import { useCallback, useEffect, useState } from 'react';
import type { LobbyAccountDto, PublicWorldDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { Flame } from './Flame.tsx';
import HomeVillage from './HomeVillage.tsx';
import { AuthScreen } from './AuthScreen.tsx';
import type { AuthCalls, Mode } from './AuthScreen.tsx';
import { OpenWorlds, WelcomeCard } from './HomeAccount.tsx';
import './home.css';

/**
 * The lobby's one front page, for visitors and signed-in accounts: top bar, headline, the village picture, and an
 * account card (sign-in / new player, or the welcome card with the worlds). One screen on desktop and phone; the page
 * scrolls only as a fallback so a phone keyboard can never trap a field.
 */
export function HomePage({ account, calls, onAuthed, onSignedOut }: { account: LobbyAccountDto | null; calls: AuthCalls; onAuthed: () => void; onSignedOut: () => void }) {
  const [worlds, setWorlds] = useState<PublicWorldDto[]>([]);
  /** The village picture has arrived: the logo flame stops flickering. */
  const [villageReady, setVillageReady] = useState(false);
  /** Asks the card for a tab and the username field (top bar "Sign in", a world's "Join"). */
  const [request, setRequest] = useState<{ mode: Mode; n: number }>({ mode: 'register', n: 0 });
  const [signingOut, setSigningOut] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (account) return;
    let alive = true;
    // A failed call just hides the list.
    api.lobbyPublicWorlds().then(
      (r) => alive && setWorlds(r.worlds),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [account]);

  const ask = useCallback((mode: Mode) => setRequest((r) => ({ mode, n: r.n + 1 })), []);

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
    <div className={`home${account ? ' home-in' : ''}`}>
      <header className="home-bar">
        <span className="home-brand">
          <Flame size={30} loading={!villageReady} />
          Clanfire
        </span>
        {account ? (
          <span className="home-who">
            <strong className="home-who-name">{account.username}</strong>
            <button type="button" className="btn btn-small" disabled={signingOut || opening} onClick={() => void signOut(false)}>
              Sign out
            </button>
          </span>
        ) : (
          <button type="button" className="btn home-signin-top" onClick={() => ask('login')}>
            Sign in
          </button>
        )}
      </header>

      <main className="home-main">
        <section className="home-copy">
          <h1 className="home-title">
            Build a village. Train an army. <em>Raid the world.</em>
          </h1>
          <p className="home-sub">A free strategy game in your browser. Grow from a campfire to a fortress with your tribe.</p>

          {account ? (
            <WelcomeCard account={account} signingOut={signingOut} onSignOutEverywhere={() => void signOut(true)} onSignedOut={onSignedOut} onBusy={setOpening} />
          ) : (
            <div className="home-card">
              <AuthScreen inline calls={calls} initialMode="register" onAuthed={onAuthed} request={request} />
            </div>
          )}
          {!account && <OpenWorlds worlds={worlds} onJoin={() => ask('register')} />}
        </section>

        <div className="home-hero">
          <HomeVillage onReady={() => setVillageReady(true)} />
        </div>
      </main>

      <footer className="home-foot">
        <small className="home-copy-line">© 2026 Clanfire</small>
      </footer>
    </div>
  );
}
