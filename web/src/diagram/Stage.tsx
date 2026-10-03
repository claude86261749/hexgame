import React, { useMemo, useRef } from 'react';
import type { Diagram, LandscapeSpec, SimSpec, FreeSpec, ChartSpec } from '../../../shared/schema';
import {
  layout, matrixValue, seriesY, simValue, simContrast, toyRegion, hexDist, HEX_K, clamp,
  type LayoutResult, type FlowL, type CompareL, type MatrixL, type ChartL, type PipelineL, type DetailL, type LandscapeL, type ViewState,
} from '../../../shared/layout';
import type { Placed } from '../../../shared/overlay';

export interface Reveal { k: number; fresh: boolean }
interface Ctx { sel: string | null; selectable: Set<string>; reveal?: Reveal; still?: boolean }
const RCtx = React.createContext<Ctx>({ sel: null, selectable: new Set() });

/** Wrap content tagged with an overlay step: hidden until revealed, newest fades in. */
function Step({ step, children }: { step?: number; children: React.ReactNode }) {
  const { reveal } = React.useContext(RCtx);
  if (step == null || !reveal) return <>{children}</>;
  if (step > reveal.k) return null;
  return <g className={'stp' + (reveal.fresh && step === reveal.k ? ' fresh' : '')}>{children}</g>;
}
const T = ({ x, y, c, a, children }: { x: number; y: number; c?: string; a?: 'middle' | 'end'; children: React.ReactNode }) =>
  <text x={x} y={y} className={'tx' + (c ? ' ' + c : '')} textAnchor={a}>{children}</text>;
function Sel({ id, label, children, extra = '' }: { id: string; label: string; children: React.ReactNode; extra?: string }) {
  const { sel, selectable } = React.useContext(RCtx);
  const can = selectable.has(id);
  return <g className={`node${can ? ' sel' : ''}${sel === id ? ' on' : ''} ${extra}`} data-k={can ? id : undefined} tabIndex={can ? 0 : undefined}
    role={can ? 'button' : undefined} aria-label={label} aria-pressed={can ? sel === id : undefined}>{children}</g>;
}

/* ------------------------------------------------------------------ flow */
function FlowG({ fl }: { fl: FlowL }) {
  return <g>
    {fl.groups.map(g => <g key={g.id}><rect x={g.box.x} y={g.box.y} width={g.box.w} height={g.box.h} rx={8} className="s-mut s-dash" /><T x={g.box.x + 8} y={g.box.y + g.box.h + 14} c="tm tb">{g.label}</T></g>)}
    {fl.edges.map((e, i) => <Step key={i} step={e.step}>
      <path d={e.d} className={(e.step != null ? 'm-s' : 's-ink') + (e.dashed ? ' s-dash' : '')} markerEnd={`url(#ah-${e.step != null ? 'mark' : 'ink'})`} />
      {e.label && <T x={e.lx} y={e.ly} c={'tm halo' + (e.step != null ? ' tk' : '')} a="middle">{e.label}</T>}
    </Step>)}
    {fl.nodes.map(n => <Step key={n.id} step={n.step}>
      <Sel id={n.id} label={n.lines.join(' ')} extra={`k-${n.kind}${n.step != null ? ' marked' : ''}`}>
        <rect className="box" x={n.box.x} y={n.box.y} width={n.box.w} height={n.box.h} rx={5} />
        {n.lines.map((l, i) => <T key={i} x={n.box.x + n.box.w / 2} y={n.box.y + 19 + 15 * i} c={'tb' + (n.kind === 'accent' ? ' ta' : '')} a="middle">{l}</T>)}
        {n.sub.map((l, i) => <T key={'s' + i} x={n.box.x + n.box.w / 2} y={n.box.y + 19 + 15 * n.lines.length + 14 * i} c="tm" a="middle">{l}</T>)}
      </Sel>
    </Step>)}
  </g>;
}

