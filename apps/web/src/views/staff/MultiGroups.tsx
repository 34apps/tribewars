// Staff page "Shared connections": groups of accounts that share an IP or a browser (device) in the last 30 days, what happened between them,
// and a risk line in plain words. Staff SEE and JUDGE here; nothing bans by itself. Moderator and admin only (the server enforces it).

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { MULTI_RETENTION_MS } from '@clanfire/engine';
import type { MultiAttackDto, MultiFlowDto, MultiGroupDto, MultiGroupsResponse, MultiMemberDto, MultiPairDto } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { formatAgo } from '../../format.ts';
import { useGame } from '../../game.ts';

const RISK_LABEL = { high: 'High risk', medium: 'Worth a look', low: 'Low risk' } as const;
const RISK_TAG = { high: 'tag-bad', medium: 'tag-warn', low: 'tag-ok' } as const;
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const day = (t: number): string => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });

function flowText(f: MultiFlowDto): string {
  return `${f.count} shipment${f.count === 1 ? '' : 's'} (${num(f.resources)} resources, ${f.days} day${f.days === 1 ? '' : 's'})`;
}

function attackText(t: MultiAttackDto): string {
  return `${t.count} attack${t.count === 1 ? '' : 's'} (${t.noDefence} met no defence), loot ${num(t.loot)}, lost ${num(t.lostAttacker)} / ${num(t.lostDefender)} troops`;
}

/** The sentences for one pair; only the parts that happened. */
export function pairLines(p: MultiPairDto, name: (id: number) => string): string[] {
  const out: string[] = [];
  const a = name(p.a);
  const b = name(p.b);
  const dirs: Array<[number, string, string]> = [
    [0, a, b],
    [1, b, a],
  ];
  for (const [i, from, to] of dirs) {
    const ship = p.ship[i]!;
    if (ship.count > 0) out.push(`${from} sent ${to} ${flowText(ship)}`);
  }
  for (const [i, from, to] of dirs) if (p.support[i]! > 0) out.push(`${from} sent support to ${to} ${p.support[i]} time${p.support[i] === 1 ? '' : 's'}`);
  for (const [i, from, to] of dirs) {
    const t = p.attacks[i]!;
    if (t.count > 0) out.push(`${from} attacked ${to}: ${attackText(t)}`);
  }
  for (const [i, from, to] of dirs) if (p.conquests[i]! > 0) out.push(`${from} took ${p.conquests[i]} village${p.conquests[i] === 1 ? '' : 's'} from ${to}`);
  for (const [i, from, to] of dirs) if (p.strikes[i]! > 0) out.push(`${from} struck the hearth of ${to} ${p.strikes[i]} time${p.strikes[i] === 1 ? '' : 's'} (Chieftain)`);
  const refused = [p.shipBlocked > 0 && `shipments ${p.shipBlocked}`, p.supportBlocked > 0 && `support ${p.supportBlocked}`, p.attackBlocked > 0 && `attacks or scouts ${p.attackBlocked}`].filter(Boolean);
  if (refused.length > 0) out.push(`Attempts refused by the same-connection check: ${refused.join(', ')}`);
  if (p.alternating) out.push(`${a} and ${b} are never on together but follow each other within minutes (${p.alternating.handoffs} hand-overs)`);
  return out;
}

