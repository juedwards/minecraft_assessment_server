const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const WebSocket = require('ws');

let win;
let wss;
const clients = new Map(); // id -> ws

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  // Load the migrated static UI inside the packaged jsalltheway/static folder
  win.loadFile(path.join(__dirname, 'static', 'index.html'));
  // Diagnostic probe: execute a small script in the renderer after load to report DOM and asset status
  win.webContents.on('did-finish-load', async () => {
    try {
      const diag = await win.webContents.executeJavaScript(`(function(){
        try {
          return {
            title: document.title,
            leftPanel: !!document.querySelector('.left-panel'),
            leftPanelWidth: (window.getComputedStyle(document.querySelector('.left-panel')||document.body).width),
            eventLog: !!document.getElementById('eventLog'),
            canvasCount: document.querySelectorAll('canvas').length,
            cssPresent: !!document.querySelector('link[href="app.css"]'),
            moduleScript: !!document.querySelector('script[type="module"][src="modules/main.js"]')
          };
        } catch (e) { return { error: String(e) }; }
      })()`);
      console.log('RENDERER DIAGNOSTICS -->', diag);
    } catch (e) { console.error('diagnostics probe failed', e); }
  });
  if (process.env.NODE_ENV === 'development') win.webContents.openDevTools({ mode: 'undocked' });
}

// Start the server facade (single WebSocket connection exposed to Minecraft clients)
let serverFacade;
try {
  serverFacade = require('./server');
} catch (err) {
  try {
    // If a sibling server module exists at repo root, use it
    serverFacade = require('../server');
  } catch (err2) {
    // No server module available in this environment; provide a no-op EventEmitter
    const { EventEmitter } = require('events');
    serverFacade = new EventEmitter();
    serverFacade.start = () => { console.warn('serverFacade: no-op start (no server module)'); };
  }
}

if (serverFacade && typeof serverFacade.on === 'function') {
  serverFacade.on('client-connected', (d) => { win && win.webContents.send('client-connected', d); });
  serverFacade.on('client-disconnected', (d) => { win && win.webContents.send('client-disconnected', d); });
  serverFacade.on('client-message', (d) => { win && win.webContents.send('client-message', d); });
}
try { serverFacade && typeof serverFacade.start === 'function' && serverFacade.start({ port: parseInt(process.env.MINECRAFT_PORT || '19131', 10) }); } catch (e) { console.warn('serverFacade.start failed or not present', e); }

ipcMain.handle('send-to-client', (evt, { id, payload }) => {
  const client = clients.get(id);
  if (!client || client.readyState !== WebSocket.OPEN) return { ok: false, error: 'client-not-open' };
  try {
    client.send(JSON.stringify(payload));
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) } }
});

ipcMain.handle('broadcast', (evt, payload) => {
  for (const [id, c] of clients.entries()) {
    try { c.send(JSON.stringify(payload)); } catch (e) { /* ignore per-client errors */ }
  }
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (wss) {
    try { wss.close(); } catch (e) {}
    wss = null;
  }
  if (process.platform !== 'darwin') app.quit();
});
