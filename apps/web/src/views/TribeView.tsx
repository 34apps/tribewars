// Tribe tab: find/found a tribe when tribeless, or the member area (overview, members, diplomacy, recruit, chat, log).

import { useEffect, useMemo, useState } from 'react';
import type { MyTribeResponse, TribeDto, TribeRole } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { DominationCard } from '../components/DominationBar.tsx';
import { formatInt } from '../format.ts';
import { useSites } from '../hooks/useSites.ts';
import { tribeBonusLine } from '../sites.ts';
import { useGame, useRules } from '../game.ts';
import type { TribeTarget } from '../game.ts';
import { ROLE_NAME } from '../relations.ts';
import { RoleBadge, TribeLabel } from '../tribe/bits.tsx';
import { Alerts } from '../tribe/Alerts.tsx';
import { Chat } from '../tribe/Chat.tsx';
import { useConfirm } from '../tribe/Confirm.tsx';
import { TribeContext } from '../tribe/context.ts';
import type { TribeApi } from '../tribe/context.ts';
import { Diplomacy } from '../tribe/Diplomacy.tsx';
import { Finder } from '../tribe/Finder.tsx';
import { Forum } from '../tribe/Forum.tsx';
import { Log } from '../tribe/Log.tsx';
import { Members } from '../tribe/Members.tsx';
import { Overview } from '../tribe/Overview.tsx';
import { PublicTribe } from '../tribe/PublicTribe.tsx';
import { Recruit } from '../tribe/Recruit.tsx';
import { useMyTribe } from '../tribe/useMyTribe.ts';

type Section = 'alerts' | 'overview' | 'members' | 'diplomacy' | 'recruit' | 'chat' | 'forum' | 'log';

const SECTION_LABEL: Record<Section, string> = {
  alerts: 'Alerts',
  overview: 'Overview',
  members: 'Members',
  diplomacy: 'Diplomacy',
  recruit: 'Recruit',
  chat: 'Chat',
  forum: 'Forum',
  log: 'Log',
};

/** For everyone: the public Domination bar (compact) and, when the tribe holds Fire sites, the Renown bonus they give. */
function WorldGoal() {
  const { myBonus } = useSites(useRules().features.sites);
  const line = tribeBonusLine(myBonus);
  return (
    <>
      <DominationCard compact />
      {line && (
        <p className="site-bonus" role="status">
          <Icon name="flame" size={18} className="inline-icon" /> {line}
        </p>
      )}
    </>
  );
}

/** Remembered while the player moves between tabs; null until a section was picked. */
let lastSection: Section | null = null;

function MemberArea({ tribe, role, data }: { tribe: TribeDto; role: TribeRole; data: MyTribeResponse }) {
  const { tribeAlerts } = useGame();
  const maxMembers = useRules().tribe.maxMembers;
  // First visit with attacks incoming lands on the alerts.
  const [chosen, setChosen] = useState<Section>(lastSection ?? (tribeAlerts > 0 ? 'alerts' : 'overview'));
  const canRecruit = data.rights.includes('invite') || data.rights.includes('handle_applications');
  const sections = useMemo<Section[]>(
    () =>
      canRecruit
        ? ['alerts', 'overview', 'members', 'diplomacy', 'recruit', 'chat', 'forum', 'log']
        : ['alerts', 'overview', 'members', 'diplomacy', 'chat', 'forum', 'log'],
    [canRecruit],
  );
  // A demoted officer may be looking at Recruit, which no longer exists for them.
  const section: Section = sections.includes(chosen) ? chosen : 'overview';

  const badges: Partial<Record<Section, number>> = {
    alerts: tribeAlerts,
    diplomacy: data.proposals.filter((p) => p.direction === 'incoming').length,
    recruit: data.rights.includes('handle_applications') ? data.applications.length : 0,
    forum: data.forumUnread,
  };

  return (
    <>
      <header className="card tribe-head">
        <h1 className="page-title tribe-title"><TribeLabel tag={tribe.tag} name={tribe.name} /></h1>
        <dl className="facts tribe-stats">
          <div><dt>Rank</dt><dd>#{tribe.rank}</dd></div>
          <div><dt>Points</dt><dd>{formatInt(tribe.points)}</dd></div>
          <div><dt>Members</dt><dd>{tribe.members}/{maxMembers}</dd></div>
          <div><dt>Your role</dt><dd><RoleBadge role={role} /><span className="visually-hidden"> {ROLE_NAME[role]}</span></dd></div>
        </dl>
      </header>

      <div className="subtabs" role="tablist" aria-label="Tribe sections">
        {sections.map((s) => {
          const n = badges[s] ?? 0;
          return (
            <button
              key={s}
              role="tab"
              id={`tab-${s}`}
              aria-selected={section === s}
              aria-controls="tribe-panel"
              className={`subtab${section === s ? ' is-active' : ''}`}
              onClick={() => {
                lastSection = s;
                setChosen(s);
              }}
            >
              {SECTION_LABEL[s]}
              {n > 0 && <span className="badge badge-inline" aria-label={`${n} waiting`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div id="tribe-panel" role="tabpanel" aria-labelledby={`tab-${section}`}>
        {section === 'alerts' && <Alerts />}
        {section === 'overview' && <Overview tribe={tribe} role={role} />}
        {section === 'members' && <Members tribe={tribe} role={role} />}
        {section === 'diplomacy' && <Diplomacy tribe={tribe} role={role} />}
        {section === 'recruit' && <Recruit tribe={tribe} role={role} />}
        {section === 'chat' && <Chat />}
        {section === 'forum' && <Forum />}
        {section === 'log' && <Log />}
      </div>
    </>
  );
}

export function TribeView() {
  const { tribeFocus, clearTribeFocus } = useGame();
  const store = useMyTribe();
  const { confirm, dialog } = useConfirm();
  const [viewing, setViewing] = useState<TribeTarget | null>(null);

  // Another tab (the map) asked for a tribe's public page: take it once.
  useEffect(() => {
    if (!tribeFocus) return;
    setViewing(tribeFocus);
    clearTribeFocus();
  }, [tribeFocus, clearTribeFocus]);

  const { data, busy, run } = store;
  const api = useMemo<TribeApi | null>(
    () => (data ? { data, busy, run, confirm, openTribe: setViewing } : null),
    [data, busy, run, confirm],
  );

  let body;
  if (!data || !api) {
    body = store.error ? (
      <div className="card">
        <p className="form-error" role="alert">{store.error}</p>
        <button className="btn" onClick={() => void store.reload()}>Try again</button>
      </div>
    ) : (
      <p className="muted" role="status">Loading tribe…</p>
    );
  } else if (viewing) {
    body = (
      <TribeContext.Provider value={api}>
        <PublicTribe target={viewing} onBack={() => setViewing(null)} />
      </TribeContext.Provider>
    );
  } else if (data.tribe && data.role) {
    body = (
      <TribeContext.Provider value={api}>
        <MemberArea tribe={data.tribe} role={data.role} data={data} />
      </TribeContext.Provider>
    );
  } else {
    body = (
      <TribeContext.Provider value={api}>
        <h1 className="page-title">Tribes</h1>
        <p className="muted pad-bottom">Join a tribe to share a chat, make alliances and keep your friends off your target list.</p>
        <Finder />
      </TribeContext.Provider>
    );
  }

  return (
    <div className="page tribe-page">
      {!viewing && <WorldGoal />}
      {body}
      {dialog}
    </div>
  );
}
