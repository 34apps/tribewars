import { createContext, useContext } from 'react';
import type { Mission, MovementDto, OwnVillageDto, PlayerDto, SendResponse, StationedDto, VillageState, WorldSettings } from '@clanfire/engine';

export type Tab = 'village' | 'map' | 'army' | 'reports' | 'tribe';
export const TABS: readonly Tab[] = ['village', 'map', 'army', 'reports', 'tribe'];

/** A tribe the Tribe tab should open in its public view. */
export interface TribeTarget {
  id: number;
}

export interface MapFocus {
  x: number;
  y: number;
  /** Changes on every request so the same tile can be focused twice. */
  nonce: number;
  /** Mission to pre-select in the send form (e.g. support from a tribe alert). */
  mission?: Mission;
}

export interface ToastOptions {
  kind?: 'ok' | 'error';
  action?: { label: string; onClick: () => void };
}

/** Everything the screens need; `live` and `now` change every second. */
export interface GameApi {
  settings: WorldSettings;
  player: PlayerDto;
  village: OwnVillageDto;
  /** village.state settled to `now`. */
  live: VillageState;
  /** Server-corrected time in ms. */
  now: number;
  movements: MovementDto[];
  unreadReports: number;
  /** Open tribe invitations addressed to me. */
  tribeInvites: number;
  /** Incoming attacks on members of my tribe (me included). */
  tribeAlerts: number;
  /** Support troops: others' troops in my villages, and mine in other villages. */
  stationed: { here: StationedDto[]; abroad: StationedDto[] };
  /** Bumped after every tribe action so the map refetches its colours and tags. */
  tribeVersion: number;
  /** Set when another tab asked to show a tribe; the Tribe tab reads it once and clears it. */
  tribeFocus: TribeTarget | null;
  clearTribeFocus: () => void;
  /** Open a tribe's public page in the Tribe tab. */
  viewTribe: (target: TribeTarget) => void;
  /** Call after any tribe change: refreshes /api/state and invalidates map data. */
  tribeChanged: () => void;
  /** Last polling error, null when connected. */
  connectionError: string | null;
  tab: Tab;
  navigate: (tab: Tab) => void;
  showOnMap: (x: number, y: number, options?: { mission?: Mission }) => void;
  mapFocus: MapFocus | null;
  highlightMovementId: number | null;
  viewMovement: (id: number) => void;
  refresh: () => Promise<void>;
  applyVillage: (v: OwnVillageDto) => void;
  applySend: (r: SendResponse) => void;
  toast: (message: string, options?: ToastOptions) => void;
}

export const GameContext = createContext<GameApi | null>(null);

export function useGame(): GameApi {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <Game>');
  return ctx;
}