/* ------------------------------------------------------------------ compare */
function CompareG({ cl, columns }: { cl: CompareL; columns: string[] }) {
  return <g>
    {columns.map((c, i) => <T key={i} x={cl.colX[i] + 8} y={cl.header} c="tb tm">{c}</T>)}
    <line x1={cl.x} x2={cl.x + cl.w} y1={cl.header + 7} y2={cl.header + 7} className="s-mut" />
    {cl.rows.map(r => <Step key={r.id} step={r.step}>
      <Sel id={r.id} label={r.label.join(' ')} extra={'row' + (r.strong ? ' strong' : '')}>
        <rect className={r.step != null ? 'm-f' : 'hit bg'} x={cl.x} y={r.y} width={cl.w} height={r.h} rx={4} style={r.step == null && !r.strong ? { stroke: 'none' } : undefined} />
        {r.label.map((l, i) => <T key={i} x={cl.x + 10} y={r.y + 16 + i * 14} c="tm">{l}</T>)}
        {r.cells.map((c, j) => c.map((l, i) => <T key={j + '-' + i} x={cl.colX[j] + 8} y={r.y + 16 + i * 14} c={'tb' + (r.strong && j === r.cells.length - 1 ? ' ta' : '')}>{l}</T>))}
      </Sel>
    </Step>)}
  </g>;
}

/* ------------------------------------------------------------------ matrix */
function MatrixG({ ml, panels }: { ml: MatrixL; panels: any[] }) {
  const byId = new Map(panels.map(p => [p.id, p]));
  return <g>
    {ml.panels.map((p, pi) => {
      const spec = byId.get(p.id); const side = p.cell * p.size;
      const cells: React.ReactNode[] = [];
      for (let i = 0; i < p.size; i++) for (let j = 0; j < p.size; j++)
        cells.push(<rect key={i * 99 + j} x={p.x + j * p.cell} y={p.y + i * p.cell} width={p.cell - 1} height={p.cell - 1} className={spec.accent ? 'f-acc' : 'f-ink'} fillOpacity={matrixValue(spec, i, j, pi).toFixed(2)} />);
      return <Sel key={p.id} id={p.id} label={spec.label}>
        <rect className="hit" x={p.x - 8} y={p.y - 8 - p.label.length * 15} width={side + 16} height={side + 16 + p.label.length * 15} rx={6} />
        {p.label.map((l, i) => <T key={i} x={p.x + side / 2} y={p.y - 8 - (p.label.length - 1 - i) * 15} c={'tb' + (spec.accent ? ' ta' : '')} a="middle">{l}</T>)}
        {cells}<rect x={p.x - 2.5} y={p.y - 2.5} width={side + 4} height={side + 4} rx={2} className="s-mut" />
      </Sel>;
    })}
    {ml.links.map((l, i) => <g key={i}>
      <line x1={l.x1} y1={l.y} x2={l.x2} y2={l.y} className="s-acc" markerStart="url(#ah-acc)" markerEnd="url(#ah-acc)" />
      <T x={(l.x1 + l.x2) / 2} y={l.y - 10} c="ta tb" a="middle">{l.label}</T>
    </g>)}
  </g>;
}

