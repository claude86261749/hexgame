export type Sparse = Map<string | number, number>;

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Symmetric eigen-decomposition by cyclic Jacobi rotations; fine for a few hundred papers.
 *  Returns eigenpairs sorted by eigenvalue, largest first. */
export function jacobi(S: ArrayLike<number>[]): { values: number[]; vectors: number[][] } {
  const n = S.length;
  const A = Array.from(S, r => Array.from(r));
  const V: number[][] = A.map((_, i) => A.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p][q];
      if (Math.abs(apq) < 1e-14) continue;
      const th = (A[q][q] - A[p][p]) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  const order = A.map((_, i) => i).sort((a, b) => A[b][b] - A[a][a]);
  return { values: order.map(i => A[i][i]), vectors: order.map(i => V.map(r => r[i])) };
}

/** The k largest eigenpairs of a symmetric matrix by subspace iteration with Rayleigh-Ritz:
 *  O(n^2 k) per step instead of Jacobi's O(n^3) per sweep, for maps with a few hundred papers.
 *  The matrix is shifted by +1 so that eigenvalues in [-1, 1] (a normalised affinity) are all positive. */
export function topEigs(S: ArrayLike<number>[], k: number, iters = 150): { values: number[]; vectors: number[][] } {
  const n = S.length, b = Math.min(n, k + 8);
  let seed = 12345;
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9 | 0) >>> 0) / 4294967296 - 0.5;
  let Q: Float64Array[] = Array.from({ length: b }, () => Float64Array.from({ length: n }, rnd));
  const orth = (V: Float64Array[]) => {
    for (let a = 0; a < V.length; a++) {
      for (let c = 0; c < a; c++) { let d = 0; for (let i = 0; i < n; i++) d += V[a][i] * V[c][i]; for (let i = 0; i < n; i++) V[a][i] -= d * V[c][i]; }
      let nn = 0; for (let i = 0; i < n; i++) nn += V[a][i] * V[a][i];
      nn = Math.sqrt(nn) || 1; for (let i = 0; i < n; i++) V[a][i] /= nn;
    }
    return V;
  };
  const mul = (v: Float64Array, shift: number) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) { const r = S[i]; let x = shift * v[i]; for (let j = 0; j < n; j++) x += r[j] * v[j]; out[i] = x; }
    return out;
  };
  Q = orth(Q);
  for (let it = 0; it < iters; it++) Q = orth(Q.map(v => mul(v, 1)));
  /* Rayleigh-Ritz on the subspace */
  const SQ = Q.map(v => mul(v, 0));
  const T = Q.map(u => SQ.map(w => { let d = 0; for (let i = 0; i < n; i++) d += u[i] * w[i]; return d; }));
  for (let a = 0; a < b; a++) for (let c = a + 1; c < b; c++) T[a][c] = T[c][a] = (T[a][c] + T[c][a]) / 2;
  const e = jacobi(T);
  const vectors = e.vectors.slice(0, k).map(y => { const v = new Array<number>(n).fill(0); y.forEach((w, a) => { for (let i = 0; i < n; i++) v[i] += w * Q[a][i]; }); return v; });
  return { values: e.values.slice(0, k), vectors };
}

/** Minimum-cost assignment of n rows to m >= n columns (Hungarian, O(n^2 m)).
 *  Returns, for each row, the column it gets. */
export function assign(cost: ArrayLike<number>[]): Int32Array {
  const n = cost.length, m = cost[0].length;
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1), p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(Infinity), used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = new Int32Array(n);
  for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
  return res;
}

export const normSparse = (a: Sparse) => { let s = 0; for (const w of a.values()) s += w * w; return Math.sqrt(s); };
export function cosSparse(a: Sparse, b: Sparse, na: number, nb: number): number {
  if (!na || !nb) return 0;
  let s = 0;
  const [x, y] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, w] of x) { const z = y.get(k); if (z) s += w * z; }
  return s / (na * nb);
}
