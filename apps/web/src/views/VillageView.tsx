import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BUILDINGS } from '@clanfire/engine';
import type { BuildingId } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { HoldCard } from '../components/HoldCard.tsx';
import { formatDuration } from '../format.ts';
import { useGame, useRules } from '../game.ts';
import { useDockSpace } from '../hooks/useDockSpace.ts';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery.ts';
import { Advisor, BuildQueue, BuildingPanel } from './village/Panels.tsx';
import { FirstStepsCard, FirstStepsChip } from './village/FirstSteps.tsx';
import { MovementsSummary, outgoingOnTheRoad } from './village/MovementsSummary.tsx';
import { RenownCard, RenownChip } from './village/RenownCard.tsx';
import { VillageScene } from './village/VillageScene.tsx';
import { DesignPreviewBar } from './village/DesignPreviewBar.tsx';
import { designPreviewAllowed, useDesignPreview } from './village/designPreviewState.ts';
import './village/village.css';

function useBuild() {
  const { village, applyVillage, refresh, toast } = useGame();
  const [busy, setBusy] = useState(false);
  async function build(id: BuildingId) {
    if (busy) return;
    setBusy(true);
    try {
      applyVillage(await api.build(village.id, id));
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }
  return { busy, build: (id: BuildingId) => void build(id) };
}

type Panel = { kind: 'building'; id: BuildingId } | { kind: 'queue' } | { kind: 'renown' } | { kind: 'steps' } | { kind: 'road' } | null;

/** Queue chip: used slots and the running timer. */
function QueueChip({ onClick }: { onClick: () => void }) {
  const { live, now } = useGame();
  const maxQueue = useRules().queues.build;
  const jobs = live.buildQueue;
  const first = jobs[0];
  return (
    <button type="button" className="vv-queuechip" onClick={onClick} aria-label={`Construction queue, ${jobs.length} of ${maxQueue} slots used`}>
      <Icon name="queue" size={22} />
      <span>
        {jobs.length}/{maxQueue}
      </span>
      {first && now >= first.startAt && <strong>{formatDuration(first.finishAt - now)}</strong>}
    </button>
  );
}

/** "On the road" chip: only while some of my own troops or shipments are travelling. */
function RoadChip({ onClick }: { onClick: () => void }) {
  const { movements, now } = useGame();
  const n = outgoingOnTheRoad(movements, now).length;
  if (n === 0) return null;
  return (
    <button type="button" className="vv-queuechip vv-roadchip" onClick={onClick} aria-label={`${n} of my armies on the road. Open details.`}>
      <Icon name="send" size={22} />
      <span>{n} on the road</span>
    </button>
  );
}

/** Notices that float under the HUD: abandoned villages, a cold hearth, the design preview bar. */
function Notices({ compact, preview }: { compact: boolean; preview: boolean }) {
  return (
    <div className="vv-notices">
      <AbandonedNotice />
      <HearthNotice compact={compact} />
      {preview && <DesignPreviewBar inline />}
    </div>
  );
}

function PanelContent({ panel, busy, build, setPanel, headingId, compact }: { panel: NonNullable<Panel>; busy: boolean; build: (id: BuildingId) => void; setPanel: (p: Panel) => void; headingId: string; compact: boolean }) {
  const pickBuilding = (id: BuildingId) => setPanel({ kind: 'building', id });
  switch (panel.kind) {
    case 'building':
      return (
        <>
          <BuildingPanel id={panel.id} busy={busy} onBuild={build} headingId={headingId} onPick={pickBuilding} />
          <Advisor id={panel.id} compact={compact} />
        </>
      );
    case 'queue':
      return <BuildQueue onPick={pickBuilding} />;
    case 'renown':
      return <RenownCard />;
    case 'steps':
      return <FirstStepsCard sheet={compact} onShowBuilding={pickBuilding} />;
    case 'road':
      return <MovementsSummary outgoingOnly />;
  }
}

function panelTitle(panel: Panel): string {
  if (!panel) return '';
  return panel.kind === 'building' ? BUILDINGS[panel.id].name : panel.kind === 'renown' ? 'Renown' : panel.kind === 'steps' ? 'First steps' : panel.kind === 'road' ? 'On the road' : 'Construction queue';
}

function DesktopVillage({ active }: { active: boolean }) {
  const { village, player } = useGame();
  const dp = useDesignPreview();
  const preview = designPreviewAllowed(player.sandbox) && dp.on;
  const [panel, setPanel] = useState<Panel>(null);
  const { busy, build } = useBuild();
  const selected = panel?.kind === 'building' ? panel.id : null;
  useEffect(() => {
    if (!active) setPanel(null);
  }, [active]);
  useEffect(() => {
    if (!panel || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel, active]);
  return (
    <div className="vv vv-desktop" hidden={!active}>
      <section className="vv-board" aria-label={`${village.name}, village`}>
        <h1 className="visually-hidden">{village.name}</h1>
        <VillageScene mode="fit" selected={selected} onSelect={(id) => setPanel({ kind: 'building', id })} levelOverride={preview ? dp : null} />
      </section>
      <Notices compact={false} preview={preview} />
      <div className="vv-chips vv-chips-left">
        <FirstStepsChip onOpen={() => setPanel({ kind: 'steps' })} />
      </div>
      <div className={`vv-chips vv-chips-right${panel ? ' has-sheet' : ''}`}>
        <RoadChip onClick={() => setPanel({ kind: 'road' })} />
        <QueueChip onClick={() => setPanel({ kind: 'queue' })} />
        <RenownChip onClick={() => setPanel({ kind: 'renown' })} />
      </div>
      {panel && (
        <aside className="hud-sheet vv-dsheet" aria-label={panelTitle(panel)}>
          <button type="button" className="hud-x vv-dsheet-x" onClick={() => setPanel(null)} aria-label="Close details">
            <Icon name="close" size={20} />
          </button>
          <PanelContent panel={panel} busy={busy} build={build} setPanel={setPanel} headingId="bpanel-title" compact={false} />
        </aside>
      )}
    </div>
  );
}

function PhoneVillage({ active }: { active: boolean }) {
  const { player } = useGame();
  const dp = useDesignPreview();
  const preview = designPreviewAllowed(player.sandbox) && dp.on;
  const [sheet, setSheet] = useState<Panel>(null);
  const [panned, setPanned] = useState(false);
  const [sheetH, setSheetH] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const dock = useDockSpace();
  const { busy, build } = useBuild();

  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) {
      setSheetH(0);
      return;
    }
    const measure = () => setSheetH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet]);

  useEffect(() => {
    if (!active) setSheet(null);
  }, [active]);

  useEffect(() => {
    if (!sheet || !active) return;
    headRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheet(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet, active]);

  const selected = sheet?.kind === 'building' ? sheet.id : null;
  const sheetTitle = panelTitle(sheet);

  return (
    <div className="vv vv-phone" hidden={!active}>
      <div className="vv-phone-main">
        <h1 className="visually-hidden">Village</h1>
        <VillageScene
          mode="pan"
          levelOverride={preview ? dp : null}
          selected={selected}
          onSelect={(id) => setSheet({ kind: 'building', id })}
          bottomInset={dock + sheetH}
          onPanned={() => setPanned(true)}
        />
        <Notices compact preview={preview} />
        {!panned && !sheet && (
          <div className="vv-draghint" aria-hidden="true">
            <Icon name="drag" size={22} />
          </div>
        )}
        {!sheet && (
          <div className="vv-chips vv-chips-phone">
            <FirstStepsChip onOpen={() => setSheet({ kind: 'steps' })} />
            <div className="vv-chips-phone-right">
              <RoadChip onClick={() => setSheet({ kind: 'road' })} />
              <QueueChip onClick={() => setSheet({ kind: 'queue' })} />
              <RenownChip onClick={() => setSheet({ kind: 'renown' })} />
            </div>
          </div>
        )}
        {sheet && (
          <div className="vv-sheet" ref={sheetRef} role="dialog" aria-modal="false" aria-label={sheetTitle}>
            <div className="vv-sheet-top" tabIndex={-1} ref={headRef}>
              <span className="vv-grip" aria-hidden="true" />
              <button type="button" className="vv-sheet-close" onClick={() => setSheet(null)} aria-label="Close">
                <Icon name="close" size={24} />
              </button>
            </div>
            <div className="vv-sheet-body">
              <PanelContent panel={sheet} busy={busy} build={build} setPanel={setSheet} headingId="sheet-title" compact />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shown once to a player whose villages were abandoned while they were away (until they dismiss it). */
function AbandonedNotice() {
  const { player, refresh, toast } = useGame();
  const [busy, setBusy] = useState(false);
  const n = player.abandonedNotice;
  if (!n) return null;
  const days = `${n.idleDays} ${n.idleDays === 1 ? 'day' : 'days'}`;
  const dismiss = () => {
    setBusy(true);
    api
      .dismissAbandonedNotice()
      .then(() => refresh())
      .catch((e) => toast(errorMessage(e), { kind: 'error' }))
      .finally(() => setBusy(false));
  };
  return (
    <div className="notice notice-block vv-abandoned" role="status">
      <div>
        Away {days}: {n.villages === 1 ? '1 village' : `${n.villages} villages`} abandoned. You get a new village with beginner protection.
      </div>
      <button className="btn btn-primary vv-abandoned-btn" onClick={dismiss} disabled={busy}>
        Got it
      </button>
    </div>
  );
}

/** The current village's hearth is out: who holds it and the clock (phones get the short card). */
function HearthNotice({ compact }: { compact: boolean }) {
  const { village } = useGame();
  if (!village.hearth) return null;
  return (
    <div className="vv-hearth-notice">
      <HoldCard hearth={village.hearth} viewpoint="owner" compact={compact} />
    </div>
  );
}

/**
 * Stays mounted while other screens are open (Game.tsx hands it a frozen game context then, and memo skips its renders), so
 * coming back is a `hidden` flip: sprites, boxes and pan position are all still there.
 */
export const VillageView = memo(function VillageView({ active = true }: { active?: boolean }) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  return desktop ? <DesktopVillage active={active} /> : <PhoneVillage active={active} />;
});
