// The PHONE in-game shell: a floating HUD (resources, village, bell) over every screen and a floating bottom dock with "More".
// Desktop uses the fixed 1440x900 frame instead (FrameShell.tsx). Attack warnings live in ONE place (AlertCards); the bell opens a non-modal alerts sheet.

import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { populationCap, populationUsage } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { ChieftainAvatar } from '../art/Chieftain.tsx';
import { Icon } from '../art/Icon.tsx';
import type { IconName } from '../art/Icon.tsx';
import { WORLD_ENDED_NOTICE, bannerText } from '../domination.ts';
import { useGame } from '../game.ts';
import type { NavTab as Tab } from '../game.ts';
import { formatCoords, formatDuration, formatInt } from '../format.ts';
import { useNotifications } from '../hooks/useNotifications.ts';
import { useAutoTab } from '../hooks/useAutoTab.ts';
import { useRaidListsEntitled } from '../hooks/useRaidListsOn.ts';
import { LOBBY_URL, isLobbyWorld, useWorldInfo } from '../hooks/useWorldInfo.ts';
import { bellCounts } from '../notifications.ts';
import { ResourcePills } from './ResourcePills.tsx';
import NotificationsSheet, { NotificationBell } from './Notifications.tsx';
import { RenameVillage, VillageBar } from './VillageSwitcher.tsx';
import '../villages.css';

const ChieftainDialog = lazy(() => import('./ChieftainDialog.tsx'));
const SettingsDialog = lazy(() => import('./SettingsDialog.tsx'));

export const TAB_LABEL: Record<Tab, string> = { village: 'Village', realm: 'Realm', map: 'Map', army: 'Army', raids: 'Raid lists', auto: 'Auto', reports: 'Reports', mail: 'Mail', tribe: 'Tribe', ranks: 'Ranks' };
export const TAB_ICON: Record<Tab, IconName> = { village: 'village', realm: 'realm', map: 'map', army: 'army', raids: 'raider', auto: 'train', reports: 'reports', mail: 'mail', tribe: 'tribe', ranks: 'ranks' };
/** The dock buttons on phones; Realm, Mail, Tribe and Ranks live in the More sheet. */
const PHONE_TABS: readonly Tab[] = ['village', 'map', 'army', 'reports'];

/** Population usage and its screen-reader text (shared by the HUD pill and the More sheet). */
export function usePopulation() {
  const { live } = useGame();
  const pop = populationUsage(live);
  const cap = populationCap(live);
  const ratio = cap > 0 ? pop.total / cap : 0;
  const label = `Population ${formatInt(pop.total)} of ${formatInt(cap)}${ratio >= 0.9 ? (ratio >= 0.999 ? ' (full)' : ' (almost full)') : ''}`;
  return { total: pop.total, cap, ratio, label };
}

/** World end and connection notes: slim cards under the HUD row. */
export function AlertNotes() {
  const { navigate, connectionError, worldEnd, tab } = useGame();
  if (!worldEnd && !connectionError) return null;
  return (
    <div className="hud-alerts">
      {worldEnd && (
        <div className="hud-note hud-ended" role="status">
          <Icon name="flame" size={22} />
          <span>{bannerText(worldEnd)} Orders closed.</span>
          {tab !== 'results' && (
            <button type="button" className="btn btn-small hud-note-btn" onClick={() => navigate('results')}>
              See results
            </button>
          )}
        </div>
      )}
      {connectionError && (
        <div className="hud-note hud-warn" role="status">
          <span>Connection problem. Retrying…</span>
        </div>
      )}
    </div>
  );
}

/** Attacks on phones: one slim pill row under the village tab (protection lives in the tab itself). */
function AlertCards() {
  const { now, movements, navigate } = useGame();
  const incoming = movements.filter((m) => m.direction === 'incoming' && m.kind === 'attack' && m.arriveAt > now - 1000).sort((a, b) => a.arriveAt - b.arriveAt);
  const first = incoming[0];
  const who = first ? first.origin.ownerName || first.origin.name : '';
  const left = first ? formatDuration(first.arriveAt - now) : '';
  const pill = first ? (
    <button type="button" className="hud-attack-pill" onClick={() => navigate('incoming')} aria-label={`${incoming.length > 1 ? `${incoming.length} attacks, next` : 'Attack'} in ${left} from ${who}. Open incoming attacks`}>
      <Icon name="warning" size={20} />
      <span className="hud-attack-pill-text">
        {incoming.length > 1 ? `${incoming.length} attacks` : 'Attack'} {left}
        <span className="hud-attack-who"> · {who}</span>
      </span>
    </button>
  ) : null;
  if (!pill) return null;
  return (
    <div className="hud-alerts">
      <div className="hud-alert-row">{pill}</div>
    </div>
  );
}

