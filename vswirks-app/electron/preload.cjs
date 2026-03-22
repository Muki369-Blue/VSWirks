const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vswirks", {
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
  },
  onState(listener) {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("vswirks:state", handler);
    return () => ipcRenderer.removeListener("vswirks:state", handler);
  },
  onEvent(listener) {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("vswirks:event", handler);
    return () => ipcRenderer.removeListener("vswirks:event", handler);
  }
});
