// Operator commands for the per-world rules (called from admin.ts, testable on its own).
//   config                       list every setting of this world (path, value, unit) and whether the world is open
//   config-set <path> <value>    change one setting; after the world has opened only the safe ones can change
//   world-open                   mark the world open by hand (it also opens with the first player)
// Every change writes an audit log row (actor: the CLI). A running server copies the change into its settings on its next request
// or 1 s tick, so no restart is needed. `domination.*` settings behave exactly like `domination-set` (the running streak is cleared).

import {
  WORLD_CONFIG_FIELDS,
  WORLD_CONFIG_SAFE_AFTER_OPEN,
  getWorldConfigValue,
  isSafeAfterOpen,
  parseWorldConfigInput,
  setWorldConfigValue,
  worldConfigField,
  type WorldConfigField,
} from '@clanfire/engine';
import { setSetting, type AdminResult } from './domination-admin.ts';
import type { Store } from './store.ts';

export const WORLD_CONFIG_COMMANDS = ['config', 'config-set', 'world-open'] as const;
export type WorldConfigCommand = (typeof WORLD_CONFIG_COMMANDS)[number];

export const isWorldConfigCommand = (cmd: string | undefined): cmd is WorldConfigCommand => (WORLD_CONFIG_COMMANDS as readonly string[]).includes(cmd ?? '');

export const WORLD_CONFIG_USAGE = 'config | config-set <path> <value> (path like conquest.holdHours, see `config`) | world-open';

const fail = (msg: string): AdminResult => ({ ok: false, lines: [msg] });
const done = (...lines: string[]): AdminResult => ({ ok: true, lines });

function audit(store: Store, now: number, action: string, detail: string): void {
  store.audit({ at: now, actorId: null, actorIp: 'cli', action, targetPlayer: null, detail: detail.slice(0, 500) });
}

const showValue = (v: number | boolean | undefined): string => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));
const unitText = (f: WorldConfigField): string => (f.unit === 'flag' ? '' : ` ${f.unit}`);

/** Every setting, grouped, and whether the world is open. */
export function listConfig(store: Store): AdminResult {
  const config = store.effectiveWorldConfig();
  const open = store.isWorldOpen();
  const at = store.worldOpenedAt();
  const lines = [
    open
      ? `The world is OPEN${at !== null ? ` (since ${new Date(at).toISOString()})` : ''}: only settings marked "(can change after opening)" can still change.`
      : 'The world is not open yet: every setting can still change. It opens with the first player or with world-open.',
  ];
  let group = '';
  for (const f of WORLD_CONFIG_FIELDS) {
    if (f.group !== group) {
      group = f.group;
      lines.push('', `[${group}]`);
    }
    lines.push(`  ${f.path} = ${showValue(getWorldConfigValue(config, f.path))}${unitText(f)}${isSafeAfterOpen(f.path) ? ' (can change after opening)' : ''}`);
  }
  return done(...lines);
}

/** Change one setting. `rawValue` is the text from the command line. */
export function setConfigValue(store: Store, path: string | undefined, rawValue: string | undefined, now: number): AdminResult {
  const field = path === undefined ? undefined : worldConfigField(path);
  if (!path || !field) return fail(`Unknown setting "${path ?? '(missing)'}". Run "config" to list them.`);
  if (store.isWorldOpen() && !isSafeAfterOpen(path)) {
    return fail(`The world is open: ${path} is fixed now (it would change running games). Still changeable: ${WORLD_CONFIG_SAFE_AFTER_OPEN.join(', ')}, domination.*`);
  }
  const parsed = parseWorldConfigInput(path, rawValue ?? '');
  if (!parsed.ok) return fail(`${parsed.message} (${field.min}..${field.max}${field.integer ? ', whole number' : ''})`);

  return store.tx(() => {
    const config = store.effectiveWorldConfig();
    const before = getWorldConfigValue(config, path);
    if (before === parsed.value) return done(`${path} is already ${showValue(before)}; nothing changed.`);
    const change = `${path} ${showValue(before)} -> ${showValue(parsed.value)}`;
    if (path.startsWith('domination.')) {
      // Same code as `domination-set`: writes world_config (+ the mirror in world_settings), clears the running streak, audit row 'domination_set'.
      const r = setSetting(store, path.slice('domination.'.length), rawValue, now);
      if (r.ok) audit(store, now, 'world_config_set', change);
      return r;
    }
    store.setWorldConfig(setWorldConfigValue(config, path, parsed.value));
    audit(store, now, 'world_config_set', change);
    const lines = [`${change}.`];
    if (path === 'npc.density') lines.push('Note: abandoned villages are placed when the world is created, so this changes nothing in this world.');
    lines.push('A running server picks it up on its next request.');
    return done(...lines);
  });
}

/** Mark the world open now (keeps the earlier time if the first player already opened it). */
export function openWorldByHand(store: Store, now: number): AdminResult {
  if (store.getMeta('world_opened_at') !== null) return done(`The world was already marked open (${new Date(store.worldOpenedAt() ?? now).toISOString()}); nothing changed.`);
  const at = store.worldOpenedAt() ?? now;
  store.tx(() => {
    store.openWorld(at);
    audit(store, now, 'world_open', `opened ${new Date(at).toISOString()}`);
  });
  return done(`The world is now open (${new Date(at).toISOString()}). Only settings marked "(can change after opening)" can change from here.`);
}

/** Run one command. `args` are the words after the command name. */
export function runWorldConfigCommand(store: Store, cmd: WorldConfigCommand, args: readonly string[], now: number): AdminResult {
  switch (cmd) {
    case 'config':
      return listConfig(store);
    case 'config-set':
      return setConfigValue(store, args[0], args[1], now);
    case 'world-open':
      return openWorldByHand(store, now);
  }
}
