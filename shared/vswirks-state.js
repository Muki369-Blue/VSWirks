const fs = require("fs/promises");
const os = require("os");
const path = require("path");

function resolveVSWirksHome() {
  return path.join(os.homedir(), "Library", "Application Support", "VSWirks");
}

function resolveVSWirksStateDir() {
  return path.join(resolveVSWirksHome(), "state");
}

function resolveBridgeStatePath() {
  return path.join(resolveVSWirksStateDir(), "bridge-state.json");
}

function resolveAppStatePath() {
  return path.join(resolveVSWirksStateDir(), "app-state.json");
}

function resolveSettingsPath() {
  return path.join(resolveVSWirksStateDir(), "settings.json");
}

async function ensureVSWirksDirs() {
  await fs.mkdir(resolveVSWirksStateDir(), { recursive: true });
}

async function readJson(filePath, fallbackValue) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function writeJson(filePath, value) {
  await ensureVSWirksDirs();
  const data = JSON.stringify(value, null, 2);
  const tmpPath = filePath + ".tmp." + Date.now();
  await fs.writeFile(tmpPath, data, "utf-8");
  await fs.rename(tmpPath, filePath);
}

async function readBridgeState() {
  return readJson(resolveBridgeStatePath(), {});
}

async function writeBridgeState(value) {
  return writeJson(resolveBridgeStatePath(), value);
}

async function updateBridgeState(patch) {
  const current = await readBridgeState();
  const next = {
    ...current,
    ...patch
  };
  await writeBridgeState(next);
  return next;
}

async function readAppState() {
  return readJson(resolveAppStatePath(), null);
}

async function writeAppState(value) {
  return writeJson(resolveAppStatePath(), value);
}

async function readSettings() {
  return readJson(resolveSettingsPath(), {});
}

async function writeSettings(value) {
  return writeJson(resolveSettingsPath(), value);
}

module.exports = {
  resolveVSWirksHome,
  resolveVSWirksStateDir,
  resolveBridgeStatePath,
  resolveAppStatePath,
  resolveSettingsPath,
  ensureVSWirksDirs,
  readJson,
  writeJson,
  readBridgeState,
  writeBridgeState,
  updateBridgeState,
  readAppState,
  writeAppState,
  readSettings,
  writeSettings
};
