declare const THREE: any;
import * as utils from './utils';
import { getScene, getGroundMesh } from './scene';

export const chunkMeshes: Map<string, any> = new Map();
export const chunkBlockGroups: Map<string, any> = new Map();
export const columnBlockTypes: Map<string, any> = new Map();
const blockGeomCache = new THREE.BoxGeometry(1, 1, 1);
const materialCache: Map<string, any> = new Map();
const MAX_CHUNK_MESHES = 200;

export function addOrUpdateChunkMesh(record: any) {
    try {
        const scene = getScene();
        if (!scene) { console.warn('addOrUpdateChunkMesh: scene not ready'); return; }
        const dim = record.dimension || 'overworld';
        const cx = parseInt(record.x, 10);
        const cz = parseInt(record.z, 10);
        const cy = record.y === null || record.y === undefined ? null : parseInt(record.y, 10);
        const key = `${dim}:${cx}:${cz}:${cy === null || cy === undefined ? 'all' : cy}`;

        if (record.heights && Array.isArray(record.heights)) {
            renderChunkAsBlocks(record);
        } else {
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

        try { const ground = getGroundMesh(); if (ground) ground.visible = chunkMeshes.size === 0; } catch (e) {}

        if (chunkMeshes.size > MAX_CHUNK_MESHES) {
            const it = chunkMeshes.keys();
            const oldestKey = it.next().value;
            const old = chunkMeshes.get(oldestKey);
            if (old) {
                try {
                    if (old.children && old.children.length) {
                        old.children.forEach((c: any) => {
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

export function renderChunkAsBlocks(record: any) {
    const scene = getScene();
    if (!scene) return;
    const dim = record.dimension || 'overworld';
    const cx = parseInt(record.x, 10);
    const cz = parseInt(record.z, 10);
    const cy = record.y === null || record.y === undefined ? null : parseInt(record.y, 10);
    const key = `${dim}:${cx}:${cz}:${cy === null || cy === undefined ? 'all' : cy}`;

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

            let colorKey = '#000000';
            try {
                if (utils && typeof (utils as any).argbIntToHex === 'function') {
                    colorKey = (utils as any).argbIntToHex(pixelVal);
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
    try { chunkMeshes.set(key, group); } catch (e) {}
}

export function updateChunkBlockFromEvent(blockPos: any, action: string, blockType: any) {
    const scene = getScene();
    const dim = 'overworld';
    const mcX = Math.floor(blockPos.x);
    const mcY = Math.floor(blockPos.y);
    const mcZ = Math.floor(blockPos.z);

    const chunkX = Math.floor(mcX / 16);
    const chunkZ = Math.floor(mcZ / 16);
    const localX = ((mcX % 16) + 16) % 16;
    const localZ = ((mcZ % 16) + 16) % 16;
    const idx = localZ * 16 + localX;
    const key = `${dim}:${chunkX}:${chunkZ}:` + 'all' + ':blocks';

    const chunkMeshKey = `${dim}:${chunkX}:${chunkZ}:all`;

    const prefix = `${dim}:${chunkX}:${chunkZ}:`;
    let group: any = null;
    let groupKey: string | null = null;
    for (const [k, g] of chunkBlockGroups.entries()) {
        if (k.startsWith(prefix)) { group = g; groupKey = k; break; }
    }
    if (!group) return;

    let target: any = null;
    for (let i = 0; i < group.children.length; i++) {
        const c = group.children[i];
        if (c && c.userData && c.userData.colIdx === idx) { target = c; break; }
    }

    if (action === 'break') {
        if (target) group.remove(target);
        if (group.children.length === 0) {
            scene.remove(group);
            if (groupKey) chunkBlockGroups.delete(groupKey);
            try { if (chunkMeshes.has(chunkMeshKey)) { const m = chunkMeshes.get(chunkMeshKey); if (m && m.parent) m.parent.remove(m); chunkMeshes.delete(chunkMeshKey); } } catch (e) {}
        }
        try { const colKey = `${chunkMeshKey}:${idx}`; if (columnBlockTypes.has(colKey)) columnBlockTypes.delete(colKey); } catch (e) {}
    } else if (action === 'place') {
        if (!target) {
            const colorKey = '#ffcc00';
            let mat = materialCache.get(colorKey);
            if (!mat) { mat = new THREE.MeshLambertMaterial({ color: colorKey }); materialCache.set(colorKey, mat); }
            const mesh = new THREE.Mesh(blockGeomCache, mat);
            const pos = utils.mcToThreeCoords(mcX, mcY, mcZ);
            mesh.position.set(pos.x, pos.y + 0.5, pos.z);
            mesh.userData = { isChunkBlock: true, chunk: key, colIdx: idx };
            group.add(mesh);
            try { chunkMeshes.set(chunkMeshKey, group); } catch (e) {}
            try { const colKey = `${chunkMeshKey}:${idx}`; if (blockType) columnBlockTypes.set(colKey, blockType); } catch (e) {}
        }
    }

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

    const disposed = new Set<any>();
    chunkBlockGroups.forEach((g, k) => {
        try {
            if (g && g.children && g.children.length) {
                g.children.forEach((c: any) => {
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

    chunkMeshes.forEach((obj, k) => {
        try {
            if (disposed.has(obj)) return;
            if (obj && obj.children && obj.children.length) {
                obj.children.forEach((c: any) => {
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

    materialCache.forEach(mat => { try { mat.dispose(); } catch (e) {} });
    materialCache.clear();

    try { const ground = getGroundMesh(); if (ground) ground.visible = true; } catch (e) {}
}
