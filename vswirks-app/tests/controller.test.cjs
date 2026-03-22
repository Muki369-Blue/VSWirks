const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createProjectSession, createSpecDraft } = require("../../shared/core");
const {
  VSWirksController,
  createDefaultModelRoles,
  normalizeModelRoles,
  resolveModelForTask
} = require("../electron/controller.cjs");

function createController(options = {}) {
  const sent = [];
  const controller = new VSWirksController(
    {
      webContents: {
        send(...args) {
          sent.push(args);
        }
      }
    },
    options.dependencies || {}
  );
  controller._sent = sent;
  controller.postState = () => {};
  controller.persistState = async () => {};
  controller.emitEvent = (payload) => {
    controller._events = [...(controller._events || []), payload];
  };
  return controller;
}

test("reconcileBridgeProject adopts the bridge workspace into an empty project", () => {
  const controller = createController();
  controller.projects = [
    createProjectSession({
      name: "No Project Selected",
      workspaceRoot: "",
      targetPath: ""
    })
  ];
  controller.activeProjectId = controller.projects[0].id;
  controller.bridgeState = {
    activeWorkspaceRoot: "/tmp/vswirks-demo",
    workspaceTarget: "/tmp/vswirks-demo/apps/web"
  };

  const adopted = controller.reconcileBridgeProject();
  const project = controller.getActiveProject();

  assert.equal(adopted, true);
  assert.equal(project.workspaceRoot, "/tmp/vswirks-demo");
  assert.equal(project.targetPath, "/tmp/vswirks-demo/apps/web");
});

test("switchProject refreshes intelligence and syncs editor state for the selected project", async () => {
  const controller = createController();
  const first = createProjectSession({
    name: "one",
    workspaceRoot: "/tmp/one",
    targetPath: "/tmp/one"
  });
  const second = createProjectSession({
    name: "two",
    workspaceRoot: "/tmp/two",
    targetPath: "/tmp/two"
  });
  controller.projects = [first, second];
  controller.activeProjectId = first.id;

  let refreshed = "";
  let published = "";
  let synced = "";
  controller.refreshProjectIntelligence = async (project) => {
    refreshed = project.id;
    return {};
  };
  controller.publishEditorSelection = async (project) => {
    published = project.id;
    return true;
  };
  controller.syncEditorToProject = async (project) => {
    synced = project.id;
    return true;
  };

  const switched = await controller.switchProject(second.id);

  assert.equal(switched, true);
  assert.equal(controller.activeProjectId, second.id);
  assert.equal(refreshed, second.id);
  assert.equal(published, second.id);
  assert.equal(synced, second.id);
});

