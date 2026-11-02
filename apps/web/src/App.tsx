import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from './api.ts';
import { AuthScreen } from './components/AuthScreen.tsx';
import { Game } from './Game.tsx';
import { Icon } from './art/Icon.tsx';

type Session = 'loading' | 'out' | 'in';

export function App() {
  const [session, setSession] = useState<Session>('loading');
  const [bootError, setBootError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setBootError(null);
    api
      .me()
      .then((r) => {
        if (!cancelled) setSession(r.player ? 'in' : 'out');
      })
      .catch((e: unknown) => {
        if (!cancelled) setBootError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const signedOut = useCallback(() => setSession('out'), []);
  const signedIn = useCallback(() => setSession('in'), []);

  if (bootError) {
    return (
      <div className="splash" role="alert">
        <div className="splash-logo" aria-hidden="true">
          <Icon name="flame" size={44} />
        </div>
        <p>{bootError}</p>
        <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }
  if (session === 'loading') {
    return (
      <div className="splash" role="status">
        <div className="splash-logo" aria-hidden="true">
          <Icon name="flame" size={44} />
        </div>
        <p>Loading Clanfire…</p>
      </div>
    );
  }
  if (session === 'out') return <AuthScreen onAuthed={signedIn} />;
  return <Game onSignedOut={signedOut} />;
}
