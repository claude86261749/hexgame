import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Diagram, PaperBundle, SessionEvent, SessionLog, Custom, LandscapeSpec } from '../../shared/schema';
import { layout, partsOf, defaultPart } from '../../shared/layout';
import { composeAll } from '../../shared/overlay';
import { emptyGuide, foldEvents, transcriptLines, type GuideState, type View } from '../../shared/session';
import { Stage } from './diagram/Stage';
import type { Guide, GuideStatus } from './live/guide';
import { api, type SessionCard } from './api';
import { Icon } from './icons';
import { Suite, useConfig } from './suite';

const fmt = (s: number) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const REL: Record<string, { name: string; gloss: (p: string) => string }> = {
  lineage: { name: 'Lineage', gloss: p => `${p} descends from it` }, component: { name: 'Component', gloss: p => `a part ${p} reuses` },
  compare: { name: 'Comparison', gloss: p => `${p} measures itself against it` }, downstream: { name: 'Downstream', gloss: () => 'built on top of work like this' },
};
const WEIGHT: Record<number, (p: string) => string> = { 3: p => `${p} leans on it heavily`, 2: p => `${p} leans on it`, 1: p => `${p} touches it lightly` };

interface Replay { log: SessionLog; T: number; playing: boolean; speed: number }

export function Reader({ b }: { b: PaperBundle }) {
  const G = b.diagrams, short = b.digest?.shortTitle || b.doc.title;
  const liveOn = useConfig()?.live !== false;
  const [view, setView] = useState<View>({ kind: 'g', id: G[0]?.id });
  const [sel, setSel] = useState<Record<string, string | null>>(() => Object.fromEntries(G.map(d => [d.id, defaultPart(d)])));
  const [xs, setXs] = useState<Record<string, number>>({});
  const [refs, setRefs] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<'read' | 'guide'>('read');
  // live
  const guide = useRef<Guide | null>(null);
  const [gstate, setGstate] = useState<GuideState>(emptyGuide());
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [status, setStatus] = useState<{ s: GuideStatus; msg?: string }>({ s: 'idle' });
  const [mic, setMic] = useState(false), [muted, setMuted] = useState(false), [phones, setPhones] = useState(false), [level, setLevel] = useState(0), [speaking, setSpeaking] = useState(false);
  // replay
  const [sessions, setSessions] = useState<SessionCard[]>([]);
  const [replay, setReplay] = useState<Replay | null>(null);
  const live = status.s === 'live' || status.s === 'connecting' || status.s === 'reconnecting';

  useEffect(() => { api.sessions(b.id).then(setSessions).catch(() => {}); }, [b.id]);
  useEffect(() => () => { guide.current?.stop(); }, []);
  // Esc cuts the guide off mid-sentence (reliable even on loud speakers, where talking over it may not register)
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape' && guide.current) { guide.current.interrupt(); setSpeaking(false); } };
    addEventListener('keydown', on); return () => removeEventListener('keydown', on);
  }, []);

  /* ------------- what state drives the screen: replay (folded at T) or live/last live */
  const replayState = useMemo(() => replay ? foldEvents(replay.log.events, replay.T) : null, [replay?.log, replay?.T]);
  const gs = replayState || gstate;
  const customs = replay ? replay.log.customs : gstate.customs;
  // follow the guide's view changes
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

  /* ------------- live controls */
  const startGuide = useCallback(async (voice: boolean) => {
    if (guide.current) return;
    setReplay(null); setTab('guide'); setEvents([]); const init = emptyGuide(); setGstate(init);
    const { Guide } = await import('./live/guide');
    if (guide.current) return;
    const g = new Guide(b.id, G, init, {
      onEvent: e => setEvents(ev => [...ev, e]), onState: setGstate, onStatus: (s, msg) => setStatus({ s, msg }),
      onLevel: setLevel, onSpeaking: setSpeaking,
    });
    guide.current = g;
    g.setHeadphones(phones);
    try { await g.start({ voice }); setMic(voice); }
    catch (e: any) { setStatus({ s: 'error', msg: String(e?.message || e) }); guide.current = null; }
  }, [b.id, G, phones]);
  const stopGuide = useCallback(async () => {
    const g = guide.current; if (!g) return;
    guide.current = null; setMic(false);
    await g.stop();
    api.sessions(b.id).then(setSessions).catch(() => {});
  }, [b.id]);
  const toggleMic = async () => { const g = guide.current; if (!g) return startGuide(true); try { await g.setMic(!g.micOn); setMic(g.micOn); } catch (e: any) { setStatus({ s: 'error', msg: 'Microphone: ' + (e?.message || e) }); } };

  /* ------------- replay controls */
  const openReplay = async (sid: string) => {
    if (guide.current) await stopGuide();
    const log = await api.session(b.id, sid);
    setReplay({ log, T: 0, playing: true, speed: 1 }); setTab('guide'); lastGuideView.current = '';
  };
  useEffect(() => {
    if (!replay?.playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      setReplay(r => { if (!r) return r; const T = Math.min(r.log.duration, r.T + dt * r.speed); return { ...r, T, playing: T < r.log.duration }; });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replay?.playing]);

  /* ------------- navigation */
  const go = (v: View) => { setView(v); lastGuideView.current = gs.view ? gs.view.kind + gs.view.id : ''; if (replay) setReplay(r => r && { ...r, playing: false }); };
  const gi = G.findIndex(d => d.id === view.id);
  const custom = view.kind === 'c' ? (replayState?.customs || gstate.customs).find(c => c.id === view.id) || customs.find(c => c.id === view.id) : null;

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

  /* ------------- side: read */
  const readPanel = (() => {
    if (view.kind === 'c' && custom) return <div className="read">
      <h2>{custom.head}</h2>
      <p className="hint" style={{ marginTop: 0 }}><i />You asked: “{custom.question}”</p>
      {custom.summary ? <p style={{ marginTop: 10 }}>{custom.summary}</p> : (() => {
        // no summary yet: show what the guide said while building this diagram
        const evs = replay ? replay.log.events : events;
        const start = evs.find(e => e.kind === 'tool' && e.name === 'start_custom' && (e.result as any)?.custom_id === custom.id)?.t;
        const next = start == null ? undefined : evs.find(e => e.t > start && e.kind === 'tool' && e.name === 'start_custom' && !(e.result as any)?.error)?.t;
        const said = start == null ? '' : evs.filter(e => e.kind === 'guide' && e.t >= start && (next == null || e.t < next) && (!replay || e.t <= replay.T)).map(e => (e as any).text).join('').trim();
        return said ? <p style={{ marginTop: 10 }}>{said}</p> : <p className="hint">The guide is still answering.</p>;
      })()}
    </div>;
    const d = G[gi]; if (!d) return null;
    const pid = sel[d.id];
    return <div className="read">
      <h2>{d.head}</h2>
      {d.body.map((p, i) => <p key={i}>{p}</p>)}
      {d.type === 'landscape' && <ul className="legend">{Object.entries(REL).map(([k, r]) => <li key={k} className={'r-' + k}><i />{r.name}</li>)}<li><i className="fogsw" />Open direction</li></ul>}
      {pid && <PartCard d={d} id={pid} short={short} onPick={id => setSel(s => ({ ...s, [d.id]: id }))} />}
      {d.hint && <p className="hint">{d.hint}</p>}
      {d.sources.length > 0 && <p className="src">From sections {d.sources.map(s => s.replace(/^s/, '')).join(', ')} of the paper.</p>}
      <div className="pn">
        {gi > 0 && <button className="btn" onClick={() => go({ kind: 'g', id: G[gi - 1].id })}>Back</button>}
        {gi < G.length - 1 && <button className="btn next" onClick={() => go({ kind: 'g', id: G[gi + 1].id })}>Next: {G[gi + 1].nav}</button>}
      </div>
    </div>;
  })();

  /* ------------- side: guide transcript */
  const evs = replay ? replay.log.events : events;
  const dur = replay ? replay.log.duration : (evs[evs.length - 1]?.t ?? 0) + 1;
  const lines = useMemo(() => transcriptLines(evs, dur), [evs, dur]);
  const T = replay ? replay.T : Infinity;
  const tlRef = useRef<HTMLDivElement>(null);
  const curLine = replay ? lines.findLastIndex(l => l.t0 <= T) : -1;
  useEffect(() => {
    const el = tlRef.current?.querySelector(replay ? '.ln.cur' : '.turn:last-child');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [curLine, lines.length]);
  const toolNotes = evs.filter(e => e.kind === 'tool') as Extract<SessionEvent, { kind: 'tool' }>[];
  const guidePanel = <div className="tlines replay" ref={tlRef}>
    {!lines.length && !live && !replay && <div className="empty">
      <p>Ask the guide about anything in {short}. It answers out loud and draws on the diagrams as it talks.</p>
      <p>Each question becomes its own diagram, kept in the list on the left. Sessions are recorded so you can play them back.</p>
    </div>}
    {!lines.length && live && <div className="empty"><span className="spin" /> {status.s === 'connecting' ? 'Connecting to the guide…' : 'Listening…'}</div>}
    {lines.map((l, i) => {
      const tools = toolNotes.filter(t => t.t >= l.t0 && t.t < (lines[i + 1]?.t0 ?? Infinity) && (!replay || t.t <= T));
      const cls = !replay ? 'past' : i < curLine ? 'past' : i === curLine ? 'cur' : 'future';
      return <div key={l.key} className={'turn ' + l.who}>
        {(i === 0 || lines[i - 1].who !== l.who) && <div className="who">{l.who === 'you' ? 'You' : 'Guide'}<span>{fmt(l.t0)}</span></div>}
        <p className={'ln ' + cls} onClick={() => replay && setReplay(r => r && { ...r, T: l.t0 + 0.001 })}>
          {l.words.map((w, k) => <React.Fragment key={k}><span className={'w' + (!replay || w.t <= T ? ' said' : '')}>{w.w}</span>{' '}</React.Fragment>)}
        </p>
        {tools.map((t, k) => <ToolNote key={k} e={t} G={G} customs={customs} />)}
      </div>;
    })}
  </div>;

  /* ------------- player */
  const cuts = replay ? replay.log.events.filter(e => e.kind === 'tool' && e.name === 'start_custom' && !(e.result as any)?.error).map(e => e.t) : [];
  const player = replay && <div className="player">
    <button className="pbtn" aria-label={replay.playing ? 'Pause' : 'Play'} onClick={() => setReplay(r => r && { ...r, playing: !r.playing, T: r.T >= r.log.duration - 0.05 ? 0 : r.T })}>{replay.playing ? Icon.pause : replay.T >= replay.log.duration - 0.05 ? Icon.again : Icon.play}</button>
    <div className="time"><b>{fmt(replay.T)}</b><span className="tot"> / {fmt(replay.log.duration)}</span></div>
    <Track T={replay.T} total={replay.log.duration} cuts={cuts} onSeek={t => setReplay(r => r && { ...r, T: t })} />
    <button className="sbtn" onClick={() => setReplay(r => r && { ...r, speed: r.speed === 1 ? 1.5 : r.speed === 1.5 ? 2 : 1 })}>{replay.speed}×</button>
  </div>;

  return <div className="app">
    <header className="paper">
      <div>
        <div className="crumb"><Suite here="diagrams" aid={b.doc.arxiv} /><a href="#/">Library</a> / {b.digest?.field || 'Paper'} / this paper</div>
        <h1>{short}</h1>
        <p className="by">{b.digest?.byline}{b.doc.arxiv && <> <a href={`https://arxiv.org/abs/${b.doc.arxiv}`} target="_blank" rel="noopener noreferrer">Open arXiv {b.doc.arxiv}</a></>}</p>
      </div>
      <p className="gist">{b.digest?.gist}</p>
    </header>
    <div className="work">
      <nav className="toc" aria-label="Diagrams">
        <div className="grp">
          <h2>The paper, in {G.length} diagrams</h2>
          {G.map((d, i) => <button key={d.id} className="ti" aria-current={view.kind === 'g' && view.id === d.id} onClick={() => go({ kind: 'g', id: d.id })}><span className="n">{i + 1}</span><span>{d.nav}</span></button>)}
        </div>
        {customs.length > 0 && <div className="grp">
          <h2>Made for your questions</h2>
          {customs.map(c => { const bi = G.findIndex(d => d.id === c.base); const shown = (replayState?.customs || gstate.customs).find(x => x.id === c.id);
            return <button key={c.id} className="ti" aria-current={view.kind === 'c' && view.id === c.id} onClick={() => replay ? setReplay(r => r && { ...r, T: (r.log.events.find(e => e.kind === 'tool' && e.name === 'start_custom' && (e.result as any)?.custom_id === c.id)?.t ?? r.T) + 0.01 }) : go({ kind: 'c', id: c.id })}>
              <span className={'dot' + (shown?.pending ? ' pending' : '')} /><span>{c.nav}</span><span className="from">{bi >= 0 ? `starts from diagram ${bi + 1}` : 'drawn from scratch'}</span></button>; })}
        </div>}
        <div className="grp">
          <h2>Talk it through</h2>
          {!liveOn ? <p className="off">The live guide is off on this site. Recorded sessions still play.</p> : !guide.current
            ? <button className="sessbtn" onClick={() => startGuide(true)}>{Icon.mic}<span>Talk to the guide<small>voice; or type below</small></span></button>
            : <button className="sessbtn on" onClick={stopGuide}>{Icon.close}<span>End the session<small>{status.s}{status.msg ? `: ${status.msg}` : ''}</small></span></button>}
          {sessions.map(s => <button key={s.id} className={'sessbtn' + (replay?.log.id === s.id ? ' on' : '')} onClick={() => replay?.log.id === s.id ? setReplay(null) : openReplay(s.id)}>
            {replay?.log.id === s.id ? Icon.close : Icon.play}<span>{replay?.log.id === s.id ? 'Close the recording' : `Play session, ${fmt(s.duration)}`}<small>{s.questions[0] ? `“${s.questions[0]}”${s.questions.length > 1 ? ` +${s.questions.length - 1}` : ''}` : new Date(s.startedAt).toLocaleString()}</small></span></button>)}
        </div>
      </nav>
      <section className="canvas" aria-label="Diagram">
        <div className="stagehead"><h2>{headN}</h2>{origin && <p className="origin">{origin}</p>}</div>
        <div className="stagewrap">{stage}</div>
        {player}
      </section>
      <aside className="side">
        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === 'read'} onClick={() => setTab('read')}>Read</button>
          <button className="tab" role="tab" aria-selected={tab === 'guide'} onClick={() => setTab('guide')}>{replay ? 'Recorded session' : 'Guide'}{live && <span className="live" />}</button>
        </div>
        <div className="sidebody">{tab === 'read' ? readPanel : guidePanel}</div>
        {!replay && liveOn && <Composer live={live} mic={mic} muted={muted} level={level} speaking={speaking} status={status}
          onSend={t => { if (guide.current) guide.current.sendText(t); else startGuide(false).then(() => guide.current?.sendText(t)); setTab('guide'); }}
          onMic={toggleMic} onMute={() => { setMuted(m => { guide.current?.setMuted(!m); return !m; }); }}
          phones={phones} onPhones={() => setPhones(p => { guide.current?.setHeadphones(!p); return !p; })}
          onStop={() => { guide.current?.interrupt(); setSpeaking(false); }} />}
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
      <h4>Approach it from</h4><div className="fromrow">{o.from.map(f => <button key={f} className="chip" onClick={() => onPick(f)}>{d.tiles.find(x => x.id === f)?.label || f}</button>)}</div>
      <p className="note"><span>Suggested by the guide from gaps in the paper. It is not a statement by the authors.</span></p>
    </div>;
    return null;
  }
  if (d.type === 'pipeline') { const s = d.steps.find(x => x.id === id); return s ? <div className="part"><h3>{d.steps.indexOf(s) + 1}&nbsp; {s.title}</h3><p>{s.note}</p></div> : null; }
  const p = partsOf(d).find(x => x.id === id);
  return p?.note ? <div className="part"><h3>{p.title}</h3><p>{p.note}</p></div> : null;
}

