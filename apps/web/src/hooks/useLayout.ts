// Phone or desktop layout, chosen by DEVICE, not by window width (owner, 2026-11-09): the desktop game is one fixed 1440x900 frame
// that never reflows, so a narrow desktop window must not flip to the phone layout. `?layout=phone|desktop` overrides it for testing.
// The choice is also written to the root element as `layout-desktop` / `layout-phone`; new CSS keys on that class.

import { useSyncExternalStore } from 'react';

export type Layout = 'phone' | 'desktop';

/** Screens whose short side is under this are phones (phones: 320-430; small laptops: 720+). */
const PHONE_SCREEN = 600;
/** A touch device with a short side under this is a phone-sized touch device too (small tablets stay phone-style). */
const TOUCH_PHONE_SCREEN = 768;

function override(): Layout | null {
  try {
    const v = new URLSearchParams(window.location.search).get('layout');
    return v === 'phone' || v === 'desktop' ? v : null;
  } catch {
    return null;
  }
}

/** Pure rule, exported for tests: `short` = the device screen's short side in CSS px. */
export function layoutFor(short: number, coarsePointer: boolean): Layout {
  return short < PHONE_SCREEN || (coarsePointer && short < TOUCH_PHONE_SCREEN) ? 'phone' : 'desktop';
}

export function detectLayout(): Layout {
  if (typeof window === 'undefined') return 'desktop';
  const forced = override();
  if (forced) return forced;
  const s = window.screen;
  const short = Math.min(s?.width || window.innerWidth, s?.height || window.innerHeight);
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return layoutFor(short, coarse);
}

let current: Layout = detectLayout();
const listeners = new Set<() => void>();

function apply(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('layout-desktop', current === 'desktop');
  root.classList.toggle('layout-phone', current === 'phone');
}
apply();

function recheck(): void {
  const next = detectLayout();
  if (next === current) return;
  current = next;
  apply();
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    // The screen can change (rotating a tablet, moving the window to another monitor); the window width never decides.
    window.addEventListener('orientationchange', recheck);
    window.addEventListener('resize', recheck);
  }
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('orientationchange', recheck);
      window.removeEventListener('resize', recheck);
    }
  };
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, () => current, () => 'desktop' as Layout);
}

/** True for the fixed 1440x900 desktop frame. */
export function useIsDesktop(): boolean {
  return useLayout() === 'desktop';
}
