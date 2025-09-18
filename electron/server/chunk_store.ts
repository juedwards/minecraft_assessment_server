import { v4 as uuidv4 } from 'uuid';
import state from './state';
import fs from 'fs';

// In-memory store for decoded chunks: Map<key, record>
const CHUNK_STORE: Map<string, any> = new Map();
// Map requestId -> [dimension, x, z, y?]
const REQUEST_TO_COORDS: Map<string, any[]> = new Map();

const DIMENSION_MAP = new Map<number, string>([[0, 'overworld'], [1, 'nether'], [2, 'end']]);

function _normalizeDimension(dimension: any) {
  if (typeof dimension === 'number') return DIMENSION_MAP.get(dimension) || String(dimension);
  return String(dimension || 'overworld');
}

function _chunkKey(dimension: any, x: any, z: any, y: any = null) {
  const dim = _normalizeDimension(dimension);
  const ypart = (y === null || y === undefined) ? 'all' : String(y);
  return `${dim}:${x}:${z}:${ypart}`;
}

export async function requestChunk(ws: any, dimension: any, x: any, z: any, y: any = null, requestId: string | null = null) {
  if (!requestId) requestId = uuidv4();
  const dimStr = _normalizeDimension(dimension);
  REQUEST_TO_COORDS.set(requestId, [dimStr, Number(x), Number(z), (y === null || y === undefined) ? null : Number(y)]);
  const yArg = (y === null || y === undefined) ? 255 : Number(y);
  const cmd = {
    header: { version: 1, requestId, messageType: 'commandRequest', messagePurpose: 'commandRequest' },
    body: { commandLine: `getchunkdata ${dimStr} ${x} ${z} ${yArg}` }
  };
  try {
    ws.send(JSON.stringify(cmd));
    console.log(`Requested chunk ${dimStr} ${x} ${z} y=${yArg} (requestId=${requestId})`);
  } catch (err) {
    console.error('Failed to send chunk request', err);
  }
  return requestId;
}

export function decodeGetChunkData(dataStr: string) {
  const s = (dataStr || '').trim().replace(/^"|"$/g, '');
  if (!s) throw new Error('empty chunk data string');

  const elems = s.split(',').filter(e => e !== '');
  const indexToData = new Map<number, number>();
  const pixels: number[] = [];
  const heights: number[] = [];
  let curIdx = 0;

  for (const elem of elems) {
    const parts = elem.split('*');
    const token = parts[0];
    let dupCount = 0;
    if (parts.length === 2) {
      const n = parseInt(parts[1], 10);
      dupCount = Number.isNaN(n) ? 0 : n;
    }

    let value: number;
    if (token.length === 6) {
      // base64 token without padding
      try {
        const raw = Buffer.from(token + '==', 'base64');
        if (raw.length !== 4) throw new Error(`decoded base64 len ${raw.length}`);
        value = raw.readUInt32LE(0);
        indexToData.set(curIdx, value);
      } catch (err) {
        console.error('base64 decode failed for token', token, err);
        throw err;
      }
    } else {
      const refIndex = parseInt(token, 10);
      if (Number.isNaN(refIndex)) {
        throw new Error(`unexpected token: ${token}`);
      }
      if (!indexToData.has(refIndex)) {
        throw new Error(`reference to unknown index: ${refIndex}`);
      }
      value = indexToData.get(refIndex) as number;
    }

    // Extract height and ARGB (force alpha=255)
    const height = (value & 0xFF000000) >>> 24;
    const argb = ((value & 0x00FFFFFF) | 0xFF000000) >>> 0; // ensure unsigned

    for (let i = 0; i < dupCount + 1; i++) {
      pixels.push(argb);
      heights.push(height);
      curIdx += 1;
    }
  }

  if (pixels.length !== 256) {
    throw new Error(`decoded chunk length ${pixels.length} != 256`);
  }

  return { pixels, heights };
}

export function storeChunk(dimension: any, x: any, z: any, pixels: number[], heights: number[], y: any = null, requestId: string | null = null, timestamp: number | null = null) {
  const key = _chunkKey(dimension, x, z, y);
  const ts = timestamp || Date.now();
  const record = { dimension: _normalizeDimension(dimension), x: Number(x), z: Number(z), y: (y === null || y === undefined) ? null : Number(y), pixels, heights, timestamp: ts, requestId };
  CHUNK_STORE.set(key, record);
  console.log(`Stored chunk ${key} (request=${requestId})`);
  return record;
}

export function getChunk(dimension: any, x: any, z: any, y: any = null) {
  return CHUNK_STORE.get(_chunkKey(dimension, x, z, y)) || null;
}

export function handleChunkResponse(header: any = {}, body: any = {}) {
  try {
    const requestId = header.requestId || header.requestID || null;
    let dim = body.dimension || body.world || body.dimensionName || 'overworld';
    let x = body.x || body.chunkX || (body.position || {}).x;
    let z = body.z || body.chunkZ || (body.position || {}).z;
    let y = body.y || body.chunkY || (body.position || {}).y;

    if ((x === undefined || z === undefined) && requestId) {
      const coords = REQUEST_TO_COORDS.get(requestId);
      if (coords) {
        dim = coords[0]; x = coords[1]; z = coords[2]; y = coords.length > 3 ? coords[3] : null;
        REQUEST_TO_COORDS.delete(requestId);
      }
    }

    if (x === undefined || z === undefined) {
      console.warn('chunk response missing coords in body', body);
      return null;
    }

    const dataStr = body.data;
    if (!dataStr) {
      console.warn('chunk response missing data field');
      return null;
    }

    const decoded = decodeGetChunkData(dataStr);
    return storeChunk(dim, Number(x), Number(z), decoded.pixels, decoded.heights, y, requestId, Date.now());
  } catch (err) {
    console.error('error handling chunk response', err);
    return null;
  }
}

