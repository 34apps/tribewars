// War Chest (docs/GAME_DESIGN.md 18.2): account-wide gold for Chieftains only. WarChestProgress is the one-row bar (Banner Hall panel and
// the Chieftain panel); WarChestPayIn pays in what is missing from the current village. Both render nothing against a server without a chest.

import { useId, useState } from 'react';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { CHEST_WARNING, chestErrorText, chestMissing, chestPayInAmount } from '../chest.ts';
import { formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { useConfirm } from '../tribe/Confirm.tsx';
import { HEARTH_OUT_REASON } from '../villages.ts';

/** One row: "War Chest", a thin bar and "chest / price gold" (a filled "Ready" tag when the chest covers the next Chieftain). */
export function WarChestProgress() {
  const { chest } = useGame();
  if (!chest) return null;
  const ready = chestMissing(chest) === 0;
  const pct = Math.min(100, Math.round((chest.gold / Math.max(1, chest.chieftainPrice)) * 100));
  return (
    <div className="wc-prog">
      <span className="wc-label">War Chest</span>
      <span className="wc-bar" role="progressbar" aria-label="War Chest gold" aria-valuemin={0} aria-valuemax={chest.chieftainPrice} aria-valuenow={Math.min(chest.gold, chest.chieftainPrice)}>
        <span className="wc-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="wc-num">
        {formatInt(chest.gold)} / {formatInt(chest.chieftainPrice)} gold
      </span>
      {ready && <span className="wc-ready">Ready</span>}
    </div>
  );
}

/** One button: pays exactly what the next Chieftain still lacks (capped by this village's gold), after a confirm step. */
export function WarChestPayIn() {
  const { chest, village, live, applyChest, refresh, toast } = useGame();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  if (!chest) return null;
  const missing = chestMissing(chest);
  if (missing < 1) return null;

  const have = Math.floor(live.resources.gold + 1e-9);
  const amount = chestPayInAmount(missing, have);
  const reason = village.hearth ? HEARTH_OUT_REASON : amount < 1 ? 'No gold in this village' : null;

  async function payIn() {
    if (busy || reason) return;
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
      <button type="button" className="btn wc-go" disabled={busy || !!reason} onClick={() => void payIn()}>
        {reason === 'No gold in this village' ? reason : `Pay in ${formatInt(amount)} gold`}
      </button>
      {reason && reason !== 'No gold in this village' && <div className="why">{reason}</div>}
    </div>
  );
}
