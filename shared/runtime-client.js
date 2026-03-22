const http = require("node:http");
const https = require("node:https");

const {
  DEFAULT_RUNTIME_BASE_URL,
  delay,
  safeJsonParse
} = require("./core");

const RUNTIME_JSON_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

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

async function fetchRuntimeJson(baseUrl, endpoint, body, signal) {
  const text = await requestRuntimeText(baseUrl, endpoint, body, signal);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Runtime returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function streamRuntimeChat(baseUrl, body, signal, handlers = {}) {
  const response = await fetchRuntimeRaw(baseUrl, "/chat/completions", body, signal);
  if (!response.body) {
    throw new Error("Streaming response body was not available.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

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
}

async function probeRuntimeHealth(baseUrl) {
  try {
    const response = await fetch(`${getRuntimeServiceUrl(baseUrl)}/health`);
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
  requestRuntimeText,
  streamRuntimeChat,
  probeRuntimeHealth,
  waitForRuntimeHealthy,
  RUNTIME_JSON_REQUEST_TIMEOUT_MS
};
