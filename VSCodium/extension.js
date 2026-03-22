const vscode = require("vscode");
const fs = require("fs/promises");
const path = require("path");
const cp = require("child_process");
const {
  readBridgeState,
  updateBridgeState,
  resolveBridgeStatePath
} = require("../shared/vswirks-state");
const {
  fetchRuntimeJson: sharedFetchRuntimeJson,
  streamRuntimeChat: sharedStreamRuntimeChat,
  probeRuntimeHealth: sharedProbeRuntimeHealth,
  waitForRuntimeHealthy: sharedWaitForRuntimeHealthy
} = require("../shared/runtime-client");
const {
  appendRipgrepIgnoreGlobs,
  filterIgnoredWorkspacePaths,
  isIgnoredWorkspacePath,
  isSkippableWorkspaceRootEntry: sharedIsSkippableWorkspaceRootEntry
} = require("../shared/workspace-filters");
const {
  delay: sharedDelay,
  clampNumber: sharedClampNumber,
  normalizeExecutionMode: sharedNormalizeExecutionMode,
  normalizeWriteApprovalMode: sharedNormalizeWriteApprovalMode,
  makeId: sharedMakeId,
  safeJsonParse: sharedSafeJsonParse,
  limitText: sharedLimitText,
  titleFromPrompt: sharedTitleFromPrompt,
  looksLikeRepoCreationRequest: sharedLooksLikeRepoCreationRequest
} = require("../shared/core");

const VIEW_ID = "bluewirksLocalAgent.chatView";
const CONTAINER_ID = "bluewirksLocalAgent";
const CHAT_PARTICIPANT_ID = "bluewirks.bluewirks-local-agent.local";
const STORAGE_KEY = "bluewirksLocalAgent.state.v2";
const MAX_STORED_THREADS = 20;
const MAX_TOOL_DETAIL_CHARS = 2200;
const LEGACY_DEFAULT_MODEL = "qwen2.5-coder:14b-instruct";
const DEFAULT_MODEL = "devstral-small-2";
const DEFAULT_EXECUTION_MODE = "plan";
const DEFAULT_RUNTIME_CWD = "/Users/bluewirks.max/dev/ai-runtime";
const DEFAULT_RUNTIME_PYTHON = "/Users/bluewirks.max/dev/ai-app/.venv/bin/python";
const DEFAULT_COMPANION_APP_PATH = path.resolve(__dirname, "..", "vswirks-app");
const LEGACY_COMPANION_APP_PATH = "/Users/bluewirks.max/Documents/VSCodium/vswirks-app";
const PACKAGED_COMPANION_APP_PATH = "/Applications/VSWirks App.app";
const SERVICE_START_TIMEOUT_MS = 12000;
const WORKSPACE_INSTRUCTIONS_PATH = path.join(".github", "copilot-instructions.md");
const WORKSPACE_TARGET_CONFIG_KEY = "workspaceTarget";
const BRIDGE_SYNC_CHAR_LIMIT = 12000;
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff"
]);
const IMAGE_PICKER_FILTERS = Object.freeze({
  Images: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif", "tif", "tiff"]
});
const IMAGE_OCR_CHAR_LIMIT = 4000;
let globalWriteApprovalMode = "ask";
const DEFAULT_GENERATION_SETTINGS = Object.freeze({
  chatTemperature: 0.2,
  chatTopP: 0.9,
  chatMaxTokens: 4096,
  agentTemperature: 0.1,
  agentTopP: 0.85,
  agentMaxTokens: 4096
});
const DEFAULT_SYSTEM_PROMPT =
  "You are a local-first coding assistant inside VSCodium. " +
  "Be concise, practical, and safe. Prefer workspace tools when you need codebase context. " +
  "When using write_file, write complete file contents. " +
  "When the user asks to create a new app or repository, produce production-ready output rather than demo placeholders.";
const NATIVE_CHAT_FOOTER =
  "\n\nLocal notes:\n- Backend: ai-runtime on 127.0.0.1\n- Writes stay inside the open workspace\n- Existing files are backed up before overwrite\n";

const QUICK_ACTIONS = [
  {
    id: "explainSelection",
    label: "Explain Selection",
    description: "Attach the current selection and explain it clearly.",
    mode: "chat",
    executionMode: "plan",
    attach: "selection",
    prompt:
      "Explain the attached selection. Cover purpose, control flow, risks, and likely change points."
  },
  {
    id: "reviewFile",
    label: "Review Open File",
    description: "Read the current file and call out bugs, regressions, and missing tests.",
    mode: "chat",
    executionMode: "plan",
    attach: "file",
    prompt:
      "Review the attached file. Prioritize bugs, risky behavior, regressions, and missing tests."
  },
  {
    id: "scaffoldFromImage",
    label: "Scaffold From Photo",
    description: "Attach a screenshot or photo and scaffold a real repo from it.",
    mode: "agent",
    executionMode: "act",
    attach: "image",
    prompt:
      "Create a complete React project structure from the attached image, including Tailwind CSS styling that matches the reference as closely as possible. If the workspace is empty, scaffold the full repository here with real source files, configuration, and a README."
  },
  {
    id: "scaffoldFeature",
    label: "Scaffold Feature",
    description: "Switch to agent mode and propose the file plan before editing.",
    mode: "agent",
    executionMode: "act",
    attach: "none",
    prompt:
      "Scaffold this feature in the current workspace. If the workspace is empty, create a full production-ready repository here, not a demo. First outline the file plan, then make the necessary edits or additions."
  },
  {
    id: "refactorFile",
    label: "Refactor File",
    description: "Attach the current file and refactor it with explicit tradeoffs.",
    mode: "agent",
    executionMode: "act",
    attach: "file",
    prompt:
      "Refactor the attached file for clarity and maintainability. Explain the tradeoffs before changing behavior."
  },
  {
    id: "generateTests",
    label: "Add Tests",
    description: "Attach the current file and generate focused tests around its behavior.",
    mode: "agent",
    executionMode: "act",
    attach: "file",
    prompt:
      "Generate or update focused tests for the attached file. Cover important behavior, edge cases, and regressions."
  }
];

function activate(context) {
  const provider = new BlueWirksAgentViewProvider(context);
  context.subscriptions.push(provider.startAppSelectionWatcher());

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bluewirksLocalAgent.focus", async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      provider.focusInput();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bluewirksLocalAgent.attachCurrentFile", async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.attachCurrentEditor(false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bluewirksLocalAgent.attachImage", async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.attachImageFromPicker();
      provider.focusInput();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bluewirksLocalAgent.sendSelection", async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.attachCurrentEditor(true);
      provider.focusInput();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bluewirksLocalAgent.openCompanionApp", async () => {
      await provider.openCompanionApp();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bluewirksLocalAgent.newChat", async () => {
      await provider.createNewThread();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bluewirksLocalAgent.setWorkspaceTarget", async (uri) => {
      await provider.setWorkspaceTarget(uri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bluewirksLocalAgent.clearWorkspaceTarget", async () => {
      await provider.clearWorkspaceTarget();
    })
  );

  registerNativeChatParticipant(context);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      provider.postState();
      void provider.syncBridgeState();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const activeEditor = vscode.window.activeTextEditor;
      if (
        activeEditor &&
        event.textEditor.document.uri.toString() === activeEditor.document.uri.toString()
      ) {
        provider.postState();
        void provider.syncBridgeState();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      provider.postState();
      void provider.syncBridgeState();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("bluewirksLocalAgent")) {
        void provider.handleConfigurationChange();
      }
    })
  );
}

function registerNativeChatParticipant(context) {
  const integration = new NativeChatIntegration(context);
  const participant = vscode.chat.createChatParticipant(
    CHAT_PARTICIPANT_ID,
    integration.handleRequest.bind(integration)
  );
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.svg");
  participant.followupProvider = {
    provideFollowups: integration.provideFollowups.bind(integration)
  };
  context.subscriptions.push(participant);
}

class NativeChatIntegration {
  constructor(context) {
    this.context = context;
    this.serviceState = {
      healthy: false,
      starting: false,
      label: "Service offline"
    };
  }

  async handleRequest(request, context, response, token) {
    const commandName = normalizeChatCommand(request.command);
    const commandSpec = getNativeChatCommandSpec(commandName);
    const model = await getConfiguredDefaultModel();
    const workspaceLabel = getWorkspaceLabel();

    response.progress(`VSWirks Local using ${model}`);
    if (workspaceLabel) {
      response.progress(`Workspace: ${workspaceLabel}`);
    }

    const userPrompt = await buildNativePrompt(request, commandSpec);
    const messages = await buildNativeApiMessages(context.history, userPrompt);

    if (commandSpec.mode === "agent") {
      const result = await this.runAgentRequest(commandSpec, model, messages, response, token);
      const footer = touchedPathsMarkdown(result.touchedPaths);
      if (footer) {
        response.markdown(footer);
      }
      response.button({
        command: "bluewirksLocalAgent.focus",
        title: "Open VSWirks Editor Sidebar"
      });
      return {
        metadata: {
          command: commandSpec.name,
          mode: commandSpec.mode,
          executionMode: commandSpec.executionMode,
          model,
          touchedPaths: result.touchedPaths
        }
      };
    }

    await this.runChatRequest(commandSpec, model, messages, response, token);
    response.button({
      command: "bluewirksLocalAgent.focus",
      title: "Open VSWirks Editor Sidebar"
    });

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      response.reference(activeEditor.document.uri);
    }

    return {
      metadata: {
        command: commandSpec.name,
        mode: commandSpec.mode,
        executionMode: commandSpec.executionMode,
        model
      }
    };
  }

  provideFollowups(result) {
    const commandName =
      result &&
      result.metadata &&
      typeof result.metadata.command === "string"
        ? result.metadata.command
        : "ask";

    switch (commandName) {
      case "review":
        return [
          {
            prompt: "Explain the most serious issue in more detail.",
            label: "Deepen Review"
          },
          {
            prompt: "Suggest the tests needed to cover the risky behavior.",
            label: "Add Tests",
            command: "test"
          }
        ];
      case "scaffold":
        return [
          {
            prompt: "Refine the generated structure for maintainability.",
            label: "Refactor",
            command: "refactor"
          },
          {
            prompt: "Add focused tests for the generated files.",
            label: "Add Tests",
            command: "test"
          }
        ];
      default:
        return [
          {
            prompt: "Review the current file or selection for bugs and regressions.",
            label: "Review Current Code",
            command: "review"
          },
          {
            prompt: "Scaffold the next feature in this workspace.",
            label: "Scaffold Feature",
            command: "scaffold"
          }
        ];
    }
  }

  async runChatRequest(commandSpec, model, messages, response, token) {
    let streamed = "";
    let usage = undefined;
    const generation = getGenerationOptions("chat", model);

    await streamRuntimeChat(
      {
        model,
        stream: true,
        ...generation,
        messages,
        stream_options: {
          include_usage: true
        }
      },
      token,
      {
        onText: (chunk) => {
          streamed += chunk;
          response.markdown(chunk);
        },
        onUsage: (nextUsage) => {
          usage = nextUsage;
        }
      }
    );

    if (!streamed.trim()) {
      response.markdown("_No response returned._");
    }

    if (usage) {
      response.markdown(
        `\n\n_Tokens: ${usage.total_tokens || "?"} total, ${usage.prompt_tokens || "?"} prompt, ${usage.completion_tokens || "?"} completion._`
      );
    }

    response.markdown(NATIVE_CHAT_FOOTER);
  }

  async runAgentRequest(commandSpec, model, messages, response, token) {
    const executionMode = normalizeExecutionMode(commandSpec.executionMode);
    const maxSteps = await resolveAgentStepLimit(executionMode, messages);
    const touchedPaths = new Set();
    let finalText = "";
    let finalUsage = undefined;
    const generation = getGenerationOptions("agent", model);
    const toolDefs = getWorkspaceToolsForExecution(executionMode);

    for (let step = 0; step < maxSteps; step += 1) {
      response.progress(
        `${commandSpec.label}: ${executionMode === "act" ? "step" : "plan step"} ${step + 1} of ${maxSteps}`
      );

      const payload = await fetchRuntimeJson(
        "/chat/completions",
        {
          model,
          stream: false,
          ...generation,
          messages,
          tools: toolDefs
        },
        token
      );

      const choice = payload.choices && payload.choices[0];
      const message = choice && choice.message ? choice.message : {};
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const assistantContent = typeof message.content === "string" ? message.content : "";

      finalUsage = payload.usage;
      if (assistantContent) {
        finalText = assistantContent;
      }

      if (!toolCalls.length) {
        if (finalText.trim()) {
          response.markdown(finalText);
        } else {
          response.markdown(
            `_${executionMode === "act" ? "Agent" : "Planner"} completed without returning text._`
          );
        }
        if (finalUsage) {
          response.markdown(
            `\n\n_Tokens: ${finalUsage.total_tokens || "?"} total, ${finalUsage.prompt_tokens || "?"} prompt, ${finalUsage.completion_tokens || "?"} completion._`
          );
        }
        response.markdown(NATIVE_CHAT_FOOTER);
        return { touchedPaths: Array.from(touchedPaths) };
      }

      messages.push({
        role: "assistant",
        content: assistantContent || null,
        tool_calls: toolCalls
      });

      for (const toolCall of toolCalls) {
        const result = await executeWorkspaceToolCall(toolCall);
        const toolName =
          toolCall && toolCall.function && toolCall.function.name
            ? toolCall.function.name
            : "tool";
        response.progress(result.summary);

        const preview = buildToolPreview(toolName, result);
        if (preview.path) {
          touchedPaths.add(preview.path);
        }

        if (preview.path) {
          const targetUri = workspaceRelativeUri(preview.path);
          if (targetUri) {
            response.reference(targetUri);
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result.content
        });
      }
    }

    response.markdown(
      `${finalText || `_${executionMode === "act" ? "Agent" : "Planner"} stopped without a final response._`}\n\n_${
        executionMode === "act" ? "Agent" : "Planner"
      } stopped after reaching the configured step limit._${NATIVE_CHAT_FOOTER}`
    );
    return { touchedPaths: Array.from(touchedPaths) };
  }
}

class BlueWirksAgentViewProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.pendingAttachments = [];
    this.abortController = undefined;
    this.modelsCache = [];
    this.pending = false;
    this.lastStatus = "Ready";
    this.persistHandle = undefined;
    this.serviceState = {
      healthy: false,
      starting: false,
      label: "Service offline"
    };
    this.appSelectionPollHandle = undefined;
    this.appSelectionPollBusy = false;

    const restored = this.restoreState();
    this.threads = restored.threads;
    this.activeThreadId = restored.activeThreadId;
    this.lastMode = restored.lastMode;
    this.lastExecutionMode = restored.lastExecutionMode;
    this.ensureActiveThread();
  }

  restoreState() {
    const raw = this.getMemento().get(STORAGE_KEY);
    if (!raw || !Array.isArray(raw.threads)) {
      const thread = createThread({ mode: "chat" });
      return {
        threads: [thread],
        activeThreadId: thread.id,
        lastMode: "chat",
        lastExecutionMode: DEFAULT_EXECUTION_MODE
      };
    }

    const threads = raw.threads
      .map((thread) => normalizeThread(thread))
      .filter(Boolean)
      .slice(0, MAX_STORED_THREADS);

    if (!threads.length) {
      const thread = createThread({ mode: "chat" });
      return {
        threads: [thread],
        activeThreadId: thread.id,
        lastMode: "chat",
        lastExecutionMode: DEFAULT_EXECUTION_MODE
      };
    }

    const activeThreadId = threads.some((thread) => thread.id === raw.activeThreadId)
      ? raw.activeThreadId
      : threads[0].id;

    return {
      threads,
      activeThreadId,
      lastMode: raw.lastMode === "agent" ? "agent" : threads[0].mode || "chat",
      lastExecutionMode: normalizeExecutionMode(raw.lastExecutionMode || threads[0].executionMode)
    };
  }

  getMemento() {
    return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length
      ? this.context.workspaceState
      : this.context.globalState;
  }

  schedulePersist() {
    if (this.persistHandle) {
      clearTimeout(this.persistHandle);
    }
    this.persistHandle = setTimeout(() => {
      this.persistHandle = undefined;
      void this.persistState();
    }, 200);
  }

  async persistState() {
    await this.getMemento().update(STORAGE_KEY, {
      threads: this.threads.slice(0, MAX_STORED_THREADS),
      activeThreadId: this.activeThreadId,
      lastMode: this.lastMode,
      lastExecutionMode: this.lastExecutionMode
    });
  }

  ensureActiveThread() {
    if (!this.threads.length) {
      const thread = createThread({
        mode: this.lastMode,
        executionMode: this.lastExecutionMode
      });
      this.threads = [thread];
      this.activeThreadId = thread.id;
      return thread;
    }

    const thread = this.threads.find((entry) => entry.id === this.activeThreadId);
    if (thread) {
      return thread;
    }

    this.activeThreadId = this.threads[0].id;
    return this.threads[0];
  }

  getActiveThread() {
    return this.ensureActiveThread();
  }

  getThreadById(threadId) {
    return this.threads.find((thread) => thread.id === threadId);
  }

  async handleConfigurationChange() {
    await this.refreshRuntimeState();
    await this.syncBridgeState();
    this.postState();
  }

  startAppSelectionWatcher() {
    const poll = async () => {
      if (this.appSelectionPollBusy) {
        return;
      }
      this.appSelectionPollBusy = true;
      try {
        await this.applyAppSelectionRequest();
        await this.applyEditorActionRequest();
      } finally {
        this.appSelectionPollBusy = false;
      }
    };

    void poll();
    this.appSelectionPollHandle = setInterval(() => {
      void poll();
    }, 1500);

    return new vscode.Disposable(() => {
      if (this.appSelectionPollHandle) {
        clearInterval(this.appSelectionPollHandle);
        this.appSelectionPollHandle = undefined;
      }
    });
  }

  async applyAppSelectionRequest() {
    const bridgeState = await readBridgeState();
    const requestedAt = Number(bridgeState && bridgeState.appSelectionRequestedAt) || 0;
    const appliedAt = Number(bridgeState && bridgeState.appSelectionAppliedAt) || 0;
    if (!requestedAt || requestedAt <= appliedAt) {
      return false;
    }

    const requestedWorkspaceRoot =
      bridgeState && typeof bridgeState.appSelectedWorkspaceRoot === "string"
        ? bridgeState.appSelectedWorkspaceRoot.trim()
        : "";
    if (!requestedWorkspaceRoot) {
      return false;
    }

    const workspaceRoot = path.resolve(requestedWorkspaceRoot);
    if (!(await exists(workspaceRoot))) {
      await updateBridgeState({
        appSelectionAppliedAt: Date.now(),
        appSelectionAppliedBy: "VSWirks Editor",
        appSelectionError: `Missing workspace root: ${workspaceRoot}`
      });
      return false;
    }

    const requestedTargetPath =
      bridgeState && typeof bridgeState.appSelectedTargetPath === "string"
        ? bridgeState.appSelectedTargetPath.trim()
        : "";
    const targetPath =
      requestedTargetPath && isPathWithin(workspaceRoot, requestedTargetPath)
        ? path.resolve(requestedTargetPath)
        : workspaceRoot;

    const matchingFolder = (vscode.workspace.workspaceFolders || []).find(
      (folder) => path.resolve(folder.uri.fsPath) === workspaceRoot
    );

    if (!matchingFolder) {
      this.lastStatus = `Switching editor to ${path.basename(workspaceRoot)}`;
      this.postState();
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(workspaceRoot), false);
      return true;
    }

    const currentTarget = getOptionalWorkspaceTargetPath();
    if (!currentTarget || path.resolve(currentTarget) !== targetPath) {
      await setConfiguredWorkspaceTargetPath(targetPath);
    }

    await this.syncBridgeState();
    await updateBridgeState({
      appSelectionAppliedAt: Date.now(),
      appSelectionAppliedBy: "VSWirks Editor",
      appSelectionError: ""
    });
    this.lastStatus = `Synced from VSWirks App: ${formatWorkspaceTargetLabel(targetPath)}`;
    this.postState();
    return true;
  }

  async applyEditorActionRequest() {
    const bridgeState = await readBridgeState();
    const request =
      bridgeState && bridgeState.editorActionRequest && typeof bridgeState.editorActionRequest === "object"
        ? bridgeState.editorActionRequest
        : null;
    const requestedAt = Number(request && request.requestedAt) || 0;
    const appliedAt = Number(request && request.appliedAt) || 0;
    if (!requestedAt || requestedAt <= appliedAt) {
      return false;
    }

    const type = typeof request.type === "string" ? request.type : "";
    try {
      if (type === "openChangedFiles") {
        const paths = Array.isArray(request.paths)
          ? request.paths.filter((item) => typeof item === "string" && item.trim())
          : [];
        for (const filePath of paths.slice(0, 8)) {
          await this.openAbsolutePath(filePath);
        }
      } else if (type === "revealPath") {
        const revealPath = typeof request.path === "string" ? request.path : "";
        if (revealPath) {
          await this.openAbsolutePath(revealPath);
        }
      } else if (type === "openDiff") {
        const leftPath = typeof request.leftPath === "string" ? request.leftPath : "";
        const rightPath = typeof request.rightPath === "string" ? request.rightPath : "";
        if (leftPath && rightPath) {
          await vscode.commands.executeCommand(
            "vscode.diff",
            vscode.Uri.file(leftPath),
            vscode.Uri.file(rightPath),
            request.label || "VSWirks Diff"
          );
        }
      }

      await updateBridgeState({
        editorActionRequest: {
          ...request,
          appliedAt: Date.now(),
          appliedBy: "VSWirks Editor",
          error: ""
        }
      });
      return true;
    } catch (error) {
      await updateBridgeState({
        editorActionRequest: {
          ...request,
          appliedAt: Date.now(),
          appliedBy: "VSWirks Editor",
          error: error instanceof Error ? error.message : String(error)
        }
      });
      return false;
    }
  }

  async setWorkspaceTarget(uri) {
    const targetPath = await resolveWorkspaceTargetSelection(uri);
    if (!targetPath) {
      return false;
    }

    await setConfiguredWorkspaceTargetPath(targetPath);
    this.lastStatus = `Workspace target set: ${formatWorkspaceTargetLabel(targetPath)}`;
    await this.syncBridgeState();
    this.postState();
    return true;
  }

  async clearWorkspaceTarget() {
    await clearConfiguredWorkspaceTargetPath();
    this.lastStatus = "Workspace target cleared";
    await this.syncBridgeState();
    this.postState();
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage(
      async (message) => {
        try {
          await this.handleWebviewMessage(message);
        } catch (error) {
          this.lastStatus = `Error: ${toErrorMessage(error)}`;
          this.postToView({
            type: "error",
            message: toErrorMessage(error)
          });
          this.postState();
        }
      },
      undefined,
      this.context.subscriptions
    );

    void this.syncBridgeState();
    this.postState();
  }

  focusInput() {
    this.postToView({ type: "focusInput" });
  }

  async createNewThread(seed) {
    if (this.pending) {
      void vscode.window.showWarningMessage("Stop the current response before starting a new chat.");
      return;
    }

    const thread = createThread({
      mode: seed && seed.mode ? seed.mode : this.lastMode,
      executionMode:
        seed && seed.executionMode ? seed.executionMode : this.lastExecutionMode,
      model: seed && seed.model ? seed.model : ""
    });
    this.threads = [thread, ...this.threads].slice(0, MAX_STORED_THREADS);
    this.activeThreadId = thread.id;
    this.lastMode = thread.mode;
    this.lastExecutionMode = thread.executionMode;
    this.pendingAttachments = [];
    this.lastStatus = "Ready";
    this.schedulePersist();
    this.postState();
    this.focusInput();
  }

  async deleteThread(threadId) {
    if (this.pending) {
      return;
    }

    this.threads = this.threads.filter((thread) => thread.id !== threadId);
    if (!this.threads.length) {
      await this.createNewThread({ mode: this.lastMode });
      return;
    }

    if (this.activeThreadId === threadId) {
      this.activeThreadId = this.threads[0].id;
    }
    this.schedulePersist();
    this.postState();
  }

  switchThread(threadId) {
    if (this.pending) {
      return;
    }

    const thread = this.getThreadById(threadId);
    if (!thread) {
      return;
    }
    this.activeThreadId = thread.id;
    this.lastMode = thread.mode || this.lastMode;
    this.lastExecutionMode = thread.executionMode || this.lastExecutionMode;
    this.lastStatus = "Ready";
    this.schedulePersist();
    this.postState();
  }

  async attachCurrentEditor(selectionOnly) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage("No active editor to attach.");
      return false;
    }

    if (selectionOnly && editor.selection.isEmpty) {
      void vscode.window.showWarningMessage("Select code before using selection-based context.");
      return false;
    }

    const document = editor.document;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath)
      : document.uri.fsPath;

    const content = selectionOnly ? document.getText(editor.selection) : document.getText();
    const selectionLabel = selectionOnly
      ? `${relativePath}:${editor.selection.start.line + 1}-${editor.selection.end.line + 1}`
      : relativePath;

    this.pendingAttachments.push({
      id: makeId("attachment"),
      kind: selectionOnly ? "selection" : "file",
      label: selectionLabel,
      languageId: document.languageId,
      content
    });

    this.lastStatus = selectionOnly ? "Selection attached" : "File attached";
    this.postState();
    return true;
  }

  async attachImageFromPicker() {
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      canSelectFiles: true,
      openLabel: "Attach Image",
      filters: IMAGE_PICKER_FILTERS
    });

    if (!picks || !picks.length) {
      return false;
    }

    let attachedCount = 0;
    this.lastStatus = picks.length > 1 ? "Analyzing images" : "Analyzing image";
    this.postState();

    for (const uri of picks) {
      const attached = await this.attachImageUri(uri);
      if (attached) {
        attachedCount += 1;
      }
    }

    if (!attachedCount) {
      this.lastStatus = "No images attached";
      this.postState();
      return false;
    }

    this.lastStatus = attachedCount === 1 ? "Image attached" : `${attachedCount} images attached`;
    this.postState();
    return true;
  }

  async attachImageUri(uri) {
    if (!uri || !isImageUriLike(uri)) {
      void vscode.window.showWarningMessage("Choose a supported image file to attach.");
      return false;
    }

    try {
      const attachment = await createImageAttachment(uri);
      this.pendingAttachments.push(attachment);
      return true;
    } catch (error) {
      const message = toErrorMessage(error);
      this.lastStatus = `Image analysis failed: ${message}`;
      this.postState();
      void vscode.window.showErrorMessage(`Image analysis failed: ${message}`);
      return false;
    }
  }

  async handleWebviewMessage(message) {
    switch (message.type) {
      case "ready":
        this.postState();
        await this.refreshRuntimeState();
        break;
      case "refreshModels":
        await this.refreshRuntimeState();
        break;
      case "startService":
        await this.startRuntimeService();
        break;
      case "openCompanionApp":
        await this.openCompanionApp();
        break;
      case "saveGenerationSettings":
        await this.saveGenerationSettings(message.payload || {});
        break;
      case "resetGenerationSettings":
        await this.resetGenerationSettings();
        break;
      case "sendPrompt":
        await this.handlePrompt(message.payload);
        break;
      case "attachCurrentFile":
        await this.attachCurrentEditor(false);
        break;
      case "attachSelection":
        await this.attachCurrentEditor(true);
        break;
      case "attachImage":
        await this.attachImageFromPicker();
        break;
      case "removeAttachment":
        this.pendingAttachments = this.pendingAttachments.filter((item) => item.id !== message.id);
        this.postState();
        break;
      case "abort":
        if (this.abortController) {
          this.abortController.abort();
        }
        break;
      case "openFile":
        await this.openFileFromView(message.path);
        break;
      case "insertCodeAtCursor":
        await this.insertCodeAtCursor(message.content);
        break;
      case "openScratchBuffer":
        await this.openScratchBuffer(message.content, message.language);
        break;
      case "newChat":
        await this.createNewThread();
        break;
      case "switchThread":
        this.switchThread(message.id);
        break;
      case "deleteThread":
        await this.deleteThread(message.id);
        break;
      case "runQuickAction":
        await this.runQuickAction(message.id);
        break;
      default:
        break;
    }
  }

  async runQuickAction(actionId) {
    const action = QUICK_ACTIONS.find((entry) => entry.id === actionId);
    if (!action) {
      return;
    }

    if (action.attach === "selection") {
      await this.attachCurrentEditor(true);
    } else if (action.attach === "file") {
      await this.attachCurrentEditor(false);
    } else if (action.attach === "image") {
      await this.attachImageFromPicker();
    }

    this.lastMode = action.mode;
    const thread = this.getActiveThread();
    thread.mode = action.mode;
    thread.executionMode = normalizeExecutionMode(action.executionMode);
    this.lastExecutionMode = thread.executionMode;
    this.postState();
    this.postToView({
      type: "prefillPrompt",
      prompt: action.prompt,
      mode: action.mode,
      executionMode: thread.executionMode
    });
  }

  async insertCodeAtCursor(content) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage("Open a file before inserting generated code.");
      return;
    }

    await editor.edit((editBuilder) => {
      editBuilder.replace(editor.selection, String(content || ""));
    });
    this.lastStatus = "Inserted code at cursor";
    this.postState();
  }

  async openScratchBuffer(content, language) {
    const document = await vscode.workspace.openTextDocument({
      content: String(content || ""),
      language: typeof language === "string" && language.trim() ? language.trim() : undefined
    });
    await vscode.window.showTextDocument(document, { preview: false });
    this.lastStatus = "Opened scratch buffer";
    this.postState();
  }

  async handlePrompt(payload) {
    if (this.pending) {
      return;
    }

    const prompt = String(payload.prompt || "").trim();
    if (!prompt) {
      return;
    }

    const requestedMode = payload.mode === "agent" ? "agent" : "chat";
    const requestedExecutionMode = normalizeExecutionMode(payload.executionMode);
    const effectiveRequest = await resolveEffectiveRequestMode(prompt, {
      mode: requestedMode,
      executionMode: requestedExecutionMode
    });
    const mode = effectiveRequest.mode;
    const executionMode = effectiveRequest.executionMode;
    const requestedModel = String(payload.model || "").trim();
    const model = requestedModel || (await this.getDefaultModel());
    const userContent = await this.composeUserMessage(prompt, this.pendingAttachments, {
      mode,
      executionMode
    });
    const thread = this.getActiveThread();

    thread.mode = mode;
    thread.executionMode = executionMode;
    thread.model = model;
    this.lastMode = mode;
    this.lastExecutionMode = executionMode;

    const userEntry = {
      id: makeId("message"),
      role: "user",
      content: prompt,
      renderedContent: userContent,
      mode,
      executionMode,
      attachments: this.pendingAttachments.map((item) => ({
        id: item.id,
        label: item.label,
        kind: item.kind
      })),
      createdAt: Date.now()
    };

    thread.messages.push(userEntry);
    if (thread.messages.filter((item) => item.role === "user").length === 1) {
      thread.title = titleFromPrompt(prompt);
    }
    touchThread(this.threads, thread.id);

    this.pendingAttachments = [];
    this.pending = true;
    this.lastStatus = effectiveRequest.autoPromoted
      ? "Auto-switched to Agent + Act for workspace build"
      : mode === "agent"
        ? executionMode === "act"
          ? "Agent running"
          : "Planning"
        : "Thinking";
    this.postState({ selectedModel: model });
    this.abortController = new AbortController();

    try {
      if (mode === "agent") {
        await this.runAgentMode(model, executionMode);
      } else {
        await this.runChatMode(model, executionMode);
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        const lastMessage = getLatestAssistantMessage(thread.messages);
        if (lastMessage && lastMessage.pending) {
          lastMessage.pending = false;
          lastMessage.status = "Stopped";
        }
        this.lastStatus = "Stopped";
        this.schedulePersist();
        this.postState({ selectedModel: model });
        return;
      }
      throw error;
    } finally {
      this.abortController = undefined;
      this.pending = false;
      touchThread(this.threads, thread.id);
      this.schedulePersist();
      this.postState({ selectedModel: model });
    }
  }

  async composeUserMessage(prompt, attachments, options) {
    return buildRequestContent(prompt, attachments, options);
  }

  async runChatMode(model, executionMode) {
    const assistantId = this.addAssistantPlaceholder(model, "chat", executionMode);
    let aggregated = "";
    let finalUsage = undefined;
    const generation = getGenerationOptions("chat", model);

    await this.streamChatCompletion(
      {
        model,
        stream: true,
        ...generation,
        messages: await this.toApiMessages(),
        stream_options: {
          include_usage: true
        }
      },
      {
        onText: (chunk) => {
          aggregated += chunk;
          this.updateAssistantPlaceholder(assistantId, aggregated);
        },
        onUsage: (usage) => {
          finalUsage = usage;
        },
        onDone: () => {
          this.finalizeAssistantPlaceholder(assistantId, {
            content: aggregated || "(empty response)",
            usage: finalUsage
          });
          this.lastStatus = "Response complete";
        }
      }
    );
  }

  async runAgentMode(model, executionMode) {
    const toolDefs = getWorkspaceToolsForExecution(executionMode);
    const assistantId = this.addAssistantPlaceholder(model, "agent", executionMode);
    const messages = await this.toApiMessages();
    const maxSteps = await resolveAgentStepLimit(executionMode, messages);
    let finalText = "";
    let finalUsage = undefined;
    const generation = getGenerationOptions("agent", model);

    for (let step = 0; step < maxSteps; step += 1) {
      this.updateAssistantPlaceholder(
        assistantId,
        finalText,
        `${executionMode === "act" ? "Agent" : "Plan"} step ${step + 1} of ${maxSteps}`
      );

      const response = await this.fetchJson("/chat/completions", {
        model,
        stream: false,
        ...generation,
        messages,
        tools: toolDefs
      });

      const choice = response.choices && response.choices[0];
      const message = choice && choice.message ? choice.message : {};
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const assistantContent = typeof message.content === "string" ? message.content : "";

      finalUsage = response.usage;
      if (assistantContent) {
        finalText = assistantContent;
        this.updateAssistantPlaceholder(assistantId, finalText);
      }

      if (!toolCalls.length) {
        this.finalizeAssistantPlaceholder(assistantId, {
          content: finalText || "(empty response)",
          usage: finalUsage
        });
        this.lastStatus = executionMode === "act" ? "Agent complete" : "Plan complete";
        return;
      }

      messages.push({
        role: "assistant",
        content: assistantContent || null,
        tool_calls: toolCalls
      });

      for (const toolCall of toolCalls) {
        const result = await this.executeToolCall(toolCall);
        const toolName =
          toolCall && toolCall.function && toolCall.function.name
            ? toolCall.function.name
            : "tool";

        this.recordToolEvent(toolName, result);
        this.lastStatus = result.summary;
        this.postToView({
          type: "toolEvent",
          tool: toolName,
          label: result.summary
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result.content
        });
      }
    }

    this.finalizeAssistantPlaceholder(assistantId, {
      content: `${finalText}\n\n${
        executionMode === "act" ? "Agent" : "Planner"
      } stopped after reaching the configured step limit.`,
      usage: finalUsage
    });
    this.lastStatus =
      executionMode === "act" ? "Agent reached step limit" : "Planner reached step limit";
  }

  recordToolEvent(toolName, result) {
    const thread = this.getActiveThread();
    const preview = buildToolPreview(toolName, result);
    thread.messages.push({
      id: makeId("tool"),
      role: "tool",
      toolName,
      summary: preview.summary,
      content: preview.details,
      path: preview.path,
      error: Boolean(preview.error),
      createdAt: Date.now()
    });
    touchThread(this.threads, thread.id);
    this.schedulePersist();
    this.postState();
  }

  async executeToolCall(toolCall) {
    const name = toolCall && toolCall.function && toolCall.function.name;
    const args = safeJsonParse(
      toolCall && toolCall.function ? toolCall.function.arguments : "{}"
    );

    switch (name) {
      case "list_workspace":
        return this.toolListWorkspace(args);
      case "read_file":
        return this.toolReadFile(args);
      case "search_workspace":
        return this.toolSearchWorkspace(args);
      case "write_file":
        return this.toolWriteFile(args);
      case "open_file":
        return this.toolOpenFile(args);
      default:
        return {
          summary: `Skipped unknown tool ${name}`,
          content: JSON.stringify({ ok: false, error: `Unknown tool ${name}` })
        };
    }
  }

  async toolListWorkspace(args) {
    const root = this.getWorkspaceRoot();
    const requestedPath = typeof args.path === "string" ? args.path : ".";
    const folder = this.resolveWorkspacePath(requestedPath, root);
    const maxEntries = clampNumber(args.max_entries, 10, 500, 120);
    const pattern = new vscode.RelativePattern(folder, "**/*");
    const files = await vscode.workspace.findFiles(
      pattern,
      "**/{.git,node_modules,.venv,.pytest_cache,__pycache__,dist,build}/**",
      maxEntries
    );
    const entries = filterIgnoredWorkspacePaths(files.map((uri) => path.relative(root, uri.fsPath))).sort();
    return {
      summary: `Listed ${entries.length} workspace files`,
      content: JSON.stringify({ ok: true, root, entries })
    };
  }

  async toolReadFile(args) {
    const root = this.getWorkspaceRoot();
    const target = this.resolveWorkspacePath(args.path, root);
    const content = await fs.readFile(target, "utf8");
    return {
      summary: `Read ${path.relative(root, target)}`,
      content: JSON.stringify({
        ok: true,
        path: path.relative(root, target),
        content
      })
    };
  }

  async toolSearchWorkspace(args) {
    const root = this.getWorkspaceRoot();
    const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
    if (!pattern) {
      throw new Error("search_workspace requires a non-empty pattern");
    }

    const maxResults = clampNumber(args.max_results, 1, 200, 30);
    const glob = typeof args.glob === "string" ? args.glob : undefined;

    const rgPath = await which("rg");
    if (rgPath) {
      const rgArgs = ["--line-number", "--no-heading", "--color", "never", pattern, root];
      if (glob) {
        rgArgs.push("-g", glob);
      }
      appendRipgrepIgnoreGlobs(rgArgs);
      const output = await execFile(rgPath, rgArgs);
      const lines = output
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, maxResults);
      return {
        summary: `Found ${lines.length} matches`,
        content: JSON.stringify({ ok: true, matches: lines })
      };
    }

    const include = glob || "**/*";
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, include),
      "**/{.git,node_modules,.venv,.pytest_cache,__pycache__,dist,build}/**",
      200
    );
    const matches = [];
    for (const file of files) {
      if (matches.length >= maxResults) {
        break;
      }
      if (isIgnoredWorkspacePath(path.relative(root, file.fsPath))) {
        continue;
      }
      const text = await fs.readFile(file.fsPath, "utf8").catch(() => "");
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (matches.length < maxResults && line.includes(pattern)) {
          matches.push(`${path.relative(root, file.fsPath)}:${index + 1}:${line}`);
        }
      });
    }

    return {
      summary: `Found ${matches.length} matches`,
      content: JSON.stringify({ ok: true, matches })
    };
  }

  async toolWriteFile(args) {
    const thread = this.getActiveThread();
    const root = this.getWorkspaceRoot();
    const target = this.resolveWorkspacePath(args.path, root);
    const content = typeof args.content === "string" ? args.content : "";
    if (!content && content !== "") {
      throw new Error("write_file requires string content");
    }

    const requiresApproval = vscode.workspace
      .getConfiguration("bluewirksLocalAgent")
      .get("writeRequiresApproval", true);

    const relativePath = path.relative(root, target);
    if (requiresApproval) {
      const approval = await requestWriteApproval(relativePath, {
        promptLabel: "VSWirks Agent",
        currentMode: thread.writeApprovalMode,
        scope: "thread"
      });
      if (!approval.approved) {
        return {
          summary: `Write denied for ${relativePath}`,
          content: JSON.stringify({ ok: false, denied: true, path: relativePath })
        };
      }

      if (approval.nextMode === "chat") {
        thread.writeApprovalMode = "chat";
        touchThread(this.threads, thread.id);
        this.schedulePersist();
        this.postState();
      }
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    let backupPath = null;
    if (await exists(target)) {
      const stamp = timestamp();
      backupPath = `${target}.bak.${stamp}`;
      await fs.copyFile(target, backupPath);
    }

    await fs.writeFile(target, content, "utf8");
    return {
      summary: `Wrote ${relativePath}`,
      content: JSON.stringify({
        ok: true,
        path: relativePath,
        backupPath: backupPath ? path.relative(root, backupPath) : null
      })
    };
  }

  async toolOpenFile(args) {
    const root = this.getWorkspaceRoot();
    const target = this.resolveWorkspacePath(args.path, root);
    await this.openFileAtPath(target);
    return {
      summary: `Opened ${path.relative(root, target)}`,
      content: JSON.stringify({ ok: true, path: path.relative(root, target) })
    };
  }

  async openFileFromView(relativePath) {
    const root = this.getWorkspaceRoot();
    await this.openFileAtPath(this.resolveWorkspacePath(relativePath, root));
  }

  async openFileAtPath(target) {
    const document = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async toApiMessages() {
    const messages = [{ role: "system", content: await buildWorkspaceSystemPrompt() }];
    for (const item of this.getActiveThread().messages) {
      if (item.role === "user") {
        messages.push({ role: "user", content: item.renderedContent || item.content });
      } else if (item.role === "assistant" && !item.pending && item.content) {
        messages.push({ role: "assistant", content: item.content });
      }
    }
    return messages;
  }

  addAssistantPlaceholder(model, mode, executionMode) {
    const thread = this.getActiveThread();
    const id = makeId("assistant");
    thread.messages.push({
      id,
      role: "assistant",
      content: "",
      model,
      mode,
      executionMode: normalizeExecutionMode(executionMode),
      pending: true,
      createdAt: Date.now()
    });
    touchThread(this.threads, thread.id);
    this.postState({ selectedModel: model });
    return id;
  }

  updateAssistantPlaceholder(id, content, status) {
    const item = findMessage(this.threads, id);
    if (!item) {
      return;
    }
    item.content = content;
    item.status = status || "";
    this.postState();
  }

  finalizeAssistantPlaceholder(id, { content, usage }) {
    const item = findMessage(this.threads, id);
    if (!item) {
      return;
    }
    item.content = content;
    item.pending = false;
    item.status = "";
    item.usage = usage;
    this.schedulePersist();
    this.postState();
  }

  async streamChatCompletion(body, handlers) {
    const response = await this.fetchRaw("/chat/completions", body, true);
    if (!response.body) {
      throw new Error("Streaming response body was not available.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const line = event
          .split(/\r?\n/)
          .find((entry) => entry.startsWith("data: "));
        if (!line) {
          continue;
        }
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") {
          if (handlers.onDone) {
            handlers.onDone();
          }
          return;
        }

        const json = safeJsonParse(payload);
        if (json.usage && handlers.onUsage) {
          handlers.onUsage(json.usage);
        }
        const choice = json.choices && json.choices[0];
        if (!choice || !choice.delta) {
          continue;
        }
        if (choice.delta.content && handlers.onText) {
          handlers.onText(choice.delta.content);
        }
      }
    }
  }

  async refreshModels() {
    try {
      const data = await this.fetchJson("/models", undefined);
      const modelIds = Array.isArray(data.data)
        ? data.data.map((item) => item.id).filter(Boolean)
        : [];
      this.modelsCache = modelIds;
      this.postToView({
        type: "models",
        models: modelIds,
        selected: this.getActiveThread().model || (await this.getDefaultModel())
      });
    } catch (error) {
      this.postToView({
        type: "error",
        message: `Failed to load models: ${toErrorMessage(error)}`
      });
    }
  }

  async refreshRuntimeState() {
    const nextState = await probeRuntimeHealth();
    this.serviceState = {
      healthy: nextState.healthy,
      starting: false,
      label: nextState.label
    };
    this.postState();

    if (nextState.healthy) {
      await this.refreshModels();
    }
  }

  async startRuntimeService() {
    if (this.serviceState.starting) {
      return;
    }

    const alreadyHealthy = await probeRuntimeHealth();
    if (alreadyHealthy.healthy) {
      this.serviceState = {
        healthy: true,
        starting: false,
        label: alreadyHealthy.label
      };
      this.lastStatus = "ai-runtime already running";
      this.postState();
      await this.refreshModels();
      return;
    }

    this.serviceState = {
      healthy: false,
      starting: true,
      label: "Starting ai-runtime"
    };
    this.lastStatus = "Starting ai-runtime";
    this.postState();

    try {
      const runtime = getRuntimeLaunchConfig();
      if (!(await exists(runtime.python))) {
        throw new Error(`Runtime Python not found: ${runtime.python}`);
      }
      if (!(await exists(path.join(runtime.cwd, "app", "main.py")))) {
        throw new Error(`Runtime app not found under: ${runtime.cwd}`);
      }

      await spawnDetachedProcess(runtime.python, runtime.args, runtime.cwd);

      const healthy = await waitForRuntimeHealthy(SERVICE_START_TIMEOUT_MS);
      if (!healthy) {
        throw new Error("ai-runtime did not become healthy in time");
      }

      this.serviceState = {
        healthy: true,
        starting: false,
        label: "Service ready"
      };
      this.lastStatus = "ai-runtime started";
      this.postState();
      await this.refreshModels();
    } catch (error) {
      this.serviceState = {
        healthy: false,
        starting: false,
        label: "Service offline"
      };
      this.lastStatus = `Start failed: ${toErrorMessage(error)}`;
      this.postState();
      void vscode.window.showErrorMessage(`Failed to start ai-runtime: ${toErrorMessage(error)}`);
    }
  }

  async saveGenerationSettings(payload) {
    const updates = normalizeGenerationSettings(payload);
    const configuration = vscode.workspace.getConfiguration("bluewirksLocalAgent");
    const target =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    for (const [key, value] of Object.entries(updates)) {
      await configuration.update(key, value, target);
    }

    this.lastStatus = "Generation defaults saved";
    this.postState();
  }

  async resetGenerationSettings() {
    await this.saveGenerationSettings(DEFAULT_GENERATION_SETTINGS);
    this.lastStatus = "Restored tuned defaults";
    this.postState();
  }

  async openCompanionApp() {
    const configuration = vscode.workspace.getConfiguration("bluewirksLocalAgent");
    const configuredSourcePath =
      String(configuration.get("companionAppPath", DEFAULT_COMPANION_APP_PATH)).trim() ||
      DEFAULT_COMPANION_APP_PATH;
    const sourcePathCandidates = Array.from(
      new Set(
        [configuredSourcePath, DEFAULT_COMPANION_APP_PATH, LEGACY_COMPANION_APP_PATH].filter(
          (candidate) => typeof candidate === "string" && candidate.trim()
        )
      )
    );
    const electronFallback = "/opt/homebrew/bin/electron";
    const npmFallback = "/opt/homebrew/bin/npm";

    if (await exists(PACKAGED_COMPANION_APP_PATH)) {
      await execFile("open", ["-a", PACKAGED_COMPANION_APP_PATH]);
      this.lastStatus = "Opened VSWirks App";
      this.postState();
      return true;
    }

    let sourcePath = "";
    for (const candidate of sourcePathCandidates) {
      if (await exists(candidate)) {
        sourcePath = candidate;
        break;
      }
    }

    if (!sourcePath) {
      throw new Error(`VSWirks App source not found: ${configuredSourcePath}`);
    }

    const electronPath = (await which("electron")) || ((await exists(electronFallback)) ? electronFallback : "");
    if (electronPath) {
      await spawnDetachedProcess(electronPath, ["."], sourcePath);
      this.lastStatus = "Launching VSWirks App";
      this.postState();
      return true;
    }

    const npmPath = (await which("npm")) || ((await exists(npmFallback)) ? npmFallback : "");
    if (npmPath) {
      await spawnDetachedProcess(npmPath, ["start"], sourcePath);
      this.lastStatus = "Launching VSWirks App";
      this.postState();
      return true;
    }

    await execFile("open", [sourcePath]).catch(() => "");
    this.lastStatus = "VSWirks App source ready";
    this.postState();
    void vscode.window.showWarningMessage(
      `VSWirks App source is ready at ${sourcePath}, but Electron or npm is not available on PATH yet.`
    );
    return false;
  }

  async syncBridgeState() {
    const activeEditor = vscode.window.activeTextEditor;
    const activeDocument = activeEditor ? activeEditor.document : null;
    const activeWorkspaceFolder = activeDocument
      ? vscode.workspace.getWorkspaceFolder(activeDocument.uri)
      : null;
    const selectionText =
      activeEditor && !activeEditor.selection.isEmpty
        ? clampText(activeEditor.document.getText(activeEditor.selection), BRIDGE_SYNC_CHAR_LIMIT)
        : "";
    const selectionRange =
      activeEditor && !activeEditor.selection.isEmpty
        ? {
            start: {
              line: activeEditor.selection.start.line,
              character: activeEditor.selection.start.character
            },
            end: {
              line: activeEditor.selection.end.line,
              character: activeEditor.selection.end.character
            }
          }
        : null;
    const selectedExplorerPath =
      getOptionalWorkspaceTargetPath() ||
      (activeDocument ? activeDocument.uri.fsPath : "");

    await updateBridgeState({
      editorName: "VSWirks Editor",
      updatedAt: Date.now(),
      bridgePath: resolveBridgeStatePath(),
      workspaceRoots: (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath),
      activeWorkspaceRoot: activeWorkspaceFolder ? activeWorkspaceFolder.uri.fsPath : "",
      workspaceTarget: getOptionalWorkspaceTargetPath(),
      activeFilePath: activeDocument ? activeDocument.uri.fsPath : "",
      activeFileLabel: activeDocument ? this.getActiveEditorLabel() : "",
      activeLanguageId: activeDocument ? activeDocument.languageId : "",
      selectedExplorerPath,
      selectionLabel: selectionText ? this.getSelectionLabel() : "",
      selectionText,
      activeSelection: selectionRange
    });
  }

  async openAbsolutePath(targetPath) {
    const resolved = path.resolve(targetPath);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat) {
      return false;
    }
    if (stat.isDirectory()) {
      await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(resolved));
      return true;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
    await vscode.window.showTextDocument(document, { preview: false });
    return true;
  }

  async getDefaultModel() {
    const configured = migrateLegacyDefaultModel(
      String(
      vscode.workspace
        .getConfiguration("bluewirksLocalAgent")
        .get("defaultModel", "")
      ).trim()
    );
    if (configured) {
      return configured;
    }
    if (this.modelsCache.length) {
      return this.modelsCache[0];
    }
    return DEFAULT_MODEL;
  }

  async fetchJson(endpoint, body) {
    const response = await this.fetchRaw(endpoint, body, false);
    return response.json();
  }

  async fetchRaw(endpoint, body, streaming) {
    const baseUrl = String(
      vscode.workspace
        .getConfiguration("bluewirksLocalAgent")
        .get("baseUrl", "http://127.0.0.1:7471/v1")
    ).replace(/\/$/, "");

    const init = {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json"
      },
      signal: this.abortController ? this.abortController.signal : undefined
    };
    if (body) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${baseUrl}${endpoint}`, init);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `${response.status} ${response.statusText}`);
    }
    if (!streaming) {
      return response;
    }
    return response;
  }

  getWorkspaceRoot() {
    return getWorkspaceTargetPath();
  }

  resolveWorkspacePath(inputPath, root) {
    if (typeof inputPath !== "string" || !inputPath.trim()) {
      throw new Error("A relative workspace path is required.");
    }
    const resolved = path.resolve(root, inputPath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Path escapes workspace: ${inputPath}`);
    }
    return resolved;
  }

  getWorkspaceLabel() {
    const targetPath = getOptionalWorkspaceTargetPath();
    return targetPath ? formatWorkspaceTargetLabel(targetPath) : "No workspace";
  }

  getActiveEditorLabel() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return "";
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (workspaceFolder) {
      return path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath);
    }
    return editor.document.fileName;
  }

  getSelectionLabel() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return "";
    }
    return `L${editor.selection.start.line + 1}-L${editor.selection.end.line + 1}`;
  }

  postState(extra) {
    const thread = this.getActiveThread();
    this.postToView({
      type: "state",
      threads: this.threads.map((entry) => ({
        id: entry.id,
        title: entry.title,
        updatedAt: entry.updatedAt,
        mode: entry.mode,
        executionMode: entry.executionMode,
        model: entry.model,
        messageCount: entry.messages.filter((item) => item.role !== "tool").length
      })),
      activeThreadId: thread.id,
      history: thread.messages,
      attachments: this.pendingAttachments.map((item) => ({
        id: item.id,
        label: item.label,
        kind: item.kind
      })),
      mode: thread.mode || this.lastMode,
      executionMode: thread.executionMode || this.lastExecutionMode || DEFAULT_EXECUTION_MODE,
      selectedModel:
        extra && Object.prototype.hasOwnProperty.call(extra, "selectedModel")
          ? extra.selectedModel
          : thread.model || "",
      pending: this.pending,
      statusText: this.pending ? this.lastStatus || "Working" : this.lastStatus || "Ready",
      quickActions: QUICK_ACTIONS,
      serviceLabel: this.serviceState.label,
      serviceHealthy: this.serviceState.healthy,
      serviceStarting: this.serviceState.starting,
      generationSettings: getGenerationSettingsSnapshot(),
      workspaceLabel: this.getWorkspaceLabel(),
      activeEditorLabel: this.getActiveEditorLabel(),
      selectionLabel: this.getSelectionLabel()
    });
  }

  postToView(message) {
    if (this.view) {
      void this.view.webview.postMessage(message);
    }
  }

  getHtml(webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css")
    );
    const nonce = String(Date.now());

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>VSWirks Editor Bridge</title>
  </head>
  <body>
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <strong>VSWirks Editor</strong>
          <span class="subtitle">editor bridge for VSWirks App</span>
        </div>
        <div class="topbar-controls">
          <select id="mode" title="Interaction mode">
            <option value="chat">Chat</option>
            <option value="agent">Agent</option>
          </select>
          <select id="model" title="Model"></select>
          <button id="refreshModels" title="Refresh models">Refresh</button>
          <button id="openCompanionApp" title="Open VSWirks App">Open App</button>
          <button id="togglePanels" title="Hide or show non-chat panels">Focus Chat</button>
          <button id="startService" title="Start ai-runtime">Start Service</button>
          <span id="serviceStatus" class="service-pill offline">Service offline</span>
        </div>
      </header>

      <section class="thread-strip">
        <button id="newChat" class="primary">New Chat</button>
        <div id="threadList" class="thread-list"></div>
      </section>

      <section class="context-strip">
        <div class="context-meta">
          <span id="workspacePill" class="pill">No workspace</span>
          <span id="editorPill" class="pill muted"></span>
          <span id="selectionPill" class="pill muted hidden"></span>
        </div>
        <div id="quickActions" class="quick-actions"></div>
      </section>

      <details class="settings-strip">
        <summary class="settings-summary">
          <div class="settings-header">
            <strong>Runtime Defaults</strong>
            <span>Tuned for local review, scaffolding, and controlled agent edits.</span>
          </div>
        </summary>
        <div class="settings-grid">
          <section class="settings-card">
            <h3>Chat</h3>
            <label class="setting-field">
              <span>Temperature</span>
              <input id="chatTemperature" type="number" min="0" max="2" step="0.05" />
            </label>
            <label class="setting-field">
              <span>Top P</span>
              <input id="chatTopP" type="number" min="0.1" max="1" step="0.05" />
            </label>
            <label class="setting-field">
              <span>Max Tokens</span>
              <input id="chatMaxTokens" type="number" min="256" max="8192" step="128" />
            </label>
          </section>
          <section class="settings-card">
            <h3>Agent</h3>
            <label class="setting-field">
              <span>Temperature</span>
              <input id="agentTemperature" type="number" min="0" max="2" step="0.05" />
            </label>
            <label class="setting-field">
              <span>Top P</span>
              <input id="agentTopP" type="number" min="0.1" max="1" step="0.05" />
            </label>
            <label class="setting-field">
              <span>Max Tokens</span>
              <input id="agentMaxTokens" type="number" min="256" max="8192" step="128" />
            </label>
          </section>
        </div>
        <div class="settings-actions">
          <button id="saveGenerationSettings">Save Defaults</button>
          <button id="resetGenerationSettings">Restore Defaults</button>
        </div>
      </details>

      <section class="intent-strip">
        <div class="intent-copy">
          <strong>Execution</strong>
          <span id="executionModeLabel">Plan only</span>
        </div>
        <div class="intent-control">
          <span class="intent-end">Plan</span>
          <input id="executionMode" class="intent-slider" type="range" min="0" max="1" step="1" value="0" />
          <span class="intent-end">Act</span>
        </div>
      </section>

      <section id="attachments" class="attachments hidden"></section>

      <section id="messages" class="messages"></section>

      <section class="composer">
        <div class="composer-actions">
          <button id="attachCurrentFile">Attach File</button>
          <button id="attachImage">Attach Image</button>
          <button id="attachSelection">Attach Selection</button>
          <button id="stop" class="danger hidden">Stop</button>
        </div>
        <textarea id="prompt" rows="6" placeholder="Ask for a review, scaffold a feature, or switch to Agent mode for workspace edits."></textarea>
        <div class="send-row">
          <span id="status" class="status">Ready</span>
          <button id="send" class="primary">Send</button>
        </div>
      </section>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function normalizeChatCommand(command) {
  const normalized = String(command || "").trim().toLowerCase();
  return normalized || "ask";
}

