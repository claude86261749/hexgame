// Convert an arXiv HTML paper (arxiv.org/html/<id>) to Markdown.
// Usage: node scripts/arxiv2md.mjs <arxiv-id> [out.md]
import { writeFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

const id = process.argv[2];
if (!id) { console.error('usage: arxiv2md <arxiv-id> [out.md]'); process.exit(1); }
const out = process.argv[3] || `papers/${id}.md`;

const res = await fetch(`https://arxiv.org/html/${id}`);
if (!res.ok) { console.error(`fetch failed: ${res.status}`); process.exit(1); }
const { document } = parseHTML(await res.text());

const q = s => document.querySelector(s);
const title = (q('h1.ltx_title_document')?.textContent || '').replace(/\s+/g, ' ').trim();
const authors = [...document.querySelectorAll('.ltx_personname')]
  .map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12).join(', ');

// math → $alttext$, drop noise
for (const m of document.querySelectorAll('math')) {
  const tex = (m.getAttribute('alttext') || m.textContent || '').trim();
  const block = m.getAttribute('display') === 'block';
  m.replaceWith(document.createTextNode(block ? `\n\n$$${tex}$$\n\n` : `$${tex}$`));
}
for (const s of ['.ltx_page_header', '.ltx_page_footer', 'nav', 'script', 'style', 'h1.ltx_title_document',
  '.ltx_authors', '.ltx_dates', '.ltx_role_footnote .ltx_tag', 'button', '.ltx_TOC', 'header', 'footer']) {
  for (const e of document.querySelectorAll(s)) e.remove();
}
for (const img of document.querySelectorAll('img')) img.replaceWith(document.createTextNode(''));

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
td.addRule('cite', { filter: n => n.nodeName === 'CITE', replacement: c => c });
td.addRule('figcaption', { filter: 'figcaption', replacement: c => `\n\n*${c.trim()}*\n\n` });
td.addRule('tableToText', { filter: 'table', replacement: (_c, n) => {
  const rows = [...n.querySelectorAll('tr')].map(r => [...r.querySelectorAll('td,th')].map(c => c.textContent.replace(/\s+/g, ' ').replace(/\|/g, '/').trim()));
  if (!rows.length) return '';
  const w = Math.max(...rows.map(r => r.length));
  const line = r => '| ' + Array.from({ length: w }, (_, i) => r[i] || '').join(' | ') + ' |';
  return '\n\n' + [line(rows[0]), '|' + ' --- |'.repeat(w), ...rows.slice(1).map(line)].join('\n') + '\n\n';
}});

const body = q('article') || q('.ltx_document') || document.body;
let md = td.turndown(body)
  .replace(/\n{3,}/g, '\n\n')
  .replace(/^(#+)\s*(\d+(?:\.\d+)*)\s*\n+/gm, '$1 $2 ');
const front = `---\ntitle: ${JSON.stringify(title)}\nauthors: ${JSON.stringify(authors)}\narxiv: "${id}"\n---\n\n# ${title}\n\n`;
writeFileSync(out, front + md.trim() + '\n');
console.log(`${out}: ${(md.length / 1024).toFixed(0)} KB, ~${Math.round(md.length / 4 / 1000)}k tokens`);
