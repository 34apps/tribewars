// The "Share play stats" switch of the lobby Account page (docs/ANALYTICS.md). No CSS import of its own (uses the account page's card classes).

import { useState } from 'react';
import type { LobbyAccountDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';

/** The "Share play stats" switch (docs/ANALYTICS.md): anonymous play statistics, on by default; off = nothing is sent for this account. */
export function ShareStats({ account, onChanged }: { account: LobbyAccountDto; onChanged: (a: LobbyAccountDto) => void }) {
  const [share, setShare] = useState(account.shareStats);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = (next: boolean) => {
    setBusy(true);
    setError(null);
    api
      .lobbyShareStats(next)
      .then((r) => {
        setShare(next);
        if (r.account) onChanged(r.account);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="acc-card" aria-labelledby="acc-stats">
      <h2 id="acc-stats" className="card-title">Play stats</h2>
      <p>
        We count anonymous play statistics to improve the game: which pages are used, how far new players get, and purchases. No names, no
        chat, no village names or coordinates. Turn this off and nothing is sent for you. A world you are playing follows the next time you enter it.
      </p>
      <label className="check" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
        <input type="checkbox" role="switch" checked={share} disabled={busy} onChange={(e) => change(e.target.checked)} />
        <span>Share play stats</span>
      </label>
      <p className="form-error" role="alert">{error}</p>
    </section>
  );
}
