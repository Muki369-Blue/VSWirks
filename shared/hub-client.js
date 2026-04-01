const http = require("node:http");
const https = require("node:https");

const {
  DEFAULT_HUB_BASE_URL,
  delay,
  safeJsonParse
} = require("./core");

const HUB_REQUEST_TIMEOUT_MS = 30 * 1000;
const HUB_PROBE_TIMEOUT_MS = 5000;
const HUB_RETRY_MAX = 2;
const HUB_RETRY_BASE_MS = 500;

function normalizeHubBaseUrl(baseUrl) {
  const normalized = String(baseUrl || DEFAULT_HUB_BASE_URL).trim();
  return normalized ? normalized.replace(/\/$/, "") : DEFAULT_HUB_BASE_URL;
}

function requestHubText(baseUrl, endpoint, body, signal) {
  const url = new URL(`${normalizeHubBaseUrl(baseUrl)}${endpoint}`);
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
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const rejectOnce = (error) => {
      if (settled) return;
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
        response.on("data", (chunk) => chunks.push(chunk));
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

    request.setTimeout(HUB_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Hub request timed out after ${Math.round(HUB_REQUEST_TIMEOUT_MS / 1000)}s`));
    });
    request.on("error", (error) => rejectOnce(error));

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    request.end(payload || undefined);
  });
}

function isTransientHubError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return false;
  const msg = String(error.message || "").toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    /\b(429|502|503|504|599)\b/.test(msg)
  );
}

async function fetchHubJson(baseUrl, endpoint, body, signal) {
  let lastError = null;
  for (let attempt = 0; attempt < HUB_RETRY_MAX; attempt += 1) {
    try {
      const text = await requestHubText(baseUrl, endpoint, body, signal);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (!isTransientHubError(error) || attempt === HUB_RETRY_MAX - 1) {
        break;
      }
      const backoff = HUB_RETRY_BASE_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
      await delay(backoff);
    }
  }
  throw lastError || new Error("fetchHubJson failed");
}

async function fetchHubProbe(baseUrl, endpoint, { parseJson = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HUB_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${normalizeHubBaseUrl(baseUrl)}${endpoint}`, {
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    if (!parseJson) {
      return true;
    }
    return safeJsonParse(await response.text(), null);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function probeHubHealth(baseUrl) {
  const health = await fetchHubProbe(baseUrl, "/healthz");
  if (health) {
    return { healthy: true, label: "Hub ready" };
  }
  const status = await fetchHubProbe(baseUrl, "/api/status", { parseJson: true });
  if (status && typeof status === "object") {
    return { healthy: true, label: "Hub ready" };
  }
  return { healthy: false, label: "Hub offline" };
}

module.exports = {
  normalizeHubBaseUrl,
  requestHubText,
  fetchHubJson,
  probeHubHealth,
  HUB_REQUEST_TIMEOUT_MS
};
