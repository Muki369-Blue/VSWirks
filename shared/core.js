const os = require("os");
const path = require("path");

const APP_STATE_VERSION = 3;
const MAX_STORED_THREADS = 20;
const MAX_STORED_PROJECTS = 12;
const MAX_STORED_SPECS = 16;
const MAX_STORED_RUNS = 40;
const MAX_RUN_EVENTS = 240;
const MAX_RUN_CHECKPOINTS = 80;
const MAX_TOOL_DETAIL_CHARS = 2200;
const MAX_API_MESSAGES = 120;
const DEFAULT_MODEL = "qwen2.5-coder:14b-instruct";
const DEFAULT_EXECUTION_MODE = "plan";
const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:7471/v1";
const DEFAULT_HUB_BASE_URL = "http://127.0.0.1:7460";
const DEFAULT_RUNTIME_CWD = path.join(os.homedir(), "dev", "ai-runtime");
const DEFAULT_RUNTIME_PYTHON = (() => {
  const candidates = [
    path.join(os.homedir(), "dev", "ai-app", ".venv", "bin", "python"),
    path.join(os.homedir(), ".venv", "bin", "python"),
    "/usr/local/bin/python3",
    "/usr/bin/python3"
  ];
  const _fs = require("fs");
  for (const c of candidates) {
    try { if (_fs.existsSync(c)) return c; } catch {}
  }
  return "python3";
})();
const WORKSPACE_INSTRUCTIONS_PATH = path.join(".github", "copilot-instructions.md");
const DEFAULT_SYSTEM_PROMPT =
  "You are a local-first coding assistant. Be concise, practical, and safe. " +
  "Use workspace context when you need it. When writing files, write complete file contents. " +
  "When the user asks to create a new app or repository, produce production-ready output rather than demo placeholders. " +
  "If you cannot complete the real implementation without placeholder logic, stop and say what is missing instead of inventing a demo.";
const DEFAULT_GENERATION_SETTINGS = Object.freeze({
  chatTemperature: 0.2,
  chatTopP: 0.9,
  chatMaxTokens: 4096,
  agentTemperature: 0.1,
  agentTopP: 0.85,
  agentMaxTokens: 4096
});
const AGENT_ROLE_VALUES = new Set(["chat", "builder", "reviewer", "refiner", "editor"]);

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clampNumber(value, min, max, fallbackValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeExecutionMode(value) {
  return value === "act" ? "act" : DEFAULT_EXECUTION_MODE;
}

function normalizeWriteApprovalMode(value) {
  return value === "chat" || value === "run" ? value : "ask";
}

function timestamp() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ];
  return parts.join("");
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function clampText(text, limit) {
  const normalized = typeof text === "string" ? text : String(text || "");
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function limitText(text, limit = MAX_TOOL_DETAIL_CHARS) {
  return clampText(text, limit);
}

function titleFromPrompt(prompt) {
  const cleaned = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "New chat";
  }
  return cleaned.length > 56 ? `${cleaned.slice(0, 53)}...` : cleaned;
}

function createMessage(seed = {}) {
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : makeId("message"),
    role: ["user", "assistant", "tool"].includes(seed.role) ? seed.role : "assistant",
    content: typeof seed.content === "string" ? seed.content : "",
    renderedContent:
      typeof seed.renderedContent === "string" ? seed.renderedContent : undefined,
    attachments: Array.isArray(seed.attachments) ? seed.attachments : [],
    model: typeof seed.model === "string" ? seed.model : "",
    mode: seed.mode === "agent" ? "agent" : "chat",
    executionMode: normalizeExecutionMode(seed.executionMode),
    pending: Boolean(seed.pending),
    status: typeof seed.status === "string" ? seed.status : "",
    usage: seed.usage && typeof seed.usage === "object" ? seed.usage : undefined,
    toolName: typeof seed.toolName === "string" ? seed.toolName : "",
    summary: typeof seed.summary === "string" ? seed.summary : "",
    path: typeof seed.path === "string" ? seed.path : "",
    error: Boolean(seed.error),
    sourceEventId: typeof seed.sourceEventId === "string" ? seed.sourceEventId : "",
    createdAt: Number(seed.createdAt) || Date.now()
  };
}

