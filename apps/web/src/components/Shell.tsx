import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RESOURCE_IDS, netProductionPerHour, populationCap, populationUsage, storageCap } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { ChieftainAvatar } from '../art/Chieftain.tsx';
import { Icon } from '../art/Icon.tsx';
import type { IconName } from '../art/Icon.tsx';
import { useGame, TABS } from '../game.ts';
import type { Tab } from '../game.ts';
import { formatCompact, formatCoords, formatDuration, formatInt, formatLeft, formatRate } from '../format.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';

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
  const net = netProductionPerHour(live, settings);
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
        const bad = r === 'food' && rate <= 0;
        const cls = [
          'res',
          nearFull ? 'is-near-full' : '',
          full ? 'is-full' : '',
          bad ? 'is-bad' : '',
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
                {compact ? formatCompact(amount) : formatInt(amount)}
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
                  {r === 'food' && !compact ? ' net' : ''}
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
  const { player, now, movements, navigate, connectionError } = useGame();
  const protectedLeft = player.protectedUntil - now;
  const incoming = movements.filter((m) => m.direction === 'incoming' && m.kind === 'attack').sort((a, b) => a.arriveAt - b.arriveAt);
  const first = incoming[0];
  return (
    <>
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
  onChangeChieftain,
  onSettings,
  compact,
}: {
  onSignOut: () => void;
  onChangeChieftain: () => void;
  onSettings: () => void;
  compact?: boolean;
}) {
  const { player, village, tribeChanged, toast } = useGame();
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
          <button
            className="btn btn-block"
            onClick={() => {
              setOpen(false);
              onChangeChieftain();
            }}
          >
            Change chieftain
          </button>
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
          <button className="btn btn-block" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const { tab } = useGame();
  const [choosing, setChoosing] = useState(false);
  const [settings, setSettings] = useState(false);
  return (
    <div className={`app app-${tab}`}>
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
        <Who onSignOut={onSignOut} onChangeChieftain={() => setChoosing(true)} onSettings={() => setSettings(true)} />
      </header>
      <div className="resstrip">
        <Who onSignOut={onSignOut} onChangeChieftain={() => setChoosing(true)} onSettings={() => setSettings(true)} compact />
        <Resources compact />
      </div>
      <Strip />
      <main className={`main${tab === 'map' ? ' main-map' : ''}${tab === 'village' ? ' main-village' : ''}`} id="main">
        {children}
      </main>
      <nav className="bottomnav" aria-label="Main">
        {TABS.map((t) => (
          <TabButton key={t} tab={t} variant="bottom" />
        ))}
      </nav>
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
