import { contextBridge } from 'electron';

// Expose a tiny, typed safe API to the renderer
declare global {
  interface Window {
    electronAPI: {
      electronVersion: string;
    };
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  electronVersion: process.versions.electron,
});