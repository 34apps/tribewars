// Building showcase (preview only): write the showcase levels into the signed-in player's first village.
// Same write path as the server's build code (Store.saveVillage with villagePoints), after emptying the build queue.

import { villagePoints } from '@clanfire/engine';
import { sha256Hex } from '../../server/src/auth.ts';
import type { AppContext } from '../../server/src/context.ts';
import { showcaseLevels, type ShowcaseStage, type StageTops } from './showcase.ts';

export function applyShowcase(ctx: AppContext, token: string | null, stage: ShowcaseStage, tops: StageTops): void {
  if (!token) throw new Error('Not signed in');
  const player = ctx.store.getSessionPlayer(sha256Hex(token), ctx.now());
  const village = player ? ctx.store.villagesOfPlayer(player.id)[0] : undefined;
  if (!village) throw new Error('No village');
  const state = { ...village.state, buildings: { ...village.state.buildings, ...showcaseLevels(stage, tops) }, buildQueue: [] };
  ctx.store.saveVillage(village.id, state, villagePoints(state));
}
