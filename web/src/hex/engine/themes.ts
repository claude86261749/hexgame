import type { CorpusIndex } from './corpus';

export interface Themes {
  /** Theme of each paper. */
  lab: Int32Array;
  /** Papers in each theme. */
  members: number[][];
  /** Soft membership of each paper in each theme. */
  soft: number[][];
}

/* themes: k-means in diffusion space, seeded farthest-first from the given paper */
export function findThemes(I: CorpusIndex, seed: number, k: number): Themes {
  const N = I.N, P = I.psi;
  const d2 = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - b[i]; s += x * x; } return s; };
  const cent = [P[seed].slice()];
  while (cent.length < k) {
    let best = 0, bd = -1;
    for (let i = 0; i < N; i++) { const m = Math.min(...cent.map(c => d2(P[i], c))); if (m > bd) { bd = m; best = i; } }
    cent.push(P[best].slice());
  }
  const lab = new Int32Array(N);
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let i = 0; i < N; i++) {
      let b = 0, bd = Infinity;
      cent.forEach((c, j) => { const x = d2(P[i], c); if (x < bd) { bd = x; b = j; } });
      if (lab[i] !== b) { lab[i] = b; moved = true; }
    }
    cent.forEach((c, j) => {
      const m = [...lab.keys()].filter(i => lab[i] === j);
      if (!m.length) return;
      for (let t = 0; t < c.length; t++) c[t] = m.reduce((s, i) => s + P[i][t], 0) / m.length;
    });
    if (!moved && it > 0) break;
  }
  /* a theme needs at least three papers: smaller groups join the theme they are most related to */
  let members = cent.map((_, j) => [...lab.keys()].filter(i => lab[i] === j));
  for (;;) {
    const small = members.findIndex(m => m.length > 0 && m.length < 3);
    if (small < 0) break;
    let best = -1, bs = -1;
    members.forEach((m, j) => {
      if (j === small || !m.length) return;
      let s = 0;
      for (const a of members[small]) for (const b of m) s += I.A[a][b];
      s /= members[small].length * m.length;
      if (s > bs) { bs = s; best = j; }
    });
    for (const i of members[small]) lab[i] = best;
    members[best] = members[best].concat(members[small]);
    members[small] = [];
  }
  const keep = members.map((_, j) => j).filter(j => members[j].length);
  const remap: Record<number, number> = {};
  keep.forEach((j, n) => (remap[j] = n));
  for (let i = 0; i < N; i++) lab[i] = remap[lab[i]];
  members = keep.map(j => members[j]);
  /* soft membership: mean affinity to each theme's members */
  const soft: number[][] = [];
  for (let i = 0; i < N; i++) {
    const m = members.map(ms => { const o = ms.filter(x => x !== i); return o.length ? o.reduce((s, x) => s + I.A[i][x], 0) / o.length : 0; });
    const e = m.map(x => Math.exp(x / 0.07)), t = e.reduce((s, x) => s + x, 0);
    soft.push(e.map(x => x / t));
  }
  return { lab, members, soft };
}
