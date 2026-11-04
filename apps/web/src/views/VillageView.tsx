import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BUILDINGS, MAX_BUILD_QUEUE } from '@clanfire/engine';
import type { BuildingId } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { formatCoords, formatDuration } from '../format.ts';
import { useGame } from '../game.ts';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery.ts';
import { Advisor, BuildQueue, BuildingPanel, Production } from './village/Panels.tsx';
import { MovementsSummary } from './village/MovementsSummary.tsx';
import { RenownBadge, RenownCard, RenownChip } from './village/RenownCard.tsx';
import { VillageScene } from './village/VillageScene.tsx';
import { DesignPreviewBar } from './village/DesignPreviewBar.tsx';
import { useDesignPreview } from './village/designPreviewState.ts';
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

function DesktopVillage() {
  const { village, player } = useGame();
  const dp = useDesignPreview();
  const preview = player.sandbox && dp.on;
  const [selected, setSelected] = useState<BuildingId | null>('hall');
  const { busy, build } = useBuild();
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);
  return (
    <div className="vv vv-desktop">
      <section className="vv-board" aria-labelledby="vv-title">
        <div className="vv-board-head">
          <h1 id="vv-title" className="vv-title">
            {village.name}
          </h1>
          <div className="vv-sub">
            {formatCoords(village.x, village.y)}
            {player.tribe ? ` · ${player.tribe.name} [${player.tribe.tag}]` : ''} · click any building
          </div>
          {preview && <DesignPreviewBar />}
        </div>
        <RenownBadge />
        <VillageScene mode="fit" selected={selected} onSelect={setSelected} levelOverride={preview ? dp : null} />
        <Production />
      </section>
      <aside className="vv-side" aria-label="Village details">
        <MovementsSummary />
        {selected ? (
          <>
            <button type="button" className="btn btn-small vv-side-close" onClick={() => setSelected(null)} aria-label="Close building details">
              <Icon name="close" size={16} /> Close
            </button>
            <BuildingPanel id={selected} busy={busy} onBuild={build} headingId="bpanel-title" onPick={setSelected} />
          </>
        ) : (
          <p className="muted vv-side-hint">Click a building to see its details.</p>
        )}
        <BuildQueue onPick={setSelected} />
        <RenownCard />
        {selected && <Advisor id={selected} />}
      </aside>
    </div>
  );
}

function PhoneVillage() {
  const { village, live, now, player } = useGame();
  const maxQueue = MAX_BUILD_QUEUE;
  const dp = useDesignPreview();
  const preview = player.sandbox && dp.on;
  const [sheet, setSheet] = useState<{ kind: 'building'; id: BuildingId } | { kind: 'queue' } | { kind: 'renown' } | null>(null);
  const [panned, setPanned] = useState(false);
  const [sheetH, setSheetH] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
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
    if (!sheet) return;
    headRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheet(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);

  const jobs = live.buildQueue;
  const first = jobs[0];
  const selected = sheet?.kind === 'building' ? sheet.id : null;
  const sheetTitle = sheet?.kind === 'building' ? BUILDINGS[sheet.id].name : sheet?.kind === 'renown' ? 'Renown' : 'Construction queue';

  return (
    <div className="vv vv-phone">
      <div className="vv-phone-main">
        <VillageScene
          mode="pan"
          levelOverride={preview ? dp : null}
          selected={selected}
          onSelect={(id) => setSheet({ kind: 'building', id })}
          bottomInset={sheetH}
          onPanned={() => setPanned(true)}
        />
        <div className="vv-namepill">
          <Icon name="flame" size={18} />
          <h1 className="vv-namepill-name">{village.name}</h1>
          <span className="vv-namepill-xy">{formatCoords(village.x, village.y)}</span>
        </div>
        {!sheet && (
          <div className="vv-moves-float">
            <MovementsSummary compact />
          </div>
        )}
        {!panned && !sheet && (
          <div className="vv-draghint" aria-hidden="true">
            <Icon name="drag" size={22} />
            Drag to look around
          </div>
        )}
        {!sheet && (
          <button
            type="button"
            className="vv-queuechip"
            onClick={() => setSheet({ kind: 'queue' })}
            aria-label={`Construction queue, ${jobs.length} of ${maxQueue} slots used`}
          >
            <Icon name="queue" size={20} />
            <span>
              {jobs.length}/{maxQueue}
            </span>
            {first && now >= first.startAt && <strong>{formatDuration(first.finishAt - now)}</strong>}
          </button>
        )}
        {!sheet && <RenownChip onClick={() => setSheet({ kind: 'renown' })} />}
        {sheet && (
          <div className="vv-sheet dark" ref={sheetRef} role="dialog" aria-modal="false" aria-label={sheetTitle}>
            <div className="vv-sheet-top" tabIndex={-1} ref={headRef}>
              <span className="vv-grip" aria-hidden="true" />
              <button type="button" className="vv-sheet-close" onClick={() => setSheet(null)} aria-label="Close">
                <Icon name="close" size={24} />
              </button>
            </div>
            <div className="vv-sheet-body">
              {sheet.kind === 'building' ? (
                <>
                  <BuildingPanel id={sheet.id} busy={busy} onBuild={build} headingId="sheet-title" onPick={(b) => setSheet({ kind: 'building', id: b })} />
                  <Advisor id={sheet.id} compact />
                </>
              ) : sheet.kind === 'renown' ? (
                <RenownCard />
              ) : (
                <BuildQueue onPick={(id) => setSheet({ kind: 'building', id })} />
              )}
            </div>
          </div>
        )}
      </div>
      {/* In its own strip under the scene (not floating), so it never covers the village. */}
      {preview && <DesignPreviewBar inline />}
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
    <div className="notice notice-block" role="status" style={{ margin: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        You were away for {days}, so {n.villages === 1 ? 'your village was' : `your ${n.villages} villages were`} abandoned and now{' '}
        {n.villages === 1 ? 'belongs' : 'belong'} to the map. Troops you stationed elsewhere stay there. You start over with a new village under
        beginner protection.
      </div>
      <button className="btn btn-primary" style={{ minHeight: 40, alignSelf: 'flex-start' }} onClick={dismiss} disabled={busy}>
        Got it
      </button>
    </div>
  );
}

export function VillageView() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  return (
    <>
      <AbandonedNotice />
      {desktop ? <DesktopVillage /> : <PhoneVillage />}
    </>
  );
}
