// Three.js setup
let scene, camera, renderer, controls;
const players = new Map();
const playerColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
let colorIndex = 0;
const blockEvents = [];
let gridHelper;
let groundMesh;
const recentEvents = [];
let sessionStartTime = null;
let sessionId = null;
let totalEvents = 0;
let ws = null;
let firstPlayerPositioned = false;
let selectedPlayerId = null;
let gridOffset = { x: 0, y: 0, z: 0 };

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
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 200, 500);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(30, 50, 30);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Ground - now with transparency
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshLambertMaterial({ 
        color: 0x7CFC00,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide  // Visible from both sides
    });
    groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Grid
    gridHelper = new THREE.GridHelper(200, 40, 0x000000, 0x000000);
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // Add axis helper (for debugging)
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    // Setup ground opacity slider
    const opacitySlider = document.getElementById('groundOpacity');
    const opacityValue = document.getElementById('opacityValue');
    
    opacitySlider.addEventListener('input', (e) => {
        const opacity = e.target.value / 100;
        groundMesh.material.opacity = opacity;
        opacityValue.textContent = opacity.toFixed(2);
    });

    // Setup ground visibility checkbox
    const showGroundCheckbox = document.getElementById('showGround');
    showGroundCheckbox.addEventListener('change', (e) => {
        groundMesh.visible = e.target.checked;
    });

    // Start animation
    animate();
}

function showSaveIndicator() {
    const indicator = document.getElementById('saveIndicator');
    indicator.classList.add('show');
    setTimeout(() => {
        indicator.classList.remove('show');
    }, 1000);
}

