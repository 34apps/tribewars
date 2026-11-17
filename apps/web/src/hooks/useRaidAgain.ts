import { useCallback, useRef, useState } from 'react';
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

/** A second press on the same report within this long after a send went out is ignored: a double click or double tap must not send twice. */
export const SENT_COOLDOWN_MS = 1500;

/** True when `reportId` was sent less than the cooldown ago (`last` = the newest send, `nowMs` on the same clock). */
export function pressedTooSoon(last: { reportId: number; at: number } | null, reportId: number, nowMs: number): boolean {
  return last !== null && last.reportId === reportId && nowMs - last.at < SENT_COOLDOWN_MS;
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
  // performance.now(): the preview replaces Date with its game clock, which jumps when the world is sped up.
  const lastSent = useRef<{ reportId: number; at: number } | null>(null);

  const run = useCallback(
    async (reportId: number, again: SendAgainDto, units: Partial<Units>) => {
      if (!lock.begin()) return;
      setView(null);
      try {
        const out = await sendAgain(again, units, now);
        if (out.ok) {
          applySend(out.response);
          lastSent.current = { reportId, at: performance.now() };
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
      if (pressedTooSoon(lastSent.current, reportId, performance.now())) return;
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
