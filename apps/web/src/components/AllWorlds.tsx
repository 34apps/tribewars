// "All worlds": every world the account has not played yet, in three tabs (Open / Full / Finished). Phone and desktop
// (a centred column). The page scrolls; nothing inside it does.

import { useState } from 'react';
import { useEnterWorld, useLobbyWorlds } from '../hooks/useLobbyWorlds.ts';
import { groupWorlds, startedLabel } from '../lobby.ts';
import type { OtherWorlds } from '../lobby.ts';
import { WorldRow } from './WorldRow.tsx';
import './lobby-phone.css';

type Tab = keyof OtherWorlds;

const TABS: { id: Tab; label: string; empty: string }[] = [
  { id: 'open', label: 'Open', empty: 'No open worlds to join right now.' },
  { id: 'full', label: 'Full', empty: 'No full worlds.' },
  { id: 'finished', label: 'Finished', empty: 'No finished worlds to look at.' },
];

export function AllWorlds({ onBack, onSignedOut }: { onBack: () => void; onSignedOut: () => void }) {
  const { list, retry } = useLobbyWorlds(onSignedOut);
  const { busyId, errors, play } = useEnterWorld(onSignedOut);
  const [tab, setTab] = useState<Tab>('open');
  const others = list.state === 'ready' ? groupWorlds(list.worlds).others : null;
  const shown = others ? others[tab] : [];
  const now = Date.now();

  return (
    <div className="aw">
      <header className="aw-bar">
        <div className="aw-bar-in">
          <button type="button" className="lp-round" aria-label="Back" onClick={onBack}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <h1 className="aw-title">All worlds</h1>
        </div>
      </header>

      <main className="aw-main">
        {list.state === 'loading' && (
          <p className="home-note" role="status">
            Loading worlds…
          </p>
        )}
        {list.state === 'error' && (
          <div className="home-note" role="alert">
            <p>{list.message}</p>
            <button type="button" className="btn btn-primary" onClick={retry}>
              Try again
            </button>
          </div>
        )}
        {others && (
          <>
            <div className="lp-tabs" role="tablist" aria-label="World state">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" id={`aw-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="aw-panel" className={`lp-tab${tab === t.id ? ' is-on' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}
                  <b>{others[t.id].length}</b>
                </button>
              ))}
            </div>
            <div id="aw-panel" role="tabpanel" aria-labelledby={`aw-tab-${tab}`}>
              {shown.length === 0 ? (
                <p className="aw-empty">{TABS.find((t) => t.id === tab)!.empty}</p>
              ) : (
                <ul className="lp-list aw-list">
                  {shown.map((w) => (
                    <WorldRow
                      key={w.id}
                      world={w}
                      meta={startedLabel(w.openedAt, now)}
                      action={tab === 'open' ? 'join' : tab === 'full' ? 'full' : 'view'}
                      busyId={busyId}
                      disabled={false}
                      error={errors[w.id]}
                      onPlay={(x) => void play(x)}
                    />
                  ))}
                </ul>
              )}
            </div>
            <p className="aw-note">Worlds you play are on the first page.</p>
          </>
        )}
      </main>
    </div>
  );
}
