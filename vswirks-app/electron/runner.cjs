const fs = require("fs/promises");
const path = require("path");
const { spawnSync } = require("node:child_process");

const {
  DEFAULT_SYSTEM_PROMPT,
  WORKSPACE_INSTRUCTIONS_PATH,
  MAX_API_MESSAGES,
  makeId,
  titleFromPrompt,
  clampText,
  limitText,
  safeJsonParse,
  normalizeExecutionMode,
  getGenerationOptions,
  looksLikeRepoCreationRequest
} = require("../../shared/core");
const { fetchRuntimeJson, streamRuntimeChat } = require("../../shared/runtime-client");
const {
  describeWorkspaceRoot,
  listWorkspace,
  readWorkspaceFile,
  searchWorkspace,
  writeWorkspaceFile,
  computeWorkspaceDiff,
  scanProjectIntelligence,
  openInVSWirksEditor
} = require("./workspace-tools.cjs");

/**
 * Trim a messages array to fit within MAX_API_MESSAGES while preserving the
 * system message (first) and the most recent conversation turns. Older
 * assistant/tool/user pairs in the middle are dropped.
 */
function trimMessagesForApi(messages) {
  if (messages.length <= MAX_API_MESSAGES) {
    return messages;
  }
  const head = messages[0] && messages[0].role === "system" ? [messages[0]] : [];
  const keep = MAX_API_MESSAGES - head.length;
  return head.concat(messages.slice(-keep));
}

const REPO_MANIFEST_PATHS = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "cargo.toml",
  "go.mod",
  "package.swift"
]);
const REPO_ENTRYPOINT_PATTERNS = [
  /^main\.py$/i,
  /^app\/main\.py$/i,
  /^src\/main\.(t|j)sx?$/i,
  /^src\/index\.(t|j)sx?$/i,
  /^electron\/main\.[cm]?[jt]s$/i,
  /^cmd\/[^/]+\/main\.go$/i,
  /^sources\/.+\/main\.swift$/i,
  /^main\.swift$/i
];
const REPO_SOURCE_PATTERNS = [
  /^src\/.+/i,
  /^app\/.+/i,
  /^lib\/.+/i,
  /^electron\/.+/i,
  /^server\/.+/i,
  /^client\/.+/i,
  /^cmd\/.+/i,
  /^sources\/.+/i,
  /^main\.py$/i
];
const REPO_TEST_PATTERNS = [/^tests?\//i, /^__tests__\//i, /\.test\.[^/]+$/i, /\.spec\.[^/]+$/i];
const PLACEHOLDER_ARTIFACT_PATTERN =
  /(placeholder\s+(for|logic|implementation)|\btodo\b|not implemented|\bstub\b|coming soon|sample app|demo skeleton|mock implementation)/i;
const DEFAULT_SCAFFOLD_PHASE_PLAN = Object.freeze({
  summary:
    "Build the repository in focused phases so architecture, implementation layers, and integration are completed before final validation.",
  phases: Object.freeze([
    {
      id: "bootstrap",
      label: "Architecture and bootstrap",
      goal:
        "Choose the concrete stack, create repository metadata, README, scripts, and the initial file structure with clear contracts for later phases.",
      ownership: [
        "README.md",
        ".gitignore",
        "package.json",
        "package-lock.json",
        "pyproject.toml",
        "requirements.txt",
        "Cargo.toml",
        "go.mod",
        "Package.swift",
        "docs/**",
        "scripts/**",
        ".github/**"
      ],
      required_outputs: [
        "repository manifest",
        "README with local run instructions",
        "initial architecture and file structure"
      ],
      requiredPathGroups: [
        ["README.md"],
        [
          "package.json",
          "pyproject.toml",
          "requirements.txt",
          "Cargo.toml",
          "go.mod",
          "Package.swift"
        ],
        [
          "src/**",
          "app/**",
          "lib/**",
          "server/**",
          "client/**",
          "frontend/**",
          "templates/**",
          "static/**",
          "main.py"
        ]
      ],
      must_write: true,
      allow_materialization: true,
      max_steps: 6
    },
    {
      id: "backend",
      label: "Backend and core implementation",
      goal:
        "Implement the real core capability, domain logic, entrypoints, and backend tests without placeholder logic.",
      ownership: [
        "main.py",
        "app/**",
        "src/**",
        "lib/**",
        "server/**",
        "backend/**",
        "cmd/**",
        "Sources/**",
        "electron/**",
        "tests/**",
        "__tests__/**",
        "test/**"
      ],
      required_outputs: ["real core implementation", "runnable entrypoint", "backend tests"],
      requiredPathGroups: [
        [
          "main.py",
          "app/main.py",
          "src/main.ts",
          "src/index.ts",
          "src/main.js",
          "src/index.js",
          "backend/**",
          "server/**",
          "app/**",
          "src/**",
          "lib/**",
          "cmd/**",
          "sources/**",
          "electron/**"
        ],
        ["tests/**", "__tests__/**", "test/**"]
      ],
      requiredWritePathGroups: [
        [
          "main.py",
          "app/**",
          "src/**",
          "lib/**",
          "server/**",
          "backend/**",
          "cmd/**",
          "sources/**",
          "electron/**"
        ],
        [
          "main.py",
          "app/main.py",
          "app/**/main.*",
          "src/main.*",
          "src/**/main.*",
          "src/index.*",
          "src/**/index.*",
          "server/main.*",
          "server/**/main.*",
          "backend/main.*",
          "backend/**/main.*",
          "electron/main.*",
          "electron/**/main.*",
          "cmd/**/main.go",
          "sources/**/main.swift",
          "main.swift"
        ],
        ["tests/**", "__tests__/**", "test/**"]
      ],
      must_write: true,
      allow_materialization: false,
      max_steps: 8
    },
    {
      id: "middleware",
      label: "Middleware and orchestration",
      goal:
        "Wire the core logic into the app runtime, API, IPC, job flow, and error handling so the backend and user-facing layer can work together locally.",
      ownership: [
        "api/**",
        "routes/**",
        "services/**",
        "middleware/**",
        "ipc/**",
        "electron/**",
        "server/**",
        "src/services/**",
        "src/api/**",
        "src/ipc/**",
        "app/services/**",
        "app/api/**"
      ],
      required_outputs: ["local orchestration layer", "runtime wiring", "error handling path"],
      must_write: true,
      allow_materialization: false,
      max_steps: 6
    },
    {
      id: "frontend",
      label: "Frontend and user experience",
      goal:
        "Implement the user-facing surface for the chosen architecture and connect it to the existing local contracts.",
      ownership: [
        "src/components/**",
        "src/ui/**",
        "src/views/**",
        "src/pages/**",
        "src/styles/**",
        "templates/**",
        "static/**",
        "public/**",
        "web/**",
        "frontend/**",
        "client/**",
        "index.html",
        "app.css",
        "styles.css"
      ],
      required_outputs: ["user-facing flow", "wired UI", "local interaction path"],
      must_write: true,
      allow_materialization: false,
      max_steps: 6
    },
    {
      id: "review",
      label: "Integration review and polish",
      goal:
        "Inspect the assembled repository, patch mismatches across layers, complete validation hooks, and leave the repo ready for local verification.",
      ownership: ["README.md", "tests/**", "__tests__/**", "docs/**", "scripts/**", "**/*"],
      required_outputs: ["integration fixes", "verification path", "coherent repository"],
      must_write: false,
      allow_materialization: false,
      max_steps: 5
    }
  ])
});

async function runConversation({
  project,
  thread,
  prompt,
  mode,
  executionMode,
  model,
  modelSelection,
  attachments,
  generationSettings,
  runtimeBaseUrl,
  signal,
  writeRequiresApproval,
  requestApproval,
  onState,
  onStatus,
  onRunEvent,
  onRunCheckpoint,
  workflowPreset,
  specDraft,
  intelligence,
  promptContext,
  runRecord
}) {
  const normalizedMode = mode === "agent" ? "agent" : "chat";
  const normalizedExecution = normalizeExecutionMode(executionMode);
  const effectiveRequest = await resolveEffectiveRequestMode(prompt, {
    mode: normalizedMode,
    executionMode: normalizedExecution,
    workspaceRoot: project.targetPath || project.workspaceRoot
  });

  const userContent = await buildRequestContent(
    prompt,
    attachments,
    effectiveRequest,
    project.targetPath || project.workspaceRoot,
    {
      workflowPreset,
      specDraft,
      intelligence,
      promptPrefix: promptContext && promptContext.promptPrefix ? promptContext.promptPrefix : ""
    }
  );

  thread.mode = effectiveRequest.mode;
  thread.executionMode = effectiveRequest.executionMode;
  thread.model = typeof modelSelection === "string" ? modelSelection : "";
  thread.modelOverride = typeof modelSelection === "string" ? modelSelection : "";
  thread.lastModelUsed = model;
  thread.currentRunId = runRecord.id;

  thread.messages.push({
    id: makeId("message"),
    role: "user",
    content: prompt,
    renderedContent: userContent,
    mode: effectiveRequest.mode,
    executionMode: effectiveRequest.executionMode,
    attachments: attachments.map((item) => ({
      id: item.id,
      label: item.label,
      kind: item.kind
    })),
    createdAt: Date.now()
  });

  if (thread.messages.filter((item) => item.role === "user").length === 1) {
    thread.title = titleFromPrompt(prompt);
  }

  project.pendingAttachments = [];
  project.currentRunStatus =
    effectiveRequest.mode === "agent"
      ? effectiveRequest.executionMode === "act"
        ? "Agent running"
        : "Planning"
      : "Thinking";

  emitRunEvent(onRunEvent, {
    type: "context",
    label: effectiveRequest.autoPromoted
      ? "Auto-promoted request into Agent + Act for blank workspace"
      : "Prepared request context",
    detail: userContent
  });

  if (onStatus) {
    onStatus(
      effectiveRequest.autoPromoted
        ? "Auto-switched to Agent + Act for workspace build"
        : project.currentRunStatus
    );
  }
  if (onState) {
    onState();
  }

  if (effectiveRequest.mode === "agent") {
    await runAgentMode({
      project,
      thread,
      model,
      generationSettings,
      runtimeBaseUrl,
      signal,
      writeRequiresApproval,
      requestApproval,
      onState,
      onStatus,
      onRunEvent,
      onRunCheckpoint,
      workflowPreset,
      specDraft,
      intelligence,
      promptContext,
      runRecord
    });
    return;
  }

  await runChatMode({
    thread,
    model,
    generationSettings,
    runtimeBaseUrl,
    signal,
    workspaceRoot: project.targetPath || project.workspaceRoot,
    promptContext,
    workflowPreset,
    specDraft,
    intelligence,
    onState,
    onStatus,
    onRunEvent
  });
  project.currentRunStatus = "Response complete";
  emitRunEvent(onRunEvent, {
    type: "complete",
    label: "Chat response complete",
    detail: "Conversation completed without workspace writes."
  });
}

async function runChatMode({
  thread,
  model,
  generationSettings,
  runtimeBaseUrl,
  signal,
  workspaceRoot,
  promptContext,
  workflowPreset,
  specDraft,
  intelligence,
  onState,
  onStatus,
  onRunEvent
}) {
  const assistant = {
    id: makeId("assistant"),
    role: "assistant",
    content: "",
    model,
    mode: "chat",
    executionMode: "plan",
    pending: true,
    createdAt: Date.now()
  };
  thread.messages.push(assistant);
  if (onState) {
    onState();
  }

  const messages = await toApiMessages(thread, workspaceRoot, {
    workflowPreset,
    specDraft,
    intelligence,
    globalSystemPrompt: promptContext && promptContext.globalSystemPrompt,
    agentProfile: promptContext && promptContext.agentProfile,
    threadSystemPrompt: promptContext && promptContext.threadSystemPrompt
  });
  let usage = undefined;
  await streamRuntimeChat(
    runtimeBaseUrl,
    {
      model,
      stream: true,
      ...getGenerationOptions("chat", generationSettings),
      messages: trimMessagesForApi(messages),
      stream_options: {
        include_usage: true
      }
    },
    signal,
    {
      onText: (chunk) => {
        assistant.content += chunk;
        if (onStatus) {
          onStatus("Streaming response");
        }
        if (onState) {
          onState();
        }
      },
      onUsage: (nextUsage) => {
        usage = nextUsage;
      }
    }
  );

  assistant.pending = false;
  assistant.usage = usage;
  if (!assistant.content.trim()) {
    assistant.content = "(empty response)";
  }
  emitRunEvent(onRunEvent, {
    type: "complete",
    label: "Assistant response streamed",
    detail: assistant.content
  });
  if (onState) {
    onState();
  }
}

async function runAgentMode({
  project,
  thread,
  model,
  generationSettings,
  runtimeBaseUrl,
  signal,
  writeRequiresApproval,
  requestApproval,
  onState,
  onStatus,
  onRunEvent,
  onRunCheckpoint,
  workflowPreset,
  specDraft,
  intelligence,
  promptContext,
  runRecord
}) {
  const workspaceRoot = project.targetPath || project.workspaceRoot;
  const assistant = {
    id: makeId("assistant"),
    role: "assistant",
    content: "",
    model,
    mode: "agent",
    executionMode: thread.executionMode,
    pending: true,
    createdAt: Date.now()
  };
  thread.messages.push(assistant);
  if (onState) {
    onState();
  }

  const messages = await toApiMessages(thread, workspaceRoot, {
    workflowPreset,
    specDraft,
    intelligence,
    globalSystemPrompt: promptContext && promptContext.globalSystemPrompt,
    agentProfile: promptContext && promptContext.agentProfile,
    threadSystemPrompt: promptContext && promptContext.threadSystemPrompt
  });
  const stagedHandled = await maybeRunStagedScaffoldMode({
    project,
    thread,
    assistant,
    model,
    generationSettings,
    runtimeBaseUrl,
    signal,
    writeRequiresApproval,
    requestApproval,
    onState,
    onStatus,
    onRunEvent,
    onRunCheckpoint,
    workflowPreset,
    specDraft,
    intelligence,
    runRecord,
    workspaceRoot,
    messages
  });
  if (stagedHandled) {
    return;
  }
  const maxSteps = await resolveAgentStepLimit(thread.executionMode, messages, workspaceRoot);
  let finalUsage = undefined;
  let runApprovalMode = "ask";

  for (let step = 0; step < maxSteps; step += 1) {
    if (signal && signal.aborted) {
      break;
    }
    assistant.status = `${thread.executionMode === "act" ? "Agent" : "Plan"} step ${step + 1} of ${maxSteps}`;
    emitRunEvent(onRunEvent, {
      type: "context",
      label: assistant.status,
      detail: `Workflow: ${(workflowPreset && workflowPreset.label) || "Freeform"}`
    });
    if (onStatus) {
      onStatus(assistant.status);
    }
    if (onState) {
      onState();
    }

    const response = await fetchRuntimeJson(
      runtimeBaseUrl,
      "/chat/completions",
      {
        model,
        stream: false,
        ...getGenerationOptions("agent", generationSettings),
        messages: trimMessagesForApi(messages),
        tools: getWorkspaceToolsForExecution(thread.executionMode)
      },
      signal
    );

    const choice = response.choices && response.choices[0];
    const message = choice && choice.message ? choice.message : {};
    let toolCalls = extractPseudoToolCallsFromAssistantContent(
      Array.isArray(message.tool_calls) ? message.tool_calls : [],
      typeof message.content === "string" ? message.content : "",
      getWorkspaceToolsForExecution(thread.executionMode)
    );
    let assistantContent = typeof message.content === "string" ? message.content : "";

    finalUsage = response.usage;
    if (assistantContent) {
      assistant.content = assistantContent;
      if (onState) {
        onState();
      }
    }

    if (!toolCalls.length && thread.executionMode === "act") {
      const retry = await requestRepoToolCallRetry({
        model,
        generationSettings,
        workspaceRoot,
        messages,
        assistantContent: assistant.content,
        fetchJson: (payload) => fetchRuntimeJson(runtimeBaseUrl, "/chat/completions", payload, signal),
        onProgress: (label) => {
          if (onStatus) {
            onStatus(label);
          }
        }
      });
      if (retry) {
        toolCalls = extractPseudoToolCallsFromAssistantContent(
          retry.toolCalls,
          retry.assistantContent,
          getWorkspaceToolsForExecution(thread.executionMode)
        );
        assistantContent = retry.assistantContent;
        finalUsage = retry.usage || finalUsage;
        if (assistantContent) {
          assistant.content = assistantContent;
          if (onState) {
            onState();
          }
        }
      }
    }

    if (!toolCalls.length) {
      if (thread.executionMode === "act") {
        const materialized = await tryMaterializeActReply({
          model,
          workspaceRoot,
          messages,
          assistantContent: assistant.content,
          fetchJson: (payload) => fetchRuntimeJson(runtimeBaseUrl, "/chat/completions", payload, signal),
          executeTool: (toolCall) =>
            executeToolCall({
              toolCall,
              workspaceRoot,
              thread,
              project,
              writeRequiresApproval,
              currentRunApprovalMode: runApprovalMode,
              requestApproval,
              onRunEvent,
              onRunCheckpoint,
              currentStep: step + 1,
              runRecord
            }).then((result) => {
              if (result.nextRunApprovalMode) {
                runApprovalMode = result.nextRunApprovalMode;
              }
              return result;
            }),
          onToolResult: (toolName, result) => {
            recordToolMessage(thread, toolName, result);
            if (onStatus) {
              onStatus(result.summary);
            }
            if (onState) {
              onState();
            }
          },
          onProgress: (label) => {
            if (onStatus) {
              onStatus(label);
            }
          }
        });

        if (materialized.applied) {
          assistant.pending = false;
          assistant.status = "";
          assistant.usage = finalUsage;
          assistant.content = materialized.summary || assistant.content || "(materialized scaffold)";
          project.currentRunStatus = "Agent complete";
          emitRunEvent(onRunEvent, {
            type: "complete",
            label: "Agent materialized scaffold into workspace",
            detail: assistant.content
          });
          if (onState) {
            onState();
          }
          return;
        }
        if (materialized.reason) {
          assistant.pending = false;
          assistant.status = "";
          assistant.usage = finalUsage;
          assistant.content = [assistant.content, materialized.reason].filter(Boolean).join("\n\n");
          project.currentRunStatus = "Paused - scaffold incomplete";
          emitRunEvent(onRunEvent, {
            type: "warning",
            label: "Run paused: repo scaffold incomplete",
            detail: materialized.reason
          });
          emitCheckpoint(onRunCheckpoint, {
            runId: runRecord.id,
            label: "Paused for scaffold review",
            step: step + 1,
            threadMessageCount: thread.messages.length,
            eventCount: runRecord.events ? runRecord.events.length : 0,
            changedFiles: Array.isArray(runRecord.changedFiles) ? runRecord.changedFiles : []
          });
          if (onState) {
            onState();
          }
          return;
        }
      }

      assistant.pending = false;
      assistant.status = "";
      assistant.usage = finalUsage;
      assistant.content = assistant.content || "(empty response)";
      project.currentRunStatus =
        thread.executionMode === "act" ? "Agent complete" : "Plan complete";
      emitRunEvent(onRunEvent, {
        type: "complete",
        label:
          thread.executionMode === "act" ? "Agent response complete" : "Planner response complete",
        detail: assistant.content
      });
      if (onState) {
        onState();
      }
      return;
    }

    messages.push({
      role: "assistant",
      content: assistantContent || null,
      tool_calls: toolCalls
    });

    for (const toolCall of toolCalls) {
      emitRunEvent(onRunEvent, {
        type: "tool_call",
        label: toolCall && toolCall.function ? toolCall.function.name : "tool",
        detail: toolCall && toolCall.function ? toolCall.function.arguments || "" : ""
      });
      const result = await executeToolCall({
        toolCall,
        workspaceRoot,
        thread,
        project,
        writeRequiresApproval,
        currentRunApprovalMode: runApprovalMode,
        requestApproval,
        onRunEvent,
        onRunCheckpoint,
        currentStep: step + 1,
        runRecord
      });
      if (result.nextRunApprovalMode) {
        runApprovalMode = result.nextRunApprovalMode;
      }
      recordToolMessage(
        thread,
        toolCall && toolCall.function ? toolCall.function.name : "tool",
        result
      );
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.content
      });
      if (onStatus) {
        onStatus(result.summary);
      }
      if (onState) {
        onState();
      }
    }
  }

  assistant.pending = false;
  assistant.status = "";
  assistant.usage = finalUsage;
  assistant.content = `${assistant.content}\n\n${
    thread.executionMode === "act" ? "Agent" : "Planner"
  } paused after reaching the configured step limit. Resume the run to continue from the latest safe checkpoint.`;
  project.currentRunStatus = "Paused - resumable";
  emitRunEvent(onRunEvent, {
    type: "warning",
    label: "Run paused at step limit",
    detail:
      "The run reached the configured step limit and was left in a recoverable paused state."
  });
  emitCheckpoint(onRunCheckpoint, {
    runId: runRecord.id,
    label: "Paused at step limit",
    step: maxSteps,
    threadMessageCount: thread.messages.length,
    eventCount: runRecord.events ? runRecord.events.length : 0,
    changedFiles: Array.isArray(runRecord.changedFiles) ? runRecord.changedFiles : []
  });
  if (onState) {
    onState();
  }
}

