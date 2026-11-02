// World creation: settings are stored in the database on first start and win over the environment.

import { DEFAULT_WORLD, createNpcVillage, generateNpcPlacements, villagePoints, type WorldSettings } from '@clanfire/engine';
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
    const settings: WorldSettings = { ...DEFAULT_WORLD, ...stored };
    for (const key of Object.keys(overrides) as Array<keyof WorldSettings>) {
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
    if (overrides[key] !== undefined) settings[key] = overrides[key];
  }

  store.tx(() => {
    store.setMeta('world_settings', JSON.stringify(settings));
    store.setMeta('world_created_at', String(now));
    for (const p of generateNpcPlacements(settings)) {
      const state = createNpcVillage(p.tier, now);
      store.insertVillage(null, NPC_VILLAGE_NAME, p.x, p.y, villagePoints(state), state);
    }
  });
  return settings;
}
