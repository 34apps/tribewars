// Made-up players and tribes so the Rankings screen can be tried out in a young world.
// Shown only when the player switches "Sample data" on; ids are negative so they never clash with real ones.

import type { PlayerRankDto, TribeSummaryDto } from '@clanfire/engine';

const FIRST = ['Ash', 'Bram', 'Cora', 'Dunn', 'Elka', 'Fenn', 'Garo', 'Hale', 'Isla', 'Jorund', 'Kest', 'Lyra', 'Mott', 'Nira', 'Orin', 'Pell', 'Quill', 'Rusk', 'Sable', 'Tarn', 'Ulf', 'Vess', 'Wren', 'Yara', 'Zed'];
const LAST = ['wood', 'ford', 'stone', 'hollow', 'crest', 'brook', 'thorn', 'vale', 'reach', 'moor', 'wick', 'gate'];

export const SAMPLE_TRIBES: readonly { id: number; tag: string; name: string }[] = [
  { id: -1, tag: 'EMB', name: 'Ember Wolves' },
  { id: -2, tag: 'IRN', name: 'Iron Covenant' },
  { id: -3, tag: 'MOS', name: 'Moss Walkers' },
  { id: -4, tag: 'GLD', name: 'Gilded Hand' },
  { id: -5, tag: 'RVN', name: 'Raven Court' },
  { id: -6, tag: 'TID', name: 'Tidebreakers' },
  { id: -7, tag: 'OAK', name: 'Old Oak Pact' },
  { id: -8, tag: 'DUS', name: 'Dustriders' },
  { id: -9, tag: 'FRO', name: 'Frostline' },
  { id: -10, tag: 'SUN', name: 'Sunward Guild' },
  { id: -11, tag: 'HAW', name: 'Hawk Road' },
  { id: -12, tag: 'LAN', name: 'Lantern Keepers' },
];

/** Deterministic pseudo-random numbers, so the sample looks the same on every visit. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** 90 players and 12 tribes. Ranks are filled in by the view (they depend on the real players too). */
export function makeSample(): { players: PlayerRankDto[]; tribes: TribeSummaryDto[] } {
  const r = rng(20261102);
  const players: PlayerRankDto[] = [];
  const perTribe = new Map<number, { members: number; points: number; villages: number }>();
  for (let i = 0; i < 90; i++) {
    const name = `${FIRST[Math.floor(r() * FIRST.length)]}${LAST[Math.floor(r() * LAST.length)]}`;
    const points = Math.round(300 + Math.pow(r(), 2.4) * 9200);
    const villages = Math.max(1, Math.min(9, Math.round(points / 1300 + r() * 2)));
    const t = r() < 0.78 ? SAMPLE_TRIBES[Math.floor(r() * SAMPLE_TRIBES.length)]! : null;
    players.push({ rank: 0, playerId: -(i + 1), username: `${name}${i % 7 === 0 ? i : ''}`, tribe: t ? { id: t.id, tag: t.tag } : null, villages, points, villageX: Math.round(r() * 999), villageY: Math.round(r() * 999) });
    if (t) {
      const agg = perTribe.get(t.id) ?? { members: 0, points: 0, villages: 0 };
      agg.members += 1;
      agg.villages += villages;
      agg.points += points;
      perTribe.set(t.id, agg);
    }
  }
  const tribes: TribeSummaryDto[] = SAMPLE_TRIBES.filter((t) => perTribe.has(t.id)).map((t) => ({
    id: t.id,
    name: t.name,
    tag: t.tag,
    members: perTribe.get(t.id)!.members,
    points: perTribe.get(t.id)!.points,
    villages: perTribe.get(t.id)!.villages,
    recruitment: 'open',
    rank: 0,
  }));
  return { players, tribes };
}
