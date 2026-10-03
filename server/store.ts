// File store: data/papers/<id>/{paper.md, doc.json, digest.json, plan.json, diagrams.json, status.json, sessions/*.json}
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DATA = process.env.DATA_DIR || join(process.cwd(), 'data');
const P = (id: string, ...f: string[]) => {
  if (!/^[\w-]+$/.test(id)) throw new Error(`bad paper id ${JSON.stringify(id)}`);
  return join(DATA, 'papers', id, ...f);
};

export function put(id: string, file: string, v: unknown) {
  mkdirSync(P(id, file.includes('/') ? file.split('/')[0] : ''), { recursive: true });
  writeFileSync(P(id, file), typeof v === 'string' ? v : JSON.stringify(v, null, 1));
}
export function get<T>(id: string, file: string): T | null {
  const f = P(id, file);
  if (!existsSync(f)) return null;
  const s = readFileSync(f, 'utf8');
  return (file.endsWith('.json') ? JSON.parse(s) : s) as T;
}
export const has = (id: string, file: string) => existsSync(P(id, file));
export function listPapers(): string[] { const d = join(DATA, 'papers'); return existsSync(d) ? readdirSync(d) : []; }
export function listSessions(id: string): string[] { const d = P(id, 'sessions'); return existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : []; }
