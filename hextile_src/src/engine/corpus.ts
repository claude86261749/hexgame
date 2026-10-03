import { CFG } from './config';
import { cosSparse, jacobi, normSparse, type Sparse } from './math';

/** What the engine needs from a paper. */
export interface CorpusPaper {
  id: string;
  y: number;
  c: string[];
  builds: string[];
  uses: string[];
  compares: string[];
}

export interface Gradient {
  k: number;
  lambda: number;
  /** Standardised coordinate of each paper along this gradient. */
  coord: number[];
  /** lambda^t: weight in diffusion space. */
  scale: number;
  /** Share of the kept structure. */
  share: number;
}

/** Everything that belongs to the corpus rather than to one map. */
export interface CorpusIndex {
  N: number;
  ix: Record<string, number>;
  /** Number of papers mentioning each concept. */
  df: Record<string, number>;
  idf: (c: string) => number;
  /** Concept profiles, weighted by rarity. */
  cv: Sparse[];
  /** Fused affinity, each view capped at 1: used for the graph. */
  A: Float64Array[];
  /** Fused affinity, uncapped: used to rank and to show. */
  Araw: Float64Array[];
  /** Other papers by descending raw affinity. */
  nbr: number[][];
  /** Sparse neighbour graph with glue. */
  W: number[][];
  grads: Gradient[];
  /** Diffusion coordinates. */
  psi: number[][];
  ddist: (i: number, j: number) => number;
  out: Map<number, number>[];
  inn: Map<number, number>[];
  pr: Float64Array;
  /** Elevation tier 1..5, from PageRank on who builds on whom. */
  elev: Int8Array;
  /** Recent papers nothing here has had time to build on. */
  tooNew: boolean[];
  /** 2-D picture of the diffusion distances. */
  xy: number[][];
}

const W_INTENT = { builds: 1, uses: 0.7, compares: 0.4 } as const;

