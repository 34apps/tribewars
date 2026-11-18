// Multi-account tooling for staff: groups of accounts that share an IP or a device (last 30 days), what happened between them, and a risk line
// in plain words. Staff SEE and JUDGE; nothing here bans anyone. Numbers are in packages/engine/src/config.ts, the rules in
// docs/SECURITY_ROADMAP.md "Multi-account tooling". IPs and device hashes are personal data: this is only reachable through the staff routes
// (moderator+) and the operator CLI.

import {
  GameError,
  MULTI_ALT_GAP_SLOTS,
  MULTI_ALT_MAX_OVERLAP,
  MULTI_ALT_MIN_HANDOFFS,
  MULTI_ALT_MIN_SLOTS,
  MULTI_BLOCKED_MIN,
  MULTI_FEED_MAX_DEFENDERS,
  MULTI_FEED_MIN_ATTACKS,
  MULTI_FEED_MIN_LOOT,
  MULTI_FEED_SHARE,
  MULTI_FLOW_MIN_DAYS,
  MULTI_FLOW_MIN_RESOURCES,
  MULTI_FLOW_MIN_SHIPMENTS,
  MULTI_FLOW_RETURN_MAX,
  MULTI_FLOW_SHARE,
  MULTI_GROUPS_MAX,
  MULTI_LINK_MAX_ACCOUNTS,
  MULTI_RELAY_WINDOW_MS,
  MULTI_RETENTION_MS,
  MULTI_RISK_HIGH,
  MULTI_RISK_MEDIUM,
  type MultiAttackDto,
  type MultiFlagDto,
  type MultiFlowDto,
  type MultiGroupDto,
  type MultiGroupsResponse,
  type MultiLinkDto,
  type MultiPairDto,
  type MultiRelayDto,
  type MultiRiskLevel,
} from '@clanfire/engine';
import { slotOf, type MemberRow, type PairEventRow, type SeenRow } from './multi-store.ts';
import type { Store } from './store.ts';

const DAY = 24 * 3_600_000;

// ---- pure rules (unit-tested with constructed data) --------------------------------------------------

const emptyFlow = (): MultiFlowDto => ({ count: 0, resources: 0, days: 0 });
const emptyAttack = (): MultiAttackDto => ({ count: 0, noDefence: 0, loot: 0, lostAttacker: 0, lostDefender: 0 });

/** Everything between accounts a and b, from the events where both are involved. Slot 0 = a to b, slot 1 = b to a. */
export function summarizePair(a: number, b: number, events: readonly PairEventRow[]): MultiPairDto {
  const pair: MultiPairDto = {
    a,
    b,
    ship: [emptyFlow(), emptyFlow()],
    shipBlocked: 0,
    support: [0, 0],
    supportBlocked: 0,
    attacks: [emptyAttack(), emptyAttack()],
    attackBlocked: 0,
    conquests: [0, 0],
    strikes: [0, 0],
    alternating: null,
  };
  const days: [Set<number>, Set<number>] = [new Set(), new Set()];
  for (const e of events) {
    const dir: 0 | 1 | null = e.a === a && e.b === b ? 0 : e.a === b && e.b === a ? 1 : null;
    if (dir === null) continue;
    switch (e.kind) {
      case 'ship': {
        const f = pair.ship[dir]!;
        f.count += 1;
        f.resources += e.amount;
        days[dir].add(Math.floor(e.at / DAY));
        break;
      }
      case 'ship_blocked':
        pair.shipBlocked += 1;
        break;
      case 'support':
        pair.support[dir] += 1;
        break;
      case 'support_blocked':
        pair.supportBlocked += 1;
        break;
      case 'attack': {
        const t = pair.attacks[dir]!;
        t.count += 1;
        if (e.defenders <= MULTI_FEED_MAX_DEFENDERS) t.noDefence += 1;
        t.loot += e.amount;
        t.lostAttacker += e.lostA;
        t.lostDefender += e.lostB;
        break;
      }
      case 'attack_blocked':
        pair.attackBlocked += 1;
        break;
      case 'conquest':
        pair.conquests[dir] += 1;
        break;
      case 'strike':
        pair.strikes[dir] += 1;
        break;
    }
  }
  pair.ship[0].days = days[0].size;
  pair.ship[1].days = days[1].size;
  return pair;
}

