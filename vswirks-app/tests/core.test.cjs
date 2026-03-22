const test = require("node:test");
const assert = require("node:assert/strict");

const {
  APP_STATE_VERSION,
  normalizeAppState,
  createSpecDraft,
  createRunRecord,
  getDefaultWorkflowPresets
} = require("../../shared/core");

test("normalizeAppState migrates legacy projects into the versioned shape", () => {
  const normalized = normalizeAppState({
    activeProjectId: "project-1",
    projects: [
      {
        id: "project-1",
        name: "Demo",
        workspaceRoot: "/tmp/demo",
        targetPath: "/tmp/demo",
        activeThreadId: "thread-1",
        threads: [
          {
            id: "thread-1",
            title: "Legacy thread",
            messages: []
          }
        ]
      }
    ]
  });

  assert.equal(normalized.version, APP_STATE_VERSION);
  assert.equal(normalized.activeProjectId, "project-1");
  assert.equal(normalized.projects[0].workflowPresets.length, getDefaultWorkflowPresets().length);
  assert.equal(normalized.projects[0].currentRunStatus, "idle");
  assert.ok(normalized.projects[0].intelligence);
});

test("new specs and runs retain stable ids and required fields", () => {
  const spec = createSpecDraft({
    title: "My Spec",
    goal: "Build the thing"
  });
  const run = createRunRecord({
    prompt: "build the thing",
    workflowId: "scaffold-app"
  });

  assert.ok(spec.id.startsWith("spec-"));
  assert.equal(spec.title, "My Spec");
  assert.ok(run.id.startsWith("run-"));
  assert.equal(run.workflowId, "scaffold-app");
  assert.deepEqual(run.changedFiles, []);
});
