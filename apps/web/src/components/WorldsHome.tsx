// Signed-in lobby page: top bar, the welcome card (your worlds, join a world, Hall of Fame) and, on desktop, the village.
// Phone (below 900 px): the "game launcher" look: village picture strip, then a bottom sheet with Continue and Join rows.

import { useEffect, useMemo, useRef, useState } from 'react';
import { summarizeBadges } from '@clanfire/engine';
import type { HallOfFameEntryDto, LobbyAccountDto, LobbyWorldDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { HOME_ART } from '../art/home-village/index.ts';
import { useEnterWorld, useLobbyWorlds } from '../hooks/useLobbyWorlds.ts';
import type { WorldList } from '../hooks/useLobbyWorlds.ts';
import { PHONE_QUERY, useMediaQuery } from '../hooks/useMediaQuery.ts';
import { BADGE_HELP, BadgeRow } from './Badges.tsx';
import { Flame } from './Flame.tsx';
import { HallOfFameList } from './HallOfFame.tsx';
import HomeVillage from './HomeVillage.tsx';
import { LogoPill } from './LogoPill.tsx';
import { WorldRow } from './WorldRow.tsx';
import { daysAgoLabel, groupWorlds, startedLabel, worldButtonLabel } from '../lobby.ts';
import './home.css';

const SIGN_OUT_ALL_HELP = 'Ends all sessions on every device. Open worlds close within 12 hours.';

/**
 * The page after sign-in. Desktop: the card on the left, the village in the same frame as the front page on the right.
 * Phone: village strip with the logo and an account button, then the sheet; the page scrolls.
 */
export function WorldsHome({ account, onSignedOut, onAllWorlds }: { account: LobbyAccountDto; onSignedOut: () => void; onAllWorlds: () => void }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [villageReady, setVillageReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [hall, setHall] = useState(false);
  const { list, retry } = useLobbyWorlds(onSignedOut);
  const enter = useEnterWorld(onSignedOut);
  /** A world is opening: sign-out waits. */
  const opening = enter.busyId !== null;

  async function signOut(everywhere: boolean) {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // "Everywhere" ends every lobby session of the account; world sessions follow within 12 hours (the link's tooltip says so).
      await (everywhere ? api.lobbyLogoutAll() : api.lobbyLogout());
    } catch {
      // The cookie may already be gone; show the signed-out page either way.
    }
    onSignedOut();
  }

  const card = (
    <WelcomeCard
      account={account}
      phone={phone}
      list={list}
      retry={retry}
      enter={enter}
      signingOut={signingOut}
      onSignOutEverywhere={() => void signOut(true)}
      onHall={() => setHall(true)}
      onAllWorlds={onAllWorlds}
    />
  );

  if (phone) {
    return (
      <div className="lp-home lp-home-in">
        <div className="lp-strip">
          <div className="lp-strip-art">
            <HomeVillage onReady={() => setVillageReady(true)} />
          </div>
          <header className="lp-strip-top">
            <LogoPill loading={!villageReady} />
            <AccountMenu username={account.username} busy={signingOut || opening} onSignOut={() => void signOut(false)} onSignOutEverywhere={() => void signOut(true)} onHall={() => setHall(true)} />
          </header>
        </div>
        {card}
        {hall && <HallDialog onClose={() => setHall(false)} />}
      </div>
    );
  }

  return (
    <div className="home home-in">
      <header className="home-bar">
        <span className="home-brand">
          <Flame size={30} loading={!villageReady} />
          Clanfire
        </span>
        <span className="home-who">
          <strong className="home-who-name">{account.username}</strong>
          <button type="button" className="btn btn-small" disabled={signingOut || opening} onClick={() => void signOut(false)}>
            Sign out
          </button>
        </span>
      </header>

      <main className="home-main">
        <div className="home-copy">{card}</div>
        <div className="home-hero">
          <HomeVillage onReady={() => setVillageReady(true)} />
        </div>
      </main>

      {hall && <HallDialog onClose={() => setHall(false)} />}
    </div>
  );
}

/** Phone: the round initial button with a small menu (name, Sign out, Sign out everywhere, Hall of Fame). */
function AccountMenu({
  username,
  busy,
  onSignOut,
  onSignOutEverywhere,
  onHall,
}: {
  username: string;
  busy: boolean;
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
  onHall: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
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

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="lp-menu-wrap" ref={wrap}>
      <button type="button" className="lp-avatar" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu, ${username}`} onClick={() => setOpen((o) => !o)}>
        {username.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="lp-menu" role="menu" aria-label="Account">
          <p className="lp-menu-name">{username}</p>
          <button type="button" role="menuitem" className="lp-menu-item" disabled={busy} onClick={pick(onSignOut)}>
            Sign out
          </button>
          <button type="button" role="menuitem" className="lp-menu-item" disabled={busy} title={SIGN_OUT_ALL_HELP} onClick={pick(onSignOutEverywhere)}>
            Sign out everywhere
          </button>
          <button type="button" role="menuitem" className="lp-menu-item" onClick={pick(onHall)}>
            Hall of Fame
          </button>
        </div>
      )}
    </div>
  );
}

/** Welcome card (desktop) or bottom sheet (phone). The sign-out calls live in the page. */
function WelcomeCard({
  account,
  phone,
  list,
  retry,
  enter,
  signingOut,
  onSignOutEverywhere,
  onHall,
  onAllWorlds,
}: {
  account: LobbyAccountDto;
  phone: boolean;
  list: WorldList;
  retry: () => void;
  enter: ReturnType<typeof useEnterWorld>;
  signingOut: boolean;
  onSignOutEverywhere: () => void;
  onHall: () => void;
  onAllWorlds: () => void;
}) {
  const { busyId, errors, play } = enter;
  const badges = useMemo(() => summarizeBadges(account.badges ?? []), [account.badges]);
  const groups = list.state === 'ready' ? groupWorlds(list.worlds) : null;
  const now = Date.now();

  const row = (w: LobbyWorldDto, meta: string | null) => {
    const joinable = w.lastPlayedAt === null && w.status === 'open';
    const label = joinable ? 'Join' : worldButtonLabel(w.status);
    return (
      <li key={w.id} className="home-world">
        <span className="home-world-text">
          <span className="home-world-name">{w.name}</span>
          {meta && <span className="home-world-meta">{meta}</span>}
          {errors[w.id] && (
            <span className="form-error home-world-error" role="alert">
              {errors[w.id]}
            </span>
          )}
        </span>
        <button
          type="button"
          className={`btn home-join${w.lastPlayedAt !== null && w.status !== 'finished' ? ' btn-primary' : ''}`}
          disabled={busyId !== null || signingOut}
          aria-label={busyId === w.id ? undefined : `${label} ${w.name}`}
          onClick={() => void play(w)}
        >
          {busyId === w.id ? 'Opening…' : label}
        </button>
      </li>
    );
  };

  const prow = (w: LobbyWorldDto, action: 'play' | 'join' | 'results', meta: string | null) => (
    <WorldRow key={w.id} world={w} meta={meta} action={action} busyId={busyId} disabled={signingOut} error={errors[w.id]} onPlay={(x) => void play(x)} />
  );

  const empty = groups !== null && groups.yours.length + groups.results.length + groups.otherCount === 0;
  const status = (
    <>
      {list.state === 'loading' && (
        <p className="home-note" role="status">
          Loading worlds…
        </p>
      )}
      {list.state === 'error' && (
        <div className="home-note" role="alert">
          <p>{list.message}</p>
          <button type="button" className="btn btn-primary" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {empty && <p className="home-note">No worlds yet.</p>}
    </>
  );
  const badgeRow = badges.length > 0 && (
    <div className="lobby-badges home-badges">
      <BadgeRow badges={badges} label="Your badges" />
      <details className="help-pop">
        <summary aria-label="About badges">?</summary>
        <p className="small">{BADGE_HELP}</p>
      </details>
    </div>
  );
  const allWorlds = groups !== null && groups.otherCount > 0 && (
    <button type="button" className="btn lp-all" onClick={onAllWorlds}>
      <span>All worlds ({groups.otherCount})</span>
      <svg className="lp-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );

  if (phone) {
    const main = groups?.yours[0];
    const others = groups ? [...groups.yours.slice(1), ...groups.results] : [];
    return (
      <section className="lp-sheet lp-sheet-in" aria-label="Your account">
        <div className="lp-grab" aria-hidden="true" />
        <h1 className="lp-hi">Hi, {account.username}</h1>
        {badgeRow}
        {status}
        {main && (
          <div className="lp-card lp-cont">
            <div className="lp-cont-pic" style={{ backgroundImage: `url("${(HOME_ART.sources[1] ?? HOME_ART.sources[0]).src}")` }}>
              <span className="tag lp-run">Running</span>
            </div>
            <div className="lp-cont-body">
              <h2 className="lp-cont-name">{main.name}</h2>
              <p className="lp-cont-meta">Played {daysAgoLabel(main.lastPlayedAt ?? now, now)}</p>
              {errors[main.id] && (
                <p className="form-error" role="alert">
                  {errors[main.id]}
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary lp-big"
                disabled={busyId !== null || signingOut}
                aria-label={busyId === main.id ? undefined : `Continue ${main.name}`}
                onClick={() => void play(main)}
              >
                {busyId === main.id ? 'Opening…' : 'Continue'}
              </button>
            </div>
          </div>
        )}
        {others.length > 0 && (
          <ul className="lp-list" aria-label="Your other worlds">
            {others.map((w) =>
              w.status === 'finished'
                ? prow(w, 'results', `Finished ${daysAgoLabel(w.lastPlayedAt ?? now, now)}`)
                : prow(w, 'play', `Played ${daysAgoLabel(w.lastPlayedAt ?? now, now)}`),
            )}
          </ul>
        )}
        {groups && groups.join.length > 0 && (
          <>
            <h2 className="lp-label">Join a world</h2>
            <ul className="lp-list" aria-label="Join a world">
              {groups.join.map((w) => prow(w, 'join', startedLabel(w.openedAt, now)))}
            </ul>
          </>
        )}
        {allWorlds}
      </section>
    );
  }

  return (
    <section className="home-card home-welcome" aria-label="Your account">
      <div className="home-welcome-head">
        <h2 className="home-welcome-title">
          Welcome back, <strong>{account.username}</strong>
        </h2>
      </div>

      {badgeRow}
      {status}

      {groups && groups.yours.length + groups.results.length > 0 && (
        <div className="home-group">
          <h3 className="home-sec-title">Your worlds</h3>
          <ul className="home-worlds">
            {groups.yours.map((w) => row(w, `Played ${daysAgoLabel(w.lastPlayedAt ?? now, now)}`))}
            {groups.results.map((w) => row(w, 'Finished'))}
          </ul>
        </div>
      )}

      {groups && groups.join.length > 0 && (
        <div className="home-group">
          <h3 className="home-sec-title">Join a world</h3>
          <ul className="home-worlds">{groups.join.map((w) => row(w, startedLabel(w.openedAt, now)))}</ul>
        </div>
      )}

      <div className="home-card-foot">
        <button type="button" className="btn btn-small home-hall" onClick={onHall}>
          Hall of Fame
        </button>
        {allWorlds}
        <button type="button" className="home-link home-link-small" disabled={signingOut || busyId !== null} title={SIGN_OUT_ALL_HELP} onClick={onSignOutEverywhere}>
          Sign out everywhere
        </button>
      </div>
    </section>
  );
}

/** Hall of Fame in a dialog. An empty or failed list says so instead of hiding. */
function HallDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<{ state: 'loading' } | { state: 'error' } | { state: 'ready'; worlds: HallOfFameEntryDto[] }>({ state: 'loading' });

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

  useEffect(() => {
    let cancelled = false;
    api.lobbyHallOfFame().then(
      (r) => !cancelled && setState({ state: 'ready', worlds: r.worlds }),
      () => !cancelled && setState({ state: 'error' }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm hof-dialog"
      aria-label="Hall of Fame"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="hof-dialog-body">
        {state.state === 'loading' && <p role="status">Loading…</p>}
        {state.state === 'error' && <p role="alert">The Hall of Fame could not be loaded.</p>}
        {state.state === 'ready' && state.worlds.length === 0 && <p>No finished worlds yet.</p>}
        {state.state === 'ready' && <HallOfFameList worlds={state.worlds} />}
        <button type="button" className="btn btn-block" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
