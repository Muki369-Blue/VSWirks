const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { PreviewManager } = require("../electron/preview/preview-manager.cjs");

describe("PreviewManager", () => {
  it("getStatus returns not running for unknown project", () => {
    const pm = new PreviewManager();
    const status = pm.getStatus({ projectId: "unknown" });
    assert.equal(status.running, false);
  });

  it("getLogs returns empty array for unknown project", () => {
    const pm = new PreviewManager();
    const logs = pm.getLogs({ projectId: "unknown" });
    assert.deepEqual(logs, []);
  });

  it("stop returns error for project with no preview", async () => {
    const pm = new PreviewManager();
    const result = await pm.stop({ projectId: "unknown" });
    assert.equal(result.ok, false);
    assert.match(result.error, /No preview/);
  });

  it("restart returns error for project with no preview", async () => {
    const pm = new PreviewManager();
    const result = await pm.restart({ projectId: "unknown" });
    assert.equal(result.ok, false);
  });

  it("start returns error without workspace root", async () => {
    const pm = new PreviewManager();
    const result = await pm.start({ projectId: "test" });
    assert.equal(result.ok, false);
    assert.match(result.error, /workspace/i);
  });

  it("stopAll resolves cleanly with no running servers", async () => {
    const pm = new PreviewManager();
    await pm.stopAll(); // should not throw
  });
});
