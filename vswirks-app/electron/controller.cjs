const cp = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { dialog } = require("electron");

const {
  APP_STATE_VERSION,
  DEFAULT_MODEL,
  DEFAULT_RUNTIME_BASE_URL,
  DEFAULT_RUNTIME_CWD,
  DEFAULT_RUNTIME_PYTHON,
  DEFAULT_GENERATION_SETTINGS,
  createProjectSession,
  normalizeAppState,
  createThread,
  touchProject,
  touchThread,
  makeId,
  normalizeGenerationSettings,
  clampText,
  safeJsonParse,
  getGenerationOptions,
  createSpecDraft,
  createRunRecord,
  createRunEvent,
  createRunCheckpoint,
  createApprovalRequest,
  createProjectIntelligence,
  getDefaultWorkflowPresets,
  normalizeAgentProfileList,
  getDefaultAgentProfiles,
  looksLikeRepoCreationRequest
} = require("../../shared/core");
const {
  fetchRuntimeJson,
  probeRuntimeHealth,
  waitForRuntimeHealthy
} = require("../../shared/runtime-client");
const {
  ensureVSWirksDirs,
  readAppState,
  writeAppState,
  readBridgeState,
  updateBridgeState,
  readSettings,
  writeSettings
} = require("../../shared/vswirks-state");
const {
  formatWorkspaceLabel,
  describeWorkspaceRoot,
  isPathWithin,
  openInVSWirksEditor,
  openPathsInVSWirksEditor,
  openDiffInVSWirksEditor,
  scanProjectIntelligence,
  runValidationPlan,
  exists
} = require("./workspace-tools.cjs");
const { isImagePath, createImageAttachment } = require("./image-tools.cjs");
const { runConversation, buildWorkspaceSystemPrompt } = require("./runner.cjs");

const AUTO_MODEL_VALUE = "__auto__";
const LEGACY_CODER_MODEL = "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit";
const DEFAULT_CODER_MODEL = "devstral-small-2";
const DEFAULT_CHAT_MODEL = "llama3.3-8b-thinking:q6";
const DEFAULT_AGENT_PROFILE_ID = "app-default";

class VSWirksController {
  constructor(window, dependencies = {}) {
    this.window = window;
    this.dependencies = {
      updateBridgeState: dependencies.updateBridgeState || updateBridgeState,
      openInVSWirksEditor: dependencies.openInVSWirksEditor || openInVSWirksEditor,
      openPathsInVSWirksEditor: dependencies.openPathsInVSWirksEditor || openPathsInVSWirksEditor,
      openDiffInVSWirksEditor: dependencies.openDiffInVSWirksEditor || openDiffInVSWirksEditor,
      runConversation: dependencies.runConversation || runConversation
    };
    this.projects = [];
    this.activeProjectId = "";
    this.bridgeState = {};
    this.models = [];
    this.abortController = null;
    this.pendingApproval = null;
    this.pendingApprovalResolver = null;
    this.promptRefining = false;
    this.lastStatus = "Ready";
    this.serviceState = {
      healthy: false,
      starting: false,
      label: "Service offline"
    };
    this.settings = {
      runtimeBaseUrl: DEFAULT_RUNTIME_BASE_URL,
      defaultModel: DEFAULT_CODER_MODEL,
      modelRoles: createDefaultModelRoles(DEFAULT_MODEL),
      runtimeCwd: DEFAULT_RUNTIME_CWD,
      runtimePython: DEFAULT_RUNTIME_PYTHON,
      generationSettings: DEFAULT_GENERATION_SETTINGS,
      writeRequiresApproval: true,
      globalSystemPrompt: "",
      agentProfiles: getDefaultAgentProfiles(),
      defaultAgentProfileId: DEFAULT_AGENT_PROFILE_ID
    };
    this.bridgePollHandle = undefined;
  }

  async initialize() {
    await ensureVSWirksDirs();
    await this.loadSettings();
    await this.loadState();
    await this.loadBridgeState();
    await this.refreshRuntimeState();
    const project = this.ensureProject();
    this.startBridgePolling();
    if (project) {
      await this.refreshProjectIntelligence(project, false);
    }
    await this.persistState();
    this.postState();
  }

  async handle(channel, payload) {
    switch (channel) {
      case "vswirks:ready":
        this.postState();
        return true;
      case "vswirks:refreshModels":
        await this.refreshRuntimeState(true);
        await this.refreshProjectIntelligence(this.getActiveProject(), true);
        return true;
      case "vswirks:startService":
        await this.startRuntimeService();
        return true;
      case "vswirks:createProject":
        return this.createProject(payload);
      case "vswirks:switchProject":
        return this.switchProject(payload && payload.id);
      case "vswirks:setTargetPath":
        return this.setTargetPath(payload);
      case "vswirks:newChat":
        return this.newChat(payload || {});
      case "vswirks:switchThread":
        return this.switchThread(payload && payload.id);
      case "vswirks:deleteThread":
        return this.deleteThread(payload && payload.id);
      case "vswirks:updateThreadSettings":
        return this.updateThreadSettings(payload || {});
      case "vswirks:updateProjectSettings":
        return this.updateProjectSettings(payload || {});
      case "vswirks:attachFile":
        return this.attachFiles();
      case "vswirks:attachImage":
        return this.attachImages();
      case "vswirks:attachEditorSelection":
        return this.attachEditorSelection();
      case "vswirks:removeAttachment":
        return this.removeAttachment(payload && payload.id);
      case "vswirks:buildSpec":
        return this.buildSpec(payload || {});
      case "vswirks:refinePrompt":
        return this.refinePrompt(payload || {});
      case "vswirks:sendPrompt":
        return this.sendPrompt(payload || {});
      case "vswirks:resumeRun":
        return this.resumeRun(payload || {});
      case "vswirks:replayRun":
        return this.replayRun(payload || {});
      case "vswirks:forkRunCheckpoint":
        return this.forkRunCheckpoint(payload || {});
      case "vswirks:uploadSpec":
        return this.uploadSpec();
      case "vswirks:useMessageAsSpec":
        return this.useMessageAsSpec(payload || {});
      case "vswirks:reviewGeneratedFiles":
        return this.reviewGeneratedFiles(payload || {});
      case "vswirks:revealRunFiles":
        return this.revealRunFiles(payload || {});
      case "vswirks:openRunDiff":
        return this.openRunDiff(payload || {});
      case "vswirks:abort":
        return this.abort();
      case "vswirks:approveWrite":
        return this.resolveApproval(payload || {});
      case "vswirks:saveGenerationSettings":
        return this.saveGenerationSettings(payload || {});
      case "vswirks:saveModelRoles":
        return this.saveModelRoles(payload || {});
      case "vswirks:savePromptingSettings":
        return this.savePromptingSettings(payload || {});
      case "vswirks:getPromptPreview":
        return this.getPromptPreview(payload || {});
      case "vswirks:resetGenerationSettings":
        return this.resetGenerationSettings();
      case "vswirks:openFile":
        return this.openFile(payload || {});
      case "vswirks:openProjectInEditor":
        return this.openProjectInEditor();
      case "vswirks:syncBridge":
        await this.loadBridgeState();
        await this.refreshProjectIntelligence(this.getActiveProject(), false);
        this.postState();
        return true;
      default:
        return null;
    }
  }

  async loadSettings() {
    const stored = await readSettings();
    const priorDefaultModel = migrateLegacyRoutingModel(
      typeof stored.defaultModel === "string" && stored.defaultModel.trim()
        ? stored.defaultModel.trim()
        : DEFAULT_MODEL
    );
    this.settings = {
      runtimeBaseUrl:
        typeof stored.runtimeBaseUrl === "string" && stored.runtimeBaseUrl.trim()
          ? stored.runtimeBaseUrl.trim()
          : DEFAULT_RUNTIME_BASE_URL,
      defaultModel: DEFAULT_CODER_MODEL,
      modelRoles: normalizeModelRoles(stored.modelRoles, priorDefaultModel),
      runtimeCwd:
        typeof stored.runtimeCwd === "string" && stored.runtimeCwd.trim()
          ? stored.runtimeCwd.trim()
          : DEFAULT_RUNTIME_CWD,
      runtimePython:
        typeof stored.runtimePython === "string" && stored.runtimePython.trim()
          ? stored.runtimePython.trim()
          : DEFAULT_RUNTIME_PYTHON,
      generationSettings: normalizeGenerationSettings(
        stored.generationSettings || DEFAULT_GENERATION_SETTINGS
      ),
      writeRequiresApproval: stored.writeRequiresApproval !== false,
      globalSystemPrompt:
        typeof stored.globalSystemPrompt === "string" ? stored.globalSystemPrompt.trim() : "",
      agentProfiles: normalizeAgentProfileList(stored.agentProfiles),
      defaultAgentProfileId: DEFAULT_AGENT_PROFILE_ID
    };
    this.settings.defaultAgentProfileId = normalizeAgentProfileId(
      stored.defaultAgentProfileId,
      this.settings.agentProfiles,
      DEFAULT_AGENT_PROFILE_ID
    );
  }

  async loadState() {
    const raw = await readAppState();
    const normalized = normalizeAppState(raw);
    this.projects = normalized.projects;
    this.activeProjectId = normalized.activeProjectId;
    this.normalizePromptingState();
  }

  async loadBridgeState() {
    this.bridgeState = await readBridgeState();
    this.reconcileBridgeProject();
    const applied = await this.applyBridgeHandoffRequest();
    if (applied) {
      await this.persistState();
    }
  }

  startBridgePolling() {
    if (this.bridgePollHandle) {
      clearInterval(this.bridgePollHandle);
    }
    let lastSerialized = JSON.stringify(this.bridgeState || {});
    this.bridgePollHandle = setInterval(async () => {
      const next = await readBridgeState();
      const serialized = JSON.stringify(next || {});
      if (serialized !== lastSerialized) {
        lastSerialized = serialized;
        this.bridgeState = next || {};
        const adopted = this.reconcileBridgeProject();
        const handedOff = await this.applyBridgeHandoffRequest();
        if (adopted || handedOff) {
          await this.refreshProjectIntelligence(this.getActiveProject(), false);
          await this.persistState();
        }
        this.postState();
      }
    }, 1500);
  }

  ensureProject() {
    if (this.projects.length) {
      return this.getActiveProject();
    }
    const fallbackRoot =
      typeof this.bridgeState.activeWorkspaceRoot === "string" && this.bridgeState.activeWorkspaceRoot
        ? this.bridgeState.activeWorkspaceRoot
        : "";
    const project = this.createProjectRecord({
      name: fallbackRoot ? path.basename(fallbackRoot) : "No Project Selected",
      workspaceRoot: fallbackRoot,
      targetPath: fallbackRoot
    });
    this.projects = [project];
    this.activeProjectId = project.id;
    return project;
  }

  getActiveProject() {
    const existing = this.projects.find((project) => project.id === this.activeProjectId);
    if (existing) {
      return existing;
    }
    this.activeProjectId = this.projects[0] ? this.projects[0].id : "";
    return this.projects[0] || null;
  }

  normalizePromptingState() {
    const profiles = this.settings.agentProfiles || getDefaultAgentProfiles();
    this.settings.defaultAgentProfileId = normalizeAgentProfileId(
      this.settings.defaultAgentProfileId,
      profiles,
      DEFAULT_AGENT_PROFILE_ID
    );
    this.projects = (this.projects || []).map((project) => {
      const normalizedProject = project;
      normalizedProject.defaultAgentProfileId = normalizeAgentProfileId(
        normalizedProject.defaultAgentProfileId,
        profiles,
        this.settings.defaultAgentProfileId
      );
      normalizedProject.threads = Array.isArray(normalizedProject.threads)
        ? normalizedProject.threads.map((thread) => ({
            ...thread,
            agentProfileId: normalizeAgentProfileId(
              thread.agentProfileId,
              profiles,
              normalizedProject.defaultAgentProfileId
            ),
            modelOverride:
              typeof thread.modelOverride === "string"
                ? thread.modelOverride
                : typeof thread.model === "string"
                  ? thread.model
                  : "",
            model:
              typeof thread.modelOverride === "string"
                ? thread.modelOverride
                : typeof thread.model === "string"
                  ? thread.model
                  : "",
            systemPromptOverride:
              typeof thread.systemPromptOverride === "string" ? thread.systemPromptOverride : "",
            draftPrompt: typeof thread.draftPrompt === "string" ? thread.draftPrompt : ""
          }))
        : [];
      return normalizedProject;
    });
  }

