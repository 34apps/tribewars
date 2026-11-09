import { useEffect, useState } from 'react';
import type { PublicWorldDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { useMediaQuery, PHONE_QUERY } from '../hooks/useMediaQuery.ts';
import { Flame } from './Flame.tsx';
import HomeVillage from './HomeVillage.tsx';
import { LogoPill } from './LogoPill.tsx';
import './home.css';

/** Signed-out front page of the lobby: one screen, no scrolling. Phone: the "game launcher" (picture, bottom sheet). */
export function HomePage({ onPlay, onSignIn }: { onPlay: () => void; onSignIn: () => void }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [worlds, setWorlds] = useState<PublicWorldDto[]>([]);
  /** Worlds open to join (the phone's "N worlds open now" line); 0 hides the line, also when the call fails. */
  const [openCount, setOpenCount] = useState(0);
  /** The village picture has arrived: the logo flame stops flickering. */
  const [villageReady, setVillageReady] = useState(false);

  useEffect(() => {
    let alive = true;
    // A failed call just hides the strip.
    api.lobbyPublicWorlds().then(
      (r) => {
        if (!alive) return;
        setWorlds(r.worlds.slice(0, 3));
        setOpenCount(r.worlds.filter((w) => w.status === 'open').length);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  if (phone) {
    return (
      <div className="lp-home">
        <div className="lp-hero">
          <HomeVillage onReady={() => setVillageReady(true)} />
        </div>
        <header className="lp-top">
          <LogoPill loading={!villageReady} />
        </header>
        <main className="lp-sheet">
          <div className="lp-grab" aria-hidden="true" />
          <h1 className="lp-h1">
            Build a village.
            <br />
            <em>Raid the world.</em>
          </h1>
          <p className="lp-sub">Free strategy in your browser.</p>
          <button type="button" className="btn btn-primary lp-big" onClick={onPlay}>
            Play free
          </button>
          <button type="button" className="btn btn-ghost lp-ghost" onClick={onSignIn}>
            I have an account
          </button>
          {openCount > 0 && (
            <p className="lp-foot">
              {openCount === 1 ? '1 world open now' : `${openCount} worlds open now`} · No download
            </p>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="home">
      <header className="home-bar">
        <span className="home-brand">
          <Flame size={30} loading={!villageReady} />
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
          <HomeVillage onReady={() => setVillageReady(true)} />
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
