const {
  DEFAULT_EXECUTION_MODE,
  MAX_RUN_EVENTS,
  MAX_RUN_CHECKPOINTS,
  AGENT_ROLE_VALUES
} = require("./defaults");
const {
  makeId,
  normalizeExecutionMode,
  normalizeWriteApprovalMode
} = require("./utils");

// --- Agent role helper (used by createAgentProfile) ---

function normalizeAgentPreferredRole(value) {
  return typeof value === "string" && AGENT_ROLE_VALUES.has(value.trim())
    ? value.trim()
    : "";
}

// --- Message ---

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

function normalizeMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  if (!["user", "assistant", "tool"].includes(message.role)) {
    return null;
  }
  return createMessage(message);
}

// --- Spec Draft ---

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

// --- Workflow Preset ---

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

function normalizeWorkflowPreset(workflow) {
  if (!workflow || typeof workflow !== "object") {
    return null;
  }
  return createWorkflowPreset(workflow);
}

// --- Agent Profile ---

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

// --- Run Event ---

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

// --- Run Checkpoint ---

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

// --- Approval Request ---

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

// --- Project Intelligence ---

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

// --- Run Record ---

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

// --- Thread ---

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

module.exports = {
  normalizeAgentPreferredRole,
  createMessage,
  normalizeMessage,
  createSpecDraft,
  normalizeSpecDraft,
  createWorkflowPreset,
  normalizeWorkflowPreset,
  createAgentProfile,
  normalizeAgentProfile,
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
  createThread,
  // Note: createProjectSession lives in normalization.js to avoid circular dep with presets
};
