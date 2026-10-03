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
export interface ExecResult { response: Record<string, unknown>; background?: boolean }

export async function execTool(d: ExecDeps, name: string, raw: unknown): Promise<ExecResult> {
  const schema = (ToolArgs as Record<string, any>)[name];
  const fail = (error: string, args: unknown = raw): ExecResult => { d.record(name, args, { error }); return { response: { error } }; };
  if (!schema) return fail(`unknown tool ${name}`);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const args: any = parsed.data;
  const ok = (result: Record<string, unknown> = { ok: true }): ExecResult => { d.record(name, args, result); return { response: result }; };
  const s = d.state();
  const custom = (id: string) => s.customs.find(c => c.id === id);
  const general = (id: string) => d.diagrams.find(g => g.id === id);
  switch (name as ToolName) {
    case 'show_diagram': {
      const g = general(args.id), c = custom(args.id);
      if (!g && !c) return fail(`no diagram "${args.id}". General: ${d.diagrams.map(x => x.id).join(', ')}; custom: ${s.customs.map(x => x.id).join(', ') || 'none'}`, args);
      if (args.part && g) {
        const parts = Object.keys(layout(g, { sel: args.part }).anchors);
        if (!parts.includes(args.part)) return fail(`"${args.part}" is not a part of ${args.id}; parts: ${Object.keys(layout(g).anchors).join(', ')}`, args);
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
        return { response: { ok: true, targets: r.targets }, background: true };
      } catch (e: any) { d.record('scratch_ready', { custom_id: c.id }, { error: String(e?.message || e) }); return { response: { error: String(e?.message || e) }, background: true }; }
    }
    case 'finish_custom': return custom(args.custom_id) ? ok() : fail(`no custom diagram "${args.custom_id}"`, args);
    case 'read_section': {
      try { const sec = await d.section(args.id); d.record(name, args, { ok: true, title: sec.title }); return { response: sec }; }
      catch (e: any) { return fail(String(e?.message || e), args); }
    }
  }
  return fail(`unhandled tool ${name}`);
}

/** Convenience: a state holder wired to applyTool, for callers that keep state outside React. */
export function stateHolder(init: GuideState, onChange?: (s: GuideState) => void) {
  let st = init;
  return { get: () => st, apply: (name: string, args: unknown, result: unknown) => { st = applyTool(st, name, args, result); onChange?.(st); } };
}
