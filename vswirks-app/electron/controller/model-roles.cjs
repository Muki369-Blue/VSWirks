// Pure helper functions for model role normalization.
// Extracted from controller.cjs to break the circular dependency
// between settings-mixin.cjs → controller.cjs.

"use strict";

const { DEFAULT_MODEL } = require("../../../shared/core/defaults");

const AUTO_MODEL_VALUE = "__auto__";
const LEGACY_CODER_MODEL = "mlx/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit";
const DEFAULT_CODER_MODEL = "devstral-small-2";
const DEFAULT_CHAT_MODEL = "llama3.3-8b-thinking:q6";

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
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized === AUTO_MODEL_VALUE) return "";
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
  if (request.purpose === "refiner") return "refiner";
  if (request.purpose === "builder") return "builder";

  const text = String(request.prompt || "").toLowerCase();
  const executionMode = request.executionMode === "act" ? "act" : "plan";
  if (/(review|audit|regression|bug scan|code review|security review|risk review)/.test(text)) {
    return "reviewer";
  }
  if (request.mode === "agent" && executionMode === "act") return "editor";
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

module.exports = {
  AUTO_MODEL_VALUE,
  LEGACY_CODER_MODEL,
  DEFAULT_CODER_MODEL,
  DEFAULT_CHAT_MODEL,
  createDefaultModelRoles,
  migrateLegacyRoutingModel,
  migrateLegacyEditorModel,
  normalizeModelRoles,
  resolveRequestedModel,
  resolveModelForTask,
  resolveModelRole
};
