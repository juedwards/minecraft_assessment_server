// LEGACY: Generated/legacy copy of the preload script. Edit `preload.ts` instead.

const { contextBridge } = require('electron');

// Expose a tiny safe API to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  electronVersion: process.versions.electron
});