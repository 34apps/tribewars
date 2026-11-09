import { useState } from 'react';
import type { BuildingId } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { useGame } from '../../game.ts';

/** Queue one level of a building in the current village (the same call everywhere: panel, quick-build list, building page). */
export function useBuild() {
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