/** Feeding: x farms y (attacks that met no defence, loot flowing mostly one way). */
export function isFeeding(p: MultiPairDto, dir: 0 | 1): boolean {
  const t = p.attacks[dir]!;
  const back = p.attacks[dir === 0 ? 1 : 0]!;
  const total = t.loot + back.loot;
  return t.noDefence >= MULTI_FEED_MIN_ATTACKS && t.loot >= MULTI_FEED_MIN_LOOT && total > 0 && t.loot / total >= MULTI_FEED_SHARE;
}

/** One-way flow: x keeps shipping to y and gets (next to) nothing back. `shippedByX` = everything x shipped to anyone in the window. */
export function isOneWayFlow(p: MultiPairDto, dir: 0 | 1, shippedByX: number): boolean {
  const f = p.ship[dir]!;
  const back = p.ship[dir === 0 ? 1 : 0]!;
  return (
    f.count >= MULTI_FLOW_MIN_SHIPMENTS &&
    f.days >= MULTI_FLOW_MIN_DAYS &&
    f.resources >= MULTI_FLOW_MIN_RESOURCES &&
    shippedByX > 0 &&
    f.resources / shippedByX >= MULTI_FLOW_SHARE &&
    back.resources <= f.resources * MULTI_FLOW_RETURN_MAX
  );
}

/** Alternating play from two sets of activity slots (sorted). Null when the accounts overlap, are too quiet, or do not follow each other. */
export function alternation(slotsA: readonly number[], slotsB: readonly number[]): { handoffs: number; slotsA: number; slotsB: number; overlap: number } | null {
  const minSize = Math.min(slotsA.length, slotsB.length);
  if (minSize < MULTI_ALT_MIN_SLOTS) return null;
  const inB = new Set(slotsB);
  const inA = new Set(slotsA);
  const overlap = slotsA.filter((s) => inB.has(s)).length;
  if (overlap > MULTI_ALT_MAX_OVERLAP * minSize) return null;
  const line: Array<{ slot: number; who: 0 | 1 }> = [];
  for (const s of slotsA) if (!inB.has(s)) line.push({ slot: s, who: 0 });
  for (const s of slotsB) if (!inA.has(s)) line.push({ slot: s, who: 1 });
  line.sort((x, y) => x.slot - y.slot);
  let handoffs = 0;
  for (let i = 1; i < line.length; i++) {
    const prev = line[i - 1]!;
    const cur = line[i]!;
    if (prev.who !== cur.who && cur.slot - prev.slot <= MULTI_ALT_GAP_SLOTS) handoffs += 1;
  }
  return handoffs >= MULTI_ALT_MIN_HANDOFFS ? { handoffs, slotsA: slotsA.length, slotsB: slotsB.length, overlap } : null;
}

/** A to C, then C to B within the window (A and B in `members`, C anyone but A and B). */
export function findRelays(members: ReadonlySet<number>, outs: readonly PairEventRow[], ins: readonly PairEventRow[]): Array<{ from: number; via: number; to: number; at: number; resources: number }> {
  const byVia = new Map<number, PairEventRow[]>();
  for (const e of ins) {
    if (!members.has(e.b)) continue;
    const list = byVia.get(e.a) ?? [];
    list.push(e);
    byVia.set(e.a, list);
  }
  const found: Array<{ from: number; via: number; to: number; at: number; resources: number }> = [];
  for (const e1 of outs) {
    if (!members.has(e1.a)) continue;
    for (const e2 of byVia.get(e1.b) ?? []) {
      if (e2.b === e1.a || e2.b === e1.b || e1.a === e1.b) continue;
      if (e2.at < e1.at || e2.at - e1.at > MULTI_RELAY_WINDOW_MS) continue;
      found.push({ from: e1.a, via: e1.b, to: e2.b, at: e2.at, resources: Math.min(e1.amount, e2.amount) });
    }
  }
  return found;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const times = (n: number): string => (n === 1 ? 'once' : `${n} times`);

class UnionFind {
  private readonly parent = new Map<number, number>();
  find(x: number): number {
    let p = this.parent.get(x) ?? x;
    if (p === x) {
      this.parent.set(x, x);
      return x;
    }
    p = this.find(p);
    this.parent.set(x, p);
    return p;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }
  groups(): number[][] {
    const out = new Map<number, number[]>();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      const list = out.get(r) ?? [];
      list.push(x);
      out.set(r, list);
    }
    return [...out.values()].map((g) => g.sort((p, q) => p - q));
  }
}

