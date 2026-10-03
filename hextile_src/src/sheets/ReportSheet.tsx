import type { ReactNode } from 'react';
import { useGame } from '../components/context';
import { pct } from '../game/text';
import { CFG } from '../engine';
import { WORLD } from '../world/world';

const Row = ({ a, s, b }: { a: string; s?: string; b: ReactNode }) => (
  <tr><td>{a}{s && <small>{s}</small>}</td><td>{b}</td></tr>
);

export function ReportBody() {
  const { view } = useGame();
  const { I, papers, themes } = WORLD;
  const nC = Object.keys(I.df).length, nM = papers.reduce((s, p) => s + p.c.length, 0);
  const cnt = (k: 'builds' | 'uses' | 'compares') => papers.reduce((s, p) => s + p[k].length, 0);
  let edges = 0;
  for (let i = 0; i < I.N; i++) for (let j = i + 1; j < I.N; j++) if (I.W[i][j] > I.A[i][j] * CFG.glue * 1.5) edges++;
  return (
    <div className="rep">
      <h3>What went in</h3>
      <table><tbody>
        <Row a="Papers" s="manifest: title, authors, year, venue" b={I.N} />
        <Row a="Concepts" s="paper-to-concept table, after merging aliases" b={nC} />
        <Row a="Concept mentions" s={'about ' + (nM / I.N).toFixed(1) + ' per paper'} b={nM} />
        <Row a="Citations inside the corpus" s={`${cnt('builds')} builds on, ${cnt('uses')} uses, ${cnt('compares')} compares against`} b={cnt('builds') + cnt('uses') + cnt('compares')} />
      </tbody></table>
      <h3>What was computed here</h3>
      <table><tbody>
        <Row a="Affinity" s={`concept overlap weighted by rarity (${pct(CFG.wConcept)}) and citations (${pct(CFG.wCite)})`} b="pairwise" />
        <Row a="Neighbour graph" s={`each paper keeps its ${CFG.knn} closest`} b={edges + ' links'} />
        <Row a="Gradients kept" s={'diffusion map, time ' + CFG.diffT} b={I.grads.length} />
        <Row a="Themes" s={'k-means in gradient space, sizes ' + themes.map(t => t.members.length).join(', ')} b={themes.length} />
        <Row a="Papers too new for an elevation" s="from the last two years, with fewer than two papers here citing them" b={I.tooNew.filter(Boolean).length} />
      </tbody></table>
      <h3>Checks on this map</h3>
      <table><tbody>
        <Row a="Map centred on" s="distance from the centre is diffusion distance from this paper" b={view.focal.s} />
        <Row a="Neighbours kept" s="share of each paper's five closest papers that lie within two hexes; the bar to pass is 50%" b={pct(view.checks.neighbours)} />
        <Row a="Structure in the two leading gradients" s="a clean ring would put most of it there" b={pct(view.checks.ringShare)} />
      </tbody></table>
      <p style={{ marginTop: 10 }}>The second number is low. This corpus is not ring-shaped, so the island is a flattened picture of several gradients at once. Colour follows bearing from the centre, themes are clusters in the paper graph, and the two only roughly agree: a theme's tiles can be scattered.</p>
      <h3>What is real and what is not</h3>
      <ul>
        <li><b>Computed in your browser</b> from the tables above: affinity, gradients, themes, the hex layout, colours, elevations, closest papers, these checks.</li>
        <li><b>Hand-written stand-ins</b> for pipeline exports: the concept lists, the three citation classes, the summaries. No paper was parsed and no embedding model was run, so the embedding views of the affinity are missing.</li>
        <li><b>Written by a model after the computation</b>, as the naming stage would: theme names, names for gradient ends, the relation lines for the DINOv3 map, expedition texts.</li>
      </ul>
      <p className="out" style={{ marginTop: 14 }}><a href="https://claude.ai/artifact/Hf3LAp1hZhq7sL6hxZ4wTg" target="_blank" rel="noopener">Read the Method spec for the full pipeline</a></p>
    </div>
  );
}
