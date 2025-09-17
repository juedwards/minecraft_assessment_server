// chunks.js
// Responsibilities:
// - Manage chunkMeshes Map and chunkBlockGroups
// - addOrUpdateChunkMesh(scene, record), renderChunkAsBlocks(scene, record), clearAllChunkMeshes(scene), updateChunkBlockFromEvent(blockPos, action, blockType)
// - Eviction and disposal of Three.js resources

import * as utils from './utils.js';
import { getScene, getGroundMesh } from './scene.js';

// Local module state (kept independent of legacy app.js while migrating)
export const chunkMeshes = new Map();
export const chunkBlockGroups = new Map();
// Map keyed by `${dim}:${chunkX}:${chunkZ}:all:<colIdx>` -> last known blockType (from place/break events)
export const columnBlockTypes = new Map();
const blockGeomCache = new THREE.BoxGeometry(1, 1, 1);
const materialCache = new Map();
const MAX_CHUNK_MESHES = 200; // match legacy default
const CHUNK_HEIGHT_SCALE = 1.0;

export function addOrUpdateChunkMesh(record) {
    try {
        const scene = getScene();
        if (!scene) { console.warn('addOrUpdateChunkMesh: scene not ready'); return; }
        const dim = record.dimension || 'overworld';
        const cx = parseInt(record.x, 10);
        const cz = parseInt(record.z, 10);
        const cy = record.y === null || record.y === undefined ? null : parseInt(record.y, 10);
        const key = `${dim}:${cx}:${cz}:${cy === null || cy === undefined ? 'all' : cy}`;

        // If heights (and optionally pixels) exist, render top-block cubes for the chunk.
        if (record.heights && Array.isArray(record.heights)) {
            renderChunkAsBlocks(record);
        } else {
            // No heights data: create a lightweight presence marker so the chunk is tracked.
            // Use canonical MC -> Three coordinate transform for the chunk center
            const centerMcX = cx * 16 + 8;
            const centerMcY = 0;
            const centerMcZ = cz * 16 + 8;
            const center = utils.mcToThreeCoords(centerMcX, centerMcY, centerMcZ);
             if (chunkMeshes.has(key)) {
                 const old = chunkMeshes.get(key);
                 try { if (old && old.parent) old.parent.remove(old); } catch (e) {}
                 chunkMeshes.delete(key);
             }
             const marker = new THREE.Group();
             marker.position.set(center.x, center.y, center.z);
             marker.userData = { isChunkMarker: true, key };
             scene.add(marker);
             chunkMeshes.set(key, marker);
         }

        // Keep the ground placeholder visibility in sync
        try { const ground = getGroundMesh(); if (ground) ground.visible = chunkMeshes.size === 0; } catch (e) {}

        // Evict oldest chunk entries if we exceed the cache cap
        if (chunkMeshes.size > MAX_CHUNK_MESHES) {
            const it = chunkMeshes.keys();
            const oldestKey = it.next().value;
            const old = chunkMeshes.get(oldestKey);
            if (old) {
                try {
                    // If it's a Group, dispose its children first
                    if (old.children && old.children.length) {
                        old.children.forEach(c => {
                            try { if (c.geometry) c.geometry.dispose(); } catch (e) {}
                            try { if (c.material && c.material.map) c.material.map.dispose(); } catch (e) {}
                            try { if (c.material) c.material.dispose(); } catch (e) {}
                        });
                    } else {
                        try { if (old.geometry) old.geometry.dispose(); } catch (e) {}
                        try { if (old.material && old.material.map) old.material.map.dispose(); } catch (e) {}
                        try { if (old.material) old.material.dispose(); } catch (e) {}
                    }
                } catch (e) {}
                try { if (old.parent) old.parent.remove(old); } catch (e) {}
                chunkMeshes.delete(oldestKey);
            }
        }
    } catch (err) {
        console.error('chunks.addOrUpdateChunkMesh failed', err, record);
    }
}

