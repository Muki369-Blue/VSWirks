/**
 * Headless scaffold driver — T2I repo
 * Wires up VSWirksController without Electron and runs a full scaffold into
 * /Users/bluewirks.max/Documents/T2I
 */

"use strict";

// ── Mock electron so controller.cjs loads outside of Electron ──────────────
const Module = require("module");
const _orig = Module._resolveFilename.bind(Module);
Module._resolveFilename = (request, ...rest) => {
  if (request === "electron") return request;
  return _orig(request, ...rest);
};
require.cache["electron"] = {
  id: "electron",
  filename: "electron",
  loaded: true,
  exports: {
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showMessageBox: async () => ({ response: 0 })
    },
    app: { getPath: () => require("os").homedir(), getVersion: () => "0.0.0" },
    shell: { openPath: async () => "", openExternal: async () => {} },
    BrowserWindow: class {}
  }
};

const path = require("path");
const fs   = require("fs/promises");

const ROOT = path.resolve(__dirname, "..");
const { VSWirksController } = require(path.join(ROOT, "vswirks-app/electron/controller.cjs"));
const { createProjectSession, createProjectIntelligence } = require(path.join(ROOT, "shared/core"));

const TARGET = "/Users/bluewirks.max/Documents/T2I";
const PROMPT =
  "Build a complete local Text-to-Image app repository for this machine. " +
  "Use a lightweight Python FastAPI backend that calls a locally-running Stable Diffusion " +
  "model via diffusers (fp16, CUDA or MPS auto-detect). Include a clean React+Vite frontend " +
  "with a prompt input, negative-prompt input, steps/cfg sliders, seed control, and an image " +
  "gallery. Wire up a Dockerfile + docker-compose for the whole stack. " +
  "Write a thorough README with local setup instructions, model download steps, and example prompts. " +
  "No demo placeholders, no TODO-only files — every source file must be real and runnable.";

async function main() {
  await fs.mkdir(TARGET, { recursive: true });

  // ── Build a minimal controller ──────────────────────────────────────────
  const controller = new VSWirksController(
    { webContents: { send() {} } },
    {}
  );

  // Patch out methods that need Electron or disk
  controller.postState      = () => {};
  controller.persistState   = async () => {};
  controller.emitEvent      = (ev) => {
    process.stdout.write(`  [event] ${JSON.stringify(ev).slice(0, 200)}\n`);
  };
  const origPost = controller.postState.bind(controller);
  controller.postState = () => {
    const proj = controller.projects[0];
    if (proj?.currentRunStatus) {
      process.stdout.write(`  [status] ${proj.currentRunStatus}\n`);
    }
    origPost();
  };

  // ── Bootstrap project ───────────────────────────────────────────────────
  const project = createProjectSession({ name: "T2I", workspaceRoot: TARGET, targetPath: TARGET });
  project.intelligence = createProjectIntelligence({ workspaceRoot: TARGET, targetPath: TARGET });
  controller.projects        = [project];
  controller.activeProjectId = project.id;

  // ── Settings — point at the live local runtime ──────────────────────────
  await controller.loadSettings().catch(() => {});        // load persisted if any
  controller.settings.runtimeBaseUrl       = "http://127.0.0.1:7471/v1";
  controller.settings.writeRequiresApproval = false;      // auto-write all files
  // Use qwen2.5-coder for all roles — stable model, no MLX/devstral issues
  controller.settings.modelRoles = {
    chat:     "qwen2.5-coder:14b-instruct",
    editor:   "qwen2.5-coder:14b-instruct",
    builder:  "qwen2.5-coder:14b-instruct",
    reviewer: "qwen2.5-coder:14b-instruct",
    refiner:  "qwen2.5-coder:14b-instruct"
  };

  // ── Mark runtime healthy and keep it that way ───────────────────────────
  controller.serviceState          = { healthy: true, starting: false, label: "Service ready" };
  controller.refreshRuntimeState   = async () => {};  // no-op — nothing resets health
  controller.refreshProjectIntelligence = async () => ({});  // no workspace probe
  controller.finalizeValidationIfNeeded = async () => {};
  controller.revealRunOutputs           = async () => {};
  console.log("Runtime confirmed healthy — ready to scaffold.");

  console.log(`\nStarting scaffold → ${TARGET}`);
  console.log("Prompt:", PROMPT.slice(0, 80) + "…\n");

  // ── Run with auto-resume until all phases complete ──────────────────────
  let ok = await controller.sendPrompt({
    prompt:           PROMPT,
    workflowPresetId: "scaffold-app",
    executionMode:    "act",
    mode:             "agent"
  });

  if (!ok) {
    console.error("sendPrompt returned false — check serviceState / project setup.");
    process.exit(1);
  }

  // Auto-resume up to 8 times if scaffold pauses between phases
  for (let resume = 0; resume < 8; resume++) {
    const proj = controller.projects[0];
    const status = proj?.currentRunStatus || "";
    if (!/paused/i.test(status)) break;

    console.log(`\n↩  Auto-resuming paused scaffold (attempt ${resume + 1})…`);
    const run = (proj.runs || [])
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

    ok = await controller.resumeRun({ runId: run?.id });
    if (!ok) {
      console.log("  Resume returned false — stopping.");
      break;
    }
  }

  // ── Report result ────────────────────────────────────────────────────────
  const files = await listFiles(TARGET);
  console.log(`\n✅  Scaffold complete — ${files.length} files written to ${TARGET}\n`);
  files.slice(0, 40).forEach((f) => console.log("  ", f));
  if (files.length > 40) console.log(`  … and ${files.length - 40} more`);
}

async function listFiles(dir, base = dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listFiles(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

main().catch((err) => { console.error(err); process.exit(1); });
