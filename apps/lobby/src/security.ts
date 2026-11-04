// Security headers and the Origin check (docs/SECURITY_ROADMAP.md). Copied from apps/server/src/security.ts; keep in sync.

/** Content-Security-Policy. The lobby serves JSON only, but the same strict policy costs nothing. */
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
 * The Origin check for writes: a request without an Origin header (not a browser) passes; otherwise the Origin host must
 * equal the Host header or its scheme://host[:port] must be in `allowed` (lowercase; ALLOWED_ORIGINS for CDN/load balancer
 * setups). "null" and garbage are refused.
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
