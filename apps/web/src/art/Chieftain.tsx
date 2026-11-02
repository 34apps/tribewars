// Chieftain portraits (badge versions for small sizes), loaded as plain .svg assets by the player's chosen id.

import { DEFAULT_CHIEFTAIN } from '@clanfire/engine';

const FILES = import.meta.glob('./chieftains/*.svg', { query: '?no-inline', import: 'default', eager: true }) as Record<string, string>;

/** Chieftain id (CHIEFTAINS in the engine config) -> portrait file. */
const FILE_BY_ID: Record<string, string> = {
  'old-orm': 'orm-the-elder',
  ysra: 'ysra-the-firebrand',
  brannoc: 'brannoc-one-eye',
  hild: 'hild-ironveil',
  'barley-tam': 'barley-tam',
  maelis: 'seer-maelis',
  corwen: 'corwen-the-heir',
  khorza: 'khorza-longmane',
  saffi: 'saffi-goldhand',
  wren: 'wren-the-huntress',
};

export function chieftainUrl(id: string): string {
  const file = FILE_BY_ID[id] ?? FILE_BY_ID[DEFAULT_CHIEFTAIN] ?? 'orm-the-elder';
  return FILES[`./chieftains/${file}.svg`] ?? '';
}

export function ChieftainAvatar({ id, size = 46, className }: { id: string; size?: number; className?: string }) {
  return (
    <img
      src={chieftainUrl(id)}
      width={size}
      height={size}
      alt=""
      className={className ? `avatar ${className}` : 'avatar'}
      draggable={false}
    />
  );
}
