import { createContext, useContext } from 'react';
import type {
  BuildingId,
  ChestInfo,
  FirstStepsDto,
  Mission,
  MovementDto,
  OwnVillageDto,
  PlayerDto,
  RenownInfo,
  SendResponse,
  StationedDto,
  VillageListItemDto,
  VillageState,
  WorldEndDto,
  WorldConfig,
  WorldSettings,
} from '@clanfire/engine';
import { worldRules } from '@clanfire/engine';
import type { SimDraftData } from './simulator.ts';

/** Tabs shown in the main navigation. */
export type NavTab = 'village' | 'map' | 'army' | 'reports' | 'mail' | 'tribe' | 'ranks';
/** Pages reached from the account menu (not in the navigation bar). */
export type MenuPage = 'support' | 'staff' | 'results' | 'rules' | 'simulator';
export type Tab = NavTab | MenuPage;
export const TABS: readonly NavTab[] = ['village', 'map', 'army', 'reports', 'mail', 'tribe', 'ranks'];
export const MENU_PAGES: readonly MenuPage[] = ['support', 'staff', 'results', 'rules', 'simulator'];

/** Mail compose form pre-filled from elsewhere (profile, ranking row, Reply). */
export interface MailDraft {
  to: string;
  subject: string;
  /** Changes on every request so the same draft can be opened twice. */
  nonce: number;
}

/** Battle simulator pre-filled from elsewhere (send form, report). */
export interface SimDraft extends SimDraftData {
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
  /** Open the send-resources form on that village (the Tribe Store button). */
  ship?: boolean;
}

export interface ToastOptions {
  /** success (default; 'ok' is the older name), info, warning, error. */
  kind?: 'ok' | 'success' | 'info' | 'warning' | 'error';
  action?: { label: string; onClick: () => void };
}

/** Everything the screens need; `live` and `now` change every second. */
export interface GameApi {
  settings: WorldSettings;
  player: PlayerDto;
  /** The player's Renown (docs/GAME_DESIGN.md section 18.2). */
  renown: RenownInfo;
  /** The player's War Chest (undefined against an older server: hide the chest UI). */
  chest: ChestInfo | undefined;
  /** The current village: every screen (build, train, send, map) acts on this one. */
  village: OwnVillageDto;
  /** All my villages (the state response), in server order. */
  villages: OwnVillageDto[];
  /** Make another of my villages the current one (kept in localStorage). */
  selectVillage: (id: number) => void;
  /** GET /api/villages rows (name, points, hearth, incoming attack, protection); null while there is one village or before the first fetch. */
  villageList: VillageListItemDto[] | null;
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
  /** Open the Battle simulator page, optionally pre-filled (the draft is applied once). */
  openSimulator: (draft?: SimDraftData) => void;
  /** Draft requested by openSimulator; the simulator page consumes it. */
  simDraft: SimDraft | null;
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
  /** The frozen result once the world has ended (orders are closed, reading still works); null while it runs. */
  worldEnd: WorldEndDto | null;
  /** Last polling error, null when connected. */
  connectionError: string | null;
  tab: Tab;
  navigate: (tab: Tab) => void;
  /** Desktop: the building whose own page is open (route `#village/b/<id>`, the Village tab stays active); null on the Village page. */
  building: BuildingId | null;
  openBuilding: (id: BuildingId | null) => void;
  showOnMap: (x: number, y: number, options?: { mission?: Mission; ship?: boolean }) => void;
  mapFocus: MapFocus | null;
  highlightMovementId: number | null;
  viewMovement: (id: number) => void;
  refresh: () => Promise<void>;
  applyVillage: (v: OwnVillageDto) => void;
  /** Apply a War Chest pay-in response (updated village and chest). */
  applyChest: (v: OwnVillageDto, chest: ChestInfo) => void;
  applySend: (r: SendResponse) => void;
  /** The First steps block of the state (undefined only against an old server). */
  firstSteps: FirstStepsDto | undefined;
  /** Apply a first-steps claim/hide response at once. */
  applyFirstSteps: (fs: FirstStepsDto) => void;
  toast: (message: string, options?: ToastOptions) => void;
}

export const GameContext = createContext<GameApi | null>(null);

export function useGame(): GameApi {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <Game>');
  return ctx;
}

/** The rules of this world (queue sizes, tribe limit, hold times, ...) from the settings the server sends. Defaults on an old server. */
export function useRules(): WorldConfig {
  return worldRules(useGame().settings);
}
