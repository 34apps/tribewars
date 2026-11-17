// The still back picture of the village scene (landscape + ground, see SceneBackdrop in VillageScene.tsx): the pictures made so far,
// and a small copy of the newest ones kept in IndexedDB so a page reload does not draw, serialise and decode it all again.
//
// Memory: at most MAX_PICS decoded pictures (blob URLs). Storage: at most KEEP_STORED SVG texts (about 1 MB each), newest first, and
// only from a production build (a dev server's art changes with every edit, so a kept picture would go stale). The kept texts carry
// the build id: a new build never shows an old build's picture. Nothing here is a game rule or player data.

import type { LandBox } from '../../art/landscape.tsx';

export type BackPic = { url: string; box: LandBox; key: string };

declare const __BUILD_ID__: string | undefined;
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';

const MAX_PICS = 6;
const KEEP_STORED = 2;
const DB_NAME = 'clanfire-scene';
const STORE = 'backpic';

/** The still pictures made so far, newest last: the next scene (a page switch, the small picture) reuses one instead of drawing, serialising and decoding it again. */
export const backPics = new Map<string, BackPic>();

export function rememberBackPic(key: string, pic: BackPic) {
  backPics.delete(key);
  backPics.set(key, pic);
  while (backPics.size > MAX_PICS) {
    const [oldKey, old] = backPics.entries().next().value as [string, BackPic];
    backPics.delete(oldKey);
    // Late: a scene may still be painting it for a moment.
    setTimeout(() => URL.revokeObjectURL(old.url), 10000);
  }
}

// ---- IndexedDB copy -----------------------------------------------------------------------------------------

type Stored = { key: string; build: string; at: number; box: LandBox; text: string };

const storageOn = () => BUILD !== '' && typeof indexedDB !== 'undefined';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** Keep this picture's SVG text for the next page load (and drop all but the newest KEEP_STORED). Never throws. */
export async function persistBackPic(key: string, box: LandBox, text: string): Promise<void> {
  if (!storageOn()) return;
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put({ key, build: BUILD, at: Date.now(), box, text } satisfies Stored);
      const all = store.getAll();
      all.onsuccess = () => {
        const rows = (all.result as Stored[]).sort((a, b) => b.at - a.at);
        rows.slice(KEEP_STORED).forEach((r) => store.delete(r.key));
      };
      await done(tx);
    } finally {
      db.close();
    }
  } catch {
    /* private mode, quota, blocked: the picture is simply made again next time */
  }
}

async function readStored(): Promise<Stored[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const all = store.getAll();
    const rows = await new Promise<Stored[]>((resolve, reject) => {
      all.onsuccess = () => resolve(all.result as Stored[]);
      all.onerror = () => reject(all.error);
    });
    // Other builds' pictures are of no use any more.
    for (const r of rows) if (r.build !== BUILD) store.delete(r.key);
    await done(tx);
    return rows.filter((r) => r.build === BUILD).sort((a, b) => b.at - a.at).slice(0, KEEP_STORED);
  } finally {
    db.close();
  }
}

let restoring: Promise<void> | null = null;

/** Load the kept pictures into `backPics`, decoded (start-up work: it runs while the game state is still on its way). Never throws. */
export function restoreBackPics(): Promise<void> {
  if (restoring) return restoring;
  restoring = (async () => {
    if (!storageOn()) return;
    try {
      const rows = await readStored();
      await Promise.all(
        rows.map(async (r) => {
          const url = URL.createObjectURL(new Blob([r.text], { type: 'image/svg+xml' }));
          try {
            const img = new Image();
            img.src = url;
            await img.decode();
            if (!backPics.has(r.key)) rememberBackPic(r.key, { url, box: r.box, key: r.key });
            else URL.revokeObjectURL(url);
          } catch {
            URL.revokeObjectURL(url);
          }
        }),
      );
    } catch {
    }
  })();
  return restoring;
}

/** Resolves when the start-up restore has finished (at once when none was started or storage is off). */
export function backPicsRestored(): Promise<void> {
  return restoring ?? Promise.resolve();
}
