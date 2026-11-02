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

/** fetch() of a data: URL (the client reads its bundled SVG art this way) is answered here: under a strict CSP without connect-src the browser would refuse it. */
function dataUrlResponse(url: string): Response | null {
  const m = /^data:([^,]*?)(;base64)?,([\s\S]*)$/i.exec(url);
  if (!m) return null;
  const mime = (m[1] ?? '').split(';')[0] || 'text/plain';
  const payload = m[3] ?? '';
  let body: BodyInit;
  if (m[2]) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    body = bytes;
  } else body = decodeURIComponent(payload);
  return new Response(body, { status: 200, headers: { 'content-type': mime } });
}

export function installFetchShim(backend: Backend, onWrite: () => void): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === 'string' && input.startsWith('data:')) {
      const res = dataUrlResponse(input);
      if (res) return res;
    }
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
