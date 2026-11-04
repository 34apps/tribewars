import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { settleVillage } from '@clanfire/engine';
import type { Mission } from '@clanfire/engine';
import { api } from './api.ts';
import { markManualSignOut } from './lobby.ts';
import { Shell } from './components/Shell.tsx';
import { Toasts } from './components/Toasts.tsx';
import type { ToastItem } from './components/Toasts.tsx';
import { GameContext, MENU_PAGES, TABS } from './game.ts';
import type { GameApi, MailDraft, MapFocus, Tab, ToastOptions, TribeTarget } from './game.ts';
import { useGameState } from './hooks/useGameState.ts';
import { LiveProvider } from './hooks/useLive.tsx';
import { useNow } from './hooks/useNow.ts';
import { ArmyView } from './views/ArmyView.tsx';
import { MailView } from './views/MailView.tsx';
import { MapView } from './views/MapView.tsx';
import { RankingsView } from './views/RankingsView.tsx';
import { ReportsView } from './views/ReportsView.tsx';
import { TribeView } from './views/TribeView.tsx';
import { VillageView } from './views/VillageView.tsx';
import { SupportView } from './views/SupportView.tsx';
import { Icon } from './art/Icon.tsx';

const StaffView = lazy(() => import('./views/StaffView.tsx'));

function readTab(): Tab {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (TABS as readonly string[]).includes(h) || (MENU_PAGES as readonly string[]).includes(h) ? (h as Tab) : 'village';
}

function useTab(): [Tab, (t: Tab) => void] {
  const [tab, setTab] = useState<Tab>(readTab);
  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((t: Tab) => {
    if (window.location.hash !== `#${t}`) window.location.hash = t;
    setTab(t);
  }, []);
  return [tab, navigate];
}

const EMPTY_STATIONED: GameApi['stationed'] = { here: [], abroad: [] };

const MAX_TOASTS = 2;
const TOAST_MS = 4000;
const TOAST_LONG_MS = 8000;

/** The signed-in app. Mounted only while signed in, so the live socket lives and dies with the session. */
export function Game({ onSignedOut }: { onSignedOut: () => void }) {
  return (
    <LiveProvider>
      <GameScreen onSignedOut={onSignedOut} />
    </LiveProvider>
  );
}

function GameScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const store = useGameState(onSignedOut);
  const now = useNow(store.serverOffset);
  const [tab, navigate] = useTab();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const [highlightMovementId, setHighlight] = useState<number | null>(null);
  const [tribeFocus, setTribeFocus] = useState<TribeTarget | null>(null);
  const [tribeVersion, setTribeVersion] = useState(0);
  const [mailDraft, setMailDraft] = useState<MailDraft | null>(null);
  const toastId = useRef(0);
  const mapVisited = useRef(false);
  if (tab === 'map') mapVisited.current = true;

  const { data } = store;
  const village = data?.villages[0] ?? null;
  const settings = data?.settings ?? null;
  const live = useMemo(() => (village && settings ? settleVillage(village.state, now, settings) : null), [village, settings, now]);

  const toast = useCallback((message: string, options?: ToastOptions) => {
    const id = ++toastId.current;
    const kind = options?.kind ?? 'ok';
    // Newest win: at most MAX_TOASTS on screen, older ones drop.
    setToasts((list) => [...list.slice(1 - MAX_TOASTS), { id, message, kind, action: options?.action }]);
    // Errors and toasts with an action stay a little longer (they can also be closed by hand).
    const ttl = kind === 'error' || options?.action ? TOAST_LONG_MS : TOAST_MS;
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ttl);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const showOnMap = useCallback(
    (x: number, y: number, options?: { mission?: Mission }) => {
      setMapFocus({ x, y, nonce: Date.now(), mission: options?.mission });
      navigate('map');
    },
    [navigate],
  );

  const viewMovement = useCallback(
    (id: number) => {
      setHighlight(id);
      navigate('army');
      window.setTimeout(() => setHighlight((cur) => (cur === id ? null : cur)), 8000);
    },
    [navigate],
  );

  const viewTribe = useCallback(
    (target: TribeTarget) => {
      setTribeFocus(target);
      navigate('tribe');
    },
    [navigate],
  );
  const clearTribeFocus = useCallback(() => setTribeFocus(null), []);
  const composeMail = useCallback(
    (to: string, subject = '') => {
      setMailDraft({ to, subject, nonce: Date.now() });
      navigate('mail');
    },
    [navigate],
  );
  const { refresh } = store;
  const tribeChanged = useCallback(() => {
    setTribeVersion((v) => v + 1);
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    markManualSignOut(); // the lobby gate must not sign this visitor straight back in
    try {
      await api.logout();
    } catch {
      // Cookie may already be gone; fall through to the sign-in screen either way.
    }
    onSignedOut();
  }, [onSignedOut]);
  /** Lobby worlds only: end the lobby sessions too; other worlds' sessions run out within hours. */
  const signOutEverywhere = useCallback(async () => {
    try {
      await api.lobbyLogoutAll();
    } catch {
      // Already signed out of the lobby: this world session still ends below.
    }
    await signOut();
  }, [signOut]);

  const ctx = useMemo<GameApi | null>(() => {
    if (!data || !village || !settings || !live) return null;
    return {
      settings,
      player: data.player,
      village,
      live,
      now,
      movements: data.movements,
      unreadReports: data.unreadReports,
      unreadMail: data.unreadMail ?? 0,
      composeMail,
      mailDraft,
      tribeInvites: data.tribeInvites ?? 0,
      tribeAlerts: data.tribeAlerts ?? 0,
      stationed: data.stationed ?? EMPTY_STATIONED,
      tribeVersion,
      tribeFocus,
      clearTribeFocus,
      viewTribe,
      tribeChanged,
      connectionError: store.error,
      tab,
      navigate,
      showOnMap,
      mapFocus,
      highlightMovementId,
      viewMovement,
      refresh: store.refresh,
      applyVillage: store.applyVillage,
      applySend: store.applySend,
      toast,
    };
  }, [data, village, settings, live, now, store.error, store.refresh, store.applyVillage, store.applySend, tab, navigate, showOnMap, mapFocus, highlightMovementId, viewMovement, toast, tribeVersion, tribeFocus, clearTribeFocus, viewTribe, tribeChanged, composeMail, mailDraft]);

  if (!ctx) {
    return (
      <div className="splash" role={store.error ? 'alert' : 'status'}>
        <div className="splash-logo" aria-hidden="true">
          <Icon name="flame" size={44} />
        </div>
        <p>{store.error ?? 'Gathering your village…'}</p>
        {store.error && (
          <button className="btn btn-primary" onClick={() => void store.refresh()}>
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <GameContext.Provider value={ctx}>
      <Shell onSignOut={signOut} onSignOutEverywhere={signOutEverywhere}>
        {tab === 'village' && <VillageView />}
        {tab === 'army' && <ArmyView />}
        {tab === 'reports' && <ReportsView />}
        {tab === 'mail' && <MailView />}
        {tab === 'tribe' && <TribeView />}
        {tab === 'ranks' && <RankingsView />}
        {tab === 'support' && <SupportView />}
        {tab === 'staff' && (
          <Suspense fallback={<p className="muted page">Loading…</p>}>
            <StaffView />
          </Suspense>
        )}
        {mapVisited.current && <MapView active={tab === 'map'} />}
      </Shell>
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </GameContext.Provider>
  );
}
