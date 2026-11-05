// Operator commands for the domination win condition and the world end (called from admin.ts, testable on its own).
//   domination                       print the status (the same numbers as GET /api/domination)
//   domination-set <key> <value>     change one setting of this world's rule (clears the running streak)
//   world-end [tribeTag|-] [reason]  end the world by hand (optional winner by tribe tag)
//   world-extend <days>              postpone domination: adds days to minAgeDays, clears the streak
// Every change writes an audit log row (actor: the CLI). The running server reads the rule fresh from the database on every
// evaluation, so a change needs no restart.

import { DEFAULT_WORLD, DOMINATION_KEYS, DOMINATION_LIMITS, checkDominationValue, isDominationKey, type DominationSettings, type DominationStatusDto } from '@clanfire/engine';
import { clearStreak, dominationStatus, endWorld, readDominationSettings, worldEndDto, writeDominationSettings } from './domination-service.ts';
import type { Store } from './store.ts';

export const DOMINATION_COMMANDS = ['domination', 'domination-set', 'world-end', 'world-extend'] as const;
export type DominationCommand = (typeof DOMINATION_COMMANDS)[number];

export const isDominationCommand = (cmd: string | undefined): cmd is DominationCommand => (DOMINATION_COMMANDS as readonly string[]).includes(cmd ?? '');

export const DOMINATION_USAGE =
  'domination | domination-set <key> <value> (keys: ' + DOMINATION_KEYS.join(', ') + ') | world-end [tribeTag|-] [reason...] | world-extend <days>';

export interface AdminResult {
  ok: boolean;
  lines: string[];
}

const fail = (msg: string): AdminResult => ({ ok: false, lines: [msg] });
const done = (...lines: string[]): AdminResult => ({ ok: true, lines });

const worldSpeed = (store: Store): number => store.getSettings()?.speed ?? DEFAULT_WORLD.speed;
const fmtDate = (t: number): string => new Date(t).toISOString();

function audit(store: Store, now: number, action: string, detail: string): void {
  store.audit({ at: now, actorId: null, actorIp: 'cli', action, targetPlayer: null, detail: detail.slice(0, 500) });
}

/** The status as plain text lines. */
export function statusLines(s: DominationStatusDto): string[] {
  const pct = (x: number): string => `${Math.floor(x * 1000 + 1e-9) / 10}%`;
  const lines = [
    `World age: ${s.worldAgeDays} days (domination counts from day ${s.minAgeDays}) - ${s.ageOk ? 'ok' : 'not yet'}`,
    `Active players (last ${s.settings.activeDays} days): ${s.activePlayers}, peak ${s.peakActivePlayers}, need ${s.minActivePlayers} - ${s.playersOk ? 'ok' : 'not enough'}`,
    `Village points held by players: ${s.totalPoints}`,
    s.leader ? `Leader: [${s.leader.tag}] ${s.leader.name} with ${s.leader.points} points (${pct(s.leader.share)}), needs ${pct(s.winShare)}` : 'Leader: none (no player owns a village)',
    ...s.topTribes.map((t, i) => `  ${i + 1}. [${t.tag}] ${t.name}: ${t.points} points (${pct(t.share)})`),
    `Qualifies now: ${s.qualifies ? 'yes' : 'no'}`,
    s.streakStartedAt === null ? `Streak: none running (needs ${s.streakDaysNeeded} days)` : `Streak: since ${fmtDate(s.streakStartedAt)}, ${s.streakDays} of ${s.streakDaysNeeded} days`,
  ];
  for (const r of s.reasons) lines.push(`Not yet: ${r}`);
  if (s.ended) lines.push(`WORLD ENDED ${fmtDate(s.ended.endedAt)} (${s.ended.kind})${s.ended.winner ? `, winner [${s.ended.winner.tag}] ${s.ended.winner.name}` : ''}: ${s.ended.reason}`);
  return lines;
}