/** Small filled number on a dock button: red for attacks, dark for unread counts. */
function DockBadge({ n, danger, label }: { n: number; danger?: boolean; label: string }) {
  if (n <= 0) return null;
  return (
    <span className={`dbadge${danger ? ' is-danger' : ''}`} aria-label={label}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

function DockButton({ tab }: { tab: Tab }) {
  const { tab: current, navigate, unreadReports, unreadMail, tribeInvites, tribeAlerts, movements, now } = useGame();
  // The Incoming attacks page belongs to the Army button.
  const active = current === tab || (tab === 'army' && current === 'incoming');
  const attacks = tab === 'army' ? movements.filter((m) => m.direction === 'incoming' && m.kind === 'attack' && m.arriveAt > now - 1000).length : 0;
  const tribeLabel = [
    tribeAlerts > 0 ? `${tribeAlerts} attack ${tribeAlerts === 1 ? 'alert' : 'alerts'}` : '',
    tribeInvites > 0 ? `${tribeInvites} ${tribeInvites === 1 ? 'invitation' : 'invitations'}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <button type="button" className={`dbtn${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} title={TAB_LABEL[tab]} onClick={() => navigate(tab)}>
      <span className="dbtn-ico" aria-hidden="true">
        <Icon name={TAB_ICON[tab]} size={30} />
      </span>
      <span className="dbtn-label">{TAB_LABEL[tab]}</span>
      {tab === 'army' && <DockBadge n={attacks} danger label={`${attacks} incoming`} />}
      {tab === 'reports' && <DockBadge n={unreadReports} label={`${unreadReports} unread`} />}
      {tab === 'mail' && <DockBadge n={unreadMail} label={`${unreadMail} unread mail`} />}
      {tab === 'tribe' && <DockBadge n={tribeInvites + tribeAlerts} danger={tribeAlerts > 0} label={tribeLabel} />}
    </button>
  );
}

function MoreButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const { player, tab, unreadMail, tribeInvites, tribeAlerts } = useGame();
  const n = unreadMail + tribeInvites + tribeAlerts;
  const inMore = tab !== 'village' && tab !== 'map' && tab !== 'army' && tab !== 'incoming' && tab !== 'reports';
  return (
    <button type="button" className={`dbtn dbtn-more${open || inMore ? ' is-active' : ''}`} aria-expanded={open} aria-haspopup="dialog" aria-current={inMore ? 'page' : undefined} title="More" onClick={onClick}>
      <span className="dbtn-ico dbtn-avatar" aria-hidden="true">
        <ChieftainAvatar id={player.chieftain} size={30} eager />
      </span>
      <span className="dbtn-label">More</span>
      <DockBadge n={n} label={`${n} unread in Mail and Tribe`} />
    </button>
  );
}

/** The account items (rename, chieftain, rules, simulator, support, staff, settings, household, worlds, sign out). */
function AccountItems({
  onDone,
  onSignOut,
  onSignOutEverywhere,
  onChangeChieftain,
  onSettings,
}: {
  onDone: () => void;
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
  onChangeChieftain: () => void;
  onSettings: () => void;
}) {
  const { player, villages, tribeChanged, toast, navigate } = useGame();
  const [renaming, setRenaming] = useState(false);
  const worldInfo = useWorldInfo();
  const go = (fn: () => void) => () => {
    onDone();
    fn();
  };
  return (
    <div className="acct-items">
      {/* With several villages Rename sits in the village list; with one it lives here. */}
      {villages.length < 2 &&
        (renaming ? (
          <div className="acct-wide">
            <RenameVillage onDone={() => setRenaming(false)} />
          </div>
        ) : (
          <button type="button" className="btn btn-block" onClick={() => setRenaming(true)}>
            Rename village
          </button>
        ))}
      <button type="button" className="btn btn-block" onClick={go(() => navigate('notes'))}>
        Notes
      </button>
      <button type="button" className="btn btn-block" onClick={go(onChangeChieftain)}>
        Change chieftain
      </button>
      <button type="button" className="btn btn-block" onClick={go(() => navigate('rules'))}>
        World rules
      </button>
      <button type="button" className="btn btn-block" onClick={go(() => navigate('simulator'))}>
        Battle simulator
      </button>
      <button type="button" className="btn btn-block" onClick={go(() => navigate('support'))}>
        Contact support
      </button>
      {player.staffRole && (
        <button type="button" className="btn btn-block" onClick={go(() => navigate('staff'))}>
          Staff tools
        </button>
      )}
      <button type="button" className="btn btn-block" onClick={go(onSettings)}>
        Settings
      </button>
      <label className="muted acct-wide acct-household">
        <input
          type="checkbox"
          checked={player.householdShared}
          onChange={(e) => {
            const shared = e.target.checked;
            api
              .setHousehold(shared)
              .then(() => {
                tribeChanged();
                toast(shared ? 'Household shared.' : 'Household unshared.');
              })
              .catch((err) => toast(errorMessage(err)));
          }}
        />
        <span title="Accounts in the same household can't send troops to each other.">Shared household</span>
      </label>
      {isLobbyWorld(worldInfo) && (
        <a className="btn btn-block" href={LOBBY_URL}>
          Worlds
        </a>
      )}
      <button type="button" className="btn btn-block" onClick={onSignOut}>
        Sign out
      </button>
      {isLobbyWorld(worldInfo) && (
        <button type="button" className="btn btn-block" title="Ends all sessions on every device." onClick={onSignOutEverywhere}>
          Sign out everywhere
        </button>
      )}
    </div>
  );
}

export interface AccountActions {
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
  onChangeChieftain: () => void;
  onSettings: () => void;
}

/** Desktop: the round avatar button; opens the account menu. */
export function Who(actions: AccountActions) {
  const { player, village } = useGame();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const tag = player.tribe ? `[${player.tribe.tag}]` : '';
  return (
    <div className="who" ref={ref}>
      <button type="button" className="hud-avatar" aria-expanded={open} aria-label={`${player.username}${tag ? ` ${tag}` : ''}, account`} onClick={() => setOpen((o) => !o)}>
        <ChieftainAvatar id={player.chieftain} size={48} eager />
      </button>
      {open && (
        <div className="who-menu">
          <div>
            <strong>{player.username}</strong> {tag && <span className="who-tag">{tag}</span>}
            <div className="muted">
              {village.name} ({formatCoords(village.x, village.y)})
            </div>
          </div>
          <AccountItems onDone={() => setOpen(false)} {...actions} />
        </div>
      )}
    </div>
  );
}

/** Phone: bottom sheet behind the More button: population, Mail / Tribe / Ranks, and the account items. */
function MoreSheet({ onClose, ...actions }: AccountActions & { onClose: () => void }) {
  const { player, village, villages, navigate, unreadMail, tribeInvites, tribeAlerts } = useGame();
  const ref = useRef<HTMLDivElement>(null);
  const pop = usePopulation();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current && t && !ref.current.contains(t) && !t.closest('.dbtn-more')) onClose();
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
  const tag = player.tribe ? `[${player.tribe.tag}]` : '';
  const raidLists = useRaidListsEntitled();
  const autoTab = useAutoTab();
  const row = (tab: Tab, badge: number, danger = false) => (
    <button type="button" className="more-row" onClick={() => { onClose(); navigate(tab); }}>
      <span className="more-row-ico" aria-hidden="true">
        <Icon name={TAB_ICON[tab]} size={28} />
      </span>
      <span className="more-row-label">{TAB_LABEL[tab]}</span>
      <DockBadge n={badge} danger={danger} label={tab === 'mail' ? `${badge} unread mail` : `${badge} invitations or alerts`} />
    </button>
  );
  return (
    <div ref={ref} className="hud-sheet more-sheet" role="dialog" aria-modal="false" aria-label="More" tabIndex={-1}>
      <span className="hud-grip" aria-hidden="true" />
      <div className="more-head">
        <span className="more-avatar" aria-hidden="true">
          <ChieftainAvatar id={player.chieftain} size={48} eager />
        </span>
        <div className="more-who">
          <strong>
            {player.username} {tag && <span className="who-tag">{tag}</span>}
          </strong>
          <span className="more-sub">
            {village.name} ({formatCoords(village.x, village.y)}) ·{' '}
            <span className={`more-pop${pop.ratio >= 0.9 ? ' is-near-full' : ''}`} aria-label={pop.label}>
              <Icon name="pop" size={16} className="inline-icon" /> <span aria-hidden="true">{formatInt(pop.total)} / {formatInt(pop.cap)}</span>
            </span>
          </span>
        </div>
        <button type="button" className="hud-x" onClick={onClose} aria-label="Close menu">
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="more-rows">
        {raidLists && row('raids', 0)}
        {autoTab && row('auto', 0)}
        {villages.length >= 2 && row('realm', 0)}
        {row('mail', unreadMail)}
        {row('tribe', tribeInvites + tribeAlerts, tribeAlerts > 0)}
        {row('ranks', 0)}
      </div>
      <AccountItems onDone={onClose} {...actions} />
    </div>
  );
}

