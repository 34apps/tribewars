// Lobby "Account" page (#account): download my data, delete my account. One column, the page scrolls; nothing inside it does.

import type { LobbyAccountDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { DeleteAccountFlow } from './DeleteAccountFlow.tsx';
import { DownloadData } from './DownloadData.tsx';
import './lobby-phone.css';
import './account.css';

export function AccountPage({ account, onBack, onDeleted }: { account: LobbyAccountDto; onBack: () => void; onDeleted: () => void }) {
  return (
    <div className="aw">
      <header className="aw-bar">
        <div className="aw-bar-in acc-bar-in">
          <button type="button" className="lp-round" aria-label="Back" onClick={onBack}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <h1 className="aw-title">Account</h1>
        </div>
      </header>
      <main className="aw-main acc-main">
        <p className="muted acc-who">Signed in as <strong>{account.username}</strong></p>
        <section className="acc-card" aria-labelledby="acc-data">
          <h2 id="acc-data" className="card-title">Your data</h2>
          <p>Download everything we keep about you as one file. It includes every world you played.</p>
          <DownloadData label="Download my data" load={api.lobbyExport} />
        </section>
        <section className="acc-card" aria-labelledby="acc-delete">
          <h2 id="acc-delete" className="card-title">Delete account</h2>
          <p>Delete your account and your data for good.</p>
          <DeleteAccountFlow mode="lobby" onDone={onDeleted} />
        </section>
      </main>
    </div>
  );
}