/* ------------------------------------------------------------------ chart */
function ChartG({ cl, spec, x }: { cl: ChartL; spec: ChartSpec; x: number }) {
  const poly = (s: any) => { let p = ''; for (let u = 0; u <= 1.0001; u += 0.0125) p += `${cl.X(u).toFixed(1)},${cl.Y(seriesY(s, u)).toFixed(1)} `; return p; };
  const st = spec.states.find(s => x >= s.from && x <= s.to) || spec.states[spec.states.length - 1];
  const readLines = useMemo(() => wrapLines(st?.text || '', cl.readW), [st?.text, cl.readW]);
  const labelY = new Map(cl.labels.map(l => [l.id, l.y]));
  const { sel } = React.useContext(RCtx);
  return <g>
    <line x1={cl.x0} y1={cl.y0 + cl.ph} x2={cl.x0 + cl.pw} y2={cl.y0 + cl.ph} className="s-mut" />
    <line x1={cl.x0} y1={cl.y0} x2={cl.x0} y2={cl.y0 + cl.ph} className="s-mut" />
    {spec.yLabel && <text className="tx tm" transform={`translate(${cl.x0 - 12},${cl.y0 + cl.ph / 2}) rotate(-90)`} textAnchor="middle">{spec.yLabel}</text>}
    {(spec.xTicks || []).map((t, i) => <g key={i}><line x1={cl.X(t.x)} x2={cl.X(t.x)} y1={cl.y0 + cl.ph} y2={cl.y0 + cl.ph + 5} className="s-mut" /><T x={cl.X(t.x)} y={cl.y0 + cl.ph + 17} c="tm" a="middle">{t.label}</T></g>)}
    <T x={cl.x0 + cl.pw / 2} y={cl.y0 + cl.ph + (spec.xTicks?.length ? 31 : 17)} c="tm" a="middle">{spec.xLabel}</T>
    {(spec.annotations || []).map(a => <Sel key={a.id} id={a.id} label={a.label}>
      <line x1={cl.X(a.x)} x2={cl.X(a.x)} y1={cl.y0 - 4} y2={cl.y0 + cl.ph} className="s-mut s-dash" />
      <T x={cl.X(a.x)} y={cl.y0 - 8} c={'tm' + (sel === a.id ? ' ta tb' : '')} a="middle">{a.label}</T>
    </Sel>)}
    {spec.series.map((s: any) => <Step key={s.id} step={s.step}>
      <Sel id={s.id} label={s.label}>
        <polyline points={poly(s)} className="hitline" style={{ fill: 'none', stroke: 'transparent', strokeWidth: 14 }} />
        <polyline points={poly(s)} className={s.step != null ? 'm-s' : s.accent ? 's-acc' : 's-ink'} style={sel === s.id ? { strokeWidth: 3.2 } : undefined} />
        <T x={cl.x0 + cl.pw + 8} y={labelY.get(s.id)!} c={'tb' + (s.step != null ? ' tk' : s.accent ? ' ta' : '')}>{s.label}</T>
      </Sel>
    </Step>)}
    <line x1={cl.X(x)} x2={cl.X(x)} y1={cl.y0 - 2} y2={cl.y0 + cl.ph} className="s-mut s-dash" />
    {spec.series.map((s: any) => <circle key={s.id} cx={cl.X(x)} cy={cl.Y(seriesY(s, x))} r={4} className={s.step != null ? 'm-fill' : s.accent ? 'f-acc' : 'f-ink'} />)}
    {readLines.map((l, i) => <text key={i} x={cl.x0} y={cl.readY + i * 17} className="tx tr">{l}</text>)}
    <rect className="scrub" x={cl.x0} y={cl.y0 - 4} width={cl.pw} height={cl.ph + 8} />
  </g>;
}
import { wrap } from '../../../shared/text';
const wrapLines = (s: string, w: number) => wrap(s, w, 13);

