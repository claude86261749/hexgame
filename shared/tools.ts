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
  { name: 'start_custom', description: 'Start a custom diagram for the reader\'s question. With base = a general diagram id, the base is drawn plain and your steps add orange marks to it. Without base, follow with draw_from_scratch. Returns custom_id and the element ids you can target.',
    parameters: S('OBJECT', { properties: { question: S('STRING', { description: 'the reader\'s question, in their words' }), base: S('STRING'), nav: S('STRING', { description: 'short title, ≤ 34 chars' }), head: S('STRING', { description: 'the answer as a claim, ≤ 70 chars' }) }, required: ['question', 'nav', 'head'] }) },
  { name: 'add_step', description: 'Reveal the next orange step of a custom diagram: 1-3 ops shown together. Call it before you talk about what it shows.',
    parameters: S('OBJECT', { properties: { custom_id: S('STRING'), ops: S('ARRAY', { items: OP_DECL }) }, required: ['custom_id', 'ops'] }) },
  { name: 'draw_from_scratch', behavior: 'NON_BLOCKING', description: 'Have a new diagram drawn for a custom diagram started without base. Slow (10-30 s); runs in the background. Returns the element ids when done.',
    parameters: S('OBJECT', { properties: { custom_id: S('STRING'), type: S('STRING', { enum: ['flow', 'pipeline', 'chart', 'matrix', 'compare'] }), brief: S('STRING', { description: 'exactly what to draw: the elements, their relations, what to emphasise' }) }, required: ['custom_id', 'type', 'brief'] }) },
  { name: 'finish_custom', description: 'Close the custom diagram with a 2-3 sentence summary shown beside it.',
    parameters: S('OBJECT', { properties: { custom_id: S('STRING'), summary: S('STRING') }, required: ['custom_id', 'summary'] }) },
  { name: 'read_section', description: 'Read a section of the paper by id from the section index, for exact details.',
    parameters: S('OBJECT', { properties: { id: S('STRING') }, required: ['id'] }) },
] as const;

export const ToolArgs = {
  show_diagram: z.object({ id: z.string(), part: z.string().optional(), x: z.number().min(0).max(1).optional() }),
  start_custom: z.object({ question: z.string(), base: z.string().optional(), nav: z.string(), head: z.string() }),
  add_step: z.object({ custom_id: z.string(), ops: z.array(OverlayOp).min(1).max(4) }),
  draw_from_scratch: z.object({ custom_id: z.string(), type: z.enum(['flow', 'pipeline', 'chart', 'matrix', 'compare']), brief: z.string() }),
  finish_custom: z.object({ custom_id: z.string(), summary: z.string() }),
  read_section: z.object({ id: z.string() }),
} as const;
export type ToolName = keyof typeof ToolArgs;
