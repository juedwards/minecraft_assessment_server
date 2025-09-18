// Utility helpers for the renderer

export function chunkKey(dim: string, x: number, z: number, y: number | null) {
    return `${dim}:${x}:${z}:${y === null || y === undefined ? 'all' : y}`;
}

export function mcToThreeCoords(x: number, y: number, z: number) {
    return { x: x, y: y, z: z };
}

export function threeToMc(x: number, y: number, z: number) {
    return { x: x, y: y, z: z };
}

export function argbIntToHex(argb: number) {
    const r = (argb >> 16) & 0xFF;
    const g = (argb >> 8) & 0xFF;
    const b = argb & 0xFF;
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export {};
