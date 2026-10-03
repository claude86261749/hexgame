// Live guide tools: declarations sent to gemini-3.8-live, and the zod schemas the browser executor validates against.
import { z } from 'zod';
import { OverlayOp, SeriesShape } from './schema.ts';

const S = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const OP_DECL = S('OBJECT', {
  properties: {
    op: S('STRING', { enum: OverlayOp.shape.op.options, description: 'badge: short tag on target · highlight: outline target · note: a sentence beside target · addNode: new box (flow only; after = node it follows) · addEdge: arrow from → to · addRow: table row (compare only; label + cells) · addSeries: new curve (chart only; label + shape) · marker: vertical line at x (chart only) · callout: a sentence under the diagram' }),
    target: S('STRING', { description: 'element id to attach to' }), text: S('STRING'), id: S('STRING'), label: S('STRING'), sub: S('STRING'),
    after: S('STRING'), from: S('STRING'), to: S('STRING'), x: S('NUMBER', { description: '0..1 along the chart x axis' }),
    cells: S('ARRAY', { items: S('STRING') }), shape: S('STRING', { enum: SeriesShape.options }), peak: S('NUMBER'),
  },
  required: ['op'],
});

export const TOOL_DECLS = [
  { name: 'show_diagram', description: 'Put a diagram on screen (a general diagram id, or a custom diagram id), optionally selecting a part (its note opens beside the diagram) or setting the chart position x (0..1).',
    parameters: S('OBJECT', { properties: { id: S('STRING'), part: S('STRING'), x: S('NUMBER') }, required: ['id'] }) },
  { name: 'start_custom', description: 'Start a custom diagram for the reader\'s question, normally with base = the general diagram closest to the answer; it is drawn plain and your add_step marks go on top. Only leave base out when no general diagram relates at all, and then call draw_from_scratch. Returns the element ids you can target.',
    parameters: S('OBJECT', { properties: { question: S('STRING', { description: 'the reader\'s question, in their words' }), base: S('STRING'), nav: S('STRING', { description: 'short title, ≤ 34 chars' }), head: S('STRING', { description: 'the answer as a claim, ≤ 70 chars' }) }, required: ['question', 'nav', 'head'] }) },
  { name: 'add_step', description: 'Reveal the next orange step of a custom diagram: 1-3 ops shown together. Call it before you talk about what it shows.',
    parameters: S('OBJECT', { properties: { custom_id: S('STRING', { description: 'optional; defaults to the latest custom diagram' }), ops: S('ARRAY', { items: OP_DECL }) }, required: ['ops'] }) },
  { name: 'draw_from_scratch', behavior: 'NON_BLOCKING', description: 'Have a new diagram drawn for a custom diagram started without base. Slow (10-30 s); runs in the background and appears on screen by itself. Its element ids arrive quietly for later steps.',
    parameters: S('OBJECT', { properties: { custom_id: S('STRING', { description: 'optional; defaults to the latest custom diagram' }), type: S('STRING', { enum: ['flow', 'pipeline', 'chart', 'matrix', 'compare'] }), brief: S('STRING', { description: 'exactly what to draw: the elements, their relations, what to emphasise' }) }, required: ['type', 'brief'] }) },
  { name: 'finish_custom', behavior: 'NON_BLOCKING', description: 'Close the custom diagram with a 2-3 sentence summary shown beside it.',
    parameters: S('OBJECT', { properties: { custom_id: S('STRING', { description: 'optional; defaults to the latest custom diagram' }), summary: S('STRING') }, required: ['summary'] }) },
  { name: 'read_section', description: 'Read a section of the paper by id from the section index, for exact details.',
    parameters: S('OBJECT', { properties: { id: S('STRING') }, required: ['id'] }) },
] as const;

/** Screen tools the guide calls around its speech. NON_BLOCKING lets it talk right after calling them. */
export const SCREEN_TOOLS = ['show_diagram', 'start_custom', 'add_step', 'draw_from_scratch', 'finish_custom'];
export const toolDecls = (o: { nonBlocking?: boolean } = {}) =>
  TOOL_DECLS.map(t => o.nonBlocking && SCREEN_TOOLS.includes(t.name) ? { ...t, behavior: 'NON_BLOCKING' } : t);
export const isNonBlocking = (decls: readonly { name: string; behavior?: string }[], name: string) => decls.find(t => t.name === name)?.behavior === 'NON_BLOCKING';

export const ToolArgs = {
  show_diagram: z.object({ id: z.string(), part: z.string().optional(), x: z.number().min(0).max(1).optional() }),
  start_custom: z.object({ question: z.string(), base: z.string().optional(), nav: z.string(), head: z.string() }),
  add_step: z.object({ custom_id: z.string().optional(), ops: z.array(OverlayOp).min(1).max(4) }),
  draw_from_scratch: z.object({ custom_id: z.string().optional(), type: z.enum(['flow', 'pipeline', 'chart', 'matrix', 'compare']), brief: z.string() }),
  finish_custom: z.object({ custom_id: z.string().optional(), summary: z.string() }),
  read_section: z.object({ id: z.string() }),
} as const;
export type ToolName = keyof typeof ToolArgs;
