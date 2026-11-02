// Typed fetch wrapper for the TribeWars HTTP API (contract: packages/engine/src/api.ts).

import type {
  ApiError,
  AuthRequest,
  BuildRequest,
  GameErrorCode,
  GameStateResponse,
  MapResponse,
  MeResponse,
  OwnVillageDto,
  ReportDto,
  ReportListResponse,
  SendRequest,
  SendResponse,
  TrainRequest,
} from '@tribewars/engine';

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
  state: () => request<GameStateResponse>('GET', '/api/state'),
  build: (villageId: number, building: string) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/build`, { building } satisfies BuildRequest),
  train: (villageId: number, unit: string, count: number) =>
    request<OwnVillageDto>('POST', `/api/villages/${villageId}/train`, { unit, count } satisfies TrainRequest),
  send: (villageId: number, body: SendRequest) => request<SendResponse>('POST', `/api/villages/${villageId}/send`, body),
  map: (x: number, y: number, w: number, h: number) => request<MapResponse>('GET', `/api/map?x=${x}&y=${y}&w=${w}&h=${h}`),
  reports: () => request<ReportListResponse>('GET', '/api/reports'),
  report: (id: number) => request<ReportDto>('GET', `/api/reports/${id}`),
};