function getNativeChatCommandSpec(command) {
  const commandMap = {
    ask: {
      name: "ask",
      label: "Ask",
      mode: "chat",
      executionMode: "plan",
      instruction:
        "Answer directly and practically. Use workspace context when it is relevant."
    },
    explain: {
      name: "explain",
      label: "Explain",
      mode: "chat",
      executionMode: "plan",
      instruction:
        "Explain the code clearly. Cover purpose, control flow, risks, and likely modification points."
    },
    review: {
      name: "review",
      label: "Review",
      mode: "chat",
      executionMode: "plan",
      instruction:
        "Review the code with a code-review mindset. Prioritize bugs, risks, regressions, and missing tests."
    },
    scaffold: {
      name: "scaffold",
      label: "Scaffold",
      mode: "agent",
      executionMode: "act",
      instruction:
        "Plan the file changes briefly, then use workspace tools to scaffold or extend the feature. If the workspace is empty, scaffold a full production-ready repository here."
    },
    refactor: {
      name: "refactor",
      label: "Refactor",
      mode: "agent",
      executionMode: "act",
      instruction:
        "Refactor the relevant code for clarity and maintainability. Keep behavior stable unless the user asks otherwise."
    },
    test: {
      name: "test",
      label: "Tests",
      mode: "agent",
      executionMode: "act",
      instruction:
        "Generate or update focused tests. Cover important behavior and edge cases."
    }
  };

  return commandMap[command] || commandMap.ask;
}

