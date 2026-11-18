// Banner Hall page body (docs/GAME_DESIGN.md 18.2): the ONE home for Chieftains (owner 2026-11-18). Left: Feast and "How taking a village
// works". Right: the Chieftain card (train with a 1 / 2 / 3 choice, queue, War Chest, strike chains, villages being held).
// The server re-checks everything.

import { useState } from 'react';
import {
  BUILDINGS,
  CANCEL_REFUND_PERCENT,
  CHIEFTAIN_MAX_BATCH,
  CHIEFTAIN_MAX_QUEUED_BATCHES,
  FEAST_RENOWN,
  RESOURCE_IDS,
  UNITS,
  checkTrain,
  trainTimeMs,
} from '@clanfire/engine';
import type { Resources } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import { Cost } from '../../components/ui.tsx';
import { WarChestPayIn } from '../../components/WarChest.tsx';
import { formatDuration, formatInt, formatLeft } from '../../format.ts';
import { useGame } from '../../game.ts';
import { useLock } from '../../hooks/useLock.ts';
import { clampFeastCount, feastDiscountPercent, feastMaxCount, feastPrice, feastTotal, nextFeastDiscountPercent } from '../../renown.ts';
import { maxTrainable, reasonText, requirementText, unmetRequirements } from '../../rules.ts';
import { chestBatchPrice, chestMissing } from '../../chest.ts';
import { NEEDS_CHEST_TEXT } from '../../shortfall.ts';
import { HEARTH_OUT_REASON, chieftainBatchPrice, chieftainCountLabel, chieftainRenownNote, chieftainTrainingLine, chainText, takingSteps } from '../../villages.ts';
import { useCancelJob } from '../cancelJob.tsx';

function Tick({ ok }: { ok: boolean }) {
  return (
    <span className={`bh-tick ${ok ? 'is-ok' : 'is-no'}`} aria-label={ok ? 'Done' : 'Missing'}>
      {ok ? '✓' : '✗'}
    </span>
  );
}

export function BannerHallPanel() {
  const { live, village, settings, applyVillage, refresh, toast } = useGame();
  const { busy, begin, end } = useLock();
  const level = live.buildings.bannerhall;
  const [amount, setAmount] = useState('1');

  if (level < 1) {
    const unmet = unmetRequirements(live.buildings, BUILDINGS.bannerhall.requires);
    const building = live.buildQueue.some((j) => j.building === 'bannerhall');
    return (
      <div className="bh-cards">
        <section className="fv-pn bh-card" aria-label="Feast">
          <div className="fv-ph">
            <h2>Feast</h2>
          </div>
          <div className="bh-body">
            <p className="why bh-why">Throw a party: spend resources, earn Renown. Renown buys new villages.</p>
            <div className="bh-cost">
              <Cost cost={feastPrice(1)} />
              <span className="bh-gain">
                <Icon name="renown" size={18} className="inline-icon" /> +{FEAST_RENOWN} Renown
              </span>
            </div>
            <p className="why bh-why">
              {building ? 'Being built' : unmet.length > 0 ? `Needs ${requirementText(unmet)}` : 'Build it above'}
            </p>
          </div>
        </section>
      </div>
    );
  }

  const unit = feastPrice(level);
  const max = feastMaxCount(live.resources, unit);
  const typed = Number.parseInt(amount, 10);
  const count = clampFeastCount(Number.isFinite(typed) ? typed : 1, max);
  const total = feastTotal(Math.max(1, count), unit);
  const reason = max < 1 ? 'Need more resources' : null;
  const discount = feastDiscountPercent(level);
  const nextDiscount = nextFeastDiscountPercent(level);

  async function feast(count: number) {
    if (reason || count < 1 || !begin()) return;
    try {
      const res = await api.feast(village.id, count);
      applyVillage(res.village);
      setAmount('1');
      toast(`+${formatInt(res.gained)} Renown`);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      end();
      // Renown is part of the state, not of the village response: this one stays a full refresh.
      void refresh();
    }
  }

  return (
    <div className="bh-cards">
      <div className="bh-col">
        <section className="fv-pn bh-card" aria-label="Feast">
          <div className="fv-ph">
            <h2>Feast</h2>
          </div>
          <div className="bh-body">
            <p className="bh-left">
              {discount > 0 ? <strong>Feast price -{discount}%</strong> : <strong>Full Feast price</strong>}
              {nextDiscount !== null ? ` (level ${level + 1}: -${nextDiscount}%)` : ' (highest level)'}
            </p>
            <div className="bh-cost">
              <Cost cost={total} have={live.resources} />
              <span className="bh-gain">
                <Icon name="renown" size={18} className="inline-icon" /> +{formatInt(FEAST_RENOWN * Math.max(1, count))} Renown
              </span>
            </div>
            <div className="bh-btns">
              <label className="visually-hidden" htmlFor="bh-amount">
                Number of Feasts
              </label>
              <input
                id="bh-amount"
                className="bh-amount"
                type="number"
                inputMode="numeric"
                min={1}
                max={Math.max(1, max)}
                step={1}
                value={amount}
                disabled={max < 1 || busy}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => setAmount(String(Math.max(1, count)))}
              />
              <button type="button" className="btn bh-max-btn" disabled={max < 1 || busy} onClick={() => setAmount(String(Math.max(1, max)))}>
                Max{max > 0 ? ` ${formatInt(max)}` : ''}
              </button>
              <button type="button" className="btn btn-primary bh-go bh-feast" disabled={!!reason || busy} onClick={() => void feast(count)}>
                <Icon name="renown" size={22} /> Feast{count > 1 ? ` ×${formatInt(count)}` : ''}
              </button>
            </div>
            {reason && <p className="why bh-why">{reason}</p>}
          </div>
        </section>

        <section className="fv-pn bh-card" aria-label="How taking a village works">
          <div className="fv-ph">
            <h2>How taking a village works</h2>
          </div>
          <ol className="bh-steps">
            {takingSteps(settings).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </section>
      </div>

      <ChieftainCard />
    </div>
  );
}

