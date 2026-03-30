const os = require("os");
const path = require("path");

const APP_STATE_VERSION = 3;
const MAX_STORED_THREADS = 20;
const MAX_STORED_PROJECTS = 12;
const MAX_STORED_SPECS = 16;
const MAX_STORED_RUNS = 40;
const MAX_RUN_EVENTS = 240;
const MAX_RUN_CHECKPOINTS = 80;
const MAX_TOOL_DETAIL_CHARS = 2200;
const MAX_API_MESSAGES = 120;
const DEFAULT_MODEL = "qwen2.5-coder:14b-instruct";
const DEFAULT_EXECUTION_MODE = "plan";
const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:7471/v1";
const DEFAULT_RUNTIME_CWD = path.join(os.homedir(), "dev", "ai-runtime");
const DEFAULT_RUNTIME_PYTHON = (() => {
  const candidates = [
    path.join(os.homedir(), "dev", "ai-app", ".venv", "bin", "python"),
    path.join(os.homedir(), ".venv", "bin", "python"),
    "/usr/local/bin/python3",
    "/usr/bin/python3"
  ];
  const _fs = require("fs");
  for (const c of candidates) {
    try { if (_fs.existsSync(c)) return c; } catch {}
  }
  return "python3";
})();
const WORKSPACE_INSTRUCTIONS_PATH = path.join(".github", "copilot-instructions.md");
const DEFAULT_SYSTEM_PROMPT =
  "You are a local-first coding assistant. Be concise, practical, and safe. " +
  "Use workspace context when you need it. When writing files, write complete file contents. " +
  "When the user asks to create a new app or repository, produce production-ready output rather than demo placeholders. " +
  "If you cannot complete the real implementation without placeholder logic, stop and say what is missing instead of inventing a demo.";
const DEFAULT_GENERATION_SETTINGS = Object.freeze({
  chatTemperature: 0.2,
  chatTopP: 0.9,
  chatMaxTokens: 4096,
  agentTemperature: 0.1,
  agentTopP: 0.85,
  agentMaxTokens: 4096
});
const AGENT_ROLE_VALUES = new Set(["chat", "builder", "reviewer", "refiner", "editor"]);

module.exports = {
  APP_STATE_VERSION,
  MAX_STORED_THREADS,
  MAX_STORED_PROJECTS,
  MAX_STORED_SPECS,
  MAX_STORED_RUNS,
  MAX_RUN_EVENTS,
  MAX_RUN_CHECKPOINTS,
  MAX_TOOL_DETAIL_CHARS,
  MAX_API_MESSAGES,
  DEFAULT_MODEL,
  DEFAULT_EXECUTION_MODE,
  DEFAULT_RUNTIME_BASE_URL,
  DEFAULT_RUNTIME_CWD,
  DEFAULT_RUNTIME_PYTHON,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_GENERATION_SETTINGS,
  WORKSPACE_INSTRUCTIONS_PATH,
  AGENT_ROLE_VALUES
};