function createSpecDraft(seed = {}) {
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : makeId("spec"),
    threadId: typeof seed.threadId === "string" ? seed.threadId : "",
    workflowId: typeof seed.workflowId === "string" ? seed.workflowId : "freeform",
    status: typeof seed.status === "string" && seed.status ? seed.status : "draft",
    title:
      typeof seed.title === "string" && seed.title.trim()
        ? seed.title.trim()
        : "Implementation Spec",
    goal: typeof seed.goal === "string" ? seed.goal : "",
    audience: typeof seed.audience === "string" ? seed.audience : "",
    stack: Array.isArray(seed.stack)
      ? seed.stack.filter((value) => typeof value === "string" && value.trim())
      : [],
    constraints: Array.isArray(seed.constraints)
      ? seed.constraints.filter((value) => typeof value === "string" && value.trim())
      : [],
    deliverables: Array.isArray(seed.deliverables)
      ? seed.deliverables.filter((value) => typeof value === "string" && value.trim())
      : [],
    acceptance_criteria: Array.isArray(seed.acceptance_criteria)
      ? seed.acceptance_criteria.filter((value) => typeof value === "string" && value.trim())
      : [],
    validation_plan: Array.isArray(seed.validation_plan)
      ? seed.validation_plan.filter((value) => typeof value === "string" && value.trim())
      : [],
    implementation_plan: Array.isArray(seed.implementation_plan)
      ? seed.implementation_plan.filter((value) => typeof value === "string" && value.trim())
      : [],
    raw: typeof seed.raw === "string" ? seed.raw : "",
    generatedFrom: typeof seed.generatedFrom === "string" ? seed.generatedFrom : "",
    model: typeof seed.model === "string" ? seed.model : "",
    createdAt: Number(seed.createdAt) || Date.now(),
    updatedAt: Number(seed.updatedAt) || Date.now()
  };
}

function normalizeSpecDraft(spec) {
  if (!spec || typeof spec !== "object") {
    return null;
  }
  return createSpecDraft(spec);
}

function createWorkflowPreset(seed = {}) {
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : makeId("workflow"),
    label:
      typeof seed.label === "string" && seed.label.trim()
        ? seed.label.trim()
        : "Custom Workflow",
    description:
      typeof seed.description === "string" && seed.description.trim()
        ? seed.description.trim()
        : "",
    defaultMode: seed.defaultMode === "agent" ? "agent" : "chat",
    defaultExecutionMode: normalizeExecutionMode(seed.defaultExecutionMode),
    preferredRole:
      typeof seed.preferredRole === "string" && seed.preferredRole.trim()
        ? seed.preferredRole.trim()
        : "chat",
    validationPack:
      typeof seed.validationPack === "string" && seed.validationPack.trim()
        ? seed.validationPack.trim()
        : "auto",
    completionContract:
      typeof seed.completionContract === "string" && seed.completionContract.trim()
        ? seed.completionContract.trim()
        : "",
    promptPrefix:
      typeof seed.promptPrefix === "string" && seed.promptPrefix.trim()
        ? seed.promptPrefix.trim()
        : "",
    buildsSpec: seed.buildsSpec !== false,
    autoActOnBlankWorkspace: seed.autoActOnBlankWorkspace !== false
  };
}