  createProjectRecord(seed = {}) {
    return createProjectSession({
      ...seed,
      defaultAgentProfileId: normalizeAgentProfileId(
        seed.defaultAgentProfileId,
        this.settings.agentProfiles,
        this.settings.defaultAgentProfileId
      )
    });
  }

  reconcileBridgeProject() {
    const bridgeRoot = this.resolveBridgeWorkspaceRoot();
    if (!bridgeRoot) {
      return false;
    }
    const bridgeTarget = this.resolveBridgeTargetPath(bridgeRoot);

    const matchingProject = this.projects.find((project) => project.workspaceRoot === bridgeRoot);
    if (matchingProject) {
      let changed = false;
      if (this.activeProjectId !== matchingProject.id) {
        this.activeProjectId = matchingProject.id;
        changed = true;
      }
      if (matchingProject.name !== path.basename(bridgeRoot)) {
        matchingProject.name = path.basename(bridgeRoot);
        changed = true;
      }
      if (matchingProject.targetPath !== bridgeTarget) {
        matchingProject.targetPath = bridgeTarget;
        changed = true;
      }
      const normalizedDefaultAgent = normalizeAgentProfileId(
        matchingProject.defaultAgentProfileId,
        this.settings.agentProfiles,
        this.settings.defaultAgentProfileId
      );
      if (matchingProject.defaultAgentProfileId !== normalizedDefaultAgent) {
        matchingProject.defaultAgentProfileId = normalizedDefaultAgent;
        changed = true;
      }
      if (
        !matchingProject.intelligence ||
        matchingProject.intelligence.workspaceRoot !== bridgeRoot ||
        matchingProject.intelligence.targetPath !== bridgeTarget
      ) {
        matchingProject.intelligence = createProjectIntelligence({
          workspaceRoot: bridgeRoot,
          targetPath: bridgeTarget,
          summary: "No project intelligence generated yet."
        });
        changed = true;
      }
      if (changed) {
        touchProject(this.projects, matchingProject.id);
      }
      return changed;
    }

    if (!this.projects.length) {
      const project = this.createProjectRecord({
        name: path.basename(bridgeRoot),
        workspaceRoot: bridgeRoot,
        targetPath: bridgeTarget
      });
      this.projects = [project];
      this.activeProjectId = project.id;
      return true;
    }

    const activeProject = this.getActiveProject();
    if (
      activeProject &&
      !activeProject.workspaceRoot &&
      (!activeProject.targetPath || activeProject.targetPath === "")
    ) {
      activeProject.name = path.basename(bridgeRoot);
      activeProject.workspaceRoot = bridgeRoot;
      activeProject.targetPath = bridgeTarget;
      activeProject.defaultAgentProfileId = normalizeAgentProfileId(
        activeProject.defaultAgentProfileId,
        this.settings.agentProfiles,
        this.settings.defaultAgentProfileId
      );
      activeProject.intelligence = createProjectIntelligence({
        workspaceRoot: bridgeRoot,
        targetPath: activeProject.targetPath,
        summary: "No project intelligence generated yet."
      });
      activeProject.updatedAt = Date.now();
      return true;
    }

    const project = this.createProjectRecord({
      name: path.basename(bridgeRoot),
      workspaceRoot: bridgeRoot,
      targetPath: bridgeTarget
    });
    project.intelligence = createProjectIntelligence({
      workspaceRoot: bridgeRoot,
      targetPath: bridgeTarget,
      summary: "No project intelligence generated yet."
    });
    this.projects.unshift(project);
    this.activeProjectId = project.id;
    return true;
  }

  getActiveThread(project = this.getActiveProject()) {
    if (!project) {
      return null;
    }
    return (
      project.threads.find((thread) => thread.id === project.activeThreadId) ||
      project.threads[0] ||
      null
    );
  }

  getWorkflowPreset(project, workflowId) {
    if (!project) {
      return getDefaultWorkflowPresets().find((item) => item.id === "freeform");
    }
    return (
      (project.workflowPresets || []).find((item) => item.id === workflowId) ||
      (project.workflowPresets || []).find((item) => item.id === "freeform") ||
      getDefaultWorkflowPresets().find((item) => item.id === "freeform")
    );
  }

  getActiveRun(project = this.getActiveProject()) {
    if (!project) {
      return null;
    }
    return (
      (project.runs || []).find((run) => run.id === project.currentRunId) ||
      (project.runs || []).find((run) => run.status === "running") ||
      (project.runs || [])[0] ||
      null
    );
  }

  getRunById(project, runId) {
    return project && Array.isArray(project.runs)
      ? project.runs.find((run) => run.id === runId) || null
      : null;
  }

  getSpecById(project, specId) {
    return project && Array.isArray(project.specs)
      ? project.specs.find((spec) => spec.id === specId) || null
      : null;
  }

  resolveBridgeWorkspaceRoot() {
    if (
      typeof this.bridgeState.activeWorkspaceRoot === "string" &&
      this.bridgeState.activeWorkspaceRoot
    ) {
      return this.bridgeState.activeWorkspaceRoot;
    }
    const workspaceRoots = Array.isArray(this.bridgeState.workspaceRoots)
      ? this.bridgeState.workspaceRoots.filter((item) => typeof item === "string" && item)
      : [];
    if (
      typeof this.bridgeState.workspaceTarget === "string" &&
      this.bridgeState.workspaceTarget
    ) {
      const matchingRoot = workspaceRoots.find((rootPath) =>
        isPathWithin(rootPath, this.bridgeState.workspaceTarget)
      );
      if (matchingRoot) {
        return matchingRoot;
      }
    }
    if (workspaceRoots.length) {
      return workspaceRoots[0];
    }
    if (
      typeof this.bridgeState.workspaceTarget === "string" &&
      this.bridgeState.workspaceTarget
    ) {
      return this.bridgeState.workspaceTarget;
    }
    return "";
  }

  resolveBridgeTargetPath(bridgeRoot) {
    if (
      typeof this.bridgeState.workspaceTarget === "string" &&
      this.bridgeState.workspaceTarget &&
      isPathWithin(bridgeRoot, this.bridgeState.workspaceTarget)
    ) {
      return this.bridgeState.workspaceTarget;
    }
    return bridgeRoot;
  }

  getAgentProfileById(agentProfileId) {
    return (
      (this.settings.agentProfiles || []).find((profile) => profile.id === agentProfileId) || null
    );
  }

  async applyBridgeHandoffRequest() {
    const request =
      this.bridgeState &&
      this.bridgeState.appHandoffRequest &&
      typeof this.bridgeState.appHandoffRequest === "object"
        ? this.bridgeState.appHandoffRequest
        : null;
    const requestedAt = Number(request && request.requestedAt) || 0;
    const appliedAt = Number(request && request.appliedAt) || 0;
    if (!requestedAt || requestedAt <= appliedAt) {
      return false;
    }

    const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
    const workspaceRoot =
      typeof request.workspaceRoot === "string" && request.workspaceRoot.trim()
        ? request.workspaceRoot.trim()
        : this.resolveBridgeWorkspaceRoot();
    const targetPath =
      typeof request.targetPath === "string" && request.targetPath.trim()
        ? request.targetPath.trim()
        : workspaceRoot;
    if (!workspaceRoot || !prompt) {
      await this.dependencies.updateBridgeState({
        appHandoffRequest: {
          ...(request || {}),
          appliedAt: Date.now(),
          appliedBy: "VSWirks App",
          error: "Missing workspace root or prompt for handoff."
        }
      });
      return false;
    }

    let project = this.projects.find((entry) => entry.workspaceRoot === workspaceRoot) || null;
    if (!project) {
      project = this.createProjectRecord({
        name: path.basename(workspaceRoot),
        workspaceRoot,
        targetPath:
          targetPath && isPathWithin(workspaceRoot, targetPath) ? targetPath : workspaceRoot
      });
      this.projects.unshift(project);
    } else {
      project.targetPath =
        targetPath && isPathWithin(workspaceRoot, targetPath) ? targetPath : workspaceRoot;
      project.defaultAgentProfileId = normalizeAgentProfileId(
        project.defaultAgentProfileId,
        this.settings.agentProfiles,
        this.settings.defaultAgentProfileId
      );
    }
    this.activeProjectId = project.id;

    await this.newChat({
      workflowPresetId:
        typeof request.requestedWorkflowId === "string" && request.requestedWorkflowId
          ? request.requestedWorkflowId
          : inferWorkflowPresetId(prompt, []),
      mode: request.requestedMode === "agent" ? "agent" : "chat",
      executionMode: request.requestedExecutionMode === "act" ? "act" : "plan",
      agentProfileId:
        typeof request.requestedAgentProfileId === "string" ? request.requestedAgentProfileId : "",
      prompt
    });

    const thread = this.getActiveThread(project);
    if (thread) {
      const attachmentSummary = Array.isArray(request.attachmentsSummary)
        ? request.attachmentsSummary.filter(Boolean)
        : [];
      if (attachmentSummary.length) {
        thread.messages.push({
          id: makeId("assistant"),
          role: "assistant",
          content:
            "Seeded from VSWirks Editor handoff.\n\n" +
            attachmentSummary.map((item) => `- ${item}`).join("\n"),
          model: "",
          mode: "chat",
          executionMode: "plan",
          pending: false,
          createdAt: Date.now()
        });
      }
      touchThread(project.threads, thread.id);
    }

    this.lastStatus = "Editor handoff ready in VSWirks App";
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
    }

