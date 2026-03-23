(function () {
  const vscode = acquireVsCodeApi();

  const elements = {
    app: document.querySelector(".app"),
    model: document.getElementById("model"),
    agentProfile: document.getElementById("agentProfile"),
    refreshModels: document.getElementById("refreshModels"),
    openCompanionApp: document.getElementById("openCompanionApp"),
    startService: document.getElementById("startService"),
    serviceStatus: document.getElementById("serviceStatus"),
    newChat: document.getElementById("newChat"),
    threadList: document.getElementById("threadList"),
    workspacePill: document.getElementById("workspacePill"),
    editorPill: document.getElementById("editorPill"),
    selectionPill: document.getElementById("selectionPill"),
    quickActions: document.getElementById("quickActions"),
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

  const persisted = vscode.getState() || {};
  const state = {
    threads: [],
    activeThreadId: "",
    history: [],
    attachments: [],
    models: [],
    agentProfiles: [],
    quickActions: [],
    pending: false,
    selectedModel: persisted.selectedModel || "",
    selectedAgentProfileId: persisted.selectedAgentProfileId || "",
    statusText: "Ready",
    serviceLabel: "Service offline",
    serviceHealthy: false,
    serviceStarting: false,
    workspaceLabel: "No workspace",
    activeEditorLabel: "",
    selectionLabel: ""
  };

  function render() {
    renderModelSelect();
    renderAgentProfileSelect();
    renderThreads();
    renderContext();
    renderQuickActions();
    renderAttachments();
    renderMessages();
    renderService();
    renderStatus();
    persistUi();
  }

  function renderModelSelect() {
    const models = [...new Set(state.models || [])];
    const current = state.selectedModel || (models[0] || "");
    elements.model.innerHTML = "";
    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      elements.model.appendChild(option);
    });
    if (current && !models.includes(current)) {
      const option = document.createElement("option");
      option.value = current;
      option.textContent = current;
      elements.model.appendChild(option);
    }
    elements.model.value = current;
  }

  function renderAgentProfileSelect() {
    const profiles = Array.isArray(state.agentProfiles) ? state.agentProfiles : [];
    const current =
      state.selectedAgentProfileId || (profiles[0] ? profiles[0].id : "");
    elements.agentProfile.innerHTML = "";
    profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.enabled === false ? `${profile.label} (disabled)` : profile.label;
      elements.agentProfile.appendChild(option);
    });
    elements.agentProfile.value = current;
  }

  function renderThreads() {
    elements.threadList.innerHTML = "";
    (state.threads || []).forEach((thread) => {
      const card = document.createElement("div");
      card.className = `thread-chip${thread.id === state.activeThreadId ? " active" : ""}`;

      const selectButton = document.createElement("button");
      selectButton.className = "thread-select";
      selectButton.type = "button";
      selectButton.disabled = state.pending;
      selectButton.addEventListener("click", () => {
        vscode.postMessage({ type: "switchThread", id: thread.id });
      });

      const title = document.createElement("span");
      title.className = "thread-title";
      title.textContent = thread.title || "New chat";

      const meta = document.createElement("span");
      meta.className = "thread-meta";
      meta.textContent = `${thread.agentProfileId || "default"} · ${formatRelativeTime(thread.updatedAt)}`;

      selectButton.appendChild(title);
      selectButton.appendChild(meta);
      card.appendChild(selectButton);

      if ((state.threads || []).length > 1) {
        const remove = document.createElement("button");
        remove.className = "thread-delete";
        remove.type = "button";
        remove.disabled = state.pending;
        remove.textContent = "x";
        remove.title = "Delete chat";
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
      button.textContent = action.label;
      button.title = action.description || action.label;
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
      chip.textContent = `${item.kind}: ${item.label}`;
      chip.title = item.label;
      chip.addEventListener("click", () => {
        vscode.postMessage({ type: "removeAttachment", id: item.id });
      });
      elements.attachments.appendChild(chip);
    });
  }

  function renderMessages() {
    elements.messages.innerHTML = "";
    const history = state.history || [];
    if (!history.length) {
      const empty = document.createElement("section");
      empty.className = "empty-state";
      empty.innerHTML =
        "<h2>Chat and bounded edits stay here.</h2><p>Use this view for explain, review, and selection-level edit help. Full repo runs are handed off to VSWirks App.</p>";
      elements.messages.appendChild(empty);
      return;
    }

    history.forEach((item) => {
      elements.messages.appendChild(
        item.role === "tool" ? renderToolCard(item) : renderConversationCard(item)
      );
    });
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function renderConversationCard(item) {
    const card = document.createElement("article");
    card.className = `message-card ${item.role}`;

    const header = document.createElement("header");
    header.className = "message-header";
    header.innerHTML = `<strong>${item.role === "assistant" ? "VSWirks Editor" : "You"}</strong>`;

    const badges = document.createElement("div");
    badges.className = "message-badges";
    if (item.model) {
      badges.appendChild(createBadge(item.model));
    }
    if (item.status) {
      badges.appendChild(createBadge(item.status));
    }
    header.appendChild(badges);
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "message-body";
    renderRichContent(body, item.content || "");
    card.appendChild(body);

    if (Array.isArray(item.attachments) && item.attachments.length) {
      const foot = document.createElement("div");
      foot.className = "meta";
      foot.textContent = item.attachments.map((entry) => entry.label).join(" | ");
      card.appendChild(foot);
    }

    return card;
  }

  function renderToolCard(item) {
    const card = document.createElement("article");
    card.className = `tool-card${item.error ? " error" : ""}`;
    card.innerHTML = `<div class="tool-header"><div><strong>${item.toolName || "tool"}</strong><div class="meta">${item.summary || ""}</div></div></div>`;
    if (item.content) {
      const detail = document.createElement("pre");
      detail.className = "tool-detail";
      detail.textContent = item.content;
      card.appendChild(detail);
    }
    return card;
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

  function renderStatus() {
    elements.status.textContent = state.statusText || "Ready";
    elements.send.disabled = state.pending || !elements.prompt.value.trim();
    elements.stop.classList.toggle("hidden", !state.pending);
    elements.model.disabled = state.pending;
    elements.agentProfile.disabled = state.pending;
    elements.newChat.disabled = state.pending;
    elements.attachCurrentFile.disabled = state.pending;
    elements.attachImage.disabled = state.pending;
    elements.attachSelection.disabled = state.pending;
    elements.refreshModels.disabled = state.pending || state.serviceStarting;
    elements.startService.disabled = state.pending || state.serviceStarting || state.serviceHealthy;
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
        mode: "chat",
        executionMode: "plan",
        model: state.selectedModel,
        agentProfileId: state.selectedAgentProfileId
      }
    });
    elements.prompt.value = "";
    renderStatus();
  }

  function createBadge(text) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = text;
    return badge;
  }

  function renderRichContent(container, text) {
    const pre = document.createElement("pre");
    pre.className = "tool-detail";
    pre.textContent = text;
    container.appendChild(pre);
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) {
      return "now";
    }
    const diff = Math.max(1, Math.round((Date.now() - Number(timestamp)) / 1000));
    if (diff < 60) {
      return `${diff}s`;
    }
    const minutes = Math.round(diff / 60);
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  }

  function persistUi() {
    vscode.setState({
      selectedModel: state.selectedModel,
      selectedAgentProfileId: state.selectedAgentProfileId
    });
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "state":
        state.threads = message.threads || [];
        state.activeThreadId = message.activeThreadId || "";
        state.history = message.history || [];
        state.attachments = message.attachments || [];
        state.quickActions = message.quickActions || [];
        state.pending = Boolean(message.pending);
        state.statusText = message.statusText || "Ready";
        state.serviceLabel = message.serviceLabel || "Service offline";
        state.serviceHealthy = Boolean(message.serviceHealthy);
        state.serviceStarting = Boolean(message.serviceStarting);
        state.workspaceLabel = message.workspaceLabel || "No workspace";
        state.activeEditorLabel = message.activeEditorLabel || "";
        state.selectionLabel = message.selectionLabel || "";
        state.agentProfiles = message.agentProfiles || [];
        if (Array.isArray(message.models)) {
          state.models = message.models;
        }
        if (typeof message.selectedModel === "string") {
          state.selectedModel = message.selectedModel;
        }
        if (typeof message.selectedAgentProfileId === "string") {
          state.selectedAgentProfileId = message.selectedAgentProfileId;
        }
        render();
        break;
      case "models":
        state.models = message.models || [];
        if (typeof message.selected === "string") {
          state.selectedModel = message.selected;
        }
        render();
        break;
      case "prefillPrompt":
        elements.prompt.value = message.prompt || "";
        if (typeof message.agentProfileId === "string") {
          state.selectedAgentProfileId = message.agentProfileId;
        }
        render();
        elements.prompt.focus();
        break;
      case "focusInput":
        elements.prompt.focus();
        break;
      case "error":
        state.statusText = message.message || "Error";
        render();
        break;
      default:
        break;
    }
  });

  elements.refreshModels.addEventListener("click", () => {
    vscode.postMessage({ type: "refreshModels" });
  });
  elements.openCompanionApp.addEventListener("click", () => {
    vscode.postMessage({ type: "openCompanionApp" });
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
  elements.send.addEventListener("click", sendPrompt);
  elements.prompt.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      sendPrompt();
    }
  });
  elements.prompt.addEventListener("input", renderStatus);
  elements.model.addEventListener("change", () => {
    state.selectedModel = elements.model.value;
    vscode.postMessage({
      type: "updateThreadSettings",
      payload: {
        model: state.selectedModel
      }
    });
    persistUi();
  });
  elements.agentProfile.addEventListener("change", () => {
    state.selectedAgentProfileId = elements.agentProfile.value;
    vscode.postMessage({
      type: "updateThreadSettings",
      payload: {
        agentProfileId: state.selectedAgentProfileId
      }
    });
    persistUi();
  });

  render();
  vscode.postMessage({ type: "ready" });
})();