function getDefaultWorkflowPresets() {
  return [
    createWorkflowPreset({
      id: "scaffold-app",
      label: "Scaffold App",
      description: "Turn a rough idea into a staged full repository build.",
      defaultMode: "agent",
      defaultExecutionMode: "act",
      preferredRole: "builder",
      validationPack: "auto",
      completionContract:
        "Create a working repository through staged architecture, backend, middleware, frontend, and integration passes as needed. The final repo must implement the requested core capability with real source, project metadata, tests, local run instructions, and at least one executable validation path. Do not leave placeholder or demo-only artifacts.",
      promptPrefix:
        "Scaffold a production-ready local-first application in staged build phases. First establish architecture and repository contracts, then implement backend/core logic, middleware or orchestration, frontend or user interaction, and finish with integration review. Use concrete tooling, write executable source and tests, and avoid demo skeletons, TODO-only files, or placeholder logic."
    }),
    createWorkflowPreset({
      id: "review-repo",
      label: "Review Repo",
      description: "Review an existing repository for bugs, risks, and missing tests.",
      defaultMode: "chat",
      defaultExecutionMode: "plan",
      preferredRole: "reviewer",
      validationPack: "none",
      completionContract:
        "Report prioritized findings with concrete evidence, likely regressions, and missing test coverage."
    }),
    createWorkflowPreset({
      id: "fix-build",
      label: "Fix Build",
      description: "Diagnose a broken project and move from report to repair.",
      defaultMode: "agent",
      defaultExecutionMode: "plan",
      preferredRole: "editor",
      validationPack: "auto",
      completionContract:
        "Identify the failing path, explain root cause, propose edits, and verify with safe local validation."
    }),
    createWorkflowPreset({
      id: "add-tests",
      label: "Add Tests",
      description: "Expand focused tests around important behaviors.",
      defaultMode: "agent",
      defaultExecutionMode: "act",
      preferredRole: "editor",
      validationPack: "test",
      completionContract:
        "Add or update targeted tests that cover key behavior, edges, and regressions."
    }),
    createWorkflowPreset({
      id: "refactor-module",
      label: "Refactor Module",
      description: "Restructure code while preserving behavior.",
      defaultMode: "agent",
      defaultExecutionMode: "act",
      preferredRole: "editor",
      validationPack: "auto",
      completionContract:
        "Improve clarity and maintainability, preserve behavior unless explicitly requested, and validate the result."
    }),
    createWorkflowPreset({
      id: "ui-from-image",
      label: "UI From Image",
      description: "Generate a full project from an attached visual reference.",
      defaultMode: "agent",
      defaultExecutionMode: "act",
      preferredRole: "builder",
      validationPack: "build",
      completionContract:
        "Convert the visual reference into a real project structure, components, styling, assets, and local run instructions.",
      promptPrefix:
        "Use the attached image as a product and UI reference. Build the actual project, not a snippet."
    }),
    createWorkflowPreset({
      id: "freeform",
      label: "Freeform",
      description: "General local coding chat and agent work.",
      defaultMode: "chat",
      defaultExecutionMode: "plan",
      preferredRole: "chat",
      buildsSpec: false,
      validationPack: "auto",
      completionContract: "Respond concisely and keep the work local-first."
    })
  ];
}

function normalizeWorkflowPreset(workflow) {
  if (!workflow || typeof workflow !== "object") {
    return null;
  }
  return createWorkflowPreset(workflow);
}

function normalizeAgentPreferredRole(value) {
  return typeof value === "string" && AGENT_ROLE_VALUES.has(value.trim())
    ? value.trim()
    : "";
}

function createAgentProfile(seed = {}) {
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : makeId("agent"),
    label:
      typeof seed.label === "string" && seed.label.trim()
        ? seed.label.trim()
        : "New Agent",
    description:
      typeof seed.description === "string" && seed.description.trim()
        ? seed.description.trim()
        : "",
    preferredRole: normalizeAgentPreferredRole(seed.preferredRole),
    modelOverride:
      typeof seed.modelOverride === "string" && seed.modelOverride.trim()
        ? seed.modelOverride.trim()
        : "",
    systemPrompt:
      typeof seed.systemPrompt === "string" && seed.systemPrompt.trim()
        ? seed.systemPrompt.trim()
        : "",
    defaultMode: seed.defaultMode === "agent" ? "agent" : "chat",
    defaultExecutionMode: normalizeExecutionMode(seed.defaultExecutionMode),
    linkedWorkflowPresetId:
      typeof seed.linkedWorkflowPresetId === "string" && seed.linkedWorkflowPresetId.trim()
        ? seed.linkedWorkflowPresetId.trim()
        : "",
    promptPrefix:
      typeof seed.promptPrefix === "string" && seed.promptPrefix.trim()
        ? seed.promptPrefix.trim()
        : "",
    enabled: seed.enabled !== false
  };
}

function normalizeAgentProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }
  return createAgentProfile(profile);
}

