const path = require("path");

const { app, BrowserWindow, ipcMain } = require("electron");

const { VSWirksController } = require("./controller.cjs");
const { IPC_CHANNELS } = require("./ipc-channels.cjs");

let mainWindow = null;
let controller = null;

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#11151c",
    title: "VSWirks App",
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

app.whenReady().then(async () => {
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
