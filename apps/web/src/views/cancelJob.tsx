// Cancelling a queued build or training batch: warn first (only CANCEL_REFUND_PERCENT comes back), tell after.

import { CANCEL_REFUND_PERCENT, RESOURCE_IDS, refundOf } from '@clanfire/engine';
import type { CancelResponse, Resources } from '@clanfire/engine';
import { useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { RESOURCE_NAME } from '../icons.ts';
import { useConfirm } from '../tribe/Confirm.tsx';

function amounts(r: Resources): string {
  const parts = RESOURCE_IDS.filter((id) => r[id] > 0).map((id) => `${formatInt(r[id])} ${RESOURCE_NAME[id].toLowerCase()}`);
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

export function useCancelJob() {
  const { village, applyVillage, refresh, toast } = useGame();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);

  /** `paid` is what the job cost (or its untrained rest); the dialog shows what comes back and what is lost. */
  async function run(what: string, paid: Resources, call: () => Promise<CancelResponse>, reservesRenown = false) {
    if (busy) return;
    const back = refundOf(paid);
    const ok = await confirm({
      title: `Cancel ${what}?`,
      body: (
        <>
          <p>
            Refund {CANCEL_REFUND_PERCENT}%: <strong>{amounts(back)}</strong>
          </p>
          {reservesRenown && <p>Renown refunded in full.</p>}
        </>
      ),
      confirmLabel: 'Cancel it',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await call();
      applyVillage(res.village);
      const renown = res.renownRefund ? ` +${formatInt(res.renownRefund)} Renown.` : '';
      toast(`Cancelled ${what}. Back: ${amounts(res.refund)}.${renown}`);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return {
    busy,
    dialog,
    cancelBuild: (what: string, paid: Resources, index: number) => run(what, paid, () => api.cancelBuild(village.id, index)),
    cancelResearch: (what: string, paid: Resources, index: number) =>
      run(what, paid, () => api.cancelResearch(village.id, index)),
    cancelTrain: (what: string, paid: Resources, building: string, index: number) =>
      run(what, paid, () => api.cancelTrain(village.id, building, index), building === 'bannerhall'),
  };
}