/* ------------------------------------------------------------------ pipeline */
function DetailG({ d }: { d: DetailL; }) {
  if (d.kind === 'flow') return <FlowG fl={d.l} />;
  if (d.kind === 'compare') return <CompareG cl={d.l} columns={(d as any).columns || []} />;
  if (d.kind === 'matrix') return <MatrixG ml={d.l} panels={d.spec.panels} />;
  return <g>{d.lines.map((b, i) => <g key={i}><circle cx={44} cy={b.y + 12} r={2.6} className="f-acc" />{b.text.map((l, j) => <text key={j} x={54} y={b.y + 16 + j * 17} className="tx tr">{l}</text>)}</g>)}</g>;
}
function PipelineG({ pl, spec }: { pl: PipelineL; spec: any }) {
  const { sel: selId } = React.useContext(RCtx);
  const sel = spec.steps.find((s: any) => s.id === selId) || spec.steps[0];
  const det = sel.detail;
  return <g>
    {pl.steps.map((s, i) => <g key={s.id}>
      <Sel id={s.id} label={`Step ${s.n}: ${spec.steps[i].title}`}>
        <rect className="box" x={s.box.x} y={s.box.y} width={s.box.w} height={s.box.h} rx={5} />
        <T x={s.box.x + 8} y={s.box.y + 14} c="tb tm">{s.n}</T>
        {s.lines.map((l, j) => <T key={j} x={s.box.x + s.box.w / 2} y={s.box.y + (s.lines.length === 1 ? 33 : 28 + j * 14)} c="tb" a="middle">{l}</T>)}
      </Sel>
      {i < pl.steps.length - 1 && <path d={`M${s.box.x + s.box.w + 3},${s.box.y + 21} l4,4 l-4,4`} className="s-ink" />}
    </g>)}
    {pl.phases.map((p, i) => <g key={i}><line x1={p.x1} x2={p.x2} y1={pl.stripBottom - 26} y2={pl.stripBottom - 26} className="s-mut" /><T x={p.lx} y={pl.stripBottom - 12} c="tm" a="middle">{p.label}</T></g>)}
    <rect x={pl.frame.x} y={pl.frame.y} width={pl.frame.w} height={pl.frame.h} rx={6} className="s-mut f-sheet" />
    <T x={pl.frame.x + 14} y={pl.frame.y + 23} c="th">{pl.title}</T>
    {pl.detail && det && <g key={sel.id} className="stp fresh"><DetailG d={det.kind === 'compare' ? { ...pl.detail, columns: det.columns } as any : pl.detail} /></g>}
    {!det && <text x={pl.frame.x + 14} y={pl.frame.y + 50} className="tx tr">{sel.note.slice(0, 90)}{sel.note.length > 90 ? '…' : ''}</text>}
  </g>;
}

/* ------------------------------------------------------------------ landscape */
const hexPts = (cx: number, cy: number, s: number, k = HEX_K) => [0, 60, 120, 180, 240, 300].map(a => [cx + s * Math.cos(a * Math.PI / 180), cy + s * Math.sin(a * Math.PI / 180) * k]);
const pts = (p: number[][]) => p.map(v => v[0].toFixed(1) + ',' + v[1].toFixed(1)).join(' ');
function LandscapeG({ ll, spec }: { ll: LandscapeL; spec: LandscapeSpec }) {
  const { sel } = React.useContext(RCtx);
  const S = 56, BASE = 8;
  const titles = new Map<string, string>([...spec.tiles.map(t => [t.id, t.title] as [string, string]), ...spec.open.map(o => [o.id, o.title] as [string, string])]);
  const tiles = [...ll.tiles].sort((a, b) => a.py - b.py || a.px - b.px);
  const byId = new Map(ll.tiles.map(t => [t.id, t]));
  const cur = sel ? byId.get(sel) : null;
  const openSel = cur && cur.kind === 'fog' ? spec.open.find(o => o.id === cur.id) : null;
  return <g transform={`translate(${ll.ox},${ll.oy}) scale(${ll.scale})`}>
    {tiles.map(t => {
      const cx = t.px, cy = t.py - t.lift, top = hexPts(cx, cy, S), hh = t.lift + BASE;
      const side = (i: number, j: number, c: string) => { const a = top[i], b = top[j]; return <polygon className={c} points={pts([a, b, [b[0], b[1] + hh], [a[0], a[1] + hh]])} />; };
      const L = t.lines;
      const lab = t.kind === 'fog' ? L.map((l, i) => <text key={i} x={cx} y={cy + (L.length === 1 ? 4 : -2 + 14 * i)} className="nm">{l}</text>)
        : [...L.map((l, i) => <text key={i} x={cx} y={cy + (L.length === 1 ? 1 : -7 + 12 * i)} className="nm">{l}</text>), t.year ? <text key="y" x={cx} y={cy + (L.length === 1 ? 14 : 17)} className="yr">{t.year}</text> : null];
      const isCur = t.kind === 'cur';
      return <g key={t.id} className={`bt k-${t.kind}${t.rel ? ' r-' + t.rel : ''}`} data-k={isCur ? undefined : t.id} tabIndex={isCur ? undefined : 0} role={isCur ? undefined : 'button'}
        aria-label={`${titles.get(t.id) || L.join(' ')} (${isCur ? 'this paper' : t.kind === 'fog' ? 'open direction' : t.rel})`}>
        <g className="lift">{t.kind !== 'fog' && <>{side(2, 3, 's1')}{side(1, 2, 's2')}{side(0, 1, 's3')}</>}<polygon className="top" points={pts(top)} />{lab}</g>
      </g>;
    })}
    {openSel && openSel.from.map(f => byId.get(f)).filter(o => o && hexDist(cur!, o) === 1).map(o => {
      const ax = cur!.px, ay = cur!.py, bx = o!.px, by = o!.py - o!.lift;
      return <g key={o!.id}><line className="lk" x1={ax + (bx - ax) * .3} y1={ay + (by - ay) * .3} x2={ax + (bx - ax) * .7} y2={ay + (by - ay) * .7} /><circle className="lkd" cx={ax + (bx - ax) * .7} cy={ay + (by - ay) * .7} r={3} /></g>;
    })}
    {cur && <polygon className="selring" points={pts(hexPts(cur.px, cur.py - cur.lift, S + 2.5))} />}
  </g>;
}