/** After the world ended the order screens (village, army, map) refuse their main buttons up front with a toast. Undefined when nothing is guarded. */
export function useGuardOrders(): ((e: MouseEvent<HTMLElement>) => void) | undefined {
  const { tab, worldEnd, toast } = useGame();
  return worldEnd && (tab === 'village' || tab === 'army' || tab === 'map')
    ? (e: MouseEvent<HTMLElement>) => {
        const button = (e.target as HTMLElement).closest('button');
        if (!button || button.closest('.wm-toolbar') || !(button.classList.contains('btn-primary') || button.type === 'submit')) return;
        e.preventDefault();
        e.stopPropagation();
        toast(WORLD_ENDED_NOTICE, { kind: 'warning' });
      }
    : undefined;
}

export function Shell({ children, onSignOut, onSignOutEverywhere }: { children: ReactNode; onSignOut: () => void; onSignOutEverywhere: () => void }) {
  const { tab, worldEnd, now } = useGame();
  const [choosing, setChoosing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Every tab floats the same HUD and dock over village art; page tabs (everything but village and map) put a cream sheet on top (Game.tsx).
  const pageMode = tab !== 'village' && tab !== 'map';
  const [hudH, setHudH] = useState(72);
  const hudRef = useRef<HTMLDivElement>(null);
  const notifications = useNotifications();
  const counts = bellCounts(notifications.items, now);
  const actions: AccountActions = { onSignOut, onSignOutEverywhere, onChangeChieftain: () => setChoosing(true), onSettings: () => setSettings(true) };

  // The HUD floats; pages and the map pad themselves by its measured height (it grows when an attack card shows).
  useLayoutEffect(() => {
    const el = hudRef.current;
    if (!el) return;
    const measure = () => setHudH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // After the world ended the server refuses every order. On the order screens (village, army, map) the main buttons say so
  // up front instead of waiting for the 403; reading, mail, chat and forum are untouched.
  const guardOrders = useGuardOrders();
  const bell = (
    <NotificationBell
      unread={counts.count}
      danger={counts.danger}
      open={bellOpen}
      compact
      onClick={() => {
        setMoreOpen(false);
        setBellOpen((o) => !o);
      }}
    />
  );
  return (
    <div className={`app app-${tab}${pageMode ? ' app-page' : ''}${worldEnd ? ' is-ended' : ''}`} style={{ '--hud-h': `${hudH}px` } as CSSProperties}>
      <header className="hud hud-phone hud-float" ref={hudRef}>
        <div className="hud-row">
          <ResourcePills compact />
          {bell}
        </div>
        <VillageBar />
        <AlertNotes />
        <AlertCards />
      </header>
      <main className={`main${tab === 'map' ? ' main-map' : ''}${tab === 'village' ? ' main-village' : ''}`} id="main" onClickCapture={guardOrders}>
        {children}
      </main>
      <nav className="dock" aria-label="Main">
        {PHONE_TABS.map((t) => (
          <DockButton key={t} tab={t} />
        ))}
        <MoreButton
          open={moreOpen}
          onClick={() => {
            setBellOpen(false);
            setMoreOpen((o) => !o);
          }}
        />
      </nav>
      {bellOpen && <NotificationsSheet store={notifications} onClose={() => setBellOpen(false)} />}
      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} {...actions} />}
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
