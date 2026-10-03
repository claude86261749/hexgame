// The generation pipeline: .md → PaperDoc → digest → plan → specs (parallel, validated, repaired) → landscape → fact-check.
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { Digest, Plan, SPEC_BY_TYPE, Diagram, type PaperDoc, type PipelineStatus, type LandscapeSpec, PlanItem } from '../shared/schema.ts';
import { ingest, paperText, sectionIndex, relevantSections } from './ingest.ts';
import { generateJSON, GenError } from './gemini.ts';
import { system } from './prompts.ts';
import { checkDigest, checkPlan, checkSpec, readerTexts, setPath } from './validate.ts';
import { layout } from '../shared/layout.ts';
import * as store from './store.ts';

export const bus = new EventEmitter(); bus.setMaxListeners(100);
const running = new Map<string, Promise<void>>();

function setStatus(id: string, s: PipelineStatus) { store.put(id, 'status.json', s); bus.emit(id, s); }

const compactDigest = (g: Digest) => JSON.stringify({ ...g, related: g.related.map(r => ({ id: r.id, label: r.label, relation: r.relation, link: r.link })), glossary: undefined });

export async function generateSpec(doc: PaperDoc, digest: Digest, plan: Plan | null, item: z.infer<typeof PlanItem>, opts: { stage?: string; type?: string; extraSystem?: string } = {}) {
  const type = (opts.type || item.type) as keyof typeof SPEC_BY_TYPE;
  const ctx = paperText(doc, { only: item.sources.length ? item.sources : relevantSections(doc, item.mustShow + ' ' + item.question), maxChars: 60000 });
  const user = [
    `# Digest\n${compactDigest(digest)}`,
    plan ? `# The full plan (for context; draw only your item)\n${plan.diagrams.map(d => `- ${d.id} [${d.type}] ${d.nav}: ${d.question}`).join('\n')}` : '',
    `# Section index\n${sectionIndex(doc)}`,
    `# Your item\n${JSON.stringify({ ...item, type })}`,
    `# Cited sections\n${ctx}`,
  ].filter(Boolean).join('\n\n');
  return generateJSON({
    stage: opts.stage || `spec:${item.id}:${type}`, system: system('style', 'spec', `types/${type}`) + (opts.extraSystem ? '\n\n---\n\n' + opts.extraSystem : ''),
    user, schema: SPEC_BY_TYPE[type] as z.ZodType<Diagram>, thinking: 'low',
    check: v => checkSpec(v, doc, { id: item.id, type }),
  });
}

export function buildLandscape(digest: Digest): LandscapeSpec | null {
  if (digest.related.length < 3) return null;
  const spec: LandscapeSpec = {
    id: 'map', type: 'landscape', nav: 'Around it', head: `Around ${digest.shortTitle} on the map`,
    body: [`${digest.shortTitle} sits among the papers it builds on, reuses, measures itself against, and feeds. Colour shows how each relates; height shows how much ${digest.shortTitle} leans on it. Hatched tiles are directions the paper leaves open.`],
    hint: 'Select a tile.', sources: [], center: { label: digest.shortTitle }, tiles: digest.related, open: digest.openDirections,
  };
  // drop tiles the layout could not place
  const L = layout(spec);
  const placed = new Set(Object.keys(L.anchors));
  spec.tiles = spec.tiles.filter(t => placed.has(t.id)); spec.open = spec.open.filter(o => placed.has(o.id));
  return spec;
}

const FactCheck = z.object({ items: z.array(z.object({ path: z.string(), verdict: z.enum(['supported', 'partly', 'unsupported']), why: z.string().max(200), fix: z.string().max(700) })) });

export async function factCheck(doc: PaperDoc, diagrams: Diagram[]): Promise<string[]> {
  const texts = readerTexts(diagrams);
  const r = await generateJSON({ stage: 'factcheck', system: system('style', 'factcheck'), thinking: 'low', schema: FactCheck,
    user: `# Paper\n${paperText(doc, { refs: false })}\n\n# Texts to check\n${JSON.stringify(texts)}` });
  const log: string[] = [];
  for (const it of r.value.items) {
    if (it.verdict === 'supported') continue;
    const before = JSON.stringify(diagrams);
    const prev = it.fix ? setPath(diagrams, it.path, it.fix) : undefined;
    const di = Number(it.path.split('/')[0]);
    if (prev === undefined) { log.push(`${it.path}: ${it.verdict} (${it.why}) — no fix applied`); continue; }
    // the fix must keep the diagram valid; otherwise revert
    if (!Diagram.safeParse(diagrams[di]).success || layout(diagrams[di]).issues.length > layout(JSON.parse(before)[di]).issues.length) {
      diagrams.splice(0, diagrams.length, ...JSON.parse(before)); log.push(`${it.path}: fix reverted (invalid)`); continue;
    }
    log.push(`${it.path}: ${it.verdict} → rewritten (${it.why})`);
  }
  return log;
}