/** Group seen-rows by their key (IP or device hash) and keep the keys used by 2..MULTI_LINK_MAX_ACCOUNTS accounts. */
function sharedKeys(rows: readonly SeenRow[]): Map<string, SeenRow[]> {
  const byKey = new Map<string, SeenRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.key) ?? [];
    list.push(r);
    byKey.set(r.key, list);
  }
  for (const [k, list] of byKey) if (list.length < 2 || list.length > MULTI_LINK_MAX_ACCOUNTS) byKey.delete(k);
  return byKey;
}

export class MultiService {
  constructor(private readonly store: Store) {}

  private get st() {
    return this.store.multi;
  }

  /** Groups as of `now`. Reviewed groups are left out unless `includeReviewed`. */
  groups(now: number, includeReviewed = false): MultiGroupsResponse {
    const all = this.computeGroups(now);
    const shown = includeReviewed ? all : all.filter((g) => !g.reviewed);
    shown.sort((x, y) => riskRank(y.risk.level) - riskRank(x.risk.level) || y.risk.score - x.risk.score || (y.lastEventAt ?? 0) - (x.lastEventAt ?? 0) || x.key.localeCompare(y.key));
    return { groups: shown.slice(0, MULTI_GROUPS_MAX), reviewedHidden: includeReviewed ? 0 : all.length - shown.length };
  }

  /** The groups one player belongs to (operator CLI). */
  groupsOf(playerId: number, now: number): MultiGroupDto[] {
    return this.computeGroups(now).filter((g) => g.members.some((m) => m.id === playerId));
  }

  /** Mark a group reviewed: hidden until a newer event involves its members. Staff only (the route checks). */
  review(key: string, now: number, reviewerId: number | null): void {
    const g = this.computeGroups(now).find((x) => x.key === key);
    if (!g) throw new GameError('not_found', 'That group no longer exists.');
    this.st.setReview(key, now, reviewerId, this.lastEventId(g.members.map((m) => m.id), now));
  }

  /** Delete data older than the retention window. Cheap; the caretaker calls it about hourly. */
  cleanup(now: number): number {
    return this.st.cleanup(now - MULTI_RETENTION_MS);
  }

  private lastEventId(ids: readonly number[], now: number): number {
    const evs = this.st.eventsAmong(ids, now - MULTI_RETENTION_MS);
    return evs.reduce((m, e) => Math.max(m, e.id), 0);
  }

  // ---- computing ---------------------------------------------------------------------------------------

  private computeGroups(now: number): MultiGroupDto[] {
    const since = now - MULTI_RETENTION_MS;
    const ipKeys = sharedKeys(this.st.ipSeen(since));
    const devKeys = sharedKeys(this.st.deviceSeen(since));
    const uf = new UnionFind();
    for (const list of [...ipKeys.values(), ...devKeys.values()]) {
      for (const r of list) uf.find(r.playerId);
      for (let i = 1; i < list.length; i++) uf.union(list[0]!.playerId, list[i]!.playerId);
    }
    const clusters: Array<{ ids: number[]; kind: 'connection' | 'behaviour' }> = uf.groups().map((ids) => ({ ids, kind: 'connection' }));

    // Behaviour only: pairs that share nothing but farm each other or feed one-way (they may use a VPN and a second browser).
    const linked = new Map<number, number>();
    clusters.forEach((c, i) => c.ids.forEach((id) => linked.set(id, i)));
    const behaviour = new Map<string, number[]>();
    const candidates = [...this.st.busyPairs('attack', since, MULTI_FEED_MIN_ATTACKS), ...this.st.busyPairs('ship', since, MULTI_FLOW_MIN_SHIPMENTS)];
    const candidateIds = [...new Set(candidates.flatMap((p) => [p.a, p.b]))];
    const shipped = this.st.shippedTotals(candidateIds, since);
    for (const c of candidates) {
      if (linked.has(c.a) && linked.get(c.a) === linked.get(c.b)) continue;
      const key = [c.a, c.b].sort((p, q) => p - q).join(',');
      if (behaviour.has(key)) continue;
      const p = summarizePair(c.a, c.b, this.st.eventsAmong([c.a, c.b], since));
      if (isFeeding(p, 0) || isFeeding(p, 1) || isOneWayFlow(p, 0, shipped.get(c.a) ?? 0) || isOneWayFlow(p, 1, shipped.get(c.b) ?? 0)) {
        behaviour.set(key, [c.a, c.b].sort((x, y) => x - y));
      }
    }
    for (const ids of behaviour.values()) clusters.push({ ids, kind: 'behaviour' });

    const out: MultiGroupDto[] = [];
    for (const c of clusters) {
      const g = this.buildGroup(c.ids, c.kind, now, ipKeys, devKeys);
      if (g && g.members.some((m) => m.bannedAt === null)) out.push(g);
    }
    const reviews = this.st.reviews(out.map((g) => g.key));
    for (const g of out) {
      const seen = reviews.get(g.key);
      g.reviewed = seen !== undefined && seen >= this.lastEventId(g.members.map((m) => m.id), now);
    }
    return out;
  }