async function buildNativePrompt(request, commandSpec) {
  const blocks = [request.prompt.trim(), `Command intent: ${commandSpec.instruction}`];
  const referenceBlocks = await readChatReferences(request.references || []);

  if (!referenceBlocks.length) {
    const editorContext = await readActiveEditorContext(commandSpec);
    if (editorContext) {
      referenceBlocks.push(editorContext);
    }
  }

  if (referenceBlocks.length) {
    blocks.push("Attached context:\n\n" + referenceBlocks.join("\n\n"));
  }

  const directive = await buildExecutionDirectiveBlock({
    prompt: request.prompt,
    mode: commandSpec.mode,
    executionMode: commandSpec.executionMode
  });
  if (directive) {
    blocks.push(directive);
  }

  return blocks.filter(Boolean).join("\n\n");
}

async function buildNativeApiMessages(history, currentPrompt) {
  const messages = [{ role: "system", content: await buildWorkspaceSystemPrompt() }];

  for (const turn of history || []) {
    if (typeof turn.prompt === "string") {
      messages.push({ role: "user", content: turn.prompt });
      continue;
    }

    if (Array.isArray(turn.response)) {
      const content = chatResponseTurnToText(turn);
      if (content) {
        messages.push({ role: "assistant", content });
      }
    }
  }

  messages.push({ role: "user", content: currentPrompt });
  return messages;
}