export function startPipeline(md: string, opts: { force?: boolean; factcheck?: boolean } = {}): string {
  const doc = ingest(md);
  const id = doc.id;
  if (running.has(id)) return id;
  if (!opts.force && store.has(id, 'diagrams.json')) return id;
  const p = runPipeline(md, doc, opts).catch(e => {
    setStatus(id, { stage: 'error', message: String(e?.message || e), items: store.get<PipelineStatus>(id, 'status.json')?.items || [] });
    console.error(e);
  }).finally(() => running.delete(id));
  running.set(id, p);
  return id;
}
export const waitFor = (id: string) => running.get(id) || Promise.resolve();

async function runPipeline(md: string, doc: PaperDoc, opts: { factcheck?: boolean }) {
  const id = doc.id;
  const st: PipelineStatus = { stage: 'ingest', items: [] };
  const push = () => setStatus(id, JSON.parse(JSON.stringify(st)));
  store.put(id, 'paper.md', md); store.put(id, 'doc.json', doc); push();

  st.stage = 'digest'; st.message = `Reading ${doc.sections.length} sections (~${Math.round(doc.tokens / 1000)}k tokens)`; push();
  const digest = (await generateJSON({ stage: 'digest', system: system('style', 'digest'), schema: Digest, thinking: 'high',
    user: paperText(doc), check: g => checkDigest(g, doc) })).value;
  store.put(id, 'digest.json', digest);

  st.stage = 'plan'; st.message = 'Choosing the diagrams'; push();
  const plan = (await generateJSON({ stage: 'plan', system: system('style', 'plan'), schema: Plan, thinking: 'high',
    user: `# Digest\n${JSON.stringify(digest)}\n\n# Section index\n${sectionIndex(doc)}`, check: p => checkPlan(p, doc) })).value;
  store.put(id, 'plan.json', plan);

  st.stage = 'specs'; st.message = 'Drawing';
  st.items = plan.diagrams.map(d => ({ id: d.id, nav: d.nav, type: d.type, state: 'generating' as const }));
  const land = buildLandscape(digest);
  if (land) st.items.push({ id: 'map', nav: land.nav, type: 'landscape', state: 'ok' });
  push();

  const results: (Diagram | null)[] = await Promise.all(plan.diagrams.map(async (item, i) => {
    const mark = (state: PipelineStatus['items'][number]['state'], note?: string) => { st.items[i] = { ...st.items[i], state, note }; push(); };
    try {
      const r = await generateSpec(doc, digest, plan, item);
      mark('ok', r.repairs ? `${r.repairs} repair${r.repairs > 1 ? 's' : ''}` : undefined);
      return r.value;
    } catch (e) {
      const issues = e instanceof GenError ? e.issues : [String(e)];
      if (item.type !== 'flow') {
        mark('repairing', `falling back to flow: ${issues[0]}`);
        try { const r = await generateSpec(doc, digest, plan, item, { type: 'flow', stage: `spec:${item.id}:fallback` }); mark('ok', `fell back to flow`); return r.value; } catch { /* fall through */ }
      }
      mark('dropped', issues.slice(0, 3).join('; '));
      return null;
    }
  }));
  const diagrams = results.filter(Boolean) as Diagram[];
  if (land) diagrams.push(land);
  store.put(id, 'diagrams.json', diagrams);

  if (opts.factcheck !== false) {
    st.stage = 'factcheck'; st.message = 'Checking every sentence against the paper'; push();
    try { const log = await factCheck(doc, diagrams); store.put(id, 'factcheck.json', log); store.put(id, 'diagrams.json', diagrams); }
    catch (e) { console.error('factcheck failed', e); }
  }
  st.stage = 'done'; st.message = undefined; push();
}
