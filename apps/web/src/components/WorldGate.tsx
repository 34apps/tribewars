import { useEffect } from 'react';
import { AuthScreen } from './AuthScreen.tsx';
import { LoadingSplash } from './Splash.tsx';
import { LOBBY_URL, isLobbyWorld, useWorldInfo } from '../hooks/useWorldInfo.ts';

/**
 * What a world page shows to a signed-out visitor. A world that only takes lobby passes has no login of its own:
 * send the visitor to the lobby. Everything else (dev, preview, tests, or world info that cannot be fetched) keeps
 * the world's own sign-in screen.
 */
export function WorldGate({ onAuthed }: { onAuthed: () => void }) {
  const info = useWorldInfo();
  const toLobby = isLobbyWorld(info);
  useEffect(() => {
    if (toLobby) window.location.replace(LOBBY_URL);
  }, [toLobby]);
  if (info === 'loading') return <LoadingSplash text="Loading Clanfire…" />;
  if (toLobby) {
    return (
      <LoadingSplash text="Taking you to the lobby…">
        <a className="link" href={LOBBY_URL}>
          Open the lobby
        </a>
      </LoadingSplash>
    );
  }
  return <AuthScreen onAuthed={onAuthed} />;
}