    const nextRequest = {
      ...(request || {}),
      appliedAt: Date.now(),
      appliedBy: "VSWirks App",
      seededProjectId: project.id,
      seededThreadId: thread ? thread.id : "",
      error: ""
    };
    await this.dependencies.updateBridgeState({
      appHandoffRequest: nextRequest
    });
    this.bridgeState = {
      ...this.bridgeState,
      appHandoffRequest: nextRequest
    };
    return true;
  }

  async createProject(payload) {
    const selected = await this.pickFolder(payload && payload.path);
    if (!selected) {
      return false;
    }

    const existing = this.projects.find((project) => project.workspaceRoot === selected);
    if (existing) {
      this.activeProjectId = existing.id;
      this.lastStatus = `Switched to ${existing.name}`;
      await this.refreshProjectIntelligence(existing, false);
      await this.persistState();
      await this.publishEditorSelection(existing);
      this.postState();
      return true;
    }

    const project = this.createProjectRecord({
      name: path.basename(selected),
      workspaceRoot: selected,
      targetPath: selected
    });
    project.intelligence = createProjectIntelligence({
      workspaceRoot: selected,
      targetPath: selected,
      summary: "No project intelligence generated yet."
    });
    this.projects.unshift(project);
    this.activeProjectId = project.id;
    await this.refreshProjectIntelligence(project, false);
    this.lastStatus = `Added project ${project.name}`;
    await this.persistState();
    await this.publishEditorSelection(project);
    await this.syncEditorToProject(project);
    this.postState();
    return true;
  }

  async switchProject(projectId) {
    if (!projectId || !this.projects.some((project) => project.id === projectId)) {
      return false;
    }
    this.activeProjectId = projectId;
    const project = this.getActiveProject();
    this.lastStatus = "Project switched";
    await this.refreshProjectIntelligence(project, false);
    await this.persistState();
    await this.publishEditorSelection(project);
    await this.syncEditorToProject(project);
    this.postState();
    return true;
  }

  async setTargetPath(payload) {
    const project = this.getActiveProject();
    if (!project || !project.workspaceRoot) {
      return false;
    }
    const selected = await this.pickFolder(payload && payload.path);
    if (!selected) {
      return false;
    }
    if (!isPathWithin(project.workspaceRoot, selected)) {
      this.emitEvent({
        type: "error",
        message: "Target folder must stay inside the active project root."
      });
      return false;
    }
    project.targetPath = selected;
    touchProject(this.projects, project.id);
    await this.refreshProjectIntelligence(project, false);
    await this.persistState();
    await this.publishEditorSelection(project);
    await this.syncEditorToProject(project);
    this.lastStatus = `Target set: ${formatWorkspaceLabel(project.workspaceRoot, project.targetPath)}`;
    this.postState();
    return true;
  }

  async publishEditorSelection(project = this.getActiveProject()) {
    if (!project || !project.workspaceRoot) {
      return false;
    }

    const workspaceRoot = project.workspaceRoot;
    const targetPath =
      project.targetPath && isPathWithin(workspaceRoot, project.targetPath)
        ? project.targetPath
        : workspaceRoot;
    const requestedAt = Date.now();

    await this.dependencies.updateBridgeState({
      appSelectedProjectId: project.id,
      appSelectedWorkspaceRoot: workspaceRoot,
      appSelectedTargetPath: targetPath,
      appSelectionRequestedAt: requestedAt,
      appSelectionRequestedBy: "VSWirks App"
    });

    this.bridgeState = {
      ...this.bridgeState,
      appSelectedProjectId: project.id,
      appSelectedWorkspaceRoot: workspaceRoot,
      appSelectedTargetPath: targetPath,
      appSelectionRequestedAt: requestedAt,
      appSelectionRequestedBy: "VSWirks App"
    };
    return true;
  }

  async publishEditorAction(action) {
    await this.dependencies.updateBridgeState({
      editorActionRequest: {
        ...(action || {}),
        requestedAt: Date.now(),
        requestedBy: "VSWirks App"
      }
    });
    this.bridgeState = {
      ...this.bridgeState,
      editorActionRequest: {
        ...(action || {}),
        requestedAt: Date.now(),
        requestedBy: "VSWirks App"
      }
    };
    await this.applyEditorActionLocally(action);
    return true;
  }

  async syncEditorToProject(project = this.getActiveProject()) {
    if (!project || !project.workspaceRoot) {
      return false;
    }
    const targetPath =
      project.targetPath && isPathWithin(project.workspaceRoot, project.targetPath)
        ? project.targetPath
        : project.workspaceRoot;

    if (await exists(project.workspaceRoot)) {
      await this.dependencies.openInVSWirksEditor(project.workspaceRoot);
      return true;
    }
    if (await exists(targetPath)) {
      await this.dependencies.openInVSWirksEditor(targetPath);
      return true;
    }
    return false;
  }

  async applyEditorActionLocally(action) {
    if (!action || typeof action !== "object") {
      return false;
    }

    if (action.type === "openChangedFiles") {
      const paths = Array.isArray(action.paths)
        ? action.paths.filter((item) => typeof item === "string" && item.trim())
        : [];
      if (paths.length) {
        await this.dependencies.openPathsInVSWirksEditor(paths);
        return true;
      }
      return false;
    }

    if (action.type === "openDiff" && action.leftPath && action.rightPath) {
      await this.dependencies.openDiffInVSWirksEditor(
        action.leftPath,
        action.rightPath,
        action.label || "VSWirks Diff"
      );
      return true;
    }

    if (action.type === "revealPath" && typeof action.path === "string" && action.path) {
      await this.dependencies.openInVSWirksEditor(action.path);
      return true;
    }

    return false;
  }

  async newChat(payload = {}) {
    const project = this.getActiveProject();
    if (!project || this.abortController) {
      return false;
    }
    const workflowPresetId =
      typeof payload.workflowPresetId === "string" && payload.workflowPresetId
        ? payload.workflowPresetId
        : "freeform";
    const thread = createThread({
      mode: payload.mode || "chat",
      executionMode: payload.executionMode || "plan",
      workflowPresetId,
      agentProfileId: normalizeAgentProfileId(
        payload.agentProfileId,
        this.settings.agentProfiles,
        project.defaultAgentProfileId || this.settings.defaultAgentProfileId
      ),
      systemPromptOverride:
        typeof payload.systemPromptOverride === "string" ? payload.systemPromptOverride : "",
      modelOverride:
        typeof payload.modelOverride === "string"
          ? resolveRequestedModel(payload.modelOverride)
          : typeof payload.model === "string"
            ? resolveRequestedModel(payload.model)
            : "",
      draftPrompt: typeof payload.prompt === "string" ? payload.prompt : ""
    });
    project.threads = [thread, ...project.threads].slice(0, 20);
    project.activeThreadId = thread.id;
    project.pendingAttachments = [];
    touchProject(this.projects, project.id);
    this.lastStatus = "Ready";
    await this.persistState();
    this.postState();
    return true;
  }

  switchThread(threadId) {
    const project = this.getActiveProject();
    if (!project || !threadId) {
      return false;
    }
    const thread = project.threads.find((item) => item.id === threadId);
    if (!thread) {
      return false;
    }
    project.activeThreadId = thread.id;
    touchProject(this.projects, project.id);
    this.lastStatus = "Thread switched";
    this.postState();
    return true;
  }

  async deleteThread(threadId) {
    const project = this.getActiveProject();
    if (!project || !threadId || this.abortController) {
      return false;
    }
    project.threads = project.threads.filter((thread) => thread.id !== threadId);
    if (!project.threads.length) {
      const thread = createThread({
        mode: "chat",
        executionMode: "plan",
        agentProfileId: project.defaultAgentProfileId || this.settings.defaultAgentProfileId
      });
      project.threads = [thread];
      project.activeThreadId = thread.id;
    } else if (!project.threads.some((thread) => thread.id === project.activeThreadId)) {
      project.activeThreadId = project.threads[0].id;
    }
    touchProject(this.projects, project.id);
    await this.persistState();
    this.postState();
    return true;
  }

  async updateThreadSettings(payload) {
    const project = this.getActiveProject();
    const thread = this.getActiveThread(project);
    if (!project || !thread) {
      return false;
    }
    if (payload.mode) {
      thread.mode = payload.mode === "agent" ? "agent" : "chat";
    }
    if (payload.executionMode) {
      thread.executionMode = payload.executionMode === "act" ? "act" : "plan";
    }
    if (typeof payload.workflowPresetId === "string" && payload.workflowPresetId) {
      thread.workflowPresetId = payload.workflowPresetId;
    }
    if (typeof payload.pausedAfterSpec === "boolean") {
      thread.pausedAfterSpec = payload.pausedAfterSpec;
    }
    if (typeof payload.agentProfileId === "string") {
      thread.agentProfileId = normalizeAgentProfileId(
        payload.agentProfileId,
        this.settings.agentProfiles,
        project.defaultAgentProfileId || this.settings.defaultAgentProfileId
      );
    }
    if (typeof payload.systemPromptOverride === "string") {
      thread.systemPromptOverride = payload.systemPromptOverride;
    }
    if (typeof payload.draftPrompt === "string") {
      thread.draftPrompt = payload.draftPrompt;
    }
    if (typeof payload.model === "string") {
      thread.model = resolveRequestedModel(payload.model);
      thread.modelOverride = thread.model;
    }
    touchThread(project.threads, thread.id);
    touchProject(this.projects, project.id);
    await this.persistState();
    this.postState();
    return true;
  }

  async updateProjectSettings(payload) {
    const project = this.getActiveProject();
    if (!project) {
      return false;
    }
    if (typeof payload.defaultAgentProfileId === "string") {
      project.defaultAgentProfileId = normalizeAgentProfileId(
        payload.defaultAgentProfileId,
        this.settings.agentProfiles,
        this.settings.defaultAgentProfileId
      );
    }
    touchProject(this.projects, project.id);
    await this.persistState();
    this.postState();
    return true;
  }

  async attachFiles() {
    const project = this.getActiveProject();
    if (!project) {
      return false;
    }
    const picked = await dialog.showOpenDialog(this.window, {
      properties: ["openFile", "multiSelections"]
    });
    if (picked.canceled || !picked.filePaths.length) {
      return false;
    }

    for (const filePath of picked.filePaths) {
      if (isImagePath(filePath)) {
        const imageAttachment = await createImageAttachment(filePath, project.workspaceRoot);
        project.pendingAttachments.push(imageAttachment);
        continue;
      }
      const content = await fs.readFile(filePath, "utf8").catch(() => "");
      project.pendingAttachments.push({
        id: makeId("attachment"),
        kind: "file",
        label:
          project.workspaceRoot && filePath.startsWith(project.workspaceRoot)
            ? path.relative(project.workspaceRoot, filePath)
            : filePath,
        languageId: path.extname(filePath).replace(/^\./, ""),
        content: clampText(content, 18000)
      });
    }

    this.lastStatus = "Files attached";
    await this.persistState();
    this.postState();
    return true;
  }

  async attachImages() {
    const project = this.getActiveProject();
    if (!project) {
      return false;
    }
    const picked = await dialog.showOpenDialog(this.window, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif", "tif", "tiff"]
        }
      ]
    });
    if (picked.canceled || !picked.filePaths.length) {
      return false;
    }

    for (const filePath of picked.filePaths) {
      project.pendingAttachments.push(await createImageAttachment(filePath, project.workspaceRoot));
    }

    this.lastStatus = picked.filePaths.length > 1 ? "Images attached" : "Image attached";
    await this.persistState();
    this.postState();
    return true;
  }

  async attachEditorSelection() {
    const project = this.getActiveProject();
    if (!project) {
      return false;
    }
    const selectionText =
      typeof this.bridgeState.selectionText === "string" ? this.bridgeState.selectionText.trim() : "";
    if (!selectionText) {
      this.emitEvent({
        type: "error",
        message: "No editor selection is currently published from VSWirks Editor."
      });
      return false;
    }
    project.pendingAttachments.push({
      id: makeId("attachment"),
      kind: "selection",
      label: this.bridgeState.selectionLabel || this.bridgeState.activeFileLabel || "Editor selection",
      languageId: this.bridgeState.activeLanguageId || "",
      content: selectionText
    });
    this.lastStatus = "Editor selection attached";
    await this.persistState();
    this.postState();
    return true;
  }

  async removeAttachment(attachmentId) {
    const project = this.getActiveProject();
    if (!project) {
      return false;
    }
    project.pendingAttachments = project.pendingAttachments.filter((item) => item.id !== attachmentId);
    await this.persistState();
    this.postState();
    return true;
  }

  resolveAgentSelection(project, thread, payload = {}) {
    return normalizeAgentProfileId(
      typeof payload.agentProfileId === "string"
        ? payload.agentProfileId
        : thread.agentProfileId || project.defaultAgentProfileId || this.settings.defaultAgentProfileId,
      this.settings.agentProfiles,
      project.defaultAgentProfileId || this.settings.defaultAgentProfileId
    );
  }

  resolvePromptConfiguration({
    project,
    thread,
    payload = {},
    prompt,
    workflowPreset,
    mode,
    executionMode,
    purpose = "conversation"
  }) {
    const agentProfileId = this.resolveAgentSelection(project, thread, payload);
    const agentProfile = this.getAgentProfileById(agentProfileId);
    const threadSystemPrompt =
      typeof payload.systemPromptOverride === "string"
        ? payload.systemPromptOverride.trim()
        : typeof thread.systemPromptOverride === "string"
          ? thread.systemPromptOverride.trim()
          : "";
    const requestedModel =
      resolveRequestedModel(payload.model) ||
      resolveRequestedModel(thread.modelOverride || thread.model) ||
      "";
    const preferredRole =
      (agentProfile && agentProfile.preferredRole) ||
      (workflowPreset && workflowPreset.preferredRole) ||
      "";
    const resolvedModelRole = resolveModelRole({
      prompt,
      mode,
      executionMode,
      purpose,
      preferredRole
    });
    const resolvedModel =
      requestedModel ||
      (agentProfile && agentProfile.modelOverride) ||
      resolveModelForTask(this.settings, {
        prompt,
        mode,
        executionMode,
        purpose,
        preferredRole
      });

    return {
      agentProfileId,
      agentProfile,
      requestedModel,
      resolvedModel,
      resolvedModelRole,
      globalSystemPrompt: this.settings.globalSystemPrompt || "",
      threadSystemPrompt,
      promptPrefix: [workflowPreset && workflowPreset.promptPrefix, agentProfile && agentProfile.promptPrefix]
        .filter(Boolean)
        .join("\n")
        .trim(),
      promptContext: {
        globalSystemPrompt: this.settings.globalSystemPrompt || "",
        agentProfileSystemPrompt:
          agentProfile && agentProfile.systemPrompt ? agentProfile.systemPrompt : "",
        threadSystemPrompt,
        workflowPromptPrefix:
          workflowPreset && workflowPreset.promptPrefix ? workflowPreset.promptPrefix : "",
        agentPromptPrefix:
          agentProfile && agentProfile.promptPrefix ? agentProfile.promptPrefix : ""
      }
    };
  }

  async buildSpec(payload) {
    const project = this.getActiveProject();
    const thread = this.getActiveThread(project);
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!project || !thread || !prompt) {
      return { ok: false, specId: "" };
    }

    const workflowPreset = this.getWorkflowPreset(
      project,
      typeof payload.workflowPresetId === "string" && payload.workflowPresetId
        ? payload.workflowPresetId
        : thread.workflowPresetId
    );
    const mode =
      payload.mode === "agent"
        ? "agent"
        : thread.mode ||
          (this.getAgentProfileById(this.resolveAgentSelection(project, thread, payload)) || {})
            .defaultMode ||
          workflowPreset.defaultMode;
    const executionMode =
      payload.executionMode === "act"
        ? "act"
        : payload.executionMode === "plan"
          ? "plan"
          : thread.executionMode ||
            (this.getAgentProfileById(this.resolveAgentSelection(project, thread, payload)) || {})
              .defaultExecutionMode ||
            workflowPreset.defaultExecutionMode;
    const promptConfig = this.resolvePromptConfiguration({
      project,
      thread,
      payload,
      prompt,
      workflowPreset,
      mode,
      executionMode,
      purpose: "builder"
    });

    try {
      this.lastStatus = "Building spec";
      this.postState();
      const specDraft = await this.generateSpecDraft({
        project,
        thread,
        prompt,
        workflowPreset,
        model: promptConfig.resolvedModel
      });
      this.saveSpecDraft(project, thread, specDraft);
      this.lastStatus = "Spec ready";
      await this.persistState();
      this.postState();
      return {
        ok: true,
        specId: specDraft.id
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent({ type: "error", message });
      this.lastStatus = `Spec failed: ${message}`;
      this.postState();
      return {
        ok: false,
        specId: ""
      };
    }
  }

  async refinePrompt(payload) {
    if (this.abortController || this.promptRefining) {
      return {
        ok: false,
        prompt: "",
        changed: false
      };
    }

    const project = this.getActiveProject();
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!prompt) {
      return {
        ok: false,
        prompt: "",
        changed: false
      };
    }

    const mode = payload.mode === "agent" ? "agent" : "chat";
    const executionMode = payload.executionMode === "act" ? "act" : "plan";
    const promptConfig = this.resolvePromptConfiguration({
      project,
      thread: this.getActiveThread(project) || createThread(),
      payload,
      prompt,
      workflowPreset: this.getWorkflowPreset(project, "freeform"),
      mode,
      executionMode,
      purpose: "refiner"
    });
    const model = promptConfig.resolvedModel;
    const workspacePath =
      project && (project.targetPath || project.workspaceRoot)
        ? project.targetPath || project.workspaceRoot
        : "";
    const workspaceSummary = workspacePath ? await describeWorkspaceRoot(workspacePath) : null;
    const attachmentSummary =
      project && Array.isArray(project.pendingAttachments) && project.pendingAttachments.length
        ? project.pendingAttachments.map((item) => `${item.kind}: ${item.label}`).join("\n- ")
        : "";

    this.promptRefining = true;
    this.lastStatus = "Refining prompt";
    this.postState();

    try {
      const response = await fetchRuntimeJson(
        this.settings.runtimeBaseUrl,
        "/chat/completions",
        {
          model,
          stream: false,
          ...buildPromptRefinerGenerationOptions(this.settings.generationSettings),
          messages: buildPromptRefinerMessages({
            prompt,
            mode,
            executionMode,
            project,
            workspaceSummary: workspaceSummary ? workspaceSummary.description : "",
            attachmentSummary
          })
        }
      );

      const content =
        response &&
        response.choices &&
        response.choices[0] &&
        response.choices[0].message &&
        typeof response.choices[0].message.content === "string"
          ? response.choices[0].message.content
          : "";
      const refinedPrompt = sanitizeRefinedPrompt(content) || prompt;

      this.lastStatus = refinedPrompt === prompt ? "Prompt already solid" : "Prompt refined";
      return {
        ok: true,
        prompt: refinedPrompt,
        changed: refinedPrompt !== prompt
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent({
        type: "error",
        message
      });
      this.lastStatus = `Error: ${message}`;
      return {
        ok: false,
        prompt,
        changed: false
      };
    } finally {
      this.promptRefining = false;
      this.postState();
    }
  }

  async sendPrompt(payload) {
    if (this.abortController) {
      return false;
    }
    const project = this.getActiveProject();
    const thread = this.getActiveThread(project);
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!project || !thread || !prompt) {
      return false;
    }

    const requestedWorkflowId =
      typeof payload.workflowPresetId === "string" && payload.workflowPresetId
        ? payload.workflowPresetId
        : thread.workflowPresetId || inferWorkflowPresetId(prompt, project.pendingAttachments);
    const workflowPreset = this.getWorkflowPreset(project, requestedWorkflowId);
    const requestedAgentProfileId = this.resolveAgentSelection(project, thread, payload);
    const agentProfile = this.getAgentProfileById(requestedAgentProfileId);
    const mode =
      payload.mode === "agent"
        ? "agent"
        : payload.mode === "chat"
          ? "chat"
          : thread.mode || (agentProfile && agentProfile.defaultMode) || workflowPreset.defaultMode;
    const executionMode =
      payload.executionMode === "act" ? "act" : payload.executionMode === "plan"
        ? "plan"
        : thread.executionMode ||
          (agentProfile && agentProfile.defaultExecutionMode) ||
          workflowPreset.defaultExecutionMode;
    const promptConfig = this.resolvePromptConfiguration({
      project,
      thread,
      payload: {
        ...payload,
        agentProfileId: requestedAgentProfileId
      },
      prompt,
      workflowPreset,
      mode,
      executionMode,
      purpose: "conversation"
    });
    const pauseAfterSpec =
      typeof payload.pausedAfterSpec === "boolean" ? payload.pausedAfterSpec : thread.pausedAfterSpec;
    let specDraft = this.getSpecById(project, thread.specDraftId);
    const useActiveSpec = Boolean(payload.useActiveSpec && specDraft);

    thread.workflowPresetId = workflowPreset.id;
    thread.mode = mode;
    thread.executionMode = executionMode;
    thread.pausedAfterSpec = pauseAfterSpec;
    thread.agentProfileId = promptConfig.agentProfileId;
    thread.systemPromptOverride = promptConfig.threadSystemPrompt;
    thread.model = promptConfig.requestedModel;
    thread.modelOverride = promptConfig.requestedModel;
    thread.lastModelUsed = promptConfig.resolvedModel;
    thread.draftPrompt = "";

    const runRecord = createRunRecord({
      threadId: thread.id,
      workflowId: workflowPreset.id,
      prompt,
      mode,
      executionMode,
      requestedModel: promptConfig.requestedModel,
      resolvedModel: promptConfig.resolvedModel,
      agentProfileId: promptConfig.agentProfileId,
      resolvedAgentProfileId: promptConfig.agentProfileId,
      resolvedAgentProfileLabel: promptConfig.agentProfile ? promptConfig.agentProfile.label : "",
      resolvedModelRole: promptConfig.resolvedModelRole,
      resolvedPromptPrefix: promptConfig.promptPrefix,
      promptContext: promptConfig.promptContext,
      status: "running",
      pausedAfterSpec: pauseAfterSpec
    });
    this.attachRunToProject(project, thread, runRecord);

    const shouldBuildSpec =
      !useActiveSpec &&
      shouldBuildSpecForRequest({
        workflowPreset,
        mode,
        prompt,
        attachments: project.pendingAttachments
      });
    try {
      if (shouldBuildSpec) {
        specDraft = await this.generateSpecDraft({
          project,
          thread,
          prompt,
          workflowPreset,
          model: resolveModelForTask(this.settings, {
            prompt,
            mode,
            executionMode,
            purpose: "builder",
            preferredRole:
              (promptConfig.agentProfile && promptConfig.agentProfile.preferredRole) ||
              workflowPreset.preferredRole ||
              ""
          })
        });
        this.saveSpecDraft(project, thread, specDraft);
        runRecord.specDraftId = specDraft.id;
        this.recordRunEvent(project, runRecord, createRunEvent({
          type: "spec",
          label: `Generated spec for ${workflowPreset.label}`,
          detail: specDraft.raw
        }));
        this.recordRunCheckpoint(project, runRecord, createRunCheckpoint({
          runId: runRecord.id,
          label: "Spec generated",
          step: 0,
          threadMessageCount: thread.messages.length,
          eventCount: runRecord.events.length,
          changedFiles: []
        }));

        if (executionMode === "plan") {
          thread.specDraftId = specDraft.id;
          this.appendAssistantSpecMessage(thread, specDraft, promptConfig.resolvedModel);
          runRecord.status = "complete";
          runRecord.summary = "Spec generated in plan mode.";
          project.currentRunStatus = "Spec complete";
          this.lastStatus = "Spec complete";
          await this.persistState();
          this.postState();
          return true;
        }

        if (pauseAfterSpec) {
          thread.specDraftId = specDraft.id;
          this.appendAssistantSpecMessage(thread, specDraft, promptConfig.resolvedModel);
          runRecord.status = "paused_after_spec";
          runRecord.summary = "Spec generated and paused before execution.";
          project.currentRunStatus = "Paused after spec";
          this.lastStatus = "Paused after spec";
          await this.persistState();
          this.postState();
          return true;
        }
      }

      if (useActiveSpec && specDraft) {
        runRecord.specDraftId = specDraft.id;
      }

      await this.refreshProjectIntelligence(project, false);
      if (!this.serviceState.healthy) {
        await this.refreshRuntimeState(false);
        if (!this.serviceState.healthy) {
          this.emitEvent({
            type: "error",
            message: "ai-runtime is offline. Start the service before sending a prompt."
          });
          runRecord.status = "failed";
          runRecord.summary = "ai-runtime offline";
          runRecord.finishedAt = Date.now();
          project.currentRunStatus = "Runtime offline";
          await this.persistState();
          this.postState();
          return false;
        }
      }
      this.abortController = new AbortController();
      this.lastStatus = executionMode === "act" ? "Running workflow" : "Planning";
      this.postState();

      runRecord.resolvedSystemPrompt = await buildWorkspaceSystemPrompt(
        project.targetPath || project.workspaceRoot,
        {
          workflowPreset,
          specDraft,
          intelligence: project.intelligence,
          globalSystemPrompt: promptConfig.globalSystemPrompt,
          agentProfile: promptConfig.agentProfile,
          threadSystemPrompt: promptConfig.threadSystemPrompt
        }
      );

      // Studio mode: prepend developer-companion system prompt
      if (payload.studioMode) {
        const directives = [];
        const features = Array.isArray(payload.studioFeatures) ? payload.studioFeatures : [];
        directives.push(
          "You are a developer's local-first AI companion called VSWirks Studio.",
          "Be conversational, practical, and developer-casual in tone.",
          "Give real answers, not filler. Be direct."
        );
        if (features.includes("deep-research")) {
          directives.push("Provide thorough, deeply researched answers with references and rationale.");
        }
        if (features.includes("web-tools")) {
          directives.push("Reference web resources, current tooling, and ecosystem context when relevant.");
        }
        if (features.includes("quick-response")) {
          directives.push("Keep your answer concise and actionable -- aim for brief practical guidance.");
        }
        runRecord.resolvedSystemPrompt = directives.join(" ") + "\n\n" + (runRecord.resolvedSystemPrompt || "");
      }

      await this.dependencies.runConversation({
        project,
        thread,
        prompt,
        mode,
        executionMode,
        model: promptConfig.resolvedModel,
        modelSelection: promptConfig.requestedModel,
        attachments: [...project.pendingAttachments],
        generationSettings: this.settings.generationSettings,
        runtimeBaseUrl: this.settings.runtimeBaseUrl,
        signal: this.abortController.signal,
        writeRequiresApproval: this.settings.writeRequiresApproval,
        requestApproval: this.requestApproval.bind(this),
        onState: () => {
          touchThread(project.threads, thread.id);
          touchProject(this.projects, project.id);
          void this.persistState();
          this.postState();
        },
        onStatus: (statusText) => {
          this.lastStatus = statusText;
          this.postState();
        },
        onRunEvent: (event) => {
          this.recordRunEvent(project, runRecord, event);
          touchProject(this.projects, project.id);
          this.postState();
        },
        onRunCheckpoint: (checkpoint) => {
          this.recordRunCheckpoint(project, runRecord, checkpoint);
          this.postState();
        },
        workflowPreset,
        specDraft,
        intelligence: project.intelligence,
        promptContext: {
          globalSystemPrompt: promptConfig.globalSystemPrompt,
          agentProfile: promptConfig.agentProfile,
          threadSystemPrompt: promptConfig.threadSystemPrompt,
          promptPrefix: promptConfig.promptPrefix
        },
        runRecord
      });

      await this.finalizeValidationIfNeeded(project, thread, workflowPreset, runRecord);
      await this.revealRunOutputs(project, runRecord);

      if (runRecord.status === "running") {
        runRecord.status = "complete";
      }
      runRecord.finishedAt = Date.now();
      project.currentRunStatus =
        runRecord.status === "paused_recoverable"
          ? "Paused - resumable"
          : runRecord.validation.status === "failed"
            ? "Validation failed"
            : "Run complete";
      thread.lastValidationResult = runRecord.validation.status;
      this.lastStatus = project.currentRunStatus;
      await this.persistState();
      this.postState();
      return true;
    } catch (error) {
      if (error && error.name === "AbortError") {
        this.lastStatus = "Stopped";
        const lastAssistant = [...thread.messages]
          .reverse()
          .find((item) => item.role === "assistant");
        if (lastAssistant) {
          lastAssistant.pending = false;
          lastAssistant.status = "";
        }
        project.currentRunStatus = "Stopped";
        runRecord.status = "stopped";
        runRecord.finishedAt = Date.now();
        await this.persistState();
        this.postState();
        return true;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent({
        type: "error",
        message
      });
      this.lastStatus = `Error: ${message}`;
      project.currentRunStatus = "Error";
      runRecord.status = "failed";
      runRecord.finishedAt = Date.now();
      this.recordRunEvent(project, runRecord, createRunEvent({
        type: "error",
        label: "Run failed",
        detail: message,
        error: true
      }));
      await this.persistState();
      this.postState();
      return false;
    } finally {
      this.abortController = null;
      if (this.pendingApprovalResolver) {
        this.pendingApprovalResolver({
          approved: false,
          nextMode: "ask"
        });
        this.pendingApprovalResolver = null;
      }
      this.pendingApproval = null;
      this.postState();
    }
  }

  attachRunToProject(project, thread, runRecord) {
    thread.currentRunId = runRecord.id;
    project.currentRunId = runRecord.id;
    project.currentRunStatus = "Queued";
    project.runs = [runRecord, ...(project.runs || [])].slice(0, 40);
    touchThread(project.threads, thread.id);
    touchProject(this.projects, project.id);
  }

  recordRunEvent(project, runRecord, event) {
    runRecord.updatedAt = Date.now();
    runRecord.events = [createRunEvent(event), ...(runRecord.events || [])].slice(0, 240);
    if (event.type === "write_applied" && event.path) {
      runRecord.changedFiles = Array.from(new Set([...(runRecord.changedFiles || []), event.path]));
    }
    if (event.type === "proposal") {
      runRecord.status = "awaiting_approval";
    } else if (event.type === "complete" && runRecord.status === "running") {
      runRecord.status = "complete";
    } else if (event.type === "warning" && /paused/i.test(event.label || "")) {
      runRecord.status = "paused_recoverable";
    } else if (event.type === "error") {
      runRecord.status = "failed";
    } else if (runRecord.status === "awaiting_approval" && event.type === "write_applied") {
      runRecord.status = "running";
    }
    runRecord.summary = event.label || runRecord.summary;
    project.currentRunStatus = runRecord.summary || project.currentRunStatus;
  }

  recordRunCheckpoint(project, runRecord, checkpoint) {
    runRecord.updatedAt = Date.now();
    runRecord.checkpoints = [createRunCheckpoint(checkpoint), ...(runRecord.checkpoints || [])].slice(0, 80);
    project.currentRunStatus = checkpoint.label || project.currentRunStatus;
  }

  async finalizeValidationIfNeeded(project, thread, workflowPreset, runRecord) {
    if (thread.executionMode !== "act") {
      runRecord.validation = {
        status: "skipped",
        steps: [],
        summary: "Validation skipped for plan-only runs."
      };
      return;
    }
    if (
      runRecord.status === "paused_recoverable" ||
      runRecord.status === "paused_after_spec" ||
      runRecord.status === "awaiting_approval"
    ) {
      runRecord.validation = {
        status: "skipped",
        steps: [],
        summary: "Validation skipped because the run is paused and incomplete."
      };
      return;
    }

    const validation = await runValidationPlan({
      intelligence: project.intelligence,
      validationPack: workflowPreset.validationPack,
      fallbackCwd: project.workspaceRoot,
      failOnMissingPlan:
        workflowPreset.id === "scaffold-app" &&
        Array.isArray(runRecord.changedFiles) &&
        runRecord.changedFiles.length > 0
    });
    runRecord.validation = validation;
    thread.lastValidationResult = validation.status;
    this.recordRunEvent(project, runRecord, createRunEvent({
      type: "validation",
      label:
        validation.status === "skipped"
          ? "Validation skipped"
          : validation.status === "failed"
            ? "Validation failed"
            : "Validation passed",
      detail:
        validation.summary +
        (validation.steps.length
          ? `\n\n${validation.steps
              .map((step) => `- ${step.label}: ${step.status}`)
              .join("\n")}`
          : "")
    }));
    this.recordRunCheckpoint(project, runRecord, createRunCheckpoint({
      runId: runRecord.id,
      label: validation.summary || "Validation complete",
      step: runRecord.checkpoints.length + 1,
      threadMessageCount: thread.messages.length,
      eventCount: runRecord.events.length,
      changedFiles: runRecord.changedFiles
    }));
    if (validation.status === "failed") {
      runRecord.status = "validation_failed";
    }
  }

  async revealRunOutputs(project, runRecord) {
    if (!runRecord.changedFiles.length || !project.workspaceRoot) {
      return false;
    }
    const changedAbsolutePaths = runRecord.changedFiles.map((item) =>
      path.join(project.workspaceRoot, item)
    );
    await this.publishEditorAction({
      type: "openChangedFiles",
      workspaceRoot: project.workspaceRoot,
      targetPath: project.targetPath || project.workspaceRoot,
      paths: changedAbsolutePaths
    });
    return true;
  }

  async resumeRun(payload) {
    const project = this.getActiveProject();
    const run = this.getRunById(project, payload.runId);
    const thread = run
      ? project.threads.find((item) => item.id === run.threadId)
      : this.getActiveThread(project);
    if (!project || !run || !thread || this.abortController) {
      return false;
    }

    project.activeThreadId = thread.id;
    const resumePrompt =
      run.status === "paused_after_spec"
        ? "Continue from the active spec and implement the project in the current workspace. Use the current spec as the contract and avoid repeating already completed work."
        : "Continue the paused run from the latest safe checkpoint. Resume from the current workspace state, avoid repeating completed writes, and finish the remaining work.";

    return this.sendPrompt({
      prompt: resumePrompt,
      mode: thread.mode,
      executionMode: "act",
      workflowPresetId: thread.workflowPresetId,
      model: thread.modelOverride || thread.model,
      agentProfileId: thread.agentProfileId,
      systemPromptOverride: thread.systemPromptOverride,
      pausedAfterSpec: false
    });
  }

  async replayRun(payload) {
    const project = this.getActiveProject();
    const run = this.getRunById(project, payload.runId);
    if (!project || !run || this.abortController) {
      return false;
    }

    await this.newChat({
      workflowPresetId: run.workflowId,
      mode: run.mode,
      executionMode: run.executionMode,
      agentProfileId: run.agentProfileId || run.resolvedAgentProfileId || "",
      modelOverride: run.requestedModel || "",
      prompt: run.prompt
    });
    const thread = this.getActiveThread(project);
    thread.model = run.requestedModel || "";
    thread.modelOverride = run.requestedModel || "";
    thread.agentProfileId = run.agentProfileId || run.resolvedAgentProfileId || "";
    thread.pausedAfterSpec = run.pausedAfterSpec;
    thread.systemPromptOverride =
      run.promptContext && typeof run.promptContext.threadSystemPrompt === "string"
        ? run.promptContext.threadSystemPrompt
        : "";
    return this.sendPrompt({
      prompt: run.prompt,
      mode: run.mode,
      executionMode: run.executionMode,
      workflowPresetId: run.workflowId,
      model: run.requestedModel,
      agentProfileId: run.agentProfileId || run.resolvedAgentProfileId || "",
      systemPromptOverride:
        run.promptContext && typeof run.promptContext.threadSystemPrompt === "string"
          ? run.promptContext.threadSystemPrompt
          : "",
      pausedAfterSpec: run.pausedAfterSpec
    });
  }

  async forkRunCheckpoint(payload) {
    const project = this.getActiveProject();
    const run = this.getRunById(project, payload.runId);
    const thread = run
      ? project.threads.find((item) => item.id === run.threadId)
      : null;
    const checkpoint =
      run && Array.isArray(run.checkpoints)
        ? run.checkpoints.find((item) => item.id === payload.checkpointId)
        : null;
    if (!project || !run || !thread || !checkpoint || this.abortController) {
      return false;
    }

    const forked = createThread({
      mode: thread.mode,
      executionMode: thread.executionMode,
      modelOverride: thread.modelOverride || thread.model,
      agentProfileId: thread.agentProfileId,
      systemPromptOverride: thread.systemPromptOverride,
      workflowPresetId: thread.workflowPresetId,
      draftPrompt: thread.draftPrompt || ""
    });
    forked.messages = thread.messages.slice(0, checkpoint.threadMessageCount);
    forked.title = `${thread.title} (forked)`;
    forked.specDraftId = thread.specDraftId;
    project.threads = [forked, ...project.threads].slice(0, 20);
    project.activeThreadId = forked.id;
    touchProject(this.projects, project.id);
    this.lastStatus = `Forked from checkpoint: ${checkpoint.label}`;
    await this.persistState();
    this.postState();
    return true;
  }

  async uploadSpec() {
    const project = this.getActiveProject();
    const thread = this.getActiveThread(project);
    if (!project || !thread) {
      return false;
    }
    const picked = await dialog.showOpenDialog(this.window, {
      title: "Upload a spec file",
      properties: ["openFile"],
      filters: [
        {
          name: "Spec files",
          extensions: ["md", "txt", "json", "yaml", "yml"]
        }
      ]
    });
    if (picked.canceled || !picked.filePaths.length) {
      return false;
    }
    const filePath = picked.filePaths[0];
    const raw = await fs.readFile(filePath, "utf8").catch(() => "");
    if (!raw.trim()) {
      this.emitEvent({ type: "error", message: "Spec file is empty" });
      return false;
    }

    let parsed = {};
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".json") {
      parsed = safeJsonParse(raw) || {};
    } else {
      // Extract structured fields from markdown headings
      const goalMatch = raw.match(/^#+\s*(?:goal|objective|summary)[:\s]*(.*)/im);
      const titleMatch = raw.match(/^#+\s+(.+)/m);
      parsed.goal = goalMatch ? goalMatch[1].trim() : clampText(raw, 240);
      parsed.title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, ext);
    }

    const specDraft = createSpecDraft({
      threadId: thread.id,
      workflowId: thread.workflowPresetId || "scaffold-app",
      status: "draft",
      title: parsed.title || inferSpecTitle(raw),
      goal: parsed.goal || clampText(raw, 240),
      stack: parsed.stack || [],
      constraints: parsed.constraints || [],
      deliverables: parsed.deliverables || [],
      acceptance_criteria: parsed.acceptance_criteria || [],
      validation_plan: parsed.validation_plan || [],
      implementation_plan: parsed.implementation_plan || [],
      raw,
      generatedFrom: `file:${filePath}`,
      model: "uploaded"
    });

    this.saveSpecDraft(project, thread, specDraft);
    // Also inject a user message so the spec shows in chat history
    thread.messages.push({
      id: makeId("user"),
      role: "user",
      content: `[Uploaded spec: ${path.basename(filePath)}]\n\n${clampText(raw, 8000)}`,
      mode: thread.mode,
      executionMode: thread.executionMode,
      createdAt: Date.now()
    });
    this.lastStatus = `Spec loaded from ${path.basename(filePath)}`;
    await this.persistState();
    this.postState();
    return true;
  }

  async useMessageAsSpec(payload) {
    const project = this.getActiveProject();
    const thread = this.getActiveThread(project);
    if (!project || !thread || !payload.messageId) {
      return false;
    }
    const message = thread.messages.find((item) => item.id === payload.messageId);
    if (!message || !message.content) {
      return false;
    }
    const specDraft = createSpecDraft({
      threadId: thread.id,
      workflowId: thread.workflowPresetId,
      title: inferSpecTitle(message.content),
      goal: clampText(message.content, 240),
      raw: message.content,
      model: message.model || thread.lastModelUsed
    });
    this.saveSpecDraft(project, thread, specDraft);
    this.lastStatus = "Message saved as spec";
    await this.persistState();
    this.postState();
    return true;
  }

  async reviewGeneratedFiles(payload) {
    const project = this.getActiveProject();
    const run = this.getRunById(project, payload.runId) || this.getActiveRun(project);
    if (!project || !run || !run.changedFiles.length || this.abortController) {
      return false;
    }
    await this.newChat({
      workflowPresetId: "review-repo",
      mode: "chat",
      executionMode: "plan"
    });
    return this.sendPrompt({
      prompt:
        "Review the files changed by the previous run. Prioritize bugs, regressions, risky assumptions, and missing tests.\n\nChanged files:\n" +
        run.changedFiles.map((item) => `- ${item}`).join("\n"),
      mode: "chat",
      executionMode: "plan",
      workflowPresetId: "review-repo"
    });
  }

  async revealRunFiles(payload) {
    const project = this.getActiveProject();
    const run = this.getRunById(project, payload.runId) || this.getActiveRun(project);
    if (!project || !run || !run.changedFiles.length) {
      return false;
    }
    const absolute = run.changedFiles.map((item) => path.join(project.workspaceRoot, item));
    await this.publishEditorAction({
      type: "openChangedFiles",
      workspaceRoot: project.workspaceRoot,
      targetPath: project.targetPath || project.workspaceRoot,
      paths: absolute
    });
    this.lastStatus = `Revealed ${run.changedFiles.length} file${run.changedFiles.length === 1 ? "" : "s"} in VSWirks Editor`;
    this.postState();
    return true;
  }

  async openRunDiff(payload) {
    const project = this.getActiveProject();
    const run = this.getRunById(project, payload.runId) || this.getActiveRun(project);
    if (!project || !run || !payload.eventId) {
      return false;
    }
    const event = (run.events || []).find((item) => item.id === payload.eventId);
    if (!event || !event.path) {
      return false;
    }
    const currentPath = path.join(project.workspaceRoot, event.path);
    const backupPath = extractBackupPathFromEvent(event);
    const leftPath =
      backupPath ||
      (await createEmptyDiffBaseFile(`vswirks-diff-${event.path.replace(/[\\/]/g, "__")}`));
    await this.publishEditorAction({
      type: "openDiff",
      leftPath,
      rightPath: currentPath,
      label: `VSWirks Diff: ${event.path}`
    });
    this.lastStatus = `Opened diff for ${event.path}`;
    this.postState();
    return true;
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
    }
    return true;
  }

  requestApproval(approvalRequest) {
    if (!this.settings.writeRequiresApproval) {
      return Promise.resolve({
        approved: true,
        nextMode: "run"
      });
    }

    const project = this.getActiveProject();
    const run = this.getActiveRun(project);
    const approval = createApprovalRequest(approvalRequest);
    this.pendingApproval = approval;
    if (run) {
      run.pendingApprovals = [approval, ...(run.pendingApprovals || [])];
      run.status = "awaiting_approval";
    }
    this.postState();

    return new Promise((resolve) => {
      this.pendingApprovalResolver = resolve;
    });
  }

  resolveApproval(payload) {
    if (!this.pendingApproval || !this.pendingApprovalResolver) {
      return false;
    }
    const decision = typeof payload.decision === "string" ? payload.decision : "deny";
    const resolver = this.pendingApprovalResolver;
    const project = this.getActiveProject();
    const run = this.getActiveRun(project);
    if (run) {
      run.pendingApprovals = (run.pendingApprovals || []).map((item) =>
        item.id === this.pendingApproval.id
          ? {
              ...item,
              status: decision === "deny" ? "denied" : "approved",
              scope: decision
            }
          : item
      );
      run.status = decision === "deny" ? "running" : "running";
      this.recordRunCheckpoint(project, run, createRunCheckpoint({
        runId: run.id,
        label: `${decision === "deny" ? "Denied" : "Approved"} ${this.pendingApproval.relativePath}`,
        step: run.checkpoints.length + 1,
        threadMessageCount: this.getActiveThread(project).messages.length,
        eventCount: run.events.length,
        changedFiles: run.changedFiles
      }));
    }
    this.pendingApprovalResolver = null;
    this.pendingApproval = null;
    resolver({
      approved: decision !== "deny",
      nextMode: decision === "chat" ? "chat" : decision === "run" ? "run" : "ask"
    });
    this.postState();
    return true;
  }

  async saveGenerationSettings(payload) {
    this.settings.generationSettings = normalizeGenerationSettings(payload);
    await writeSettings(this.settings);
    this.lastStatus = "Generation defaults saved";
    this.postState();
    return true;
  }

  async saveModelRoles(payload) {
    this.settings.modelRoles = normalizeModelRoles(payload, DEFAULT_MODEL);
    await writeSettings(this.settings);
    this.lastStatus = "Model roles saved";
    this.postState();
    return true;
  }

  async savePromptingSettings(payload) {
    this.settings.globalSystemPrompt =
      typeof payload.globalSystemPrompt === "string" ? payload.globalSystemPrompt.trim() : "";
    this.settings.agentProfiles = normalizeAgentProfileList(payload.agentProfiles);
    this.settings.defaultAgentProfileId = normalizeAgentProfileId(
      payload.defaultAgentProfileId,
      this.settings.agentProfiles,
      DEFAULT_AGENT_PROFILE_ID
    );
    this.normalizePromptingState();
    await writeSettings(this.settings);
    await this.persistState();
    this.lastStatus = "Agents and prompting settings saved";
    this.postState();
    return true;
  }

  async getPromptPreview(payload = {}) {
    const project = this.getActiveProject();
    const thread = this.getActiveThread(project);
    if (!project || !thread) {
      return {
        ok: false,
        preview: ""
      };
    }

    const prompt =
      typeof payload.prompt === "string" && payload.prompt.trim()
        ? payload.prompt.trim()
        : thread.draftPrompt || "";
    const workflowPreset = this.getWorkflowPreset(
      project,
      typeof payload.workflowPresetId === "string" && payload.workflowPresetId
        ? payload.workflowPresetId
        : thread.workflowPresetId || "freeform"
    );
    const mode = payload.mode === "agent" ? "agent" : payload.mode === "chat" ? "chat" : thread.mode;
    const executionMode =
      payload.executionMode === "act" ? "act" : payload.executionMode === "plan"
        ? "plan"
        : thread.executionMode;
    const promptConfig = this.resolvePromptConfiguration({
      project,
      thread,
      payload,
      prompt,
      workflowPreset,
      mode,
      executionMode,
      purpose: "conversation"
    });
    const specDraft = this.getSpecById(project, thread.specDraftId);
    const preview = await buildWorkspaceSystemPrompt(project.targetPath || project.workspaceRoot, {
      workflowPreset,
      specDraft,
      intelligence: project.intelligence,
      globalSystemPrompt: promptConfig.globalSystemPrompt,
      agentProfile: promptConfig.agentProfile,
      threadSystemPrompt: promptConfig.threadSystemPrompt
    });
    return {
      ok: true,
      preview,
      resolvedModel: promptConfig.resolvedModel,
      agentProfileId: promptConfig.agentProfileId
    };
  }

  async resetGenerationSettings() {
    this.settings.generationSettings = DEFAULT_GENERATION_SETTINGS;
    await writeSettings(this.settings);
    this.lastStatus = "Restored tuned defaults";
    this.postState();
    return true;
  }

  async openFile(payload) {
    const project = this.getActiveProject();
    if (!project) {
      return false;
    }
    const filePath =
      typeof payload.path === "string" && project.targetPath
        ? path.join(project.targetPath, payload.path)
        : project.workspaceRoot
          ? path.join(project.workspaceRoot, payload.path || "")
          : "";
    if (!filePath) {
      return false;
    }
    await this.dependencies.openInVSWirksEditor(filePath);
    return true;
  }

  async openProjectInEditor() {
    const project = this.getActiveProject();
    if (!project || !project.workspaceRoot) {
      return false;
    }
    const revealPath = project.targetPath || project.workspaceRoot;
    if (await exists(revealPath)) {
      await this.dependencies.openInVSWirksEditor(revealPath);
      this.lastStatus = `Revealed in VSWirks Editor: ${formatWorkspaceLabel(
        project.workspaceRoot,
        revealPath
      )}`;
      this.postState();
      return true;
    }
    return false;
  }

  async refreshRuntimeState(refreshModels = false) {
    const nextState = await probeRuntimeHealth(this.settings.runtimeBaseUrl);
    this.serviceState = {
      healthy: nextState.healthy,
      starting: false,
      label: nextState.label
    };

    if (nextState.healthy || refreshModels) {
      try {
        const data = await fetchRuntimeJson(this.settings.runtimeBaseUrl, "/models");
        this.models = Array.isArray(data.data)
          ? data.data.map((item) => item.id).filter(Boolean)
          : [];
      } catch {
        this.models = this.models || [];
      }
    }

    this.postState();
  }

  async startRuntimeService() {
    if (this.serviceState.starting) {
      return false;
    }

    const healthy = await probeRuntimeHealth(this.settings.runtimeBaseUrl);
    if (healthy.healthy) {
      this.serviceState = {
        healthy: true,
        starting: false,
        label: healthy.label
      };
      this.lastStatus = "ai-runtime already running";
      this.postState();
      return true;
    }

    this.serviceState = {
      healthy: false,
      starting: true,
      label: "Starting ai-runtime"
    };
    this.lastStatus = "Starting ai-runtime";
    this.postState();

    try {
      if (!(await exists(this.settings.runtimePython))) {
        throw new Error(`Runtime Python not found: ${this.settings.runtimePython}`);
      }
      if (!(await exists(path.join(this.settings.runtimeCwd, "app", "main.py")))) {
        throw new Error(`Runtime app not found under: ${this.settings.runtimeCwd}`);
      }
      const runtimeUrl = new URL(this.settings.runtimeBaseUrl.replace(/\/v1$/, ""));
      await spawnDetachedProcess(
        this.settings.runtimePython,
        [
          "-m",
          "uvicorn",
          "app.main:app",
          "--host",
          runtimeUrl.hostname || "127.0.0.1",
          "--port",
          runtimeUrl.port || "7471"
        ],
        this.settings.runtimeCwd
      );

      const ready = await waitForRuntimeHealthy(this.settings.runtimeBaseUrl, 12000);
      if (!ready) {
        throw new Error("ai-runtime did not become healthy in time");
      }

      this.serviceState = {
        healthy: true,
        starting: false,
        label: "Service ready"
      };
      this.lastStatus = "ai-runtime started";
      await this.refreshRuntimeState(true);
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isTransient = /econnrefused|timeout|upstream unavailable/i.test(errorMsg);
      this.serviceState = {
        healthy: false,
        starting: false,
        label: isTransient ? "Service offline – retryable" : "Service offline"
      };
      this.lastStatus = isTransient
        ? `Start failed (retryable): ${errorMsg}. Click Start again or check that ai-runtime is installed.`
        : `Start failed: ${errorMsg}`;
      this.emitEvent({
        type: "error",
        message: this.lastStatus
      });
      this.postState();
      return false;
    }
  }

  async refreshProjectIntelligence(project = this.getActiveProject(), forceStatusText = false) {
    if (!project || !project.workspaceRoot) {
      return null;
    }
    const intelligence = await scanProjectIntelligence({
      workspaceRoot: project.workspaceRoot,
      targetPath: project.targetPath || project.workspaceRoot
    });
    project.intelligence = {
      ...createProjectIntelligence(intelligence),
      id:
        project.intelligence && project.intelligence.id ? project.intelligence.id : makeId("intel")
    };
    if (forceStatusText) {
      this.lastStatus = "Project intelligence refreshed";
    }
    return project.intelligence;
  }

  saveSpecDraft(project, thread, specDraft) {
    project.specs = [specDraft, ...(project.specs || []).filter((item) => item.id !== specDraft.id)].slice(
      0,
      16
    );
    project.activeSpecId = specDraft.id;
    thread.specDraftId = specDraft.id;
  }

  appendAssistantSpecMessage(thread, specDraft, model) {
    thread.messages.push({
      id: makeId("assistant"),
      role: "assistant",
      content: formatSpecDraftMarkdown(specDraft),
      model,
      mode: thread.mode,
      executionMode: "plan",
      pending: false,
      createdAt: Date.now()
    });
  }

  async generateSpecDraft({ project, thread, prompt, workflowPreset, model }) {
    const workspaceSummary = await describeWorkspaceRoot(project.targetPath || project.workspaceRoot);
    const response = await fetchRuntimeJson(
      this.settings.runtimeBaseUrl,
      "/chat/completions",
      {
        model,
        stream: false,
        ...buildSpecGenerationOptions(this.settings.generationSettings),
        messages: buildSpecMessages({
          prompt,
          workflowPreset,
          project,
          thread,
          workspaceSummary: workspaceSummary ? workspaceSummary.description : "",
          projectIntelligence: project.intelligence ? project.intelligence.summary : "",
          attachments: project.pendingAttachments || []
        })
      }
    );
    const content =
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message &&
      typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : "";
    return parseSpecDraft(content, {
      threadId: thread.id,
      workflowId: workflowPreset.id,
      model,
      prompt
    });
  }

  async persistState() {
    await writeAppState({
      version: APP_STATE_VERSION,
      activeProjectId: this.activeProjectId,
      projects: this.projects
    });
  }

  postState() {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    const activeProject = this.getActiveProject();
    const activeThread = this.getActiveThread(activeProject);
    const activeRun = this.getActiveRun(activeProject);
    const activeSpec =
      (activeProject && this.getSpecById(activeProject, activeProject.activeSpecId)) ||
      (activeThread && this.getSpecById(activeProject, activeThread.specDraftId));
    const bridgeWorkspaceRoot =
      typeof this.bridgeState.activeWorkspaceRoot === "string"
        ? this.bridgeState.activeWorkspaceRoot
        : "";

    this.window.webContents.send("vswirks:state", {
      projects: this.projects.map((project) => ({
        id: project.id,
        name: project.name,
        workspaceRoot: project.workspaceRoot,
        targetPath: project.targetPath,
        updatedAt: project.updatedAt,
        currentRunStatus: project.currentRunStatus,
        threadCount: project.threads.length
      })),
      activeProjectId: this.activeProjectId,
      activeProject: activeProject
        ? {
            id: activeProject.id,
            name: activeProject.name,
            workspaceRoot: activeProject.workspaceRoot,
            targetPath: activeProject.targetPath,
            workspaceLabel: activeProject.workspaceRoot
              ? formatWorkspaceLabel(activeProject.workspaceRoot, activeProject.targetPath)
              : "No workspace",
            threads: activeProject.threads.map((thread) => ({
              id: thread.id,
              title: thread.title,
              updatedAt: thread.updatedAt,
              mode: thread.mode,
              executionMode: thread.executionMode,
              model: thread.modelOverride || thread.model,
              modelOverride: thread.modelOverride || thread.model || "",
              lastModelUsed: thread.lastModelUsed || "",
              agentProfileId: thread.agentProfileId || "",
              systemPromptOverride: thread.systemPromptOverride || "",
              draftPrompt: thread.draftPrompt || "",
              workflowPresetId: thread.workflowPresetId || "freeform",
              pausedAfterSpec: Boolean(thread.pausedAfterSpec),
              lastValidationResult: thread.lastValidationResult || "",
              messageCount: thread.messages.filter((item) => item.role !== "tool").length
            })),
            activeThreadId: activeProject.activeThreadId,
            defaultAgentProfileId:
              activeProject.defaultAgentProfileId || this.settings.defaultAgentProfileId,
            history: activeThread ? activeThread.messages : [],
            attachments: (activeProject.pendingAttachments || []).map((item) => ({
              id: item.id,
              label: item.label,
              kind: item.kind
            })),
            runs: activeProject.runs || [],
            activeRun,
            specs: activeProject.specs || [],
            activeSpec,
            workflowPresets: activeProject.workflowPresets || getDefaultWorkflowPresets(),
            selectedWorkflowId:
              activeThread && activeThread.workflowPresetId
                ? activeThread.workflowPresetId
                : "freeform",
            selectedAgentProfileId:
              activeThread && activeThread.agentProfileId
                ? activeThread.agentProfileId
                : activeProject.defaultAgentProfileId || this.settings.defaultAgentProfileId,
            selectedModel:
              activeThread && (activeThread.modelOverride || activeThread.model)
                ? activeThread.modelOverride || activeThread.model
                : AUTO_MODEL_VALUE,
            resolvedModel:
              activeThread && activeThread.lastModelUsed
                ? activeThread.lastModelUsed
                : resolveModelForTask(this.settings, {
                    prompt: "",
                    mode: activeThread && activeThread.mode ? activeThread.mode : "chat",
                    executionMode:
                      activeThread && activeThread.executionMode ? activeThread.executionMode : "plan",
                    purpose: "conversation"
                  }),
            intelligence: activeProject.intelligence || null
          }
        : null,
      bridge: {
        activeWorkspaceRoot: bridgeWorkspaceRoot,
        activeWorkspaceLabel: bridgeWorkspaceRoot ? path.basename(bridgeWorkspaceRoot) : "",
        activeFileLabel: this.bridgeState.activeFileLabel || "",
        selectionLabel: this.bridgeState.selectionLabel || "",
        targetLabel:
          typeof this.bridgeState.workspaceTarget === "string" && this.bridgeState.workspaceTarget
            ? path.basename(this.bridgeState.workspaceTarget)
            : "",
        selectedExplorerPath:
          typeof this.bridgeState.selectedExplorerPath === "string"
            ? this.bridgeState.selectedExplorerPath
            : "",
        activeSelection:
          this.bridgeState.activeSelection && typeof this.bridgeState.activeSelection === "object"
            ? this.bridgeState.activeSelection
            : null,
        connected:
          Number(this.bridgeState.updatedAt) > Date.now() - 120000 &&
          Boolean(this.bridgeState.editorName)
      },
      models: this.models,
      serviceLabel: this.serviceState.label,
      serviceHealthy: this.serviceState.healthy,
      serviceStarting: this.serviceState.starting,
      settings: {
        ...this.settings,
        agentProfiles: this.settings.agentProfiles || getDefaultAgentProfiles()
      },
      pending: Boolean(this.abortController),
      promptRefining: this.promptRefining,
      statusText: this.lastStatus,
      pendingApproval: this.pendingApproval
    });
  }

  emitEvent(payload) {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send("vswirks:event", payload);
  }

  async pickFolder(preselectedPath) {
    if (typeof preselectedPath === "string" && preselectedPath.trim()) {
      return preselectedPath.trim();
    }
    const picked = await dialog.showOpenDialog(this.window, {
      properties: ["openDirectory", "createDirectory"]
    });
    if (picked.canceled || !picked.filePaths.length) {
      return "";
    }
    return picked.filePaths[0];
  }
}

