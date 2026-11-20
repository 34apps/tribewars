// The DESKTOP in-game shell (owner, 2026-11-09, revised): fills the whole window, minimum 1440x900 (a smaller window scrolls, never squeezed). A fixed top bar (village,
// resources with storage fill, population, bell, account), a row of folder tabs and one cream sheet that holds the page. A smaller window
// scrolls; a bigger one grows the frame and the pages stretch (frame.css). Menu-only pages (support, rules, simulator, staff, results) are
// reached from the account menu. Phones use Shell.tsx.

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { storageCap } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { bannerText } from '../domination.ts';
import { navTabs, useGame } from '../game.ts';
import type { NavTab } from '../game.ts';
import { formatCompact, formatDuration, formatInt, formatLeft } from '../format.ts';
import { useNotifications } from '../hooks/useNotifications.ts';
import { useRaidListsEntitled } from '../hooks/useRaidListsOn.ts';
import { bellCounts } from '../notifications.ts';
import NotificationsSheet, { NotificationBell } from './Notifications.tsx';
import { ResourcePills } from './ResourcePills.tsx';
import { TAB_ICON, TAB_LABEL, Who, usePopulation, useGuardOrders } from './Shell.tsx';
import type { AccountActions } from './Shell.tsx';
import { VillageBar } from './VillageSwitcher.tsx';
import '../villages.css';
import { useTribeFixed } from '../views/tribe/tribe-fixed.ts';
import '../frame.css';

const ChieftainDialog = lazy(() => import('./ChieftainDialog.tsx'));
const SettingsDialog = lazy(() => import('./SettingsDialog.tsx'));

/** Storehouse cap, the four fill-up resource pills (tap = exact numbers), then population used / cap. */
function TopResources() {
  const { live } = useGame();
  const cap = storageCap(live);
  const pop = usePopulation();
  const popState = pop.ratio >= 0.999 ? ' is-full' : pop.ratio >= 0.9 ? ' is-near' : '';
  return (
    <ResourcePills
      className="fr-res"
      before={
        <li className="fr-rs fr-rs-cap" title={`Storehouse: each resource holds up to ${formatInt(cap)}`}>
          <Icon name="chest" size={24} />
          <span className="fr-rv">
            <b>
              <span className="visually-hidden">Storage capacity: </span>
              {formatCompact(cap)}
            </b>
            <span className="fr-cap-label" aria-hidden="true">Storehouse</span>
          </span>
        </li>
      }
      after={
        <li className={`fr-rs fr-rs-pop${popState}`} aria-label={pop.label}>
          <Icon name="pop" size={24} />
          <span className="fr-rv" aria-hidden="true">
            <b>{formatCompact(pop.total)}</b>
            <span className="fr-cap-label">/ {formatCompact(pop.cap)}</span>
          </span>
          <span className="fr-sf fr-sf-pop">
            <i className={pop.ratio >= 0.9 ? 'hi' : ''} style={{ width: `${Math.max(0, Math.min(1, pop.ratio)) * 100}%` }} />
          </span>
        </li>
      }
    />
  );
}

/** Small filled number on a folder tab: dark for unread counts, red for attacks and tribe alerts. */
function TabBadge({ n, danger, label, dot }: { n: number; danger?: boolean; label: string; dot?: boolean }) {
  if (n <= 0) return null;
  return (
    <span className={`fr-bd${danger ? ' is-danger' : ''}${dot ? ' is-dot' : ''}`} aria-label={label}>
      {dot ? null : n > 99 ? '99+' : n}
    </span>
  );
}

function FolderTab({ tab }: { tab: NavTab }) {
  const { tab: current, navigate, unreadReports, unreadMail, tribeInvites, tribeAlerts, movements, now } = useGame();
  // The Incoming attacks page belongs to the Army folder (the chip that opens it sits next to the tabs).
  const active = current === tab || (tab === 'army' && current === 'incoming');
  const attacks = tab === 'army' ? movements.filter((m) => m.direction === 'incoming' && m.kind === 'attack' && m.arriveAt > now - 1000).length : 0;
  const tribeLabel = [
    tribeAlerts > 0 ? `${tribeAlerts} attack ${tribeAlerts === 1 ? 'alert' : 'alerts'}` : '',
    tribeInvites > 0 ? `${tribeInvites} ${tribeInvites === 1 ? 'invitation' : 'invitations'}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <button type="button" className={`fr-ft${active ? ' is-on' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => navigate(tab)}>
      <Icon name={TAB_ICON[tab]} size={active ? 28 : 26} />
      <span>{TAB_LABEL[tab]}</span>
      {tab === 'army' && <TabBadge n={attacks} danger dot label={`${attacks} incoming ${attacks === 1 ? 'attack' : 'attacks'}`} />}
      {tab === 'reports' && <TabBadge n={unreadReports} label={`${unreadReports} unread`} />}
      {tab === 'mail' && <TabBadge n={unreadMail} label={`${unreadMail} unread mail`} />}
      {tab === 'tribe' && <TabBadge n={tribeInvites + tribeAlerts} danger={tribeAlerts > 0} label={tribeLabel} />}
    </button>
  );
}