async function maybeRunStagedScaffoldMode({
  project,
  thread,
  assistant,
  model,
  generationSettings,
  runtimeBaseUrl,
  signal,
  writeRequiresApproval,
  requestApproval,
  onState,
  onStatus,
  onRunEvent,
  onRunCheckpoint,
  workflowPreset,
  specDraft,
  intelligence,
  runRecord,
  workspaceRoot,
  messages
}) {
  const workspaceSnapshot = await describeWorkspaceRoot(workspaceRoot);
  const latestUserContent = getLatestUserContent(messages);
  if (
    normalizeExecutionMode(thread.executionMode) !== "act" ||
    !workflowPreset ||
    workflowPreset.id !== "scaffold-app" ||
    !isRepoBuildOnEmptyWorkspace(latestUserContent, workspaceSnapshot)
  ) {
    return false;
  }

  const fetchJson = (payload) =>
    fetchRuntimeJson(runtimeBaseUrl, "/chat/completions", payload, signal);
  const plan = await requestScaffoldExecutionPlan({
    model,
    workspaceRoot,
    latestUserContent,
    workflowPreset,
    specDraft,
    intelligence,
    fetchJson
  });
  const phaseSummaries = [];
  let finalUsage = undefined;
  let runApprovalMode = "ask";

  emitRunEvent(onRunEvent, {
    type: "context",
    label: "Prepared staged scaffold phases",
    detail: buildScaffoldPlanSummary(plan)
  });
  emitCheckpoint(onRunCheckpoint, {
    runId: runRecord.id,
    label: "Scaffold phase plan ready",
    step: 0,
    threadMessageCount: thread.messages.length,
    eventCount: runRecord.events ? runRecord.events.length : 0,
    changedFiles: Array.isArray(runRecord.changedFiles) ? runRecord.changedFiles : []
  });
  assistant.content = buildStagedScaffoldSummary(plan.summary, phaseSummaries);
  if (onState) {
    onState();
  }

  for (let phaseIndex = 0; phaseIndex < plan.phases.length; phaseIndex += 1) {
    const phase = plan.phases[phaseIndex];
    const phaseResult = await runScaffoldPhase({
      project,
      thread,
      assistant,
      model,
      generationSettings,
      workspaceRoot,
      fetchJson,
      signal,
      writeRequiresApproval,
      requestApproval,
      onState,
      onStatus,
      onRunEvent,
      onRunCheckpoint,
      runRecord,
      phase,
      phaseIndex,
      phaseCount: plan.phases.length,
      messages,
      currentRunApprovalMode: runApprovalMode,
      completedPhaseSummaries: phaseSummaries
    });
    if (phaseResult.nextRunApprovalMode) {
      runApprovalMode = phaseResult.nextRunApprovalMode;
    }
    finalUsage = phaseResult.usage || finalUsage;
    if (phaseResult.summaryLine) {
      phaseSummaries.push(phaseResult.summaryLine);
    }
    await refreshProjectIntelligenceSnapshot(project);
    assistant.content = buildStagedScaffoldSummary(plan.summary, phaseSummaries);
    if (onState) {
      onState();
    }

    if (phaseResult.pausedReason) {
      assistant.pending = false;
      assistant.status = "";
      assistant.usage = finalUsage;
      assistant.content = [assistant.content, phaseResult.pausedReason]
        .filter(Boolean)
        .join("\n\n");
      runRecord.status = "paused_recoverable";
      runRecord.summary = `Paused after ${phase.label}`;
      project.currentRunStatus = "Paused - scaffold incomplete";
      emitRunEvent(onRunEvent, {
        type: "warning",
        label: "Run paused: staged scaffold incomplete",
        detail: phaseResult.pausedReason
      });
      emitCheckpoint(onRunCheckpoint, {
        runId: runRecord.id,
        label: `Paused after ${phase.label}`,
        step: phaseIndex + 1,
        threadMessageCount: thread.messages.length,
        eventCount: runRecord.events ? runRecord.events.length : 0,
        changedFiles: Array.isArray(runRecord.changedFiles) ? runRecord.changedFiles : []
      });
      if (onState) {
        onState();
      }
      return true;
    }
  }

  assistant.pending = false;
  assistant.status = "";
  assistant.usage = finalUsage;
  assistant.content = buildStagedScaffoldSummary(plan.summary, phaseSummaries, runRecord.changedFiles);
  project.currentRunStatus = "Agent complete";
  emitRunEvent(onRunEvent, {
    type: "complete",
    label: "Staged scaffold complete",
    detail: assistant.content
  });
  if (onState) {
    onState();
  }
  return true;
}

