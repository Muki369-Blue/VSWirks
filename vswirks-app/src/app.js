(function () {
  const api = window.vswirks;
  const persisted = JSON.parse(localStorage.getItem("vswirks-ui") || "{}");
  const AUTO_MODEL_VALUE = "__auto__";
  const SpeechRecognitionConstructor =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;

  const QUICK_ACTIONS = [
    {
      id: "scaffold-app",
      label: "Scaffold App",
      workflowId: "scaffold-app",
      mode: "agent",
      executionMode: "act",
      prompt:
        "Create a production-ready local-first application in the selected target folder. Build it in staged phases for architecture, backend, middleware, frontend, and integration as needed. Implement the real core capability, choose concrete tooling, write executable source and tests, and do not ship demo or placeholder artifacts."
    },
    {
      id: "review-repo",
      label: "Review Repo",
      workflowId: "review-repo",
      mode: "chat",
      executionMode: "plan",
      prompt:
        "Review this repository and prioritize bugs, risky behavior, regressions, and missing tests."
    },
    {
      id: "fix-build",
      label: "Fix Build",
      workflowId: "fix-build",
      mode: "agent",
      executionMode: "plan",
      prompt:
        "Diagnose the current project, identify the build or runtime issue, and propose the safest fix path."
    },
    {
      id: "add-tests",
      label: "Add Tests",
      workflowId: "add-tests",
      mode: "agent",
      executionMode: "act",
      prompt:
        "Add or update focused tests around the most important behavior in this project."
    },
    {
      id: "refactor-module",
      label: "Refactor Module",
      workflowId: "refactor-module",
      mode: "agent",
      executionMode: "act",
      prompt:
        "Refactor the current area for clarity and maintainability while preserving behavior unless explicitly requested."
    },
    {
      id: "ui-from-image",
      label: "UI From Image",
      workflowId: "ui-from-image",
      mode: "agent",
      executionMode: "act",
      attach: "image",
      prompt:
        "Create a complete React project structure from the attached image, including Tailwind CSS styling, responsive layout, and production-ready source files."
    }
  ];

  const elements = {
    app: document.getElementById("app"),
    mode: document.getElementById("mode"),
    workflowPreset: document.getElementById("workflowPreset"),
    agentProfile: document.getElementById("agentProfile"),
    model: document.getElementById("model"),
    refreshModels: document.getElementById("refreshModels"),
    focusChat: document.getElementById("focusChat"),
    startService: document.getElementById("startService"),
    serviceStatus: document.getElementById("serviceStatus"),
    projectWorkspace: document.getElementById("projectWorkspace"),
    bridgeWorkspace: document.getElementById("bridgeWorkspace"),
    bridgeFile: document.getElementById("bridgeFile"),
    bridgeSelection: document.getElementById("bridgeSelection"),
    syncBridge: document.getElementById("syncBridge"),
    openProjectFolder: document.getElementById("openProjectFolder"),
    setProjectTarget: document.getElementById("setProjectTarget"),
    openProjectInEditor: document.getElementById("openProjectInEditor"),
    projectList: document.getElementById("projectList"),
    newChat: document.getElementById("newChat"),
    threadList: document.getElementById("threadList"),
    attachments: document.getElementById("attachments"),
    messages: document.getElementById("messages"),
    attachFile: document.getElementById("attachFile"),
    attachImage: document.getElementById("attachImage"),
    attachEditorSelection: document.getElementById("attachEditorSelection"),
    uploadSpec: document.getElementById("uploadSpec"),
    stop: document.getElementById("stop"),
    vibeHold: document.getElementById("vibeHold"),
    vibeClear: document.getElementById("vibeClear"),
    vibeBuildSpec: document.getElementById("vibeBuildSpec"),
    vibeConfirmAct: document.getElementById("vibeConfirmAct"),
    vibeStatusText: document.getElementById("vibeStatusText"),
    vibeTranscript: document.getElementById("vibeTranscript"),
    prompt: document.getElementById("prompt"),
    executionMode: document.getElementById("executionMode"),
    executionModeLabel: document.getElementById("executionModeLabel"),
    pauseAfterSpec: document.getElementById("pauseAfterSpec"),
    buildSpec: document.getElementById("buildSpec"),
    refinePrompt: document.getElementById("refinePrompt"),
    status: document.getElementById("status"),
    send: document.getElementById("send"),
    workflowSummary: document.getElementById("workflowSummary"),
    quickActions: document.getElementById("quickActions"),
    modelRoleChat: document.getElementById("modelRoleChat"),
    modelRoleBuilder: document.getElementById("modelRoleBuilder"),
    modelRoleReviewer: document.getElementById("modelRoleReviewer"),
    modelRoleRefiner: document.getElementById("modelRoleRefiner"),
    modelRoleEditor: document.getElementById("modelRoleEditor"),
    saveModelRoles: document.getElementById("saveModelRoles"),
    projectDefaultAgentProfile: document.getElementById("projectDefaultAgentProfile"),
    defaultAgentProfile: document.getElementById("defaultAgentProfile"),
    globalSystemPrompt: document.getElementById("globalSystemPrompt"),
    threadSystemPromptOverride: document.getElementById("threadSystemPromptOverride"),
    savePromptingSettings: document.getElementById("savePromptingSettings"),
    saveThreadPrompting: document.getElementById("saveThreadPrompting"),
    nextRunModel: document.getElementById("nextRunModel"),
    nextRunSystemPrompt: document.getElementById("nextRunSystemPrompt"),
    refreshPromptPreview: document.getElementById("refreshPromptPreview"),
    promptPreview: document.getElementById("promptPreview"),
    agentProfileEditor: document.getElementById("agentProfileEditor"),
    agentProfileLabel: document.getElementById("agentProfileLabel"),
    agentProfileDescription: document.getElementById("agentProfileDescription"),
    agentProfilePreferredRole: document.getElementById("agentProfilePreferredRole"),
    agentProfileDefaultMode: document.getElementById("agentProfileDefaultMode"),
    agentProfileDefaultExecutionMode: document.getElementById("agentProfileDefaultExecutionMode"),
    agentProfileLinkedWorkflow: document.getElementById("agentProfileLinkedWorkflow"),
    agentProfileModelOverride: document.getElementById("agentProfileModelOverride"),
    agentProfilePromptPrefix: document.getElementById("agentProfilePromptPrefix"),
    agentProfileSystemPrompt: document.getElementById("agentProfileSystemPrompt"),
    agentProfileEnabled: document.getElementById("agentProfileEnabled"),
    newAgentProfile: document.getElementById("newAgentProfile"),
    duplicateAgentProfile: document.getElementById("duplicateAgentProfile"),
    saveAgentProfile: document.getElementById("saveAgentProfile"),
    deleteAgentProfile: document.getElementById("deleteAgentProfile"),
    chatTemperature: document.getElementById("chatTemperature"),
    chatTopP: document.getElementById("chatTopP"),
    chatMaxTokens: document.getElementById("chatMaxTokens"),
    agentTemperature: document.getElementById("agentTemperature"),
    agentTopP: document.getElementById("agentTopP"),
    agentMaxTokens: document.getElementById("agentMaxTokens"),
    saveGenerationSettings: document.getElementById("saveGenerationSettings"),
    resetGenerationSettings: document.getElementById("resetGenerationSettings"),
    projectIntelligenceSummary: document.getElementById("projectIntelligenceSummary"),
    validationSummary: document.getElementById("validationSummary"),
    contextProjectRoot: document.getElementById("contextProjectRoot"),
    contextTargetPath: document.getElementById("contextTargetPath"),
    contextEditorFile: document.getElementById("contextEditorFile"),
    contextBridgePath: document.getElementById("contextBridgePath"),
    progressBar: document.getElementById("progressBar"),
    progressFill: document.getElementById("progressFill"),
    progressLabel: document.getElementById("progressLabel"),
    progressDetail: document.getElementById("progressDetail"),
    progressElapsed: document.getElementById("progressElapsed"),
    runSummary: document.getElementById("runSummary"),
    specPanel: document.getElementById("specPanel"),
    runPanel: document.getElementById("runPanel"),
    diffPanel: document.getElementById("diffPanel"),
    validationPanel: document.getElementById("validationPanel"),
    tabButtons: Array.from(document.querySelectorAll(".tab-button")),
    tabPanels: {
      spec: document.getElementById("panelSpec"),
      run: document.getElementById("panelRun"),
      diff: document.getElementById("panelDiff"),
      validation: document.getElementById("panelValidation"),
      workflow: document.getElementById("panelWorkflow"),
      intelligence: document.getElementById("panelIntelligence"),
      settings: document.getElementById("panelSettings"),
      context: document.getElementById("panelContext")
    }
  };

  let state = {
    projects: [],
    activeProjectId: "",
    activeProject: null,
    bridge: {},
    models: [],
    serviceHealthy: false,
    serviceStarting: false,
    serviceLabel: "Service offline",
    settings: {
      generationSettings: {
        chatTemperature: 0.2,
        chatTopP: 0.9,
        chatMaxTokens: 4096,
        agentTemperature: 0.1,
        agentTopP: 0.85,
        agentMaxTokens: 4096
      },
      modelRoles: {
        chat: "",
        builder: "",
        reviewer: "",
        refiner: "",
        editor: ""
      },
      globalSystemPrompt: "",
      agentProfiles: [],
      defaultAgentProfileId: ""
    },
    pending: false,
    promptRefining: false,
    statusText: "Ready",
    pendingApproval: null
  };

  const oneShotOverrides = {
    model: "",
    systemPrompt: ""
  };
  const profileEditor = {
    activeId: "",
    draft: null
  };
  let promptPreviewText = "Prompt preview will appear here.";
  let lastHydratedThreadId = "";
  let lastHydratedDraftPrompt = "";
  let draftSyncHandle = null;

  let drawerTab = persisted.drawerTab || "spec";
  const progress = {
    startedAt: 0,
    timer: null,
    lastLabel: "",
    history: []
  };

  const vibe = {
    supported: Boolean(SpeechRecognitionConstructor),
    listening: false,
    transcript: "",
    interim: "",
    error: "",
    recognition: null
  };

  if (persisted.mode) {
    elements.mode.value = persisted.mode;
  }
  if (persisted.executionMode === "act") {
    elements.executionMode.value = "1";
  }
  if (persisted.focusChat) {
    elements.app.classList.add("focus-chat");
  }

  api.onState((payload) => {
    const wasPending = state.pending;
    state = {
      ...state,
      ...payload
    };
    hydratePromptDraftFromState();
    // Track progress transitions
    if (state.pending && !wasPending) {
      startProgress();
    } else if (!state.pending && wasPending) {
      stopProgress();
    }
    if (state.pending && state.statusText && state.statusText !== progress.lastLabel) {
      updateProgress(state.statusText);
    }
    render();
  });

  api.onEvent((payload) => {
    if (payload && payload.type === "error") {
      state.statusText = payload.message;
      updateProgress(payload.message);
      renderStatus();
    }
  });

  function startProgress() {
    progress.startedAt = Date.now();
    progress.history = [];
    progress.lastLabel = "";
    updateProgress("Thinking...");
    if (progress.timer) clearInterval(progress.timer);
    progress.timer = setInterval(() => {
      renderProgressElapsed();
    }, 1000);
  }

  function stopProgress() {
    if (progress.timer) {
      clearInterval(progress.timer);
      progress.timer = null;
    }
    elements.progressBar.classList.add("hidden");
  }

  function updateProgress(label) {
    if (!label || label === progress.lastLabel) return;
    progress.lastLabel = label;
    progress.history.push({ label, at: Date.now() });
    elements.progressBar.classList.remove("hidden");
    elements.progressLabel.textContent = classifyStatus(label);
    elements.progressDetail.textContent = label;
    elements.progressDetail.title = label;
    renderProgressElapsed();
  }

  function renderProgressElapsed() {
    if (!progress.startedAt) return;
    const seconds = Math.floor((Date.now() - progress.startedAt) / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    elements.progressElapsed.textContent = m > 0
      ? `${m}m ${String(s).padStart(2, "0")}s`
      : `${s}s`;
  }

  function classifyStatus(text) {
    const t = (text || "").toLowerCase();
    if (/stream|generat|complet/i.test(t)) return "Generating";
    if (/scaffold|material/i.test(t)) return "Scaffolding";
    if (/spec|refin/i.test(t)) return "Spec";
    if (/valid|lint|test/i.test(t)) return "Validating";
    if (/writ|patch|apply/i.test(t)) return "Writing files";
    if (/retr|recov|repair/i.test(t)) return "Retrying";
    if (/paus/i.test(t)) return "Paused";
    if (/error|fail/i.test(t)) return "Error";
    if (/phase/i.test(t)) return "Phase";
    return "Working";
  }

  function render() {
    syncTopbarControls();
    renderTabs();
    renderModels();
    renderWorkflowPresets();
    renderAgentSelectors();
    renderProjects();
    renderThreads();
    renderBridge();
    renderAttachments();
    renderMessages();
    renderQuickActions();
    renderSettings();
    renderVibe();
    renderSpecPanel();
    renderRunPanel();
    renderDiffPanel();
    renderValidationPanel();
    renderStatus();
    renderProjectControls();
    applyPromptPlaceholder();
    rememberUi();
  }

  function syncTopbarControls() {
    const activeThread = getActiveThread();
    if (activeThread) {
      elements.mode.value = activeThread.mode || "chat";
      elements.executionMode.value = activeThread.executionMode === "act" ? "1" : "0";
      elements.pauseAfterSpec.checked = Boolean(activeThread.pausedAfterSpec);
    }
    renderExecutionMode();
  }

  function hydratePromptDraftFromState() {
    const activeThread = getActiveThread();
    if (!activeThread) {
      return;
    }
    const draftPrompt = typeof activeThread.draftPrompt === "string" ? activeThread.draftPrompt : "";
    if (
      activeThread.id !== lastHydratedThreadId ||
      (draftPrompt && draftPrompt !== lastHydratedDraftPrompt && !elements.prompt.value.trim())
    ) {
      elements.prompt.value = draftPrompt;
      lastHydratedThreadId = activeThread.id;
      lastHydratedDraftPrompt = draftPrompt;
    }
  }

  function renderTabs() {
    elements.tabButtons.forEach((button) => {
      const active = button.dataset.tab === drawerTab;
      button.classList.toggle("active", active);
      elements.tabPanels[button.dataset.tab].classList.toggle("active", active);
    });
  }

  function renderModels() {
    const current =
      state.activeProject && typeof state.activeProject.selectedModel === "string"
        ? state.activeProject.selectedModel || AUTO_MODEL_VALUE
        : elements.model.value || AUTO_MODEL_VALUE;
    elements.model.innerHTML = "";
    const autoOption = document.createElement("option");
    autoOption.value = AUTO_MODEL_VALUE;
    autoOption.textContent = "Auto (app-owned model routing)";
    elements.model.appendChild(autoOption);
    const models = [...new Set(state.models || [])];
    if (!models.length && state.settings.defaultModel) {
      models.push(state.settings.defaultModel);
    }
    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      elements.model.appendChild(option);
    });
    elements.model.value =
      current === AUTO_MODEL_VALUE || models.includes(current) ? current : AUTO_MODEL_VALUE;
  }

  function renderWorkflowPresets() {
    const presets = state.activeProject ? state.activeProject.workflowPresets || [] : [];
    elements.workflowPreset.innerHTML = "";
    presets.forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      elements.workflowPreset.appendChild(option);
    });
    const selectedWorkflowId =
      state.activeProject && state.activeProject.selectedWorkflowId
        ? state.activeProject.selectedWorkflowId
        : "freeform";
    elements.workflowPreset.value = presets.some((item) => item.id === selectedWorkflowId)
      ? selectedWorkflowId
      : presets[0]
        ? presets[0].id
        : "freeform";

    const selectedPreset = presets.find((item) => item.id === elements.workflowPreset.value);
    elements.workflowSummary.innerHTML = selectedPreset
      ? [
          `<strong>${selectedPreset.label}</strong>`,
          `<div class="meta">${selectedPreset.description || "No workflow description."}</div>`,
          `<div class="meta">Default: ${selectedPreset.defaultMode} · ${selectedPreset.defaultExecutionMode}</div>`,
          `<div class="meta">Completion: ${selectedPreset.completionContract || "none"}</div>`
        ].join("")
      : '<div class="meta">No workflow presets loaded.</div>';
  }

  function renderAgentSelectors() {
    const profiles = normalizeAgentProfiles(state.settings.agentProfiles);
    const projectDefault =
      state.activeProject && state.activeProject.defaultAgentProfileId
        ? state.activeProject.defaultAgentProfileId
        : state.settings.defaultAgentProfileId || "";
    const thread = getActiveThread();
    const threadAgentProfileId =
      thread && thread.agentProfileId ? thread.agentProfileId : projectDefault;

    renderAgentSelect(elements.agentProfile, threadAgentProfileId, profiles, true);
    renderAgentSelect(elements.projectDefaultAgentProfile, projectDefault, profiles, false);
    renderAgentSelect(
      elements.defaultAgentProfile,
      state.settings.defaultAgentProfileId || projectDefault,
      profiles,
      false
    );
    renderAgentSelect(elements.agentProfileEditor, profileEditor.activeId || threadAgentProfileId, profiles, false);

    elements.threadSystemPromptOverride.value =
      thread && typeof thread.systemPromptOverride === "string" ? thread.systemPromptOverride : "";
    elements.globalSystemPrompt.value = state.settings.globalSystemPrompt || "";

    if (!profileEditor.draft || !profiles.some((profile) => profile.id === profileEditor.activeId)) {
      profileEditor.activeId =
        elements.agentProfileEditor.value || threadAgentProfileId || (profiles[0] && profiles[0].id) || "";
      profileEditor.draft = cloneAgentProfile(findAgentProfile(profileEditor.activeId, profiles));
    }
    renderModelSelect(elements.nextRunModel, oneShotOverrides.model, true);
    renderModelSelect(
      elements.agentProfileModelOverride,
      profileEditor.draft ? profileEditor.draft.modelOverride || "" : "",
      true
    );
    renderWorkflowSelect(
      elements.agentProfileLinkedWorkflow,
      profileEditor.draft ? profileEditor.draft.linkedWorkflowPresetId || "" : ""
    );
    syncAgentProfileDraftToForm();
    elements.nextRunSystemPrompt.value = oneShotOverrides.systemPrompt;
    elements.promptPreview.textContent = promptPreviewText;
  }

  function renderProjects() {
    elements.projectList.innerHTML = "";
    (state.projects || []).forEach((project) => {
      const button = document.createElement("button");
      button.className = `project-chip${project.id === state.activeProjectId ? " active" : ""}`;
      button.type = "button";
      button.disabled = state.pending;
      button.addEventListener("click", () => {
        void api.invoke("vswirks:switchProject", { id: project.id });
      });

      const title = document.createElement("strong");
      title.textContent = project.name;
      button.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "project-paths";
      meta.appendChild(
        createProjectPathRow("Project Root", project.workspaceRoot || "No project root selected")
      );
      meta.appendChild(
        createProjectPathRow(
          "Target Folder",
          describeTargetPath(project.workspaceRoot, project.targetPath)
        )
      );
      button.appendChild(meta);

      const status = document.createElement("div");
      status.className = "meta";
      status.textContent = `${project.id === state.activeProjectId ? "active project" : "click to activate"} | ${project.threadCount} chats | ${project.currentRunStatus || "idle"}`;
      button.appendChild(status);

      elements.projectList.appendChild(button);
    });
  }

  function renderThreads() {
    elements.threadList.innerHTML = "";
    const threads = state.activeProject ? state.activeProject.threads || [] : [];
    threads.forEach((thread) => {
      const button = document.createElement("button");
      button.className = `thread-chip${thread.id === state.activeProject.activeThreadId ? " active" : ""}`;
      button.type = "button";
      button.disabled = state.pending;
      button.addEventListener("click", () => {
        void api.invoke("vswirks:switchThread", { id: thread.id });
      });

      const title = document.createElement("strong");
      title.textContent = thread.title;
      button.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "thread-meta";
      meta.textContent = [
        thread.mode,
        thread.executionMode,
        thread.agentProfileId || "project agent",
        thread.workflowPresetId || "freeform",
        formatRelativeTime(thread.updatedAt)
      ].join(" · ");
      button.appendChild(meta);

      if (thread.lastValidationResult) {
        const validation = document.createElement("div");
        validation.className = "meta";
        validation.textContent = `validation: ${thread.lastValidationResult}`;
        button.appendChild(validation);
      }

      elements.threadList.appendChild(button);
    });
  }

  function renderBridge() {
    elements.projectWorkspace.textContent = state.activeProject
      ? state.activeProject.workspaceLabel || "No workspace"
      : "No project";

    const connected = state.bridge && state.bridge.connected;
    elements.bridgeWorkspace.textContent = connected
      ? `Editor: ${state.bridge.activeWorkspaceLabel || "connected"}`
      : "Editor not connected";

    togglePill(
      elements.bridgeFile,
      Boolean(state.bridge && state.bridge.activeFileLabel),
      state.bridge.activeFileLabel || ""
    );
    togglePill(
      elements.bridgeSelection,
      Boolean(state.bridge && state.bridge.selectionLabel),
      state.bridge.selectionLabel || ""
    );

    elements.contextProjectRoot.textContent =
      state.activeProject && state.activeProject.workspaceRoot
        ? state.activeProject.workspaceRoot
        : "None";
    elements.contextTargetPath.textContent =
      state.activeProject && state.activeProject.targetPath
        ? state.activeProject.targetPath
        : "None";
    elements.contextEditorFile.textContent =
      state.bridge && state.bridge.activeFileLabel ? state.bridge.activeFileLabel : "None";
    elements.contextBridgePath.textContent = "VSWirks bridge store";
  }

  function togglePill(element, visible, text) {
    element.classList.toggle("hidden", !visible);
    element.textContent = text;
  }

  function renderAttachments() {
    const attachments = state.activeProject ? state.activeProject.attachments || [] : [];
    elements.attachments.innerHTML = "";
    elements.attachments.classList.toggle("hidden", attachments.length === 0);
    attachments.forEach((item) => {
      const button = document.createElement("button");
      button.className = "attachment-chip";
      button.type = "button";
      button.textContent = `${item.kind}: ${item.label}`;
      button.addEventListener("click", () => {
        void api.invoke("vswirks:removeAttachment", { id: item.id });
      });
      elements.attachments.appendChild(button);
    });
  }

  function renderMessages() {
    elements.messages.innerHTML = "";
    const history = state.activeProject ? state.activeProject.history || [] : [];

    if (!history.length) {
      const empty = document.createElement("div");
      empty.className = "message-card assistant";
      empty.innerHTML =
        "<strong>Run local agent work without leaving the editor loop.</strong><p>Use Plan to shape a spec, then switch to Act when you want VSWirks App to propose patches, write files, validate results, and sync back into VSWirks Editor.</p>";
      elements.messages.appendChild(empty);
      return;
    }

    history.forEach((item) => {
      const node = item.role === "tool" ? renderToolCard(item) : renderConversationCard(item);
      elements.messages.appendChild(node);
    });
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function renderConversationCard(item) {
    const card = document.createElement("article");
    card.className = `message-card ${item.role}`;

    const header = document.createElement("header");
    header.className = "message-header";

    const title = document.createElement("strong");
    title.textContent = item.role === "assistant" ? "VSWirks" : "You";
    header.appendChild(title);

    const badges = document.createElement("div");
    badges.className = "message-badges";
    if (item.model) {
      badges.appendChild(createBadge(item.model));
    }
    if (item.mode) {
      badges.appendChild(createBadge(item.mode));
    }
    if (item.executionMode) {
      badges.appendChild(createBadge(item.executionMode));
    }
    if (item.status) {
      badges.appendChild(createBadge(item.status));
    }
    header.appendChild(badges);

    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.appendChild(createTextButton("Copy", () => navigator.clipboard.writeText(item.content || "")));
    if (item.role === "assistant") {
      actions.appendChild(
        createTextButton("Use As Spec", () =>
          api.invoke("vswirks:useMessageAsSpec", { messageId: item.id })
        )
      );
      const activeRun = getActiveRun();
      if (activeRun) {
        actions.appendChild(
          createTextButton("Replay From Here", () =>
            api.invoke("vswirks:replayRun", { runId: activeRun.id })
          )
        );
        if (activeRun.changedFiles && activeRun.changedFiles.length) {
          actions.appendChild(
            createTextButton("Review Generated Files", () =>
              api.invoke("vswirks:reviewGeneratedFiles", { runId: activeRun.id })
            )
          );
          actions.appendChild(
            createTextButton("Reveal In Editor", () =>
              api.invoke("vswirks:revealRunFiles", { runId: activeRun.id })
            )
          );
        }
      }
    }
    header.appendChild(actions);

    card.appendChild(header);
    const body = document.createElement("div");
    body.className = "message-body";
    renderRichContent(body, item.content || "");
    card.appendChild(body);

    if (item.attachments && item.attachments.length) {
      const footnote = document.createElement("div");
      footnote.className = "meta";
      footnote.textContent = item.attachments.map((entry) => entry.label).join(" | ");
      card.appendChild(footnote);
    }
    if (item.usage) {
      const footnote = document.createElement("div");
      footnote.className = "meta";
      footnote.textContent =
        `tokens ${item.usage.total_tokens || "?"} | prompt ${item.usage.prompt_tokens || "?"} | completion ${item.usage.completion_tokens || "?"}`;
      card.appendChild(footnote);
    }

    return card;
  }

  function renderToolCard(item) {
    const card = document.createElement("article");
    card.className = `tool-card${item.error ? " error" : ""}`;
    const header = document.createElement("div");
    header.className = "tool-header";
    const left = document.createElement("div");
    left.innerHTML = `<strong>${item.toolName || "tool"}</strong><div class="meta">${item.summary || ""}</div>`;
    header.appendChild(left);
    if (item.path) {
      header.appendChild(
        createTextButton("Open", () => {
          void api.invoke("vswirks:openFile", { path: item.path });
        })
      );
    }
    card.appendChild(header);
    if (item.content) {
      const detail = document.createElement("pre");
      detail.className = "tool-detail";
      detail.textContent = item.content;
      card.appendChild(detail);
    }
    return card;
  }

  function renderQuickActions() {
    elements.quickActions.innerHTML = "";
    QUICK_ACTIONS.forEach((action) => {
      const button = document.createElement("button");
      button.className = "quick-action";
      button.type = "button";
      button.textContent = action.label;
      button.disabled = state.pending;
      button.addEventListener("click", async () => {
        if (action.attach === "image") {
          await api.invoke("vswirks:attachImage");
        }
        elements.mode.value = action.mode;
        elements.executionMode.value = action.executionMode === "act" ? "1" : "0";
        elements.workflowPreset.value = action.workflowId;
        await syncThreadSettings();
        elements.prompt.value = action.prompt;
        renderExecutionMode();
        applyPromptPlaceholder();
        rememberUi();
        elements.prompt.focus();
      });
      elements.quickActions.appendChild(button);
    });
  }

  function renderSettings() {
    const values = state.settings && state.settings.generationSettings
      ? state.settings.generationSettings
      : {
          chatTemperature: 0.2,
          chatTopP: 0.9,
          chatMaxTokens: 4096,
          agentTemperature: 0.1,
          agentTopP: 0.85,
          agentMaxTokens: 4096
        };
    elements.chatTemperature.value = values.chatTemperature;
    elements.chatTopP.value = values.chatTopP;
    elements.chatMaxTokens.value = values.chatMaxTokens;
    elements.agentTemperature.value = values.agentTemperature;
    elements.agentTopP.value = values.agentTopP;
    elements.agentMaxTokens.value = values.agentMaxTokens;

    renderRoleSelect(elements.modelRoleChat, state.settings.modelRoles.chat);
    renderRoleSelect(elements.modelRoleBuilder, state.settings.modelRoles.builder);
    renderRoleSelect(elements.modelRoleReviewer, state.settings.modelRoles.reviewer);
    renderRoleSelect(elements.modelRoleRefiner, state.settings.modelRoles.refiner);
    renderRoleSelect(elements.modelRoleEditor, state.settings.modelRoles.editor);

    elements.projectIntelligenceSummary.innerHTML = state.activeProject && state.activeProject.intelligence
      ? `<pre class="info-pre">${escapeHtml(state.activeProject.intelligence.summary || "No intelligence data yet.")}</pre>`
      : '<div class="meta">No project intelligence generated yet.</div>';

    const activeRun = getActiveRun();
    elements.validationSummary.innerHTML =
      activeRun && activeRun.validation
        ? `<strong>${activeRun.validation.summary || "Validation not run yet."}</strong>`
        : '<div class="meta">No validation results yet.</div>';
  }

  function renderRoleSelect(element, selectedValue) {
    const models = [...new Set(state.models || [])];
    const current = selectedValue || (models[0] || "");
    element.innerHTML = "";
    const options = Array.from(new Set([current, ...models].filter(Boolean)));
    options.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      element.appendChild(option);
    });
    element.value = current;
  }

  function renderModelSelect(element, selectedValue, allowAuto = false) {
    if (!element) {
      return;
    }
    const models = [...new Set(state.models || [])];
    const current = selectedValue || (allowAuto ? "" : models[0] || "");
    element.innerHTML = "";
    if (allowAuto) {
      const autoOption = document.createElement("option");
      autoOption.value = "";
      autoOption.textContent = "Auto";
      element.appendChild(autoOption);
    }
    Array.from(new Set([current, ...models].filter(Boolean))).forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      element.appendChild(option);
    });
    element.value = current;
  }

  function renderWorkflowSelect(element, selectedValue) {
    if (!element) {
      return;
    }
    const presets = state.activeProject ? state.activeProject.workflowPresets || [] : [];
    element.innerHTML = "";
    const autoOption = document.createElement("option");
    autoOption.value = "";
    autoOption.textContent = "None";
    element.appendChild(autoOption);
    presets.forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      element.appendChild(option);
    });
    element.value = selectedValue || "";
  }

  function renderAgentSelect(element, selectedValue, profiles, allowAuto) {
    if (!element) {
      return;
    }
    element.innerHTML = "";
    if (allowAuto) {
      const autoOption = document.createElement("option");
      autoOption.value = "";
      autoOption.textContent = "Project Default Agent";
      element.appendChild(autoOption);
    }
    profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.enabled === false ? `${profile.label} (disabled)` : profile.label;
      element.appendChild(option);
    });
    const fallback = allowAuto ? "" : profiles[0] ? profiles[0].id : "";
    element.value =
      selectedValue && profiles.some((profile) => profile.id === selectedValue)
        ? selectedValue
        : fallback;
  }

  function normalizeAgentProfiles(profiles) {
    return Array.isArray(profiles) && profiles.length
      ? profiles
      : [
          {
            id: "app-default",
            label: "App Default",
            description: "",
            preferredRole: "",
            modelOverride: "",
            systemPrompt: "",
            defaultMode: "chat",
            defaultExecutionMode: "plan",
            linkedWorkflowPresetId: "",
            promptPrefix: "",
            enabled: true
          }
        ];
  }

  function findAgentProfile(agentProfileId, profiles = normalizeAgentProfiles(state.settings.agentProfiles)) {
    return profiles.find((profile) => profile.id === agentProfileId) || profiles[0] || null;
  }

  function cloneAgentProfile(profile) {
    if (!profile) {
      return {
        id: `custom-${Date.now()}`,
        label: "",
        description: "",
        preferredRole: "",
        modelOverride: "",
        systemPrompt: "",
        defaultMode: "chat",
        defaultExecutionMode: "plan",
        linkedWorkflowPresetId: "",
        promptPrefix: "",
        enabled: true
      };
    }
    return {
      ...profile
    };
  }

  function syncAgentProfileDraftToForm() {
    if (!profileEditor.draft) {
      return;
    }
    elements.agentProfileLabel.value = profileEditor.draft.label || "";
    elements.agentProfileDescription.value = profileEditor.draft.description || "";
    elements.agentProfilePreferredRole.value = profileEditor.draft.preferredRole || "";
    elements.agentProfileDefaultMode.value = profileEditor.draft.defaultMode || "chat";
    elements.agentProfileDefaultExecutionMode.value =
      profileEditor.draft.defaultExecutionMode || "plan";
    elements.agentProfileLinkedWorkflow.value = profileEditor.draft.linkedWorkflowPresetId || "";
    elements.agentProfileModelOverride.value = profileEditor.draft.modelOverride || "";
    elements.agentProfilePromptPrefix.value = profileEditor.draft.promptPrefix || "";
    elements.agentProfileSystemPrompt.value = profileEditor.draft.systemPrompt || "";
    elements.agentProfileEnabled.checked = profileEditor.draft.enabled !== false;
  }

  function renderSpecPanel() {
    const activeSpec = state.activeProject ? state.activeProject.activeSpec : null;
    if (!activeSpec) {
      elements.specPanel.innerHTML =
        '<div class="meta">No active spec yet. Use <strong>Build Spec</strong> or run a workflow that generates one automatically.</div>';
      return;
    }
    elements.specPanel.innerHTML = "";
    const header = document.createElement("div");
    header.className = "drawer-header-row";
    header.innerHTML = `<strong>${activeSpec.title}</strong><span class="meta">${formatRelativeTime(activeSpec.updatedAt)}</span>`;
    elements.specPanel.appendChild(header);
    const actions = document.createElement("div");
    actions.className = "inline-actions";
    actions.appendChild(
      createTextButton("Run From Spec", () => {
        void confirmSpecToAct();
      })
    );
    actions.appendChild(
      createTextButton("Copy Spec", () =>
        navigator.clipboard.writeText(activeSpec.raw || activeSpec.goal || "")
      )
    );
    elements.specPanel.appendChild(actions);
    const body = document.createElement("div");
    body.className = "drawer-rich";
    renderRichContent(body, activeSpec.raw || activeSpec.goal || "");
    elements.specPanel.appendChild(body);
  }

  function renderVibe() {
    const activeSpec = getActiveSpec();
    const voiceLines = [];
    if (vibe.transcript) {
      voiceLines.push(vibe.transcript);
    }
    if (vibe.interim) {
      voiceLines.push(`[listening] ${vibe.interim}`);
    }

    if (!vibe.supported) {
      elements.vibeStatusText.textContent =
        "Local speech recognition is unavailable in this Electron build.";
    } else if (vibe.error) {
      elements.vibeStatusText.textContent = vibe.error;
    } else if (vibe.listening) {
      elements.vibeStatusText.textContent = "Listening. Release the button to stop capture.";
    } else if (activeSpec) {
      elements.vibeStatusText.textContent =
        "Spec ready. Review it, then confirm it into Act when you want workspace edits.";
    } else {
      elements.vibeStatusText.textContent =
        "Hold to talk, generate a spec, then confirm it into Act.";
    }

    elements.vibeHold.textContent = vibe.listening ? "Release To Stop" : "Hold To Talk";
    elements.vibeTranscript.classList.toggle("hidden", voiceLines.length === 0);
    elements.vibeTranscript.textContent = voiceLines.join("\n");
  }

  function renderRunPanel() {
    const activeRun = getActiveRun();
    if (!activeRun) {
      elements.runPanel.innerHTML = '<div class="meta">No active or recent run.</div>';
      return;
    }
    elements.runPanel.innerHTML = "";
    const header = document.createElement("div");
    header.className = "drawer-header-row";
    header.innerHTML = `<strong>${activeRun.summary || activeRun.workflowId || "Run"}</strong><span class="meta">${activeRun.status}</span>`;
    elements.runPanel.appendChild(header);

    const actionRow = document.createElement("div");
    actionRow.className = "inline-actions";
    if (["paused_recoverable", "paused_after_spec"].includes(activeRun.status)) {
      actionRow.appendChild(
        createTextButton("Resume", () => api.invoke("vswirks:resumeRun", { runId: activeRun.id }))
      );
    }
    actionRow.appendChild(
      createTextButton("Replay", () => api.invoke("vswirks:replayRun", { runId: activeRun.id }))
    );
    if (activeRun.changedFiles && activeRun.changedFiles.length) {
      actionRow.appendChild(
        createTextButton("Reveal Files", () =>
          api.invoke("vswirks:revealRunFiles", { runId: activeRun.id })
        )
      );
    }
    elements.runPanel.appendChild(actionRow);

    const timeline = document.createElement("div");
    timeline.className = "timeline";
    const events = [...(activeRun.events || [])].reverse();
    if (!events.length) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.textContent = "Run events will appear here.";
      timeline.appendChild(empty);
    }
    events.forEach((event) => {
      const node = document.createElement("div");
      node.className = `timeline-item ${event.type || "info"}`;
      const top = document.createElement("div");
      top.className = "timeline-top";
      top.innerHTML = `<strong>${event.label}</strong><span class="meta">${formatRelativeTime(event.createdAt)}</span>`;
      node.appendChild(top);
      if (event.detail) {
        const detail = document.createElement("div");
        detail.className = "meta";
        detail.textContent = event.detail;
        node.appendChild(detail);
      }
      if (event.path) {
        const actions = document.createElement("div");
        actions.className = "inline-actions";
        actions.appendChild(
          createTextButton("Open", () => api.invoke("vswirks:openFile", { path: event.path }))
        );
        actions.appendChild(
          createTextButton("Reveal", () =>
            api.invoke("vswirks:revealRunFiles", { runId: activeRun.id })
          )
        );
        node.appendChild(actions);
      }
      timeline.appendChild(node);
    });
    elements.runPanel.appendChild(timeline);

    if (activeRun.checkpoints && activeRun.checkpoints.length) {
      const checkpoints = document.createElement("div");
      checkpoints.className = "checkpoint-list";
      checkpoints.innerHTML = "<strong>Checkpoints</strong>";
      activeRun.checkpoints.forEach((checkpoint) => {
        const item = document.createElement("div");
        item.className = "checkpoint-item";
        item.innerHTML = `<span>${checkpoint.label}</span><span class="meta">${formatRelativeTime(checkpoint.createdAt)}</span>`;
        item.appendChild(
          createTextButton("Fork", () =>
            api.invoke("vswirks:forkRunCheckpoint", {
              runId: activeRun.id,
              checkpointId: checkpoint.id
            })
          )
        );
        checkpoints.appendChild(item);
      });
      elements.runPanel.appendChild(checkpoints);
    }
  }

  function renderDiffPanel() {
    elements.diffPanel.innerHTML = "";
    const activeRun = getActiveRun();
    if (state.pendingApproval) {
      elements.runSummary.textContent = `Awaiting approval for ${state.pendingApproval.relativePath}`;
      const card = document.createElement("div");
      card.className = "approval-card";
      card.innerHTML = `<strong>Pending proposal</strong><div class="meta">${state.pendingApproval.relativePath}</div>`;
      if (state.pendingApproval.rationale) {
        const rationale = document.createElement("div");
        rationale.className = "meta";
        rationale.textContent = state.pendingApproval.rationale;
        card.appendChild(rationale);
      }
      if (state.pendingApproval.diff) {
        const diff = document.createElement("pre");
        diff.className = "tool-detail diff-preview";
        diff.textContent = state.pendingApproval.diff;
        card.appendChild(diff);
      }
      const actions = document.createElement("div");
      actions.className = "approval-actions";
      [
        ["Approve Once", "once"],
        ["Approve Chat", "chat"],
        ["Approve Run", "run"],
        ["Deny", "deny"]
      ].forEach(([label, decision]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = decision === "deny" ? "danger" : "";
        button.textContent = label;
        button.addEventListener("click", () => {
          void api.invoke("vswirks:approveWrite", {
            id: state.pendingApproval.id,
            decision
          });
        });
        actions.appendChild(button);
      });
      card.appendChild(actions);
      elements.diffPanel.appendChild(card);
    } else {
      elements.runSummary.textContent = activeRun ? activeRun.summary || activeRun.status : "No active runs";
    }

    const diffEvents = activeRun ? [...(activeRun.events || [])].filter((event) => event.diff) : [];
    if (!diffEvents.length && !state.pendingApproval) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.textContent = "Patch proposals and write diffs will appear here.";
      elements.diffPanel.appendChild(empty);
      return;
    }

    diffEvents.slice(0, 8).forEach((event) => {
      const card = document.createElement("div");
      card.className = "diff-card";
      card.innerHTML = `<strong>${event.label}</strong><div class="meta">${event.path || ""}</div>`;
      const diff = document.createElement("pre");
      diff.className = "tool-detail diff-preview";
      diff.textContent = event.diff;
      card.appendChild(diff);
      const actions = document.createElement("div");
      actions.className = "inline-actions";
      if (event.path) {
        actions.appendChild(
          createTextButton("Open", () => api.invoke("vswirks:openFile", { path: event.path }))
        );
      }
      actions.appendChild(
        createTextButton("Reveal", () =>
          api.invoke("vswirks:revealRunFiles", { runId: activeRun.id })
        )
      );
      card.appendChild(actions);
      elements.diffPanel.appendChild(card);
    });
  }

  function renderValidationPanel() {
    elements.validationPanel.innerHTML = "";
    const activeRun = getActiveRun();
    if (!activeRun || !activeRun.validation) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.textContent = "Validation results will appear here after Act runs.";
      elements.validationPanel.appendChild(empty);
      return;
    }

    const header = document.createElement("div");
    header.className = "drawer-header-row";
    header.innerHTML = `<strong>${activeRun.validation.summary || "Validation pending"}</strong><span class="meta">${activeRun.validation.status}</span>`;
    elements.validationPanel.appendChild(header);

    if (!(activeRun.validation.steps || []).length) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.textContent = "No validation steps recorded.";
      elements.validationPanel.appendChild(empty);
      return;
    }

    activeRun.validation.steps.forEach((step) => {
      const card = document.createElement("div");
      card.className = `validation-card ${step.status}`;
      card.innerHTML = `<strong>${step.label}</strong><div class="meta">${step.command || ""}</div>`;
      if (step.output) {
        const detail = document.createElement("pre");
        detail.className = "tool-detail";
        detail.textContent = step.output;
        card.appendChild(detail);
      }
      elements.validationPanel.appendChild(card);
    });
  }

  function renderStatus() {
    const hasPrompt = Boolean(elements.prompt.value.trim());
    const hasVoiceDraft = Boolean(vibe.transcript || vibe.interim);
    const activeSpec = getActiveSpec();
    elements.status.textContent = state.statusText || "Ready";
    // Keep progress bar in sync
    if (state.pending) {
      elements.progressBar.classList.remove("hidden");
    } else {
      elements.progressBar.classList.add("hidden");
    }
    elements.send.disabled = state.pending || state.promptRefining || !hasPrompt;
    elements.refinePrompt.disabled = state.pending || state.promptRefining || !hasPrompt;
    elements.buildSpec.disabled = state.pending || !hasPrompt;
    elements.vibeHold.disabled = state.pending || !vibe.supported;
    elements.vibeClear.disabled = state.pending || (!hasPrompt && !hasVoiceDraft);
    elements.vibeBuildSpec.disabled = state.pending || !hasPrompt;
    elements.vibeConfirmAct.disabled = state.pending || !activeSpec;
    elements.refinePrompt.textContent = state.promptRefining ? "Refining..." : "Refine Prompt";
    elements.stop.classList.toggle("hidden", !state.pending);
    elements.agentProfile.disabled = state.pending;
    elements.projectDefaultAgentProfile.disabled = state.pending;
    elements.defaultAgentProfile.disabled = state.pending;
    elements.globalSystemPrompt.disabled = state.pending;
    elements.threadSystemPromptOverride.disabled = state.pending;
    elements.nextRunModel.disabled = state.pending;
    elements.nextRunSystemPrompt.disabled = state.pending;
    elements.refreshPromptPreview.disabled = state.pending;
    elements.savePromptingSettings.disabled = state.pending;
    elements.saveThreadPrompting.disabled = state.pending;
    elements.agentProfileEditor.disabled = state.pending;
    elements.agentProfileLabel.disabled = state.pending;
    elements.agentProfileDescription.disabled = state.pending;
    elements.agentProfilePreferredRole.disabled = state.pending;
    elements.agentProfileDefaultMode.disabled = state.pending;
    elements.agentProfileDefaultExecutionMode.disabled = state.pending;
    elements.agentProfileLinkedWorkflow.disabled = state.pending;
    elements.agentProfileModelOverride.disabled = state.pending;
    elements.agentProfilePromptPrefix.disabled = state.pending;
    elements.agentProfileSystemPrompt.disabled = state.pending;
    elements.agentProfileEnabled.disabled = state.pending;
    elements.newAgentProfile.disabled = state.pending;
    elements.duplicateAgentProfile.disabled = state.pending;
    elements.saveAgentProfile.disabled = state.pending;
    elements.deleteAgentProfile.disabled = state.pending;
    elements.startService.disabled = state.pending || state.serviceStarting || state.serviceHealthy;
    elements.startService.textContent = state.serviceHealthy
      ? "Running"
      : state.serviceStarting
        ? "Starting..."
        : "Start Service";
    elements.serviceStatus.textContent = state.serviceLabel || "Service offline";
    elements.serviceStatus.className = `pill service ${
      state.serviceHealthy ? "online" : state.serviceStarting ? "starting" : "offline"
    }`;
  }

  function renderProjectControls() {
    const hasWorkspace = Boolean(state.activeProject && state.activeProject.workspaceRoot);
    elements.setProjectTarget.disabled = state.pending || !hasWorkspace;
    elements.openProjectInEditor.disabled = state.pending || !hasWorkspace;
  }

  function renderExecutionMode() {
    elements.executionModeLabel.textContent =
      elements.executionMode.value === "1"
        ? elements.mode.value === "agent"
          ? "Take action in the workspace"
          : "Chat stays read-only until you switch to Agent"
        : "Plan only, no writes";
  }

  function applyPromptPlaceholder() {
    const acting = elements.executionMode.value === "1";
    elements.prompt.placeholder =
      elements.mode.value === "agent"
        ? acting
          ? "Describe the task. Act mode will generate a spec, propose patches, write files, and validate the result."
          : "Describe the task. Plan mode will inspect the workspace and return a concrete spec or plan without editing files."
        : acting
          ? "Chat mode stays conversational. Switch to Agent when you want file edits or scaffolding."
          : "Ask for analysis, planning, review, or local repo strategy.";
  }

  function rememberUi() {
    localStorage.setItem(
      "vswirks-ui",
      JSON.stringify({
        mode: elements.mode.value,
        executionMode: elements.executionMode.value === "1" ? "act" : "plan",
        focusChat: elements.app.classList.contains("focus-chat"),
        drawerTab
      })
    );
  }

  function sendPrompt() {
    const prompt = elements.prompt.value.trim();
    if (!prompt || state.pending) {
      return;
    }
    const requestOverrides = consumeOneShotOverrides();
    void api.invoke("vswirks:sendPrompt", {
      prompt,
      mode: elements.mode.value,
      executionMode: elements.executionMode.value === "1" ? "act" : "plan",
      workflowPresetId: elements.workflowPreset.value,
      agentProfileId: elements.agentProfile.value,
      model: requestOverrides.model || getRequestedModel(),
      systemPromptOverride: requestOverrides.systemPrompt || elements.threadSystemPromptOverride.value,
      pausedAfterSpec: elements.pauseAfterSpec.checked
    });
    elements.prompt.value = "";
    lastHydratedDraftPrompt = "";
    renderStatus();
  }

  function getRequestedModel() {
    return elements.model.value && elements.model.value !== AUTO_MODEL_VALUE ? elements.model.value : "";
  }

  function consumeOneShotOverrides() {
    const overrides = {
      model: oneShotOverrides.model || "",
      systemPrompt: oneShotOverrides.systemPrompt || ""
    };
    oneShotOverrides.model = "";
    oneShotOverrides.systemPrompt = "";
    return overrides;
  }

  function getActiveThread() {
    if (!state.activeProject || !state.activeProject.threads) {
      return null;
    }
    return (
      state.activeProject.threads.find((thread) => thread.id === state.activeProject.activeThreadId) ||
      state.activeProject.threads[0] ||
      null
    );
  }

  function getActiveRun() {
    return state.activeProject ? state.activeProject.activeRun || null : null;
  }

  function getActiveSpec() {
    return state.activeProject ? state.activeProject.activeSpec || null : null;
  }

  function createBadge(text) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = text;
    return badge;
  }

  function createProjectPathRow(label, value) {
    const row = document.createElement("div");
    row.className = "project-path";

    const title = document.createElement("span");
    title.className = "project-path-label";
    title.textContent = label;
    row.appendChild(title);

    const text = document.createElement("span");
    text.className = "project-path-value";
    text.textContent = value;
    row.appendChild(text);

    return row;
  }

  function describeTargetPath(workspaceRoot, targetPath) {
    if (!targetPath) {
      return "Project root";
    }
    if (workspaceRoot && workspaceRoot === targetPath) {
      return `${targetPath} (project root)`;
    }
    return targetPath;
  }

  function renderRichContent(container, text) {
    const parts = splitIntoSegments(text);
    if (!parts.length) {
      const paragraph = document.createElement("p");
      paragraph.textContent = "";
      container.appendChild(paragraph);
      return;
    }

    parts.forEach((segment) => {
      if (segment.type === "code") {
        container.appendChild(renderCodeBlock(segment));
      } else {
        renderTextBlocks(container, segment.text);
      }
    });
  }

  function splitIntoSegments(text) {
    const source = String(text || "");
    const pattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
    const segments = [];
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(source))) {
      if (match.index > lastIndex) {
        segments.push({ type: "text", text: source.slice(lastIndex, match.index) });
      }
      const info = match[1].trim();
      const parts = info ? info.split(/\s+/) : [];
      segments.push({
        type: "code",
        language: parts[0] || "",
        meta: parts.slice(1).join(" "),
        code: match[2].replace(/\n$/, "")
      });
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < source.length) {
      segments.push({ type: "text", text: source.slice(lastIndex) });
    }

    return segments.filter((segment) =>
      segment.type === "code" ? Boolean(segment.code || segment.language) : Boolean(segment.text.trim())
    );
  }

  function renderTextBlocks(container, text) {
    const blocks = String(text || "")
      .trim()
      .split(/\n{2,}/)
      .filter(Boolean);

    blocks.forEach((block) => {
      const lines = block.split("\n");
      if (lines.every((line) => line.trim().startsWith("- "))) {
        const list = document.createElement("ul");
        lines.forEach((line) => {
          const item = document.createElement("li");
          appendInlineContent(item, line.replace(/^\s*-\s*/, ""));
          list.appendChild(item);
        });
        container.appendChild(list);
        return;
      }
      const paragraph = document.createElement("p");
      appendInlineContent(paragraph, block);
      container.appendChild(paragraph);
    });
  }

  function appendInlineContent(parent, text) {
    const pattern = /`([^`]+)`|(https?:\/\/[^\s<]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text))) {
      if (match.index > lastIndex) {
        appendText(parent, text.slice(lastIndex, match.index));
      }
      if (match[1]) {
        const code = document.createElement("code");
        code.textContent = match[1];
        parent.appendChild(code);
      } else {
        const link = document.createElement("a");
        link.href = match[0];
        link.textContent = match[0];
        link.target = "_blank";
        link.rel = "noreferrer";
        parent.appendChild(link);
      }
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
      appendText(parent, text.slice(lastIndex));
    }
  }

  function appendText(parent, text) {
    const parts = String(text).split("\n");
    parts.forEach((part, index) => {
      if (part) {
        parent.appendChild(document.createTextNode(part));
      }
      if (index < parts.length - 1) {
        parent.appendChild(document.createElement("br"));
      }
    });
  }

  function renderCodeBlock(segment) {
    const shell = document.createElement("section");
    shell.className = "code-block";
    const header = document.createElement("div");
    header.className = "code-toolbar";
    const label = document.createElement("span");
    label.textContent = segment.language || "text";
    header.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "code-actions";
    actions.appendChild(
      createTextButton("Copy", () => {
        navigator.clipboard.writeText(segment.code);
      })
    );
    header.appendChild(actions);
    shell.appendChild(header);
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = segment.code;
    pre.appendChild(code);
    shell.appendChild(pre);
    return shell;
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) {
      return "now";
    }
    const diff = Date.now() - Number(timestamp);
    const seconds = Math.max(1, Math.round(diff / 1000));
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours}h`;
    }
    return `${Math.round(hours / 24)}d`;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function createTextButton(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  async function syncThreadSettings() {
    await api.invoke("vswirks:updateThreadSettings", {
      mode: elements.mode.value,
      executionMode: elements.executionMode.value === "1" ? "act" : "plan",
      workflowPresetId: elements.workflowPreset.value,
      agentProfileId: elements.agentProfile.value,
      systemPromptOverride: elements.threadSystemPromptOverride.value,
      pausedAfterSpec: elements.pauseAfterSpec.checked,
      model: getRequestedModel()
    });
  }

  function queueDraftSync() {
    if (draftSyncHandle) {
      clearTimeout(draftSyncHandle);
    }
    draftSyncHandle = setTimeout(() => {
      draftSyncHandle = null;
      void api.invoke("vswirks:updateThreadSettings", {
        draftPrompt: elements.prompt.value
      });
      lastHydratedDraftPrompt = elements.prompt.value;
    }, 150);
  }

  function readAgentProfileDraftFromForm() {
    return {
      ...(profileEditor.draft || {}),
      id: profileEditor.draft && profileEditor.draft.id ? profileEditor.draft.id : `custom-${Date.now()}`,
      label: elements.agentProfileLabel.value.trim(),
      description: elements.agentProfileDescription.value.trim(),
      preferredRole: elements.agentProfilePreferredRole.value,
      defaultMode: elements.agentProfileDefaultMode.value,
      defaultExecutionMode: elements.agentProfileDefaultExecutionMode.value,
      linkedWorkflowPresetId: elements.agentProfileLinkedWorkflow.value,
      modelOverride: elements.agentProfileModelOverride.value,
      promptPrefix: elements.agentProfilePromptPrefix.value.trim(),
      systemPrompt: elements.agentProfileSystemPrompt.value.trim(),
      enabled: elements.agentProfileEnabled.checked
    };
  }

  function buildPromptingSettingsPayload(nextProfiles) {
    return {
      globalSystemPrompt: elements.globalSystemPrompt.value.trim(),
      defaultAgentProfileId: elements.defaultAgentProfile.value,
      agentProfiles: nextProfiles || normalizeAgentProfiles(state.settings.agentProfiles)
    };
  }

  async function refreshPromptPreview() {
    const result = await api.invoke("vswirks:getPromptPreview", {
      prompt: elements.prompt.value.trim(),
      mode: elements.mode.value,
      executionMode: elements.executionMode.value === "1" ? "act" : "plan",
      workflowPresetId: elements.workflowPreset.value,
      agentProfileId: elements.agentProfile.value,
      model: oneShotOverrides.model || getRequestedModel(),
      systemPromptOverride: oneShotOverrides.systemPrompt || elements.threadSystemPromptOverride.value
    });
    promptPreviewText =
      result && result.ok && typeof result.preview === "string"
        ? result.preview
        : "Prompt preview is unavailable.";
    render();
  }

  function ensureVibeRecognition() {
    if (!SpeechRecognitionConstructor) {
      return null;
    }
    if (vibe.recognition) {
      return vibe.recognition;
    }

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = "en-US";
    if ("processLocally" in recognition) {
      try {
        recognition.processLocally = true;
      } catch {}
    }

    recognition.addEventListener("start", () => {
      vibe.listening = true;
      vibe.error = "";
      renderVibe();
      renderStatus();
    });
    recognition.addEventListener("end", () => {
      vibe.listening = false;
      vibe.interim = "";
      renderVibe();
      renderStatus();
    });
    recognition.addEventListener("error", (event) => {
      vibe.listening = false;
      vibe.error =
        event && event.error
          ? `Voice capture failed: ${event.error}`
          : "Voice capture failed.";
      renderVibe();
      renderStatus();
    });
    recognition.addEventListener("result", (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index] && event.results[index][0]
          ? String(event.results[index][0].transcript || "").trim()
          : "";
        if (!transcript) {
          continue;
        }
        if (event.results[index].isFinal) {
          finalText += `${transcript} `;
        } else {
          interimText += `${transcript} `;
        }
      }

      vibe.interim = interimText.trim();
      const normalizedFinal = finalText.trim();
      if (normalizedFinal) {
        vibe.transcript = [vibe.transcript, normalizedFinal].filter(Boolean).join(" ").trim();
        elements.prompt.value = [elements.prompt.value.trim(), normalizedFinal]
          .filter(Boolean)
          .join(" ")
          .trim();
      }
      renderVibe();
      renderStatus();
    });

    vibe.recognition = recognition;
    return recognition;
  }

  function startVibeCapture() {
    if (state.pending || vibe.listening) {
      return;
    }
    const recognition = ensureVibeRecognition();
    if (!recognition) {
      vibe.error = "Local speech recognition is unavailable in this Electron build.";
      renderVibe();
      renderStatus();
      return;
    }
    vibe.error = "";
    vibe.interim = "";
    try {
      recognition.start();
    } catch (error) {
      vibe.error = error instanceof Error ? error.message : String(error);
      renderVibe();
      renderStatus();
    }
  }

  function stopVibeCapture() {
    if (!vibe.recognition || !vibe.listening) {
      return;
    }
    try {
      vibe.recognition.stop();
    } catch (error) {
      vibe.error = error instanceof Error ? error.message : String(error);
      vibe.listening = false;
      renderVibe();
      renderStatus();
    }
  }

  function clearVibeDraft() {
    vibe.transcript = "";
    vibe.interim = "";
    vibe.error = "";
    elements.prompt.value = "";
    renderVibe();
    renderStatus();
  }

  function buildVibeSpec() {
    const prompt = elements.prompt.value.trim();
    if (!prompt || state.pending) {
      return;
    }
    const requestOverrides = consumeOneShotOverrides();
    elements.mode.value = "agent";
    elements.executionMode.value = "0";
    elements.pauseAfterSpec.checked = true;
    renderExecutionMode();
    applyPromptPlaceholder();
    rememberUi();
    void syncThreadSettings();
    void api.invoke("vswirks:buildSpec", {
      prompt,
      mode: "agent",
      executionMode: "plan",
      workflowPresetId: elements.workflowPreset.value,
      agentProfileId: elements.agentProfile.value,
      model: requestOverrides.model || getRequestedModel(),
      systemPromptOverride: requestOverrides.systemPrompt || elements.threadSystemPromptOverride.value
    });
    drawerTab = "spec";
    renderTabs();
    rememberUi();
  }

  async function confirmSpecToAct() {
    const activeSpec = getActiveSpec();
    const prompt =
      elements.prompt.value.trim() ||
      (activeSpec && activeSpec.generatedFrom) ||
      (activeSpec && activeSpec.goal) ||
      (activeSpec && activeSpec.title) ||
      "";
    if (!activeSpec || !prompt || state.pending) {
      return;
    }
    elements.mode.value = "agent";
    elements.executionMode.value = "1";
    elements.pauseAfterSpec.checked = false;
    renderExecutionMode();
    applyPromptPlaceholder();
    rememberUi();
    await syncThreadSettings();
    const requestOverrides = consumeOneShotOverrides();
    void api.invoke("vswirks:sendPrompt", {
      prompt,
      mode: "agent",
      executionMode: "act",
      workflowPresetId: elements.workflowPreset.value,
      agentProfileId: elements.agentProfile.value,
      model: requestOverrides.model || getRequestedModel(),
      systemPromptOverride: requestOverrides.systemPrompt || elements.threadSystemPromptOverride.value,
      pausedAfterSpec: false,
      useActiveSpec: true
    });
    vibe.transcript = "";
    vibe.interim = "";
    vibe.error = "";
    elements.prompt.value = "";
    drawerTab = "run";
    renderVibe();
    renderTabs();
    renderStatus();
    rememberUi();
  }

  elements.refreshModels.addEventListener("click", () => {
    void api.invoke("vswirks:refreshModels");
  });
  elements.focusChat.addEventListener("click", () => {
    elements.app.classList.toggle("focus-chat");
    rememberUi();
  });
  elements.startService.addEventListener("click", () => {
    void api.invoke("vswirks:startService");
  });
  elements.syncBridge.addEventListener("click", () => {
    void api.invoke("vswirks:syncBridge");
  });
  elements.openProjectFolder.addEventListener("click", () => {
    void api.invoke("vswirks:createProject");
  });
  elements.setProjectTarget.addEventListener("click", () => {
    void api.invoke("vswirks:setTargetPath");
  });
  elements.openProjectInEditor.addEventListener("click", () => {
    void api.invoke("vswirks:openProjectInEditor");
  });
  elements.newChat.addEventListener("click", () => {
    void api.invoke("vswirks:newChat", {
      workflowPresetId: elements.workflowPreset.value,
      agentProfileId: elements.agentProfile.value,
      modelOverride: getRequestedModel(),
      systemPromptOverride: elements.threadSystemPromptOverride.value,
      mode: elements.mode.value,
      executionMode: elements.executionMode.value === "1" ? "act" : "plan"
    });
  });
  elements.attachFile.addEventListener("click", () => {
    void api.invoke("vswirks:attachFile");
  });
  elements.attachImage.addEventListener("click", () => {
    void api.invoke("vswirks:attachImage");
  });
  elements.attachEditorSelection.addEventListener("click", () => {
    void api.invoke("vswirks:attachEditorSelection");
  });
  elements.uploadSpec.addEventListener("click", () => {
    void api.invoke("vswirks:uploadSpec");
  });
  elements.stop.addEventListener("click", () => {
    void api.invoke("vswirks:abort");
  });
  elements.vibeHold.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    startVibeCapture();
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
    elements.vibeHold.addEventListener(eventName, stopVibeCapture);
  });
  elements.vibeClear.addEventListener("click", clearVibeDraft);
  elements.vibeBuildSpec.addEventListener("click", buildVibeSpec);
  elements.vibeConfirmAct.addEventListener("click", () => {
    void confirmSpecToAct();
  });
  elements.buildSpec.addEventListener("click", () => {
    const prompt = elements.prompt.value.trim();
    if (!prompt) {
      return;
    }
    const requestOverrides = consumeOneShotOverrides();
    void api.invoke("vswirks:buildSpec", {
      prompt,
      mode: elements.mode.value,
      executionMode: elements.executionMode.value === "1" ? "act" : "plan",
      workflowPresetId: elements.workflowPreset.value,
      agentProfileId: elements.agentProfile.value,
      model: requestOverrides.model || getRequestedModel(),
      systemPromptOverride: requestOverrides.systemPrompt || elements.threadSystemPromptOverride.value
    });
    drawerTab = "spec";
    renderTabs();
    rememberUi();
  });
  elements.refinePrompt.addEventListener("click", async () => {
    const prompt = elements.prompt.value.trim();
    if (!prompt || state.pending || state.promptRefining) {
      return;
    }

    const result = await api.invoke("vswirks:refinePrompt", {
      prompt,
      mode: elements.mode.value,
      executionMode: elements.executionMode.value === "1" ? "act" : "plan",
      agentProfileId: elements.agentProfile.value,
      model: oneShotOverrides.model || getRequestedModel(),
      systemPromptOverride: oneShotOverrides.systemPrompt || elements.threadSystemPromptOverride.value
    });

    if (result && result.ok && typeof result.prompt === "string" && result.prompt.trim()) {
      elements.prompt.value = result.prompt;
      elements.prompt.focus();
      elements.prompt.setSelectionRange(result.prompt.length, result.prompt.length);
      renderStatus();
    }
  });
  elements.send.addEventListener("click", sendPrompt);
  elements.mode.addEventListener("change", async () => {
    await syncThreadSettings();
    rememberUi();
    renderExecutionMode();
    applyPromptPlaceholder();
  });
  elements.workflowPreset.addEventListener("change", async () => {
    await syncThreadSettings();
    renderWorkflowPresets();
  });
  elements.executionMode.addEventListener("input", async () => {
    renderExecutionMode();
    applyPromptPlaceholder();
    rememberUi();
    await syncThreadSettings();
  });
  elements.pauseAfterSpec.addEventListener("change", async () => {
    await syncThreadSettings();
  });
  elements.model.addEventListener("change", async () => {
    await syncThreadSettings();
  });
  elements.agentProfile.addEventListener("change", async () => {
    await syncThreadSettings();
    await refreshPromptPreview();
  });
  elements.projectDefaultAgentProfile.addEventListener("change", () => {
    void api.invoke("vswirks:updateProjectSettings", {
      defaultAgentProfileId: elements.projectDefaultAgentProfile.value
    });
  });
  elements.defaultAgentProfile.addEventListener("change", () => {
    void api.invoke("vswirks:savePromptingSettings", buildPromptingSettingsPayload());
  });
  elements.threadSystemPromptOverride.addEventListener("change", async () => {
    await syncThreadSettings();
    await refreshPromptPreview();
  });
  elements.nextRunModel.addEventListener("change", () => {
    oneShotOverrides.model = elements.nextRunModel.value;
  });
  elements.nextRunSystemPrompt.addEventListener("input", () => {
    oneShotOverrides.systemPrompt = elements.nextRunSystemPrompt.value.trim();
  });
  elements.refreshPromptPreview.addEventListener("click", () => {
    void refreshPromptPreview();
  });
  elements.savePromptingSettings.addEventListener("click", () => {
    void api.invoke("vswirks:savePromptingSettings", buildPromptingSettingsPayload());
  });
  elements.saveThreadPrompting.addEventListener("click", async () => {
    await syncThreadSettings();
    await refreshPromptPreview();
  });
  elements.agentProfileEditor.addEventListener("change", () => {
    profileEditor.activeId = elements.agentProfileEditor.value;
    profileEditor.draft = cloneAgentProfile(findAgentProfile(profileEditor.activeId));
    syncAgentProfileDraftToForm();
  });
  [
    elements.agentProfileLabel,
    elements.agentProfileDescription,
    elements.agentProfilePreferredRole,
    elements.agentProfileDefaultMode,
    elements.agentProfileDefaultExecutionMode,
    elements.agentProfileLinkedWorkflow,
    elements.agentProfileModelOverride,
    elements.agentProfilePromptPrefix,
    elements.agentProfileSystemPrompt,
    elements.agentProfileEnabled
  ].forEach((element) => {
    const eventName = element.tagName === "SELECT" || element.type === "checkbox" ? "change" : "input";
    element.addEventListener(eventName, () => {
      profileEditor.draft = readAgentProfileDraftFromForm();
    });
  });
  elements.newAgentProfile.addEventListener("click", () => {
    profileEditor.activeId = `custom-${Date.now()}`;
    profileEditor.draft = cloneAgentProfile({
      id: profileEditor.activeId,
      label: "",
      description: "",
      preferredRole: "",
      modelOverride: "",
      systemPrompt: "",
      defaultMode: "chat",
      defaultExecutionMode: "plan",
      linkedWorkflowPresetId: "",
      promptPrefix: "",
      enabled: true
    });
    syncAgentProfileDraftToForm();
  });
  elements.duplicateAgentProfile.addEventListener("click", () => {
    const source = readAgentProfileDraftFromForm();
    profileEditor.activeId = `custom-${Date.now()}`;
    profileEditor.draft = {
      ...source,
      id: profileEditor.activeId,
      label: source.label ? `${source.label} Copy` : "Copied Agent"
    };
    syncAgentProfileDraftToForm();
  });
  elements.saveAgentProfile.addEventListener("click", async () => {
    const nextProfile = readAgentProfileDraftFromForm();
    const profiles = normalizeAgentProfiles(state.settings.agentProfiles)
      .filter((profile) => profile.id !== nextProfile.id)
      .concat(nextProfile);
    profileEditor.activeId = nextProfile.id;
    profileEditor.draft = cloneAgentProfile(nextProfile);
    await api.invoke("vswirks:savePromptingSettings", buildPromptingSettingsPayload(profiles));
    await refreshPromptPreview();
  });
  elements.deleteAgentProfile.addEventListener("click", async () => {
    const targetId = profileEditor.activeId;
    if (!targetId) {
      return;
    }
    const profiles = normalizeAgentProfiles(state.settings.agentProfiles).filter(
      (profile) => profile.id !== targetId
    );
    profileEditor.activeId = profiles[0] ? profiles[0].id : "";
    profileEditor.draft = cloneAgentProfile(findAgentProfile(profileEditor.activeId, profiles));
    await api.invoke("vswirks:savePromptingSettings", buildPromptingSettingsPayload(profiles));
    await refreshPromptPreview();
  });
  elements.saveModelRoles.addEventListener("click", () => {
    void api.invoke("vswirks:saveModelRoles", {
      chat: elements.modelRoleChat.value,
      builder: elements.modelRoleBuilder.value,
      reviewer: elements.modelRoleReviewer.value,
      refiner: elements.modelRoleRefiner.value,
      editor: elements.modelRoleEditor.value
    });
  });
  elements.saveGenerationSettings.addEventListener("click", () => {
    void api.invoke("vswirks:saveGenerationSettings", {
      chatTemperature: Number(elements.chatTemperature.value),
      chatTopP: Number(elements.chatTopP.value),
      chatMaxTokens: Number(elements.chatMaxTokens.value),
      agentTemperature: Number(elements.agentTemperature.value),
      agentTopP: Number(elements.agentTopP.value),
      agentMaxTokens: Number(elements.agentMaxTokens.value)
    });
  });
  elements.resetGenerationSettings.addEventListener("click", () => {
    void api.invoke("vswirks:resetGenerationSettings");
  });
  elements.prompt.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      sendPrompt();
    }
  });
  elements.prompt.addEventListener("input", () => {
    renderStatus();
    queueDraftSync();
  });
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      drawerTab = button.dataset.tab;
      renderTabs();
      rememberUi();
    });
  });

  renderExecutionMode();
  applyPromptPlaceholder();
  renderTabs();
  renderVibe();
  void api.invoke("vswirks:ready");
})();
