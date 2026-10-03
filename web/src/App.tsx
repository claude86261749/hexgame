import { useCallback, useEffect, useState } from 'react';
import type { PaperBundle, PipelineStatus } from '../../shared/schema';
import { api, type PaperCard } from './api';
import { Reader } from './Reader';
import { Defs } from './diagram/Stage';
import { MapApp } from './hex/MapApp';

/** #/ is the map; #/p/<id> is one paper with its live guide, and #/p/<id>/live starts a voice session on arrival. */
const route = () => { const m = location.hash.match(/^#\/p\/([\w-]+)(\/live)?/); return m ? { id: m[1], live: !!m[2] } : null; };

export function App() {
  const [r, setR] = useState(route());
  const [papers, setPapers] = useState<PaperCard[]>([]);
  const refreshPapers = useCallback(() => { api.papers().then(setPapers).catch(() => {}); }, []);
  useEffect(() => { const on = () => setR(route()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  useEffect(() => { if (!r) { document.title = 'Related Work, live'; refreshPapers(); } }, [r, refreshPapers]);
  return <><Defs />{r ? <Paper key={r.id} id={r.id} live={r.live} /> : <MapApp papers={papers} refreshPapers={refreshPapers} />}</>;
}

function Paper({ id, live }: { id: string; live: boolean }) {
  const [b, setB] = useState<PaperBundle | null>(null), [err, setErr] = useState('');
  const [st, setSt] = useState<PipelineStatus | null>(null);
  useEffect(() => {
    let off = () => {};
    api.paper(id).then(x => {
      setB(x); setSt(x.status);
      if (x.status.stage !== 'done') off = api.events(id, s => { setSt(s); if (s.stage === 'done') api.paper(id).then(setB); });
    }).catch(e => setErr(String(e.message || e)));
    return () => off();
  }, [id]);
  useEffect(() => { if (b?.digest) document.title = `${b.digest.shortTitle}, live`; }, [b?.digest]);
  if (err) return <Shell><h2>Could not open this paper</h2><p className="err">{err}</p></Shell>;
  if (!b || !st) return <Shell><p><span className="spin" /> Loading…</p></Shell>;
  if (st.stage !== 'done' || !b.diagrams.length) return <Progress title={b.doc.title} st={st} />;
  return <Reader b={b} autostart={live} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="ex"><div className="progress">
    <p className="crumb"><a href="#/"><i className="hx" style={{ '--c': 'var(--accent)' } as React.CSSProperties} aria-hidden="true" />Related Work map</a></p>
    <div className="card">{children}</div>
  </div></div>;
}

const STAGES: [PipelineStatus['stage'], string][] = [['ingest', 'Split the paper into sections'], ['digest', 'Read the paper and take notes'], ['plan', 'Choose the diagrams'], ['specs', 'Draw each diagram, then check that it fits'], ['factcheck', 'Check every sentence against the paper']];
function Progress({ title, st }: { title: string; st: PipelineStatus }) {
  const at = STAGES.findIndex(s => s[0] === st.stage);
  return <Shell>
    <h2>{title}</h2>
    <p>{st.stage === 'error' ? <span className="err">Generation failed: {st.message}</span> : <>Getting the paper ready for the live guide: turning it into diagrams the guide can show and mark up. This takes a minute or two. {st.message}</>}</p>
    <ol>{STAGES.map(([k, label], i) => <li key={k}><span>{i < at || st.stage === 'done' ? '✓' : i === at ? <span className="spin" /> : '·'}</span><span>{label}</span><small /></li>)}</ol>
    {st.items.length > 0 && <ol>{st.items.map(it => <li key={it.id}><span className={'st-' + it.state}>{it.state === 'ok' ? '✓' : it.state === 'dropped' ? '✕' : <span className="spin" />}</span><span>{it.nav} <small>{it.type}</small></span><small>{it.note}</small></li>)}</ol>}
  </Shell>;
}
