import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from './api.ts';
import { ErrorSplash, LoadingSplash } from './components/Splash.tsx';
import { WorldGate } from './components/WorldGate.tsx';
import { Game } from './Game.tsx';

type Session = 'loading' | 'out' | 'in';

/** A world page (/w/<id>/ or the old root): sign in if needed, then the game. Lazy-loaded by App so the lobby never pays for it. */
export default function WorldApp() {
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

  if (bootError) return <ErrorSplash message={bootError} onRetry={() => setAttempt((n) => n + 1)} />;
  if (session === 'loading') return <LoadingSplash text="Loading Clanfire…" />;
  if (session === 'out') return <WorldGate onAuthed={signedIn} />;
  return <Game onSignedOut={signedOut} />;
}
