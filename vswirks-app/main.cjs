const path = require("path");
const fs = require("fs");

const { app, BrowserWindow, ipcMain } = require("electron");

// Electron's Chromium network stack corrupts chunked SSE streams from local AI runtime,
// causing "OnSizeReceived failed with Error: -2". Override fetch for localhost requests
// with a Node.js http-based implementation that handles SSE streaming correctly.
if (!globalThis._nodeFetchPatched) {
  globalThis._nodeFetchPatched = true;
  const originalFetch = globalThis.fetch;
  const http = require("http");
  const { URL } = require("url");
  const { Readable } = require("stream");

  function nodeFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(typeof url === "string" ? url : url.toString());
      const reqOptions = {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        method: options.method || (options.body ? "POST" : "GET"),
        headers: { ...(options.headers || {}) }
      };
      const req = http.request(reqOptions, (res) => {
        // Build a web-compatible Response-like object
        const bodyStream = new ReadableStream({
          start(controller) {
            res.on("data", (chunk) => controller.enqueue(chunk));
            res.on("end", () => controller.close());
            res.on("error", (e) => controller.error(e));
          }
        });
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: new Headers(
            Object.entries(res.headers).reduce((acc, [k, v]) => {
              acc[k] = Array.isArray(v) ? v.join(", ") : v;
              return acc;
            }, {})
          ),
          body: bodyStream,
          async json() {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          },
          async text() {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            return Buffer.concat(chunks).toString("utf-8");
          }
        });
      });
      req.on("error", reject);
      if (options.signal) {
        options.signal.addEventListener("abort", () => req.destroy(new Error("Aborted")));
      }
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  globalThis.fetch = function patchedFetch(url, options) {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (urlStr.includes("127.0.0.1") || urlStr.includes("localhost")) {
      return nodeFetch(url, options);
    }
    return originalFetch(url, options);
  };
}

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

app.setName("CodeBlue");

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
    title: "CodeBlue",
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Pipe renderer console to main process stdout for debugging
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
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
