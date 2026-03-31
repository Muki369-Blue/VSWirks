// @domain: media — Image generation, TTS, and file attachments mixin
// Applied to the controller prototype in controller.cjs

const cp = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { fetchRuntimeJson } = require("../../../shared/runtime-client");
const { DEFAULT_RUNTIME_BASE_URL } = require("../../../shared/core/defaults");
const { isImagePath, createImageAttachment } = require("../image-tools.cjs");
const { synthesize: ttssynthesize } = require("../tts-engine.cjs");

module.exports = {
  async generateImage({ prompt, width = 512, height = 512 } = {}) {
    if (!prompt) return { ok: false, error: "No prompt provided" };
    const project = this.getActiveProject();
    const outputDir = project && project.workspaceRoot
      ? path.join(project.workspaceRoot, ".vswirks", "generated")
      : path.join(os.tmpdir(), "vswirks-generated");
    await fs.mkdir(outputDir, { recursive: true }).catch(() => {});
    const outputFile = path.join(outputDir, `img-${Date.now()}.png`);

    const baseUrl = this.settings.runtimeBaseUrl || DEFAULT_RUNTIME_BASE_URL;
    try {
      const result = await fetchRuntimeJson(baseUrl, "/images/generations", {
        model: "stable-diffusion",
        prompt,
        size: `${width}x${height}`,
        n: 1,
        response_format: "b64_json"
      });
      if (result && result.data && result.data[0] && result.data[0].b64_json) {
        await fs.writeFile(outputFile, Buffer.from(result.data[0].b64_json, "base64"));
        return { ok: true, path: outputFile };
      }
    } catch { /* fall through to CLI */ }

    try {
      cp.execSync(
        `python -m mlx_stable_diffusion.generate --prompt ${JSON.stringify(prompt)} --output ${JSON.stringify(outputFile)} --width ${width} --height ${height}`,
        { encoding: "utf-8", timeout: 120000 }
      );
      return { ok: true, path: outputFile };
    } catch (error) {
      return { ok: false, error: `Image generation failed: ${error.message}` };
    }
  },

  async synthesizeSpeech({ text, voice } = {}) {
    if (!text) return { ok: false, error: "No text provided" };
    try {
      const result = await ttssynthesize(text, voice || "af_heart");
      return { ok: true, wavPath: result.wavPath, sampleRate: result.sampleRate, durationMs: result.durationMs };
    } catch (error) {
      return { ok: false, error: `TTS failed: ${error.message}` };
    }
  }
};
