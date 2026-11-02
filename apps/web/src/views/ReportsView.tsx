import { useCallback, useEffect, useState } from 'react';
import { RESOURCE_IDS, UNITS, UNIT_IDS } from '@tribewars/engine';
import type { BattleReportData, ReportDto, ReportSummaryDto, VillageRefDto } from '@tribewars/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { formatAgo, formatClock, formatCoords, formatInt, formatSignedPercent } from '../format.ts';
import { useGame } from '../game.ts';
import { RESOURCE_ICON, RESOURCE_NAME, UNIT_ICON } from '../icons.ts';

function VillageCell({ role, v, won }: { role: string; v: VillageRefDto; won: boolean }) {
  const { showOnMap } = useGame();
  return (
    <div className={`side ${won ? 'is-winner' : ''}`}>
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

function BattleDetail({ b, ownerWon }: { b: BattleReportData; ownerWon: boolean }) {
  const defenderKnown = b.defenderUnits !== null;
  const rows = UNIT_IDS.filter((u) => b.attackerUnits[u] > 0 || (b.defenderUnits?.[u] ?? 0) > 0);
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
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">No units were involved.</td>
                </tr>
              ) : (
                rows.map((u) => (
                  <tr key={u}>
                    <th scope="row">
                      <span aria-hidden="true">{UNIT_ICON[u]}</span> {UNITS[u].name}
                    </th>
                    <td className="num"><Num value={b.attackerUnits[u]} /></td>
                    <td className="num"><Num value={b.attackerLosses[u]} loss /></td>
                    <td className="num"><Num value={b.defenderUnits ? b.defenderUnits[u] : null} /></td>
                    <td className="num"><Num value={b.defenderLosses ? b.defenderLosses[u] : null} loss /></td>
                  </tr>
                ))
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
                <span aria-hidden="true">{RESOURCE_ICON[r]}</span> <span className="visually-hidden">{RESOURCE_NAME[r]} </span>
                <strong>{formatInt(b.loot[r])}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing was taken.</p>
        )}
      </section>
    </>
  );
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
          <span className={`tag ${report.won ? 'tag-ok' : 'tag-bad'}`}>{report.won ? 'Won' : 'Lost'}</span>
          <span className="muted">{report.side === 'attack' ? 'You attacked' : 'You were attacked'} · {formatClock(report.createdAt, now)}</span>
        </div>
      </header>
      <BattleDetail b={report.battle} ownerWon={report.won} />
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
            Battles <span className="muted">{unreadReports > 0 ? `${unreadReports} unread` : ''}</span>
          </h2>
          {listError && (
            <p className="form-error" role="alert">
              {listError} <button className="link" onClick={() => void loadList()}>Retry</button>
            </p>
          )}
          {list === null && !listError && <p className="muted">Loading…</p>}
          {list !== null && list.length === 0 && (
            <p className="muted">No battles yet. Send raiders to an abandoned village from the Map and the report will show up here.</p>
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
                    <span className="report-icon" aria-hidden="true">{r.side === 'attack' ? '⚔️' : '🛡️'}</span>
                    <span className="report-main">
                      <span className="report-title">
                        {!r.read && <span className="dot" aria-label="Unread" />}
                        {r.title}
                      </span>
                      <span className="muted report-sub">{formatAgo(r.createdAt, now)}</span>
                    </span>
                    <span className={`tag ${r.won ? 'tag-ok' : 'tag-bad'}`}>{r.won ? 'Won' : 'Lost'}</span>
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
          {!showDetail && <p className="muted report-hint">Select a report to see the battle.</p>}
        </div>
      </div>
    </div>
  );
}
