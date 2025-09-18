import * as ui from './modules/ui';
import * as events from './modules/events';
import * as players from './modules/players';
import * as websocket from './modules/websocket';
import * as chunks from './modules/chunks';
import { getScene, getCamera, getRenderer, getControls, getGroundMesh, getGridHelper } from './modules/scene';

// Local references populated at init()
let scene: any, camera: any, renderer: any, controls: any, groundMesh: any, gridHelper: any, axesHelper: any;
let sessionStartTime: number | null = null;
let sessionId: string | null = null;
let totalEvents = 0;
let firstPlayerPositioned = false;

// Fetch server info on load
export async function fetchServerInfo() {
    try {
        const host = (window as any).WS_CONFIG && (window as any).WS_CONFIG.host ? (window as any).WS_CONFIG.host : window.location.hostname;
        const httpPort = (window as any).WS_CONFIG && (window as any).WS_CONFIG.httpPort ? (window as any).WS_CONFIG.httpPort : 8080;
        const base = `http://${host}:${httpPort}`;
        const response = await fetch(`${base}/api/server-info`);
        const info = await response.json();
        const connectionDiv = document.querySelector('#info div[style*="font-size:12px"]');
        if (connectionDiv) {
            connectionDiv.innerHTML = `Left-drag: Rotate | Scroll: Zoom<br>Connect: <strong>${info.connection_string}</strong>`;
        }
    } catch (error) {
        console.error('Failed to fetch server info:', error);
        try {
            const host = (window as any).WS_CONFIG && (window as any).WS_CONFIG.host ? (window as any).WS_CONFIG.host : 'localhost';
            const mcPort = (window as any).WS_CONFIG && (window as any).WS_CONFIG.mcPort ? (window as any).WS_CONFIG.mcPort : ((window as any).WS_CONFIG && (window as any).WS_CONFIG.minecraftPort ? (window as any).WS_CONFIG.minecraftPort : 19131);
            const connectionDiv = document.querySelector('#info div[style*="font-size:12px"]');
            if (connectionDiv) connectionDiv.innerHTML = `Left-drag: Rotate | Scroll: Zoom<br>Connect: <strong>/connect ${host}:${mcPort}</strong>`;
        } catch (e) { /* ignore */ }
    }
}

export function init() {
    // Scene objects are created by the scene module (bootstrap) and are available now
    scene = getScene();
    camera = getCamera();
    renderer = getRenderer();
    controls = getControls();
    groundMesh = getGroundMesh();
    gridHelper = getGridHelper();
    axesHelper = (getScene() && (getScene() as any).axesHelper) || null;

    // Ground opacity slider
    const opacitySlider = document.getElementById('groundOpacity') as HTMLInputElement | null;
    const opacityValue = document.getElementById('opacityValue');
    if (opacitySlider && opacityValue) {
        opacitySlider.addEventListener('input', (e: Event) => {
            const opacity = (e.target as HTMLInputElement).valueAsNumber / 100;
            if (groundMesh && groundMesh.material) groundMesh.material.opacity = opacity;
            opacityValue.textContent = opacity.toFixed(2);
        });
    }

    const showGroundCheckbox = document.getElementById('showGround') as HTMLInputElement | null;
    if (showGroundCheckbox) showGroundCheckbox.addEventListener('change', (e) => { if (groundMesh) groundMesh.visible = (e.target as HTMLInputElement).checked; });

    animate();

    // Wire DOM handlers
    try { ui.wireDomHandlers(); } catch (e) { console.error('failed to wire DOM handlers in init()', e); }

    // Connect WebSocket
    try {
        if (websocket && typeof websocket.connect === 'function') websocket.connect();
        else console.warn('websocket module not available; live updates disabled');
    } catch (e) { console.error('Failed to start websocket connection from init():', e); }
}

