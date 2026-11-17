// Presentational pieces of the send forms' hints (no CSS import and no game context, so the tests can render them; the styles are in attack-hint.css,
// imported by AttackHint.tsx).
import type { MapVillageDto } from '@clanfire/engine';
import { attackHintText } from '../attackHint.ts';
import type { AttackHint as Hint } from '../attackHint.ts';
import type { SupportTimingLine } from '../supportTiming.ts';

/** Can a hint make sense for this target? (A player's village that can be hit, or an abandoned one that still has defenders: an empty abandoned village needs no troop count.) */
export function hintTarget(target: Pick<MapVillageDto, 'id' | 'kind' | 'protected' | 'defended'> | null): boolean {
  if (!target || target.id <= 0) return false;
  if (target.kind === 'player') return !target.protected;
  return target.kind === 'abandoned' && target.defended === true;
}

/** The hint as the form shows it: a tag, then short lines (presentational; the tests render it). */
export function AttackHintView({ hint, now }: { hint: Hint; now: number }) {
  const t = attackHintText(hint, now);
  const [first, ...rest] = t.lines;
  return (
    <div className="ah" aria-live="polite">
      <p className="ah-l ah-row">
        {t.tag && <span className={`tag tag-${t.tag.tone} ah-tag`}>{t.tag.label}</span>}
        {first && <span>{first}</span>}
      </p>
      {rest.map((line, i) => (
        <p key={i} className={`ah-l${i === rest.length - 1 ? ' ah-last' : ''}`}>
          {line}
        </p>
      ))}
    </div>
  );
}

/** "Will my help arrive in time?": one line per attack, a green tag when the help lands first, a red one when it does not. */
export function SupportTimingView({ lines }: { lines: SupportTimingLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="ah ah-support" aria-live="polite">
      {lines.map((l) => (
        <p key={l.movementId} className="ah-l ah-row">
          <span className={`tag ${l.inTime ? 'tag-ok' : 'tag-bad'} ah-tag`}>{l.inTime ? 'In time' : 'Too late'}</span>
          <span>{l.text}</span>
        </p>
      ))}
    </div>
  );
}