  private buildGroup(ids: number[], kind: 'connection' | 'behaviour', now: number, ipKeys: Map<string, SeenRow[]>, devKeys: Map<string, SeenRow[]>): MultiGroupDto | null {
    const since = now - MULTI_RETENTION_MS;
    const set = new Set(ids);
    const rows = this.st.members(ids);
    if (rows.length < 2) return null;
    const totals = this.st.villageTotals(ids);
    const members = rows.map((m: MemberRow) => ({
      id: m.id,
      username: m.username,
      householdShared: m.householdShared,
      bannedAt: m.bannedAt,
      villages: totals.get(m.id)?.villages ?? 0,
      points: totals.get(m.id)?.points ?? 0,
      tribeTag: this.store.tribes.playerTribe(m.id)?.tag ?? null,
      lastActive: m.lastActive,
    }));
    const name = (id: number): string => members.find((m) => m.id === id)?.username ?? `#${id}`;

    // Links: every shared IP / device that touches this group, and which pairs share one directly.
    const links: MultiLinkDto[] = [];
    const direct = { ip: new Set<string>(), device: new Set<string>() };
    const pairKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
    for (const [kindName, map] of [['ip', ipKeys], ['device', devKeys]] as const) {
      for (const [key, list] of map) {
        const inGroup = list.filter((r) => set.has(r.playerId));
        if (inGroup.length < 2) continue;
        links.push({
          kind: kindName,
          label: kindName === 'ip' ? key : `device ${key.slice(0, 8)}`,
          seen: inGroup.map((r) => ({ playerId: r.playerId, firstSeen: r.firstSeen, lastSeen: r.lastSeen })),
        });
        for (let i = 0; i < inGroup.length; i++) for (let j = i + 1; j < inGroup.length; j++) direct[kindName].add(pairKey(inGroup[i]!.playerId, inGroup[j]!.playerId));
      }
    }
    links.sort((x, y) => (x.kind === y.kind ? x.label.localeCompare(y.label) : x.kind === 'ip' ? -1 : 1));

    const events = this.st.eventsAmong(ids, since);
    const shipped = this.st.shippedTotals(ids, since);
    const pairs: MultiPairDto[] = [];
    const flags: MultiFlagDto[] = [];
    let score = 0;
    const slotCache = new Map<number, number[]>();
    const slots = (id: number): number[] => {
      let s = slotCache.get(id);
      if (!s) slotCache.set(id, (s = this.st.activitySlots(id, slotOf(since))));
      return s;
    };
    let blocked = 0;
    const feedTexts: string[] = [];
    const flowTexts: string[] = [];
    const takenTexts: string[] = [];
    const altTexts: string[] = [];
    const hiddenDevice: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const p = summarizePair(a, b, events);
        const key = pairKey(a, b);
        const sharesIp = direct.ip.has(key);
        const sharesDevice = direct.device.has(key);
        if (sharesIp || sharesDevice) p.alternating = alternation(slots(a), slots(b));
        const touched =
          p.ship[0].count + p.ship[1].count + p.shipBlocked + p.support[0] + p.support[1] + p.supportBlocked + p.attacks[0].count + p.attacks[1].count + p.attackBlocked + p.conquests[0] + p.conquests[1] + p.strikes[0] + p.strikes[1] > 0;
        if (touched || p.alternating) pairs.push(p);
        blocked += p.shipBlocked + p.supportBlocked + p.attackBlocked;
        if (sharesDevice && !sharesIp) hiddenDevice.push(`${name(a)} and ${name(b)}`);
        for (const dir of [0, 1] as const) {
          const x = dir === 0 ? a : b;
          const y = dir === 0 ? b : a;
          if (isFeeding(p, dir)) {
            const t = p.attacks[dir]!;
            const share = Math.round((t.loot / (t.loot + p.attacks[dir === 0 ? 1 : 0]!.loot)) * 100);
            feedTexts.push(`${name(x)} took ${fmt(t.loot)} resources from ${name(y)} in ${t.count} attacks (${t.noDefence} met no defence; ${share}% of all loot between them goes this way)`);
          }
          if (isOneWayFlow(p, dir, shipped.get(x) ?? 0)) {
            const f = p.ship[dir]!;
            flowTexts.push(`${name(x)} sent ${name(y)} ${fmt(f.resources)} resources in ${f.count} shipments on ${f.days} days and got ${fmt(p.ship[dir === 0 ? 1 : 0]!.resources)} back`);
          }
          if (p.conquests[dir]! > 0) {
            takenTexts.push(`${name(x)} took ${p.conquests[dir] === 1 ? 'a village' : `${p.conquests[dir]} villages`} from ${name(y)}`);
          } else if (p.strikes[dir]! > 0) {
            takenTexts.push(`${name(x)} put out the hearth of ${name(y)} ${times(p.strikes[dir]!)} (Chieftain strike)`);
          }
        }
        if (p.alternating) {
          altTexts.push(`${name(a)} and ${name(b)} are never on at the same time but follow each other within minutes (${p.alternating.handoffs} hand-overs, ${p.alternating.overlap} shared ten-minute slot${p.alternating.overlap === 1 ? '' : 's'})`);
        }
      }
    }

    const relays: MultiRelayDto[] = findRelays(set, this.st.shipsFrom(ids, since), this.st.shipsTo(ids, since))
      .sort((x, y) => y.at - x.at)
      .slice(0, 20)
      .map((r) => ({ from: r.from, via: r.via, viaName: this.store.getPlayer(r.via)?.username ?? `#${r.via}`, to: r.to, at: r.at, resources: r.resources }));

    const undeclared = members.filter((m) => !m.householdShared && m.bannedAt === null);
    if (kind === 'connection' && undeclared.length > 0) {
      flags.push({ code: 'undeclared', text: `No household declared by ${undeclared.map((m) => m.username).join(', ')}` });
      score += 1;
    }
    if (hiddenDevice.length > 0) {
      flags.push({ code: 'device_hidden', text: `${hiddenDevice.join('; ')} used the same browser on different connections` });
      score += 2;
    }
    if (feedTexts.length > 0) {
      flags.push({ code: 'feeding', text: feedTexts.join('; ') });
      score += 1;
    }
    if (flowTexts.length > 0) {
      flags.push({ code: 'one_way_flow', text: flowTexts.join('; ') });
      score += 1;
    }
    if (relays.length > 0) {
      const r = relays[0]!;
      flags.push({ code: 'relay', text: `${relays.length} relay${relays.length === 1 ? '' : 's'} through a third account, e.g. ${name(r.from)} to ${r.viaName} to ${name(r.to)} within 48 hours (${fmt(r.resources)} resources)` });
      score += 1;
    }
    if (altTexts.length > 0) {
      flags.push({ code: 'alternating', text: altTexts.join('; ') });
      score += 1;
    }
    if (blocked >= MULTI_BLOCKED_MIN) {
      flags.push({ code: 'blocked_attempts', text: `${blocked} attempts to ship, support or attack each other were refused by the same-connection check` });
      score += 1;
    }
    if (takenTexts.length > 0) {
      flags.push({ code: 'village_taken', text: takenTexts.join('; ') });
      score += pairs.some((p) => p.conquests[0] + p.conquests[1] > 0) ? 2 : 1;
    }

    const level: MultiRiskLevel = score >= MULTI_RISK_HIGH ? 'high' : score >= MULTI_RISK_MEDIUM ? 'medium' : 'low';
    const lead = level === 'high' ? 'High risk' : level === 'medium' ? 'Worth a look' : 'Low risk';
    const text =
      flags.length > 0
        ? `${lead}: ${flags.map((f) => f.text).join('. ')}.`
        : `${lead}: every account declared the shared household and nothing suspicious happened between them.`;
    const lastEventAt = events.length > 0 ? events.reduce((m, e) => Math.max(m, e.at), 0) : null;
    return { key: ids.join(','), kind, members, links, pairs, relays, flags, risk: { level, score, text }, lastEventAt, reviewed: false };
  }
}

const riskRank = (l: MultiRiskLevel): number => (l === 'high' ? 2 : l === 'medium' ? 1 : 0);
