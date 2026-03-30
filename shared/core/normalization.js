const {
  APP_STATE_VERSION,
  DEFAULT_EXECUTION_MODE,
  MAX_STORED_THREADS,
  MAX_STORED_PROJECTS,
  MAX_STORED_SPECS,
  MAX_STORED_RUNS
} = require("./defaults");
const { makeId, normalizeExecutionMode, normalizeWriteApprovalMode } = require("./utils");
const {
  createMessage,
  normalizeMessage,
  createThread,
  createProjectIntelligence,
  normalizeSpecDraft,
  normalizeRunRecord,
  normalizeWorkflowPreset,
  normalizeProjectIntelligence
} = require("./factories");
const { getDefaultWorkflowPresets } = require("./presets");

function createProjectSession(seed = {}) {
  const thread = createThread({
    mode: seed.mode || "chat",
    executionMode: seed.executionMode || DEFAULT_EXECUTION_MODE,
    modelOverride: seed.modelOverride || seed.model || "",
    agentProfileId: seed.agentProfileId || "",
    systemPromptOverride: seed.systemPromptOverride || "",
    draftPrompt: seed.draftPrompt || "",
    workflowPresetId: seed.workflowPresetId || "freeform"
  });
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : makeId("project"),
    name:
      typeof seed.name === "string" && seed.name.trim()
        ? seed.name.trim()
        : "Untitled Project",
    workspaceRoot:
      typeof seed.workspaceRoot === "string" && seed.workspaceRoot.trim()
        ? seed.workspaceRoot.trim()
        : "",
    targetPath:
      typeof seed.targetPath === "string" && seed.targetPath.trim()
        ? seed.targetPath.trim()
        : typeof seed.workspaceRoot === "string"
          ? seed.workspaceRoot.trim()
          : "",
    createdAt: Number(seed.createdAt) || Date.now(),
    updatedAt: Number(seed.updatedAt) || Date.now(),
    activeThreadId: thread.id,
    defaultAgentProfileId:
      typeof seed.defaultAgentProfileId === "string" ? seed.defaultAgentProfileId : "",
    activeSpecId: typeof seed.activeSpecId === "string" ? seed.activeSpecId : "",
    currentRunId: typeof seed.currentRunId === "string" ? seed.currentRunId : "",
    threads: [thread],
    pendingAttachments: [],
    currentRunStatus:
      typeof seed.currentRunStatus === "string" ? seed.currentRunStatus : "idle",
    runs: [],
    specs: [],
    workflowPresets: getDefaultWorkflowPresets(),
    intelligence: createProjectIntelligence({
      workspaceRoot: seed.workspaceRoot || "",
      targetPath: seed.targetPath || seed.workspaceRoot || "",
      summary: "No project intelligence generated yet."
    })
  };
}

function normalizeThread(thread) {
  if (!thread || typeof thread !== "object" || !Array.isArray(thread.messages)) {
    return null;
  }

  const messages = thread.messages.map((message) => normalizeMessage(message)).filter(Boolean);
  return {
    id: typeof thread.id === "string" && thread.id ? thread.id : makeId("thread"),
    title:
      typeof thread.title === "string" && thread.title.trim()
        ? thread.title.trim()
        : "New chat",
    createdAt: Number(thread.createdAt) || Date.now(),
    updatedAt: Number(thread.updatedAt) || Date.now(),
    mode: thread.mode === "agent" ? "agent" : "chat",
    executionMode: normalizeExecutionMode(thread.executionMode),
    writeApprovalMode: normalizeWriteApprovalMode(thread.writeApprovalMode),
    model:
      typeof thread.modelOverride === "string"
        ? thread.modelOverride
        : typeof thread.model === "string"
          ? thread.model
          : "",
    modelOverride:
      typeof thread.modelOverride === "string"
        ? thread.modelOverride
        : typeof thread.model === "string"
          ? thread.model
          : "",
    lastModelUsed: typeof thread.lastModelUsed === "string" ? thread.lastModelUsed : "",
    agentProfileId: typeof thread.agentProfileId === "string" ? thread.agentProfileId : "",
    systemPromptOverride:
      typeof thread.systemPromptOverride === "string" ? thread.systemPromptOverride : "",
    workflowPresetId:
      typeof thread.workflowPresetId === "string" && thread.workflowPresetId
        ? thread.workflowPresetId
        : "freeform",
    pausedAfterSpec: Boolean(thread.pausedAfterSpec),
    approvalScope:
      typeof thread.approvalScope === "string" && thread.approvalScope
        ? thread.approvalScope
        : "ask",
    currentRunId: typeof thread.currentRunId === "string" ? thread.currentRunId : "",
    specDraftId: typeof thread.specDraftId === "string" ? thread.specDraftId : "",
    draftPrompt: typeof thread.draftPrompt === "string" ? thread.draftPrompt : "",
    lastValidationResult:
      typeof thread.lastValidationResult === "string" ? thread.lastValidationResult : "",
    messages
  };
}

function touchThread(threads, threadId) {
  const index = threads.findIndex((entry) => entry.id === threadId);
  if (index === -1) {
    return;
  }
  const [thread] = threads.splice(index, 1);
  thread.updatedAt = Date.now();
  threads.unshift(thread);
}

