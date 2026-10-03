import { createContext, useContext } from 'react';
import type { Lens } from '../canvas/types';
import type { GameState, SheetMode } from '../game/state';
import type { MapView } from '../world/mapView';

export interface GameApi {
  game: GameState;
  view: MapView;
  lens: Lens | null;
  /** Walk to a tile (or open it, if you stand on it). */
  travel(id: string): void;
  markRead(id: string): void;
  markUnread(id: string): void;
  refocus(id: string): void;
  toggleLens(l: Lens): void;
  openSheet(mode: SheetMode): void;
}

export const GameContext = createContext<GameApi | null>(null);
export function useGame(): GameApi {
  const g = useContext(GameContext);
  if (!g) throw new Error('useGame outside GameContext');
  return g;
}
