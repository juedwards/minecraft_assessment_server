// electron_ws_shim.js
// A compatibility shim that replaces browser WebSocket with the desktop/main-process-backed
// single WebSocket. It preserves the original websocket.js message-handling logic but
// receives messages from the preload API (window.api) and forwards outgoing sends to the API.

import * as events from './events.js';
import * as players from './players.js';
import * as chunks from './chunks.js';
import { getScene } from './scene.js';
import * as state from './state.js';
import * as utils from './utils.js';

let _connected = false;
let _apiListenerRegistered = false;
let _lastWsObj = null; // compatibility: expose as window.ws

function _setConnected(flag) {
    _connected = !!flag;
    try {
        const wsStatus = document.getElementById('wsStatus');
        if (wsStatus) wsStatus.textContent = flag ? 'Connected' : 'Disconnected';
        const status = document.getElementById('status');
        if (status) {
            status.className = flag ? 'connected' : 'disconnected';
            status.textContent = flag ? 'WebSocket Connected' : 'WebSocket Disconnected';
        }
    } catch (e) {}
}

export function isOpen() {
    return _connected;
}

export function getWs() {
    return _lastWsObj;
}

export function send(obj) {
    try {
        if (window.api && typeof window.api.send === 'function') {
            window.api.send(obj);
        } else {
            console.warn('electron_ws_shim.send(): window.api.send not available', obj);
        }
    } catch (e) {
        console.error('electron_ws_shim.send() failed', e);
    }
}

export async function connect(host = (window && window.WS_CONFIG && window.WS_CONFIG.host) ? window.WS_CONFIG.host : ((window && window.location && window.location.hostname) ? window.location.hostname : 'localhost'), port = (window && window.WS_CONFIG && window.WS_CONFIG.port) ? window.WS_CONFIG.port : 8081, path = 'live') {
    // Request main process to open the real WebSocket and then register a message listener
    try {
        if (window.api && typeof window.api.connect === 'function') {
            try {
                await window.api.connect({ host, port, path });
                _setConnected(true);
                if (typeof _lastWsObj?.onopen === 'function') {
                    try { _lastWsObj.onopen(); } catch (e) {}
                }
            } catch (err) {
                console.error('electron_ws_shim: api.connect failed', err);
                _setConnected(false);
                if (typeof _lastWsObj?.onclose === 'function') {
                    try { _lastWsObj.onclose(); } catch (e) {}
                }
            }

            if (!_apiListenerRegistered && window.api && typeof window.api.onMessage === 'function') {
                window.api.onMessage((message) => {
                    // Accept either already-parsed objects or raw JSON strings
                    let data = message;
                    if (typeof message === 'string') {
                        try { data = JSON.parse(message); } catch (e) { console.error('electron_ws_shim: invalid JSON from api.onMessage', e); return; }
                    }

                    // Also expose a legacy ws.onmessage compatibility call
                    try {
                        if (_lastWsObj && typeof _lastWsObj.onmessage === 'function') {
                            try { _lastWsObj.onmessage({ data: JSON.stringify(data) }); } catch (e) {}
                        }
                    } catch (e) {}

                    // Run the original message handling switch (port of websocket.js onmessage)
                    try {
                        _handleIncoming(data);
                    } catch (e) { console.error('electron_ws_shim: _handleIncoming failed', e); }
                });

                // Listen for connection state events from main if available
                if (window.api && typeof window.api.onState === 'function') {
                    window.api.onState((s) => {
                        _setConnected(!!s.connected);
                        if (!s.connected && typeof _lastWsObj?.onclose === 'function') {
                            try { _lastWsObj.onclose(); } catch (e) {}
                        }
                        if (s.connected && typeof _lastWsObj?.onopen === 'function') {
                            try { _lastWsObj.onopen(); } catch (e) {}
                        }
                    });
                }

                _apiListenerRegistered = true;
            }
        } else {
            console.warn('electron_ws_shim.connect: window.api.connect not available; running without live connection');
            _setConnected(false);
        }
    } catch (e) {
        console.error('electron_ws_shim.connect error', e);
        _setConnected(false);
    }
}

export function disconnect() {
    try {
        if (window.api && typeof window.api.disconnect === 'function') {
            window.api.disconnect();
        }
        _setConnected(false);
        if (typeof _lastWsObj?.onclose === 'function') {
            try { _lastWsObj.onclose(); } catch (e) {}
        }
    } catch (e) { console.error('electron_ws_shim.disconnect failed', e); }
}

