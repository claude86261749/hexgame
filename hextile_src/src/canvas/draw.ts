import { SQ3 } from '../engine';
import { WHEEL_HEX, WHITE, clamp, css, mix, rng, type RGB } from '../world/colour';
import { K, S, UNIT } from '../world/geometry';
import type { Marker } from '../world/mapView';
import { WORLD } from '../world/world';
import type { Camera, Lens, Move, Palette, Sprite } from './types';

export const SANS = '"IBM Plex Sans Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif';
export const SERIF = '"STIX Two Text","Times New Roman",Times,serif';

/** Everything one frame needs. */
export interface Scene {
  ctx: CanvasRenderingContext2D;
  PAL: Palette;
  W: number;
  H: number;
  DPR: number;
  cam: Camera;
  now: number;
  /** prefers-reduced-motion */
  RM: boolean;
  sprites: Sprite[];
  /** Sprites back to front. */
  order: Sprite[];
  sea: { wx: number; wy: number }[];
  markers: Marker[];
  focal: Sprite;
  cur: Sprite;
  hover: Sprite | null;
  move: Move | null;
  /** The island is being laid out again around a new centre. */
  moving: boolean;
  trails: boolean;
  lens: Lens | null;
}

const ANG = [0, 60, 120, 180, 240, 300].map(d => d * Math.PI / 180), COS = ANG.map(Math.cos), SIN = ANG.map(Math.sin);
type Pt = [number, number];
export function hexPts(cx: number, cy: number, h: number, s: number): Pt[] {
  const o: Pt[] = [];
  for (let i = 0; i < 6; i++) o.push([cx + s * COS[i], cy + s * SIN[i] * K - h]);
  return o;
}

/* ───────────── primitives ───────────── */
function path(ctx: CanvasRenderingContext2D, p: Pt[]) {
  ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.closePath();
}
function fillPoly(ctx: CanvasRenderingContext2D, p: Pt[], c: string) { path(ctx, p); ctx.fillStyle = c; ctx.fill(); }
function wall(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, h: number, c: string) { fillPoly(ctx, [a, b, [b[0], b[1] + h], [a[0], a[1] + h]], c); }
function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); }
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function seg(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, c: string, w: number) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.stroke();
}

/* ───────────── terrain furniture ─────────────
   drawn in tones of whatever colour the tile currently has:
   plaster grey while unread, the theme gradient once read */
type C = CanvasRenderingContext2D;
function peak(ctx: C, x: number, y: number, w: number, h: number, cL: string, cD: string, sL?: string, sD?: string) {
  const f = y + w * 0.17, ay = y - h;
  fillPoly(ctx, [[x - w / 2, y], [x, ay], [x, f]], cL); fillPoly(ctx, [[x, ay], [x + w / 2, y], [x, f]], cD);
  if (sL && sD) {
    const k = 0.37, ly = ay + (y - ay) * k, fy = ay + (f - ay) * k + 1.5;
    fillPoly(ctx, [[x - w / 2 * k, ly], [x, ay], [x, fy]], sL); fillPoly(ctx, [[x, ay], [x + w / 2 * k, ly], [x, fy]], sD);
  }
}
function tree(ctx: C, x: number, y: number, s: number, cD: string, cL: string, cT: string) {
  ctx.fillStyle = cT; ctx.fillRect(x - 0.9 * s, y - 4.5 * s, 1.8 * s, 4.5 * s);
  disc(ctx, x, y - 8.5 * s, 5.2 * s, cD); disc(ctx, x - 1.4 * s, y - 9.8 * s, 2.9 * s, cL);
}
function box(ctx: C, x: number, y: number, w: number, d: number, h: number, cTop: string, cFront: string, cSeam: string) {
  ctx.fillStyle = cFront; ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = cTop; ctx.fillRect(x - w / 2, y - h - d * K, w, d * K);
  ctx.fillStyle = cSeam; ctx.fillRect(x - w / 2, y - h * 0.5, w, 0.9); ctx.fillRect(x - w * 0.12, y - h, 0.9, h * 0.5); ctx.fillRect(x + w * 0.2, y - h * 0.5, 0.9, h * 0.5);
}
function house(ctx: C, x: number, y: number, w: number, h: number, cW: string, cR: string, cDoor: string) {
  ctx.fillStyle = cW; ctx.fillRect(x - w / 2, y - h, w, h);
  fillPoly(ctx, [[x - w / 2 - 1.6, y - h], [x, y - h - w * 0.5], [x + w / 2 + 1.6, y - h]], cR);
  ctx.fillStyle = cDoor; ctx.fillRect(x - 1.3, y - h * 0.6, 2.6, h * 0.6);
}
function crystal(ctx: C, x: number, y: number, w: number, h: number, cL: string, cD: string) {
  const sy = y - h * 0.6;
  fillPoly(ctx, [[x - w / 2, sy], [x, y - h], [x, y]], cL); fillPoly(ctx, [[x, y - h], [x + w / 2, sy], [x, y]], cD);
}
function dune(ctx: C, x: number, y: number, w: number, h: number, cL: string, cD: string) {
  const ax = x - w * 0.025, ay = y - h * 1.05;
  ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.quadraticCurveTo(x - w * 0.05, y - h * 2.1, x + w / 2, y); ctx.closePath(); ctx.fillStyle = cL; ctx.fill();
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(x + w * 0.225, y - h * 1.05, x + w / 2, y); ctx.lineTo(x + w * 0.1, y);
  ctx.quadraticCurveTo(x + w * 0.03, y - h * 0.5, ax, ay); ctx.closePath(); ctx.fillStyle = cD; ctx.fill();
}

