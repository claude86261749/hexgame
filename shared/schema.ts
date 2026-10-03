// The contract between the models, the harness and the renderer.
// Models only ever produce JSON matching these schemas; the renderer is fixed code.
import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_-]{0,23}$/).describe('short lowercase id, unique within the diagram, e.g. "teacher"');
const sources = z.array(z.string()).max(4).describe('ids of paper sections that support this, e.g. ["s4.2"]');
const note = z.string().max(700).describe('side-panel text shown when this element is selected: 1-3 plain sentences');

/* ------------------------------------------------------------------ paper */
export const Section = z.object({ id: z.string(), title: z.string(), level: z.number(), text: z.string() });
export const Reference = z.object({ key: z.string(), text: z.string(), arxiv: z.string().optional() });
export const PaperDoc = z.object({
  id: z.string(), title: z.string(), authors: z.string(), arxiv: z.string().optional(),
  sections: z.array(Section), references: z.array(Reference), tokens: z.number(),
});
export type PaperDoc = z.infer<typeof PaperDoc>;

/* ------------------------------------------------------------------ digest */
export const Relation = z.enum(['lineage', 'component', 'compare', 'downstream']);
export const RelatedWork = z.object({
  id, label: z.string().max(22).describe('tile label, 1-3 words, e.g. "DINOv2"'),
  year: z.string().max(10), title: z.string(), authors: z.string().optional(), venue: z.string().optional(),
  arxiv: z.string().optional().describe('arXiv id like 2304.07193 if known from the references'),
  relation: Relation.describe('lineage: this paper descends from it; component: a part it reuses; compare: a baseline/rival it measures against; downstream: work that builds on features/results like these'),
  weight: z.number().int().min(1).max(3).describe('3 = the paper leans on it heavily, 1 = touches it lightly'),
  link: z.string().max(500).describe('2-3 sentences: how the two papers connect'),
  carriedHeading: z.string().max(40), carried: z.array(z.string().max(90)).max(5),
  changedHeading: z.string().max(40), changed: z.array(z.string().max(90)).max(5),
});
export const OpenDirection = z.object({
  id, label: z.string().max(26).describe('tile label, 2-4 words'), title: z.string().max(80),
  shows: z.string().max(300).describe('what the paper shows'), open: z.string().max(400).describe('what it leaves open'),
  move: z.string().max(300).describe('a concrete first experiment'), from: z.array(z.string()).min(1).max(3).describe('ids of related works to approach it from'),
});
const Cited = z.object({ text: z.string().max(400), sources });
export const Digest = z.object({
  title: z.string(), shortTitle: z.string().max(24).describe('the name people use, e.g. "DINOv3"'),
  byline: z.string().describe('"Surname, Surname and colleagues, Institution, Year"'),
  arxiv: z.string().optional(), field: z.string().max(60).describe('e.g. "Self-supervised vision"'),
  gist: z.string().max(320).describe('two sentences for a smart non-specialist'),
  problem: Cited, newIdea: Cited.describe('the single most important new idea'),
  claims: z.array(Cited).max(8), method: z.array(z.object({ step: z.string().max(40), detail: z.string().max(400), sources })).max(8),
  findings: z.array(Cited).max(8), limitations: z.array(Cited).max(6),
  related: z.array(RelatedWork).max(10), openDirections: z.array(OpenDirection).max(5),
  glossary: z.array(z.object({ term: z.string(), plain: z.string().max(200) })).max(12),
});
export type Digest = z.infer<typeof Digest>;

/* ------------------------------------------------------------------ diagrams */
const common = {
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  nav: z.string().max(34).describe('short table-of-contents label, e.g. "What breaks at scale"'),
  head: z.string().max(70).describe('the claim the diagram makes, as a heading'),
  body: z.array(z.string().max(420)).min(1).max(3).describe('1-3 short paragraphs read beside the diagram'),
  hint: z.string().max(110).optional().describe('how to interact, e.g. "Select a step to see it drawn out."'),
  caveat: z.string().max(100).optional().describe('shown on the diagram, e.g. "Curve shapes are schematic, not the paper\'s numbers."'),
  sources,
};

export const NodeKind = z.enum(['default', 'accent', 'input', 'output', 'muted']);
export const FlowNode = z.object({
  id, label: z.string().max(28), sub: z.string().max(36).optional().describe('second line, muted'),
  kind: NodeKind.optional(), note: note.optional(), sources: sources.optional(),
});
export const FlowEdge = z.object({ from: z.string(), to: z.string(), label: z.string().max(22).optional(), dashed: z.boolean().optional() });
const flowBody = {
  direction: z.enum(['LR', 'TB']).describe('LR for pipelines up to 4 layers deep, TB otherwise'),
  nodes: z.array(FlowNode).min(2).max(10), edges: z.array(FlowEdge).max(16),
  groups: z.array(z.object({ id, label: z.string().max(30), nodes: z.array(z.string()).min(1) })).max(3).optional(),
};