async function runScaffoldPhase({
  project,
  thread,
  assistant,
  model,
  generationSettings,
  workspaceRoot,
  fetchJson,
  signal,
  writeRequiresApproval,
  requestApproval,
  onState,
  onStatus,
  onRunEvent,
  onRunCheckpoint,
  runRecord,
  phase,
  phaseIndex,
  phaseCount,
  messages,
  currentRunApprovalMode,
  completedPhaseSummaries
}) {
  const phasePrompt = buildScaffoldPhasePrompt({
    phase,
    phaseIndex,
    phaseCount,
    intelligence: project.intelligence,
    completedPhaseSummaries
  });
  const rootUserContent = getPrimaryUserContent(messages);
  const initialChangedSet = new Set(
    Array.isArray(runRecord.changedFiles) ? runRecord.changedFiles : []
  );
  let runApprovalMode = currentRunApprovalMode;
  let finalUsage = undefined;
  let latestAssistantContent = "";
  let previousChangedFileCount = 0;
  let consecutiveContractStallSteps = 0;

  messages.push({
    role: "user",
    content: phasePrompt
  });

  emitRunEvent(onRunEvent, {
    type: "context",
    label: `Starting ${phase.label}`,
    detail: phasePrompt
  });
  emitCheckpoint(onRunCheckpoint, {
    runId: runRecord.id,
    label: `Phase ready: ${phase.label}`,
    step: phaseIndex + 1,
    threadMessageCount: thread.messages.length,
    eventCount: runRecord.events ? runRecord.events.length : 0,
    changedFiles: Array.isArray(runRecord.changedFiles) ? runRecord.changedFiles : []
  });

  for (let step = 0; step < phase.maxSteps; step += 1) {
    if (signal && signal.aborted) {
      break;
    }
    const phaseStep = phaseIndex * 10 + step + 1;
    assistant.status = `${phase.label} step ${step + 1} of ${phase.maxSteps}`;
    if (onStatus) {
      onStatus(assistant.status);
    }
    emitRunEvent(onRunEvent, {
      type: "context",
      label: assistant.status,
      detail: `Staged scaffold phase ${phaseIndex + 1} of ${phaseCount}`
    });
    if (onState) {
      onState();
    }

    const response = await fetchJson({
      model,
      stream: false,
      ...getGenerationOptions("agent", generationSettings),
      messages: trimMessagesForApi(messages),
      tools: getAgentTools()
    });
    const choice = response && response.choices && response.choices[0];
    const message = choice && choice.message ? choice.message : {};
    let toolCalls = extractPseudoToolCallsFromAssistantContent(
      Array.isArray(message.tool_calls) ? message.tool_calls : [],
      typeof message.content === "string" ? message.content : "",
      getAgentTools()
    );
    let assistantContent = typeof message.content === "string" ? message.content : "";

    finalUsage = response.usage;
    if (assistantContent) {
      latestAssistantContent = assistantContent;
    }

    if (!toolCalls.length) {
      const retry = await requestPhaseToolCallRetry({
        model,
        generationSettings,
        messages,
        assistantContent: latestAssistantContent,
        fetchJson,
        phase,
        onProgress: (label) => {
          if (onStatus) {
            onStatus(label);
          }
        }
      });
      if (retry) {
        toolCalls = extractPseudoToolCallsFromAssistantContent(
          retry.toolCalls,
          retry.assistantContent,
          getAgentTools()
        );
        assistantContent = retry.assistantContent;
        latestAssistantContent = assistantContent || latestAssistantContent;
        finalUsage = retry.usage || finalUsage;
      }
    }

    if (!toolCalls.length && phase.allowMaterialization) {
      let materialized = await tryMaterializeActReply({
        model,
        workspaceRoot,
        messages,
        assistantContent: latestAssistantContent,
        fetchJson,
        executeTool: (toolCall) =>
          executeToolCall({
            toolCall,
            workspaceRoot,
            thread,
            project,
            writeRequiresApproval,
            currentRunApprovalMode: runApprovalMode,
            requestApproval,
            onRunEvent,
            onRunCheckpoint,
            currentStep: phaseStep,
            runRecord
          }).then((result) => {
            if (result.nextRunApprovalMode) {
              runApprovalMode = result.nextRunApprovalMode;
            }
            return result;
          }),
        onToolResult: (toolName, result) => {
          recordToolMessage(thread, toolName, result);
          if (onStatus) {
            onStatus(result.summary);
          }
          if (onState) {
            onState();
          }
        },
        onProgress: (label) => {
          if (onStatus) {
            onStatus(label);
          }
        }
      });
      if (
        shouldAttemptBootstrapMaterializationRecovery({
          phase,
          materialized
        })
      ) {
        materialized = await tryBootstrapPhaseRecovery({
          model,
          workspaceRoot,
          phase,
          rootUserContent,
          phasePrompt,
          assistantContent: latestAssistantContent,
          fetchJson,
          executeTool: (toolCall) =>
            executeToolCall({
              toolCall,
              workspaceRoot,
              thread,
              project,
              writeRequiresApproval,
              currentRunApprovalMode: runApprovalMode,
              requestApproval,
              onRunEvent,
              onRunCheckpoint,
              currentStep: phaseStep,
              runRecord
            }).then((result) => {
              if (result.nextRunApprovalMode) {
                runApprovalMode = result.nextRunApprovalMode;
              }
              return result;
            }),
          onToolResult: (toolName, result) => {
            recordToolMessage(thread, toolName, result);
            if (onStatus) {
              onStatus(result.summary);
            }
            if (onState) {
              onState();
            }
          },
          onProgress: (label) => {
            if (onStatus) {
              onStatus(label);
            }
          }
        });
      }

      if (materialized.applied) {
        const newChangedFiles = getNewChangedFiles(initialChangedSet, runRecord.changedFiles);
        return {
          usage: finalUsage,
          nextRunApprovalMode: runApprovalMode,
          summaryLine: buildScaffoldPhaseSummary({
            phase,
            newChangedFiles,
            assistantContent: materialized.summary || latestAssistantContent
          }),
          pausedReason: ""
        };
      }

      if (materialized.reason && phase.mustWrite) {
        return {
          usage: finalUsage,
          nextRunApprovalMode: runApprovalMode,
          summaryLine: "",
          pausedReason: materialized.reason
        };
      }
    }

    if (!toolCalls.length) {
      const newChangedFiles = getNewChangedFiles(initialChangedSet, runRecord.changedFiles);
      const ownedWrites = newChangedFiles.filter((item) => scaffoldPhaseOwnsPath(phase, item));
      const missingRequirements = await findMissingPhaseRequirements(phase, workspaceRoot);
      const missingWriteRequirements = findMissingPhaseWriteRequirements(phase, newChangedFiles);
      const invalidManifestIssues = await findInvalidStructuredWorkspaceFiles(workspaceRoot);
      if (phase.mustWrite && !newChangedFiles.length) {
        if (
          shouldAttemptPhaseContractRecovery({
            phase,
            changedFiles: newChangedFiles,
            ownedWrites,
            missingRequirements,
            missingWriteRequirements,
            invalidManifestIssues
          })
        ) {
          const recovered = await tryPhaseContractRecovery({
            model,
            workspaceRoot,
            phase,
            rootUserContent,
            phasePrompt,
            assistantContent: assistantContent || latestAssistantContent,
            missingRequirements,
            missingWriteRequirements,
            invalidManifestIssues,
            changedFiles: newChangedFiles,
            fetchJson,
            executeTool: (toolCall) =>
              executeToolCall({
                toolCall,
                workspaceRoot,
                thread,
                project,
                writeRequiresApproval,
                currentRunApprovalMode: runApprovalMode,
                requestApproval,
                onRunEvent,
                onRunCheckpoint,
                currentStep: phaseStep,
                runRecord
              }).then((result) => {
                if (result.nextRunApprovalMode) {
                  runApprovalMode = result.nextRunApprovalMode;
                }
                return result;
              }),
            onToolResult: (toolName, result) => {
              recordToolMessage(thread, toolName, result);
              if (onStatus) {
                onStatus(result.summary);
              }
              if (onState) {
                onState();
              }
            },
            onProgress: (label) => {
              if (onStatus) {
                onStatus(label);
              }
            }
          });
          if (recovered.applied) {
            const recoveredChangedFiles = getNewChangedFiles(
              initialChangedSet,
              runRecord.changedFiles
            );
            return {
              usage: finalUsage,
              nextRunApprovalMode: runApprovalMode,
              summaryLine: buildScaffoldPhaseSummary({
                phase,
                newChangedFiles: recoveredChangedFiles,
                assistantContent: recovered.summary || assistantContent || latestAssistantContent
              }),
              pausedReason: ""
            };
          }
          if (recovered.reason) {
            return {
              usage: finalUsage,
              nextRunApprovalMode: runApprovalMode,
              summaryLine: "",
              pausedReason: recovered.reason
            };
          }
        }
        return {
          usage: finalUsage,
          nextRunApprovalMode: runApprovalMode,
          summaryLine: "",
          pausedReason:
            `Scaffold phase "${phase.label}" produced no workspace changes. ` +
            "This phase must write real code before the run can continue."
        };
      }
      if (phase.mustWrite && phase.ownership.length && !ownedWrites.length) {
        if (
          shouldAttemptPhaseContractRecovery({
            phase,
            changedFiles: newChangedFiles,
            ownedWrites,
            missingRequirements,
            missingWriteRequirements,
            invalidManifestIssues
          })
        ) {
          const recovered = await tryPhaseContractRecovery({
            model,
            workspaceRoot,
            phase,
            rootUserContent,
            phasePrompt,
            assistantContent: assistantContent || latestAssistantContent,
            missingRequirements,
            missingWriteRequirements,
            invalidManifestIssues,
            changedFiles: newChangedFiles,
            fetchJson,
            executeTool: (toolCall) =>
              executeToolCall({
                toolCall,
                workspaceRoot,
                thread,
                project,
                writeRequiresApproval,
                currentRunApprovalMode: runApprovalMode,
                requestApproval,
                onRunEvent,
                onRunCheckpoint,
                currentStep: phaseStep,
                runRecord
              }).then((result) => {
                if (result.nextRunApprovalMode) {
                  runApprovalMode = result.nextRunApprovalMode;
                }
                return result;
              }),
            onToolResult: (toolName, result) => {
              recordToolMessage(thread, toolName, result);
              if (onStatus) {
                onStatus(result.summary);
              }
              if (onState) {
                onState();
              }
            },
            onProgress: (label) => {
              if (onStatus) {
                onStatus(label);
              }
            }
          });
          if (recovered.applied) {
            const recoveredChangedFiles = getNewChangedFiles(
              initialChangedSet,
              runRecord.changedFiles
            );
            return {
              usage: finalUsage,
              nextRunApprovalMode: runApprovalMode,
              summaryLine: buildScaffoldPhaseSummary({
                phase,
                newChangedFiles: recoveredChangedFiles,
                assistantContent: recovered.summary || assistantContent || latestAssistantContent
              }),
              pausedReason: ""
            };
          }
          if (recovered.reason) {
            return {
              usage: finalUsage,
              nextRunApprovalMode: runApprovalMode,
              summaryLine: "",
              pausedReason: recovered.reason
            };
          }
        }
        return {
          usage: finalUsage,
          nextRunApprovalMode: runApprovalMode,
          summaryLine: "",
          pausedReason: describePhaseOwnershipGap(phase, newChangedFiles)
        };
      }
      if (missingWriteRequirements.length) {
        if (
          shouldAttemptPhaseContractRecovery({
            phase,
            changedFiles: newChangedFiles,
            ownedWrites,
            missingRequirements,
            missingWriteRequirements,
            invalidManifestIssues
          })
        ) {
          const recovered = await tryPhaseContractRecovery({
            model,
            workspaceRoot,
            phase,
            rootUserContent,
            phasePrompt,
            assistantContent: assistantContent || latestAssistantContent,
            missingRequirements,
            missingWriteRequirements,
            invalidManifestIssues,
            changedFiles: newChangedFiles,
            fetchJson,
            executeTool: (toolCall) =>
              executeToolCall({
                toolCall,
                workspaceRoot,
                thread,
                project,
                writeRequiresApproval,
                currentRunApprovalMode: runApprovalMode,
                requestApproval,
                onRunEvent,
                onRunCheckpoint,
                currentStep: phaseStep,
                runRecord
              }).then((result) => {
                if (result.nextRunApprovalMode) {
                  runApprovalMode = result.nextRunApprovalMode;
                }
                return result;
              }),
            onToolResult: (toolName, result) => {
              recordToolMessage(thread, toolName, result);
              if (onStatus) {
                onStatus(result.summary);
              }
              if (onState) {
                onState();
              }
            },
            onProgress: (label) => {
              if (onStatus) {
                onStatus(label);
              }
            }
          });
          if (recovered.applied) {
            const recoveredChangedFiles = getNewChangedFiles(
              initialChangedSet,
              runRecord.changedFiles
            );
            return {
              usage: finalUsage,
              nextRunApprovalMode: runApprovalMode,
              summaryLine: buildScaffoldPhaseSummary({
                phase,
                newChangedFiles: recoveredChangedFiles,
                assistantContent: recovered.summary || assistantContent || latestAssistantContent
              }),
              pausedReason: ""
            };
          }
          if (recovered.reason) {
            return {
              usage: finalUsage,
              nextRunApprovalMode: runApprovalMode,
              summaryLine: "",
              pausedReason: recovered.reason
            };
          }
        }
        return {
          usage: finalUsage,
          nextRunApprovalMode: runApprovalMode,
          summaryLine: "",
          pausedReason: describePhaseWriteRequirements(
            phase,
            missingWriteRequirements,
            newChangedFiles
          )
        };
      }
      if (missingRequirements.length || invalidManifestIssues.length) {
        if (
          shouldAttemptBootstrapMissingRequirementsRecovery({
            phase,
            missingRequirements,
            changedFiles: newChangedFiles,
            invalidManifestIssues
          })
        ) {
          const recovered = await tryBootstrapMissingRequirementsRecovery({
            model,
            workspaceRoot,
            phase,
            rootUserContent,
            phasePrompt,
            assistantContent: assistantContent || latestAssistantContent,
            missingRequirements,
            invalidManifestIssues,
            fetchJson,
            executeTool: (toolCall) =>
              executeToolCall({
                toolCall,
                workspaceRoot,
                thread,
                project,
                writeRequiresApproval,
                currentRunApprovalMode: runApprovalMode,
                requestApproval,
                onRunEvent,
                onRunCheckpoint,
                currentStep: phaseStep,
                runRecord
              }).then((result) => {
                if (result.nextRunApprovalMode) {
                  runApprovalMode = result.nextRunApprovalMode;
                }
                return result;
              }),
            onToolResult: (toolName, result) => {
              recordToolMessage(thread, toolName, result);
              if (onStatus) {
                onStatus(result.summary);
              }
              if (onState) {
                onState();
              }
            },
            onProgress: (label) => {
              if (onStatus) {
                onStatus(label);
              }
            }
          });
          if (recovered.applied) {
            const recoveredChangedFiles = getNewChangedFiles(
              initialChangedSet,
              runRecord.changedFiles
            );
            return {
              usage: finalUsage,
              nextRunApprovalMode: runApprovalMode,
              summaryLine: buildScaffoldPhaseSummary({
                phase,
                newChangedFiles: recoveredChangedFiles,
                assistantContent: recovered.summary || assistantContent || latestAssistantContent
              }),
              pausedReason: ""
            };
          }
          if (recovered.reason) {
            return {
              usage: finalUsage,
              nextRunApprovalMode: runApprovalMode,
              summaryLine: "",
              pausedReason: recovered.reason
            };
          }
        }
        if (
          shouldAttemptPhaseContractRecovery({
            phase,
            changedFiles: newChangedFiles,
            ownedWrites,
            missingRequirements,
            missingWriteRequirements,
            invalidManifestIssues
          })
        ) {
          const recovered = await tryPhaseContractRecovery({
            model,
            workspaceRoot,
            phase,
            rootUserContent,
            phasePrompt,
            assistantContent: assistantContent || latestAssistantContent,
            missingRequirements,
            missingWriteRequirements,
            invalidManifestIssues,
            changedFiles: newChangedFiles,
            fetchJson,
            executeTool: (toolCall) =>
              executeToolCall({
                toolCall,
                workspaceRoot,
                thread,
                project,
                writeRequiresApproval,
                currentRunApprovalMode: runApprovalMode,
                requestApproval,
                onRunEvent,
                onRunCheckpoint,
                currentStep: phaseStep,
                runRecord
              }).then((result) => {
                if (result.nextRunApprovalMode) {
                  runApprovalMode = result.nextRunApprovalMode;
                }
                return result;
              }),
            onToolResult: (toolName, result) => {
              recordToolMessage(thread, toolName, result);
              if (onStatus) {
                onStatus(result.summary);
              }
              if (onState) {
                onState();
              }
            },
            onProgress: (label) => {
              if (onStatus) {
                onStatus(label);
              }
            }
          });
          if (recovered.applied) {
            const recoveredChangedFiles = getNewChangedFiles(
              initialChangedSet,
              runRecord.changedFiles
            );
            return {
              usage: finalUsage,
              nextRunApprovalMode: runApprovalMode,
              summaryLine: buildScaffoldPhaseSummary({
                phase,
                newChangedFiles: recoveredChangedFiles,
                assistantContent: recovered.summary || assistantContent || latestAssistantContent
              }),
              pausedReason: ""
            };
          }
          if (recovered.reason) {
            return {
              usage: finalUsage,
              nextRunApprovalMode: runApprovalMode,
              summaryLine: "",
              pausedReason: recovered.reason
            };
          }
        }
        if (invalidManifestIssues.length) {
          return {
            usage: finalUsage,
            nextRunApprovalMode: runApprovalMode,
            summaryLine: "",
            pausedReason: describeInvalidStructuredManifestIssues(
              phase,
              invalidManifestIssues,
              newChangedFiles
            )
          };
        }
        return {
          usage: finalUsage,
          nextRunApprovalMode: runApprovalMode,
          summaryLine: "",
          pausedReason: describePhaseMissingRequirements(phase, missingRequirements, newChangedFiles)
        };
      }
      if (assistantContent) {
        messages.push({
          role: "assistant",
          content: assistantContent
        });
      }
      return {
        usage: finalUsage,
        nextRunApprovalMode: runApprovalMode,
        summaryLine: buildScaffoldPhaseSummary({
          phase,
          newChangedFiles,
          assistantContent: assistantContent || latestAssistantContent
        }),
        pausedReason: ""
      };
    }

    messages.push({
      role: "assistant",
      content: assistantContent || null,
      tool_calls: toolCalls
    });

    const stepTouchedPaths = [];
    for (const toolCall of toolCalls) {
      emitRunEvent(onRunEvent, {
        type: "tool_call",
        label: toolCall && toolCall.function ? toolCall.function.name : "tool",
        detail: toolCall && toolCall.function ? toolCall.function.arguments || "" : ""
      });
      const result = await executeToolCall({
        toolCall,
        workspaceRoot,
        thread,
        project,
        writeRequiresApproval,
        currentRunApprovalMode: runApprovalMode,
        requestApproval,
        onRunEvent,
        onRunCheckpoint,
        currentStep: phaseStep,
        runRecord
      });
      if (result.nextRunApprovalMode) {
        runApprovalMode = result.nextRunApprovalMode;
      }
      if (
        toolCall &&
        toolCall.function &&
        toolCall.function.name === "write_file" &&
        result &&
        !result.error &&
        typeof result.path === "string" &&
        result.path
      ) {
        stepTouchedPaths.push(result.path);
      }
      recordToolMessage(
        thread,
        toolCall && toolCall.function ? toolCall.function.name : "tool",
        result
      );
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.content
      });
      if (onStatus) {
        onStatus(result.summary);
      }
      if (onState) {
        onState();
      }
    }

    const postStepChangedFiles = getNewChangedFiles(initialChangedSet, runRecord.changedFiles);
    const postStepState = await inspectPhaseWorkspaceState({
      phase,
      workspaceRoot,
      changedFiles: postStepChangedFiles
    });
    if (
      isPhaseWorkspaceContractSatisfied({
        phase,
        changedFiles: postStepChangedFiles,
        ...postStepState
      })
    ) {
      return {
        usage: finalUsage,
        nextRunApprovalMode: runApprovalMode,
        summaryLine: buildScaffoldPhaseSummary({
          phase,
          newChangedFiles: postStepChangedFiles,
          assistantContent: assistantContent || latestAssistantContent
        }),
        pausedReason: ""
      };
    }
    const stalledContractStep = isPhaseContractStallStep({
      stepTouchedPaths,
      changedFiles: postStepChangedFiles,
      previousChangedFileCount,
      missingRequirements: postStepState.missingRequirements,
      missingWriteRequirements: postStepState.missingWriteRequirements,
      invalidManifestIssues: postStepState.invalidManifestIssues
    });
    consecutiveContractStallSteps = stalledContractStep ? consecutiveContractStallSteps + 1 : 0;
    previousChangedFileCount = postStepChangedFiles.length;
    if (
      consecutiveContractStallSteps >= 2 &&
      shouldAttemptPhaseContractRecovery({
        phase,
        changedFiles: postStepChangedFiles,
        ...postStepState
      })
    ) {
      const recovered = await tryPhaseContractRecovery({
        model,
        workspaceRoot,
        phase,
        rootUserContent,
        phasePrompt,
        assistantContent: assistantContent || latestAssistantContent,
        missingRequirements: postStepState.missingRequirements,
        missingWriteRequirements: postStepState.missingWriteRequirements,
        invalidManifestIssues: postStepState.invalidManifestIssues,
        changedFiles: postStepChangedFiles,
        fetchJson,
        executeTool: (toolCall) =>
          executeToolCall({
            toolCall,
            workspaceRoot,
            thread,
            project,
            writeRequiresApproval,
            currentRunApprovalMode: runApprovalMode,
            requestApproval,
            onRunEvent,
            onRunCheckpoint,
            currentStep: phaseStep,
            runRecord
          }).then((result) => {
            if (result.nextRunApprovalMode) {
              runApprovalMode = result.nextRunApprovalMode;
            }
            return result;
          }),
        onToolResult: (toolName, result) => {
          recordToolMessage(thread, toolName, result);
          if (onStatus) {
            onStatus(result.summary);
          }
          if (onState) {
            onState();
          }
        },
        onProgress: (label) => {
          if (onStatus) {
            onStatus(label);
          }
        }
      });
      if (recovered.applied) {
        const recoveredChangedFiles = getNewChangedFiles(initialChangedSet, runRecord.changedFiles);
        return {
          usage: finalUsage,
          nextRunApprovalMode: runApprovalMode,
          summaryLine: buildScaffoldPhaseSummary({
            phase,
            newChangedFiles: recoveredChangedFiles,
            assistantContent: recovered.summary || assistantContent || latestAssistantContent
          }),
          pausedReason: ""
        };
      }
      if (recovered.reason) {
        return {
          usage: finalUsage,
          nextRunApprovalMode: runApprovalMode,
          summaryLine: "",
          pausedReason: recovered.reason
        };
      }
    }
    if (
      step < phase.maxSteps - 1 &&
      (
        postStepState.missingRequirements.length ||
        postStepState.missingWriteRequirements.length ||
        postStepState.invalidManifestIssues.length
      )
    ) {
      messages.push({
        role: "user",
        content: buildPhaseGapFollowUp({
          phase,
          changedFiles: postStepChangedFiles,
          missingRequirements: postStepState.missingRequirements,
          missingWriteRequirements: postStepState.missingWriteRequirements,
          invalidManifestIssues: postStepState.invalidManifestIssues
        })
      });
    }
  }

  const changedFiles = getNewChangedFiles(initialChangedSet, runRecord.changedFiles);
  const {
    ownedWrites,
    missingRequirements,
    missingWriteRequirements,
    invalidManifestIssues
  } = await inspectPhaseWorkspaceState({
    phase,
    workspaceRoot,
    changedFiles
  });
  if (
    isPhaseWorkspaceContractSatisfied({
      phase,
      changedFiles,
      ownedWrites,
      missingRequirements,
      missingWriteRequirements,
      invalidManifestIssues
    })
  ) {
    return {
      usage: finalUsage,
      nextRunApprovalMode: runApprovalMode,
      summaryLine: buildScaffoldPhaseSummary({
        phase,
        newChangedFiles: changedFiles,
        assistantContent: latestAssistantContent
      }),
      pausedReason: ""
    };
  }
  if (
    shouldAttemptBootstrapMissingRequirementsRecovery({
      phase,
      missingRequirements,
      changedFiles,
      invalidManifestIssues
    })
  ) {
    const recovered = await tryBootstrapMissingRequirementsRecovery({
      model,
      workspaceRoot,
      phase,
      rootUserContent,
      phasePrompt,
      assistantContent: latestAssistantContent,
      missingRequirements,
      invalidManifestIssues,
      fetchJson,
      executeTool: (toolCall) =>
        executeToolCall({
          toolCall,
          workspaceRoot,
          thread,
          project,
          writeRequiresApproval,
          currentRunApprovalMode: runApprovalMode,
          requestApproval,
          onRunEvent,
          onRunCheckpoint,
          currentStep: phase.maxSteps,
          runRecord
        }).then((result) => {
          if (result.nextRunApprovalMode) {
            runApprovalMode = result.nextRunApprovalMode;
          }
          return result;
        }),
      onToolResult: (toolName, result) => {
        recordToolMessage(thread, toolName, result);
        if (onStatus) {
          onStatus(result.summary);
        }
        if (onState) {
          onState();
        }
      },
      onProgress: (label) => {
        if (onStatus) {
          onStatus(label);
        }
      }
    });
    if (recovered.applied) {
      const recoveredChangedFiles = getNewChangedFiles(initialChangedSet, runRecord.changedFiles);
      return {
        usage: finalUsage,
        nextRunApprovalMode: runApprovalMode,
        summaryLine: buildScaffoldPhaseSummary({
          phase,
          newChangedFiles: recoveredChangedFiles,
          assistantContent: recovered.summary || latestAssistantContent
        }),
        pausedReason: ""
      };
    }
    if (recovered.reason) {
      return {
        usage: finalUsage,
        nextRunApprovalMode: runApprovalMode,
        summaryLine: "",
        pausedReason: recovered.reason
      };
    }
  }
  if (
    shouldAttemptPhaseContractRecovery({
      phase,
      changedFiles,
      ownedWrites,
      missingRequirements,
      missingWriteRequirements,
      invalidManifestIssues
    })
  ) {
    const recovered = await tryPhaseContractRecovery({
      model,
      workspaceRoot,
      phase,
      rootUserContent,
      phasePrompt,
      assistantContent: latestAssistantContent,
      missingRequirements,
      missingWriteRequirements,
      invalidManifestIssues,
      changedFiles,
      fetchJson,
      executeTool: (toolCall) =>
        executeToolCall({
          toolCall,
          workspaceRoot,
          thread,
          project,
          writeRequiresApproval,
          currentRunApprovalMode: runApprovalMode,
          requestApproval,
          onRunEvent,
          onRunCheckpoint,
          currentStep: phase.maxSteps,
          runRecord
        }).then((result) => {
          if (result.nextRunApprovalMode) {
            runApprovalMode = result.nextRunApprovalMode;
          }
          return result;
        }),
      onToolResult: (toolName, result) => {
        recordToolMessage(thread, toolName, result);
        if (onStatus) {
          onStatus(result.summary);
        }
        if (onState) {
          onState();
        }
      },
      onProgress: (label) => {
        if (onStatus) {
          onStatus(label);
        }
      }
    });
    if (recovered.applied) {
      const recoveredChangedFiles = getNewChangedFiles(initialChangedSet, runRecord.changedFiles);
      return {
        usage: finalUsage,
        nextRunApprovalMode: runApprovalMode,
        summaryLine: buildScaffoldPhaseSummary({
          phase,
          newChangedFiles: recoveredChangedFiles,
          assistantContent: recovered.summary || latestAssistantContent
        }),
        pausedReason: ""
      };
    }
    if (recovered.reason) {
      return {
        usage: finalUsage,
        nextRunApprovalMode: runApprovalMode,
        summaryLine: "",
        pausedReason: recovered.reason
      };
    }
  }
  if (invalidManifestIssues.length) {
    return {
      usage: finalUsage,
      nextRunApprovalMode: runApprovalMode,
      summaryLine: "",
      pausedReason: describeInvalidStructuredManifestIssues(
        phase,
        invalidManifestIssues,
        changedFiles
      )
    };
  }
  if (phase.mustWrite && !changedFiles.length) {
    return {
      usage: finalUsage,
      nextRunApprovalMode: runApprovalMode,
      summaryLine: "",
      pausedReason:
        `Scaffold phase "${phase.label}" produced no workspace changes. ` +
        "This phase must write real code before the run can continue."
    };
  }
  if (phase.mustWrite && phase.ownership.length && !ownedWrites.length) {
    return {
      usage: finalUsage,
      nextRunApprovalMode: runApprovalMode,
      summaryLine: "",
      pausedReason: describePhaseOwnershipGap(phase, changedFiles)
    };
  }
  if (missingWriteRequirements.length) {
    return {
      usage: finalUsage,
      nextRunApprovalMode: runApprovalMode,
      summaryLine: "",
      pausedReason: describePhaseWriteRequirements(phase, missingWriteRequirements, changedFiles)
    };
  }
  return {
    usage: finalUsage,
    nextRunApprovalMode: runApprovalMode,
    summaryLine: "",
    pausedReason:
      missingRequirements.length
        ? describePhaseMissingRequirements(
            phase,
            missingRequirements,
            changedFiles
          )
        : `Scaffold phase "${phase.label}" reached its step limit before meeting its contract. ` +
          "Resume the run to continue from the current workspace state."
  };
}

