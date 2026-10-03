import { useEffect, useState } from 'react';
import type { PaperBundle, PipelineStatus } from '../../shared/schema';
import { api, type PaperCard } from './api';
import { Reader } from './Reader';
import { Defs } from './diagram/Stage';

const route = () => { const m = location.hash.match(/^#\/p\/([\w-]+)/); return m ? m[1] : null; };

export function App() {
  const [pid, setPid] = useState(route());
  useEffect(() => { const on = () => setPid(route()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return <><Defs />{pid ? <Paper key={pid} id={pid} /> : <Home />}</>;
}

function Paper({ id }: { id: string }) {
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
  useEffect(() => { if (b?.digest) document.title = `${b.digest.shortTitle}, in diagrams`; }, [b?.digest]);
  if (err) return <div className="progress"><h2>Could not open this paper</h2><p className="err">{err}</p><a href="#/">Back to the library</a></div>;
  if (!b || !st) return <div className="progress"><span className="spin" /> Loading…</div>;
  if (st.stage !== 'done' || !b.diagrams.length) return <Progress title={b.doc.title} st={st} />;
  return <Reader b={b} />;
}

const STAGES: [PipelineStatus['stage'], string][] = [['ingest', 'Split the paper into sections'], ['digest', 'Read the paper and take notes'], ['plan', 'Choose the diagrams'], ['specs', 'Draw each diagram, then check that it fits'], ['factcheck', 'Check every sentence against the paper']];
function Progress({ title, st }: { title: string; st: PipelineStatus }) {
  const at = STAGES.findIndex(s => s[0] === st.stage);
  return <div className="progress">
    <p className="crumb"><a href="#/">Library</a></p>
    <h2>{title}</h2>
    <p>{st.stage === 'error' ? <span className="err">Generation failed: {st.message}</span> : <>Turning the paper into diagrams. This takes a minute or two. {st.message}</>}</p>
    <ol>{STAGES.map(([k, label], i) => <li key={k}><span>{i < at || st.stage === 'done' ? '✓' : i === at ? <span className="spin" /> : '·'}</span><span>{label}</span><small /></li>)}</ol>
    {st.items.length > 0 && <ol>{st.items.map(it => <li key={it.id}><span className={'st-' + it.state}>{it.state === 'ok' ? '✓' : it.state === 'dropped' ? '✕' : <span className="spin" />}</span><span>{it.nav} <small>{it.type}</small></span><small>{it.note}</small></li>)}</ol>}
  </div>;
}

function Home() {
  const [papers, setPapers] = useState<PaperCard[]>([]), [samples, setSamples] = useState<string[]>([]);
  const [err, setErr] = useState(''), [over, setOver] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Papers in diagrams'; api.papers().then(setPapers).catch(e => setErr(String(e.message))); api.samples().then(setSamples).catch(() => {}); }, []);
  const open = (id: string) => { location.hash = `#/p/${id}`; };
  const upload = async (f: File) => {
    setErr(''); setBusy(true);
    try { if (!/\.(md|markdown|txt)$/i.test(f.name)) throw new Error('Choose a Markdown (.md) file'); open((await api.upload(await f.text())).id); }
    catch (e: any) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };
  return <main className="home">
    <h1>Papers, explained in diagrams</h1>
    <p className="lede">Add a paper as Markdown. It is read, turned into a short sequence of interactive diagrams, and paired with a guide you can talk to, which draws new diagrams for your questions.</p>
    <label className={'drop' + (over ? ' over' : '')} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
      <p>Drop a <b>.md</b> paper here, or choose one. Convert an arXiv paper with <code>npm run fetch:arxiv -- 2508.10104</code>.</p>
      <span className="btn primary">{busy ? 'Uploading…' : 'Choose a file'}</span>
      <input type="file" accept=".md,.markdown,.txt,text/markdown" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
    </label>
    {samples.length > 0 && <div className="samples">Or start from a sample: {samples.map(s => <button key={s} className="chip" onClick={async () => { try { open((await api.ingestSample(s)).id); } catch (e: any) { setErr(String(e.message)); } }}>{s.replace(/\.md$/, '')}</button>)}</div>}
    {err && <p className="err">{err}</p>}
    <div className="cards">{papers.map(p => <button key={p.id} className="card" onClick={() => open(p.id)}>
      <span className="meta">{p.field || 'Paper'}{p.stage !== 'done' ? ` · ${p.stage}` : ''}{p.sessions ? ` · ${p.sessions} session${p.sessions > 1 ? 's' : ''}` : ''}</span>
      <h3>{p.title}</h3>{p.gist && <p>{p.gist}</p>}
    </button>)}</div>
  </main>;
}
