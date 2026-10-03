import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Chip } from '../components/bits';
import { useGame } from '../components/context';
import { WORLD } from '../world/world';

/** The papers you can talk through with the live guide, and a way to add one. */
export function LiveBody() {
  const { papers, liveByTile, refreshPapers } = useGame();
  const [samples, setSamples] = useState<string[]>([]);
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [over, setOver] = useState(false);
  useEffect(() => { refreshPapers(); api.samples().then(setSamples).catch(() => {}); }, [refreshPapers]);
  const tileOf = (id: string) => Object.keys(liveByTile).find(t => liveByTile[t].id === id);
  const open = (id: string) => { location.hash = `#/p/${id}`; };
  const upload = async (f: File) => {
    setErr(''); setBusy(true);
    try { if (!/\.(md|markdown|txt)$/i.test(f.name)) throw new Error('Choose a Markdown (.md) file'); open((await api.upload(await f.text())).id); }
    catch (e: any) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };
  const ready = papers.filter(p => p.stage === 'done'), drawing = papers.filter(p => p.stage !== 'done');

  return (
    <>
      <p className="lead">Talk a paper through, out loud. The guide answers in a few spoken sentences and works the paper's diagrams while it talks: it opens the right one, marks it up, or draws a new one for your question. Interrupt it whenever you like.</p>
      {ready.length === 0 && <p className="none">No paper has a live guide yet. Add one below.</p>}
      {ready.map(p => {
        const tid = tileOf(p.id);
        return (
          <section className="livep" key={p.id}>
            <p className="field">{p.field || 'Paper'}</p>
            <h3>{p.title}</h3>
            {p.gist && <p className="gist">{p.gist}</p>}
            <div className="row">
              <a className="primary live-go" href={`#/p/${p.id}/live`}><i aria-hidden="true" />Start a live session</a>
              <a className="quiet" href={`#/p/${p.id}`}>Open the diagrams first</a>
            </div>
            {tid
              ? <p className="where-on">On the map: <Chip x={WORLD.byId[tid]} /></p>
              : <p className="where-on">Not on this map.</p>}
          </section>
        );
      })}
      {drawing.length > 0 && (
        <div className="grp">
          <h4>Being prepared</h4>
          <ul className="chips">{drawing.map(p => <li key={p.id}><a className="chip unread" href={`#/p/${p.id}`}>{p.title} <span className="yr">{p.stage}</span></a></li>)}</ul>
        </div>
      )}
      <div className="addp">
        <h4>Add a paper</h4>
        <label className={'drop' + (over ? ' over' : '')} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
          <span>Drop a paper as Markdown, or <u>{busy ? 'uploading…' : 'choose a file'}</u>. It takes a minute or two to turn it into diagrams; then the guide is ready.</span>
          <input type="file" accept=".md,.markdown,.txt,text/markdown" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        </label>
        {samples.length > 0 && <p className="src">Or from the samples folder: {samples.map(s => <button key={s} type="button" className="chip concept" onClick={async () => { try { open((await api.ingestSample(s)).id); } catch (e: any) { setErr(String(e.message)); } }}>{s.replace(/\.md$/, '')}</button>)}</p>}
        <p className="src">Convert an arXiv paper with <code>npm run fetch:arxiv -- 2508.10104</code>.</p>
        {err && <p className="err">{err}</p>}
      </div>
    </>
  );
}
