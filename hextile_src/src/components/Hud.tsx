import { META } from '../data/corpus';
import { WORLD } from '../world/world';
import { css } from '../world/colour';
import { Hx } from './bits';
import { useGame } from './context';

function Stats() {
  const { game } = useGame();
  const r = WORLD.papers.filter(t => game.read[t.id]).length, s = WORLD.papers.filter(t => game.seen[t.id] && !game.read[t.id]).length;
  const o = WORLD.opens.filter(t => game.read[t.id]).length;
  return <><b>{r}</b> of {WORLD.papers.length} read, <b>{s}</b> revealed, <b>{o}</b> of {WORLD.opens.length} open questions</>;
}

export function Hud() {
  const { view } = useGame();
  return (
    <header className="hud glass">
      <h1>{META.title}</h1>
      <p className="sub">{META.papers} {META.name || 'papers'} on arXiv and the {META.foundations} works they share, around {view.focal.s}</p>
      <p className="stats" aria-live="polite"><Stats /></p>
    </header>
  );
}

/* legend: the three tile states, then the themes and how much of each is read */
export function Legend() {
  const { game, view } = useGame();
  return (
    <div className="legend glass" aria-label="Legend">
      <p className="stats"><Stats /></p>
      <ul className="states">
        <li><Hx variant="dash" />Uncharted</li>
        <li><Hx c="var(--rev)" />Revealed</li>
        <li><Hx variant="any" />Read</li>
      </ul>
      <ul className="themes">
        {WORLD.themes.map(th => (
          <li key={th.j}>
            <Hx c={css(view.themeRgb[th.j])} />{th.name}
            <span className="n"><b>{th.members.filter(i => game.read[WORLD.papers[i].id]).length}</b>/{th.members.length}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
