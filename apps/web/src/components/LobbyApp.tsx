import { useCallback, useEffect, useState } from 'react';
import type { LobbyAccountDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { AuthScreen } from './AuthScreen.tsx';
import type { AuthCalls } from './AuthScreen.tsx';
import { ErrorSplash, LoadingSplash } from './Splash.tsx';
import { WorldPicker } from './WorldPicker.tsx';

const LOBBY_CALLS: AuthCalls = { login: api.lobbyLogin, register: api.lobbyRegister, changePassword: api.lobbyChangePassword, passwordMin: 10 };

/** Root of the lobby page (/lobby/): sign in or create the one account, then pick a world. */
export function LobbyApp() {
  const [account, setAccount] = useState<LobbyAccountDto | null | 'loading'>('loading');
  const [bootError, setBootError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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
  if (account === null) return <AuthScreen calls={LOBBY_CALLS} onAuthed={reload} />;
  return <WorldPicker account={account} onSignedOut={signedOut} />;
}