function buildPromptRefinerGenerationOptions(settings) {
  const options = getGenerationOptions("chat", settings);
  return {
    temperature: Math.min(0.35, Number(options.temperature) || 0.2),
    top_p: Math.min(0.95, Number(options.top_p) || 0.9),
    max_tokens: Math.min(1200, Number(options.max_tokens) || 1200)
  };
}

function buildSpecGenerationOptions(settings) {
  const options = getGenerationOptions("agent", settings);
  return {
    temperature: Math.min(0.2, Number(options.temperature) || 0.1),
    top_p: Math.min(0.9, Number(options.top_p) || 0.85),
    max_tokens: Math.min(2400, Number(options.max_tokens) || 2400)
  };
}

function createDefaultModelRoles(currentModel) {
  return {
    chat: DEFAULT_CHAT_MODEL,
    builder: currentModel || DEFAULT_MODEL,
    reviewer: currentModel || DEFAULT_MODEL,
    refiner: DEFAULT_CHAT_MODEL,
    editor: DEFAULT_CODER_MODEL
  };
}

function migrateLegacyRoutingModel(model) {
  return model === LEGACY_CODER_MODEL ? DEFAULT_MODEL : model;
}

function migrateLegacyEditorModel(model) {
  return model === LEGACY_CODER_MODEL ? DEFAULT_CODER_MODEL : model;
}

