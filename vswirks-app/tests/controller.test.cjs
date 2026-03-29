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
      isDestroyed() {
        return false;
      },
      show() {},
      focus() {},
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

test("reconcileBridgeProject switches to an existing bridge workspace and updates its target", () => {
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
  controller.bridgeState = {
    workspaceRoots: ["/tmp/two"],
    activeWorkspaceRoot: "",
    workspaceTarget: "/tmp/two/apps/api"
  };

  const adopted = controller.reconcileBridgeProject();
  const project = controller.getActiveProject();

  assert.equal(adopted, true);
  assert.equal(project.id, second.id);
  assert.equal(project.workspaceRoot, "/tmp/two");
  assert.equal(project.targetPath, "/tmp/two/apps/api");
});

test("reconcileBridgeProject creates a project for a new bridge workspace", () => {
  const controller = createController();
  const existing = createProjectSession({
    name: "one",
    workspaceRoot: "/tmp/one",
    targetPath: "/tmp/one"
  });
  controller.projects = [existing];
  controller.activeProjectId = existing.id;
  controller.bridgeState = {
    workspaceRoots: ["/tmp/fresh"],
    activeWorkspaceRoot: "",
    workspaceTarget: "/tmp/fresh"
  };

  const adopted = controller.reconcileBridgeProject();
  const project = controller.getActiveProject();

  assert.equal(adopted, true);
  assert.equal(project.workspaceRoot, "/tmp/fresh");
  assert.equal(project.targetPath, "/tmp/fresh");
  assert.equal(controller.projects.some((entry) => entry.workspaceRoot === "/tmp/fresh"), true);
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
    assert.match(
      controller._events[0].message,
      /Target folder must stay inside the active project root/
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("syncEditorToProject opens the workspace root before a nested target path", async () => {
  const calls = [];
  const controller = createController({
    dependencies: {
      openInVSWirksEditor: async (targetPath) => {
        calls.push(targetPath);
        return true;
      }
    }
  });
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-sync-root-"));
  const nestedTarget = path.join(tmpRoot, "apps", "desktop");
  await fs.mkdir(nestedTarget, { recursive: true });
  const project = createProjectSession({
    name: "repo",
    workspaceRoot: tmpRoot,
    targetPath: nestedTarget
  });

  try {
    const ok = await controller.syncEditorToProject(project);

    assert.equal(ok, true);
    assert.deepEqual(calls, [tmpRoot]);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
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

test("default model roles use qwen-coder for building and devstral for act", () => {
  const roles = createDefaultModelRoles("qwen2.5-coder:14b-instruct");

  assert.equal(roles.builder, "qwen2.5-coder:14b-instruct");
  assert.equal(roles.reviewer, "qwen2.5-coder:14b-instruct");
  assert.equal(roles.editor, "devstral-small-2");
});

test("resolveModelForTask routes act mode to the editor role and review to reviewer", () => {
  const settings = {
    modelRoles: {
      chat: "llama3.3-8b-thinking:q6",
      builder: "qwen2.5-coder:14b-instruct",
      reviewer: "qwen2.5-coder:14b-instruct",
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
    "qwen2.5-coder:14b-instruct"
  );
});

test("normalizeModelRoles migrates the legacy OOM 27B model to default", () => {
  const roles = normalizeModelRoles(
    {
      chat: "llama3.3-8b-thinking:q6",
      refiner: "llama3.3-8b-thinking:q6",
      editor: "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit"
    },
    "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit"
  );

  assert.equal(roles.builder, "qwen2.5-coder:14b-instruct");
  assert.equal(roles.reviewer, "qwen2.5-coder:14b-instruct");
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

test("applyBridgeHandoffRequest seeds a chat from the editor handoff contract", async () => {
  let bridgePatch = null;
  const controller = createController({
    dependencies: {
      updateBridgeState: async (patch) => {
        bridgePatch = patch;
        return patch;
      }
    }
  });
  controller.bridgeState = {
    appHandoffRequest: {
      prompt: "Review this repo end to end.",
      workspaceRoot: "/tmp/vswirks-handoff",
      targetPath: "/tmp/vswirks-handoff/apps/web",
      requestedWorkflowId: "review-repo",
      requestedAgentProfileId: "review-analyst",
      requestedMode: "chat",
      requestedExecutionMode: "plan",
      attachmentsSummary: ["file: src/app.js"],
      requestedAt: 10
    }
  };

  const ok = await controller.applyBridgeHandoffRequest();
  const project = controller.getActiveProject();
  const thread = controller.getActiveThread(project);

  assert.equal(ok, true);
  assert.equal(project.workspaceRoot, "/tmp/vswirks-handoff");
  assert.equal(project.targetPath, "/tmp/vswirks-handoff/apps/web");
  assert.equal(thread.agentProfileId, "review-analyst");
  assert.equal(thread.draftPrompt, "Review this repo end to end.");
  assert.match(thread.messages[0].content, /Seeded from VSWirks Editor handoff/);
  assert.equal(
    bridgePatch.appHandoffRequest.requestedWorkflowId,
    "review-repo"
  );
  assert.equal(bridgePatch.appHandoffRequest.seededThreadId, thread.id);
});

test("getPromptPreview composes the app global, agent, and thread prompt layers", async () => {
  const controller = createController();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vswirks-preview-"));
  await fs.mkdir(path.join(tmpRoot, ".github"), { recursive: true });
  await fs.writeFile(
    path.join(tmpRoot, ".github", "copilot-instructions.md"),
    "Use the repo conventions.",
    "utf8"
  );

  try {
    controller.settings.globalSystemPrompt = "Global prompt";
    controller.settings.agentProfiles = [
      {
        id: "app-default",
        label: "App Default",
        systemPrompt: "Default prompt",
        enabled: true
      },
      {
        id: "review-analyst",
        label: "Review Analyst",
        preferredRole: "reviewer",
        systemPrompt: "Agent profile prompt",
        enabled: true
      }
    ];
    controller.settings.defaultAgentProfileId = "app-default";

    const project = createProjectSession({
      name: "repo",
      workspaceRoot: tmpRoot,
      targetPath: tmpRoot,
      defaultAgentProfileId: "review-analyst"
    });
    const thread = project.threads[0];
    thread.agentProfileId = "review-analyst";
    thread.systemPromptOverride = "Thread prompt";
    controller.projects = [project];
    controller.activeProjectId = project.id;

    const preview = await controller.getPromptPreview({
      prompt: "Review the repository.",
      workflowPresetId: "review-repo",
      agentProfileId: "review-analyst"
    });

    assert.equal(preview.ok, true);
    assert.match(preview.preview, /Workspace instructions:\nUse the repo conventions\./);
    assert.match(preview.preview, /Global system prompt:\nGlobal prompt/);
    assert.match(preview.preview, /Agent profile \(Review Analyst\):\nAgent profile prompt/);
    assert.match(preview.preview, /Thread override prompt:\nThread prompt/);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