async function requestScaffoldExecutionPlan({
  model,
  workspaceRoot,
  latestUserContent,
  workflowPreset,
  specDraft,
  intelligence,
  fetchJson
}) {
  const response = await fetchJson({
    model,
    stream: false,
    temperature: 0.05,
    top_p: 0.8,
    max_tokens: 2400,
    messages: [
      {
        role: "system",
        content:
          `${await buildWorkspaceSystemPrompt(workspaceRoot, {
            workflowPreset,
            specDraft,
            intelligence
          })}\n\n` +
          "Design a staged scaffold execution plan for an empty repository workspace. " +
          'Return only JSON with this schema: {"summary":"short summary","phases":[{"id":"short-id","label":"phase label","goal":"what this phase must accomplish","ownership":["relative/path/or/glob"],"required_outputs":["short requirement"],"must_write":true,"allow_materialization":false,"max_steps":6}]}. ' +
          "Use 4-5 phases. Cover architecture/bootstrap, backend/core, middleware/orchestration, frontend/user flow, and final review when applicable. " +
          "The bootstrap phase must cover README.md, at least one dependency manifest, and initial source or package structure. " +
          "Keep ownership mostly disjoint. Use relative paths or simple globs. Do not use markdown fences."
      },
      {
        role: "user",
        content:
          `Create the staged scaffold phase plan for this request:\n${clampText(
            latestUserContent,
            16000
          )}`
      }
    ]
  });
  const choice = response && response.choices && response.choices[0];
  const content =
    choice && choice.message && typeof choice.message.content === "string"
      ? choice.message.content
      : "";
  return parseScaffoldExecutionPlan(content);
}

function parseScaffoldExecutionPlan(text) {
  const candidates = [];
  const source = String(text || "").trim();
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
    return normalizeScaffoldExecutionPlan(parsed);
  }

  return normalizeScaffoldExecutionPlan(null);
}

function normalizeScaffoldExecutionPlan(plan) {
  const fallbackPhases = DEFAULT_SCAFFOLD_PHASE_PLAN.phases;
  const parsedSource = Array.isArray(plan && plan.phases)
    ? plan.phases.filter((phase) => phase && typeof phase === "object")
    : [];
  const parsedPhases =
    parsedSource.length >= 4 && parsedSource.length <= 5
      ? parsedSource
          .map((phase, index) => normalizeScaffoldPhase(phase, fallbackPhases[index]))
          .filter(Boolean)
      : [];
  return {
    summary:
      plan && typeof plan.summary === "string" && plan.summary.trim()
        ? plan.summary.trim()
        : DEFAULT_SCAFFOLD_PHASE_PLAN.summary,
    phases:
      parsedPhases.length > 0
        ? parsedPhases
        : fallbackPhases.map((phase) => normalizeScaffoldPhase(phase, phase))
  };
}

function normalizeScaffoldPhase(phase, fallback) {
  const base = fallback || {};
  return {
    id:
      phase && typeof phase.id === "string" && phase.id.trim()
        ? phase.id.trim().toLowerCase()
        : base.id || makeId("phase"),
    label:
      phase && typeof phase.label === "string" && phase.label.trim()
        ? phase.label.trim()
        : base.label || "Scaffold phase",
    goal:
      phase && typeof phase.goal === "string" && phase.goal.trim()
        ? phase.goal.trim()
        : base.goal || "Complete this scaffold phase.",
    ownership: mergeStringLists(base.ownership, phase && phase.ownership),
    requiredOutputs: mergeStringLists(base.required_outputs, phase && phase.required_outputs),
    requiredPathGroups: normalizeRequiredPathGroups(
      base.requiredPathGroups,
      phase && phase.required_path_groups
    ),
    requiredWritePathGroups: normalizeRequiredPathGroups(
      base.requiredWritePathGroups,
      phase && phase.required_write_path_groups
    ),
    mustWrite:
      phase && typeof phase.must_write === "boolean"
        ? phase.must_write || Boolean(base.must_write)
        : Boolean(base.must_write),
    allowMaterialization:
      phase && typeof phase.allow_materialization === "boolean"
        ? phase.allow_materialization || Boolean(base.allow_materialization)
        : Boolean(base.allow_materialization),
    maxSteps: resolvePhaseStepCount(phase && phase.max_steps, base.max_steps)
  };
}

function mergeStringLists(base, extra) {
  const list = [
    ...(Array.isArray(base) ? base : []),
    ...(Array.isArray(extra) ? extra : [])
  ];
  return Array.from(
    new Set(
      list
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
    )
  );
}

function normalizeRequiredPathGroups(baseGroups, extraGroups) {
  const groups = [
    ...(Array.isArray(baseGroups) ? baseGroups : []),
    ...(Array.isArray(extraGroups) ? extraGroups : [])
  ];
  return groups
    .map((group) =>
      Array.isArray(group)
        ? group.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
        : []
    )
    .filter((group) => group.length > 0);
}

function clampPhaseStepCount(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 3 && parsed <= 12) {
    return Math.trunc(parsed);
  }
  const fallbackValue = Number(fallback);
  if (Number.isFinite(fallbackValue) && fallbackValue >= 3 && fallbackValue <= 12) {
    return Math.trunc(fallbackValue);
  }
  return 6;
}

function resolvePhaseStepCount(value, fallback) {
  const minimum = clampPhaseStepCount(fallback, 6);
  const requested = clampPhaseStepCount(value, minimum);
  return Math.max(minimum, requested);
}

function buildScaffoldPhasePrompt({
  phase,
  phaseIndex,
  phaseCount,
  intelligence,
  completedPhaseSummaries
}) {
  const ownership = phase.ownership.length
    ? phase.ownership.map((item) => `- ${item}`).join("\n")
    : "- No explicit ownership provided";
  const requiredOutputs = phase.requiredOutputs.length
    ? phase.requiredOutputs.map((item) => `- ${item}`).join("\n")
    : "- Leave this phase in a runnable state";
  const completionChecks = formatScaffoldPhaseCompletionChecks(phase.requiredPathGroups);
  const writeChecks = formatScaffoldPhaseCompletionChecks(phase.requiredWritePathGroups);
  const priorPhases = Array.isArray(completedPhaseSummaries) && completedPhaseSummaries.length
    ? completedPhaseSummaries.map((item) => `- ${item}`).join("\n")
    : "- No completed scaffold phases yet";

  return [
    `Scaffold phase ${phaseIndex + 1} of ${phaseCount}: ${phase.label}`,
    `Goal: ${phase.goal}`,
    "",
    "Completed phases so far:",
    priorPhases,
    "",
    "Current workspace intelligence:",
    clampText(
      intelligence && intelligence.summary ? intelligence.summary : "No workspace intelligence yet.",
      4000
    ),
    "",
    "Owned paths for this phase:",
    ownership,
    "",
    "Required outputs:",
    requiredOutputs,
    "",
    "Phase completion checks:",
    completionChecks,
    "",
    "Phase write checks:",
    writeChecks,
    "",
    "Rules:",
    "- Inspect the current workspace before editing.",
    "- Work this phase to completion before moving on.",
    "- Stop this phase as soon as every phase completion check and phase write check is satisfied. Do not drift into later-phase files once the contract is met.",
    "- Prefer changes inside the owned paths. If a cross-cutting edit is required, keep it minimal and consistent with earlier phases.",
    "- Use workspace tool calls. Do not answer with prose only.",
    "- Write complete, production-ready code and tests with no placeholder, stub, or demo artifacts.",
    phase.requiredWritePathGroups.length
      ? "- This phase must itself write files matching every phase write check group."
      : "- When you write files, make sure they advance the concrete implementation for this phase.",
    phase.mustWrite
      ? "- This phase is not complete until it has produced real workspace changes."
      : "- If the repo is already coherent for this phase, make only the minimal fixes needed."
  ].join("\n");
}

async function requestPhaseToolCallRetry({
  model,
  generationSettings,
  messages,
  assistantContent,
  fetchJson,
  phase,
  onProgress
}) {
  if (onProgress) {
    onProgress(`Retrying ${phase.label} with tool-only guidance`);
  }

  const response = await fetchJson({
    model,
    stream: false,
    ...getGenerationOptions("agent", generationSettings),
    messages: [
      ...messages,
      {
        role: "assistant",
        content: String(assistantContent || "").trim() || "I did not call any tools."
      },
      {
        role: "user",
        content:
          `You are still in scaffold phase "${phase.label}". Do not answer with prose only. ` +
          "Use workspace tool calls now to complete this phase. " +
          `Owned paths: ${phase.ownership.join(", ") || "none specified"}. ` +
          `Required outputs: ${phase.requiredOutputs.join(", ") || "phase completion"}. ` +
          "Do not emit placeholder, TODO-only, stub, or demo-only content."
      }
    ],
    tools: getAgentTools()
  });

  const choice = response && response.choices && response.choices[0];
  const message = choice && choice.message ? choice.message : {};
  return {
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    assistantContent: typeof message.content === "string" ? message.content : "",
    usage: response.usage
  };
}

async function refreshProjectIntelligenceSnapshot(project) {
  if (!project || !project.workspaceRoot) {
    return null;
  }
  const intelligence = await scanProjectIntelligence({
    workspaceRoot: project.workspaceRoot,
    targetPath: project.targetPath || project.workspaceRoot
  });
  project.intelligence = intelligence;
  return intelligence;
}

function getNewChangedFiles(initialChangedSet, changedFiles) {
  const next = Array.isArray(changedFiles) ? changedFiles : [];
  return next.filter((item) => !initialChangedSet.has(item));
}

async function findMissingPhaseRequirements(phase, workspaceRoot) {
  const groups = Array.isArray(phase && phase.requiredPathGroups) ? phase.requiredPathGroups : [];
  if (!groups.length || !workspaceRoot) {
    return [];
  }

  const files = await listWorkspace({
    workspaceRoot,
    relativePath: ".",
    maxEntries: 600
  }).catch(() => []);
  const normalizedFiles = Array.from(
    new Set((Array.isArray(files) ? files : []).map((filePath) => normalizeRepoPath(filePath)))
  );

  return groups.filter(
    (group) => !group.some((pattern) => workspaceContainsPattern(normalizedFiles, pattern))
  );
}

function findMissingPhaseWriteRequirements(phase, changedFiles) {
  const groups = Array.isArray(phase && phase.requiredWritePathGroups)
    ? phase.requiredWritePathGroups
    : [];
  if (!groups.length) {
    return [];
  }

  const normalizedFiles = Array.from(
    new Set(
      (Array.isArray(changedFiles) ? changedFiles : []).map((filePath) => normalizeRepoPath(filePath))
    )
  );

  return groups.filter(
    (group) => !group.some((pattern) => workspaceContainsPattern(normalizedFiles, pattern))
  );
}

async function inspectPhaseWorkspaceState({ phase, workspaceRoot, changedFiles }) {
  const changed = Array.isArray(changedFiles) ? changedFiles : [];
  return {
    ownedWrites: changed.filter((item) => scaffoldPhaseOwnsPath(phase, item)),
    missingRequirements: await findMissingPhaseRequirements(phase, workspaceRoot),
    missingWriteRequirements: findMissingPhaseWriteRequirements(phase, changed),
    invalidManifestIssues: await findInvalidStructuredWorkspaceFiles(workspaceRoot)
  };
}

function isPhaseWorkspaceContractSatisfied({
  phase,
  changedFiles,
  ownedWrites,
  missingRequirements,
  missingWriteRequirements,
  invalidManifestIssues
}) {
  if (!phase) {
    return false;
  }

  const changed = Array.isArray(changedFiles) ? changedFiles : [];
  const owned = Array.isArray(ownedWrites) ? ownedWrites : [];
  if (Array.isArray(invalidManifestIssues) && invalidManifestIssues.length) {
    return false;
  }
  if (phase.mustWrite && !changed.length) {
    return false;
  }
  if (phase.mustWrite && Array.isArray(phase.ownership) && phase.ownership.length && !owned.length) {
    return false;
  }
  if (Array.isArray(missingRequirements) && missingRequirements.length) {
    return false;
  }
  if (Array.isArray(missingWriteRequirements) && missingWriteRequirements.length) {
    return false;
  }
  return true;
}

function isPhaseContractStallStep({
  stepTouchedPaths,
  changedFiles,
  previousChangedFileCount,
  missingRequirements,
  missingWriteRequirements,
  invalidManifestIssues
}) {
  const touched = Array.isArray(stepTouchedPaths) ? stepTouchedPaths.filter(Boolean) : [];
  if (!touched.length) {
    return false;
  }
  const changed = Array.isArray(changedFiles) ? changedFiles : [];
  if (changed.length !== Number(previousChangedFileCount || 0)) {
    return false;
  }
  return Boolean(
    (Array.isArray(missingRequirements) && missingRequirements.length) ||
      (Array.isArray(missingWriteRequirements) && missingWriteRequirements.length) ||
      (Array.isArray(invalidManifestIssues) && invalidManifestIssues.length)
  );
}

async function loadStructuredWorkspaceFiles(workspaceRoot) {
  if (!workspaceRoot) {
    return [];
  }
  const files = [];
  for (const candidate of ["package.json", "pyproject.toml", "Cargo.toml"]) {
    const content = await fs.readFile(path.join(workspaceRoot, candidate), "utf8").catch(() => null);
    if (typeof content === "string") {
      files.push({
        path: candidate,
        content
      });
    }
  }
  return files;
}