/** The Chieftain card: everything about Chieftains in one place. */
function ChieftainCard() {
  const { live, now, village, renown, chest, chains, holds, settings, applyVillage, refresh, toast, showOnMap } = useGame();
  const cancel = useCancelJob();
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const queue = live.trainQueues.bannerhall;
  const def = UNITS.chieftain;
  const owned = renown.villages;
  const out = renown.chieftains ?? 0;

  const batchRenown = chieftainBatchPrice(renown, count, settings);
  const batchChest = chest ? chestBatchPrice(owned, out, count, settings) : 0;
  const renownOk = renown.balance >= batchRenown;
  const chestOk = !chest || chest.gold >= batchChest;
  const batchCost = Object.fromEntries(RESOURCE_IDS.map((r) => [r, def.cost[r] * count])) as Resources;
  const lacking = RESOURCE_IDS.filter((r) => batchCost[r] > 0 && Math.floor(live.resources[r] + 1e-9) < batchCost[r]);
  const check = checkTrain(live, 'chieftain', count, now, settings);
  const perUnit = trainTimeMs('chieftain', live, settings);
  const cap = Math.min(CHIEFTAIN_MAX_BATCH, maxTrainable(live, 'chieftain', now, settings));

  let reason: string | null = null;
  if (village.hearth) reason = HEARTH_OUT_REASON;
  else if (queue.length >= CHIEFTAIN_MAX_QUEUED_BATCHES) reason = 'Queue full';
  else if (!check.ok) reason = reasonText(check);
  else if (!renownOk) reason = `Need ${formatInt(batchRenown)} Renown`;
  else if (!chestOk) reason = NEEDS_CHEST_TEXT;

  async function train() {
    if (busy || reason) return;
    setBusy(true);
    try {
      applyVillage(await api.train(village.id, 'chieftain', count));
      toast(`${formatInt(count)} × ${def.name}: ${formatInt(batchRenown)} Renown reserved`);
      setCount(1);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const home = live.troops.chieftain ?? 0;
  const away = live.away.chieftain ?? 0;
  const inTraining = queue.reduce((n, j) => n + j.count - j.done, 0);
  const trainingLine = chieftainTrainingLine(queue, now);
  const chestPct = chest ? Math.min(100, Math.round((chest.gold / Math.max(1, batchChest)) * 100)) : 0;

  return (
    <section className="fv-pn bh-card bh-chief" aria-label="Chieftain">
      {cancel.dialog}
      <div className="fv-ph">
        <h2>Chieftains</h2>
        <span className="fv-mut bh-counts">
          {formatInt(home)} at home · {formatInt(away)} away · {formatInt(inTraining)} in training
        </span>
      </div>
      <div className="bh-body">
        {trainingLine && <p className="bh-training">{trainingLine}</p>}
        {queue.length > 0 && (
          <ul className="bh-queue">
            {queue.map((job, i) => {
              const left = job.count - job.done;
              const endAt = job.startAt + job.count * job.perUnitMs;
              return (
                <li key={`${job.startAt}-${i}`}>
                  <span>
                    {formatInt(job.count)} × {def.name} · {now >= job.startAt ? formatDuration(endAt - now) : `in ${formatDuration(job.startAt - now)}`}
                  </span>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={cancel.busy}
                    title={`${CANCEL_REFUND_PERCENT}% back, Renown in full`}
                    onClick={() => {
                      const paid = Object.fromEntries(RESOURCE_IDS.map((r) => [r, def.cost[r] * left])) as Resources;
                      void cancel.cancelTrain(`${formatInt(left)} × ${def.name}`, paid, 'bannerhall', i);
                    }}
                  >
                    Cancel
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="bh-train">
          <p className="bh-why" id="bh-count-label">
            {chieftainCountLabel()}
          </p>
          <div className="bh-count" role="group" aria-labelledby="bh-count-label">
            {Array.from({ length: CHIEFTAIN_MAX_BATCH }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" className="btn bh-count-btn" aria-pressed={count === n} disabled={busy} onClick={() => setCount(n)}>
                <b>{n}</b>
                <span>
                  {formatInt(chieftainBatchPrice(renown, n, settings))} Renown
                  {chest ? ` · ${formatInt(chestBatchPrice(owned, out, n, settings))} gold` : ''}
                </span>
              </button>
            ))}
          </div>
          <p className="muted bh-fine" title={chieftainRenownNote()}>
            Each one costs more than the last. {formatDuration(perUnit * count)} to train{cap > 0 && cap < count ? ` · you can afford ${cap}` : ''}.
          </p>
        </div>

        <ul className="bh-list">
          <li className="bh-row">
            <Tick ok={renownOk} />
            <span className="bh-name">Renown (from Feasts and battles)</span>
            <span className="bh-num">
              {formatInt(renown.balance)} / {formatInt(batchRenown)}
            </span>
          </li>
          {chest && (
            <li className="bh-row">
              <Tick ok={chestOk} />
              <span className="bh-name">War Chest gold</span>
              <span className="bh-num">
                {formatInt(chest.gold)} / {formatInt(batchChest)}
              </span>
              <span className="bh-bar" role="progressbar" aria-label="War Chest gold" aria-valuemin={0} aria-valuemax={batchChest} aria-valuenow={Math.min(chest.gold, batchChest)}>
                <span className="bh-fill" style={{ width: `${chestPct}%` }} />
              </span>
            </li>
          )}
          {lacking.length > 0 && (
            <li className="bh-row">
              <Tick ok={false} />
              <span className="bh-name">Resources</span>
              <span className="bh-num">{lacking.map((r) => `${formatInt(batchCost[r])} ${r}`).join(' · ')}</span>
            </li>
          )}
        </ul>
        <WarChestPayIn />
        <button type="button" className="btn btn-primary bh-go bh-train-btn" disabled={!!reason || busy} onClick={() => void train()}>
          <Icon name="chieftain" size={22} /> Train {count} {count === 1 ? 'Chieftain' : 'Chieftains'}
        </button>
        {reason && <p className="why bh-why">{reason}</p>}

        {(chains.length > 0 || holds.length > 0) && (
          <ul className="bh-live" aria-label="Taking villages">
            {chains.map((c) => (
              <li key={`c${c.villageId}`}>
                <button type="button" className="bh-link" onClick={() => showOnMap(c.x, c.y)}>
                  {c.name}
                </button>
                : {chainText({ have: c.have, need: c.need, endsAt: c.endsAt }, now) ?? `${c.have} of ${c.need} Chieftains banked`}
                {c.need > c.have ? ` · send ${c.need - c.have} more` : ''}
              </li>
            ))}
            {holds.map((h) => (
              <li key={`h${h.villageId}`}>
                Holding{' '}
                <button type="button" className="bh-link" onClick={() => showOnMap(h.x, h.y)}>
                  {h.name}
                </button>
                : {h.running ? `${formatLeft(h.holdMsLeft)} left` : 'paused, needs more occupiers'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
