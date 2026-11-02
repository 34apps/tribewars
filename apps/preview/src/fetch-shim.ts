// Routes the web client's relative /api/* requests to the in-browser backend; anything else goes to the real fetch.

import type { Backend } from './backend.ts';

function apiPath(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') {
    if (input === '/api' || input.startsWith('/api/') || input.startsWith('/api?')) return input;
  }
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, window.location.href);
    if (u.protocol === window.location.protocol && u.host === window.location.host && (u.pathname === '/api' || u.pathname.startsWith('/api/'))) {
      return u.pathname + u.search;
    }
  } catch {
    // not a URL we understand: fall through to the real fetch
  }
  return null;
}

export function installFetchShim(backend: Backend, onWrite: () => void): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = apiPath(input);
    if (path === null) return realFetch(input, init);
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    let bodyText: string | undefined;
    if (typeof init?.body === 'string') bodyText = init.body;
    else if (init?.body === undefined && typeof input === 'object' && 'text' in input && method !== 'GET') bodyText = await input.text();
    const res = await backend.request(method, path, bodyText);
    if (method !== 'GET') onWrite();
    const nullBody = res.status === 204 || res.body === null;
    return new Response(nullBody ? null : res.body, { status: res.status, headers: res.headers });
  };
}
