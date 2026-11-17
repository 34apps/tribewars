// Sessions in the preview never expire. The real server counts session lifetime in game time (auth.ts), and this world's clock
// runs up to 1000x, so the owner would be signed out after 60 game days (about 86 real minutes at 1000x).

import { sha256Hex, type AuthService } from '../../server/src/auth.ts';
import type { Store } from '../../server/src/store.ts';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function neverExpireSessions(auth: AuthService, store: Store): void {
  auth.authenticate = (token) => (token && TOKEN_RE.test(token) ? store.getSessionPlayer(sha256Hex(token), 0) : null);
  store.deleteExpiredSessions = () => {};
}
