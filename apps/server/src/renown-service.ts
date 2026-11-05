// Combat Renown (docs/GAME_DESIGN.md section 18.2): who may earn from a resolved battle and how it is stored.
// The maths (value, pair window, size factor) is the engine's `battleRenown`; this file decides the parts that need accounts:
// computer-run villages, the same IP group, the same tribe and allied tribes never pay, and it keeps the pair windows
// in `renown_pairs`. Building and Feast Renown never come through here (Store.saveVillage and GameService.feast).

import {
  battleRenown,
  isAttackForbidden,
  pairRenown,
  renownPairWindowMs,
  settleVillage,
  sizeFactor,
  villagePoints,
  type BattleResult,
  type RenownEarner,
  type RenownParty,
  type VillageRanks,
  type VillageState,
  type WorldSettings,
} from '@clanfire/engine';
import { relationBetweenPlayers } from './relations.ts';
import type { StationedRow, Store, VillageRecord } from './store.ts';

/** Everything the game service knows about one resolved battle (states are settled to the battle time, before the battle). */
export interface BattleForRenown {
  at: number;
  result: BattleResult;
  origin: VillageRecord;
  target: VillageRecord;
  originState: VillageState;
  targetState: VillageState;
  attackerRanks: VillageRanks | undefined;
  contingents: readonly StationedRow[];
}

export class RenownService {
  constructor(
    private readonly store: Store,
    private readonly settings: WorldSettings,
  ) {}

  /**
   * Pay combat Renown for a battle (call inside the battle's transaction): the attacker, the village owner and every
   * support owner each earn separately. Returns the whole Renown (floored) each player got, for the reports.
   * Not for scouts, called-off attacks or shipments: the caller only calls this for a real battle.
   */
  awardBattle(b: BattleForRenown): Map<number, number> {
    const store = this.store;
    const at = b.at;
    const windowMs = renownPairWindowMs(this.settings);
    const attackerId = b.origin.ownerId;
    const defenderId = b.target.ownerId;
    const supportIds = b.contingents.map((c) => c.ownerPlayerId);

    // Who each party is up against, as a key of the pair window: 'p:<player>' or 'v:<abandoned village>'.
    const keyAgainstAttacker = attackerId !== null ? `p:${attackerId}` : null;
    const keyAgainstDefender = defenderId !== null ? `p:${defenderId}` : `v:${b.target.id}`;
    const who = (e: RenownEarner): { playerId: number | null; key: string | null } => {
      if (e.side === 'attacker') return { playerId: attackerId, key: keyAgainstDefender };
      if (e.side === 'defender') return { playerId: defenderId, key: keyAgainstAttacker };
      return { playerId: supportIds[e.index ?? -1] ?? null, key: keyAgainstAttacker };
    };

    const homes = b.contingents.map((c) => store.getVillage(c.homeVillageId));
    const attackerParty: RenownParty = {
      eligible: attackerId !== null && this.mayEarn(attackerId, defenderId, at) && supportIds.every((id) => this.mayEarn(attackerId, id, at, true)),
      points: villagePoints(b.originState),
    };
    const defenderParty: RenownParty = {
      eligible: defenderId !== null && attackerId !== null && this.mayEarn(defenderId, attackerId, at),
      // Abandoned villages are small by design and already limited by the repeat-raid loot rule:
      // they are exempt from the size factor (the attacker's own points as the opponent's make it 1).
      points: defenderId === null ? attackerParty.points : villagePoints(b.targetState),
    };
    const supportParties: RenownParty[] = b.contingents.map((_, i) => {
      const home = homes[i];
      return {
        eligible: attackerId !== null && this.mayEarn(supportIds[i] as number, attackerId, at),
        points: home ? villagePoints(settleVillage(home.state, at, this.settings)) : 0,
      };
    });

    const awards = battleRenown({
      result: b.result,
      context: {
        support: b.contingents.map((c) => c.units),
        attackerRanks: b.attackerRanks,
        defenderRanks: b.targetState.ranks,
        supportRanks: b.contingents.map((c) => c.ranks ?? undefined),
      },
      attacker: attackerParty,
      defender: defenderParty,
      support: supportParties,
      pairValue: (e) => {
        const w = who(e);
        return w.playerId === null || w.key === null ? 0 : store.openRenownPair(w.playerId, w.key, at, windowMs);
      },
    });

    const counted = new Map<string, number>(); // raw Renown already added to a pair earlier in this very battle
    const gains = new Map<number, number>();
    for (const a of awards) {
      const w = who(a);
      if (a.skipped || a.counted <= 0 || w.playerId === null || w.key === null) continue;
      const k = `${w.playerId}|${w.key}`;
      const earlier = counted.get(k) ?? 0;
      let renown = a.renown;
      if (earlier > 0) {
        // Two contingents of one support owner share one pair: the second one continues where the first stopped.
        const own = a.side === 'attacker' ? attackerParty : a.side === 'defender' ? defenderParty : (supportParties[a.index ?? -1] as RenownParty);
        const opponent = a.side === 'attacker' ? defenderParty : attackerParty;
        renown = pairRenown(store.openRenownPair(w.playerId, w.key, at, windowMs), a.counted) * sizeFactor(opponent.points, own.points);
      }
      counted.set(k, earlier + a.counted);
      store.addRenownPair(w.playerId, w.key, a.counted, at, windowMs);
      const credited = store.addRenown(w.playerId, renown); // includes the Fire Shrine bonus, so the report shows what was really paid
      gains.set(w.playerId, (gains.get(w.playerId) ?? 0) + credited);
    }
    const whole = new Map<number, number>();
    for (const [id, g] of gains) whole.set(id, Math.floor(g + 1e-9));
    return whole;
  }

  /**
   * May `earner` be paid Renown for a battle against `opponent` (null = abandoned village, always fine)? No when the
   * earner is a sandbox account, the two share an IP group (the same guard that stops them attacking each other) or are
   * in the same tribe or in allied tribes. NAP partners, neutrals and enemies are fine.
   * `ipOnly`: the attacker against a support owner only needs the IP rule (support owners are tribe or ally of the village owner by design).
   */
  private mayEarn(earner: number, opponent: number | null, at: number, ipOnly = false): boolean {
    const p = this.store.getPlayer(earner);
    if (!p) return false;
    // Test-mode accounts earn from abandoned villages (no one is hurt), but never from fights against real players.
    if (opponent === null) return true;
    if (this.store.isSandboxUser(p.username)) return false;
    if (opponent === earner || this.store.shareAnIp(earner, opponent)) return false;
    if (ipOnly) return true;
    const rel = relationBetweenPlayers(this.store.tribes, earner, opponent, at).relation;
    return !(isAttackForbidden(rel) && rel !== 'nap');
  }
}
