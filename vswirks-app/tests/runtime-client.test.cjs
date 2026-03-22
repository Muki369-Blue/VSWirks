const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  fetchRuntimeJson,
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