async function buildWorkspaceSystemPrompt() {
  const instructions = await readWorkspaceInstructions();
  if (!instructions) {
    return DEFAULT_SYSTEM_PROMPT;
  }

  return `${DEFAULT_SYSTEM_PROMPT}\n\nWorkspace instructions:\n${instructions}`;
}

async function readWorkspaceInstructions() {
  const root = getOptionalWorkspaceRootPath();
  if (!root) {
    return "";
  }

  const target = path.join(root, WORKSPACE_INSTRUCTIONS_PATH);
  const text = await fs.readFile(target, "utf8").catch(() => "");
  return text.trim();
}

async function buildRequestContent(prompt, attachments, options) {
  const blocks = [String(prompt || "").trim()];
  const hasImageAttachments = attachments.some((item) => item && item.kind === "image");

  if (attachments.length) {
    const attachmentBlocks = attachments.map((item) => formatAttachmentBlock(item));
    blocks.push(`Workspace context:\n\n${attachmentBlocks.join("\n\n")}`);
  }

  const directive = await buildExecutionDirectiveBlock({
    prompt,
    mode: options && options.mode,
    executionMode: options && options.executionMode,
    hasImageAttachments
  });
  if (directive) {
    blocks.push(directive);
  }

  return blocks.filter(Boolean).join("\n\n");
}

