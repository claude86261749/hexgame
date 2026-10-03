import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Diagram, PaperBundle, SessionEvent, Custom, LandscapeSpec } from '../../shared/schema';
import { partsOf, defaultPart } from '../../shared/layout';
import { composeAll } from '../../shared/overlay';
import { emptyGuide, transcriptLines, type GuideState, type View } from '../../shared/session';
import { Stage } from './diagram/Stage';
import type { Guide, GuideStatus } from './live/guide';
import { Icon } from './icons';

const fmt = (s: number) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const REL: Record<string, { name: string; gloss: (p: string) => string }> = {
  lineage: { name: 'Lineage', gloss: p => `${p} descends from it` }, component: { name: 'Component', gloss: p => `a part ${p} reuses` },
  compare: { name: 'Comparison', gloss: p => `${p} measures itself against it` }, downstream: { name: 'Downstream', gloss: () => 'built on top of work like this' },
};
const WEIGHT: Record<number, (p: string) => string> = { 3: p => `${p} leans on it heavily`, 2: p => `${p} leans on it`, 1: p => `${p} touches it lightly` };
const HexMark = ({ c }: { c?: string }) => <i className="hx" style={c ? ({ '--c': c } as React.CSSProperties) : undefined} aria-hidden="true" />;

/** One paper, explained live: the diagrams in the middle, the live guide on the right, and what the guide draws for
 *  your questions collected on the left. `autostart` opens a voice session as soon as the page is up. */
