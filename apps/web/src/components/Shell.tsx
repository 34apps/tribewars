import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { RESOURCE_IDS, populationCap, populationUsage, productionPerHour, storageCap } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { ChieftainAvatar } from '../art/Chieftain.tsx';
import { Icon } from '../art/Icon.tsx';
import type { IconName } from '../art/Icon.tsx';
import { WORLD_ENDED_NOTICE, bannerText } from '../domination.ts';
import { useGame, TABS } from '../game.ts';
import type { NavTab as Tab } from '../game.ts';
import { formatCompact, formatCoords, formatDuration, formatInt, formatLeft, formatRate } from '../format.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';
import { useNotifications } from '../hooks/useNotifications.ts';
import { LOBBY_URL, isLobbyWorld, useWorldInfo } from '../hooks/useWorldInfo.ts';
import NotificationsDialog, { NotificationBell } from './Notifications.tsx';
import { RenameVillage, VillageBar } from './VillageSwitcher.tsx';

const ChieftainDialog = lazy(() => import('./ChieftainDialog.tsx'));
const SettingsDialog = lazy(() => import('./SettingsDialog.tsx'));

const TAB_LABEL: Record<Tab, string> = { village: 'Village', map: 'Map', army: 'Army', reports: 'Reports', mail: 'Mail', tribe: 'Tribe', ranks: 'Ranks' };
/** "+3k/h" style rate for the narrow phone strip. */
function compactRate(perHour: number): string {
  const r = Math.round(perHour);
  const abs = Math.abs(r);
  if (abs < 1000) return formatRate(r);
  return `${r < 0 ? '−' : '+'}${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k/h`;
}

const TAB_ICON: Record<Tab, IconName> = { village: 'village', map: 'map', army: 'army', reports: 'reports', mail: 'mail', tribe: 'tribe', ranks: 'ranks' };

/** Wood/food/iron/gold counters: amount/cap, rate, fill bar. `compact` (phone strip) hides cap and bar via CSS. */
function Resources({ compact }: { compact?: boolean }) {
  const { live, settings } = useGame();
  const cap = storageCap(live);
  const net = productionPerHour(live, settings);
  const pop = populationUsage(live);
  const popCap = populationCap(live);
  const popRatio = popCap > 0 ? pop.total / popCap : 0;
  const popLabel = `Population ${formatInt(pop.total)} of ${formatInt(popCap)}${popRatio >= 0.9 ? (popRatio >= 0.999 ? ' (full)' : ' (almost full)') : ''}`;
  return (
    <ul className="resources" aria-label="Resources">
      {RESOURCE_IDS.map((r) => {
        const amount = Math.floor(live.resources[r] + 1e-9);
        const ratio = cap > 0 ? live.resources[r] / cap : 0;
        const nearFull = ratio >= 0.9;
        const full = ratio >= 0.999;
        const rate = net[r];
        const cls = [
          'res',
          nearFull ? 'is-near-full' : '',
          full ? 'is-full' : '',
          Math.round(rate) === 0 ? 'is-zero' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li key={r} className={cls}>
            <span className="token" aria-hidden="true">
              <Icon name={RESOURCE_ICON[r]} size={compact ? 20 : 24} />
            </span>
            <span className="res-text">
              <span className="res-amount">
                <span className="visually-hidden">{RESOURCE_NAME[r]}: </span>
                <span title={formatInt(amount)}>{formatCompact(amount)}</span>
                <span className="res-cap">
                  <span aria-hidden="true"> /</span>
                  <span className="visually-hidden"> of </span>
                  {formatInt(cap)}
                  {full && <span className="visually-hidden"> (full)</span>}
                </span>
              </span>
              <span className="res-sub">
                <span className="res-meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                </span>
                <span className="res-rate">
                  {compact ? compactRate(rate) : formatRate(rate)}
                </span>
              </span>
            </span>
          </li>
        );
      })}
      <li className={`res res-pop${popRatio >= 0.9 ? ' is-near-full' : ''}${popRatio >= 0.999 ? ' is-full' : ''}`} aria-label={popLabel}>
        <span className="token" aria-hidden="true">
          <Icon name="pop" size={compact ? 20 : 24} />
        </span>
        <span className="res-text">
          <span className="res-amount" aria-hidden="true">
            {formatInt(pop.total)}
            <span className="res-cap"> / {formatInt(popCap)}</span>
          </span>
          <span className="res-sub" aria-hidden="true">
            <span className="res-meter">
              <span style={{ width: `${Math.min(100, popRatio * 100)}%` }} />
            </span>
            <span className="res-rate">Pop</span>
          </span>
        </span>
      </li>
    </ul>
  );
}

