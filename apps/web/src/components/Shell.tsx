import type { ReactNode } from 'react';
import { RESOURCE_IDS, netProductionPerHour, storageCap } from '@tribewars/engine';
import { useGame, TABS } from '../game.ts';
import type { Tab } from '../game.ts';
import { formatCompact, formatCoords, formatDuration, formatInt, formatLeft, formatRate } from '../format.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';

const TAB_LABEL: Record<Tab, string> = { village: 'Village', map: 'Map', army: 'Army', reports: 'Reports', tribe: 'Tribe' };
const TAB_ICON: Record<Tab, string> = { village: '🏘️', map: '🗺️', army: '⚔️', reports: '📜', tribe: '🚩' };

function ResourceBar() {
  const { live, settings } = useGame();
  const cap = storageCap(live);
  const net = netProductionPerHour(live, settings);
  return (
    <section className="resbar" aria-label="Resources">
      <ul>
        {RESOURCE_IDS.map((r) => {
          const amount = Math.floor(live.resources[r] + 1e-9);
          const ratio = cap > 0 ? live.resources[r] / cap : 0;
          const nearFull = ratio >= 0.9;
          const full = ratio >= 0.999;
          const rate = net[r];
          const bad = r === 'food' && rate <= 0;
          const cls = ['res', nearFull ? 'is-near-full' : '', full ? 'is-full' : '', bad ? 'is-bad' : ''].filter(Boolean).join(' ');
          return (
            <li key={r} className={cls}>
              <span className="res-top">
                <span className="res-icon" aria-hidden="true">{RESOURCE_ICON[r]}</span>
                <span className="res-amount">
                  <span className="visually-hidden">{RESOURCE_NAME[r]}: </span>
                  {formatInt(amount)}
                </span>
              </span>
              <span className="res-sub">
                <span className="res-cap">
                  <span aria-hidden="true">/</span>
                  <span className="visually-hidden"> of </span>
                  {formatCompact(cap)}
                  {full && <span className="visually-hidden"> (full)</span>}
                </span>
                <span className="res-rate">{formatRate(rate)}</span>
              </span>
              <span className="res-meter" aria-hidden="true">
                <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
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
          <span aria-hidden="true">⚠️</span>
          <span>
            {incoming.length > 1 ? `${incoming.length} attacks incoming` : 'Attack incoming'}: first lands in{' '}
            <strong>{formatDuration(first.arriveAt - now)}</strong>
          </span>
        </button>
      )}
      {protectedLeft > 0 && (
        <div className="strip strip-protect">
          <span aria-hidden="true">🛡️</span>
          <span>
            Beginner protection: <strong>{formatLeft(protectedLeft)}</strong> left
          </span>
        </div>
      )}
    </>
  );
}

function TabButton({ tab, variant }: { tab: Tab; variant: 'top' | 'bottom' }) {
  const { tab: current, navigate, unreadReports, tribeInvites, movements } = useGame();
  const active = current === tab;
  const incoming = tab === 'army' ? movements.filter((m) => m.direction === 'incoming' && m.kind === 'attack').length : 0;
  const badge = tab === 'reports' ? unreadReports : tab === 'tribe' ? tribeInvites : incoming;
  const badgeLabel = tab === 'reports' ? `${badge} unread` : tab === 'tribe' ? `${badge} ${badge === 1 ? 'invitation' : 'invitations'}` : `${badge} incoming`;
  return (
    <button
      className={`tab tab-${variant}${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => navigate(tab)}
    >
      <span className="tab-icon" aria-hidden="true">{TAB_ICON[tab]}</span>
      <span className="tab-label">{TAB_LABEL[tab]}</span>
      {badge > 0 && (
        <span className={`badge${tab === 'army' ? ' badge-danger' : ''}`} aria-label={badgeLabel}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

export function Shell({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const { player, village, tab } = useGame();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span aria-hidden="true">🏰</span> TribeWars
        </div>
        <nav className="toptabs" aria-label="Main">
          {TABS.map((t) => (
            <TabButton key={t} tab={t} variant="top" />
          ))}
        </nav>
        <div className="who">
          <div className="who-text">
            <strong>
              {player.tribe && <span className="who-tag" title={player.tribe.name}>[{player.tribe.tag}] </span>}
              {player.username}
            </strong>
            <span>
              <span className="who-village">{village.name} </span>({formatCoords(village.x, village.y)})
            </span>
          </div>
          <button className="btn btn-ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <ResourceBar />
      <Strip />
      <main className={`main${tab === 'map' ? ' main-map' : ''}`} id="main">
        {children}
      </main>
      <nav className="bottomnav" aria-label="Main">
        {TABS.map((t) => (
          <TabButton key={t} tab={t} variant="bottom" />
        ))}
      </nav>
    </div>
  );
}
