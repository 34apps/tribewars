// War Chest (docs/GAME_DESIGN.md 18.2): account-wide gold for Chieftains only. WarChestProgress is the one-row bar against the WHOLE village price
// (Banner Hall page); WarChestPayIn is always there: an amount field, two quick fills and Pay in. Both render nothing against a server without a chest.

import { useId, useState } from 'react';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { CHEST_WARNING, chestErrorText, chestFillAmount, chestPayInReason, chestWholePrice, parseChestGold } from '../chest.ts';
import { formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { useConfirm } from '../tribe/Confirm.tsx';
import { HEARTH_OUT_REASON } from '../villages.ts';

/** One row: "War Chest", a thin bar and "chest / village price gold" (a filled "Ready" tag when the chest covers the whole price). */
export function WarChestProgress() {
  const { chest } = useGame();
  if (!chest) return null;
  const price = chestWholePrice(chest);
  const ready = chest.gold >= price;
  const pct = Math.min(100, Math.round((chest.gold / price) * 100));
  return (
    <div className="wc-prog">
      <span className="wc-label">War Chest</span>
      <span className="wc-bar" role="progressbar" aria-label="War Chest gold" aria-valuemin={0} aria-valuemax={price} aria-valuenow={Math.min(chest.gold, price)}>
        <span className="wc-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="wc-num">
        {formatInt(chest.gold)} / {formatInt(price)} gold
      </span>
      {ready && <span className="wc-ready">Ready</span>}
    </div>
  );
}

/** Always there: any whole amount from 1 to this village's gold, two quick fills, Pay in (confirm step, one way). */
export function WarChestPayIn() {
  const { chest, village, live, applyChest, refresh, toast } = useGame();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const id = useId();
  if (!chest) return null;

  const have = Math.floor(live.resources.gold + 1e-9);
  const fill = chestFillAmount(chest, have);
  const reason = chestPayInReason(text, have, !!village.hearth);
  const amount = parseChestGold(text, have);
  const plainReason = village.hearth ? HEARTH_OUT_REASON : have < 1 ? 'No gold in this village' : null;
  const quickOff = busy || !!plainReason;

  async function payIn() {
    if (busy || reason || amount === null) return;
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
      <div className="wc-pay-row">
        <label className="wc-pay-label" htmlFor={id}>
          Gold to pay in
        </label>
        <input
          id={id}
          className="wc-amount"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={`1 to ${formatInt(have)}`}
          value={text}
          disabled={busy || !!plainReason}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className="btn wc-go" disabled={busy || !!reason} title={reason ?? undefined} onClick={() => void payIn()}>
          Pay in
        </button>
      </div>
      <div className="wc-quick">
        {fill >= 1 && (
          <button type="button" className="btn btn-small" disabled={quickOff} onClick={() => setText(String(fill))}>
            Fill to next village ({formatInt(fill)})
          </button>
        )}
        <button type="button" className="btn btn-small" disabled={quickOff || have < 1} onClick={() => setText(String(have))}>
          All gold here ({formatInt(have)})
        </button>
      </div>
      {plainReason && <div className="why">{plainReason}</div>}
      <div className="muted wc-warn">{CHEST_WARNING}</div>
    </div>
  );
}
