// Typed fetch wrapper for the Clanflame HTTP API (contract: packages/engine/src/api.ts).

import { DEVICE_HEADER, ensureDeviceId, existingDeviceId } from './device.ts';

import type {
  AccountDeleteRequest,
  AccountDeletionInfoDto,
  ApiError,
  LobbyShareStatsRequest,
  ShopFromId,
  StatsPageId,
  ShopAgeRequest,
  ShopBalanceResponse,
  ShopCheckoutRequest,
  ShopCheckoutResponse,
  ShopResponse,
  ShopSpendRequest,
  ApplyRequest,
  AuthRequest,
  BuildRequest,
  ChieftainRequest,
  HouseholdRequest,
  CancelBuildRequest,
  CancelResearchRequest,
  CancelResponse,
  CancelTrainRequest,
  ChatMessageDto,
  ChatRequest,
  ChatResponse,
  CreateTribeRequest,
  DiplomacyKind,
  DominationStatusDto,
  ScoutedResponse,
  VillageIntelDto,
  SiteRecallRequest,
  SitesResponse,
  WorldEndResponse,
  DiplomacyRequest,
  GameErrorCode,
  GameStateResponse,
  InviteRequest,
  MailBox,
  MailConversationReadResponse,
  MailConversationsResponse,
  MailDto,
  MailThreadResponse,
  MailListResponse,
  MapResponse,
  MapOverviewResponse,
  SearchVillagesBy,
  SearchVillagesResponse,
  MeResponse,
  MovementResponse,
  MyTribeResponse,
  NoteRequest,
  NoteResponse,
  NotesResponse,
  RealmResponse,
  NotificationsReadRequest,
  NotificationsResponse,
  OwnVillageDto,
  ReportDto,
  RecallRequest,
  RenameVillageRequest,
  VillageListResponse,
  RankRequest,
  ResearchRequest,
  ReportListResponse,
  AutoOverviewResponse,
  AutoSettingsRequest,
  AutoVillageDto,
  RaidListRequest,
  RaidListResponse,
  RaidListSendRequest,
  RaidListSendResponse,
  RaidListsResponse,
  RaidRowRequest,
  RaidRowUpdateRequest,
  SendMailRequest,
  SendRequest,
  RoleRequest,
  SendResponse,
  SendShipmentRequest,
  SendShipmentResponse,
  TrainRequest,
  TransferRequest,
  TribeAlertsResponse,
  LookoutSightingsResponse,
  TribeDto,
  PlayerProfileDto,
  PlayerRankingResponse,
  RenownRankingResponse,
  FighterKind,
  FighterRankingResponse,
  FighterScope,
  ChestDepositRequest,
  ChestDepositResponse,
  FeastAllRequest,
  FeastAllResponse,
  FeastOverviewResponse,
  FeastRequest,
  FirstStepClaimRequest,
  FirstStepClaimResponse,
  FirstStepHiddenRequest,
  FirstStepId,
  FirstStepsDto,
  FeastResponse,
  TribeListResponse,
  TribeRole,
  TroopGroupRequest,
  TroopGroupResponse,
  TroopGroupsResponse,
  TribeSettingsRequest,
  Units,
} from '@clanfire/engine';
import type {
  AssignTicketRequest,
  AuditListResponse,
  BanRequest,
  CreateMessageReportRequest,
  CreateTicketRequest,
  MessageReportCategory,
  MessageReportReceipt,
  MessageReportStatus,
  MuteRequest,
  MultiGroupsResponse,
  MultiReviewRequest,
  ResolveReportRequest,
  StaffPlayerDetailDto,
  StaffPlayerListResponse,
  StaffReportDto,
  StaffReportListResponse,
  StaffTicketDto,
  StaffTicketListResponse,
  StaffTicketReplyRequest,
  TemplateListResponse,
  TicketCategory,
  TicketDto,
  TicketListResponse,
  TicketPriority,
  TicketPriorityRequest,
  TicketReplyRequest,
  TicketStatus,
  TicketStatusRequest,
  WarnRequest,
} from '@clanfire/engine';
import type {
  ForumBoardDto,
  ForumBoardsResponse,
  ForumPostDto,
  ForumThreadResponse,
  ForumThreadsResponse,
  TribeAction,
  TribeMemberDto,
  TribeProjectId,
  TribeProjectsResponse,
} from '@clanfire/engine';

import type {
  EnterPassRequest,
  EnterWorldResponse,
  HallOfFameResponse,
  LobbyAuthRequest,
  LobbyChangePasswordRequest,
  LobbyMeResponse,
  LobbyWorldsResponse,
  PublicWorldsResponse,
  WorldConfigResponse,
  WorldInfoResponse,
} from '@clanfire/engine';

