// Toast kinds and timing (pure; Toasts.tsx draws them, Game.tsx raises them).

export type ToastKind = 'error' | 'warning' | 'success' | 'info';
/** What callers may pass: the four kinds, plus the older 'ok' (= success). */
export type ToastKindInput = ToastKind | 'ok';

export const TOAST_MS = 4000;
export const TOAST_LONG_MS = 8000;

/** 'ok' (and nothing) means success. */
export function normalizeKind(kind: ToastKindInput | undefined): ToastKind {
  return kind === undefined || kind === 'ok' ? 'success' : kind;
}

/** How long a toast stays in ms; null = until the player closes it (errors). A toast with an action stays a little longer. */
export function toastTtl(kind: ToastKindInput | undefined, hasAction: boolean): number | null {
  const k = normalizeKind(kind);
  if (k === 'error') return null;
  return hasAction || k === 'warning' ? TOAST_LONG_MS : TOAST_MS;
}

/** Assistive tech: errors interrupt (alert), the rest are polite (status). */
export const toastRole = (kind: ToastKindInput | undefined): 'alert' | 'status' => (normalizeKind(kind) === 'error' ? 'alert' : 'status');

/** An error that has a known fix gets a warning with a button; everything else stays an error. */
export function errorToast(code: string | undefined, message: string, fixes: { farm?: () => void }): { kind: ToastKind; action?: { label: string; onClick: () => void } } {
  if (code === 'population_full' && fixes.farm) return { kind: 'warning', action: { label: 'Farm', onClick: fixes.farm } };
  void message;
  return { kind: 'error' };
}
