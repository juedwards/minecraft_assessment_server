// Player helper functions for the viewer

declare const THREE: any;
import { getScene, getControls, getCamera } from './scene';
import * as utils from './utils';

export const players: Map<string, any> = new Map();
const playerColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
let colorIndex = 0;
let firstPlayerPositioned = false;

const _playerChangeHandlers: Function[] = [];
export function onPlayersChanged(cb: Function) { if (typeof cb === 'function') _playerChangeHandlers.push(cb); }
function triggerPlayersChanged() { _playerChangeHandlers.forEach(h => { try { h(); } catch (e) {} }); }

export function createPlayer(playerId: string, playerName: string) {
    const scene = getScene();
    if (!scene) { console.warn('createPlayer: scene not ready'); return; }
    console.log(`Creating player (module): ${playerName} (${playerId})`);

    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const color = playerColors[colorIndex % playerColors.length];
    const material = new THREE.MeshLambertMaterial({ color: color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    const initialHalfHeight = (geometry && geometry.parameters && geometry.parameters.height) ? (geometry.parameters.height / 2) : 1;
    mesh.position.y = initialHalfHeight;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    canvas.width = 256; canvas.height = 64;
    if (context) {
        context.fillStyle = color;
        context.fillRect(0, 0, 256, 64);
        context.fillStyle = 'white';
        context.font = 'bold 36px Arial';
        context.textAlign = 'center';
        context.fillText(playerName || playerId, 128, 45);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(5, 1.25, 1);
    sprite.position.y = 3;
    mesh.add(sprite);

    const pathGeometry = new THREE.BufferGeometry();
    const pathMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 2, opacity: 0.8, transparent: true });
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
    try { triggerPlayersChanged(); } catch (e) {}
}

export function updatePlayer(playerId: string, playerName: string, x: number, y: number, z: number, alreadyWorld = false) {
    const scene = getScene();
    if (!scene) return;

    if (!players.has(playerId)) createPlayer(playerId, playerName);
    const player = players.get(playerId);

    let worldX: number, worldY: number, worldZ: number;
    if (alreadyWorld) {
        worldX = x; worldY = y; worldZ = z;
    } else {
        const p = utils.mcToThreeCoords(x, y, z);
        worldX = p.x; worldY = p.y; worldZ = p.z;
    }

    let halfHeight = 1;
    try { if (player.mesh && player.mesh.geometry && player.mesh.geometry.parameters && player.mesh.geometry.parameters.height) halfHeight = player.mesh.geometry.parameters.height / 2; } catch (e) {}
    let meshCenterY = worldY + halfHeight;

    player.targetPos.set(worldX, meshCenterY, worldZ);
    player.lastUpdate = Date.now();

    if (Number.isFinite(worldX) && Number.isFinite(meshCenterY) && Number.isFinite(worldZ)) {
        if (player.path.length === 0 || player.path[player.path.length - 1].distanceTo(player.targetPos) > 0.5) {
            player.path.push(new THREE.Vector3(worldX, meshCenterY, worldZ));
            if (player.path.length > player.maxPathPoints) player.path.shift();
            updatePathLine(player);
        }
    }

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
    } catch (e) { }

    try { triggerPlayersChanged(); } catch (e) {}
}

export function removePlayer(playerId: string) {
    const player = players.get(playerId);
    if (player) {
        if (player.mesh && player.mesh.parent) player.mesh.parent.remove(player.mesh);
        if (player.pathLine && player.pathLine.parent) player.pathLine.parent.remove(player.pathLine);
        players.delete(playerId);
        try { triggerPlayersChanged(); } catch (e) {}
    }
}

export function updatePathLine(player: any) {
    try {
        if (!document.getElementById('showPath') || !(document.getElementById('showPath') as HTMLInputElement).checked) {
            player.pathLine.visible = false; return; }
        player.pathLine.visible = true;
        if (!player.path || player.path.length === 0) {
            player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
            return;
        }

        const validPoints = player.path.filter((p: any) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
        if (validPoints.length === 0) {
            player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
            return;
        }

        if (validPoints.length === 1) {
            const p = validPoints[0];
            player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([p.x, p.y + 0.1, p.z], 3));
            return;
        }

        try {
            const curve = new THREE.CatmullRomCurve3(validPoints);
            const divisions = Math.min(Math.max(validPoints.length * 6, 16), 256);
            const sampled = curve.getPoints(divisions);
            const positions: number[] = [];
            sampled.forEach((pt: any) => positions.push(pt.x, pt.y + 0.1, pt.z));
            player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        } catch (e) {
            const positions: number[] = [];
            validPoints.forEach((point: any) => positions.push(point.x, point.y + 0.1, point.z));
            player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        }
    } catch (e) {}
}

export function updatePlayerCount() { try { const el = document.getElementById('playerCount'); if (el) el.textContent = String(players.size); } catch (e) {} }

export function updatePlayerList() {
    try {
        const playerListDiv = document.getElementById('playerList');
        if (!playerListDiv) return;
        playerListDiv.innerHTML = '<h4 style="margin-top:0">Active Players</h4>';
        players.forEach((player, playerId) => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';

            const mc = utils.threeToMc(player.targetPos.x, player.targetPos.y, player.targetPos.z);
            let halfH = 1;
            try { if (player.mesh && player.mesh.geometry && player.mesh.geometry.parameters && player.mesh.geometry.parameters.height) halfH = player.mesh.geometry.parameters.height / 2; } catch (e) {}
            const mcX = mc.x; const mcY = mc.y - halfH; const mcZ = mc.z;

            playerItem.innerHTML = `...`;

            const centerBtn = playerItem.querySelector('.center-grid-btn');
            if (centerBtn) {
                centerBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    try {
                        const targetPosition = player.targetPos.clone();
                        if (window && (window as any).controls && (window as any).camera) {
                            const offset = new THREE.Vector3(20, 30, 20);
                            const newCameraPosition = targetPosition.clone().add(offset);
                            const startPos = (window as any).camera.position.clone();
                            const startTarget = (window as any).controls.target.clone();
                            const duration = 1000;
                            const startTime = Date.now();
                            function animateCamera() {
                                const elapsed = Date.now() - startTime;
                                const t = Math.min(elapsed / duration, 1);
                                const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                                (window as any).camera.position.lerpVectors(startPos, newCameraPosition, easeT);
                                (window as any).controls.target.lerpVectors(startTarget, targetPosition, easeT);
                                (window as any).controls.update();
                                if (t < 1) requestAnimationFrame(animateCamera);
                            }
                            animateCamera();
                        }
                    } catch (e) { }
                });
            }

            playerItem.onclick = (e) => {
                if ((e.target as Element).closest('.center-grid-btn')) return;
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
