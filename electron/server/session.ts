import fs from 'fs';
import path from 'path';
import state from './state';
import * as aiClient from './ai_client';

// Ensure data directory exists
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function nowUtcIso(): string {
  return new Date().toISOString();
}

export function startSession(user: string = 'juedwards'): void {
  state.sessionStartTime = new Date();
  const iso = nowUtcIso();
  state.sessionId = `minecraft_session_${iso.replace(/[:.]/g, '_')}`;
  state.sessionEvents = [];
  const initialEvent = { timestamp: iso, event_type: 'session_start', data: { session_id: state.sessionId, server_version: '1.0', user } };
  state.sessionEvents.push(initialEvent);
  state.sessionFile = path.join(DATA_DIR, `${state.sessionId}.json`);
  saveSessionRealtime();
  console.info(`Started new session: ${state.sessionId}`);
}

export function saveSessionRealtime(): void {
  if (!state.sessionFile) return;
  const iso = nowUtcIso();
  const sessionData = {
    session_info: {
      id: state.sessionId,
      start_time: state.sessionStartTime ? (state.sessionStartTime as any).toISOString ? (state.sessionStartTime as any).toISOString() : String(state.sessionStartTime) : null,
      last_update: iso,
      duration_seconds: state.sessionStartTime ? ((Date.now() - new Date(state.sessionStartTime).getTime()) / 1000) : 0,
      total_events: state.sessionEvents ? state.sessionEvents.length : 0,
      user: 'juedwards',
      status: (state.activePlayers && state.activePlayers.size > 0) ? 'active' : 'ended',
    },
    events: state.sessionEvents || [],
  };
  const tmp = `${state.sessionFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sessionData, null, 2), { encoding: 'utf8' });
  try { if (fs.existsSync(state.sessionFile)) fs.unlinkSync(state.sessionFile); } catch (e) {}
  fs.renameSync(tmp, state.sessionFile);
  state.lastSaveTime = Date.now() / 1000;
}

export function endSession(): void {
  if (!state.sessionId) return;
  const now = nowUtcIso();
  state.sessionEvents.push({ timestamp: now, event_type: 'session_end', data: { session_id: state.sessionId, duration_seconds: state.sessionStartTime ? ((Date.now() - new Date(state.sessionStartTime).getTime()) / 1000) : 0, total_events: state.sessionEvents.length } });
  saveSessionRealtime();
  console.info(`Session ended and saved: ${state.sessionFile} (${state.sessionEvents.length} events)`);
}

export function recordEvent(eventType: string, data: any): void {
  // Auto-start a session if none exists so events aren't silently dropped
  if (!state.sessionId) {
    try {
      startSession();
      console.info('Auto-started session because recordEvent was called without an active session');
    } catch (e) {
      console.error('Failed to auto-start session in recordEvent', e);
    }
  }
  const ev = { timestamp: nowUtcIso(), event_type: eventType, data };
  state.sessionEvents.push(ev);
  state.eventBuffer.push(ev);
  const now = Date.now() / 1000;
  if ((now - (state.lastSaveTime || 0) > 5) || (state.eventBuffer.length >= 50)) {
    saveSessionRealtime();
    state.eventBuffer = [];
    state.lastSaveTime = now;
  }
}

export async function analyzePlayerData(): Promise<any> {
  try {
    // Locate rubric.md in a few candidate locations (electron dev vs packaged)
    const candidatePaths = [
      path.resolve(__dirname, '..', 'rubric.md'),           // electron/rubric.md -> repo/rubric.md
      path.resolve(process.cwd(), 'rubric.md'),              // cwd/rubric.md
      path.resolve(__dirname, '..', '..', 'rubric.md'),       // electron/../.. fallback
    ];

    let rubricPath: string | null = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) { rubricPath = p; break; }
    }

    let rubricContent: string | null = null;
    if (rubricPath) {
      rubricContent = fs.readFileSync(rubricPath, { encoding: 'utf8' });
      console.info('Using rubric from', rubricPath);
    } else {
      // Fallback default rubric to avoid hard errors in environments where the
      // external file isn't present (development, packaged asar, etc.). You
      // should include a rubric.md in the repository or package for production.
      console.warn('Rubric file not found in candidate paths; using default embedded rubric');
      rubricContent = `Default Rubric:\n- Collaboration\n- Problem Solving\n- Use of Tools\n- Creativity\n\n(Replace this file at project root with a full rubric.md)`;
    }

    // Aggregate events similarly to Python implementation
    const playerAnalysis: Record<string, any> = {};
    console.info(`analyzePlayerData: sessionEvents=${(state.sessionEvents||[]).length}, activePlayers=${(state.activePlayers ? state.activePlayers.size : 0)}, sessionId=${state.sessionId}`);
    for (const ev of state.sessionEvents || []) {
      const etype = ev.event_type;
      const data = ev.data || {};
      if (['player_position','block_placed','block_broken','player_join','player_leave','player_chat'].includes(etype)) {
        const pid = data.player_id || data.player_name || 'unknown';
        if (!playerAnalysis[pid]) playerAnalysis[pid] = { positions: [], blocks_placed: [], blocks_broken: [], join_time: null, leave_time: null, total_distance: 0 };
        const rec = playerAnalysis[pid];
        if (etype === 'player_position') { if (data.position) rec.positions.push(data.position); }
        else if (etype === 'block_placed') rec.blocks_placed.push({ type: data.block_type, position: data.estimated_block_position, time: ev.timestamp });
        else if (etype === 'block_broken') rec.blocks_broken.push({ type: data.block_type, position: data.estimated_block_position, time: ev.timestamp });
        else if (etype === 'player_join') rec.join_time = ev.timestamp;
        else if (etype === 'player_leave') rec.leave_time = ev.timestamp;
      }
    }

    // If no player data was found, return a helpful error so the UI can explain why nothing is being analyzed
    if (Object.keys(playerAnalysis).length === 0) {
      const errMsg = `No player events recorded for analysis. sessionEvents=${(state.sessionEvents||[]).length}, activePlayers=${(state.activePlayers ? state.activePlayers.size : 0)}, playerPositions=${Object.keys(state.playerPositions||{}).length}. Ensure players are connected and generating events, and that a session has been started.`;
      console.warn(errMsg);
      return { analyses: {}, error: errMsg };
    }

    // compute distances
    for (const pid of Object.keys(playerAnalysis)) {
      const p = playerAnalysis[pid];
      if (p.positions.length > 1) {
        let total = 0;
        for (let i = 1; i < p.positions.length; i++) {
          const a = p.positions[i-1], b = p.positions[i];
          if (!a || !b) continue;
          const dx = (b.x - a.x), dy = (b.y - a.y), dz = (b.z - a.z);
          total += Math.sqrt(dx*dx + dy*dy + dz*dz);
        }
        p.total_distance = Math.round(total * 100) / 100;
      }
    }

    const analyses: Record<string, string> = {};
    for (const pid of Object.keys(playerAnalysis)) {
      const p = playerAnalysis[pid];
      let summary = `Player Activity Summary:\n- Total positions recorded: ${p.positions.length}\n- Total distance traveled: ${p.total_distance || 0} blocks\n- Blocks placed: ${p.blocks_placed.length}\n- Blocks broken: ${p.blocks_broken.length}\n- Session duration: ${p.join_time || 'N/A'} to ${p.leave_time || 'still active'}\n\nBlock Placement Details:\n`;
      for (let i = 0; i < Math.min(10, p.blocks_placed.length); i++) { const b = p.blocks_placed[i]; const pos = b.position || {x:0,y:0,z:0}; summary += `- ${b.type} at (${pos.x}, ${pos.y}, ${pos.z})\n`; }
      if (p.blocks_placed.length > 10) summary += `... and ${p.blocks_placed.length - 10} more blocks\n`;
      summary += '\nBlock Breaking Details:\n';
      for (let i = 0; i < Math.min(10, p.blocks_broken.length); i++) { const b = p.blocks_broken[i]; const pos = b.position || {x:0,y:0,z:0}; summary += `- ${b.type} at (${pos.x}, ${pos.y}, ${pos.z})\n`; }
      if (p.blocks_broken.length > 10) summary += `... and ${p.blocks_broken.length - 10} more blocks\n`;

      const prompt = `Please analyze the following Minecraft player's gameplay data against the provided rubric.\n\nRUBRIC:\n${rubricContent}\n\nPLAYER: ${pid}\n\n${summary}\n\nPlease provide a detailed assessment of this player's performance based on the rubric criteria. Include specific examples from their gameplay data and suggestions for improvement. Format the response in a clear, structured way with sections for different rubric criteria.`;

      try {
        const text = await aiClient.analyzePrompt(prompt, process.env.AZURE_OPENAI_DEPLOYMENT_NAME);
        analyses[pid] = text;
      } catch (err) {
        console.error('AI analyze failed for player', pid, err);
        analyses[pid] = `Error: ${err}`;
      }
    }

    state.latest_assessment_results = { analyses };
    return { analyses };
  } catch (err) {
    console.error('analyzePlayerData error', err);
    return { error: String(err) };
  }
}
