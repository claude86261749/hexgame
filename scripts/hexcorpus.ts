// A directory of arXiv papers as Markdown → the hex map's corpus (hextile_src/src/data/corpus.json).
//
//   npx tsx scripts/hexcorpus.ts <corpus dir> [--out hextile_src/src/data/corpus.json] [--min-shared 7] [--name "cs.IR, September 2026"]
//
// The directory holds <arxiv id>.md files (kgpipe.fetch output: "# Title", "## Abstract", "## References" with
// "- [bib.bibN] …" lines, and "[[n](#bib.bibN)]" citation links in the text) and an optional _metadata.json
// (arxiv_id → {title, authors, submitted}).
//
// Stages:
//   1. parse    every paper: abstract, headings, references, and the sentences that cite each reference
//   2. pool     references shared by many papers become "foundation" tiles; references to other corpus papers are kept
//   3. extract  (flash, per paper) short label, idea, concepts, and the intent of each kept citation
//   4. found    (flash, one call per 20) the same for the foundation papers, from their reference strings and citing sentences
//   5. merge    (flash, one call) synonymous concepts → one canonical name
//   6. engine   the hex engine itself, in Node: affinity, themes, gradients; the centre is the most connected corpus paper
//   7. name     (flash) theme names, gradient ends, expeditions, open questions, and each paper's relation to the centre
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { generateJSON, callStats } from '../server/gemini.ts';
import { buildIndex, findThemes, CFG } from '../hextile_src/src/engine/index.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const DIR = resolve(argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.match(/^--(out|min-shared|name|limit)$/)) || 'papers');
const OUT = resolve(opt('out', 'hextile_src/src/data/corpus.json'));
const MIN_SHARED = Number(opt('min-shared', '7'));
const NAME = opt('name', '');
const LIMIT = Number(opt('limit', '0'));

const STYLE = `Write for a researcher from a neighbouring field. Short declarative sentences, present tense, concrete nouns.
No hype words ("novel", "state-of-the-art", "powerful", "significantly", "leverage"). Only claims the given text supports. Never invent numbers.`;

