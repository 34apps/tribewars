// Routes the web client's relative /api/* requests to the in-browser backend; anything else goes to the real fetch.

import type { Backend } from './backend.ts';

/** "/w/<id>/api/x" is the same in-browser backend as "/api/x" (the preview ignores the world prefix). */
function stripWorld(pathname: string): string {
  return pathname.replace(/^\/w\/[A-Za-z0-9-]{1,32}(?=\/api(?:[/?]|$))/, '');
}

function apiPath(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') {
    const s = stripWorld(input);
    if (s === '/api' || s.startsWith('/api/') || s.startsWith('/api?')) return s;
  }
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, window.location.href);
    const p = stripWorld(u.pathname);
    if (u.protocol === window.location.protocol && u.host === window.location.host && (p === '/api' || p.startsWith('/api/'))) {
      return p + u.search;
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
