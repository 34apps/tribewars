// Bell + alerts sheet (docs/GAME_DESIGN.md 18.10): who is coming, from where, and when it lands. Never a unit list (the API has none).
// The sheet is not a modal: no scrim, the village stays bright. Desktop: a cream sheet floating at the right that grows with its rows
// (the page scrolls, no inner scrollbar). Phone: a bottom sheet with a grab handle.

import { useEffect, useRef, useState } from 'react';
import type { NotificationDto } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import type { IconName } from '../art/Icon.tsx';
import { formatAgo, formatCoords, formatDuration } from '../format.ts';
import { useGame } from '../game.ts';
import type { NotificationsStore } from '../hooks/useNotifications.ts';
import { NOTIFICATIONS_SHOWN, NOTIFICATION_LABEL, splitNotifications } from '../notifications.ts';
import type { BrowserAlertState } from '../notifications.ts';

const KIND_ICON: Record<NotificationDto['kind'], IconName> = { incoming_attack: 'warning', incoming_support: 'support', incoming_resources: 'chest' };

/** The round bell button with its badge (red while an unread attack is still on the way). `unread` counts only rows still on the way. */
export function NotificationBell({ unread, danger, onClick, compact, open }: { unread: number; danger: boolean; onClick: () => void; compact?: boolean; open?: boolean }) {
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <button type="button" className={`bell${compact ? ' bell-compact' : ''}${open ? ' is-open' : ''}`} aria-label={label} aria-expanded={open ?? undefined} title="Notifications" onClick={onClick}>
      <span className="bell-token" aria-hidden="true">
        <Icon name="bell" size={compact ? 22 : 26} />
      </span>
      {unread > 0 && (
        <span className={`badge${danger ? ' badge-danger' : ''}`} aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

/** "Browser alerts off · Turn on" and what each browser state means. The permission prompt only ever comes from this button. */
export function BrowserAlertsBox({ state, onEnable }: { state: BrowserAlertState; onEnable: () => void }) {
  return (
    <div className="notif-alerts">
      {state === 'default' && (
        <p>
          Browser alerts off <span aria-hidden="true">·</span>{' '}
          <button type="button" className="notif-link" aria-label="Turn on browser alerts" onClick={onEnable}>
            Turn on
          </button>
        </p>
      )}
      {state === 'granted' && <p>Browser alerts are on.</p>}
      {state === 'denied' && <p title="Allow notifications for this site in your browser settings.">Browser alerts blocked.</p>}
      {state === 'unsupported' && <p>This browser cannot show alerts.</p>}
    </div>
  );
}

function NotificationRow({ n, now, multiVillage, onOpen }: { n: NotificationDto; now: number; multiVillage: boolean; onOpen: (n: NotificationDto) => void }) {
  const left = n.arriveAt - now;
  const onWay = left > 0;
  const who = n.origin.ownerName || n.origin.name;
  const coords = formatCoords(n.origin.x, n.origin.y);
  const when = onWay ? formatDuration(left) : formatAgo(n.arriveAt, now);
  const tone = onWay ? (n.kind === 'incoming_attack' ? 'is-attack' : 'is-calm') : 'is-past';
  const label = `${NOTIFICATION_LABEL[n.kind]} from ${who} (${coords})${multiVillage ? ` to ${n.target.name}` : ''}, ${onWay ? `arrives in ${when}` : `arrived ${when}`}. Show`;
  return (
    <li>
      <button type="button" className={`nrow ${tone}${n.read ? '' : ' is-unread'}`} aria-label={label} onClick={() => onOpen(n)}>
        <span className="nrow-ico" aria-hidden="true">
          <Icon name={KIND_ICON[n.kind]} size={22} />
        </span>
        <span className="nrow-who" aria-hidden="true">
          <strong>{who}</strong> <span className="nrow-xy">({coords})</span>
          {multiVillage && <span className="nrow-to"> to {n.target.name}</span>}
        </span>
        <span className="nrow-time" aria-hidden="true">
          {when}
        </span>
        <svg className="nrow-chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </li>
  );
}

/** The list itself (newest rows only), split into "On the way" and "Earlier". Presentational: the sheet feeds it. */
export function NotificationList({ items, now, onOpen, multiVillage = false }: { items: readonly NotificationDto[]; now: number; onOpen: (n: NotificationDto) => void; multiVillage?: boolean }) {
  const { onTheWay, earlier } = splitNotifications(items, now);
  if (onTheWay.length + earlier.length === 0) {
    return <p className="muted">No warnings yet.</p>;
  }
  const section = (title: string, rows: NotificationDto[]) =>
    rows.length > 0 && (
      <section className="notif-section" aria-label={title}>
        <h3 className="notif-label">{title}</h3>
        <ul className="notif-list">
          {rows.map((n) => (
            <NotificationRow key={n.id} n={n} now={now} multiVillage={multiVillage} onOpen={onOpen} />
          ))}
        </ul>
      </section>
    );
  return (
    <>
      {section('On the way', onTheWay)}
      {section('Earlier', earlier)}
      {items.length > NOTIFICATIONS_SHOWN && <p className="muted">Showing the newest {NOTIFICATIONS_SHOWN} of {items.length}.</p>}
    </>
  );
}

export default function NotificationsSheet({ store, onClose }: { store: NotificationsStore; onClose: () => void }) {
  const { now, village, villages, selectVillage, viewMovement } = useGame();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Outside tap closes; a tap on the bell is the bell's own toggle.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current && t && !ref.current.contains(t) && !t.closest('.bell')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      previous?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div ref={ref} className="hud-sheet notif-sheet" role="dialog" aria-modal="false" aria-labelledby="notif-sheet-title" tabIndex={-1}>
      <span className="hud-grip" aria-hidden="true" />
      <div className="notif-head">
        <h2 id="notif-sheet-title" className="notif-title">
          Alerts
        </h2>
        <button type="button" className="notif-link" disabled={busy || store.unread === 0} onClick={() => void markAll()}>
          Mark all read
        </button>
        <button type="button" className="hud-x" onClick={onClose} aria-label="Close alerts">
          <Icon name="close" size={20} />
        </button>
      </div>
      <NotificationList items={store.items} now={now} onOpen={open} multiVillage={villages.length > 1} />
      <BrowserAlertsBox state={store.alerts} onEnable={() => void store.enableAlerts()} />
    </div>
  );
}