function formatAttachmentBlock(item) {
  if (item && item.kind === "image") {
    return typeof item.content === "string" && item.content.trim()
      ? item.content.trim()
      : `Attached image: ${item.label}`;
  }

  const fence = item && typeof item.languageId === "string" ? item.languageId : "";
  return [
    `Attached ${item.kind}: ${item.label}`,
    `\`\`\`${fence}`,
    item.content,
    "```"
  ].join("\n");
}

async function buildExecutionDirectiveBlock({ prompt, mode, executionMode, hasImageAttachments }) {
  const normalizedMode = mode === "agent" ? "agent" : "chat";
  const normalizedExecutionMode = normalizeExecutionMode(executionMode);
  const workspaceSnapshot = await describeWorkspaceRoot();
  const lines = [];

  if (normalizedExecutionMode === "act") {
    lines.push(
      "Execution mode: act. Inspect the workspace before editing. When changes are needed, make them instead of stopping at a plan. Prefer workspace tool calls over pasting full file contents into chat."
    );
  } else {
    lines.push(
      "Execution mode: plan. Inspect the workspace if needed, but do not modify files or call write_file. Return a concrete implementation plan only."
    );
  }

  if (workspaceSnapshot && workspaceSnapshot.description) {
    lines.push(workspaceSnapshot.description);
  }

  if (normalizedMode === "agent") {
    lines.push(
      normalizedExecutionMode === "act"
        ? "For repository work, use workspace tools deliberately and write complete file contents."
        : "Return phases, exact file paths, stack choices, and validation steps."
    );
  }

  if (hasImageAttachments) {
    lines.push(
      "Attached image context was derived locally from image metadata and OCR. Treat it as a UI or product reference. When the request is to build from the image, turn that reference into real components, styling, project structure, and file writes rather than stopping at a mockup description."
    );
  }

  if (looksLikeRepoCreationRequest(prompt, workspaceSnapshot && workspaceSnapshot.empty)) {
    lines.push(
      "Tailor the repository to this local Apple Silicon workstation and keep it local-first."
    );
    if (workspaceSnapshot && workspaceSnapshot.empty) {
      lines.push(
        normalizedExecutionMode === "act"
          ? "Workspace state: empty project root. Create a full production-ready repository here. Do not leave demo placeholders, fake sample files, or TODO-only scaffolding. Write the real README, project metadata, source, tests, scripts, and local run instructions."
          : "Workspace state: empty project root. Return a full production-ready repository plan with exact file paths, responsibilities, and setup steps. Do not create files."
      );
    }
  }

  return lines.join("\n");
}

async function resolveEffectiveRequestMode(prompt, requested) {
  const mode = requested && requested.mode === "agent" ? "agent" : "chat";
  const executionMode = normalizeExecutionMode(requested && requested.executionMode);
  const workspaceSnapshot = await describeWorkspaceRoot();
  const shouldPromote =
    workspaceSnapshot &&
    workspaceSnapshot.empty &&
    looksLikeRepoCreationRequest(prompt, workspaceSnapshot.empty) &&
    (mode !== "agent" || executionMode !== "act");

  if (!shouldPromote) {
    return {
      mode,
      executionMode,
      autoPromoted: false
    };
  }

  return {
    mode: "agent",
    executionMode: "act",
    autoPromoted: true
  };
}

async function resolveAgentStepLimit(executionMode, messages) {
  const configured = Math.max(
    1,
    Math.round(
      clampNumber(
        vscode.workspace
          .getConfiguration("bluewirksLocalAgent")
          .get("agentMaxSteps", 6),
        1,
        48,
        6
      )
    )
  );

  if (normalizeExecutionMode(executionMode) !== "act") {
    return configured;
  }

  const workspaceSnapshot = await describeWorkspaceRoot();
  const latestUserContent = getLatestUserContent(messages);
  const isRepoBuild = looksLikeRepoCreationRequest(
    latestUserContent,
    workspaceSnapshot && workspaceSnapshot.empty
  );

  return isRepoBuild ? Math.max(configured, 24) : configured;
}

async function describeWorkspaceRoot() {
  const root = getOptionalWorkspaceRootPath();
  if (!root) {
    return null;
  }

  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    return null;
  }

  const visible = entries.filter((entry) => !isSkippableWorkspaceRootEntry(entry));
  if (!visible.length) {
    return {
      empty: true,
      description: "Workspace state: empty or metadata-only project root."
    };
  }

  const listed = visible.slice(0, 16).map((entry) =>
    `${entry.isDirectory() ? "dir" : "file"} ${entry.name}`
  );
  const extra =
    visible.length > listed.length ? `\n- ... ${visible.length - listed.length} more` : "";

  return {
    empty: false,
    description: `Workspace state: ${visible.length} root entries.\nRoot entries:\n- ${listed.join("\n- ")}${extra}`
  };
}

function isSkippableWorkspaceRootEntry(entry) {
  const name = entry && typeof entry.name === "string" ? entry.name : "";
  return sharedIsSkippableWorkspaceRootEntry(name);
}

const looksLikeRepoCreationRequest = sharedLooksLikeRepoCreationRequest;

function getLatestUserContent(messages) {
  const items = Array.isArray(messages) ? [...messages].reverse() : [];
  for (const item of items) {
    if (item && item.role === "user" && typeof item.content === "string" && item.content.trim()) {
      return item.content;
    }
  }
  return "";
}

function chatResponseTurnToText(turn) {
  const parts = [];
  for (const part of turn.response || []) {
    if (part.value && typeof part.value.value === "string") {
      parts.push(part.value.value);
    } else if (part.title || (part.value && typeof part.value.toString === "function")) {
      parts.push(part.title || part.value.toString());
    } else if (part.value && typeof part.value.title === "string") {
      parts.push(`[Button: ${part.value.title}]`);
    }
  }
  return parts.join("\n").trim();
}

async function readChatReferences(references) {
  const blocks = [];

  for (const reference of references) {
    const block = await readSingleChatReference(reference).catch(() => "");
    if (block) {
      blocks.push(block);
    }
  }

  return blocks;
}

async function readSingleChatReference(reference) {
  if (!reference) {
    return "";
  }

  const value = reference.value;
  const description = reference.modelDescription
    ? `Reference description: ${reference.modelDescription}`
    : "";

  if (isLocationLike(value)) {
    const uri = value.uri;
    const document = await vscode.workspace.openTextDocument(uri);
    const snippet = document.getText(value.range);
    return [
      `Referenced location: ${labelForUri(uri)}:${value.range.start.line + 1}-${value.range.end.line + 1}`,
      description,
      fenceBlock(document.languageId, clampText(snippet, 12000))
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (isUriLike(value)) {
    if (value.scheme === "file" || value.scheme === "vscode-remote") {
      if (isImageUriLike(value)) {
        return buildImageReferenceBlock(value, description);
      }

      const document = await vscode.workspace.openTextDocument(value);
      return [
        `Referenced file: ${labelForUri(value)}`,
        description,
        fenceBlock(document.languageId, clampText(document.getText(), 14000))
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [`Referenced resource: ${value.toString()}`, description].filter(Boolean).join("\n");
  }

  if (typeof value === "string") {
    return [`Referenced text:`, description, fenceBlock("", clampText(value, 12000))]
      .filter(Boolean)
      .join("\n");
  }

  if (description) {
    return description;
  }

  return "";
}

async function buildImageReferenceBlock(uri, description) {
  const analyzed = await analyzeImageForPrompt(uri.fsPath);
  return [
    `Referenced image: ${labelForUri(uri)}`,
    description,
    analyzed.block
  ]
    .filter(Boolean)
    .join("\n");
}

async function readActiveEditorContext(commandSpec) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return "";
  }

  const selectionFirst = ["explain", "review", "refactor", "test"].includes(commandSpec.name);
  const document = editor.document;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const relativePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath)
    : document.uri.fsPath;

  if (selectionFirst && !editor.selection.isEmpty) {
    return [
      `Active selection: ${relativePath}:${editor.selection.start.line + 1}-${editor.selection.end.line + 1}`,
      fenceBlock(document.languageId, clampText(document.getText(editor.selection), 12000))
    ].join("\n");
  }

  if (selectionFirst) {
    return [
      `Active file: ${relativePath}`,
      fenceBlock(document.languageId, clampText(document.getText(), 14000))
    ].join("\n");
  }

  return "";
}

async function createImageAttachment(uri) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const relativePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, uri.fsPath)
    : uri.fsPath;
  const analyzed = await analyzeImageForPrompt(uri.fsPath);

  return {
    id: makeId("attachment"),
    kind: "image",
    label: relativePath,
    sourcePath: uri.fsPath,
    mimeType: analyzed.mimeType,
    content: `Attached image: ${relativePath}\n${analyzed.block}`
  };
}

async function analyzeImageForPrompt(filePath) {
  const metadata = await readImageMetadata(filePath).catch(() => ({
    format: imageFormatFromPath(filePath),
    pixelWidth: 0,
    pixelHeight: 0
  }));
  const ocrText = await runTesseractOcr(filePath).catch(() => "");
  const metadataLine = summarizeImageMetadata(filePath, metadata);
  const lines = [metadataLine];

  if (ocrText) {
    lines.push(`Visible text extracted locally:\n${fenceBlock("", clampText(ocrText, IMAGE_OCR_CHAR_LIMIT))}`);
  } else {
    lines.push("Visible text extracted locally: none");
  }

  lines.push(
    "Use this image analysis as a design reference. If some layout details are ambiguous, state the assumption briefly and continue with a clean, production-ready implementation."
  );

  return {
    mimeType: imageMimeTypeFromPath(filePath),
    metadata,
    ocrText,
    block: lines.join("\n")
  };
}

async function readImageMetadata(filePath) {
  const output = await execFile("sips", ["-g", "format", "-g", "pixelWidth", "-g", "pixelHeight", filePath]);
  const format = matchSipsValue(output, "format") || imageFormatFromPath(filePath);
  const pixelWidth = Number(matchSipsValue(output, "pixelWidth")) || 0;
  const pixelHeight = Number(matchSipsValue(output, "pixelHeight")) || 0;
  return {
    format,
    pixelWidth,
    pixelHeight
  };
}

