import { EXPEDITIONS } from '../data/expeditions';
import { GRAD_DEFS, THEME_DEFS } from '../data/naming';
import { OPEN } from '../data/openQuestions';
import { PAPERS } from '../data/papers';
import { INTENTS, type Expedition, type Intent, type OpenQuestion, type Paper, type Pole, type Terrain, type ThemeDef, type GradDef } from '../data/types';
import { CFG, buildIndex, findThemes, hashStr, type CorpusIndex, type Themes } from '../engine';

/* ───────────── world: built by the engine from the exports ───────────── */

export interface Theme {
  j: number;
  name: string;
  terrain: Terrain;
  note: string;
  members: number[];
}

interface TileCommon {
  /** Index into WORLD.tiles. */
  ti: number;
  seed: number;
  /** Elevation tier before the map puts a summit at the centre. */
  baseTier: number;
}
export interface PaperTile extends Paper, TileCommon {
  kind: 'paper';
  /** Index into the corpus. */
  i: number;
  theme: Theme;
  /** Elevation 1..5. */
  e: number;
  tooNew: boolean;
}
export interface OpenTile extends OpenQuestion, TileCommon {
  kind: 'open';
  /** Index into OPEN. */
  n: number;
  s: string;
}
export type Tile = PaperTile | OpenTile;

export interface Grad {
  k: number;
  coord: number[];
  share: number;
  lambda: number;
  /** Papers from the minus end to the plus end. */
  order: number[];
  rank: Int32Array;
  /** The nine papers at each end. */
  lo: number[];
  hi: number[];
  plus: Pole;
  minus: Pole;
  zmax: number;
}

export interface Citer { t: PaperTile; k: Intent }

export interface World {
  I: CorpusIndex;
  TH: Themes;
  themes: Theme[];
  grads: Grad[];
  tiles: Tile[];
  papers: PaperTile[];
  opens: OpenTile[];
  byId: Record<string, Tile>;
  citers: Record<string, Citer[]>;
  expeditions: Expedition[];
}

const SPARE: Terrain[] = ['meadow', 'marsh', 'coast', 'ice', 'outpost', 'crystal', 'works', 'terrace', 'quarry', 'mountain'];

export function buildWorld(papers: Paper[] = PAPERS, opens: OpenQuestion[] = OPEN, expeditions: Expedition[] = EXPEDITIONS): World {
  const I = buildIndex(papers);
  const TH = findThemes(I, 0, CFG.themes); /* themes belong to the corpus, not to one map */
  const idfSum = (list: number[]) => {
    const m: Record<string, number> = {};
    for (const i of list) for (const c of papers[i].c) m[c] = (m[c] || 0) + I.idf(c);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  const usedDefs = new Set<ThemeDef>();
  const themes: Theme[] = TH.members.map((ms, j) => {
    const def = THEME_DEFS.find(d => !usedDefs.has(d) && ms.includes(I.ix[d.anchor]));
    if (def) { usedDefs.add(def); return { j, name: def.name, terrain: def.terrain, note: def.note, members: ms }; }
    const top = idfSum(ms).slice(0, 2).map(x => x[0]);
    return { j, name: top.join(' and '), terrain: SPARE[j % SPARE.length], note: 'A cluster the naming stage has not named yet.', members: ms };
  });

  const tiles: Tile[] = [];
  const paperTiles: PaperTile[] = papers.map((p, i) => {
    const tooNew = I.tooNew[i], e = I.elev[i];
    const t: PaperTile = { ...p, kind: 'paper', i, ti: i, seed: hashStr(p.id), theme: themes[TH.lab[i]], e, tooNew, baseTier: tooNew ? Math.max(2, e) : e };
    tiles.push(t);
    return t;
  });
  const openTiles: OpenTile[] = opens.map((o, n) => {
    const t: OpenTile = { ...o, kind: 'open', n, ti: papers.length + n, seed: hashStr(o.id), s: 'open question', baseTier: 1 };
    tiles.push(t);
    return t;
  });
  const byId: Record<string, Tile> = {};
  for (const t of tiles) byId[t.id] = t;

  const citers: Record<string, Citer[]> = {};
  for (const t of paperTiles) for (const k of INTENTS) for (const id of t[k]) (citers[id] = citers[id] || []).push({ t, k });

  /* gradients: ranked directions through the corpus, each with two ends */
  const usedG = new Set<GradDef>();
  const autoPole = (list: number[]): Pole => {
    const top = idfSum(list).filter(x => list.filter(i => papers[i].c.includes(x[0])).length >= 2).slice(0, 2).map(x => x[0]);
    return { name: top.join(', ') || 'unnamed', gloss: 'not yet named by the naming stage' };
  };
  const grads: Grad[] = I.grads.slice(0, 4).map((g, n) => {
    const order = [...g.coord.keys()].sort((a, b) => g.coord[a] - g.coord[b]), lo = order.slice(0, 9), hi = order.slice(-9).reverse();
    const rank = new Int32Array(I.N);
    order.forEach((i, r) => (rank[i] = r));
    const def = GRAD_DEFS.find(d => !usedG.has(d) && (hi.includes(I.ix[d.anchor]) || lo.includes(I.ix[d.anchor])));
    let plus: Pole, minus: Pole;
    if (def) {
      usedG.add(def);
      if (hi.includes(I.ix[def.anchor])) { plus = def.at; minus = def.away; } else { plus = def.away; minus = def.at; }
    } else { plus = autoPole(hi); minus = autoPole(lo); }
    const zmax = Math.max(...g.coord.map(Math.abs));
    return { k: n + 1, coord: g.coord, share: g.share, lambda: g.lambda, order, rank, lo, hi, plus, minus, zmax };
  });

  return { I, TH, themes, grads, tiles, papers: paperTiles, opens: openTiles, byId, citers, expeditions };
}

/** The one world this app shows. Built once, at load. */
export const WORLD = buildWorld();