// Create a legacy-compatible global ws object so older scripts that call ws.onmessage continue to work
_lastWsObj = {
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
    send: (payload) => {
        try { send(payload); } catch (e) {}
    }
};
window.ws = _lastWsObj; // legacy global

// The original websocket.js message handler logic is kept here with small adjustments
function _handleIncoming(data) {
    if (!data || !data.type) return;
    switch (data.type) {
        case 'session_info':
            state.setSessionInfo(data.sessionId, data.startTime);
            const sessionIdElem = document.getElementById('sessionId');
            if (sessionIdElem && data.sessionId) sessionIdElem.textContent = data.sessionId.split('_').slice(-2).join('_');
            const fileNameElem = document.getElementById('fileName');
            if (fileNameElem) fileNameElem.textContent = data.fileName;
            const exportButton = document.getElementById('exportButton');
            if (exportButton) {
                exportButton.disabled = false;
                exportButton.title = `Export ${data.fileName}`;
            }
            if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();
            break;

        case 'save_notification':
            try { if (events && typeof events.triggerSaveNotification === 'function') events.triggerSaveNotification(); } catch (e) { console.error(e); }
            break;

        case 'chunk':
            try {
                chunks && typeof chunks.addOrUpdateChunkMesh === 'function' && chunks.addOrUpdateChunkMesh(data);

                try {
                    const currentCount = (chunks && chunks.chunkMeshes) ? chunks.chunkMeshes.size : 0;
                    const scene = getScene();
                    if (scene && scene.groundMesh) scene.groundMesh.visible = currentCount === 0;
                } catch (e) { /* ignore */ }

                const cx = parseInt(data.x, 10);
                const cz = parseInt(data.z, 10);
                const centerMcX = cx * 16 + 8;
                const centerMcZ = cz * 16 + 8;
                const centerPos = utils.mcToThreeCoords(centerMcX, 0, centerMcZ);
                const dbg = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.3,0.3), new THREE.MeshBasicMaterial({color:0xff0000}));
                dbg.position.set(centerPos.x, centerPos.y + 0.3, centerPos.z);
                dbg.userData = { isDebugChunkMarker: true };
                const sceneObj = getScene();
                if (sceneObj) sceneObj.add(dbg);
                setTimeout(() => { const s = getScene(); if (s) s.remove(dbg); }, 5000);
            } catch (e) {
                console.error('failed to render chunk', e, data);
            }
            break;

        case 'position':
            try {
                if (players && typeof players.updatePlayer === 'function') {
                    let candidateA = null;
                    try { candidateA = (utils && typeof utils.mcToThreeCoords === 'function') ? utils.mcToThreeCoords(data.x, data.y, data.z) : null; } catch (e) { candidateA = null; }
                    const candidateB = { x: data.x, y: data.y, z: data.z };

                    function nearestChunkDist(pos) {
                        try {
                            if (!chunks || !chunks.chunkMeshes || chunks.chunkMeshes.size === 0) return Number.POSITIVE_INFINITY;
                            let min = Number.POSITIVE_INFINITY;
                            for (const [k, m] of chunks.chunkMeshes.entries()) {
                                const parts = k.split(':');
                                if (parts.length < 3) continue;
                                const cxk = parseInt(parts[1], 10);
                                const czk = parseInt(parts[2], 10);
                                if (Number.isNaN(cxk) || Number.isNaN(czk)) continue;
                                const center = utils.mcToThreeCoords(cxk * 16 + 8, 0, czk * 16 + 8);
                                const dx = center.x - pos.x;
                                const dz = center.z - pos.z;
                                const d2 = dx * dx + dz * dz;
                                if (d2 < min) min = d2;
                            }
                            return Math.sqrt(min);
                        } catch (e) { return Number.POSITIVE_INFINITY; }
                    }

                    let chosen = 'mc';
                    if (candidateA) {
                        const dA = nearestChunkDist(candidateA);
                        const dB = nearestChunkDist(candidateB);
                        const WORLD_PREFERENCE_MARGIN = 2.0;
                        if (dB + WORLD_PREFERENCE_MARGIN < dA) {
                            chosen = 'world';
                        } else {
                            chosen = 'mc';
                        }
                        console.log("position mapping decision", { playerId: data.playerId, candidateA, candidateB, dA, dB, chosen });
                    } else {
                        chosen = 'mc';
                        console.log('position mapping: no mcToThreeCoords available; defaulting to MC coords', { playerId: data.playerId, data });
                    }

                    if (chosen === 'mc') {
                        players.updatePlayer(data.playerId, data.playerName, data.x, data.y, data.z, false);
                    } else {
                        players.updatePlayer(data.playerId, data.playerName, data.x, data.y, data.z, true);
                    }
                }
            } catch (e) {
                console.error('player update delegation failed', e);
            }

            state.incrementEventCount();
            if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();

            // TEMP DEBUG: visualization omitted for brevity in shim
            break;

        case 'block_place':
            try {
                if (events && typeof events.addBlockEvent === 'function') {
                    events.addBlockEvent('place', data.x, data.y, data.z, data.blockType, data.playerName, data.blockPos);
                }
            } catch (e) { console.error('block_place handling failed', e); }
            state.incrementEventCount();
            if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();
            try { chunks && typeof chunks.updateChunkBlockFromEvent === 'function' && chunks.updateChunkBlockFromEvent(data.blockPos, 'place', data.blockType); } catch (e) { console.error('failed to update chunk block on place', e); }
            break;

        case 'block_break':
            try {
                if (events && typeof events.addBlockEvent === 'function') {
                    events.addBlockEvent('break', data.x, data.y, data.z, data.blockType, data.playerName, data.blockPos);
                }
            } catch (e) { console.error('block_break handling failed', e); }
            state.incrementEventCount();
            if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();
            try { chunks && typeof chunks.updateChunkBlockFromEvent === 'function' && chunks.updateChunkBlockFromEvent(data.blockPos, 'break', data.blockType); } catch (e) { console.error('failed to update chunk block on break', e); }
            break;

        case 'disconnect':
            try {
                if (players && typeof players.removePlayer === 'function') {
                    players.removePlayer(data.playerId);
                }
            } catch (e) { console.error('player remove delegation failed', e); }
            state.incrementEventCount();
            if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();
            break;

        case 'player_chat':
            if (events && typeof events.addEventToLog === 'function') events.addEventToLog(`<span style="color: #9C27B0;">💬</span> ${data.playerName}: "${data.message}"`);
            state.incrementEventCount();
            if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();
            break;

        case 'player_event':
            try {
                let icon = '📌';
                let color = '#2196F3';
                switch(data.eventType) {
                    case 'death': icon = '💀'; color = '#F44336'; break;
                    case 'achievement': icon = '🏆'; color = '#FFD700'; break;
                    case 'combat': icon = '⚔️'; color = '#FF5722'; break;
                }
                if (events && typeof events.addEventToLog === 'function') events.addEventToLog(`<span style="color: ${color};">${icon}</span> ${data.playerName} ${data.details}`);
            } catch (e) { console.error('player_event handling failed', e); }
            state.incrementEventCount();
            if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();
            break;

        case 'session_cleared':
            try {
                const sessionIdElem = document.getElementById('sessionId');
                if (sessionIdElem) sessionIdElem.textContent = data.sessionId || '-';
                const fileNameElem = document.getElementById('fileName');
                if (fileNameElem) fileNameElem.textContent = data.fileName || '-';
                state.setSessionInfo(data.sessionId, data.startTime);
                const durationElem = document.getElementById('sessionDuration');
                if (durationElem) durationElem.textContent = '00:00';
                chunks && typeof chunks.clearAllChunkMeshes === 'function' && chunks.clearAllChunkMeshes(getScene());
                if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();
                console.log('Session cleared, new session:', data.sessionId);
            } catch (e) { console.error('session_cleared handling failed', e); }
            break;

        case 'analysis_result':
            try { if (events && typeof events.triggerAnalysisResult === 'function') events.triggerAnalysisResult(data); } catch (e) { console.error('analysis_result handling failed', e); }
            break;

        case 'player_join':
            try {
                if (players && typeof players.createPlayer === 'function') {
                    players.createPlayer(data.playerId, data.playerName);
                }
            } catch (e) { console.error('player_join handling failed', e); }
            state.incrementEventCount();
            if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();
            break;

        default:
            console.warn('Unhandled WS message type:', data.type);
    }
}

// End shim
