// Mags the Tinker's tips: one short, plain-text hint per building, made specific with the live village where it
// helps. Client-side flavour only; numbers come from the engine.

import {
  BUILDINGS,
  FEAST_RENOWN,
  RESOURCE_IDS,
  UNITS,
  UNIT_IDS,
  WALL_BONUS_PER_LEVEL,
  populationCap,
  populationUsage,
  storageCap,
  vaultForLevel,
} from '@clanfire/engine';
import type { BuildingId, ResourceId, VillageState, WorldSettings } from '@clanfire/engine';
import { formatInt } from '../../format.ts';
import { RESOURCE_NAME } from '../../icons.ts';
import { unmetRequirements, requirementText } from '../../rules.ts';

/** Buildings and units that need `id` at exactly `level`. */
function opensAt(id: BuildingId, level: number): string[] {
  const out: string[] = [];
  for (const b of Object.values(BUILDINGS)) if (b.id !== id && b.requires[id] === level) out.push(b.name);
  for (const u of UNIT_IDS) if (UNITS[u].requires[id] === level) out.push(UNITS[u].name);
  return out;
}

export function tipFor(id: BuildingId, v: VillageState, s: WorldSettings): string {
  const level = v.buildings[id];
  const def = BUILDINGS[id];
  const unmet = unmetRequirements(v.buildings, def.requires);
  if (level === 0 && unmet.length > 0) {
    return `The ${def.name} needs ${requirementText(unmet)} first. Work on that and come back.`;
  }
  const next = opensAt(id, level + 1);
  switch (id) {
    case 'hall':
      return next.length > 0
        ? `A bigger Town Hall speeds up every build. Level ${level + 1} also opens the way to the ${next.join(', ')}.`
        : 'A bigger Town Hall speeds up every build in the village.';
    case 'lumber':
      return 'Wood goes into nearly everything. Keep the Lumber Camp a step ahead of the other pits and fields.';
    case 'farm': {
      const room = populationCap(v) - populationUsage(v).total;
      if (room <= 0) return 'Your village is full: no room for more buildings or troops. Upgrade the Farm to raise the population cap.';
      return 'Each Farm level raises the population cap and grows more food. Upgrade it before you train a lot more troops.';
    }
    case 'mine':
      return 'Iron goes into weapons and the heavier buildings. Raiders and the Wall eat plenty of it.';
    case 'goldmine':
      return level === 0
        ? 'No gold is coming in yet. A Gold Mine pays for the Stables and, later, Knights.'
        : 'Gold comes in slowly. Save it for cavalry and elite troops.';
    case 'storehouse': {
      const cap = storageCap(v);
      let fullest: ResourceId = 'wood';
      for (const r of RESOURCE_IDS) if (v.resources[r] > v.resources[fullest]) fullest = r;
      const have = v.resources[fullest];
      if (cap > 0 && have / cap >= 0.8) {
        return `${RESOURCE_NAME[fullest]} is nearly full (${formatInt(have)} of ${formatInt(cap)}). A bigger Storehouse stops it going to waste.`;
      }
      return 'Each Storehouse level raises how much of every resource you can keep. Upgrade it before big builds.';
    }
    case 'barracks':
      return level === 0
        ? 'The Barracks trains your first troops. Pikemen are cheap and hold the gate.'
        : 'Pikemen are cheap and stop cavalry. Train a few before you go raiding.';
    case 'stables':
      return 'Riders are fast and carry more loot home. Gold pays for them.';
    case 'wall':
      return `Every Wall level makes your defenders ${Math.round(WALL_BONUS_PER_LEVEL * 100)}% stronger and adds village militia.`;
    case 'drillyard':
      return 'Research stronger troops here, then spend Training Points on ranks. One village cannot max everything, so pick a role.';
    case 'market':
      return level === 0
        ? 'Without a Market your traders stay home. Build one to send resources to your other villages and to friends.'
        : 'Each Market level lets one shipment carry more. Receiving needs no Market.';
    case 'bannerhall':
      return level === 0
        ? 'The Banner Hall turns surplus resources into Renown at a Feast. Renown is what lets you own more than one village.'
        : `Hold Feasts here while the stores are full: ${FEAST_RENOWN} Renown each, and Renown is never lost. More levels allow more Feasts a day.`;
    case 'vault':
      return level === 0
        ? 'Raiders take what they find. A Hidden Vault keeps some of each resource out of their reach.'
        : `The Hidden Vault keeps ${formatInt(vaultForLevel(level))} of each resource safe from raiders.`;
  }
}
