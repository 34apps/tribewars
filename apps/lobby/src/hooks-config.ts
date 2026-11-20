// The ONE place that decides which AccountDataHooks the lobby runs with (index.ts and admin.ts both import it).

import type { AccountDataHooks } from './account-hooks.ts';
import { createShopAccountDataHooks } from './shop/account-data-hooks.ts';

export const lobbyHooks: AccountDataHooks = createShopAccountDataHooks();
