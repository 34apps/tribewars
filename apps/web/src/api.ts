// Typed fetch wrapper for the Clanfire HTTP API (contract: packages/engine/src/api.ts).

import type {
  ApiError,
  ApplyRequest,
  AuthRequest,
  BuildRequest,
  ChieftainRequest,
  ChatMessageDto,
  ChatRequest,
  ChatResponse,
  CreateTribeRequest,
  DiplomacyKind,
  DiplomacyRequest,
  GameErrorCode,
  GameStateResponse,
  InviteRequest,
  MapResponse,
  MeResponse,
  MovementResponse,
  MyTribeResponse,
  OwnVillageDto,
  ReportDto,
  RecallRequest,
  ReportListResponse,
  SendRequest,
  RoleRequest,
  SendResponse,
  TrainRequest,
  TransferRequest,
  TribeAlertsResponse,
  TribeDto,
  TribeListResponse,
  TribeRole,
  TribeSettingsRequest,
  Units,
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

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
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
  logout: () => request<void>('POST', '/api/auth/logout', {}),
  setChieftain: (chieftain: string) => request<MeResponse>('POST', '/api/me/chieftain', { chieftain } satisfies ChieftainRequest),
  state: () => request<GameStateResponse>('GET', '/api/state'),
  build: (villageId: number, building: string) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/build`, { building } satisfies BuildRequest),
  train: (villageId: number, unit: string, count: number) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/train`, { unit, count } satisfies TrainRequest),
  send: (villageId: number, body: SendRequest) => request<SendResponse>('POST', `/api/villages/${villageId}/send`, body),
  /** Bring support troops home; omit `units` for all of them (the owner of the troops). */
  recall: (stationedId: number, units?: Partial<Units>) =>
    request<MovementResponse>('POST', `/api/stationed/${stationedId}/recall`, (units ? { units } : {}) satisfies RecallRequest),
  /** Send someone else's support troops home (the owner of the host village). */
  sendBack: (stationedId: number) => request<MovementResponse>('POST', `/api/stationed/${stationedId}/send-back`, {}),
  map: (x: number, y: number, w: number, h: number) => request<MapResponse>('GET', `/api/map?x=${x}&y=${y}&w=${w}&h=${h}`),
  reports: () => request<ReportListResponse>('GET', '/api/reports'),
  report: (id: number) => request<ReportDto>('GET', `/api/reports/${id}`),


  // ---- Tribes ----
  tribes: (q: string) => request<TribeListResponse>('GET', `/api/tribes${q ? `?q=${encodeURIComponent(q)}` : ''}`),
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
  sendChat: (text: string) => request<ChatMessageDto>('POST', '/api/tribe/chat', { text } satisfies ChatRequest),
};
