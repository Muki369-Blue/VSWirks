const http = require("node:http");
const https = require("node:https");

const {
  DEFAULT_RUNTIME_BASE_URL,
  delay,
  safeJsonParse
} = require("./core");

const RUNTIME_JSON_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const TRANSIENT_RETRY_MAX = 3;
const TRANSIENT_RETRY_BASE_MS = 800;

function normalizeBaseUrl(baseUrl) {
  const normalized = String(baseUrl || DEFAULT_RUNTIME_BASE_URL).trim();
  return normalized ? normalized.replace(/\/$/, "") : DEFAULT_RUNTIME_BASE_URL;
}

function getRuntimeServiceUrl(baseUrl) {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/, "");
}

async function fetchRuntimeRaw(baseUrl, endpoint, body, signal) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined,
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  return response;
}

function requestRuntimeText(baseUrl, endpoint, body, signal) {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${endpoint}`);
  const transport = url.protocol === "https:" ? https : http;
  const payload = body ? JSON.stringify(body) : "";
  const headers = body
    ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    : {};

  return new Promise((resolve, reject) => {
    let settled = false;
    let request = null;

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const resolveOnce = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      const abortError = new Error("This operation was aborted");
      abortError.name = "AbortError";
      if (request) {
        request.destroy(abortError);
      }
      rejectOnce(abortError);
    };

    if (signal && signal.aborted) {
      onAbort();
      return;
    }

    request = transport.request(
      url,
      {
        method: body ? "POST" : "GET",
        headers
      },
      (response) => {
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          const text = chunks.join("");
          if (response.statusCode && response.statusCode >= 400) {
            rejectOnce(new Error(text || `${response.statusCode} ${response.statusMessage || ""}`.trim()));
            return;
          }
          resolveOnce(text);
        });
      }
    );

    request.setTimeout(RUNTIME_JSON_REQUEST_TIMEOUT_MS, () => {
      request.destroy(
        new Error(
          `Runtime JSON request timed out after ${Math.round(
            RUNTIME_JSON_REQUEST_TIMEOUT_MS / 1000
          )}s`
        )
      );
    });
    request.on("error", (error) => {
      rejectOnce(error);
    });

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    request.end(payload || undefined);
  });
}

function isTransientError(error) {
  if (!error) {
    return false;
  }
  if (error.name === "AbortError") {
    return false;
  }
  const msg = String(error.message || "").toLowerCase();
  if (
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("upstream unavailable") ||
    msg.includes("socket hang up") ||
    /\b(429|502|503|504)\b/.test(msg)
  ) {
    return true;
  }
  return false;
}

async function fetchRuntimeJson(baseUrl, endpoint, body, signal) {
  let lastError;
  for (let attempt = 0; attempt < TRANSIENT_RETRY_MAX; attempt += 1) {
    if (signal && signal.aborted) {
      const abortError = new Error("This operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    }
    try {
      const text = await requestRuntimeText(baseUrl, endpoint, body, signal);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === TRANSIENT_RETRY_MAX - 1) {
        break;
      }
      const backoff = TRANSIENT_RETRY_BASE_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
      await delay(backoff);
    }
  }
  if (lastError && String(lastError.message || "").includes("invalid JSON")) {
    throw lastError;
  }
  throw lastError || new Error("fetchRuntimeJson failed after retries");
}

async function streamRuntimeChat(baseUrl, body, signal, handlers = {}) {
  const response = await fetchRuntimeRaw(baseUrl, "/chat/completions", body, signal);
  if (!response.body) {
    throw new Error("Streaming response body was not available.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  let inactivityTimer = null;
  const abortController = signal ? null : new AbortController();
  const resetInactivity = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (abortController) abortController.abort();
      reader.cancel().catch(() => {});
    }, 60000);
  };
  resetInactivity();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      resetInactivity();
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const line = event
          .split(/\r?\n/)
          .find((entry) => entry.startsWith("data: "));
        if (!line) {
          continue;
        }
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") {
          if (handlers.onDone) {
            handlers.onDone();
          }
          return;
        }

        const json = safeJsonParse(payload, {});
        if (json.usage && handlers.onUsage) {
          handlers.onUsage(json.usage);
        }

        const choice = json.choices && json.choices[0];
        if (!choice || !choice.delta) {
          continue;
        }

        if (choice.delta.content && handlers.onText) {
          handlers.onText(choice.delta.content);
        }
      }
    }
  } finally {
    if (inactivityTimer) clearTimeout(inactivityTimer);
  }
}

async function probeRuntimeHealth(baseUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${getRuntimeServiceUrl(baseUrl)}/health`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return {
      healthy: true,
      label: "Service ready"
    };
  } catch {
    return {
      healthy: false,
      label: "Service offline"
    };
  }
}

async function waitForRuntimeHealthy(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const next = await probeRuntimeHealth(baseUrl);
    if (next.healthy) {
      return true;
    }
    await delay(500);
  }
  return false;
}

module.exports = {
  normalizeBaseUrl,
  getRuntimeServiceUrl,
  fetchRuntimeRaw,
  fetchRuntimeJson,
  isTransientError,
  requestRuntimeText,
  streamRuntimeChat,
  probeRuntimeHealth,
  waitForRuntimeHealthy,
  RUNTIME_JSON_REQUEST_TIMEOUT_MS,
  TRANSIENT_RETRY_MAX,
  TRANSIENT_RETRY_BASE_MS
};
