// Security headers and per-account route limits (docs/SECURITY_ROADMAP.md, Phase 1).

/**
 * Content-Security-Policy for the game. Mirror any change in docs/DEPLOYMENT_PLAN.md (CloudFront policy).
 * Two hosts are allowed beyond 'self' only because apps/web/index.html still loads its fonts from
 * Google Fonts (stylesheet from fonts.googleapis.com, font files from fonts.gstatic.com).
 * Self-hosting the fonts (NEXT_STEPS.md) lets both be removed. No inline script, no eval.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self' https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export const PERMISSIONS_POLICY = [
  'accelerometer',
  'autoplay',
  'camera',
  'display-capture',
  'geolocation',
  'gyroscope',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'usb',
  'xr-spatial-tracking',
]
  .map((f) => `${f}=()`)
  .join(', ');

/** One year, subdomains too. Sent only in production (behind TLS). */
export const HSTS = 'max-age=31536000; includeSubDomains';

/**
 * Per-account limits, requests per minute, ON TOP of the global per-IP / per-session limits.
 * Keyed by player account id (not session, so many logins or IPs cannot multiply them).
 * A human clicking fast stays far below these; a script hammering one action hits them within seconds.
 */
export const ROUTE_LIMIT_WINDOW_MS = 60_000;
export const ROUTE_LIMITS = {
  send: 60, // send troops, recall, send back, cancel a movement
  build: 60, // start or cancel construction
  train: 60, // start or cancel training
  research: 30, // start or cancel research
  market: 30, // resource shipments
  feast: 30, // Feast (resources into Renown)
  chest: 30, // War Chest deposit (village gold into the chest)
  village: 30, // rename a village, the light village list
  tribe: 60, // every tribe write: create, join, invites, members, diplomacy, ...
  mail: 60, // all mail calls (sending has its own gaps in mail-service)
  search: 60, // tribe search / list, player profiles
  lookup: 30, // command post village / player name search, own scout intel on a village
  rankings: 30, // player and Renown rankings
  world: 30, // domination status (a few ranking queries), the world end screen, the site list and Lookout sightings
  notifications: 60, // incoming-attack notifications: list and mark read
  groups: 30, // saved troop groups: list, create, update, delete
  firststeps: 30, // first steps card: claim, hide
  projects: 30, // tribe projects: read the store and ledger, store village, start and cancel a project
} as const;
export type RouteBucket = keyof typeof ROUTE_LIMITS;

const RULES: { bucket: RouteBucket; test: RegExp; methods?: readonly string[] }[] = [
  { bucket: 'send', test: /^\/api\/(villages\/:id\/send|movements\/:id\/cancel|stationed\/:id\/(recall|send-back)|sites\/:id\/recall)$/ },
  { bucket: 'build', test: /^\/api\/villages\/:id\/(build|cancel-build)$/ },
  { bucket: 'train', test: /^\/api\/villages\/:id\/(train|cancel-train)$/ },
  { bucket: 'research', test: /^\/api\/villages\/:id\/(research|cancel-research)$/ },
  { bucket: 'market', test: /^\/api\/villages\/:id\/ship$/ },
  { bucket: 'feast', test: /^\/api\/villages\/:id\/feast$/ },
  { bucket: 'chest', test: /^\/api\/villages\/:id\/chest$/ },
  { bucket: 'village', test: /^\/api\/villages(\/:id\/rename)?$/ },
  { bucket: 'mail', test: /^\/api\/mail(\/|$)/ },
  { bucket: 'groups', test: /^\/api\/troop-groups(\/|$)/ },
  { bucket: 'firststeps', test: /^\/api\/first-steps(\/|$)/ },
  { bucket: 'notifications', test: /^\/api\/notifications(\/|$)/ },
  { bucket: 'search', test: /^\/api\/(tribes(\/:id)?|players\/:id)$/, methods: ['GET', 'HEAD'] },
  { bucket: 'lookup', test: /^\/api\/(search\/villages|scouted\/:id)$/, methods: ['GET', 'HEAD'] },
  { bucket: 'rankings', test: /^\/api\/rankings\// },
  { bucket: 'world', test: /^\/api\/(domination|world-end|sites|tribe\/sightings)$/ },
  { bucket: 'projects', test: /^\/api\/tribe\/projects(\/|$)/ },
  { bucket: 'tribe', test: /^\/api\/(tribes|tribe|invites|applications)(\/|$)/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
];

/**
 * The Origin check shared by writes (app.ts) and the WebSocket upgrade (live.ts): a request without an Origin header
 * (not a browser) passes; otherwise the Origin host must equal the Host header or its scheme://host[:port] must be in
 * `allowed` (lowercase; ALLOWED_ORIGINS for CDN/load balancer setups). "null" and garbage are refused.
 */
export function originAllowed(origin: string | undefined, host: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (origin === undefined) return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  return u.host.toLowerCase() === (host ?? '').toLowerCase() || allowed.has(u.origin.toLowerCase());
}

/** Which limit bucket a matched route pattern (e.g. `/api/villages/:id/send`) belongs to, if any. */
export function routeBucket(method: string, pattern: string): RouteBucket | null {
  for (const r of RULES) {
    if (r.test.test(pattern) && (!r.methods || r.methods.includes(method))) return r.bucket;
  }
  return null;
}