function getDefaultAgentProfiles() {
  return [
    createAgentProfile({
      id: "app-default",
      label: "App Default",
      description: "Balanced local-first behavior for day-to-day VSWirks work.",
      preferredRole: "chat",
      defaultMode: "chat",
      defaultExecutionMode: "plan",
      systemPrompt:
        "Keep responses concise, practical, and app-first. Route heavy repo work into staged VSWirks App runs instead of loose snippets."
    }),
    createAgentProfile({
      id: "build-operator",
      label: "Build Operator",
      description: "Use for staged implementation and scaffold work owned by VSWirks App.",
      preferredRole: "editor",
      defaultMode: "agent",
      defaultExecutionMode: "act",
      linkedWorkflowPresetId: "scaffold-app",
      promptPrefix:
        "Treat VSWirks App as the orchestration owner. Finish real repository structure, validation, and resumable staged execution.",
      systemPrompt:
        "You are executing app-owned local builds. Prefer coherent repo completion, validation, and resumable staged progress over ad hoc edits."
    }),
    createAgentProfile({
      id: "review-analyst",
      label: "Review Analyst",
      description: "Findings-first reviewer for repo and code audits.",
      preferredRole: "reviewer",
      defaultMode: "chat",
      defaultExecutionMode: "plan",
      linkedWorkflowPresetId: "review-repo",
      systemPrompt:
        "Review like a senior engineer. Findings first. Prioritize bugs, regressions, risky assumptions, and missing tests."
    })
  ];
}

function normalizeAgentProfileList(profiles) {
  const defaults = getDefaultAgentProfiles();
  const incoming = Array.isArray(profiles)
    ? profiles.map((profile) => normalizeAgentProfile(profile)).filter(Boolean)
    : [];
  const merged = new Map(defaults.map((profile) => [profile.id, profile]));
  for (const profile of incoming) {
    merged.set(profile.id, profile);
  }
  return Array.from(merged.values());
}

function createRunEvent(seed = {}) {
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : makeId("event"),
    type:
      typeof seed.type === "string" && seed.type.trim() ? seed.type.trim() : "context",
    label:
      typeof seed.label === "string" && seed.label.trim()
        ? seed.label.trim()
        : "Run event",
    detail: typeof seed.detail === "string" ? seed.detail : "",
    status:
      typeof seed.status === "string" && seed.status.trim() ? seed.status.trim() : "info",
    path: typeof seed.path === "string" ? seed.path : "",
    diff: typeof seed.diff === "string" ? seed.diff : "",
    rationale: typeof seed.rationale === "string" ? seed.rationale : "",
    command: typeof seed.command === "string" ? seed.command : "",
    output: typeof seed.output === "string" ? seed.output : "",
    error: Boolean(seed.error),
    meta: seed.meta && typeof seed.meta === "object" ? seed.meta : {},
    createdAt: Number(seed.createdAt) || Date.now()
  };
}

function normalizeRunEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  return createRunEvent(event);
}

function createRunCheckpoint(seed = {}) {
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : makeId("checkpoint"),
    runId: typeof seed.runId === "string" ? seed.runId : "",
    label:
      typeof seed.label === "string" && seed.label.trim()
        ? seed.label.trim()
        : "Checkpoint",
    step: Number(seed.step) || 0,
    status:
      typeof seed.status === "string" && seed.status.trim() ? seed.status.trim() : "saved",
    threadMessageCount: Number(seed.threadMessageCount) || 0,
    eventCount: Number(seed.eventCount) || 0,
    changedFiles: Array.isArray(seed.changedFiles)
      ? seed.changedFiles.filter((value) => typeof value === "string" && value.trim())
      : [],
    createdAt: Number(seed.createdAt) || Date.now()
  };
}

function normalizeRunCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object") {
    return null;
  }
  return createRunCheckpoint(checkpoint);
}

function createApprovalRequest(seed = {}) {
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : makeId("approval"),
    runId: typeof seed.runId === "string" ? seed.runId : "",
    threadId: typeof seed.threadId === "string" ? seed.threadId : "",
    relativePath: typeof seed.relativePath === "string" ? seed.relativePath : "",
    diff: typeof seed.diff === "string" ? seed.diff : "",
    rationale: typeof seed.rationale === "string" ? seed.rationale : "",
    sourceStep: Number(seed.sourceStep) || 0,
    scope: typeof seed.scope === "string" && seed.scope ? seed.scope : "once",
    status: typeof seed.status === "string" && seed.status ? seed.status : "pending",
    createdAt: Number(seed.createdAt) || Date.now()
  };
}

