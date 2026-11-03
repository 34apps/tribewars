import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BUILDINGS, buildQueueLimit } from '@clanfire/engine';
import type { BuildingId } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { formatCoords, formatDuration } from '../format.ts';
import { useGame } from '../game.ts';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery.ts';
import { Advisor, BuildQueue, BuildingPanel, Production } from './village/Panels.tsx';
import { VillageScene } from './village/VillageScene.tsx';
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

function Legend() {
  return (
    <ul className="vv-legend" aria-label="Legend">
      <li>
        <span className="token" aria-hidden="true">
          <Icon name="sign" size={20} />
        </span>
        Empty plot · build
      </li>
      <li>
        <span className="token" aria-hidden="true">
          <Icon name="scaffold" size={20} />
        </span>
        Under construction
      </li>
    </ul>
  );
}

function DesktopVillage() {
  const { village, player } = useGame();
  const [selected, setSelected] = useState<BuildingId>('hall');
  const { busy, build } = useBuild();
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
        </div>
        <Legend />
        <VillageScene mode="fit" selected={selected} onSelect={setSelected} />
        <Production />
      </section>
      <aside className="vv-side" aria-label="Village details">
        <BuildingPanel id={selected} busy={busy} onBuild={build} headingId="bpanel-title" />
        <BuildQueue onPick={setSelected} />
        <Advisor id={selected} />
      </aside>
    </div>
  );
}

function PhoneVillage() {
  const { village, live, now, player } = useGame();
  const maxQueue = buildQueueLimit(player.premium);
  const [sheet, setSheet] = useState<{ kind: 'building'; id: BuildingId } | { kind: 'queue' } | null>(null);
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
  const sheetTitle = sheet?.kind === 'building' ? BUILDINGS[sheet.id].name : 'Construction queue';

  return (
    <div className="vv vv-phone">
      <VillageScene
        mode="pan"
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
                <BuildingPanel id={sheet.id} busy={busy} onBuild={build} headingId="sheet-title" />
                <Advisor id={sheet.id} compact />
              </>
            ) : (
              <BuildQueue onPick={(id) => setSheet({ kind: 'building', id })} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function VillageView() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  return desktop ? <DesktopVillage /> : <PhoneVillage />;
}
