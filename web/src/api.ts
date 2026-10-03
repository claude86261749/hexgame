import type { Diagram, PaperBundle, PipelineStatus, SessionLog } from '../../shared/schema';

async function j<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `${r.status} ${r.statusText}`);
  return body as T;
}
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export interface PaperCard { id: string; title: string; full?: string; field?: string; gist?: string; stage: string; sessions: number; arxiv?: string }
export interface SiteConfig { uploads: boolean; live: boolean; map: string; corpus: boolean }
export interface SessionCard { id: string; startedAt: string; duration: number; title?: string; questions: string[] }

let _config: Promise<SiteConfig> | null = null;
export const api = {
  config: () => (_config ??= fetch('/api/config').then(r => j<SiteConfig>(r)).catch(() => ({ uploads: true, live: true, map: '', corpus: false }))),
  arxiv: (aid: string) => fetch(`/api/arxiv/${aid}`, { method: 'POST' }).then(r => j<{ id: string }>(r)),
  papers: () => fetch('/api/papers').then(r => j<PaperCard[]>(r)),
  samples: () => fetch('/api/samples').then(r => j<string[]>(r)),
  ingestSample: (name: string) => fetch(`/api/samples/${encodeURIComponent(name)}`, { method: 'POST' }).then(r => j<{ id: string }>(r)),
  upload: (markdown: string) => post('/api/papers', { markdown }).then(r => j<{ id: string }>(r)),
  paper: (id: string) => fetch(`/api/papers/${id}`).then(r => j<PaperBundle>(r)),
  events: (id: string, on: (s: PipelineStatus) => void) => { const es = new EventSource(`/api/papers/${id}/events`); es.onmessage = e => on(JSON.parse(e.data)); return () => es.close(); },
  section: (id: string, sid: string) => fetch(`/api/papers/${id}/sections/${encodeURIComponent(sid)}`).then(r => j<{ id: string; title: string; text: string }>(r)),
  liveToken: (id: string) => post(`/api/papers/${id}/live`, {}).then(r => j<{ token: string; model: string; config: any }>(r)),
  scratch: (id: string, body: Record<string, unknown>) => post(`/api/papers/${id}/scratch`, body).then(r => j<{ spec: Diagram; targets: string[] }>(r)),
  sessions: (id: string) => fetch(`/api/papers/${id}/sessions`).then(r => j<SessionCard[]>(r)),
  session: (id: string, sid: string) => fetch(`/api/papers/${id}/sessions/${sid}`).then(r => j<SessionLog>(r)),
  saveSession: (id: string, log: SessionLog) => post(`/api/papers/${id}/sessions`, log).then(r => j<{ id: string }>(r)),
};
