// The ONE place that decides which AccountDataHooks the lobby runs with (index.ts and admin.ts both import it).
// The Flames shop session replaces `noopHooks` here with its implementation.

import { noopHooks, type AccountDataHooks } from './account-hooks.ts';

export const lobbyHooks: AccountDataHooks = noopHooks;
