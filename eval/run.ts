// Offline pipeline eval over a corpus of .md papers: npm run eval -- papers/*.md [--force] [--no-factcheck]
// Reports, per paper: diagrams kept/dropped, type mix, repairs, remaining layout issues, citation validity,
// fact-check rewrites, wall time and tokens. Writes data/eval/<timestamp>.json.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagram, PaperDoc, PipelineStatus } from '../shared/schema.ts';
import { layout } from '../shared/layout.ts';
import { ingest } from '../server/ingest.ts';
import { startPipeline, waitFor } from '../server/pipeline.ts';
import { callStats } from '../server/gemini.ts';
import { promptVersion } from '../server/prompts.ts';
import * as store from '../server/store.ts';

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
const force = process.argv.includes('--force'), factcheck = !process.argv.includes('--no-factcheck');
const rows: any[] = [];
for (const f of files) {
  const md = readFileSync(f, 'utf8'), id = ingest(md).id;
  const before = { ...callStats }, t0 = Date.now();
  startPipeline(md, { force, factcheck }); await waitFor(id);
  const st = store.get<PipelineStatus>(id, 'status.json')!, ds = store.get<Diagram[]>(id, 'diagrams.json') || [], doc = store.get<PaperDoc>(id, 'doc.json')!;
  const valid = new Set(doc.sections.map(s => s.id));
  const cites: string[] = []; JSON.stringify(ds, (k, v) => { if (k === 'sources' && Array.isArray(v)) cites.push(...v); return v; });
  const fc = store.get<string[]>(id, 'factcheck.json') || [];
  rows.push({
    paper: f, id, stage: st.stage, secs: Math.round((Date.now() - t0) / 1000),
    diagrams: ds.length, dropped: st.items.filter(i => i.state === 'dropped').length,
    types: ds.map(d => d.type).join(','),
    repairs: st.items.reduce((n, i) => n + (Number(i.note?.match(/(\d+) repair/)?.[1]) || 0), 0),
    fallbacks: st.items.filter(i => i.note?.includes('fell back')).length,
    layoutIssues: ds.reduce((n, d) => n + layout(d).issues.length, 0),
    citations: cites.length, badCitations: cites.filter(c => !valid.has(c)).length,
    factcheckRewrites: fc.filter(l => l.includes('rewritten')).length, factcheckFlags: fc.length,
    calls: callStats.calls - before.calls, cached: callStats.cached - before.cached,
    kTokIn: Math.round((callStats.inTok - before.inTok) / 1000), kTokOut: Math.round((callStats.outTok - before.outTok + callStats.thoughtTok - before.thoughtTok) / 1000),
  });
}
console.table(rows.map(({ paper, id, ...r }) => ({ paper: paper.split('/').pop(), ...r })));
const dir = join(store.DATA, 'eval'); mkdirSync(dir, { recursive: true });
const out = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ promptVersion: promptVersion(), rows }, null, 1));
console.log('report:', out);
process.exit(0);
