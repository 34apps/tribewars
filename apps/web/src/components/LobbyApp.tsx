import { useCallback, useEffect, useState } from 'react';
import type { LobbyAccountDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { AuthScreen } from './AuthScreen.tsx';
import type { AuthCalls, Mode } from './AuthScreen.tsx';
import { HomePage } from './HomePage.tsx';
import { WorldsHome } from './WorldsHome.tsx';
import { ErrorSplash, LoadingSplash } from './Splash.tsx';

const LOBBY_CALLS: AuthCalls = { login: api.lobbyLogin, register: api.lobbyRegister, changePassword: api.lobbyChangePassword, passwordMin: 10 };

/** Root of the lobby page (/lobby/): homepage, then the sign-in / new-player form, then the account's worlds. */
export function LobbyApp() {
  const [account, setAccount] = useState<LobbyAccountDto | null | 'loading'>('loading');
  const [bootError, setBootError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Signed out: the homepage (null) or the form in one of its two modes. */
  const [authMode, setAuthMode] = useState<Mode | null>(null);

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

  const reload = useCallback(() => {
    setAccount('loading');
    setAttempt((n) => n + 1);
  }, []);
  const signedOut = useCallback(() => setAccount(null), []);

  if (bootError) return <ErrorSplash message={bootError} onRetry={reload} />;
  if (account === 'loading') return <LoadingSplash text="Loading Clanfire…" />;
  if (account === null) {
    if (authMode === null) return <HomePage onPlay={() => setAuthMode('register')} onSignIn={() => setAuthMode('login')} />;
    return <AuthScreen key={authMode} calls={LOBBY_CALLS} onAuthed={reload} initialMode={authMode} onBack={() => setAuthMode(null)} />;
  }
  return <WorldsHome account={account} onSignedOut={signedOut} />;
}
