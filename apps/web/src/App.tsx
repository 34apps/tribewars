import { Suspense, lazy } from 'react';
import { isLobbyPath } from '@clanfire/engine';
import { LobbyApp } from './components/LobbyApp.tsx';
import { LoadingSplash } from './components/Splash.tsx';

// The game (village, map, army...) is its own chunk: the lobby homepage must not download it.
const WorldApp = lazy(() => import('./WorldApp.tsx'));

/** One build, three situations by page path: the lobby (/lobby/), a world (/w/<id>/), or the old single-world root. */
export function App() {
  if (isLobbyPath(window.location.pathname)) return <LobbyApp />;
  return (
    <Suspense fallback={<LoadingSplash text="Loading Clanfire…" />}>
      <WorldApp />
    </Suspense>
  );
}
