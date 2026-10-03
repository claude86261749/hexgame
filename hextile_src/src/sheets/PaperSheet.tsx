import type { CSSProperties } from 'react';
import { ArrowIcon, Chip, Chips, DashIcon, Hx, More } from '../components/bits';
import { useGame } from '../components/context';
import { META, explainerUrl } from '../data/corpus';
import { START } from '../game/state';
import { ELEV, bearingLine, byYear, closest, evidence, paperById, plural, themeLine } from '../game/text';
import { css, lum } from '../world/colour';
import { WORLD, type OpenTile, type PaperTile } from '../world/world';

export function OpenBody({ t }: { t: OpenTile }) {
  const { view } = useGame();
  const near = view.at[t.ti].nb.filter((n): n is PaperTile => !!n && n.kind === 'paper').sort(byYear);
  return (
    <>
      <article className="paper">
        <header className="paper-head"><h2>{t.t}</h2><p className="venue">No paper stands here yet.</p></header>
        <ul className="where">
          <li><span className="ico"><Hx c={css(view.themeRgb[view.themeOf[t.ti].j])} /></span><span>On the edge of {view.themeOf[t.ti].name}</span></li>
          <li><span className="ico"><ArrowIcon /></span><span>{bearingLine(view, t)}</span></li>
        </ul>
        <p className="body">{t.text}</p>
        <div className="rel"><h3>Nearest papers</h3><Chips tiles={near} /></div>
      </article>
      <p className="fine">Open ground is placed on the coast next to the papers whose concepts match it best. The questions themselves are one surveyor's opinion.</p>
    </>
  );
}

function Strata({ t }: { t: PaperTile }) {
  return <span className="strata" aria-hidden="true">{[1, 2, 3, 4, 5].map(i => <i key={i} className={!t.tooNew && i <= t.e ? 'on' : ''} />)}</span>;
}