test("setTargetPath rejects folders outside the active project root", async () => {
  const controller = createController();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-root-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-outside-"));
  try {
    const project = createProjectSession({
      name: "demo",
      workspaceRoot: tmpRoot,
      targetPath: tmpRoot
    });
    controller.projects = [project];
    controller.activeProjectId = project.id;
    controller.pickFolder = async () => outside;

    const ok = await controller.setTargetPath({});

    assert.equal(ok, false);
    assert.match(controller._events[0].message, /Target folder must stay inside the active project root/);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("applyEditorActionLocally forwards openDiff actions to the editor dependency", async () => {
  const calls = [];
  const controller = createController({
    dependencies: {
      openDiffInVSWirksEditor: async (...args) => {
        calls.push(args);
        return true;
      }
    }
  });

  const ok = await controller.applyEditorActionLocally({
    type: "openDiff",
    leftPath: "/tmp/old.js",
    rightPath: "/tmp/new.js",
    label: "VSWirks Diff"
  });

  assert.equal(ok, true);
  assert.deepEqual(calls, [["/tmp/old.js", "/tmp/new.js", "VSWirks Diff"]]);
});

test("openRunDiff publishes a real diff action when a backup exists", async () => {
  const controller = createController();
  const project = createProjectSession({
    name: "repo",
    workspaceRoot: "/tmp/repo",
    targetPath: "/tmp/repo"
  });
  const run = {
    id: "run-1",
    events: [
      {
        id: "evt-1",
        path: "src/app.js",
        detail: "Backup created: /tmp/repo/src/app.js.bak.20260320-000000"
      }
    ]
  };
  project.runs = [run];
  project.currentRunId = run.id;
  controller.projects = [project];
  controller.activeProjectId = project.id;

  let action = null;
  controller.publishEditorAction = async (payload) => {
    action = payload;
    return true;
  };

  const ok = await controller.openRunDiff({
    runId: run.id,
    eventId: "evt-1"
  });

  assert.equal(ok, true);
  assert.deepEqual(action, {
    type: "openDiff",
    leftPath: "/tmp/repo/src/app.js.bak.20260320-000000",
    rightPath: "/tmp/repo/src/app.js",
    label: "VSWirks Diff: src/app.js"
  });
});

test("reviewGeneratedFiles opens a review chat seeded with the changed files", async () => {
  const controller = createController();
  const project = createProjectSession({
    name: "repo",
    workspaceRoot: "/tmp/repo",
    targetPath: "/tmp/repo"
  });
  const run = {
    id: "run-1",
    changedFiles: ["src/app.js", "tests/app.test.js"]
  };
  project.runs = [run];
  project.currentRunId = run.id;
  controller.projects = [project];
  controller.activeProjectId = project.id;

  let newChatPayload = null;
  let sendPayload = null;
  controller.newChat = async (payload) => {
    newChatPayload = payload;
    return true;
  };
  controller.sendPrompt = async (payload) => {
    sendPayload = payload;
    return true;
  };

  const ok = await controller.reviewGeneratedFiles({ runId: run.id });

  assert.equal(ok, true);
  assert.deepEqual(newChatPayload, {
    workflowPresetId: "review-repo",
    mode: "chat",
    executionMode: "plan"
  });
  assert.equal(sendPayload.workflowPresetId, "review-repo");
  assert.match(sendPayload.prompt, /src\/app\.js/);
  assert.match(sendPayload.prompt, /tests\/app\.test\.js/);
});

test("default model roles prefer MLX for planning and devstral for act", () => {
  const roles = createDefaultModelRoles("mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit");

  assert.equal(roles.builder, "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit");
  assert.equal(roles.reviewer, "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit");
  assert.equal(roles.editor, "devstral-small-2");
});

test("resolveModelForTask routes act mode to the editor role and review to reviewer", () => {
  const settings = {
    modelRoles: {
      chat: "llama3.3-8b-thinking:q6",
      builder: "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit",
      reviewer: "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit",
      refiner: "llama3.3-8b-thinking:q6",
      editor: "devstral-small-2"
    }
  };

  assert.equal(
    resolveModelForTask(settings, {
      prompt: "Scaffold a production repo here",
      mode: "agent",
      executionMode: "act",
      purpose: "conversation"
    }),
    "devstral-small-2"
  );
  assert.equal(
    resolveModelForTask(settings, {
      prompt: "Review this repo for regressions",
      mode: "chat",
      executionMode: "plan",
      purpose: "conversation"
    }),
    "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit"
  );
});

test("normalizeModelRoles migrates the legacy qwen act default to devstral", () => {
  const roles = normalizeModelRoles(
    {
      chat: "llama3.3-8b-thinking:q6",
      refiner: "llama3.3-8b-thinking:q6",
      editor: "qwen2.5-coder:14b-instruct"
    },
    "qwen2.5-coder:14b-instruct"
  );

  assert.equal(roles.builder, "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit");
  assert.equal(roles.reviewer, "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit");
  assert.equal(roles.editor, "devstral-small-2");
});

test("sendPrompt can reuse an existing spec without regenerating it", async () => {
  let captured = null;
  const controller = createController({
    dependencies: {
      runConversation: async (payload) => {
        captured = payload;
      }
    }
  });
  const project = createProjectSession({
    name: "repo",
    workspaceRoot: "/tmp/repo",
    targetPath: "/tmp/repo"
  });
  const thread = project.threads[0];
  const spec = createSpecDraft({
    threadId: thread.id,
    workflowId: "scaffold-app",
    title: "Scaffold Spec",
    goal: "Ship the repo",
    raw: "Build the app in phases.",
    generatedFrom: "Create the application"
  });
  project.specs = [spec];
  project.activeSpecId = spec.id;
  thread.specDraftId = spec.id;
  thread.workflowPresetId = "scaffold-app";
  thread.mode = "agent";
  thread.executionMode = "act";
  controller.projects = [project];
  controller.activeProjectId = project.id;
  controller.serviceState = { healthy: true, starting: false, label: "Service ready" };
  controller.refreshProjectIntelligence = async () => ({});
  controller.finalizeValidationIfNeeded = async () => {};
  controller.revealRunOutputs = async () => {};

  let buildCount = 0;
  controller.generateSpecDraft = async () => {
    buildCount += 1;
    return spec;
  };

  const ok = await controller.sendPrompt({
    prompt: "Create the application",
    mode: "agent",
    executionMode: "act",
    workflowPresetId: "scaffold-app",
    useActiveSpec: true
  });

  assert.equal(ok, true);
  assert.equal(buildCount, 0);
  assert.equal(captured.specDraft.id, spec.id);
});