export function renderChunkAsBlocks(record) {
    const scene = getScene();
    if (!scene) return;
    const dim = record.dimension || 'overworld';
    const cx = parseInt(record.x, 10);
    const cz = parseInt(record.z, 10);
    const cy = record.y === null || record.y === undefined ? null : parseInt(record.y, 10);
    const key = `${dim}:${cx}:${cz}:${cy === null || cy === undefined ? 'all' : cy}`;

    // Remove existing block group if present
    if (chunkBlockGroups.has(key)) {
        const g = chunkBlockGroups.get(key);
        scene.remove(g);
        chunkBlockGroups.delete(key);
    }

    const group = new THREE.Group();
    group.userData = { chunkKey: key };

    const pixels = record.pixels || [];
    const heights = record.heights || [];

    for (let rz = 0; rz < 16; rz++) {
        for (let cxp = 0; cxp < 16; cxp++) {
            const idx = rz * 16 + cxp;
            const pixelVal = pixels[idx] || 0;
            const heightVal = heights[idx] || 0;

            // Convert ARGB to hex
            let colorKey = '#000000';
            try {
                if (utils && typeof utils.argbIntToHex === 'function') {
                    colorKey = utils.argbIntToHex(pixelVal);
                } else {
                    const r = (pixelVal >> 16) & 0xFF;
                    const gcol = (pixelVal >> 8) & 0xFF;
                    const b = pixelVal & 0xFF;
                    colorKey = '#' + ((r << 16) | (gcol << 8) | b).toString(16).padStart(6, '0');
                }
            } catch (e) {
                const r = (pixelVal >> 16) & 0xFF;
                const gcol = (pixelVal >> 8) & 0xFF;
                const b = pixelVal & 0xFF;
                colorKey = '#' + ((r << 16) | (gcol << 8) | b).toString(16).padStart(6, '0');
            }

            let mat = materialCache.get(colorKey);
            if (!mat) {
                mat = new THREE.MeshLambertMaterial({ color: colorKey });
                materialCache.set(colorKey, mat);
            }

            // Compute canonical MC coordinates for this column and convert to Three coords
            const mcX = cx * 16 + cxp;
            const mcZ = cz * 16 + rz;
            const mcY = heightVal;
            const pos = utils.mcToThreeCoords(mcX, mcY, mcZ);
            const mesh = new THREE.Mesh(blockGeomCache, mat);
            mesh.position.set(pos.x, pos.y + 0.5, pos.z);
             mesh.userData = { isChunkBlock: true, chunk: key, colIdx: idx };
             group.add(mesh);
         }
     }

     scene.add(group);
     chunkBlockGroups.set(key, group);
     // Register this group's presence as the authoritative chunk geometry
     try { chunkMeshes.set(key, group); } catch (e) {}
 }

 export function updateChunkBlockFromEvent(blockPos, action, blockType) {
     const scene = getScene();
     const dim = 'overworld';
    // Use integer block coordinates for indexing (floor) to match Minecraft chunk math
    const mcX = Math.floor(blockPos.x);
    const mcY = Math.floor(blockPos.y);
    const mcZ = Math.floor(blockPos.z);

    const chunkX = Math.floor(mcX / 16);
    const chunkZ = Math.floor(mcZ / 16);
    // Normalized local coordinates in [0..15] even for negative world coords
    const localX = ((mcX % 16) + 16) % 16;
    const localZ = ((mcZ % 16) + 16) % 16;
    const idx = localZ * 16 + localX;
     const key = `${dim}:${chunkX}:${chunkZ}:` + 'all' + ':blocks';

     // The corresponding chunk plane key (without the ':blocks' suffix)
     const chunkMeshKey = `${dim}:${chunkX}:${chunkZ}:all`;

     const prefix = `${dim}:${chunkX}:${chunkZ}:`;
     let group = null;
     let groupKey = null;
     for (const [k, g] of chunkBlockGroups.entries()) {
         if (k.startsWith(prefix)) { group = g; groupKey = k; break; }
     }
     if (!group) return;

     let target = null;
     for (let i = 0; i < group.children.length; i++) {
         const c = group.children[i];
         if (c && c.userData && c.userData.colIdx === idx) { target = c; break; }
     }

     if (action === 'break') {
         if (target) group.remove(target);
         // If we've removed the last block in this group, remove the group and re-show the plane
         if (group.children.length === 0) {
             scene.remove(group);
             if (groupKey) chunkBlockGroups.delete(groupKey);
             try { if (chunkMeshes.has(chunkMeshKey)) { const m = chunkMeshes.get(chunkMeshKey); if (m && m.parent) m.parent.remove(m); chunkMeshes.delete(chunkMeshKey); } } catch (e) {}
         }
         // Remove any known blockType record for this column
        try { const colKey = `${chunkMeshKey}:${idx}`; if (columnBlockTypes.has(colKey)) columnBlockTypes.delete(colKey); } catch (e) {}
     } else if (action === 'place') {
         if (!target) {
             const colorKey = '#ffcc00';
             let mat = materialCache.get(colorKey);
             if (!mat) { mat = new THREE.MeshLambertMaterial({ color: colorKey }); materialCache.set(colorKey, mat); }
             const mesh = new THREE.Mesh(blockGeomCache, mat);
            // Compute canonical Three.js position for the placed block
             const pos = utils.mcToThreeCoords(mcX, mcY, mcZ);
             mesh.position.set(pos.x, pos.y + 0.5, pos.z);
             mesh.userData = { isChunkBlock: true, chunk: key, colIdx: idx };
             group.add(mesh);
             // Ensure the chunk presence map is updated to reference this block group
             try { chunkMeshes.set(chunkMeshKey, group); } catch (e) {}
             // Record block type for this column so other systems (player snapping) can make decisions
            try { const colKey = `${chunkMeshKey}:${idx}`; if (blockType) columnBlockTypes.set(colKey, blockType); } catch (e) {}
         }
     }

     // Track the last known blockType for this column (used by players module to avoid snapping to non-solid blocks)
     const blockTypeKey = `${dim}:${chunkX}:${chunkZ}:all:${idx}`;
     if (action === 'place' && blockType) {
         columnBlockTypes.set(blockTypeKey, blockType);
     } else if (action === 'break') {
         columnBlockTypes.delete(blockTypeKey);
     }
 }

 export function clearAllChunkMeshes() {
    const scene = getScene();
    if (!scene) return;

    // First dispose all block groups (these own the per-block meshes)
    const disposed = new Set();
    chunkBlockGroups.forEach((g, k) => {
        try {
            if (g && g.children && g.children.length) {
                g.children.forEach(c => {
                    try { if (c.geometry) c.geometry.dispose(); } catch (e) {}
                    try { if (c.material && c.material.map) c.material.map.dispose(); } catch (e) {}
                    try { if (c.material) c.material.dispose(); } catch (e) {}
                });
            }
            if (g && g.parent) g.parent.remove(g);
        } catch (e) {}
        disposed.add(g);
    });
    chunkBlockGroups.clear();

    // Dispose any remaining chunk entries (markers or other objects) that weren't handled above
    chunkMeshes.forEach((obj, k) => {
        try {
            if (disposed.has(obj)) return; // already removed
            if (obj && obj.children && obj.children.length) {
                obj.children.forEach(c => {
                    try { if (c.geometry) c.geometry.dispose(); } catch (e) {}
                    try { if (c.material && c.material.map) c.material.map.dispose(); } catch (e) {}
                    try { if (c.material) c.material.dispose(); } catch (e) {}
                });
            } else {
                try { if (obj.geometry) obj.geometry.dispose(); } catch (e) {}
                try { if (obj.material && obj.material.map) obj.material.map.dispose(); } catch (e) {}
                try { if (obj.material) obj.material.dispose(); } catch (e) {}
            }
            if (obj && obj.parent) obj.parent.remove(obj);
        } catch (e) {}
    });
    chunkMeshes.clear();

    // Dispose cached materials
    materialCache.forEach(mat => { try { mat.dispose(); } catch (e) {} });
    materialCache.clear();

    // Restore ground placeholder visibility
    try { const ground = getGroundMesh(); if (ground) ground.visible = true; } catch (e) {}
}
