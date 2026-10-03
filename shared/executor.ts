// Tool executor for the live guide. Shared by the browser (real sessions) and the Node eval harness,
// so both validate and apply tool calls identically. Invalid calls are rejected with a message the
// model can act on; nothing invalid ever reaches the screen.
import type { Diagram } from './schema.ts';
import { ToolArgs, type ToolName } from './tools.ts';
import { applyTool, type GuideState } from './session.ts';
import { composeAll } from './overlay.ts';
import { layout } from './layout.ts';

export interface ExecDeps {
  diagrams: Diagram[];
  state: () => GuideState;
  record: (name: string, args: unknown, result: unknown) => void;
  scratch: (args: { custom_id: string; type: string; brief: string; question: string; nav: string; head: string }) => Promise<{ spec: Diagram; targets: string[] }>;
  section: (id: string) => Promise<{ id: string; title: string; text: string }>;
  nextCustomId: () => string;
}
/** background: NON_BLOCKING result. silent: deliver it without making the model speak again. */
export interface ExecResult { response: Record<string, unknown>; background?: boolean; silent?: boolean }

export async function execTool(d: ExecDeps, name: string, raw: unknown): Promise<ExecResult> {
  const schema = (ToolArgs as Record<string, any>)[name];
  const fail = (error: string, args: unknown = raw): ExecResult => { d.record(name, args, { error }); return { response: { error } }; };
  if (!schema) return fail(`unknown tool ${name}`);
  const parsed = schema.safeParse(normalise(name, raw));
  if (!parsed.success) return fail(parsed.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const args: any = parsed.data;
  // custom_id is optional: default to the latest custom diagram (recorded resolved, so replay is exact)
  if (['add_step', 'draw_from_scratch', 'finish_custom'].includes(name) && !args.custom_id) {
    const last = d.state().customs[d.state().customs.length - 1];
    if (!last) {
      if (name === 'finish_custom') { d.record(name, args, { ok: true, note: 'nothing to finish' }); return { response: { ok: true }, background: true, silent: true }; }
      return fail('there is no custom diagram yet; call start_custom first', args);
    }
    args.custom_id = last.id;
  }
  const ok = (result: Record<string, unknown> = { ok: true }): ExecResult => { d.record(name, args, result); return { response: result }; };
  const s = d.state();
  const custom = (id: string) => s.customs.find(c => c.id === id);
  const general = (id: string) => d.diagrams.find(g => g.id === id);
  switch (name as ToolName) {
    case 'show_diagram': {
      if (typeof args.id === 'string' && args.id.includes('.') && !general(args.id) && !custom(args.id)) { const [id, part] = args.id.split('.'); args.id = id; args.part ??= part; }
      const g = general(args.id), c = custom(args.id);
      if (!g && !c) return fail(`no diagram "${args.id}". General: ${d.diagrams.map(x => x.id).join(', ')}; custom: ${s.customs.map(x => x.id).join(', ') || 'none'}`, args);
      if (args.part && g) {
        const parts = Object.keys(layout(g, { sel: args.part }).anchors);
        // a wrong part name should not cost a regeneration: show the diagram, tell the model quietly
        if (!parts.includes(args.part)) { const bad = args.part; delete args.part; return ok({ ok: true, note: `shown without selecting "${bad}" (not a part; parts: ${Object.keys(layout(g).anchors).join(', ')})` }); }
      }
      return ok();
    }
    case 'start_custom': {
      const base = args.base ? general(args.base) : null;
      if (args.base && !base) return fail(`base "${args.base}" is not a general diagram id (${d.diagrams.map(x => x.id).join(', ')})`, args);
      const custom_id = d.nextCustomId();
      return ok({ custom_id, targets: base ? Object.keys(layout(base).anchors) : [], next: base ? 'add_step' : 'draw_from_scratch' });
    }
    case 'add_step': {
      const c = custom(args.custom_id); if (!c) return fail(`no custom diagram "${args.custom_id}"`, args);
      if (c.pending) return fail('the diagram is still being drawn; wait for draw_from_scratch to return', args);
      const base = c.base ? general(c.base) || null : null;
      const trial = composeAll({ ...c, steps: [...c.steps, args.ops] }, base);
      if (trial.issues.length) {
        // point the model at the diagram that does contain a missing target
        const hints = args.ops.flatMap((o: any) => [o.target, o.from, o.to, o.after]).filter(Boolean)
          .filter((t: string) => !(t in trial.L.anchors))
          .map((t: string) => { const g = d.diagrams.find(x => t in layout(x).anchors); return g ? `"${t}" belongs to ${g.id} ("${g.nav}"); for a new question call start_custom with base "${g.id}"` : null; })
          .filter(Boolean);
        return fail([...trial.issues.slice(0, 2), ...hints].join('; '), args);
      }
      return ok({ ok: true, step: c.steps.length + 1 });
    }
    case 'draw_from_scratch': {
      const c = custom(args.custom_id); if (!c) return fail(`no custom diagram "${args.custom_id}"`, args);
      if (c.base) return fail('this custom diagram has a base; use add_step instead', args);
      d.record(name, args, { started: true });
      try {
        const r = await d.scratch({ ...args, question: c.question, nav: c.nav, head: c.head });
        d.record('scratch_ready', { custom_id: c.id }, { spec: r.spec });
        return { response: { ok: true, drawn: true, targets: r.targets }, background: true, silent: true };
      } catch (e: any) { d.record('scratch_ready', { custom_id: c.id }, { error: String(e?.message || e) }); return { response: { error: String(e?.message || e) }, background: true }; }
    }
    case 'finish_custom': return custom(args.custom_id) ? { ...ok(), background: true, silent: true } : fail(`no custom diagram "${args.custom_id}"`, args);
    case 'read_section': {
      try { const sec = await d.section(args.id); d.record(name, args, { ok: true, title: sec.title }); return { response: sec }; }
      catch (e: any) { return fail(String(e?.message || e), args); }
    }
  }
  return fail(`unhandled tool ${name}`);
}

/**
 * Forgive cosmetic slips that would otherwise fail validation. Every rejected call makes the live model generate
 * again, and it tends to repeat what it just said, so only semantic problems (unknown targets) are rejected.
 */
const OPS = ['badge', 'highlight', 'note', 'addNode', 'addEdge', 'addRow', 'marker', 'addSeries', 'callout'];
const clip = (v: unknown, n: number) => typeof v === 'string' && v.length > n ? v.slice(0, n - 1).trimEnd() + '…' : v;
export function normalise(name: string, raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const a: any = { ...(raw as any) };
  if (name === 'add_step' && Array.isArray(a.ops)) {
    a.ops = a.ops.slice(0, 4).map((o: any) => {
      if (!o || typeof o !== 'object') return o;
      const key = String(o.op ?? o.type ?? '').toLowerCase().replace(/[^a-z]/g, '');
      const op = OPS.find(x => x.toLowerCase() === key) ?? (key === 'label' || key === 'tag' ? 'badge' : key === 'text' || key === 'caption' ? 'callout' : key === 'outline' || key === 'circle' ? 'highlight' : o.op);
      const n = { ...o, op };
      if ((op === 'badge' || op === 'note' || op === 'callout' || op === 'marker') && !n.text && n.label) n.text = n.label;
      n.text = clip(n.text, 140); n.label = clip(n.label, 28); n.sub = clip(n.sub, 36);
      if (Array.isArray(n.cells)) n.cells = n.cells.slice(0, 3).map((c: unknown) => clip(String(c), 60));
      return n;
    });
  }
  if (name === 'start_custom') { a.nav = clip(a.nav, 34); a.head = clip(a.head, 70); }
  return a;
}

/**
 * How to deliver a background result. Silent results don't make the model speak again (which made it repeat itself),
 * but if the guide has not said anything since it asked for the drawing, it is waiting: wake it up to answer.
 */
export function deliver(r: ExecResult, spokeSinceCall: boolean, nonBlocking = !!r.background): { response: Record<string, unknown>; scheduling?: 'SILENT' | 'WHEN_IDLE' } {
  if (!nonBlocking) return { response: r.response };
  if (r.response.error) return { response: { ...r.response, note: spokeSinceCall ? 'Correct this call. Do not repeat what you already said.' : undefined }, scheduling: 'WHEN_IDLE' };
  if (spokeSinceCall && (r.silent || !r.background)) return { response: r.response, scheduling: 'SILENT' };
  return { response: spokeSinceCall ? r.response : { ...r.response, note: 'If you have not answered the reader yet, answer now in two or three sentences using what is on screen. If you already have, say nothing.' }, scheduling: 'WHEN_IDLE' };
}

/**
 * Deliver a tool result once the guide has settled. A non-blocking result often arrives just before the guide's
 * first words; deciding then would wake a guide that was about to speak, and it would answer twice. So wait until
 * 5 s after the call or 1.5 s after the result (whichever is later), or until the guide speaks.
 */
export async function settle(r: ExecResult, nonBlocking: boolean, tCallMs: number, spokeSince: (tMs: number) => boolean, nowMs: () => number): Promise<ReturnType<typeof deliver>> {
  if (nonBlocking && !r.response.error) {
    const until = Math.max(tCallMs + 5000, nowMs() + 1500);
    while (nowMs() < until && !spokeSince(tCallMs)) await new Promise(res => setTimeout(res, 100));
  }
  return deliver(r, spokeSince(tCallMs), nonBlocking);
}

/** Convenience: a state holder wired to applyTool, for callers that keep state outside React. */
export function stateHolder(init: GuideState, onChange?: (s: GuideState) => void) {
  let st = init;
  return { get: () => st, apply: (name: string, args: unknown, result: unknown) => { st = applyTool(st, name, args, result); onChange?.(st); } };
}
