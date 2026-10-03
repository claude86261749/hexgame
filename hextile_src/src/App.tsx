import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapController } from './canvas/MapController';
import type { Lens } from './canvas/types';
import { GameContext, type GameApi } from './components/context';
import { Hud, Legend } from './components/Hud';
import { MapCanvas } from './components/MapCanvas';
import { Hint, LensBar, Toasts, Tooltip, setHover, type Toast } from './components/Overlays';
import { Sheet } from './components/Sheet';
import { Toolbar } from './components/Toolbar';
import * as G from './game/state';
import type { GameState, SheetMode, ToastEvent } from './game/state';
import { getMapView } from './world/mapView';
import { WORLD } from './world/world';

/** Q W E A S D: indices into DIRS, the six flat-top neighbours. */
const KEYDIR: Record<string, number> = { w: 2, e: 1, d: 0, s: 5, a: 4, q: 3 };

export function App() {
  const [game, setGame] = useState<GameState>(() => G.load() ?? G.freshGame(performance.now()));
  const [epoch, setEpoch] = useState(0);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [pop, setPop] = useState(0);
  const [lens, setLens] = useState<Lens | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ctl = useRef<MapController | null>(null);
  const view = getMapView(game.focal);

  /* actions can come from the canvas's frame loop, so they work on a ref of the latest state */
  const gameRef = useRef(game);
  const apply = useCallback((f: (s: GameState) => GameState) => {
    const next = f(gameRef.current);
    if (next === gameRef.current) return;
    gameRef.current = next;
    setGame(next);
  }, []);
  useEffect(() => { G.save(game); }, [game]);

  const toastId = useRef(0);
  const pushToasts = useCallback((evs: ToastEvent[]) => {
    if (evs.length) setToasts(ts => [...ts, ...evs.map(e => ({ ...e, id: ++toastId.current }))].slice(-3));
  }, []);
  const expireToast = useCallback((id: number) => setToasts(ts => ts.filter(t => t.id !== id)), []);

  const openSheet = useCallback((m: SheetMode) => { setSheet(m); setPop(p => p + 1); }, []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const api: GameApi = useMemo(() => ({
    game, view, lens,
    travel: id => ctl.current?.travel(id),
    markRead: id => {
      const { state, toasts } = G.markRead(gameRef.current, id, performance.now());
      apply(() => state);
      pushToasts(toasts);
    },
    markUnread: id => apply(s => G.markUnread(s, id, performance.now())),
    refocus: id => { if (!ctl.current?.busy) apply(s => G.refocus(s, id, performance.now())); },
    toggleLens: l => setLens(cur => (cur && cur.type === l.type && JSON.stringify(cur) === JSON.stringify(l) ? null : l)),
    openSheet,
  }), [game, view, lens, apply, pushToasts, openSheet]);

  const events = {
    arrive: (id: string) => { apply(s => G.arrive(s, id, performance.now())); openSheet('paper'); },
    openCurrent: () => openSheet('paper'),
    hover: setHover,
  };

  const reset = () => {
    G.clearSave();
    const fresh = G.freshGame(performance.now());
    gameRef.current = fresh;
    setGame(fresh);
    setLens(null);
    setToasts([]);
    setSheet(null);
    setEpoch(e => e + 1);
  };

  /* keys anywhere on the page: walk, read, close */
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const k = e.key.toLowerCase(), cur = WORLD.byId[game.cur];
    if (k === 'escape') { if (sheet) { closeSheet(); e.preventDefault(); } return; }
    if (k in KEYDIR) {
      const n = view.at[cur.ti].nb[KEYDIR[k]];
      if (n && game.seen[n.id]) { ctl.current?.travel(n.id); e.preventDefault(); }
      return;
    }
    if (k === 'r' && cur.kind === 'paper' && !game.read[cur.id] && !ctl.current?.busy) { api.markRead(cur.id); e.preventDefault(); }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => onKey.current(e);
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, []);

  return (
    <GameContext.Provider value={api}>
      <main className={'map' + (sheet ? ' has-sheet' : '')}>
        <MapCanvas game={game} view={view} lens={lens} epoch={epoch} events={events} controller={ctl} />
        <Hud />
        <Toolbar
          sheet={sheet}
          toggleSheet={m => (sheet === m ? closeSheet() : openSheet(m))}
          recenter={() => ctl.current?.recenter()}
          toggleTrails={() => apply(G.toggleTrails)}
          liftFog={() => apply(s => G.liftFog(s, performance.now()))}
          reset={reset}
        />
        <Legend />
        {game.hint && !lens && <Hint onDismiss={() => apply(G.dismissHint)} />}
        <LensBar onClear={() => setLens(null)} />
        <Tooltip />
        <Toasts toasts={toasts} onOpen={t => { openSheet(t.mode); expireToast(t.id); }} onExpire={expireToast} />
        <Sheet mode={sheet} pop={pop} onClose={closeSheet} />
      </main>
    </GameContext.Provider>
  );
}
