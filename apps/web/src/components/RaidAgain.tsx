// "Raid again" / "Scout again" on a report: a button that opens the send screen for the report's target (empty fields, nothing sent).
// Used by the desktop and the phone Reports pages; `variant` picks the button family of the page it sits in.

import type { SendAgainDto } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { useGame } from '../game.ts';
import { againLabel, lastTimeOf } from '../raidAgain.ts';

export type AgainVariant = 'frame' | 'phone';

const BTN: Record<AgainVariant, string> = { frame: 'fv-btn sm ra-btn', phone: 'btn btn-small ra-btn' };

export function RaidAgainButton({ again, variant, title }: { again: SendAgainDto; variant: AgainVariant; title?: string }) {
  const { showOnMap } = useGame();
  const label = againLabel(again);
  return (
    <button
      type="button"
      className={BTN[variant]}
      title={title ?? `${label}: ${again.targetName}`}
      aria-label={`${label}: ${again.targetName}`}
      onClick={() => showOnMap(again.x, again.y, { mission: again.mission, lastTime: lastTimeOf(again) })}
    >
      <Icon name={again.mission === 'scout' ? 'scout' : 'raider'} size={variant === 'frame' ? 16 : 20} />
      <span>{label}</span>
    </button>
  );
}
