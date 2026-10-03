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
  /** Why the paper is on the DINOv3 map. */
  link: string;
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
