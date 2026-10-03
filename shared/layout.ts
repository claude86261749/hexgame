// Deterministic layout for every diagram type. Pure functions, shared by the server lint and the web renderer.
// Canvas is 560 wide (as in the prototype); height grows with content.
import type { Diagram, FlowSpec, CompareSpec, MatrixSpec, ChartSpec, PipelineSpec, LandscapeSpec, FreeSpec, Detail } from './schema.ts';
import { textW, wrap, maxLineW } from './text.ts';

export const W = 560, PAD = 16;
export interface Box { x: number; y: number; w: number; h: number }
export const union = (bs: Box[]): Box => {
  const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y));
  return { x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y };
};
export const intersects = (a: Box, b: Box, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
export const rnd = (a: number, b: number, c: number) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

interface Area { x: number; y: number; w: number }
export interface Base { w: number; h: number; anchors: Record<string, Box>; issues: string[]; obstacles: Box[] }

/* =================================================================== flow */
/** Sample a 'M x,y C x,y x,y x,y' path. */
function bez(d: string): [number, number][] {
  const n = d.match(/-?[\d.]+/g)!.map(Number); if (n.length < 8) return [];
  const [x0, y0, x1, y1, x2, y2, x3, y3] = n, out: [number, number][] = [];
  for (let t = 0.08; t < 0.93; t += 0.06) { const u = 1 - t; out.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]); }
  return out;
}
type Stepped<T> = T & { step?: number };
type FlowBody = { direction: FlowSpec['direction']; nodes: Stepped<FlowSpec['nodes'][number]>[]; edges: Stepped<FlowSpec['edges'][number]>[]; groups?: FlowSpec['groups'] };
export interface FlowNodeL { id: string; box: Box; lines: string[]; sub: string[]; kind: string; step?: number }
export interface FlowEdgeL { from: string; to: string; d: string; label?: string; lx: number; ly: number; dashed?: boolean; step?: number }
export interface FlowL { nodes: FlowNodeL[]; edges: FlowEdgeL[]; groups: { id: string; label: string; box: Box }[]; bottom: number }