// Delegators to modules
export function addBlockEvent(type: 'place' | 'break', x: number, y: number, z: number, blockType: string, playerName: string, blockPos: any) { try { events.addBlockEvent(type, x, y, z, blockType, playerName, blockPos); } catch (e) { console.error('addBlockEvent delegation failed', e); } }
export function addEventToLog(message: string) { try { events.addEventToLog(message); } catch (e) { console.error('addEventToLog delegation failed', e); } }
export function updateEventLog() { try { events.updateEventLog(); } catch (e) { console.error('updateEventLog delegation failed', e); } }
export function clearBlocks() { try { events.clearBlocks(); } catch (e) { console.error('clearBlocks delegation failed', e); } }
export function showSaveIndicator() { try { ui.showSaveIndicator(); } catch (e) { console.error('showSaveIndicator delegation failed', e); } }
export function updateSessionInfo() { try { ui.updateSessionInfo(); } catch (e) { console.error('updateSessionInfo delegation failed', e); } }
export function parseMarkdownToHTML(text: string) { try { return ui.parseMarkdownToHTML(text); } catch (e) { console.error('parseMarkdownToHTML delegation failed', e); } return text; }
export function displayAnalysisResults(data: any) { try { ui.displayAnalysisResults(data); } catch (e) { console.error('displayAnalysisResults delegation failed', e); } }
export function downloadAssessment() { try { ui.downloadAssessment(); } catch (e) { console.error('downloadAssessment delegation failed', e); } }
export function exportSessionData() { try { ui.exportSessionData(); } catch (e) { console.error('exportSessionData delegation failed', e); } }
export async function openRubricEditor() { try { return ui.openRubricEditor(); } catch (e) { console.error('openRubricEditor delegation failed', e); } }
export function closeRubricEditor() { try { ui.closeRubricEditor(); } catch (e) { console.error('closeRubricEditor delegation failed', e); } }
export async function saveRubric() { try { return ui.saveRubric(); } catch (e) { console.error('saveRubric delegation failed', e); } }

export function createPlayer(playerId: string, playerName: string) { try { players.createPlayer(playerId, playerName); } catch (e) { console.error('createPlayer delegation failed', e); } }
export function updatePlayer(playerId: string, playerName: string, x: number, y: number, z: number) { try { players.updatePlayer(playerId, playerName, x, y, z); } catch (e) { console.error('updatePlayer delegation failed', e); } }
export function removePlayer(playerId: string) { try { players.removePlayer(playerId); } catch (e) { console.error('removePlayer delegation failed', e); } }
export function updatePlayerCount() { try { players.updatePlayerCount(); } catch (e) { console.error('updatePlayerCount delegation failed', e); } }
export function updatePlayerList() { try { players.updatePlayerList(); } catch (e) { console.error('updatePlayerList delegation failed', e); } }
export function clearPath() { try { players.clearPath(); } catch (e) { console.error('clearPath delegation failed', e); } }
export function clearPlayers() { try { players.clearPlayers(); } catch (e) { console.error('clearPlayers delegation failed', e); } }

function getPlayersMap(): Map<string, any> { return (players as any).players ? (players as any).players : (players as any); }
export function updatePathLine(player: any) { try { players.updatePathLine(player); } catch (e) { console.error('updatePathLine delegation failed', e); } }

function animate() {
    requestAnimationFrame(animate);

    try {
        // Smooth movement interpolation for all players
        getPlayersMap().forEach(player => {
            if (player.mesh && player.targetPos) player.mesh.position.lerp(player.targetPos, 0.1);
        });

        // Update path visibility
        getPlayersMap().forEach(player => updatePathLine(player));

        // Update block visibility
        const showBlocksElem = document.getElementById('showBlocks');
        const showBlocks = showBlocksElem ? (showBlocksElem as HTMLInputElement).checked : true;
        const blockEventsList = events.blockEvents || [];
        blockEventsList.forEach((event: any) => { if (event && event.mesh) event.mesh.visible = showBlocks; });

        // Update grid visibility
        const showGridElem = document.getElementById('showGrid') as HTMLInputElement | null;
        if (gridHelper) gridHelper.visible = showGridElem ? showGridElem.checked : true;

        // Update session info via UI module
        updateSessionInfo();

    } catch (err) {
        console.error('animate() error, continuing render loop:', err);
    }

    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    const cam = getCamera();
    if (cam) {
        cam.aspect = window.innerWidth / window.innerHeight;
        cam.updateProjectionMatrix();
    }
    const rend = getRenderer();
    if (rend && rend.setSize) rend.setSize(window.innerWidth, window.innerHeight);
});

init();
fetchServerInfo();

const exportButton = document.getElementById('exportButton'); if (exportButton) exportButton.disabled = true;
