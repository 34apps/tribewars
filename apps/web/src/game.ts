import { createContext, useContext } from 'react';
import type { Mission, MovementDto, OwnVillageDto, PlayerDto, SendResponse, StationedDto, VillageState, WorldSettings } from '@clanfire/engine';

/** Tabs shown in the main navigation. */
export type NavTab = 'village' | 'map' | 'army' | 'reports' | 'mail' | 'tribe' | 'ranks';
/** Pages reached from the account menu (not in the navigation bar). */
export type MenuPage = 'support' | 'staff';
export type Tab = NavTab | MenuPage;
export const TABS: readonly NavTab[] = ['village', 'map', 'army', 'reports', 'mail', 'tribe', 'ranks'];
export const MENU_PAGES: readonly MenuPage[] = ['support', 'staff'];

/** Mail compose form pre-filled from elsewhere (profile, ranking row, Reply). */
export interface MailDraft {
  to: string;
  subject: string;
  /** Changes on every request so the same draft can be opened twice. */
  nonce: number;
}

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
  /** Unread mails in my inbox. */
  unreadMail: number;
  /** Open the Mail tab on a new message to `to` (subject optional). */
  composeMail: (to: string, subject?: string) => void;
  /** Draft requested by composeMail; the Mail tab consumes it. */
  mailDraft: MailDraft | null;
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
