// The desktop Tribe page inside the fixed 1440 x 900 frame (owner-approved pictures mix-tribe2-1440 and mix-tribe-members-1440): a tribe
// header (tag, name, recruitment line, stat tiles), the sub-tab row, then the section. Overview and Members are fixed-size pages; the other
// sections show today's components under the same header and may grow the page for now. Without a tribe: the finder. Phones keep TribeView.

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { MyTribeResponse, TribeDto, TribeRole } from '@clanfire/engine';
import { Icon } from '../../art/Icon.tsx';
import { DominationCard } from '../../components/DominationBar.tsx';
import { PageHeader } from '../../components/PageHeader.tsx';
import { formatInt } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import type { TribeTarget } from '../../game.ts';
import { useSites } from '../../hooks/useSites.ts';
import { tribeBonusLine } from '../../sites.ts';
import { Alerts } from '../../tribe/Alerts.tsx';
import { Chat } from '../../tribe/Chat.tsx';
import { useConfirm } from '../../tribe/Confirm.tsx';
import { TribeContext } from '../../tribe/context.ts';
import type { TribeApi } from '../../tribe/context.ts';
import { Diplomacy } from '../../tribe/Diplomacy.tsx';
import { Finder } from '../../tribe/Finder.tsx';
import { Forum } from '../../tribe/Forum.tsx';
import { Log } from '../../tribe/Log.tsx';
import { LookoutSection } from '../../tribe/Lookout.tsx';
import { Projects } from '../../tribe/Projects.tsx';
import { PublicTribe } from '../../tribe/PublicTribe.tsx';
import { Recruit } from '../../tribe/Recruit.tsx';
import { useMyTribe } from '../../tribe/useMyTribe.ts';
import { FrameTribeMembers } from './FrameTribeMembers.tsx';
import { FrameTribeOverview } from './FrameTribeOverview.tsx';
import type { TribeSection } from './FrameTribeOverview.tsx';
import { RECRUITMENT_LINE, shortDate } from './frame-tribe-logic.ts';
import { setTribeFixed } from './tribe-fixed.ts';
import '../../frame-tribe.css';

const SECTION_LABEL: Record<TribeSection, string> = {
  alerts: 'Alerts',
  overview: 'Overview',
  members: 'Members',
  diplomacy: 'Diplomacy',
  projects: 'Projects',
  recruit: 'Recruit',
  chat: 'Chat',
  forum: 'Forum',
  log: 'Log',
};

/** The Fire-site Renown bonus and the Domination bar, as on the phone; shown under the growing sub-tabs. */
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

