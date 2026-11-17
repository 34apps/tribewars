// Keeps the small village picture (miniShots.ts) up to date from the Village page's own scene: when the kept picture does not match the
// buildings, wait until the page has painted and the scene's still back picture is in, then snapshot that scene (also while it is hidden
// behind a building page: the snapshot does not need layout). No second scene is drawn for it.

import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useGame } from '../../game.ts';
import { snapshotScene } from './miniSnapshot.ts';
import { getMini, markMiniFailed, miniFailed, miniKey, putMini, whenIdle } from './miniShots.ts';

/** Whether the kept small picture shows the village as it is now (nothing to make). */
export function useMiniFresh(): boolean {
  const { village, live, now } = useGame();
  return getMini(`${village.id}@${village.x},${village.y}`)?.key === miniKey(live.buildings, live.buildQueue, now, !!village.hearth);
}

export function useMiniShooter(root: RefObject<HTMLElement | null>, sceneOn: boolean) {
  const { village, live, now } = useGame();
  const key = miniKey(live.buildings, live.buildQueue, now, !!village.hearth);
  const vk = `${village.id}@${village.x},${village.y}`;
  const exact = getMini(vk)?.key === key;
  useEffect(() => {
    if (!sceneOn || exact || miniFailed(vk, key)) return;
    let alive = true;
    let poll = 0;
    // Not requestAnimationFrame: it never fires in a hidden or unfocused tab/pane.
    const cancelIdle = whenIdle(() => {
      let tries = 0;
      poll = window.setInterval(() => {
        tries += 1;
        const view = root.current?.querySelector('.vv-view');
        // Ready when the still back layer shows the picture of the current buildings.
        if (view && view.querySelector('.vv-pic[data-still="1"]')) {
          window.clearInterval(poll);
          void snapshotScene(view).then((shot) => {
            if (!alive) return;
            if (shot) putMini(vk, key, shot);
            else markMiniFailed(vk, key);
          });
        } else if (tries > 60) {
          window.clearInterval(poll);
          markMiniFailed(vk, key);
        }
      }, 150);
    });
    return () => {
      alive = false;
      cancelIdle();
      window.clearInterval(poll);
    };
  }, [sceneOn, exact, key, vk, root]);
}
