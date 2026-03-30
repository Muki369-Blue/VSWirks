const {
  DEFAULT_EXECUTION_MODE,
  MAX_TOOL_DETAIL_CHARS,
  DEFAULT_GENERATION_SETTINGS
} = require("./defaults");

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
  normalizeGenerationSettings,
  getGenerationOptions,
  looksLikeRepoCreationRequest
};
