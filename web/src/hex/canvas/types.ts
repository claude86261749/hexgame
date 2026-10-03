import type { Terrain } from '../data/types';
import type { RGB } from '../world/colour';
import type { Tile } from '../world/world';

/** A tile as the canvas sees it: where it is drawn now, and how far each transition has got. */
export interface Sprite {
  t: Tile;
  /** Drawn position (animates toward tx, ty when the map is rebuilt). */
  wx: number;
  wy: number;
  tx: number;
  ty: number;
  /** Drawn colour (animates toward col). */
  colNow: RGB;
  col: RGB;
  /** Drawn height, reveal amount 0..1, paint amount 0..1. */
  h: number;
  da: number;
  cm: number;
  /** Displayed states, which lag the game state by each change's due time. */
  dseen: boolean;
  dread: boolean;
  tier: number;
  terrain: Terrain;
  /** Unit-hex coordinates on the current map. */
  q: number;
  r: number;
}

export interface Palette {
  sea: RGB; fog: RGB; fogLine: RGB; rev: RGB; shade: RGB; ink: RGB; ink2: RGB; pill: RGB; accent: RGB; live: RGB;
  dark: boolean;
}

export interface Camera { x: number; y: number; z: number; tx: number | null; ty: number | null; tz: number | null }

/** A walk from one tile to another. */
export interface Move { from: Sprite; to: Sprite; t0: number; dur: number }

/** An overlay of ink marks: never colour, which stays reserved for "read". */
export type Lens = { type: 'grad'; k: number } | { type: 'concept'; name: string };
