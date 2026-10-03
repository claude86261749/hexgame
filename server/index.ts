import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Diagram, Digest, PaperDoc, PipelineStatus, SessionLog, PaperBundle } from '../shared/schema.ts';
import { MODELS } from '../shared/config.ts';
import { startPipeline, bus } from './pipeline.ts';
import { drawScratch } from './scratch.ts';
import { liveConfig, mintToken } from './live.ts';
import { GenError } from './gemini.ts';
import * as store from './store.ts';

const app = new Hono();
const bundle = (id: string): PaperBundle | null => {
  const doc = store.get<PaperDoc>(id, 'doc.json');
  if (!doc) return null;
  return { id, doc: { ...doc, sections: doc.sections.map(s => ({ id: s.id, title: s.title, level: s.level, chars: s.text.length })) },
    digest: store.get<Digest>(id, 'digest.json'), diagrams: store.get<Diagram[]>(id, 'diagrams.json') || [],
    status: store.get<PipelineStatus>(id, 'status.json') || { stage: 'queued', items: [] } };
};

app.get('/api/papers', c => c.json(store.listPapers().map(id => {
  const d = store.get<PaperDoc>(id, 'doc.json'), g = store.get<Digest>(id, 'digest.json'), s = store.get<PipelineStatus>(id, 'status.json');
  return { id, title: g?.shortTitle || d?.title || id, full: d?.title, field: g?.field, gist: g?.gist, stage: s?.stage || 'queued', sessions: store.listSessions(id).length };
})));
app.get('/api/samples', c => c.json(existsSync('papers') ? readdirSync('papers').filter(f => f.endsWith('.md')) : []));
app.post('/api/samples/:name', c => {
  const f = `papers/${c.req.param('name').replace(/[^\w.-]/g, '')}`;
  if (!existsSync(f)) return c.json({ error: 'not found' }, 404);
  return c.json({ id: startPipeline(readFileSync(f, 'utf8')) });
});
app.post('/api/papers', async c => {
  const { markdown } = await c.req.json<{ markdown: string }>();
  if (!markdown || markdown.length < 200) return c.json({ error: 'Markdown is empty or too short to be a paper' }, 400);
  if (markdown.length > 2_000_000) return c.json({ error: 'Markdown is larger than 2 MB' }, 400);
  return c.json({ id: startPipeline(markdown, { force: c.req.query('force') === '1' }) });
});
app.get('/api/papers/:id', c => { const b = bundle(c.req.param('id')); return b ? c.json(b) : c.json({ error: 'not found' }, 404); });
app.get('/api/papers/:id/events', c => streamSSE(c, async s => {
  const id = c.req.param('id');
  const send = (st: PipelineStatus) => s.writeSSE({ data: JSON.stringify(st) });
  const cur = store.get<PipelineStatus>(id, 'status.json'); if (cur) await send(cur);
  if (cur?.stage === 'done' || cur?.stage === 'error') return;
  await new Promise<void>(resolve => {
    const on = (st: PipelineStatus) => { send(st); if (st.stage === 'done' || st.stage === 'error') { bus.off(id, on); resolve(); } };
    bus.on(id, on); s.onAbort(() => { bus.off(id, on); resolve(); });
  });
}));
app.get('/api/papers/:id/sections/:sid', c => {
  const doc = store.get<PaperDoc>(c.req.param('id'), 'doc.json');
  const sec = doc?.sections.find(s => s.id === c.req.param('sid'));
  if (!sec) return c.json({ error: `no section ${c.req.param('sid')}; use an id from the section index` }, 404);
  const kids = doc!.sections.filter(s => s.id.startsWith(sec.id + '.'));
  const text = [sec.text, ...kids.map(k => `[${k.id}] ${k.title}\n${k.text}`)].join('\n\n');
  return c.json({ id: sec.id, title: sec.title, text: text.slice(0, 14000), truncated: text.length > 14000 });
});

app.post('/api/papers/:id/live', async c => {
  const id = c.req.param('id');
  const doc = store.get<PaperDoc>(id, 'doc.json'), digest = store.get<Digest>(id, 'digest.json'), ds = store.get<Diagram[]>(id, 'diagrams.json');
  if (!doc || !digest || !ds) return c.json({ error: 'paper not ready' }, 409);
  try { return c.json({ token: await mintToken(), model: MODELS.live, config: liveConfig(doc, digest, ds) }); }
  catch (e: any) { return c.json({ error: String(e?.message || e) }, 502); }
});

app.post('/api/papers/:id/scratch', async c => {
  try { return c.json(await drawScratch(c.req.param('id'), await c.req.json())); }
  catch (e: any) { return c.json({ error: e instanceof GenError ? `could not draw it: ${e.issues.slice(0, 3).join('; ')}` : String(e?.message || e) }, 500); }
});

app.get('/api/papers/:id/sessions', c => c.json(store.listSessions(c.req.param('id')).map(sid => {
  const s = store.get<SessionLog>(c.req.param('id'), `sessions/${sid}.json`)!;
  return { id: s.id, startedAt: s.startedAt, duration: s.duration, title: s.title, questions: s.customs.map(x => x.question) };
}).sort((a, b) => b.startedAt.localeCompare(a.startedAt))));
app.get('/api/papers/:id/sessions/:sid', c => { const s = store.get<SessionLog>(c.req.param('id'), `sessions/${c.req.param('sid').replace(/[^\w-]/g, '')}.json`); return s ? c.json(s) : c.json({ error: 'not found' }, 404); });
app.post('/api/papers/:id/sessions', async c => {
  const body = await c.req.json<SessionLog>();
  const sid = (body.id || randomUUID()).replace(/[^\w-]/g, '').slice(0, 40);
  store.put(c.req.param('id'), `sessions/${sid}.json`, { ...body, id: sid, paperId: c.req.param('id') });
  return c.json({ id: sid });
});

if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}
const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, () => console.log(`api on http://localhost:${port} (flash: ${MODELS.flash}, live: ${MODELS.live})`));
