// Renown in the village view: a compact readout (desktop badge on the board, phone chip under the scene) and the card with
// the numbers. Renown limits how many villages a player may own (docs/GAME_DESIGN.md section 18.2). Display only: the
// server keeps the numbers; founding and taking villages is not built yet.

import { Icon } from '../../art/Icon.tsx';
import { ProgressBar } from '../../components/ui.tsx';
import { formatCompact, formatInt } from '../../format.ts';
import { useGame } from '../../game.ts';
import { renownProgress, renownToGo } from '../../renown.ts';

/** "Renown 120. Next village costs 300." for screen readers and tooltips. */
function summary(balance: number, next: number): string {
  return `Renown ${formatInt(balance)}. Next village costs ${formatInt(next)} Renown.`;
}

/** Desktop: a small pill in the corner of the board. Balance, and what the next village costs. Not interactive. */
export function RenownBadge() {
  const { renown } = useGame();
  return (
    <div className="vv-renown-badge" title={summary(renown.balance, renown.nextVillageCost)} role="group" aria-label={summary(renown.balance, renown.nextVillageCost)}>
      <Icon name="renown" size={26} />
      <span className="vv-renown-badge-text" aria-hidden="true">
        <strong>{formatInt(renown.balance)}</strong> Renown
        <span className="vv-renown-badge-next">next village: {formatInt(renown.nextVillageCost)}</span>
      </span>
    </div>
  );
}

/** Phone: a chip (icon, balance / next village's price) that opens the card in the bottom sheet. 44 px tall. */
export function RenownChip({ onClick }: { onClick: () => void }) {
  const { renown } = useGame();
  return (
    <button type="button" className="vv-renownchip" onClick={onClick} aria-label={`${summary(renown.balance, renown.nextVillageCost)} Open Renown details.`}>
      <Icon name="renown" size={22} />
      <span aria-hidden="true">
        <strong>{formatCompact(renown.balance)}</strong>
        <span className="vv-renownchip-next">/{formatCompact(renown.nextVillageCost)}</span>
      </span>
    </button>
  );
}

export function RenownCard() {
  const { renown } = useGame();
  const toGo = renownToGo(renown);
  return (
    <section className="vv-card renown" aria-labelledby="renown-title">
      <div className="renown-head">
        <Icon name="renown" size={28} />
        <h2 id="renown-title" className="vv-h2">
          Renown
        </h2>
        <span className="renown-bal">
          <strong>{formatInt(renown.balance)}</strong> to spend
        </span>
      </div>
      <dl className="renown-facts">
        <div>
          <dt>Earned</dt>
          <dd>{formatInt(renown.total)}</dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>{formatInt(renown.spent)}</dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd>{formatInt(renown.balance)}</dd>
        </div>
      </dl>
      <div className="renown-next">
        <span>
          Next village: <strong>{formatInt(renown.nextVillageCost)}</strong> Renown
        </span>
        <span className="renown-togo">{toGo > 0 ? `${formatInt(toGo)} to go` : 'Enough saved'}</span>
      </div>
      <ProgressBar value={renownProgress(renown)} label="Renown saved towards the next village" tone={toGo > 0 ? 'brand' : 'ok'} />
      <p className="renown-note">Earned by building, fighting, keeping troops at home (a little each day once beginner protection ends) and Feasts. Never lost.</p>
      <p className="renown-note renown-soon">Founding and taking villages: coming soon.</p>
    </section>
  );
}
