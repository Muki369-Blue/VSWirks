// @domain: model — Ollama + Model Lab mixin for VSWirksController
// Applied to the controller prototype in controller.cjs

const cp = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { fetchRuntimeJson } = require("../../../shared/runtime-client");
const { DEFAULT_RUNTIME_BASE_URL } = require("../../../shared/core/defaults");

const DEFAULT_ABLITERATOR_DIR = path.join(os.homedir(), "Documents", "abliterator-main");

/**
 * Validate a file-system path for use in Python code strings.
 * Rejects paths containing characters that could break out of Python string literals.
 */
function assertSafePath(p, label) {
  if (typeof p !== "string" || !p.trim()) {
    throw new Error(`${label} is required`);
  }
  // Reject characters that could escape Python string context
  if (/["'\\`$\n\r\0]/.test(p)) {
    throw new Error(`${label} contains unsafe characters`);
  }
  // Must be an absolute path
  if (!path.isAbsolute(p)) {
    throw new Error(`${label} must be an absolute path`);
  }
}

module.exports = {
  DEFAULT_ABLITERATOR_DIR,

  async listOllamaModels() {
    try {
      const result = cp.execSync("ollama list", { encoding: "utf-8", timeout: 10000 });
      const lines = result.trim().split("\n").slice(1);
      return lines.map((line) => {
        const parts = line.split(/\s{2,}/);
        return {
          name: parts[0] || "",
          id: parts[1] || "",
          size: parts[2] || "",
          modified: parts[3] || ""
        };
      }).filter((m) => m.name);
    } catch {
      return [];
    }
  },

  async pullOllamaModel({ name } = {}) {
    if (!name) return { ok: false, error: "No model name provided" };
    try {
      cp.execFileSync("ollama", ["pull", name], { encoding: "utf-8", timeout: 600000 });
      await this.refreshRuntimeState(true);
      this.postState();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  async deleteOllamaModel({ name } = {}) {
    if (!name) return { ok: false, error: "No model name provided" };
    try {
      cp.execFileSync("ollama", ["rm", name], { encoding: "utf-8", timeout: 30000 });
      await this.refreshRuntimeState(true);
      this.postState();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  async compareModels({ prompt, modelA, modelB } = {}) {
    if (!prompt || !modelA || !modelB) {
      return { ok: false, error: "Missing prompt, modelA, or modelB" };
    }
    const baseUrl = this.settings.runtimeBaseUrl || DEFAULT_RUNTIME_BASE_URL;
    const body = (model) => ({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.7
    });
    const [resultA, resultB] = await Promise.allSettled([
      fetchRuntimeJson(baseUrl, "/chat/completions", body(modelA)),
      fetchRuntimeJson(baseUrl, "/chat/completions", body(modelB))
    ]);
    const extract = (r) => {
      if (r.status === "rejected") return { error: r.reason.message };
      const choice = r.value && r.value.choices && r.value.choices[0];
      return { content: choice && choice.message ? choice.message.content : "" };
    };
    return {
      ok: true,
      modelA: { name: modelA, ...extract(resultA) },
      modelB: { name: modelB, ...extract(resultB) }
    };
  },

  async listLocalModels() {
    const models = [];
    try {
      const ollamaList = await this.listOllamaModels();
      ollamaList.forEach(m => models.push({ ...m, source: "ollama", abliterated: false }));
    } catch {}
    const ablDir = path.join(os.homedir(), ".abliterate", "abliterated_models");
    try {
      const entries = await fs.readdir(ablDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          models.push({ name: entry.name, source: "abliterated", abliterated: true, path: path.join(ablDir, entry.name) });
        }
      }
    } catch {}
    const hfDir = path.join(os.homedir(), ".cache", "huggingface", "hub");
    try {
      const entries = await fs.readdir(hfDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("models--")) {
          const modelName = entry.name.replace("models--", "").replace(/--/g, "/");
          models.push({ name: modelName, source: "huggingface", abliterated: false, path: path.join(hfDir, entry.name) });
        }
      }
    } catch {}
    return { ok: true, models };
  },

  async listAbliteratedModels() {
    const models = [];
    const ablDir = path.join(os.homedir(), ".abliterate", "abliterated_models");
    try {
      const entries = await fs.readdir(ablDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          let meta = {};
          try {
            const raw = await fs.readFile(path.join(ablDir, entry.name, "abliteration_meta.json"), "utf-8");
            meta = JSON.parse(raw);
          } catch {}
          models.push({ name: entry.name, path: path.join(ablDir, entry.name), meta });
        }
      }
    } catch {}
    return { ok: true, models };
  },

  async getAbliterateConfigs() {
    const configDir = path.join(os.homedir(), ".abliterate", "job_configs");
    try {
      const entries = await fs.readdir(configDir);
      const configs = [];
      for (const entry of entries) {
        if (entry.endsWith(".json")) {
          try {
            const raw = await fs.readFile(path.join(configDir, entry), "utf-8");
            configs.push({ name: entry.replace(".json", ""), config: JSON.parse(raw) });
          } catch {}
        }
      }
      return { ok: true, configs };
    } catch {
      return { ok: true, configs: [] };
    }
  },

  async saveAbliterateConfig({ name, config } = {}) {
    if (!name || !config) return { ok: false, error: "Missing name or config" };
    const configDir = path.join(os.homedir(), ".abliterate", "job_configs");
    await fs.mkdir(configDir, { recursive: true }).catch(() => {});
    await fs.writeFile(path.join(configDir, `${name}.json`), JSON.stringify(config, null, 2), "utf-8");
    return { ok: true };
  },

  async abliterateModel({ modelPath, config = {} } = {}) {
    if (!modelPath) return { ok: false, error: "No model path provided" };
    try { assertSafePath(modelPath, "modelPath"); } catch (e) { return { ok: false, error: e.message }; }
    const abliteratorDir = (this.settings && this.settings.abliteratorDir) || DEFAULT_ABLITERATOR_DIR;
    try { assertSafePath(abliteratorDir, "abliteratorDir"); } catch (e) { return { ok: false, error: e.message }; }
    const outputDir = path.join(os.homedir(), ".abliterate", "abliterated_models", path.basename(modelPath) + "-abliterated");
    await fs.mkdir(outputDir, { recursive: true }).catch(() => {});

    const pythonCandidates = [
      path.join(abliteratorDir, ".venv", "bin", "python"),
      path.join(os.homedir(), "dev", "ai-app", ".venv", "bin", "python"),
      "python3"
    ];
    let pythonBin = "python3";
    const fsSync = require("fs");
    for (const c of pythonCandidates) {
      if (fsSync.existsSync(c)) { pythonBin = c; break; }
    }

    const configJson = JSON.stringify({
      model_path: modelPath,
      output_path: outputDir,
      num_prompts: config.numPrompts || 30,
      direction_multiplier: config.directionMultiplier || 1.0,
      use_null_space: config.useNullSpace || false,
      use_winsorization: config.useWinsorization || true,
      adaptive_layer_weighting: config.adaptiveLayerWeighting || true,
      ...config
    });

    const configFile = path.join(os.tmpdir(), `abliterate-config-${Date.now()}.json`);
    await fs.writeFile(configFile, configJson, "utf-8");

    this._abliterateProcess = cp.spawn(pythonBin, [
      "-c",
      `import json, sys; sys.path.insert(0, ${JSON.stringify(abliteratorDir)}); from src.abliterate import run_abliteration, AbliterationConfig; config = AbliterationConfig(**json.load(open(${JSON.stringify(configFile)}))); run_abliteration(config); print("ABLITERATION_COMPLETE")`
    ], {
      cwd: abliteratorDir,
      env: { ...process.env, PYTHONPATH: abliteratorDir }
    });

    let output = "";
    this._abliterateProcess.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.includes("layer") || line.includes("Layer") || line.includes("%")) {
          this.emitEvent({ type: "abliterate-progress", label: line.trim() });
        }
      }
    });
    this._abliterateProcess.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.includes("layer") || text.includes("%")) {
        this.emitEvent({ type: "abliterate-progress", label: text.trim() });
      }
    });

    return new Promise((resolve) => {
      this._abliterateProcess.on("close", async (code) => {
        this._abliterateProcess = null;
        await fs.unlink(configFile).catch(() => {});
        if (code === 0) {
          await fs.writeFile(path.join(outputDir, "abliteration_meta.json"), JSON.stringify({
            sourceModel: modelPath,
            config,
            completedAt: new Date().toISOString()
          }, null, 2), "utf-8").catch(() => {});
          resolve({ ok: true, outputPath: outputDir });
        } else {
          resolve({ ok: false, error: `Abliteration exited with code ${code}` });
        }
      });
    });
  },

  abliterateCancel() {
    if (this._abliterateProcess) {
      this._abliterateProcess.kill("SIGTERM");
      this._abliterateProcess = null;
      return { ok: true };
    }
    return { ok: false, error: "No abliteration in progress" };
  },

  async evaluateRefusal({ modelPath } = {}) {
    if (!modelPath) return { ok: false, error: "No model path" };
    try { assertSafePath(modelPath, "modelPath"); } catch (e) { return { ok: false, error: e.message }; }
    const abliteratorDir = (this.settings && this.settings.abliteratorDir) || DEFAULT_ABLITERATOR_DIR;
    try { assertSafePath(abliteratorDir, "abliteratorDir"); } catch (e) { return { ok: false, error: e.message }; }
    const pythonBin = path.join(abliteratorDir, ".venv", "bin", "python");
    try {
      const output = cp.execFileSync(pythonBin, [
        "-c",
        `import json, sys; sys.path.insert(0, "${abliteratorDir}"); from utils.refusal_eval import RefusalScanner; from src.model_utils import load_model_and_tokenizer; model, tok = load_model_and_tokenizer("${modelPath}"); scanner = RefusalScanner(model, tok); results = scanner.quick_scan(); print(json.dumps(results))`
      ], { encoding: "utf-8", timeout: 300000, cwd: abliteratorDir, env: { ...process.env, PYTHONPATH: abliteratorDir } });
      const result = JSON.parse(output.trim().split("\n").pop());
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  async exportToGguf({ modelPath, quantType = "Q4_K_M" } = {}) {
    if (!modelPath) return { ok: false, error: "No model path" };
    try { assertSafePath(modelPath, "modelPath"); } catch (e) { return { ok: false, error: e.message }; }
    if (typeof quantType !== "string" || !/^[A-Za-z0-9_]+$/.test(quantType)) {
      return { ok: false, error: "Invalid quantization type" };
    }
    const abliteratorDir = (this.settings && this.settings.abliteratorDir) || DEFAULT_ABLITERATOR_DIR;
    try { assertSafePath(abliteratorDir, "abliteratorDir"); } catch (e) { return { ok: false, error: e.message }; }
    const outputDir = path.join(os.homedir(), ".abliterate", "gguf_exports");
    await fs.mkdir(outputDir, { recursive: true }).catch(() => {});
    const pythonBin = path.join(abliteratorDir, ".venv", "bin", "python");
    try {
      const output = cp.execFileSync(pythonBin, [
        "-c",
        `import json, sys; sys.path.insert(0, "${abliteratorDir}"); from src.gguf_export import export_to_gguf, GGUFExportConfig; from pathlib import Path; config = GGUFExportConfig(model_path=Path("${modelPath}"), output_dir=Path("${outputDir}"), quant_type="${quantType}"); result = export_to_gguf(config); print(json.dumps({"output": str(result)}))`
      ], { encoding: "utf-8", timeout: 600000, cwd: abliteratorDir, env: { ...process.env, PYTHONPATH: abliteratorDir } });
      return { ok: true, output: output.trim() };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  async importToOllama({ ggufPath, modelName } = {}) {
    if (!ggufPath || !modelName) return { ok: false, error: "Missing ggufPath or modelName" };
    try { assertSafePath(ggufPath, "ggufPath"); } catch (e) { return { ok: false, error: e.message }; }
    if (typeof modelName !== "string" || !/^[a-zA-Z0-9._:/-]+$/.test(modelName)) {
      return { ok: false, error: "Invalid model name" };
    }
    const modelfile = `FROM ${ggufPath}\nPARAMETER temperature 0.7\nPARAMETER num_ctx 4096`;
    const modelfilePath = path.join(os.tmpdir(), `ollama-modelfile-${Date.now()}`);
    await fs.writeFile(modelfilePath, modelfile, "utf-8");
    try {
      cp.execFileSync("ollama", ["create", modelName, "-f", modelfilePath], { encoding: "utf-8", timeout: 300000 });
      await fs.unlink(modelfilePath).catch(() => {});
      await this.refreshRuntimeState(true);
      this.postState();
      return { ok: true };
    } catch (error) {
      await fs.unlink(modelfilePath).catch(() => {});
      return { ok: false, error: error.message };
    }
  }
};
