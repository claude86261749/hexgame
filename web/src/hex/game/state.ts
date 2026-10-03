import { hexDist } from '../engine';
import { getMapView } from '../world/mapView';
import { WORLD } from '../world/world';

/* three tile states, kept apart on purpose:
   uncharted (blank) → revealed (grey landscape) → read (coloured) */
export interface GameState {
  /** The tile you stand on. */
  cur: string;
  /** The paper at the centre of the map. */
  focal: string;
  steps: number;
  /** Expeditions completed. */
  done: Record<string, 1>;
  /** Themes fully read, by theme index. */
  reg: Record<number, 1>;
  lifted: boolean;
  trails: boolean;
  hint: boolean;
  complete: boolean;
  seen: Record<string, true>;
  read: Record<string, true>;
  /** When the map should show each change, on the performance.now() clock. Never saved. */
  dueSeen: Record<string, number>;
  dueRead: Record<string, number>;
}

export type SheetMode = 'paper' | 'live' | 'exp' | 'log' | 'grad' | 'rep';
export interface ToastEvent { title: string; text: string; mode: SheetMode }

export const START = 'dinov3';
const W = WORLD;

function reveal(s: GameState, id: string, at: number) {
  if (s.seen[id]) return;
  s.seen[id] = true;
  s.dueSeen[id] = at;
}
/* walking onto a tile shows the landscape around it, nothing more */
function stepOn(s: GameState, id: string, at: number) {
  reveal(s, id, at);
  let i = 0;
  for (const n of getMapView(s.focal).at[W.byId[id].ti].nb) if (n && !s.seen[n.id]) reveal(s, n.id, at + 130 + (i++) * 70);
}
/* reading a paper paints its tile and brings what it builds on and uses into view */
function setRead(s: GameState, id: string, at: number) {
  if (s.read[id]) return;
  s.read[id] = true;
  s.dueRead[id] = at;
  const t = W.byId[id];
  if (t.kind === 'paper') {
    let j = 0;
    for (const r of [...t.builds, ...t.uses]) if (!s.seen[r]) reveal(s, r, at + 380 + (j++) * 110);
  }
}
/** Copy the parts an action may change. */
const draft = (s: GameState): GameState => ({
  ...s, done: { ...s.done }, reg: { ...s.reg }, seen: { ...s.seen }, read: { ...s.read }, dueSeen: { ...s.dueSeen }, dueRead: { ...s.dueRead },
});

export function freshGame(now: number): GameState {
  const s: GameState = {
    cur: START, focal: START, steps: 0, done: {}, reg: {}, lifted: false, trails: false, hint: true, complete: false,
    seen: {}, read: {}, dueSeen: {}, dueRead: {},
  };
  stepOn(s, START, now + 350);
  setRead(s, START, now + 700);
  return s;
}

export function arrive(prev: GameState, id: string, now: number): GameState {
  const s = draft(prev);
  s.cur = id; s.steps++; s.hint = false;
  stepOn(s, id, now);
  if (W.byId[id].kind === 'open') setRead(s, id, now + 200); /* open ground has nothing to read: visiting notes it */
  return s;
}

export function markRead(prev: GameState, id: string, now: number): { state: GameState; toasts: ToastEvent[] } {
  const s = draft(prev);
  setRead(s, id, now);
  return checkProgress(s);
}

export function markUnread(prev: GameState, id: string, now: number): GameState {
  const s = draft(prev);
  delete s.read[id];
  s.dueRead[id] = now;
  return s;
}

export function liftFog(prev: GameState, now: number): GameState {
  if (prev.lifted) return prev;
  const s = draft(prev), view = getMapView(s.focal), c = view.at[W.byId[s.cur].ti];
  for (const t of W.tiles) reveal(s, t.id, now + hexDist(view.at[t.ti], c) * 85);
  s.lifted = true;
  return s;
}

/* one index, many maps: move another paper to the centre and lay the island out again */
export function refocus(prev: GameState, id: string, now: number): GameState {
  const t = W.byId[id];
  if (!t || t.kind !== 'paper' || id === prev.focal) return prev;
  const s = draft(prev);
  s.focal = id;
  stepOn(s, s.cur, now + 500);
  return s;
}

export const toggleTrails = (s: GameState): GameState => ({ ...s, trails: !s.trails });
export const dismissHint = (s: GameState): GameState => ({ ...s, hint: false });

function checkProgress(s: GameState): { state: GameState; toasts: ToastEvent[] } {
  const toasts: ToastEvent[] = [];
  for (const ex of W.expeditions) {
    if (!s.done[ex.id] && ex.steps.every(id => s.read[id])) {
      s.done[ex.id] = 1;
      toasts.push({ title: 'Expedition complete', text: ex.name + '. Its insight is now under Expeditions.', mode: 'exp' });
    }
  }
  for (const th of W.themes) {
    if (!s.reg[th.j] && th.members.every(i => s.read[W.papers[i].id])) {
      s.reg[th.j] = 1;
      toasts.push({ title: 'Theme fully read', text: th.name + ': every tile painted.', mode: 'log' });
    }
  }
  if (!s.complete && W.papers.every(t => s.read[t.id])) {
    s.complete = true;
    toasts.push({ title: 'Survey complete', text: 'All ' + W.papers.length + ' papers read. Time to write the section.', mode: 'log' });
  }
  return { state: s, toasts };
}

/* ───────────── persistence ───────────── */
const SAVE_KEY = 'hextile.related-work.dinov3.v1';

interface Saved {
  cur: string; focal: string; steps: number; done: Record<string, 1>; reg: Record<number, 1>;
  lifted: boolean; trails: boolean; hint: boolean; complete: boolean;
  read: string[]; seen: string[];
}

export function save(s: GameState) {
  try {
    const o: Saved = {
      cur: s.cur, focal: s.focal, steps: s.steps, done: s.done, reg: s.reg, lifted: s.lifted, trails: s.trails, hint: s.hint, complete: s.complete,
      read: Object.keys(s.read), seen: Object.keys(s.seen).filter(id => !s.read[id]),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(o));
  } catch { /* storage may be unavailable */ }
}

export function load(): GameState | null {
  try {
    const o = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as Saved | null;
    if (!o || !Array.isArray(o.read) || !Array.isArray(o.seen) || !W.byId[o.cur] || W.byId[o.focal]?.kind !== 'paper') return null;
    const s: GameState = {
      cur: o.cur, focal: o.focal, steps: o.steps | 0, done: o.done || {}, reg: o.reg || {},
      lifted: !!o.lifted, trails: !!o.trails, hint: !!o.hint, complete: !!o.complete,
      seen: {}, read: {}, dueSeen: {}, dueRead: {},
    };
    for (const id of o.seen) if (W.byId[id]) s.seen[id] = true;
    for (const id of o.read) if (W.byId[id]) { s.seen[id] = true; s.read[id] = true; }
    return s;
  } catch {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
