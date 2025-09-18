// NOTE: This JavaScript file is a generated or legacy copy of the TypeScript source.
// Edit `main.ts` in this folder and run `npm run build` rather than modifying this file.

const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load the local static/index.html that will be copied into this folder on install
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
  const { startWebServer } = require('./server/ws_web');
  const { startMinecraftServer } = require('./server/ws_minecraft');
  startWebServer(process.env.WS_PORT || 8081);
  startMinecraftServer(process.env.MINECRAFT_PORT || 19131);
} catch (err) {
  console.error('Failed to start local websocket servers', err);
}