function normalizeModelRoles(storedRoles, currentModel) {
  const defaults = createDefaultModelRoles(migrateLegacyRoutingModel(currentModel));
  return {
    chat:
      storedRoles && typeof storedRoles.chat === "string" && storedRoles.chat.trim()
        ? storedRoles.chat.trim()
        : defaults.chat,
    builder:
      storedRoles && typeof storedRoles.builder === "string" && storedRoles.builder.trim()
        ? storedRoles.builder.trim()
        : defaults.builder,
    reviewer:
      storedRoles && typeof storedRoles.reviewer === "string" && storedRoles.reviewer.trim()
        ? storedRoles.reviewer.trim()
        : defaults.reviewer,
    refiner:
      storedRoles && typeof storedRoles.refiner === "string" && storedRoles.refiner.trim()
        ? storedRoles.refiner.trim()
        : defaults.refiner,
    editor:
      storedRoles && typeof storedRoles.editor === "string" && storedRoles.editor.trim()
        ? migrateLegacyEditorModel(storedRoles.editor.trim())
        : defaults.editor
  };
}

function resolveRequestedModel(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim();
  if (!normalized || normalized === AUTO_MODEL_VALUE) {
    return "";
  }
  return normalized;
}

function resolveModelForTask(settings, request) {
  const roles =
    settings && settings.modelRoles ? settings.modelRoles : createDefaultModelRoles(DEFAULT_MODEL);
  const role = resolveModelRole(request);
  return roles[role] || roles.chat || DEFAULT_CHAT_MODEL;
}

