// Custom diagrams = a base diagram (general or drawn from scratch) + orange overlay steps.
// Ops that extend the structure (addNode/addEdge/addRow/addSeries) are merged into the spec so layout
// accounts for them; the rest become marks positioned against layout anchors. Everything is tagged
// with its step so the renderer can reveal step k and fade in the newest one.
import type { Custom, Diagram, OverlayOp } from './schema.ts';
import { layout, seriesY, type Box, type LayoutResult, intersects, W } from './layout.ts';
import { textW, wrap } from './text.ts';

export type Placed =
  | { kind: 'badge'; step: number; x: number; y: number; w: number; text: string }
  | { kind: 'highlight'; step: number; box: Box }
  | { kind: 'trace'; step: number; d: string }
  | { kind: 'note'; step: number; x: number; y: number; lines: string[]; line?: [number, number, number, number] }
  | { kind: 'marker'; step: number; x: number; y1: number; y2: number; label: string }
  | { kind: 'callout'; step: number; box: Box; lines: string[] }
  | { kind: 'arrow'; step: number; x1: number; y1: number; x2: number; y2: number; label?: string };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
let auto = 0;

export function placeholder(c: Pick<Custom, 'id' | 'nav' | 'head' | 'question'>, text = 'Drawing…'): Diagram {
  return { id: c.id, type: 'free', nav: c.nav, head: c.head, body: [c.question], sources: [],
    items: [{ kind: 'text', x: 220, y: 120, text, muted: true }] };
}

/** Merge structural ops into the spec. Returns the spec and the ops that remain as marks. */
export function compose(c: Custom, base: Diagram | null): { spec: Diagram; marks: { step: number; op: OverlayOp }[]; issues: string[] } {
  const issues: string[] = [];
  const src = c.spec ?? base;
  const spec: any = src ? clone(src) : placeholder(c);
  spec.id = c.id; spec.nav = c.nav; spec.head = c.head;
  const marks: { step: number; op: OverlayOp }[] = [];
  c.steps.forEach((ops, step) => ops.forEach(op => {
    const nid = op.id || `${op.op}${++auto}`;
    if (op.op === 'addNode' && spec.type === 'flow') {
      spec.nodes.push({ id: nid, label: op.label || op.text || '…', sub: op.sub, kind: 'accent', step });
      if (op.after) {
        if (spec.nodes.some((n: any) => n.id === op.after)) spec.edges.push({ from: op.after, to: nid, step });
        else issues.push(`addNode: after "${op.after}" is not a node`);
      }
    } else if (op.op === 'addEdge' && spec.type === 'flow' && op.from && op.to) {
      spec.edges.push({ from: op.from, to: op.to, label: op.text, step });
    } else if (op.op === 'addRow' && spec.type === 'compare') {
      spec.rows.push({ id: nid, label: op.label || '', cells: op.cells || [], mark: true, step });
    } else if (op.op === 'addSeries' && spec.type === 'chart') {
      spec.series.push({ id: nid, label: op.label || 'new', shape: op.shape || 'rise', peak: op.peak, step });
    } else if (op.op === 'addEdge') {
      marks.push({ step, op: { ...op, op: 'addEdge' } });
    } else if (['addNode', 'addRow', 'addSeries'].includes(op.op)) {
      marks.push({ step, op: { op: 'callout', text: [op.label, op.sub, op.text, ...(op.cells || [])].filter(Boolean).join(' · ') } });
    } else marks.push({ step, op });
  }));
  return { spec, marks, issues };
}

