import { useEffect, useRef, useState } from 'react';
import type { SheetMode } from '../game/state';
import { EXPLAINER } from '../data/corpus';
import { WORLD } from '../world/world';
import { useGame } from './context';

interface Props {
  sheet: SheetMode | null;
  toggleSheet(m: Exclude<SheetMode, 'paper'>): void;
  recenter(): void;
  toggleTrails(): void;
  liftFog(): void;
  reset(): void;
}

export function Toolbar({ sheet, toggleSheet, recenter, toggleTrails, liftFog, reset }: Props) {
  const { game } = useGame();
  const nread = WORLD.papers.filter(t => game.read[t.id]).length;
  const nexp = WORLD.expeditions.filter(ex => ex.steps.every(id => game.read[id])).length;
  const allSeen = WORLD.tiles.every(t => game.seen[t.id]);

  /* "Start over" asks once, then erases on a second click within a few seconds */
  const [armed, setArmed] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onReset = () => {
    clearTimeout(timer.current);
    if (!armed) { setArmed(true); timer.current = window.setTimeout(() => setArmed(false), 3500); return; }
    setArmed(false);
    reset();
  };

  const modeButton = (m: Exclude<SheetMode, 'paper'>, label: string, cnt?: string) => (
    <button type="button" aria-pressed={sheet === m} onClick={() => toggleSheet(m)}>
      {label}{cnt !== undefined && <> <span className="cnt">{cnt}</span></>}
    </button>
  );
  return (
    <div className="tools" role="toolbar" aria-label="Map controls">
      {/* the switch between the two views of the corpus, shared with the diagram explainer (same markup and class names) */}
      <nav className="suite" aria-label="Views">
        <a href="./" aria-current="page"><i className="suite-hx" />Map</a>
        <a href={EXPLAINER + '#/'}><i className="suite-dg" />Diagrams</a>
      </nav>
      <span className="gap" aria-hidden="true" />
      {modeButton('exp', 'Expeditions', `${nexp}/${WORLD.expeditions.length}`)}
      {modeButton('log', 'Log', `${nread}/${WORLD.papers.length}`)}
      {modeButton('grad', 'Gradients')}
      {modeButton('rep', 'Run report')}
      <span className="gap" aria-hidden="true" />
      <button type="button" onClick={recenter}>Recenter</button>
      <button type="button" aria-pressed={game.trails} onClick={toggleTrails}>{game.trails ? 'Showing all trails' : 'Show all trails'}</button>
      <button type="button" disabled={game.lifted || allSeen} onClick={liftFog}>{game.lifted ? 'Fog lifted' : 'Lift the fog'}</button>
      <button type="button" onClick={onReset}>{armed ? 'Erase progress?' : 'Start over'}</button>
    </div>
  );
}
