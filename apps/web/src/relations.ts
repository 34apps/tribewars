// How a village relates to the viewer: map colours, labels and the words used in panels.

import type { DiplomacyKind, PlayerRelation, TribeRole } from '@clanfire/engine';

/** PlayerRelation plus 'abandoned' (villages without an owner). */
export type RelationKey = PlayerRelation | 'abandoned';

interface RelationStyle {
  /** House walls and roof on the canvas; the roof is also the tag pill's background. */
  body: string;
  roof: string;
  label: string;
}

// Shades differ in lightness as well as hue so they stay apart for colour-blind players.
export const RELATION_STYLE: Record<RelationKey, RelationStyle> = {
  self: { body: '#f4c542', roof: '#b57f06', label: 'You' },
  tribe: { body: '#3aa84f', roof: '#17632a', label: 'Your tribe' },
  ally: { body: '#4f86e6', roof: '#1c4a9e', label: 'Ally' },
  nap: { body: '#a770dc', roof: '#5f2f93', label: 'Non-aggression pact' },
  enemy: { body: '#d9382f', roof: '#84140e', label: 'Enemy' },
  neutral: { body: '#f4963a', roof: '#a14d06', label: 'Neutral' },
  abandoned: { body: '#bba78c', roof: '#76624c', label: 'Abandoned' },
};

export const LEGEND_ORDER: readonly RelationKey[] = ['self', 'tribe', 'ally', 'nap', 'enemy', 'neutral', 'abandoned'];

/** Why Send is hidden for a village; null when attacking is allowed. */
export const ATTACK_BLOCKED_TEXT: Partial<Record<PlayerRelation, string>> = {
  self: 'This is your own village.',
  tribe: 'Your tribe-mate: you cannot attack members of your own tribe.',
  ally: 'Your ally: attacks are blocked while the alliance holds.',
  nap: 'Non-aggression pact: attacks are blocked while the pact holds.',
};

export const DIPLOMACY_NAME: Record<DiplomacyKind, string> = {
  ally: 'Alliance',
  nap: 'Non-aggression pact',
  enemy: 'Enemy',
};

export const DIPLOMACY_SHORT: Record<DiplomacyKind, string> = { ally: 'Ally', nap: 'NAP', enemy: 'Enemy' };

export const ROLE_NAME: Record<TribeRole, string> = { leader: 'Leader', officer: 'Officer', member: 'Member' };
