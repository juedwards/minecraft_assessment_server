// events.js
// Responsibilities:
// - Manage blockEvents array and visualizations
// - addBlockEvent(), addEventToLog(), updateEventLog(), clearBlocks()

import * as utils from './utils.js';
import { getScene } from './scene.js';

export const blockEvents = [];
export const recentEvents = [];

const _analysisHandlers = [];
const _saveHandlers = [];
const _sessionUpdatedHandlers = [];

export function onAnalysisResult(cb) { if (typeof cb === 'function') _analysisHandlers.push(cb); }
export function triggerAnalysisResult(data) { _analysisHandlers.forEach(h => { try { h(data); } catch (e) { console.error('analysis handler failed', e); } }); }

export function onSaveNotification(cb) { if (typeof cb === 'function') _saveHandlers.push(cb); }
export function triggerSaveNotification() { _saveHandlers.forEach(h => { try { h(); } catch (e) {} }); }

export function onSessionUpdated(cb) { if (typeof cb === 'function') _sessionUpdatedHandlers.push(cb); }
export function triggerSessionUpdated() { _sessionUpdatedHandlers.forEach(h => { try { h(); } catch (e) {} }); }

export function addBlockEvent(type, x, y, z, blockType, playerName, blockPos) {
    // Convert Minecraft block coordinates to canonical Three.js coordinates
    const p = utils.mcToThreeCoords(blockPos.x, blockPos.y, blockPos.z);
    const worldX = p.x;
    const worldY = p.y;
    const worldZ = p.z;

    // Create block visualization
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshLambertMaterial({
        color: type === 'place' ? 0x00ff00 : 0xff0000,
        transparent: true,
        opacity: 0.7
    });
    const mesh = new THREE.Mesh(geometry, material);
    // Align block event cube to match chunk block geometry (center at pos.y + 0.5)
    mesh.position.set(worldX, worldY + 0.5, worldZ);
    mesh.castShadow = true;

    // Add wireframe
    const wireframe = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
    );
    mesh.add(wireframe);

    const scene = getScene();
    if (scene) scene.add(mesh);

    blockEvents.push({
        mesh: mesh,
        type: type,
        blockType: blockType,
        position: { x: worldX, y: worldY, z: worldZ },
        timestamp: Date.now()
    });

    // Add to event log with colored squares
    const iconClass = type === 'place' ? 'placed' : 'broken';
    const actionText = type === 'place' ? 'placed' : 'broke';
    addEventToLog(`<span class="event-icon ${iconClass}"></span>${playerName || 'Player'} ${actionText} ${blockType} at (${blockPos.x.toFixed(0)}, ${blockPos.y.toFixed(0)}, ${blockPos.z.toFixed(0)})`);

    // Fade out animation
    const fadeOut = () => {
        mesh.material.opacity -= 0.01;
        if (mesh.material.opacity > 0.1) {
            setTimeout(fadeOut, 100);
        }
    };
    setTimeout(fadeOut, 30000); // Start fading after 30 seconds
}

export function addEventToLog(message) {
    recentEvents.unshift({
        message: message,
        timestamp: new Date().toLocaleTimeString()
    });

    // Keep only last 10 events
    if (recentEvents.length > 10) {
        recentEvents.pop();
    }

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
