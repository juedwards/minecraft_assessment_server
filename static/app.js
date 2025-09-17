// Three.js setup
let scene, camera, renderer, controls;
const players = new Map();
const playerColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
let colorIndex = 0;
let gridHelper;
let groundMesh;
let sessionStartTime = null;
let sessionId = null;
let totalEvents = 0;
let firstPlayerPositioned = false;
// In-memory map of rendered chunk meshes keyed by "dim:x:z:y"
// (migrated to static/modules/chunks.js)

// Optional: render each chunk as block cubes (one cube per column at the column's top block)
// (migrated to chunks module)

// Helper to build a stable key
function chunkKey(dim, x, z, y) {
    return `${dim}:${x}:${z}:${y === null || y === undefined ? 'all' : y}`;
}

// Fetch server info on load
async function fetchServerInfo() {
    try {
        const response = await fetch('/api/server-info');
        const info = await response.json();
        // Update the connection string in the UI
        const connectionDiv = document.querySelector('#info div[style*="font-size:12px"]');
        if (connectionDiv) {
            connectionDiv.innerHTML = `
                Left-drag: Rotate | Scroll: Zoom<br>
                Connect: <strong>${info.connection_string}</strong>
            `;
        }
    } catch (error) {
        console.error('Failed to fetch server info:', error);
    }
}

function init() {
    // Scene objects are created by the scene module (bootstrap) and attached to window
    scene = window.scene;
    camera = window.camera;
    renderer = window.renderer;
    controls = window.controls;
    groundMesh = window.groundMesh;
    gridHelper = window.gridHelper;
    axesHelper = window.axesHelper;

    // Setup ground opacity slider (guarded: groundMesh may be absent when using chunk data)
    const opacitySlider = document.getElementById('groundOpacity');
    const opacityValue = document.getElementById('opacityValue');
    if (opacitySlider && opacityValue) {
        opacitySlider.addEventListener('input', (e) => {
            const opacity = e.target.value / 100;
            if (groundMesh && groundMesh.material) {
                groundMesh.material.opacity = opacity;
            }
            opacityValue.textContent = opacity.toFixed(2);
        });
    }

    // Setup ground visibility checkbox (guarded)
    const showGroundCheckbox = document.getElementById('showGround');
    if (showGroundCheckbox) {
        showGroundCheckbox.addEventListener('change', (e) => {
            if (groundMesh) groundMesh.visible = e.target.checked;
        });
    }

    // Start animation
    animate();

    // Wire DOM handlers so player-list subscribers are registered before we open the websocket
    try {
        if (window && window.ui && typeof window.ui.wireDomHandlers === 'function') {
            window.ui.wireDomHandlers();
        }
    } catch (e) { console.error('failed to wire DOM handlers in init()', e); }

    // Start the live websocket connection only after the scene and renderer are initialized
    try {
        if (window.websocket && typeof window.websocket.connect === 'function') {
            window.websocket.connect();
        } else {
            console.warn('websocket module not available; live updates disabled');
        }
    } catch (e) {
        console.error('Failed to start websocket connection from init():', e);
    }
}

// Thin delegators to the events and UI modules (modules are authoritative)
function addBlockEvent(type, x, y, z, blockType, playerName, blockPos) {
    try { if (window && window.events && typeof window.events.addBlockEvent === 'function') window.events.addBlockEvent(type, x, y, z, blockType, playerName, blockPos); } catch (e) { console.error('addBlockEvent delegation failed', e); }
}

function addEventToLog(message) {
    try { if (window && window.events && typeof window.events.addEventToLog === 'function') window.events.addEventToLog(message); } catch (e) { console.error('addEventToLog delegation failed', e); }
}

function updateEventLog() {
    try { if (window && window.events && typeof window.events.updateEventLog === 'function') window.events.updateEventLog(); } catch (e) { console.error('updateEventLog delegation failed', e); }
}

function clearBlocks() {
    try { if (window && window.events && typeof window.events.clearBlocks === 'function') window.events.clearBlocks(); } catch (e) { console.error('clearBlocks delegation failed', e); }
}

function showSaveIndicator() {
    try { if (window && window.ui && typeof window.ui.showSaveIndicator === 'function') window.ui.showSaveIndicator(); } catch (e) { console.error('showSaveIndicator delegation failed', e); }
}

function updateSessionInfo() {
    try { if (window && window.ui && typeof window.ui.updateSessionInfo === 'function') window.ui.updateSessionInfo(); } catch (e) { console.error('updateSessionInfo delegation failed', e); }
}

function parseMarkdownToHTML(text) {
    try { if (window && window.ui && typeof window.ui.parseMarkdownToHTML === 'function') return window.ui.parseMarkdownToHTML(text); } catch (e) { console.error('parseMarkdownToHTML delegation failed', e); }
    return text;
}

function displayAnalysisResults(data) {
    try { if (window && window.ui && typeof window.ui.displayAnalysisResults === 'function') return window.ui.displayAnalysisResults(data); } catch (e) { console.error('displayAnalysisResults delegation failed', e); }
}

function downloadAssessment() {
    try { if (window && window.ui && typeof window.ui.downloadAssessment === 'function') return window.ui.downloadAssessment(); } catch (e) { console.error('downloadAssessment delegation failed', e); }
}

function exportSessionData() {
    try { if (window && window.ui && typeof window.ui.exportSessionData === 'function') return window.ui.exportSessionData(); } catch (e) { console.error('exportSessionData delegation failed', e); }
}