/* ------------------------------------------------------------------ sim */
function SimG({ spec, ref0 }: { spec: SimSpec; ref0: number }) {
  const ri = Math.floor(ref0 / 8), rj = ref0 % 8;
  const cells: React.ReactNode[] = [];
  for (let p = 0; p < 64; p++) { const i = Math.floor(p / 8), j = p % 8; cells.push(<rect key={p} className={`pcell seg-${toyRegion(p)}`} data-p={p} x={16 + j * 24} y={52 + i * 24} width={24} height={24} />); }
  return <g transform="translate(0,22)">
    <T x={16} y={40} c="th">Toy image, cut into {spec.unit}es</T>
    {cells}
    <rect x={16 + rj * 24 + 1} y={52 + ri * 24 + 1} width={22} height={22} className="s-ink" style={{ strokeWidth: 2.5, pointerEvents: 'none' }} />
    {spec.regions.map((r, i) => <g key={i}><rect x={16 + (i % 2) * 96} y={258 + Math.floor(i / 2) * 16} width={10} height={10} className={`seg-${i}`} /><T x={30 + (i % 2) * 96} y={267 + Math.floor(i / 2) * 16} c="tm">{r}</T></g>)}
    {spec.modes.map((m, q) => {
      const x = 226 + q * 112, grid: React.ReactNode[] = [];
      for (let p = 0; p < 64; p++) { const i = Math.floor(p / 8), j = p % 8; grid.push(<rect key={p} x={x + j * 13} y={52 + i * 13} width={12} height={12} className={m.accent ? 'f-acc' : 'f-ink'} fillOpacity={simValue(m, q, ref0, p).toFixed(2)} />); }
      const c = simContrast(m, q, ref0), y = 196 + q * 24, w = Math.max(2, c * 200);
      return <g key={q}>
        <T x={x} y={40} c="tb">{m.label}</T>{grid}
        <rect x={x - 2} y={50} width={107} height={107} rx={2} className="s-mut" />
        <rect x={x + rj * 13 - 1} y={52 + ri * 13 - 1} width={14} height={14} className="s-ink" style={{ strokeWidth: 1.5 }} />
        <T x={226} y={y + 9}>{m.label}</T>
        <rect x={350} y={y} width={w} height={10} rx={2} className={m.accent ? 'f-acc' : 'f-ink'} />
        <T x={350 + w + 8} y={y + 9} c="tb">{c.toFixed(2)}</T>
      </g>;
    })}
    <T x={226} y={184} c="tm">Contrast: similarity inside the region minus outside</T>
  </g>;
}

