import { INTENTS, type Intent } from '../data/types';
import { angDiff } from '../world/geometry';
import type { MapView } from '../world/mapView';
import { WORLD, type PaperTile, type Tile } from '../world/world';

export const INTENT: Record<Intent, string> = { builds: 'builds on', uses: 'uses', compares: 'compares against' };
export const ELEV = ['', 'Little is built on it inside this corpus.', 'Some work builds on it.', 'Well built upon.', 'A lot rests on it.', 'Bedrock for the field.'];

export const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');
export const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const pct = (x: number) => Math.round(x * 100) + '%';
export const byYear = (a: PaperTile, b: PaperTile) => a.y - b.y || a.s.localeCompare(b.s);
export const paperById = (id: string) => WORLD.byId[id] as PaperTile;

/** Where a tile lies on the map, in words. */
export function bearingLine(view: MapView, t: Tile): string {
  const { focal, markers } = view, p = view.at[t.ti];
  if (t === focal) return 'The centre of this map.';
  if (p.rad < 1.35) return `Next to the centre: among the papers closest to ${focal.s}.`;
  const near = markers.slice().sort((a, b) => angDiff(a.ang, p.ang) - angDiff(b.ang, p.ang));
  if (!near.length) return 'Away from the centre.';
  if (angDiff(near[0].ang, p.ang) <= 42 || near.length < 2) return `Toward ${lc(near[0].name)}: ${near[0].gloss}.`;
  return `Between ${lc(near[0].name)} and ${lc(near[1].name)}.`;
}

/** The paper's theme, and the one it shades into, if any. */
export function themeLine(t: PaperTile): string {
  const soft = WORLD.TH.soft[t.i];
  let b = -1;
  soft.forEach((v, j) => { if (j !== t.theme.j && (b < 0 || v > soft[b])) b = j; });
  return t.theme.name + (b >= 0 && soft[b] >= 0.2 ? `, shading into ${WORLD.themes[b].name}` : '');
}

/** Concepts two papers share, rarest first. */
export const shared = (a: PaperTile, b: PaperTile) => a.c.filter(c => b.c.includes(c)).sort((x, y) => WORLD.I.idf(y) - WORLD.I.idf(x));

/** How a relates to b by citation, in a's voice. */
export function citeWords(a: PaperTile, b: PaperTile): string {
  for (const k of INTENTS) if (a[k].includes(b.id)) return INTENT[k] + ' it';
  for (const k of INTENTS) if (b[k].includes(a.id)) return k === 'builds' ? 'is built on by it' : k === 'uses' ? 'is used by it' : 'is a comparison point for it';
  return '';
}

/* without the narrative stage, the relation to the centre is shown as the evidence it would start from */
export function evidence(t: PaperTile, focal: PaperTile): string {
  const sh = shared(t, focal), cw = citeWords(t, focal);
  const a = sh.length
    ? `Shares ${plural(sh.length, 'concept')} with ${focal.s}: ${sh.slice(0, 4).join(', ')}${sh.length > 4 ? ' and others' : ''}.`
    : `Shares no extracted concept with ${focal.s}.`;
  return a + (cw ? ` It ${cw}.` : ' Neither cites the other in this corpus.');
}

export interface Closest { o: PaperTile; affinity: number; width: number; sh: string[]; cw: string }
/** The five papers with the highest affinity. */
export function closest(t: PaperTile): Closest[] {
  const top = WORLD.I.nbr[t.i].slice(0, 5), row = WORLD.I.Araw[t.i], max = row[top[0]] || 1;
  return top.map(j => {
    const o = WORLD.papers[j];
    return { o, affinity: row[j], width: Math.round(100 * row[j] / max), sh: shared(t, o), cw: citeWords(t, o) };
  });
}
