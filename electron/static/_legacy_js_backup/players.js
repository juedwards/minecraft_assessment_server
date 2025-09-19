// players.js
// Responsibilities:
// - Manage players Map, creation, updates, removal
// - Path history and path-line updates
// - Expose public API used by websocket and UI modules

import { getScene } from './scene.js';
import * as utils from './utils.js';
import { getCamera, getControls } from './scene.js';

export const players = new Map();
const playerColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
let colorIndex = 0;
let firstPlayerPositioned = false;

// simple pub/sub for player list changes
const _playerChangeHandlers = [];
export function onPlayersChanged(cb) { if (typeof cb === 'function') _playerChangeHandlers.push(cb); }
function triggerPlayersChanged() { _playerChangeHandlers.forEach(h => { try { h(); } catch (e) {} }); }

export function createPlayer(playerId, playerName) {
    const scene = getScene();
    if (!scene) { console.warn('createPlayer: scene not ready'); return; }
    console.log(`Creating player (module): ${playerName} (${playerId})`);

    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const color = playerColors[colorIndex % playerColors.length];
    const material = new THREE.MeshLambertMaterial({ color: color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    // Set initial mesh center Y using half the mesh height (robust if geometry later changes)
    const initialHalfHeight = (geometry && geometry.parameters && geometry.parameters.height) ? (geometry.parameters.height / 2) : 1;
    mesh.position.y = initialHalfHeight;

    // Add player label
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;
    context.fillStyle = color;
    context.fillRect(0, 0, 256, 64);
    context.fillStyle = 'white';
    context.font = 'bold 36px Arial';
    context.textAlign = 'center';
    context.fillText(playerName || playerId, 128, 45);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(5, 1.25, 1);
    sprite.position.y = 3;
    mesh.add(sprite);

    // Create path line
    const pathGeometry = new THREE.BufferGeometry();
    const pathMaterial = new THREE.LineBasicMaterial({ 
        color: color, 
        linewidth: 2,
        opacity: 0.8,
        transparent: true 
    });
    const pathLine = new THREE.Line(pathGeometry, pathMaterial);
    scene.add(pathLine);

    players.set(playerId, {
        mesh: mesh,
        targetPos: mesh.position.clone(),
        name: playerName || playerId,
        color: color,
        lastUpdate: Date.now(),
        path: [mesh.position.clone()],
        pathLine: pathLine,
        maxPathPoints: 500
    });

    scene.add(mesh);
    colorIndex++;

    // Update UI counts by notifying subscribers
    try { triggerPlayersChanged(); } catch (e) {}
}

export function updatePlayer(playerId, playerName, x, y, z, alreadyWorld = false) {
    const scene = getScene();
    if (!scene) return;

    if (!players.has(playerId)) {
        createPlayer(playerId, playerName);
    }

    const player = players.get(playerId);

    // Convert coordinates using the canonical mcToThreeCoords helper (unless alreadyWorld)
    let worldX, worldY, worldZ;
    if (alreadyWorld) {
        worldX = x; worldY = y; worldZ = z;
    } else {
        const p = utils.mcToThreeCoords(x, y, z);
        worldX = p.x; worldY = p.y; worldZ = p.z;
    }

    // Player mesh.position.y is the mesh center. The incoming Minecraft Y coords
    // represent the player's feet. Compute half the mesh height dynamically and
    // convert the incoming feet Y into the mesh-center Y so the mesh sits on the ground.
    let halfHeight = 1;
    if (player.mesh && player.mesh.geometry && player.mesh.geometry.parameters && player.mesh.geometry.parameters.height) {
        halfHeight = player.mesh.geometry.parameters.height / 2;
    }
    let meshCenterY = worldY + halfHeight;

    player.targetPos.set(worldX, meshCenterY, worldZ);
    player.lastUpdate = Date.now();

    if (Number.isFinite(worldX) && Number.isFinite(meshCenterY) && Number.isFinite(worldZ)) {
        if (player.path.length === 0 || player.path[player.path.length - 1].distanceTo(player.targetPos) > 0.5) {
            // Store the path using the mesh-center Y so the line follows the player mesh
            player.path.push(new THREE.Vector3(worldX, meshCenterY, worldZ));
            if (player.path.length > player.maxPathPoints) player.path.shift();
            updatePathLine(player);
        }
    }

    // Center camera on first player position (only if legacy controls available)
    try {
        if (!firstPlayerPositioned && players.size === 1) {
            firstPlayerPositioned = true;
            const controls = getControls();
            const camera = getCamera();
            if (controls && camera) {
                controls.target.copy(player.targetPos);
                const offset = new THREE.Vector3(20, 30, 20);
                const cameraPos = player.targetPos.clone().add(offset);
                camera.position.copy(cameraPos);
                controls.update();
            }
        }
    } catch (e) { /* ignore */ }

    // Let UI update if present via pubsub
    try { triggerPlayersChanged(); } catch (e) {}
}

export function removePlayer(playerId) {
    const player = players.get(playerId);
    if (player) {
        if (player.mesh && player.mesh.parent) player.mesh.parent.remove(player.mesh);
        if (player.pathLine && player.pathLine.parent) player.pathLine.parent.remove(player.pathLine);
        players.delete(playerId);
        try { triggerPlayersChanged(); } catch (e) {}
    }
}

export function updatePathLine(player) {
    try {
        if (!document.getElementById('showPath') || !document.getElementById('showPath').checked) {
            player.pathLine.visible = false;
            return;
        }
        player.pathLine.visible = true;
        // Smooth the visible path using a Catmull-Rom spline sampled along the stored path
        if (!player.path || player.path.length === 0) {
            player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
            return;
        }

        // Filter invalid points first
        const validPoints = player.path.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
        if (validPoints.length === 0) {
            player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
            return;
        }

        // If only 1 point, draw it as a degenerate line
        if (validPoints.length === 1) {
            const p = validPoints[0];
            player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([p.x, p.y + 0.1, p.z], 3));
            return;
        }

        try {
            const curve = new THREE.CatmullRomCurve3(validPoints);
            const divisions = Math.min(Math.max(validPoints.length * 6, 16), 256);
            const sampled = curve.getPoints(divisions);
            const positions = [];
            sampled.forEach(pt => positions.push(pt.x, pt.y + 0.1, pt.z));
            player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        } catch (e) {
            // Fall back to raw points if curve creation fails
            const positions = [];
            validPoints.forEach(point => positions.push(point.x, point.y + 0.1, point.z));
            player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        }
    } catch (e) {}
}

export function updatePlayerCount() {
    try { const el = document.getElementById('playerCount'); if (el) el.textContent = players.size; } catch (e) {}
}

export function updatePlayerList() {
    try {
        const playerListDiv = document.getElementById('playerList');
        if (!playerListDiv) return;
        playerListDiv.innerHTML = '<h4 style="margin-top:0">Active Players</h4>';
        players.forEach((player, playerId) => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';

            // Recover original Minecraft coordinates from the stored Three.js targetPos
            const mc = utils.threeToMc(player.targetPos.x, player.targetPos.y, player.targetPos.z);
            // For Y we stored the mesh center (meshCenterY = worldY + halfHeight), so
            // recover the player's feet Y by subtracting half the mesh height.
            let halfH = 1;
            try { if (player.mesh && player.mesh.geometry && player.mesh.geometry.parameters && player.mesh.geometry.parameters.height) halfH = player.mesh.geometry.parameters.height / 2; } catch (e) {}
            const mcX = mc.x;
            const mcY = mc.y - halfH;
            const mcZ = mc.z;

             playerItem.innerHTML = `
                 <div style="display: flex; align-items: center; justify-content: space-between;">
                     <div style="display: flex; align-items: center; flex: 1;">
                         <div style="width: 12px; height: 12px; background-color: ${player.color}; margin-right: 8px; border-radius: 2px; flex-shrink: 0;"></div>
                         <span style="flex: 1;">${player.name} <span style="color: #888; font-size: 11px;">(${mcX.toFixed(0)}, ${mcY.toFixed(0)}, ${mcZ.toFixed(0)})</span></span>
                     </div>
                     <button class="center-grid-btn" data-player-id="${playerId}" title="Center grid on player"> 
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/>
                            <line x1="12" y1="1" x2="12" y2="7"/>
                            <line x1="12" y1="17" x2="12" y2="23"/>
                            <line x1="1" y1="12" x2="7" y2="12"/>
                            <line x1="17" y1="12" x2="23" y2="12"/>
                        </svg>
                     </button>
                 </div>
             `;

            // Attach listener to the center-grid button (no inline onclick)
            const centerBtn = playerItem.querySelector('.center-grid-btn');
            if (centerBtn) {
                centerBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    try {
                        // Center camera on this player's position
                        const targetPosition = player.targetPos.clone();
                        if (window && window.controls && window.camera) {
                            const offset = new THREE.Vector3(20, 30, 20);
                            const newCameraPosition = targetPosition.clone().add(offset);
                            const startPos = window.camera.position.clone();
                            const startTarget = window.controls.target.clone();
                            const duration = 1000;
                            const startTime = Date.now();
                            function animateCamera() {
                                const elapsed = Date.now() - startTime;
                                const t = Math.min(elapsed / duration, 1);
                                const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                                window.camera.position.lerpVectors(startPos, newCameraPosition, easeT);
                                window.controls.target.lerpVectors(startTarget, targetPosition, easeT);
                                window.controls.update();
                                if (t < 1) requestAnimationFrame(animateCamera);
                            }
                            animateCamera();
                        }
                    } catch (e) { /* ignore */ }
                });
            }

            playerItem.onclick = (e) => {
                if (e.target.closest('.center-grid-btn')) return;
                const targetPosition = player.targetPos.clone();
                try {
                    const controls = getControls();
                    const camera = getCamera();
                    if (controls && camera) {
                        controls.target.copy(targetPosition);
                        const offset = new THREE.Vector3(20, 30, 20);
                        const newCameraPosition = targetPosition.clone().add(offset);
                        const startPos = camera.position.clone();
                        const startTarget = controls.target.clone();
                        const duration = 1000;
                        const startTime = Date.now();
                        function animateCamera() {
                            const elapsed = Date.now() - startTime;
                            const t = Math.min(elapsed / duration, 1);
                            const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                            camera.position.lerpVectors(startPos, newCameraPosition, easeT);
                            controls.target.lerpVectors(startTarget, targetPosition, easeT);
                            controls.update();
                            if (t < 1) requestAnimationFrame(animateCamera);
                        }
                        animateCamera();
                    }
                } catch (e) {}
            };

            playerListDiv.appendChild(playerItem);
        });

        if (players.size === 0) playerListDiv.innerHTML += '<div style="color: #999; font-size: 13px;">No players connected</div>';
    } catch (e) {}
}

export function clearPath() {
    players.forEach(player => {
        player.path = [];
        updatePathLine(player);
    });
}

export function clearPlayers() {
    players.forEach(player => {
        if (player.mesh && player.mesh.parent) player.mesh.parent.remove(player.mesh);
        if (player.pathLine && player.pathLine.parent) player.pathLine.parent.remove(player.pathLine);
    });
    players.clear();
    updatePlayerCount();
    updatePlayerList();
}