export function getPendingRequestIdsForChunk(dimension: any, x: any, z: any, y: any = null) {
  const ids: string[] = [];
  const norm = _normalizeDimension(dimension);
  for (const [reqId, coords] of REQUEST_TO_COORDS.entries()) {
    if (!coords || coords.length < 3) continue;
    const d = coords[0]; const cx = coords[1]; const cz = coords[2]; const cy = coords.length > 3 ? coords[3] : null;
    if (d === norm && cx === Number(x) && cz === Number(z) && cy === ((y === null || y === undefined) ? null : Number(y))) ids.push(reqId);
  }
  return ids;
}

export async function ensureChunkPresent(ws: any, dimension: any, x: any, z: any, y: any = null, radius: number = 0) {
  const requested: string[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const cx = Number(x) + dx; const cz = Number(z) + dz;
      if (getChunk(dimension, cx, cz, y)) continue;
      if (getPendingRequestIdsForChunk(dimension, cx, cz, y).length > 0) continue;
      try {
        const rid = await requestChunk(ws, dimension, cx, cz, y);
        requested.push(rid);
      } catch (err) {
        console.error('failed to request chunk', err);
      }
    }
  }
  return requested;
}

export function chunkHeightmap(dimension: any, x: any, z: any, y: any = null) {
  const rec = getChunk(dimension, x, z, y);
  if (!rec) throw new Error(`chunk not found: ${dimension} ${x} ${z} y=${y}`);
  const heights = rec.heights;
  if (!heights || heights.length !== 256) throw new Error('invalid heights for chunk');
  const hm: number[][] = [];
  for (let rz = 0; rz < 16; rz++) {
    const row: number[] = [];
    for (let cx = 0; cx < 16; cx++) row.push(Number(heights[rz * 16 + cx]));
    hm.push(row);
  }
  return hm;
}

export function getChunkMesh(dimension: any, x: any, z: any, y: any = null, heightScale: number = 1.0, tileScale: number = 1.0) {
  const rec = getChunk(dimension, x, z, y);
  if (!rec) throw new Error(`chunk not found: ${dimension} ${x} ${z} y=${y}`);
  const pixels = rec.pixels || [];
  const heights = rec.heights || [];
  if (heights.length !== 256 || pixels.length !== 256) throw new Error('invalid chunk data lengths');

  const vertices: number[] = [];
  const colors: number[] = [];
  for (let rz = 0; rz < 16; rz++) {
    for (let cx = 0; cx < 16; cx++) {
      const idx = rz * 16 + cx;
      const worldX = (Number(x) * 16 + cx) * tileScale;
      const worldZ = (Number(z) * 16 + rz) * tileScale;
      const h = Number(heights[idx]) * Number(heightScale);
      vertices.push(worldX, h, worldZ);
      const val = Number(pixels[idx]) >>> 0;
      const r = (val >> 16) & 0xFF;
      const g = (val >> 8) & 0xFF;
      const b = val & 0xFF;
      const a = (val >> 24) & 0xFF;
      colors.push(r, g, b, a);
    }
  }

  const indices: number[] = [];
  for (let rz = 0; rz < 15; rz++) {
    for (let cx = 0; cx < 15; cx++) {
      const tl = rz * 16 + cx;
      const tr = tl + 1;
      const bl = tl + 16;
      const br = bl + 1;
      indices.push(tl, bl, tr, tr, bl, br);
    }
  }

  return { vertices, indices, colors, chunk: { dimension: _normalizeDimension(dimension), x: Number(x), z: Number(z), y } };
}

export function saveChunkMeshObj(pathStr: string, mesh: any) {
  const verts = mesh.vertices;
  const inds = mesh.indices;
  const lines: string[] = [];
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    lines.push(`v ${x} ${y} ${z}`);
  }
  for (let i = 0; i < inds.length; i += 3) {
    const a = inds[i] + 1, b = inds[i + 1] + 1, c = inds[i + 2] + 1;
    lines.push(`f ${a} ${b} ${c}`);
  }
  fs.writeFileSync(pathStr, lines.join('\n'), { encoding: 'utf8' });
}

export function assembleSlicesToVoxels(slicePayloads: string[], yOffsets: number[]) {
  if (!Array.isArray(slicePayloads) || !Array.isArray(yOffsets) || slicePayloads.length !== yOffsets.length) throw new Error('slice_payloads and y_offsets must be same length');
  const out: Record<number, any> = {};
  for (let i = 0; i < slicePayloads.length; i++) {
    const payload = slicePayloads[i];
    const y = yOffsets[i];
    const decoded = decodeGetChunkData(payload);
    out[y] = { pixels: decoded.pixels, heights: decoded.heights };
  }
  return out;
}