function matchSipsValue(output, key) {
  const match = String(output || "").match(new RegExp(`${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

async function runTesseractOcr(filePath) {
  const tesseractPath = await which("tesseract");
  if (!tesseractPath) {
    return "";
  }

  let output = await execFile(tesseractPath, [filePath, "stdout", "--psm", "11"]).catch(() => "");
  if (!normalizeOcrText(output)) {
    output = await runTesseractOcrOnStableCopy(tesseractPath, filePath);
  }
  return normalizeOcrText(output);
}

async function runTesseractOcrOnStableCopy(tesseractPath, filePath) {
  const home = process.env.HOME;
  if (!home) {
    return "";
  }

  const extension = path.extname(filePath) || ".png";
  const fallbackDir = path.join(home, "Library", "Caches", "bluewirks-local-agent");
  const fallbackPath = path.join(
    fallbackDir,
    `ocr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}${extension}`
  );

  try {
    await fs.mkdir(fallbackDir, { recursive: true });
    await fs.copyFile(filePath, fallbackPath);
    return await execFile(tesseractPath, [fallbackPath, "stdout", "--psm", "11"]).catch(
      () => ""
    );
  } finally {
    await fs.unlink(fallbackPath).catch(() => {});
  }
}

function normalizeOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function summarizeImageMetadata(filePath, metadata) {
  const parts = [`Image metadata: ${path.basename(filePath)}`];
  const format = metadata && metadata.format ? String(metadata.format).toUpperCase() : "unknown";
  parts.push(format);
  if (metadata && metadata.pixelWidth && metadata.pixelHeight) {
    parts.push(`${metadata.pixelWidth}x${metadata.pixelHeight}`);
  }
  return parts.join(" | ");
}

async function resolveWorkspaceTargetSelection(uri) {
  if (uri && typeof uri === "object" && typeof uri.fsPath === "string" && uri.fsPath) {
    return normalizeWorkspaceTargetFsPath(uri.fsPath);
  }

  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) {
    void vscode.window.showWarningMessage("Open a folder before setting a workspace target.");
    return "";
  }

  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  const picked = await vscode.window.showWorkspaceFolderPick({
    placeHolder: "Choose the workspace root for VSWirks Editor writes"
  });
  return picked ? picked.uri.fsPath : "";
}

async function normalizeWorkspaceTargetFsPath(fsPath) {
  const normalized = path.resolve(fsPath);
  const folder = getContainingWorkspaceFolderForPath(normalized);
  if (!folder) {
    throw new Error("The selected target must be inside an open workspace folder.");
  }

  const stat = await fs.stat(normalized).catch(() => null);
  return stat && stat.isDirectory() ? normalized : path.dirname(normalized);
}

async function setConfiguredWorkspaceTargetPath(targetPath) {
  await vscode.workspace
    .getConfiguration("bluewirksLocalAgent")
    .update(WORKSPACE_TARGET_CONFIG_KEY, targetPath, vscode.ConfigurationTarget.Workspace);
}

async function clearConfiguredWorkspaceTargetPath() {
  await vscode.workspace
    .getConfiguration("bluewirksLocalAgent")
    .update(WORKSPACE_TARGET_CONFIG_KEY, "", vscode.ConfigurationTarget.Workspace);
}

async function getConfiguredDefaultModel() {
  const configured = migrateLegacyDefaultModel(
    String(
    vscode.workspace
      .getConfiguration("bluewirksLocalAgent")
      .get("defaultModel", "")
    ).trim()
  );
  return configured || DEFAULT_MODEL;
}

function migrateLegacyDefaultModel(model) {
  return model === LEGACY_DEFAULT_MODEL ? DEFAULT_MODEL : model;
}

function getRuntimeBaseUrl() {
  return String(
    vscode.workspace
      .getConfiguration("bluewirksLocalAgent")
      .get("baseUrl", "http://127.0.0.1:7471/v1")
  ).replace(/\/$/, "");
}

function getRuntimeServiceUrl() {
  return getRuntimeBaseUrl().replace(/\/v1$/, "");
}

function getRuntimeLaunchConfig() {
  const configuration = vscode.workspace.getConfiguration("bluewirksLocalAgent");
  const runtimeUrl = new URL(getRuntimeServiceUrl());
  return {
    python: String(configuration.get("runtimePython", DEFAULT_RUNTIME_PYTHON)).trim() || DEFAULT_RUNTIME_PYTHON,
    cwd: String(configuration.get("runtimeCwd", DEFAULT_RUNTIME_CWD)).trim() || DEFAULT_RUNTIME_CWD,
    args: [
      "-m",
      "uvicorn",
      "app.main:app",
      "--host",
      runtimeUrl.hostname || "127.0.0.1",
      "--port",
      runtimeUrl.port || "7471"
    ]
  };
}

function getGenerationSettingsSnapshot() {
  const configuration = vscode.workspace.getConfiguration("bluewirksLocalAgent");
  return normalizeGenerationSettings({
    chatTemperature: configuration.get(
      "chatTemperature",
      DEFAULT_GENERATION_SETTINGS.chatTemperature
    ),
    chatTopP: configuration.get("chatTopP", DEFAULT_GENERATION_SETTINGS.chatTopP),
    chatMaxTokens: configuration.get(
      "chatMaxTokens",
      DEFAULT_GENERATION_SETTINGS.chatMaxTokens
    ),
    agentTemperature: configuration.get(
      "agentTemperature",
      DEFAULT_GENERATION_SETTINGS.agentTemperature
    ),
    agentTopP: configuration.get("agentTopP", DEFAULT_GENERATION_SETTINGS.agentTopP),
    agentMaxTokens: configuration.get(
      "agentMaxTokens",
      DEFAULT_GENERATION_SETTINGS.agentMaxTokens
    )
  });
}

function getGenerationOptions(mode) {
  const settings = getGenerationSettingsSnapshot();
  if (mode === "agent") {
    return {
      temperature: settings.agentTemperature,
      top_p: settings.agentTopP,
      max_tokens: settings.agentMaxTokens
    };
  }
  return {
    temperature: settings.chatTemperature,
    top_p: settings.chatTopP,
    max_tokens: settings.chatMaxTokens
  };
}

async function fetchRuntimeJson(endpoint, body, token) {
  const controller = new AbortController();
  const disposable =
    token && typeof token.onCancellationRequested === "function"
      ? token.onCancellationRequested(() => controller.abort())
      : { dispose() {} };

  try {
    return await sharedFetchRuntimeJson(
      getRuntimeBaseUrl(),
      endpoint,
      body,
      controller.signal
    );
  } finally {
    disposable.dispose();
  }
}

async function streamRuntimeChat(body, token, handlers) {
  const controller = new AbortController();
  const disposable =
    token && typeof token.onCancellationRequested === "function"
      ? token.onCancellationRequested(() => controller.abort())
      : { dispose() {} };
  try {
    await sharedStreamRuntimeChat(getRuntimeBaseUrl(), body, controller.signal, handlers);
  } finally {
    disposable.dispose();
  }
}

async function executeWorkspaceToolCall(toolCall) {
  const name = toolCall && toolCall.function && toolCall.function.name;
  const args = safeJsonParse(
    toolCall && toolCall.function ? toolCall.function.arguments : "{}"
  );

  switch (name) {
    case "list_workspace":
      return toolListWorkspace(args);
    case "read_file":
      return toolReadFile(args);
    case "search_workspace":
      return toolSearchWorkspace(args);
    case "write_file":
      return toolWriteFile(args);
    case "open_file":
      return toolOpenFile(args);
    default:
      return {
        summary: `Skipped unknown tool ${name}`,
        content: JSON.stringify({ ok: false, error: `Unknown tool ${name}` })
      };
  }
}

async function toolListWorkspace(args) {
  const root = getWorkspaceRootPath();
  const requestedPath = typeof args.path === "string" ? args.path : ".";
  const folder = resolveWorkspacePathGlobal(requestedPath, root);
  const maxEntries = clampNumber(args.max_entries, 10, 500, 120);
  const pattern = new vscode.RelativePattern(folder, "**/*");
  const files = await vscode.workspace.findFiles(
    pattern,
    "**/{.git,node_modules,.venv,.pytest_cache,__pycache__,dist,build}/**",
    maxEntries
  );
  const entries = filterIgnoredWorkspacePaths(files.map((uri) => path.relative(root, uri.fsPath))).sort();
  return {
    summary: `Listed ${entries.length} workspace files`,
    content: JSON.stringify({ ok: true, root, entries })
  };
}

async function toolReadFile(args) {
  const root = getWorkspaceRootPath();
  const target = resolveWorkspacePathGlobal(args.path, root);
  const content = await fs.readFile(target, "utf8");
  return {
    summary: `Read ${path.relative(root, target)}`,
    content: JSON.stringify({
      ok: true,
      path: path.relative(root, target),
      content
    })
  };
}

async function toolSearchWorkspace(args) {
  const root = getWorkspaceRootPath();
  const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
  if (!pattern) {
    throw new Error("search_workspace requires a non-empty pattern");
  }

  const maxResults = clampNumber(args.max_results, 1, 200, 30);
  const glob = typeof args.glob === "string" ? args.glob : undefined;
  const rgPath = await which("rg");

  if (rgPath) {
    const rgArgs = ["--line-number", "--no-heading", "--color", "never", pattern, root];
    if (glob) {
      rgArgs.push("-g", glob);
    }
    appendRipgrepIgnoreGlobs(rgArgs);
    const output = await execFile(rgPath, rgArgs);
    const lines = output
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, maxResults);
    return {
      summary: `Found ${lines.length} matches`,
      content: JSON.stringify({ ok: true, matches: lines })
    };
  }

  const include = glob || "**/*";
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, include),
    "**/{.git,node_modules,.venv,.pytest_cache,__pycache__,dist,build}/**",
    200
  );
  const matches = [];

  for (const file of files) {
    if (matches.length >= maxResults) {
      break;
    }
    if (isIgnoredWorkspacePath(path.relative(root, file.fsPath))) {
      continue;
    }
    const text = await fs.readFile(file.fsPath, "utf8").catch(() => "");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (matches.length < maxResults && line.includes(pattern)) {
        matches.push(`${path.relative(root, file.fsPath)}:${index + 1}:${line}`);
      }
    });
  }

  return {
    summary: `Found ${matches.length} matches`,
    content: JSON.stringify({ ok: true, matches })
  };
}

async function toolWriteFile(args) {
  const root = getWorkspaceRootPath();
  const target = resolveWorkspacePathGlobal(args.path, root);
  const content = typeof args.content === "string" ? args.content : "";
  if (!content && content !== "") {
    throw new Error("write_file requires string content");
  }

  const requiresApproval = vscode.workspace
    .getConfiguration("bluewirksLocalAgent")
    .get("writeRequiresApproval", true);

  const relativePath = path.relative(root, target);
  if (requiresApproval) {
    const approval = await requestWriteApproval(relativePath, {
      promptLabel: "VSWirks Local",
      currentMode: globalWriteApprovalMode,
      scope: "session"
    });
    if (!approval.approved) {
      return {
        summary: `Write denied for ${relativePath}`,
        content: JSON.stringify({ ok: false, denied: true, path: relativePath })
      };
    }

    if (approval.nextMode === "chat") {
      globalWriteApprovalMode = "chat";
    }
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  let backupPath = null;
  if (await exists(target)) {
    const stamp = timestamp();
    backupPath = `${target}.bak.${stamp}`;
    await fs.copyFile(target, backupPath);
  }

  await fs.writeFile(target, content, "utf8");
  return {
    summary: `Wrote ${relativePath}`,
    content: JSON.stringify({
      ok: true,
      path: relativePath,
      backupPath: backupPath ? path.relative(root, backupPath) : null
    })
  };
}

async function toolOpenFile(args) {
  const root = getWorkspaceRootPath();
  const target = resolveWorkspacePathGlobal(args.path, root);
  const document = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(document, { preview: false });
  return {
    summary: `Opened ${path.relative(root, target)}`,
    content: JSON.stringify({ ok: true, path: path.relative(root, target) })
  };
}

function getWorkspaceRootPath() {
  return getWorkspaceTargetPath();
}

function getOptionalWorkspaceRootPath() {
  return getOptionalWorkspaceTargetPath();
}

function getWorkspaceTargetPath() {
  const configured = getConfiguredWorkspaceTargetPath();
  if (configured) {
    return configured;
  }

  const activeFolder = getActiveEditorWorkspaceFolder();
  if (activeFolder) {
    return activeFolder.uri.fsPath;
  }

  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) {
    throw new Error("Open a workspace folder before using VSWirks Editor commands.");
  }
  return folder.uri.fsPath;
}

function getOptionalWorkspaceTargetPath() {
  try {
    return getWorkspaceTargetPath();
  } catch {
    return "";
  }
}

function getConfiguredWorkspaceTargetPath() {
  const configured = String(
    vscode.workspace
      .getConfiguration("bluewirksLocalAgent")
      .get(WORKSPACE_TARGET_CONFIG_KEY, "")
  ).trim();
  if (!configured) {
    return "";
  }

  return getContainingWorkspaceFolderForPath(configured) ? configured : "";
}

function getActiveEditorWorkspaceFolder() {
  const editor = vscode.window.activeTextEditor;
  return editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri) : null;
}

function getContainingWorkspaceFolderForPath(targetPath) {
  const folders = vscode.workspace.workspaceFolders || [];
  const normalized = path.resolve(String(targetPath || ""));
  return folders.find((folder) => isPathWithin(folder.uri.fsPath, normalized)) || null;
}

function isPathWithin(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWorkspacePathGlobal(inputPath, root) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("A relative workspace path is required.");
  }

  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }

  return resolved;
}

function getWorkspaceLabel() {
  const targetPath = getOptionalWorkspaceTargetPath();
  if (!targetPath) {
    return "";
  }

  return formatWorkspaceTargetLabel(targetPath);
}

function formatWorkspaceTargetLabel(targetPath) {
  const folder = getContainingWorkspaceFolderForPath(targetPath);
  if (!folder) {
    return path.basename(targetPath);
  }

  const relative = path.relative(folder.uri.fsPath, targetPath);
  return relative ? `${folder.name} -> ${relative}` : folder.name;
}

function workspaceRelativeUri(relativePath) {
  if (!relativePath) {
    return null;
  }

  try {
    const root = getWorkspaceRootPath();
    return vscode.Uri.file(resolveWorkspacePathGlobal(relativePath, root));
  } catch {
    return null;
  }
}

function isImageUriLike(value) {
  return Boolean(value && isUriLike(value) && isImagePath(value.fsPath || ""));
}

function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase());
}

function touchedPathsMarkdown(paths) {
  if (!paths || !paths.length) {
    return "";
  }

  const lines = ["\n\nTouched files:"];
  for (const item of paths) {
    lines.push(`- \`${item}\``);
  }
  return lines.join("\n");
}

