const path = require("path");
const fs = require("fs");

const { app, BrowserWindow, ipcMain } = require("electron");

const { VSWirksController } = require("./controller.cjs");
const { IPC_CHANNELS } = require("./ipc-channels.cjs");

// Kokoro TTS needs voice .bin files relative to CWD.
// Ensure a voices/ symlink exists pointing to the kokoro-js package voices.
function ensureKokoroVoicesLink() {
  try {
    const kokoroVoicesDir = path.resolve(__dirname, "..", "node_modules", "kokoro-js", "voices");
    // Walk up to find node_modules (monorepo hoisting)
    let searchDir = path.resolve(__dirname, "..");
    let found = null;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(searchDir, "node_modules", "kokoro-js", "voices");
      if (fs.existsSync(candidate)) { found = candidate; break; }
      searchDir = path.dirname(searchDir);
    }
    if (!found) return;
    const linkTarget = path.join(process.cwd(), "voices");
    if (!fs.existsSync(linkTarget)) {
      fs.symlinkSync(found, linkTarget, "dir");
    }
  } catch { /* non-fatal */ }
}
ensureKokoroVoicesLink();

let mainWindow = null;
let controller = null;
const APP_ICON_PATH = path.join(__dirname, "assets", "vswirks-icon.png");

app.setName("VSWirks App");

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#11151c",
    title: "VSWirks App",
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  controller = new VSWirksController(mainWindow);
  await controller.initialize();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));
}

app.on("second-instance", async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  await createMainWindow();
});

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(APP_ICON_PATH);
  }
  registerIpc();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (controller) {
    controller.cleanup();
  }
});

function registerIpc() {
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (_event, payload) => {
      if (!controller) {
        return null;
      }
      return controller.handle(channel, payload);
    });
  }
}
