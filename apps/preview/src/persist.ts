// Saving the world: the sql.js database bytes (and the signed-in session token) go to IndexedDB, falling back to
// localStorage. Everything is wrapped in try/catch: the game works without storage, it just forgets on reload.

const DB_NAME = 'clanfire-preview';
const STORE = 'kv';
const KEY = 'save-v1';
const LS_KEY = 'clanfire-preview-save-v1';

export interface Save {
  db: Uint8Array | null;
  token: string | null;
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function idbGet(): Promise<Save | null> {
  const idb = await openIdb();
  try {
    return await new Promise<Save | null>((resolve, reject) => {
      const req = idb.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Save | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  } finally {
    idb.close();
  }
}

async function idbPut(save: Save | null): Promise<void> {
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(STORE, 'readwrite');
      if (save === null) tx.objectStore(STORE).delete(KEY);
      else tx.objectStore(STORE).put(save, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  } finally {
    idb.close();
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function lsGet(): Save | null {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { db: string | null; token: string | null };
  return { db: parsed.db ? fromBase64(parsed.db) : null, token: parsed.token };
}

function lsPut(save: Save | null): void {
  if (save === null) localStorage.removeItem(LS_KEY);
  else localStorage.setItem(LS_KEY, JSON.stringify({ db: save.db ? toBase64(save.db) : null, token: save.token }));
}

function valid(s: Save | null): s is Save {
  return s !== null && s.db instanceof Uint8Array && s.db.length > 0;
}

/** The saved world, or null when there is none (or storage is unavailable). */
export async function loadSave(): Promise<Save | null> {
  try {
    const s = await idbGet();
    if (valid(s)) return s;
  } catch {
    // fall through to localStorage
  }
  try {
    const s = lsGet();
    if (valid(s)) return s;
  } catch {
    // no storage at all
  }
  return null;
}

/** Store the save. Resolves true when some storage took it. */
export async function writeSave(save: Save): Promise<boolean> {
  try {
    await idbPut(save);
    return true;
  } catch {
    // fall through
  }
  try {
    lsPut(save);
    return true;
  } catch {
    return false;
  }
}

/** Remove every saved copy. */
export async function wipeSave(): Promise<void> {
  try {
    await idbPut(null);
  } catch {
    // ignore
  }
  try {
    lsPut(null);
  } catch {
    // ignore
  }
}
