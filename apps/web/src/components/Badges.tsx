// World badges: small hand-made toy-style medals (inline SVG, no assets). Badges give no power; they only mark finished worlds.
// BadgeIcon = the drawing, BadgeChip = icon + short label (filled tag), BadgeRow = a wrapping row of chips.

import type { BadgeKind, BadgeSummaryDto } from '@clanfire/engine';

const INK = '#2b211c';

/** Short label: "Champion", "2nd tribe", "3rd tribe", "Top 10 · #4", "Veteran ×3". */
export function badgeLabel(b: { badge: BadgeKind; count?: number; place?: number | null; bestPlace?: number | null }): string {
  const place = b.place ?? b.bestPlace ?? null;
  const times = b.count !== undefined && b.count > 1 ? ` ×${b.count}` : '';
  switch (b.badge) {
    case 'champion':
      return `Champion${times}`;
    case 'second_tribe':
      return `2nd tribe${times}`;
    case 'third_tribe':
      return `3rd tribe${times}`;
    case 'top10':
      return `Top 10${place !== null ? ` · #${place}` : ''}${times}`;
    case 'veteran':
      return `Veteran${times}`;
  }
}

const MEDAL_FILL: Partial<Record<BadgeKind, { rim: string; face: string; shine: string }>> = {
  champion: { rim: '#b07720', face: '#f2b33d', shine: '#ffdc7a' },
  second_tribe: { rim: '#8c877d', face: '#d9d5cc', shine: '#fff8e8' },
  third_tribe: { rim: '#843a23', face: '#c98a52', shine: '#ef9c6e' },
};

const STAR = 'M12 5.2l1.9 4 4.4.5-3.3 3 .9 4.3L12 14.8 8.1 17l.9-4.3-3.3-3 4.4-.5z';

export function BadgeIcon({ kind, place, size = 22 }: { kind: BadgeKind; place?: number | null; size?: number }) {
  const medal = MEDAL_FILL[kind];
  return (
    <svg className="badge-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {medal && (
        <>
          <circle cx="12" cy="12" r="10" fill={medal.rim} stroke={INK} strokeWidth="1.6" />
          <circle cx="12" cy="12" r="7.4" fill={medal.face} stroke={INK} strokeWidth="1.2" />
          <path d="M7.6 9.4a5.4 5.4 0 0 1 4-2.6" fill="none" stroke={medal.shine} strokeWidth="1.4" strokeLinecap="round" />
          {kind === 'champion' ? (
            <path d={STAR} fill="#fff8e8" stroke={INK} strokeWidth="1" strokeLinejoin="round" />
          ) : (
            <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="800" fill={INK}>
              {kind === 'second_tribe' ? '2' : '3'}
            </text>
          )}
        </>
      )}
      {kind === 'top10' && (
        <>
          <path d="M12 1.8l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 16.4 6.1 19.6l1.3-6.5L2.5 8.6l6.6-.8z" fill="#7ad3cd" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
          {place !== null && place !== undefined && (
            <text x="12" y="14.4" textAnchor="middle" fontSize={place >= 10 ? 6.5 : 8} fontWeight="800" fill={INK}>
              {place}
            </text>
          )}
        </>
      )}
      {kind === 'veteran' && (
        <>
          <path d="M12 2.2l8 2.6v6.2c0 5.2-3.4 8.6-8 10.6-4.6-2-8-5.4-8-10.6V4.8z" fill="#a6c964" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M12 5.4v13.4M12 5.4l5.4 1.8" fill="none" stroke="#5e8c3a" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M8.2 11.6l2.6 2.6 5-5" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export function BadgeChip({ badge, count, place }: { badge: BadgeKind; count?: number; place?: number | null }) {
  const label = badgeLabel({ badge, count, place });
  return (
    <li className={`badge-chip badge-${badge}`} title={label}>
      <BadgeIcon kind={badge} place={place} />
      <span>{label}</span>
    </li>
  );
}

/** Account badges (per-kind summary) as a wrapping row; nothing at all when empty. */
export function BadgeRow({ badges, label = 'Badges' }: { badges: readonly BadgeSummaryDto[]; label?: string }) {
  if (badges.length === 0) return null;
  return (
    <ul className="badge-row" aria-label={label}>
      {badges.map((b) => (
        <BadgeChip key={b.badge} badge={b.badge} count={b.count} place={b.bestPlace} />
      ))}
    </ul>
  );
}

/** Icons only (tables): one small icon per badge with the label as tooltip and for screen readers. */
export function BadgeIcons({ badges }: { badges: readonly { badge: BadgeKind; place: number | null; count?: number }[] | undefined }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className="badge-icons">
      {badges.map((b) => (
        <span key={b.badge} className="badge-icon-wrap" title={badgeLabel(b)} role="img" aria-label={badgeLabel(b)}>
          <BadgeIcon kind={b.badge} place={b.place} size={18} />
        </span>
      ))}
    </span>
  );
}

/** Small badge icons next to a tribe member's name; nothing without badges. */
export function MemberBadges({ badges }: { badges: readonly BadgeSummaryDto[] | undefined }) {
  return <BadgeIcons badges={badges?.map((b) => ({ badge: b.badge, place: b.bestPlace, count: b.count }))} />;
}

/** The one plain help text (3 short lines) shown behind every "?" next to badges. */
export const BADGE_HELP =
  'Badges stay on your account for good. They give no power. Earned when a world ends: Champion / 2nd / 3rd tribe (14+ days in that tribe), Top 10 players, Veteran (still had a village). You must have played in the last week.';
