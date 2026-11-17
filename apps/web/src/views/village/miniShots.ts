// Where the small village pictures (miniSnapshot.ts) are kept and who draws them.
//  - Kept per village in memory, and (a few of them) in localStorage, so a page reload shows the picture at once and the scene is not
//    drawn again at all while the buildings are the same (the draw was ~250 ms of main-thread work at every cold start).
//  - Taken from the Village page's own scene (useMiniShooter.ts), so no second scene is ever drawn for it.
//  - `whenIdle` starts work after the page has painted, in an idle moment (Safari has no requestIdleCallback: a timer there).

import type { MiniShot } from './miniSnapshot.ts';

type Entry = { key: string; shot: MiniShot };

const STORE_KEY = 'clanfire-mini-v1';
const KEEP = 4; // villages kept in storage (each picture is ~40-80 KB as a data URL)

let loaded = false;
const cache = new Map<string, Entry>();
const listeners = new Set<{ vk: string; fn: () => void }>();
const failed = new Set<string>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = storage()?.getItem(STORE_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const e = item as { vk?: unknown; key?: unknown; url?: unknown };
      if (typeof e.vk === 'string' && typeof e.key === 'string' && typeof e.url === 'string' && e.url.startsWith('data:image/')) cache.set(e.vk, { key: e.key, shot: { url: e.url } });
    }
  } catch {
    /* a broken saved value: start with none */
  }
}

function save() {
  try {
    const s = storage();
    if (!s) return;
    // Newest last in the map; keep the latest few.
    const list = Array.from(cache.entries())
      .filter(([, e]) => e.shot.url.startsWith('data:'))
      .slice(-KEEP)
      .map(([vk, e]) => ({ vk, key: e.key, url: e.shot.url }));
    s.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the in-memory picture still works */
  }
}

function notify(vk: string) {
  for (const l of Array.from(listeners)) if (l.vk === vk) l.fn();
}

export function getMini(vk: string): Entry | undefined {
  load();
  return cache.get(vk);
}

export function putMini(vk: string, key: string, shot: MiniShot) {
  load();
  cache.delete(vk); // newest last
  cache.set(vk, { key, shot });
  save();
  notify(vk);
}

/** Called when a new picture of this village was kept. */
export function subscribeMini(vk: string, fn: () => void): () => void {
  const l = { vk, fn };
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** A picture that could not be made for these buildings is not tried again until they change. */
export function miniFailed(vk: string, key: string): boolean {
  return failed.has(`${vk}|${key}`);
}

export function markMiniFailed(vk: string, key: string) {
  failed.add(`${vk}|${key}`);
}

/** What the picture shows: the buildings' levels, the jobs running now (scaffolds) and whether the hearth burns. Same text on every screen. */
export function miniKey(buildings: unknown, queue: { startAt: number; building: string; targetLevel: number }[], now: number, hearth: boolean): string {
  return JSON.stringify([buildings, queue.filter((j) => j.startAt <= now).map((j) => `${j.building}:${j.targetLevel}`), hearth]);
}

/** Run `fn` after the page has had its first paint, in an idle moment (at the latest after `timeout` ms). Returns a cancel function. */
export function whenIdle(fn: () => void, timeout = 2500): () => void {
  const w = typeof window === 'undefined' ? null : window;
  if (w && typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 300);
  return () => clearTimeout(id);
}
