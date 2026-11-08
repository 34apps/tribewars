import { Suspense, lazy, useEffect, useState } from 'react';
import type { PublicWorldDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import './home.css';

const HomeVillage = lazy(() => import('./HomeVillage.tsx'));

/** Signed-out front page of the lobby: one screen, no scrolling. */
export function HomePage({ onPlay, onSignIn }: { onPlay: () => void; onSignIn: () => void }) {
  const [worlds, setWorlds] = useState<PublicWorldDto[]>([]);

  useEffect(() => {
    let alive = true;
    // A failed call just hides the strip.
    api.lobbyPublicWorlds().then(
      (r) => alive && setWorlds(r.worlds.slice(0, 3)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="home">
      <header className="home-bar">
        <span className="home-brand">
          <Icon name="flame" size={30} />
          Clanfire
        </span>
        <button type="button" className="btn home-signin-top" onClick={onSignIn}>
          Sign in
        </button>
      </header>

      <main className="home-main">
        <section className="home-copy">
          <p className="home-tag">Free browser strategy</p>
          <h1 className="home-title">
            Build a village. Train an army. <em>Raid the world.</em>
          </h1>
          <p className="home-sub">A free strategy game in your browser. Grow from a campfire to a fortress with your tribe.</p>
          <button type="button" className="btn btn-primary home-play" onClick={onPlay}>
            Play free
          </button>
          <ul className="home-chips" aria-label="What you do">
            <li>
              <Icon name="village" size={20} />
              Build
            </li>
            <li>
              <Icon name="raider" size={20} />
              Raid
            </li>
            <li>
              <Icon name="tribe" size={20} />
              Tribe
            </li>
          </ul>
          <p className="home-already">
            Already playing?{' '}
            <button type="button" className="home-link" onClick={onSignIn}>
              Sign in
            </button>
          </p>
          <p className="home-trust">No download · Phone and computer · Free</p>
        </section>

        <div className="home-hero">
          <Suspense fallback={null}>
            <HomeVillage />
          </Suspense>
        </div>
      </main>

      <footer className="home-foot">
        {worlds.length > 0 && (
          <ul className="home-worlds" aria-label="Open worlds">
            {worlds.map((w) => (
              <li key={w.id} className="home-world">
                <span className="home-world-name">{w.name}</span>
                {w.status === 'open' ? (
                  <button type="button" className="btn home-join" onClick={onPlay} aria-label={`Join ${w.name}`}>
                    Join
                  </button>
                ) : (
                  <span className="home-world-full">Full</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <small className="home-copy-line">© 2026 Clanfire</small>
      </footer>
    </div>
  );
}
