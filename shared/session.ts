// One reducer for guide state, used live (as tools execute) and in replay (folding the recorded log),
// so a replayed session shows exactly what the reader saw.
import type { Custom, Diagram, SessionEvent } from './schema.ts';

export type View = { kind: 'g' | 'c'; id: string };
export interface GuideState { customs: Custom[]; view: View | null; sel: Record<string, string | null>; x: Record<string, number> }
export const emptyGuide = (): GuideState => ({ customs: [], view: null, sel: {}, x: {} });

/** Apply one successful tool event. Events whose result has `error` are ignored. */
export function applyTool(s: GuideState, name: string, args: any, result: any): GuideState {
  if (result?.error && name === 'scratch_ready') {
    return { ...s, customs: s.customs.map(c => c.id === args.custom_id ? { ...c, pending: false, summary: c.summary || 'The diagram could not be drawn.' } : c) };
  }
  if (result?.error) return s;
  const customs = s.customs.map(c => ({ ...c, steps: [...c.steps] }));
  const find = (id: string) => customs.find(c => c.id === id);
  switch (name) {
    case 'show_diagram': {
      const kind = find(args.id) ? 'c' : 'g';
      return { ...s, view: { kind, id: args.id }, sel: args.part ? { ...s.sel, [args.id]: args.part } : s.sel, x: args.x != null ? { ...s.x, [args.id]: args.x } : s.x };
    }
    case 'start_custom': {
      const c: Custom = { id: result.custom_id, question: args.question, base: args.base || null, nav: args.nav, head: args.head, summary: '', spec: null, steps: [], pending: !args.base };
      return { ...s, customs: [...customs, c], view: { kind: 'c', id: c.id } };
    }
    case 'add_step': { const c = find(args.custom_id); if (c) c.steps.push(args.ops); return { ...s, customs, view: { kind: 'c', id: args.custom_id } }; }
    case 'draw_from_scratch': { const c = find(args.custom_id); if (c) c.pending = true; return { ...s, customs }; }
    case 'scratch_ready': { const c = find(args.custom_id); if (c) { c.spec = result.spec as Diagram; c.pending = false; } return { ...s, customs, view: { kind: 'c', id: args.custom_id } }; }
    case 'finish_custom': { const c = find(args.custom_id); if (c) c.summary = args.summary; return { ...s, customs }; }
  }
  return s;
}
export function foldEvents(events: SessionEvent[], upTo = Infinity): GuideState {
  let s = emptyGuide();
  for (const e of events) { if (e.t > upTo) break; if (e.kind === 'tool') s = applyTool(s, e.name, e.args, e.result); }
  return s;
}

/* -------- transcript lines for the player */
export interface Line { who: 'you' | 'guide'; t0: number; t1: number; words: { w: string; t: number }[]; key: string }
export function transcriptLines(events: SessionEvent[], duration: number): Line[] {
  // Group consecutive same-speaker chunks into a run; chunks can split words, so time words by character offset.
  const runs: { who: 'you' | 'guide'; chunks: { t: number; text: string }[] }[] = [];
  for (const e of events) {
    if (e.kind === 'turn') { runs.push({ who: 'guide', chunks: [] }); continue; }
    if (e.kind !== 'you' && e.kind !== 'guide') continue;
    let r = runs[runs.length - 1];
    if (!r || r.who !== e.kind || (r.chunks.length && e.kind === 'you' && e.t - r.chunks[r.chunks.length - 1].t > 4)) runs.push(r = { who: e.kind, chunks: [] });
    r.chunks.push({ t: e.t, text: e.text });
  }
  const lines: Line[] = [];
  for (const r of runs) {
    if (!r.chunks.length) continue;
    let text = '', offs: { at: number; t: number }[] = [];
    for (const c of r.chunks) { offs.push({ at: text.length, t: c.t }); text += c.text; }
    const tAt = (i: number) => { let t = offs[0].t; for (const o of offs) { if (o.at <= i) t = o.t; else break; } return t; };
    let cur: Line | null = null;
    for (const m of text.matchAll(/\S+/g)) {
      if (!cur || (r.who === 'guide' && cur.words.length >= 14 && /[.!?]["”’)]?$/.test(cur.words[cur.words.length - 1].w))) {
        cur = { who: r.who, t0: tAt(m.index!), t1: 0, words: [], key: String(lines.length) }; lines.push(cur);
      }
      cur.words.push({ w: m[0], t: tAt(m.index!) });
    }
  }
  // spread words that share a chunk timestamp evenly up to the next timestamp
  for (const l of lines) {
    for (let i = 0; i < l.words.length;) {
      let j = i; while (j < l.words.length && l.words[j].t === l.words[i].t) j++;
      const next = j < l.words.length ? l.words[j].t : l.words[i].t + (j - i) * 0.3;
      const step = Math.min(0.45, (next - l.words[i].t) / (j - i));
      for (let k = i; k < j; k++) l.words[k].t = l.words[i].t + (k - i) * step;
      i = j;
    }
  }
  return lines.map((l, i) => ({ ...l, t1: Math.min(l.words[l.words.length - 1].t + 0.4, lines[i + 1]?.t0 ?? duration) }));
}