async function openRubricEditor() {
    try { if (window && window.ui && typeof window.ui.openRubricEditor === 'function') return window.ui.openRubricEditor(); } catch (e) { console.error('openRubricEditor delegation failed', e); }
}

function closeRubricEditor() {
    try { if (window && window.ui && typeof window.ui.closeRubricEditor === 'function') return window.ui.closeRubricEditor(); } catch (e) { console.error('closeRubricEditor delegation failed', e); }
}

async function saveRubric() {
    try { if (window && window.ui && typeof window.ui.saveRubric === 'function') return window.ui.saveRubric(); } catch (e) { console.error('saveRubric delegation failed', e); }
}

// Thin delegators to the players module (module is authoritative)
function createPlayer(playerId, playerName) {
    try { if (window && window.players && typeof window.players.createPlayer === 'function') { window.players.createPlayer(playerId, playerName); return; } }
    catch (e) { console.error('createPlayer delegation failed', e); }
}

function updatePlayer(playerId, playerName, x, y, z) {
    try { if (window && window.players && typeof window.players.updatePlayer === 'function') { window.players.updatePlayer(playerId, playerName, x, y, z); return; } }
    catch (e) { console.error('updatePlayer delegation failed', e); }
}

function removePlayer(playerId) {
    try { if (window && window.players && typeof window.players.removePlayer === 'function') { window.players.removePlayer(playerId); return; } }
    catch (e) { console.error('removePlayer delegation failed', e); }
}

function updatePlayerCount() {
    try { if (window && window.players && typeof window.players.updatePlayerCount === 'function') { window.players.updatePlayerCount(); return; } }
    catch (e) { console.error('updatePlayerCount delegation failed', e); }
}

function updatePlayerList() {
    try { if (window && window.players && typeof window.players.updatePlayerList === 'function') { window.players.updatePlayerList(); return; } }
    catch (e) { console.error('updatePlayerList delegation failed', e); }
}

function clearPath() {
    try { if (window && window.players && typeof window.players.clearPath === 'function') { window.players.clearPath(); return; } }
    catch (e) { console.error('clearPath delegation failed', e); }
}

function clearPlayers() {
    try { if (window && window.players && typeof window.players.clearPlayers === 'function') { window.players.clearPlayers(); return; } }
    catch (e) { console.error('clearPlayers delegation failed', e); }
}

// Legacy player helpers removed — players module is authoritative and delegators above will call it.

function centerGridOnPlayer(playerId) {
    const player = (window && window.players && window.players.players) ? window.players.players.get(playerId) : null;
    if (!player) return;

    // Calculate the offset needed to center the grid on the player
    gridOffset = {
        x: player.targetPos.x,
        y: player.targetPos.y,
        z: player.targetPos.z
    };

    // Move the ground, grid, and axes helper to the new position
    if (groundMesh) {
        groundMesh.position.set(gridOffset.x, gridOffset.y, gridOffset.z);
    }

    if (gridHelper) {
        gridHelper.position.set(gridOffset.x, gridOffset.y, gridOffset.z);
    }

    if (axesHelper) {
        axesHelper.position.set(gridOffset.x, gridOffset.y, gridOffset.z);
    }

    // Visual feedback
    addEventToLog(`<span style="color: #4CAF50;">✓</span> Grid centered on ${player.name}`);
}

// ClearPath legacy implementation removed — use the delegator `clearPath()` defined earlier which calls the players module.

// Helper to prefer players module's map when present
function getPlayersMap() {
    return (window && window.players && window.players.players) ? window.players.players : players;
}

function updatePathLine(player) {
    try { if (window && window.players && typeof window.players.updatePathLine === 'function') window.players.updatePathLine(player); } catch (e) { console.error('updatePathLine delegation failed', e); }
}

function animate() {
    requestAnimationFrame(animate);

    try {
        // Smooth movement interpolation for all players
        getPlayersMap().forEach(player => {
            if (player.mesh && player.targetPos) {
                player.mesh.position.lerp(player.targetPos, 0.1);
            }
        });

        // Update path visibility for all players
        getPlayersMap().forEach(player => {
            updatePathLine(player);
        });

        // Update block visibility (safe access to avoid null element errors)
        const showBlocksElem = document.getElementById('showBlocks');
        const showBlocks = showBlocksElem ? showBlocksElem.checked : true;
        const blockEventsList = (window && window.events && window.events.blockEvents) ? window.events.blockEvents : [];
        blockEventsList.forEach(event => {
            if (event && event.mesh) event.mesh.visible = showBlocks;
        });

        // Update grid visibility (safe access)
        const showGridElem = document.getElementById('showGrid');
        if (gridHelper) {
            gridHelper.visible = showGridElem ? showGridElem.checked : true;
        }

        // Update session info via UI module
        updateSessionInfo();

    } catch (err) {
        // Keep rendering even if a single update step fails
        console.error('animate() error, continuing render loop:', err);
    }

    // Keep controls/render outside try so we always draw something to the screen
    controls.update();
    renderer.render(scene, camera);
}

// WebSocket logic moved to `static/modules/websocket.js` — use the websocket module attached on `window`
// The legacy connectWebSocket implementation was migrated; keep a thin delegator here if needed

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialize
init();
fetchServerInfo();  // Fetch server info including external IP

// Initialize export button as disabled until session starts
const exportButton = document.getElementById('exportButton');
if (exportButton) {
    exportButton.disabled = true;
}