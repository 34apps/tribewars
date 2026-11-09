// The desktop Reports page inside the fixed 1440 x 900 frame (owner-approved pictures mix-reports2-*-1440): the report list on the left
// (type chips with unread counts, day groups, one-line rows, paging instead of scrolling) and the chosen report on the right, built from
// the same data the phone's ReportsView shows. No village column, no scrolling: long tables use compact rows or a "+N more" dialog.
// Phones keep ReportsView.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BUILDINGS, BUILDING_IDS, RESOURCE_IDS, UNITS, UNIT_IDS, normalizeUnits } from '@clanfire/engine';
import type { BattleReportData, ReportDto, ReportSummaryDto, ScoutReportData, ShipmentReportData, SiegeHit, SupportReportData, Units, VillageRefDto, VillageReportData } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../../api.ts';
import { BuildingArt } from '../../art/BuildingArt.tsx';
import { Icon } from '../../art/Icon.tsx';
import type { IconName } from '../../art/Icon.tsx';
import { UnitFigure } from '../../art/UnitFigure.tsx';
import { formatCoords, formatInt, formatSignedPercent } from '../../format.ts';
import { useGame } from '../../game.ts';
import { useLiveTopic } from '../../hooks/useLive.tsx';
import { MISSION_ICON, RESOURCE_ICON, RESOURCE_NAME, UNIT_ICON } from '../../icons.ts';
import { DAY_GROUP_LABEL, groupByDay, reportLine } from '../../reports.ts';
import { unitListText } from '../../rules.ts';
import { draftFromReport } from '../../simulator.ts';
import { moraleLabel, siegeHitText, villageReportText } from '../../villages.ts';
import { Dialog } from '../army/FrameArmy.tsx';
import { Chev, pluralUnit } from '../village/FrameParts.tsx';
import { reportIcon, reportTone } from '../ReportsView.tsx';
import { REPORT_FILTERS, attackShare, carriedLine, filterCounts, filterReports, pageSlice, paging, rowOutcome, tableDensity } from './frame-reports-logic.ts';
import type { ReportFilter } from './frame-reports-logic.ts';
import '../../frame-reports.css';

const SIEGE_SHOWN = 3;
/** Short plural for the siege rows ("40 Slings"). */
const SIEGE_PLURAL: Partial<Record<(typeof UNIT_IDS)[number], string>> = { logram: 'Log Rams', boulder: 'Slings' };

// ---- Small shared bits -----------------------------------------------------------------------------------------------

const TONE_CLASS = { ok: 'd', sun: 'r', bad: 'x', mute: 'c' } as const;

