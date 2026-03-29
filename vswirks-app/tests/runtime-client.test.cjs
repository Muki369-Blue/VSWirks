const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  fetchRuntimeJson,
  probeRuntimeHealth,
  waitForRuntimeHealthy,
  RUNTIME_JSON_REQUEST_TIMEOUT_MS
} = require("../../shared/runtime-client.js");

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

test("fetchRuntimeJson performs GET requests over the node http client", async () => {
  await withServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/v1/models");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ object: "list", data: [] }));
  }, async (baseUrl) => {
    const result = await fetchRuntimeJson(baseUrl, "/models");
    assert.deepEqual(result, { object: "list", data: [] });
  });
});

test("fetchRuntimeJson performs POST requests and parses JSON", async () => {
  await withServer((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/chat/completions");

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          received: JSON.parse(body)
        })
      );
    });
  }, async (baseUrl) => {
    const payload = {
      model: "mlx/test",
      messages: [{ role: "user", content: "hello" }]
    };
    const result = await fetchRuntimeJson(baseUrl, "/chat/completions", payload);
    assert.deepEqual(result, { received: payload });
  });
});

test("fetchRuntimeJson surfaces non-2xx runtime errors", async () => {
  await withServer((request, response) => {
    response.statusCode = 504;
    response.end("mlx worker timed out");
  }, async (baseUrl) => {
    await assert.rejects(
      fetchRuntimeJson(baseUrl, "/chat/completions", { model: "mlx/test" }),
      /mlx worker timed out/
    );
  });
});

test("runtime JSON timeout is extended for long-running local model requests", () => {
  assert.equal(RUNTIME_JSON_REQUEST_TIMEOUT_MS, 15 * 60 * 1000);
});

test("probeRuntimeHealth accepts the canonical /health endpoint", async () => {
  await withServer((request, response) => {
    if (request.url === "/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  }, async (baseUrl) => {
    const result = await probeRuntimeHealth(baseUrl);
    assert.deepEqual(result, {
      healthy: true,
      label: "Service ready"
    });
  });
});

test("probeRuntimeHealth accepts /healthz when /health is unavailable", async () => {
  await withServer((request, response) => {
    if (request.url === "/health") {
      response.statusCode = 404;
      response.end("missing");
      return;
    }
    if (request.url === "/healthz") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  }, async (baseUrl) => {
    const result = await probeRuntimeHealth(baseUrl);
    assert.deepEqual(result, {
      healthy: true,
      label: "Service ready"
    });
  });
});

test("probeRuntimeHealth falls back to /v1/models when health endpoints are unavailable", async () => {
  await withServer((request, response) => {
    if (request.url === "/health" || request.url === "/healthz") {
      response.statusCode = 404;
      response.end("missing");
      return;
    }
    if (request.url === "/v1/models") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ object: "list", data: [{ id: "llama3.1:8b" }] }));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  }, async (baseUrl) => {
    const result = await probeRuntimeHealth(baseUrl);
    assert.deepEqual(result, {
      healthy: true,
      label: "Service ready"
    });
  });
});

test("probeRuntimeHealth reports offline when no readiness endpoint succeeds", async () => {
  await withServer((request, response) => {
    response.statusCode = 404;
    response.end("not found");
  }, async (baseUrl) => {
    const result = await probeRuntimeHealth(baseUrl);
    assert.deepEqual(result, {
      healthy: false,
      label: "Service offline"
    });
  });
});

test("waitForRuntimeHealthy succeeds when a compatible models endpoint is available", async () => {
  await withServer((request, response) => {
    if (request.url === "/health" || request.url === "/healthz") {
      response.statusCode = 404;
      response.end("missing");
      return;
    }
    if (request.url === "/v1/models") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ object: "list", data: [{ id: "devstral-small-2" }] }));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  }, async (baseUrl) => {
    const ready = await waitForRuntimeHealthy(baseUrl, 1000);
    assert.equal(ready, true);
  });
});
