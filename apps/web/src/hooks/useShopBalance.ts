import { useEffect, useState } from 'react';
import type { ShopBalanceResponse } from '@clanfire/engine';
import { api } from '../api.ts';

/** The account's Flames balance for menus, best effort: null while loading and when the call fails (no lobby, signed out). */
export function useShopBalance(enabled = true): ShopBalanceResponse | null {
  const [value, setValue] = useState<ShopBalanceResponse | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api.lobbyShopBalance().then(
      (r) => !cancelled && typeof r?.balance === 'number' && setValue(r),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return value;
}
