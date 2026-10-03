// Semantic + layout checks that the schema cannot express. Errors go back to the model for repair;
// warnings are fixed in place (e.g. unknown section ids are dropped) and logged.
import type { Diagram, Digest, PaperDoc, Plan } from '../shared/schema.ts';
import { layout } from '../shared/layout.ts';

type Check = { errors: string[]; warnings: string[] };

/** Drop citations to section ids that do not exist (mutates). */
function cleanSources(v: any, valid: Set<string>, warnings: string[], path = ''): void {
  if (Array.isArray(v)) return v.forEach((x, i) => cleanSources(x, valid, warnings, `${path}/${i}`));
  if (!v || typeof v !== 'object') return;
  for (const [k, x] of Object.entries(v)) {
    if (k === 'sources' && Array.isArray(x)) {
      const keep = x.filter(s => valid.has(s) || valid.has(String(s).replace(/^\[|\]$/g, '')));
      if (keep.length !== x.length) warnings.push(`${path}: dropped unknown sources ${x.filter(s => !keep.includes(s)).join(',')}`);
      v[k] = keep.map((s: string) => s.replace(/^\[|\]$/g, ''));
    } else cleanSources(x, valid, warnings, `${path}/${k}`);
  }
}
const validIds = (doc: PaperDoc) => new Set(doc.sections.map(s => s.id));

export function elementIds(d: Diagram): string[] {
  switch (d.type) {
    case 'flow': return [...d.nodes.map(n => n.id), ...(d.groups || []).map(g => g.id)];
    case 'pipeline': return [...d.steps.map(s => s.id), ...d.steps.flatMap(s => !s.detail ? [] : s.detail.kind === 'flow' ? s.detail.nodes.map(n => n.id)
      : s.detail.kind === 'compare' ? s.detail.rows.map(r => r.id) : s.detail.kind === 'matrix' ? s.detail.panels.map(p => p.id) : [])];
    case 'chart': return [...d.series.map(s => s.id), ...(d.annotations || []).map(a => a.id)];
    case 'matrix': return d.panels.map(p => p.id);
    case 'compare': return d.rows.map(r => r.id);
    case 'landscape': return [...d.tiles.map(t => t.id), ...d.open.map(o => o.id)];
    case 'free': return d.items.flatMap(i => i.id ? [i.id] : []);
    case 'sim': return [];
  }
}

export function checkSpec(d: Diagram, doc: PaperDoc, expect?: { id: string; type: string }): Check {
  const errors: string[] = [], warnings: string[] = [];
  if (expect) { if (d.type !== expect.type) errors.push(`type must be "${expect.type}"`); d.id = expect.id; }
  cleanSources(d, validIds(doc), warnings);
  const ids = elementIds(d), seen = new Set<string>();
  for (const i of ids) { if (seen.has(i)) errors.push(`element id "${i}" is used twice; ids must be unique within the diagram`); seen.add(i); }
  if (d.type === 'pipeline') {
    for (const s of d.steps) if (!s.detail) warnings.push(`step ${s.id} has no detail`);
  }
  if (d.type === 'flow' && d.nodes.filter(n => !n.note).length > d.nodes.length / 2) errors.push('give a note to every node the reader might select (most nodes have none)');
  if (d.type === 'chart' && !d.schematic && !d.caveat) warnings.push('chart is not schematic and has no caveat');
  if (d.type === 'chart' && d.schematic && !d.caveat) d.caveat = 'Curve shapes are schematic, not the paper’s numbers.';
  if (d.type === 'sim' && !d.caveat) d.caveat = 'A toy simulation for intuition, not data from the paper.';
  errors.push(...layout(d).issues);
  return { errors: [...new Set(errors)], warnings };
}

export function checkDigest(g: Digest, doc: PaperDoc): Check {
  const errors: string[] = [], warnings: string[] = [];
  cleanSources(g, validIds(doc), warnings);
  const rel = new Set<string>();
  for (const r of g.related) { if (rel.has(r.id)) errors.push(`related id "${r.id}" is used twice`); rel.add(r.id); }
  for (const o of g.openDirections) {
    const bad = o.from.filter(f => !rel.has(f));
    if (bad.length) { o.from = o.from.filter(f => rel.has(f)); warnings.push(`open direction ${o.id}: dropped unknown from ${bad}`); }
    if (!o.from.length && g.related.length) errors.push(`open direction "${o.id}" must list at least one related id in from`);
    if (rel.has(o.id)) errors.push(`open direction id "${o.id}" collides with a related id`);
  }
  if (g.claims.length && g.claims.every(c => !c.sources.length)) errors.push('claims must cite section ids that exist in the paper');
  return { errors, warnings };
}

export function checkPlan(p: Plan, doc: PaperDoc): Check {
  const errors: string[] = [], warnings: string[] = [];
  cleanSources(p, validIds(doc), warnings);
  p.diagrams.forEach((d, i) => { if (d.id !== `g${i + 1}`) { warnings.push(`renumbered ${d.id} → g${i + 1}`); d.id = `g${i + 1}`; } });
  if (p.diagrams.filter(d => d.type === 'sim').length > 1) errors.push('at most one sim diagram');
  if (p.diagrams.filter(d => d.type === 'free').length > 1) errors.push('at most one free diagram; prefer typed diagrams');
  for (const d of p.diagrams) if (!d.sources.length) errors.push(`${d.id} must cite at least one existing section id`);
  return { errors, warnings };
}

/* --------------------------------------------------------------- fact-check plumbing */
export function readerTexts(ds: Diagram[]): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const add = (path: string, text?: string) => { if (text) out.push({ path, text }); };
  ds.forEach((d, di) => {
    const p = `${di}`;
    add(`${p}/head`, d.head); d.body.forEach((b, i) => add(`${p}/body/${i}`, b));
    const walk = (v: any, path: string) => {
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}/${i}`));
      if (!v || typeof v !== 'object') return;
      for (const [k, x] of Object.entries(v)) {
        if (['note', 'link', 'shows', 'text'].includes(k) && typeof x === 'string' && x.length > 30) add(`${path}/${k}`, x);
        else if (typeof x === 'object') walk(x, `${path}/${k}`);
      }
    };
    for (const k of ['nodes', 'steps', 'series', 'annotations', 'states', 'panels', 'rows', 'tiles', 'open', 'items'] as const) walk((d as any)[k], `${p}/${k}`);
  });
  return out;
}
export function setPath(root: any, path: string, value: string): string | undefined {
  const ks = path.split('/'); let o = root;
  for (const k of ks.slice(0, -1)) { o = o?.[k]; if (o == null) return; }
  const last = ks[ks.length - 1];
  if (typeof o?.[last] !== 'string') return;
  const prev = o[last]; o[last] = value; return prev;
}
