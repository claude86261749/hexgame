/** Hex radius in world pixels. */
export const S = 48;
/** Vertical squash of the isometric view. */
export const K = 0.6;
/** Height of a revealed tile at tier 0, and per tier. */
export const BASE = 10;
export const UNIT = 7;
/** Height of an uncharted tile. */
export const FOGH = 6;
/** Height of a tile once revealed. */
export const tileHeight = (tier: number) => BASE + UNIT * tier;
/** Bearing in degrees, 0 = north, clockwise. */
export const bearingOf = (x: number, y: number) => (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
export const angDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
