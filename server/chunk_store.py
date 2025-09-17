"""Chunk request/decoding/storage helpers.

This module provides functions to request a specific chunk from a connected
Minecraft websocket client, decode the compact getchunkdata response and store
decoded tiles in an in-memory dictionary keyed by (dimension,chunkX,chunkZ).

Example developer usage and notes:
- Use `decode_getchunkdata(data_str)` to obtain `(pixels, heights)` lists of
  length 256 for a 16×16 chunk.
  
Note: this module focuses on top-block pixel/heights payloads. For
performance-sensitive clients we avoid generating PNGs or embedding large
base64 images; instead chunk payloads are stored as compact numeric arrays
and there are helpers to pack/unpack compact binary representations.

For developer inspection, run `python server/scripts/decode_chunk_sample.py`
to decode a sample payload, print statistics, and write a compact binary sample at
`data/sample_chunk.bin` for consumption by optimized clients.
"""

import base64
import struct
import json
import time
import io
import logging
from uuid import uuid4
from typing import Tuple, List, Dict, Optional

logger = logging.getLogger(__name__)

# In-memory store for decoded chunks
# key: "{dimension}:{x}:{z}" -> value: dict with pixels, heights, timestamp, request_id
CHUNK_STORE: Dict[str, Dict] = {}

# Map outstanding requestId -> (dimension, x, z, y)
REQUEST_TO_COORDS: Dict[str, Tuple[str, int, int, Optional[int]]] = {}

# Map integer dimension ids to command-string names
DIMENSION_MAP = {0: 'overworld', 1: 'nether', 2: 'end'}


def _normalize_dimension(dimension) -> str:
    """Return a normalized string dimension name usable in commands and keys.

    Accepts either an int id or string and returns a string.
    """
    if isinstance(dimension, int):
        return DIMENSION_MAP.get(dimension, str(dimension))
    return str(dimension)


def _chunk_key(dimension: str, x: int, z: int, y: Optional[int] = None) -> str:
    """Build a stable key for a chunk + optional Y coordinate.

    If y is None we use the literal 'all' to indicate no Y-slice specified.
    """
    # normalize dimension to avoid mismatches when callers pass numeric ids
    dim_str = _normalize_dimension(dimension)
    y_part = str(y) if y is not None else 'all'
    return f"{dim_str}:{x}:{z}:{y_part}"


async def request_chunk(websocket, dimension: str, x: int, z: int, y: Optional[int] = None, request_id: Optional[str] = None) -> str:
    """Send a getchunkdata command over the provided Minecraft websocket.

    Returns the requestId used (generated if not provided). Records the mapping
    so incoming responses that only include the requestId can be matched to
    the original requested chunk coordinates.
    """
    if request_id is None:
        request_id = str(uuid4())
    # record normalized dimension and requested coords (including optional y)
    dim_str = _normalize_dimension(dimension)
    REQUEST_TO_COORDS[request_id] = (dim_str, int(x), int(z), int(y) if y is not None else None)
    # choose the Y argument for the command; default to 255 when not specified
    y_arg = int(y) if y is not None else 255
    cmd = {
        'header': {
            'version': 1,
            'requestId': request_id,
            'eventName': 'ChunkDataRequest',
            'messageType': 'commandRequest',
            'messagePurpose': 'commandRequest'
        },
        'body': {
            'commandLine': f'getchunkdata {dim_str} {x} {z} {y_arg}'
        }
    }
    await websocket.send(json.dumps(cmd))
    logger.info(f"Requested chunk {dimension} {x} {z} with requestId={request_id}")
    return request_id


