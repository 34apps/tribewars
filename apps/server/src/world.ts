// World creation: settings are stored in the database on first start and win over the environment.
// Two stored rows describe the rules: `world_settings` (the flat fields the engine always read) and `world_config` (the complete
// per-world rules, packages/engine/src/world-config.ts). They are written together and always agree.

import { randomInt } from 'node:crypto';
import {
  DEFAULT_WORLD,
  applyWorldConfig,
  checkWorldConfigInput,
  createNpcVillage,
  flatSettings,
  generateExpandingStartNpcs,
  generateNpcPlacements,
  mergeDominationSettings,
  resolveWorldConfig,
  villagePoints,
  worldConfigFromSettings,
  type WorldSettings,
} from '@clanfire/engine';
import { sitesFor, withoutSiteTiles } from './site-layout.ts';
import type { Store } from './store.ts';

export const NPC_VILLAGE_NAME = 'Abandoned village';

/**
 * Settings of this world, WITH `config`. `configOverrides` (a partial config, e.g. from WORLD_CONFIG) is used only when the world is
 * created; a bad value throws. An existing world without a stored config (made before per-world settings) gets one in memory only:
 * nothing is written, and it behaves exactly as before.
 */
export function initWorld(
  store: Store,
  overrides: Partial<WorldSettings>,
  now: number,
  warn: (msg: string) => void,
  configOverrides?: unknown,
): WorldSettings {
  const stored = store.getSettings();
  if (stored) {
    // A database from before the domination rule has no `domination`: it runs on the defaults (and is not rewritten).
    const flat: WorldSettings = { ...DEFAULT_WORLD, ...stored, domination: mergeDominationSettings(stored.domination) };
    delete flat.config;
    const settings = applyWorldConfig(flat, store.effectiveWorldConfig());
    for (const key of Object.keys(overrides) as Array<keyof WorldSettings>) {
      if (key === 'domination' || key === 'config') continue; // the stored rule wins silently (the operator changes it with the admin tool)
      if (overrides[key] !== undefined && overrides[key] !== settings[key]) {
        warn(
          `World setting ${key}=${String(overrides[key])} from the environment is ignored: this database was created with ${key}=${String(settings[key])}.`,
        );
      }
    }
    return settings;
  }

  let flat: WorldSettings = { ...DEFAULT_WORLD };
  for (const key of Object.keys(overrides) as Array<keyof WorldSettings>) {
    if (key === 'config') continue;
    if (overrides[key] !== undefined) Object.assign(flat, { [key]: overrides[key] });
  }
  // The domination rule is stored whole, so later changes to the defaults never change a running world.
  flat.domination = mergeDominationSettings(flat.domination);

  const base = worldConfigFromSettings(flat);
  if (configOverrides !== undefined) {
    const check = checkWorldConfigInput(configOverrides);
    if (!check.ok) throw new Error(`Invalid world configuration: ${check.message}`);
  }
  const config = resolveWorldConfig(configOverrides, base);
  const settings = applyWorldConfig(flat, config);
  flat = flatSettings(settings);

  store.tx(() => {
    store.setMeta('world_settings', JSON.stringify(flat));
    store.setWorldConfig(config); // also rewrites world_settings from the config: both in sync
    store.setMeta('world_created_at', String(now));
    // No abandoned village within SITE_NO_VILLAGE_RADIUS of a map site.
    const placements = withoutSiteTiles(sitesFor(settings), settings.layout === 'expanding' ? generateExpandingStartNpcs(settings) : generateNpcPlacements(settings));
    const expanding = settings.layout === 'expanding';
    for (const p of placements) {
      const state = createNpcVillage(p.tier, now, expanding ? randomInt(0, 0xffffffff) : undefined, settings);
      store.insertVillage(null, NPC_VILLAGE_NAME, p.x, p.y, villagePoints(state), state);
    }
  });
  return settings;
}
