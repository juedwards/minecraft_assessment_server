// chunk_mesher.js
// Simple client-side prototype to fetch per-column stacks and render blocks
// using THREE.InstancedMesh grouped by color. This is an immediate, practical
// performance improvement over creating 256 separate Mesh instances per chunk.

import * as utils from './utils.js';
import { getScene } from './scene.js';

const materialCache = new Map();
const geomCache = new THREE.BoxGeometry(1, 1, 1);

export async function fetchChunkStacks(dimension, x, z) {
    const url = `/api/chunk-stacks/${encodeURIComponent(dimension)}/${x}/${z}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch chunk stacks: ${res.status}`);
    const json = await res.json();
    return json.stacks || {};
}

function getMaterialForHex(hex) {
    let m = materialCache.get(hex);
    if (!m) {
        m = new THREE.MeshLambertMaterial({ color: hex });
        materialCache.set(hex, m);
    }
    return m;
}

export function createGroupFromStacks(dimension, chunkX, chunkZ, stacks) {
    const group = new THREE.Group();
    group.userData = { chunkKey: `${dimension}:${chunkX}:${chunkZ}` };

    // Build per-color instance lists
    const colorInstances = new Map(); // hex -> array of matrices

    for (let idx = 0; idx < 256; idx++) {
        const localX = idx % 16;
        const localZ = Math.floor(idx / 16);
        const entries = stacks[idx] || [];
        for (let e of entries) {
            // e: { y: int, pixel: int, slice_y: ... }
            const worldX = chunkX * 16 + localX;
            const worldZ = chunkZ * 16 + localZ;
            const worldY = (typeof e.y === 'number') ? e.y : (e.slice_y || 0);
            const colorHex = (utils && typeof utils.argbIntToHex === 'function') ? utils.argbIntToHex(e.pixel) : '#ffffff';

            const mat = new THREE.Matrix4();
            // Three.js uses center-based cube; place center at Y + 0.5
            mat.makeTranslation(worldX, worldY + 0.5, worldZ);

            if (!colorInstances.has(colorHex)) colorInstances.set(colorHex, []);
            colorInstances.get(colorHex).push(mat);
        }
    }

    // Create InstancedMesh per color
    for (const [hex, mats] of colorInstances.entries()) {
        const mat = getMaterialForHex(hex);
        const inst = new THREE.InstancedMesh(geomCache, mat, mats.length);
        inst.castShadow = true;
        inst.receiveShadow = true;
        for (let i = 0; i < mats.length; i++) {
            inst.setMatrixAt(i, mats[i]);
        }
        inst.userData = { isChunkMesh: true, chunk: `${dimension}:${chunkX}:${chunkZ}` };
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
    }

    return group;
}

export async function renderChunkFromCoords(dimension, chunkX, chunkZ) {
    const scene = getScene();
    if (!scene) throw new Error('scene not available');
    const stacks = await fetchChunkStacks(dimension, chunkX, chunkZ);
    const group = createGroupFromStacks(dimension, chunkX, chunkZ, stacks);
    scene.add(group);
    return group;
}

export function disposeGroup(group) {
    if (!group) return;
    group.traverse(obj => {
        if (obj.isInstancedMesh) {
            try { obj.geometry.dispose(); } catch (e) {}
            try { if (obj.material) obj.material.dispose(); } catch (e) {}
        }
    });
    if (group.parent) group.parent.remove(group);
}