function decor(sc: Scene, sp: Sprite, cx: number, ty: number, c: RGB, alpha: number) {
  const { ctx, PAL } = sc;
  const LLc = mix(c, WHITE, 0.76);
  const L = css(mix(c, WHITE, 0.4)), LL = css(LLc), D = css(mix(c, PAL.shade, 0.27)), DD = css(mix(c, PAL.shade, 0.52));
  const HI = css(mix(LLc, WHITE, sp.cm)); /* snow, ice, sails: pure white only once read */
  const R = rng(sp.t.seed), e = sp.tier;
  ctx.save(); ctx.globalAlpha = alpha;
  switch (sp.terrain) {
    case 'mountain': {
      const hh = 15 + e * 4.4, y = ty - 3;
      if (e >= 4) peak(ctx, cx - 18, y - 1, 22, hh * 0.6, L, D, HI, LL);
      if (e >= 2) peak(ctx, cx + 16, y + 1, 25, hh * 0.72, L, D, HI, LL);
      peak(ctx, cx - 1, y + 4, 33, hh, L, D, HI, LL);
      break;
    }
    case 'meadow': {
      const y = ty - 4, pr: Pt[] = [[9, -7], [-20, -3]];
      if (e >= 4) pr.push([-5, 4.5]);
      for (const [px, py] of pr) { tree(ctx, cx + px, y + py, 1, D, L, DD); tree(ctx, cx + px + 10, y + py + 2, 0.82, D, L, DD); }
      break;
    }
    case 'quarry': {
      const y = ty - 2, h1 = 8 + e * 1.2;
      box(ctx, cx + 14, y - 3, 14, 7, 5 + e, LL, L, D);
      box(ctx, cx - 9, y + 3, 22, 9, h1, LL, L, D);
      box(ctx, cx - 12, y + 3 - h1 - 1.6, 11, 6, 6, HI, LL, L);
      break;
    }
    case 'marsh': {
      const cw = 9.5, ch = 5.7, gap = 1.7, cols = 4, rows = 3;
      const x0 = cx - (cols * cw + (cols - 1) * gap) / 2, y0 = ty - 6 - (rows * ch + (rows - 1) * gap) / 2;
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const masked = R() < 0.45;
        ctx.globalAlpha = alpha * (masked ? 0.5 : 0.95); ctx.fillStyle = masked ? DD : LL;
        ctx.fillRect(x0 + q * (cw + gap), y0 + r * (ch + gap), cw, ch);
      }
      ctx.globalAlpha = alpha;
      for (const [rx, ry] of [[-27, 1], [27, -3], [30, 1]]) {
        seg(ctx, cx + rx, ty + ry, cx + rx + 0.8, ty + ry - 10, DD, 1.2);
        ctx.beginPath(); ctx.ellipse(cx + rx + 0.9, ty + ry - 11, 1.5, 3, 0, 0, Math.PI * 2); ctx.fillStyle = DD; ctx.fill();
      }
      break;
    }
    case 'coast': {
      const y = ty - 3;
      ctx.beginPath(); ctx.ellipse(cx - 4, y + 1, 23, 9.5, 0, 0, Math.PI * 2); ctx.fillStyle = LL; ctx.fill();
      ctx.strokeStyle = css(mix(LLc, WHITE, 0.5), 0.8); ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      for (const [wx, wy] of [[27, 5], [31, -2], [-31, -4]]) { ctx.beginPath(); ctx.arc(cx + wx, y + wy, 4, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
      if (e >= 4) {
        fillPoly(ctx, [[cx - 10, y + 2], [cx - 8, y - 17], [cx - 2, y - 17], [cx, y + 2]], HI);
        fillPoly(ctx, [[cx - 9.4, y - 4], [cx - 8.8, y - 10], [cx - 1.2, y - 10], [cx - 0.6, y - 4]], DD);
        ctx.fillStyle = DD; ctx.fillRect(cx - 9.5, y - 22, 9, 5);
        disc(ctx, cx - 5, y - 19.5, 1.6, css(mix(LLc, [255, 226, 122], sp.cm)));
      } else {
        seg(ctx, cx - 7, y + 1, cx - 7, y - 19, DD, 1.5);
        fillPoly(ctx, [[cx - 7, y - 19.5], [cx + 4, y - 16.5], [cx - 7, y - 13.5]], DD);
        fillPoly(ctx, [[cx - 7, y - 12.5], [cx + 2.5, y - 10], [cx - 7, y - 7.5]], HI);
      }
      break;
    }
    case 'ice': {
      const y = ty - 2;
      dune(ctx, cx - 11, y + 2, 34, 7.5, LL, L);
      if (e >= 3) crystal(ctx, cx - 21, y - 4, 7, 10, HI, L);
      crystal(ctx, cx + 14, y - 2, 10, 14 + e * 1.6, HI, L); crystal(ctx, cx + 4, y + 5, 8, 9 + e, HI, L);
      break;
    }
    case 'terrace': {
      const lv: Pt[] = e >= 3 ? [[0.68, 5], [0.43, 10], [0.2, 14.5]] : [[0.66, 5], [0.36, 10]];
      let prev = 0;
      lv.forEach(([scale, up], i) => {
        const P = hexPts(cx, ty - 2, up, S * scale), hh = up - prev;
        wall(ctx, P[2], P[3], hh, css(mix(c, PAL.shade, 0.14))); wall(ctx, P[1], P[2], hh, css(mix(c, PAL.shade, 0.28))); wall(ctx, P[0], P[1], hh, css(mix(c, PAL.shade, 0.4)));
        fillPoly(ctx, P, css(mix(c, WHITE, 0.2 + i * 0.22))); prev = up;
      });
      break;
    }
    case 'works': {
      const y = ty - 3;
      house(ctx, cx + 7, y - 3, 15, 8.5, LL, DD, D); house(ctx, cx - 15, y + 2, 13, 7.5, LL, DD, D);
      if (e >= 3) house(ctx, cx + 21, y + 5, 10, 6, LL, DD, D);
      break;
    }
    case 'crystal': {
      const y = ty - 2;
      crystal(ctx, cx - 15, y, 10, 17, LL, D); crystal(ctx, cx + 15, y - 2, 9, 13 + e, LL, D); crystal(ctx, cx, y + 4, 13, 21 + e * 2, LL, D);
      break;
    }
    case 'outpost': {
      const y = ty - 3;
      seg(ctx, cx + 15, y + 1, cx + 15, y - 18, DD, 1.4);
      ctx.beginPath(); ctx.arc(cx + 15, y - 18, 5.5, Math.PI * 0.2, Math.PI * 1.2); ctx.closePath(); ctx.fillStyle = LL; ctx.fill();
      disc(ctx, cx + 12.3, y - 21.6, 1.5, DD);
      peak(ctx, cx - 8, y + 2, 24, 14, LL, D);
      fillPoly(ctx, [[cx - 10.6, y + 4.6], [cx - 8, y - 4], [cx - 5.4, y + 4.6]], DD);
      if (e >= 3) peak(ctx, cx + 6, y + 7, 14, 8, LL, D);
      break;
    }
  }
  ctx.restore();
}

/* ───────────── tiles ───────────── */
function tileColour(sc: Scene, sp: Sprite): RGB {
  const { PAL } = sc;
  const painted = sp.t.kind === 'open' ? PAL.rev : sp.colNow;
  let c = mix(mix(PAL.fog, PAL.rev, sp.da), painted, sp.cm);
  if (sp === sc.hover && sp.dseen) c = mix(c, WHITE, 0.16);
  return c;
}
function drawTile(sc: Scene, sp: Sprite) {
  const { ctx, PAL } = sc;
  const cx = sp.wx, cy = sp.wy, h = sp.h, c = tileColour(sc, sp), P = hexPts(cx, cy, h, S), ty = cy - h;
  wall(ctx, P[2], P[3], h, css(mix(c, PAL.shade, 0.2)));
  wall(ctx, P[1], P[2], h, css(mix(c, PAL.shade, 0.36)));
  wall(ctx, P[0], P[1], h, css(mix(c, PAL.shade, 0.5)));
  if (sp.da > 0.5 && sp.t.kind === 'paper') { /* one stratum per elevation tier */
    ctx.strokeStyle = css(PAL.shade, 0.2); ctx.lineWidth = 0.8;
    for (let k = 1; k <= sp.tier; k++) {
      const d = k * UNIT;
      if (d > h - 2) break;
      ctx.beginPath(); ctx.moveTo(P[3][0], P[3][1] + d); ctx.lineTo(P[2][0], P[2][1] + d); ctx.lineTo(P[1][0], P[1][1] + d); ctx.lineTo(P[0][0], P[0][1] + d); ctx.stroke();
    }
  }
  fillPoly(ctx, P, css(c));
  if (!sp.dseen && sp.da < 0.05) {
    ctx.setLineDash([4, 3.5]); ctx.strokeStyle = css(PAL.fogLine, 0.9); ctx.lineWidth = 1; path(ctx, hexPts(cx, cy, h, S - 0.5)); ctx.stroke(); ctx.setLineDash([]);
    return;
  }
  ctx.strokeStyle = css(mix(c, PAL.shade, 0.4), 0.55); ctx.lineWidth = 1; path(ctx, P); ctx.stroke();
  ctx.strokeStyle = css(WHITE, PAL.dark ? 0.16 + 0.2 * sp.cm : 0.42); ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(P[3][0] + 1, P[3][1]); ctx.lineTo(P[4][0] + 0.5, P[4][1] + 1); ctx.lineTo(P[5][0] - 0.5, P[5][1] + 1); ctx.stroke();

  if (sp.t.kind === 'open') {
    ctx.save(); ctx.globalAlpha = sp.da; path(ctx, P); ctx.clip(); ctx.strokeStyle = css(PAL.ink, 0.16); ctx.lineWidth = 1.2;
    for (let x = -S * 2; x < S * 2; x += 7) { ctx.beginPath(); ctx.moveTo(cx + x, ty - S); ctx.lineTo(cx + x + S * 0.9, ty + S); ctx.stroke(); }
    ctx.restore();
    ctx.save(); ctx.globalAlpha = sp.da;
    seg(ctx, cx - 6, ty + 1, cx - 6, ty - 21, css(PAL.ink), 1.5);
    ctx.fillStyle = css(mix(PAL.pill, PAL.accent, sp.cm)); ctx.fillRect(cx - 6, ty - 22, 14, 11);
    ctx.strokeStyle = css(PAL.ink); ctx.lineWidth = 1; ctx.strokeRect(cx - 6, ty - 22, 14, 11);
    ctx.fillStyle = css(mix(PAL.ink, PAL.pill, sp.cm)); ctx.font = '700 9.5px ' + SANS; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', cx + 1, ty - 16.2);
    ctx.restore();
  } else if (sp.da > 0.02) {
    decor(sc, sp, cx, ty, c, sp.da);
    if (sp === sc.focal) { /* the centre of the current map carries the flag */
      ctx.save(); ctx.globalAlpha = sp.da;
      const fx = cx + 22, fy = ty - 2, f = css(PAL.dark ? WHITE : PAL.ink);
      seg(ctx, fx, fy, fx, fy - 27, f, 1.7);
      fillPoly(ctx, [[fx, fy - 27.5], [fx + 12, fy - 23.5], [fx, fy - 19.5]], css(mix(PAL.ink, PAL.accent, 0.25 + 0.75 * sp.cm)));
      ctx.restore();
    }
  }
  if (sp === sc.cur && !sc.move) {
    const a = sc.RM ? 1 : 0.72 + 0.28 * Math.sin(sc.now / 420);
    path(ctx, hexPts(cx, cy, h, S * 0.9)); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 4.2; ctx.stroke();
    ctx.strokeStyle = css(PAL.dark ? WHITE : PAL.ink, a); ctx.lineWidth = 2; ctx.stroke();
  } else if (sp === sc.hover) {
    path(ctx, hexPts(cx, cy, h, S * 0.9)); ctx.strokeStyle = css(PAL.dark ? WHITE : PAL.ink, 0.5); ctx.lineWidth = 1.4; ctx.stroke();
  }
}

/* the sea carries the bearing-to-hue wheel as a soft halo */
function drawHalo(sc: Scene) {
  const { ctx, PAL } = sc;
  if (!ctx.createConicGradient) return;
  const R = S * SQ3 * 10.6;
  ctx.save(); ctx.scale(1, K);
  const g = ctx.createConicGradient(-Math.PI / 2, 0, 0);
  WHEEL_HEX.forEach((c, i) => g.addColorStop(i / WHEEL_HEX.length, c)); g.addColorStop(1, WHEEL_HEX[0]);
  ctx.globalAlpha = PAL.dark ? 0.3 : 0.34; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  const f = ctx.createRadialGradient(0, 0, R * 0.5, 0, 0, R);
  f.addColorStop(0, css(PAL.sea, 0)); f.addColorStop(0.55, css(PAL.sea, 0.55)); f.addColorStop(1, css(PAL.sea, 1));
  ctx.fillStyle = f; ctx.beginPath(); ctx.arc(0, 0, R * 1.02, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* macro-direction markers: chevrons heading out to sea where a gradient's end papers landed */
function drawMarkers(sc: Scene) {
  const { ctx, PAL } = sc;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const m of sc.markers) {
    const px = -m.dy, py = m.dx, col = PAL.dark ? mix(m.col, WHITE, 0.15) : mix(m.col, PAL.shade, 0.18);
    [0.25, 0.9, 1.55].forEach((o, i) => {
      const r = m.rho + o;
      ctx.beginPath();
      ctx.moveTo(S * (r * m.dx + px * 0.62), S * (r * m.dy + py * 0.62) * K);
      ctx.lineTo(S * (r + 0.42) * m.dx, S * (r + 0.42) * m.dy * K);
      ctx.lineTo(S * (r * m.dx - px * 0.62), S * (r * m.dy - py * 0.62) * K);
      ctx.strokeStyle = css(col, [0.95, 0.62, 0.32][i]); ctx.lineWidth = 3.2; ctx.stroke();
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `italic 600 20px ${SERIF}`; ctx.fillStyle = css(PAL.ink, 0.88); ctx.fillText(m.name, m.px, m.py - 8);
    ctx.font = `400 12.5px ${SANS}`; ctx.fillStyle = css(PAL.ink2); ctx.fillText(m.gloss, m.px, m.py + 9);
  }
}

/* citation trails from the tile you stand on: dashes for what it builds on and uses, dots for what cites it */
const tileTop = (sp: Sprite): Pt => [sp.wx, sp.wy - sp.h - 8];
function trail(sc: Scene, a: Sprite, b: Sprite, col: RGB, alpha: number, width: number, dash: number[], off: number) {
  const { ctx, PAL } = sc;
  const [ax, ay] = tileTop(a), [bx, by] = tileTop(b), d = Math.hypot(bx - ax, by - ay);
  const mx = (ax + bx) / 2, my = (ay + by) / 2 - (26 + d * 0.2);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by);
  ctx.setLineDash([]); ctx.strokeStyle = css(PAL.pill, alpha * 0.75); ctx.lineWidth = width + 2.4; ctx.stroke();
  ctx.setLineDash(dash); ctx.lineDashOffset = off; ctx.strokeStyle = css(col, alpha); ctx.lineWidth = width; ctx.stroke(); ctx.setLineDash([]);
  const tx = bx - mx, tyy = by - my, tl = Math.hypot(tx, tyy) || 1, ux = tx / tl, uy = tyy / tl, s = 5 + width * 1.6;
  ctx.beginPath(); ctx.moveTo(bx, by);
  ctx.lineTo(bx - ux * s - uy * s * 0.5, by - uy * s + ux * s * 0.5); ctx.lineTo(bx - ux * s + uy * s * 0.5, by - uy * s - ux * s * 0.5); ctx.closePath();
  ctx.fillStyle = css(col, alpha); ctx.fill();
}
function drawTrails(sc: Scene) {
  const { PAL, sprites, cur } = sc;
  const ink = PAL.dark ? WHITE : PAL.ink, flow = sc.RM ? 0 : -sc.now * 0.018;
  const of = (id: string) => sprites[WORLD.byId[id].ti];
  if (sc.trails) {
    for (const p of WORLD.papers) {
      const sp = sprites[p.ti];
      if (!sp.dread) continue;
      for (const id of p.builds) { const r = of(id); if (r.dseen && sp !== cur && r !== cur) trail(sc, sp, r, ink, 0.3, 1.1, [], 0); }
    }
  }
  const c = cur.t;
  if (c.kind !== 'paper' || !cur.dread) return; /* trails only once you have read it */
  const inc = (WORLD.citers[c.id] || []).filter(x => x.k !== 'compares' && sprites[x.t.ti].dseen), ia = inc.length > 8 ? 0.5 : 0.9; /* a hub's many citers are drawn fainter */
  for (const x of inc) trail(sc, sprites[x.t.ti], cur, PAL.accent, ia, 1.5, [1.5, 5], flow);
  for (const id of c.uses) { const r = of(id); if (r.dseen) trail(sc, cur, r, ink, 0.7, 1.2, [3, 5], flow); }
  for (const id of c.builds) { const r = of(id); if (r.dseen) trail(sc, cur, r, ink, 0.9, 1.6, [6, 5], flow); }
}

/* lenses: ink marks on revealed tiles. They never use colour, which stays reserved for "read". */
function drawLens(sc: Scene) {
  const { ctx, PAL, lens } = sc;
  if (!lens) return;
  const ink = PAL.dark ? WHITE : PAL.ink;
  for (const sp of sc.order) {
    const t = sp.t;
    if (t.kind !== 'paper' || !sp.dseen) continue;
    const x = sp.wx + 24, y = sp.wy - sp.h - 9;
    if (lens.type === 'concept') {
      if (!t.c.includes(lens.name)) continue;
      ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI * 2); ctx.fillStyle = css(PAL.pill); ctx.fill(); ctx.strokeStyle = css(ink); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fillStyle = css(ink); ctx.fill();
    } else {
      const G = WORLD.grads[lens.k - 1], z = G.coord[t.i], r = 2.5 + 6.5 * Math.abs(z) / G.zmax;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = css(z > 0 ? ink : PAL.pill); ctx.fill();
      ctx.strokeStyle = css(z > 0 ? PAL.pill : ink); ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
}

/* the walker */
const tokenAt = (sp: Sprite): Pt => [sp.wx - 23, sp.wy - sp.h + 3];
function drawToken(sc: Scene) {
  const { ctx, PAL, move } = sc;
  let x: number, y: number, lift: number;
  if (move) {
    const p = move.dur ? clamp((sc.now - move.t0) / move.dur, 0, 1) : 1, e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const a = tokenAt(move.from), b = tokenAt(move.to);
    x = a[0] + (b[0] - a[0]) * e; y = a[1] + (b[1] - a[1]) * e; lift = Math.sin(Math.PI * p) * (18 + move.dur * 0.03);
  } else {
    [x, y] = tokenAt(sc.cur);
    lift = sc.RM ? 0 : 1.2 + 1.2 * Math.sin(sc.now / 520);
  }
  const body = PAL.dark ? WHITE : PAL.ink, rim = PAL.dark ? PAL.pill : WHITE;
  ctx.beginPath(); ctx.ellipse(x, y + 0.5, 8.5 - lift * 0.08, 3.6 - lift * 0.04, 0, 0, Math.PI * 2); ctx.fillStyle = css(PAL.shade, 0.3); ctx.fill();
  y -= lift;
  ctx.lineJoin = 'round'; ctx.lineWidth = 1.8; ctx.strokeStyle = css(rim); ctx.fillStyle = css(body);
  ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.quadraticCurveTo(x - 6, y - 11, x - 2.6, y - 14.5); ctx.lineTo(x + 2.6, y - 14.5);
  ctx.quadraticCurveTo(x + 6, y - 11, x + 7, y); ctx.closePath(); ctx.stroke(); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y - 18.5, 5, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
}

/* labels are drawn in screen space so they stay legible at any zoom */
const widths = new Map<string, number>();
export const clearTextCache = () => widths.clear();
function textWidth(ctx: C, txt: string, fs: number) {
  const k = fs.toFixed(1) + txt;
  let w = widths.get(k);
  if (w === undefined) { w = ctx.measureText(txt).width; widths.set(k, w); }
  return w;
}
function drawLabels(sc: Scene) {
  const { ctx, PAL, cam, W, H } = sc;
  const fs = 11.5 * clamp(cam.z, 0.88, 1.3), few = cam.z < 0.5;
  ctx.font = `600 ${fs}px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const sp of sc.order) {
    if (!sp.dseen) continue;
    const here = sp === sc.cur, hov = sp === sc.hover, read = sp.dread;
    if (few && !here && !hov && !read) continue;
    const sx = (sp.wx - cam.x) * cam.z + W / 2, sy = (sp.wy - sp.h + 16 - cam.y) * cam.z + H / 2;
    if (sx < -60 || sx > W + 60 || sy < -20 || sy > H + 20) continue;
    const txt = sp.t.s, w = textWidth(ctx, txt, fs) + fs * 0.9, hgt = fs + 6.5;
    rr(ctx, sx - w / 2, sy - hgt / 2, w, hgt, 4);
    ctx.globalAlpha = Math.min(1, sp.da * 1.4);
    ctx.fillStyle = here ? css(PAL.ink) : css(PAL.pill, read || hov ? 0.94 : 0.5); ctx.fill();
    ctx.fillStyle = here ? css(PAL.pill) : css(read || hov ? PAL.ink : PAL.ink2); ctx.fillText(txt, sx, sy + 0.5);
    ctx.globalAlpha = 1;
  }
}

export function drawScene(sc: Scene) {
  const { ctx, PAL, cam, W, H, DPR } = sc;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = css(PAL.sea); ctx.fillRect(0, 0, W, H);
  ctx.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, DPR * (W / 2 - cam.x * cam.z), DPR * (H / 2 - cam.y * cam.z));
  drawHalo(sc);
  if (!sc.moving) {
    ctx.lineWidth = 1; ctx.strokeStyle = css(PAL.ink, PAL.dark ? 0.07 : 0.06);
    for (const c of sc.sea) { path(ctx, hexPts(c.wx, c.wy, 0, S - 2)); ctx.stroke(); }
    drawMarkers(sc);
  }
  ctx.fillStyle = css(PAL.shade, PAL.dark ? 0.45 : 0.12);
  for (const sp of sc.order) { path(ctx, hexPts(sp.wx, sp.wy + 7, 0, S + 1.5)); ctx.fill(); }
  for (const sp of sc.order) drawTile(sc, sp);
  if (!sc.moving) { drawTrails(sc); drawLens(sc); }
  drawToken(sc);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawLabels(sc);
}
