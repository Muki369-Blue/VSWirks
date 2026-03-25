"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs/promises");

// Kokoro TTS engine — lazy-loaded, cached, runs on CPU via ONNX
// 82M parameter model, downloads ~80MB on first use from HuggingFace

const VOICE_MAP = {
  "af_heart": "af_heart",     // Zola — warm, confident
  "af_bella": "af_bella",     // Mei — clear, precise
  "bf_emma": "bf_emma",       // Claire — friendly, expressive
  "af_nicole": "af_nicole",   // Priya — articulate, composed
  "am_michael": "am_michael", // Marcus — deep, steady
  "am_puck": "am_puck"        // James — energetic, clear
};

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MODEL_OPTIONS = { dtype: "q8", device: "cpu" };

let ttsInstance = null;
let loadingPromise = null;

async function getModel() {
  if (ttsInstance) return ttsInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { KokoroTTS } = await import("kokoro-js");
    ttsInstance = await KokoroTTS.from_pretrained(MODEL_ID, MODEL_OPTIONS);
    loadingPromise = null;
    return ttsInstance;
  })();

  return loadingPromise;
}

/**
 * Synthesize speech and save to a WAV file.
 * Returns the file path — much faster than sending raw samples over IPC.
 * @param {string} text - Text to speak (max ~3000 chars)
 * @param {string} voiceId - Kokoro voice ID (e.g. "af_heart")
 * @returns {{ wavPath: string, sampleRate: number, durationMs: number }}
 */
async function synthesize(text, voiceId) {
  const tts = await getModel();
  const voice = VOICE_MAP[voiceId] || "af_heart";
  const trimmed = text.slice(0, 3000);

  const audio = await tts.generate(trimmed, { voice });

  // audio.audio is Float32Array, audio.sampling_rate is 24000
  const wavDir = path.join(os.tmpdir(), "vswirks-tts");
  await fs.mkdir(wavDir, { recursive: true }).catch(() => {});
  const wavPath = path.join(wavDir, `tts-${Date.now()}.wav`);

  // Use kokoro's built-in save method (writes proper WAV)
  audio.save(wavPath);

  const durationMs = Math.round((audio.audio.length / audio.sampling_rate) * 1000);
  return { wavPath, sampleRate: audio.sampling_rate, durationMs };
}

function isLoaded() {
  return ttsInstance !== null;
}

function listVoices() {
  return Object.keys(VOICE_MAP);
}

module.exports = { synthesize, isLoaded, listVoices, VOICE_MAP };
