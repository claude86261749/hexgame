import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIR = new URL('../prompts/', import.meta.url);
const cache = new Map<string, string>();
/** Load prompts/<name>.md and fill {{slots}}. Unfilled slots throw, so a template change cannot silently drop context. */
export function prompt(name: string, slots: Record<string, string> = {}): string {
  let t = cache.get(name);
  if (t == null) { t = readFileSync(new URL(name + '.md', DIR), 'utf8'); if (process.env.NODE_ENV === 'production') cache.set(name, t); }
  return t.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in slots)) throw new Error(`prompt ${name}: missing slot ${k}`); return slots[k]; });
}
export const system = (...names: string[]) => names.map(n => prompt(n)).join('\n\n---\n\n');
export const promptVersion = () => createHash('sha256').update(['style', 'digest', 'plan', 'spec', 'repair', 'factcheck', 'scratch', 'live',
  ...['flow', 'pipeline', 'chart', 'matrix', 'compare', 'sim', 'free'].map(t => 'types/' + t)].map(n => readFileSync(new URL(n + '.md', DIR), 'utf8')).join('')).digest('hex').slice(0, 8);