function Strip() {
  const { player, now, movements, navigate, connectionError, worldEnd, tab } = useGame();
  const protectedLeft = player.protectedUntil - now;
  const incoming = movements.filter((m) => m.direction === 'incoming' && m.kind === 'attack').sort((a, b) => a.arriveAt - b.arriveAt);
  const first = incoming[0];
  return (
    <>
      {worldEnd && (
        <div className="strip strip-ended" role="status">
          <Icon name="flame" size={22} />
          <span>{bannerText(worldEnd)} Orders are closed.</span>
          {tab !== 'results' && (
            <button type="button" className="btn btn-small strip-ended-btn" onClick={() => navigate('results')}>
              See results
            </button>
          )}
        </div>
      )}
      {connectionError && (
        <div className="strip strip-warn" role="status">
          <span>Connection problem. Retrying…</span>
        </div>
      )}
      {first && (
        <button className="strip strip-danger" onClick={() => navigate('army')}>
          <Icon name="warning" size={22} />
          <span>
            {incoming.length > 1 ? `${incoming.length} attacks incoming` : 'Attack incoming'}: first lands in{' '}
            <strong>{formatDuration(first.arriveAt - now)}</strong>
          </span>
        </button>
      )}
      {protectedLeft > 0 && (
        <div className="strip strip-protect">
          <Icon name="shield" size={22} />
          <span>
            Beginner protection: <strong>{formatLeft(protectedLeft)}</strong> left
          </span>
        </div>
      )}
    </>
  );
}