function isUriLike(value) {
  return Boolean(value && typeof value === "object" && typeof value.scheme === "string");
}

function isLocationLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.uri &&
      typeof value.uri.scheme === "string" &&
      value.range &&
      typeof value.range.start === "object" &&
      typeof value.range.end === "object"
  );
}

function labelForUri(uri) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (workspaceFolder) {
    return path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  }
  return uri.fsPath || uri.toString();
}

function imageFormatFromPath(filePath) {
  return path.extname(String(filePath || "")).replace(/^\./, "") || "unknown";
}

function imageMimeTypeFromPath(filePath) {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  const byExtension = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff"
  };
  return byExtension[extension] || "application/octet-stream";
}

function fenceBlock(language, content) {
  return `\`\`\`${language || ""}\n${content}\n\`\`\``;
}

function clampText(text, limit) {
  const normalized = typeof text === "string" ? text : String(text || "");
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function getWorkspaceToolsForExecution(executionMode) {
  return normalizeExecutionMode(executionMode) === "act" ? getAgentTools() : getPlannerTools();
}

function getPlannerTools() {
  return [
    {
      type: "function",
      function: {
        name: "list_workspace",
        description: "List files in the current workspace.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative directory to list. Use '.' for the root."
            },
            max_entries: {
              type: "number",
              description: "Maximum number of paths to return."
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a text file from the workspace.",
        parameters: {
          type: "object",
          required: ["path"],
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative file path."
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "search_workspace",
        description: "Search for a string in workspace files.",
        parameters: {
          type: "object",
          required: ["pattern"],
          properties: {
            pattern: {
              type: "string",
              description: "Plain text or regex-like search term."
            },
            glob: {
              type: "string",
              description: "Optional include glob such as '**/*.ts'."
            },
            max_results: {
              type: "number",
              description: "Maximum number of matches to return."
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "open_file",
        description: "Open a workspace file in the editor.",
        parameters: {
          type: "object",
          required: ["path"],
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative file path."
            }
          }
        }
      }
    }
  ];
}

function getAgentTools() {
  return [
    {
      type: "function",
      function: {
        name: "list_workspace",
        description: "List files in the current workspace.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative directory to list. Use '.' for the root."
            },
            max_entries: {
              type: "number",
              description: "Maximum number of paths to return."
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a text file from the workspace.",
        parameters: {
          type: "object",
          required: ["path"],
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative file path."
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "search_workspace",
        description: "Search for a string in workspace files.",
        parameters: {
          type: "object",
          required: ["pattern"],
          properties: {
            pattern: {
              type: "string",
              description: "Plain text or regex-like search term."
            },
            glob: {
              type: "string",
              description: "Optional include glob such as '**/*.ts'."
            },
            max_results: {
              type: "number",
              description: "Maximum number of matches to return."
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Write complete file contents to a workspace file. Existing files are backed up before overwrite.",
        parameters: {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative file path."
            },
            content: {
              type: "string",
              description: "Complete new file contents."
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "open_file",
        description: "Open a workspace file in the editor.",
        parameters: {
          type: "object",
          required: ["path"],
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative file path."
            }
          }
        }
      }
    }
  ];
}

function buildToolPreview(toolName, result) {
  const parsed = safeJsonParse(result.content);
  const summary = result.summary || `${toolName} completed`;

  switch (toolName) {
    case "list_workspace":
      return {
        summary,
        details: limitText((parsed.entries || []).join("\n")),
        error: parsed.ok === false
      };
    case "read_file":
      return {
        summary,
        details: limitText(parsed.content || ""),
        path: parsed.path || null,
        error: parsed.ok === false
      };
    case "search_workspace":
      return {
        summary,
        details: limitText((parsed.matches || []).join("\n")),
        error: parsed.ok === false
      };
    case "write_file":
      return {
        summary,
        details: parsed.backupPath
          ? `Backup created: ${parsed.backupPath}`
          : parsed.denied
            ? "Write denied by user."
            : "",
        path: parsed.path || null,
        error: parsed.ok === false
      };
    case "open_file":
      return {
        summary,
        details: "",
        path: parsed.path || null,
        error: parsed.ok === false
      };
    default:
      return {
        summary,
        details: limitText(result.content),
        path: parsed.path || null,
        error: parsed.ok === false
      };
  }
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function normalizeGenerationSettings(settings) {
  return {
    chatTemperature: clampNumber(
      settings.chatTemperature,
      0,
      2,
      DEFAULT_GENERATION_SETTINGS.chatTemperature
    ),
    chatTopP: clampNumber(
      settings.chatTopP,
      0.1,
      1,
      DEFAULT_GENERATION_SETTINGS.chatTopP
    ),
    chatMaxTokens: Math.round(
      clampNumber(
        settings.chatMaxTokens,
        256,
        8192,
        DEFAULT_GENERATION_SETTINGS.chatMaxTokens
      )
    ),
    agentTemperature: clampNumber(
      settings.agentTemperature,
      0,
      2,
      DEFAULT_GENERATION_SETTINGS.agentTemperature
    ),
    agentTopP: clampNumber(
      settings.agentTopP,
      0.1,
      1,
      DEFAULT_GENERATION_SETTINGS.agentTopP
    ),
    agentMaxTokens: Math.round(
      clampNumber(
        settings.agentMaxTokens,
        256,
        8192,
        DEFAULT_GENERATION_SETTINGS.agentMaxTokens
      )
    )
  };
}

async function probeRuntimeHealth() {
  return sharedProbeRuntimeHealth(getRuntimeBaseUrl());
}

async function waitForRuntimeHealthy(timeoutMs) {
  return sharedWaitForRuntimeHealthy(getRuntimeBaseUrl(), timeoutMs);
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

const delay = sharedDelay;

async function requestWriteApproval(relativePath, options) {
  const currentMode = normalizeWriteApprovalMode(options && options.currentMode);
  if (currentMode === "chat") {
    return {
      approved: true,
      nextMode: "chat"
    };
  }

  const selection = await vscode.window.showWarningMessage(
    `Allow ${options && options.promptLabel ? options.promptLabel : "VSWirks Editor"} to write ${relativePath}?`,
    { modal: true },
    "Write File",
    "Approve Chat"
  );

  if (selection === "Approve Chat") {
    return {
      approved: true,
      nextMode: "chat"
    };
  }

  return {
    approved: selection === "Write File",
    nextMode: "ask"
  };
}

const normalizeExecutionMode = sharedNormalizeExecutionMode;
const normalizeWriteApprovalMode = sharedNormalizeWriteApprovalMode;
const clampNumber = sharedClampNumber;

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

const safeJsonParse = sharedSafeJsonParse;

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function which(program) {
  try {
    const output = await execFile("which", [program]);
    const trimmed = output.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function execFile(command, args) {
  return new Promise((resolve, reject) => {
    cp.execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function createThread(seed) {
  return {
    id: makeId("thread"),
    title: seed && seed.title ? seed.title : "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: seed && seed.mode === "agent" ? "agent" : "chat",
    executionMode: normalizeExecutionMode(seed && seed.executionMode),
    writeApprovalMode: normalizeWriteApprovalMode(seed && seed.writeApprovalMode),
    model: seed && typeof seed.model === "string" ? seed.model : "",
    messages: []
  };
}

function normalizeThread(thread) {
  if (!thread || typeof thread !== "object" || !Array.isArray(thread.messages)) {
    return null;
  }

  const messages = thread.messages
    .map((message) => normalizeMessage(message))
    .filter(Boolean);

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
    model: typeof thread.model === "string" ? thread.model : "",
    messages
  };
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  if (!["user", "assistant", "tool"].includes(message.role)) {
    return null;
  }

  return {
    id: typeof message.id === "string" && message.id ? message.id : makeId("message"),
    role: message.role,
    content: typeof message.content === "string" ? message.content : "",
    renderedContent:
      typeof message.renderedContent === "string" ? message.renderedContent : undefined,
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    model: typeof message.model === "string" ? message.model : "",
    mode: message.mode === "agent" ? "agent" : "chat",
    executionMode: normalizeExecutionMode(message.executionMode),
    pending: false,
    status: typeof message.status === "string" ? message.status : "",
    usage: message.usage && typeof message.usage === "object" ? message.usage : undefined,
    toolName: typeof message.toolName === "string" ? message.toolName : "",
    summary: typeof message.summary === "string" ? message.summary : "",
    path: typeof message.path === "string" ? message.path : "",
    error: Boolean(message.error),
    createdAt: Number(message.createdAt) || Date.now()
  };
}

const makeId = sharedMakeId;
const titleFromPrompt = sharedTitleFromPrompt;

function touchThread(threads, threadId) {
  const index = threads.findIndex((entry) => entry.id === threadId);
  if (index === -1) {
    return;
  }
  const [thread] = threads.splice(index, 1);
  thread.updatedAt = Date.now();
  threads.unshift(thread);
}

function findMessage(threads, messageId) {
  for (const thread of threads) {
    const message = thread.messages.find((entry) => entry.id === messageId);
    if (message) {
      return message;
    }
  }
  return null;
}

function getLatestAssistantMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      return messages[index];
    }
  }
  return null;
}

const limitText = sharedLimitText;

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
