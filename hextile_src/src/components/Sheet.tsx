import type { SheetMode } from '../game/state';
import { css } from '../world/colour';
import { WORLD } from '../world/world';
import { ExpeditionsBody } from '../sheets/ExpeditionsSheet';
import { GradientsBody } from '../sheets/GradientsSheet';
import { LogBody } from '../sheets/LogSheet';
import { OpenBody, PaperBody, PaperFoot } from '../sheets/PaperSheet';
import { ReportBody } from '../sheets/ReportSheet';
import { CloseIcon, Hx } from './bits';
import { useGame } from './context';

const TITLES: Record<Exclude<SheetMode, 'paper'>, string> = { exp: 'Expeditions', log: 'Log', grad: 'Gradients', rep: 'Run report' };

/** The popup: a paper's first page, or the expeditions, log, gradients and run report. */
export function Sheet({ mode, pop, onClose }: { mode: SheetMode | null; pop: number; onClose(): void }) {
  const { game, view } = useGame();

  const t = WORLD.byId[game.cur];
  let title, content, foot = null;
  if (mode === 'paper') {
    if (t.kind === 'open') {
      title = <p className="sheet-title" id="sheet-title"><Hx c="var(--accent)" />Open ground</p>;
      content = <OpenBody t={t} />;
    } else {
      const read = !!game.read[t.id];
      title = <p className="sheet-title" id="sheet-title"><Hx c={read ? css(view.at[t.ti].col) : 'var(--rev)'} />{read ? 'Read' : 'Revealed, not read yet'}</p>;
      content = <PaperBody t={t} />;
      foot = <footer className="sheet-foot"><PaperFoot t={t} /></footer>;
    }
  } else if (mode) {
    title = <p className="sheet-title big" id="sheet-title">{TITLES[mode]}</p>;
    content = mode === 'exp' ? <ExpeditionsBody /> : mode === 'log' ? <LogBody /> : mode === 'grad' ? <GradientsBody /> : <ReportBody />;
  }
  return (
    /* keyed by pop: each open replays the pop-in and starts at the top, while
       re-renders in between (a lens toggled, a tile read) keep the scroll */
    <aside key={pop} className={'sheet' + (pop ? ' pop' : '')} role="dialog" aria-labelledby="sheet-title" hidden={!mode}>
      <header className="sheet-head">
        {title ?? <p className="sheet-title" id="sheet-title" />}
        <button type="button" className="x" aria-label="Close" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="sheet-body" tabIndex={0}>{content}</div>
      {foot}
    </aside>
  );
}
