import { useCallback, useEffect, useRef, useState } from 'react';
import type { TroopGroupDto, Units } from '@clanfire/engine';
import { api } from '../api.ts';

export interface TroopGroupsStore {
  groups: TroopGroupDto[];
  loaded: boolean;
  /** Each of these throws the API error (shown by the caller) and refreshes the list on success. */
  create: (name: string, units: Partial<Units>) => Promise<void>;
  update: (id: number, name: string, units: Partial<Units>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

/** The player's saved troop groups (shared by all their villages): loaded once when the send form opens, refreshed after each change. */
export function useTroopGroups(enabled = true): TroopGroupsStore {
  const [groups, setGroups] = useState<TroopGroupDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api.troopGroups();
      if (alive.current) setGroups(Array.isArray(res.groups) ? res.groups : []);
    } catch {
      // Older server or a hiccup: the built-in groups still work.
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (enabled) void load();
    return () => {
      alive.current = false;
    };
  }, [enabled, load]);

  const create = useCallback(
    async (name: string, units: Partial<Units>) => {
      await api.createTroopGroup({ name, units });
      await load();
    },
    [load],
  );
  const update = useCallback(
    async (id: number, name: string, units: Partial<Units>) => {
      await api.updateTroopGroup(id, { name, units });
      await load();
    },
    [load],
  );
  const remove = useCallback(
    async (id: number) => {
      await api.deleteTroopGroup(id);
      await load();
    },
    [load],
  );

  return { groups, loaded, create, update, remove };
}
