import { Chips, More } from '../components/bits';
import { useGame } from '../components/context';
import { lc, pct } from '../game/text';
import type { Pole } from '../data/types';
import { WORLD } from '../world/world';

function End({ list, pole, filled }: { list: number[]; pole: Pole; filled: boolean }) {
  const { game } = useGame();
  const ts = list.slice(0, 7).map(i => WORLD.papers[i]), sn = ts.filter(x => game.seen[x.id]);
  return (
    <div className="pole">
      <h4><span className={'dot' + (filled ? ' f' : '')} />{pole.name}</h4>
      <p className="gl">{pole.gloss}</p>
      {sn.length > 0 && <Chips tiles={sn} />}
      <More shown={sn.length} hidden={ts.length - sn.length} tail="of its seven end papers still uncharted" />
    </div>
  );
}

export function GradientsBody() {
  const { game, lens, toggleLens } = useGame();
  const cur = WORLD.byId[game.cur], n = WORLD.I.N, first = WORLD.grads[0].share;
  return (
    <>
      <p className="lead">A gradient is a direction along which the papers change. These come from a diffusion map on the paper graph and are ranked by how much of its structure each one carries. The sea markers on the map are the ends of the first three.</p>
      {WORLD.grads.map(G => {
        const on = lens?.type === 'grad' && lens.k === G.k;
        let here = null;
        if (cur.kind === 'paper') {
          const r = G.rank[cur.i], side = r >= n * 0.66 || r < n * 0.34;
          here = <p className="here">{cur.s} is number {n - r} of {n} counting from the {lc(G.plus.name)} end{side ? '' : ', near the middle'}.</p>;
        }
        return (
          <section className="grad" key={G.k}>
            <h3>Gradient {G.k}<span className="share">{pct(G.share)} of the structure kept</span></h3>
            <div className="sharebar"><i style={{ width: pct(G.share / first * 0.999) }} /></div>
            <End list={G.hi} pole={G.plus} filled />
            <End list={G.lo} pole={G.minus} filled={false} />
            {here}
            <button type="button" className="show" aria-pressed={on} onClick={() => toggleLens({ type: 'grad', k: G.k })}>
              {on ? 'Hide from the map' : 'Mark every revealed paper on the map'}
            </button>
          </section>
        );
      })}
      <p className="fine" style={{ marginTop: 0 }}>The shares are close to one another, so no two gradients dominate. In this corpus the leading ones mostly separate tight groups from everything else, which is common for a small, clustered graph. Names of the ends were written by a model after looking at the papers there.</p>
    </>
  );
}