import { LOBBY_PREFIX, worldPrefixOf } from '@clanfire/engine';
import { WORLD_ENDED_EVENT, WORLD_ENDED_NOTE, isWorldEndedError } from './domination.ts';

export type ClientErrorCode = GameErrorCode | 'network' | 'server_error';

/** Thrown for every failed request; carries the API's error code and message. */
export class ApiRequestError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  constructor(code: ClientErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/**
 * API base for a page path: "/w/<id>/api" when the page is served under a world path (play.example.com/w/w1/),
 * "/api" otherwise (dev, preview, single-world installs). The same build serves every world.
 */
export function apiBase(pathname: string): string {
  return `${worldPrefixOf(pathname)}/api`;
}

/** "/api/x" -> "/w/<id>/api/x" under a world path; unchanged otherwise. Read per call, so it follows the page URL. */
export function withApiBase(path: string): string {
  if (typeof window === 'undefined') return path;
  const prefix = worldPrefixOf(window.location.pathname);
  return prefix !== '' && path.startsWith('/api') ? prefix + path : path;
}

/** The lobby's API base ("/lobby/api"). Lobby paths are sent verbatim: they never get a world prefix. */
export const lobbyApiBase = `${LOBBY_PREFIX}/api`;

/**
 * A world page path from the lobby, or null when it is not safe to navigate or POST to. Only plain same-origin
 * absolute paths ending in "/" pass ("/w/w1/"): no scheme, no "//host", no dot segments, no query or fragment.
 */
export function safeWorldPath(path: unknown): string | null {
  if (typeof path !== 'string' || path.length > 200) return null;
  if (!/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*\/$/.test(path)) return null;
  if (path.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  return path;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** World requests: "/api/..." gets the page's "/w/<id>" prefix. */
function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  return send<T>(method, withApiBase(path), body);
}

/** Lobby requests: the path (always under /lobby/api) is used as given. */
function lobbyRequest<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (!path.startsWith(`${lobbyApiBase}/`)) throw new Error(`Not a lobby API path: ${path}`);
  return send<T>(method, path, body);
}

/** World calls that create the browser id: sign-in, register and entering with a lobby pass. */
const DEVICE_CREATING = /\/api\/auth\/(login|register|enter)$/;

/**
 * The device-id header for a request URL. Never for the lobby. For a world's sign-in, register and enter calls the id is created
 * if needed; every other world call sends an id only when one already exists (a bare visit creates nothing).
 */
export function deviceHeaderFor(url: string): Record<string, string> {
  if (url.startsWith(`${lobbyApiBase}/`)) return {};
  const id = DEVICE_CREATING.test(url.split('?')[0] ?? url) ? ensureDeviceId() : existingDeviceId();
  return id ? { [DEVICE_HEADER]: id } : {};
}

/** A JSON file the server sends as a download: the text and the file name from Content-Disposition. */
export async function downloadJson(url: string, fallbackName: string): Promise<{ filename: string; blob: Blob }> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...deviceHeaderFor(url) } });
  } catch {
    throw new ApiRequestError('network', 'Cannot reach the server. Check your connection.', 0);
  }
  if (!res.ok) {
    let err: Partial<ApiError> = {};
    try {
      err = JSON.parse(await res.text()) as Partial<ApiError>;
    } catch {
      err = {};
    }
    const fallback = res.status === 429 ? 'Try again in a few minutes.' : res.status >= 500 ? 'The server had a problem. Try again in a moment.' : `Request failed (${res.status}).`;
    throw new ApiRequestError(err.error ?? 'server_error', err.message ?? fallback, res.status);
  }
  const text = await res.text();
  return { filename: filenameFromDisposition(res.headers.get('Content-Disposition'), fallbackName), blob: new Blob([text], { type: 'application/json' }) };
}

/** The file name in a Content-Disposition header (plain or RFC 5987 filename*), made safe; the fallback when absent or odd. */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback;
  let name: string | null = null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star?.[1]) {
    try {
      name = decodeURIComponent(star[1].trim());
    } catch {
      name = null;
    }
  }
  if (name === null) {
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(header);
    name = (plain?.[1] ?? plain?.[2] ?? '').trim();
  }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '');
  return name === '' || name.length > 120 ? fallback : name;
}

async function send<T>(method: Method, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: method === 'GET' ? 'no-store' : 'default',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        // The lobby never gets the device id; only the world's own API (multi-account tooling for staff).
        ...deviceHeaderFor(url),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError('network', 'Cannot reach the server. Check your connection.', 0);
  }
  if (res.status === 204) return undefined as T;
  let payload: unknown = null;
  try {
    const text = await res.text();
    if (text) payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const err = (payload ?? {}) as Partial<ApiError>;
    const fallback = res.status >= 500 ? 'The server had a problem. Try again in a moment.' : `Request failed (${res.status}).`;
    const message = err.message ?? fallback;
    // The world is over: tell the app (it asks for the results) and give the player a friendly line, not a raw error.
    if (method !== 'GET' && isWorldEndedError(res.status, message)) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(WORLD_ENDED_EVENT));
      throw new ApiRequestError('forbidden', WORLD_ENDED_NOTE, res.status);
    }
    throw new ApiRequestError(err.error ?? 'server_error', message, res.status);
  }
  return payload as T;
}

