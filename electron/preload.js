// NOTE: This JavaScript file is a generated copy of `preload.ts`.
// Prefer editing `preload.ts` and running `npm run build` instead of modifying this file.

const { contextBridge } = require('electron');

// Expose a tiny safe API to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  electronVersion: process.versions.electron
});