function TabButton({ tab, variant }: { tab: Tab; variant: 'top' | 'bottom' }) {
  const { tab: current, navigate, unreadReports, unreadMail, tribeInvites, tribeAlerts, movements } = useGame();
  const active = current === tab;
  const incoming = tab === 'army' ? movements.filter((m) => m.direction === 'incoming' && m.kind === 'attack').length : 0;
  const badge = tab === 'reports' ? unreadReports : tab === 'mail' ? unreadMail : tab === 'tribe' ? tribeInvites + tribeAlerts : incoming;
  const tribeLabel = [
    tribeAlerts > 0 ? `${tribeAlerts} attack ${tribeAlerts === 1 ? 'alert' : 'alerts'}` : '',
    tribeInvites > 0 ? `${tribeInvites} ${tribeInvites === 1 ? 'invitation' : 'invitations'}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const badgeLabel = tab === 'reports' ? `${badge} unread` : tab === 'mail' ? `${badge} unread mail` : tab === 'tribe' ? tribeLabel : `${badge} incoming`;
  // Red for attacks (yours or your tribe's); invitations alone stay calm.
  const danger = tab === 'army' || (tab === 'tribe' && tribeAlerts > 0);
  const iconSize = variant === 'top' ? (active ? 28 : 25) : active ? 26 : 23;
  return (
    <button
      className={`tab tab-${variant}${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      title={TAB_LABEL[tab]}
      onClick={() => navigate(tab)}
    >
      <span className="tab-token" aria-hidden="true">
        <Icon name={TAB_ICON[tab]} size={iconSize} />
      </span>
      <span className="tab-label">{TAB_LABEL[tab]}</span>
      {badge > 0 && (
        <span className={`badge${danger ? ' badge-danger' : ''}`} aria-label={badgeLabel}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

/** Chieftain avatar + name [TAG]; opens a small menu with the village, Change chieftain and Sign out. */
function Who({
  onSignOut,
  onSignOutEverywhere,
  onChangeChieftain,
  onSettings,
  compact,
}: {
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
  onChangeChieftain: () => void;
  onSettings: () => void;
  compact?: boolean;
}) {
  const { player, village, villages, tribeChanged, toast, navigate } = useGame();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const worldInfo = useWorldInfo();
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
      <button
        className="who-button"
        aria-expanded={open}
        aria-label={`${player.username}${tag ? ` ${tag}` : ''}, account`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar-ring">
          <ChieftainAvatar id={player.chieftain} size={compact ? 40 : 46} eager />
        </span>
        {!compact && (
          <span className="who-text" aria-hidden="true">
            <span className="who-name">{player.username}</span>
            {tag && <span className="who-tag">{tag}</span>}
          </span>
        )}
      </button>
      {open && (
        <div className="who-menu">
          <div>
            <strong>{player.username}</strong> {tag && <span className="who-tag">{tag}</span>}
            <div className="muted">
              {village.name} ({formatCoords(village.x, village.y)})
            </div>
          </div>
          {/* With several villages Rename sits in the village bar's list; with one it lives here. */}
          {villages.length < 2 &&
            (renaming ? (
              <RenameVillage onDone={() => setRenaming(false)} />
            ) : (
              <button className="btn btn-block" onClick={() => setRenaming(true)}>
                Rename village
              </button>
            ))}
          <button
            className="btn btn-block"
            onClick={() => {
              setOpen(false);
              onChangeChieftain();
            }}
          >
            Change chieftain
          </button>
          <button
            className="btn btn-block"
            onClick={() => {
              setOpen(false);
              navigate('support');
            }}
          >
            Contact support
          </button>
          {player.staffRole && (
            <button
              className="btn btn-block"
              onClick={() => {
                setOpen(false);
                navigate('staff');
              }}
            >
              Staff tools
            </button>
          )}
          {player.sandbox && (
            <button
              className="btn btn-block"
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
            >
              Settings (test mode)
            </button>
          )}
          <label className="muted" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={player.householdShared}
              onChange={(e) => {
                const shared = e.target.checked;
                api
                  .setHousehold(shared)
                  .then(() => {
                    tribeChanged();
                    toast(shared ? 'Reported: someone else plays from your household.' : 'Household report removed.');
                  })
                  .catch((err) => toast(errorMessage(err)));
              }}
            />
            <span>Someone else in my household plays Clanfire. Our accounts can't send troops to each other.</span>
          </label>
          {isLobbyWorld(worldInfo) && (
            <a className="btn btn-block" href={LOBBY_URL}>
              Worlds
            </a>
          )}
          <button className="btn btn-block" onClick={onSignOut}>
            Sign out
          </button>
          {isLobbyWorld(worldInfo) && (
            <button className="btn btn-block" onClick={onSignOutEverywhere}>
              Sign out everywhere
            </button>
          )}
          {isLobbyWorld(worldInfo) && <small className="muted">Everywhere ends all your Clanfire sessions on every device.</small>}
        </div>
      )}
    </div>
  );
}

export function Shell({ children, onSignOut, onSignOutEverywhere }: { children: ReactNode; onSignOut: () => void; onSignOutEverywhere: () => void }) {
  const { tab, worldEnd, toast } = useGame();
  const [choosing, setChoosing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const notifications = useNotifications();
  const bell = (compact?: boolean) => (
    <NotificationBell unread={notifications.unread} danger={notifications.unreadAttacks > 0} onClick={() => setBellOpen(true)} compact={compact} />
  );
  // After the world ended the server refuses every order. On the order screens (village, army, map) the main buttons say so
  // up front instead of waiting for the 403; reading, mail, chat and forum are untouched.
  const guardOrders =
    worldEnd && (tab === 'village' || tab === 'army' || tab === 'map')
      ? (e: MouseEvent<HTMLElement>) => {
          const button = (e.target as HTMLElement).closest('button');
          if (!button || button.closest('.wm-toolbar') || !(button.classList.contains('btn-primary') || button.type === 'submit')) return;
          e.preventDefault();
          e.stopPropagation();
          toast(WORLD_ENDED_NOTICE, { kind: 'error' });
        }
      : undefined;
  return (
    <div className={`app app-${tab}${worldEnd ? ' is-ended' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <Icon name="flame" size={32} />
          Clanfire
        </div>
        <nav className="toptabs" aria-label="Main">
          {TABS.map((t) => (
            <TabButton key={t} tab={t} variant="top" />
          ))}
        </nav>
        <Resources />
        {bell()}
        <Who onSignOut={onSignOut} onSignOutEverywhere={onSignOutEverywhere} onChangeChieftain={() => setChoosing(true)} onSettings={() => setSettings(true)} />
      </header>
      <div className="resstrip">
        <Who onSignOut={onSignOut} onSignOutEverywhere={onSignOutEverywhere} onChangeChieftain={() => setChoosing(true)} onSettings={() => setSettings(true)} compact />
        <Resources compact />
        {bell(true)}
      </div>
      <Strip />
      <VillageBar />
      <main className={`main${tab === 'map' ? ' main-map' : ''}${tab === 'village' ? ' main-village' : ''}`} id="main" onClickCapture={guardOrders}>
        {children}
      </main>
      <nav className="bottomnav" aria-label="Main">
        {TABS.map((t) => (
          <TabButton key={t} tab={t} variant="bottom" />
        ))}
      </nav>
      {bellOpen && <NotificationsDialog store={notifications} onClose={() => setBellOpen(false)} />}
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