function normalizeApprovalRequest(approval) {
  if (!approval || typeof approval !== "object") {
    return null;
  }
  return createApprovalRequest(approval);
}

function createProjectIntelligence(seed = {}) {
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : makeId("intel"),
    workspaceRoot: typeof seed.workspaceRoot === "string" ? seed.workspaceRoot : "",
    targetPath: typeof seed.targetPath === "string" ? seed.targetPath : "",
    summary: typeof seed.summary === "string" ? seed.summary : "",
    frameworks: Array.isArray(seed.frameworks)
      ? seed.frameworks.filter((value) => typeof value === "string" && value.trim())
      : [],
    manifests: Array.isArray(seed.manifests)
      ? seed.manifests.filter((value) => typeof value === "string" && value.trim())
      : [],
    scripts: seed.scripts && typeof seed.scripts === "object" ? seed.scripts : {},
    entrypoints: Array.isArray(seed.entrypoints)
      ? seed.entrypoints.filter((value) => typeof value === "string" && value.trim())
      : [],
    testPaths: Array.isArray(seed.testPaths)
      ? seed.testPaths.filter((value) => typeof value === "string" && value.trim())
      : [],
    validationPlan: Array.isArray(seed.validationPlan)
      ? seed.validationPlan.filter((value) => value && typeof value === "object")
      : [],
    generatedAt: Number(seed.generatedAt) || Date.now()
  };
}

function normalizeProjectIntelligence(intelligence) {
  if (!intelligence || typeof intelligence !== "object") {
    return null;
  }
  return createProjectIntelligence(intelligence);
}