export const api = {
  // ---- lobby (one account, many worlds) ----
  lobbyMe: () => lobbyRequest<LobbyMeResponse>('GET', `${lobbyApiBase}/auth/me`),
  lobbyLogin: (body: LobbyAuthRequest) => lobbyRequest<LobbyMeResponse>('POST', `${lobbyApiBase}/auth/login`, body),
  lobbyRegister: (body: LobbyAuthRequest) => lobbyRequest<LobbyMeResponse>('POST', `${lobbyApiBase}/auth/register`, body),
  lobbyLogout: () => lobbyRequest<void>('POST', `${lobbyApiBase}/auth/logout`, {}),
  /** End every lobby session of the account; worlds follow within hours (their lobby-linked sessions are short). */
  lobbyLogoutAll: () => lobbyRequest<void>('POST', `${lobbyApiBase}/auth/logout-all`, {}),
  lobbyChangePassword: (body: LobbyChangePasswordRequest) => lobbyRequest<LobbyMeResponse>('POST', `${lobbyApiBase}/auth/change-password`, body),
  /** What deleting the account will do (worlds, Flames that will be lost): shown before the confirm step. */
  lobbyDeletionInfo: () => lobbyRequest<AccountDeletionInfoDto>('GET', `${lobbyApiBase}/account/deletion-info`),
  /** Delete the lobby account for good. 204; the cookie is cleared. */
  lobbyDeleteAccount: (body: AccountDeleteRequest) => lobbyRequest<void>('POST', `${lobbyApiBase}/account/delete`, body),
  /** Everything kept about the account, every world included, as a JSON download. */
  lobbyExport: () => downloadJson(`${lobbyApiBase}/account/export`, 'clanflame-data.json'),
  /** This world's data about the signed-in player, as a JSON download. */
  worldExport: () => downloadJson(withApiBase('/api/account/export'), 'clanflame-world-data.json'),
  /** Worlds with their own accounts only (lobby worlds answer 403: delete in the lobby). */
  worldDeleteAccount: (body: AccountDeleteRequest) => request<void>('POST', '/api/account/delete', body),
  // ---- Flames shop (lobby, signed in) ----
  /** `from` (where the shop was opened, a fixed id) is sent on the first load of a visit only: it is only used for the shop_open statistic. */
  lobbyShop: (country?: string | null, from?: ShopFromId) => {
    const q = [country ? `country=${encodeURIComponent(country)}` : '', from ? `from=${from}` : ''].filter(Boolean).join('&');
    return lobbyRequest<ShopResponse>('GET', `${lobbyApiBase}/shop${q ? `?${q}` : ''}`);
  },
  /** Small: the balance shown in the world's account menu. */
  lobbyShopBalance: () => lobbyRequest<ShopBalanceResponse>('GET', `${lobbyApiBase}/shop/balance`),
  lobbyCheckout: (body: ShopCheckoutRequest) => lobbyRequest<ShopCheckoutResponse>('POST', `${lobbyApiBase}/shop/checkout`, body),
  lobbySpend: (body: ShopSpendRequest) => lobbyRequest<ShopResponse>('POST', `${lobbyApiBase}/shop/spend`, body),
  /** Self-declared age group, once per account (before the first purchase). */
  lobbyShopAge: (body: ShopAgeRequest) => lobbyRequest<ShopResponse>('POST', `${lobbyApiBase}/shop/age`, body),
  /** Pay open dispute fees: answers a Stripe checkout address like a purchase. */
  lobbyShopSettle: () => lobbyRequest<ShopCheckoutResponse>('POST', `${lobbyApiBase}/shop/settle`, {}),
  /** The "Share play stats" switch of the account (anonymous play statistics, default on). Answers the account. */
  lobbyShareStats: (share: boolean) => lobbyRequest<LobbyMeResponse>('POST', `${lobbyApiBase}/account/share-stats`, { share } satisfies LobbyShareStatsRequest),
  lobbyWorlds: () => lobbyRequest<LobbyWorldsResponse>('GET', `${lobbyApiBase}/worlds`),
  /** Signed-out homepage strip: open and full worlds, public fields only. */
  lobbyPublicWorlds: () => lobbyRequest<PublicWorldsResponse>('GET', `${lobbyApiBase}/worlds/public`),
  lobbyHallOfFame: () => lobbyRequest<HallOfFameResponse>('GET', `${lobbyApiBase}/hall-of-fame`),
  lobbyEnter: (id: string) => lobbyRequest<EnterWorldResponse>('POST', `${lobbyApiBase}/worlds/${encodeURIComponent(id)}/enter`, {}),
  /** Hand the entry pass to the world (same origin: sets its session cookie). The pass travels in the body only. */
  worldEnter: (worldPath: string, pass: string): Promise<MeResponse> => {
    const safe = safeWorldPath(worldPath);
    if (safe === null) return Promise.reject(new ApiRequestError('server_error', 'This world has an invalid address.', 0));
    return send<MeResponse>('POST', `${safe}api/auth/enter`, { pass } satisfies EnterPassRequest);
  },
  /** Public facts about this world, including whether it only accepts lobby entry passes. */
  worldInfo: () => request<WorldInfoResponse>('GET', '/api/world/info'),
  /** The rules of this world (public, read-only): speeds, protection, conquest, queues, features. */
  worldConfig: () => request<WorldConfigResponse>('GET', '/api/world/config'),
  me: () => request<MeResponse>('GET', '/api/auth/me'),
  login: (body: AuthRequest) => request<MeResponse>('POST', '/api/auth/login', body),
  register: (body: AuthRequest) => request<MeResponse>('POST', '/api/auth/register', body),
  sandboxMax: () => request<GameStateResponse>('POST', '/api/sandbox/max', {}),
  sandboxWarp: (seconds: number) => request<GameStateResponse>('POST', '/api/sandbox/warp', { seconds }),
  sandboxFinish: () => request<GameStateResponse>('POST', '/api/sandbox/finish', {}),
  sandboxClearArmy: () => request<GameStateResponse>('POST', '/api/sandbox/clear-army', {}),
  sandboxClearAbandoned:() => request<GameStateResponse>('POST', '/api/sandbox/clear-abandoned', {}),
  sandboxReset: () => request<GameStateResponse>('POST', '/api/sandbox/reset', {}),
  logout: () => request<void>('POST', '/api/auth/logout', {}),
  setChieftain: (chieftain: string) => request<MeResponse>('POST', '/api/me/chieftain', { chieftain } satisfies ChieftainRequest),
  /** Analytics: this page was opened for the first time this session. 204; the server decides whether anything is sent. */
  statsPage: (page: StatsPageId) => request<void>('POST', '/api/stats/page', { page }),
  claimFirstStep: (id: FirstStepId, villageId: number) =>
    request<FirstStepClaimResponse>('POST', `/api/first-steps/${id}/claim`, { villageId } satisfies FirstStepClaimRequest),
  setFirstStepsHidden: (hidden: boolean) =>
    request<FirstStepsDto>('POST', '/api/first-steps/hidden', { hidden } satisfies FirstStepHiddenRequest),
  dismissAbandonedNotice: () => request<MeResponse>('POST', '/api/me/abandoned-notice/dismiss', {}),
  setHousehold: (shared: boolean) => request<MeResponse>('POST', '/api/me/household', { shared } satisfies HouseholdRequest),
  state: () => request<GameStateResponse>('GET', '/api/state'),
  /** Every village of mine, light (name, points, hearth, incoming attack, protection, stock). */
  villages: () => request<VillageListResponse>('GET', '/api/villages'),
  renameVillage: (villageId: number, name: string) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/rename`, { name } satisfies RenameVillageRequest),
  build: (villageId: number, building: string) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/build`, { building } satisfies BuildRequest),
  cancelBuild: (villageId: number, index: number) =>
    request<CancelResponse>('POST', `/api/villages/${villageId}/cancel-build`, { index } satisfies CancelBuildRequest),
  cancelTrain: (villageId: number, building: string, index: number) =>
    request<CancelResponse>('POST', `/api/villages/${villageId}/cancel-train`, { building, index } satisfies CancelTrainRequest),
  cancelResearch: (villageId: number, index: number) =>
    request<CancelResponse>('POST', `/api/villages/${villageId}/cancel-research`, { index } satisfies CancelResearchRequest),
  train: (villageId: number, unit: string, count: number) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/train`, { unit, count } satisfies TrainRequest),
  research: (villageId: number, unit: string) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/research`, { unit } satisfies ResearchRequest),
  rank: (villageId: number, unit: string, track: string) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/rank`, { unit, track } satisfies RankRequest),
  respec: (villageId: number, unit: string, track: string) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/respec`, { unit, track } satisfies RankRequest),
  /** Send resources to my other village, a tribe-mate or an ally. */
  ship: (villageId: number, body: SendShipmentRequest) =>
    request<SendShipmentResponse>('POST', `/api/villages/${villageId}/ship`, body),
  send: (villageId: number, body: SendRequest) => request<SendResponse>('POST', `/api/villages/${villageId}/send`, body),
  /** Bring support troops home; omit `units` for all of them (the owner of the troops). */
  recall: (stationedId: number, units?: Partial<Units>) =>
    request<MovementResponse>('POST', `/api/stationed/${stationedId}/recall`, (units ? { units } : {}) satisfies RecallRequest),
  /** Send someone else's support troops home (the owner of the host village). */
  cancelMovement: (movementId: number) => request<MovementResponse>('POST', `/api/movements/${movementId}/cancel`, {}),
  /** Bring my troops home from a map site (the owner of the troops); omit `units` for all of them. */
  siteRecall: (siteId: number, villageId: number, units?: Partial<Units>) =>
    request<MovementResponse>('POST', `/api/sites/${siteId}/recall`, { villageId, ...(units ? { units } : {}) } satisfies SiteRecallRequest),
  sendBack: (stationedId: number) => request<MovementResponse>('POST', `/api/stationed/${stationedId}/send-back`, {}),
  map: (x: number, y: number, w: number, h: number) => request<MapResponse>('GET', `/api/map?x=${x}&y=${y}&w=${w}&h=${h}`),
  /** Command post: villages by village or player name (max 10). `fromVillageId` (one of mine) sorts nearest first. */
  searchVillages: (q: string, by: SearchVillagesBy, fromVillageId?: number) =>
    request<SearchVillagesResponse>('GET', `/api/search/villages?q=${encodeURIComponent(q)}&by=${by}${fromVillageId === undefined ? '' : `&from=${fromVillageId}`}`),
  /** Incoming attack / support / resources warnings for my villages, newest first (GAME_DESIGN 18.10). Never carries units. */
  getNotifications: () => request<NotificationsResponse>('GET', '/api/notifications'),
  /** Mark the given notifications read, or all of them when `ids` is left out. */
  markNotificationsRead: (ids?: number[]) =>
    request<NotificationsResponse>('POST', '/api/notifications/read', (ids ? { ids } : {}) satisfies NotificationsReadRequest),
  /** Saved troop groups (a send-form convenience): mine only, oldest first. */
  troopGroups: () => request<TroopGroupsResponse>('GET', '/api/troop-groups'),
  createTroopGroup: (body: TroopGroupRequest) => request<TroopGroupResponse>('POST', '/api/troop-groups', body),
  updateTroopGroup: (id: number, body: TroopGroupRequest) => request<TroopGroupResponse>('POST', `/api/troop-groups/${id}`, body),
  deleteTroopGroup: (id: number) => request<void>('POST', `/api/troop-groups/${id}/delete`, {}),
  /** Realm overview: all my villages in one request (read-only). */
  realm: () => request<RealmResponse>('GET', '/api/realm'),
  /** My private notes and tags on villages and players, newest edit first. */
  notes: () => request<NotesResponse>('GET', '/api/notes'),
  saveNote: (body: NoteRequest) => request<NoteResponse>('POST', '/api/notes', body),
  deleteNote: (id: number) => request<void>('POST', `/api/notes/${id}/delete`, {}),
  // ---- Raid lists (a paid extra; GET works for everyone and says `enabled` / `entitled`) ----
  autoOverview: () => request<AutoOverviewResponse>('GET', '/api/auto'),
  autoSettings: (villageId: number, body: AutoSettingsRequest) => request<AutoVillageDto>('POST', `/api/villages/${villageId}/auto`, body),
  raidLists: () => request<RaidListsResponse>('GET', '/api/raid-lists'),
  createRaidList: (name: string) => request<RaidListResponse>('POST', '/api/raid-lists', { name } satisfies RaidListRequest),
  renameRaidList: (id: number, name: string) => request<RaidListResponse>('POST', `/api/raid-lists/${id}`, { name } satisfies RaidListRequest),
  deleteRaidList: (id: number) => request<void>('POST', `/api/raid-lists/${id}/delete`, {}),
  addRaidRow: (listId: number, body: RaidRowRequest) => request<RaidListResponse>('POST', `/api/raid-lists/${listId}/rows`, body),
  updateRaidRow: (listId: number, rowId: number, body: RaidRowUpdateRequest) =>
    request<RaidListResponse>('POST', `/api/raid-lists/${listId}/rows/${rowId}`, body),
  deleteRaidRow: (listId: number, rowId: number) => request<RaidListResponse>('POST', `/api/raid-lists/${listId}/rows/${rowId}/delete`, {}),
  /** One request for the ticked rows; omit `rowIds` for the whole list. */
  sendRaidList: (listId: number, body: RaidListSendRequest = {}) => request<RaidListSendResponse>('POST', `/api/raid-lists/${listId}/send`, body),
  reports: () => request<ReportListResponse>('GET', '/api/reports'),
  report: (id: number) => request<ReportDto>('GET', `/api/reports/${id}`),
  mailList: (box: MailBox, before?: number) =>
    request<MailListResponse>('GET', `/api/mail?box=${box}${before === undefined ? '' : `&before=${before}`}`),
  /** The public domination bar data (leader, share, streak, why it does not count yet). */
  domination: () => request<DominationStatusDto>('GET', '/api/domination'),
  /** { ended: null } while the world runs; the frozen results once it ended. */
  worldEnd: () => request<WorldEndResponse>('GET', '/api/world-end'),
  /** Great Fire and Fire Shrines. May answer 404 on an older server: callers treat a failure as "no sites". */
  sites: () => request<SitesResponse>('GET', '/api/sites'),
  /** Premium wide overview: light rows for the whole world (403 without the extra). */
  mapOverview: () => request<MapOverviewResponse>('GET', '/api/map/overview'),
  /** My own newest scout report with building levels on a village (Firecart picker); both fields null when none. */
  scouted: (villageId: number) => request<ScoutedResponse>('GET', `/api/scouted/${villageId}`),
  intel: (villageId: number) => request<VillageIntelDto>('GET', `/api/intel/${villageId}`),
  /** Mail as conversations (one row per person), newest first, 20 per page. */
  mailConversations: (page = 0) => request<MailConversationsResponse>('GET', `/api/mail/conversations?page=${page}`),
  /** The letters with one player, both directions, newest first. */
  mailThread: (playerId: number, before?: number, limit = 30) =>
    request<MailThreadResponse>('GET', `/api/mail/conversation/${playerId}?limit=${limit}${before === undefined ? '' : `&before=${before}`}`),
  markConversationRead: (playerId: number) => request<MailConversationReadResponse>('POST', `/api/mail/conversation/${playerId}/read`, {}),
  /** Hides the whole conversation for me only. */
  deleteConversation: (playerId: number) => request<void>('POST', `/api/mail/conversation/${playerId}/delete`, {}),
  mail: (id: number) => request<MailDto>('GET', `/api/mail/${id}`),
  sendMail: (body: SendMailRequest) => request<MailDto>('POST', '/api/mail', body),
  deleteMail: (id: number) => request<void>('DELETE', `/api/mail/${id}`),


  // ---- Tribes ----
  tribes: (q: string) => request<TribeListResponse>('GET', `/api/tribes${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  playerRanking: () => request<PlayerRankingResponse>('GET', '/api/rankings/players'),
  renownRanking: () => request<RenownRankingResponse>('GET', '/api/rankings/renown'),
  fighterRanking: (scope: FighterScope, kind: FighterKind) => request<FighterRankingResponse>('GET', `/api/rankings/fighters?scope=${scope}&kind=${kind}`),
  feastsOverview: () => request<FeastOverviewResponse>('GET', '/api/feasts'),
  feastAll: (villages: FeastAllRequest['villages']) =>
    request<FeastAllResponse>('POST', '/api/feasts', { villages } satisfies FeastAllRequest),
  feast: (villageId: number, count: number) =>
    request<FeastResponse>('POST', `/api/villages/${villageId}/feast`, { count } satisfies FeastRequest),
  chestDeposit: (villageId: number, gold: number) =>
    request<ChestDepositResponse>('POST', `/api/villages/${villageId}/chest`, { gold } satisfies ChestDepositRequest),
  playerProfile: (id: number) => request<PlayerProfileDto>('GET', `/api/players/${id}`),
  tribe: (id: number) => request<TribeDto>('GET', `/api/tribes/${id}`),
  myTribe: () => request<MyTribeResponse>('GET', '/api/tribe'),
  createTribe: (body: CreateTribeRequest) => request<MyTribeResponse>('POST', '/api/tribes', body),
  joinTribe: (id: number) => request<MyTribeResponse>('POST', `/api/tribes/${id}/join`, {}),
  applyToTribe: (id: number, message: string) =>
    request<MyTribeResponse>('POST', `/api/tribes/${id}/apply`, { message } satisfies ApplyRequest),
  acceptInvite: (id: number) => request<MyTribeResponse>('POST', `/api/invites/${id}/accept`, {}),
  declineInvite: (id: number) => request<MyTribeResponse>('POST', `/api/invites/${id}/decline`, {}),
  withdrawApplication: (id: number) => request<MyTribeResponse>('POST', `/api/applications/${id}/withdraw`, {}),
  tribeSettings: (body: TribeSettingsRequest) => request<MyTribeResponse>('POST', '/api/tribe/settings', body),
  invitePlayer: (username: string) => request<MyTribeResponse>('POST', '/api/tribe/invites', { username } satisfies InviteRequest),
  cancelInvite: (id: number) => request<MyTribeResponse>('POST', `/api/tribe/invites/${id}/cancel`, {}),
  acceptApplication: (id: number) => request<MyTribeResponse>('POST', `/api/tribe/applications/${id}/accept`, {}),
  declineApplication: (id: number) => request<MyTribeResponse>('POST', `/api/tribe/applications/${id}/decline`, {}),
  kickMember: (playerId: number) => request<MyTribeResponse>('POST', `/api/tribe/members/${playerId}/kick`, {}),
  setMemberRole: (playerId: number, role: Exclude<TribeRole, 'leader'>) =>
    request<MyTribeResponse>('POST', `/api/tribe/members/${playerId}/role`, { role } satisfies RoleRequest),
  transferLeadership: (playerId: number) =>
    request<MyTribeResponse>('POST', '/api/tribe/transfer', { playerId } satisfies TransferRequest),
  leaveTribe: () => request<MyTribeResponse>('POST', '/api/tribe/leave', {}),
  disbandTribe: () => request<MyTribeResponse>('POST', '/api/tribe/disband', {}),
  proposeDiplomacy: (tag: string, kind: DiplomacyKind) =>
    request<MyTribeResponse>('POST', '/api/tribe/diplomacy', { tag, kind } satisfies DiplomacyRequest),
  acceptProposal: (id: number) => request<MyTribeResponse>('POST', `/api/tribe/diplomacy/proposals/${id}/accept`, {}),
  declineProposal: (id: number) => request<MyTribeResponse>('POST', `/api/tribe/diplomacy/proposals/${id}/decline`, {}),
  withdrawProposal: (id: number) => request<MyTribeResponse>('POST', `/api/tribe/diplomacy/proposals/${id}/withdraw`, {}),
  cancelRelation: (id: number) => request<MyTribeResponse>('POST', `/api/tribe/diplomacy/relations/${id}/cancel`, {}),
  tribeProjects: () => request<TribeProjectsResponse>('GET', '/api/tribe/projects'),
  setStoreVillage: (villageId: number) => request<TribeProjectsResponse>('POST', '/api/tribe/projects/store-village', { villageId }),
  startProject: (project: TribeProjectId) => request<TribeProjectsResponse>('POST', '/api/tribe/projects/start', { project }),
  cancelProject: () => request<TribeProjectsResponse>('POST', '/api/tribe/projects/cancel', {}),
  tribeAlerts: () => request<TribeAlertsResponse>('GET', '/api/tribe/alerts'),
  sightings: () => request<LookoutSightingsResponse>('GET', '/api/tribe/sightings'),
  chat: (after?: number) => request<ChatResponse>('GET', `/api/tribe/chat${after ? `?after=${after}` : ''}`),
  setGrants: (playerId: number, grants: TribeAction[]) => request<TribeMemberDto>('PUT', `/api/tribe/members/${playerId}/permissions`, { grants }),
  forumBoards: () => request<ForumBoardsResponse>('GET', '/api/tribe/forum/boards'),
  forumCreateBoard: (name: string, visibility: string, postRule: string) => request<ForumBoardDto>('POST', '/api/tribe/forum/boards', { name, visibility, postRule }),
  forumUpdateBoard: (id: number, patch: { name?: string; visibility?: string; postRule?: string }) => request<ForumBoardDto>('PUT', `/api/tribe/forum/boards/${id}`, patch),
  forumDeleteBoard: (id: number) => request<void>('DELETE', `/api/tribe/forum/boards/${id}`),
  forumThreads: (boardId: number, page: number) => request<ForumThreadsResponse>('GET', `/api/tribe/forum/boards/${boardId}/threads?page=${page}`),
  forumNewThread: (boardId: number, title: string, body: string) => request<ForumThreadResponse>('POST', `/api/tribe/forum/boards/${boardId}/threads`, { title, body }),
  forumThread: (id: number, page: number) => request<ForumThreadResponse>('GET', `/api/tribe/forum/threads/${id}?page=${page}`),
  forumUpdateThread: (id: number, patch: { pinned?: boolean; locked?: boolean }) => request<unknown>('PUT', `/api/tribe/forum/threads/${id}`, patch),
  forumDeleteThread: (id: number) => request<void>('DELETE', `/api/tribe/forum/threads/${id}`),
  forumReply: (threadId: number, body: string) => request<ForumPostDto>('POST', `/api/tribe/forum/threads/${threadId}/posts`, { body }),
  forumEditPost: (id: number, body: string) => request<ForumPostDto>('PUT', `/api/tribe/forum/posts/${id}`, { body }),
  forumDeletePost: (id: number) => request<void>('DELETE', `/api/tribe/forum/posts/${id}`),
  sendChat: (text: string) => request<ChatMessageDto>('POST', '/api/tribe/chat', { text } satisfies ChatRequest),

  // ---- Support and reports (player) ----
  createTicket: (body: CreateTicketRequest) => request<TicketDto>('POST', '/api/tickets', body),
  tickets: () => request<TicketListResponse>('GET', '/api/tickets'),
  ticket: (id: number) => request<TicketDto>('GET', `/api/tickets/${id}`),
  replyTicket: (id: number, body: string) => request<TicketDto>('POST', `/api/tickets/${id}/messages`, { body } satisfies TicketReplyRequest),
  closeTicket: (id: number) => request<TicketDto>('POST', `/api/tickets/${id}/close`, {}),
  reportMessage: (body: CreateMessageReportRequest) => request<MessageReportReceipt>('POST', '/api/reports', body),

  // ---- Staff ----
  staffTickets: (f: { status?: TicketStatus; category?: TicketCategory; assignee?: number; unassigned?: boolean; offset?: number }) => {
    const q = new URLSearchParams();
    if (f.status) q.set('status', f.status);
    if (f.category) q.set('category', f.category);
    if (f.assignee !== undefined) q.set('assignee', String(f.assignee));
    if (f.unassigned) q.set('unassigned', '1');
    if (f.offset) q.set('offset', String(f.offset));
    const s = q.toString();
    return request<StaffTicketListResponse>('GET', `/api/staff/tickets${s ? `?${s}` : ''}`);
  },
  staffTicket: (id: number) => request<StaffTicketDto>('GET', `/api/staff/tickets/${id}`),
  staffReplyTicket: (id: number, body: StaffTicketReplyRequest) => request<StaffTicketDto>('POST', `/api/staff/tickets/${id}/messages`, body),
  staffAssignTicket: (id: number, assigneeId: number | null) =>
    request<StaffTicketDto>('POST', `/api/staff/tickets/${id}/assign`, { assigneeId } satisfies AssignTicketRequest),
  staffTicketStatus: (id: number, status: TicketStatus) =>
    request<StaffTicketDto>('POST', `/api/staff/tickets/${id}/status`, { status } satisfies TicketStatusRequest),
  staffTicketPriority: (id: number, priority: TicketPriority) =>
    request<StaffTicketDto>('POST', `/api/staff/tickets/${id}/priority`, { priority } satisfies TicketPriorityRequest),
  staffTemplates: () => request<TemplateListResponse>('GET', '/api/staff/templates'),
  staffReports: (f: { status?: MessageReportStatus; category?: MessageReportCategory; before?: number }) => {
    const q = new URLSearchParams();
    if (f.status) q.set('status', f.status);
    if (f.category) q.set('category', f.category);
    if (f.before !== undefined) q.set('before', String(f.before));
    const s = q.toString();
    return request<StaffReportListResponse>('GET', `/api/staff/reports${s ? `?${s}` : ''}`);
  },
  staffResolveReport: (id: number, body: ResolveReportRequest) => request<StaffReportDto>('POST', `/api/staff/reports/${id}/resolve`, body),
  staffPlayers: (query: string) => request<StaffPlayerListResponse>('GET', `/api/staff/players?query=${encodeURIComponent(query)}`),
  staffPlayer: (id: number) => request<StaffPlayerDetailDto>('GET', `/api/staff/players/${id}`),
  staffMute: (id: number, body: MuteRequest) => request<StaffPlayerDetailDto>('POST', `/api/staff/players/${id}/mute`, body),
  staffUnmute: (id: number) => request<StaffPlayerDetailDto>('POST', `/api/staff/players/${id}/unmute`, {}),
  staffBan: (id: number, body: BanRequest) => request<StaffPlayerDetailDto>('POST', `/api/staff/players/${id}/ban`, body),
  staffUnban: (id: number) => request<StaffPlayerDetailDto>('POST', `/api/staff/players/${id}/unban`, {}),
  staffWarn: (id: number, body: WarnRequest) => request<StaffPlayerDetailDto>('POST', `/api/staff/players/${id}/warn`, body),
  staffMulti: (all = false) => request<MultiGroupsResponse>('GET', `/api/staff/multi${all ? '?all=1' : ''}`),
  staffMultiReview: (key: string) => request<MultiGroupsResponse>('POST', '/api/staff/multi/review', { key } satisfies MultiReviewRequest),
  staffAudit: (f: { player?: number; before?: number }) => {
    const q = new URLSearchParams();
    if (f.player !== undefined) q.set('player', String(f.player));
    if (f.before !== undefined) q.set('before', String(f.before));
    const s = q.toString();
    return request<AuditListResponse>('GET', `/api/staff/audit${s ? `?${s}` : ''}`);
  },
};
