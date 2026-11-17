import { useCallback, useState } from 'react';
import type { SendAgainDto, Units } from '@clanfire/engine';
import { useGame } from '../game.ts';
import { decideAgain, homeTroops, sendAgain } from '../raidAgain.ts';
import type { AgainDecision } from '../raidAgain.ts';
import { useLock } from './useLock.ts';

/** What the "Raid again" note under a report shows. One report at a time. */
export type AgainView =
  | { reportId: number; again: SendAgainDto; phase: 'asking'; decision: Exclude<AgainDecision, { kind: 'send' }> }
  | { reportId: number; again: SendAgainDto; phase: 'sent'; text: string; movementId: number }
  | { reportId: number; again: SendAgainDto; phase: 'error'; text: string };

export interface RaidAgainCtl {
  view: AgainView | null;
  busy: boolean;
  /** Press on a report: sends at once when every troop is home, else shows what is missing (nothing is sent). */
  press: (reportId: number, again: SendAgainDto) => void;
  /** "Send what is there" in the missing-troops note. */
  sendRest: () => void;
  /** Cancel / dismiss the note. */
  close: () => void;
}

/**
 * "Raid again" for the Reports pages. One press is one request (useLock): the troops are compared with what is at home in the
 * report's sending village (from the state the client already holds), and the normal send call does the rest; the server
 * re-checks everything and its message is shown as it is.
 */
export function useRaidAgain(): RaidAgainCtl {
  const { villages, settings, now, applySend } = useGame();
  const lock = useLock();
  const [view, setView] = useState<AgainView | null>(null);

  const run = useCallback(
    async (reportId: number, again: SendAgainDto, units: Partial<Units>) => {
      if (!lock.begin()) return;
      setView(null);
      try {
        const out = await sendAgain(again, units, now);
        if (out.ok) {
          applySend(out.response);
          setView({ reportId, again, phase: 'sent', text: out.text, movementId: out.response.movement.id });
        } else {
          setView({ reportId, again, phase: 'error', text: out.text });
        }
      } finally {
        lock.end();
      }
    },
    [lock, applySend, now],
  );

  const press = useCallback(
    (reportId: number, again: SendAgainDto) => {
      const decision = decideAgain(again, homeTroops(villages, again.fromVillageId, now, settings));
      if (decision.kind === 'send') void run(reportId, again, decision.units);
      else setView({ reportId, again, phase: 'asking', decision });
    },
    [villages, settings, now, run],
  );

  const sendRest = useCallback(() => {
    if (view?.phase !== 'asking' || view.decision.kind !== 'partial') return;
    void run(view.reportId, view.again, view.decision.units);
  }, [view, run]);

  const close = useCallback(() => setView(null), []);
  return { view, busy: lock.busy, press, sendRest, close };
}