function validateStructuredManifestContent(filePath, content) {
  const normalizedPath = normalizeRepoPath(filePath);
  const source = typeof content === "string" ? content : "";

  if (normalizedPath === "package.json") {
    try {
      JSON.parse(source);
      return {
        ok: true,
        issue: ""
      };
    } catch (error) {
      return {
        ok: false,
        issue: `Invalid ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  if (!normalizedPath.endsWith(".toml")) {
    return {
      ok: true,
      issue: ""
    };
  }

  const result = spawnSync(
    "python3",
    ["-c", "import sys, tomllib; tomllib.loads(sys.stdin.read())"],
    {
      input: source,
      encoding: "utf8"
    }
  );

  if (result.error && result.error.code === "ENOENT") {
    return {
      ok: true,
      issue: ""
    };
  }
  if (result.error) {
    return {
      ok: false,
      issue: `Invalid ${filePath}: ${result.error.message}`
    };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-1)[0];
    return {
      ok: false,
      issue: `Invalid ${filePath}: ${detail || "TOML parse failed"}`
    };
  }

  return {
    ok: true,
    issue: ""
  };
}

function evaluateStructuredManifestFiles(files) {
  const issues = [];
  for (const entry of Array.isArray(files) ? files : []) {
    if (!entry || typeof entry.path !== "string") {
      continue;
    }
    const validation = validateStructuredManifestContent(entry.path, entry.content);
    if (!validation.ok && validation.issue) {
      issues.push(validation.issue);
    }
  }
  return {
    ok: issues.length === 0,
    issues
  };
}

function mergeStructuredManifestFiles(existingFiles, incomingFiles) {
  const merged = new Map();
  for (const entry of Array.isArray(existingFiles) ? existingFiles : []) {
    if (!entry || typeof entry.path !== "string") {
      continue;
    }
    merged.set(normalizeRepoPath(entry.path), {
      path: entry.path,
      content: typeof entry.content === "string" ? entry.content : ""
    });
  }
  for (const entry of Array.isArray(incomingFiles) ? incomingFiles : []) {
    if (!entry || typeof entry.path !== "string") {
      continue;
    }
    merged.set(normalizeRepoPath(entry.path), {
      path: entry.path,
      content: typeof entry.content === "string" ? entry.content : ""
    });
  }
  return Array.from(merged.values());
}

async function findInvalidStructuredWorkspaceFiles(workspaceRoot) {
  const files = await loadStructuredWorkspaceFiles(workspaceRoot);
  return evaluateStructuredManifestFiles(files).issues;
}

function evaluatePhaseMaterializationManifest(phase, files, existingPaths = []) {
  const normalizedFiles = [
    ...(Array.isArray(existingPaths) ? existingPaths : []),
    ...((Array.isArray(files) ? files : []).map((entry) => normalizeRepoPath(entry.path)))
  ];
  const issues = [];
  const groups = Array.isArray(phase && phase.requiredPathGroups) ? phase.requiredPathGroups : [];
  const writeGroups = Array.isArray(phase && phase.requiredWritePathGroups)
    ? phase.requiredWritePathGroups
    : [];
  const writtenPaths = (Array.isArray(files) ? files : []).map((entry) => normalizeRepoPath(entry.path));

  for (const group of groups) {
    if (!group.some((pattern) => workspaceContainsPattern(normalizedFiles, pattern))) {
      issues.push(`Missing required path group: ${group.join(" or ")}`);
    }
  }

  for (const group of writeGroups) {
    if (!group.some((pattern) => workspaceContainsPattern(writtenPaths, pattern))) {
      issues.push(`Missing required phase write group: ${group.join(" or ")}`);
    }
  }

  const materializedFiles = Array.isArray(files) ? files : [];
  const ownedWrites = materializedFiles.filter((entry) =>
    scaffoldPhaseOwnsPath(phase, entry && entry.path)
  );
  if (Array.isArray(phase && phase.ownership) && phase.ownership.length && !ownedWrites.length) {
    issues.push("No files in the manifest matched the phase ownership.");
  }

  const placeholderPaths = materializedFiles
    .filter(
      (entry) =>
        normalizeRepoPath(entry.path) !== ".gitignore" &&
        PLACEHOLDER_ARTIFACT_PATTERN.test(typeof entry.content === "string" ? entry.content : "")
    )
    .map((entry) => entry.path);
  if (placeholderPaths.length) {
    issues.push(
      `Placeholder or stub markers detected in ${placeholderPaths.slice(0, 5).join(", ")}.`
    );
  }

  const structuredQuality = evaluateStructuredManifestFiles(materializedFiles);
  if (!structuredQuality.ok) {
    issues.push(...structuredQuality.issues);
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function workspaceContainsPattern(normalizedFiles, pattern) {
  const matcher = ownershipPatternToRegExp(pattern);
  return (Array.isArray(normalizedFiles) ? normalizedFiles : []).some((filePath) =>
    matcher.test(filePath)
  );
}

function shouldAttemptBootstrapMaterializationRecovery({ phase, materialized }) {
  return Boolean(
    phase &&
      phase.id === "bootstrap" &&
      materialized &&
      !materialized.applied &&
      (materialized.code === "empty_manifest" || materialized.code === "quality_reject")
  );
}

function shouldAttemptBootstrapMissingRequirementsRecovery({
  phase,
  missingRequirements,
  changedFiles,
  invalidManifestIssues
}) {
  return Boolean(
    phase &&
      phase.id === "bootstrap" &&
      Array.isArray(changedFiles) &&
      changedFiles.length &&
      (
        (Array.isArray(missingRequirements) && missingRequirements.length) ||
        (Array.isArray(invalidManifestIssues) && invalidManifestIssues.length)
      )
  );
}

function shouldAttemptPhaseContractRecovery({
  phase,
  changedFiles,
  ownedWrites,
  missingRequirements,
  missingWriteRequirements,
  invalidManifestIssues
}) {
  if (!phase || phase.id === "bootstrap" || !phase.mustWrite) {
    return false;
  }

  const changed = Array.isArray(changedFiles) ? changedFiles : [];
  const owned = Array.isArray(ownedWrites) ? ownedWrites : [];
  return Boolean(
    !changed.length ||
      (Array.isArray(phase.ownership) && phase.ownership.length && !owned.length) ||
      (Array.isArray(missingRequirements) && missingRequirements.length) ||
      (Array.isArray(missingWriteRequirements) && missingWriteRequirements.length) ||
      (Array.isArray(invalidManifestIssues) && invalidManifestIssues.length)
  );
}

function scaffoldPhaseOwnsPath(phase, filePath) {
  const ownership = Array.isArray(phase && phase.ownership) ? phase.ownership : [];
  if (!ownership.length) {
    return true;
  }
  const normalizedPath = normalizeRepoPath(filePath);
  return ownership.some((pattern) => ownershipPatternToRegExp(pattern).test(normalizedPath));
}

function ownershipPatternToRegExp(pattern) {
  const normalized = normalizeRepoPath(pattern).replace(/\/+$/g, "");
  if (normalized === "**" || normalized === "**/*") {
    return /^.+$/i;
  }
  const placeholder = normalized
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "__SINGLE_STAR__");
  const escaped = placeholder.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  const source = escaped
    .replace(/__DOUBLE_STAR__/g, ".*")
    .replace(/__SINGLE_STAR__/g, "[^/]*");
  return new RegExp(`^${source}$`, "i");
}

function describePhaseOwnershipGap(phase, changedFiles) {
  const changed = Array.isArray(changedFiles) && changedFiles.length
    ? changedFiles.map((item) => `- ${item}`).join("\n")
    : "- none";
  const ownership = phase.ownership.length
    ? phase.ownership.map((item) => `- ${item}`).join("\n")
    : "- none declared";
  return [
    `Scaffold phase "${phase.label}" wrote files, but none matched its owned paths.`,
    "",
    "Owned paths:",
    ownership,
    "",
    "Files changed in this phase:",
    changed
  ].join("\n");
}

function describePhaseMissingRequirements(phase, missingRequirements, changedFiles) {
  const missing = Array.isArray(missingRequirements)
    ? missingRequirements.map((group) => `- ${group.join(" or ")}`).join("\n")
    : "- unknown";
  const changed = Array.isArray(changedFiles) && changedFiles.length
    ? changedFiles.map((item) => `- ${item}`).join("\n")
    : "- none";
  return [
    `Scaffold phase "${phase.label}" is still missing required workspace foundations.`,
    "",
    "Missing path groups:",
    missing,
    "",
    "Files changed in this phase:",
    changed
  ].join("\n");
}

function describePhaseWriteRequirements(phase, missingWriteRequirements, changedFiles) {
  const missing = Array.isArray(missingWriteRequirements)
    ? missingWriteRequirements.map((group) => `- ${group.join(" or ")}`).join("\n")
    : "- unknown";
  const changed = Array.isArray(changedFiles) && changedFiles.length
    ? changedFiles.map((item) => `- ${item}`).join("\n")
    : "- none";
  return [
    `Scaffold phase "${phase.label}" did not write the files required by its own contract.`,
    "",
    "Missing write groups:",
    missing,
    "",
    "Files changed in this phase:",
    changed
  ].join("\n");
}

function describeInvalidStructuredManifestIssues(phase, issues, changedFiles) {
  const formattedIssues = Array.isArray(issues)
    ? issues.map((item) => `- ${item}`).join("\n")
    : "- unknown";
  const changed = Array.isArray(changedFiles) && changedFiles.length
    ? changedFiles.map((item) => `- ${item}`).join("\n")
    : "- none";
  return [
    `Scaffold phase "${phase.label}" wrote invalid structured manifest content.`,
    "",
    "Manifest issues:",
    formattedIssues,
    "",
    "Files changed in this phase:",
    changed
  ].join("\n");
}

function buildScaffoldPlanSummary(plan) {
  const phases = Array.isArray(plan && plan.phases) ? plan.phases : [];
  return [
    plan && plan.summary ? plan.summary : DEFAULT_SCAFFOLD_PHASE_PLAN.summary,
    "",
    ...phases.map((phase, index) => `${index + 1}. ${phase.label}: ${phase.goal}`)
  ].join("\n");
}

function buildScaffoldPhaseSummary({ phase, newChangedFiles, assistantContent }) {
  const changed = Array.isArray(newChangedFiles) ? newChangedFiles : [];
  if (changed.length) {
    return `${phase.label}: wrote ${changed.length} file${changed.length === 1 ? "" : "s"} (${changed
      .slice(0, 4)
      .join(", ")})`;
  }
  if (assistantContent && assistantContent.trim()) {
    return `${phase.label}: ${clampText(assistantContent.replace(/\s+/g, " ").trim(), 220)}`;
  }
  return `${phase.label}: complete`;
}

function buildPhaseGapFollowUp({
  phase,
  changedFiles,
  missingRequirements,
  missingWriteRequirements,
  invalidManifestIssues
}) {
  const lines = [
    `You are still in scaffold phase "${phase.label}". The workspace does not yet satisfy this phase contract.`
  ];
  if (Array.isArray(missingWriteRequirements) && missingWriteRequirements.length) {
    lines.push("");
    lines.push("Still missing phase write groups:");
    for (const group of missingWriteRequirements) {
      lines.push(`- ${group.join(" or ")}`);
    }
  }
  if (Array.isArray(missingRequirements) && missingRequirements.length) {
    lines.push("");
    lines.push("Still missing workspace path groups:");
    for (const group of missingRequirements) {
      lines.push(`- ${group.join(" or ")}`);
    }
  }
  if (Array.isArray(invalidManifestIssues) && invalidManifestIssues.length) {
    lines.push("");
    lines.push("Structured manifest issues:");
    for (const issue of invalidManifestIssues.slice(0, 4)) {
      lines.push(`- ${issue}`);
    }
  }
  if (Array.isArray(changedFiles) && changedFiles.length) {
    lines.push("");
    lines.push("Files already changed in this phase:");
    for (const filePath of changedFiles.slice(-6)) {
      lines.push(`- ${filePath}`);
    }
  }
  lines.push("");
  lines.push(
    "On the next step, write the missing owned files directly. Do not keep rewriting already-touched files unless that change is required to satisfy one of the missing checks."
  );
  return lines.join("\n");
}

function formatScaffoldPhaseCompletionChecks(requiredPathGroups) {
  if (!Array.isArray(requiredPathGroups) || !requiredPathGroups.length) {
    return "- No explicit path-based completion checks";
  }
  return requiredPathGroups.map((group) => `- ${group.join(" or ")}`).join("\n");
}

function buildStagedScaffoldSummary(planSummary, phaseSummaries, changedFiles) {
  const lines = [planSummary || DEFAULT_SCAFFOLD_PHASE_PLAN.summary, "", "Phase progress:"];
  if (Array.isArray(phaseSummaries) && phaseSummaries.length) {
    for (const item of phaseSummaries) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push("- Waiting for scaffold phases to start");
  }

  const files = Array.isArray(changedFiles) ? changedFiles.filter(Boolean) : [];
  if (files.length) {
    lines.push("");
    lines.push("Changed files:");
    for (const item of files.slice(0, 12)) {
      lines.push(`- \`${item}\``);
    }
    if (files.length > 12) {
      lines.push(`- ... ${files.length - 12} more`);
    }
  }
  return lines.join("\n");
}

async function executeToolCall({
  toolCall,
  workspaceRoot,
  thread,
  project,
  writeRequiresApproval,
  currentRunApprovalMode,
  requestApproval,
  onRunEvent,
  onRunCheckpoint,
  currentStep,
  runRecord
}) {
  const name = toolCall && toolCall.function && toolCall.function.name;
  const args = safeJsonParse(
    toolCall && toolCall.function ? toolCall.function.arguments : "{}",
    {}
  );

  switch (name) {
    case "list_workspace": {
      const entries = await listWorkspace({
        workspaceRoot,
        relativePath: typeof args.path === "string" ? args.path : ".",
        maxEntries: Number(args.max_entries) || 120
      });
      emitCheckpoint(onRunCheckpoint, {
        runId: runRecord.id,
        label: `Listed workspace (${entries.length} items)`,
        step: currentStep,
        threadMessageCount: thread.messages.length,
        eventCount: runRecord.events ? runRecord.events.length : 0,
        changedFiles: runRecord.changedFiles || []
      });
      return {
        summary: `Listed ${entries.length} workspace files`,
        content: JSON.stringify({ ok: true, root: workspaceRoot, entries })
      };
    }
    case "read_file": {
      const content = await readWorkspaceFile({
        workspaceRoot,
        relativePath: args.path
      });
      emitCheckpoint(onRunCheckpoint, {
        runId: runRecord.id,
        label: `Read ${args.path}`,
        step: currentStep,
        threadMessageCount: thread.messages.length,
        eventCount: runRecord.events ? runRecord.events.length : 0,
        changedFiles: runRecord.changedFiles || []
      });
      return {
        summary: `Read ${args.path}`,
        content: JSON.stringify({ ok: true, path: args.path, content })
      };
    }
    case "search_workspace": {
      const matches = await searchWorkspace({
        workspaceRoot,
        pattern: String(args.pattern || ""),
        glob: typeof args.glob === "string" ? args.glob : undefined,
        maxResults: Number(args.max_results) || 30
      });
      emitCheckpoint(onRunCheckpoint, {
        runId: runRecord.id,
        label: `Searched workspace (${matches.length} matches)`,
        step: currentStep,
        threadMessageCount: thread.messages.length,
        eventCount: runRecord.events ? runRecord.events.length : 0,
        changedFiles: runRecord.changedFiles || []
      });
      return {
        summary: `Found ${matches.length} matches`,
        content: JSON.stringify({ ok: true, matches })
      };
    }
    case "write_file": {
      return proposeAndApplyWrite({
        workspaceRoot,
        relativePath: String(args.path || "").trim(),
        content: typeof args.content === "string" ? args.content : "",
        reason: typeof args.reason === "string" ? args.reason : "",
        thread,
        writeRequiresApproval,
        currentRunApprovalMode,
        requestApproval,
        onRunEvent,
        onRunCheckpoint,
        currentStep,
        runRecord
      });
    }
    case "open_file": {
      const targetPath = path.join(workspaceRoot, String(args.path || ""));
      await openInVSWirksEditor(targetPath);
      emitRunEvent(onRunEvent, {
        type: "context",
        label: `Opened ${args.path}`,
        detail: "Revealed in the editor.",
        path: String(args.path || "")
      });
      emitCheckpoint(onRunCheckpoint, {
        runId: runRecord.id,
        label: `Opened ${args.path}`,
        step: currentStep,
        threadMessageCount: thread.messages.length,
        eventCount: runRecord.events ? runRecord.events.length : 0,
        changedFiles: runRecord.changedFiles || []
      });
      return {
        summary: `Opened ${args.path}`,
        content: JSON.stringify({ ok: true, path: args.path })
      };
    }
    default:
      emitRunEvent(onRunEvent, {
        type: "warning",
        label: `Skipped unknown tool ${name}`,
        detail: toolCall && toolCall.function ? toolCall.function.arguments || "" : ""
      });
      return {
        summary: `Skipped unknown tool ${name}`,
        content: JSON.stringify({ ok: false, error: `Unknown tool ${name}` })
      };
  }
}