function Track({ T, total, cuts, onSeek }: { T: number; total: number; cuts: number[]; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null); const drag = useRef(false);
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total; };
  const pc = (T / Math.max(total, 0.001) * 100).toFixed(2) + '%';
  return <div className="track" ref={ref} role="slider" tabIndex={0} aria-label="Position in the session" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(T)} aria-valuetext={fmt(T)}
    onPointerDown={e => { drag.current = true; ref.current!.setPointerCapture(e.pointerId); onSeek(at(e)); }} onPointerMove={e => drag.current && onSeek(at(e))} onPointerUp={() => { drag.current = false; }}
    onKeyDown={e => { if (e.key === 'ArrowRight') onSeek(Math.min(total, T + 5)); else if (e.key === 'ArrowLeft') onSeek(Math.max(0, T - 5)); else if (e.key === 'Home') onSeek(0); else if (e.key === 'End') onSeek(total); }}>
    <div className="fill" style={{ width: pc }} />{cuts.map((c, i) => <div key={i} className="cut" style={{ left: (c / total * 100).toFixed(2) + '%' }} />)}<div className="thumb" style={{ left: pc }} />
  </div>;
}

function Composer(p: { onStop: () => void; phones: boolean; onPhones: () => void; live: boolean; mic: boolean; muted: boolean; level: number; speaking: boolean; status: { s: GuideStatus; msg?: string }; onSend: (t: string) => void; onMic: () => void; onMute: () => void }) {
  const [text, setText] = useState('');
  return <div className="composer">
    <form onSubmit={e => { e.preventDefault(); if (text.trim()) { p.onSend(text.trim()); setText(''); } }}>
      <button type="button" className={'mic' + (p.mic ? ' on' : '')} aria-label={p.mic ? 'Turn the microphone off' : 'Talk to the guide'} aria-pressed={p.mic} onClick={p.onMic}>{Icon.mic}</button>
      <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder={p.live ? 'Ask the guide…' : 'Ask a question to start the guide'} aria-label="Ask the guide" />
      <button className="btn" type="submit" disabled={!text.trim()}>Ask</button>
    </form>
    <div className="status">
      <span>{p.status.s === 'error' ? <span className="err">{p.status.msg}</span> : p.live ? (p.speaking ? <>Guide is speaking · <button className="linkbtn" type="button" onClick={p.onStop}>Stop</button> (Esc)</> : p.mic ? 'Listening' : 'Connected, microphone off') : 'The guide uses your microphone, or you can type.'}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{p.mic && <span className="level"><b style={{ width: Math.min(100, p.level * 600) + '%' }} /></span>}
        <label title="With headphones you can talk over the guide at any time. On speakers, the guide stops listening while it talks unless you speak up clearly." style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={p.phones} onChange={p.onPhones} />Headphones</label>
        {p.live && <button className="linkbtn" type="button" onClick={p.onMute}>{p.muted ? 'Unmute voice' : 'Mute voice'}</button>}</span>
    </div>
  </div>;
}