/* per corpus: affinity, diffusion gradients, themes, elevation */
export function buildIndex(papers: CorpusPaper[]): CorpusIndex {
  const N = papers.length, ix: Record<string, number> = {};
  papers.forEach((p, i) => (ix[p.id] = i));

  /* view 1: concept profiles, weighted by rarity */
  const df: Record<string, number> = {};
  papers.forEach(p => p.c.forEach(c => (df[c] = (df[c] || 0) + 1)));
  const idf = (c: string) => Math.log(1 + N / (df[c] || N));
  const cv: Sparse[] = papers.map(p => new Map(p.c.map(c => [c, idf(c)])));
  const cn = cv.map(normSparse);

  /* view 2: citations. direct links, shared references, shared citers */
  const out = papers.map(() => new Map<number, number>()), inn = papers.map(() => new Map<number, number>());
  papers.forEach((p, i) => {
    for (const k of ['builds', 'uses', 'compares'] as const) for (const id of p[k]) {
      const j = ix[id];
      if (j === undefined) continue;
      out[i].set(j, W_INTENT[k]);
      inn[j].set(i, W_INTENT[k]);
    }
  });
  const on = out.map(normSparse), inorm = inn.map(normSparse);
  const simC: Float64Array[] = [], simX: Float64Array[] = [];
  for (let i = 0; i < N; i++) { simC.push(new Float64Array(N)); simX.push(new Float64Array(N)); }
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    simC[i][j] = simC[j][i] = cosSparse(cv[i], cv[j], cn[i], cn[j]);
    const direct = Math.max(out[i].get(j) || 0, out[j].get(i) || 0);
    simX[i][j] = simX[j][i] = 0.5 * direct + 0.25 * cosSparse(out[i], out[j], on[i], on[j]) + 0.25 * cosSparse(inn[i], inn[j], inorm[i], inorm[j]);
  }

  /* put the views on one scale (95th percentile of non-zero pairs), then fuse */
  const scale = (S: Float64Array[]) => {
    const v: number[] = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (S[i][j] > 0) v.push(S[i][j]);
    v.sort((a, b) => a - b);
    return v[Math.floor(v.length * 0.95)] || 1;
  };
  const sc = scale(simC), sx = scale(simX), A: Float64Array[] = [], Araw: Float64Array[] = [];
  for (let i = 0; i < N; i++) {
    A.push(new Float64Array(N)); Araw.push(new Float64Array(N));
    for (let j = 0; j < N; j++) if (i !== j) {
      A[i][j] = CFG.wConcept * Math.min(1, simC[i][j] / sc) + CFG.wCite * Math.min(1, simX[i][j] / sx);
      Araw[i][j] = CFG.wConcept * simC[i][j] / sc + CFG.wCite * simX[i][j] / sx;
    }
  }

  /* sparse neighbour graph, with a thin all-pairs glue so it stays connected */
  const nbr = Araw.map((row, i) => [...row.keys()].filter(j => j !== i).sort((a, b) => row[b] - row[a]));
  const W = A.map(r => Array.from(r, x => x * CFG.glue));
  for (let i = 0; i < N; i++) for (const j of nbr[i].slice(0, CFG.knn)) W[i][j] = W[j][i] = A[i][j];

  /* diffusion map: eigenvectors of the normalised graph are the gradients, ranked by eigenvalue */
  const d = W.map(r => r.reduce((s, x) => s + x, 0));
  const S = W.map((r, i) => r.map((x, j) => x / Math.sqrt(d[i] * d[j])));
  const eig = jacobi(S);
  const grads: Gradient[] = [];
  for (let k = 1; k <= CFG.comps; k++) {
    const lam = eig.values[k], vec = eig.vectors[k].map((x, i) => x / Math.sqrt(d[i]));
    let big = 0;
    for (const x of vec) if (Math.abs(x) > Math.abs(big)) big = x; /* fix the arbitrary sign */
    const sg = big < 0 ? -1 : 1, mean = vec.reduce((s, x) => s + x, 0) / N;
    const sd = Math.sqrt(vec.reduce((s, x) => s + (x - mean) * (x - mean), 0) / N) || 1;
    grads.push({ k, lambda: lam, coord: vec.map(x => sg * (x - mean) / sd), scale: Math.pow(lam, CFG.diffT), share: 0 });
  }
  const tot = grads.reduce((s, g) => s + g.scale, 0);
  grads.forEach(g => (g.share = g.scale / tot));
  const psi = papers.map((_, i) => grads.map(g => g.coord[i] * g.scale));
  const ddist = (i: number, j: number) => {
    let s = 0;
    for (let k = 0; k < psi[i].length; k++) { const x = psi[i][k] - psi[j][k]; s += x * x; }
    return Math.sqrt(s);
  };

  /* elevation: PageRank on who builds on whom; recent papers have had no time to be built on */
  let pr = new Float64Array(N).fill(1 / N);
  for (let it = 0; it < 60; it++) {
    const nx = new Float64Array(N).fill(0.15 / N);
    let dangling = 0;
    for (let i = 0; i < N; i++) {
      let tw = 0;
      for (const w of out[i].values()) tw += w;
      if (!tw) { dangling += pr[i]; continue; }
      for (const [j, w] of out[i]) nx[j] += 0.85 * pr[i] * w / tw;
    }
    for (let i = 0; i < N; i++) nx[i] += 0.85 * dangling / N;
    pr = nx;
  }
  const ranked = [...pr.keys()].sort((a, b) => pr[a] - pr[b]), elev = new Int8Array(N);
  const maxY = Math.max(...papers.map(p => p.y));
  ranked.forEach((i, r) => { elev[i] = 1 + Math.min(4, Math.floor(5 * r / N)); });
  const tooNew = papers.map((p, i) => p.y >= maxY - 1 && inn[i].size < 2);

  const I: CorpusIndex = { N, ix, df, idf, cv, A, Araw, nbr, W, grads, psi, ddist, out, inn, pr, elev, tooNew, xy: [] };
  I.xy = embed2d(I);
  return I;
}

/* 2-D picture of the diffusion distances (stress majorisation), started from the two leading gradients */
function embed2d(I: CorpusIndex): number[][] {
  const N = I.N, D: Float64Array[] = [];
  for (let i = 0; i < N; i++) { D.push(new Float64Array(N)); for (let j = 0; j < N; j++) D[i][j] = I.ddist(i, j); }
  let X = I.psi.map(p => [p[0], p[1]]);
  for (let it = 0; it < 200; it++) {
    const Y = X.map(() => [0, 0]);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const dx = X[i][0] - X[j][0], dy = X[i][1] - X[j][1], d = Math.hypot(dx, dy) || 1e-9, b = D[i][j] / d;
      Y[i][0] += b * dx; Y[i][1] += b * dy;
    }
    X = Y.map(p => [p[0] / N, p[1] / N]);
  }
  return X;
}
