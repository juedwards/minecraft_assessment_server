// TypeScript development entry point (copies logic from main.js)
import { app, BrowserWindow } from 'electron';
import path from 'path';

import { startWebServer } from './server/ws_web';
import { startMinecraftServer } from './server/ws_minecraft';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const indexPath = path.resolve(__dirname, 'static', 'index.html');
  win.loadFile(indexPath);

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Start local websocket servers for Minecraft and the renderer
try {
  // Coerce environment variables to numbers if present
  const wsPort = Number(process.env.WS_PORT) || 8081;
  const mcPort = Number(process.env.MINECRAFT_PORT) || 19131;
  startWebServer(wsPort);
  startMinecraftServer(mcPort);
} catch (err) {
  console.error('Failed to start local websocket servers', err);
}
