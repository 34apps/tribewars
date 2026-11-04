import { useCallback, useEffect, useState } from 'react';
import type { LobbyAccountDto, LobbyWorldDto } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { WORLD_STATUS_LABEL, enterWorld } from '../lobby.ts';

type WorldList = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; worlds: LobbyWorldDto[] };

const STATUS_NOTE = {
  open: 'Anyone can join.',
  full: 'No new players. If you already play here, you can still enter.',
  closed: 'Nobody can enter right now.',
} as const;

/** Lobby home for a signed-in account: header with sign-out, and one card per world. */
export function WorldPicker({ account, onSignedOut }: { account: LobbyAccountDto; onSignedOut: () => void }) {
  const [list, setList] = useState<WorldList>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signingOut, setSigningOut] = useState(false);

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
        // The lobby session ended (expired or signed out elsewhere): back to the sign-in screen.
        if (e instanceof ApiRequestError && e.status === 401) onSignedOut();
        else setList({ state: 'error', message: errorMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, onSignedOut]);

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
        // Navigating away: stay busy so the card cannot be pressed twice.
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

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api.lobbyLogout();
    } catch {
      // The cookie may already be gone; show the sign-in screen either way.
    }
    onSignedOut();
  }

  return (
    <main className="lobby">
      <header className="lobby-head dark">
        <span className="lobby-brand">
          <Icon name="flame" size={36} />
          <span className="lobby-brand-name">Clanfire</span>
        </span>
        <p className="lobby-who">
          Signed in as <strong>{account.username}</strong>
        </p>
        <button type="button" className="btn btn-small" disabled={signingOut || busyId !== null} onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <h1 className="lobby-title">Choose a world</h1>

      {list.state === 'loading' && (
        <p className="lobby-note dark" role="status">
          Loading worlds…
        </p>
      )}
      {list.state === 'error' && (
        <div className="lobby-note dark" role="alert">
          <p>{list.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {list.state === 'ready' && list.worlds.length === 0 && <p className="lobby-note dark">No worlds are open yet.</p>}
      {list.state === 'ready' && list.worlds.length > 0 && (
        <ul className="lobby-grid">
          {list.worlds.map((w) => {
            const busy = busyId === w.id;
            const error = errors[w.id];
            return (
              <li key={w.id} className="lobby-card dark">
                <div className="lobby-card-head">
                  <h2 className="lobby-card-name">{w.name}</h2>
                  <span className={`world-status world-status-${w.status}`}>{WORLD_STATUS_LABEL[w.status]}</span>
                </div>
                <p className="lobby-card-note">{STATUS_NOTE[w.status]}</p>
                <div className="form-error lobby-card-error" role="alert" aria-live="assertive">
                  {error}
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={w.status === 'closed' || busyId !== null}
                  aria-label={busy ? undefined : `Play ${w.name}`}
                  onClick={() => void play(w)}
                >
                  {busy ? 'Opening…' : 'Play'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