/** The round icon token of a report (list row and detail header). */
function Token({ r, size }: { r: ReportSummaryDto; size: number }) {
  return (
    <span className={`frp-tk ${TONE_CLASS[reportTone(r)]}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={reportIcon(r)} size={Math.round(size * 0.62)} />
    </span>
  );
}

function Tag({ tone, children, big }: { tone: string; children: ReactNode; big?: boolean }) {
  return <span className={`frp-tag ${tone}${big ? ' big' : ''}`}>{children}</span>;
}

function Pt({ unit, size = 24 }: { unit: Parameters<typeof UnitFigure>[0]['unit']; size?: number }) {
  return (
    <span className="frp-pt" style={{ width: size, height: size }} aria-hidden="true">
      <UnitFigure unit={unit} pose="icon" size={size} />
    </span>
  );
}

function Num({ value, loss }: { value: number | null; loss?: boolean }) {
  if (value === null) return <span className="frp-dash">?</span>;
  if (value === 0) return <span className="frp-dash">–</span>;
  return <b className={loss ? 'ls' : undefined}>{loss ? '−' : ''}{formatInt(value)}</b>;
}

/** Owner name for the report's owner ("You") or the other side. */
function useSideName() {
  const { player } = useGame();
  return (v: VillageRefDto): string => (v.ownerName !== null && v.ownerName === player.username ? 'You' : v.ownerName ?? 'Abandoned village');
}

function SideCard({ role, v, win }: { role: string; v: VillageRefDto; win?: boolean }) {
  const { showOnMap } = useGame();
  return (
    <div className={`frp-sdc${win ? ' w' : ''}`}>
      <span className="fv-up frp-role">
        {role}
        {win && <Tag tone="won">Winner</Tag>}
      </span>
      <b>{v.ownerName ?? 'Abandoned village'}</b>
      <button type="button" className="fv-lk" onClick={() => showOnMap(v.x, v.y)} title="Open on map">
        {v.name} ({formatCoords(v.x, v.y)})
      </button>
    </div>
  );
}

function Sides({ left, right, mid = 'vs', winner }: { left: [string, VillageRefDto]; right?: [string, VillageRefDto]; mid?: string; winner?: 'left' | 'right' }) {
  return (
    <div className="frp-sd">
      <SideCard role={left[0]} v={left[1]} win={winner === 'left'} />
      {right && (
        <>
          <span className="frp-vs" aria-hidden="true">{mid}</span>
          <SideCard role={right[0]} v={right[1]} win={winner === 'right'} />
        </>
      )}
    </div>
  );
}

function Note({ tone, icon, children, aside }: { tone: 'ok' | 'bad' | 'mute'; icon: IconName; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={`frp-note is-${tone}`} role="note">
      <Icon name={icon} size={20} />
      <span>{children}</span>
      {aside && <span className="frp-aside">{aside}</span>}
    </div>
  );
}

function Tiles({ res, size = 26, dim }: { res: Record<(typeof RESOURCE_IDS)[number], number>; size?: number; dim?: boolean }) {
  return (
    <div className="frp-tiles">
      {RESOURCE_IDS.map((r) => (
        <div key={r} className={`frp-tile${dim && (res[r] ?? 0) === 0 ? ' is-zero' : ''}`}>
          <Icon name={RESOURCE_ICON[r]} size={size} />
          <b>{formatInt(res[r] ?? 0)}</b>
          <span>{RESOURCE_NAME[r]}</span>
        </div>
      ))}
    </div>
  );
}

function Box({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`frp-bx ${className}`} aria-label={title}>
      <div className="frp-bxh">
        <h3>{title}</h3>
        <span className="fv-sp" />
        {aside}
      </div>
      {children}
    </section>
  );
}

// ---- Battle ----------------------------------------------------------------------------------------------------------

interface ForceRow {
  unit: (typeof UNIT_IDS)[number];
  sent: number | null;
  lost: number | null;
  had: number | null;
  hadLost: number | null;
  support?: boolean;
}

function forceRows(b: BattleReportData): { main: ForceRow[]; support: ForceRow[] } {
  const att = normalizeUnits(b.attackerUnits);
  const attLost = normalizeUnits(b.attackerLosses);
  const def = b.defenderUnits ? normalizeUnits(b.defenderUnits) : null;
  const defLost = b.defenderLosses ? normalizeUnits(b.defenderLosses) : null;
  const sup = b.supportUnits ? normalizeUnits(b.supportUnits) : null;
  const supLost = b.supportLosses ? normalizeUnits(b.supportLosses) : null;
  const main = UNIT_IDS.filter((u) => att[u] > 0 || (def?.[u] ?? 0) > 0).map((u) => ({
    unit: u,
    sent: att[u],
    lost: attLost[u],
    had: def ? def[u] : null,
    hadLost: defLost ? defLost[u] : null,
  }));
  const support = UNIT_IDS.filter((u) => (sup?.[u] ?? 0) > 0).map((u) => ({
    unit: u,
    sent: 0,
    lost: 0,
    had: sup ? sup[u] : null,
    hadLost: supLost ? supLost[u] : null,
    support: true,
  }));
  return { main, support };
}

function ForcesTable({ rows, supportRows, attName, defName, supportLabel, density, limit }: { rows: ForceRow[]; supportRows: ForceRow[]; attName: string; defName: string; supportLabel: string; density: 'normal' | 'compact'; limit: number }) {
  // `limit` counts body rows including the support group heading; rows past it are left out (they are in the dialog).
  const shownMain = rows.slice(0, limit);
  const left = limit - shownMain.length;
  const shownSupport = left > 1 ? supportRows.slice(0, left - 1) : [];
  const line = (r: ForceRow) => (
    <tr key={`${r.support ? 's' : 'm'}-${r.unit}`} className={r.support ? 'sp' : undefined}>
      <th scope="row">
        <Pt unit={r.unit} size={density === 'compact' ? 20 : 24} />
        {UNITS[r.unit].name}
      </th>
      <td>{r.support ? <span className="frp-dash">–</span> : <Num value={r.sent} />}</td>
      <td>{r.support ? <span className="frp-dash">–</span> : <Num value={r.lost} loss />}</td>
      <td><Num value={r.had} /></td>
      <td><Num value={r.hadLost} loss /></td>
    </tr>
  );
  return (
    <table className={`frp-bt${density === 'compact' ? ' is-compact' : ''}`}>
      <thead>
        <tr>
          <th />
          <th colSpan={2} className="g">{attName} · attacker</th>
          <th colSpan={2} className="g">{defName} · defender</th>
        </tr>
        <tr>
          <th scope="col">Unit</th>
          <th scope="col" className="n">Sent</th>
          <th scope="col" className="n">Lost</th>
          <th scope="col" className="n">Had</th>
          <th scope="col" className="n">Lost</th>
        </tr>
      </thead>
      <tbody>
        {shownMain.map(line)}
        {rows.length === 0 && supportRows.length === 0 && (
          <tr>
            <td colSpan={5} className="frp-dash">No units.</td>
          </tr>
        )}
        {shownSupport.length > 0 && (
          <tr className="gr">
            <th colSpan={5}>
              <Icon name={MISSION_ICON.support} size={18} />
              {supportLabel}
            </th>
          </tr>
        )}
        {shownSupport.map(line)}
      </tbody>
    </table>
  );
}

function SiegeRow({ h, sent, compact }: { h: SiegeHit; sent: number; compact: boolean }) {
  const unit = UNITS[h.unit];
  const building = BUILDINGS[h.building];
  const down = h.to === 0 && h.from > 0;
  const none = h.from === h.to;
  const count = `${formatInt(sent)} ${sent === 1 ? unit.name : SIEGE_PLURAL[h.unit] ?? pluralUnit(h.unit)}${h.random ? ' · random' : ''}`;
  return (
    <li className={`frp-sgr${compact ? ' is-compact' : ''}`}>
      <Pt unit={h.unit} size={compact ? 28 : 34} />
      <BuildingArt id={h.building} level={Math.max(1, h.from)} size={compact ? 30 : 36} />
      <span className="frp-sgt">
        <b>{building.name}</b>
        <small className={down ? 'kd' : undefined}>{down ? `knocked down · ${count}` : none ? `nothing to hit · ${count}` : count}</small>
      </span>
      <span className="frp-lvc">{h.from}</span>
      <span className="frp-arr"><Chev size={16} /></span>
      <span className={`frp-lvc${down ? ' zero' : none ? '' : ' dn'}`}>{h.to}</span>
    </li>
  );
}

function BattleBody({ report, b }: { report: ReportDto; b: BattleReportData }) {
  const sideName = useSideName();
  const [more, setMore] = useState<null | 'forces' | 'siege'>(null);
  const attName = sideName(b.attacker);
  const defName = sideName(b.defender);
  const { main, support } = forceRows(b);
  const total = main.length + (support.length > 0 ? 1 + support.length : 0);
  const dens = tableDensity(total);
  const supportLabel = report.side === 'support' ? 'Support · You' : 'Support · stationed troops';
  const carried = carriedLine(b);
  const lootTotal = RESOURCE_IDS.reduce((sum, r) => sum + b.loot[r], 0);
  const siege = b.siege ?? [];
  const siegeCompact = siege.length > 2;
  const siegeShown = siege.length > SIEGE_SHOWN ? siege.slice(0, SIEGE_SHOWN - 1) : siege;
  const share = attackShare(b.attackPower, b.defensePower);
  const morale = moraleLabel(b.morale);
  const storeLoot = RESOURCE_IDS.filter((r) => (b.lootFromTribeStore?.[r] ?? 0) > 0);
  return (
    <>
      <Sides left={['Attacker', b.attacker]} right={['Defender', b.defender]} winner={b.attackerWon ? 'left' : 'right'} />
      <div className="frp-grid">
        <div className="frp-forces">
          <ForcesTable rows={main} supportRows={support} attName={attName} defName={defName} supportLabel={supportLabel} density={dens.density} limit={dens.shown} />
          {total > dens.shown && (
            <button type="button" className="fv-lk" onClick={() => setMore('forces')} aria-haspopup="dialog">
              +{total - dens.shown} more <Chev />
            </button>
          )}
          {b.defenderUnits === null && <p className="frp-mut">Defender forces unknown.</p>}
        </div>
        <div className="frp-col">
          <Box title="Battle" aside={<Tag tone={b.attackerWon ? 'lost' : 'won'} big>{b.attackerWon ? 'Attacker won' : 'Defender held'}</Tag>}>
            <div className="frp-h2h">
              <div>
                <span className="frp-who">{attName}{b.attackerWon && <span className="frp-crown">Winner</span>}</span>
                <b>{formatInt(b.attackPower)}</b>
                <span className="frp-lbl">attack</span>
              </div>
              <div className="r">
                <span className="frp-who">{defName}{support.length > 0 ? ' + support' : ''}{!b.attackerWon && <span className="frp-crown">Winner</span>}</span>
                <b>{formatInt(b.defensePower)}</b>
                <span className="frp-lbl">defence</span>
              </div>
            </div>
            <div className="frp-bar" role="img" aria-label={`Attack ${formatInt(b.attackPower)} against defence ${formatInt(b.defensePower)}`}>
              <i className="a" style={{ width: `${share * 100}%` }} />
              <i className="d" />
            </div>
            <div className="frp-chips">
              <span className={`frp-ch ${b.luck >= 0 ? 'ok' : 'warn'}`}>Luck {formatSignedPercent(b.luck)}</span>
              {morale && <span className="frp-ch warn">{morale}</span>}
              {b.wallLevel !== null && (
                <span className="frp-ch">
                  <Icon name="shield" size={16} />
                  Wall {b.wallLevel} in battle
                </span>
              )}
              {b.renownGained !== undefined && b.renownGained > 0 && (
                <span className="frp-ch ok">
                  <Icon name="renown" size={16} />
                  Your Renown +{formatInt(b.renownGained)}
                </span>
              )}
            </div>
          </Box>
          {siege.length > 0 && (
            <Box title="Siege" aside={<span className="fv-mut">after the battle</span>}>
              <ul className="frp-sg">
                {siegeShown.map((h, i) => (
                  <SiegeRow key={`${h.unit}-${h.building}-${i}`} h={h} sent={normalizeUnits(b.attackerUnits)[h.unit]} compact={siegeCompact} />
                ))}
              </ul>
              {siege.length > siegeShown.length && (
                <button type="button" className="fv-lk" onClick={() => setMore('siege')} aria-haspopup="dialog">
                  +{siege.length - siegeShown.length} more <Chev />
                </button>
              )}
            </Box>
          )}
          <Box title="Loot" aside={lootTotal > 0 ? <span className="fv-mut">{attName === 'You' ? 'You' : attName} carried home</span> : undefined}>
            {lootTotal > 0 ? (
              <Tiles res={b.loot} dim />
            ) : (
              <p className="frp-mut">No loot.</p>
            )}
            {carried && (
              <div className="frp-cap">
                <span>
                  Carried <b>{formatInt(carried.carried)}</b> of <b>{formatInt(carried.capacity)}</b> {attName === 'You' ? 'your' : 'their'} survivors could take
                </span>
                <span className="frp-cbar" role="img" aria-label={`${Math.round(carried.ratio * 100)} percent of the carrying capacity`}>
                  <i style={{ width: `${carried.ratio * 100}%` }} />
                </span>
              </div>
            )}
            {storeLoot.length > 0 && (
              <p className="frp-mut">
                Tribe Store: {storeLoot.map((r) => `${formatInt(b.lootFromTribeStore?.[r] ?? 0)} ${RESOURCE_NAME[r].toLowerCase()}`).join(', ')}
              </p>
            )}
          </Box>
        </div>
      </div>
      {more === 'forces' && (
        <Dialog title="Forces" onClose={() => setMore(null)}>
          <ForcesTable rows={main} supportRows={support} attName={attName} defName={defName} supportLabel={supportLabel} density="normal" limit={total} />
        </Dialog>
      )}
      {more === 'siege' && (
        <Dialog title="Siege" onClose={() => setMore(null)}>
          <ul className="frp-sg">
            {siege.map((h, i) => (
              <li key={i} className="frp-sgl">{siegeHitText(h)}</li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  );
}

function CalledOffBody({ b }: { b: BattleReportData }) {
  return (
    <>
      <Sides left={['Attacker', b.attacker]} right={['Target', b.defender]} mid="→" />
      <Note tone="mute" icon="shield">Called off: target protected. No losses, no loot.</Note>
    </>
  );
}

// ---- Scouting --------------------------------------------------------------------------------------------------------

function Stat({ label, value, loss }: { label: string; value: number | null; loss?: boolean }) {
  return (
    <span className="frp-sct">
      {label} <b className={loss && value ? 'ls' : undefined}>{value === null ? '?' : value === 0 && loss ? '–' : `${loss ? '−' : ''}${formatInt(value)}`}</b>
    </span>
  );
}

function ScoutBody({ s, side }: { s: ScoutReportData; side: ReportDto['side'] }) {
  const sender = side === 'attack';
  const intel = s.intel;
  const troops = intel?.troops ? normalizeUnits(intel.troops) : null;
  const troopRows = troops ? UNIT_IDS.filter((u) => troops[u] > 0) : [];
  const levels = intel?.buildings ?? null;
  const buildingRows = levels ? BUILDING_IDS.filter((b) => typeof levels[b] === 'number' && levels[b] > 0) : [];
  const result = sender
    ? s.success
      ? 'Scouting succeeded.'
      : 'Scouting failed: all scouts caught.'
    : s.success
      ? `${formatInt(s.scoutsSent)} enemy scouts escaped.`
      : `${formatInt(s.scoutsSent)} enemy scouts caught.`;
  const approx = intel?.troopsApprox ? '≈ ' : '';
  return (
    <>
      <Sides left={['Scouts from', s.scout]} right={['Target', s.target]} mid="→" />
      <Note
        tone={s.success === sender ? 'ok' : 'bad'}
        icon={MISSION_ICON.scout}
        aside={
          <>
            <Stat label="Sent" value={s.scoutsSent} />
            <Stat label="Lost" value={s.scoutsLost} loss />
            <Stat label="Defenders" value={s.defenderScouts} />
            <Stat label="Defenders lost" value={s.defenderScoutsLost} loss />
          </>
        }
      >
        {result}
      </Note>
      {!intel && sender && <p className="frp-mut">The scouts brought nothing back.</p>}
      {intel?.resources && (
        <div className="frp-ig">
          <span className="fv-up">Resources</span>
          <Tiles res={intel.resources} />
        </div>
      )}
      {(troops || levels) && (
        <div className="frp-sc2">
          {troops && (
            <div className="frp-ig frp-sct2w">
              <span className="fv-up">Troops at home{intel?.troopsApprox ? ' · rough' : ''}</span>
              {troopRows.length === 0 ? (
                <p className="frp-mut">No troops.</p>
              ) : (
                <table className="frp-bt frp-sct2">
                  <thead>
                    <tr>
                      <th scope="col">Unit</th>
                      <th scope="col" className="n">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {troopRows.map((u) => (
                      <tr key={u}>
                        <th scope="row">
                          <Pt unit={u} />
                          {UNITS[u].name}
                        </th>
                        <td><b>{approx}{formatInt(troops[u])}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {levels && (
            <div className="frp-ig frp-sc2b">
              <span className="fv-up">Buildings</span>
              {buildingRows.length === 0 ? (
                <p className="frp-mut">No buildings.</p>
              ) : (
                <div className="frp-gc3">
                  {buildingRows.map((b) => (
                    <div key={b} className="frp-gc">
                      <BuildingArt id={b} level={1} size={28} />
                      {BUILDINGS[b].name}
                      <b>{levels[b]}</b>
                    </div>
                  ))}
                  {typeof intel?.wallLevel === 'number' && (
                    <div className="frp-gc fx">
                      Wall <b>{intel.wallLevel}</b>
                      {typeof intel.drillyardLevel === 'number' && (
                        <>
                          <span className="frp-sep" />
                          Drillyard <b>{intel.drillyardLevel}</b>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {typeof intel?.keen === 'number' && intel.keen < 5 && <p className="frp-mut">Keen {intel.keen}: limited view.</p>}
    </>
  );
}

// ---- Support, shipment, village --------------------------------------------------------------------------------------

function UnitsTable({ units }: { units: Units }) {
  const u = normalizeUnits(units);
  const rows = UNIT_IDS.filter((id) => u[id] > 0);
  if (rows.length === 0) return <p className="frp-mut">None.</p>;
  return (
    <table className="frp-bt frp-sct2">
      <thead>
        <tr>
          <th scope="col">Unit</th>
          <th scope="col" className="n">Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((id) => (
          <tr key={id}>
            <th scope="row">
              <Pt unit={id} />
              {UNITS[id].name}
            </th>
            <td><b>{formatInt(u[id])}</b></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SupportBody({ s }: { s: SupportReportData }) {
  const host = s.host.ownerName ?? s.host.name;
  const reason = s.reason === 'relation_changed' ? ` ${host} left your tribe or pact.` : '';
  return (
    <>
      <Sides left={['Support from', s.home]} right={['Sent to', s.host]} mid="→" />
      <Note tone="mute" icon={MISSION_ICON.support}>Support turned back.{reason}</Note>
      <div className="frp-ig frp-sct2w">
        <span className="fv-up">Troops</span>
        <UnitsTable units={s.units} />
      </div>
    </>
  );
}

function ShipmentBody({ s }: { s: ShipmentReportData }) {
  const lostTotal = RESOURCE_IDS.reduce((sum, r) => sum + s.lost[r], 0);
  return (
    <>
      <Sides left={['Sent from', s.from]} right={['Delivered to', s.to]} mid="→" />
      <Note tone={lostTotal > 0 ? 'bad' : 'ok'} icon={MISSION_ICON.shipment}>
        {s.role === 'sent' ? 'Delivered.' : 'Received.'}
        {lostTotal > 0 && ' Storehouse full: part lost.'}
      </Note>
      <div className="frp-ig">
        <span className="fv-up">Sent</span>
        <Tiles res={s.resources} dim />
      </div>
      <div className="frp-ig">
        <span className="fv-up">Stored</span>
        <Tiles res={s.stored} dim />
      </div>
      {lostTotal > 0 && (
        <div className="frp-ig">
          <span className="fv-up">Lost (storehouse full)</span>
          <Tiles res={s.lost} dim />
        </div>
      )}
    </>
  );
}

function VillageBody({ d }: { d: VillageReportData }) {
  const { now } = useGame();
  const text = villageReportText(d, now);
  const good = d.kind === 'struck' || d.kind === 'taken' || d.kind === 'founded' || d.kind === 'relit';
  return (
    <>
      <Sides left={[d.kind === 'found_failed' ? 'Free land' : 'Village', d.village]} />
      <Note tone={good ? 'ok' : 'bad'} icon="chieftain">
        {text.lines.map((line, i) => (
          <span key={i} className="frp-ln">
            {line}
          </span>
        ))}
      </Note>
      {d.units && unitListText(d.units) !== '' && (
        <div className="frp-ig frp-sct2w">
          <span className="fv-up">Troops</span>
          <UnitsTable units={d.units} />
        </div>
      )}
      {d.overflow && unitListText(d.overflow) !== '' && (
        <div className="frp-ig frp-sct2w">
          <span className="fv-up">Sent home</span>
          <UnitsTable units={d.overflow} />
        </div>
      )}
    </>
  );
}

function Body({ report }: { report: ReportDto }) {
  if (report.type === 'village' && report.village) return <VillageBody d={report.village} />;
  if (report.type === 'shipment' && report.shipment) return <ShipmentBody s={report.shipment} />;
  if (report.type === 'scout' && report.scout) return <ScoutBody s={report.scout} side={report.side} />;
  if (report.type === 'support' && report.support) return <SupportBody s={report.support} />;
  if (report.type === 'battle' && report.battle) {
    return report.battle.outcome === 'called_off' ? <CalledOffBody b={report.battle} /> : <BattleBody report={report} b={report.battle} />;
  }
  return <p className="frp-mut">No details.</p>;
}

// ---- The detail panel ------------------------------------------------------------------------------------------------

function ContextLine({ report }: { report: ReportDto }) {
  const { now } = useGame();
  const extra = report.type === 'battle' && report.side === 'support' ? ' · your support fought here' : report.type === 'battle' && report.side === 'defense' ? ' · your village was attacked' : '';
  return (
    <span>
      {whenText(report.createdAt, now)}
      {extra}
    </span>
  );
}

function Detail({ report, position }: { report: ReportDto; position: string }) {
  const { openSimulator } = useGame();
  const draft = draftFromReport(report);
  const out = rowOutcome(report);
  const line = reportLine(report.title);
  return (
    <section className="fv-pn frp-detail" aria-labelledby="frp-title">
      <div className="fv-ph">
        <h2>Report</h2>
        <span className="fv-sp" />
        <span className="fv-mut">{position}</span>
      </div>
      <div className="frp-rd">
        <div className="frp-rdh">
          <Token r={report} size={44} />
          <div className="frp-rdt">
            <h2 id="frp-title">
              {line.text}
              {line.coords && <small> ({line.coords})</small>}
            </h2>
            <div className="frp-rdm">
              <Tag tone={out.tone}>{out.label}</Tag>
              <ContextLine report={report} />
            </div>
          </div>
          <span className="fv-sp" />
          <button type="button" className="fv-btn sm frp-share" disabled title="Sharing a report comes later">
            Share
            <span className="frp-soon">soon</span>
          </button>
          {draft && (
            <button type="button" className="fv-btn fv-btn-g" onClick={() => openSimulator(draft)}>
              <Icon name="army" size={18} />
              Simulate
            </button>
          )}
        </div>
        <Body report={report} />
      </div>
    </section>
  );
}

// ---- The list --------------------------------------------------------------------------------------------------------

function hhmm(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "Today 11:02", "Yesterday 23:10", "5 Nov 23:10". */
function whenText(ts: number, now: number): string {
  const d = new Date(ts);
  if (d.toDateString() === new Date(now).toDateString()) return `Today ${hhmm(d)}`;
  if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return `Yesterday ${hhmm(d)}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hhmm(d)}`;
}

function rowTime(ts: number, now: number): string {
  const d = new Date(ts);
  const time = hhmm(d);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  const yesterday = d.toDateString() === new Date(now - 86_400_000).toDateString();
  return sameDay || yesterday ? time : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function ListPanel({
  list,
  filter,
  setFilter,
  counts,
  page,
  setPage,
  selected,
  onSelect,
  now,
  error,
  retry,
}: {
  list: ReportSummaryDto[] | null;
  filter: ReportFilter;
  setFilter: (f: ReportFilter) => void;
  counts: ReturnType<typeof filterCounts>;
  page: number;
  setPage: (p: number) => void;
  selected: number | null;
  onSelect: (id: number) => void;
  now: number;
  error: string | null;
  retry: () => void;
}) {
  const filtered = useMemo(() => filterReports(list ?? [], filter), [list, filter]);
  const pg = paging(filtered.length, page);
  const groups = groupByDay(pageSlice(filtered, pg.page), now);
  return (
    <section className="fv-pn frp-list" aria-label="All reports">
      <div className="frp-chs" role="group" aria-label="Report type">
        {REPORT_FILTERS.map((f) => (
          <button key={f.id} type="button" className={`frp-chip${filter === f.id ? ' on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            {counts[f.id].unread > 0 && <i aria-label={`${counts[f.id].unread} unread`}>{counts[f.id].unread}</i>}
          </button>
        ))}
      </div>
      <div className="frp-rows">
        {error && (
          <p className="form-error frp-pad" role="alert">
            {error}{' '}
            <button type="button" className="fv-lk" onClick={retry}>
              Retry
            </button>
          </p>
        )}
        {list === null && !error && <p className="fv-empty frp-pad">Loading…</p>}
        {list !== null && filtered.length === 0 && <p className="fv-empty frp-pad">{list.length === 0 ? 'No reports yet.' : 'No reports of this kind.'}</p>}
        {groups.map(({ group, items }) => (
          <div key={group} role="group" aria-label={DAY_GROUP_LABEL[group]}>
            <div className="frp-grp fv-up">{DAY_GROUP_LABEL[group]}</div>
            {items.map((r) => {
              const line = reportLine(r.title);
              const out = rowOutcome(r);
              const sel = selected === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`frp-rr${sel ? ' sel' : ''}${!r.read && !sel ? ' unr' : ''}`}
                  onClick={() => onSelect(r.id)}
                  aria-current={sel ? 'true' : undefined}
                  title={r.title}
                >
                  <Token r={r} size={30} />
                  <span className="frp-rtx">
                    {!r.read && <span className="frp-udot" role="img" aria-label="Unread" />}
                    {line.text}
                  </span>
                  <Tag tone={out.tone}>{out.label}</Tag>
                  <span className="frp-rtm">{rowTime(r.createdAt, now)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="frp-pgr">
        <span className="fv-mut">{pg.total === 0 ? '0 reports' : `${pg.from}–${pg.to} of ${pg.total}`}</span>
        <span className="fv-sp" />
        <button type="button" className="fv-pg" aria-label="Newer reports" disabled={pg.page <= 0} onClick={() => setPage(pg.page - 1)}>
          <Chev flip size={16} />
        </button>
        <button type="button" className="fv-pg" aria-label="Older reports" disabled={pg.page >= pg.pages - 1} onClick={() => setPage(pg.page + 1)}>
          <Chev size={16} />
        </button>
      </div>
    </section>
  );
}

// ---- The page --------------------------------------------------------------------------------------------------------

export function FrameReports() {
  const { unreadReports, now, refresh } = useGame();
  const [list, setList] = useState<ReportSummaryDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const res = await api.reports();
      setList(res.reports);
      setListError(null);
    } catch (e) {
      setListError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void loadList();
  }, [loadList, unreadReports]);
  useLiveTopic('reports', () => void loadList());

  const filtered = useMemo(() => filterReports(list ?? [], filter), [list, filter]);
  const counts = useMemo(() => filterCounts(list ?? []), [list]);

  // Open the newest report of the chosen kind when nothing (or something no longer listed) is open.
  useEffect(() => {
    if (list === null) return;
    if (selected !== null && filtered.some((r) => r.id === selected)) return;
    setSelected(filtered[0]?.id ?? null);
    setPage(0);
  }, [list, filtered, selected]);

  useEffect(() => {
    if (selected === null) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetailError(null);
    api
      .report(selected)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setList((cur) => cur?.map((x) => (x.id === r.id ? { ...x, read: true } : x)) ?? cur);
        void refresh();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setReport(null);
        setDetailError(e instanceof ApiRequestError && e.code === 'not_found' ? 'This report no longer exists.' : errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, refresh]);

  const idx = filtered.findIndex((r) => r.id === selected);
  const position = idx >= 0 ? `${idx + 1} of ${filtered.length}` : '';
  const shown = report && report.id === selected ? report : null;
  const onFilter = (f: ReportFilter) => {
    setFilter(f);
    setPage(0);
  };
  return (
    <div className="frp">
      <ListPanel
        list={list}
        filter={filter}
        setFilter={onFilter}
        counts={counts}
        page={page}
        setPage={setPage}
        selected={selected}
        onSelect={setSelected}
        now={now}
        error={listError}
        retry={() => void loadList()}
      />
      {shown ? (
        <Detail report={shown} position={position} />
      ) : (
        <section className="fv-pn frp-detail" aria-label="Report">
          <div className="fv-ph">
            <h2>Report</h2>
          </div>
          <div className="frp-rd">
            {detailError ? <p className="form-error" role="alert">{detailError}</p> : <p className="fv-empty">{loading || list === null || list.length > 0 ? 'Loading…' : 'No reports yet. Battles, scouting and shipments will show here.'}</p>}
          </div>
        </section>
      )}
    </div>
  );
}
