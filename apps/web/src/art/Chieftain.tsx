// Chieftain portraits, loaded as plain .svg asset URLs (never inlined into JS).
// Two cuts per chieftain (design/sprites/chieftains): the full coin and a heavier "badge" cut for sizes up to 40 px.

import { CHIEFTAINS, DEFAULT_CHIEFTAIN } from '@clanfire/engine';

const BADGES = import.meta.glob('./chieftains/*.svg', { query: '?no-inline', import: 'default', eager: true }) as Record<string, string>;
const FULLS = import.meta.glob('./chieftains/full/*.svg', { query: '?no-inline', import: 'default', eager: true }) as Record<string, string>;

/** Largest rendered size (CSS px) that uses the badge cut. */
export const BADGE_MAX_SIZE = 40;

/** Chieftain id (CHIEFTAINS in the engine config) -> portrait file name. */
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

/** Unknown ids (older server, future chieftains) fall back to the default chieftain. */
function resolve(id: string | null | undefined): (typeof CHIEFTAINS)[number] {
  return CHIEFTAINS.find((c) => c.id === id) ?? CHIEFTAINS.find((c) => c.id === DEFAULT_CHIEFTAIN) ?? CHIEFTAINS[0];
}

export function chieftainUrl(id: string | null | undefined, size: number): string {
  const file = FILE_BY_ID[resolve(id).id] ?? 'orm-the-elder';
  return (size <= BADGE_MAX_SIZE ? BADGES[`./chieftains/${file}.svg`] : FULLS[`./chieftains/full/${file}.svg`]) ?? '';
}

/** "Wren, The Quiet Huntress": the alt text of every portrait. */
export function chieftainLabel(id: string | null | undefined): string {
  const c = resolve(id);
  return `${c.name}, ${c.title}`;
}

export function ChieftainAvatar({
  id,
  size = 46,
  className,
  eager,
}: {
  id: string | null | undefined;
  size?: number;
  className?: string;
  /** Skip lazy loading (the signed-in header avatar). */
  eager?: boolean;
}) {
  return (
    <img
      src={chieftainUrl(id, size)}
      width={size}
      height={size}
      alt={chieftainLabel(id)}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={className ? `avatar ${className}` : 'avatar'}
      draggable={false}
    />
  );
}
