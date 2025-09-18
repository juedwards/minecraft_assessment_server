import WebSocket, { Server as WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

import state from './state';
import { broadcastToWeb } from './ws_web';
import * as chunkStore from './chunk_store';
import * as session from './session';

let wss: WebSocketServer | null = null;

// Track per-connection position update counters so we don't record every travelled event
const positionUpdateCounters: WeakMap<WebSocket, number> = new WeakMap();

export function sendWelcomeMessage(ws: WebSocket, clientAddr: string = 'unknown'): void {
  const welcome = {
    header: {
      version: 1,
      requestId: uuidv4(),
      messageType: 'commandRequest',
      messagePurpose: 'commandRequest',
    },
    body: {
      origin: { type: 'player' },
      commandLine:
        'tellraw @a {"rawtext":[{"text":"§6§l======\\n§r§e§lWelcome to Playtrace AI\\n§r§eYour game data is being recorded.\\n§eIf you do not want this please exit now.\\n§6§l======"}]}}',
      version: 1,
    },
  };
  try {
    (ws as any).send(JSON.stringify(welcome));
    console.log(`Sent welcome message (requestId=${welcome.header.requestId}) to ${clientAddr}`);
  } catch (err) {
    console.error('Failed to send welcome', err);
  }
}

export async function onMessage(ws: WebSocket, raw: WebSocket.Data) {
  // Parse incoming message and guard against malformed JSON
  let parsed: any;
  try {
    parsed = JSON.parse(String(raw));
  } catch (err) {
    console.error('Failed to parse incoming Minecraft message:', err, typeof raw === 'string' ? raw : String(raw).slice(0, 200));
    return;
  }

  const header = parsed.header || {};
  const body = parsed.body || {};
  console.log(`Incoming message: purpose=${header.messagePurpose || header.messageType || 'unknown'} event=${header.eventName || header.event || ''} requestId=${header.requestId || header.requestID || ''}`);

  // Handle chunk responses first (they contain a `data` payload)
  if ((header.messagePurpose === 'commandResponse' || header.messageType === 'commandResponse') && body && body.data) {
    try {
      console.log('commandResponse received for requestId=', header.requestId || header.requestID, 'dataFieldPresent=', !!body.data, 'dataLength=', body.data ? String(body.data).length : 0);
      const rec = chunkStore.handleChunkResponse(header, body);
      if (rec) {
        console.log(`Decoded and stored chunk ${rec.dimension} ${rec.x} ${rec.z} y=${rec.y} (request=${rec.requestId})`);
        broadcastToWeb({ type: 'chunk', dimension: rec.dimension, x: rec.x, z: rec.z, y: rec.y, pixels: rec.pixels, heights: rec.heights, requestId: rec.requestId, timestamp: rec.timestamp });
      } else {
        console.warn('Received chunk response but decoding returned no record', { header, sample: body && body.data ? String(body.data).slice(0, 200) : null });
      }
    } catch (err) {
      console.error('Error decoding or broadcasting chunk response', err);
    }
    return;
  }

  // Map event messages to smaller UI-friendly packets
  if (header.messagePurpose === 'event' || header.messageType === 'event') {
    const eventName = header.eventName || header.event || '';
    const player_data = body.player || {};
    const playerId = player_data.id ? String(player_data.id) : null;
    const playerName = player_data.name || null;

    // Debug payload shape to help diagnose missing fields
    console.debug && console.debug('Event payload preview:', eventName, player_data ? JSON.stringify(player_data).slice(0, 1000) : null);

    if (eventName === 'PlayerMessage') {
      try {
        const message_text = body.message || '';
        const message_type = body.type || '';
        const sender = body.sender || 'Unknown';
        try { session.recordEvent('player_chat', { player_id: playerId, player_name: playerName, message: message_text, message_type, sender }); } catch (e) { console.error('session.recordEvent failed for player_chat', e); }
        broadcastToWeb({ type: 'player_chat', playerId, playerName, message: message_text });
        console.info(`Chat from ${playerName}: ${message_text}`);
      } catch (err) { console.error('Error handling PlayerMessage event', err); }
      return;
    }

    if (eventName === 'PlayerTravelled') {
      try {
        if (player_data && player_data.position) {
          const pos = player_data.position;
          const x = Number(pos.x || 0);
          const y = Number(pos.y || 0);
          const z = Number(pos.z || 0);
          const pid = playerId || `player_${Date.now()}`;
          const pname = playerName || pid;

          state.playerPositions[pid] = { x, y, z, name: pname };

          // Throttle recording of position events
          const prev = positionUpdateCounters.get(ws) || 0;
          const next = prev + 1;
          positionUpdateCounters.set(ws, next);
          if (next % 10 === 0) {
            try { session.recordEvent('player_position', { player_id: pid, player_name: pname, position: { x, y, z }, dimension: player_data.dimension || 'overworld' }); } catch (e) { console.error('session.recordEvent failed for player_position', e); }
          }

          // Broadcast live position to web clients
          broadcastToWeb({ type: 'position', playerId: pid, playerName: pname, x, y, z });

          // Ask Minecraft client for the surrounding chunk(s)
          try {
            const cx = Math.floor(x / 16.0);
            const cz = Math.floor(z / 16.0);
            const dim = player_data.dimension || 'overworld';
            const ySlice = Math.floor(y);
            chunkStore.ensureChunkPresent(ws, dim, cx, cz, ySlice, 1).catch((e: any) => console.error('failed to request chunk for player position', e));
          } catch (e) { console.error('failed to request chunk for player position', e); }
        }
      } catch (err) { console.error('Error handling PlayerTravelled', err); }
      return;
    }

    if (eventName === 'BlockPlaced') {
      try {
        const player_pos = (body.player || {}).position || {};
        const block_x = Math.floor(player_pos.x || 0);
        const block_y = Math.floor(player_pos.y || 0);
        const block_z = Math.floor(player_pos.z || 0);
        const block_info = body.block || {};
        const block_id = block_info.id || 'unknown';
        const block_namespace = block_info.namespace || 'minecraft';
        const block_type = `${block_namespace}:${block_id}`;
        try { session.recordEvent('block_placed', { player_id: playerId, player_name: playerName, block_type, player_position: { x: player_pos.x || 0, y: player_pos.y || 0, z: player_pos.z || 0 }, estimated_block_position: { x: block_x, y: block_y + 1, z: block_z } }); } catch (e) { console.error('session.recordEvent failed for block_placed', e); }
        broadcastToWeb({ type: 'block_place', x: player_pos.x || 0, y: player_pos.y || 0, z: player_pos.z || 0, blockPos: { x: block_x, y: block_y + 1, z: block_z }, blockType: block_type, playerName: playerName || 'Unknown' });
        console.info(`Block placed: ${block_type} near (${block_x}, ${block_y}, ${block_z}) by ${playerName}`);
      } catch (err) { console.error('Error handling BlockPlaced', err); }
      return;
    }

    if (eventName === 'BlockBroken') {
      try {
        const player_pos = (body.player || {}).position || {};
        const block_x = Math.floor(player_pos.x || 0);
        const block_y = Math.floor(player_pos.y || 0);
        const block_z = Math.floor(player_pos.z || 0);
        const block_info = body.block || {};
        const block_id = block_info.id || 'unknown';
        const block_namespace = block_info.namespace || 'minecraft';
        const block_type = `${block_namespace}:${block_id}`;
        try { session.recordEvent('block_broken', { player_id: playerId, player_name: playerName, block_type, player_position: { x: player_pos.x || 0, y: player_pos.y || 0, z: player_pos.z || 0 }, estimated_block_position: { x: block_x, y: block_y, z: block_z } }); } catch (e) { console.error('session.recordEvent failed for block_broken', e); }
        broadcastToWeb({ type: 'block_break', x: player_pos.x || 0, y: player_pos.y || 0, z: player_pos.z || 0, blockPos: { x: block_x, y: block_y, z: block_z }, blockType: block_type, playerName: playerName || 'Unknown' });
        console.info(`Block broken: ${block_type} near (${block_x}, ${block_y}, ${block_z}) by ${playerName}`);
      } catch (err) { console.error('Error handling BlockBroken', err); }
      return;
    }

    // Default: record generic event payloads to the session so they are preserved
    try {
      if (eventName) {
        try { session.recordEvent(eventName.toLowerCase(), { player_id: playerId, player_name: playerName, event_data: body }); } catch (e) { console.error('session.recordEvent failed for generic event', e); }
      }
    } catch (err) { console.error('Error handling generic event', err); }

    return;
  }

  // If message contains player info (non-event), handle initial join/position snapshot
  if (body && body.player) {
    try {
      const p = body.player;
      const playerId = p.id ? String(p.id) : `player_${Date.now()}`;
      const playerName = p.name || playerId;

      const wasEmpty = state.activePlayers.size === 0;
      state.activePlayers.add(playerId);

      if (wasEmpty) {
        try {
          session.startSession();
          const startTimeIso = state.sessionStartTime ? (state.sessionStartTime instanceof Date ? (state.sessionStartTime as Date).toISOString() : String(state.sessionStartTime)) : null;
          const fileName = state.sessionFile ? path.basename(state.sessionFile) : null;
          broadcastToWeb({ type: 'session_info', sessionId: state.sessionId, startTime: startTimeIso, fileName });
        } catch (e) { console.error('Failed to start session', e); }
      }

      try { session.recordEvent('player_join', { player_id: playerId, player_name: playerName }); } catch (e) { console.error('session.recordEvent failed for player_join', e); }

      if (p.position) {
        state.playerPositions[playerId] = { x: p.position.x || 0, y: p.position.y || 0, z: p.position.z || 0, name: playerName };
        broadcastToWeb({ type: 'position', playerId, playerName, x: p.position.x || 0, y: p.position.y || 0, z: p.position.z || 0 });
      }
    } catch (err) {
      console.error('Error processing non-event player message', err, body);
    }
  }
}

export function startMinecraftServer(port: number = Number(process.env.MINECRAFT_PORT) || 19131) {
  if (wss) return wss;
  wss = new WebSocket.Server({ port });
  console.log(`WebSocket server for Minecraft listening on ws://0.0.0.0:${port}`);

  wss.on('connection', (ws: WebSocket, req) => {
    state.minecraftConnections.add(ws as any);
    const clientAddr = (ws as any)._socket ? `${(ws as any)._socket.remoteAddress}:${(ws as any)._socket.remotePort}` : 'unknown';
    console.log('Minecraft client connected from', clientAddr);

    // Initialize per-connection position update counter
    positionUpdateCounters.set(ws, 0);

    // Send a welcome message and subscribe to common events (mirror Python behavior)
    sendWelcomeMessage(ws, clientAddr);

    // Subscribe to common events
    const eventsToSubscribe = [
      'BlockPlaced','BlockBroken','PlayerTravelled','PlayerMessage','ItemUsed','ItemInteracted','ItemCrafted','ItemSmelted','ItemEquipped','ItemDropped','ItemPickedUp','PlayerDied','MobKilled','PlayerHurt','PlayerAttack','DoorUsed','ChestOpened','ContainerClosed','ButtonPressed','LeverUsed','PressurePlateActivated','PlayerJump','PlayerSneak','PlayerSprint','PlayerSwim','PlayerClimb','PlayerGlide','PlayerTeleport','AwardAchievement','PlayerTransform','EntitySpawned','EntityRemoved','EntityInteracted','WeatherChanged','TimeChanged','GameRulesUpdated','PlayerEat','PlayerSleep','PlayerWake','CameraUsed','BookEdited','BossKilled','RaidCompleted','TradeCompleted'
    ];

    try {
      for (const ev of eventsToSubscribe) {
        const reqId = uuidv4();
        const req = { header: { version: 1, requestId: reqId, messageType: 'commandRequest', messagePurpose: 'subscribe' }, body: { eventName: ev } };
        (ws as any).send(JSON.stringify(req));
        console.log(`Sent subscription request for event "${ev}" (requestId=${reqId}) to ${clientAddr}`);
      }
    } catch (err) {
      console.error('Failed to send subscriptions', err);
    }

    // Development convenience: request a few nearby chunks so we can test decoding/broadcasting
    try {
      const isDev = process.env.NODE_ENV === 'development';
      if (isDev) {
        const sampleCoords = [[0,0],[1,0],[-1,0]];
        for (const [cx, cz] of sampleCoords) {
          chunkStore.requestChunk(ws, 0, cx, cz, null)
            .then((rid: any) => console.info(`Requested sample chunk ${cx},${cz} (rid=${rid}) for client ${clientAddr}`))
            .catch((e: any) => console.error('sample chunk request failed', e));
        }
      }
    } catch (e) { console.error('dev sample chunk requests failed', e); }

    ws.on('message', (msg) => onMessage(ws, msg));
    ws.on('close', () => {
      state.minecraftConnections.delete(ws as any);
      console.log('Minecraft client disconnected', clientAddr);
    });
    ws.on('error', (err) => console.error('Minecraft WS error', err));
  });

  return wss;
}

export async function broadcastActivePlayers() {
  try {
    const players_list: any[] = [];
    // If the authoritative activePlayers set is empty, fall back to keys present in playerPositions
    const sourceIds = (state.activePlayers && state.activePlayers.size > 0) ? Array.from(state.activePlayers) : Object.keys(state.playerPositions || {});
    for (const pid of sourceIds) {
      const pname = (state.playerPositions[pid] && state.playerPositions[pid].name) || pid;
      const entry: any = { playerId: pid, playerName: pname };
      const pos = state.playerPositions[pid];
      if (pos) {
        entry.x = pos.x;
        entry.y = pos.y;
        entry.z = pos.z;
      }
      players_list.push(entry);
    }
    broadcastToWeb({ type: 'active_players', players: players_list });
  } catch (err) {
    console.error('Error broadcasting active players', err);
  }
}

// Periodically broadcast active player list to web clients
setInterval(broadcastActivePlayers, 5000);

