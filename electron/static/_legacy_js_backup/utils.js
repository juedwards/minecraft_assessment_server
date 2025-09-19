// utils.js
// Responsibilities:
// - Small helper functions: chunkKey, coordinate transforms, color conversions

export function chunkKey(dim, x, z, y) {
    return `${dim}:${x}:${z}:${y === null || y === undefined ? 'all' : y}`;
}

export function mcToThreeCoords(x, y, z) {
    // Identity mapping: use Minecraft coordinates directly in Three.js scene.
    // This returns a 1:1 mapping so other modules can use MC coords without
    // applying local offsets. Make sure the scene/camera/grid are compatible
    // with the MC origin / ranges when using this mode.
    return { x: x, y: y, z: z };
}

// Inverse helper: convert Three.js world coords back to Minecraft coordinates.
// Use this for display / UI conversions so the inverse mapping is centralized.
export function threeToMc(x, y, z) {
    // Identity inverse for 1:1 mapping
    return { x: x, y: y, z: z };
}

export function argbIntToHex(argb) {
    const r = (argb >> 16) & 0xFF;
    const g = (argb >> 8) & 0xFF;
    const b = argb & 0xFF;
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
