// Markdown paper → PaperDoc: stable section ids, cleaned text, parsed references.
// Works on hand-written Markdown and on PDF/HTML→MD conversions (see scripts/arxiv2md.mjs).
import { createHash } from 'node:crypto';
import type { PaperDoc } from '../shared/schema.ts';

const SPECIAL = /^(abstract|references|bibliography|appendix|appendices|acknowledg(e)?ments?|conclusions?|introduction|related work|discussion|limitations)\b/i;

export const paperId = (md: string) => createHash('sha256').update(md).digest('hex').slice(0, 12);

function cleanInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                                // images
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')               // links → text
    .replace(/<\/?[a-z][^>]*>/gi, '')                                     // html tags
    .replace(/\\([_*\[\]()#.!-])/g, '$1');                                 // md escapes
}

export function ingest(md: string): PaperDoc {
  const id = paperId(md);
  let body = md.replace(/\r\n/g, '\n');
  const fm: Record<string, string> = {};
  const m = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (m) {
    for (const line of m[1].split('\n')) { const kv = line.match(/^(\w+):\s*(.*)$/); if (kv) fm[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1'); }
    body = body.slice(m[0].length);
  }
  const lines = body.split('\n');
  type Raw = { title: string; level: number; num?: string; lines: string[] };
  const raw: Raw[] = [{ title: 'Front matter', level: 1, lines: [] }];
  let title = fm.title || '', fence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length, text = cleanInline(h[2]).replace(/\s*\((?:Tab|Fig|Tabs|Figs)\.[^)]*\)\s*$/, '').trim();
      if (level === 1 && !title) { title = text; continue; }
      if (level === 1 && text === title) continue;
      const num = text.match(/^((?:[A-Z]|\d+)(?:\.\d+)*)\.?\s+(?=\S)/)?.[1];
      const isSection = level <= 4 && (num || level <= 3) || SPECIAL.test(text) || /^appendix\s+[A-Z]/i.test(text);
      if (isSection) { raw.push({ title: text, level, num: num && (/\d/.test(num) || /^[A-Z](\.|$)/.test(num)) ? num : undefined, lines: [] }); continue; }
      raw[raw.length - 1].lines.push(`**${text}.**`);
      continue;
    }
    raw[raw.length - 1].lines.push(line);
  }
  const used = new Set<string>(); let x = 0;
  const sections = raw.map(r => {
    let sid = r.num ? 's' + r.num : /^abstract/i.test(r.title) ? 'abstract' : /^(references|bibliography)/i.test(r.title) ? 'refs'
      : r.title === 'Front matter' ? 'front' : (r.title.match(/^appendix\s+([A-Z])\b/i) ? 's' + r.title.match(/^appendix\s+([A-Z])\b/i)![1].toUpperCase() : 'x' + (++x));
    while (used.has(sid)) sid += '_';
    used.add(sid);
    const text = cleanInline(r.lines.join('\n')).replace(/\n{3,}/g, '\n\n').trim();
    return { id: sid, title: r.title, level: r.level, text };
  }).filter(s => s.text.length > 0 || /^s[0-9A-Z]/.test(s.id));

  // references: one entry per paragraph / list item in the refs section
  const refSec = sections.find(s => s.id === 'refs');
  const references = (refSec?.text.split(/\n\s*\n|\n(?=\s*(?:[-*]|\[\d+\]|\d+\.)\s)/) || [])
    .map(t => t.replace(/^\s*(?:[-*]|\d+\.)\s*/, '').replace(/\s+/g, ' ').trim()).filter(t => t.length > 25)
    .map((t, i) => ({ key: 'r' + (i + 1), text: t.slice(0, 400), arxiv: t.match(/(?:arXiv[:\s]*|abs\/)(\d{4}\.\d{4,5})/i)?.[1] }));

  const total = sections.reduce((n, s) => n + s.text.length, 0);
  return { id, title: title || 'Untitled', authors: fm.authors || '', arxiv: fm.arxiv || undefined, sections, references, tokens: Math.round(total / 4) };
}

/** The paper as the models see it: every section prefixed with its id so claims can cite it. */
export function paperText(doc: PaperDoc, opts: { only?: string[]; maxChars?: number; refs?: boolean } = {}): string {
  const only = opts.only && new Set(opts.only);
  const parts: string[] = only ? [] : [`[meta] Title: ${doc.title}${doc.authors ? `\nAuthors: ${doc.authors}` : ''}${doc.arxiv ? `\narXiv: ${doc.arxiv}` : ''}`];
  for (const s of doc.sections) {
    if (s.id === 'refs') continue;
    if (only && ![...only].some(o => s.id === o || s.id.startsWith(o + '.'))) continue;
    parts.push(`[${s.id}] ${'#'.repeat(Math.min(s.level, 4))} ${s.title}\n${s.text}`);
  }
  if (opts.refs !== false && !only && doc.references.length) parts.push('[refs] References\n' + doc.references.map(r => `- ${r.text.slice(0, 260)}`).join('\n'));
  let t = parts.join('\n\n');
  if (opts.maxChars && t.length > opts.maxChars) t = t.slice(0, opts.maxChars) + '\n[… truncated]';
  return t;
}

export const sectionIndex = (doc: PaperDoc) => doc.sections.filter(s => s.id !== 'refs')
  .map(s => `${s.id}: ${s.title} (${Math.round(s.text.length / 4)} tok)`).join('\n');

/** Cheap lexical retrieval for live briefs on long papers. */
export function relevantSections(doc: PaperDoc, query: string, k = 3): string[] {
  const words = [...new Set(query.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [])];
  return doc.sections.filter(s => s.id !== 'refs' && s.id !== 'front')
    .map(s => { const t = (s.title + ' ' + s.text).toLowerCase(); return { id: s.id, score: words.reduce((n, w) => n + Math.min(5, t.split(w).length - 1), 0) / Math.sqrt(1 + s.text.length / 2000) }; })
    .sort((a, b) => b.score - a.score).slice(0, k).map(s => s.id);
}
