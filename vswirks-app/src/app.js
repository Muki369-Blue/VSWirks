(function () {
  const api = window.vswirks;
  const persisted = JSON.parse(localStorage.getItem("vswirks-ui") || "{}");
  const AUTO_MODEL_VALUE = "__auto__";

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Syntax highlighting (inline, no dependencies) ────
  const SYN_KEYWORDS = new Set([
    "abstract","async","await","break","case","catch","class","const","continue",
    "debugger","default","delete","do","else","enum","export","extends","false",
    "finally","for","from","function","if","import","in","instanceof","let","new",
    "null","of","return","static","super","switch","this","throw","true","try",
    "typeof","undefined","var","void","while","with","yield",
    "def","elif","except","lambda","pass","raise","self","None","True","False",
    "fn","impl","pub","mod","use","crate","mut","struct","trait","match","loop","move"
  ]);
  const SYN_BUILTINS = new Set([
    "console","document","window","require","module","exports","process",
    "Array","Object","String","Number","Boolean","Map","Set","Promise","Error",
    "Math","JSON","Date","RegExp","parseInt","parseFloat","setTimeout","setInterval",
    "print","len","range","list","dict","tuple","int","str","float","type","open",
    "println","vec","Box","Option","Result","Some","Ok","Err"
  ]);

  function highlightCode(code, lang) {
    // Tokenize and highlight with spans
    let result = code;
    // Strings (double, single, backtick)
    result = result.replace(/(["'`])(?:(?!\1|\\).|\\.)*?\1/g, '<span class="syn-str">$&</span>');
    // Comments (// and #)
    result = result.replace(/(\/\/.*?$|#(?!include|define|if).*?$)/gm, '<span class="syn-cmt">$&</span>');
    // Numbers
    result = result.replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[0-9a-fA-F]+)\b/g, '<span class="syn-num">$&</span>');
    // Keywords and builtins (word boundary match)
    result = result.replace(/\b([a-zA-Z_]\w*)\b/g, (match) => {
      if (SYN_KEYWORDS.has(match)) return `<span class="syn-kw">${match}</span>`;
      if (SYN_BUILTINS.has(match)) return `<span class="syn-bi">${match}</span>`;
      return match;
    });
    // Decorators / annotations
    result = result.replace(/@\w+/g, '<span class="syn-dec">$&</span>');
    return result;
  }

  /** Lightweight Markdown → HTML (safe: all text is escaped first). */
  function renderMarkdown(raw) {
    const safe = escapeHtml(raw);
    let html = safe;

    // Fenced code blocks: ```lang\n...\n```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      const highlighted = highlightCode(code.trimEnd(), lang);
      const langLabel = lang ? `<span class="code-lang">${lang}</span>` : "";
      const copyBtn = `<button class="code-copy-btn" onclick="navigator.clipboard.writeText(this.closest('pre').querySelector('code').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button>`;
      return `<pre class="md-code-block">${langLabel}${copyBtn}<code class="lang-${lang || "text"}">${highlighted}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>');

    // Headers (h1-h3)
    html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

    // Bold / italic
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // Unordered lists (- item)
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
    // Collapse adjacent <ul> tags
    html = html.replace(/<\/ul>\s*<ul>/g, "");

    // Ordered lists (1. item)
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/<\/blockquote>\s*<blockquote>/g, "<br>");

    // Horizontal rules
    html = html.replace(/^---$/gm, "<hr>");

    // Line breaks → paragraphs (double newline)
    html = html.replace(/\n{2,}/g, "</p><p>");
    html = `<p>${html}</p>`;
    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, "");

    return html;
  }

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
    viewStudio: document.getElementById("viewStudio"),
    viewProjects: document.getElementById("viewProjects"),
    studioView: document.getElementById("studioView"),
    studioMessages: document.getElementById("studioMessages"),
    studioPrompt: document.getElementById("studioPrompt"),
    studioSend: document.getElementById("studioSend"),
    studioStatus: document.getElementById("studioStatus"),
    studioDeepResearch: document.getElementById("studioDeepResearch"),
    studioWebTools: document.getElementById("studioWebTools"),
    studioQuickResponse: document.getElementById("studioQuickResponse"),
    studioVoice: document.getElementById("studioVoice"),
    studioVoiceTest: document.getElementById("studioVoiceTest"),
    studioVoiceStop: document.getElementById("studioVoiceStop"),
    studioVoiceInput: document.getElementById("studioVoiceInput"),
    studioProjectList: document.getElementById("studioProjectList"),
    studioNewProject: document.getElementById("studioNewProject"),
    studioNewChat: document.getElementById("studioNewChat"),
    studioProjectContext: document.getElementById("studioProjectContext"),
    studioProjectLabel: document.getElementById("studioProjectLabel"),
    studioClearProject: document.getElementById("studioClearProject"),
    studioExport: document.getElementById("studioExport"),
    studioImport: document.getElementById("studioImport"),
    studioTemplateSelect: document.getElementById("studioTemplateSelect"),
    studioGitPanel: document.getElementById("studioGitPanel"),
    studioRefreshGit: document.getElementById("studioRefreshGit"),
    studioSearch: document.getElementById("studioSearch"),
    studioSearchResults: document.getElementById("studioSearchResults"),
    studioIndexProject: document.getElementById("studioIndexProject"),
    studioRagSearch: document.getElementById("studioRagSearch"),
    studioFileChanges: document.getElementById("studioFileChanges"),
    studioAutoContext: document.getElementById("studioAutoContext"),
    studioGitFiles: document.getElementById("studioGitFiles"),
    studioGitCommitRow: document.getElementById("studioGitCommitRow"),
    studioGitMessage: document.getElementById("studioGitMessage"),
    studioGitCommitBtn: document.getElementById("studioGitCommitBtn"),
    studioGitBranchRow: document.getElementById("studioGitBranchRow"),
    studioGitBranchSelect: document.getElementById("studioGitBranchSelect"),
    studioGitCheckoutBtn: document.getElementById("studioGitCheckoutBtn"),
    studioGitDiffPreview: document.getElementById("studioGitDiffPreview"),
    studioGenerateImage: document.getElementById("studioGenerateImage"),
    studioModelPanel: document.getElementById("studioModelPanel"),
    studioRefreshModels: document.getElementById("studioRefreshModels"),
    studioModelName: document.getElementById("studioModelName"),
    studioPullModel: document.getElementById("studioPullModel"),
    studioTabChat: document.getElementById("studioTabChat"),
    studioTabTerminal: document.getElementById("studioTabTerminal"),
    studioTabCompare: document.getElementById("studioTabCompare"),
    studioTerminal: document.getElementById("studioTerminal"),
    studioTerminalOutput: document.getElementById("studioTerminalOutput"),
    studioTerminalInput: document.getElementById("studioTerminalInput"),
    studioTerminalRun: document.getElementById("studioTerminalRun"),
    studioCompare: document.getElementById("studioCompare"),
    compareModelA: document.getElementById("compareModelA"),
    compareModelB: document.getElementById("compareModelB"),
    compareRun: document.getElementById("compareRun"),
    compareHeaderA: document.getElementById("compareHeaderA"),
    compareHeaderB: document.getElementById("compareHeaderB"),
    compareResultA: document.getElementById("compareResultA"),
    compareResultB: document.getElementById("compareResultB"),
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
  let activeView = "studio";
  const studioFeatures = { deepResearch: false, webTools: false, quickResponse: true };
  let studioVoiceId = "";
  let studioLastSpokenId = "";

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

  let isFirstState = true;
  let lastActiveProjectId = "";

  api.onState((payload) => {
    const wasPending = state.pending;
    const prevProjectId = state.activeProjectId;
    state = {
      ...state,
      ...payload
    };
    hydratePromptDraftFromState();

    // On first load: open Studio fresh, clear transient UI
    if (isFirstState) {
      isFirstState = false;
      elements.prompt.value = "";
      switchView("studio");
    }

    // Detect project switch → jump to most recent step
    if (state.activeProjectId && state.activeProjectId !== prevProjectId && prevProjectId) {
      navigateToProjectLatest();
    }
    lastActiveProjectId = state.activeProjectId || "";

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

  // ── Studio view ─────────────────────────────────────

  function switchView(view) {
    activeView = view;
    elements.app.classList.toggle("view-studio", view === "studio");
    elements.app.classList.toggle("view-projects", view === "projects");
    elements.viewStudio.classList.toggle("active", view === "studio");
    elements.viewProjects.classList.toggle("active", view === "projects");
    if (view === "studio") {
      renderStudioMessages();
      requestAnimationFrame(() => elements.studioPrompt.focus());
    } else {
      navigateToProjectLatest();
    }
  }

  function renderStudioMessages() {
    const history = state.activeProject ? state.activeProject.history || [] : [];
    elements.studioMessages.innerHTML = "";

    if (!history.length || history.every((m) => m.role === "system")) {
      const welcome = document.createElement("div");
      welcome.className = "studio-welcome";
      welcome.innerHTML = [
        "<h2>What are you working on?</h2>",
        "<p>Your local-first dev companion. Ask anything — code questions, debugging, architecture, tooling. Everything runs on your machine.</p>",
        '<div class="feature-hints">',
        '<span class="hint">Deep Research</span>',
        '<span class="hint">Web Tools</span>',
        '<span class="hint">Quick Response</span>',
        "</div>"
      ].join("");
      elements.studioMessages.appendChild(welcome);
      return;
    }

    history.forEach((item) => {
      if (item.role === "system" || item.role === "tool") return;
      const card = document.createElement("div");
      card.className = `message-card ${item.role}`;
      const header = document.createElement("div");
      header.className = "message-header";
      header.textContent = item.role === "user" ? "You" : "Studio";
      card.appendChild(header);
      const body = document.createElement("div");
      body.className = "message-body";
      if (item.role === "assistant") {
        body.innerHTML = renderMarkdown(item.content || "");
      } else {
        body.textContent = item.content || "";
      }
      card.appendChild(body);
      if (item.role === "assistant" && !state.pending) {
        const actions = document.createElement("div");
        actions.className = "message-actions";
        const copyBtn = document.createElement("button");
        copyBtn.className = "ghost-button compact-button";
        copyBtn.textContent = "Copy";
        copyBtn.addEventListener("click", () => navigator.clipboard.writeText(item.content || ""));
        actions.appendChild(copyBtn);
        const speakBtn = document.createElement("button");
        speakBtn.className = "ghost-button compact-button";
        speakBtn.textContent = "Speak";
        speakBtn.addEventListener("click", () => speakText(item.content || ""));
        actions.appendChild(speakBtn);
        card.appendChild(actions);
      }
      elements.studioMessages.appendChild(card);
    });

    // Auto-speak latest assistant response
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    if (lastAssistant && lastAssistant.id !== studioLastSpokenId && !state.pending && studioVoiceId) {
      studioLastSpokenId = lastAssistant.id;
      speakText(lastAssistant.content || "");
    }

    requestAnimationFrame(() => {
      elements.studioMessages.scrollTop = elements.studioMessages.scrollHeight;
    });
  }

  function renderStudioProjects() {
    elements.studioProjectList.innerHTML = "";
    (state.projects || []).forEach((project) => {
      const chip = document.createElement("button");
      chip.className = `studio-project-chip${project.id === state.activeProjectId ? " active" : ""}`;
      chip.type = "button";
      chip.title = project.workspaceRoot || project.name;
      chip.addEventListener("click", () => {
        void api.invoke("vswirks:switchProject", { id: project.id });
      });

      const name = document.createElement("strong");
      name.textContent = project.name;
      chip.appendChild(name);

      const root = document.createElement("div");
      root.className = "meta path";
      root.textContent = (project.workspaceRoot || "").replace(/^.*\//, "");
      chip.appendChild(root);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = project.currentRunStatus || `${project.threadCount} chat${project.threadCount !== 1 ? "s" : ""}`;
      chip.appendChild(meta);

      elements.studioProjectList.appendChild(chip);
    });

    // Project context banner
    const active = state.activeProject;
    if (active) {
      elements.studioProjectContext.style.display = "";
      elements.studioProjectLabel.textContent = `Chatting about: ${active.name}`;
      elements.studioPrompt.placeholder = `Ask about ${active.name}…`;
      refreshGitPanel();
    } else {
      elements.studioProjectContext.style.display = "none";
      elements.studioPrompt.placeholder = "What are you working on?";
      elements.studioGitPanel.innerHTML = '<span class="meta">Select a project</span>';
    }
  }

  function renderStudioStatus() {
    elements.studioStatus.textContent = state.statusText || "Ready";
    elements.studioSend.disabled = state.pending || !elements.studioPrompt.value.trim();
  }

  // ── Prompt templates ─────────────────────────────

  const PROMPT_TEMPLATES = [
    { label: "Explain this code", prompt: "Explain the following code in detail, including what each section does and why:\n\n" },
    { label: "Find bugs", prompt: "Review the following code for bugs, edge cases, and potential issues. List each problem and suggest a fix:\n\n" },
    { label: "Write tests", prompt: "Write comprehensive unit tests for the following code. Cover happy paths, edge cases, and error conditions:\n\n" },
    { label: "Refactor", prompt: "Refactor the following code for better readability and maintainability without changing behavior:\n\n" },
    { label: "Add docs", prompt: "Add clear documentation comments to the following code. Explain parameters, return values, and behavior:\n\n" },
    { label: "Optimize", prompt: "Analyze the following code for performance bottlenecks and suggest optimizations:\n\n" },
    { label: "Security audit", prompt: "Perform a security audit on the following code. Identify vulnerabilities (XSS, injection, auth issues) and suggest fixes:\n\n" },
    { label: "Architecture review", prompt: "Review the architecture of this project. Identify strengths, weaknesses, and suggest improvements:\n\n" },
    { label: "Debug error", prompt: "I'm getting the following error. Help me understand the root cause and fix it:\n\n" },
    { label: "API design", prompt: "Design a clean REST API for the following requirements. Include endpoints, methods, request/response schemas:\n\n" }
  ];

  function populatePromptTemplates() {
    elements.studioTemplateSelect.innerHTML = '<option value="">Templates…</option>';
    PROMPT_TEMPLATES.forEach((tpl, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = tpl.label;
      elements.studioTemplateSelect.appendChild(opt);
    });
  }

  // ── Git panel (enhanced) ─────────────────────────

  async function refreshGitPanel() {
    const result = await api.invoke("vswirks:getGitStatus");
    if (!result || !result.ok) {
      elements.studioGitPanel.innerHTML = `<span class="meta">${escapeHtml(result && result.error ? result.error : "No git repo")}</span>`;
      elements.studioGitFiles.innerHTML = "";
      elements.studioGitCommitRow.style.display = "none";
      elements.studioGitBranchRow.style.display = "none";
      elements.studioGitDiffPreview.style.display = "none";
      return;
    }
    const lines = [
      `<div class="git-branch">${escapeHtml(result.branch)}</div>`,
      `<div class="git-changes meta">${result.changes} change${result.changes !== 1 ? "s" : ""}</div>`
    ];
    if (result.recentCommits.length) {
      lines.push('<div class="git-log">');
      result.recentCommits.slice(0, 5).forEach((c) => {
        lines.push(`<div class="git-commit meta">${escapeHtml(c)}</div>`);
      });
      lines.push("</div>");
    }
    elements.studioGitPanel.innerHTML = lines.join("");

    // Render changed files with stage/unstage toggle
    elements.studioGitFiles.innerHTML = "";
    if (result.statusLines && result.statusLines.length) {
      elements.studioGitCommitRow.style.display = "";
      result.statusLines.slice(0, 20).forEach((line) => {
        const indexStatus = line.charAt(0);
        const workStatus = line.charAt(1);
        const filePath = line.slice(3).trim();
        const isStaged = indexStatus !== " " && indexStatus !== "?";

        const row = document.createElement("div");
        row.className = "git-file-row";
        row.title = filePath;

        const statusBadge = document.createElement("span");
        statusBadge.className = `git-file-status ${isStaged ? "staged" : "unstaged"}`;
        statusBadge.textContent = isStaged ? indexStatus : (workStatus === "?" ? "?" : workStatus);
        row.appendChild(statusBadge);

        const name = document.createElement("span");
        name.className = "git-file-name";
        name.textContent = filePath;
        name.addEventListener("click", () => showGitDiff(filePath));
        row.appendChild(name);

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "ghost-button compact-button git-stage-btn";
        toggleBtn.textContent = isStaged ? "Unstage" : "Stage";
        toggleBtn.addEventListener("click", async () => {
          if (isStaged) {
            await api.invoke("vswirks:gitUnstage", { files: [filePath] });
          } else {
            await api.invoke("vswirks:gitStage", { files: [filePath] });
          }
          refreshGitPanel();
        });
        row.appendChild(toggleBtn);

        elements.studioGitFiles.appendChild(row);
      });
    } else {
      elements.studioGitCommitRow.style.display = "none";
    }

    // Branch switcher
    const branchResult = await api.invoke("vswirks:gitBranches");
    if (branchResult && branchResult.ok && branchResult.branches.length > 1) {
      elements.studioGitBranchRow.style.display = "";
      elements.studioGitBranchSelect.innerHTML = "";
      branchResult.branches.forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b.name;
        opt.textContent = b.name;
        if (b.current) opt.selected = true;
        elements.studioGitBranchSelect.appendChild(opt);
      });
    } else {
      elements.studioGitBranchRow.style.display = "none";
    }
  }

  async function showGitDiff(filePath) {
    const result = await api.invoke("vswirks:gitDiff", { file: filePath });
    if (!result || !result.ok) {
      elements.studioGitDiffPreview.style.display = "none";
      return;
    }
    const diff = (result.staged || "") + (result.unstaged || "");
    if (!diff.trim()) {
      elements.studioGitDiffPreview.style.display = "none";
      return;
    }
    elements.studioGitDiffPreview.style.display = "";
    elements.studioGitDiffPreview.innerHTML = `<pre class="md-code-block"><code class="lang-diff">${highlightDiff(escapeHtml(diff.slice(0, 5000)))}</code></pre>`;
  }

  function highlightDiff(text) {
    return text.split("\n").map((line) => {
      if (line.startsWith("+")) return `<span class="diff-add">${line}</span>`;
      if (line.startsWith("-")) return `<span class="diff-del">${line}</span>`;
      if (line.startsWith("@@")) return `<span class="diff-hunk">${line}</span>`;
      return line;
    }).join("\n");
  }

  // ── Model panel ──────────────────────────────────

  async function refreshModelPanel() {
    const models = await api.invoke("vswirks:listOllamaModels");
    if (!Array.isArray(models) || !models.length) {
      elements.studioModelPanel.innerHTML = '<span class="meta">No models found</span>';
      return;
    }
    elements.studioModelPanel.innerHTML = "";
    models.forEach((m) => {
      const row = document.createElement("div");
      row.className = "model-row";
      const label = document.createElement("span");
      label.className = "model-name";
      label.textContent = m.name;
      label.title = `${m.size} — ${m.modified}`;
      row.appendChild(label);
      const del = document.createElement("button");
      del.className = "icon-btn model-delete";
      del.textContent = "×";
      del.title = `Delete ${m.name}`;
      del.addEventListener("click", async () => {
        if (!confirm(`Delete model "${m.name}"?`)) return;
        const result = await api.invoke("vswirks:deleteOllamaModel", { name: m.name });
        if (result && result.ok) refreshModelPanel();
      });
      row.appendChild(del);
      elements.studioModelPanel.appendChild(row);
    });
  }

  // ── File changes ──────────────────────────────────

  function renderFileChanges() {
    const changes = state.recentFileChanges || [];
    if (!changes.length) {
      elements.studioFileChanges.innerHTML = '<span class="meta">No recent changes</span>';
      return;
    }
    elements.studioFileChanges.innerHTML = "";
    changes.slice(0, 8).forEach((c) => {
      const row = document.createElement("div");
      row.className = "file-change-row";
      row.title = c.file;
      const icon = c.type === "rename" ? "~" : c.type === "change" ? "M" : "+";
      row.innerHTML = `<span class="file-change-icon">${icon}</span><span class="file-change-name">${escapeHtml(c.file)}</span>`;
      elements.studioFileChanges.appendChild(row);
    });
  }

  // ── RAG search ──────────────────────────────────

  async function indexProject() {
    elements.studioIndexProject.disabled = true;
    elements.studioIndexProject.textContent = "Indexing…";
    const result = await api.invoke("vswirks:indexProject", {});
    elements.studioIndexProject.disabled = false;
    elements.studioIndexProject.textContent = "Index";
    if (result && result.ok) {
      elements.studioSearchResults.innerHTML = `<div class="meta">Indexed ${result.files} files, ${result.chunks} chunks</div>`;
    } else {
      elements.studioSearchResults.innerHTML = `<div class="meta" style="color:var(--bad)">${escapeHtml(result ? result.error : "Failed")}</div>`;
    }
  }

  async function ragSearch() {
    const query = elements.studioSearch.value.trim();
    if (!query) return;
    elements.studioSearchResults.innerHTML = '<div class="meta">Searching…</div>';
    const result = await api.invoke("vswirks:ragSearch", { query });
    if (!result || !result.ok) {
      elements.studioSearchResults.innerHTML = `<div class="meta" style="color:var(--bad)">${escapeHtml(result ? result.error : "Failed")}</div>`;
      return;
    }
    if (!result.results.length) {
      elements.studioSearchResults.innerHTML = '<div class="meta">No results</div>';
      return;
    }
    elements.studioSearchResults.innerHTML = "";
    result.results.forEach((r) => {
      const row = document.createElement("div");
      row.className = "search-result-row";
      row.innerHTML = `<strong>${escapeHtml(r.file)}:${r.startLine}</strong><span class="meta">${r.score ? ` (${(r.score * 100).toFixed(0)}%)` : ""}</span><pre class="search-result-snippet">${escapeHtml(r.text.slice(0, 200))}</pre>`;
      elements.studioSearchResults.appendChild(row);
    });
  }

  // ── Auto-context ────────────────────────────────

  let autoContextEnabled = persisted.autoContext || false;

  function getAutoContextSnippet() {
    if (!autoContextEnabled) return "";
    const changes = state.recentFileChanges || [];
    if (!changes.length) return "";
    return "\n\n[Auto-context: recently changed files]\n" + changes.slice(0, 5).map((c) => `- ${c.file} (${c.type})`).join("\n");
  }

  // ── Image generation ────────────────────────────

  async function generateImage() {
    const prompt = elements.studioPrompt.value.trim();
    if (!prompt) { alert("Enter an image description first"); return; }

    elements.studioGenerateImage.disabled = true;
    elements.studioStatus.textContent = "Generating image…";

    const result = await api.invoke("vswirks:generateImage", { prompt });

    elements.studioGenerateImage.disabled = false;
    elements.studioStatus.textContent = "Ready";

    if (result && result.ok) {
      // Show the generated image inline as a chat message
      const imgCard = document.createElement("div");
      imgCard.className = "message-card assistant";
      imgCard.innerHTML = `<div class="message-header">Studio</div><div class="message-body"><p><em>Generated image for: "${escapeHtml(prompt)}"</em></p><img src="file://${escapeHtml(result.path)}" class="generated-image" alt="Generated image" /></div>`;
      elements.studioMessages.appendChild(imgCard);
      elements.studioMessages.scrollTop = elements.studioMessages.scrollHeight;
    } else {
      alert(result ? result.error : "Image generation failed");
    }
  }

  // ── Studio tab switching ──────────────────────────

  let activeStudioPanel = "chat";

  function switchStudioPanel(panel) {
    activeStudioPanel = panel;
    document.querySelectorAll(".studio-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.panel === panel);
    });
    document.querySelectorAll(".studio-panel").forEach((el) => {
      el.style.display = el.dataset.panel === panel ? "" : "none";
    });
  }

  // ── Terminal ─────────────────────────────────────

  async function runTerminalCommand() {
    const command = elements.studioTerminalInput.value.trim();
    if (!command) return;

    const entry = document.createElement("div");
    entry.className = "terminal-entry";
    entry.innerHTML = `<span class="terminal-cmd">$ ${escapeHtml(command)}</span>`;
    elements.studioTerminalOutput.appendChild(entry);
    elements.studioTerminalInput.value = "";

    const result = await api.invoke("vswirks:runCommand", { command });
    const output = document.createElement("pre");
    output.className = "terminal-result";
    output.textContent = result.output || result.error || "(no output)";
    if (!result.ok) output.classList.add("terminal-error");
    entry.appendChild(output);
    elements.studioTerminalOutput.scrollTop = elements.studioTerminalOutput.scrollHeight;
  }

  // ── Model A/B compare ───────────────────────────

  function populateCompareModels() {
    const models = state.models || [];
    [elements.compareModelA, elements.compareModelB].forEach((sel, idx) => {
      sel.innerHTML = "";
      models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id || m;
        opt.textContent = m.id || m;
        sel.appendChild(opt);
      });
      // Default second model to a different one if possible
      if (idx === 1 && models.length > 1) sel.selectedIndex = 1;
    });
  }

  async function runModelComparison() {
    const prompt = elements.studioPrompt.value.trim();
    if (!prompt) { alert("Enter a prompt first"); return; }
    const modelA = elements.compareModelA.value;
    const modelB = elements.compareModelB.value;
    if (!modelA || !modelB) return;

    elements.compareRun.disabled = true;
    elements.compareRun.textContent = "Comparing…";
    elements.compareHeaderA.textContent = modelA;
    elements.compareHeaderB.textContent = modelB;
    elements.compareResultA.innerHTML = "<em>Loading…</em>";
    elements.compareResultB.innerHTML = "<em>Loading…</em>";

    const result = await api.invoke("vswirks:compareModels", { prompt, modelA, modelB });

    if (result && result.ok) {
      elements.compareResultA.innerHTML = result.modelA.error
        ? `<span class="terminal-error">${escapeHtml(result.modelA.error)}</span>`
        : renderMarkdown(result.modelA.content || "(empty)");
      elements.compareResultB.innerHTML = result.modelB.error
        ? `<span class="terminal-error">${escapeHtml(result.modelB.error)}</span>`
        : renderMarkdown(result.modelB.content || "(empty)");
    } else {
      elements.compareResultA.textContent = result ? result.error : "Failed";
      elements.compareResultB.textContent = "";
    }

    elements.compareRun.disabled = false;
    elements.compareRun.textContent = "Compare";
  }

  function studioSendPrompt() {
    const rawPrompt = elements.studioPrompt.value.trim();
    if (!rawPrompt || state.pending) return;

    const autoContext = getAutoContextSnippet();
    const prompt = rawPrompt + autoContext;

    const features = [];
    if (studioFeatures.deepResearch) features.push("deep-research");
    if (studioFeatures.webTools) features.push("web-tools");
    if (studioFeatures.quickResponse) features.push("quick-response");

    void api.invoke("vswirks:sendPrompt", {
      prompt,
      mode: "chat",
      executionMode: "plan",
      workflowPresetId: "freeform",
      agentProfileId: "",
      model: getRequestedModel(),
      studioMode: true,
      studioFeatures: features
    });
    elements.studioPrompt.value = "";
  }

  // ── Voice synthesis (Kokoro TTS — emotional, human-sounding) ──

  // 6 curated voice personas powered by Kokoro TTS (82M param model)
  // Each maps to a specific Kokoro voice trained on real speech data
  const VOICE_PERSONAS = [
    { name: "Zola",    desc: "Warm, confident (Female)",      kokoroVoice: "af_heart" },
    { name: "Mei",     desc: "Clear, precise (Female)",       kokoroVoice: "af_bella" },
    { name: "Claire",  desc: "Friendly, expressive (Female)", kokoroVoice: "bf_emma" },
    { name: "Priya",   desc: "Articulate, composed (Female)", kokoroVoice: "af_nicole" },
    { name: "Marcus",  desc: "Deep, steady (Male)",           kokoroVoice: "am_michael" },
    { name: "James",   desc: "Energetic, clear (Male)",       kokoroVoice: "am_puck" }
  ];

  let currentAudioEl = null;

  function populateStudioVoices() {
    elements.studioVoice.innerHTML = '<option value="">Off</option>';
    VOICE_PERSONAS.forEach((persona) => {
      const opt = document.createElement("option");
      opt.value = persona.name;
      opt.textContent = `${persona.name} — ${persona.desc}`;
      elements.studioVoice.appendChild(opt);
    });
  }

  function stopSpeaking() {
    if (currentAudioEl) {
      currentAudioEl.pause();
      currentAudioEl.src = "";
      currentAudioEl = null;
    }
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
    }
    elements.studioStatus.textContent = "Ready";
  }

  async function speakText(text) {
    if (!studioVoiceId || !text) return;
    stopSpeaking();

    const persona = VOICE_PERSONAS.find((p) => p.name === studioVoiceId);
    if (!persona) return;

    // Try Kokoro TTS via IPC — returns a WAV file path
    try {
      elements.studioStatus.textContent = "Generating voice…";
      const result = await api.invoke("vswirks:synthesizeSpeech", {
        text: text.slice(0, 3000),
        voice: persona.kokoroVoice
      });

      if (result && result.ok && result.wavPath) {
        const audio = new Audio(`file://${result.wavPath}`);
        audio.onended = () => { currentAudioEl = null; elements.studioStatus.textContent = "Ready"; };
        audio.onerror = () => { currentAudioEl = null; elements.studioStatus.textContent = "Ready"; };
        currentAudioEl = audio;
        elements.studioStatus.textContent = `${persona.name} speaking… (${(result.durationMs / 1000).toFixed(1)}s)`;
        audio.play();
        return;
      }
      // If result exists but not ok, show the error briefly
      if (result && result.error) {
        console.warn("Kokoro TTS:", result.error);
      }
    } catch (err) {
      console.warn("Kokoro TTS failed:", err);
    }

    // Fallback: Web Speech API (robotic but always available)
    elements.studioStatus.textContent = "Ready";
    if (typeof speechSynthesis !== "undefined") {
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 2000));
      utterance.rate = 1.0;
      speechSynthesis.speak(utterance);
    }
  }

  populateStudioVoices();

  populatePromptTemplates();
  refreshModelPanel();

  function navigateToProjectLatest() {
    const ap = state.activeProject;
    if (!ap) return;

    // Pick the best drawer tab based on project state
    const hasActiveRun = ap.activeRun && ap.activeRun.status !== "complete";
    const hasValidation = ap.activeRun && ap.activeRun.validation && ap.activeRun.validation.status;
    const hasSpec = ap.activeSpec && ap.activeSpec.raw;
    const runStatus = (ap.currentRunStatus || "").toLowerCase();

    if (hasActiveRun || /running|streaming|paused|queued/i.test(runStatus)) {
      drawerTab = "run";
    } else if (hasValidation && /failed/i.test(ap.activeRun.validation.status)) {
      drawerTab = "validation";
    } else if (/complete/i.test(runStatus)) {
      drawerTab = "diff";
    } else if (hasSpec) {
      drawerTab = "spec";
    } else {
      drawerTab = "spec";
    }

    // Scroll messages to bottom after next render
    requestAnimationFrame(() => {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    });
  }

  function render() {
    renderModels();
    renderStatus();
    if (activeView === "studio") {
      renderStudioProjects();
      renderStudioMessages();
      renderStudioStatus();
      renderFileChanges();
      return;
    }
    syncTopbarControls();
    renderTabs();
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
    populateCompareModels();
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
    left.innerHTML = `<strong>${escapeHtml(item.toolName || "tool")}</strong><div class="meta">${escapeHtml(item.summary || "")}</div>`;
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
    header.innerHTML = `<strong>${escapeHtml(activeSpec.title)}</strong><span class="meta">${escapeHtml(formatRelativeTime(activeSpec.updatedAt))}</span>`;
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
    header.innerHTML = `<strong>${escapeHtml(activeRun.summary || activeRun.workflowId || "Run")}</strong><span class="meta">${escapeHtml(activeRun.status)}</span>`;
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
      top.innerHTML = `<strong>${escapeHtml(event.label)}</strong><span class="meta">${escapeHtml(formatRelativeTime(event.createdAt))}</span>`;
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
        item.innerHTML = `<span>${escapeHtml(checkpoint.label)}</span><span class="meta">${escapeHtml(formatRelativeTime(checkpoint.createdAt))}</span>`;
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
      card.innerHTML = `<strong>Pending proposal</strong><div class="meta">${escapeHtml(state.pendingApproval.relativePath)}</div>`;
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
      card.innerHTML = `<strong>${escapeHtml(event.label)}</strong><div class="meta">${escapeHtml(event.path || "")}</div>`;
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
    header.innerHTML = `<strong>${escapeHtml(activeRun.validation.summary || "Validation pending")}</strong><span class="meta">${escapeHtml(activeRun.validation.status)}</span>`;
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
      card.innerHTML = `<strong>${escapeHtml(step.label)}</strong><div class="meta">${escapeHtml(step.command || "")}</div>`;
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
  // ── Studio listeners ──
  elements.viewStudio.addEventListener("click", () => switchView("studio"));
  elements.viewProjects.addEventListener("click", () => switchView("projects"));
  elements.studioSend.addEventListener("click", studioSendPrompt);
  elements.studioPrompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); studioSendPrompt(); }
  });
  elements.studioPrompt.addEventListener("input", () => renderStudioStatus());
  elements.studioDeepResearch.addEventListener("change", (e) => { studioFeatures.deepResearch = e.target.checked; });
  elements.studioWebTools.addEventListener("change", (e) => { studioFeatures.webTools = e.target.checked; });
  elements.studioQuickResponse.addEventListener("change", (e) => { studioFeatures.quickResponse = e.target.checked; });
  elements.studioVoice.addEventListener("change", (e) => { studioVoiceId = e.target.value; });
  elements.studioVoiceTest.addEventListener("click", () => {
    speakText("Hey, what are you working on? I'm your local dev companion. Let's build something great together.");
  });
  elements.studioVoiceStop.addEventListener("click", stopSpeaking);
  elements.studioNewProject.addEventListener("click", () => {
    void api.invoke("vswirks:createProject");
  });
  elements.studioNewChat.addEventListener("click", () => {
    void api.invoke("vswirks:newChat", { mode: "chat", executionMode: "plan" });
  });
  elements.studioClearProject.addEventListener("click", () => {
    void api.invoke("vswirks:newChat", { mode: "chat", executionMode: "plan" });
  });
  elements.studioExport.addEventListener("click", () => {
    void api.invoke("vswirks:exportConversation");
  });
  elements.studioImport.addEventListener("click", async () => {
    await api.invoke("vswirks:importConversation");
  });
  elements.studioTemplateSelect.addEventListener("change", (e) => {
    const idx = parseInt(e.target.value, 10);
    if (!isNaN(idx) && PROMPT_TEMPLATES[idx]) {
      elements.studioPrompt.value = PROMPT_TEMPLATES[idx].prompt;
      elements.studioPrompt.focus();
    }
    e.target.value = "";
  });
  let searchDebounce = null;
  elements.studioSearch.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const query = elements.studioSearch.value.trim();
    if (!query) {
      elements.studioSearchResults.innerHTML = "";
      return;
    }
    searchDebounce = setTimeout(async () => {
      const result = await api.invoke("vswirks:searchProjectFiles", { query });
      elements.studioSearchResults.innerHTML = "";
      if (result && result.ok && result.results.length) {
        result.results.forEach((file) => {
          const row = document.createElement("div");
          row.className = "search-result-row";
          row.textContent = file;
          row.title = `Click to mention ${file} in chat`;
          row.addEventListener("click", () => {
            elements.studioPrompt.value += `\n[${file}] `;
            elements.studioPrompt.focus();
          });
          elements.studioSearchResults.appendChild(row);
        });
      } else {
        elements.studioSearchResults.innerHTML = '<span class="meta">No results</span>';
      }
    }, 400);
  });
  elements.studioRefreshGit.addEventListener("click", () => refreshGitPanel());
  elements.studioRefreshModels.addEventListener("click", () => refreshModelPanel());

  // Git commit
  elements.studioGitCommitBtn.addEventListener("click", async () => {
    const message = elements.studioGitMessage.value.trim();
    if (!message) return;
    elements.studioGitCommitBtn.disabled = true;
    const result = await api.invoke("vswirks:gitCommit", { message });
    elements.studioGitCommitBtn.disabled = false;
    if (result && result.ok) {
      elements.studioGitMessage.value = "";
      refreshGitPanel();
    } else {
      alert(result ? result.error : "Commit failed");
    }
  });
  elements.studioGitMessage.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); elements.studioGitCommitBtn.click(); }
  });

  // Git branch checkout
  elements.studioGitCheckoutBtn.addEventListener("click", async () => {
    const branch = elements.studioGitBranchSelect.value;
    if (!branch) return;
    const result = await api.invoke("vswirks:gitCheckout", { branch });
    if (result && result.ok) refreshGitPanel();
    else alert(result ? result.error : "Checkout failed");
  });

  // RAG indexing & search
  elements.studioIndexProject.addEventListener("click", indexProject);
  elements.studioRagSearch.addEventListener("click", ragSearch);
  elements.studioSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); ragSearch(); }
  });

  // Auto-context toggle
  elements.studioAutoContext.checked = autoContextEnabled;
  elements.studioAutoContext.addEventListener("change", () => {
    autoContextEnabled = elements.studioAutoContext.checked;
    persisted.autoContext = autoContextEnabled;
    localStorage.setItem("vswirks-ui", JSON.stringify(persisted));
  });

  // Image generation
  elements.studioGenerateImage.addEventListener("click", generateImage);

  // Studio tabs
  [elements.studioTabChat, elements.studioTabTerminal, elements.studioTabCompare].forEach((btn) => {
    btn.addEventListener("click", () => switchStudioPanel(btn.dataset.panel));
  });

  // Terminal
  elements.studioTerminalRun.addEventListener("click", runTerminalCommand);
  elements.studioTerminalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); runTerminalCommand(); }
  });

  // Model compare
  elements.compareRun.addEventListener("click", runModelComparison);
  elements.studioPullModel.addEventListener("click", async () => {
    const name = elements.studioModelName.value.trim();
    if (!name) return;
    elements.studioPullModel.disabled = true;
    elements.studioPullModel.textContent = "Pulling…";
    const result = await api.invoke("vswirks:pullOllamaModel", { name });
    elements.studioPullModel.disabled = false;
    elements.studioPullModel.textContent = "Pull";
    elements.studioModelName.value = "";
    if (result && !result.ok) alert(`Pull failed: ${result.error}`);
    else refreshModelPanel();
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
