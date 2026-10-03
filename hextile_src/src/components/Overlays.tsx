import { useEffect, useSyncExternalStore } from 'react';
import type { Hover } from '../canvas/MapController';
import type { SheetMode } from '../game/state';
import { plural } from '../game/text';
import { clamp } from '../world/colour';
import { WORLD } from '../world/world';
import { useGame } from './context';

const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export function Hint({ onDismiss }: { onDismiss(): void }) {
  return (
    <div className="hint">
      <span>{coarse ? 'Tap' : 'Click'} a grey tile to walk there and open its paper. Only papers you mark as read get their colour.</span>
      <button type="button" onClick={onDismiss}>Got it</button>
    </div>
  );
}

export function LensBar({ onClear }: { onClear(): void }) {
  const { game, lens } = useGame();
  if (!lens) return null;
  let text;
  if (lens.type === 'concept') {
    const all = WORLD.papers.filter(t => t.c.includes(lens.name)), sn = all.filter(t => game.seen[t.id]).length;
    text = <><b>{lens.name}</b> is mentioned by {plural(all.length, 'paper')}; {sn} {sn === 1 ? 'is' : 'are'} revealed and marked.</>;
  } else {
    const G = WORLD.grads[lens.k - 1];
    text = <>Gradient {G.k}: <span className="dot f" /> {G.plus.name}, <span className="dot" /> {G.minus.name}. A larger mark is further toward that end.</>;
  }
  return <div className="lens"><span>{text}</span><button type="button" onClick={onClear}>Clear</button></div>;
}

/* ───────────── tooltip ─────────────
   Hover changes on every pointer move, so it lives in its own tiny store
   and only the tooltip re-renders. */
let hover: Hover | null = null;
const listeners = new Set<() => void>();
let timer = 0;
export function setHover(h: Hover | null) {
  clearTimeout(timer);
  hover = h;
  if (h?.sticky) timer = window.setTimeout(() => setHover(null), 2400);
  listeners.forEach(f => f());
}
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function Tooltip() {
  const { game, view } = useGame();
  const h = useSyncExternalStore(subscribe, () => hover);
  if (!h) return null;
  const t = WORLD.byId[h.id], here = t.id === game.cur;
  let body;
  if (!game.seen[t.id]) body = <><b>Uncharted</b><span>Walk next to it, or read a paper that builds on it, to reveal it.</span></>;
  else if (t.kind === 'open') body = <><b>{t.t}</b><span>Open ground near {view.themeOf[t.ti].name}.{here ? ' You are here.' : ' Click to walk there.'}</span></>;
  else body = <><b>{t.s}</b>, {t.y}<span>{game.read[t.id] ? 'Read.' : 'Revealed, not read.'} {here ? 'You are here. Click to open it.' : 'Click to walk there.'}</span></>;
  const wrap = document.querySelector('.map')?.getBoundingClientRect();
  const W = wrap?.width ?? window.innerWidth, H = wrap?.height ?? window.innerHeight;
  return <div className="tip" style={{ left: clamp(h.x, 0, W - 200), top: clamp(h.y, 0, H - 70) }}>{body}</div>;
}

/* ───────────── toasts ───────────── */
export interface Toast { id: number; title: string; text: string; mode: SheetMode }

export function Toasts({ toasts, onOpen, onExpire }: { toasts: Toast[]; onOpen(t: Toast): void; onExpire(id: number): void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => <ToastItem key={t.id} t={t} onOpen={onOpen} onExpire={onExpire} />)}
    </div>
  );
}
function ToastItem({ t, onOpen, onExpire }: { t: Toast; onOpen(t: Toast): void; onExpire(id: number): void }) {
  useEffect(() => { const h = setTimeout(() => onExpire(t.id), 7000); return () => clearTimeout(h); }, [t.id, onExpire]);
  return <button type="button" className="toast" onClick={() => onOpen(t)}><b>{t.title}</b>{t.text}</button>;
}