def decode_getchunkdata(data_str: str) -> Tuple[List[int], List[int]]:
    """Decode the compact getchunkdata 'data' string into two lists:
    - pixels: list of 256 ARGB integers (alpha forced to 255)
    - heights: list of 256 integer heights (0-255, taken from the MSB)

    Tokens are either 6-char base64 values (little-endian uint32) or integer
    references to previous indices. Tokens can be followed by "*N" to indicate
    repeats. This function now includes improved error handling and logging so
    malformed payloads provide helpful diagnostics.
    """
    s = (data_str or "").strip().strip('"')
    if s == "":
        raise ValueError("empty chunk data string")

    elems = [e for e in s.split(',') if e != '']

    index_to_data: Dict[int, int] = {}
    pixels: List[int] = []
    heights: List[int] = []
    cur_idx = 0

    for elem in elems:
        parts = elem.split('*')
        token = parts[0]
        # token*N means N duplicates -> total N+1 instances
        try:
            dup_count = int(parts[1]) if len(parts) == 2 else 0
            if dup_count < 0:
                raise ValueError
        except ValueError:
            logger.warning('Invalid repeat count in token %r -> %r', elem, parts[1] if len(parts) > 1 else None)
            dup_count = 0

        try:
            if len(token) == 6:
                # 6-char base64 without padding; add '==' then decode to 4 bytes (little-endian uint32)
                try:
                    raw = base64.b64decode(token + '==')
                except Exception as e:
                    logger.exception('base64 decode failed for token %r', token)
                    raise ValueError(f"invalid base64 token: {token}") from e
                if len(raw) != 4:
                    logger.error('decoded base64 length unexpected for token %r: %d bytes', token, len(raw))
                    raise ValueError(f"invalid base64 token length for {token}")
                value = struct.unpack('<I', raw)[0]
                index_to_data[cur_idx] = value
            else:
                # token is an index referring to a previous element
                try:
                    ref_index = int(token)
                except ValueError:
                    logger.error('Unexpected token format (not 6-char base64 nor integer index): %r', token)
                    raise ValueError(f"unexpected token: {token}")
                if ref_index not in index_to_data:
                    logger.error('Reference to unknown index %d at element %r (cur_idx=%d)', ref_index, elem, cur_idx)
                    raise IndexError(f"reference to unknown index: {ref_index}")
                value = index_to_data[ref_index]

            # Extract height (MSB) and ARGB (force alpha=255)
            height = (value & 0xFF000000) >> 24
            argb = (value & 0x00FFFFFF) | 0xFF000000  # force alpha=255

            for _ in range(dup_count + 1):
                pixels.append(argb)
                heights.append(height)
                cur_idx += 1
        except Exception:
            logger.exception('Error decoding element %r at position %d', elem, cur_idx)
            raise

    if len(pixels) != 256:
        raise ValueError(f"decoded chunk length {len(pixels)} != 256 (expected one 16x16 chunk)")

    return pixels, heights


def store_chunk(dimension: str, x: int, z: int, pixels: List[int], heights: List[int], y: Optional[int] = None, request_id: Optional[str] = None, timestamp: Optional[float] = None) -> Dict:
    """Store a decoded chunk into CHUNK_STORE.

    Returns the stored record dict. PNG generation and base64 are no longer
    performed by this function; that data was removed to avoid large payloads
    being broadcast over websockets.
    """
    key = _chunk_key(dimension, x, z, y)
    if timestamp is None:
        timestamp = time.time()

    record = {
        'dimension': _normalize_dimension(dimension),
        'x': int(x),
        'z': int(z),
        'y': int(y) if y is not None else None,
        'pixels': pixels,
        'heights': heights,
        'timestamp': timestamp,
        'request_id': request_id,
    }

    # Do not generate or store PNGs here; keep the stored data compact.

    CHUNK_STORE[key] = record
    logger.info(f"Stored chunk {key} (request={request_id})")
    return record


def get_chunk(dimension: str, x: int, z: int, y: Optional[int] = None) -> Optional[Dict]:
    return CHUNK_STORE.get(_chunk_key(dimension, x, z, y))


def handle_chunk_response(header: Dict, body: Dict) -> Optional[Dict]:
    """Convenience helper to decode and store a chunk response.

    Attempts to extract chunk coordinates from common body keys and decode the
    compact 'data' payload. Returns the stored record or None if it cannot
    decode.
    """
    try:
        request_id = header.get('requestId') or header.get('requestID')
        # Extract coords robustly from common fields
        dim = body.get('dimension') or body.get('world') or body.get('dimensionName') or 'overworld'
        x = body.get('x') or body.get('chunkX') or (body.get('position') or {}).get('x')
        z = body.get('z') or body.get('chunkZ') or (body.get('position') or {}).get('z')
        y = body.get('y') or body.get('chunkY') or (body.get('position') or {}).get('y')

        # If the response doesn't include explicit coords, try looking them up
        # from the requestId we recorded earlier. The mapping may include a Y
        # coordinate as the fourth element.
        if (x is None or z is None or y is None) and request_id:
            coords = REQUEST_TO_COORDS.pop(request_id, None)
            if coords:
                # coords may be (dimension, x, z) or (dimension, x, z, y)
                if len(coords) >= 4:
                    dim, x, z, y = coords[0], coords[1], coords[2], coords[3]
                else:
                    dim, x, z = coords[0], coords[1], coords[2]
                    y = None

        if x is None or z is None:
            logger.warning('chunk response missing coords in body: %s', body)
            return None

        # Some payloads place data under 'data' as a string
        data_str = body.get('data')
        if data_str is None:
            logger.warning('chunk response missing data field')
            return None

        pixels, heights = decode_getchunkdata(data_str)
        return store_chunk(dim, int(x), int(z), pixels, heights, y=y, request_id=request_id)
    except Exception:
        logger.exception('error handling chunk response')
        return None


