import { DIRS, SQ3, buildMap, cellKey, hexDist, mapChecks, type MapChecks, type MapLayout } from '../engine';
import { CORE, lab2rgb, rgb2lab, wheelColour, type RGB } from './colour';
import { K, S, angDiff, bearingOf } from './geometry';
import { WORLD, type PaperTile, type Theme, type Tile, type World } from './world';

/** Where a tile sits on one map. */
export interface Placement {
  q: number;
  r: number;
  /** Unit hex coordinates. */
  lx: number;
  ly: number;
  /** World pixels. */
  tx: number;
  ty: number;
  /** Distance from the centre, in tiles. */
  rad: number;
  /** Bearing from the centre, degrees clockwise from north. */
  ang: number;
  col: RGB;
  tier: number;
  /** The six neighbours, in DIRS order. */
  nb: (Tile | null)[];
}

export interface Marker {
  ang: number;
  name: string;
  gloss: string;
  k: number;
  dx: number;
  dy: number;
  col: RGB;
  rho: number;
  px: number;
  py: number;
}

export interface Box { x0: number; x1: number; y0: number; y1: number }

/** Everything that depends on which paper sits at the centre. */
export interface MapView {
  focal: PaperTile;
  layout: MapLayout;
  checks: MapChecks;
  /** Indexed by tile.ti. */
  at: Placement[];
  /** Theme of each tile: a paper's own, or the commonest around an open plot. */
  themeOf: Theme[];
  /** Mean colour of each theme's tiles on this map. */
  themeRgb: RGB[];
  /** Empty sea cells near the coast, in world pixels. */
  sea: { wx: number; wy: number }[];
  /** Macro-direction markers: the ends of the leading gradients. */
  markers: Marker[];
  box: Box;
}

export function buildMapView(world: World, focalId: string): MapView {
  const focal = world.byId[focalId];
  if (!focal || focal.kind !== 'paper') throw new Error(`not a paper: ${focalId}`);
  const layout = buildMap(world.I, focal.i, world.opens);
  const checks = mapChecks(world.I, layout);
  const byCell = new Map<string, Tile>();
  const at: Placement[] = world.tiles.map(t => {
    const c = t.kind === 'paper' ? layout.pos[t.i] : layout.openPos[t.n];
    const ang = bearingOf(c.x, c.y), rad = Math.hypot(c.x, c.y) / SQ3;
    byCell.set(cellKey(c.q, c.r), t);
    return {
      q: c.q, r: c.r, lx: c.x, ly: c.y, tx: S * c.x, ty: S * c.y * K, rad, ang,
      col: t === focal ? CORE.slice() as RGB : wheelColour(ang, rad),
      tier: t === focal ? 5 : t.baseTier, /* the centre is drawn as the summit whatever its elevation */
      nb: [],
    };
  });
  world.tiles.forEach(t => { const p = at[t.ti]; p.nb = DIRS.map(d => byCell.get(cellKey(p.q + d[0], p.r + d[1])) || null); });

  const themeOf: Theme[] = world.tiles.map(t => {
    if (t.kind === 'paper') return t.theme;
    const cnt = new Map<Theme, number>();
    at[t.ti].nb.forEach(n => { if (n && n.kind === 'paper') cnt.set(n.theme, (cnt.get(n.theme) || 0) + 1); });
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || world.themes[0];
  });
  const themeRgb = world.themes.map(th => {
    const lab: RGB = [0, 0, 0];
    th.members.forEach(i => { const l = rgb2lab(at[world.papers[i].ti].col); for (let k = 0; k < 3; k++) lab[k] += l[k] / th.members.length; });
    return lab2rgb(lab);
  });

  const sea: MapView['sea'] = [];
  for (let q = -12; q <= 12; q++) for (let r = -12; r <= 12; r++) {
    if (byCell.has(cellKey(q, r))) continue;
    if (at.some(p => hexDist(p, { q, r }) <= 2)) sea.push({ wx: S * 1.5 * q, wy: S * SQ3 * (r + q / 2) * K });
  }

  /* macro-direction markers: the ends of the leading gradients, wherever their papers landed together */
  const markers: Marker[] = [];
  for (const G of world.grads.slice(0, 3)) for (const [list, pole] of [[G.hi, G.plus], [G.lo, G.minus]] as const) {
    let sx = 0, sy = 0, n = 0;
    for (const i of list.slice(0, 7)) {
      const t = world.papers[i];
      if (t === focal) continue;
      const a = at[t.ti].ang * Math.PI / 180;
      sx += Math.sin(a); sy += -Math.cos(a); n++;
    }
    if (Math.hypot(sx, sy) / n < 0.7) continue;
    const ang = bearingOf(sx, sy);
    if (markers.some(m => angDiff(m.ang, ang) < 34)) continue;
    const len = Math.hypot(sx, sy);
    markers.push({ ang, name: pole.name, gloss: pole.gloss, k: G.k, dx: sx / len, dy: sy / len, col: wheelColour(ang, 5), rho: 0, px: 0, py: 0 });
  }
  for (const m of markers) {
    let ext = 0;
    for (const p of at) if (angDiff(p.ang, m.ang) <= 38) ext = Math.max(ext, p.lx * m.dx + p.ly * m.dy);
    m.rho = ext + 1.55;
    const lr = m.rho + 0.95 + 2.2 * Math.abs(m.dy);
    m.px = S * lr * m.dx;
    m.py = S * lr * m.dy * K - (1 - Math.abs(m.dy)) * 42 + (m.dy > 0.5 ? 8 : m.dy < -0.5 ? -6 : 0);
  }

  const box = at.reduce<Box>((b, p) => ({ x0: Math.min(b.x0, p.tx - S), x1: Math.max(b.x1, p.tx + S), y0: Math.min(b.y0, p.ty - S), y1: Math.max(b.y1, p.ty + S * 0.9) }), { x0: 0, x1: 0, y0: 0, y1: 0 });
  for (const m of markers) {
    box.x0 = Math.min(box.x0, m.px - 108); box.x1 = Math.max(box.x1, m.px + 108);
    box.y0 = Math.min(box.y0, m.py - 24); box.y1 = Math.max(box.y1, m.py + 22);
  }
  return { focal, layout, checks, at, themeOf, themeRgb, sea, markers, box };
}

/* one index, many maps: each is built once and kept */
const cache = new Map<string, MapView>();
export function getMapView(focalId: string): MapView {
  let v = cache.get(focalId);
  if (!v) { v = buildMapView(WORLD, focalId); cache.set(focalId, v); }
  return v;
}
