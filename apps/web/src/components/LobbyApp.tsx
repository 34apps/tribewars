import { useCallback, useEffect, useState } from 'react';
import type { LobbyAccountDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { lobbyRouteHash, lobbyScreen, parseLobbyHash } from '../lobby.ts';
import type { LobbyRoute } from '../lobby.ts';
import { AllWorlds } from './AllWorlds.tsx';
import { AuthScreen } from './AuthScreen.tsx';
import type { AuthCalls } from './AuthScreen.tsx';
import { HomePage } from './HomePage.tsx';
import HomeVillage from './HomeVillage.tsx';
import { WorldsHome } from './WorldsHome.tsx';
import { ErrorSplash, LoadingSplash } from './Splash.tsx';
import './lobby-phone.css';

const LOBBY_CALLS: AuthCalls = { login: api.lobbyLogin, register: api.lobbyRegister, changePassword: api.lobbyChangePassword, passwordMin: 10 };

/** Marks a history entry the lobby itself pushed: the entry before it is also a lobby screen, so "back" may go there. */
const NAV_MARK = { clanfireLobby: true };

function currentRoute(): LobbyRoute {
  return parseLobbyHash(window.location.hash);
}

/** Root of the lobby page (/lobby/): homepage, then the sign-in / new-player form, then the account's worlds. */
export function LobbyApp() {
  const [account, setAccount] = useState<LobbyAccountDto | null | 'loading'>('loading');
  const [bootError, setBootError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** The screen, kept in the address after "#" (see lobby.ts): Back, Forward and a reload land on the right one. */
  const [route, setRoute] = useState<LobbyRoute>(currentRoute);

  useEffect(() => {
    const sync = () => setRoute(currentRoute());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBootError(null);
    api
      .lobbyMe()
      .then((r) => {
        if (!cancelled) setAccount(r.account);
      })
      .catch((e: unknown) => {
        if (!cancelled) setBootError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /** Forward to a screen: a new history entry, so the browser's Back button returns here. */
  const go = useCallback((to: LobbyRoute) => {
    const { pathname, search } = window.location;
    window.history.pushState(NAV_MARK, '', `${pathname}${search}${lobbyRouteHash(to)}`);
    setRoute(to);
  }, []);
  /** The on-screen back arrow: the entry before this one when the lobby pushed it, else replace this entry (a shared link must not leave the page). */
  const back = useCallback((fallback: LobbyRoute) => {
    const marked = (window.history.state as { clanfireLobby?: boolean } | null)?.clanfireLobby === true;
    if (marked) {
      window.history.back();
      return;
    }
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}${lobbyRouteHash(fallback)}`);
    setRoute(fallback);
  }, []);

  /** The form's two tabs: the address follows (this entry is replaced, no new Back step). */
  const swapTo = useCallback((to: LobbyRoute) => {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}${lobbyRouteHash(to)}`);
    setRoute(to);
  }, []);

  /** After sign-in or sign-up the form's address is no longer wanted: Back must not return to it. */
  const authed = useCallback(() => {
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}`);
    setRoute('home');
    setAccount('loading');
    setAttempt((n) => n + 1);
  }, []);
  const reload = useCallback(() => {
    setAccount('loading');
    setAttempt((n) => n + 1);
  }, []);
  const signedOut = useCallback(() => setAccount(null), []);

  if (bootError) return <ErrorSplash message={bootError} onRetry={reload} />;
  if (account === 'loading') return <LoadingSplash text="Loading Clanfire…" />;
  const screen = lobbyScreen(route, account !== null);
  switch (screen) {
    case 'home':
      return <HomePage onPlay={() => go('signup')} onSignIn={() => go('signin')} />;
    case 'form-login':
    case 'form-register':
      return (
        <AuthScreen
          calls={LOBBY_CALLS}
          onAuthed={authed}
          initialMode={screen === 'form-login' ? 'login' : 'register'}
          onModeChange={(m) => swapTo(m === 'login' ? 'signin' : 'signup')}
          onBack={() => back('home')}
          hero={<HomeVillage />}
        />
      );
    case 'all-worlds':
      return <AllWorlds onBack={() => back('home')} onSignedOut={signedOut} />;
    case 'your-worlds':
      return account === null ? null : <WorldsHome account={account} onSignedOut={signedOut} onAllWorlds={() => go('worlds')} />;
  }
}
