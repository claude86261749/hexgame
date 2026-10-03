import { Chips } from '../components/bits';
import { useGame } from '../components/context';
import { WORLD } from '../world/world';

export function ExpeditionsBody() {
  const { game } = useGame();
  return (
    <>
      <p className="lead">Each expedition is a lineage to trace, in order. Read every paper on it and the notebook writes down what the lineage adds up to.</p>
      {WORLD.expeditions.map(ex => {
        const ts = ex.steps.map(id => WORLD.byId[id]), n = ts.filter(x => game.read[x.id]).length;
        return (
          <section className="exp" key={ex.id}>
            <h3>{ex.name}</h3>
            <p className="q">{ex.q}</p>
            <Chips tiles={ts} ordered />
            {n === ts.length ? <p className="insight">{ex.insight}</p> : <p className="prog">{n} of {ts.length} read</p>}
          </section>
        );
      })}
    </>
  );
}
