import type { Diagram, PaperBundle, PipelineStatus, SessionLog } from '../../shared/schema';

async function j<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `${r.status} ${r.statusText}`);
  return body as T;
}
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export interface PaperCard { id: string; title: string; full?: string; field?: string; gist?: string; stage: string; sessions: number }

export const api = {
  papers: () => fetch('/api/papers').then(r => j<PaperCard[]>(r)),
  samples: () => fetch('/api/samples').then(r => j<string[]>(r)),
  ingestSample: (name: string) => fetch(`/api/samples/${encodeURIComponent(name)}`, { method: 'POST' }).then(r => j<{ id: string }>(r)),
  upload: (markdown: string) => post('/api/papers', { markdown }).then(r => j<{ id: string }>(r)),
  paper: (id: string) => fetch(`/api/papers/${id}`).then(r => j<PaperBundle>(r)),
  events: (id: string, on: (s: PipelineStatus) => void) => { const es = new EventSource(`/api/papers/${id}/events`); es.onmessage = e => on(JSON.parse(e.data)); return () => es.close(); },
  section: (id: string, sid: string) => fetch(`/api/papers/${id}/sections/${encodeURIComponent(sid)}`).then(r => j<{ id: string; title: string; text: string }>(r)),
  liveToken: (id: string) => post(`/api/papers/${id}/live`, {}).then(r => j<{ token: string; model: string; config: any }>(r)),
  scratch: (id: string, body: Record<string, unknown>) => post(`/api/papers/${id}/scratch`, body).then(r => j<{ spec: Diagram; targets: string[] }>(r)),
  saveSession: (id: string, log: SessionLog) => post(`/api/papers/${id}/sessions`, log).then(r => j<{ id: string }>(r)),
};
