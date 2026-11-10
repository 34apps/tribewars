// War Chest (docs/GAME_DESIGN.md 18.2): account-wide gold for Chieftains only. WarChestSummary shows the numbers (Banner Hall panel and
// the Chieftain panel); WarChestPayIn pays gold in from the current village. Both render nothing against a server without a chest.

import { useId, useState } from 'react';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { CHEST_WARNING, chestErrorText, chestMissing, chestPayInReason, parseChestGold } from '../chest.ts';
import { formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { useConfirm } from '../tribe/Confirm.tsx';
import { HEARTH_OUT_REASON } from '../villages.ts';

/** Chest gold, gold held by Chieftains, what the next Chieftain needs and what is missing. */
export function WarChestSummary({ compact = false }: { compact?: boolean }) {
  const { chest } = useGame();
  if (!chest) return null;
  const missing = chestMissing(chest);
  return (
    <dl className={`wc-ledger${compact ? ' is-compact' : ''}`} aria-label="War Chest">
      <div>
        <dt>{compact ? 'In chest' : 'In the chest'}</dt>
        <dd>{formatInt(chest.gold)}</dd>
      </div>
      <div>
        <dt>{compact ? 'Held' : 'Held by Chieftains'}</dt>
        <dd>{formatInt(chest.reserved)}</dd>
      </div>
      <div>
        <dt>{compact ? 'Next needs' : 'Next Chieftain needs'}</dt>
        <dd>{formatInt(chest.chieftainPrice)}</dd>
      </div>
      <div>
        <dt>{compact ? 'Missing' : 'Still missing'}</dt>
        <dd>{missing > 0 ? formatInt(missing) : 'None'}</dd>
      </div>
    </dl>
  );
}

/** Whole-number pay-in from this village, with a confirm step: the gold never comes back out. */
export function WarChestPayIn() {
  const { chest, village, live, applyChest, refresh, toast } = useGame();
  const { confirm, dialog } = useConfirm();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  if (!chest) return null;

  const have = Math.floor(live.resources.gold + 1e-9);
  const reason = chestPayInReason(text, have, !!village.hearth);
  const amount = parseChestGold(text, have);

  async function payIn() {
    if (busy || amount === null || reason) return;
    const ok = await confirm({
      title: `Pay ${formatInt(amount)} gold into the War Chest?`,
      body: <p>{CHEST_WARNING}</p>,
      confirmLabel: 'Pay in',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.chestDeposit(village.id, amount);
      applyChest(res.village, res.chest);
      setText('');
      toast(`${formatInt(amount)} gold paid into the War Chest`);
    } catch (e) {
      toast(e instanceof ApiRequestError ? chestErrorText(e.code, errorMessage(e)) : errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <div className="wc-pay">
      {dialog}
      <label className="field wc-field" htmlFor={inputId}>
        <span>Gold to pay in</span>
        <span className="wc-row">
          <input
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={`up to ${formatInt(have)}`}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value.replace(/[^\d]/g, '').slice(0, 9))}
          />
          <button type="button" className="btn wc-all" disabled={busy || have < 1} onClick={() => setText(String(have))}>
            All
          </button>
        </span>
      </label>
      <p className="why wc-warn">{CHEST_WARNING}</p>
      <button type="button" className="btn btn-primary wc-go" disabled={busy || !!reason} onClick={() => void payIn()}>
        Pay in{amount !== null ? ` ${formatInt(amount)}` : ''}
      </button>
      {reason && text.trim() !== '' && <div className="why">{reason}</div>}
      {village.hearth && !reason && <div className="why">{HEARTH_OUT_REASON}</div>}
    </div>
  );
}

/** Desktop Banner Hall: the chest as its own compact card in the right column (same card style as "What it does"). */
export function WarChestCard() {
  const { chest } = useGame();
  if (!chest) return null;
  return (
    <section className="fv-pn wc-card" aria-label="War Chest">
      <div className="fv-ph">
        <h2>War Chest</h2>
      </div>
      <div className="fv-ord">
        <p className="fv-desc">Gold for Chieftains only. It never comes back out; half returns if a Chieftain dies.</p>
        <WarChestSummary compact />
        <WarChestPayIn />
      </div>
    </section>
  );
}
