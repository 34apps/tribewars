// The preview's virtual game clock. Import this file FIRST (main.tsx does): it replaces the global `Date` so that
// `new Date()` and `Date.now()` return game time. The in-page server, the web client's countdowns and the computer
// players all read the same clock, so speeding it up speeds up everything at once.
//
//   virtual = baseVirtual + (realNow - baseReal) * rate
//
// Changing the rate rebases, so game time is continuous and never goes backwards. `skip` only moves forward.

export interface ClockSnapshot {
  /** Game time (ms since epoch) when the snapshot was taken. */
  virtual: number;
  /** Game seconds per real second (1 = real pace). */
  rate: number;
  /** Real time (ms since epoch) when the snapshot was taken. */
  realAt: number;
}

export interface GameClock {
  getRate(): number;
  setRate(rate: number): void;
  /** Move game time forward by `ms` (ignored when not a positive number). */
  skip(ms: number): void;
  gameNow(): number;
  snapshot(): ClockSnapshot;
  /** Continue from a saved snapshot: while the page was closed game time passed at 1x, then the saved rate resumes. */
  restore(snap: ClockSnapshot): void;
  /** Back to real time at 1x (a fresh world). */
  reset(): void;
  /** Called after a rate change or skip. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
}

export function createClock(realNow: () => number): GameClock {
  let baseReal = realNow();
  let baseVirtual = baseReal;
  let rate = 1;
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const l of [...listeners]) l();
  };
  const now = (): number => Math.floor(baseVirtual + (realNow() - baseReal) * rate);
  const rebase = (): void => {
    baseVirtual = now();
    baseReal = realNow();
  };
  return {
    getRate: () => rate,
    setRate(r) {
      if (!Number.isFinite(r) || r < 1) return; // never slower than the real game
      rebase();
      rate = r;
      emit();
    },
    skip(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return;
      rebase();
      baseVirtual += ms;
      emit();
    },
    gameNow: now,
    snapshot: () => ({ virtual: now(), rate, realAt: realNow() }),
    restore(snap) {
      const real = realNow();
      const before = now();
      const away = Math.max(0, real - snap.realAt); // closed page: 1x
      baseReal = real;
      baseVirtual = Math.max(before, snap.virtual + away); // never earlier than what this page already showed
      rate = Number.isFinite(snap.rate) && snap.rate >= 1 ? snap.rate : 1;
      emit();
    },
    reset() {
      baseReal = realNow();
      baseVirtual = baseReal;
      rate = 1;
      emit();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const RealDate = Date;
const realNow = RealDate.now.bind(RealDate);

/** The page-wide clock. */
export const clock: GameClock = createClock(realNow);

class GameDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(clock.gameNow());
    else super(...(args as [number]));
  }
  static override now(): number {
    return clock.gameNow();
  }
}

if (!(globalThis.Date as unknown as { __clanfireVirtual?: boolean }).__clanfireVirtual) {
  Object.defineProperty(GameDate, '__clanfireVirtual', { value: true });
  globalThis.Date = GameDate as unknown as DateConstructor;
}

/** Real (wall-clock) time, for code that must not follow the game clock (saving). */
export const realTime = realNow;
