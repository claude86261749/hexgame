import type { GameState } from '../game/state';
import { clamp, hex2rgb, type RGB } from '../world/colour';
import { FOGH, S, tileHeight } from '../world/geometry';
import type { MapView } from '../world/mapView';
import { WORLD } from '../world/world';
import { clearTextCache, drawScene, hexPts } from './draw';
import type { Camera, Lens, Move, Palette, Sprite } from './types';

export interface Hover { id: string; x: number; y: number; sticky: boolean }

export interface ControllerEvents {
  /** The walker reached a tile. */
  arrive(id: string): void;
  /** The tile you already stand on was clicked. */
  openCurrent(): void;
  /** The pointer is over a tile, or over nothing. */
  hover(h: Hover | null): void;
}

export interface ControllerProps {
  game: GameState;
  view: MapView;
  lens: Lens | null;
  /** Bumped by "Start over": snap everything and frame the island again. */
  epoch: number;
  /** Tiles whose paper has a live guide; their labels carry a red dot. */
  live: ReadonlySet<string>;
}

const KEY_PAN = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] } as const;

/**
 * Owns the canvas: camera, animation, pointer input and the frame loop.
 * React owns the game state and passes it in with setProps after each commit.
 */
export class MapController {
  private ctx: CanvasRenderingContext2D;
  private sprites: Sprite[];
  private order: Sprite[];
  private props!: ControllerProps;
  private PAL!: Palette;
  private cam: Camera = { x: 0, y: -6, z: 1, tx: null, ty: null, tz: null };
  private W = 1; private H = 1; private DPR = 1;
  private sized = false;
  private move: Move | null = null;
  private moving = false;
  private hoverId: string | null = null;
  private pendingFocus: string | null = null;
  private raf = 0;
  private last = 0;
  private readonly RM: boolean;
  private cleanup: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private wrap: HTMLElement, private events: ControllerEvents) {
    this.ctx = canvas.getContext('2d')!;
    this.RM = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.sprites = WORLD.tiles.map(t => ({
      t, wx: 0, wy: 0, tx: 0, ty: 0, colNow: [0, 0, 0], col: [0, 0, 0], h: FOGH, da: 0, cm: 0,
      dseen: false, dread: false, tier: t.baseTier, terrain: 'meadow', q: 0, r: 0,
    }));
    this.order = this.sprites.slice();
    this.readTheme();
    this.listen();
  }

  /* ───────────── props from React ───────────── */
  setProps(next: ControllerProps) {
    const prev = this.props;
    this.props = next;
    if (!prev || prev.epoch !== next.epoch) {
      this.layOut(next.view, false);
      const now = performance.now();
      for (const sp of this.sprites) this.snap(sp, now);
      this.move = null;
      this.sized = false;
      this.resize();
    } else if (prev.view !== next.view) {
      /* the island is laid out again around a new centre */
      this.layOut(next.view, !this.RM);
      this.cam.tz = this.RM ? null : this.fitZoom();
      if (this.RM) this.cam.z = this.fitZoom();
      const b = next.view.box;
      this.centreOn((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, true);
    }
    if (this.pendingFocus) { this.focusOn(this.pendingFocus, false); this.pendingFocus = null; }
  }

  private layOut(view: MapView, animate: boolean) {
    for (const sp of this.sprites) {
      const p = view.at[sp.t.ti];
      sp.tx = p.tx; sp.ty = p.ty; sp.q = p.q; sp.r = p.r;
      sp.col = p.col; sp.tier = p.tier; sp.terrain = view.themeOf[sp.t.ti].terrain;
      if (!animate) { sp.wx = sp.tx; sp.wy = sp.ty; sp.colNow = sp.col.slice() as RGB; }
    }
    this.moving = animate;
    this.order.sort((a, b) => a.wy - b.wy || a.wx - b.wx);
  }

  /** Show a tile as the game has it, minus any change still due. */
  private snap(sp: Sprite, now: number) {
    const g = this.props.game, id = sp.t.id;
    sp.dseen = !!g.seen[id] && (g.dueSeen[id] ?? 0) <= now;
    sp.dread = !!g.read[id] && (g.dueRead[id] ?? 0) <= now;
    sp.h = sp.dseen ? tileHeight(sp.tier) : FOGH;
    sp.da = sp.dseen ? 1 : 0;
    sp.cm = sp.dread ? 1 : 0;
  }

  /* ───────────── commands ───────────── */
  /** Walk to a revealed tile; clicking where you stand opens its paper. */
  travel(id: string) {
    const g = this.props.game, to = this.sprite(id);
    if (!to || !g.seen[id] || this.move || this.moving) return;
    if (id === g.cur) { this.events.openCurrent(); this.pendingFocus = id; return; }
    const from = this.sprite(g.cur)!, d = Math.hypot(to.wx - from.wx, to.wy - from.wy);
    this.move = { from, to, t0: performance.now(), dur: this.RM ? 0 : clamp(260 + d * 0.55, 300, 760) };
  }
  get busy() { return !!this.move || this.moving; }

  recenter() {
    this.cam.tz = this.RM ? null : this.fitZoom();
    if (this.RM) this.cam.z = this.fitZoom();
    this.focusOn(this.props.game.cur, true);
  }

  /** Bring a tile into the free part of the view if it is near an edge, or always when forced. */
  focusOn(id: string, force: boolean) {
    const sp = this.sprite(id);
    if (!sp) return;
    const { cam, W, H } = this, v = this.viewRect();
    const sx = (sp.wx - cam.x) * cam.z + W / 2, sy = (sp.wy - sp.h - cam.y) * cam.z + H / 2;
    const mx = Math.min(140, v.w * 0.22), my = Math.min(90, v.h * 0.2);
    if (force || sx < v.x + mx || sx > v.x + v.w - mx || sy < v.y + my + 20 || sy > v.y + v.h - my) {
      this.centreOn(sp.wx, sp.wy - tileHeight(sp.tier) - 6, true);
    }
  }

  readTheme = () => {
    const cs = getComputedStyle(document.documentElement), g = (n: string) => hex2rgb(cs.getPropertyValue(n));
    const sea = g('--sea');
    this.PAL = {
      sea, fog: g('--fog'), fogLine: g('--fog-line'), rev: g('--rev'), shade: g('--shade'),
      ink: g('--ink'), ink2: g('--ink-2'), pill: g('--pill'), accent: g('--accent'), live: g('--live'),
      dark: sea[0] + sea[1] + sea[2] < 300,
    };
  };

  start() {
    const frame = (ts: number) => {
      const dt = Math.min(0.05, (ts - this.last) / 1000 || 0);
      this.last = ts;
      this.update(dt, ts);
      this.draw(ts);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) f();
  }

  /* ───────────── camera ───────────── */
  private sprite(id: string) { const t = WORLD.byId[id]; return t ? this.sprites[t.ti] : undefined; }
  private narrow() { return this.W <= 860; }
  /** The part of the map not covered by the title, the toolbar or the popup. */
  private viewRect() {
    const { W, H } = this, top = this.narrow() ? 108 : 60, bot = 8;
    const sheet = this.wrap.querySelector<HTMLElement>('.sheet'), open = !!sheet && !sheet.hidden;
    if (this.narrow()) return { x: 0, y: top, w: W, h: Math.max(120, H - top - (open ? sheet!.getBoundingClientRect().height : bot)) };
    const legend = this.wrap.querySelector<HTMLElement>('.legend');
    const left = (legend ? legend.getBoundingClientRect().right - this.wrap.getBoundingClientRect().left : 0) + 6;
    const right = open ? sheet!.getBoundingClientRect().width + 28 : 8;
    return { x: left, y: top, w: Math.max(260, W - left - right), h: Math.max(120, H - top - bot) };
  }
  private islandZoom(v = this.viewRect()) { const b = this.props.view.box; return Math.min(v.w / (b.x1 - b.x0 + 24), v.h / (b.y1 - b.y0 + 24)); }
  private fitZoom() { return clamp(this.islandZoom(), 0.66, 1.15); }
  private centreOn(wx: number, wy: number, animate: boolean) {
    const { cam, W, H } = this, v = this.viewRect(), z = cam.tz || cam.z;
    const x = wx - (v.x + v.w / 2 - W / 2) / z, y = wy - (v.y + v.h / 2 - H / 2) / z;
    if (animate && !this.RM) { cam.tx = x; cam.ty = y; } else { cam.x = x; cam.y = y; cam.tx = cam.ty = null; }
  }
  resize = () => {
    const r = this.wrap.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height); this.DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(this.W * this.DPR); this.canvas.height = Math.round(this.H * this.DPR);
    if (!this.sized && this.props) {
      this.sized = true;
      this.cam.tz = null; this.cam.z = this.fitZoom();
      const b = this.props.view.box;
      if (this.islandZoom() >= 0.66) this.centreOn((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, false);
      else { const c = this.sprite(this.props.game.cur)!; this.centreOn(c.wx, c.wy - tileHeight(c.tier), false); }
    }
  };
  private zoomAt(sx: number, sy: number, z: number) {
    const { cam, W, H } = this;
    z = clamp(z, 0.4, 2.4);
    const wx = (sx - W / 2) / cam.z + cam.x, wy = (sy - H / 2) / cam.z + cam.y;
    cam.z = z; cam.x = wx - (sx - W / 2) / z; cam.y = wy - (sy - H / 2) / z; cam.tx = cam.ty = cam.tz = null;
  }

  /* ───────────── frame ───────────── */
  private update(dt: number, now: number) {
    const g = this.props.game, k = 1 - Math.exp(-dt * 8), kc = 1 - Math.exp(-dt * 4.2);
    for (const sp of this.sprites) {
      const id = sp.t.id, seen = !!g.seen[id], read = !!g.read[id];
      if (sp.dseen !== seen && (!seen || now >= (g.dueSeen[id] ?? 0))) sp.dseen = seen;
      if (sp.dread !== read && (!read || now >= (g.dueRead[id] ?? 0))) sp.dread = read;
      const th = sp.dseen ? tileHeight(sp.tier) : FOGH, td = sp.dseen ? 1 : 0, tc = sp.dread ? 1 : 0;
      if (this.RM) { sp.h = th; sp.da = td; sp.cm = tc; }
      else { sp.h += (th - sp.h) * k; sp.da += (td - sp.da) * k; sp.cm += (tc - sp.cm) * kc; }
    }
    if (this.moving) {
      const km = 1 - Math.exp(-dt * 4.5);
      let far = 0;
      for (const sp of this.sprites) {
        sp.wx += (sp.tx - sp.wx) * km; sp.wy += (sp.ty - sp.wy) * km;
        far = Math.max(far, Math.abs(sp.tx - sp.wx) + Math.abs(sp.ty - sp.wy));
        for (let c = 0; c < 3; c++) sp.colNow[c] += (sp.col[c] - sp.colNow[c]) * km;
      }
      if (far < 0.6) {
        for (const sp of this.sprites) { sp.wx = sp.tx; sp.wy = sp.ty; sp.colNow = sp.col.slice() as RGB; }
        this.moving = false;
      }
      this.order.sort((a, b) => a.wy - b.wy || a.wx - b.wx);
    }
    if (this.move && now - this.move.t0 >= this.move.dur) {
      const id = this.move.to.t.id;
      this.move = null;
      this.pendingFocus = id;
      this.events.arrive(id);
    }
    const cam = this.cam;
    if (cam.tx !== null && cam.ty !== null) {
      const q = 1 - Math.exp(-dt * 5.5);
      cam.x += (cam.tx - cam.x) * q; cam.y += (cam.ty - cam.y) * q;
      if (Math.abs(cam.tx - cam.x) + Math.abs(cam.ty - cam.y) < 0.4) cam.tx = cam.ty = null;
    }
    if (cam.tz !== null) {
      cam.z += (cam.tz - cam.z) * (1 - Math.exp(-dt * 6));
      if (Math.abs(cam.tz - cam.z) < 0.004) { cam.z = cam.tz; cam.tz = null; }
    }
  }

  private draw(now: number) {
    const { props } = this;
    drawScene({
      ctx: this.ctx, PAL: this.PAL, W: this.W, H: this.H, DPR: this.DPR, cam: this.cam, now, RM: this.RM,
      sprites: this.sprites, order: this.order, sea: props.view.sea, markers: props.view.markers,
      focal: this.sprites[props.view.focal.ti], cur: this.sprite(props.game.cur)!,
      hover: this.hoverId ? this.sprite(this.hoverId)! : null,
      move: this.move, moving: this.moving, trails: props.game.trails, lens: props.lens, live: props.live,
    });
  }

  /* ───────────── pointer, wheel, keys ───────────── */
  private hit(sx: number, sy: number): Sprite | null {
    const { cam, W, H } = this, x = (sx - W / 2) / cam.z + cam.x, y = (sy - H / 2) / cam.z + cam.y;
    for (let i = this.order.length - 1; i >= 0; i--) {
      const sp = this.order[i];
      if (Math.abs(x - sp.wx) > S || y < sp.wy - sp.h - S || y > sp.wy + S) continue;
      const P = hexPts(sp.wx, sp.wy, sp.h, S), h = sp.h;
      if (inPoly(x, y, [P[3], P[4], P[5], P[0], [P[0][0], P[0][1] + h], [P[1][0], P[1][1] + h], [P[2][0], P[2][1] + h], [P[3][0], P[3][1] + h]])) return sp;
    }
    return null;
  }

  private listen() {
    const cv = this.canvas, cam = this.cam;
    const ptrs = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; cx: number; cy: number } | null = null, pinch: { d: number; z: number } | null = null, moved = false;
    const pos = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, f: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, f, opts);
      this.cleanup.push(() => el.removeEventListener(type, f, opts));
    };

    on(cv, 'pointerdown', e => {
      const p = pos(e);
      ptrs.set(e.pointerId, p);
      try { cv.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      if (ptrs.size === 1) { drag = { x: p.x, y: p.y, cx: cam.x, cy: cam.y }; moved = false; }
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.z }; moved = true; }
    });
    on(cv, 'pointermove', e => {
      const p = pos(e);
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
      if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
        return;
      }
      if (drag && ptrs.size === 1) {
        const dx = p.x - drag.x, dy = p.y - drag.y;
        if (!moved && Math.hypot(dx, dy) > 5) { moved = true; cv.classList.add('is-drag'); this.events.hover(null); }
        if (moved) { cam.x = drag.cx - dx / cam.z; cam.y = drag.cy - dy / cam.z; cam.tx = cam.ty = null; }
        return;
      }
      if (e.pointerType === 'mouse') {
        const sp = this.hit(p.x, p.y);
        this.hoverId = sp ? sp.t.id : null;
        cv.classList.toggle('is-point', !!sp && !!this.props.game.seen[sp.t.id]);
        this.events.hover(sp ? { id: sp.t.id, x: p.x, y: p.y, sticky: false } : null);
      }
    });
    const endPtr = (e: PointerEvent) => {
      const p = pos(e), had = ptrs.has(e.pointerId);
      ptrs.delete(e.pointerId);
      if (!had) return;
      if (ptrs.size === 0) {
        cv.classList.remove('is-drag');
        if (!moved && e.type === 'pointerup') {
          const sp = this.hit(p.x, p.y);
          if (sp) {
            if (!this.props.game.seen[sp.t.id]) this.events.hover({ id: sp.t.id, x: p.x, y: p.y, sticky: true });
            else { this.events.hover(null); this.travel(sp.t.id); }
          }
        }
        drag = null; pinch = null;
      } else if (ptrs.size === 1) {
        const q = [...ptrs.values()][0];
        drag = { x: q.x, y: q.y, cx: cam.x, cy: cam.y }; pinch = null; moved = true;
      }
    };
    on(cv, 'pointerup', endPtr);
    on(cv, 'pointercancel', endPtr);
    on(cv, 'pointerleave', () => { this.hoverId = null; this.events.hover(null); cv.classList.remove('is-point'); });
    on(cv, 'wheel', e => {
      e.preventDefault();
      const p = pos(e);
      this.zoomAt(p.x, p.y, cam.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
    }, { passive: false });
    /* with the map focused, the arrow keys pan and + - zoom */
    on(cv, 'keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase(), step = 70 / cam.z;
      if (k in KEY_PAN) { const [dx, dy] = KEY_PAN[k as keyof typeof KEY_PAN]; cam.x += dx * step; cam.y += dy * step; }
      else if (k === '+' || k === '=') this.zoomAt(this.W / 2, this.H / 2, cam.z * 1.2);
      else if (k === '-') this.zoomAt(this.W / 2, this.H / 2, cam.z / 1.2);
      else return;
      cam.tx = cam.ty = null;
      e.preventDefault();
    });

    const ro = new ResizeObserver(this.resize);
    ro.observe(this.wrap);
    this.cleanup.push(() => ro.disconnect());
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', this.readTheme);
    this.cleanup.push(() => mq?.removeEventListener('change', this.readTheme));
    const mo = new MutationObserver(this.readTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    this.cleanup.push(() => mo.disconnect());
    if (document.fonts) {
      document.fonts.ready.then(clearTextCache);
      document.fonts.addEventListener('loadingdone', clearTextCache);
      this.cleanup.push(() => document.fonts.removeEventListener('loadingdone', clearTextCache));
    }
  }
}

function inPoly(x: number, y: number, p: [number, number][]) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
