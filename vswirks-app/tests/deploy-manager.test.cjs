const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DeployManager } = require("../electron/deploy/deploy-manager.cjs");

describe("DeployManager", () => {
  it("build returns error without workspace root", async () => {
    const dm = new DeployManager();
    const result = await dm.build({ projectId: "test" });
    assert.equal(result.ok, false);
    assert.match(result.error, /workspace/i);
  });

  it("package returns error without workspace root", async () => {
    const dm = new DeployManager();
    const result = await dm.package({ projectId: "test" });
    assert.equal(result.ok, false);
    assert.match(result.error, /workspace/i);
  });

  it("package returns error for unsupported format", async () => {
    const dm = new DeployManager();
    const result = await dm.package({ projectId: "test", workspaceRoot: "/tmp", format: "rar" });
    assert.equal(result.ok, false);
    assert.match(result.error, /Unsupported format/);
  });

  it("listReleases returns empty array for unknown project", async () => {
    const dm = new DeployManager();
    const releases = await dm.listReleases({ projectId: "unknown-proj" });
    assert.deepEqual(releases, []);
  });

  it("getRelease returns null for unknown release", async () => {
    const dm = new DeployManager();
    const release = await dm.getRelease({ projectId: "unknown-proj", releaseId: "r1" });
    assert.equal(release, null);
  });

  it("deployLocal returns error without required params", async () => {
    const dm = new DeployManager();
    const result = await dm.deployLocal({ projectId: "test" });
    assert.equal(result.ok, false);
    assert.match(result.error, /Missing/);
  });

  it("emits events via constructor callback", async () => {
    const events = [];
    const dm = new DeployManager({ emitEvent: (e) => events.push(e) });
    // Build will fail but should emit start event
    await dm.build({ projectId: "test", workspaceRoot: "/nonexistent/path", command: "false" });
    assert.ok(events.some((e) => e.type === "deploy-build-start"));
  });
});
