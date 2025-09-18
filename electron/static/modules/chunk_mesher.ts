declare const THREE: any;
import * as utils from './utils';
import { getScene } from './scene';

const materialCache: Map<string, any> = new Map();
const geomCache = new THREE.BoxGeometry(1, 1, 1);

export async function fetchChunkStacks(dimension: string, x: number, z: number): Promise<any> {
    const url = `/api/chunk-stacks/${encodeURIComponent(dimension)}/${x}/${z}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch chunk stacks: ${res.status}`);
    const json = await res.json();
    return json.stacks || {};
}

function getMaterialForHex(hex: string) {
    let m = materialCache.get(hex);
    if (!m) {
        m = new THREE.MeshLambertMaterial({ color: hex });
        materialCache.set(hex, m);
    }
    return m;
}

export function createGroupFromStacks(dimension: string, chunkX: number, chunkZ: number, stacks: any) {
    const group = new THREE.Group();
    group.userData = { chunkKey: `${dimension}:${chunkX}:${chunkZ}` };

    const colorInstances: Map<string, any[]> = new Map();

    for (let idx = 0; idx < 256; idx++) {
        const localX = idx % 16;
        const localZ = Math.floor(idx / 16);
        const entries = stacks[idx] || [];
        for (const e of entries) {
            const worldX = chunkX * 16 + localX;
            const worldZ = chunkZ * 16 + localZ;
            const worldY = (typeof e.y === 'number') ? e.y : (e.slice_y || 0);
            const colorHex = (utils && typeof (utils as any).argbIntToHex === 'function') ? (utils as any).argbIntToHex(e.pixel) : '#ffffff';

            const mat = new THREE.Matrix4();
            mat.makeTranslation(worldX, worldY + 0.5, worldZ);

            if (!colorInstances.has(colorHex)) colorInstances.set(colorHex, []);
            colorInstances.get(colorHex)!.push(mat);
        }
    }

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

export async function renderChunkFromCoords(dimension: string, chunkX: number, chunkZ: number) {
    const scene = getScene();
    if (!scene) throw new Error('scene not available');
    const stacks = await fetchChunkStacks(dimension, chunkX, chunkZ);
    const group = createGroupFromStacks(dimension, chunkX, chunkZ, stacks);
    scene.add(group);
    return group;
}

export function disposeGroup(group: any) {
    if (!group) return;
    group.traverse((obj: any) => {
        if (obj.isInstancedMesh) {
            try { obj.geometry.dispose(); } catch (e) {}
            try { if (obj.material) obj.material.dispose(); } catch (e) {}
        }
    });
    if (group.parent) group.parent.remove(group);
}

export {};
