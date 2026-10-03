import { Chips, Hx } from '../components/bits';
import { useGame } from '../components/context';
import { byYear, plural } from '../game/text';
import { css } from '../world/colour';
import { WORLD } from '../world/world';

const noneStyle = { color: 'var(--ink-2)', fontSize: '13.5px', margin: 0 };

export function LogBody() {
  const { game, view } = useGame();
  const seen = WORLD.papers.filter(t => game.seen[t.id] && !game.read[t.id]).sort(byYear);
  const nread = WORLD.papers.filter(t => game.read[t.id]).length;
  const openSeen = WORLD.opens.filter(t => game.seen[t.id]);
  return (
    <>
      <div className="dir">
        <h3>Revealed, not read</h3>
        <p className="gloss">{plural(seen.length, 'grey tile')} waiting</p>
        {seen.length
          ? <Chips tiles={seen} />
          : <p className="none" style={noneStyle}>{nread === WORLD.papers.length ? 'Nothing left to read.' : 'Nothing in view. Walk to the edge of the fog.'}</p>}
      </div>
      {WORLD.themes.map(th => {
        const all = th.members.map(i => WORLD.papers[i]), rd = all.filter(t => game.read[t.id]).sort(byYear);
        return (
          <div className="grp" key={th.j}>
            <h4><Hx c={css(view.themeRgb[th.j])} />{th.name} <span className="n">{rd.length} of {all.length}</span></h4>
            <p className="note">{th.note}</p>
            {rd.length ? <Chips tiles={rd} /> : <p className="none">Nothing read here yet.</p>}
          </div>
        );
      })}
      <div className="dir" style={{ marginTop: 22 }}>
        <h3>Open ground</h3>
        <p className="gloss">plots on the coast where no paper stands yet</p>
        {openSeen.length ? <Chips tiles={openSeen} /> : <p className="none" style={noneStyle}>None revealed yet.</p>}
      </div>
      <p className="keys">
        <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> walk to the six neighbouring tiles. <kbd>R</kbd> marks the paper you stand on as read.{' '}
        <kbd>Esc</kbd> closes the popup. With the map focused, the arrow keys pan and <kbd>+</kbd> <kbd>-</kbd> zoom.
      </p>
    </>
  );
}
