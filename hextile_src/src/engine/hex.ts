/* Axial coordinates on a flat-top hex grid. */
export interface Axial { q: number; r: number }
export interface Cell extends Axial { x: number; y: number }

export const SQ3 = Math.sqrt(3);
export const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const cellKey = (q: number, r: number) => q + ',' + r;
export const hexDist = (a: Axial, b: Axial) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