/** Position marks against the layout. Unknown targets are reported, not drawn. */
export function place(marks: { step: number; op: OverlayOp }[], L: LayoutResult, spec: Diagram): { items: Placed[]; h: number; issues: string[] } {
  const issues: string[] = [], items: Placed[] = [], taken: Box[] = [...Object.values(L.anchors), ...L.obstacles];
  let h = L.h;
  const anchor = (t?: string) => {
    if (!t) return null;
    const b = L.anchors[t];
    if (!b) issues.push(`target "${t}" does not exist; valid targets: ${Object.keys(L.anchors).slice(0, 40).join(', ')}`);
    return b || null;
  };
  const callouts: { step: number; text: string }[] = [];
  const mark = (step: number, id: string, b: Box) => {
    const ser = L.type === 'chart' && spec.type === 'chart' ? spec.series.find(x => x.id === id) : null;
    if (ser && L.type === 'chart') { let d = ''; for (let u = 0; u <= 1.0001; u += 0.0125) d += `${d ? 'L' : 'M'}${L.chart.X(u).toFixed(1)},${L.chart.Y(seriesY(ser, u)).toFixed(1)}`; items.push({ kind: 'trace', step, d }); }
    else items.push({ kind: 'highlight', step, box: { x: b.x - 5, y: b.y - 5, w: b.w + 10, h: b.h + 10 } });
  };
  for (const { step, op } of marks) {
    switch (op.op) {
      case 'badge': {
        const b = anchor(op.target); if (!b || !op.text) break;
        const w = textW(op.text, 10, true) + 16;
        const x = Math.min(W - w - 4, Math.max(4, b.x + b.w / 2 - w / 2));
        const y = b.y - 20 >= 2 ? b.y - 20 : b.y + 3;
        items.push({ kind: 'badge', step, x, y, w, text: op.text }); taken.push({ x, y, w, h: 17 });
        break;
      }
      case 'highlight': { const b = anchor(op.target); if (b) mark(step, op.target!, b); break; }
      case 'note': {
        const b = anchor(op.target); if (!b || !op.text) break;
        const lines = wrap(op.text, 150, 11.5), nw = Math.max(...lines.map(l => textW(l, 11.5, true))) + 4, nh = lines.length * 14;
        const cands: Box[] = [
          { x: b.x + b.w + 14, y: b.y + b.h / 2 - nh / 2, w: nw, h: nh }, { x: b.x - 14 - nw, y: b.y + b.h / 2 - nh / 2, w: nw, h: nh },
          { x: b.x + b.w / 2 - nw / 2, y: b.y + b.h + 10, w: nw, h: nh }, { x: b.x + b.w / 2 - nw / 2, y: b.y - 10 - nh, w: nw, h: nh },
        ].map(c => ({ ...c, x: Math.max(4, Math.min(W - c.w - 4, c.x)), y: Math.max(4, c.y) }));
        const pick = cands.find(c => c.x >= 4 && c.x + c.w <= W - 4 && c.y + c.h < L.h - (spec.caveat ? 26 : 4) && !taken.some(t => t !== b && intersects(c, t, 3)));
        if (!pick) {
          // nowhere free beside the target: mark the target and put the sentence under the diagram
          mark(step, op.target!, b);
          callouts.push({ step, text: op.text });
          break;
        }
        taken.push(pick);
        const cx = pick.x + pick.w / 2, cy = pick.y + pick.h / 2;
        const ex = Math.max(b.x, Math.min(b.x + b.w, cx)), ey = Math.max(b.y, Math.min(b.y + b.h, cy));
        items.push({ kind: 'note', step, x: pick.x, y: pick.y + 11, lines, line: intersects(pick, b, 4) ? undefined : [ex, ey, Math.max(pick.x, Math.min(pick.x + pick.w, ex)), Math.max(pick.y, Math.min(pick.y + pick.h, ey))] });
        break;
      }
      case 'marker': {
        if (L.type !== 'chart' || op.x == null) { issues.push('marker needs a chart diagram and x in 0..1'); break; }
        const c = L.chart; items.push({ kind: 'marker', step, x: c.X(op.x), y1: c.y0 - 4, y2: c.y0 + c.ph, label: op.text || op.label || '' });
        break;
      }
      case 'addEdge': {
        const a = anchor(op.from), b = anchor(op.to); if (!a || !b) break;
        const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
        const trim = (x: number, y: number, bb: Box, tx: number, ty: number) => { const dx = tx - x, dy = ty - y, s = Math.min(Math.abs((bb.w / 2 + 4) / (dx || 1e-6)), Math.abs((bb.h / 2 + 4) / (dy || 1e-6))); return [x + dx * s, y + dy * s]; };
        const [x1, y1] = trim(ax, ay, a, bx, by), [x2, y2] = trim(bx, by, b, ax, ay);
        items.push({ kind: 'arrow', step, x1, y1, x2, y2, label: op.text });
        break;
      }
      case 'callout': if (op.text) callouts.push({ step, text: op.text }); break;
      default: if (op.target) anchor(op.target);
    }
  }
  if (spec.caveat && callouts.length) h = Math.max(L.h - 22, h - 22);
  for (const c of callouts) {
    const lines = wrap(c.text, W - 60, 12.5), bh = lines.length * 16 + 14;
    items.push({ kind: 'callout', step: c.step, box: { x: 16, y: h, w: W - 32, h: bh }, lines });
    h += bh + 8;
  }
  if (spec.caveat && callouts.length) h += 22;
  return { items, h, issues };
}

export function composeAll(c: Custom, base: Diagram | null, vs: { sel?: string | null; x?: number } = {}) {
  const { spec, marks, issues } = compose(c, base);
  const L = layout(spec, vs);
  const p = place(marks, L, spec);
  return { spec, L, items: p.items, h: p.h, issues: [...issues, ...p.issues] };
}
