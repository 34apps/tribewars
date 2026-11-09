// The DESKTOP in-game shell (owner, 2026-11-09, revised): fills the whole window, minimum 1440x900 (a smaller window scrolls, never squeezed). A fixed top bar (village,
// resources with storage fill, population, bell, account), a row of folder tabs and one cream sheet that holds the page. A smaller window
// scrolls; a bigger one grows the frame and the pages stretch (frame.css). Menu-only pages (support, rules, simulator, staff, results) are
// reached from the account menu. Phones use Shell.tsx.

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { RESOURCE_IDS, productionPerHour, storageCap } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { bannerText } from '../domination.ts';
import { TABS, useGame } from '../game.ts';
import type { NavTab } from '../game.ts';
import { formatCompact, formatDuration, formatInt, formatLeft, formatRate } from '../format.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';
import { useNotifications } from '../hooks/useNotifications.ts';
import { bellCounts } from '../notifications.ts';
import NotificationsSheet, { NotificationBell } from './Notifications.tsx';
import { TAB_ICON, TAB_LABEL, Who, usePopulation, useGuardOrders } from './Shell.tsx';
import type { AccountActions } from './Shell.tsx';
import { VillageBar } from './VillageSwitcher.tsx';
import { useTribeFixed } from '../views/tribe/tribe-fixed.ts';
import { MiniVillage } from '../views/village/FrameBuilding.tsx';
import '../frame.css';

const ChieftainDialog = lazy(() => import('./ChieftainDialog.tsx'));
const SettingsDialog = lazy(() => import('./SettingsDialog.tsx'));

/** Wood/food/iron/gold with the rate and a thin storage-fill bar, then population used / cap. */
function TopResources() {
  const { live, settings } = useGame();
  const cap = storageCap(live);
  const net = productionPerHour(live, settings);
  const pop = usePopulation();
  return (
    <ul className="fr-res" aria-label="Resources">
      {RESOURCE_IDS.map((r) => {
        const ratio = cap > 0 ? live.resources[r] / cap : 0;
        const amount = Math.floor(live.resources[r] + 1e-9);
        return (
          <li key={r} className="fr-rs">
            <Icon name={RESOURCE_ICON[r]} size={28} />
            <span className="fr-rv">
              <span className="fr-ra">
                <b title={formatInt(amount)}>
                  <span className="visually-hidden">{RESOURCE_NAME[r]}: </span>
                  {formatCompact(amount)}
                  <span className="visually-hidden">
                    {' '}
                    of {formatInt(cap)}
                    {ratio >= 0.999 ? ' (full)' : ''}
                  </span>
                </b>
                <small className={Math.round(net[r]) < 0 ? 'is-neg' : Math.round(net[r]) === 0 ? 'is-zero' : ''}>{formatRate(net[r])}</small>
              </span>
              <span className="fr-sf" aria-hidden="true">
                <i className={ratio >= 0.9 ? 'hi' : ''} style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
              </span>
            </span>
          </li>
        );
      })}
      <li className="fr-rs fr-rs-pop" aria-label={pop.label}>
        <Icon name="pop" size={28} />
        <span className="fr-rv" aria-hidden="true">
          <span className="fr-ra">
            <b>{formatInt(pop.total)}</b>
            <small className="is-zero">/ {formatInt(pop.cap)}</small>
          </span>
          <span className="fr-sf fr-sf-pop">
            <i className="hi" style={{ width: `${Math.max(0, Math.min(1, pop.ratio)) * 100}%` }} />
          </span>
        </span>
      </li>
    </ul>
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
  const active = current === tab;
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
  const { player, now, movements, viewMovement, worldEnd, connectionError, tab, navigate } = useGame();
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
          onClick={() => viewMovement(first.id)}
          aria-label={`${incoming.length > 1 ? `${incoming.length} attacks, next` : 'Attack'} in ${left} from ${who}. Show`}
        >
          <Icon name="warning" size={22} />
          <span>{incoming.length > 1 ? `${incoming.length} attacks · ` : ''}Attack from {who}</span>
          <span className="fr-cd">{left}</span>
        </button>
      )}
    </div>
  );
}

export function FrameShell({ children, onSignOut, onSignOutEverywhere }: { children: ReactNode; onSignOut: () => void; onSignOutEverywhere: () => void }) {
  const { tab, worldEnd, now, navigate } = useGame();
  const [choosing, setChoosing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  // Draw the small village once while idle, off-screen, so building pages and Army show it at once (see MiniVillage).
  const [warming, setWarming] = useState(false);
  const warmDone = useCallback(() => setWarming(false), []);
  useEffect(() => {
    const t = window.setTimeout(() => setWarming(true), 1500);
    return () => window.clearTimeout(t);
  }, []);
  const notifications = useNotifications();
  const counts = bellCounts(notifications.items, now);
  const actions: AccountActions = { onSignOut, onSignOutEverywhere, onChangeChieftain: () => setChoosing(true), onSettings: () => setSettings(true) };
  const guardOrders = useGuardOrders();
  // Village, map, army, reports, mail and the Tribe Overview / Members keep the frame exactly window-tall, at least 900 px (no page scroll); every other page may grow it for now.
  const tribeFixed = useTribeFixed();
  const fixed = tab === 'village' || tab === 'map' || tab === 'army' || tab === 'reports' || tab === 'mail' || (tab === 'tribe' && tribeFixed);
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
          {TABS.map((t) => (
            <FolderTab key={t} tab={t} />
          ))}
          <TabRowAlerts />
        </nav>
        <main className={`fr-sheet${tab === 'map' ? ' is-map' : ''}${tab === 'village' ? ' is-village' : ''}`} id="main" onClickCapture={guardOrders}>
          {children}
        </main>
        {warming && (
          <div className="fv-left" aria-hidden="true" style={{ position: 'fixed', left: -9999, top: 0, visibility: 'hidden', pointerEvents: 'none' }}>
            <MiniVillage warm onWarm={warmDone} />
          </div>
        )}
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
