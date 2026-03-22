(function () {
  const vscode = acquireVsCodeApi();
  const persistedUi = vscode.getState() || {};

  const elements = {
    app: document.querySelector(".app"),
    mode: document.getElementById("mode"),
    model: document.getElementById("model"),
    refreshModels: document.getElementById("refreshModels"),
    openCompanionApp: document.getElementById("openCompanionApp"),
    togglePanels: document.getElementById("togglePanels"),
    startService: document.getElementById("startService"),
    serviceStatus: document.getElementById("serviceStatus"),
    newChat: document.getElementById("newChat"),
    threadList: document.getElementById("threadList"),
    workspacePill: document.getElementById("workspacePill"),
    editorPill: document.getElementById("editorPill"),
    selectionPill: document.getElementById("selectionPill"),
    quickActions: document.getElementById("quickActions"),
    chatTemperature: document.getElementById("chatTemperature"),
    chatTopP: document.getElementById("chatTopP"),
    chatMaxTokens: document.getElementById("chatMaxTokens"),
    agentTemperature: document.getElementById("agentTemperature"),
    agentTopP: document.getElementById("agentTopP"),
    agentMaxTokens: document.getElementById("agentMaxTokens"),
    saveGenerationSettings: document.getElementById("saveGenerationSettings"),
    resetGenerationSettings: document.getElementById("resetGenerationSettings"),
    executionMode: document.getElementById("executionMode"),
    executionModeLabel: document.getElementById("executionModeLabel"),
    attachments: document.getElementById("attachments"),
    messages: document.getElementById("messages"),
    attachCurrentFile: document.getElementById("attachCurrentFile"),
    attachImage: document.getElementById("attachImage"),
    attachSelection: document.getElementById("attachSelection"),
    stop: document.getElementById("stop"),
    prompt: document.getElementById("prompt"),
    status: document.getElementById("status"),
    send: document.getElementById("send")
  };

  let state = {
    threads: [],
    activeThreadId: "",
    history: [],
    attachments: [],
    models: [],
    quickActions: [],
    pending: false,
    selectedModel: persistedUi.model || "",
    statusText: "Ready",
    serviceLabel: "Service offline",
    serviceHealthy: false,
    serviceStarting: false,
    generationSettings: defaultGenerationSettings(),
    executionMode: persistedUi.executionMode || "plan",
    focusChat: Boolean(persistedUi.focusChat),
    workspaceLabel: "No workspace",
    activeEditorLabel: "",
    selectionLabel: ""
  };
  let flashStatus = "";
  let flashHandle = undefined;
  let generationDraft = normalizeGenerationDraft(persistedUi.generationDraft);

  if (persistedUi.mode) {
    elements.mode.value = persistedUi.mode;
  }
  if (persistedUi.draft) {
    elements.prompt.value = persistedUi.draft;
  }

  function render() {
    if (state.mode) {
      elements.mode.value = state.mode;
    }
    if (state.models.length) {
      updateModels(state.models, state.selectedModel);
    }

    renderThreads();
    renderContext();
    renderQuickActions();
    renderService();
    renderGenerationSettings();
    renderExecutionMode();
    renderFocusMode();
    renderAttachments();
    renderMessages();
    applyPromptPlaceholder();
    autoResizePrompt();

    const statusText = flashStatus || state.statusText || (state.pending ? "Working" : "Ready");
    elements.status.textContent = statusText;
    elements.stop.classList.toggle("hidden", !state.pending);
    elements.send.disabled = state.pending;
    elements.newChat.disabled = state.pending;
    elements.attachCurrentFile.disabled = state.pending;
    elements.attachImage.disabled = state.pending;
    elements.attachSelection.disabled = state.pending;
    elements.mode.disabled = state.pending;
    elements.model.disabled = state.pending;
    elements.executionMode.disabled = state.pending;
    elements.refreshModels.disabled = state.pending || state.serviceStarting;
    elements.startService.disabled = state.pending || state.serviceStarting || state.serviceHealthy;
    elements.saveGenerationSettings.disabled = state.serviceStarting;
    elements.resetGenerationSettings.disabled = state.serviceStarting;
  }

  function renderService() {
    const label = state.serviceStarting
      ? "Starting ai-runtime"
      : state.serviceLabel || (state.serviceHealthy ? "Service ready" : "Service offline");
    elements.serviceStatus.textContent = label;
    elements.serviceStatus.className =
      `service-pill ${state.serviceHealthy ? "online" : state.serviceStarting ? "starting" : "offline"}`;
    elements.startService.textContent = state.serviceHealthy
      ? "Running"
      : state.serviceStarting
        ? "Starting..."
        : "Start Service";
  }

  function renderGenerationSettings() {
    const values = generationDraft || state.generationSettings || defaultGenerationSettings();
    setInputValue(elements.chatTemperature, values.chatTemperature);
    setInputValue(elements.chatTopP, values.chatTopP);
    setInputValue(elements.chatMaxTokens, values.chatMaxTokens);
    setInputValue(elements.agentTemperature, values.agentTemperature);
    setInputValue(elements.agentTopP, values.agentTopP);
    setInputValue(elements.agentMaxTokens, values.agentMaxTokens);
  }

  function renderExecutionMode() {
    const mode = state.executionMode === "act" ? "act" : "plan";
    elements.executionMode.value = mode === "act" ? "1" : "0";
    elements.executionModeLabel.textContent =
      mode === "act"
        ? elements.mode.value === "agent"
          ? "Take action in the workspace"
          : "Ready to act once you switch to Agent"
        : "Plan only, no writes";
  }

  function renderFocusMode() {
    const focusChat = Boolean(state.focusChat);
    if (elements.app) {
      elements.app.classList.toggle("focus-chat", focusChat);
    }
    elements.togglePanels.textContent = focusChat ? "Show Panels" : "Focus Chat";
    elements.togglePanels.title = focusChat
      ? "Show thread, context, and settings panels"
      : "Hide non-chat panels and expand the message area";
  }

  function renderThreads() {
    elements.threadList.innerHTML = "";

    (state.threads || []).forEach((thread) => {
      const card = document.createElement("div");
      card.className = `thread-chip${thread.id === state.activeThreadId ? " active" : ""}`;

      const selectButton = document.createElement("button");
      selectButton.className = "thread-select";
      selectButton.disabled = state.pending;
      selectButton.addEventListener("click", () => {
        vscode.postMessage({ type: "switchThread", id: thread.id });
      });

      const title = document.createElement("span");
      title.className = "thread-title";
      title.textContent = thread.title || "New chat";

      const meta = document.createElement("span");
      meta.className = "thread-meta";
      meta.textContent = `${thread.mode || "chat"} · ${thread.executionMode || "plan"} · ${formatRelativeTime(thread.updatedAt)}`;

      selectButton.appendChild(title);
      selectButton.appendChild(meta);
      card.appendChild(selectButton);

      if ((state.threads || []).length > 1) {
        const remove = document.createElement("button");
        remove.className = "thread-delete";
        remove.type = "button";
        remove.disabled = state.pending;
        remove.title = "Delete chat";
        remove.textContent = "x";
        remove.addEventListener("click", () => {
          vscode.postMessage({ type: "deleteThread", id: thread.id });
        });
        card.appendChild(remove);
      }

      elements.threadList.appendChild(card);
    });
  }

  function renderContext() {
    elements.workspacePill.textContent = state.workspaceLabel || "No workspace";

    if (state.activeEditorLabel) {
      elements.editorPill.classList.remove("hidden");
      elements.editorPill.textContent = state.activeEditorLabel;
    } else {
      elements.editorPill.classList.add("hidden");
      elements.editorPill.textContent = "";
    }

    if (state.selectionLabel) {
      elements.selectionPill.classList.remove("hidden");
      elements.selectionPill.textContent = state.selectionLabel;
    } else {
      elements.selectionPill.classList.add("hidden");
      elements.selectionPill.textContent = "";
    }
  }

  function renderQuickActions() {
    elements.quickActions.innerHTML = "";
    (state.quickActions || []).forEach((action) => {
      const button = document.createElement("button");
      button.className = "quick-action";
      button.type = "button";
      button.disabled = state.pending;
      button.title = action.description || action.label;
      button.textContent = action.label;
      button.addEventListener("click", () => {
        vscode.postMessage({ type: "runQuickAction", id: action.id });
      });
      elements.quickActions.appendChild(button);
    });
  }

  function renderAttachments() {
    const attachments = state.attachments || [];
    elements.attachments.innerHTML = "";
    elements.attachments.classList.toggle("hidden", attachments.length === 0);

    attachments.forEach((item) => {
      const chip = document.createElement("button");
      chip.className = "attachment-chip";
      chip.type = "button";
      chip.title = item.label;
      chip.textContent = `${item.kind}: ${item.label}`;
      chip.addEventListener("click", () => {
        vscode.postMessage({ type: "removeAttachment", id: item.id });
      });
      elements.attachments.appendChild(chip);
    });
  }

  function renderMessages() {
    elements.messages.innerHTML = "";

    if (!(state.history || []).length) {
      const empty = document.createElement("section");
      empty.className = "empty-state";

      const heading = document.createElement("h2");
      heading.textContent = "Work the codebase like a local copilot.";
      empty.appendChild(heading);

      const copy = document.createElement("p");
      copy.textContent =
        "Use plan mode for concrete repo plans, then slide to act when you want the agent to scaffold or edit the workspace through ai-runtime. In an empty folder, act mode can build the full repo instead of stopping at a demo, including from an attached mockup or photo.";
      empty.appendChild(copy);

      const grid = document.createElement("div");
      grid.className = "starter-grid";

      (state.quickActions || []).forEach((action) => {
        const card = document.createElement("button");
        card.className = "starter-card";
        card.type = "button";
        card.disabled = state.pending;

        const title = document.createElement("strong");
        title.textContent = action.label;
        card.appendChild(title);

        const description = document.createElement("span");
        description.textContent = action.description || "";
        card.appendChild(description);

        card.addEventListener("click", () => {
          vscode.postMessage({ type: "runQuickAction", id: action.id });
        });

        grid.appendChild(card);
      });

      empty.appendChild(grid);
      elements.messages.appendChild(empty);
      return;
    }

    (state.history || []).forEach((item) => {
      const node = item.role === "tool" ? renderToolCard(item) : renderConversationCard(item);
      elements.messages.appendChild(node);
    });

    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function renderConversationCard(item) {
    const wrapper = document.createElement("article");
    wrapper.className = `message-card ${item.role}`;

    const header = document.createElement("header");
    header.className = "message-header";

    const title = document.createElement("div");
    title.className = "message-title";
    title.textContent = item.role === "assistant" ? "Assistant" : "You";
    header.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "message-badges";

    if (item.model) {
      meta.appendChild(createBadge(item.model, "subtle"));
    }
    if (item.mode) {
      meta.appendChild(createBadge(item.mode, "mode"));
    }
    if (item.executionMode) {
      meta.appendChild(createBadge(item.executionMode, "intent"));
    }
    if (item.status) {
      meta.appendChild(createBadge(item.status, "status"));
    }
    header.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "ghost-button";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", () => {
      void copyToClipboard(item.content || "");
    });
    actions.appendChild(copyButton);
    header.appendChild(actions);

    wrapper.appendChild(header);

    const body = document.createElement("div");
    body.className = "message-body";
    renderRichContent(body, item.content || "");
    wrapper.appendChild(body);

    if (item.attachments && item.attachments.length) {
      const attachments = document.createElement("div");
      attachments.className = "message-footnote";
      attachments.textContent = item.attachments.map((entry) => entry.label).join(" | ");
      wrapper.appendChild(attachments);
    }

    if (item.usage) {
      const usage = document.createElement("div");
      usage.className = "message-footnote";
      usage.textContent =
        `tokens ${item.usage.total_tokens || "?"}` +
        ` | prompt ${item.usage.prompt_tokens || "?"}` +
        ` | completion ${item.usage.completion_tokens || "?"}`;
      wrapper.appendChild(usage);
    }

    return wrapper;
  }

  function renderToolCard(item) {
    const wrapper = document.createElement("article");
    wrapper.className = `tool-card${item.error ? " error" : ""}`;

    const header = document.createElement("header");
    header.className = "tool-header";

    const left = document.createElement("div");
    left.className = "tool-title";

    const title = document.createElement("strong");
    title.textContent = item.toolName || "tool";
    left.appendChild(title);

    const summary = document.createElement("span");
    summary.textContent = item.summary || "";
    left.appendChild(summary);

    header.appendChild(left);

    if (item.path) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "ghost-button";
      open.textContent = "Open";
      open.addEventListener("click", () => {
        vscode.postMessage({ type: "openFile", path: item.path });
      });
      header.appendChild(open);
    }

    wrapper.appendChild(header);

    if (item.content) {
      const detail = document.createElement("pre");
      detail.className = "tool-detail";
      detail.textContent = item.content;
      wrapper.appendChild(detail);
    }

    return wrapper;
  }

  function renderRichContent(container, text) {
    const segments = splitIntoSegments(text);
    if (!segments.length) {
      const paragraph = document.createElement("p");
      paragraph.textContent = "";
      container.appendChild(paragraph);
      return;
    }

    segments.forEach((segment) => {
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
        segments.push({
          type: "text",
          text: source.slice(lastIndex, match.index)
        });
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
      segments.push({
        type: "text",
        text: source.slice(lastIndex)
      });
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

    if (!blocks.length) {
      return;
    }

    blocks.forEach((block) => {
      const lines = block.split("\n");
      const trimmed = block.trim();

      if (trimmed.startsWith("#")) {
        const heading = document.createElement("h3");
        heading.textContent = trimmed.replace(/^#+\s*/, "");
        container.appendChild(heading);
        return;
      }

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

      if (lines.every((line) => /^\s*\d+\.\s/.test(line))) {
        const list = document.createElement("ol");
        lines.forEach((line) => {
          const item = document.createElement("li");
          appendInlineContent(item, line.replace(/^\s*\d+\.\s*/, ""));
          list.appendChild(item);
        });
        container.appendChild(list);
        return;
      }

      if (lines.every((line) => line.trim().startsWith(">"))) {
        const quote = document.createElement("blockquote");
        appendInlineContent(
          quote,
          lines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n")
        );
        container.appendChild(quote);
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
        appendTextFragment(parent, text.slice(lastIndex, match.index));
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
      appendTextFragment(parent, text.slice(lastIndex));
    }
  }

  function appendTextFragment(parent, text) {
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
    label.className = "code-label";
    label.textContent = segment.language || "text";
    header.appendChild(label);

    if (segment.meta) {
      const meta = document.createElement("span");
      meta.className = "code-meta";
      meta.textContent = segment.meta;
      header.appendChild(meta);
    }

    const actions = document.createElement("div");
    actions.className = "code-actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost-button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      void copyToClipboard(segment.code);
    });
    actions.appendChild(copy);

    const insert = document.createElement("button");
    insert.type = "button";
    insert.className = "ghost-button";
    insert.textContent = "Insert";
    insert.addEventListener("click", () => {
      vscode.postMessage({
        type: "insertCodeAtCursor",
        content: segment.code
      });
    });
    actions.appendChild(insert);

    const scratch = document.createElement("button");
    scratch.type = "button";
    scratch.className = "ghost-button";
    scratch.textContent = "Scratch";
    scratch.addEventListener("click", () => {
      vscode.postMessage({
        type: "openScratchBuffer",
        content: segment.code,
        language: segment.language || ""
      });
    });
    actions.appendChild(scratch);

    header.appendChild(actions);
    shell.appendChild(header);

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = segment.code;
    pre.appendChild(code);
    shell.appendChild(pre);

    return shell;
  }

  function createBadge(text, variant) {
    const badge = document.createElement("span");
    badge.className = `badge ${variant || ""}`.trim();
    badge.textContent = text;
    return badge;
  }

  function updateModels(models, selected) {
    const currentValue = selected || elements.model.value || persistedUi.model || "";
    const uniqueModels = [...new Set(models || [])];
    elements.model.innerHTML = "";
    uniqueModels.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      elements.model.appendChild(option);
    });
    if (uniqueModels.length) {
      elements.model.value = uniqueModels.includes(currentValue)
        ? currentValue
        : uniqueModels[0];
    }
    rememberUiState();
  }

  function sendPrompt() {
    const prompt = elements.prompt.value.trim();
    if (!prompt || state.pending) {
      return;
    }
    vscode.postMessage({
      type: "sendPrompt",
      payload: {
        prompt,
        mode: elements.mode.value,
        model: elements.model.value,
        executionMode: getExecutionModeValue()
      }
    });
    elements.prompt.value = "";
    rememberUiState();
    autoResizePrompt();
  }

  function applyPromptPlaceholder() {
    const acting = getExecutionModeValue() === "act";
    elements.prompt.placeholder =
      elements.mode.value === "agent"
        ? acting
          ? "Describe the task. Act mode can inspect the workspace and scaffold or edit files."
          : "Describe the task. Plan mode will inspect the workspace and return a concrete plan without editing files."
        : acting
          ? "Chat mode still replies in text. Switch to Agent when you want the workspace changed."
          : "Ask for analysis, planning, scaffolding, or code explanations.";
  }

  function autoResizePrompt() {
    elements.prompt.style.height = "auto";
    elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 280)}px`;
  }

  function rememberUiState() {
    vscode.setState({
      draft: elements.prompt.value,
      mode: elements.mode.value,
      model: elements.model.value,
      executionMode: getExecutionModeValue(),
      generationDraft,
      focusChat: state.focusChat
    });
  }

  function getExecutionModeValue() {
    return elements.executionMode.value === "1" ? "act" : "plan";
  }

  function defaultGenerationSettings() {
    return {
      chatTemperature: 0.2,
      chatTopP: 0.9,
      chatMaxTokens: 4096,
      agentTemperature: 0.1,
      agentTopP: 0.85,
      agentMaxTokens: 4096
    };
  }

  function normalizeGenerationDraft(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    return {
      chatTemperature: Number(value.chatTemperature),
      chatTopP: Number(value.chatTopP),
      chatMaxTokens: Number(value.chatMaxTokens),
      agentTemperature: Number(value.agentTemperature),
      agentTopP: Number(value.agentTopP),
      agentMaxTokens: Number(value.agentMaxTokens)
    };
  }

  function sameGenerationSettings(left, right) {
    const a = left || {};
    const b = right || {};
    return (
      Number(a.chatTemperature) === Number(b.chatTemperature) &&
      Number(a.chatTopP) === Number(b.chatTopP) &&
      Number(a.chatMaxTokens) === Number(b.chatMaxTokens) &&
      Number(a.agentTemperature) === Number(b.agentTemperature) &&
      Number(a.agentTopP) === Number(b.agentTopP) &&
      Number(a.agentMaxTokens) === Number(b.agentMaxTokens)
    );
  }

  function readGenerationForm() {
    return {
      chatTemperature: Number(elements.chatTemperature.value),
      chatTopP: Number(elements.chatTopP.value),
      chatMaxTokens: Number(elements.chatMaxTokens.value),
      agentTemperature: Number(elements.agentTemperature.value),
      agentTopP: Number(elements.agentTopP.value),
      agentMaxTokens: Number(elements.agentMaxTokens.value)
    };
  }

  function captureGenerationDraft() {
    generationDraft = readGenerationForm();
    rememberUiState();
  }

  function setInputValue(element, value) {
    if (!element) {
      return;
    }
    const normalized = String(value ?? "");
    if (element.value !== normalized) {
      element.value = normalized;
    }
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      return;
    }
    setFlashStatus("Copied");
  }

  function setFlashStatus(text) {
    flashStatus = text;
    render();
    if (flashHandle) {
      window.clearTimeout(flashHandle);
    }
    flashHandle = window.setTimeout(() => {
      flashStatus = "";
      render();
    }, 1600);
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
    const days = Math.round(hours / 24);
    return `${days}d`;
  }

  elements.send.addEventListener("click", sendPrompt);
  elements.refreshModels.addEventListener("click", () => {
    vscode.postMessage({ type: "refreshModels" });
  });
  elements.openCompanionApp.addEventListener("click", () => {
    vscode.postMessage({ type: "openCompanionApp" });
  });
  elements.togglePanels.addEventListener("click", () => {
    state.focusChat = !state.focusChat;
    rememberUiState();
    render();
  });
  elements.startService.addEventListener("click", () => {
    vscode.postMessage({ type: "startService" });
  });
  elements.newChat.addEventListener("click", () => {
    vscode.postMessage({ type: "newChat" });
  });
  elements.attachCurrentFile.addEventListener("click", () => {
    vscode.postMessage({ type: "attachCurrentFile" });
  });
  elements.attachImage.addEventListener("click", () => {
    vscode.postMessage({ type: "attachImage" });
  });
  elements.attachSelection.addEventListener("click", () => {
    vscode.postMessage({ type: "attachSelection" });
  });
  elements.stop.addEventListener("click", () => {
    vscode.postMessage({ type: "abort" });
  });
  elements.mode.addEventListener("change", () => {
    rememberUiState();
    renderExecutionMode();
    applyPromptPlaceholder();
  });
  elements.model.addEventListener("change", rememberUiState);
  elements.executionMode.addEventListener("input", () => {
    state.executionMode = getExecutionModeValue();
    rememberUiState();
    renderExecutionMode();
    applyPromptPlaceholder();
  });
  [
    elements.chatTemperature,
    elements.chatTopP,
    elements.chatMaxTokens,
    elements.agentTemperature,
    elements.agentTopP,
    elements.agentMaxTokens
  ].forEach((element) => {
    element.addEventListener("input", captureGenerationDraft);
  });
  elements.saveGenerationSettings.addEventListener("click", () => {
    const payload = readGenerationForm();
    vscode.postMessage({ type: "saveGenerationSettings", payload });
  });
  elements.resetGenerationSettings.addEventListener("click", () => {
    generationDraft = null;
    rememberUiState();
    vscode.postMessage({ type: "resetGenerationSettings" });
  });
  elements.prompt.addEventListener("input", () => {
    rememberUiState();
    autoResizePrompt();
  });
  elements.prompt.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      sendPrompt();
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "state":
        state = {
          ...state,
          threads: message.threads || [],
          activeThreadId: message.activeThreadId || "",
          history: message.history || [],
          attachments: message.attachments || [],
          pending: Boolean(message.pending),
          quickActions: message.quickActions || [],
          selectedModel:
            typeof message.selectedModel === "string"
              ? message.selectedModel
              : state.selectedModel,
          statusText: message.statusText || state.statusText,
          serviceLabel: message.serviceLabel || state.serviceLabel,
          serviceHealthy: Boolean(message.serviceHealthy),
          serviceStarting: Boolean(message.serviceStarting),
          generationSettings: message.generationSettings || state.generationSettings,
          executionMode: message.executionMode || state.executionMode || getExecutionModeValue(),
          workspaceLabel: message.workspaceLabel || "No workspace",
          activeEditorLabel: message.activeEditorLabel || "",
          selectionLabel: message.selectionLabel || "",
          mode: message.mode || state.mode || elements.mode.value
        };
        if (generationDraft && sameGenerationSettings(generationDraft, state.generationSettings)) {
          generationDraft = null;
          rememberUiState();
        }
        render();
        break;
      case "models":
        state.models = message.models || [];
        updateModels(state.models, message.selected || state.selectedModel);
        render();
        break;
      case "error":
        flashStatus = "";
        state.pending = false;
        state.statusText = message.message;
        render();
        break;
      case "toolEvent":
        setFlashStatus(message.label);
        break;
      case "focusInput":
        elements.prompt.focus();
        break;
      case "prefillPrompt":
        if (message.mode) {
          elements.mode.value = message.mode;
        }
        if (message.executionMode) {
          state.executionMode = message.executionMode;
        }
        elements.prompt.value = message.prompt || "";
        renderExecutionMode();
        rememberUiState();
        applyPromptPlaceholder();
        autoResizePrompt();
        elements.prompt.focus();
        break;
      default:
        break;
    }
  });

  applyPromptPlaceholder();
  autoResizePrompt();
  render();
  vscode.postMessage({ type: "ready" });
})();
