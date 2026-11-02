import { createContext, useContext } from 'react';
import type { MovementDto, OwnVillageDto, PlayerDto, SendResponse, VillageState, WorldSettings } from '@tribewars/engine';

export type Tab = 'village' | 'map' | 'army' | 'reports';
export const TABS: readonly Tab[] = ['village', 'map', 'army', 'reports'];

export interface MapFocus {
  x: number;
  y: number;
  /** Changes on every request so the same tile can be focused twice. */
  nonce: number;
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
  /** Last polling error, null when connected. */
  connectionError: string | null;
  tab: Tab;
  navigate: (tab: Tab) => void;
  showOnMap: (x: number, y: number) => void;
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
