// World creation: settings are stored in the database on first start and win over the environment.

import { randomInt } from 'node:crypto';
import { DEFAULT_WORLD, createNpcVillage, generateExpandingStartNpcs, generateNpcPlacements, mergeDominationSettings, villagePoints, type WorldSettings } from '@clanfire/engine';
import { sitesFor, withoutSiteTiles } from './site-layout.ts';
import type { Store } from './store.ts';

export const NPC_VILLAGE_NAME = 'Abandoned village';

export function initWorld(
  store: Store,
  overrides: Partial<WorldSettings>,
  now: number,
  warn: (msg: string) => void,
): WorldSettings {
  const stored = store.getSettings();
  if (stored) {
    // A database from before the domination rule has no `domination`: it runs on the defaults (and is not rewritten).
    const settings: WorldSettings = { ...DEFAULT_WORLD, ...stored, domination: mergeDominationSettings(stored.domination) };
    for (const key of Object.keys(overrides) as Array<keyof WorldSettings>) {
      if (key === 'domination') continue; // the stored rule wins silently (the operator changes it with the admin tool)
      if (overrides[key] !== undefined && overrides[key] !== settings[key]) {
        warn(
          `World setting ${key}=${String(overrides[key])} from the environment is ignored: this database was created with ${key}=${String(settings[key])}.`,
        );
      }
    }
    return settings;
  }

  const settings: WorldSettings = { ...DEFAULT_WORLD };
  for (const key of Object.keys(overrides) as Array<keyof WorldSettings>) {
    if (overrides[key] !== undefined) Object.assign(settings, { [key]: overrides[key] });
  }
  // The domination rule is stored whole, so later changes to the defaults never change a running world.
  settings.domination = mergeDominationSettings(settings.domination);

  store.tx(() => {
    store.setMeta('world_settings', JSON.stringify(settings));
    store.setMeta('world_created_at', String(now));
    // No abandoned village within SITE_NO_VILLAGE_RADIUS of a map site.
    const placements = withoutSiteTiles(sitesFor(settings), settings.layout === 'expanding' ? generateExpandingStartNpcs(settings) : generateNpcPlacements(settings));
    const expanding = settings.layout === 'expanding';
    for (const p of placements) {
      const state = createNpcVillage(p.tier, now, expanding ? randomInt(0, 0xffffffff) : undefined);
      store.insertVillage(null, NPC_VILLAGE_NAME, p.x, p.y, villagePoints(state), state);
    }
  });
  return settings;
}
