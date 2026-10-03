// npm run ingest -- papers/foo.md [--force] [--no-factcheck]
import { readFileSync } from 'node:fs';
import { startPipeline, waitFor, bus } from './pipeline.ts';
import { callStats } from './gemini.ts';
import * as store from './store.ts';

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
const force = process.argv.includes('--force'), factcheck = !process.argv.includes('--no-factcheck');
for (const f of files) {
  const t0 = Date.now();
  const id = startPipeline(readFileSync(f, 'utf8'), { force, factcheck });
  let last = '';
  bus.on(id, s => { const line = `${s.stage}${s.message ? ': ' + s.message : ''} ${s.items.map((i: any) => `${i.id}:${i.state}`).join(' ')}`; if (line !== last) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, line); last = line; });
  await waitFor(id);
  const st = store.get<any>(id, 'status.json');
  console.log(`${f} → ${id} ${st?.stage} in ${((Date.now() - t0) / 1000).toFixed(0)}s`, st?.items?.filter((i: any) => i.note).map((i: any) => `${i.id}: ${i.note}`));
}
console.log('calls', callStats);
