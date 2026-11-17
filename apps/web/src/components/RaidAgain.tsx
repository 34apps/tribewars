// "Raid again" / "Scout again" on a report: the button and the inline note (missing troops, result, server message).
// Used by the desktop and the phone Reports pages; `variant` picks the button family of the page it sits in.

import type { SendAgainDto } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import type { RaidAgainCtl } from '../hooks/useRaidAgain.ts';
import { againLabel, unitsText } from '../raidAgain.ts';
import '../raid.css';

export type AgainVariant = 'frame' | 'phone';

const BTN: Record<AgainVariant, string> = { frame: 'fv-btn sm ra-btn', phone: 'btn btn-small ra-btn' };
const BTN_GO: Record<AgainVariant, string> = { frame: 'fv-btn fv-btn-g sm ra-btn', phone: 'btn btn-small btn-primary ra-btn' };

/** The button. One press is one request: it greys while a send is on its way. */
export function RaidAgainButton({
  reportId,
  again,
  ctl,
  variant,
  title,
  onPressed,
}: {
  reportId: number;
  again: SendAgainDto;
  ctl: RaidAgainCtl;
  variant: AgainVariant;
  title?: string;
  /** Called right after the press (a list row opens its report so the note shows there). */
  onPressed?: () => void;
}) {
  const label = againLabel(again);
  return (
    <button
      type="button"
      className={BTN[variant]}
      disabled={ctl.busy}
      title={title ?? `${label}: ${again.targetName}`}
      aria-label={`${label}: ${again.targetName}`}
      onClick={() => {
        ctl.press(reportId, again);
        onPressed?.();
      }}
    >
      <Icon name={again.mission === 'scout' ? 'scout' : 'raider'} size={variant === 'frame' ? 16 : 20} />
      <span>{ctl.busy ? 'Sending…' : label}</span>
    </button>
  );
}

/** The note under the report that was pressed: what is missing (with the choices), the result, or the server's message. */
export function RaidAgainNote({ reportId, ctl, variant }: { reportId: number; ctl: RaidAgainCtl; variant: AgainVariant }) {
  const v = ctl.view;
  if (!v || v.reportId !== reportId) return null;
  if (v.phase === 'sent') {
    return (
      <div className="ra-note is-ok" role="status">
        <span>{v.text}</span>
        <button type="button" className={BTN[variant]} onClick={ctl.close}>
          OK
        </button>
      </div>
    );
  }
  if (v.phase === 'error') {
    return (
      <div className="ra-note is-bad" role="alert">
        <span>{v.text}</span>
        <button type="button" className={BTN[variant]} onClick={ctl.close}>
          OK
        </button>
      </div>
    );
  }
  const d = v.decision;
  const partial = d.kind === 'partial';
  return (
    <div className="ra-note is-warn" role="alert">
      <span>
        {d.text}
        {partial && (
          <>
            {'. '}
            <span className="ra-can">Can go now: {unitsText(d.units)}.</span>
          </>
        )}
      </span>
      <span className="ra-acts">
        {partial && (
          <button type="button" className={BTN_GO[variant]} disabled={ctl.busy} onClick={ctl.sendRest}>
            Send what is there
          </button>
        )}
        <button type="button" className={BTN[variant]} onClick={ctl.close}>
          Cancel
        </button>
      </span>
    </div>
  );
}
