// Achievements (badge cards with tier colours and progress) and lifetime statistics on a player's profile sheet.

import { ACHIEVEMENTS, STAT_KEYS, STAT_LABELS, TIER_NAMES } from '@clanfire/engine';
import type { AchievementProgress, BadgeSummaryDto, PlayerStatsDto, WorldBadgeDto } from '@clanfire/engine';
import { formatInt } from '../format.ts';
import { BADGE_HELP, BadgeChip, BadgeRow } from '../components/Badges.tsx';

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

function Badge({ p }: { p: AchievementProgress }) {
  const def = BY_ID.get(p.id);
  if (!def) return null;
  const tierName = p.tier === 0 ? 'locked' : TIER_NAMES[p.tier - 1];
  // Progress inside the current tier band towards the next threshold.
  const from = p.tier === 0 ? 0 : def.tiers[p.tier - 1] ?? 0;
  const ratio = p.next === null ? 1 : Math.max(0, Math.min(1, (p.value - from) / Math.max(1, p.next - from)));
  const status = p.next === null ? 'Max' : `${formatInt(p.value)} / ${formatInt(p.next)}`;
  return (
    <li className={`ach ach-${tierName}`} title={def.description} aria-label={`${def.name}: ${tierName === 'locked' ? 'locked' : `${tierName} tier`}. ${def.description} ${status}.`}>
      <span className="ach-medal" aria-hidden="true">
        {p.tier === 0 ? '?' : '★'.repeat(p.tier)}
      </span>
      <span className="ach-body">
        <span className="ach-name">{def.name}</span>
        <span className="ach-meter" aria-hidden="true">
          <span style={{ width: `${ratio * 100}%` }} />
        </span>
        <span className="ach-status" aria-hidden="true">{status}</span>
      </span>
    </li>
  );
}

export function ProfileExtras({ stats, achievements, badges = [], worldBadges = [] }: { stats: PlayerStatsDto; achievements: AchievementProgress[]; badges?: BadgeSummaryDto[]; worldBadges?: WorldBadgeDto[] }) {
  const earned = achievements.filter((a) => a.tier > 0).length;
  return (
    <div className="prof-extras">
      {(badges.length > 0 || worldBadges.length > 0) && (
        <section aria-label="Badges">
          <div className="title-row">
            <h3 className="prof-h">Badges</h3>
            <details className="help-pop on-light">
              <summary aria-label="About badges">?</summary>
              <p className="small">{BADGE_HELP}</p>
            </details>
          </div>
          <BadgeRow badges={badges} />
          {worldBadges.length > 0 && (
            <>
              <p className="muted small">This world</p>
              <ul className="badge-row" aria-label="This world">
                {worldBadges.map((b) => (
                  <BadgeChip key={b.badge} badge={b.badge} place={b.place} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <section aria-label="Achievements">
        <h3 className="prof-h">
          Achievements <span className="muted small">{earned} / {achievements.length}</span>
        </h3>
        <ul className="ach-grid">
          {achievements.map((a) => (
            <Badge key={a.id} p={a} />
          ))}
        </ul>
      </section>
      <section aria-label="Statistics">
        <h3 className="prof-h">Statistics</h3>
        <dl className="stat-list">
          {STAT_KEYS.map((k) => (
            <div key={k}>
              <dt className="muted small">{STAT_LABELS[k]}</dt>
              <dd>{formatInt(stats[k])}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