function updateSessionInfo() {
    if (sessionStartTime) {
        const duration = Math.floor((Date.now() - sessionStartTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        document.getElementById('sessionDuration').textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    document.getElementById('eventCount').textContent = totalEvents;
}

function createPlayer(playerId, playerName) {
    console.log(`Creating player: ${playerName} (${playerId})`);
    
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const color = playerColors[colorIndex % playerColors.length];
    const material = new THREE.MeshLambertMaterial({ color: color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.position.y = 1;

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
        targetPos: new THREE.Vector3(),
        name: playerName || playerId,
        color: color,
        lastUpdate: Date.now(),
        path: [],
        pathLine: pathLine,
        maxPathPoints: 500 // Limit path length
    });

    scene.add(mesh);
    colorIndex++;
    
    updatePlayerCount();
    updatePlayerList();
}

function updatePlayer(playerId, playerName, x, y, z) {
    if (!players.has(playerId)) {
        createPlayer(playerId, playerName);
    }
    
    const player = players.get(playerId);
    
    // Convert Minecraft coords to Three.js coords
    const worldX = x - 200;
    const worldY = y - 80;
    const worldZ = -(z + 85);
    
    player.targetPos.set(worldX, worldY, worldZ);
    player.lastUpdate = Date.now();
    
    // Add to path if moved significantly
    if (player.path.length === 0 || 
        player.path[player.path.length - 1].distanceTo(player.targetPos) > 0.5) {
        
        player.path.push(new THREE.Vector3(worldX, worldY, worldZ));
        
        // Limit path length
        if (player.path.length > player.maxPathPoints) {
            player.path.shift();
        }
        
        // Update path line
        updatePathLine(player);
    }
    
    // Center camera on first player position
    if (!firstPlayerPositioned && players.size === 1) {
        firstPlayerPositioned = true;
        console.log(`Centering camera on first player at (${worldX}, ${worldY}, ${worldZ})`);
        
        // Set camera target to player position
        controls.target.copy(player.targetPos);
        
        // Position camera at a nice viewing angle
        const offset = new THREE.Vector3(20, 30, 20);
        const cameraPos = player.targetPos.clone().add(offset);
        camera.position.copy(cameraPos);
        
        controls.update();
    }
    
    updatePlayerList();
}

function updatePathLine(player) {
    if (!document.getElementById('showPath').checked) {
        player.pathLine.visible = false;
        return;
    }
    
    player.pathLine.visible = true;
    const positions = [];
    player.path.forEach(point => {
        positions.push(point.x, point.y + 0.1, point.z); // Slightly above ground
    });
    
    player.pathLine.geometry.setAttribute('position', 
        new THREE.Float32BufferAttribute(positions, 3));
}

function addBlockEvent(type, x, y, z, blockType, playerName, blockPos) {
    // Use the block's actual position
    const worldX = blockPos.x - 200;
    const worldY = blockPos.y - 80;
    const worldZ = -(blockPos.z + 85);
    
    // Create block visualization
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshLambertMaterial({
        color: type === 'place' ? 0x00ff00 : 0xff0000,
        transparent: true,
        opacity: 0.7
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(worldX, worldY, worldZ);
    mesh.castShadow = true;
    
    // Add wireframe
    const wireframe = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
    );
    mesh.add(wireframe);
    
    scene.add(mesh);
    
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

function addEventToLog(message) {
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

function updateEventLog() {
    const eventListDiv = document.getElementById('eventList');
    let html = '';
    
    recentEvents.forEach(event => {
        html += `<div style="margin: 2px 0;">${event.timestamp} - ${event.message}</div>`;
    });
    
    eventListDiv.innerHTML = html;
}

function removePlayer(playerId) {
    const player = players.get(playerId);
    if (player) {
        scene.remove(player.mesh);
        scene.remove(player.pathLine);
        players.delete(playerId);
        updatePlayerCount();
        updatePlayerList();
    }
}

function updatePlayerCount() {
    document.getElementById('playerCount').textContent = players.size;
}

function updatePlayerList() {
    const playerListDiv = document.getElementById('playerList');
    playerListDiv.innerHTML = '<h4 style="margin-top:0">Active Players</h4>';
    
    players.forEach((player, playerId) => {
        const playerItem = document.createElement('div');
        playerItem.className = 'player-item';
        
        // Convert back to Minecraft coordinates for display
        const mcX = player.targetPos.x + 200;
        const mcY = player.targetPos.y + 80;
        const mcZ = -(player.targetPos.z) - 85;
        
        playerItem.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; flex: 1;">
                    <div style="width: 12px; height: 12px; background-color: ${player.color}; margin-right: 8px; border-radius: 2px; flex-shrink: 0;"></div>
                    <span style="flex: 1;">${player.name} <span style="color: #888; font-size: 11px;">(${mcX.toFixed(0)}, ${mcY.toFixed(0)}, ${mcZ.toFixed(0)})</span></span>
                </div>
                <button class="center-grid-btn" onclick="centerGridOnPlayer('${playerId}')" title="Center grid on player">
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
        
        // Add click handler to focus on player (existing functionality)
        playerItem.onclick = (e) => {
            // Don't trigger if clicking the center grid button
            if (e.target.closest('.center-grid-btn')) return;
            
            // Animate camera to focus on player
            const targetPosition = player.targetPos.clone();
            controls.target.copy(targetPosition);
            
            // Move camera to a nice viewing angle
            const offset = new THREE.Vector3(20, 30, 20);
            const newCameraPosition = targetPosition.clone().add(offset);
            
            // Smooth camera transition
            const startPos = camera.position.clone();
            const startTarget = controls.target.clone();
            const duration = 1000; // 1 second
            const startTime = Date.now();
            
            function animateCamera() {
                const elapsed = Date.now() - startTime;
                const t = Math.min(elapsed / duration, 1);
                const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // Ease in-out
                
                camera.position.lerpVectors(startPos, newCameraPosition, easeT);
                controls.target.lerpVectors(startTarget, targetPosition, easeT);
                controls.update();
                
                if (t < 1) {
                    requestAnimationFrame(animateCamera);
                }
            }
            
            animateCamera();
        };
        
        playerListDiv.appendChild(playerItem);
    });
    
    if (players.size === 0) {
        playerListDiv.innerHTML += '<div style="color: #999; font-size: 13px;">No players connected</div>';
    }
}

function centerGridOnPlayer(playerId) {
    const player = players.get(playerId);
    if (!player) return;
    
    // Calculate the offset needed to center the grid on the player
    gridOffset = {
        x: player.targetPos.x,
        y: player.targetPos.y,
        z: player.targetPos.z
    };
    
    // Move the ground and grid to the new position
    if (groundMesh) {
        groundMesh.position.set(gridOffset.x, gridOffset.y, gridOffset.z);
    }
    
    if (gridHelper) {
        gridHelper.position.set(gridOffset.x, gridOffset.y, gridOffset.z);
    }
    
    // Visual feedback
    addEventToLog(`<span style="color: #4CAF50;">✓</span> Grid centered on ${player.name}`);
}

function clearPath() {
    players.forEach(player => {
        player.path = [];
        updatePathLine(player);
    });
}

function clearBlocks() {
    blockEvents.forEach(event => {
        scene.remove(event.mesh);
    });
    blockEvents.length = 0;
}

// ChatGPT Analysis Functions
async function analyzeWithChatGPT() {
    const button = document.getElementById('assessmentButton');
    const resultsDiv = document.getElementById('assessmentResults');
    const contentDiv = document.getElementById('assessmentContent');
    
    button.disabled = true;
    button.textContent = 'Analyzing...';
    
    // Show results with loading spinner
    resultsDiv.classList.add('show');
    contentDiv.innerHTML = '<div class="loading-spinner"></div><p style="text-align:center;">Analyzing player data with AI...</p>';
    
    try {
        // Send analysis request via WebSocket
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'analyze_request'
            }));
        } else {
            throw new Error('WebSocket not connected');
        }
    } catch (error) {
        contentDiv.innerHTML = `<div style="color: #f44336;">Error: ${error.message}</div>`;
        button.disabled = false;
        button.textContent = 'Analyze Players with AI';
    }
}

function displayAnalysisResults(data) {
    const button = document.getElementById('assessmentButton');
    const contentDiv = document.getElementById('assessmentContent');
    
    button.disabled = false;
    button.textContent = 'Analyze Players with AI';
    
    if (data.error) {
        contentDiv.innerHTML = `<div style="color: #f44336;">Error: ${data.error}</div>`;
        return;
    }
    
    let html = '';
    for (const [player, analysis] of Object.entries(data.analyses)) {
        html += `
            <div class="assessment-player">
                <h3>${player}</h3>
                <div class="assessment-content">${analysis}</div>
            </div>
        `;
    }
    
    if (Object.keys(data.analyses).length === 0) {
        html = '<p>No player data available for analysis.</p>';
    }
    
    contentDiv.innerHTML = html;
}

function closeAssessment() {
    document.getElementById('assessmentResults').classList.remove('show');
}

// Rubric Editor Functions
async function openRubricEditor() {
    const modal = document.getElementById('rubricEditor');
    const textarea = document.getElementById('rubricContent');
    
    // Show modal
    modal.classList.add('show');
    
    // Load current rubric
    try {
        const response = await fetch('/api/rubric');
        if (response.ok) {
            const data = await response.json();
            textarea.value = data.content;
        } else {
            textarea.value = 'Error loading rubric. Please try again.';
        }
    } catch (error) {
        console.error('Error loading rubric:', error);
        textarea.value = 'Error loading rubric. Please try again.';
    }
}

function closeRubricEditor() {
    const modal = document.getElementById('rubricEditor');
    modal.classList.remove('show');
}

async function saveRubric() {
    const textarea = document.getElementById('rubricContent');
    const content = textarea.value;
    
    try {
        const response = await fetch('/api/rubric', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: content })
        });
        
        if (response.ok) {
            // Show save indicator
            showSaveIndicator();
            closeRubricEditor();
            
            // Optional: Show success message
            addEventToLog('<span style="color: #4CAF50;">✓</span> Rubric updated successfully');
        } else {
            const error = await response.json();
            alert('Error saving rubric: ' + (error.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving rubric:', error);
        alert('Error saving rubric. Please try again.');
    }
}

// Make functions available globally
window.openRubricEditor = openRubricEditor;
window.closeRubricEditor = closeRubricEditor;
window.saveRubric = saveRubric;
window.centerGridOnPlayer = centerGridOnPlayer;

// Make functions available globally for onclick handlers
window.clearPath = clearPath;
window.clearBlocks = clearBlocks;
window.analyzeWithChatGPT = analyzeWithChatGPT;
window.closeAssessment = closeAssessment;

function animate() {
    requestAnimationFrame(animate);

    // Smooth movement interpolation for all players
    players.forEach(player => {
        if (player.mesh && player.targetPos) {
            player.mesh.position.lerp(player.targetPos, 0.1);
        }
    });

    // Update path visibility for all players
    players.forEach(player => {
        updatePathLine(player);
    });

    // Update block visibility
    const showBlocks = document.getElementById('showBlocks').checked;
    blockEvents.forEach(event => {
        event.mesh.visible = showBlocks;
    });

    // Update grid visibility
    gridHelper.visible = document.getElementById('showGrid').checked;

    // Update session info
    updateSessionInfo();

    controls.update();
    renderer.render(scene, camera);
}

// WebSocket connection to get live updates
function connectWebSocket() {
    // Use the current host for WebSocket connection
    const wsHost = window.location.hostname || 'localhost';
    ws = new WebSocket(`ws://${wsHost}:8081/live`);
    
    ws.onopen = () => {
        console.log('Connected to live updates');
        document.getElementById('wsStatus').textContent = 'Connected';
        document.getElementById('status').className = 'connected';
        document.getElementById('status').textContent = 'WebSocket Connected';
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Received:', data.type, data);
        
        if (data.type === 'session_info') {
            sessionId = data.sessionId;
            sessionStartTime = new Date(data.startTime).getTime();
            document.getElementById('sessionId').textContent = sessionId.split('_').slice(-2).join('_');
            document.getElementById('fileName').textContent = data.fileName;
        } else if (data.type === 'save_notification') {
            showSaveIndicator();
        } else if (data.type === 'position') {
            updatePlayer(data.playerId, data.playerName, data.x, data.y, data.z);
            totalEvents++;
        } else if (data.type === 'block_place') {
            addBlockEvent('place', data.x, data.y, data.z, data.blockType, data.playerName, data.blockPos);
            console.log(`Block placed: ${data.blockType} at (${data.blockPos.x}, ${data.blockPos.y}, ${data.blockPos.z})`);
            totalEvents++;
        } else if (data.type === 'block_break') {
            addBlockEvent('break', data.x, data.y, data.z, data.blockType, data.playerName, data.blockPos);
            console.log(`Block broken: ${data.blockType} at (${data.blockPos.x}, ${data.blockPos.y}, ${data.blockPos.z})`);
            totalEvents++;
        } else if (data.type === 'disconnect') {
            removePlayer(data.playerId);
            totalEvents++;
        } else if (data.type === 'analysis_result') {
            displayAnalysisResults(data);
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from live updates');
        document.getElementById('wsStatus').textContent = 'Disconnected';
        document.getElementById('status').className = 'disconnected';
        document.getElementById('status').textContent = 'WebSocket Disconnected';
        
        // Reconnect after 2 seconds
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialize
init();
fetchServerInfo();  // Fetch server info including external IP
connectWebSocket();