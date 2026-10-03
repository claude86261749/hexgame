import { describe, expect, test } from 'vitest';
import * as G from '../src/game/state';
import { getMapView } from '../src/world/mapView';
import { WORLD } from '../src/world/world';

const T0 = 1000;
const nb = (s: G.GameState, id: string) => getMapView(s.focal).at[WORLD.byId[id].ti].nb.filter(Boolean).map(n => n!.id);

describe('game', () => {
  test('a fresh game has DINOv3 read and its neighbours and references revealed', () => {
    const s = G.freshGame(T0);
    expect(s.read).toEqual({ dinov3: true });
    for (const id of nb(s, 'dinov3')) expect(s.seen[id]).toBe(true);
    const d = WORLD.byId.dinov3;
    if (d.kind !== 'paper') throw new Error();
    for (const id of [...d.builds, ...d.uses]) expect(s.seen[id]).toBe(true);
    for (const id of d.compares) if (!nb(s, 'dinov3').includes(id)) expect(s.seen[id]).toBeUndefined();
    /* reveals are staggered for the canvas */
    expect(s.dueRead.dinov3).toBe(T0 + 700);
  });

  test('walking reveals neighbours but paints nothing', () => {
    const s0 = G.freshGame(T0), to = nb(s0, 'dinov3')[0];
    const s1 = G.arrive(s0, to, T0 + 2000);
    expect(s1.cur).toBe(to);
    expect(s1.steps).toBe(1);
    expect(s1.hint).toBe(false);
    for (const id of nb(s1, to)) expect(s1.seen[id]).toBe(true);
    expect(Object.keys(s1.read)).toEqual(WORLD.byId[to].kind === 'open' ? ['dinov3', to] : ['dinov3']);
    expect(s0.cur).toBe('dinov3'); /* actions do not mutate */
  });

  test('reading a whole expedition completes it once', () => {
    let s = G.freshGame(T0);
    const ex = WORLD.expeditions[0];
    const all: G.ToastEvent[] = [];
    for (const id of ex.steps) { const r = G.markRead(s, id, T0); s = r.state; all.push(...r.toasts); }
    expect(s.done[ex.id]).toBe(1);
    expect(all.filter(t => t.mode === 'exp')).toHaveLength(1);
    expect(G.markRead(s, ex.steps[0], T0).toasts).toEqual([]);
  });

  test('refocus moves the centre but keeps progress', () => {
    const s0 = G.freshGame(T0), s1 = G.refocus(s0, 'clip', T0);
    expect(s1.focal).toBe('clip');
    expect(s1.read).toEqual(s0.read);
    expect(G.refocus(s1, 'clip', T0)).toBe(s1);
    expect(G.refocus(s1, 'o-drift', T0)).toBe(s1); /* open ground cannot be a centre */
  });

  test('lifting the fog reveals every tile', () => {
    const s = G.liftFog(G.freshGame(T0), T0);
    expect(WORLD.tiles.every(t => s.seen[t.id])).toBe(true);
    expect(G.liftFog(s, T0)).toBe(s);
  });
});