function resolveModelRole(request = {}) {
  if (
    typeof request.preferredRole === "string" &&
    ["chat", "builder", "reviewer", "refiner", "editor"].includes(request.preferredRole)
  ) {
    return request.preferredRole;
  }
  if (request.purpose === "refiner") {
    return "refiner";
  }
  if (request.purpose === "builder") {
    return "builder";
  }

  const text = String(request.prompt || "").toLowerCase();
  const executionMode = request.executionMode === "act" ? "act" : "plan";
  if (/(review|audit|regression|bug scan|code review|security review|risk review)/.test(text)) {
    return "reviewer";
  }
  if (request.mode === "agent" && executionMode === "act") {
    return "editor";
  }
  if (/(refactor|edit|fix|patch|rewrite|update|modify|cleanup|repair|test|debug)/.test(text)) {
    return "editor";
  }
  if (
    request.mode === "agent" ||
    /(build|create|scaffold|generate|develop|implement|bootstrap|start|ship)/.test(text)
  ) {
    return executionMode === "act" ? "editor" : "builder";
  }
  return "chat";
}

function normalizeAgentProfileId(value, profiles, fallbackValue = "") {
  const items = Array.isArray(profiles) ? profiles : getDefaultAgentProfiles();
  const requested = typeof value === "string" ? value.trim() : "";
  if (requested && items.some((profile) => profile.id === requested)) {
    return requested;
  }
  const fallback = typeof fallbackValue === "string" ? fallbackValue.trim() : "";
  if (fallback && items.some((profile) => profile.id === fallback)) {
    return fallback;
  }
  const firstEnabled = items.find((profile) => profile.enabled !== false);
  return firstEnabled ? firstEnabled.id : "";
}

