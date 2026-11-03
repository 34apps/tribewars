// Typed fetch wrapper for the Clanfire HTTP API (contract: packages/engine/src/api.ts).

import type {
  ApiError,
  ApplyRequest,
  AuthRequest,
  BuildRequest,
  ChieftainRequest,
  HouseholdRequest,
  ChatMessageDto,
  ChatRequest,
  ChatResponse,
  CreateTribeRequest,
  DiplomacyKind,
  DiplomacyRequest,
  GameErrorCode,
  GameStateResponse,
  InviteRequest,
  MailBox,
  MailDto,
  MailListResponse,
  MapResponse,
  MeResponse,
  MovementResponse,
  MyTribeResponse,
  OwnVillageDto,
  ReportDto,
  RecallRequest,
  RankRequest,
  ResearchRequest,
  ReportListResponse,
  SendMailRequest,
  SendRequest,
  RoleRequest,
  SendResponse,
  SendShipmentRequest,
  SendShipmentResponse,
  TrainRequest,
  TransferRequest,
  TribeAlertsResponse,
  TribeDto,
  PlayerProfileDto,
  PlayerRankingResponse,
  TribeListResponse,
  TribeRole,
  TribeSettingsRequest,
  Units,
} from '@clanfire/engine';
import type {
  ForumBoardDto,
  ForumBoardsResponse,
  ForumPostDto,
  ForumThreadResponse,
  ForumThreadsResponse,
  TribeAction,
  TribeMemberDto,
} from '@clanfire/engine';

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

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: method === 'GET' ? 'no-store' : 'default',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
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
    throw new ApiRequestError(err.error ?? 'server_error', err.message ?? fallback, res.status);
  }
  return payload as T;
}

export const api = {
  me: () => request<MeResponse>('GET', '/api/auth/me'),
  login: (body: AuthRequest) => request<MeResponse>('POST', '/api/auth/login', body),
  register: (body: AuthRequest) => request<MeResponse>('POST', '/api/auth/register', body),
  sandboxMax: () => request<GameStateResponse>('POST', '/api/sandbox/max', {}),
  sandboxWarp: (seconds: number) => request<GameStateResponse>('POST', '/api/sandbox/warp', { seconds }),
  sandboxClearAbandoned: () => request<GameStateResponse>('POST', '/api/sandbox/clear-abandoned', {}),
  sandboxReset: () => request<GameStateResponse>('POST', '/api/sandbox/reset', {}),
  logout: () => request<void>('POST', '/api/auth/logout', {}),
  setChieftain: (chieftain: string) => request<MeResponse>('POST', '/api/me/chieftain', { chieftain } satisfies ChieftainRequest),
  dismissAbandonedNotice: () => request<MeResponse>('POST', '/api/me/abandoned-notice/dismiss', {}),
  setHousehold: (shared: boolean) => request<MeResponse>('POST', '/api/me/household', { shared } satisfies HouseholdRequest),
  state: () => request<GameStateResponse>('GET', '/api/state'),
  build: (villageId: number, building: string) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/build`, { building } satisfies BuildRequest),
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
  sendBack: (stationedId: number) => request<MovementResponse>('POST', `/api/stationed/${stationedId}/send-back`, {}),
  map: (x: number, y: number, w: number, h: number) => request<MapResponse>('GET', `/api/map?x=${x}&y=${y}&w=${w}&h=${h}`),
  reports: () => request<ReportListResponse>('GET', '/api/reports'),
  report: (id: number) => request<ReportDto>('GET', `/api/reports/${id}`),
  mailList: (box: MailBox, before?: number) =>
    request<MailListResponse>('GET', `/api/mail?box=${box}${before === undefined ? '' : `&before=${before}`}`),
  mail: (id: number) => request<MailDto>('GET', `/api/mail/${id}`),
  sendMail: (body: SendMailRequest) => request<MailDto>('POST', '/api/mail', body),
  deleteMail: (id: number) => request<void>('DELETE', `/api/mail/${id}`),


  // ---- Tribes ----
  tribes: (q: string) => request<TribeListResponse>('GET', `/api/tribes${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  playerRanking: () => request<PlayerRankingResponse>('GET', '/api/rankings/players'),
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
  tribeAlerts: () => request<TribeAlertsResponse>('GET', '/api/tribe/alerts'),
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
};
