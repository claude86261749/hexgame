/** One paper, as the extraction pipeline would export it. */
export interface Paper {
  id: string;
  /** Short label drawn on the tile. */
  s: string;
  /** Full title. */
  t: string;
  /** Authors. */
  a: string;
  /** Year. */
  y: number;
  /** Venue. */
  v: string;
  idea: string;
  /** How the paper relates to the paper at the centre of the map. */
  link: string;
  /** Submission date, for papers in the corpus. */
  date?: string;
  /** arXiv id, for papers in the corpus. They open in the diagram explainer. */
  arxiv?: string;
  /** A foundation: not in the corpus, but cited by many papers that are. */
  ext?: boolean;
  /** For a foundation, the number of corpus papers that cite it. */
  cited?: number;
  /** Concepts, from the paper-to-concept table. */
  c: string[];
  /** Classified citations inside the corpus. */
  builds: string[];
  uses: string[];
  compares: string[];
}

export interface OpenQuestion {
  id: string;
  t: string;
  text: string;
  c: string[];
}

export interface Expedition {
  id: string;
  name: string;
  q: string;
  steps: string[];
  insight: string;
}

export type Intent = 'builds' | 'uses' | 'compares';
export const INTENTS: Intent[] = ['builds', 'uses', 'compares'];

export type Terrain =
  | 'outpost' | 'meadow' | 'works' | 'ice' | 'terrace'
  | 'marsh' | 'coast' | 'mountain' | 'crystal' | 'quarry';

export interface ThemeDef { anchor: string; name: string; terrain: Terrain; note: string }
export interface Pole { name: string; gloss: string }
export interface GradDef { anchor: string; at: Pole; away: Pole }

export interface CorpusMeta {
  /** Name of the map, written after the computation. */
  title: string;
  intro: string;
  /** Where the corpus came from, e.g. "cs.IR, September 2026". */
  name: string;
  source: string;
  /** The paper the map starts centred on. */
  centre: string;
  built: string;
  papers: number;
  foundations: number;
  /** A reference becomes a foundation when this many corpus papers cite it. */
  minShared: number;
}

/** The pipeline export the map is built from (scripts/hexcorpus.ts in the parent project). */
export interface Corpus {
  meta: CorpusMeta;
  papers: Paper[];
  themes: ThemeDef[];
  grads: GradDef[];
  expeditions: Expedition[];
  open: OpenQuestion[];
}
