import { useEffect, useSyncExternalStore } from 'react';
import { tribeWaymarks } from '@clanfire/engine';
import type { Coords, SiteDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { useGame, useRules } from '../game.ts';

// The Waymarks my tribe holds, for travel previews anywhere in the app (map send panel, Command post, shipments).
// useSites publishes every answer here; a screen that never mounted useSites fetches the sites once itself.

const NONE: readonly Coords[] = [];
let sitesNow: readonly SiteDto[] = [];
let fetched = false;
const listeners = new Set<() => void>();

/** Called by useSites with each fresh answer. */
export function publishSites(sites: readonly SiteDto[]): void {
  sitesNow = sites;
  fetched = true;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const memo: { sites: readonly SiteDto[]; tribe: number | null; list: readonly Coords[] } = { sites: [], tribe: null, list: NONE };

/** Waymark tiles that speed up my tribe's trips; empty without a tribe or without sites. Same list the server uses. */
export function useTribeWaymarks(): readonly Coords[] {
  const { player } = useGame();
  const sitesOn = useRules().features.sites;
  const tribe = player.tribe?.id ?? null;
  const sites = useSyncExternalStore(subscribe, () => sitesNow, () => sitesNow);
  useEffect(() => {
    if (!sitesOn || tribe === null || fetched) return;
    fetched = true;
    api
      .sites()
      .then((res) => publishSites(Array.isArray(res.sites) ? (res.sites as SiteDto[]) : []))
      .catch(() => {
        fetched = false;
      });
  }, [sitesOn, tribe]);
  if (tribe === null || !sitesOn) return NONE;
  if (memo.sites !== sites || memo.tribe !== tribe) {
    memo.sites = sites;
    memo.tribe = tribe;
    memo.list = tribeWaymarks(sites as SiteDto[], tribe);
  }
  return memo.list;
}
