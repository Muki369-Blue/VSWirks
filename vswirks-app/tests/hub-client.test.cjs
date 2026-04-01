const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  fetchHubJson,
  probeHubHealth,
  HUB_REQUEST_TIMEOUT_MS
} = require("../../shared/hub-client.js");

async function withHubServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

test("fetchHubJson performs GET requests against ai-hub style endpoints", async () => {
  await withHubServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/ops/hub-bundle");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, services: { ports: { "ai-hub": true } } }));
  }, async (baseUrl) => {
    const result = await fetchHubJson(baseUrl, "/ops/hub-bundle");
    assert.equal(result.ok, true);
    assert.equal(result.services.ports["ai-hub"], true);
  });
});

test("probeHubHealth accepts /healthz", async () => {
  await withHubServer((request, response) => {
    if (request.url === "/healthz") {
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.statusCode = 404;
    response.end("missing");
  }, async (baseUrl) => {
    const result = await probeHubHealth(baseUrl);
    assert.deepEqual(result, { healthy: true, label: "Hub ready" });
  });
});

test("hub request timeout stays short for control-plane probes", () => {
  assert.equal(HUB_REQUEST_TIMEOUT_MS, 30 * 1000);
});
