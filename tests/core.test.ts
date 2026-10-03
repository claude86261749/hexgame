import { describe, it, expect } from 'vitest';
import { ingest, paperText, relevantSections } from '../server/ingest.ts';
import { layout } from '../shared/layout.ts';
import { composeAll } from '../shared/overlay.ts';
import { execTool, stateHolder } from '../shared/executor.ts';
import { emptyGuide, foldEvents, transcriptLines } from '../shared/session.ts';
import { checkSpec } from '../server/validate.ts';
import type { Diagram, FlowSpec, ChartSpec, SessionEvent } from '../shared/schema.ts';

const MD = `---
title: "Toy Paper"
authors: "A. Author, B. Author"
---
# Toy Paper
###### Abstract
We study toys. See [the code](https://x.y).
## 1 Introduction
Toys are fun.
##### A paragraph heading
More text.
## 2 Method
### 2.1 Step one
Do the first thing with $x^2$.
## References
- Smith. Toys at scale. arXiv:2101.00001, 2021.
- Jones. Another reference that is long enough to count.
`;

const flow: FlowSpec = {
  id: 'g1', type: 'flow', nav: 'What it is', head: 'A toy flows', body: ['Body.'], sources: ['s1'], direction: 'LR',
  nodes: [{ id: 'a', label: 'Input', note: 'n' }, { id: 'b', label: 'Model', kind: 'accent', note: 'n' }, { id: 'c', label: 'Output', note: 'n' }],
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
};
const chart: ChartSpec = {
  id: 'g2', type: 'chart', nav: 'Trend', head: 'It rises', body: ['Body.'], sources: [], xLabel: 'time', schematic: true,
  series: [{ id: 'up', label: 'Quality', shape: 'rise' }, { id: 'down', label: 'Cost', shape: 'fall' }],
  states: [{ from: 0, to: 0.5, text: 'Early.' }, { from: 0.5, to: 1, text: 'Late.' }],
};

describe('ingest', () => {
  const doc = ingest(MD);
  it('reads front matter and numbered sections with stable ids', () => {
    expect(doc.title).toBe('Toy Paper');
    expect(doc.sections.map(s => s.id)).toEqual(['abstract', 's1', 's2', 's2.1', 'refs']);
  });
  it('turns links into text and keeps paragraph headings inline', () => {
    expect(doc.sections[0].text).toContain('See the code.');
    expect(doc.sections[1].text).toContain('**A paragraph heading.**');
  });
  it('parses references with arXiv ids', () => {
    expect(doc.references[0].arxiv).toBe('2101.00001');
  });
  it('prefixes section ids for citation and retrieves by keyword', () => {
    expect(paperText(doc)).toContain('[s2.1] ### 2.1 Step one');
    expect(relevantSections(doc, 'first thing step')[0]).toBe('s2.1');
  });
});

describe('layout lint', () => {
  it('accepts a small flow', () => { expect(layout(flow).issues).toEqual([]); });
  it('rejects a flow too deep for left-to-right', () => {
    const deep = { ...flow, nodes: 'abcdef'.split('').map(id => ({ id, label: 'Step ' + id })), edges: 'abcde'.split('').map((id, i) => ({ from: id, to: 'abcdef'[i + 1] })) };
    expect(layout(deep).issues.join()).toMatch(/too wide for LR/);
    expect(layout({ ...deep, direction: 'TB' }).issues).toEqual([]);
  });
  it('reports edges to missing nodes and duplicate ids', () => {
    const bad: Diagram = { ...flow, edges: [...flow.edges, { from: 'a', to: 'zzz' }], nodes: [...flow.nodes, { id: 'a', label: 'Dup', note: 'n' }] };
    const doc = ingest(MD);
    const r = checkSpec(bad, doc);
    expect(r.errors.join()).toMatch(/missing node/);
    expect(r.errors.join()).toMatch(/used twice/);
  });
  it('drops citations to unknown sections with a warning', () => {
    const d: Diagram = { ...flow, sources: ['s1', 's99'] };
    const r = checkSpec(d, ingest(MD));
    expect(d.sources).toEqual(['s1']); expect(r.warnings.join()).toMatch(/s99/);
  });
  it('flags chart series that would draw on top of each other', () => {
    expect(layout({ ...chart, series: [chart.series[0], { ...chart.series[0], id: 'twin' }] }).issues.join()).toMatch(/same shape/);
  });
});

describe('overlays', () => {
  const custom = { id: 'c1', question: 'q', base: 'g1', nav: 'n', head: 'h', summary: '', spec: null, steps: [[{ op: 'badge' as const, target: 'b', text: 'new' }], [{ op: 'addNode' as const, id: 'x', label: 'Extra', after: 'b' }]] };
  it('merges structural ops into the spec and positions marks', () => {
    const r = composeAll(custom, flow);
    expect(r.issues).toEqual([]);
    expect(r.spec.type === 'flow' && r.spec.nodes.find(n => n.id === 'x')).toBeTruthy();
    expect(r.items.find(i => i.kind === 'badge')).toBeTruthy();
  });
  it('reports unknown targets', () => {
    expect(composeAll({ ...custom, steps: [[{ op: 'note', target: 'nope', text: 'hi' }]] }, flow).issues.join()).toMatch(/does not exist/);
  });
});

describe('executor + replay', () => {
  it('validates tool calls, applies them, and replays to the same state', async () => {
    const events: SessionEvent[] = []; let t = 0;
    const st = stateHolder(emptyGuide());
    const deps = {
      diagrams: [flow, chart] as Diagram[], state: st.get, nextCustomId: () => 'c1',
      record: (name: string, args: any, result: any) => { events.push({ t: t++, kind: 'tool', name, args, result }); st.apply(name, args, result); },
      scratch: async () => { throw new Error('unused'); }, section: async () => ({ id: 's1', title: 'Intro', text: 'x' }),
    };
    expect((await execTool(deps, 'show_diagram', { id: 'nope' })).response.error).toMatch(/no diagram/);
    expect((await execTool(deps, 'start_custom', { question: 'Why?', base: 'g2', nav: 'Why', head: 'Because' })).response.custom_id).toBe('c1');
    const bad = await execTool(deps, 'add_step', { custom_id: 'c1', ops: [{ op: 'highlight', target: 'b' }] });
    expect(String(bad.response.error)).toMatch(/belongs to g1/);
    expect((await execTool(deps, 'add_step', { custom_id: 'c1', ops: [{ op: 'marker', x: 0.5, text: 'here' }, { op: 'highlight', target: 'up' }] })).response.step).toBe(1);
    const live = st.get(), replayed = foldEvents(events);
    expect(replayed.customs).toEqual(live.customs);
    expect(replayed.view).toEqual({ kind: 'c', id: 'c1' });
  });
  it('builds transcript lines from split transcription chunks', () => {
    const lines = transcriptLines([{ t: 0, kind: 'you', text: 'Why?' }, { t: 1, kind: 'guide', text: 'Becau' }, { t: 1.2, kind: 'guide', text: 'se it is.' }], 3);
    expect(lines.map(l => l.words.map(w => w.w).join(' '))).toEqual(['Why?', 'Because it is.']);
  });
});
