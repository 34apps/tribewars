import type { BuildingId } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { useGame } from '../../game.ts';
import { useLock } from '../../hooks/useLock.ts';
import { useSync } from '../../hooks/useSync.ts';

/** Queue one level of a building in the current village (the same call everywhere: panel, quick-build list, building page). */
export function useBuild() {
  const { village, applyVillage, toast } = useGame();
  const { busy, begin, end } = useLock();
  const sync = useSync();
  async function build(id: BuildingId) {
    if (!begin()) return;
    let ok = false;
    try {
      applyVillage(await api.build(village.id, id));
      ok = true;
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      end();
      sync(ok);
    }
  }
  return { busy, build: (id: BuildingId) => void build(id) };
}
