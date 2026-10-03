// draw_from_scratch: a live brief → one validated diagram spec, via flash.
import type { Diagram, Digest, PaperDoc } from '../shared/schema.ts';
import { layout } from '../shared/layout.ts';
import { relevantSections } from './ingest.ts';
import { generateSpec } from './pipeline.ts';
import { prompt } from './prompts.ts';
import * as store from './store.ts';

export async function drawScratch(paperId: string, a: { brief: string; question?: string; type: string; custom_id?: string; nav?: string; head?: string }) {
  const doc = store.get<PaperDoc>(paperId, 'doc.json'), digest = store.get<Digest>(paperId, 'digest.json');
  if (!doc || !digest) throw new Error('paper not ready');
  const sources = relevantSections(doc, `${a.brief} ${a.question || ''}`, 3);
  const item = { id: 'g1', type: a.type as any, nav: (a.nav || 'Drawn for you').slice(0, 34), question: a.question || a.brief, mustShow: a.brief, sources };
  const r = await generateSpec(doc, digest, null, item, { stage: `scratch:${a.type}`, extraSystem: prompt('scratch') });
  const spec = { ...r.value, id: a.custom_id || 'scratch', nav: item.nav, head: (a.head || r.value.head).slice(0, 70) } as Diagram;
  return { spec, targets: Object.keys(layout(spec).anchors) };
}
