// Incoming-warning notifications on the client (docs/GAME_DESIGN.md 18.10): labels and texts, the pure rule that decides which
// notifications get a browser alert, and thin guarded wrappers around the browser Notification API. Nothing here asks for
// permission by itself: `requestBrowserAlerts` is only called from a button click. No unit list ever appears: the API has none.

import { worldPrefixOf } from '@clanfire/engine';
import type { NotificationDto, NotificationKind } from '@clanfire/engine';
import { formatCoords } from './format.ts';

export const NOTIFICATION_LABEL: Record<NotificationKind, string> = {
  incoming_attack: 'Incoming attack',
  incoming_support: 'Incoming support',
  incoming_resources: 'Incoming resources',
};

/** How many rows the list shows (the API sends up to 100, newest first). */
export const NOTIFICATIONS_SHOWN = 20;
/** At most this many browser alerts per fetch, so a burst never floods the desktop. */
export const MAX_ALERTS_PER_FETCH = 3;

/** The newest rows for the list, newest first. */
export function shownNotifications(list: readonly NotificationDto[]): NotificationDto[] {
  return [...list].sort((a, b) => b.id - a.id).slice(0, NOTIFICATIONS_SHOWN);
}

/** "14:05" in the player's locale. */
export function arrivalClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const notificationTitle = (n: Pick<NotificationDto, 'kind'>): string => NOTIFICATION_LABEL[n.kind];

/** "From Oak Hollow (12|34) to Home, arrives 14:05". No units. */
export function notificationBody(n: NotificationDto, clock: (ts: number) => string = arrivalClock): string {
  return `From ${n.origin.name} (${formatCoords(n.origin.x, n.origin.y)}) to ${n.target.name}, arrives ${clock(n.arriveAt)}`;
}

// ---- Which notifications get a browser alert -------------------------------------------------------------

export interface AnnounceDecision {
  /** Oldest first, at most MAX_ALERTS_PER_FETCH. */
  announce: NotificationDto[];
  /** The new "highest id already announced" to store. */
  last: number;
}

/**
 * `last` is the highest id announced so far (null = never stored). With no stored value the current maximum becomes the baseline and
 * nothing old is announced. Only unread rows above the baseline are announced, and only when the browser allows it (`canShow`); the
 * baseline moves up either way, so a permission given later never replays old rows. If the list's highest id is BELOW the stored
 * value (rows were cancelled and deleted, ids reused, or another account) the baseline drops to it, so new rows are not missed.
 */
export function decideAnnouncements(list: readonly NotificationDto[], last: number | null, canShow: boolean): AnnounceDecision {
  const maxId = list.reduce((m, n) => Math.max(m, n.id), 0);
  if (last === null) return { announce: [], last: maxId };
  const base = last > maxId ? maxId : last;
  const fresh = list.filter((n) => n.id > base && !n.read).sort((a, b) => a.id - b.id);
  return { announce: canShow ? fresh.slice(-MAX_ALERTS_PER_FETCH) : [], last: Math.max(base, maxId) };
}

// ---- Stored baseline (per world, not per account) ----------------------------------------------------------

const LAST_KEY = 'clanfire.alerts.lastId';
type ReadStore = Pick<Storage, 'getItem'>;
type WriteStore = Pick<Storage, 'setItem'>;

/** localStorage key for the page's world ("/w/<id>" under a world path, plain otherwise). */
export function lastAnnouncedKey(pathname: string): string {
  return `${LAST_KEY}${worldPrefixOf(pathname)}`;
}

export function readLastAnnounced(store: ReadStore | null, key: string): number | null {
  try {
    const raw = store?.getItem(key);
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeLastAnnounced(store: WriteStore | null, key: string, id: number): void {
  try {
    store?.setItem(key, String(id));
  } catch {
    // Private mode or full storage: the next load starts from the current maximum, which is safe.
  }
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

// ---- Browser Notification API (all guarded) -------------------------------------------------------------

export type BrowserAlertState = 'unsupported' | 'default' | 'granted' | 'denied';

export function browserAlertState(): BrowserAlertState {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    const p = Notification.permission;
    return p === 'granted' || p === 'denied' || p === 'default' ? p : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** Asks the browser for permission. Call ONLY from a click handler, never on load. Returns the state afterwards. */
export async function requestBrowserAlerts(): Promise<BrowserAlertState> {
  try {
    if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') return 'unsupported';
    await Notification.requestPermission();
  } catch {
    // Ignored: the state below tells what the browser now says.
  }
  return browserAlertState();
}

/** Shows one browser alert (title and short body, no units). False when the browser refused or threw. */
export function showBrowserAlert(n: NotificationDto): boolean {
  try {
    if (typeof Notification === 'undefined') return false;
    new Notification(notificationTitle(n), { body: notificationBody(n), tag: `clanfire-notification-${n.id}` });
    return true;
  } catch {
    return false;
  }
}

/**
 * One announcement round for a fresh list: reads the stored baseline, decides, shows the alerts, stores the new baseline.
 * Dependencies are injectable for tests.
 */
export function announceNew(
  list: readonly NotificationDto[],
  deps: {
    storage?: (ReadStore & WriteStore) | null;
    key: string;
    canShow?: boolean;
    show?: (n: NotificationDto) => unknown;
  },
): AnnounceDecision {
  const storage = deps.storage === undefined ? browserStorage() : deps.storage;
  const canShow = deps.canShow ?? browserAlertState() === 'granted';
  const decision = decideAnnouncements(list, readLastAnnounced(storage, deps.key), canShow);
  const show = deps.show ?? showBrowserAlert;
  for (const n of decision.announce) show(n);
  writeLastAnnounced(storage, deps.key, decision.last);
  return decision;
}