function buildPromptRefinerMessages({
  prompt,
  mode,
  executionMode,
  project,
  workspaceSummary,
  attachmentSummary
}) {
  const lines = [
    "Rewrite the user's draft into a stronger engineering prompt for VSWirks App.",
    "",
    `Mode: ${mode}`,
    `Execution mode: ${executionMode}`,
    `Project root: ${project && project.workspaceRoot ? project.workspaceRoot : "none"}`,
    `Target folder: ${project && project.targetPath ? project.targetPath : "none"}`,
    `Workspace summary: ${workspaceSummary || "Unavailable"}`,
    attachmentSummary ? `Attachments:\n- ${attachmentSummary}` : "Attachments: none",
    "",
    "Requirements:",
    "- Preserve the user's intent and constraints.",
    "- Preserve the original product type and domain terms exactly when possible.",
    "- Keep the request local-first and avoid cloud services unless explicitly requested.",
    "- If the user asks for an app, keep it as an app. If the user names a specific domain tool, keep that exact tool concept.",
    "- If the user implies production quality or says no demo, convert that into a production-ready implementation brief.",
    "- If platform or runtime is unspecified, prefer a local macOS-first implementation suited to Apple Silicon and this workstation.",
    "- Make the request more specific about scope, architecture, deliverables, verification, and project structure when useful.",
    "- Keep it concise enough to fit naturally in the composer.",
    "- Return only the rewritten prompt as plain text.",
    "",
    "User draft:",
    prompt
  ];

  return [
    {
      role: "system",
      content:
        "You are a senior software engineer refining prompts for a local coding agent. " +
        "Turn vague requests into precise implementation briefs without changing the user's goals. " +
        "Preserve the original product type, domain nouns, and scope. " +
        "Do not add markdown fences, commentary, or labels. Output only the refined prompt."
    },
    {
      role: "user",
      content: lines.join("\n")
    }
  ];
}

