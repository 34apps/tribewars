// Bell + notification sheet (docs/GAME_DESIGN.md 18.10): who sent what to which of my villages, when it left and when it lands.
// Never a unit list (the API has none). On phones the dialog is a full-width sheet at the top, on desktop a panel under the bell.

import { useEffect, useRef, useState } from 'react';
import type { NotificationDto } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { formatAgo, formatClock, formatCoords, formatDuration } from '../format.ts';
import { useGame } from '../game.ts';
import type { NotificationsStore } from '../hooks/useNotifications.ts';
import { NOTIFICATIONS_SHOWN, NOTIFICATION_LABEL, shownNotifications } from '../notifications.ts';
import type { BrowserAlertState } from '../notifications.ts';

const KIND_TAG: Record<NotificationDto['kind'], string> = { incoming_attack: 'tag-bad', incoming_support: 'tag-ok', incoming_resources: 'tag-ok' };

/** The bell button with its unread badge (red while an unread attack is in the list). */
export function NotificationBell({ unread, danger, onClick, compact }: { unread: number; danger: boolean; onClick: () => void; compact?: boolean }) {
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <button type="button" className={`bell${compact ? ' bell-compact' : ''}`} aria-label={label} title="Notifications" onClick={onClick}>
      <span className="bell-token" aria-hidden="true">
        <Icon name="bell" size={compact ? 22 : 24} />
      </span>
      {unread > 0 && (
        <span className={`badge${danger ? ' badge-danger' : ''}`} aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

/** "Turn on browser alerts" and what each browser state means. The permission prompt only ever comes from this button. */
export function BrowserAlertsBox({ state, onEnable }: { state: BrowserAlertState; onEnable: () => void }) {
  return (
    <div className="notif-alerts">
      {state === 'default' && (
        <>
          <button type="button" className="btn btn-small" onClick={onEnable}>
            Turn on browser alerts
          </button>
        </>
      )}
      {state === 'granted' && <p className="muted">Browser alerts are on.</p>}
      {state === 'denied' && <p className="muted" title="Allow notifications for this site in your browser settings.">Browser alerts blocked.</p>}
      {state === 'unsupported' && <p className="muted">This browser cannot show alerts.</p>}
    </div>
  );
}

function NotificationRow({ n, now, onOpen }: { n: NotificationDto; now: number; onOpen: (n: NotificationDto) => void }) {
  const left = n.arriveAt - now;
  const owner = n.origin.ownerName ? `${n.origin.ownerName}, ` : '';
  return (
    <li className={`notif${n.read ? '' : ' is-unread'}${n.kind === 'incoming_attack' ? ' is-attack' : ''}`}>
      <div className="notif-head">
        <span className={`tag ${KIND_TAG[n.kind]}`}>{NOTIFICATION_LABEL[n.kind]}</span>
        <span className="notif-time">
          <strong>{left > 0 ? formatDuration(left) : 'arrived'}</strong>
        </span>
      </div>
      <p className="notif-line">
        from {owner}
        <strong>{n.origin.name}</strong> ({formatCoords(n.origin.x, n.origin.y)}) to <strong>{n.target.name}</strong>
      </p>
      <div className="notif-foot">
        <span>
          Sent {formatClock(n.departAt, now)}
          <br />
          {left > 0 ? `Arrives ${formatClock(n.arriveAt, now)}` : `Arrived ${formatAgo(n.arriveAt, now)}`}
        </span>
        <button type="button" className="btn btn-small" onClick={() => onOpen(n)}>
          Show
        </button>
      </div>
    </li>
  );
}

/** The list itself (newest rows only). Presentational: the dialog feeds it. */
export function NotificationList({ items, now, onOpen }: { items: readonly NotificationDto[]; now: number; onOpen: (n: NotificationDto) => void }) {
  const shown = shownNotifications(items);
  if (shown.length === 0) {
    return <p className="muted">No warnings yet.</p>;
  }
  return (
    <>
      <ul className="notif-list" aria-label="Notifications">
        {shown.map((n) => (
          <NotificationRow key={n.id} n={n} now={now} onOpen={onOpen} />
        ))}
      </ul>
      {items.length > NOTIFICATIONS_SHOWN && <p className="muted">Showing the newest {NOTIFICATIONS_SHOWN} of {items.length}.</p>}
    </>
  );
}

export default function NotificationsDialog({ store, onClose }: { store: NotificationsStore; onClose: () => void }) {
  const { now, village, villages, selectVillage, viewMovement } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dlg.open) dlg.showModal();
    return () => {
      if (dlg.open) dlg.close();
      previous?.focus?.();
    };
  }, []);

  function open(n: NotificationDto) {
    if (n.target.villageId !== village.id && villages.some((v) => v.id === n.target.villageId)) selectVillage(n.target.villageId);
    onClose();
    viewMovement(n.movementId);
  }

  async function markAll() {
    if (busy) return;
    setBusy(true);
    await store.markAllRead();
    setBusy(false);
  }

  return (
    <dialog
      ref={ref}
      className="confirm notif-dialog"
      aria-labelledby="notif-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <h2 id="notif-dialog-title" className="card-title">
        Notifications{store.unread > 0 ? ` (${store.unread} unread)` : ''}
      </h2>
      <BrowserAlertsBox state={store.alerts} onEnable={() => void store.enableAlerts()} />
      <NotificationList items={store.items} now={now} onOpen={open} />
      <div className="confirm-actions">
        <button type="button" className="btn" disabled={busy || store.unread === 0} onClick={() => void markAll()}>
          Mark all read
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