/* ------------------------------------------------------------------ free */
function FreeG({ spec }: { spec: FreeSpec }) {
  return <g>{spec.items.map((it, i) => {
    const cls = it.accent ? 's-acc f-soft' : it.muted ? 's-mut f-sheet' : 's-ink f-sheet';
    const inner = it.kind === 'box' ? <><rect className="box" x={it.x} y={it.y} width={it.w ?? 100} height={it.h ?? 40} rx={5} style={it.accent ? { stroke: 'var(--accent)', fill: 'var(--accent-soft)' } : undefined} />{it.text && <T x={it.x + (it.w ?? 100) / 2} y={it.y + (it.h ?? 40) / 2 + 4} c={'tb' + (it.accent ? ' ta' : '')} a="middle">{it.text}</T>}</>
      : it.kind === 'circle' ? <><circle cx={it.x} cy={it.y} r={(it.w ?? 20) / 2} className={cls} />{it.text && <T x={it.x} y={it.y + 4} c="tb" a="middle">{it.text}</T>}</>
      : it.kind === 'arrow' ? <><line x1={it.x} y1={it.y} x2={it.x2 ?? it.x} y2={it.y2 ?? it.y} className={it.accent ? 's-acc' : 's-ink'} markerEnd={`url(#ah-${it.accent ? 'acc' : 'ink'})`} />{it.text && <T x={((it.x + (it.x2 ?? it.x)) / 2)} y={((it.y + (it.y2 ?? it.y)) / 2) - 6} c="tm halo" a="middle">{it.text}</T>}</>
      : <T x={it.x} y={it.y} c={it.accent ? 'ta tb' : it.muted ? 'tm' : ''}>{it.text}</T>;
    return it.id ? <Sel key={i} id={it.id} label={it.text || it.id}>{inner}</Sel> : <g key={i}>{inner}</g>;
  })}</g>;
}

/* ------------------------------------------------------------------ overlay marks */
function Marks({ items }: { items: Placed[] }) {
  return <g>{items.map((m, i) => <Step key={i} step={m.step}>{
    m.kind === 'badge' ? <g><rect x={m.x} y={m.y} width={m.w} height={17} rx={8.5} className="m-f" /><text x={m.x + m.w / 2} y={m.y + 12} className="tx tbd" textAnchor="middle">{m.text}</text></g>
    : m.kind === 'highlight' ? <rect x={m.box.x} y={m.box.y} width={m.box.w} height={m.box.h} rx={7} className="m-s" />
    : m.kind === 'trace' ? <path d={m.d} className="m-s" style={{ strokeWidth: 6, strokeOpacity: 0.45, strokeLinecap: 'round' }} />
    : m.kind === 'note' ? <g>{m.line && <line x1={m.line[0]} y1={m.line[1]} x2={m.line[2]} y2={m.line[3]} className="m-s" style={{ strokeWidth: 1.2 }} />}{m.lines.map((l, j) => <text key={j} x={m.x} y={m.y + j * 14} className="tx tk halo">{l}</text>)}</g>
    : m.kind === 'marker' ? <g><line x1={m.x} x2={m.x} y1={m.y1} y2={m.y2} className="m-s s-dash" /><text x={m.x + 5} y={m.y1 + 10} className="tx tk halo">{m.label}</text></g>
    : m.kind === 'callout' ? <g><rect x={m.box.x} y={m.box.y} width={m.box.w} height={m.box.h} rx={6} className="m-f" />{m.lines.map((l, j) => <text key={j} x={m.box.x + 12} y={m.box.y + 19 + j * 16} className="tx tl">{l}</text>)}</g>
    : <g><line x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} className="m-s" markerEnd="url(#ah-mark)" />{m.label && <text x={(m.x1 + m.x2) / 2} y={(m.y1 + m.y2) / 2 - 6} className="tx tk halo" textAnchor="middle">{m.label}</text>}</g>
  }</Step>)}</g>;
}

