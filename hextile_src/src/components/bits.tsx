import type { CSSProperties, ReactNode } from 'react';
import { css } from '../world/colour';
import type { Tile } from '../world/world';
import { useGame } from './context';

/** A small hexagon swatch. */
export function Hx({ c, variant }: { c?: string; variant?: 'dash' | 'any' }) {
  return <i className={'hx' + (variant ? ' ' + variant : '')} style={c ? ({ '--c': c } as CSSProperties) : undefined} aria-hidden="true" />;
}

export const ArrowIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
    <path d="M3 12L12 3M5.5 3H12v6.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
/** The line style a trail is drawn with on the map. */
export const DashIcon = ({ dash, w, by }: { dash: string; w: number; by?: boolean }) => (
  <svg className={by ? 'by' : undefined} viewBox="0 0 28 6" width="28" height="6" aria-hidden="true">
    <line x1="1" y1="3" x2="27" y2="3" stroke="currentColor" strokeWidth={w} strokeDasharray={dash} strokeLinecap="round" />
  </svg>
);

/** Swatch colour of a tile: its map colour once read, plaster grey before. */
export function useSwatch() {
  const { game, view } = useGame();
  return (t: Tile) => (game.read[t.id] ? (t.kind === 'open' ? 'var(--accent)' : css(view.at[t.ti].col)) : 'var(--rev)');
}

/** A tile you can walk to, or a dashed placeholder while it is uncharted. */
export function Chip({ x }: { x: Tile }) {
  const { game, view, travel } = useGame();
  const swatch = useSwatch();
  if (!game.seen[x.id]) {
    const th = view.themeOf[x.ti];
    return <span className="chip is-fog"><Hx variant="dash" />uncharted, in {th.name}</span>;
  }
  const here = x.id === game.cur, read = !!game.read[x.id];
  const cls = here ? ' is-here' : !read ? ' unread' : '';
  return (
    <button type="button" className={'chip' + cls} onClick={() => travel(x.id)} title={here ? 'You are here' : read ? 'Read' : 'Revealed, not read'}>
      <Hx c={swatch(x)} />
      {x.kind === 'open' ? x.t : <>{x.s} <span className="yr">{x.y}</span></>}
    </button>
  );
}

export function Chips({ tiles, ordered }: { tiles: Tile[]; ordered?: boolean }) {
  const items = tiles.map(x => <li key={x.id}><Chip x={x} /></li>);
  return ordered ? <ol className="chips">{items}</ol> : <ul className="chips">{items}</ul>;
}

/** "and 3 more still uncharted" under a list that shows only revealed tiles. */
export function More({ shown, hidden, tail = 'still uncharted' }: { shown: number; hidden: number; tail?: string }): ReactNode {
  if (!hidden) return null;
  return <span className="more">{shown ? 'and ' : ''}{hidden} {shown ? 'more ' : ''}{tail}</span>;
}
