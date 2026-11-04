// Chieftain training in the Banner Hall (docs/GAME_DESIGN.md 18.2, step 2). On top of the resources a Chieftain reserves Renown
// when training starts (the price of the village he will found or take). Used in the Army tab and in the Banner Hall panel of
// the village view. The engine decides what the button allows; the server re-checks everything.

import { BUILDINGS, CANCEL_REFUND_PERCENT, CHIEFTAIN_MAX_BATCH, CHIEFTAIN_MAX_QUEUED_BATCHES, RESOURCE_IDS, UNITS, checkTrain, trainTimeMs } from '@clanfire/engine';
import type { Resources, TrainJob } from '@clanfire/engine';
import { useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { formatClock, formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { maxTrainable, reasonText, requirementText, unmetRequirements } from '../rules.ts';
import { useCancelJob } from '../views/cancelJob.tsx';
import { chieftainBatchPrice, chieftainRenownNote, chieftainsAffordable, nextChieftainPrice } from '../villages.ts';
import { Cost, ProgressBar } from './ui.tsx';
import '../villages.css';

const def = UNITS.chieftain;

function BatchRow({ job, onCancel, disabled }: { job: TrainJob; onCancel: () => void; disabled: boolean }) {
  const { now } = useGame();
  const total = job.count * job.perUnitMs;
  const endAt = job.startAt + total;
  const started = now >= job.startAt;
  return (
    <li className="job">
      <div className="job-head">
        <span className="job-name">
          <Icon name="chieftain" size={20} className="inline-icon" /> {formatInt(job.count)} × {def.name}
          <span className="muted"> ({job.done}/{job.count})</span>
        </span>
        <span className="job-time">{started ? <strong>{formatDuration(endAt - now)}</strong> : <span className="muted">starts in {formatDuration(job.startAt - now)}</span>}</span>
      </div>
      <ProgressBar value={(now - job.startAt) / total} label={`${def.name} batch progress`} />
      <div className="job-foot muted">Done {formatClock(endAt, now)}</div>
      <button type="button" className="btn btn-small" disabled={disabled} onClick={onCancel}>
        Cancel ({CANCEL_REFUND_PERCENT}% back, Renown in full)
      </button>
    </li>
  );
}

/** The whole panel. `heading` false hides the title (the Banner Hall panel has its own). */
export function ChieftainPanel({ heading = true }: { heading?: boolean }) {
  const { live, now, settings, village, renown, applyVillage, refresh, toast, navigate } = useGame();
  const cancel = useCancelJob();
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const level = live.buildings.bannerhall;
  const queue = live.trainQueues.bannerhall;

  if (level < 1) {
    const unmet = unmetRequirements(live.buildings, BUILDINGS.bannerhall.requires);
    return (
      <section className="card training" aria-labelledby="chief-title">
        <h2 id="chief-title" className="card-title">
          <Icon name="chieftain" size={24} className="inline-icon" /> {def.name}
        </h2>
        <div className="empty-state">
          <p>Build the {BUILDINGS.bannerhall.name} first: it trains the {def.name}, who founds new villages and puts out the hearths of abandoned ones.</p>
          {unmet.length > 0 && <p className="muted">Requires {requirementText(unmet)}.</p>}
          <button className="btn btn-small" onClick={() => navigate('village')}>
            Go to Village
          </button>
        </div>
      </section>
    );
  }

  const price = nextChieftainPrice(renown);
  const batchPrice = chieftainBatchPrice(renown, count);
  const reserved = renown.reserved ?? 0;
  const perUnit = trainTimeMs('chieftain', live, settings);
  const maxByResources = Math.min(CHIEFTAIN_MAX_BATCH, maxTrainable(live, 'chieftain', now, settings));
  const maxByRenown = chieftainsAffordable(renown, CHIEFTAIN_MAX_BATCH);
  const cap = Math.min(maxByResources, maxByRenown);
  const check = checkTrain(live, 'chieftain', count, now, settings);
  const batchCost = Object.fromEntries(RESOURCE_IDS.map((r) => [r, def.cost[r] * count])) as Resources;

  let reason: string | null = null;
  if (queue.length >= CHIEFTAIN_MAX_QUEUED_BATCHES) reason = 'One batch at a time: wait for the queue or cancel it';
  else if (!check.ok) reason = reasonText(check);
  else if (batchPrice > renown.balance) reason = `Needs ${formatInt(batchPrice)} Renown, you have ${formatInt(renown.balance)}`;

  async function train() {
    if (busy || reason) return;
    setBusy(true);
    try {
      applyVillage(await api.train(village.id, 'chieftain', count));
      toast(`Training ${formatInt(count)} ${def.name}${count === 1 ? '' : 's'}. ${formatInt(batchPrice)} Renown reserved.`);
      setCount(1);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <section className="card training" aria-labelledby="chief-title">
      {cancel.dialog}
      <h2 id="chief-title" className={heading ? 'card-title' : 'visually-hidden'}>
        <Icon name="chieftain" size={24} className="inline-icon" /> {def.name}
      </h2>
      <p className="building-desc">{def.description}</p>

      {queue.length > 0 && (
        <div className="subsection">
          <h3 className="subtitle">
            Training queue <span className="muted">{queue.length}/{CHIEFTAIN_MAX_QUEUED_BATCHES}</span>
          </h3>
          <ol className="job-list">
            {queue.map((job, i) => (
              <BatchRow
                key={`${job.startAt}-${i}`}
                job={job}
                disabled={cancel.busy}
                onCancel={() => {
                  const left = job.count - job.done;
                  const paid = Object.fromEntries(RESOURCE_IDS.map((r) => [r, def.cost[r] * left])) as Resources;
                  void cancel.cancelTrain(`${formatInt(left)} × ${def.name}`, paid, 'bannerhall', i);
                }}
              />
            ))}
          </ol>
        </div>
      )}

      <dl className="chief-ledger" aria-label="Renown and Chieftains">
        <div>
          <dt>Renown to spend</dt>
          <dd>{formatInt(renown.balance)}</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{formatInt(reserved)}</dd>
        </div>
        <div>
          <dt>Next Chieftain</dt>
          <dd>{formatInt(price)} Renown</dd>
        </div>
        <div>
          <dt>Chieftains now</dt>
          <dd>{formatInt(renown.chieftains ?? 0)}</dd>
        </div>
      </dl>

      <div className="building-cost">
        <Cost cost={def.cost} have={live.resources} />
        <span className="chief-price" title="Renown reserved per Chieftain">
          <Icon name="renown" size={18} className="inline-icon" /> {formatInt(price)}
        </span>
        <span className="time" title="Time per Chieftain">
          <Icon name="time" size={18} className="inline-icon" /> {formatDuration(perUnit)} each
        </span>
      </div>

      <div className="train-row">
        <span className="chief-count" role="group" aria-label="How many Chieftains">
          {Array.from({ length: CHIEFTAIN_MAX_BATCH }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" className="btn" aria-pressed={count === n} disabled={busy} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </span>
        <button className="btn btn-primary" onClick={() => void train()} disabled={!!reason || busy}>
          Train
        </button>
      </div>
      <div className="muted batch-preview">
        {count} × <Cost cost={batchCost} have={live.resources} /> · <Icon name="renown" size={16} className="inline-icon" /> {formatInt(batchPrice)} Renown ·{' '}
        {formatDuration(perUnit * count)}
        {cap > 0 ? ` · you can afford ${cap}` : ''}
      </div>
      {reason && <div className="why">{reason}</div>}
      <p className="chief-note muted">{chieftainRenownNote()}</p>
    </section>
  );
}
