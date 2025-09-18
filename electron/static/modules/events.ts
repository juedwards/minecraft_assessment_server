declare const THREE: any;
import * as utils from './utils';
import { getScene } from './scene';

export const blockEvents: any[] = [];
export const recentEvents: any[] = [];

const _analysisHandlers: Function[] = [];
const _saveHandlers: Function[] = [];
const _sessionUpdatedHandlers: Function[] = [];

export function onAnalysisResult(cb: Function) { if (typeof cb === 'function') _analysisHandlers.push(cb); }
export function triggerAnalysisResult(data: any) { _analysisHandlers.forEach(h => { try { h(data); } catch (e) { console.error('analysis handler failed', e); } }); }

export function onSaveNotification(cb: Function) { if (typeof cb === 'function') _saveHandlers.push(cb); }
export function triggerSaveNotification() { _saveHandlers.forEach(h => { try { h(); } catch (e) {} }); }

export function onSessionUpdated(cb: Function) { if (typeof cb === 'function') _sessionUpdatedHandlers.push(cb); }
export function triggerSessionUpdated() { _sessionUpdatedHandlers.forEach(h => { try { h(); } catch (e) {} }); }

export function addBlockEvent(type: 'place' | 'break', x: number, y: number, z: number, blockType: string, playerName: string | null, blockPos: any) {
    const p = utils.mcToThreeCoords(blockPos.x, blockPos.y, blockPos.z);
    const worldX = p.x;
    const worldY = p.y;
    const worldZ = p.z;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshLambertMaterial({
        color: type === 'place' ? 0x00ff00 : 0xff0000,
        transparent: true,
        opacity: 0.7
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(worldX, worldY + 0.5, worldZ);
    mesh.castShadow = true;

    const wireframe = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
    );
    mesh.add(wireframe);

    const scene = getScene();
    if (scene) scene.add(mesh);

    blockEvents.push({ mesh, type, blockType, position: { x: worldX, y: worldY, z: worldZ }, timestamp: Date.now() });

    const iconClass = type === 'place' ? 'placed' : 'broken';
    const actionText = type === 'place' ? 'placed' : 'broke';
    addEventToLog(`<span class="event-icon ${iconClass}"></span>${playerName || 'Player'} ${actionText} ${blockType} at (${blockPos.x.toFixed(0)}, ${blockPos.y.toFixed(0)}, ${blockPos.z.toFixed(0)})`);

    const fadeOut = () => {
        mesh.material.opacity -= 0.01;
        if (mesh.material.opacity > 0.1) {
            setTimeout(fadeOut, 100);
        }
    };
    setTimeout(fadeOut, 30000);
}

export function addEventToLog(message: string) {
    recentEvents.unshift({ message, timestamp: new Date().toLocaleTimeString() });
    if (recentEvents.length > 10) recentEvents.pop();
    updateEventLog();
}

export function updateEventLog() {
    const eventListDiv = document.getElementById('eventList');
    if (!eventListDiv) return;
    let html = '';
    recentEvents.forEach(event => {
        html += `<div style="margin: 2px 0;">${event.timestamp} - ${event.message}</div>`;
    });
    eventListDiv.innerHTML = html;
}

export function clearBlocks() {
    const scene = getScene();
    blockEvents.forEach(event => {
        if (scene && event && event.mesh) scene.remove(event.mesh);
    });
    blockEvents.length = 0;
}

export {};
