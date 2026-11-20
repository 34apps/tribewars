// Random device id for multi-account detection (staff tooling, docs/SECURITY_ROADMAP.md "Multi-account tooling").
// One random 128-bit id per browser, kept in localStorage and sent to the world's API in the X-Clanfire-Device header (the server also keeps
// it in a first-party cookie and stores only a hash). It is NOT a fingerprint: nothing about the browser or hardware is read.
//
// ePrivacy: the id is only CREATED when the player signs in, registers or enters a world (the account service they asked for),
// never on a bare visit. Every other call only reads an id that already exists (existingDeviceId); see api.ts deviceHeaderFor.

const KEY = 'clanfire_device';
const ID = /^[0-9a-f]{32}$/;

export const DEVICE_HEADER = 'X-Clanfire-Device';

let cached: string | null = null;

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The browser's device id if one was already created; null otherwise. Never writes anything. */
export function existingDeviceId(): string | null {
  if (cached) return cached;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && ID.test(saved)) return (cached = saved);
  } catch {
    // storage blocked: no saved id
  }
  return null;
}

/** The browser's device id, created now if there is none. Call only for sign-in, register and world entry. Falls back to an id for this page load when storage is blocked. */
export function ensureDeviceId(): string {
  const have = existingDeviceId();
  if (have) return have;
  const id = randomId();
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // keep the id in memory only
  }
  return (cached = id);
}

/** For tests: forget the in-memory copy. */
export function resetDeviceCache(): void {
  cached = null;
}
