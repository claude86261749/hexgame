import { describe, expect, test } from 'vitest';
import { assign, cellKey, hexDist, jacobi } from '../src/engine';
import { getMapView } from '../src/world/mapView';
import { WORLD } from '../src/world/world';

describe('math', () => {
  test('jacobi recovers eigenpairs of a symmetric matrix', () => {
    const S = [[2, 1, 0], [1, 2, 0], [0, 0, 5]];
    const { values, vectors } = jacobi(S);
    expect(values.map(v => +v.toFixed(9))).toEqual([5, 3, 1]);
    for (let k = 0; k < 3; k++) {
      const v = vectors[k], Sv = S.map(r => r.reduce((s, x, j) => s + x * v[j], 0));
      Sv.forEach((x, i) => expect(x).toBeCloseTo(values[k] * v[i], 9));
    }
  });

  test('assign finds the cheapest matching', () => {
    const cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
    const at = [...assign(cost)];
    expect(new Set(at).size).toBe(3);
    expect(at.reduce((s, j, i) => s + cost[i][j], 0)).toBe(5);
  });
});

describe('world', () => {
  test('every citation points inside the corpus', () => {
    for (const p of WORLD.papers) for (const id of [...p.builds, ...p.uses, ...p.compares]) expect(WORLD.byId[id], `${p.id} → ${id}`).toBeDefined();
    for (const ex of WORLD.expeditions) for (const id of ex.steps) expect(WORLD.byId[id]?.kind).toBe('paper');
  });

  test('themes partition the papers, each with at least three', () => {
    const all = WORLD.themes.flatMap(t => t.members).sort((a, b) => a - b);
    expect(all).toEqual(WORLD.papers.map(p => p.i));
    for (const t of WORLD.themes) expect(t.members.length).toBeGreaterThanOrEqual(3);
    expect(new Set(WORLD.themes.map(t => t.name)).size).toBe(WORLD.themes.length);
  });

  test('elevations are tiers 1 to 5', () => {
    for (const p of WORLD.papers) { expect(p.e).toBeGreaterThanOrEqual(1); expect(p.e).toBeLessThanOrEqual(5); }
  });
});

describe('map', () => {
  for (const focal of ['dinov3', 'clip', 'transformer']) {
    test(`map around ${focal} is one island with the focal paper at the centre`, () => {
      const v = getMapView(focal);
      expect(v.focal.id).toBe(focal);
      const at = v.at[v.focal.ti];
      expect([at.q, at.r]).toEqual([0, 0]);
      /* one tile per cell */
      const keys = v.at.map(p => cellKey(p.q, p.r));
      expect(new Set(keys).size).toBe(WORLD.tiles.length);
      /* connected: every tile reachable from the centre through neighbours */
      const seen = new Set([v.focal.id]), stack = [v.focal.ti];
      while (stack.length) for (const n of v.at[stack.pop()!].nb) if (n && !seen.has(n.id)) { seen.add(n.id); stack.push(n.ti); }
      expect(seen.size).toBe(WORLD.tiles.length);
      /* open plots sit on the coast, never next to each other */
      for (const o of WORLD.opens) {
        const p = v.at[o.ti];
        expect(p.nb.some(n => n?.kind === 'paper')).toBe(true);
        expect(p.nb.some(n => n?.kind === 'open')).toBe(false);
      }
      /* the check from the spec: most close pairs stay within two hexes */
      expect(v.checks.neighbours).toBeGreaterThan(0.5);
      for (const p of v.at) expect(hexDist(p, { q: 0, r: 0 })).toBeLessThan(9);
    });
  }

  test('map views are cached per focal paper', () => {
    expect(getMapView('dinov3')).toBe(getMapView('dinov3'));
  });
});