function normalizeWorkflowPresetList(presets) {
  const defaults = getDefaultWorkflowPresets();
  const incoming = Array.isArray(presets)
    ? presets.map((preset) => normalizeWorkflowPreset(preset)).filter(Boolean)
    : [];
  const merged = new Map(defaults.map((preset) => [preset.id, preset]));
  for (const preset of incoming) {
    merged.set(preset.id, preset);
  }
  return Array.from(merged.values());
}

function normalizeProjectSession(project) {
  if (!project || typeof project !== "object") {
    return null;
  }

  const threads = Array.isArray(project.threads)
    ? project.threads
        .map((thread) => normalizeThread(thread))
        .filter(Boolean)
        .slice(0, MAX_STORED_THREADS)
    : [];

  if (!threads.length) {
    const created = createProjectSession(project);
    created.pendingAttachments = Array.isArray(project.pendingAttachments)
      ? project.pendingAttachments
      : [];
    created.runs = Array.isArray(project.runs)
      ? project.runs.map((run) => normalizeRunRecord(run)).filter(Boolean).slice(0, MAX_STORED_RUNS)
      : [];
    created.specs = Array.isArray(project.specs)
      ? project.specs.map((spec) => normalizeSpecDraft(spec)).filter(Boolean).slice(0, MAX_STORED_SPECS)
      : [];
    created.workflowPresets = normalizeWorkflowPresetList(project.workflowPresets);
    created.intelligence =
      normalizeProjectIntelligence(project.intelligence) ||
      createProjectIntelligence({
        workspaceRoot: created.workspaceRoot,
        targetPath: created.targetPath,
        summary: "No project intelligence generated yet."
      });
    return created;
  }

  const activeThreadId = threads.some((thread) => thread.id === project.activeThreadId)
    ? project.activeThreadId
    : threads[0].id;
  const specs = Array.isArray(project.specs)
    ? project.specs.map((spec) => normalizeSpecDraft(spec)).filter(Boolean).slice(0, MAX_STORED_SPECS)
    : [];
  const activeSpecId = specs.some((spec) => spec.id === project.activeSpecId)
    ? project.activeSpecId
    : specs[0]
      ? specs[0].id
      : "";
  const runs = Array.isArray(project.runs)
    ? project.runs.map((run) => normalizeRunRecord(run)).filter(Boolean).slice(0, MAX_STORED_RUNS)
    : [];

  return {
    id: typeof project.id === "string" && project.id ? project.id : makeId("project"),
    name:
      typeof project.name === "string" && project.name.trim()
        ? project.name.trim()
        : "Untitled Project",
    workspaceRoot: typeof project.workspaceRoot === "string" ? project.workspaceRoot : "",
    targetPath:
      typeof project.targetPath === "string" && project.targetPath
        ? project.targetPath
        : typeof project.workspaceRoot === "string"
          ? project.workspaceRoot
          : "",
    createdAt: Number(project.createdAt) || Date.now(),
    updatedAt: Number(project.updatedAt) || Date.now(),
    activeThreadId,
    defaultAgentProfileId:
      typeof project.defaultAgentProfileId === "string" ? project.defaultAgentProfileId : "",
    activeSpecId,
    currentRunId:
      typeof project.currentRunId === "string" && project.currentRunId
        ? project.currentRunId
        : runs.find((run) => ["running", "paused_recoverable", "awaiting_approval", "paused_after_spec"].includes(run.status))?.id || "",
    threads,
    pendingAttachments: Array.isArray(project.pendingAttachments) ? project.pendingAttachments : [],
    currentRunStatus:
      typeof project.currentRunStatus === "string" ? project.currentRunStatus : "idle",
    runs,
    specs,
    workflowPresets: normalizeWorkflowPresetList(project.workflowPresets),
    intelligence:
      normalizeProjectIntelligence(project.intelligence) ||
      createProjectIntelligence({
        workspaceRoot: project.workspaceRoot || "",
        targetPath: project.targetPath || project.workspaceRoot || "",
        summary: "No project intelligence generated yet."
      })
  };
}

function normalizeAppState(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.projects)) {
    return {
      version: APP_STATE_VERSION,
      activeProjectId: "",
      projects: []
    };
  }

  const projects = raw.projects
    .map((project) => normalizeProjectSession(project))
    .filter(Boolean)
    .slice(0, MAX_STORED_PROJECTS);

  const activeProjectId = projects.some((project) => project.id === raw.activeProjectId)
    ? raw.activeProjectId
    : projects[0]
      ? projects[0].id
      : "";

  return {
    version: APP_STATE_VERSION,
    activeProjectId,
    projects
  };
}

function touchProject(projects, projectId) {
  const index = projects.findIndex((entry) => entry.id === projectId);
  if (index === -1) {
    return;
  }
  const [project] = projects.splice(index, 1);
  project.updatedAt = Date.now();
  projects.unshift(project);
}

module.exports = {
  createProjectSession,
  normalizeThread,
  touchThread,
  normalizeWorkflowPresetList,
  normalizeProjectSession,
  normalizeAppState,
  touchProject
};
