const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onClientConnected: (cb) => ipcRenderer.on('client-connected', (ev, data) => cb(data)),
  onClientDisconnected: (cb) => ipcRenderer.on('client-disconnected', (ev, data) => cb(data)),
  onClientMessage: (cb) => ipcRenderer.on('client-message', (ev, data) => cb(data)),
  sendToClient: (id, payload) => ipcRenderer.invoke('send-to-client', { id, payload }),
  broadcast: (payload) => ipcRenderer.invoke('broadcast', payload)
});

// Expose a small DESKTOP_ENV flag used by config.js to detect Electron vs file://
contextBridge.exposeInMainWorld('DESKTOP_ENV', { isElectron: true });

// Provide a lightweight compatibility 'api' surface that matches the shim's expectations.
// Some methods are thin wrappers around the existing electronAPI; connect/disconnect are no-ops
// (the main process already manages its server) but return a resolved promise for compatibility.
contextBridge.exposeInMainWorld('api', {
  connect: async (opts) => {
    // no-op: main process currently runs a server facade; return success for compatibility
    return { ok: true };
  },
  disconnect: async () => {
    return { ok: true };
  },
  send: (payload) => {
    // Broadcast outgoing payloads to all connected clients by default
    return ipcRenderer.invoke('broadcast', payload);
  },
  onMessage: (cb) => {
    ipcRenderer.on('client-message', (ev, data) => cb(data));
  },
  onState: (cb) => {
    // Optional: main process could emit ws-state updates; keep a compatibility hook
    ipcRenderer.on('ws-state', (ev, data) => cb(data));
  }
});
