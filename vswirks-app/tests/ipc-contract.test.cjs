const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const { IPC_CHANNELS } = require("../electron/ipc-channels.cjs");

test("renderer invoke channels are registered in the app IPC contract", async () => {
  const source = await fs.readFile(path.join(__dirname, "..", "src", "app.js"), "utf8");
  const invoked = Array.from(
    new Set(Array.from(source.matchAll(/api\.invoke\("([^"]+)"/g), (match) => match[1]))
  ).sort();
  const missing = invoked.filter((channel) => !IPC_CHANNELS.includes(channel));

  assert.deepEqual(missing, []);
});

test("app IPC contract does not contain duplicate channel names", () => {
  assert.equal(new Set(IPC_CHANNELS).size, IPC_CHANNELS.length);
});
