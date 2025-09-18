// WebSocket helper for the renderer

declare const THREE: any;
import * as events from './events';
import * as players from './players';
import * as chunks from './chunks';
import { getScene } from './scene';
import * as state from './state';
import * as utils from './utils';

let ws: WebSocket | null = null;
let lastConnectOpts: { host?: string; port?: number | string; path?: string } = {};

export function isOpen() {
    return ws && (ws as any).readyState === (typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1);
}

export function getWs() { return ws; }

export function send(obj: any) {
    try {
        if (isOpen()) {
            (ws as any).send(JSON.stringify(obj));
        } else {
            console.warn('websocket.send(): socket not open', obj);
        }
    } catch (e) {
        console.error('websocket.send() failed', e);
    }
}

export function connect(host: string = (window as any).WS_CONFIG && (window as any).WS_CONFIG.host ? (window as any).WS_CONFIG.host : (window && window.location && window.location.hostname) ? window.location.hostname : 'localhost', port: number | string = (window as any).WS_CONFIG && (window as any).WS_CONFIG.port ? (window as any).WS_CONFIG.port : 8081, path = 'live') {
    lastConnectOpts = { host, port, path };
    const wsUrl = `ws://${host}:${port}/${path}`;
    ws = new (window as any).WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to live updates', wsUrl);
        const wsStatus = document.getElementById('wsStatus'); if (wsStatus) wsStatus.textContent = 'Connected';
        const status = document.getElementById('status'); if (status) { status.className = 'connected'; status.textContent = 'WebSocket Connected'; }
    };

    ws.onmessage = (event: MessageEvent) => {
        let data: any;
        try { data = JSON.parse(event.data); } catch (e) { console.error('Invalid WS JSON', e); return; }

        console.log('Received:', data.type, data);

        switch (data.type) {
            case 'session_info':
                state.setSessionInfo(data.sessionId, data.startTime);
                const sessionIdElem = document.getElementById('sessionId');
                if (sessionIdElem && data.sessionId) sessionIdElem.textContent = data.sessionId.split('_').slice(-2).join('_');
                const fileNameElem = document.getElementById('fileName'); if (fileNameElem) fileNameElem.textContent = data.fileName;
                const exportButton = document.getElementById('exportButton'); if (exportButton) { exportButton.disabled = false; exportButton.title = `Export ${data.fileName}`; }
                if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();
                break;

            case 'save_notification':
                try { if (events && typeof events.triggerSaveNotification === 'function') events.triggerSaveNotification(); } catch (e) { console.error(e); }
                break;

            case 'chunk':
                try {
                    chunks && typeof (chunks as any).addOrUpdateChunkMesh === 'function' && (chunks as any).addOrUpdateChunkMesh(data);
                    try { const currentCount = (chunks && (chunks as any).chunkMeshes) ? (chunks as any).chunkMeshes.size : 0; const scene = getScene(); if (scene && scene.groundMesh) scene.groundMesh.visible = currentCount === 0; } catch (e) {}
                    const cx = parseInt(data.x, 10); const cz = parseInt(data.z, 10);
                    const centerMcX = cx * 16 + 8; const centerMcZ = cz * 16 + 8; const centerPos = (utils as any).mcToThreeCoords(centerMcX, 0, centerMcZ);
                    const dbg = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.3,0.3), new THREE.MeshBasicMaterial({color:0xff0000}));
                    dbg.position.set(centerPos.x, centerPos.y + 0.3, centerPos.z); dbg.userData = { isDebugChunkMarker: true };
                    const sceneRef = getScene(); if (sceneRef) sceneRef.add(dbg);
                    setTimeout(() => { const s = getScene(); if (s) s.remove(dbg); }, 5000);
                } catch (e) { console.error('failed to render chunk', e, data); }
                break;

            case 'position':
                try {
                    if (players && typeof (players as any).updatePlayer === 'function') {
                        let candidateA = null;
                        try { candidateA = ((utils as any).mcToThreeCoords) ? (utils as any).mcToThreeCoords(data.x, data.y, data.z) : null; } catch (e) { candidateA = null; }
                        const candidateB = { x: data.x, y: data.y, z: data.z };

                        function nearestChunkDist(pos: any) {
                            try {
                                if (!chunks || !(chunks as any).chunkMeshes || (chunks as any).chunkMeshes.size === 0) return Number.POSITIVE_INFINITY;
                                let min = Number.POSITIVE_INFINITY;
                                for (const [k, m] of (chunks as any).chunkMeshes.entries()) {
                                    const parts = k.split(':'); if (parts.length < 3) continue; const cxk = parseInt(parts[1], 10); const czk = parseInt(parts[2], 10);
                                    if (Number.isNaN(cxk) || Number.isNaN(czk)) continue;
                                    const center = (utils as any).mcToThreeCoords(cxk * 16 + 8, 0, czk * 16 + 8);
                                    const dx = center.x - pos.x; const dz = center.z - pos.z; const d2 = dx * dx + dz * dz; if (d2 < min) min = d2;
                                }
                                return Math.sqrt(min);
                            } catch (e) { return Number.POSITIVE_INFINITY; }
                        }

                        let chosen = 'mc';
                        if (candidateA) {
                            const dA = nearestChunkDist(candidateA);
                            const dB = nearestChunkDist(candidateB);
                            const WORLD_PREFERENCE_MARGIN = 2.0;
                            if (dB + WORLD_PREFERENCE_MARGIN < dA) chosen = 'world'; else chosen = 'mc';
                            console.log('position mapping decision', { playerId: data.playerId, candidateA, candidateB, dA, dB, chosen });
                        } else {
                            chosen = 'mc';
                            console.log('position mapping: no mcToThreeCoords available; defaulting to MC coords', { playerId: data.playerId, data });
                        }

                        if (chosen === 'mc') {
                            (players as any).updatePlayer(data.playerId, data.playerName, data.x, data.y, data.z, false);
                        } else {
                            (players as any).updatePlayer(data.playerId, data.playerName, data.x, data.y, data.z, true);
                        }
                    }
                } catch (e) { console.error('player update delegation failed', e); }

                state.incrementEventCount();
                if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();

                try {
                    const sceneRef = getScene();
                    const rawThree = ((utils as any).mcToThreeCoords) ? (utils as any).mcToThreeCoords(data.x, data.y, data.z) : { x: data.x, y: data.y, z: data.z };
                    console.log('POSITION DEBUG', { playerId: data.playerId, raw: {x:data.x,y:data.y,z:data.z}, rawThree });
                    if (sceneRef) {
                        const rawMarker = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
                        rawMarker.position.set(rawThree.x, rawThree.y, rawThree.z); rawMarker.userData = { debugMarker: true }; sceneRef.add(rawMarker);

                        let placedPos = null; let halfH = 1;
                        try { placedPos = ((players as any).players && (players as any).players.get && (players as any).players.get(data.playerId)) ? (players as any).players.get(data.playerId).targetPos.clone() : null; } catch (e) { placedPos = null; }
                        try { const playerRec = ((players as any).players && (players as any).players.get && (players as any).players.get(data.playerId)) ? (players as any).players.get(data.playerId) : null; if (playerRec && playerRec.mesh && playerRec.mesh.geometry && playerRec.mesh.geometry.parameters && playerRec.mesh.geometry.parameters.height) halfH = playerRec.mesh.geometry.parameters.height / 2; } catch (e) { halfH = 1; }

                        const placedMarker = new THREE.Mesh(new THREE.SphereGeometry(0.25), new THREE.MeshBasicMaterial({ color: 0x0000ff }));
                        if (placedPos) placedMarker.position.copy(placedPos); else placedMarker.position.set(rawThree.x, rawThree.y + 1, rawThree.z);
                        placedMarker.userData = { debugMarker: true }; sceneRef.add(placedMarker);

                        try {
                            const placedFeetY = (placedPos ? placedPos.y : (rawThree.y + 1)) - halfH;
                            console.log('POSITION DEBUG Y:', { rawFeetY: rawThree.y, placedFeetY, diff: placedFeetY - rawThree.y, halfH });

                            const mcX = Math.floor(rawThree.x); const mcZ = Math.floor(rawThree.z); const chunkX = Math.floor(mcX / 16); const chunkZ = Math.floor(mcZ / 16); const localX = ((mcX % 16) + 16) % 16; const localZ = ((mcZ % 16) + 16) % 16; const colIdx = localZ * 16 + localX; const chunkPrefix = `${'overworld'}:${chunkX}:${chunkZ}:`;
                            let columnTopY: any = null;
                            for (const [k, g] of ((chunks as any).chunkBlockGroups ? (chunks as any).chunkBlockGroups.entries() : [])) {
                                if (k.startsWith(chunkPrefix)) {
                                    for (let i = 0; i < g.children.length; i++) {
                                        const c = g.children[i];
                                        if (c && c.userData && c.userData.colIdx === colIdx) {
                                            columnTopY = c.position.y + 0.5;
                                            try {
                                                const heightsArr = (g && g.userData && Array.isArray(g.userData.heights)) ? g.userData.heights : null;
                                                if (heightsArr && heightsArr.length > colIdx) {
                                                    const rawHeightVal = heightsArr[colIdx];
                                                    const expectedTop = rawHeightVal + 1;
                                                    console.log('POSITION DEBUG HEIGHTS:', { rawHeightVal, expectedTop, feet_vs_expectedTop: placedFeetY - expectedTop });
                                                }
                                            } catch (e) {}

                                            try {
                                                const colKey = `${k}:${colIdx}`;
                                                const recordedType = (chunks as any).columnBlockTypes && (chunks as any).columnBlockTypes.has(colKey) ? (chunks as any).columnBlockTypes.get(colKey) : null;
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
                                try {
                                    const gapMaterial = new THREE.LineBasicMaterial({ color: 0xFFFF00 });
                                    const pts = [ new THREE.Vector3(rawThree.x, columnTopY, rawThree.z), new THREE.Vector3(rawThree.x, placedFeetY, rawThree.z) ];
                                    const gapGeom = new THREE.BufferGeometry().setFromPoints(pts);
                                    const gapLine = new THREE.Line(gapGeom, gapMaterial);
                                    gapLine.userData = { debugMarker: true, debugGapLine: true };
                                    sceneRef.add(gapLine);
                                    setTimeout(() => { try { const s = getScene(); if (s) s.remove(gapLine); } catch (e) {} }, 5000);
                                } catch (e) { }
                            } else {
                                console.log('POSITION DEBUG COLUMN: no column mesh available for this player column');
                            }
                        } catch (e) {}

                        setTimeout(() => { try { const s = getScene(); if (s) { s.remove(rawMarker); s.remove(placedMarker); } } catch (e) {} }, 5000);
                    }
                } catch (e) { console.error('position debug failed', e); }

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
                try { chunks && typeof chunks.updateChunkBlockFromEvent === 'function' && chunks.updateChunkBlockFromEvent(data.blockPos, 'break', null); } catch (e) { console.error('failed to update chunk block on break', e); }
                break;

            case 'player_init':
                try {
                    if (players && typeof (players as any).addPlayer === 'function') {
                        (players as any).addPlayer(data.playerId, data.playerName, data.x, data.y, data.z, data.rotation);
                    }
                } catch (e) { console.error('player_init handling failed', e); }
                break;

            case 'player_remove':
                try {
                    if (players && typeof (players as any).removePlayer === 'function') {
                        (players as any).removePlayer(data.playerId);
                    }
                } catch (e) { console.error('player_remove handling failed', e); }
                break;

            case 'player_update':
                try {
                    if (players && typeof (players as any).updatePlayer === 'function') {
                        (players as any).updatePlayer(data.playerId, data.playerName, data.x, data.y, data.z, data.isTeleport);
                    }
                } catch (e) { console.error('player_update handling failed', e); }
                break;

            case 'teleport':
                try {
                    if (players && typeof (players as any).updatePlayer === 'function') {
                        (players as any).updatePlayer(data.playerId, data.playerName, data.x, data.y, data.z, true);
                    }
                } catch (e) { console.error('teleport handling failed', e); }
                break;

            case 'set_block':
                try {
                    if (chunks && typeof chunks.updateChunkBlockFromEvent === 'function') {
                        chunks.updateChunkBlockFromEvent(data.blockPos, 'place', data.blockType);
                    }
                } catch (e) { console.error('set_block handling failed', e); }
                break;

            case 'clear_chunk':
                try {
                    chunks && typeof (chunks as any).clearChunk === 'function' && (chunks as any).clearChunk(data);
                } catch (e) { console.error('clear_chunk handling failed', e); }
                break;

            case 'init_done':
                try {
                    console.log('Initialization done, starting event loop');
                    // init_done received (no-op for renderer); session updated event will be triggered below
                     if (events && typeof events.triggerSessionUpdated === 'function') events.triggerSessionUpdated();
                } catch (e) { console.error('init_done handling failed', e); }
                break;

            default:
                console.warn('Unhandled message type:', data.type, data);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed, scheduling reconnect');
        const wsStatus = document.getElementById('wsStatus'); if (wsStatus) wsStatus.textContent = 'Disconnected';
        const status = document.getElementById('status'); if (status) { status.className = 'disconnected'; status.textContent = 'WebSocket Disconnected'; }
        ws = null;
        // Attempt reconnect
        setTimeout(() => {
            try {
                console.info('Attempting WS reconnect to', lastConnectOpts.host, lastConnectOpts.port, lastConnectOpts.path);
                connect(lastConnectOpts.host, lastConnectOpts.port, lastConnectOpts.path);
            } catch (e) { console.error('Reconnect attempt failed', e); }
        }, 2000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}
