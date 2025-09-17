// websocket.js
// Responsibilities:
// - connect(), manage ws lifecycle
// - Dispatch incoming messages to players/chunks/events/ui modules

import * as events from './events.js';
import * as players from './players.js';
import * as chunks from './chunks.js';
import { getScene } from './scene.js';
import * as state from './state.js';
import * as utils from './utils.js';

let ws = null;

export function isOpen() {
    return ws && ws.readyState === WebSocket.OPEN;
}

export function getWs() {
    return ws;
}

export function send(obj) {
    try {
        if (isOpen()) {
            ws.send(JSON.stringify(obj));
        } else {
            console.warn('websocket.send(): socket not open', obj);
        }
    } catch (e) {
        console.error('websocket.send() failed', e);
    }
}

export function connect(host = (window && window.location && window.location.hostname) ? window.location.hostname : 'localhost', port = 8081, path = 'live') {
    const wsUrl = `ws://${host}:${port}/${path}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to live updates');
        const wsStatus = document.getElementById('wsStatus');
        if (wsStatus) wsStatus.textContent = 'Connected';
        const status = document.getElementById('status');
        if (status) {
            status.className = 'connected';
            status.textContent = 'WebSocket Connected';
        }
    };

    ws.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            console.error('Invalid WS JSON', e);
            return;
        }

        console.log('Received:', data.type, data);

        switch (data.type) {
            case 'session_info':
                // set session info in shared state and notify UI
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
                    // Compute canonical MC -> Three chunk center and use it for debug marker
                    const centerMcX = cx * 16 + 8;
                    const centerMcZ = cz * 16 + 8;
                    const centerPos = utils.mcToThreeCoords(centerMcX, 0, centerMcZ);
                    const dbg = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.3,0.3), new THREE.MeshBasicMaterial({color:0xff0000}));
                    dbg.position.set(centerPos.x, centerPos.y + 0.3, centerPos.z);
                     dbg.userData = { isDebugChunkMarker: true };
                     const scene = getScene();
                     if (scene) scene.add(dbg);
                     setTimeout(() => { const s = getScene(); if (s) s.remove(dbg); }, 5000);
                } catch (e) {
                    console.error('failed to render chunk', e, data);
                }
                break;

            case 'position':
                try {
                    if (players && typeof players.updatePlayer === 'function') {
                        // Two candidate interpretations:
                        // A) data.x/y/z are Minecraft world coords -> convert with mcToThreeCoords
                        // B) data.x/y/z are already *three.js* world coords -> use directly
                        let candidateA = null;
                        try { candidateA = (utils && typeof utils.mcToThreeCoords === 'function') ? utils.mcToThreeCoords(data.x, data.y, data.z) : null; } catch (e) { candidateA = null; }
                        const candidateB = { x: data.x, y: data.y, z: data.z };

                        // Helper: compute nearest chunk center distance for a candidate world position
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
                            const WORLD_PREFERENCE_MARGIN = 2.0; // units (blocks/meters)
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

                // TEMP DEBUG: run in its own try/catch so we don't disturb main flow
                try {
                    const scene = getScene();
                    const rawThree = (utils && typeof utils.mcToThreeCoords === 'function') ? utils.mcToThreeCoords(data.x, data.y, data.z) : { x: data.x, y: data.y, z: data.z };
                    console.log('POSITION DEBUG', { playerId: data.playerId, raw: {x:data.x,y:data.y,z:data.z}, rawThree });
                    if (scene) {
                        const rawMarker = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
                        rawMarker.position.set(rawThree.x, rawThree.y, rawThree.z);
                        rawMarker.userData = { debugMarker: true };
                        scene.add(rawMarker);

                        let placedPos = null;
                        let halfH = 1;
                        try { placedPos = (players && players.players && players.players.get && players.players.get(data.playerId)) ? players.players.get(data.playerId).targetPos.clone() : null; } catch (e) { placedPos = null; }
                        try { const playerRec = (players && players.players && players.players.get && players.players.get(data.playerId)) ? players.players.get(data.playerId) : null; if (playerRec && playerRec.mesh && playerRec.mesh.geometry && playerRec.mesh.geometry.parameters && playerRec.mesh.geometry.parameters.height) halfH = playerRec.mesh.geometry.parameters.height / 2; } catch (e) { halfH = 1; }

                        const placedMarker = new THREE.Mesh(new THREE.SphereGeometry(0.25), new THREE.MeshBasicMaterial({ color: 0x0000ff }));
                        if (placedPos) placedMarker.position.copy(placedPos); else placedMarker.position.set(rawThree.x, rawThree.y + 1, rawThree.z);
                        placedMarker.userData = { debugMarker: true };
                        scene.add(placedMarker);

                        try {
                            const placedFeetY = (placedPos ? placedPos.y : (rawThree.y + 1)) - halfH;
                            console.log('POSITION DEBUG Y:', { rawFeetY: rawThree.y, placedFeetY, diff: placedFeetY - rawThree.y, halfH });

                            // Also attempt to read the authoritative block top Y at this column
                            const mcX = Math.floor(rawThree.x);
                            const mcZ = Math.floor(rawThree.z);
                            const chunkX = Math.floor(mcX / 16);
                            const chunkZ = Math.floor(mcZ / 16);
                            const localX = ((mcX % 16) + 16) % 16;
                            const localZ = ((mcZ % 16) + 16) % 16;
                            const colIdx = localZ * 16 + localX;
                            const chunkPrefix = `${'overworld'}:${chunkX}:${chunkZ}:`;
                            let columnTopY = null;
                            for (const [k, g] of (chunks && chunks.chunkBlockGroups ? chunks.chunkBlockGroups.entries() : [])) {
                                if (k.startsWith(chunkPrefix)) {
                                    for (let i = 0; i < g.children.length; i++) {
                                        const c = g.children[i];
                                        if (c && c.userData && c.userData.colIdx === colIdx) {
                                            // c.position.y is block center, so top = center + 0.5
                                            columnTopY = c.position.y + 0.5;
                                            // Also attempt to read the heights array for this chunk (if available)
                                            try {
                                                const heightsArr = (g && g.userData && Array.isArray(g.userData.heights)) ? g.userData.heights : null;
                                                if (heightsArr && heightsArr.length > colIdx) {
                                                    const rawHeightVal = heightsArr[colIdx];
                                                    const expectedTop = rawHeightVal + 1; // because block center = rawHeightVal + 0.5
                                                    console.log('POSITION DEBUG HEIGHTS:', { rawHeightVal, expectedTop, feet_vs_expectedTop: placedFeetY - expectedTop });
                                                }
                                            } catch (e) {}

                                            // Also emit any recorded blockType for that column
                                            try {
                                                const colKey = `${k}:${colIdx}`;
                                                const recordedType = chunks.columnBlockTypes && chunks.columnBlockTypes.has(colKey) ? chunks.columnBlockTypes.get(colKey) : null;
                                                if (recordedType) console.log('POSITION DEBUG BLOCKTYPE:', { colKey, recordedType });
                                            } catch (e) {}

                                            break;
                                        }
                                    }
                                    if (columnTopY !== null) break;
                                }
                            }
                            if (columnTopY !== null) {
                                console.log('POSITION DEBUG COLUMN:', { columnTopY, feet_vs_column_top: placedFeetY - columnTopY });

                                // Visualize the vertical gap between column top and player feet
                                try {
                                    const gapMaterial = new THREE.LineBasicMaterial({ color: 0xFFFF00 });
                                    const pts = [ new THREE.Vector3(rawThree.x, columnTopY, rawThree.z), new THREE.Vector3(rawThree.x, placedFeetY, rawThree.z) ];
                                    const gapGeom = new THREE.BufferGeometry().setFromPoints(pts);
                                    const gapLine = new THREE.Line(gapGeom, gapMaterial);
                                    gapLine.userData = { debugMarker: true, debugGapLine: true };
                                    scene.add(gapLine);
                                    setTimeout(() => { try { const s = getScene(); if (s) s.remove(gapLine); } catch (e) {} }, 5000);
                                } catch (e) { /* ignore visualization errors */ }
                            } else {
                                console.log('POSITION DEBUG COLUMN: no column mesh available for this player column');
                            }
                        } catch (e) { /* ignore column read errors */ }

                        // remove debug markers after a short time
                        setTimeout(() => {
                            try { const s = getScene(); if (s) { s.remove(rawMarker); s.remove(placedMarker); } } catch (e) {}
                        }, 5000);
                    }
                } catch (e) {
                    console.error('position debug failed', e);
                }

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
    };

    ws.onclose = () => {
        console.log('Disconnected from live updates');
        const wsStatus = document.getElementById('wsStatus');
        if (wsStatus) wsStatus.textContent = 'Disconnected';
        const status = document.getElementById('status');
        if (status) {
            status.className = 'disconnected';
            status.textContent = 'WebSocket Disconnected';
        }

        // Reconnect after 2 seconds
        setTimeout(() => {
            try { connect(); } catch (e) { console.error('reconnect failed', e); }
        }, 2000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

export function disconnect() {
    try {
        if (ws) ws.close();
        ws = null;
    } catch (e) { console.error('websocket.disconnect failed', e); }
}