function TribeHeader({ tribe }: { tribe: TribeDto }) {
  const maxMembers = useRules().tribe.maxMembers;
  const stats: Array<[string, string]> = [
    ['Members', `${tribe.members} / ${maxMembers}`],
    ['Points', formatInt(tribe.points)],
    ['Villages', formatInt(tribe.villages)],
    ['Rank', `#${tribe.rank}`],
  ];
  return (
    <div className="frt-head">
      <span className={`frt-tag${tribe.tag.length > 3 ? ' is-long' : ''}`} aria-hidden="true">{tribe.tag}</span>
      <h1 className="frt-name">
        <b>{tribe.name}</b>
        <small>
          <span className="visually-hidden">Tag {tribe.tag}. </span>
          {RECRUITMENT_LINE[tribe.recruitment]} · founded {shortDate(tribe.createdAt)}
        </small>
      </h1>
      <span className="fv-sp" />
      <dl className="frt-stats">
        {stats.map(([label, value]) => (
          <div key={label} className="frt-st">
            <dt className="fv-up">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MemberArea({ tribe, role, data }: { tribe: TribeDto; role: TribeRole; data: MyTribeResponse }) {
  const { tribeAlerts } = useGame();
  const [chosen, setChosen] = useState<TribeSection>('overview');
  const canRecruit = data.rights.includes('invite') || data.rights.includes('handle_applications');
  const sections = useMemo<TribeSection[]>(
    () => (canRecruit ? ['overview', 'alerts', 'members', 'diplomacy', 'projects', 'recruit', 'chat', 'forum', 'log'] : ['overview', 'alerts', 'members', 'diplomacy', 'projects', 'chat', 'forum', 'log']),
    [canRecruit],
  );
  // A demoted officer may be looking at Recruit, which no longer exists for them.
  const section: TribeSection = sections.includes(chosen) ? chosen : 'overview';
  const fixed = section === 'overview' || section === 'members';
  useLayoutEffect(() => {
    setTribeFixed(fixed);
  }, [fixed]);

  const badges: Partial<Record<TribeSection, number>> = {
    alerts: tribeAlerts,
    diplomacy: data.proposals.filter((p) => p.direction === 'incoming').length,
    recruit: data.rights.includes('handle_applications') ? data.applications.length : 0,
    forum: data.forumUnread,
  };
  const go = (s: TribeSection) => {
    window.scrollTo?.({ top: 0 });
    setChosen(s);
  };

  return (
    <div className={`frt${fixed ? ' frt-fixed' : ' frt-flow'}`}>
      <TribeHeader tribe={tribe} />
      <nav className="frt-subs" role="tablist" aria-label="Tribe sections">
        {sections.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            id={`tab-${s}`}
            aria-selected={section === s}
            aria-controls="tribe-panel"
            className={`frt-sub${section === s ? ' on' : ''}`}
            onClick={() => go(s)}
          >
            {SECTION_LABEL[s]}
            {(badges[s] ?? 0) > 0 && (
              <i className={s === 'alerts' ? 'is-red' : undefined} aria-label={`${badges[s]} waiting`}>
                {badges[s]}
              </i>
            )}
          </button>
        ))}
      </nav>
      <div id="tribe-panel" role="tabpanel" aria-labelledby={`tab-${section}`} className="frt-body">
        {section === 'overview' && <FrameTribeOverview tribe={tribe} role={role} onOpen={go} />}
        {section === 'members' && <FrameTribeMembers tribe={tribe} role={role} />}
        {!fixed && (
          <div className="page frt-old">
            {section === 'alerts' && (
              <>
                <Alerts />
                <LookoutSection />
              </>
            )}
            {section === 'diplomacy' && <Diplomacy tribe={tribe} role={role} />}
            {section === 'projects' && <Projects />}
            {section === 'recruit' && <Recruit tribe={tribe} role={role} />}
            {section === 'chat' && <Chat />}
            {section === 'forum' && <Forum />}
            {section === 'log' && <Log />}
            <WorldGoal />
          </div>
        )}
      </div>
    </div>
  );
}

/** Pages that are not the fixed Overview / Members: they grow the frame (and the page scrolls). */
function Flow({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    setTribeFixed(false);
  }, []);
  return <div className="frt frt-flow"><div className="page frt-old">{children}</div></div>;
}

export function FrameTribe() {
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
  // Leaving the page: back to the shell's default.
  useEffect(() => () => setTribeFixed(false), []);

  const { data, busy, run } = store;
  const api = useMemo<TribeApi | null>(() => (data ? { data, busy, run, confirm, openTribe: setViewing } : null), [data, busy, run, confirm]);

  let body;
  if (!data || !api) {
    body = (
      <Flow>
        <PageHeader icon="tribe" title="Tribe" />
        {store.error ? (
          <div className="card">
            <p className="form-error" role="alert">{store.error}</p>
            <button className="btn" onClick={() => void store.reload()}>Retry</button>
          </div>
        ) : (
          <p className="muted" role="status">Loading…</p>
        )}
      </Flow>
    );
  } else if (viewing) {
    body = (
      <TribeContext.Provider value={api}>
        <Flow>
          <PublicTribe target={viewing} onBack={() => setViewing(null)} />
        </Flow>
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
        <Flow>
          <PageHeader icon="tribe" title="Tribes" />
          <Finder />
          <WorldGoal />
        </Flow>
      </TribeContext.Provider>
    );
  }
  return (
    <>
      {body}
      {dialog}
    </>
  );
}