/** Right end of the tab row: the red attack pill (next attack and its countdown), the protection chip, world-end and connection notes. */
function TabRowAlerts() {
  const { player, now, movements, worldEnd, connectionError, tab, navigate } = useGame();
  const protectedLeft = player.protectedUntil - now;
  const incoming = movements.filter((m) => m.direction === 'incoming' && m.kind === 'attack' && m.arriveAt > now - 1000).sort((a, b) => a.arriveAt - b.arriveAt);
  const first = incoming[0];
  const who = first ? first.origin.ownerName || first.origin.name : '';
  const left = first ? formatDuration(first.arriveAt - now) : '';
  return (
    <div className="fr-alerts">
      {worldEnd && (
        <span className="fr-note" role="status">
          <Icon name="flame" size={20} />
          {bannerText(worldEnd)} Orders closed.
          {tab !== 'results' && (
            <button type="button" className="fr-note-btn" onClick={() => navigate('results')}>
              See results
            </button>
          )}
        </span>
      )}
      {connectionError && (
        <span className="fr-note is-warn" role="status">
          Connection problem. Retrying…
        </span>
      )}
      {protectedLeft > 0 && (
        <span className="fr-note is-protect">
          <Icon name="shield" size={20} />
          Protected <strong>{formatLeft(protectedLeft)}</strong>
        </span>
      )}
      {first && (
        <button
          type="button"
          className="fr-ach"
          onClick={() => navigate('incoming')}
          aria-label={`${incoming.length > 1 ? `${incoming.length} attacks, next` : 'Attack'} in ${left} from ${who}. Open incoming attacks`}
        >
          <Icon name="warning" size={22} />
          <span className="fr-ach-t">{incoming.length > 1 ? `${incoming.length} attacks · ` : ''}Attack from {who}</span>
          <span className="fr-cd">{left}</span>
        </button>
      )}
    </div>
  );
}

export function FrameShell({ children, onSignOut, onSignOutEverywhere }: { children: ReactNode; onSignOut: () => void; onSignOutEverywhere: () => void }) {
  const { tab, worldEnd, now, navigate, villages } = useGame();
  const [choosing, setChoosing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const notifications = useNotifications();
  const counts = bellCounts(notifications.items, now);
  const actions: AccountActions = { onSignOut, onSignOutEverywhere, onChangeChieftain: () => setChoosing(true), onSettings: () => setSettings(true) };
  const guardOrders = useGuardOrders();
  // Village, realm, notes, map, incoming attacks, army, reports, mail and the Tribe Overview / Members keep the frame exactly window-tall, at least 900 px (no page scroll); every other page may grow it for now.
  const tribeFixed = useTribeFixed();
  const raidListsEntitled = useRaidListsEntitled();
  const fixed = tab === 'village' || tab === 'realm' || tab === 'notes' || tab === 'incoming' || tab === 'map' || tab === 'army' || tab === 'raids' || tab === 'reports' || tab === 'mail' || (tab === 'tribe' && tribeFixed);
  return (
    <div className="frame-root">
      <div className={`frame fr-tab-${tab}${fixed ? ' is-fixed' : ''}${worldEnd ? ' is-ended' : ''}`}>
        <header className="fr-top">
          <button type="button" className="fr-logo" aria-label="Village" onClick={() => navigate('village')}>
            <Icon name="flame" size={28} />
          </button>
          <VillageBar frame />
          <TopResources />
          <NotificationBell unread={counts.count} danger={counts.danger} open={bellOpen} compact onClick={() => setBellOpen((o) => !o)} />
          <Who {...actions} />
        </header>
        <nav className="fr-tabs" aria-label="Main">
          {navTabs(villages.length, raidListsEntitled).map((t) => (
            <FolderTab key={t} tab={t} />
          ))}
          <TabRowAlerts />
        </nav>
        <main className={`fr-sheet${tab === 'map' ? ' is-map' : ''}${tab === 'village' ? ' is-village' : ''}`} id="main" onClickCapture={guardOrders}>
          {children}
        </main>
        {bellOpen && <NotificationsSheet store={notifications} onClose={() => setBellOpen(false)} />}
      </div>
      {settings && (
        <Suspense fallback={null}>
          <SettingsDialog onClose={() => setSettings(false)} />
        </Suspense>
      )}
      {choosing && (
        <Suspense fallback={null}>
          <ChieftainDialog onClose={() => setChoosing(false)} />
        </Suspense>
      )}
    </div>
  );
}
