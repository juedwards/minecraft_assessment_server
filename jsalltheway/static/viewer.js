// ...existing code...

// Add persistent world storage
const worldChunks = new Map(); // Store all chunks by position key

// ...existing code...

// Update WebSocket message handling
// shim will call window.ws.onmessage or call handleIncomingMessage directly
// Keep the same message handling semantics as the original websocket module

function handleIncomingMessageObject(message) {
    switch(message.type) {
        case 'world_data':
            // Load initial world data
            console.log(`Loading ${message.data.total_chunks} chunks...`);
            message.data.chunks.forEach(chunk => {
                addChunkToWorld(chunk);
            });
            updateStats();
            break;

        case 'new_chunks':
            // Add new chunks as they're loaded
            message.chunks.forEach(chunk => {
                addChunkToWorld(chunk);
            });
            updateStats();
            break;

        // ...existing code...
    }
}

// If a legacy global ws object is present and sets onmessage, keep a small adapter
if (window.ws && typeof window.ws.onmessage === 'function') {
    // The shim will also call window.ws.onmessage when messages arrive, so nothing else to do here.
}

function addChunkToWorld(chunkData) {
    const key = `${chunkData.position[0]},${chunkData.position[1]},${chunkData.position[2]}`;
    
    // Remove old chunk if it exists
    if (worldChunks.has(key)) {
        const oldMesh = worldChunks.get(key);
        scene.remove(oldMesh);
        oldMesh.geometry.dispose();
        oldMesh.material.dispose();
    }
    
    // Create chunk mesh
    const chunkMesh = createChunkMesh(chunkData);
    if (chunkMesh) {
        worldChunks.set(key, chunkMesh);
        scene.add(chunkMesh);
    }
}

function createChunkMesh(chunkData) {
    // ...existing code...
    // (Your existing chunk mesh creation code)
}

function updateStats() {
    const statsElement = document.getElementById('stats');
    if (statsElement) {
        statsElement.textContent = `Chunks loaded: ${worldChunks.size}`;
    }
}

// ...existing code...

// Optimize rendering for large worlds
function optimizeRendering() {
    const cameraPos = camera.position;
    const renderDistance = 500; // Blocks
    
    worldChunks.forEach((mesh, key) => {
        const distance = mesh.position.distanceTo(cameraPos);
        // Use LOD or hide distant chunks
        mesh.visible = distance < renderDistance;
    });
}

// Call optimize rendering periodically
setInterval(optimizeRendering, 1000);

// ...existing code...
