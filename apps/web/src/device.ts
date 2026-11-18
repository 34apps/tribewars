// Random device id for multi-account detection (staff tooling, docs/SECURITY_ROADMAP.md "Multi-account tooling").
// One random 128-bit id per browser, kept in localStorage and sent to the world's API in the X-Clanfire-Device header (the server also keeps
// it in a first-party cookie and stores only a hash). It is NOT a fingerprint: nothing about the browser or hardware is read.

const KEY = 'clanfire_device';
const ID = /^[0-9a-f]{32}$/;

export const DEVICE_HEADER = 'X-Clanfire-Device';

let cached: string | null = null;

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The browser's device id (created on first use). Falls back to an id for this page load when storage is blocked. */
export function deviceId(): string {
  if (cached) return cached;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && ID.test(saved)) return (cached = saved);
  } catch {
    // storage blocked: use a per-load id below
  }
  const id = randomId();
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // keep the id in memory only
  }
  return (cached = id);
}