export function showStatus(store: Store, now: number): AdminResult {
  return done(...statusLines(dominationStatus(store, { speed: worldSpeed(store) }, now)));
}

export function setSetting(store: Store, key: string | undefined, rawValue: string | undefined, now: number): AdminResult {
  if (!isDominationKey(key)) return fail(`Unknown setting. Keys: ${DOMINATION_KEYS.join(', ')}`);
  const lim = DOMINATION_LIMITS[key];
  const value = rawValue !== undefined && rawValue.trim() !== '' ? Number(rawValue) : Number.NaN;
  const check = checkDominationValue(key, value);
  if (!check.ok) return fail(`${check.message} (${lim.min}..${lim.max}${lim.integer ? ', whole number' : ''})`);
  return store.tx(() => {
    const before = readDominationSettings(store);
    writeDominationSettings(store, { ...before, [key]: check.value } as DominationSettings);
    audit(store, now, 'domination_set', `${key}: ${before[key]} -> ${check.value}; streak cleared`);
    return done(`${key}: ${before[key]} -> ${check.value}. The running streak was cleared.`);
  });
}

export function endByHand(store: Store, tagArg: string | undefined, reasonWords: readonly string[], now: number): AdminResult {
  if (store.isWorldEnded()) return fail('This world has already ended.');
  let winner: { tribeId: number; name: string; tag: string } | null = null;
  if (tagArg !== undefined && tagArg !== '-') {
    const tribe = store.tribes.getTribeByTag(tagArg.toUpperCase());
    if (!tribe) return fail(`No tribe with the tag ${tagArg}.`);
    winner = { tribeId: tribe.id, name: tribe.name, tag: tribe.tag };
  }
  const reason = reasonWords.join(' ').trim() || 'Ended by the operator.';
  const ended = endWorld(store, { at: now, kind: 'manual', winner, reason: reason.slice(0, 500), actorIp: 'cli' });
  if (!ended) return fail('This world has already ended.');
  const end = store.domination.getWorldEnd();
  const dto = end ? worldEndDto(end) : null;
  return done(
    `The world has ended${winner ? ` with winner [${winner.tag}] ${winner.name}` : ''}. Final rankings stored: ${dto?.finalTribes.length ?? 0} tribes shown, ${dto?.finalPlayers.length ?? 0} players shown.`,
    'Players are blocked from changing the game on their next request; a running server announces it within a second.',
  );
}

export function extendWorld(store: Store, rawDays: string | undefined, now: number): AdminResult {
  if (store.isWorldEnded()) return fail('This world has already ended; it cannot be extended.');
  const days = rawDays !== undefined && rawDays.trim() !== '' ? Number(rawDays) : Number.NaN;
  if (!Number.isFinite(days) || days <= 0) return fail('Days must be a number above 0.');
  return store.tx(() => {
    const before = readDominationSettings(store);
    const next = Math.round((before.minAgeDays + days) * 1000) / 1000;
    const check = checkDominationValue('minAgeDays', next);
    if (!check.ok) return fail(`${check.message} (adding ${days} days to ${before.minAgeDays} is too much)`);
    writeDominationSettings(store, { ...before, minAgeDays: next });
    clearStreak(store);
    audit(store, now, 'world_extend', `+${days} days: minAgeDays ${before.minAgeDays} -> ${next}; streak cleared`);
    return done(`Domination now counts from day ${next} (was ${before.minAgeDays}). The running streak was cleared.`);
  });
}

/** Run one command. `args` are the words after the command name. */
export function runDominationCommand(store: Store, cmd: DominationCommand, args: readonly string[], now: number): AdminResult {
  switch (cmd) {
    case 'domination':
      return showStatus(store, now);
    case 'domination-set':
      return setSetting(store, args[0], args[1], now);
    case 'world-end':
      return endByHand(store, args[0], args.slice(1), now);
    case 'world-extend':
      return extendWorld(store, args[0], now);
  }
}