export function Reader({ b, autostart }: { b: PaperBundle; autostart?: boolean }) {
  const G = b.diagrams, short = b.digest?.shortTitle || b.doc.title;
  const [view, setView] = useState<View>({ kind: 'g', id: G[0]?.id });
  const [sel, setSel] = useState<Record<string, string | null>>(() => Object.fromEntries(G.map(d => [d.id, defaultPart(d)])));
  const [xs, setXs] = useState<Record<string, number>>({});
  const [refs, setRefs] = useState<Record<string, number>>({});
  const guide = useRef<Guide | null>(null);
  const [gs, setGs] = useState<GuideState>(emptyGuide());
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [status, setStatus] = useState<{ s: GuideStatus; msg?: string }>({ s: 'idle' });
  const [open, setOpen] = useState(false);
  const [mic, setMic] = useState(false), [muted, setMuted] = useState(false), [phones, setPhones] = useState(false), [level, setLevel] = useState(0), [speaking, setSpeaking] = useState(false);
  const live = status.s === 'live' || status.s === 'connecting' || status.s === 'reconnecting';
  const customs = gs.customs;

  useEffect(() => () => { guide.current?.stop(); }, []);
  // Esc cuts the guide off mid-sentence (reliable even on loud speakers, where talking over it may not register)
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape' && guide.current) { guide.current.interrupt(); setSpeaking(false); } };
    addEventListener('keydown', on); return () => removeEventListener('keydown', on);
  }, []);

  /* ------------- the screen follows the guide's tool calls */
  const lastGuideView = useRef<string>('');
  useEffect(() => {
    if (!gs.view) return;
    const key = gs.view.kind + gs.view.id + JSON.stringify(gs.sel[gs.view.id] ?? '') + (gs.x[gs.view.id] ?? '');
    if (key === lastGuideView.current) return;
    lastGuideView.current = key;
    setView(gs.view);
    if (gs.view.kind === 'g' && gs.sel[gs.view.id] !== undefined) setSel(s => ({ ...s, [gs.view!.id]: gs.sel[gs.view!.id] }));
    if (gs.x[gs.view.id] != null) setXs(x => ({ ...x, [gs.view!.id]: gs.x[gs.view!.id] }));
  }, [gs]);

  const describe = (v: View) => v.kind === 'g' ? `the diagram "${G.find(d => d.id === v.id)?.nav}"` : `the diagram made for the question "${customs.find(c => c.id === v.id)?.question}"`;

  /* ------------- live session */
  const startGuide = useCallback(async (voice: boolean) => {
    if (guide.current) return;
    setOpen(true); setEvents([]);
    const init = { ...emptyGuide(), view }; setGs(init);
    const { Guide } = await import('./live/guide');
    if (guide.current) return;
    const g = new Guide(b.id, G, init, {
      onEvent: e => setEvents(ev => [...ev, e]), onState: setGs, onStatus: (s, msg) => setStatus({ s, msg }),
      onLevel: setLevel, onSpeaking: setSpeaking,
    });
    guide.current = g;
    g.setHeadphones(phones);
    try { await g.start({ voice, onScreen: describe(view) }); setMic(voice); }
    catch (e: any) { setStatus({ s: 'error', msg: String(e?.message || e) }); guide.current = null; }
  }, [b.id, G, phones, view]);
  const stopGuide = useCallback(async () => {
    const g = guide.current; if (!g) return;
    guide.current = null; setMic(false); setSpeaking(false);
    await g.stop();
  }, []);
  const toggleMic = async () => { const g = guide.current; if (!g) return startGuide(true); try { await g.setMic(!g.micOn); setMic(g.micOn); } catch (e: any) { setStatus({ s: 'error', msg: 'Microphone: ' + (e?.message || e) }); } };
  const ask = (t: string) => { if (guide.current) guide.current.sendText(t); else startGuide(false).then(() => guide.current?.sendText(t)); };
  const started = useRef(false);
  useEffect(() => { if (autostart && !started.current) { started.current = true; startGuide(true); } }, [autostart, startGuide]);

  /* ------------- navigation by hand; the guide is told what the reader opened */
  const go = (v: View) => {
    setView(v);
    lastGuideView.current = gs.view ? gs.view.kind + gs.view.id : '';
    if (guide.current && (v.kind !== view.kind || v.id !== view.id)) guide.current.lookingAt(describe(v));
  };
  const gi = G.findIndex(d => d.id === view.id);
  const custom = view.kind === 'c' ? customs.find(c => c.id === view.id) || null : null;

  /* ------------- stage */
  let stage: React.ReactNode, headN: React.ReactNode = null, origin: React.ReactNode = null;
  if (view.kind === 'g' && G[gi]) {
    const d = G[gi];
    const vs = { sel: sel[d.id] ?? null, x: xs[d.id], ref: refs[d.id] };
    const selectable = new Set(d.type === 'landscape' ? [...(d as LandscapeSpec).tiles.map(t => t.id), ...(d as LandscapeSpec).open.map(o => o.id)] : d.type === 'pipeline' ? d.steps.map(s => s.id) : partsOf(d).filter(p => p.note).map(p => p.id));
    stage = <Stage key={d.id} spec={d} vs={vs} selectable={selectable}
      onSelect={id => setSel(s => ({ ...s, [d.id]: d.type === 'landscape' ? id : id ?? s[d.id] }))}
      onScrub={x => setXs(s => ({ ...s, [d.id]: x }))} onRef={p => setRefs(s => ({ ...s, [d.id]: p }))} />;
    headN = <><span className="n">{gi + 1}</span>{d.nav}</>;
  } else if (custom) {
    const base = custom.base ? G.find(d => d.id === custom.base) || null : null;
    const c = composeAll(custom, base, { sel: base ? defaultPart(base) : null, x: base ? xs[base.id] : undefined });
    stage = <>
      <Stage key={custom.id} spec={c.spec} L={c.L} marks={c.items} height={c.h} still reveal={{ k: custom.steps.length - 1, fresh: true }} vs={{ sel: base ? defaultPart(base) : null }} />
      {custom.pending && <div className="busy"><span className="spin" /> drawing…</div>}
    </>;
    headN = custom.nav;
    const bi = base ? G.indexOf(base) : -1;
    origin = base ? <><i />Orange was added for your question. The rest is <button className="linkbtn" onClick={() => go({ kind: 'g', id: base.id })}>diagram {bi + 1}, {base.nav.toLowerCase()}</button></> : <><i />Drawn from scratch for your question</>;
  }

  /* ------------- notes under the diagram */
  const notes = (() => {
    if (view.kind === 'c' && custom) {
      let said = custom.summary;
      if (!said) {
        // no summary yet: show what the guide has said since it started this diagram
        const start = events.find(e => e.kind === 'tool' && e.name === 'start_custom' && (e.result as any)?.custom_id === custom.id)?.t;
        const next = start == null ? undefined : events.find(e => e.t > start && e.kind === 'tool' && e.name === 'start_custom' && !(e.result as any)?.error)?.t;
        said = start == null ? '' : events.filter(e => e.kind === 'guide' && e.t >= start && (next == null || e.t < next)).map(e => (e as any).text).join('').trim();
      }
      return <div className="read">
        <h2>{custom.head}</h2>
        <p className="rhint" style={{ marginTop: 0 }}><i />You asked: “{custom.question}”</p>
        {said ? <p style={{ marginTop: 10 }}>{said}</p> : <p className="rhint">The guide is still answering.</p>}
      </div>;
    }
    const d = G[gi]; if (!d) return null;
    const pid = sel[d.id];
    return <div className="read">
      <h2>{d.head}</h2>
      {d.body.map((p, i) => <p key={i}>{p}</p>)}
      {d.type === 'landscape' && <ul className="rlegend">{Object.entries(REL).map(([k, r]) => <li key={k} className={'r-' + k}><i />{r.name}</li>)}<li><i className="fogsw" />Open direction</li></ul>}
      {pid && <PartCard d={d} id={pid} short={short} onPick={id => setSel(s => ({ ...s, [d.id]: id }))} />}
      {d.hint && <p className="rhint">{d.hint}</p>}
      {d.sources.length > 0 && <p className="src">From sections {d.sources.map(s => s.replace(/^s/, '')).join(', ')} of the paper.</p>}
      <div className="pn">
        {gi > 0 && <button className="btn" onClick={() => go({ kind: 'g', id: G[gi - 1].id })}>Back</button>}
        {gi < G.length - 1 && <button className="btn next" onClick={() => go({ kind: 'g', id: G[gi + 1].id })}>Next: {G[gi + 1].nav}</button>}
      </div>
    </div>;
  })();

  /* ------------- the live transcript */
  const dur = (events[events.length - 1]?.t ?? 0) + 1;
  const lines = useMemo(() => transcriptLines(events, dur), [events, dur]);
  const tlRef = useRef<HTMLDivElement>(null);
  useEffect(() => { tlRef.current?.querySelector('.turn:last-child')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [lines.length, events.length]);
  const toolNotes = events.filter(e => e.kind === 'tool') as Extract<SessionEvent, { kind: 'tool' }>[];
  const cur = G[gi];
  const asks = [
    cur && view.kind === 'g' ? `Walk me through “${cur.nav}”` : null,
    b.digest?.newIdea ? `What is the one new idea in ${short}?` : null,
    b.digest?.glossary[0] ? `Draw how ${b.digest.glossary[0].term} works` : null,
    b.digest?.limitations.length ? `Where does ${short} fall short?` : null,
  ].filter(Boolean) as string[];

  const liveBody = !open
    ? <div className="livecard">
        <h3>Talk {short} through with the guide</h3>
        <p>Ask out loud, the way you would ask a colleague at a whiteboard. The guide answers in a few spoken sentences and works on the diagrams while it talks: it switches to the right one, marks it up in orange, or draws a new one for your question.</p>
        <button className="go-big" onClick={() => startGuide(true)}><span className="ring">{Icon.mic}</span><span>Start a live session<small>Uses your microphone. You can also type below.</small></span></button>
        <h4>Or start by asking</h4>
        <div className="asks">{asks.map(q => <button key={q} className="xchip ask" onClick={() => ask(q)}>{q}</button>)}</div>
        <h4>During the session</h4>
        <ul>
          <li><HexMark c="var(--live)" />Talk over the guide to interrupt it, or press Esc. On speakers it only stops for a clear voice; tick Headphones to interrupt freely.</li>
          <li><HexMark c="var(--mark)" />Each question that gets its own diagram is kept on the left, so you can go back to it.</li>
          <li><HexMark />Move through the diagrams yourself at any time. The guide is told what you opened.</li>
        </ul>
      </div>
    : <div className="tlines" ref={tlRef} aria-live="polite">
        {!lines.length && <div className="waiting"><span className="spin" /> {status.s === 'connecting' || status.s === 'reconnecting' ? 'Connecting to the guide…' : status.s === 'error' ? 'The session could not start.' : mic ? 'Listening. Ask anything.' : 'Connected. Type a question below.'}</div>}
        {lines.map((l, i) => {
          const tools = toolNotes.filter(t => t.t >= l.t0 && t.t < (lines[i + 1]?.t0 ?? Infinity));
          return <div key={l.key} className={'turn ' + l.who}>
            {(i === 0 || lines[i - 1].who !== l.who) && <div className="who">{l.who === 'you' ? 'You' : 'Guide'}<span>{fmt(l.t0)}</span></div>}
            <p className="ln">{l.words.map(w => w.w).join(' ')}</p>
            {tools.map((t, k) => <ToolNote key={k} e={t} G={G} customs={customs} />)}
          </div>;
        })}
      </div>;

  const pill = live
    ? <span className="livepill on"><i />{status.s === 'live' ? (speaking ? 'Live · guide speaking' : mic ? 'Live · listening' : 'Live') : status.s === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
    : <span className="livepill"><i />{status.s === 'closed' ? 'Session ended' : status.s === 'error' ? 'Not connected' : 'Not live'}</span>;

  return <div className="ex">
    <header className="ex-head">
      <div className="ex-hud glass">
        <p className="crumb"><a href="#/"><HexMark c="var(--accent)" />Related Work map</a> <span aria-hidden="true">/</span> {b.digest?.field || 'Paper'}</p>
        <h1>{short}, live</h1>
        <p className="sub">{b.digest?.gist}</p>
        <p className="byline">{b.digest?.byline}{b.doc.arxiv && <> · <a href={`https://arxiv.org/abs/${b.doc.arxiv}`} target="_blank" rel="noopener noreferrer">arXiv {b.doc.arxiv}</a></>}</p>
      </div>
      <div className="ex-tools" role="toolbar" aria-label="Session">
        {guide.current
          ? <button type="button" onClick={stopGuide}>{Icon.close}End the session</button>
          : <button type="button" onClick={() => startGuide(true)}>{Icon.mic}{open ? 'New live session' : 'Start a live session'}</button>}
        <a href="#/">Back to the map</a>
      </div>
    </header>
    <div className="work">
      <nav className="toc card" aria-label="Diagrams">
        <div className="tgrp">
          <h2>The paper, in {G.length} diagrams</h2>
          {G.map((d, i) => <button key={d.id} className="ti" aria-current={view.kind === 'g' && view.id === d.id} onClick={() => go({ kind: 'g', id: d.id })}><span className="n">{i + 1}</span><span>{d.nav}</span></button>)}
        </div>
        <div className="tgrp">
          <h2><HexMark c="var(--mark)" />Drawn in this session</h2>
          {customs.length === 0 && <p className="none">Nothing yet. When the guide marks up a diagram or draws a new one for your question, it is kept here.</p>}
          {customs.map(c => { const bi = G.findIndex(d => d.id === c.base);
            return <button key={c.id} className="ti" aria-current={view.kind === 'c' && view.id === c.id} onClick={() => go({ kind: 'c', id: c.id })}>
              <span className={'dot' + (c.pending ? ' pending' : '')} /><span>{c.nav}</span><span className="from">{bi >= 0 ? `starts from diagram ${bi + 1}` : 'drawn from scratch'}</span></button>; })}
        </div>
      </nav>
      <section className="canvas" aria-label="Diagram">
        <div className="stagehead"><h2>{headN}</h2>{origin && <p className="origin">{origin}</p>}</div>
        <div className="stagewrap card">{stage}</div>
        <div className="notes card">{notes}</div>
      </section>
      <aside className="side card" aria-label="Live guide">
        <div className="side-head"><h2>Live guide</h2>{pill}</div>
        <div className="sidebody">{liveBody}</div>
        <Composer live={live} mic={mic} muted={muted} level={level} speaking={speaking} status={status}
          onSend={ask} onMic={toggleMic} onMute={() => { setMuted(m => { guide.current?.setMuted(!m); return !m; }); }}
          phones={phones} onPhones={() => setPhones(p => { guide.current?.setHeadphones(!p); return !p; })}
          onStop={() => { guide.current?.interrupt(); setSpeaking(false); }} />
      </aside>
    </div>
  </div>;
}

function ToolNote({ e, G, customs }: { e: Extract<SessionEvent, { kind: 'tool' }>; G: Diagram[]; customs: Custom[] }) {
  const r = e.result as any, a = e.args as any;
  if (r?.error) return <p className="toolnote err">Tool {e.name} failed: {String(r.error).slice(0, 160)}</p>;
  const nav = (id: string) => G.find(d => d.id === id)?.nav || customs.find(c => c.id === id)?.nav || id;
  const t = e.name === 'show_diagram' ? `Showing “${nav(a.id)}”` : e.name === 'start_custom' ? `New diagram: “${a.nav}”` : e.name === 'add_step' ? `Drew step ${r?.step ?? ''}`
    : e.name === 'draw_from_scratch' ? 'Drawing a new diagram…' : e.name === 'scratch_ready' ? 'Diagram ready' : e.name === 'read_section' ? `Read ${r?.title ? `“${r.title}”` : `section ${a.id}`}` : e.name === 'finish_custom' ? 'Summary added' : e.name;
  return <p className="toolnote">{t}</p>;
}

function PartCard({ d, id, short, onPick }: { d: Diagram; id: string; short: string; onPick: (id: string) => void }) {
  if (d.type === 'landscape') {
    const t = d.tiles.find(x => x.id === id);
    if (t) return <div className="part">
      <div className={'kind r-' + t.relation}><i />{REL[t.relation].name}: {REL[t.relation].gloss(short)}</div>
      <h3>{t.title}</h3>
      <p className="cby">{[t.authors, t.venue, t.year].filter(Boolean).join('. ')}.{t.arxiv && <> <a href={`https://arxiv.org/abs/${t.arxiv}`} target="_blank" rel="noopener noreferrer">Open arXiv {t.arxiv}</a></>}</p>
      <p>{t.link}</p>
      <h4>{t.carriedHeading}</h4><ul>{t.carried.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <h4>{t.changedHeading}</h4><ul>{t.changed.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <p className="note"><span>{WEIGHT[t.weight](short)}.</span></p>
    </div>;
    const o = d.open.find(x => x.id === id);
    if (o) return <div className="part">
      <div className="kind"><i className="fogsw" />Open direction</div>
      <h3>{o.title}</h3>
      <h4>What the paper shows</h4><p>{o.shows}</p>
      <h4>What it leaves open</h4><p>{o.open}</p>
      <h4>A first move</h4><p>{o.move}</p>
      <h4>Approach it from</h4><div className="fromrow">{o.from.map(f => <button key={f} className="xchip" onClick={() => onPick(f)}>{d.tiles.find(x => x.id === f)?.label || f}</button>)}</div>
      <p className="note"><span>Suggested by the guide from gaps in the paper. It is not a statement by the authors.</span></p>
    </div>;
    return null;
  }
  if (d.type === 'pipeline') { const s = d.steps.find(x => x.id === id); return s ? <div className="part"><h3>{d.steps.indexOf(s) + 1}&nbsp; {s.title}</h3><p>{s.note}</p></div> : null; }
  const p = partsOf(d).find(x => x.id === id);
  return p?.note ? <div className="part"><h3>{p.title}</h3><p>{p.note}</p></div> : null;
}

function Composer(p: { onStop: () => void; phones: boolean; onPhones: () => void; live: boolean; mic: boolean; muted: boolean; level: number; speaking: boolean; status: { s: GuideStatus; msg?: string }; onSend: (t: string) => void; onMic: () => void; onMute: () => void }) {
  const [text, setText] = useState('');
  return <div className="composer">
    <form onSubmit={e => { e.preventDefault(); if (text.trim()) { p.onSend(text.trim()); setText(''); } }}>
      <button type="button" className={'mic' + (p.mic ? ' on' : '')} aria-label={p.mic ? 'Turn the microphone off' : 'Talk to the guide'} aria-pressed={p.mic} onClick={p.onMic}>{Icon.mic}</button>
      <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder={p.live ? 'Ask the guide…' : 'Type a question to start a live session'} aria-label="Ask the guide" />
      <button className="btn go" type="submit" disabled={!text.trim()}>Ask</button>
    </form>
    <div className="status">
      <span>{p.status.s === 'error' ? <span className="err">{p.status.msg}</span> : p.status.s === 'connecting' || p.status.s === 'reconnecting' ? 'Connecting…' : p.live ? (p.speaking ? <>Guide is speaking · <button className="linkbtn" type="button" onClick={p.onStop}>Stop</button> (Esc)</> : p.mic ? 'Listening' : 'Connected, microphone off') : 'Voice or text; the guide answers out loud.'}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{p.mic && <span className="level"><b style={{ width: Math.min(100, p.level * 600) + '%' }} /></span>}
        <label title="With headphones you can talk over the guide at any time. On speakers, the guide stops listening while it talks unless you speak up clearly."><input type="checkbox" checked={p.phones} onChange={p.onPhones} />Headphones</label>
        {p.live && <button className="linkbtn" type="button" onClick={p.onMute}>{p.muted ? 'Unmute voice' : 'Mute voice'}</button>}</span>
    </div>
  </div>;
}