function createRunRecord(seed = {}) {
  return {
    id: typeof seed.id === "string" && seed.id ? seed.id : makeId("run"),
    threadId: typeof seed.threadId === "string" ? seed.threadId : "",
    workflowId: typeof seed.workflowId === "string" ? seed.workflowId : "freeform",
    specDraftId: typeof seed.specDraftId === "string" ? seed.specDraftId : "",
    prompt: typeof seed.prompt === "string" ? seed.prompt : "",
    mode: seed.mode === "agent" ? "agent" : "chat",
    executionMode: normalizeExecutionMode(seed.executionMode),
    requestedModel:
      typeof seed.requestedModel === "string" ? seed.requestedModel : "",
    resolvedModel:
      typeof seed.resolvedModel === "string" ? seed.resolvedModel : "",
    agentProfileId: typeof seed.agentProfileId === "string" ? seed.agentProfileId : "",
    resolvedAgentProfileId:
      typeof seed.resolvedAgentProfileId === "string" ? seed.resolvedAgentProfileId : "",
    resolvedAgentProfileLabel:
      typeof seed.resolvedAgentProfileLabel === "string" ? seed.resolvedAgentProfileLabel : "",
    resolvedModelRole:
      typeof seed.resolvedModelRole === "string" ? seed.resolvedModelRole : "",
    resolvedPromptPrefix:
      typeof seed.resolvedPromptPrefix === "string" ? seed.resolvedPromptPrefix : "",
    resolvedSystemPrompt:
      typeof seed.resolvedSystemPrompt === "string" ? seed.resolvedSystemPrompt : "",
    promptContext:
      seed.promptContext && typeof seed.promptContext === "object"
        ? {
            globalSystemPrompt:
              typeof seed.promptContext.globalSystemPrompt === "string"
                ? seed.promptContext.globalSystemPrompt
                : "",
            agentProfileSystemPrompt:
              typeof seed.promptContext.agentProfileSystemPrompt === "string"
                ? seed.promptContext.agentProfileSystemPrompt
                : "",
            threadSystemPrompt:
              typeof seed.promptContext.threadSystemPrompt === "string"
                ? seed.promptContext.threadSystemPrompt
                : "",
            workflowPromptPrefix:
              typeof seed.promptContext.workflowPromptPrefix === "string"
                ? seed.promptContext.workflowPromptPrefix
                : "",
            agentPromptPrefix:
              typeof seed.promptContext.agentPromptPrefix === "string"
                ? seed.promptContext.agentPromptPrefix
                : ""
          }
        : {
            globalSystemPrompt: "",
            agentProfileSystemPrompt: "",
            threadSystemPrompt: "",
            workflowPromptPrefix: "",
            agentPromptPrefix: ""
          },
    status: typeof seed.status === "string" && seed.status ? seed.status : "queued",
    summary: typeof seed.summary === "string" ? seed.summary : "",
    changedFiles: Array.isArray(seed.changedFiles)
      ? seed.changedFiles.filter((value) => typeof value === "string" && value.trim())
      : [],
    pendingApprovals: Array.isArray(seed.pendingApprovals)
      ? seed.pendingApprovals.map((approval) => normalizeApprovalRequest(approval)).filter(Boolean)
      : [],
    events: Array.isArray(seed.events)
      ? seed.events.map((event) => normalizeRunEvent(event)).filter(Boolean).slice(0, MAX_RUN_EVENTS)
      : [],
    checkpoints: Array.isArray(seed.checkpoints)
      ? seed.checkpoints
          .map((checkpoint) => normalizeRunCheckpoint(checkpoint))
          .filter(Boolean)
          .slice(0, MAX_RUN_CHECKPOINTS)
      : [],
    validation:
      seed.validation && typeof seed.validation === "object"
        ? {
            status:
              typeof seed.validation.status === "string" ? seed.validation.status : "pending",
            steps: Array.isArray(seed.validation.steps)
              ? seed.validation.steps.filter((step) => step && typeof step === "object")
              : [],
            summary: typeof seed.validation.summary === "string" ? seed.validation.summary : ""
          }
        : {
            status: "pending",
            steps: [],
            summary: ""
          },
    pausedAfterSpec: Boolean(seed.pausedAfterSpec),
    replayOfRunId: typeof seed.replayOfRunId === "string" ? seed.replayOfRunId : "",
    forkedFromCheckpointId:
      typeof seed.forkedFromCheckpointId === "string" ? seed.forkedFromCheckpointId : "",
    startedAt: Number(seed.startedAt) || Date.now(),
    updatedAt: Number(seed.updatedAt) || Date.now(),
    finishedAt: Number(seed.finishedAt) || 0
  };
}

function normalizeRunRecord(run) {
  if (!run || typeof run !== "object") {
    return null;
  }
  return createRunRecord(run);
}

