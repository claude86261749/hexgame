import { CFG } from './config';
import type { CorpusIndex } from './corpus';
import { DIRS, SQ3, cellKey, hexDist, type Cell } from './hex';
import { assign, cosSparse, hashStr, normSparse } from './math';

export interface OpenPlot { id: string; c: string[] }

export interface MapLayout {
  focal: number;
  /** Cell of each paper. */
  pos: Cell[];
  /** Cell of each open question. */
  openPos: Cell[];
  /** Diffusion distance of each paper from the focal paper. */
  dist: number[];
}

/* per map: everything that depends on the focal paper */
export function buildMap(I: CorpusIndex, focal: number, opens: OpenPlot[]): MapLayout {
  const N = I.N, X = I.xy;
  /* bearing: direction of each paper in the 2-D picture, seen from the focal paper */
  const raw: number[] = [];
  for (let i = 0; i < N; i++) raw.push(i === focal ? 0 : Math.atan2(X[i][1] - X[focal][1], X[i][0] - X[focal][0]));
  const others = [...raw.keys()].filter(i => i !== focal).sort((a, b) => raw[a] - raw[b]);
  const ang = new Float64Array(N);
  others.forEach((i, r) => {
    const even = -Math.PI + 2 * Math.PI * (r + 0.5) / others.length;
    ang[i] = raw[i] + CFG.spread * (even - raw[i]);
  });
  /* distance from the centre: rank by diffusion distance from the focal paper */
  const dist = [...raw.keys()].map(i => I.ddist(i, focal));
  const byD = others.slice().sort((a, b) => dist[a] - dist[b]);
  const R = Math.sqrt(N * 1.18 / 3) * 1.02, rho = new Float64Array(N); /* a hex disc of radius R holds about 3R^2 cells */
  byD.forEach((i, r) => { rho[i] = 0.9 + (R - 0.9) * Math.sqrt((r + 1) / others.length); });
  const tx = (i: number) => (i === focal ? 0 : rho[i] * SQ3 * Math.cos(ang[i]));
  const ty = (i: number) => (i === focal ? 0 : rho[i] * SQ3 * Math.sin(ang[i]));

  /* assignment to hex cells, then local swaps that pull strongly related papers together */
  let cells: Cell[] = [];
  const RC = Math.ceil(R) + 2;
  for (let q = -RC; q <= RC; q++) for (let r = -RC; r <= RC; r++) {
    if (hexDist({ q, r }, { q: 0, r: 0 }) <= RC) cells.push({ q, r, x: 1.5 * q, y: SQ3 * (r + q / 2) });
  }
  /* papers may only take the cells nearest the centre, so the island stays in one piece */
  cells.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y) || a.q - b.q || a.r - b.r);
  const allCells = cells;
  cells = cells.slice(0, Math.ceil(N * CFG.slack));
  const cost: Float64Array[] = [];
  for (let i = 0; i < N; i++) {
    const row = new Float64Array(cells.length), x = tx(i), y = ty(i);
    cells.forEach((c, j) => { const dx = c.x - x, dy = c.y - y; row[j] = dx * dx + dy * dy + (i === focal && (c.q || c.r) ? 1e6 : 0); });
    cost.push(row);
  }
  const at = assign(cost), pos = [...at].map(j => cells[j]);
  const occ = new Map<string, number>();
  pos.forEach((c, i) => occ.set(cellKey(c.q, c.r), i));
  const local = (i: number, c: Cell) => {
    let s = 0;
    for (const d of DIRS) { const j = occ.get(cellKey(c.q + d[0], c.r + d[1])); if (j !== undefined && j !== i) s += I.A[i][j]; }
    const dx = c.x - tx(i), dy = c.y - ty(i);
    return s - 0.02 * (dx * dx + dy * dy);
  };
  const free = new Map<string, Cell>();
  for (const c of cells) { const k = cellKey(c.q, c.r); if (!occ.has(k)) free.set(k, c); }
  for (let pass = 0; pass < 10; pass++) {
    let gain = 0;
    for (let i = 0; i < N; i++) {
      if (i === focal) continue;
      for (let j = i + 1; j < N; j++) {
        if (j === focal) continue;
        const ci = pos[i], cj = pos[j], before = local(i, ci) + local(j, cj);
        occ.set(cellKey(ci.q, ci.r), j); occ.set(cellKey(cj.q, cj.r), i);
        const after = local(i, cj) + local(j, ci);
        if (after > before + 1e-9) { pos[i] = cj; pos[j] = ci; gain += after - before; }
        else { occ.set(cellKey(ci.q, ci.r), i); occ.set(cellKey(cj.q, cj.r), j); }
      }
      for (const [k, c] of free) {
        /* only onto the coast: a cell with two papers around it, so no tile ends up offshore */
        let around = 0;
        for (const d of DIRS) { const j = occ.get(cellKey(c.q + d[0], c.r + d[1])); if (j !== undefined && j !== i) around++; }
        if (around < 2) continue;
        const ci = pos[i], before = local(i, ci);
        occ.delete(cellKey(ci.q, ci.r)); occ.set(k, i);
        const after = local(i, c);
        if (after > before + 1e-9) { pos[i] = c; free.delete(k); free.set(cellKey(ci.q, ci.r), ci); gain += after - before; }
        else { occ.delete(k); occ.set(cellKey(ci.q, ci.r), i); }
      }
    }
    if (gain < 1e-6) break;
  }

  /* open ground: the free coast cell whose neighbours best match its concepts */
  const openPos: Cell[] = [];
  for (const o of opens) {
    const ov = new Map<string, number>(o.c.map(c => [c, I.idf(c)])), on = normSparse(ov);
    const fit = I.cv.map(v => cosSparse(ov, v, on, normSparse(v)));
    let best: Cell | null = null, bs = -1;
    for (const c of allCells) {
      const k = cellKey(c.q, c.r);
      if (occ.has(k)) continue;
      const around = DIRS.map(d => occ.get(cellKey(c.q + d[0], c.r + d[1])));
      const nb = around.filter((x): x is number => x !== undefined && x >= 0);
      if (!nb.length) continue;
      if (around.some(x => x === -1)) continue; /* never next to another open plot */
      const s = nb.reduce((a, i) => a + fit[i], 0) / nb.length + (6 - nb.length) * 0.004 + (hashStr(o.id + k) % 1000) / 1e7;
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) throw new Error(`no coast cell left for open question ${o.id}`);
    occ.set(cellKey(best.q, best.r), -1);
    openPos.push(best);
  }
  return { focal, pos, openPos, dist };
}

export interface MapChecks {
  /** Share of each paper's five closest papers that lie within two hexes. */
  neighbours: number;
  /** Share of structure carried by the two leading gradients. */
  ringShare: number;
}

/* checks from section 3.8 of the spec, computed on this map */
export function mapChecks(I: CorpusIndex, M: MapLayout): MapChecks {
  let kept = 0, tot = 0;
  for (let i = 0; i < I.N; i++) for (const j of I.nbr[i].slice(0, 5)) { tot++; if (hexDist(M.pos[i], M.pos[j]) <= 2) kept++; }
  return { neighbours: kept / tot, ringShare: I.grads[0].share + I.grads[1].share };
}