/* ───────────── 1. parse ───────────── */
interface Ref { key: string; raw: string; title: string; norm: string; arxiv?: string; cites: string[] }
interface Parsed { id: string; title: string; authors: string[]; date: string; abstract: string; intro: string; heads: string[]; refs: Ref[] }

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const refTitle = (raw: string) => {
  const s = raw.replace(/^\[bib\.bib\d+\]\s*(\[\d+\]\.\s*)?/, '');
  const m = s.match(/\(\d{4}[a-z]?\)\s*\.?\s*(.+?)\s(?:\.|\?)\s/) || s.match(/\d{4}[a-z]?\)?\.\s+(.+?)\s(?:\.|\?)\s/);
  return (m?.[1] || s.slice(0, 120)).replace(/\s+/g, ' ').trim();
};
const stripMd = (s: string) => s.replace(/\[\[(\d+)\]\(#bib\.bib\d+\)\]/g, '[$1]').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

function parse(file: string, meta: any): Parsed {
  const md = readFileSync(file, 'utf8'), id = file.split('/').pop()!.replace(/\.md$/, '');
  const title = meta?.title || md.match(/^#\s+(.+)$/m)?.[1] || id;
  const sec = (re: RegExp) => { const m = md.match(re); if (!m) return ''; const rest = md.slice(m.index! + m[0].length); return rest.slice(0, rest.search(/\n#{1,2} /) >>> 0); };
  const intro = stripMd(sec(/^##\s+(?:(?:1|I)\.?\s+)?Introduction\s*$/im)).slice(0, 3000);
  const abstract = stripMd(sec(/^#{2,6}\s*Abstract\s*$/im)).slice(0, 2500) || intro.slice(0, 1200);
  const heads = [...md.matchAll(/^#{2,3}\s+(.+)$/gm)].map(m => stripMd(m[1])).filter(h => !/^(references|acknowledg|appendix)/i.test(h)).slice(0, 30);
  const refStart = md.search(/^## References\s*$/m);
  const refs: Ref[] = [];
  if (refStart >= 0) {
    const block = md.slice(refStart).split(/\n## (?!References)/)[0];
    for (const line of block.split('\n')) {
      const m = line.match(/^- \[(bib\.bib\d+)\]\s*(.*)$/);
      if (!m) continue;
      const raw = m[2].replace(/\s+/g, ' ').trim(), t = refTitle(m[2]);
      refs.push({ key: m[1], raw: raw.slice(0, 400), title: t, norm: norm(t).slice(0, 70), arxiv: raw.match(/(?:arXiv[:\s]*|abs\/)(\d{4}\.\d{4,5})/i)?.[1], cites: [] });
    }
  }
  /* citing sentences: every sentence of the body with a link to the reference */
  const body = refStart >= 0 ? md.slice(0, refStart) : md, byKey = new Map(refs.map(r => [r.key, r]));
  for (const para of body.split(/\n\s*\n/)) {
    if (!para.includes('#bib.bib')) continue;
    for (const s of para.split(/(?<=[.!?])\s+(?=[A-Z])/)) for (const k of new Set([...s.matchAll(/#(bib\.bib\d+)\)/g)].map(x => x[1]))) {
      const r = byKey.get(k);
      if (r && r.cites.length < 3) r.cites.push(stripMd(s).slice(0, 400));
    }
  }
  const authors: string[] = meta?.authors || [];
  return { id, title: title.replace(/\s+/g, ' ').trim(), authors, date: meta?.submitted || '', abstract, intro, heads, refs };
}

/* ───────────── schemas ───────────── */
const Intent = z.enum(['builds', 'uses', 'compares', 'none']);
const PaperOut = z.object({
  s: z.string().describe('Short label for the map tile, at most 18 characters: the method or system name if it has one, else 1-3 words'),
  idea: z.string().describe('2-3 sentences, under 70 words: what the paper does and how'),
  concepts: z.array(z.string()).describe('8-14 concepts: methods, tasks, datasets, model families and ideas this paper is about, as short lowercase noun phrases (keep acronyms and proper names as written, e.g. "ColBERT", "BM25", "LLM agents")'),
  cites: z.array(z.object({ ref: z.string(), intent: Intent })).describe('One entry per listed reference'),
});
const FoundOut = z.object({ papers: z.array(z.object({
  id: z.string(), s: z.string().describe('Short tile label, at most 18 characters'), t: z.string().describe('Clean full title'),
  a: z.string().describe('Authors as "Surname, Surname, Surname" or "Surname, Surname et al." for more than three'),
  y: z.number().int(), v: z.string().describe('Venue, short (e.g. "SIGIR", "NeurIPS", "arXiv", "Foundations and Trends in IR")'),
  idea: z.string().describe('1-2 sentences: what this work introduced'),
  concepts: z.array(z.string()).describe('5-10 concepts, same style as the corpus concepts'),
})) });
const MergeOut = z.object({ groups: z.array(z.object({ canonical: z.string(), variants: z.array(z.string()) })) });
const NameOut = z.object({
  title: z.string().describe('Name for the whole map, 2-5 words'),
  intro: z.string().describe('One or two sentences on what this corpus is about'),
  themes: z.array(z.object({ theme: z.number().int(), name: z.string().describe('2-3 words, a place name in the style "Twin-View Meadows", "Decoder Works", "Caption Coast"'), note: z.string().describe('One sentence: what the papers here share') })),
  grads: z.array(z.object({ grad: z.number().int(), plus: z.object({ name: z.string(), gloss: z.string() }), minus: z.object({ name: z.string(), gloss: z.string() }) })),
  expeditions: z.array(z.object({ name: z.string(), q: z.string().describe('The question the route answers'), steps: z.array(z.string()).describe('4-6 paper ids, in reading order'), insight: z.string().describe('2-4 sentences: what you understand after walking it') })),
  open: z.array(z.object({ t: z.string().describe('Short title, a question'), text: z.string().describe('2 sentences'), c: z.array(z.string()).describe('3-5 concepts, copied exactly from the vocabulary') })),
});
const TopicsOut = z.object({ topics: z.array(z.object({ name: z.string().describe('2-4 words, lowercase except acronyms'), gloss: z.string() })) });
const TagOut = z.object({ papers: z.array(z.object({ id: z.string(), topics: z.array(z.string()).describe('2-4 topic names, copied exactly') })) });
const LinkOut = z.object({ links: z.array(z.object({ id: z.string(), link: z.string().describe('One or two sentences: how this paper relates to the centre paper') })) });

async function pool<T, R>(xs: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < xs.length) { const i = next++; out[i] = await f(xs[i], i); } }));
  return out;
}
const shortAuthors = (a: string[]) => a.length > 3 ? a.slice(0, 3).map(x => x.split(' ').pop()).join(', ') + ' et al.' : a.map(x => x.split(' ').pop()).join(', ');

async function main() {
  const metaFile = join(DIR, '_metadata.json');
  const META: Record<string, any> = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
  let files = readdirSync(DIR).filter(f => /\.md$/.test(f) && !f.startsWith('_')).sort();
  if (LIMIT) files = files.slice(0, LIMIT);
  const P = files.map(f => parse(join(DIR, f), META[f.replace(/\.md$/, '')]));
  console.log(`parsed ${P.length} papers, ${P.reduce((n, p) => n + p.refs.length, 0)} references`);

  /* ───────────── 2. pool references ───────────── */
  const ids = new Set(P.map(p => p.id)), byTitle = new Map(P.map(p => [norm(p.title).slice(0, 70), p.id]));
  const inCorpus = (r: Ref, self: string) => {
    const a = r.arxiv && ids.has(r.arxiv) ? r.arxiv : byTitle.get(r.norm) || [...byTitle].find(([t]) => t.length > 30 && norm(r.raw).includes(t))?.[1];
    return a && a !== self ? a : undefined;
  };
  /* group references to the same work. Citation styles differ (author-year labels, numbered lists, full or
     initialled names, venue strings), so: same first author and year, then enough shared words */
  const STOP = new Set(('proceedings conference international annual meeting association computational linguistics advances neural information processing systems ' +
    'journal arxiv preprint pages vol volume link links external document ieee acm press transactions empirical methods natural language findings ' +
    'learning representations sigir emnlp naacl iclr icml neurips aaai kdd wsdm recsys cikm openreview corr abs with from that this using and for the').split(' '));
  const sig = (r: Ref) => {
    const s = r.raw.replace(/^\[\d+\]\.\s*/, ''), m = s.match(/^(.{0,200}?)\((\d{4})[a-z]?\)/);
    const first = m ? m[1].split(/[\s,]+/).find(w => w.length > 1 && !/^[A-Z]\.$/.test(w) && !/^\W/.test(w)) : undefined;
    const words = new Set(norm(s.slice(m ? m[0].length : 0)).split(' ').filter(w => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)));
    return { k: first ? norm(first) : r.norm.slice(0, 30), y: m ? Number(m[2]) : 0, words };
  };
  /* one citation string can carry full author names and another only initials, so compare by containment */
  const contain = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (Math.min(a.size, b.size) || 1); };
  type Group = { key: string; y: number; words: Set<string>; refs: { p: string; r: Ref }[] };
  const groups: Group[] = [], byK = new Map<string, Group[]>(), groupOf = new Map<Ref, string>();
  for (const p of P) for (const r of p.refs) {
    if (inCorpus(r, p.id) || r.norm.length < 12) continue;
    const { k, y, words } = sig(r), cands = byK.get(k) || [];
    let g = cands.find(g => Math.abs(g.y - y) <= 1 && contain(g.words, words) >= 0.6);
    if (!g) { g = { key: `${k}#${cands.length}`, y, words, refs: [] }; cands.push(g); byK.set(k, cands); groups.push(g); }
    else if (words.size < g.words.size) g.words = words; /* keep the tighter signature: title and venue only */
    groupOf.set(r, g.key);
    if (!g.refs.some(x => x.p === p.id)) g.refs.push({ p: p.id, r });
  }
  const gkey = (r: Ref) => groupOf.get(r);
  const found = groups.filter(g => g.refs.length >= MIN_SHARED).sort((a, b) => b.refs.length - a.refs.length);
  const fid = new Map(found.map((g, i) => [g.key, 'f' + String(i + 1).padStart(2, '0')]));
  console.log(`${found.length} foundations (references shared by ≥${MIN_SHARED} papers)`);
  if (argv.includes('--dry')) {
    for (const g of found) console.log(`  ${fid.get(g.key)} ×${g.refs.length} ${g.refs[0].r.title.slice(0, 90)}`);
    for (const p of P.slice(0, 3)) console.log(p.id, p.title, '|', p.abstract.slice(0, 120), '|', p.refs.slice(0, 2).map(r => [r.title, r.cites.length]));
    return;
  }

  /* ───────────── 3. extract, per paper ───────────── */
  const extracted = await pool(P, Number(process.env.GEMINI_CONCURRENCY || 3), async p => {
    const kept: { id: string; label: string; cites: string[] }[] = [];
    for (const r of p.refs) {
      const g = gkey(r), id = inCorpus(r, p.id) || (g && fid.get(g));
      if (id && !kept.some(k => k.id === id)) kept.push({ id, label: r.title, cites: r.cites });
    }
    const user = [`# Paper ${p.id}\nTitle: ${p.title}`, `## Abstract\n${p.abstract}`, `## Introduction (start)\n${p.intro}`, `## Section headings\n${p.heads.join('\n')}`,
      kept.length ? `## References to classify\nFor each, decide from the citing sentences how this paper relates to it: "builds" (extends its method or idea), "uses" (uses it as a component, dataset, metric or tool), "compares" (a baseline or point of contrast), or "none" (mentioned in passing).\n` +
        kept.map(k => `- ref: ${k.id} | ${k.label}\n${k.cites.map(c => `  > ${c}`).join('\n') || '  > (no citing sentence found)'}`).join('\n') : '## References to classify\n(none)'].join('\n\n');
    try {
      const r = await generateJSON({ stage: `hex:paper:${p.id}`, system: `You turn a research paper into a map entry.\n${STYLE}`, user, schema: PaperOut, thinking: 'low',
        check: v => ({ errors: [...(v.s.length > 22 ? [`s is ${v.s.length} characters; at most 18`] : []), ...(v.concepts.length < 5 ? ['give at least 8 concepts'] : [])] }) });
      return { p, v: r.value, kept };
    } catch (e: any) { console.warn(`  ${p.id}: ${e.message}`); return { p, v: null, kept }; }
  });
  console.log(`extracted ${extracted.filter(x => x.v).length}/${P.length}`);

  /* ───────────── 4. foundations ───────────── */
  const fpapers: any[] = [];
  for (let i = 0; i < found.length; i += 20) {
    const batch = found.slice(i, i + 20);
    const user = batch.map(g => `## ${fid.get(g.key)} (cited by ${g.refs.length} papers in the corpus)\nReference strings:\n${[...new Set(g.refs.slice(0, 3).map(x => x.r.raw))].map(s => `- ${s}`).join('\n')}\nCiting sentences:\n${g.refs.flatMap(x => x.r.cites).slice(0, 4).map(c => `> ${c}`).join('\n')}`).join('\n\n');
    const r = await generateJSON({ stage: `hex:found:${i}`, system: `You describe well-known earlier papers that many papers in a corpus cite. Use the reference strings for title, authors, year and venue; use what you know of the paper and the citing sentences for its idea. One entry per id, ids unchanged.\n${STYLE}`,
      user, schema: FoundOut, thinking: 'low', check: v => ({ errors: batch.filter(g => !v.papers.some(p => p.id === fid.get(g.key))).map(g => `missing ${fid.get(g.key)}`) }) });
    fpapers.push(...r.value.papers.filter(p => batch.some(g => fid.get(g.key) === p.id)));
  }

  /* one work can still be cited under two author lists ("Q. Team" and "A. Yang et al."): merge by clean title */
  const alias = new Map<string, string>(), seenT = new Map<string, any>();
  for (const f of fpapers.slice()) {
    const k = norm(f.t), first = seenT.get(k);
    if (first) { alias.set(f.id, first.id); fpapers.splice(fpapers.indexOf(f), 1); } else seenT.set(k, f);
  }
  const A = (id: string) => alias.get(id) || id;

  /* ───────────── 5. merge concepts ───────────── */
  const raw = [...extracted.flatMap(x => x.v?.concepts || []), ...fpapers.flatMap(p => p.concepts)].map(c => c.trim()).filter(Boolean);
  const counts = new Map<string, number>(); for (const c of raw) counts.set(c, (counts.get(c) || 0) + 1);
  const canon = new Map<string, string>();
  /* case and plural variants first, without a model */
  const fold = (c: string) => c.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').replace(/(?<=[a-z]{3})s\b/g, '');
  const folded = new Map<string, string>();
  for (const [c] of [...counts].sort((a, b) => b[1] - a[1])) { const f = fold(c); if (!folded.has(f)) folded.set(f, c); canon.set(c, folded.get(f)!); }
  const vocab = [...new Set(canon.values())].map(c => [c, [...counts].filter(([k]) => canon.get(k) === c).reduce((n, [, v]) => n + v, 0)] as const).sort((a, b) => b[1] - a[1]);
  const mr = await generateJSON({ stage: 'hex:merge', thinking: 'low', schema: MergeOut,
    system: 'You clean the concept vocabulary of a paper map. Group only true synonyms and spelling variants (e.g. "RAG" and "retrieval-augmented generation"; "sequential recommender" and "sequential recommendation"). Do not merge a narrower concept into a broader one. Pick the clearest, most common name as canonical. List only groups with at least two members; copy every variant exactly.',
    user: vocab.map(([c, n]) => `${c} (${n})`).join('\n') });
  for (const g of mr.value.groups) for (const v of g.variants) for (const [k, c] of canon) if (c === v) canon.set(k, g.canonical);
  const C = (cs: string[]) => [...new Set(cs.map(c => canon.get(c.trim()) || c.trim()))];

  /* ───────────── 5b. topics ─────────────
     Extracted concepts are specific ("cattle semantics"), so many papers share none with anyone. A layer of broad
     topics, each paper tagged with a few, keeps every paper connected; rarity weighting keeps the specific ones decisive. */
  const vocabC = [...new Set(canon.values())].map(c => [c, [...counts].filter(([k]) => canon.get(k) === c).reduce((n, [, v]) => n + v, 0)] as const).sort((a, b) => b[1] - a[1]);
  const tr = await generateJSON({ stage: 'hex:topics', thinking: 'low', schema: TopicsOut,
    system: 'You design the topic layer of a map of research papers: 30-40 broad topics that together cover every paper, each shared by several papers. Topics are research areas, problem settings or method families (e.g. "sequential recommendation", "retrieval-augmented generation", "evaluation and benchmarks"), not single methods. No two topics should overlap much.',
    user: `# Concepts (with paper counts)\n${vocabC.slice(0, 400).map(([c, n]) => `${c} (${n})`).join('\n')}\n\n# Paper titles\n${extracted.map(x => '- ' + x.p.title).join('\n')}` });
  const TOPICS = tr.value.topics.map(t => t.name);
  const tags = new Map<string, string[]>();
  const tagItems = [...extracted.map(x => ({ id: x.p.id, t: x.p.title, c: x.v?.concepts || [] })), ...fpapers.map(f => ({ id: f.id, t: f.t, c: f.concepts }))];
  for (let i = 0; i < tagItems.length; i += 60) {
    const batch = tagItems.slice(i, i + 60);
    const r = await generateJSON({ stage: `hex:tags:${i}`, thinking: 'low', schema: TagOut,
      system: 'Tag each paper with the 2-4 topics from the list that fit it best. Copy topic names exactly.',
      user: `# Topics\n${tr.value.topics.map(t => `- ${t.name}: ${t.gloss}`).join('\n')}\n\n# Papers\n${batch.map(b => `${b.id} | ${b.t} | ${b.c.join(', ')}`).join('\n')}`,
      check: v => ({ errors: [...batch.filter(b => !v.papers.some(p => p.id === b.id)).map(b => `missing ${b.id}`),
        ...v.papers.flatMap(p => p.topics.filter(t => !TOPICS.includes(t)).map(t => `${p.id}: "${t}" is not in the list`))] }) });
    for (const p of r.value.papers) tags.set(p.id, p.topics.filter(t => TOPICS.includes(t)));
  }
  const withTopics = (id: string, cs: string[]) => [...new Set([...C(cs), ...(tags.get(id) || [])])];

  /* ───────────── assemble papers ───────────── */
  const papers: any[] = [];
  for (const { p, v, kept } of extracted) {
    const rel = { builds: [] as string[], uses: [] as string[], compares: [] as string[] };
    for (const c of v?.cites || []) if (c.intent !== 'none' && kept.some(k => k.id === c.ref) && !Object.values(rel).some(l => l.includes(A(c.ref)))) rel[c.intent].push(A(c.ref));
    const y = Number((p.date || '').slice(0, 4)) || 2000 + Number(p.id.slice(0, 2));
    papers.push({ id: p.id, arxiv: p.id, s: v?.s || p.title.split(/[:\s]/)[0], t: p.title, a: shortAuthors(p.authors), y, v: 'arXiv ' + p.id,
      date: p.date.slice(0, 10), idea: v?.idea || p.abstract.split(/(?<=\.)\s/).slice(0, 2).join(' '), link: '', c: withTopics(p.id, v?.concepts || []), ...rel });
  }
  for (const f of fpapers) {
    const cited = new Set(found.filter(x => A(fid.get(x.key)!) === f.id).flatMap(x => x.refs.map(r => r.p))).size;
    papers.push({ id: f.id, ext: true, cited, s: f.s, t: f.t, a: f.a, y: f.y, v: f.v, idea: f.idea, link: '', c: withTopics(f.id, f.concepts), builds: [], uses: [], compares: [] });
  }

  /* ───────────── 6. engine ───────────── */
  const I = buildIndex(papers), TH = findThemes(I, 0, CFG.themes);
  let centre = 0, best = -1;
  papers.forEach((p, i) => { if (p.ext) return; const s = I.Araw[i].reduce((a, b) => a + b, 0); if (s > best) { best = s; centre = i; } });
  const C0 = papers[centre];
  console.log(`centre: ${C0.id} ${C0.s}; ${TH.members.length} themes`);
  const idfTop = (ms: number[], n: number) => { const m: Record<string, number> = {}; for (const i of ms) for (const c of papers[i].c) m[c] = (m[c] || 0) + I.idf(c); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]); };
  const gradEnds = I.grads.slice(0, 4).map(g => { const o = [...g.coord.keys()].sort((a, b) => g.coord[a] - g.coord[b]); return { lo: o.slice(0, 9), hi: o.slice(-9).reverse() }; });
  const line = (i: number) => `${papers[i].id} | ${papers[i].s} | ${papers[i].t}`;

  /* ───────────── 7. name ───────────── */
  const vocabFinal = [...new Set(papers.flatMap(p => p.c))];
  const nr = await generateJSON({ stage: 'hex:name', thinking: 'low', schema: NameOut,
    system: `You name the parts of a map of research papers, after the map has been computed. Themes are clusters; gradients are directions through the corpus with two ends; expeditions are reading routes through papers on the map (use only ids listed, foundations included where they help); open questions are gaps the corpus leaves.\n${STYLE}`,
    check: v => ({ errors: [
      ...TH.members.map((_, j) => j).filter(j => !v.themes.some(t => t.theme === j)).map(j => `name theme ${j}`),
      ...gradEnds.map((_, k) => k).filter(k => !v.grads.some(g => g.grad === k)).map(k => `name gradient ${k}`),
      ...v.expeditions.flatMap(x => x.steps.filter(s => !papers.some(p => p.id === s)).map(s => `expedition "${x.name}": unknown id ${s}`)),
      ...(v.expeditions.length < 4 ? ['give 5 expeditions'] : []), ...(v.open.length < 4 ? ['give 5 open questions'] : []),
    ] }),
    user: [`# Corpus\n${papers.filter(p => !p.ext).length} recent arXiv papers${NAME ? ` (${NAME})` : ''}, plus ${fpapers.length} foundation papers many of them cite (ids f01…).`,
      `# Centre of the map\n${line(centre)}`,
      `# Themes\n${TH.members.map((ms, j) => `## theme ${j} (${ms.length} papers)\nTop concepts: ${idfTop(ms, 8).join(', ')}\n${ms.slice(0, 14).map(line).join('\n')}`).join('\n\n')}`,
      `# Gradients\n${gradEnds.map((g, k) => `## gradient ${k}\nplus end:\n${g.hi.map(line).join('\n')}\nminus end:\n${g.lo.map(line).join('\n')}`).join('\n\n')}`,
      `# All papers\n${papers.map((p, i) => line(i)).join('\n')}`,
      `# Concept vocabulary\n${vocabFinal.join('; ')}`].join('\n\n') });

  const links = new Map<string, string>();
  const others = papers.filter((_, i) => i !== centre);
  for (let i = 0; i < others.length; i += 50) {
    const batch = others.slice(i, i + 50);
    const r = await generateJSON({ stage: `hex:links:${i}`, thinking: 'low', schema: LinkOut,
      system: `The map is centred on one paper. For each other paper, write one or two sentences on how it relates to the centre paper: the problem or method they share, where they differ, or, for a foundation paper, what the centre paper takes from that line of work. If they are far apart, say what separates them. Be specific.\n${STYLE}`,
      user: `# Centre\n${C0.id}: ${C0.t}\n${C0.idea}\nConcepts: ${C0.c.join(', ')}\n\n# Papers\n${batch.map(p => `## ${p.id}: ${p.t}\n${p.idea}\nConcepts: ${p.c.join(', ')}`).join('\n\n')}`,
      check: v => ({ errors: batch.filter(p => !v.links.some(l => l.id === p.id)).map(p => `missing ${p.id}`) }) });
    for (const l of r.value.links) links.set(l.id, l.link);
  }
  for (const p of papers) p.link = p === C0 ? `The centre of this map: of the ${papers.filter(x => !x.ext).length} papers, it has the most in common with the rest.` : links.get(p.id) || '';

  const TERRAINS = ['outpost', 'meadow', 'works', 'ice', 'terrace', 'marsh', 'coast', 'mountain', 'crystal', 'quarry'];
  const N = nr.value;
  /* anchors: the most typical member, so a name follows its cluster if the numbers move */
  const anchorOf = (ms: number[]) => ms.slice().sort((a, b) => TH.soft[b][TH.lab[b]] - TH.soft[a][TH.lab[a]])[0];
  const out = {
    meta: { title: N.title, intro: N.intro, name: NAME, source: 'arXiv', centre: C0.id, built: new Date().toISOString().slice(0, 10), papers: papers.filter(p => !p.ext).length, foundations: fpapers.length, minShared: MIN_SHARED },
    papers,
    themes: N.themes.filter(t => TH.members[t.theme]).map(t => ({ anchor: papers[anchorOf(TH.members[t.theme])].id, name: t.name, terrain: TERRAINS[t.theme % TERRAINS.length], note: t.note })),
    grads: N.grads.filter(g => gradEnds[g.grad]).map(g => ({ anchor: papers[gradEnds[g.grad].hi[0]].id, at: g.plus, away: g.minus })),
    expeditions: N.expeditions.map((x, i) => ({ id: 'x' + (i + 1), ...x })),
    open: N.open.map((o, i) => ({ id: 'o' + (i + 1), t: o.t, text: o.text, c: C(o.c) })),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/\},\{"id"/g, '},\n{"id"'));
  console.log(`wrote ${OUT}: ${papers.length} papers. ${JSON.stringify(callStats)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