def get_pending_request_ids_for_chunk(dimension: str, x: int, z: int, y: Optional[int] = None) -> list:
    """Return list of requestIds that are currently outstanding for the exact chunk+y.

    Handles both older stored tuples that were 3-elements (dimension,x,z)
    and the newer 4-element form (dimension,x,z,y).
    """
    ids = []
    norm_dim = _normalize_dimension(dimension)
    for req_id, coords in REQUEST_TO_COORDS.items():
        # coords may be stored as (dim, x, z) or (dim, x, z, y)
        if not coords or len(coords) < 3:
            continue
        dim_val = coords[0]
        x_val = coords[1]
        z_val = coords[2]
        y_val = coords[3] if len(coords) > 3 else None
        if dim_val == norm_dim and x_val == x and z_val == z and y_val == (int(y) if y is not None else None):
            ids.append(req_id)
    return ids


async def ensure_chunk_present(websocket, dimension: str, x: int, z: int, y: Optional[int] = None, radius: int = 0) -> list:
    """Ensure the requested chunk (and optional surrounding radius) are present in CHUNK_STORE.

    For any missing chunk (exact y slice) this will issue a request via
    request_chunk and return the list of requestIds that were sent. It will not
    re-request chunks that are already present or already outstanding.
    """
    requested_ids = []
    for dx in range(-radius, radius + 1):
        for dz in range(-radius, radius + 1):
            cx = int(x) + dx
            cz = int(z) + dz
            # Skip if we already have the chunk for the exact y
            if get_chunk(dimension, cx, cz, y=y):
                continue
            # Skip if there's already a pending request for this exact chunk+y
            if get_pending_request_ids_for_chunk(dimension, cx, cz, y):
                continue
            # Send a request and record the id
            try:
                rid = await request_chunk(websocket, dimension, cx, cz, y=y)
                requested_ids.append(rid)
            except Exception:
                logger.exception('failed to request chunk %s %s %s y=%s', dimension, cx, cz, y)
    return requested_ids


def chunk_heightmap(dimension: str, x: int, z: int, y: Optional[int] = None) -> List[List[int]]:
    """Return a 16×16 heightmap (rows=z, cols=x) for a stored chunk.

    Raises KeyError if the chunk is not present in CHUNK_STORE.
    """
    rec = get_chunk(dimension, x, z, y=y)
    if not rec:
        raise KeyError(f"chunk not found: {dimension} {x} {z} y={y}")
    heights = rec.get('heights')
    if not heights or len(heights) != 256:
        raise ValueError('invalid heights for chunk')
    # Build 2D list: [row_z][col_x]
    hm = []
    for rz in range(16):
        row = []
        for cx in range(16):
            row.append(int(heights[rz * 16 + cx]))
        hm.append(row)
    return hm


def get_chunk_mesh(dimension: str, x: int, z: int, y: Optional[int] = None, height_scale: float = 1.0, tile_scale: float = 1.0) -> Dict:
    """Return a simple mesh representation for the chunk.

    Mesh is returned as a dict with keys:
      - vertices: flat list [x,y,z,...]
      - indices: triangle index list (0-based)
      - colors: flat RGBA list [r,g,b,a,...] per vertex (0-255)
    Coordinates use world-space with one vertex per column (no skirt or walls).
    """
    rec = get_chunk(dimension, x, z, y=y)
    if not rec:
        raise KeyError(f"chunk not found: {dimension} {x} {z} y={y}")

    pixels = rec.get('pixels', [])
    heights = rec.get('heights', [])
    if len(heights) != 256 or len(pixels) != 256:
        raise ValueError('invalid chunk data lengths')

    vertices = []
    colors = []
    # vertex per column in chunk: iterate z (row), then x (col)
    for rz in range(16):
        for cx in range(16):
            idx = rz * 16 + cx
            world_x = (int(x) * 16 + cx) * tile_scale
            world_z = (int(z) * 16 + rz) * tile_scale
            h = float(heights[idx]) * float(height_scale)
            vertices.extend([world_x, h, world_z])
            val = int(pixels[idx])
            r = (val >> 16) & 0xFF
            g = (val >> 8) & 0xFF
            b = val & 0xFF
            a = (val >> 24) & 0xFF
            colors.extend([r, g, b, a])

    indices = []
    # Triangulate the 16x16 grid
    for rz in range(15):
        for cx in range(15):
            tl = rz * 16 + cx
            tr = tl + 1
            bl = tl + 16
            br = bl + 1
            # two triangles: (tl, bl, tr) and (tr, bl, br)
            indices.extend([tl, bl, tr, tr, bl, br])

    return {'vertices': vertices, 'indices': indices, 'colors': colors, 'chunk': {'dimension': _normalize_dimension(dimension), 'x': int(x), 'z': int(z), 'y': y}}


