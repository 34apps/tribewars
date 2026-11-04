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
  tribe: 60, // every tribe write: create, join, invites, members, diplomacy, ...
  mail: 60, // all mail calls (sending has its own gaps in mail-service)
  search: 60, // tribe search / list, player profiles
  rankings: 30, // player ranking
} as const;
export type RouteBucket = keyof typeof ROUTE_LIMITS;

const RULES: { bucket: RouteBucket; test: RegExp; methods?: readonly string[] }[] = [
  { bucket: 'send', test: /^\/api\/(villages\/:id\/send|movements\/:id\/cancel|stationed\/:id\/(recall|send-back))$/ },
  { bucket: 'build', test: /^\/api\/villages\/:id\/(build|cancel-build)$/ },
  { bucket: 'train', test: /^\/api\/villages\/:id\/(train|cancel-train)$/ },
  { bucket: 'research', test: /^\/api\/villages\/:id\/(research|cancel-research)$/ },
  { bucket: 'market', test: /^\/api\/villages\/:id\/ship$/ },
  { bucket: 'mail', test: /^\/api\/mail(\/|$)/ },
  { bucket: 'search', test: /^\/api\/(tribes(\/:id)?|players\/:id)$/, methods: ['GET', 'HEAD'] },
  { bucket: 'rankings', test: /^\/api\/rankings\// },
  { bucket: 'tribe', test: /^\/api\/(tribes|tribe|invites|applications)(\/|$)/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
];

/** Which limit bucket a matched route pattern (e.g. `/api/villages/:id/send`) belongs to, if any. */
export function routeBucket(method: string, pattern: string): RouteBucket | null {
  for (const r of RULES) {
    if (r.test.test(pattern) && (!r.methods || r.methods.includes(method))) return r.bucket;
  }
  return null;
}
