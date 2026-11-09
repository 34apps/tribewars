// What a building's state control shows (Village page list, building page upgrade box): ONE pure picker so every page agrees.
// The control itself is components/BuildState.tsx. Nothing here decides game rules; the server re-checks every build.

export type BuildStateKind =
  | 'build' //     can be built / upgraded now: gold
  | 'afford' //    not enough resources: cream, hourglass + time until affordable
  | 'queuefull' // build queue full: cream, "Queue full" (or when a slot frees)
  | 'upgrading' // a job is running: teal with the timer
  | 'queued' //    a job waits in the queue: tan "Next"
  | 'max' //       top level reached: dark with a star
  | 'locked' //    requirements not met: grey with a lock
  | 'blocked'; //  anything else the engine or the village refuses (cold hearth, cost above storage)

export interface BuildStateInput {
  /** Level today (queued levels not counted). */
  level: number;
  /** This building's own jobs in the build queue. */
  jobsOfThis: number;
  /** The running job's finish time minus now (ms), or null when none of its jobs runs yet. */
  upgradingLeftMs: number | null;
  /** The next level (after the queue) is above the building's max level. */
  atMax: boolean;
  /** Not built and a requirement is missing. */
  locked: boolean;
  /** Why the engine refuses a build right now (null when it allows it); `hearth` = cold village. */
  refusal: 'none' | 'queue_full' | 'not_enough_resources' | 'other';
  /** ms until the cost is affordable at today's income; null = never at this income; used for `not_enough_resources`. */
  affordInMs: number | null;
  /** ms until the earliest build job finishes (a queue slot frees); used for `queue_full`. */
  queueFreesInMs: number | null;
}

export interface BuildStatePick {
  kind: BuildStateKind;
  /** The player can press it (only the gold one). */
  actionable: boolean;
}

export function pickBuildState(i: BuildStateInput): BuildStatePick {
  const kind = ((): BuildStateKind => {
    if (i.upgradingLeftMs !== null) return 'upgrading';
    if (i.jobsOfThis > 0) return 'queued';
    if (i.atMax) return 'max';
    if (i.locked) return 'locked';
    if (i.refusal === 'queue_full') return 'queuefull';
    if (i.refusal === 'not_enough_resources') return 'afford';
    if (i.refusal === 'other') return 'blocked';
    return 'build';
  })();
  return { kind, actionable: kind === 'build' };
}

/** Maps the engine's check result code to the picker's `refusal`. */
export function refusalOf(res: { ok: true } | { ok: false; reason: string }, extraRefusal: string | null): BuildStateInput['refusal'] {
  if (extraRefusal) return 'other';
  if (res.ok) return 'none';
  if (res.reason === 'queue_full') return 'queue_full';
  if (res.reason === 'not_enough_resources') return 'not_enough_resources';
  return 'other';
}