function Concepts({ t }: { t: PaperTile }) {
  const { view, lens, toggleLens } = useGame();
  const focal = view.focal, fset = new Set(focal.c), I = WORLD.I;
  return (
    <div className="rel">
      <h3>Concepts</h3>
      <p className="src">From the paper-to-concept table, rarest first, with the number of papers that mention each.{t !== focal && ` Outlined ones are shared with ${focal.s}.`}</p>
      <ul className="chips">
        {t.c.slice().sort((a, b) => I.idf(b) - I.idf(a)).map(c => {
          const on = lens?.type === 'concept' && lens.name === c;
          return (
            <li key={c}>
              <button type="button" className={'chip concept' + (t !== focal && fset.has(c) ? ' shared' : '') + (on ? ' on' : '')}
                onClick={() => toggleLens({ type: 'concept', name: c })} title="Mark the revealed papers that mention it">
                {c} <span className="df">{I.df[c]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Closest({ t }: { t: PaperTile }) {
  const { game } = useGame();
  return (
    <div className="rel">
      <h3>Closest papers</h3>
      <p className="src">From the affinity graph: shared concepts weighted by rarity, plus citations.</p>
      <ul className="near">
        {closest(t).map(({ o, affinity, width, sh, cw }) => {
          const why = game.seen[o.id]
            ? [sh.length ? `${plural(sh.length, 'shared concept')}, rarest: ${sh[0]}` : 'no shared concept', cw ? `${t.s} ${cw}` : ''].filter(Boolean).join('; ')
            : 'Walk there, or read a paper that builds on it, to see why.';
          return (
            <li key={o.id}>
              <Chip x={o} />
              <span className="meter" title={`Affinity ${affinity.toFixed(2)}`}><i style={{ width: width + '%' }} /></span>
              <span className="why">{why}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Trails({ t }: { t: PaperTile }) {
  const { game } = useGame();
  const list = (ids: string[]) => ids.map(paperById).sort(byYear);
  const cit = (WORLD.citers[t.id] || []).filter(x => x.k !== 'compares').map(x => x.t).sort(byYear), citSeen = cit.filter(x => game.seen[x.id]);
  const cmp = list(t.compares), cmpSeen = cmp.filter(x => game.seen[x.id]);
  const nOut = t.builds.length + t.uses.length;
  if (!game.read[t.id]) {
    return (
      <p className="locked">
        Its trails are hidden until you mark it as read: {nOut ? `${plural(nOut, 'paper')} it builds on or uses` : 'nothing it builds on here'}
        {cit.length ? `, ${cit.length} that build${cit.length > 1 ? '' : 's'} on it` : ''}.
      </p>
    );
  }
  return (
    <>
      <div className="rel">
        <h3><DashIcon dash="6 4.5" w={1.8} />Builds on</h3>
        {t.builds.length ? <Chips tiles={list(t.builds)} /> : <p className="none">Nothing else on this map. The trail starts here.</p>}
      </div>
      {t.uses.length > 0 && <div className="rel"><h3><DashIcon dash="3 5" w={1.4} />Uses as a component</h3><Chips tiles={list(t.uses)} /></div>}
      {cmp.length > 0 && (
        <div className="rel">
          <h3>Compares against</h3>
          {cmpSeen.length > 0 && <Chips tiles={cmpSeen} />}
          <More shown={cmpSeen.length} hidden={cmp.length - cmpSeen.length} />
        </div>
      )}
      <div className="rel">
        <h3><DashIcon dash="0.1 5" w={2} by />Built on by</h3>
        {cit.length
          ? <>{citSeen.length > 0 && <Chips tiles={citSeen} />}<More shown={citSeen.length} hidden={cit.length - citSeen.length} /></>
          : <p className="none">Nothing on this map yet.</p>}
      </div>
    </>
  );
}

export function PaperBody({ t }: { t: PaperTile }) {
  const { game, view, refocus } = useGame();
  const focal = view.focal;
  const venue = t.ext ? `${t.v} ${t.y} · cited by ${plural(t.cited || 0, 'paper')} on this map` : t.arxiv ? `arXiv ${t.arxiv}${t.date ? ` · ${t.date}` : ''}` : /\d/.test(t.v) ? t.v : t.v + ' ' + t.y;
  const elev = t.tooNew ? 'Too new to tell: elevation counts who builds on a paper, and nothing here has had time to.' : `Elevation ${t.e} of 5. ${ELEV[t.e]}`;
  return (
    <>
      {game.steps === 0 && t.id === START && (
        <div className="preface">
          <p>{META.intro} The map starts at {t.s}, the paper with the most in common with the rest, and its tile is the only one in colour.</p>
          <p>Walking onto a tile shows the landscape around it in grey. A tile is painted only when you mark its paper as read, and reading is also what brings in the papers it builds on.</p>
        </div>
      )}
      <article className="paper">
        <header className="paper-head">
          <h2>{t.t}</h2>
          <p className="authors">{t.a}</p>
          <p className="venue">{venue}</p>
        </header>
        <ul className="where">
          <li><span className="ico"><Hx c={css(view.at[t.ti].col)} /></span><span>{themeLine(t)}</span></li>
          <li><span className="ico"><ArrowIcon /></span><span>{bearingLine(view, t)}</span></li>
          <li><span className="ico"><Strata t={t} /></span><span>{elev}</span></li>
        </ul>
        <p className="body"><b>The idea.</b> {t.idea}</p>
        {focal.id === START && t.link
          ? <p className="body"><b>{t.ext ? 'Why it is on this map' : `Relation to ${focal.s}`}.</b> {t.link}</p>
          : t === focal
            ? <p className="body"><b>Why it is at the centre.</b> You rebuilt the map around it. Every other paper is now placed by how far it is from this one.</p>
            : <p className="body"><b>Relation to {focal.s}.</b> {evidence(t, focal)}</p>}
        <Concepts t={t} />
        <Closest t={t} />
        <Trails t={t} />
        {t === focal
          ? <div className="refocus">This paper is the centre of the current map. Open any other paper to rebuild the map around it.</div>
          : (
            <div className="refocus">
              <button type="button" onClick={() => refocus(t.id)}>Rebuild the map around this paper</button>
              Same index, different map: distances and layout are recomputed from {t.s}. Themes, gradients and what you have read stay as they are.
            </div>
          )}
        {t.arxiv
          ? <p className="out explain"><a className="go" href={explainerUrl(t.arxiv)}>Explain it in diagrams</a>
              <a href={`https://arxiv.org/abs/${t.arxiv}`} target="_blank" rel="noopener">arXiv {t.arxiv}</a></p>
          : <p className="out"><a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(t.t)}`} target="_blank" rel="noopener">Find this paper on Google Scholar</a></p>}
      </article>
      <p className="fine">{t.ext
        ? `A foundation: not in the corpus, but cited by at least ${META.minShared} of its papers. Title, venue and summary are written by a model from the citation strings and citing sentences.`
        : 'The summary, concepts and citation classes are extracted by a model from the paper\'s text.'} Positions, colours, themes, elevations and closest papers are computed from them in your browser. Check the paper before you cite it.</p>
    </>
  );
}

export function PaperFoot({ t }: { t: PaperTile }) {
  const { game, view, markRead, markUnread } = useGame();
  const col = view.at[t.ti].col;
  if (game.read[t.id]) {
    return (
      <>
        <span className="done"><Hx c={css(col)} />You have read this.</span>
        <button type="button" className="quiet" onClick={() => markUnread(t.id)}>Mark unread</button>
      </>
    );
  }
  return (
    <>
      <button type="button" className="primary" onClick={() => markRead(t.id)}
        style={{ '--c': css(col), '--t': lum(col) > 0.34 ? '#15233B' : '#fff' } as CSSProperties}>Mark as read</button>
      <span>Paints the tile and reveals what it builds on.</span>
    </>
  );
}
