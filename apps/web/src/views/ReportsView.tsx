import { useCallback, useEffect, useState } from 'react';
import { BUILDINGS, BUILDING_IDS, RESOURCE_IDS, UNITS, UNIT_IDS, normalizeUnits } from '@clanfire/engine';
import type { BattleReportData, ReportDto, ReportSummaryDto, ScoutReportData, ShipmentReportData, SupportReportData, VillageRefDto, VillageReportData } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { useLiveTopic } from '../hooks/useLive.tsx';
import { formatAgo, formatClock, formatCoords, formatInt, formatSignedPercent } from '../format.ts';
import { useGame } from '../game.ts';
import { BuildingArt } from '../art/BuildingArt.tsx';
import { ChieftainAvatar } from '../art/Chieftain.tsx';
import { Icon } from '../art/Icon.tsx';
import type { IconName } from '../art/Icon.tsx';
import { MISSION_ICON, RESOURCE_ICON, RESOURCE_NAME, UNIT_ICON } from '../icons.ts';
import { unitListText } from '../rules.ts';
import { villageReportText } from '../villages.ts';

function VillageCell({ role, v, won }: { role: string; v: VillageRefDto; won: boolean }) {
  const { showOnMap, player } = useGame();
  // Reports carry no chieftain for the other side (no API change yet): only your own portrait can be shown.
  const mine = v.ownerName !== null && v.ownerName === player.username;
  return (
    <div className={`side${won ? ' is-winner' : ''}${mine ? ' has-avatar' : ''}`}>
      {mine && <ChieftainAvatar id={player.chieftain} size={40} className="side-avatar" />}
      <div className="side-role">{role}{won && <span className="tag tag-ok">Winner</span>}</div>
      <div className="side-name">{v.ownerName ?? 'Abandoned village'}</div>
      <button className="link" onClick={() => showOnMap(v.x, v.y)}>
        {v.name} ({formatCoords(v.x, v.y)})
      </button>
    </div>
  );
}

function Num({ value, loss }: { value: number | null; loss?: boolean }) {
  if (value === null) return <span className="muted">?</span>;
  if (value === 0) return <span className="muted">–</span>;
  return <span className={loss ? 'loss' : undefined}>{loss ? '−' : ''}{formatInt(value)}</span>;
}

const TYPE_NAME: Record<ReportSummaryDto['type'], string> = { battle: 'Battle', scout: 'Scout', support: 'Support', shipment: 'Shipment', village: 'Village' };
const SIDE_NAME: Record<ReportSummaryDto['side'], string> = {
  attack: 'You attacked',
  defense: 'You were attacked',
  support: 'Your troops there were attacked',
  shipment: 'Resources',
};
// Village reports use side 'attack' for the claimant or founder and 'defense' for the owner; the sub-line names the event instead.
const VILLAGE_SIDE_NAME: Record<ReportSummaryDto['side'], string> = { attack: 'Your claim', defense: 'Your village', support: 'Your village', shipment: 'Your village' };

function reportIcon(r: ReportSummaryDto): IconName {
  if (r.type === 'village') return 'chieftain';
  if (r.type === 'shipment') return MISSION_ICON.shipment;
  if (r.type === 'scout') return MISSION_ICON.scout;
  if (r.type === 'support' || r.side === 'support') return MISSION_ICON.support;
  return r.side === 'attack' ? MISSION_ICON.attack : 'shield';
}

/** What happened, from the report owner's point of view. */
function OutcomeTag({ report }: { report: ReportSummaryDto }) {
  if (report.type === 'village') return <span className={`tag ${report.won ? 'tag-ok' : 'tag-bad'}`}>{report.won ? 'Good news' : 'Setback'}</span>;
  if (report.type === 'shipment') return <span className="tag tag-ok">Delivered</span>;
  if (report.type === 'support') return <span className="tag tag-muted">Turned back</span>;
  if (report.side === 'support' && report.type === 'battle' && report.outcome !== 'called_off') {
    return <span className="tag tag-info">Troops attacked</span>;
  }
  if (report.type === 'scout') {
    // The sender wins by getting through; the defender wins by catching the scouts.
    const label = report.side === 'attack' ? (report.won ? 'Success' : 'Failed') : report.won ? 'Caught' : 'Escaped';
    return <span className={`tag ${report.won ? 'tag-ok' : 'tag-bad'}`}>{label}</span>;
  }
  if (report.outcome === 'called_off') return <span className="tag tag-muted">Called off</span>;
  return <span className={`tag ${report.won ? 'tag-ok' : 'tag-bad'}`}>{report.won ? 'Won' : 'Lost'}</span>;
}