def save_chunk_mesh_obj(path: str, mesh: Dict):
    """Write a Wavefront OBJ file from a mesh dict returned by get_chunk_mesh()."""
    verts = mesh['vertices']
    inds = mesh['indices']
    # Write as triangles
    lines = []
    for i in range(0, len(verts), 3):
        x, y, z = verts[i], verts[i+1], verts[i+2]
        lines.append(f"v {x} {y} {z}")
    # faces: indices are 0-based; OBJ is 1-based
    for i in range(0, len(inds), 3):
        a = inds[i] + 1
        b = inds[i+1] + 1
        c = inds[i+2] + 1
        lines.append(f"f {a} {b} {c}")

    with open(path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines))


def assemble_slices_to_voxels(slice_payloads: List[str], y_offsets: List[int]) -> Dict[int, Dict]:
    """Assemble multiple compact slice payload strings into a mapping of y_offset -> decoded slice.

    This is a light-weight helper (placeholder) that decodes each given slice string
    using `decode_getchunkdata` and returns a dict mapping the provided y offset
    to the decoded `{ 'pixels': [...], 'heights': [...] }` structure. The function
    does not attempt to produce a full 3D voxel array yet — it is a first step for
    supporting multi-slice assembly.
    """
    if len(slice_payloads) != len(y_offsets):
        raise ValueError('slice_payloads and y_offsets must be same length')

    out: Dict[int, Dict] = {}
    for payload, y in zip(slice_payloads, y_offsets):
        pixels, heights = decode_getchunkdata(payload)
        out[int(y)] = {'pixels': pixels, 'heights': heights}
    return out


def pack_chunk_binary(pixels: List[int], heights: List[int]) -> bytes:
    """Pack pixels/heights into a compact binary blob.

    Format (simple prototype):
      - 4 bytes magic: b'CHNK'
      - 2 bytes version: uint16 (1)
      - 256 * uint32 pixels (little-endian)
      - 256 * uint8 heights
    """
    if len(pixels) != 256 or len(heights) != 256:
        raise ValueError('pixels and heights must be length 256')
    out = io.BytesIO()
    out.write(b'CHNK')
    out.write(struct.pack('<H', 1))
    for p in pixels:
        out.write(struct.pack('<I', int(p) & 0xFFFFFFFF))
    for h in heights:
        out.write(struct.pack('<B', int(h) & 0xFF))
    return out.getvalue()


def unpack_chunk_binary(blob: bytes) -> Dict[str, List[int]]:
    """Unpack the format produced by pack_chunk_binary.

    Returns a dict with 'pixels' and 'heights'.
    """
    buf = memoryview(blob)
    if len(buf) < 4 + 2 + 256*4 + 256:
        raise ValueError('binary blob too small to contain chunk')
    magic = bytes(buf[0:4]).decode('ascii', errors='ignore')
    if magic != 'CHNK':
        raise ValueError('invalid chunk magic')
    version = struct.unpack_from('<H', buf, 4)[0]
    if version != 1:
        raise ValueError('unsupported version')
    offset = 6
    pixels = []
    for i in range(256):
        val = struct.unpack_from('<I', buf, offset)[0]
        pixels.append(int(val))
        offset += 4
    heights = []
    for i in range(256):
        heights.append(int(buf[offset]))
        offset += 1
    return {'pixels': pixels, 'heights': heights}


def assemble_chunk_column_stacks(dimension: str, x: int, z: int) -> Dict[int, List[Dict]]:
    """Return a mapping colIdx -> list of { 'y': int, 'pixel': int } sorted by Y.

    Scans entries in CHUNK_STORE for the given chunk coordinates across any Y
    slices and collects per-column top-block entries. This does not attempt to
    reconstruct every interior block — it collects the reported top entries
    present in stored slices (which is the format currently provided by the
    Minecraft client). The returned mapping is useful to produce a vertical
    stack of non-air tops for rendering/analysis.
    """
    prefix = f"{_normalize_dimension(dimension)}:{int(x)}:{int(z)}:"
    stacks: Dict[int, List[Dict]] = {i: [] for i in range(256)}
    for key, rec in CHUNK_STORE.items():
        if not key.startswith(prefix):
            continue
        # Each rec should contain 'heights' and 'pixels' arrays
        heights = rec.get('heights') or []
        pixels = rec.get('pixels') or []
        # optional reported y slice metadata
        slice_y = rec.get('y')
        for idx in range(min(len(heights), len(pixels), 256)):
            h = int(heights[idx])
            p = int(pixels[idx])
            # store the reported absolute height (or slice metadata if present)
            stacks[idx].append({'y': h, 'pixel': p, 'slice_y': slice_y})
    # Sort each stack by y ascending
    for k, arr in stacks.items():
        arr.sort(key=lambda e: e['y'])
    return stacks