async function proposeAndApplyWrite({
  workspaceRoot,
  relativePath,
  content,
  reason,
  thread,
  writeRequiresApproval,
  currentRunApprovalMode,
  requestApproval,
  onRunEvent,
  onRunCheckpoint,
  currentStep,
  runRecord
}) {
  let nextRunApprovalMode = currentRunApprovalMode;
  const diffPreview = await computeWorkspaceDiff({
    workspaceRoot,
    relativePath,
    nextContent: content
  });
  const approvalRequest = {
    id: makeId("approval"),
    runId: runRecord.id,
    threadId: thread.id,
    relativePath,
    diff: diffPreview.diff,
    rationale: reason || `Agent step ${currentStep}`,
    sourceStep: currentStep,
    status: "pending",
    createdAt: Date.now()
  };

  emitRunEvent(onRunEvent, {
    type: "proposal",
    label: `Proposed ${relativePath}`,
    detail: approvalRequest.rationale,
    path: relativePath,
    diff: approvalRequest.diff,
    rationale: approvalRequest.rationale
  });

  if (writeRequiresApproval) {
    if (thread.writeApprovalMode !== "chat" && currentRunApprovalMode !== "run") {
      const approval = await requestApproval(approvalRequest);
      emitCheckpoint(onRunCheckpoint, {
        runId: runRecord.id,
        label: `Approval ${approval.approved ? "granted" : "denied"} for ${relativePath}`,
        step: currentStep,
        threadMessageCount: thread.messages.length,
        eventCount: runRecord.events ? runRecord.events.length : 0,
        changedFiles: runRecord.changedFiles || []
      });
      if (!approval.approved) {
        emitRunEvent(onRunEvent, {
          type: "warning",
          label: `Write denied for ${relativePath}`,
          detail: "The file proposal was denied and kept in the run history."
        });
        return {
          summary: `Write denied for ${relativePath}`,
          content: JSON.stringify({
            ok: false,
            denied: true,
            path: relativePath,
            diff: approvalRequest.diff
          })
        };
      }
      if (approval.nextMode === "chat") {
        thread.writeApprovalMode = "chat";
      } else if (approval.nextMode === "run") {
        nextRunApprovalMode = "run";
      }
    }
  }

  const outcome = await writeWorkspaceFile({
    workspaceRoot,
    relativePath,
    content
  });
  emitRunEvent(onRunEvent, {
    type: "write_applied",
    label: `Wrote ${relativePath}`,
    detail: outcome.backupPath ? `Backup created: ${outcome.backupPath}` : "New file written",
    path: relativePath,
    diff: approvalRequest.diff,
    rationale: approvalRequest.rationale
  });
  emitCheckpoint(onRunCheckpoint, {
    runId: runRecord.id,
    label: `Applied ${relativePath}`,
    step: currentStep,
    threadMessageCount: thread.messages.length,
    eventCount: runRecord.events ? runRecord.events.length : 0,
    changedFiles: Array.from(new Set([...(runRecord.changedFiles || []), relativePath]))
  });
  return {
    summary: `Wrote ${relativePath}`,
    content: JSON.stringify({
      ok: true,
      path: outcome.path,
      backupPath: outcome.backupPath,
      diff: approvalRequest.diff
    }),
    nextRunApprovalMode
  };
}

function recordToolMessage(thread, toolName, result) {
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
}

async function toApiMessages(thread, workspaceRoot, context = {}) {
  const messages = [
    {
      role: "system",
      content: await buildWorkspaceSystemPrompt(workspaceRoot, context)
    }
  ];
  for (const item of thread.messages) {
    if (item.role === "user") {
      messages.push({ role: "user", content: item.renderedContent || item.content });
    } else if (item.role === "assistant" && !item.pending && item.content) {
      messages.push({ role: "assistant", content: item.content });
    }
  }
  return messages;
}

async function buildWorkspaceSystemPrompt(workspaceRoot, context = {}) {
  const instructions = await readWorkspaceInstructions(workspaceRoot);
  const segments = [DEFAULT_SYSTEM_PROMPT];
  if (instructions) {
    segments.push(`Workspace instructions:\n${instructions}`);
  }
  if (context.globalSystemPrompt) {
    segments.push(`Global system prompt:\n${context.globalSystemPrompt}`);
  }
  if (context.agentProfile && context.agentProfile.systemPrompt) {
    segments.push(
      `Agent profile (${context.agentProfile.label || context.agentProfile.id || "custom"}):\n` +
        `${context.agentProfile.systemPrompt}`
    );
  }
  if (context.threadSystemPrompt) {
    segments.push(`Thread override prompt:\n${context.threadSystemPrompt}`);
  }
  if (context.workflowPreset && context.workflowPreset.label) {
    segments.push(
      `Workflow preset: ${context.workflowPreset.label}\n` +
        `${context.workflowPreset.description || ""}\n` +
        `Completion contract: ${context.workflowPreset.completionContract || "none"}`
    );
  }
  if (context.specDraft && context.specDraft.raw) {
    segments.push(`Active spec draft:\n${context.specDraft.raw}`);
  }
  if (context.intelligence && context.intelligence.summary) {
    segments.push(`Project intelligence:\n${context.intelligence.summary}`);
  }
  return segments.filter(Boolean).join("\n\n");
}

async function readWorkspaceInstructions(workspaceRoot) {
  if (!workspaceRoot) {
    return "";
  }
  const target = path.join(workspaceRoot, WORKSPACE_INSTRUCTIONS_PATH);
  const text = await fs.readFile(target, "utf8").catch(() => "");
  return text.trim();
}

async function buildRequestContent(prompt, attachments, options, workspaceRoot, context = {}) {
  const blocks = [];
  if (context.promptPrefix) {
    blocks.push(String(context.promptPrefix).trim());
  }
  blocks.push(String(prompt || "").trim());
  const hasImageAttachments = attachments.some((item) => item && item.kind === "image");

  if (attachments.length) {
    const attachmentBlocks = attachments.map((item) => formatAttachmentBlock(item));
    blocks.push(`Workspace context:\n\n${attachmentBlocks.join("\n\n")}`);
  }

  const directive = await buildExecutionDirectiveBlock({
    prompt,
    mode: options.mode,
    executionMode: options.executionMode,
    hasImageAttachments,
    workspaceRoot,
    workflowPreset: context.workflowPreset,
    specDraft: context.specDraft,
    intelligence: context.intelligence
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

async function buildExecutionDirectiveBlock({
  prompt,
  mode,
  executionMode,
  hasImageAttachments,
  workspaceRoot,
  workflowPreset,
  specDraft,
  intelligence
}) {
  const workspaceSnapshot = await describeWorkspaceRoot(workspaceRoot);
  const lines = [];

  if (normalizeExecutionMode(executionMode) === "act") {
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

  if (mode === "agent") {
    lines.push(
      normalizeExecutionMode(executionMode) === "act"
        ? "For repository work, use workspace tools deliberately and write complete file contents."
        : "Return phases, exact file paths, stack choices, and validation steps."
    );
  }

  if (workflowPreset && workflowPreset.completionContract) {
    lines.push(`Workflow completion contract: ${workflowPreset.completionContract}`);
  }

  if (specDraft && specDraft.raw) {
    lines.push(`Active spec draft available. Follow it closely:\n${clampText(specDraft.raw, 12000)}`);
  }

  if (intelligence && intelligence.summary) {
    lines.push(`Project intelligence summary:\n${clampText(intelligence.summary, 6000)}`);
  }

  if (hasImageAttachments) {
    lines.push(
      "Attached image context was derived locally from image metadata and OCR. Treat it as a UI or product reference. When the request is to build from the image, turn that reference into real components, styling, project structure, and file writes rather than stopping at a mockup description."
    );
  }

  if (looksLikeRepoCreationRequest(prompt, workspaceSnapshot && workspaceSnapshot.empty)) {
    lines.push("Tailor the repository to this local Apple Silicon workstation and keep it local-first.");
    if (workspaceSnapshot && workspaceSnapshot.empty) {
      lines.push(
        normalizeExecutionMode(executionMode) === "act"
          ? "Workspace state: empty project root. Create a full production-ready repository here. Do not leave demo placeholders, fake sample files, or TODO-only scaffolding. Write the real README, project metadata, source, tests, scripts, and local run instructions."
          : "Workspace state: empty project root. Return a full production-ready repository plan with exact file paths, responsibilities, and setup steps. Do not create files."
      );
    }
  }

  return lines.join("\n");
}

async function resolveEffectiveRequestMode(prompt, requested) {
  const workspaceSnapshot = await describeWorkspaceRoot(requested.workspaceRoot);
  const shouldPromote =
    workspaceSnapshot &&
    workspaceSnapshot.empty &&
    looksLikeRepoCreationRequest(prompt, workspaceSnapshot.empty) &&
    (requested.mode !== "agent" || requested.executionMode !== "act");

  if (!shouldPromote) {
    return {
      mode: requested.mode,
      executionMode: requested.executionMode,
      autoPromoted: false
    };
  }

  return {
    mode: "agent",
    executionMode: "act",
    autoPromoted: true
  };
}

async function resolveAgentStepLimit(executionMode, messages, workspaceRoot) {
  if (normalizeExecutionMode(executionMode) !== "act") {
    return 6;
  }
  const workspaceSnapshot = await describeWorkspaceRoot(workspaceRoot);
  const latestUserContent = getLatestUserContent(messages);
  const isRepoBuild = looksLikeRepoCreationRequest(
    latestUserContent,
    workspaceSnapshot && workspaceSnapshot.empty
  );
  return isRepoBuild ? 24 : 8;
}

function getLatestUserContent(messages) {
  const items = Array.isArray(messages) ? [...messages].reverse() : [];
  for (const item of items) {
    if (item && item.role === "user" && typeof item.content === "string" && item.content.trim()) {
      return item.content;
    }
  }
  return "";
}

function getPrimaryUserContent(messages) {
  const items = Array.isArray(messages) ? messages : [];
  for (const item of items) {
    if (item && item.role === "user" && typeof item.content === "string" && item.content.trim()) {
      return item.content;
    }
  }
  return "";
}

function getWorkspaceToolsForExecution(executionMode) {
  return normalizeExecutionMode(executionMode) === "act" ? getAgentTools() : getPlannerTools();
}

function getPlannerTools() {
  return [
    toolShape("list_workspace", "List files in the current workspace.", {
      path: { type: "string", description: "Workspace-relative directory to list. Use '.' for the root." },
      max_entries: { type: "number", description: "Maximum number of paths to return." }
    }),
    toolShape(
      "read_file",
      "Read a text file from the workspace.",
      {
        path: { type: "string", description: "Workspace-relative file path." }
      },
      ["path"]
    ),
    toolShape(
      "search_workspace",
      "Search for a string in workspace files.",
      {
        pattern: { type: "string", description: "Plain text or regex-like search term." },
        glob: { type: "string", description: "Optional include glob such as '**/*.ts'." },
        max_results: { type: "number", description: "Maximum number of matches to return." }
      },
      ["pattern"]
    ),
    toolShape(
      "open_file",
      "Open a workspace file in the editor.",
      {
        path: { type: "string", description: "Workspace-relative file path." }
      },
      ["path"]
    )
  ];
}

function getAgentTools() {
  return [
    ...getPlannerTools().slice(0, 3),
    toolShape(
      "write_file",
      "Propose and then write complete file contents to a workspace file. Existing files are backed up before overwrite.",
      {
        path: { type: "string", description: "Workspace-relative file path." },
        content: { type: "string", description: "Complete new file contents." },
        reason: {
          type: "string",
          description: "Short reason for the change that will be shown in approvals and run history."
        }
      },
      ["path", "content"]
    ),
    getPlannerTools()[3]
  ];
}

function toolShape(name, description, properties, required) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        required,
        properties
      }
    }
  };
}

async function tryMaterializeActReply({
  model,
  workspaceRoot,
  messages,
  assistantContent,
  fetchJson,
  executeTool,
  onToolResult,
  onProgress
}) {
  const workspaceSnapshot = await describeWorkspaceRoot(workspaceRoot);
  const latestUserContent = getLatestUserContent(messages);

  if (!workspaceSnapshot || !workspaceSnapshot.empty) {
    return { applied: false, touchedPaths: [], summary: "", reason: "", code: "not_applicable" };
  }
  if (!looksLikeRepoCreationRequest(latestUserContent, workspaceSnapshot.empty)) {
    return { applied: false, touchedPaths: [], summary: "", reason: "", code: "not_applicable" };
  }
  if (!String(assistantContent || "").trim()) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        "Repo scaffold reply was empty. The run needs workspace tool calls or a complete repository manifest before files can be written.",
      code: "empty_reply"
    };
  }

  if (onProgress) {
    onProgress("Materializing scaffold into workspace files");
  }

  const manifest = await requestMaterializationManifest({
    model,
    workspaceRoot,
    latestUserContent,
    assistantContent,
    fetchJson
  });
  if (!manifest.files.length) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        "Repo scaffold manifest was empty. The run needs concrete files, project metadata, source, tests, and local verification details before it can continue.",
      code: "empty_manifest"
    };
  }

  const quality = evaluateRepoMaterializationManifest(manifest);
  if (!quality.ok) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        "Refusing to materialize an incomplete repository scaffold.\n- " +
        quality.issues.join("\n- "),
      code: "quality_reject"
    };
  }

  return applyMaterializationManifest({
    manifest,
    executeTool,
    onToolResult,
    summaryFallback: "Materialized workspace scaffold into local files."
  });
}

function inferRequestedRepoName(text) {
  const source = String(text || "");
  const patterns = [
    /\b(?:repository|repo|project|app|application|tool|service|cli|package)\s+named\s+([A-Za-z0-9._-]+)/i,
    /\bnamed\s+([A-Za-z0-9._-]+)/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return titleFromPrompt(source) || "local-app";
}

function sanitizeBootstrapToken(value, fallback, joiner = "-") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, joiner)
    .replace(/[._-]{2,}/g, joiner)
    .replace(/^[._-]+|[._-]+$/g, "")
    .toLowerCase();
  return normalized || fallback;
}

function humanizeBootstrapName(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) {
    return "Local App";
  }
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function detectBootstrapStrategy(rootUserContent, assistantContent) {
  const text = `${rootUserContent || ""}\n${assistantContent || ""}`.toLowerCase();
  if (
    /\b(node|javascript|typescript|react|next|electron|express|vite|npm|pnpm|yarn)\b/.test(text)
  ) {
    return "node";
  }
  return "python";
}

function summarizeBootstrapIntent(text) {
  const source = String(text || "").toLowerCase();
  if (/\baudio\b/.test(source) && /\bstem\b/.test(source)) {
    return "Local-first offline audio stem separation application for Apple Silicon.";
  }
  if (/\bcli\b/.test(source)) {
    return "Local-first command-line application for Apple Silicon.";
  }
  if (/\bapi\b|\bservice\b|\bserver\b/.test(source)) {
    return "Local-first service application for Apple Silicon.";
  }
  return "Local-first application for Apple Silicon.";
}

function extractInvalidStructuredPaths(invalidManifestIssues) {
  const result = new Set();
  for (const issue of Array.isArray(invalidManifestIssues) ? invalidManifestIssues : []) {
    const match = String(issue || "").match(/Invalid\s+([^:]+):/i);
    if (match && match[1]) {
      result.add(normalizeRepoPath(match[1]));
    }
  }
  return result;
}