function metaText(report: ReportSummaryDto): string {
  if (report.type === 'village') return report.side === 'attack' ? 'Your claim or new village' : 'Your village';
  if (report.type === 'scout') return report.side === 'attack' ? 'You scouted' : 'Enemy scouts were spotted';
  if (report.type === 'shipment') return report.side === 'shipment' ? 'Resources arrived' : '';
  if (report.type === 'support') return 'Your support turned back';
  if (report.side === 'support') return 'Your troops stationed there were attacked';
  return report.side === 'attack' ? 'You attacked' : 'You were attacked';
}

function CalledOffDetail({ b, side }: { b: BattleReportData; side: ReportDto['side'] }) {
  return (
    <>
      <div className="sides">
        <VillageCell role="Attacker" v={b.attacker} won={false} />
        <span className="vs" aria-hidden="true">→</span>
        <VillageCell role="Target" v={b.defender} won={false} />
      </div>
      <p className="notice notice-block called-off" role="note">
        <Icon name="shield" size={20} className="inline-icon" />{' '}
        <span>
          Attack called off. The target is now protected by a pact or tribe, so {side === 'attack' ? 'your troops turned back' : 'the attackers turned back'}.
          No battle took place: no losses, no loot.
        </span>
      </p>
    </>
  );
}

function BattleDetail({ b, ownerWon }: { b: BattleReportData; ownerWon: boolean }) {
  const defenderKnown = b.defenderUnits !== null;
  const att = normalizeUnits(b.attackerUnits);
  const attLost = normalizeUnits(b.attackerLosses);
  const def = b.defenderUnits ? normalizeUnits(b.defenderUnits) : null;
  const defLost = b.defenderLosses ? normalizeUnits(b.defenderLosses) : null;
  const sup = b.supportUnits ? normalizeUnits(b.supportUnits) : null;
  const supLost = b.supportLosses ? normalizeUnits(b.supportLosses) : null;
  const rows = UNIT_IDS.filter((u) => att[u] > 0 || (def?.[u] ?? 0) > 0);
  const supportRows = UNIT_IDS.filter((u) => (sup?.[u] ?? 0) > 0);
  const lootTotal = RESOURCE_IDS.reduce((sum, r) => sum + b.loot[r], 0);
  const power = Math.max(1, b.attackPower, b.defensePower);
  return (
    <>
      <div className="sides">
        <VillageCell role="Attacker" v={b.attacker} won={b.attackerWon} />
        <span className="vs" aria-hidden="true">vs</span>
        <VillageCell role="Defender" v={b.defender} won={!b.attackerWon} />
      </div>

      <section className="subsection" aria-label="Forces">
        <div className="table-wrap">
          <table className="table battle">
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>Unit</th>
                <th scope="colgroup" colSpan={2} className="group">Attacker</th>
                <th scope="colgroup" colSpan={2} className="group">Defender</th>
              </tr>
              <tr>
                <th scope="col" className="num">Sent</th>
                <th scope="col" className="num">Lost</th>
                <th scope="col" className="num">Had</th>
                <th scope="col" className="num">Lost</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && supportRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">No units were involved.</td>
                </tr>
              ) : (
                rows.map((u) => (
                  <tr key={u}>
                    <th scope="row">
                      <Icon name={UNIT_ICON[u]} size={20} className="inline-icon" /> {UNITS[u].name}
                    </th>
                    <td className="num"><Num value={att[u]} /></td>
                    <td className="num"><Num value={attLost[u]} loss /></td>
                    <td className="num"><Num value={def ? def[u] : null} /></td>
                    <td className="num"><Num value={defLost ? defLost[u] : null} loss /></td>
                  </tr>
                ))
              )}
              {supportRows.length > 0 && (
                <>
                  <tr className="group-row">
                    <th scope="rowgroup" colSpan={5}>
                      <Icon name={MISSION_ICON.support} size={20} className="inline-icon" /> Support troops (defending)
                    </th>
                  </tr>
                  {supportRows.map((u) => (
                    <tr key={`support-${u}`} className="support-row">
                      <th scope="row">
                        <Icon name={UNIT_ICON[u]} size={20} className="inline-icon" /> {UNITS[u].name}
                      </th>
                      <td className="num"><span className="muted">–</span></td>
                      <td className="num"><span className="muted">–</span></td>
                      <td className="num"><Num value={sup ? sup[u] : null} /></td>
                      <td className="num"><Num value={supLost ? supLost[u] : null} loss /></td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
        {!defenderKnown && <p className="muted note">The defender's forces are unknown because none of the attackers came back.</p>}
      </section>

      <section className="subsection" aria-label="Battle numbers">
        <div className="power">
          <div className="power-row">
            <span>Attack power</span>
            <strong>{formatInt(b.attackPower)}</strong>
          </div>
          <div className="power-bar" aria-hidden="true">
            <span className="power-att" style={{ width: `${(b.attackPower / power) * 100}%` }} />
          </div>
          <div className="power-row">
            <span>Defense power</span>
            <strong>{formatInt(b.defensePower)}</strong>
          </div>
          <div className="power-bar" aria-hidden="true">
            <span className="power-def" style={{ width: `${(b.defensePower / power) * 100}%` }} />
          </div>
        </div>
        <dl className="facts">
          <div>
            <dt>Luck (attacker)</dt>
            <dd className={b.luck >= 0 ? 'gain' : 'loss'}>{formatSignedPercent(b.luck)}</dd>
          </div>
          <div>
            <dt>Wall level</dt>
            <dd>{b.wallLevel === null ? <span className="muted">Unknown</span> : b.wallLevel}</dd>
          </div>
          <div>
            <dt>Result</dt>
            <dd>{b.attackerWon ? 'Attacker won' : 'Defender held'}{ownerWon ? ' (your win)' : ''}</dd>
          </div>
        </dl>
      </section>

      <section className="subsection" aria-label="Loot">
        <h3 className="subtitle">Loot</h3>
        {lootTotal > 0 ? (
          <ul className="loot">
            {RESOURCE_IDS.filter((r) => b.loot[r] > 0).map((r) => (
              <li key={r}>
                <Icon name={RESOURCE_ICON[r]} size={18} className="inline-icon" /> <span className="visually-hidden">{RESOURCE_NAME[r]} </span>
                <strong>{formatInt(b.loot[r])}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing was taken.</p>
        )}
        {b.lootShare !== undefined && (
          <p className="muted">
            This village was raided recently, so your troops could only carry off {b.lootShare}% of the usual load. Wait a day or try another target.
          </p>
        )}
        {b.renownGained !== undefined && b.renownGained > 0 && (
          <p className="report-renown">
            <strong>Renown +{formatInt(b.renownGained)}</strong>
          </p>
        )}
      </section>
    </>
  );
}

/** Scouting: result, scout numbers and, for a successful sender, what the Pathfinders saw. */
function ScoutDetail({ s, side }: { s: ScoutReportData; side: ReportDto['side'] }) {
  const sender = side === 'attack';
  const intel = s.intel;
  const troops = intel?.troops ? normalizeUnits(intel.troops) : null;
  const troopRows = troops ? UNIT_IDS.filter((u) => troops[u] > 0) : [];
  const levels = intel?.buildings ?? null;
  const buildingRows = levels ? BUILDING_IDS.filter((b) => typeof levels[b] === 'number' && levels[b] > 0) : [];

  let result: string;
  if (sender) {
    result = s.success
      ? 'Scouting succeeded. Your Pathfinders got a look inside and made it out.'
      : 'Scouting failed. The defending Pathfinders caught every one of your scouts, so you learned nothing.';
  } else {
    result = s.success
      ? `${formatInt(s.scoutsSent)} enemy Pathfinders were spotted. They outnumbered your Pathfinders and escaped.`
      : `${formatInt(s.scoutsSent)} enemy Pathfinders were spotted and caught by your Pathfinders.`;
  }

  return (
    <>
      <div className="sides">
        <VillageCell role="Scouts from" v={s.scout} won={false} />
        <span className="vs" aria-hidden="true">→</span>
        <VillageCell role="Target" v={s.target} won={false} />
      </div>
      <p className={`notice called-off ${s.success === sender ? 'notice-ok' : 'notice-block'}`} role="note">
        <Icon name={MISSION_ICON.scout} size={20} className="inline-icon" /> <span>{result}</span>
      </p>

      <section className="subsection" aria-label="Scouts">
        <dl className="facts">
          <div>
            <dt>Scouts sent</dt>
            <dd>{formatInt(s.scoutsSent)}</dd>
          </div>
          <div>
            <dt>Scouts lost</dt>
            <dd className={s.scoutsLost > 0 ? 'loss' : undefined}>{s.scoutsLost > 0 ? `−${formatInt(s.scoutsLost)}` : '–'}</dd>
          </div>
          <div>
            <dt>Defending scouts</dt>
            <dd>{s.defenderScouts === null ? <span className="muted">Unknown</span> : formatInt(s.defenderScouts)}</dd>
          </div>
          <div>
            <dt>Defenders lost</dt>
            <dd className={s.defenderScoutsLost > 0 ? 'loss' : undefined}>
              {s.defenderScoutsLost > 0 ? `−${formatInt(s.defenderScoutsLost)}` : '–'}
            </dd>
          </div>
        </dl>
      </section>

      {intel && (
        <section className="subsection" aria-label="What the scouts saw">
          <h3 className="subtitle">What the scouts saw</h3>
          {intel.resources && (
            <>
              <h4 className="subtitle-small">Resources</h4>
              <ul className="loot">
                {RESOURCE_IDS.map((r) => (
                  <li key={r}>
                    <Icon name={RESOURCE_ICON[r]} size={18} className="inline-icon" /> <span className="visually-hidden">{RESOURCE_NAME[r]} </span>
                    <strong>{formatInt(intel.resources[r] ?? 0)}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
          {troops && (
            <>
              <h4 className="subtitle-small">Troops in the village{intel.troopsApprox ? ' (rough numbers)' : ''}</h4>
              {troopRows.length === 0 ? (
                <p className="muted">No troops at home.</p>
              ) : (
                <ul className="loot">
                  {troopRows.map((u) => (
                    <li key={u}>
                      <Icon name={UNIT_ICON[u]} size={20} className="inline-icon" /> {UNITS[u].name} <strong>{intel.troopsApprox ? '≈ ' : ''}{formatInt(troops[u])}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {levels && (
            <>
              <h4 className="subtitle-small">Buildings</h4>
              {buildingRows.length === 0 ? (
                <p className="muted">No buildings.</p>
              ) : (
                <dl className="stats">
                  {buildingRows.map((b) => (
                    <div key={b}>
                      <dt>
                        <BuildingArt id={b} level={1} size={24} className="inline-icon" /> {BUILDINGS[b].name}
                      </dt>
                      <dd>{levels[b]}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
          {typeof intel.wallLevel === 'number' && (
            <dl className="facts">
              <div>
                <dt>Wall level</dt>
                <dd>{intel.wallLevel}</dd>
              </div>
              {typeof intel.drillyardLevel === 'number' && (
                <div>
                  <dt>Drillyard level</dt>
                  <dd>{intel.drillyardLevel}</dd>
                </div>
              )}
            </dl>
          )}
          {typeof intel.keen === 'number' && intel.keen < 5 && (
            <p className="muted">Your Pathfinders' Keen rank ({intel.keen}) limits what they can see. Higher ranks reveal more.</p>
          )}
        </section>
      )}
    </>
  );
}

/** Support that turned back instead of staying. */
function SupportDetail({ s }: { s: SupportReportData }) {
  const units = normalizeUnits(s.units);
  const rows = UNIT_IDS.filter((u) => units[u] > 0);
  const host = s.host.ownerName ?? s.host.name;
  const reason = s.reason === 'relation_changed' ? `${host} is no longer in your tribe or an ally, so the support turned back.` : 'The support turned back.';
  return (
    <>
      <div className="sides">
        <VillageCell role="Support from" v={s.home} won={false} />
        <span className="vs" aria-hidden="true">→</span>
        <VillageCell role="Sent to" v={s.host} won={false} />
      </div>
      <p className="notice called-off" role="note">
        <Icon name={MISSION_ICON.support} size={20} className="inline-icon" /> <span>Support turned back. {reason}</span>
      </p>
      <section className="subsection" aria-label="Troops">
        <h3 className="subtitle">Troops</h3>
        {rows.length === 0 ? (
          <p className="muted">No troop details.</p>
        ) : (
          <ul className="loot">
            {rows.map((u) => (
              <li key={u}>
                <Icon name={UNIT_ICON[u]} size={20} className="inline-icon" /> {UNITS[u].name} <strong>{formatInt(units[u])}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** A shipment that arrived: what was sent, what fitted into the storehouse, what was lost. */
function ShipmentDetail({ s }: { s: ShipmentReportData }) {
  const lostTotal = RESOURCE_IDS.reduce((sum, r) => sum + s.lost[r], 0);
  const row = (label: string, res: ShipmentReportData['resources']) => (
    <>
      <h4 className="subtitle-small">{label}</h4>
      <ul className="loot">
        {RESOURCE_IDS.filter((r) => res[r] > 0).map((r) => (
          <li key={r}>
            <Icon name={RESOURCE_ICON[r]} size={18} className="inline-icon" /> <span className="visually-hidden">{RESOURCE_NAME[r]} </span>
            <strong>{formatInt(res[r])}</strong>
          </li>
        ))}
        {RESOURCE_IDS.every((r) => res[r] === 0) && <li className="muted">Nothing</li>}
      </ul>
    </>
  );
  return (
    <>
      <div className="sides">
        <VillageCell role="Sent from" v={s.from} won={false} />
        <span className="vs" aria-hidden="true">→</span>
        <VillageCell role="Delivered to" v={s.to} won={false} />
      </div>
      <p className={`notice called-off ${lostTotal > 0 ? 'notice-block' : 'notice-ok'}`} role="note">
        <Icon name={MISSION_ICON.shipment} size={20} className="inline-icon" />{' '}
        <span>
          {s.role === 'sent' ? 'Your shipment was delivered.' : 'You received a shipment.'}
          {lostTotal > 0 && ' The storehouse was full, so part of it was lost.'}
        </span>
      </p>
      <section className="subsection" aria-label="Cargo">
        {row('Sent', s.resources)}
        {row('Stored', s.stored)}
        {lostTotal > 0 && row('Lost (storehouse full)', s.lost)}
      </section>
    </>
  );
}

/** Strike, Hold, Found and Taken events (step 2): a few plain sentences, the village, and the troops that were involved. */
function VillageDetail({ d }: { d: VillageReportData }) {
  const { now } = useGame();
  const text = villageReportText(d, now);
  const good = d.kind === 'struck' || d.kind === 'taken' || d.kind === 'founded' || d.kind === 'relit';
  return (
    <>
      <div className="sides">
        <VillageCell role={d.kind === 'found_failed' ? 'Free land' : 'Village'} v={d.village} won={false} />
      </div>
      <p className={`notice called-off ${good ? 'notice-ok' : 'notice-block'}`} role="note">
        <Icon name="chieftain" size={20} className="inline-icon" />{' '}
        <span>
          {text.lines.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {line}
            </span>
          ))}
        </span>
      </p>
      {d.units && unitListText(d.units) !== '' && (
        <section className="subsection" aria-label="Troops">
          <h4 className="subtitle-small">Troops</h4>
          <p>{unitListText(d.units)}</p>
        </section>
      )}
      {d.overflow && unitListText(d.overflow) !== '' && (
        <section className="subsection" aria-label="Troops that did not fit">
          <h4 className="subtitle-small">Did not fit, went home</h4>
          <p>{unitListText(d.overflow)}</p>
        </section>
      )}
    </>
  );
}

function ReportBody({ report }: { report: ReportDto }) {
  if (report.type === 'village' && report.village) return <VillageDetail d={report.village} />;
  if (report.type === 'shipment' && report.shipment) return <ShipmentDetail s={report.shipment} />;
  if (report.type === 'scout' && report.scout) return <ScoutDetail s={report.scout} side={report.side} />;
  if (report.type === 'support' && report.support) return <SupportDetail s={report.support} />;
  if (report.type === 'battle' && report.battle) {
    return report.battle.outcome === 'called_off' ? (
      <CalledOffDetail b={report.battle} side={report.side} />
    ) : (
      <BattleDetail b={report.battle} ownerWon={report.won} />
    );
  }
  return <p className="muted">This report has no details.</p>;
}

function ReportDetail({ report, onBack }: { report: ReportDto; onBack: () => void }) {
  const { now } = useGame();
  return (
    <article className="card report-detail" aria-labelledby="report-title">
      <button className="btn btn-small back" onClick={onBack}>
        ← Reports
      </button>
      <header className="report-head">
        <h2 id="report-title" className="card-title">{report.title}</h2>
        <div className="report-meta">
          <OutcomeTag report={report} />
          <span className="muted">{metaText(report)} · {formatClock(report.createdAt, now)}</span>
        </div>
      </header>
      <ReportBody report={report} />
    </article>
  );
}

export function ReportsView() {
  const { unreadReports, now, refresh } = useGame();
  const [list, setList] = useState<ReportSummaryDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const res = await api.reports();
      setList(res.reports);
      setListError(null);
    } catch (e) {
      setListError(errorMessage(e));
    }
  }, []);

  // Load on open and whenever the unread count changes (a new report arrived).
  useEffect(() => {
    void loadList();
  }, [loadList, unreadReports]);
  useLiveTopic('reports', () => void loadList());

  useEffect(() => {
    if (selected === null) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
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
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, refresh]);

  const showDetail = selected !== null;
  return (
    <div className="page">
      <h1 className="page-title">Reports</h1>
      <div className={`reports${showDetail ? ' has-detail' : ''}`}>
        <section className="card report-list-card" aria-labelledby="rl-title">
          <h2 id="rl-title" className="card-title">
            All reports <span className="muted">{unreadReports > 0 ? `${unreadReports} unread` : ''}</span>
          </h2>
          {listError && (
            <p className="form-error" role="alert">
              {listError} <button className="link" onClick={() => void loadList()}>Retry</button>
            </p>
          )}
          {list === null && !listError && <p className="muted">Loading…</p>}
          {list !== null && list.length === 0 && (
            <p className="muted">No reports yet. Send raiders or Pathfinders to an abandoned village from the Map and the report will show up here.</p>
          )}
          {list !== null && list.length > 0 && (
            <ul className="report-list">
              {list.map((r) => (
                <li key={r.id}>
                  <button
                    className={`report-item${r.read ? '' : ' is-unread'}${selected === r.id ? ' is-selected' : ''}`}
                    onClick={() => setSelected(r.id)}
                    aria-current={selected === r.id ? 'true' : undefined}
                  >
                    <span className="report-icon" aria-hidden="true">
                      <Icon name={reportIcon(r)} size={26} />
                    </span>
                    <span className="report-main">
                      <span className="report-title">
                        {!r.read && <span className="dot" aria-label="Unread" />}
                        {r.title}
                      </span>
                      <span className="muted report-sub">
                        {TYPE_NAME[r.type]} · {(r.type === 'village' ? VILLAGE_SIDE_NAME : SIDE_NAME)[r.side]} · {formatAgo(r.createdAt, now)}
                      </span>
                    </span>
                    <OutcomeTag report={r} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="report-pane">
          {report && <ReportDetail report={report} onBack={() => setSelected(null)} />}
          {!report && showDetail && (
            <div className="card">
              <button className="btn btn-small back" onClick={() => setSelected(null)}>
                ← Reports
              </button>
              {loadingDetail ? <p className="muted">Loading report…</p> : <p className="form-error" role="alert">{detailError}</p>}
            </div>
          )}
          {!showDetail && <p className="muted report-hint">Select a report to read it.</p>}
        </div>
      </div>
    </div>
  );
}