/* ------------------------------------------------------------------ stage */
export interface StageProps {
  spec: Diagram; vs?: ViewState; L?: LayoutResult; marks?: Placed[]; height?: number; reveal?: Reveal; still?: boolean;
  selectable?: Set<string>; onSelect?: (id: string | null) => void; onScrub?: (x: number) => void; onRef?: (p: number) => void; label?: string;
}
export function Stage(p: StageProps) {
  const vs = p.vs || {};
  const L = p.L || layout(p.spec, vs);
  const svg = useRef<SVGSVGElement>(null);
  const h = p.height ?? L.h;
  const selectable = p.selectable || new Set<string>();
  const svgX = (e: React.PointerEvent) => { const s = svg.current!; const pt = s.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = s.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()).x : 0; };
  const onPointer = (e: React.PointerEvent) => {
    const t = e.target as Element;
    if (p.spec.type === 'sim') { const c = t.closest('.pcell') as SVGElement | null; if (c) p.onRef?.(Number(c.dataset.p)); return; }
    if (L.type === 'chart' && t.closest('.scrub')) p.onScrub?.(clamp((svgX(e) - L.chart.x0) / L.chart.pw));
  };
  const onClick = (e: React.MouseEvent) => {
    if (p.still) return;
    const el = (e.target as Element).closest('[data-k]') as SVGElement | null;
    if (el) p.onSelect?.(el.dataset.k!);
    else if (p.spec.type === 'landscape') p.onSelect?.(null);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = (e.target as Element).closest('[data-k]') as SVGElement | null;
    if (el && e.target === el) { e.preventDefault(); p.onSelect?.(el.dataset.k!); }
  };
  const sel = vs.sel ?? null;
  const body = (() => {
    switch (L.type) {
      case 'flow': return <FlowG fl={L.flow} />;
      case 'pipeline': return <PipelineG pl={L.pipe} spec={p.spec} />;
      case 'chart': return <ChartG cl={L.chart} spec={p.spec as ChartSpec} x={vs.x ?? 1} />;
      case 'matrix': return <MatrixG ml={L.matrix} panels={(p.spec as any).panels} />;
      case 'compare': return <CompareG cl={L.compare} columns={(p.spec as any).columns} />;
      case 'landscape': return <LandscapeG ll={L.land} spec={p.spec as LandscapeSpec} />;
      case 'sim': return <SimG spec={p.spec as SimSpec} ref0={vs.ref ?? 27} />;
      case 'free': return <FreeG spec={p.spec as FreeSpec} />;
    }
  })();
  return <RCtx.Provider value={{ sel, selectable, reveal: p.reveal, still: p.still }}>
    <svg ref={svg} className="stage" viewBox={`0 0 560 ${h}`} role="group" aria-label={p.label || p.spec.head}
      onPointerMove={onPointer} onPointerDown={onPointer} onClick={onClick} onKeyDown={onKey}>
      <g className={p.still ? 'still' : undefined}>{body}</g>
      {p.marks && <Marks items={p.marks} />}
      {p.spec.caveat && <T x={16} y={h - 10} c="tm">{p.spec.caveat}</T>}
    </svg>
  </RCtx.Provider>;
}

export function Defs() {
  return <svg className="defs" aria-hidden="true" focusable="false"><defs>
    <pattern id="hatch2" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="7" className="hatch2-l" /></pattern>
    {['ink', 'acc', 'mut', 'mark'].map(k => <marker key={k} id={`ah-${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1.5,1.5 L8.5,5 L1.5,8.5" className={`mk-${k}`} /></marker>)}
  </defs></svg>;
}