export const CompareRow = z.object({ id, label: z.string().max(26), cells: z.array(z.string().max(34)).min(1).max(3), mark: z.boolean().optional(), note: note.optional() });
const compareBody = {
  columns: z.array(z.string().max(24)).min(1).max(3).describe('headers for the cell columns (the row-label column has no header)'),
  rows: z.array(CompareRow).min(1).max(10),
};

export const MatrixPanel = z.object({
  id, label: z.string().max(30), size: z.number().int().min(4).max(12),
  preset: z.enum(['diagonal', 'blocks', 'noisy-blocks', 'noise', 'explicit']),
  blocks: z.number().int().min(2).max(4).optional(), noise: z.number().min(0).max(1).optional(),
  values: z.array(z.array(z.number().min(0).max(1))).optional().describe('only with preset "explicit"'),
  accent: z.boolean().optional(), note: note.optional(), sources: sources.optional(),
});
const matrixBody = {
  panels: z.array(MatrixPanel).min(1).max(3),
  links: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().max(26) })).max(2).optional(),
};

export const SeriesShape = z.enum(['rise', 'saturate', 'fall', 'decay', 'peak-then-fall', 'dip-then-rise', 's-curve', 'flat', 'points']);
export const Series = z.object({
  id, label: z.string().max(26), shape: SeriesShape,
  peak: z.number().min(0).max(1).optional().describe('x (0-1) of the peak, dip or inflection'),
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(12).optional().describe('only with shape "points"'),
  accent: z.boolean().optional(), note: note.optional(), sources: sources.optional(),
});
const chartBody = {
  xLabel: z.string().max(40), yLabel: z.string().max(40).optional(),
  series: z.array(Series).min(1).max(3),
  xTicks: z.array(z.object({ x: z.number().min(0).max(1), label: z.string().max(10) })).max(5).optional(),
  annotations: z.array(z.object({ id, x: z.number().min(0).max(1), label: z.string().max(24), note: note.optional() })).max(3).optional(),
  states: z.array(z.object({ from: z.number().min(0).max(1), to: z.number().min(0).max(1), text: z.string().max(140) })).min(1).max(4)
    .describe('what is true in each x range; shown as the reader scrubs'),
  schematic: z.boolean().describe('true unless every curve is drawn from numbers in a cited table'),
};

const detail = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flow'), ...flowBody }),
  z.object({ kind: z.literal('compare'), ...compareBody }),
  z.object({ kind: z.literal('matrix'), ...matrixBody }),
  z.object({ kind: z.literal('bullets'), items: z.array(z.string().max(80)).min(1).max(5) }),
]);
export const PipelineStep = z.object({
  id, label: z.string().max(14).describe('1-2 words in the strip'), title: z.string().max(40),
  note, sources, detail: detail.optional().describe('drawn in the frame under the strip when this step is selected'),
});
const pipelineBody = {
  steps: z.array(PipelineStep).min(2).max(7),
  phases: z.array(z.object({ label: z.string().max(30), from: z.string(), to: z.string() })).max(3).optional(),
};

const simBody = {
  kind: z.literal('similarity-map'),
  regions: z.array(z.string().max(14)).length(4).describe('names of the 4 regions of the toy image, e.g. ["sky","dog","tree","grass"]'),
  modes: z.array(z.object({ label: z.string().max(22), coherence: z.number().min(0).max(1), noise: z.number().min(0).max(1), accent: z.boolean().optional() })).min(2).max(3),
  unit: z.string().max(14).describe('what one cell is, e.g. "patch", "token"'),
};

const landscapeBody = {
  center: z.object({ label: z.string().max(22) }),
  tiles: z.array(RelatedWork).max(10), open: z.array(OpenDirection).max(5),
};

export const FreeItem = z.object({
  kind: z.enum(['box', 'text', 'arrow', 'circle']), id: id.optional(),
  x: z.number(), y: z.number(), w: z.number().optional(), h: z.number().optional(), x2: z.number().optional(), y2: z.number().optional(),
  text: z.string().max(60).optional(), accent: z.boolean().optional(), muted: z.boolean().optional(), note: note.optional(),
});
const freeBody = { items: z.array(FreeItem).min(1).max(40).describe('primitives on a 560x360 canvas') };