function buildSpecMessages({
  prompt,
  workflowPreset,
  project,
  workspaceSummary,
  projectIntelligence,
  attachments
}) {
  return [
    {
      role: "system",
      content:
        "You are a senior engineer producing implementation specs for a local coding agent. " +
        'Return only JSON matching this schema: {"title":"","goal":"","audience":"","stack":[],"constraints":[],"deliverables":[],"acceptance_criteria":[],"validation_plan":[],"implementation_plan":[],"raw_markdown":""}.'
    },
    {
      role: "user",
      content: [
        `Workflow: ${workflowPreset.label}`,
        `Workflow description: ${workflowPreset.description || "none"}`,
        `Completion contract: ${workflowPreset.completionContract || "none"}`,
        `Project root: ${project.workspaceRoot || "none"}`,
        `Target folder: ${project.targetPath || "none"}`,
        `Workspace summary: ${workspaceSummary || "Unavailable"}`,
        `Project intelligence: ${projectIntelligence || "Unavailable"}`,
        attachments && attachments.length
          ? `Attachments:\n- ${attachments.map((item) => `${item.kind}: ${item.label}`).join("\n- ")}`
          : "Attachments: none",
        "",
        "Create a decision-complete engineering spec for the following request:",
        prompt
      ].join("\n")
    }
  ];
}

function sanitizeRefinedPrompt(text) {
  return String(text || "")
    .replace(/^\s*```[\w-]*\s*/u, "")
    .replace(/\s*```\s*$/u, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function shouldBuildSpecForRequest({ workflowPreset, mode, prompt, attachments }) {
  if (workflowPreset && workflowPreset.buildsSpec) {
    return true;
  }
  if (mode === "agent") {
    return true;
  }
  if (Array.isArray(attachments) && attachments.some((item) => item.kind === "image")) {
    return true;
  }
  return looksLikeRepoCreationRequest(prompt, true);
}

function inferWorkflowPresetId(prompt, attachments) {
  const text = String(prompt || "").toLowerCase();
  const hasImage = Array.isArray(attachments) && attachments.some((item) => item.kind === "image");
  if (hasImage) {
    return "ui-from-image";
  }
  if (/(review|audit|bug|risk|regression)/.test(text)) {
    return "review-repo";
  }
  if (/(fix build|broken|failing|compile|error|repair)/.test(text)) {
    return "fix-build";
  }
  if (/(test|coverage)/.test(text)) {
    return "add-tests";
  }
  if (/(refactor|cleanup|restructure)/.test(text)) {
    return "refactor-module";
  }
  if (/(create|build|scaffold|start|bootstrap|app|repository|repo|project)/.test(text)) {
    return "scaffold-app";
  }
  return "freeform";
}

function parseSpecDraft(content, metadata) {
  const candidates = [];
  const source = String(content || "").trim();
  if (source) {
    candidates.push(source);
  }
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    candidates.push(fenced[1].trim());
  }
  const jsonSlice = source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1).trim();
  if (jsonSlice.startsWith("{") && jsonSlice.endsWith("}")) {
    candidates.push(jsonSlice);
  }

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate, null);
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    const rawMarkdown =
      typeof parsed.raw_markdown === "string" && parsed.raw_markdown.trim()
        ? parsed.raw_markdown.trim()
        : buildSpecRawMarkdown(parsed, metadata.prompt);
    return createSpecDraft({
      threadId: metadata.threadId,
      workflowId: metadata.workflowId,
      title:
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim()
          : inferSpecTitle(metadata.prompt),
      goal: typeof parsed.goal === "string" ? parsed.goal : metadata.prompt,
      audience: typeof parsed.audience === "string" ? parsed.audience : "Local developer",
      stack: Array.isArray(parsed.stack) ? parsed.stack : [],
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
      deliverables: Array.isArray(parsed.deliverables) ? parsed.deliverables : [],
      acceptance_criteria: Array.isArray(parsed.acceptance_criteria)
        ? parsed.acceptance_criteria
        : [],
      validation_plan: Array.isArray(parsed.validation_plan) ? parsed.validation_plan : [],
      implementation_plan: Array.isArray(parsed.implementation_plan)
        ? parsed.implementation_plan
        : [],
      raw: rawMarkdown,
      generatedFrom: metadata.prompt,
      model: metadata.model
    });
  }

  return createSpecDraft({
    threadId: metadata.threadId,
    workflowId: metadata.workflowId,
    title: inferSpecTitle(metadata.prompt),
    goal: metadata.prompt,
    audience: "Local developer",
    raw: source || metadata.prompt,
    generatedFrom: metadata.prompt,
    model: metadata.model
  });
}

function buildSpecRawMarkdown(parsed, prompt) {
  const sections = [
    `# ${parsed.title || inferSpecTitle(prompt)}`,
    "",
    "## Goal",
    parsed.goal || prompt || "",
    "",
    "## Stack",
    ...(Array.isArray(parsed.stack) && parsed.stack.length
      ? parsed.stack.map((item) => `- ${item}`)
      : ["- Not specified"]),
    "",
    "## Constraints",
    ...(Array.isArray(parsed.constraints) && parsed.constraints.length
      ? parsed.constraints.map((item) => `- ${item}`)
      : ["- Keep the implementation local-first"]),
    "",
    "## Deliverables",
    ...(Array.isArray(parsed.deliverables) && parsed.deliverables.length
      ? parsed.deliverables.map((item) => `- ${item}`)
      : ["- Production-ready implementation"]),
    "",
    "## Acceptance Criteria",
    ...(Array.isArray(parsed.acceptance_criteria) && parsed.acceptance_criteria.length
      ? parsed.acceptance_criteria.map((item) => `- ${item}`)
      : ["- The resulting app or change works locally and is verifiable"]),
    "",
    "## Validation Plan",
    ...(Array.isArray(parsed.validation_plan) && parsed.validation_plan.length
      ? parsed.validation_plan.map((item) => `- ${item}`)
      : ["- Run the safest detected local validation commands"])
  ];
  return sections.join("\n");
}

function formatSpecDraftMarkdown(specDraft) {
  return specDraft.raw || `# ${specDraft.title}\n\n${specDraft.goal}`;
}

function inferSpecTitle(prompt) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "Implementation Spec";
  }
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function extractBackupPathFromEvent(event) {
  const detail = event && typeof event.detail === "string" ? event.detail : "";
  const match = detail.match(/Backup created:\s+(.+)$/m);
  return match && match[1] ? match[1].trim() : "";
}

async function createEmptyDiffBaseFile(label) {
  const safeLabel = String(label || "vswirks-diff").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const target = path.join(os.tmpdir(), `${safeLabel}.before`);
  await fs.writeFile(target, "", "utf8");
  return target;
}

async function spawnDetachedProcess(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, {
      cwd,
      env: process.env,
      detached: true,
      stdio: "ignore"
    });

    let settled = false;
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve();
      }
    }, 150);
  });
}

module.exports = {
  VSWirksController,
  createDefaultModelRoles,
  normalizeModelRoles,
  resolveModelForTask,
  resolveModelRole
};
