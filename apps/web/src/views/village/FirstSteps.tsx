// First steps (docs/GAME_DESIGN.md section 20): the starter-task card (desktop side column, phone bottom sheet) and the slim
// phone bar. The server decides what is done and what a claim adds; this shows it and calls the two endpoints.

import { useState } from 'react';
import type { BuildingId, FirstStepDto } from '@clanfire/engine';
import { storageCap } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { Mags } from '../../art/Mags.tsx';
import { ProgressBar, Cost } from '../../components/ui.tsx';
import {
  FIRST_STEP_LABEL,
  FIRST_STEP_TARGET,
  addedText,
  claimableSteps,
  doneCount,
  firstStepsVisible,
  nextOpenStep,
  wouldOverflow,
} from '../../firstSteps.ts';
import { useGame } from '../../game.ts';

/** Claim + hide for the village shown now, with the "some won't fit" check against its stock and storage. */
function useFirstSteps(onShowBuilding: (id: BuildingId) => void) {
  const { village, live, firstSteps, applyFirstSteps, applyVillage, refresh, toast, navigate } = useGame();
  const [busy, setBusy] = useState<string | null>(null);
  const cap = storageCap(live);

  const overflows = (s: FirstStepDto) => wouldOverflow(s.reward, live.resources, cap);

  async function claim(s: FirstStepDto) {
    if (busy) return;
    setBusy(s.id);
    try {
      const r = await api.claimFirstStep(s.id, village.id);
      applyVillage(r.village);
      applyFirstSteps(r.firstSteps);
      toast(`${FIRST_STEP_LABEL[s.id]}: added ${addedText(r.added)} to ${village.name}.`);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
      void refresh();
    } finally {
      setBusy(null);
    }
  }

  async function hide() {
    if (busy) return;
    setBusy('hide');
    try {
      applyFirstSteps(await api.setFirstStepsHidden(true));
      toast('First steps hidden. Bring them back in Settings.');
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  function show(s: FirstStepDto) {
    const t = FIRST_STEP_TARGET[s.id];
    if (t.kind === 'building') onShowBuilding(t.id);
    else navigate(t.tab);
  }

  return { firstSteps, busy, overflows, claim: (s: FirstStepDto) => void claim(s), hide: () => void hide(), show };
}

const HELP =
  'Steps tick themselves when you start them. Claim adds the reward to the village you are looking at. Anything your storehouse cannot hold is lost. Rewards never expire.';

/** The full card. `onShowBuilding` selects a building in the village (panel on desktop, sheet on phones). */
export function FirstStepsCard({ onShowBuilding, sheet = false }: { onShowBuilding: (id: BuildingId) => void; sheet?: boolean }) {
  const { firstSteps, busy, overflows, claim, hide, show } = useFirstSteps(onShowBuilding);
  if (!firstStepsVisible(firstSteps)) return null;
  const total = firstSteps.steps.length;
  const done = doneCount(firstSteps);
  const next = nextOpenStep(firstSteps);
  return (
    <section className={`vv-card fs-card${sheet ? ' is-sheet' : ''}`} aria-labelledby="fs-title">
      <div className="fs-head">
        <Mags size={40} className="fs-mags" />
        <div className="title-row fs-title-row">
          <h2 id="fs-title" className="vv-h2 card-title">
            First steps
          </h2>
          <span className="fs-count" aria-label={`${done} of ${total} done`}>
            {done} / {total}
          </span>
          <details className="help-pop">
            <summary aria-label="About first steps">?</summary>
            <p className="small">{HELP}</p>
          </details>
        </div>
        {!sheet && (
          <button type="button" className="fs-hide" onClick={hide} disabled={busy !== null}>
            Hide
          </button>
        )}
      </div>
      <ProgressBar value={done / total} label={`First steps: ${done} of ${total} done`} />
      {next ? (
        <div className="fs-next">
          <div className="fs-next-text">
            <span className="fs-next-tag">Next</span>
            <strong>{FIRST_STEP_LABEL[next.id]}</strong>
            <Cost cost={next.reward} />
          </div>
          <button type="button" className="btn btn-small fs-show" onClick={() => show(next)}>
            Show me
          </button>
        </div>
      ) : (
        <p className="fs-next fs-all-done">Everything done. Claim your rewards below.</p>
      )}
      <ol className="fs-list">
        {firstSteps.steps.map((s, i) => {
          const claimable = s.done && !s.claimed;
          return (
            <li key={s.id} className={`fs-row${s.claimed ? ' is-claimed' : ''}${claimable ? ' is-claimable' : ''}`}>
              <span className="fs-mark" aria-hidden="true">
                {s.claimed ? '✓' : i + 1}
              </span>
              <span className="fs-row-text">
                <span className="fs-row-label">
                  {FIRST_STEP_LABEL[s.id]}
                  {s.claimed && <span className="visually-hidden"> (claimed)</span>}
                </span>
                {!s.claimed && <Cost cost={s.reward} />}
                {claimable && overflows(s) && <span className="fs-warn">Some won&apos;t fit</span>}
              </span>
              {claimable && (
                <button type="button" className="btn btn-primary btn-small fs-claim" onClick={() => claim(s)} disabled={busy !== null}>
                  {busy === s.id ? '...' : 'Claim'}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Phone: a slim bar under the strips and above the village. Tap opens the card; Claim takes the first waiting reward. */
export function FirstStepsBar({ onOpen }: { onOpen: () => void }) {
  const { firstSteps, busy, claim } = useFirstSteps(() => undefined);
  if (!firstStepsVisible(firstSteps)) return null;
  const total = firstSteps.steps.length;
  const done = doneCount(firstSteps);
  const next = nextOpenStep(firstSteps);
  const waiting = claimableSteps(firstSteps);
  const line = next ? FIRST_STEP_LABEL[next.id] : `${done} done`;
  return (
    <div className="fs-bar">
      <button type="button" className="fs-bar-main" onClick={onOpen} aria-label={`First steps, ${done} of ${total} done. ${next ? `Next: ${line}.` : ''} Open details.`}>
        <Mags size={30} className="fs-mags" />
        <span className="fs-bar-text" aria-hidden="true">
          <strong>
            First steps {done} / {total}
          </strong>
          <span className="fs-bar-next">{next ? `Next: ${line}` : line}</span>
        </span>
      </button>
      {waiting[0] && (
        <button type="button" className="btn btn-primary btn-small fs-claim" onClick={() => claim(waiting[0]!)} disabled={busy !== null}>
          {busy === waiting[0].id ? '...' : waiting.length > 1 ? `Claim (${waiting.length})` : 'Claim'}
        </button>
      )}
    </div>
  );
}