function stripBootstrapRootPrefix(filePath, rootUserContent) {
  const rawPath = String(filePath || "")
    .trim()
    .replace(/^\.?\//, "")
    .replace(/^\/+/, "");
  const segments = rawPath.split("/").filter(Boolean);
  if (segments.length < 2) {
    return rawPath;
  }

  const requestedName = inferRequestedRepoName(rootUserContent);
  const candidates = [
    requestedName,
    sanitizeBootstrapToken(requestedName, "", "-"),
    sanitizeBootstrapToken(requestedName, "", "_")
  ]
    .filter(Boolean)
    .map((value) => String(value).replace(/[^a-z0-9]/gi, "").toLowerCase());
  const firstSegment = segments[0].replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (firstSegment && candidates.includes(firstSegment)) {
    return segments.slice(1).join("/");
  }
  return rawPath;
}

function buildPythonBootstrapFiles({
  displayName,
  summary,
  packageName,
  moduleName,
  preferPyproject
}) {
  const manifestPath = preferPyproject ? "pyproject.toml" : "requirements.txt";
  const manifestContent = preferPyproject
    ? [
        "[build-system]",
        'requires = ["setuptools>=68"]',
        'build-backend = "setuptools.build_meta"',
        "",
        "[project]",
        `name = "${packageName}"`,
        'version = "0.1.0"',
        `description = "${summary}"`,
        'requires-python = ">=3.11"',
        "dependencies = [",
        '  "fastapi>=0.115,<1.0",',
        '  "uvicorn>=0.30,<1.0",',
        '  "httpx>=0.27,<1.0",',
        "]",
        ""
      ].join("\n")
    : ["fastapi>=0.115,<1.0", "uvicorn>=0.30,<1.0", "httpx>=0.27,<1.0", ""].join("\n");

  const readme = [
    `# ${displayName}`,
    "",
    summary,
    "",
    "## Stack",
    "- Python 3.11",
    "- FastAPI",
    "- Uvicorn",
    "",
    "## Run",
    "```bash",
    "python3 -m venv .venv",
    "source .venv/bin/activate",
    preferPyproject ? "python3 -m pip install -e ." : "python3 -m pip install -r requirements.txt",
    "python3 -m uvicorn main:app --host 127.0.0.1 --port 8000",
    "```",
    "",
    "## Verify",
    "```bash",
    "python3 -m compileall .",
    "python3 -m unittest discover tests",
    "```",
    ""
  ].join("\n");

  return [
    {
      path: "README.md",
      content: readme,
      reason: "Create a concrete local run and verification guide."
    },
    {
      path: manifestPath,
      content: manifestContent,
      reason: "Define the Python service dependencies and project metadata."
    },
    {
      path: "main.py",
      content: [
        "from fastapi import FastAPI",
        "",
        `app = FastAPI(title=${JSON.stringify(displayName)}, version="0.1.0")`,
        "",
        "",
        '@app.get("/")',
        "def read_root() -> dict[str, str]:",
        `    return {"name": ${JSON.stringify(moduleName)}, "status": "ready"}`,
        "",
        "",
        '@app.get("/health")',
        "def read_health() -> dict[str, str]:",
        '    return {"status": "ok"}',
        ""
      ].join("\n"),
      reason: "Add a runnable local FastAPI entrypoint."
    },
    {
      path: "src/backend/__init__.py",
      content: `"""Backend package for ${displayName}."""\n`,
      reason: "Establish the backend package structure for later phases."
    },
    {
      path: "src/frontend/__init__.py",
      content: `"""Frontend package for ${displayName}."""\n`,
      reason: "Establish the frontend package structure for later phases."
    },
    {
      path: "src/utils/__init__.py",
      content: `"""Shared utilities for ${displayName}."""\n`,
      reason: "Establish the shared utility package structure."
    },
    {
      path: "tests/test_main.py",
      content: [
        "import unittest",
        "",
        "from fastapi.testclient import TestClient",
        "",
        "from main import app",
        "",
        "",
        "class AppTests(unittest.TestCase):",
        "    def setUp(self) -> None:",
        "        self.client = TestClient(app)",
        "",
        "    def test_health(self) -> None:",
        '        response = self.client.get("/health")',
        "        self.assertEqual(response.status_code, 200)",
        '        self.assertEqual(response.json()["status"], "ok")',
        "",
        "",
        'if __name__ == "__main__":',
        "    unittest.main()",
        ""
      ].join("\n"),
      reason: "Add a local verification path for the bootstrap service shell."
    },
    {
      path: "scripts/run.sh",
      content: ["#!/usr/bin/env bash", "set -euo pipefail", "python3 -m uvicorn main:app --host 127.0.0.1 --port 8000", ""].join("\n"),
      reason: "Provide a local run helper for the service shell."
    },
    {
      path: "scripts/test.sh",
      content: ["#!/usr/bin/env bash", "set -euo pipefail", "python3 -m unittest discover tests", ""].join("\n"),
      reason: "Provide a local validation helper for the bootstrap repo."
    }
  ];
}

function buildNodeBootstrapFiles({ displayName, summary, packageName }) {
  const readme = [
    `# ${displayName}`,
    "",
    summary,
    "",
    "## Stack",
    "- Node.js",
    "- Native HTTP server",
    "- node:test",
    "",
    "## Run",
    "```bash",
    "npm install",
    "npm start",
    "```",
    "",
    "## Verify",
    "```bash",
    "node --test",
    "```",
    ""
  ].join("\n");

  return [
    {
      path: "README.md",
      content: readme,
      reason: "Create a concrete local run and verification guide."
    },
    {
      path: "package.json",
      content: `${JSON.stringify(
        {
          name: packageName,
          version: "0.1.0",
          private: true,
          type: "module",
          scripts: {
            start: "node src/index.js",
            test: "node --test"
          },
          engines: {
            node: ">=20"
          }
        },
        null,
        2
      )}\n`,
      reason: "Define the Node.js project metadata and scripts."
    },
    {
      path: "src/server.js",
      content: [
        'import http from "node:http";',
        "",
        "export function createServer() {",
        "  return http.createServer((request, response) => {",
        '    if (request.url === "/health") {',
        '      response.writeHead(200, { "content-type": "application/json" });',
        '      response.end(JSON.stringify({ status: "ok" }));',
        "      return;",
        "    }",
        "",
        '    response.writeHead(200, { "content-type": "application/json" });',
        `    response.end(JSON.stringify({ name: ${JSON.stringify(packageName)}, status: "ready" }));`,
        "  });",
        "}",
        ""
      ].join("\n"),
      reason: "Add a runnable local server shell for the repository."
    },
    {
      path: "src/index.js",
      content: [
        'import { createServer } from "./server.js";',
        "",
        "const port = Number(process.env.PORT || 3000);",
        'const host = process.env.HOST || "127.0.0.1";',
        "",
        "const server = createServer();",
        "server.listen(port, host, () => {",
        "  process.stdout.write(`Server listening on http://${host}:${port}\\n`);",
        "});",
        ""
      ].join("\n"),
      reason: "Add the local process entrypoint."
    },
    {
      path: "tests/server.test.js",
      content: [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { once } from "node:events";',
        "",
        'import { createServer } from "../src/server.js";',
        "",
        'test("health endpoint responds with ok", async () => {',
        "  const server = createServer();",
        '  server.listen(0, "127.0.0.1");',
        '  await once(server, "listening");',
        "  const address = server.address();",
        '  const response = await fetch(`http://127.0.0.1:${address.port}/health`);',
        "  const payload = await response.json();",
        "  assert.equal(response.status, 200);",
        '  assert.equal(payload.status, "ok");',
        "  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));",
        "});",
        ""
      ].join("\n"),
      reason: "Add a local verification path for the Node service shell."
    },
    {
      path: "scripts/run.sh",
      content: ["#!/usr/bin/env bash", "set -euo pipefail", "npm start", ""].join("\n"),
      reason: "Provide a local run helper for the bootstrap repo."
    },
    {
      path: "scripts/test.sh",
      content: ["#!/usr/bin/env bash", "set -euo pipefail", "node --test", ""].join("\n"),
      reason: "Provide a local validation helper for the bootstrap repo."
    }
  ];
}

function buildDeterministicBootstrapManifest({
  rootUserContent,
  assistantContent,
  existingPaths,
  invalidManifestIssues
}) {
  const requestedName = inferRequestedRepoName(rootUserContent);
  const packageName = sanitizeBootstrapToken(requestedName, "local-app");
  const moduleName = sanitizeBootstrapToken(requestedName, "local_app", "_");
  const displayName = humanizeBootstrapName(requestedName);
  const summary = summarizeBootstrapIntent(rootUserContent);
  const strategy = detectBootstrapStrategy(rootUserContent, assistantContent);
  const normalizedExistingPaths = new Set(
    (Array.isArray(existingPaths) ? existingPaths : []).map((entry) => normalizeRepoPath(entry))
  );
  const invalidPaths = extractInvalidStructuredPaths(invalidManifestIssues);
  const preferPyproject =
    strategy === "python" &&
    (normalizedExistingPaths.has("pyproject.toml") || invalidPaths.has("pyproject.toml"));
  const files =
    strategy === "node"
      ? buildNodeBootstrapFiles({ displayName, summary, packageName })
      : buildPythonBootstrapFiles({
          displayName,
          summary,
          packageName,
          moduleName,
          preferPyproject
        });

  return {
    summary: `Stabilized bootstrap foundation for ${displayName}.`,
    files,
    open: [strategy === "node" ? "src/index.js" : "main.py"]
  };
}

function stabilizeBootstrapManifest({
  manifest,
  rootUserContent,
  assistantContent,
  existingPaths,
  invalidManifestIssues
}) {
  const normalizedExistingPaths = new Set(
    (Array.isArray(existingPaths) ? existingPaths : []).map((entry) => normalizeRepoPath(entry))
  );
  const invalidPaths = extractInvalidStructuredPaths(invalidManifestIssues);
  const fallback = buildDeterministicBootstrapManifest({
    rootUserContent,
    assistantContent,
    existingPaths,
    invalidManifestIssues
  });
  const sourceManifest =
    manifest && typeof manifest === "object"
      ? {
          summary: typeof manifest.summary === "string" ? manifest.summary : "",
          files: Array.isArray(manifest.files) ? manifest.files : [],
          open: Array.isArray(manifest.open) ? manifest.open : []
        }
      : { summary: "", files: [], open: [] };
  const merged = new Map();

  for (const entry of sourceManifest.files) {
    const nextPath =
      entry && typeof entry.path === "string"
        ? stripBootstrapRootPrefix(entry.path, rootUserContent)
        : "";
    if (!entry || !nextPath) {
      continue;
    }
    if (PLACEHOLDER_ARTIFACT_PATTERN.test(typeof entry.content === "string" ? entry.content : "")) {
      continue;
    }
    merged.set(normalizeRepoPath(nextPath), {
      path: nextPath,
      content: typeof entry.content === "string" ? entry.content : "",
      reason: typeof entry.reason === "string" ? entry.reason : ""
    });
  }

  for (const entry of fallback.files) {
    const normalizedPath = normalizeRepoPath(entry.path);
    if (invalidPaths.has(normalizedPath)) {
      merged.set(normalizedPath, entry);
      continue;
    }
    if (merged.has(normalizedPath) || normalizedExistingPaths.has(normalizedPath)) {
      continue;
    }
    merged.set(normalizedPath, entry);
  }

  return {
    summary:
      sourceManifest.summary && sourceManifest.summary.trim()
        ? sourceManifest.summary.trim()
        : fallback.summary,
    files: Array.from(merged.values()),
    open: Array.from(new Set([...(sourceManifest.open || []), ...(fallback.open || [])]))
  };
}

async function tryBootstrapPhaseRecovery({
  model,
  workspaceRoot,
  phase,
  rootUserContent,
  phasePrompt,
  assistantContent,
  fetchJson,
  executeTool,
  onToolResult,
  onProgress
}) {
  if (onProgress) {
    onProgress("Retrying bootstrap with constrained foundation materialization");
  }

  const existingStructuredFiles = await loadStructuredWorkspaceFiles(workspaceRoot);
  const manifest = stabilizeBootstrapManifest({
    manifest: await requestBootstrapRecoveryManifest({
      model,
      workspaceRoot,
      rootUserContent,
      phasePrompt,
      assistantContent,
      fetchJson
    }),
    rootUserContent,
    assistantContent,
    existingPaths: [],
    invalidManifestIssues: []
  });
  if (!manifest.files.length) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        "Bootstrap recovery manifest was empty. The builder still did not provide README, project metadata, source, tests, and verification guidance.",
      code: "bootstrap_empty_manifest"
    };
  }

  const phaseQuality = evaluatePhaseMaterializationManifest(phase, manifest.files);
  if (!phaseQuality.ok) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        "Refusing bootstrap recovery manifest because it missed bootstrap requirements.\n- " +
        phaseQuality.issues.join("\n- "),
      code: "bootstrap_phase_quality_reject"
    };
  }

  const combinedStructuredFiles = mergeStructuredManifestFiles(existingStructuredFiles, manifest.files);
  const structuredQuality = evaluateStructuredManifestFiles(combinedStructuredFiles);
  if (!structuredQuality.ok) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        "Refusing bootstrap recovery manifest because it still contains invalid structured manifests.\n- " +
        structuredQuality.issues.join("\n- "),
      code: "bootstrap_manifest_reject"
    };
  }

  return applyMaterializationManifest({
    manifest,
    executeTool,
    onToolResult,
    summaryFallback: "Recovered bootstrap foundation into local files."
  });
}

async function tryBootstrapMissingRequirementsRecovery({
  model,
  workspaceRoot,
  phase,
  rootUserContent,
  phasePrompt,
  assistantContent,
  missingRequirements,
  invalidManifestIssues,
  fetchJson,
  executeTool,
  onToolResult,
  onProgress
}) {
  if (onProgress) {
    onProgress("Recovering missing bootstrap foundations");
  }

  const existingPaths = await listWorkspace({
    workspaceRoot,
    relativePath: ".",
    maxEntries: 600
  }).catch(() => []);
  const existingStructuredFiles = await loadStructuredWorkspaceFiles(workspaceRoot);
  const normalizedExistingPaths = Array.from(
    new Set((Array.isArray(existingPaths) ? existingPaths : []).map((entry) => normalizeRepoPath(entry)))
  );
  const manifest = stabilizeBootstrapManifest({
    manifest: await requestBootstrapMissingRequirementsManifest({
      model,
      workspaceRoot,
      rootUserContent,
      phasePrompt,
      assistantContent,
      missingRequirements,
      invalidManifestIssues,
      existingPaths: normalizedExistingPaths,
      fetchJson
    }),
    rootUserContent,
    assistantContent,
    existingPaths: normalizedExistingPaths,
    invalidManifestIssues
  });
  if (!manifest.files.length) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        "Bootstrap requirement recovery manifest was empty. The builder still did not provide the missing README, source, entrypoint, or manifest fixes.",
      code: "bootstrap_missing_requirements_empty_manifest"
    };
  }

  const phaseQuality = evaluatePhaseMaterializationManifest(
    phase,
    manifest.files,
    normalizedExistingPaths
  );
  if (!phaseQuality.ok) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        "Refusing bootstrap requirement recovery manifest because it still missed bootstrap requirements.\n- " +
        phaseQuality.issues.join("\n- "),
      code: "bootstrap_missing_requirements_phase_quality_reject"
    };
  }

  const combinedStructuredFiles = mergeStructuredManifestFiles(existingStructuredFiles, manifest.files);
  const structuredQuality = evaluateStructuredManifestFiles(combinedStructuredFiles);
  if (!structuredQuality.ok) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        "Refusing bootstrap requirement recovery manifest because it still contains invalid structured manifests.\n- " +
        structuredQuality.issues.join("\n- "),
      code: "bootstrap_missing_requirements_manifest_reject"
    };
  }

  return applyMaterializationManifest({
    manifest,
    executeTool,
    onToolResult,
    summaryFallback: "Recovered missing bootstrap foundations into local files."
  });
}

function buildPhaseRecoveryDirective(phase) {
  if (!phase || typeof phase !== "object") {
    return "Return complete, production-ready files that satisfy this phase contract.";
  }
  if (phase.id === "backend") {
    return (
      "This backend/core phase must write real application logic in owned source or entrypoint files " +
      "and at least one backend test file."
    );
  }
  if (phase.id === "middleware") {
    return "This middleware phase must write the actual orchestration or runtime wiring files now.";
  }
  if (phase.id === "frontend") {
    return "This frontend phase must write the actual user-facing flow in owned UI files now.";
  }
  return "Return complete, production-ready files that satisfy this phase contract.";
}

async function requestPhaseRecoveryManifest({
  model,
  workspaceRoot,
  phase,
  rootUserContent,
  phasePrompt,
  assistantContent,
  missingRequirements,
  missingWriteRequirements,
  invalidManifestIssues,
  changedFiles,
  existingPaths,
  fetchJson
}) {
  const missingText = Array.isArray(missingRequirements) && missingRequirements.length
    ? missingRequirements.map((group) => `- ${group.join(" or ")}`).join("\n")
    : "- none";
  const missingWriteText = Array.isArray(missingWriteRequirements) && missingWriteRequirements.length
    ? missingWriteRequirements.map((group) => `- ${group.join(" or ")}`).join("\n")
    : "- none";
  const invalidText = Array.isArray(invalidManifestIssues) && invalidManifestIssues.length
    ? invalidManifestIssues.map((issue) => `- ${issue}`).join("\n")
    : "- none";
  const changedText = Array.isArray(changedFiles) && changedFiles.length
    ? changedFiles.map((entry) => `- ${entry}`).join("\n")
    : "- none";
  const existingText = Array.isArray(existingPaths) && existingPaths.length
    ? existingPaths.slice(0, 100).map((entry) => `- ${entry}`).join("\n")
    : "- none";
  const payload = {
    model,
    stream: false,
    temperature: 0.05,
    top_p: 0.8,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          `${await buildWorkspaceSystemPrompt(workspaceRoot)}\n\n` +
          "You are recovering a stalled phase of a staged repository scaffold. " +
          'Return only a JSON object with this schema: {"summary":"short summary","files":[{"path":"relative/path","content":"complete file contents","reason":"short why"}],"open":["optional/relative/path"]}. ' +
          "The workspace already contains earlier phases. Return only the missing files or necessary replacements needed to satisfy this phase contract. " +
          "Keep writes primarily inside the owned paths for this phase. Every file must be complete, production-ready, and free of placeholder, TODO-only, stub, or demo-only content. " +
          `${buildPhaseRecoveryDirective(phase)} ` +
          "If you still cannot produce concrete files that satisfy this phase, return an empty files array."
      },
      {
        role: "user",
        content: `Original scaffold request:\n${clampText(rootUserContent, 16000)}`
      },
      {
        role: "user",
        content: `Phase contract:\n${clampText(phasePrompt, 12000)}`
      },
      {
        role: "user",
        content: `Existing workspace files:\n${existingText}`
      },
      {
        role: "user",
        content: `Files already changed in this phase:\n${changedText}`
      },
      {
        role: "user",
        content: `Still missing phase completion checks:\n${missingText}`
      },
      {
        role: "user",
        content: `Still missing phase write checks:\n${missingWriteText}`
      },
      {
        role: "user",
        content: `Invalid existing manifest issues:\n${invalidText}`
      },
      {
        role: "assistant",
        content:
          clampText(
            String(assistantContent || "").trim() || "This phase stalled without producing enough concrete files.",
            16000
          )
      },
      {
        role: "user",
        content:
          `Recover the "${phase && phase.label ? phase.label : "scaffold"}" phase now. ` +
          "Return only the missing or corrected files needed to satisfy this phase contract. " +
          "Do not answer with prose outside the JSON object."
      }
    ]
  };

  const response = await fetchJson(payload);
  const choice = response && response.choices && response.choices[0];
  const content =
    choice && choice.message && typeof choice.message.content === "string"
      ? choice.message.content
      : "";
  return parseMaterializationManifest(content);
}