export const FlowSpec = z.object({ ...common, type: z.literal('flow'), ...flowBody });
export const PipelineSpec = z.object({ ...common, type: z.literal('pipeline'), ...pipelineBody });
export const ChartSpec = z.object({ ...common, type: z.literal('chart'), ...chartBody });
export const MatrixSpec = z.object({ ...common, type: z.literal('matrix'), ...matrixBody });
export const CompareSpec = z.object({ ...common, type: z.literal('compare'), ...compareBody });
export const SimSpec = z.object({ ...common, type: z.literal('sim'), ...simBody });
export const LandscapeSpec = z.object({ ...common, type: z.literal('landscape'), ...landscapeBody });
export const FreeSpec = z.object({ ...common, type: z.literal('free'), ...freeBody });

export const SPEC_BY_TYPE = { flow: FlowSpec, pipeline: PipelineSpec, chart: ChartSpec, matrix: MatrixSpec, compare: CompareSpec, sim: SimSpec, landscape: LandscapeSpec, free: FreeSpec } as const;
export type DiagramType = keyof typeof SPEC_BY_TYPE;
export const GENERATED_TYPES = ['flow', 'pipeline', 'chart', 'matrix', 'compare', 'sim', 'free'] as const;
export const Diagram = z.discriminatedUnion('type', [FlowSpec, PipelineSpec, ChartSpec, MatrixSpec, CompareSpec, SimSpec, LandscapeSpec, FreeSpec]);
export type Diagram = z.infer<typeof Diagram>;
export type FlowSpec = z.infer<typeof FlowSpec>; export type PipelineSpec = z.infer<typeof PipelineSpec>;
export type ChartSpec = z.infer<typeof ChartSpec>; export type MatrixSpec = z.infer<typeof MatrixSpec>;
export type CompareSpec = z.infer<typeof CompareSpec>; export type SimSpec = z.infer<typeof SimSpec>;
export type LandscapeSpec = z.infer<typeof LandscapeSpec>; export type FreeSpec = z.infer<typeof FreeSpec>;
export type Detail = z.infer<typeof detail>;

/* ------------------------------------------------------------------ plan */
export const PlanItem = z.object({
  id: z.string().regex(/^g[1-9]$/), type: z.enum(GENERATED_TYPES),
  nav: z.string().max(34), question: z.string().max(140).describe('the one reader question this diagram answers'),
  mustShow: z.string().max(600).describe('what the diagram must contain, concretely'),
  sources: z.array(z.string()).min(1).max(6),
});
export const Plan = z.object({ diagrams: z.array(PlanItem).min(3).max(6) });
export type Plan = z.infer<typeof Plan>;

/* ------------------------------------------------------------------ overlays (custom diagrams) */
export const OverlayOp = z.object({
  op: z.enum(['badge', 'highlight', 'note', 'addNode', 'addEdge', 'addRow', 'marker', 'addSeries', 'callout']),
  target: z.string().optional(), text: z.string().max(140).optional(),
  id: z.string().optional(), label: z.string().max(28).optional(), sub: z.string().max(36).optional(),
  after: z.string().optional(), from: z.string().optional(), to: z.string().optional(),
  x: z.number().min(0).max(1).optional(), cells: z.array(z.string().max(60)).max(3).optional(),
  shape: SeriesShape.optional(), peak: z.number().optional(),
});
export type OverlayOp = z.infer<typeof OverlayOp>;
export const Custom = z.object({
  id: z.string(), question: z.string(), base: z.string().nullable(), nav: z.string(), head: z.string(),
  summary: z.string().default(''), spec: Diagram.nullable().default(null), steps: z.array(z.array(OverlayOp)).default([]),
  pending: z.boolean().optional(),
});
export type Custom = z.infer<typeof Custom>;

/* ------------------------------------------------------------------ sessions */
export type SessionEvent =
  | { t: number; kind: 'you' | 'guide'; text: string }
  | { t: number; kind: 'turn' }
  | { t: number; kind: 'tool'; name: string; args: Record<string, unknown>; result?: unknown };
export interface SessionLog { id: string; paperId: string; startedAt: string; duration: number; events: SessionEvent[]; customs: Custom[]; title?: string }

export interface PaperBundle {
  id: string; doc: Omit<PaperDoc, 'sections'> & { sections: { id: string; title: string; level: number; chars: number }[] };
  digest: Digest | null; diagrams: Diagram[]; status: PipelineStatus;
}
export interface PipelineStatus {
  stage: 'queued' | 'ingest' | 'digest' | 'plan' | 'specs' | 'factcheck' | 'done' | 'error';
  message?: string; items: { id: string; nav: string; type: string; state: 'waiting' | 'generating' | 'repairing' | 'ok' | 'dropped'; note?: string }[];
}