export function layoutFlow(spec: FlowBody, area: Area, issues: string[], anchors: Record<string, Box>): FlowL {
  const ids = new Set(spec.nodes.map(n => n.id));
  const edges = spec.edges.filter(e => {
    const ok = ids.has(e.from) && ids.has(e.to) && e.from !== e.to;
    if (!ok) issues.push(`edge ${e.from}→${e.to} references a missing node`);
    return ok;
  });
  // layering: longest path over a DFS order that ignores back edges
  const out = new Map<string, string[]>(); spec.nodes.forEach(n => out.set(n.id, []));
  edges.forEach(e => out.get(e.from)!.push(e.to));
  const state = new Map<string, number>(), order: string[] = [], back = new Set<string>();
  const dfs = (v: string) => { state.set(v, 1); for (const u of out.get(v)!) { if (state.get(u) === 1) back.add(v + '>' + u); else if (!state.get(u)) dfs(u); } state.set(v, 2); order.push(v); };
  spec.nodes.forEach(n => { if (!state.get(n.id)) dfs(n.id); });
  order.reverse();
  const layer = new Map<string, number>(order.map(v => [v, 0]));
  for (const v of order) for (const u of out.get(v)!) if (!back.has(v + '>' + u)) layer.set(u, Math.max(layer.get(u)!, layer.get(v)! + 1));
  const L = Math.max(...layer.values()) + 1;
  const layers: string[][] = Array.from({ length: L }, () => []);
  spec.nodes.forEach(n => layers[layer.get(n.id)!].push(n.id));
  // barycentre ordering, two sweeps
  const pos = new Map<string, number>(); const setPos = () => layers.forEach(l => l.forEach((v, i) => pos.set(v, i)));
  setPos();
  const preds = (v: string) => edges.filter(e => e.to === v).map(e => e.from);
  const succs = (v: string) => edges.filter(e => e.from === v).map(e => e.to);
  for (let it = 0; it < 2; it++) {
    for (let i = 1; i < L; i++) { const bc = (v: string) => { const p = preds(v); return p.length ? p.reduce((s, u) => s + pos.get(u)!, 0) / p.length : pos.get(v)!; }; layers[i].sort((a, b) => bc(a) - bc(b)); setPos(); }
    for (let i = L - 2; i >= 0; i--) { const bc = (v: string) => { const p = succs(v); return p.length ? p.reduce((s, u) => s + pos.get(u)!, 0) / p.length : pos.get(v)!; }; layers[i].sort((a, b) => bc(a) - bc(b)); setPos(); }
  }
  const LR = spec.direction === 'LR';
  const maxNodeW = LR ? Math.min(170, (area.w - 22 * (L - 1)) / L) : 170;
  const size = new Map<string, { w: number; h: number; lines: string[]; sub: string[] }>();
  for (const n of spec.nodes) {
    const lines = wrap(n.label, maxNodeW - 20, 12, true), sub = n.sub ? wrap(n.sub, maxNodeW - 20, 11) : [];
    if (lines.length > 2) issues.push(`node "${n.id}" label "${n.label}" wraps to ${lines.length} lines; shorten it`);
    const w = Math.max(84, Math.min(maxNodeW, Math.max(maxLineW(lines, 12, true), maxLineW(sub, 11)) + 24));
    if (maxLineW(lines, 12, true) > w - 12) issues.push(`node "${n.id}" label word too long for its box`);
    size.set(n.id, { w, h: 18 + lines.length * 15 + sub.length * 14, lines, sub });
  }
  const box = new Map<string, Box>();
  const hasGroups = !!spec.groups?.length, gpad = hasGroups ? 12 : 0;
  if (LR) {
    const colW = layers.map(l => Math.max(...l.map(v => size.get(v)!.w)));
    const sum = colW.reduce((a, b) => a + b, 0);
    const gap = L > 1 ? Math.min(64, (area.w - sum) / (L - 1)) : 0;
    if (L > 4 || (L > 1 && gap < 30)) issues.push(`flow is ${L} layers deep, too wide for LR; use direction TB, or merge nodes so the longest chain has at most 4 boxes`);
    const used = sum + gap * (L - 1); let x = area.x + (area.w - used) / 2;
    const colH = layers.map(l => l.reduce((s, v) => s + size.get(v)!.h, 0) + 16 * (l.length - 1));
    const H = Math.max(...colH);
    layers.forEach((l, i) => {
      let y = area.y + gpad + (H - colH[i]) / 2;
      for (const v of l) { const s = size.get(v)!; box.set(v, { x: x + (colW[i] - s.w) / 2, y, w: s.w, h: s.h }); y += s.h + 16; }
      x += colW[i] + gap;
    });
  } else {
    let y = area.y + gpad;
    for (const l of layers) {
      const rowW = l.reduce((s, v) => s + size.get(v)!.w, 0) + 18 * (l.length - 1);
      if (rowW > area.w) issues.push(`a row of ${l.length} nodes (${l.join(', ')}) is too wide; split it or shorten labels`);
      let x = area.x + (area.w - rowW) / 2; const rh = Math.max(...l.map(v => size.get(v)!.h));
      for (const v of l) { const s = size.get(v)!; box.set(v, { x, y: y + (rh - s.h) / 2, w: s.w, h: s.h }); x += s.w + 18; }
      y += rh + 38;
    }
  }
  const nodes: FlowNodeL[] = spec.nodes.map(n => ({ id: n.id, box: box.get(n.id)!, lines: size.get(n.id)!.lines, sub: size.get(n.id)!.sub, kind: n.kind || 'default', step: n.step }));
  nodes.forEach(n => { anchors[n.id] = n.box; });
  const groups = (spec.groups || []).map(g => {
    const members = g.nodes.filter(v => box.has(v)).map(v => box.get(v)!);
    if (!members.length) { issues.push(`group "${g.id}" has no valid nodes`); return null; }
    const u = union(members), b = { x: u.x - 10, y: u.y - 10, w: u.w + 20, h: u.h + 20 };
    for (const n of nodes) if (!g.nodes.includes(n.id) && intersects(b, n.box)) issues.push(`group "${g.id}" overlaps node "${n.id}" that is not in it; regroup or drop the group`);
    anchors[g.id] = b;
    return { id: g.id, label: g.label, box: b };
  }).filter(Boolean) as FlowL['groups'];
  const fe: FlowEdgeL[] = edges.map(e => {
    const a = box.get(e.from)!, b = box.get(e.to)!;
    const fwd = layer.get(e.to)! > layer.get(e.from)!;
    let d = '', lx = 0, ly = 0;
    if (LR && fwd) {
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x - 3, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
      d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; lx = mx; ly = (y1 + y2) / 2 - 5;
    } else if (!LR && fwd) {
      const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y - 3, my = (y1 + y2) / 2;
      d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`; lx = (x1 + x2) / 2 + 6; ly = my + 4;
    } else if (LR) {
      const x1 = a.x + a.w / 2, x2 = b.x + b.w / 2, top = Math.min(a.y, b.y) - 18;
      d = `M${x1},${a.y} C${x1},${top} ${x2},${top} ${x2},${b.y - 3}`; lx = (x1 + x2) / 2; ly = top + 2;
    } else {
      const y1 = a.y + a.h / 2, y2 = b.y + b.h / 2, side = Math.max(a.x + a.w, b.x + b.w) + 26;
      d = `M${a.x + a.w},${y1} C${side},${y1} ${side},${y2} ${b.x + b.w + 3},${y2}`; lx = side - 4; ly = (y1 + y2) / 2;
    }
    // edges that skip layers can cut through boxes: detour along a lane beside the nodes in between
    if (fwd && layer.get(e.to)! - layer.get(e.from)! > 1) {
      const pts = bez(d), others = nodes.filter(n => n.id !== e.from && n.id !== e.to);
      const hit = others.filter(n => pts.some(([px, py]) => px > n.box.x - 3 && px < n.box.x + n.box.w + 3 && py > n.box.y - 3 && py < n.box.y + n.box.h + 3));
      if (hit.length) {
        if (!LR) {
          const between = others.filter(n => n.box.y + n.box.h > a.y + a.h && n.box.y < b.y);
          const right = Math.max(...between.map(n => n.box.x + n.box.w)) + 18, left = Math.min(...between.map(n => n.box.x)) - 18;
          const useRight = Math.abs(right - (a.x + a.w)) + Math.abs(right - (b.x + b.w)) <= Math.abs(a.x - left) + Math.abs(b.x - left) && right < area.x + area.w;
          const lane = useRight ? right : left, ax = useRight ? a.x + a.w : a.x, bx = useRight ? b.x + b.w + 3 : b.x - 3, ay = a.y + a.h / 2, by = b.y + b.h / 2;
          if (lane < area.x || lane > area.x + area.w) issues.push(`edge ${e.from}→${e.to} skips layers and has no room to route around; restructure the flow`);
          d = `M${ax},${ay} C${lane},${ay} ${lane},${ay} ${lane},${ay + 24} L${lane},${by - 24} C${lane},${by} ${lane},${by} ${bx},${by}`;
          lx = lane + (useRight ? 4 : -4); ly = (ay + by) / 2;
          if (e.label) { const w = textW(e.label, 11.5); lx = useRight ? Math.min(lane + 4 + w / 2, area.x + area.w - w / 2) : Math.max(lane - 4 - w / 2, area.x + w / 2); }
        } else {
          const between = others.filter(n => n.box.x + n.box.w > a.x + a.w && n.box.x < b.x);
          const lane = Math.max(...between.map(n => n.box.y + n.box.h)) + 18, ax = a.x + a.w / 2, bx = b.x + b.w / 2;
          d = `M${ax},${a.y + a.h} C${ax},${lane} ${ax},${lane} ${ax + 24},${lane} L${bx - 24},${lane} C${bx},${lane} ${bx},${lane} ${bx},${b.y + b.h + 3}`;
          lx = (ax + bx) / 2; ly = lane + 14;
        }
      }
    }
    return { from: e.from, to: e.to, d, label: e.label, lx, ly, dashed: e.dashed, step: e.step };
  });
  // edge labels must sit in free space
  for (const e of fe) if (e.label) {
    const w = textW(e.label, 11.5), lb = { x: e.lx - w / 2, y: e.ly - 11, w, h: 14 };
    const hit = nodes.find(n => intersects(lb, n.box, 1));
    if (hit) issues.push(`edge label "${e.label}" (${e.from}→${e.to}) collides with node "${hit.id}"; shorten it, drop it, or use TB`);
  }
  const all = [...nodes.map(n => n.box), ...groups.map(g => ({ ...g.box, h: g.box.h + 18 }))];
  return { nodes, edges: fe, groups, bottom: all.length ? Math.max(...all.map(b => b.y + b.h)) : area.y };
}

/* =================================================================== compare */
export interface CompareL { colX: number[]; colW: number[]; labelW: number; header: number; rows: { id: string; y: number; h: number; label: string[]; cells: string[][]; step?: number; strong?: boolean }[]; x: number; w: number; bottom: number }
export function layoutCompare(spec: { columns: string[]; rows: Stepped<CompareSpec['rows'][number]>[] }, area: Area, issues: string[], anchors: Record<string, Box>): CompareL {
  const nc = Math.max(spec.columns.length, ...spec.rows.map(r => r.cells.length));
  const labelW = Math.min(180, Math.max(90, ...spec.rows.map(r => textW(r.label, 11.5) + 20)));
  const cw = (area.w - labelW) / nc;
  const colX = Array.from({ length: nc }, (_, i) => area.x + labelW + i * cw);
  let y = area.y + 26;
  const rows = spec.rows.map(r => {
    const label = wrap(r.label, labelW - 16, 11.5), cells = r.cells.map(c => wrap(c, cw - 14, 11.5, true));
    const n = Math.max(label.length, ...cells.map(c => c.length));
    if (n > 2) issues.push(`row "${r.id}" wraps to ${n} lines; shorten its text`);
    const h = 10 + n * 14;
    const row = { id: r.id, y, h, label, cells, step: r.step, strong: r.mark };
    anchors[r.id] = { x: area.x, y, w: area.w, h };
    y += h + 2;
    return row;
  });
  return { colX, colW: colX.map(() => cw), labelW, header: area.y + 16, rows, x: area.x, w: area.w, bottom: y };
}

/* =================================================================== matrix */
export function matrixValue(p: MatrixSpec['panels'][number], i: number, j: number, salt = 0): number {
  const n = p.size, B = p.blocks || 3, blk = (k: number) => Math.min(B - 1, Math.floor(k * B / n));
  const noise = p.noise ?? (p.preset === 'noisy-blocks' ? 0.35 : 0.1);
  const r = rnd(Math.min(i, j), Math.max(i, j), 7 + salt) - 0.5;
  switch (p.preset) {
    case 'diagonal': return i === j ? 1 : clamp(0.08 + r * noise);
    case 'blocks': return i === j ? 1 : blk(i) === blk(j) ? 0.82 : 0.06;
    case 'noisy-blocks': return i === j ? 1 : clamp((blk(i) === blk(j) ? 0.56 : 0.3) + r * noise);
    case 'noise': return i === j ? 1 : clamp(0.4 + r * (noise * 1.6));
    case 'explicit': return clamp(p.values?.[i]?.[j] ?? 0);
  }
}
export interface MatrixL { panels: { id: string; x: number; y: number; cell: number; label: string[]; size: number }[]; links: { from: string; to: string; label: string; x1: number; x2: number; y: number }[]; bottom: number }
export function layoutMatrix(spec: Pick<MatrixSpec, 'panels' | 'links'>, area: Area, issues: string[], anchors: Record<string, Box>): MatrixL {
  const n = spec.panels.length, gap = spec.links?.length ? 110 : 44;
  const per = (area.w - gap * (n - 1)) / n;
  const panelsRaw = spec.panels.map(p => {
    const cell = Math.max(6, Math.min(16, Math.floor(Math.min(per, 170) / p.size)));
    if (p.preset === 'explicit' && (!p.values || p.values.length !== p.size)) issues.push(`panel "${p.id}" preset explicit needs a ${p.size}x${p.size} values array`);
    return { p, cell, side: cell * p.size, label: wrap(p.label, Math.max(per, cell * p.size), 12, true) };
  });
  const total = panelsRaw.reduce((s, q) => s + q.side, 0) + gap * (n - 1);
  let x = area.x + (area.w - total) / 2;
  const labH = Math.max(...panelsRaw.map(q => q.label.length)) * 15;
  const panels = panelsRaw.map(q => {
    const r = { id: q.p.id, x, y: area.y + labH + 8, cell: q.cell, label: q.label, size: q.p.size };
    anchors[q.p.id] = { x, y: area.y, w: q.side, h: labH + 8 + q.side };
    x += q.side + gap;
    return r;
  });
  const byId = new Map(panels.map(p => [p.id, p]));
  const links = (spec.links || []).flatMap(l => {
    const a = byId.get(l.from), b = byId.get(l.to);
    if (!a || !b) { issues.push(`matrix link ${l.from}→${l.to} references a missing panel`); return []; }
    const [L, R] = a.x < b.x ? [a, b] : [b, a];
    if (textW(l.label, 11.5) > gap + 40) issues.push(`matrix link label "${l.label}" is too long`);
    return [{ from: l.from, to: l.to, label: l.label, x1: L.x + L.cell * L.size + 6, x2: R.x - 6, y: L.y + (L.cell * L.size) / 2 }];
  });
  const bottom = Math.max(...panels.map(p => p.y + p.cell * p.size)) + 8;
  return { panels, links, bottom };
}

/* =================================================================== chart */
export function seriesY(s: { shape: string; peak?: number; points?: { x: number; y: number }[] }, x: number): number {
  const p = s.peak ?? 0.25;
  switch (s.shape) {
    case 'rise': return 0.12 + 0.74 * Math.pow(x, 0.9);
    case 'saturate': return 0.12 + 0.74 * (1 - Math.exp(-4 * x)) / (1 - Math.exp(-4));
    case 'fall': return 0.86 - 0.7 * x;
    case 'decay': return 0.12 + 0.74 * Math.exp(-4 * x);
    case 'peak-then-fall': return x <= p ? 0.25 + 0.6 * Math.sin((x / Math.max(p, 0.01)) * Math.PI / 2) : 0.85 - 0.45 * Math.pow((x - p) / Math.max(1 - p, 0.01), 1.2);
    case 'dip-then-rise': return x <= p ? 0.75 - 0.6 * Math.sin((x / Math.max(p, 0.01)) * Math.PI / 2) : 0.15 + 0.5 * Math.pow((x - p) / Math.max(1 - p, 0.01), 0.9);
    case 's-curve': return 0.12 + 0.74 / (1 + Math.exp(-12 * (x - (s.peak ?? 0.5))));
    case 'flat': return 0.5;
    case 'points': {
      const pts = [...(s.points || [])].sort((a, b) => a.x - b.x);
      if (!pts.length) return 0.5;
      if (x <= pts[0].x) return pts[0].y;
      for (let i = 1; i < pts.length; i++) if (x <= pts[i].x) { const a = pts[i - 1], b = pts[i]; return a.y + (b.y - a.y) * (x - a.x) / Math.max(b.x - a.x, 1e-6); }
      return pts[pts.length - 1].y;
    }
  }
  return 0.5;
}
export interface ChartL { x0: number; y0: number; pw: number; ph: number; X: (u: number) => number; Y: (v: number) => number; labels: { id: string; y: number }[]; readY: number; readW: number; bottom: number }
export function layoutChart(spec: Pick<ChartSpec, 'series' | 'states' | 'annotations'>, area: Area, issues: string[], anchors: Record<string, Box>): ChartL {
  const labW = Math.min(150, Math.max(70, ...spec.series.map(s => textW(s.label, 11.5, true) + 12)));
  const x0 = area.x + 34, y0 = area.y + 22, pw = area.w - 34 - labW, ph = 170;
  const X = (u: number) => x0 + pw * u, Y = (v: number) => y0 + ph * (1 - v);
  // series end labels, pushed apart
  const ends = spec.series.map(s => ({ id: s.id, y: Y(seriesY(s, 1)) + 4 })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  for (const s of spec.series) {
    let lo = 1, hi = 0; for (let u = 0; u <= 1; u += 0.05) { const v = seriesY(s, u); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    anchors[s.id] = { x: x0, y: Y(hi) - 4, w: pw, h: Y(lo) - Y(hi) + 8 };
  }
  for (const a of spec.annotations || []) anchors[a.id] = { x: X(a.x) - 30, y: y0 - 20, w: 60, h: 16 };
  anchors['plot'] = { x: x0, y: y0, w: pw, h: ph };
  const readW = area.w - 40;
  const maxRead = Math.max(1, ...spec.states.map(s => wrap(s.text, readW, 13).length));
  if (maxRead > 3) issues.push('a chart state text wraps to more than 3 lines; shorten it');
  const sorted = [...spec.states].sort((a, b) => a.from - b.from);
  if (sorted.length && (sorted[0].from > 0.02 || sorted[sorted.length - 1].to < 0.98)) issues.push('chart states should cover x from 0 to 1');
  const sig = spec.series.map(s => s.shape === 'points' ? JSON.stringify(s.points) : s.shape + (s.peak ?? ''));
  sig.forEach((g, i) => { const j = sig.indexOf(g); if (j < i) issues.push(`series "${spec.series[i].id}" has the same shape as "${spec.series[j].id}" and would draw on top of it; give it a different shape or points`); });
  const readY = y0 + ph + 58;
  return { x0, y0, pw, ph, X, Y, labels: ends, readY, readW, bottom: readY + maxRead * 17 + 4 };
}

/* =================================================================== detail (inside pipeline frame) */
export type DetailL =
  | { kind: 'flow'; l: FlowL } | { kind: 'compare'; l: CompareL } | { kind: 'matrix'; l: MatrixL; spec: Pick<MatrixSpec, 'panels'> }
  | { kind: 'bullets'; lines: { y: number; text: string[] }[]; bottom: number };
export function layoutDetail(d: Detail, area: Area, issues: string[], anchors: Record<string, Box>): DetailL & { bottom: number } {
  if (d.kind === 'flow') { const l = layoutFlow(d, area, issues, anchors); return { kind: 'flow', l, bottom: l.bottom }; }
  if (d.kind === 'compare') { const l = layoutCompare(d, area, issues, anchors); return { kind: 'compare', l, bottom: l.bottom }; }
  if (d.kind === 'matrix') { const l = layoutMatrix(d, area, issues, anchors); return { kind: 'matrix', l, spec: d, bottom: l.bottom }; }
  let y = area.y + 4;
  const lines = d.items.map(it => { const text = wrap(it, area.w - 20, 13); const r = { y, text }; y += text.length * 17 + 6; return r; });
  return { kind: 'bullets', lines, bottom: y };
}

/* =================================================================== pipeline */
export interface PipelineL { steps: { id: string; box: Box; lines: string[]; n: number }[]; phases: { label: string; x1: number; x2: number; lx: number }[]; frame: Box; title: string; detail: (DetailL & { bottom: number }) | null; stripBottom: number }
export function layoutPipeline(spec: Pick<PipelineSpec, 'steps' | 'phases'>, sel: string | null, area: Area, issues: string[], anchors: Record<string, Box>): PipelineL {
  const n = spec.steps.length, gap = 12;
  const sw = (area.w - gap * (n - 1)) / n;
  const steps = spec.steps.map((s, i) => {
    const lines = wrap(s.label, sw - 12, 12, true);
    if (lines.length > 2) issues.push(`step "${s.id}" label "${s.label}" too long for the strip`);
    if (maxLineW(lines, 12, true) > sw - 6) issues.push(`step "${s.id}" label has a word too long for its box`);
    const box = { x: area.x + i * (sw + gap), y: area.y + 16, w: sw, h: 50 };
    anchors[s.id] = box;
    return { id: s.id, box, lines, n: i + 1 };
  });
  const idx = new Map(spec.steps.map((s, i) => [s.id, i]));
  const phases = (spec.phases || []).flatMap(p => {
    const a = idx.get(p.from), b = idx.get(p.to);
    if (a == null || b == null || b < a) { issues.push(`phase "${p.label}" has bad from/to step ids`); return []; }
    const x1 = steps[a].box.x, x2 = steps[b].box.x + sw, w = textW(p.label, 11.5);
    return [{ label: p.label, x1, x2, lx: Math.max(area.x + w / 2, Math.min(area.x + area.w - w / 2, (x1 + x2) / 2)) }];
  });
  const stripBottom = area.y + 16 + 50 + (phases.length ? 34 : 12);
  const frame = { x: area.x, y: stripBottom, w: area.w, h: 0 };
  // frame height = tallest detail of any step, so the canvas does not jump
  let maxH = 40, detail: PipelineL['detail'] = null, title = '';
  for (const s of spec.steps) {
    const scratchIssues: string[] = [], scratchAnch: Record<string, Box> = {};
    const isSel = s.id === (sel ?? spec.steps[0].id);
    if (s.detail) {
      const dl = layoutDetail(s.detail, { x: area.x + 16, y: stripBottom + 40, w: area.w - 32 }, isSel || !sel ? scratchIssues : [], isSel ? anchors : scratchAnch);
      maxH = Math.max(maxH, dl.bottom - stripBottom + 14);
      scratchIssues.forEach(m => issues.push(`step "${s.id}" detail: ${m}`));
      if (isSel) detail = dl;
    }
    if (isSel) title = `${idx.get(s.id)! + 1}  ${s.title}`;
  }
  frame.h = maxH;
  return { steps, phases, frame, title, detail, stripBottom };
}

/* =================================================================== landscape */
export const HEX_K = 0.6;
export interface TileL { id: string; q: number; r: number; px: number; py: number; lift: number; kind: 'cur' | 'read' | 'fog'; lines: string[]; year?: string; rel?: string }
const DIRS: [number, number][] = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
const PREF: Record<string, number[]> = { lineage: [0, 5, 1], component: [1, 2, 0], compare: [2, 1, 3], downstream: [3, 4, 2] };
const hexD = (a: { q: number; r: number }, b: { q: number; r: number }) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
export const hexDist = hexD;
function tileLines(label: string): string[] {
  if (textW(label, 12, true) <= 84) return [label];
  const w = wrap(label, 84, 12, true);
  return w.length > 2 ? [w[0], w.slice(1).join(' ')] : w;
}
export interface LandscapeL { tiles: TileL[]; scale: number; ox: number; oy: number; bottom: number }
export function layoutLandscape(spec: Pick<LandscapeSpec, 'center' | 'tiles' | 'open'>, issues: string[], anchors: Record<string, Box>): LandscapeL {
  const taken = new Map<string, string>(); const key = (q: number, r: number) => q + ',' + r;
  const cells: TileL[] = [{ id: '_center', q: 0, r: 0, px: 0, py: 0, lift: 22, kind: 'cur', lines: tileLines(spec.center.label) }];
  taken.set(key(0, 0), '_center');
  const ring = (q: number, r: number) => DIRS.map(([dq, dr]) => [q + dq, r + dr] as [number, number]);
  const sorted = [...spec.tiles].sort((a, b) => b.weight - a.weight);
  for (const t of sorted) {
    const pref = PREF[t.relation] || [0, 1, 2, 3, 4, 5];
    // candidates: ring 1 then ring 2, scored by direction preference
    const cands: { q: number; r: number; s: number }[] = [];
    for (let d = 0; d < 6; d++) {
      const [dq, dr] = DIRS[d]; const ps = pref.indexOf(d);
      const base = ps < 0 ? 10 : ps * 2;
      cands.push({ q: dq, r: dr, s: base + (t.weight >= 2 ? 0 : 3) });
      cands.push({ q: 2 * dq, r: 2 * dr, s: base + 4 });
      const [eq, er] = DIRS[(d + 1) % 6];
      cands.push({ q: dq + eq, r: dr + er, s: base + 5 });
    }
    cands.sort((a, b) => a.s - b.s);
    const c = cands.find(c => !taken.has(key(c.q, c.r)));
    if (!c) { issues.push(`no room for tile ${t.id}`); continue; }
    taken.set(key(c.q, c.r), t.id);
    cells.push({ id: t.id, q: c.q, r: c.r, px: 0, py: 0, lift: { 3: 14, 2: 10, 1: 6 }[t.weight] || 6, kind: 'read', lines: tileLines(t.label), year: t.year, rel: t.relation });
  }
  const byId = new Map(cells.map(c => [c.id, c]));
  for (const o of spec.open) {
    const from = o.from.map(f => byId.get(f)).filter(Boolean) as TileL[];
    if (from.length < o.from.length) issues.push(`open direction "${o.id}" refers to unknown tiles`);
    const cand: { q: number; r: number; s: number }[] = [];
    for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
      if (taken.has(key(q, r)) || hexD({ q, r }, { q: 0, r: 0 }) > 3) continue;
      const adj = from.filter(f => hexD(f, { q, r }) === 1).length;
      cand.push({ q, r, s: -adj * 10 + hexD({ q, r }, { q: 0, r: 0 }) * 2 });
    }
    cand.sort((a, b) => a.s - b.s);
    const c = cand[0];
    if (!c) continue;
    taken.set(key(c.q, c.r), o.id);
    cells.push({ id: o.id, q: c.q, r: c.r, px: 0, py: 0, lift: 0, kind: 'fog', lines: tileLines(o.label) });
  }
  const LS = 60;
  cells.forEach(c => { c.px = LS * 1.5 * c.q; c.py = LS * Math.sqrt(3) * (c.r + c.q / 2) * HEX_K; });
  const minX = Math.min(...cells.map(c => c.px)) - 60, maxX = Math.max(...cells.map(c => c.px)) + 60;
  const minY = Math.min(...cells.map(c => c.py - c.lift)) - 40, maxY = Math.max(...cells.map(c => c.py)) + 50;
  const scale = Math.min(1, (W - 20) / (maxX - minX));
  const ox = (W - (maxX - minX) * scale) / 2 - minX * scale, oy = 12 - minY * scale;
  cells.forEach(c => { anchors[c.id] = { x: ox + (c.px - 56) * scale, y: oy + (c.py - c.lift - 34) * scale, w: 112 * scale, h: 68 * scale }; });
  return { tiles: cells, scale, ox, oy, bottom: oy + maxY * scale + 4 };
}

/* =================================================================== free */
export function layoutFree(spec: Pick<FreeSpec, 'items'>, issues: string[], anchors: Record<string, Box>) {
  let bottom = 40;
  for (const it of spec.items) {
    let b: Box;
    if (it.kind === 'box') b = { x: it.x, y: it.y, w: it.w ?? 100, h: it.h ?? 40 };
    else if (it.kind === 'circle') { const r = (it.w ?? 20) / 2; b = { x: it.x - r, y: it.y - r, w: 2 * r, h: 2 * r }; }
    else if (it.kind === 'arrow') b = union([{ x: it.x, y: it.y, w: 0, h: 0 }, { x: it.x2 ?? it.x, y: it.y2 ?? it.y, w: 0, h: 0 }]);
    else b = { x: it.x, y: it.y - 12, w: textW(it.text || '', 11.5), h: 16 };
    if (b.x < 0 || b.x + b.w > W + 1 || b.y < 0) issues.push(`free item ${it.id || it.kind + '@' + it.x + ',' + it.y} is off the 560-wide canvas`);
    if (it.kind === 'box' && it.text && textW(it.text, 11.5, true) > b.w - 10) issues.push(`text "${it.text}" overflows its box`);
    if (it.id) anchors[it.id] = b;
    bottom = Math.max(bottom, b.y + b.h + 12);
  }
  return { bottom };
}

/* =================================================================== sim */
export const TOY = ['AAAAAAAA', 'AAAAAACC', 'AABBAACC', 'ABBBBACC', 'DBBBBDCD', 'DBBBDDDD', 'DDDDDDDD', 'DDDDDDDD'];
export const toyRegion = (p: number) => 'ABCD'.indexOf(TOY[Math.floor(p / 8)][p % 8]);
export function simValue(m: { coherence: number; noise: number }, mi: number, ref: number, p: number): number {
  if (ref === p) return 1;
  const same = toyRegion(ref) === toyRegion(p) ? 1 : 0;
  const n = rnd(Math.min(ref, p), Math.max(ref, p), mi * 13 + 1) - 0.5;
  const inside = 0.3 + 0.62 * m.coherence, outside = 0.4 - 0.32 * m.coherence;
  return clamp((same ? inside : outside) + n * m.noise * 0.7);
}
export function simContrast(m: { coherence: number; noise: number }, mi: number, ref: number) {
  let a = 0, na = 0, b = 0, nb = 0;
  for (let p = 0; p < 64; p++) { if (p === ref) continue; const v = simValue(m, mi, ref, p); if (toyRegion(p) === toyRegion(ref)) { a += v; na++; } else { b += v; nb++; } }
  return (na ? a / na : 0) - (nb ? b / nb : 0);
}

/* =================================================================== entry */
export interface ViewState { sel?: string | null; x?: number; ref?: number }
export type LayoutResult = Base & (
  | { type: 'flow'; flow: FlowL } | { type: 'pipeline'; pipe: PipelineL } | { type: 'chart'; chart: ChartL }
  | { type: 'matrix'; matrix: MatrixL } | { type: 'compare'; compare: CompareL } | { type: 'landscape'; land: LandscapeL }
  | { type: 'sim' } | { type: 'free' });

export function layout(d: Diagram, vs: ViewState = {}): LayoutResult {
  const r = layoutInner(d, vs);
  r.obstacles = obstaclesOf(r, d);
  return r;
}
const tbox = (x: number, y: number, s: string, size = 11.5, anchor: 'start' | 'middle' = 'start'): Box => { const w = textW(s, size); return { x: anchor === 'middle' ? x - w / 2 : x, y: y - size, w, h: size + 4 }; };
/** Text and marks that overlay notes must not cover (anchors are added separately). */
function obstaclesOf(r: LayoutResult, d: Diagram): Box[] {
  const o: Box[] = [];
  if (r.type === 'chart' && d.type === 'chart') {
    const c = r.chart;
    d.series.forEach(s => { const y = c.labels.find(l => l.id === s.id)!.y; o.push(tbox(c.x0 + c.pw + 8, y, s.label, 12)); });
    o.push({ x: c.x0 - 30, y: c.y0 + c.ph, w: c.pw + 40, h: 36 }, { x: c.x0, y: c.readY - 14, w: c.readW, h: c.bottom - c.readY + 14 }, { x: c.x0 - 26, y: c.y0, w: 16, h: c.ph });
    (d.annotations || []).forEach(a => o.push(tbox(c.X(a.x), c.y0 - 8, a.label, 11.5, 'middle')));
  }
  const flowObs = (fl: FlowL) => { fl.edges.forEach(e => { if (e.label) o.push(tbox(e.lx, e.ly, e.label, 11.5, 'middle')); }); fl.groups.forEach(g => o.push(tbox(g.box.x + 8, g.box.y + g.box.h + 14, g.label, 12))); };
  if (r.type === 'flow') flowObs(r.flow);
  if (r.type === 'pipeline') { const p = r.pipe; o.push({ x: p.frame.x, y: p.frame.y, w: p.frame.w, h: 32 }); p.phases.forEach(ph => o.push(tbox(ph.lx, p.stripBottom - 12, ph.label, 11.5, 'middle'))); if (p.detail?.kind === 'flow') flowObs(p.detail.l); }
  if (r.type === 'matrix') r.matrix.links.forEach(l => o.push(tbox((l.x1 + l.x2) / 2, l.y - 10, l.label, 12, 'middle')));
  if (r.type === 'compare') o.push({ x: r.compare.x, y: r.compare.header - 14, w: r.compare.w, h: 22 });
  if (r.type === 'sim') o.push({ x: 0, y: 0, w: W, h: r.h });
  if (d.caveat) o.push({ x: 0, y: r.h - 24, w: W, h: 24 });
  return o;
}
function layoutInner(d: Diagram, vs: ViewState): LayoutResult {
  const issues: string[] = [], anchors: Record<string, Box> = {};
  const area = { x: PAD, y: PAD, w: W - 2 * PAD };
  const fin = (bottom: number) => Math.max(220, Math.ceil(bottom + (d.caveat ? 26 : 12)));
  switch (d.type) {
    case 'flow': { const flow = layoutFlow(d, area, issues, anchors); return { type: 'flow', flow, w: W, h: fin(flow.bottom), anchors, issues, obstacles: [] }; }
    case 'pipeline': { const pipe = layoutPipeline(d, vs.sel ?? null, area, issues, anchors); return { type: 'pipeline', pipe, w: W, h: fin(pipe.frame.y + pipe.frame.h), anchors, issues, obstacles: [] }; }
    case 'chart': { const chart = layoutChart(d, area, issues, anchors); return { type: 'chart', chart, w: W, h: fin(chart.bottom), anchors, issues, obstacles: [] }; }
    case 'matrix': { const matrix = layoutMatrix(d, { ...area, y: area.y + 4 }, issues, anchors); return { type: 'matrix', matrix, w: W, h: fin(matrix.bottom), anchors, issues, obstacles: [] }; }
    case 'compare': { const compare = layoutCompare(d, area, issues, anchors); return { type: 'compare', compare, w: W, h: fin(compare.bottom), anchors, issues, obstacles: [] }; }
    case 'landscape': { const land = layoutLandscape(d, issues, anchors); return { type: 'landscape', land, w: W, h: fin(land.bottom), anchors, issues, obstacles: [] }; }
    case 'sim': {
      anchors['image'] = { x: 16, y: 74, w: 192, h: 192 };
      d.modes.forEach((_, i) => { anchors['mode' + i] = { x: 226 + i * 112 - 2, y: 60, w: 107, h: 120 }; });
      return { type: 'sim', w: W, h: fin(196 + d.modes.length * 24 + 30), anchors, issues, obstacles: [] };
    }
    case 'free': { const f = layoutFree(d, issues, anchors); return { type: 'free', w: W, h: fin(f.bottom), anchors, issues, obstacles: [] }; }
  }
}

/** Every selectable element with its side-panel note, in reading order. */
export function partsOf(d: Diagram): { id: string; title: string; note?: string }[] {
  switch (d.type) {
    case 'flow': return d.nodes.filter(n => n.note).map(n => ({ id: n.id, title: n.label, note: n.note }));
    case 'pipeline': return d.steps.map(s => ({ id: s.id, title: s.title, note: s.note }));
    case 'chart': return [...d.series, ...(d.annotations || [])].filter(s => s.note).map(s => ({ id: s.id, title: s.label, note: s.note }));
    case 'matrix': return d.panels.filter(p => p.note).map(p => ({ id: p.id, title: p.label, note: p.note }));
    case 'compare': return d.rows.filter(r => r.note).map(r => ({ id: r.id, title: r.label, note: r.note }));
    case 'landscape': return [...d.tiles.map(t => ({ id: t.id, title: t.title })), ...d.open.map(o => ({ id: o.id, title: o.title }))];
    case 'free': return d.items.filter(i => i.id && i.note).map(i => ({ id: i.id!, title: i.text || i.id!, note: i.note }));
    case 'sim': return [];
  }
}
export const defaultPart = (d: Diagram): string | null => d.type === 'pipeline' ? d.steps[0]?.id ?? null : (partsOf(d).find(p => p.note)?.id ?? null);

