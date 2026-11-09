// Signed-in lobby page: top bar, the welcome card (your worlds, join a world, Hall of Fame) and, on desktop, the village.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { summarizeBadges } from '@clanfire/engine';
import type { HallOfFameEntryDto, LobbyAccountDto, LobbyWorldDto } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { BADGE_HELP, BadgeRow } from './Badges.tsx';
import { Flame } from './Flame.tsx';
import { HallOfFameList } from './HallOfFame.tsx';
import HomeVillage from './HomeVillage.tsx';
import { daysAgoLabel, enterWorld, groupWorlds, worldButtonLabel } from '../lobby.ts';
import './home.css';

/**
 * The page after sign-in. Phone: no picture, the card fills the width and the page scrolls. Desktop: the card on the
 * left, the village in the same frame as the front page on the right.
 */
export function WorldsHome({ account, onSignedOut }: { account: LobbyAccountDto; onSignedOut: () => void }) {
  const [villageReady, setVillageReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [opening, setOpening] = useState(false);

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
        <div className="home-copy">
          <WelcomeCard account={account} signingOut={signingOut} onSignOutEverywhere={() => void signOut(true)} onSignedOut={onSignedOut} onBusy={setOpening} />
        </div>
        <div className="home-hero">
          <HomeVillage onReady={() => setVillageReady(true)} />
        </div>
      </main>
    </div>
  );
}

type WorldList = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; worlds: LobbyWorldDto[] };

/** Welcome card. The sign-out calls live in the page (the top bar has the main button); "everywhere" is the link at the bottom. */
function WelcomeCard({
  account,
  signingOut,
  onSignOutEverywhere,
  onSignedOut,
  onBusy,
}: {
  account: LobbyAccountDto;
  signingOut: boolean;
  onSignOutEverywhere: () => void;
  onSignedOut: () => void;
  /** True while a world is opening: the top bar's Sign out waits. */
  onBusy: (busy: boolean) => void;
}) {
  const [list, setList] = useState<WorldList>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hall, setHall] = useState(false);
  const badges = useMemo(() => summarizeBadges(account.badges ?? []), [account.badges]);

  useEffect(() => {
    let cancelled = false;
    setList({ state: 'loading' });
    api
      .lobbyWorlds()
      .then((r) => {
        if (!cancelled) setList({ state: 'ready', worlds: r.worlds });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // The lobby session ended (expired or signed out elsewhere): back to the signed-out page.
        if (e instanceof ApiRequestError && e.status === 401) onSignedOut();
        else setList({ state: 'error', message: errorMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, onSignedOut]);

  useEffect(() => onBusy(busyId !== null), [busyId, onBusy]);

  // Coming back with the browser's Back button can restore this page frozen mid-"Opening…".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusyId(null);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const play = useCallback(
    async (world: LobbyWorldDto) => {
      setBusyId(world.id);
      setErrors((prev) => ({ ...prev, [world.id]: '' }));
      try {
        await enterWorld(world, (path) => window.location.assign(path));
        // Navigating away: stay busy so a button cannot be pressed twice.
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) {
          onSignedOut();
          return;
        }
        setErrors((prev) => ({ ...prev, [world.id]: errorMessage(e) }));
        setBusyId(null);
      }
    },
    [onSignedOut],
  );

  const groups = list.state === 'ready' ? groupWorlds(list.worlds) : null;
  const now = Date.now();

  const row = (w: LobbyWorldDto, meta: string | null, full = false) => {
    const busy = busyId === w.id;
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
        {full ? (
          <span className="home-world-full">Full</span>
        ) : (
          <button
            type="button"
            className={`btn home-join${w.lastPlayedAt !== null && w.status !== 'finished' ? ' btn-primary' : ''}`}
            disabled={busyId !== null || signingOut}
            aria-label={busy ? undefined : `${w.status === 'open' && w.lastPlayedAt === null ? 'Join' : worldButtonLabel(w.status)} ${w.name}`}
            onClick={() => void play(w)}
          >
            {busy ? 'Opening…' : w.status === 'open' && w.lastPlayedAt === null ? 'Join' : worldButtonLabel(w.status)}
          </button>
        )}
      </li>
    );
  };

  return (
    <section className="home-card home-welcome" aria-label="Your account">
      <div className="home-welcome-head">
        <h2 className="home-welcome-title">
          Welcome back, <strong>{account.username}</strong>
        </h2>
      </div>

      {badges.length > 0 && (
        <div className="lobby-badges home-badges">
          <BadgeRow badges={badges} label="Your badges" />
          <details className="help-pop">
            <summary aria-label="About badges">?</summary>
            <p className="small">{BADGE_HELP}</p>
          </details>
        </div>
      )}

      {list.state === 'loading' && (
        <p className="home-note" role="status">
          Loading worlds…
        </p>
      )}
      {list.state === 'error' && (
        <div className="home-note" role="alert">
          <p>{list.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {groups && groups.yours.length + groups.join.length + groups.results.length === 0 && <p className="home-note">No worlds yet.</p>}

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
          <ul className="home-worlds">{groups.join.map((w) => row(w, null, w.status === 'full'))}</ul>
        </div>
      )}

      <div className="home-card-foot">
        <button type="button" className="btn btn-small home-hall" onClick={() => setHall(true)}>
          Hall of Fame
        </button>
        <button
          type="button"
          className="home-link home-link-small"
          disabled={signingOut || busyId !== null}
          title="Ends all sessions on every device. Open worlds close within 12 hours."
          onClick={onSignOutEverywhere}
        >
          Sign out everywhere
        </button>
      </div>

      {hall && <HallDialog onClose={() => setHall(false)} />}
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