function MemberRow({ m, now, canBan, onProfile, onBanned }: { m: MultiMemberDto; now: number; canBan: boolean; onProfile: (id: number) => void; onBanned: () => void }) {
  const { toast } = useGame();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function ban(e: FormEvent) {
    e.preventDefault();
    if (reason.trim() === '' || busy) return;
    setBusy(true);
    try {
      await api.staffBan(m.id, { reason: reason.trim() });
      toast(`${m.username} is banned.`);
      setOpen(false);
      onBanned();
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="multi-member">
      <div className="multi-member-line">
        <button type="button" className="btn btn-small" onClick={() => onProfile(m.id)} aria-label={`Open the profile of ${m.username}`}>
          {m.username}
        </button>
        <span className={`tag ${m.householdShared ? 'tag-info' : 'tag-muted'}`}>{m.householdShared ? 'household declared' : 'no household'}</span>
        {m.bannedAt !== null && <span className="tag tag-bad">banned</span>}
        <span className="muted">
          {m.villages} village{m.villages === 1 ? '' : 's'} · {num(m.points)} points · {m.tribeTag ? `tribe [${m.tribeTag}]` : 'no tribe'} · seen {formatAgo(m.lastActive, now)}
        </span>
        {canBan && m.bannedAt === null && !open && (
          <button type="button" className="btn btn-small btn-danger-outline" onClick={() => setOpen(true)}>
            Ban…
          </button>
        )}
      </div>
      {open && (
        <form className="multi-ban" onSubmit={(e) => void ban(e)}>
          <label className="visually-hidden" htmlFor={`multi-ban-${m.id}`}>
            Reason for banning {m.username}
          </label>
          <input id={`multi-ban-${m.id}`} className="input" value={reason} maxLength={300} placeholder="Reason (kept in the audit log)" autoComplete="off" onChange={(e) => setReason(e.target.value)} />
          <button type="submit" className="btn btn-small btn-danger-outline" disabled={busy || reason.trim() === ''}>
            {busy ? 'Working…' : `Ban ${m.username}`}
          </button>
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

export function GroupCard({ g, now, canBan, onProfile, onChanged, onReview }: { g: MultiGroupDto; now: number; canBan: boolean; onProfile: (id: number) => void; onChanged: () => void; onReview: (key: string) => void }) {
  const names = new Map(g.members.map((m) => [m.id, m.username]));
  const name = (id: number): string => names.get(id) ?? `#${id}`;
  const lines = g.pairs.flatMap((p) => pairLines(p, name));
  return (
    <article className="card multi-group" aria-label={`Group: ${g.members.map((m) => m.username).join(', ')}`}>
      <header className="multi-head">
        <span className={`tag ${RISK_TAG[g.risk.level]}`}>{RISK_LABEL[g.risk.level]}</span>
        {g.kind === 'behaviour' && <span className="tag tag-muted">caught by behaviour, no shared connection</span>}
        {g.reviewed && <span className="tag tag-muted">reviewed</span>}
      </header>
      <p className="multi-risk">{g.risk.text}</p>
      <ul className="multi-members">
        {g.members.map((m) => (
          <MemberRow key={m.id} m={m} now={now} canBan={canBan} onProfile={onProfile} onBanned={onChanged} />
        ))}
      </ul>
      {g.links.length > 0 && (
        <>
          <h3 className="card-title">Shared connections and devices</h3>
          <ul className="staff-audit">
            {g.links.map((l) => (
              <li key={`${l.kind}:${l.label}`}>
                <strong>{l.label}</strong>{' '}
                <span className="muted">
                  {l.seen.map((r) => `${name(r.playerId)} ${day(r.firstSeen)} to ${day(r.lastSeen)}`).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="card-title">Between these accounts (last {Math.round(MULTI_RETENTION_MS / 86_400_000)} days)</h3>
      {lines.length === 0 && g.relays.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="staff-audit">
          {lines.map((t) => (
            <li key={t}>{t}</li>
          ))}
          {g.relays.map((r) => (
            <li key={`${r.from}-${r.via}-${r.to}-${r.at}`}>
              Relay: {name(r.from)} to {r.viaName} to {name(r.to)} within 48 hours ({num(r.resources)} resources, {day(r.at)})
            </li>
          ))}
        </ul>
      )}
      {g.flags.length > 0 && (
        <p className="multi-flags">
          {g.flags.map((f) => (
            <span key={f.code} className="tag tag-muted">
              {f.code.replace(/_/g, ' ')}
            </span>
          ))}
        </p>
      )}
      {!g.reviewed && (
        <div className="mail-actions">
          <button type="button" className="btn" onClick={() => onReview(g.key)}>
            Mark reviewed
          </button>
        </div>
      )}
    </article>
  );
}

export function MultiGroups({ canBan, onProfile }: { canBan: boolean; onProfile: (id: number) => void }) {
  const { now, toast } = useGame();
  const [data, setData] = useState<MultiGroupsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const load = useCallback(
    async (showAll: boolean) => {
      try {
        setData(await api.staffMulti(showAll));
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [],
  );
  useEffect(() => {
    void load(all);
  }, [load, all]);

  async function review(key: string) {
    try {
      setData(await api.staffMultiReview(key));
      if (all) await load(true);
      toast('Marked reviewed. It comes back if something new happens between them.');
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    }
  }

  return (
    <section aria-label="Shared connections" className="multi-page">
      <div className="card multi-intro">
        <p className="muted">
          Accounts that used the same connection (IP) or the same browser in the last 30 days. Two accounts of one person in a world are not allowed; real households declare it and then cannot ship to or support each other. Nothing here bans anyone by itself:
          you decide. Addresses and device ids are private to staff and deleted after 30 days.
        </p>
        <label className="check-row">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Also show reviewed groups
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}{' '}
          <button type="button" className="btn btn-small" onClick={() => void load(all)}>
            Retry
          </button>
        </p>
      )}
      {data === null && !error && <p className="muted">Loading…</p>}
      {data !== null && data.groups.length === 0 && (
        <p className="card muted">No groups to look at{data.reviewedHidden > 0 ? `; ${data.reviewedHidden} reviewed group${data.reviewedHidden === 1 ? ' is' : 's are'} hidden` : ''}.</p>
      )}
      {data !== null && data.groups.length > 0 && (
        <>
          {data.reviewedHidden > 0 && <p className="muted">{data.reviewedHidden} reviewed group{data.reviewedHidden === 1 ? ' is' : 's are'} hidden until something new happens.</p>}
          <div className="multi-grid">
            {data.groups.map((g) => (
              <GroupCard key={g.key} g={g} now={now} canBan={canBan} onProfile={onProfile} onChanged={() => void load(all)} onReview={(k) => void review(k)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