async function tryPhaseContractRecovery({
  model,
  workspaceRoot,
  phase,
  rootUserContent,
  phasePrompt,
  assistantContent,
  missingRequirements,
  missingWriteRequirements,
  invalidManifestIssues,
  changedFiles,
  fetchJson,
  executeTool,
  onToolResult,
  onProgress
}) {
  if (onProgress) {
    onProgress(`Recovering ${phase.label} with constrained phase materialization`);
  }

  const existingPaths = await listWorkspace({
    workspaceRoot,
    relativePath: ".",
    maxEntries: 600
  }).catch(() => []);
  const existingStructuredFiles = await loadStructuredWorkspaceFiles(workspaceRoot);
  const normalizedExistingPaths = Array.from(
    new Set((Array.isArray(existingPaths) ? existingPaths : []).map((entry) => normalizeRepoPath(entry)))
  );
  const manifest = await requestPhaseRecoveryManifest({
    model,
    workspaceRoot,
    phase,
    rootUserContent,
    phasePrompt,
    assistantContent,
    missingRequirements,
    missingWriteRequirements,
    invalidManifestIssues,
    changedFiles,
    existingPaths: normalizedExistingPaths,
    fetchJson
  });
  if (!manifest.files.length) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        `${phase.label} recovery manifest was empty. ` +
        "This phase still did not provide the required owned files and concrete implementation.",
      code: "phase_recovery_empty_manifest"
    };
  }

  const phaseQuality = evaluatePhaseMaterializationManifest(
    phase,
    manifest.files,
    normalizedExistingPaths
  );
  if (!phaseQuality.ok) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        `Refusing ${phase.label} recovery manifest because it did not satisfy the phase contract.\n- ` +
        phaseQuality.issues.join("\n- "),
      code: "phase_recovery_quality_reject"
    };
  }

  const combinedStructuredFiles = mergeStructuredManifestFiles(existingStructuredFiles, manifest.files);
  const structuredQuality = evaluateStructuredManifestFiles(combinedStructuredFiles);
  if (!structuredQuality.ok) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason:
        `Refusing ${phase.label} recovery manifest because it still contains invalid structured manifests.\n- ` +
        structuredQuality.issues.join("\n- "),
      code: "phase_recovery_manifest_reject"
    };
  }

  return applyMaterializationManifest({
    manifest,
    executeTool,
    onToolResult,
    summaryFallback: `Recovered ${phase.label} into local files.`
  });
}

async function requestRepoToolCallRetry({
  model,
  generationSettings,
  workspaceRoot,
  messages,
  assistantContent,
  fetchJson,
  onProgress
}) {
  const workspaceSnapshot = await describeWorkspaceRoot(workspaceRoot);
  const latestUserContent = getLatestUserContent(messages);
  if (!isRepoBuildOnEmptyWorkspace(latestUserContent, workspaceSnapshot)) {
    return null;
  }

  if (onProgress) {
    onProgress("Retrying repo scaffold with tool-only guidance");
  }

  const response = await fetchJson({
    model,
    stream: false,
    ...getGenerationOptions("agent", generationSettings),
    messages: [
      ...messages,
      {
        role: "assistant",
        content: String(assistantContent || "").trim() || "I did not call any tools."
      },
      {
        role: "user",
        content:
          "You are in Act mode for an empty repository workspace. Do not answer with prose only. Use workspace tool calls now to create the real repository. Include project metadata, executable source implementing the core capability, tests, and a validation path. Do not emit demo placeholders, TODO-only files, or stub logic."
      }
    ],
    tools: getAgentTools()
  });
  const choice = response && response.choices && response.choices[0];
  const message = choice && choice.message ? choice.message : {};
  return {
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    assistantContent: typeof message.content === "string" ? message.content : "",
    usage: response.usage
  };
}

async function requestMaterializationManifest({
  model,
  workspaceRoot,
  latestUserContent,
  assistantContent,
  fetchJson
}) {
  const payload = {
    model,
    stream: false,
    temperature: 0.05,
    top_p: 0.8,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          `${await buildWorkspaceSystemPrompt(workspaceRoot)}\n\n` +
          "You convert a proposed repository into strict JSON for local file materialization. " +
          'Return only a JSON object with this schema: {"summary":"short summary","files":[{"path":"relative/path","content":"complete file contents","reason":"short why"}],"open":["optional/relative/path"]}. ' +
          "Do not use markdown fences. Keep paths relative. Include complete production-ready contents. " +
          "Every accepted manifest must include a README, project metadata or dependency manifest, real source implementing the core capability, tests, and local run or validation instructions. " +
          "If the proposal is too vague to do that without placeholders, return an empty files array."
      },
      {
        role: "user",
        content:
          "The workspace is empty. Convert the requested repository into concrete files for this workspace. Do not return explanations outside the JSON object."
      },
      {
        role: "user",
        content: `Original request:\n${clampText(latestUserContent, 16000)}`
      },
      {
        role: "assistant",
        content: clampText(assistantContent, 24000)
      },
      {
        role: "user",
        content:
          "Return the JSON object now. Include a practical README, project metadata, source files, tests, and local verification guidance. Do not emit placeholder, stub, TODO-only, or demo-only implementations. If the upstream proposal is not detailed enough for a real repo, return an empty files array."
      }
    ]
  };

  const response = await fetchJson(payload);
  const choice = response && response.choices && response.choices[0];
  const content =
    choice && choice.message && typeof choice.message.content === "string"
      ? choice.message.content
      : "";
  return parseMaterializationManifest(content);
}

async function requestBootstrapRecoveryManifest({
  model,
  workspaceRoot,
  rootUserContent,
  phasePrompt,
  assistantContent,
  fetchJson
}) {
  const payload = {
    model,
    stream: false,
    temperature: 0.05,
    top_p: 0.8,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          `${await buildWorkspaceSystemPrompt(workspaceRoot)}\n\n` +
          "You are recovering the bootstrap phase of a staged repository scaffold. " +
          'Return only a JSON object with this schema: {"summary":"short summary","files":[{"path":"relative/path","content":"complete file contents","reason":"short why"}],"open":["optional/relative/path"]}. ' +
          "Produce the smallest concrete repository foundation that is already real and locally runnable enough to unblock later phases. " +
          "It must include README.md, at least one dependency or project manifest, and at least one executable source entrypoint or initial app package file. " +
          "Do not use markdown fences. Keep paths relative. Do not emit placeholder, TODO-only, stub, or demo-only content."
      },
      {
        role: "user",
        content: `Original scaffold request:\n${clampText(rootUserContent, 16000)}`
      },
      {
        role: "user",
        content: `Bootstrap phase contract:\n${clampText(phasePrompt, 12000)}`
      },
      {
        role: "assistant",
        content:
          clampText(
            String(assistantContent || "").trim() || "No concrete bootstrap files were produced.",
            16000
          )
      },
      {
        role: "user",
        content:
          "Recover this bootstrap phase now. Return a minimal but real repository foundation with complete file contents for README, manifest, and initial source or entrypoint files. Include tests or validation only if you can do so concretely without blocking bootstrap. If you still cannot produce that concretely, return an empty files array."
      }
    ]
  };

  const response = await fetchJson(payload);
  const choice = response && response.choices && response.choices[0];
  const content =
    choice && choice.message && typeof choice.message.content === "string"
      ? choice.message.content
      : "";
  return parseMaterializationManifest(content);
}

async function requestBootstrapMissingRequirementsManifest({
  model,
  workspaceRoot,
  rootUserContent,
  phasePrompt,
  assistantContent,
  missingRequirements,
  invalidManifestIssues,
  existingPaths,
  fetchJson
}) {
  const missingText = Array.isArray(missingRequirements) && missingRequirements.length
    ? missingRequirements.map((group) => `- ${group.join(" or ")}`).join("\n")
    : "- unknown";
  const invalidText = Array.isArray(invalidManifestIssues) && invalidManifestIssues.length
    ? invalidManifestIssues.map((issue) => `- ${issue}`).join("\n")
    : "- none";
  const existingText = Array.isArray(existingPaths) && existingPaths.length
    ? existingPaths.slice(0, 80).map((entry) => `- ${entry}`).join("\n")
    : "- none";
  const payload = {
    model,
    stream: false,
    temperature: 0.05,
    top_p: 0.8,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          `${await buildWorkspaceSystemPrompt(workspaceRoot)}\n\n` +
          "You are fixing the last missing bootstrap foundations of a staged repository scaffold. " +
          'Return only a JSON object with this schema: {"summary":"short summary","files":[{"path":"relative/path","content":"complete file contents","reason":"short why"}],"open":["optional/relative/path"]}. ' +
          "The existing workspace already contains some bootstrap files. Return only the missing files or necessary replacements needed to satisfy the phase contract. " +
          "The combined workspace must end up with README.md, at least one project or dependency manifest, a runnable entrypoint or initial app package file, and tests or executable local validation coverage. " +
          "Do not use markdown fences. Keep paths relative. Do not emit placeholder, TODO-only, stub, or demo-only content."
      },
      {
        role: "user",
        content: `Original scaffold request:\n${clampText(rootUserContent, 16000)}`
      },
      {
        role: "user",
        content: `Bootstrap phase contract:\n${clampText(phasePrompt, 12000)}`
      },
      {
        role: "user",
        content: `Existing workspace files:\n${existingText}`
      },
      {
        role: "user",
        content: `Still missing path groups:\n${missingText}`
      },
      {
        role: "user",
        content: `Invalid existing manifest issues:\n${invalidText}`
      },
      {
        role: "assistant",
        content:
          clampText(
            String(assistantContent || "").trim() || "Bootstrap foundation is still incomplete.",
            16000
          )
      },
      {
        role: "user",
        content:
          "Return only the missing or corrected bootstrap files now. Prioritize README.md, source entrypoints or initial package files, and any manifest rewrites needed to fix invalid syntax. Do not wait for full test coverage in this bootstrap repair step. If you still cannot provide those concretely, return an empty files array."
      }
    ]
  };

  const response = await fetchJson(payload);
  const choice = response && response.choices && response.choices[0];
  const content =
    choice && choice.message && typeof choice.message.content === "string"
      ? choice.message.content
      : "";
  return parseMaterializationManifest(content);
}

function parseMaterializationManifest(text) {
  const candidates = [];
  const source = String(text || "").trim();
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
    if (!parsed || !Array.isArray(parsed.files)) {
      continue;
    }
    const files = parsed.files
      .map((entry) => ({
        path: typeof entry.path === "string" ? entry.path.trim() : "",
        content: typeof entry.content === "string" ? entry.content : "",
        reason: typeof entry.reason === "string" ? entry.reason : ""
      }))
      .filter((entry) => entry.path);
    if (!files.length) {
      continue;
    }
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      files,
      open: Array.isArray(parsed.open)
        ? parsed.open.filter((entry) => typeof entry === "string" && entry.trim())
        : []
    };
  }

  return {
    summary: "",
    files: [],
    open: []
  };
}

async function applyMaterializationManifest({
  manifest,
  executeTool,
  onToolResult,
  summaryFallback
}) {
  const touchedPaths = [];
  let deniedCount = 0;
  for (const file of manifest.files.slice(0, 60)) {
    const result = await executeTool(createSyntheticToolCall("write_file", file));
    if (onToolResult) {
      onToolResult("write_file", result);
    }
    const parsed = safeJsonParse(result.content, {});
    if (parsed && parsed.ok && parsed.path) {
      touchedPaths.push(parsed.path);
    } else if (parsed && parsed.denied) {
      deniedCount += 1;
    }
  }

  const openTargets = normalizeOpenTargets(manifest.open, touchedPaths);
  if (openTargets.length) {
    const openResult = await executeTool(
      createSyntheticToolCall("open_file", { path: openTargets[0] })
    );
    if (onToolResult) {
      onToolResult("open_file", openResult);
    }
  }

  if (!touchedPaths.length) {
    return {
      applied: false,
      touchedPaths: [],
      summary: "",
      reason: "",
      code: "no_writes"
    };
  }

  const summaryLines = [];
  summaryLines.push(
    manifest.summary && manifest.summary.trim()
      ? manifest.summary.trim()
      : summaryFallback || `Materialized ${touchedPaths.length} files into the workspace.`
  );
  if (deniedCount) {
    summaryLines.push(`Write approvals denied: ${deniedCount}`);
  }
  summaryLines.push("");
  summaryLines.push("Created files:");
  for (const item of touchedPaths) {
    summaryLines.push(`- \`${item}\``);
  }

  return {
    applied: true,
    touchedPaths,
    summary: summaryLines.join("\n"),
    reason: "",
    code: "applied"
  };
}

function normalizeOpenTargets(openTargets, touchedPaths) {
  const preferred = Array.isArray(openTargets)
    ? openTargets.filter((item) => typeof item === "string" && item.trim())
    : [];
  if (preferred.length) {
    return preferred;
  }
  return Array.isArray(touchedPaths) ? touchedPaths.slice(0, 3) : [];
}

function isRepoBuildOnEmptyWorkspace(latestUserContent, workspaceSnapshot) {
  return Boolean(
    workspaceSnapshot &&
      workspaceSnapshot.empty &&
      looksLikeRepoCreationRequest(latestUserContent, workspaceSnapshot.empty)
  );
}

function evaluateRepoMaterializationManifest(manifest, options = {}) {
  const files = Array.isArray(manifest && manifest.files) ? manifest.files : [];
  const normalized = files.map((entry) => ({
    path: normalizeRepoPath(entry.path),
    content: typeof entry.content === "string" ? entry.content : ""
  }));
  const existingPaths = Array.isArray(options && options.existingPaths)
    ? options.existingPaths.map((entry) => normalizeRepoPath(entry))
    : [];
  const combinedPaths = Array.from(
    new Set([...existingPaths, ...normalized.map((entry) => entry.path)])
  );
  const issues = [];

  if (!combinedPaths.some((entry) => entry === "readme.md")) {
    issues.push("Missing README.md with local setup and run instructions.");
  }
  if (!combinedPaths.some((entry) => REPO_MANIFEST_PATHS.has(entry))) {
    issues.push("Missing project metadata or dependency manifest such as package.json, pyproject.toml, or requirements.txt.");
  }
  if (!combinedPaths.some((entry) => REPO_SOURCE_PATTERNS.some((pattern) => pattern.test(entry)))) {
    issues.push("Missing real source files under a concrete app structure.");
  }
  if (!combinedPaths.some((entry) => REPO_ENTRYPOINT_PATTERNS.some((pattern) => pattern.test(entry)))) {
    issues.push("Missing a runnable entrypoint such as main.py, app/main.py, or src/main.*.");
  }
  if (!combinedPaths.some((entry) => REPO_TEST_PATTERNS.some((pattern) => pattern.test(entry)))) {
    issues.push("Missing tests.");
  }

  const placeholderPaths = normalized
    .filter(
      (entry) =>
        entry.path !== ".gitignore" &&
        PLACEHOLDER_ARTIFACT_PATTERN.test(entry.content)
    )
    .map((entry) => entry.path);
  if (placeholderPaths.length) {
    issues.push(
      `Placeholder or stub markers detected in ${placeholderPaths.slice(0, 5).join(", ")}.`
    );
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function normalizeRepoPath(filePath) {
  return String(filePath || "")
    .trim()
    .replace(/^\.?\//, "")
    .toLowerCase();
}

function extractPseudoToolCallsFromAssistantContent(toolCalls, assistantContent, toolDefinitions) {
  if (Array.isArray(toolCalls) && toolCalls.length) {
    return toolCalls;
  }
  const allowedToolNames = new Set(
    (Array.isArray(toolDefinitions) ? toolDefinitions : [])
      .map((tool) => tool && tool.function && tool.function.name)
      .filter(Boolean)
  );
  if (!allowedToolNames.size) {
    return [];
  }
  const content = String(assistantContent || "");
  if (!content.includes("<tool_call>")) {
    return [];
  }
  const matches = content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi);
  const recovered = [];
  for (const match of matches) {
    const parsed = safeJsonParse(match && match[1] ? match[1] : "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name || !allowedToolNames.has(name)) {
      continue;
    }
    const args =
      typeof parsed.arguments === "string"
        ? safeJsonParse(parsed.arguments) || {}
        : parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)
          ? parsed.arguments
          : {};
    recovered.push(createSyntheticToolCall(name, args));
  }
  return recovered;
}

function createSyntheticToolCall(name, argumentsObject) {
  return {
    id: makeId("toolcall"),
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(argumentsObject)
    }
  };
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
        details: parsed.diff
          ? limitText(parsed.diff, 4000)
          : parsed.backupPath
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

function emitRunEvent(onRunEvent, event) {
  if (!onRunEvent) {
    return;
  }
  onRunEvent({
    id: makeId("event"),
    createdAt: Date.now(),
    ...event
  });
}

function emitCheckpoint(onRunCheckpoint, checkpoint) {
  if (!onRunCheckpoint) {
    return;
  }
  onRunCheckpoint({
    id: makeId("checkpoint"),
    createdAt: Date.now(),
    ...checkpoint
  });
}

module.exports = {
  runConversation,
  buildWorkspaceSystemPrompt,
  buildDeterministicBootstrapManifest,
  evaluateRepoMaterializationManifest,
  evaluatePhaseMaterializationManifest,
  findMissingPhaseWriteRequirements,
  parseScaffoldExecutionPlan,
  normalizeScaffoldExecutionPlan,
  scaffoldPhaseOwnsPath,
  stabilizeBootstrapManifest,
  extractPseudoToolCallsFromAssistantContent,
  isPhaseContractStallStep,
  isPhaseWorkspaceContractSatisfied,
  shouldAttemptBootstrapMaterializationRecovery,
  shouldAttemptBootstrapMissingRequirementsRecovery,
  shouldAttemptPhaseContractRecovery
};