function createThread(seed = {}) {
  const modelOverride =
    seed && typeof seed.modelOverride === "string"
      ? seed.modelOverride
      : seed && typeof seed.model === "string"
        ? seed.model
        : "";
  return {
    id: makeId("thread"),
    title: seed && seed.title ? seed.title : "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: seed && seed.mode === "agent" ? "agent" : "chat",
    executionMode: normalizeExecutionMode(seed && seed.executionMode),
    writeApprovalMode: normalizeWriteApprovalMode(seed && seed.writeApprovalMode),
    model: modelOverride,
    modelOverride,
    lastModelUsed: seed && typeof seed.lastModelUsed === "string" ? seed.lastModelUsed : "",
    agentProfileId: seed && typeof seed.agentProfileId === "string" ? seed.agentProfileId : "",
    systemPromptOverride:
      seed && typeof seed.systemPromptOverride === "string" ? seed.systemPromptOverride : "",
    workflowPresetId:
      seed && typeof seed.workflowPresetId === "string" ? seed.workflowPresetId : "freeform",
    pausedAfterSpec: Boolean(seed && seed.pausedAfterSpec),
    approvalScope:
      seed && typeof seed.approvalScope === "string" ? seed.approvalScope : "ask",
    currentRunId: seed && typeof seed.currentRunId === "string" ? seed.currentRunId : "",
    specDraftId: seed && typeof seed.specDraftId === "string" ? seed.specDraftId : "",
    draftPrompt: seed && typeof seed.draftPrompt === "string" ? seed.draftPrompt : "",
    lastValidationResult:
      seed && typeof seed.lastValidationResult === "string" ? seed.lastValidationResult : "",
    messages: []
  };
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  if (!["user", "assistant", "tool"].includes(message.role)) {
    return null;
  }

  return createMessage(message);
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

function normalizeGenerationSettings(settings) {
  return {
    chatTemperature: clampNumber(
      settings && settings.chatTemperature,
      0,
      2,
      DEFAULT_GENERATION_SETTINGS.chatTemperature
    ),
    chatTopP: clampNumber(
      settings && settings.chatTopP,
      0.1,
      1,
      DEFAULT_GENERATION_SETTINGS.chatTopP
    ),
    chatMaxTokens: Math.round(
      clampNumber(
        settings && settings.chatMaxTokens,
        256,
        8192,
        DEFAULT_GENERATION_SETTINGS.chatMaxTokens
      )
    ),
    agentTemperature: clampNumber(
      settings && settings.agentTemperature,
      0,
      2,
      DEFAULT_GENERATION_SETTINGS.agentTemperature
    ),
    agentTopP: clampNumber(
      settings && settings.agentTopP,
      0.1,
      1,
      DEFAULT_GENERATION_SETTINGS.agentTopP
    ),
    agentMaxTokens: Math.round(
      clampNumber(
        settings && settings.agentMaxTokens,
        256,
        8192,
        DEFAULT_GENERATION_SETTINGS.agentMaxTokens
      )
    )
  };
}

function getGenerationOptions(mode, settings) {
  const normalized = normalizeGenerationSettings(settings);
  if (mode === "agent") {
    return {
      temperature: normalized.agentTemperature,
      top_p: normalized.agentTopP,
      max_tokens: normalized.agentMaxTokens
    };
  }
  return {
    temperature: normalized.chatTemperature,
    top_p: normalized.chatTopP,
    max_tokens: normalized.chatMaxTokens
  };
}

function looksLikeRepoCreationRequest(prompt, workspaceEmpty) {
  const text = String(prompt || "").toLowerCase();
  const createVerb = /(create|build|scaffold|start|initialize|bootstrap|make|develop|generate|ship)/.test(
    text
  );
  const repoSignal =
    /(repo|repository|project|app|application|tool|service|cli|package|workspace)/.test(text) ||
    Boolean(workspaceEmpty);
  return createVerb && repoSignal;
}

module.exports = {
  APP_STATE_VERSION,
  MAX_STORED_THREADS,
  MAX_STORED_PROJECTS,
  MAX_STORED_SPECS,
  MAX_STORED_RUNS,
  MAX_RUN_EVENTS,
  MAX_RUN_CHECKPOINTS,
  MAX_TOOL_DETAIL_CHARS,
  MAX_API_MESSAGES,
  DEFAULT_MODEL,
  DEFAULT_EXECUTION_MODE,
  DEFAULT_RUNTIME_BASE_URL,
  DEFAULT_HUB_BASE_URL,
  DEFAULT_RUNTIME_CWD,
  DEFAULT_RUNTIME_PYTHON,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_GENERATION_SETTINGS,
  WORKSPACE_INSTRUCTIONS_PATH,
  delay,
  clampNumber,
  normalizeExecutionMode,
  normalizeWriteApprovalMode,
  timestamp,
  makeId,
  safeJsonParse,
  clampText,
  limitText,
  titleFromPrompt,
  createMessage,
  createThread,
  normalizeMessage,
  normalizeThread,
  touchThread,
  createSpecDraft,
  normalizeSpecDraft,
  createWorkflowPreset,
  normalizeWorkflowPreset,
  getDefaultWorkflowPresets,
  createAgentProfile,
  normalizeAgentProfile,
  getDefaultAgentProfiles,
  normalizeAgentProfileList,
  createRunEvent,
  normalizeRunEvent,
  createRunCheckpoint,
  normalizeRunCheckpoint,
  createApprovalRequest,
  normalizeApprovalRequest,
  createProjectIntelligence,
  normalizeProjectIntelligence,
  createRunRecord,
  normalizeRunRecord,
  createProjectSession,
  normalizeProjectSession,
  normalizeAppState,
  touchProject,
  normalizeGenerationSettings,
  getGenerationOptions,
  looksLikeRepoCreationRequest
};
