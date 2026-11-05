// Words for the "World rules" page: one value of the world's published config as plain text, and the settings grouped for display.
// Pure (no React, no art imports): unit-tested. Durations in the config are at speed 1, so real time is the value divided by the speed.

import { WORLD_CONFIG_FIELDS, getWorldConfigValue } from '@clanfire/engine';
import type { WorldConfig, WorldConfigField } from '@clanfire/engine';

export const RULE_GROUP_TITLE: Record<WorldConfigField['group'], string> = {
  pace: 'Pace',
  protection: 'Protection',
  npc: 'Abandoned villages',
  conquest: 'Conquest',
  domination: 'Winning the world',
  tribe: 'Tribes',
  features: 'Optional rules',
  queues: 'Queues',
};

const trim = (n: number, digits: number): string => String(Number(n.toFixed(digits)));

/** Real hours as short text: "36 h", "3.5 days" from 48 h on, "20 min" under an hour, "30 s" under a minute. */
export function realHoursText(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '–';
  if (hours >= 48) return `${trim(hours / 24, 1)} days`;
  if (hours >= 1) return `${trim(hours, 2)} h`;
  const minutes = hours * 60;
  if (minutes >= 1) return `${trim(minutes, 1)} min`;
  return `${trim(minutes * 60, 0)} s`;
}

/** Real days as short text: "14 days", or hours when it is under a day. */
export function realDaysText(days: number): string {
  if (!Number.isFinite(days) || days < 0) return '–';
  if (days >= 1) return `${trim(days, 1)} ${Number(days.toFixed(1)) === 1 ? 'day' : 'days'}`;
  return realHoursText(days * 24);
}

const intFormat = new Intl.NumberFormat();

export interface RuleValueText {
  /** What the setting is in this world, in real time. */
  value: string;
  /** "(8 h at speed 1)": only for durations in a world that does not run at speed 1. */
  atSpeed1: string | null;
}

/** One setting as the player reads it. `speed` is the world speed (config.pace.speed). */
export function ruleValueText(field: WorldConfigField, raw: number | boolean | undefined, speed: number): RuleValueText {
  if (typeof raw === 'boolean') return { value: raw ? 'On' : 'Off', atSpeed1: null };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { value: '–', atSpeed1: null };
  const s = speed > 0 && Number.isFinite(speed) ? speed : 1;
  switch (field.unit) {
    case 'hours':
      return { value: realHoursText(raw / s), atSpeed1: s !== 1 ? `(${realHoursText(raw)} at speed 1)` : null };
    case 'days':
      return { value: realDaysText(raw / s), atSpeed1: s !== 1 ? `(${realDaysText(raw)} at speed 1)` : null };
    case 'x':
      return { value: `${trim(raw, 2)}×`, atSpeed1: null };
    case 'share':
      return { value: `${trim(raw * 100, 2)}%`, atSpeed1: null };
    case 'tiles':
      return { value: `${trim(raw, 2)} tiles`, atSpeed1: null };
    case 'renown':
      return { value: `${intFormat.format(raw)} Renown`, atSpeed1: null };
    default:
      return { value: intFormat.format(raw), atSpeed1: null };
  }
}

export interface RuleRow {
  path: string;
  label: string;
  help: string;
  value: string;
  atSpeed1: string | null;
  /** The operator can still change it after the world has opened. */
  editable: boolean;
}

export interface RuleGroup {
  id: WorldConfigField['group'];
  title: string;
  rows: RuleRow[];
}

/** Every setting in display order, grouped. `editableAfterOpen`: the response's list of paths that may still change. */
export function ruleGroups(config: WorldConfig, editableAfterOpen: readonly string[]): RuleGroup[] {
  const groups: RuleGroup[] = [];
  for (const f of WORLD_CONFIG_FIELDS) {
    let g = groups.find((x) => x.id === f.group);
    if (!g) {
      g = { id: f.group, title: RULE_GROUP_TITLE[f.group], rows: [] };
      groups.push(g);
    }
    const v = ruleValueText(f, getWorldConfigValue(config, f.path), config.pace.speed);
    g.rows.push({ path: f.path, label: f.label, help: f.help, value: v.value, atSpeed1: v.atSpeed1, editable: editableAfterOpen.includes(f.path) });
  }
  return groups;
}
