// Converted from ws_web.js (copy for incremental migration)

import WebSocket, { Server as WebSocketServer } from 'ws';
import state from './state';
import { analyzePlayerData } from './session';
import fs from 'fs';
import path from 'path';
import { app as electronApp } from 'electron';

let wss: WebSocketServer | null = null;

export function broadcastToWeb(payload: any): void {
  const msg = JSON.stringify(payload);
  let sent = 0;
  for (const ws of state.webClients) {
    if ((ws as any).readyState === WebSocket.OPEN) {
      try {
        (ws as any).send(msg);
        sent++;
      } catch (err) {
        console.error('Failed to send to web client', err);
      }
    }
  }
  console.log(`Broadcasted ${payload.type || 'message'} to ${sent} web clients`);
}

export function startWebServer(port: number = Number(process.env.WS_PORT) || 8081): WebSocketServer {
  if (wss) return wss;
  wss = new WebSocket.Server({ port });
  console.log(`WebSocket server for renderer listening on ws://0.0.0.0:${port}`);

  wss.on('connection', (ws: WebSocket, req) => {
    state.webClients.add(ws as any);
    console.log('Renderer connected');

    // In development mode, replay a sample session (if available) to show players/chunks
    const isDevMode = process.env.NODE_ENV === 'development' || (typeof electronApp !== 'undefined' && electronApp && !electronApp.isPackaged);
    if (isDevMode) {
      try {
        const dataDir = path.resolve(__dirname, '..', 'data');
        if (fs.existsSync(dataDir)) {
          const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort().reverse();
          if (files.length > 0) {
            const samplePath = path.join(dataDir, files[0]);
            console.info('Replaying sample session for dev from', samplePath);
            const content = fs.readFileSync(samplePath, { encoding: 'utf8' });
            const sess = JSON.parse(content);
            const events = Array.isArray(sess.events) ? sess.events : [];
            // Replay events slowly so UI can render them
            let idx = 0;
            for (const ev of events) {
              setTimeout(() => {
                try {
                  if (ev.event_type === 'player_position' && ev.data) {
                    const pd = ev.data || {};
                    const pos = pd.position || {}; // some events embed position under `position`
                    const payload = {
                      type: 'position',
                      playerId: String(pd.player_id || pd.player_name || pd.player || 'player'),
                      playerName: pd.player_name || pd.player || String(pd.player_id || ''),
                      x: pos.x != null ? pos.x : pd.x || 0,
                      y: pos.y != null ? pos.y : pd.y || 0,
                      z: pos.z != null ? pos.z : pd.z || 0
                    };
                    try { ws.send(JSON.stringify(payload)); console.info('Replayed position to renderer', payload); } catch (e) {}
                  }
                  // Add other event types mappings if useful (chunk, block_place, etc.)
                } catch (err) { console.error('replay event send failed', err); }
              }, idx * 200);
              idx += 1;
            }
            // Also send a synthetic chunk for dev so render path is exercised even without MC chunk responses
            try {
              const heights = new Array(256).fill(64);
              const pixelColor = ((0xFF << 24) >>> 0) | (0x66 << 16) | (0x99 << 8) | 0xCC; // ARGB -> 0xFF6699CC
              const pixels = new Array(256).fill(pixelColor);
              const synthetic = { type: 'chunk', dimension: 'overworld', x: 0, z: 0, y: null, pixels, heights, requestId: 'dev-synthetic-0' };
              console.info('Broadcasting synthetic chunk for dev to renderer (overworld 0,0)');
              broadcastToWeb(synthetic);
            } catch (e) { console.error('failed to broadcast synthetic chunk', e); }
          }
        }
      } catch (err) {
        console.error('dev replay failed', err);
      }
    }

    ws.on('message', async (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Handle simple messages coming from the UI; we will expand these
        if (msg && msg.type === 'ping') {
          (ws as any).send(JSON.stringify({ type: 'pong' }));
        }
        // Forward other messages to connected Minecraft clients if appropriate
        if (msg && msg.type === 'game_command') {
          const command = msg.command;
          let forwarded = 0;
          for (const mc of state.minecraftConnections) {
            if ((mc as any).readyState === WebSocket.OPEN) {
              (mc as any).send(JSON.stringify({ header: { messagePurpose: 'commandRequest' }, body: { commandLine: command } }));
              forwarded++;
            }
          }
          console.log(`Forwarded game_command "${command}" to ${forwarded} Minecraft clients`);
        }
        if (msg && msg.type === 'analyze_request') {
          console.info('Received analyze_request from UI');
          try {
            const result = await analyzePlayerData();
            (ws as any).send(JSON.stringify({ type: 'analysis_result', ...result }));
            console.info('Sent analysis_result to UI');
          } catch (err) {
            console.error('Failed to perform analysis request', err);
            (ws as any).send(JSON.stringify({ type: 'analysis_result', error: String(err) }));
          }
        }
        if (msg && msg.type === 'session_status') {
          try {
            const info = {
              type: 'session_status',
              sessionId: state.sessionId,
              sessionStartTime: state.sessionStartTime ? (state.sessionStartTime.toString ? state.sessionStartTime.toString() : state.sessionStartTime) : null,
              sessionFile: state.sessionFile || null,
              eventsCount: (state.sessionEvents && state.sessionEvents.length) || 0,
              activePlayers: Array.from(state.activePlayers || []),
              lastSaveTime: state.lastSaveTime || null,
            };
            (ws as any).send(JSON.stringify(info));
            console.log('Replied to session_status request with', info);
          } catch (e) {
            console.error('Failed to respond to session_status', e);
            (ws as any).send(JSON.stringify({ type: 'session_status', error: String(e) }));
          }
        }
      } catch (err) {
        console.error('Error handling message from renderer', err);
      }
    });

    ws.on('close', () => {
      state.webClients.delete(ws as any);
      console.log('Renderer disconnected');
    });
  });

  return wss;
}

