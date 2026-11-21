export type AppNavView = 'home' | 'budget' | 'wallets' | 'more';
export type HomeSubTab = 'transactions' | 'statistics' | 'templates';

export interface RouteState {
  activeNav: AppNavView;
  homeTab: HomeSubTab;
  activeWalletId: string | null;
}

export interface RaseediHistoryState {
  raseediNav: RouteState;
  raseediDepth: number;
  raseediModalId?: string;
}

export const NAV_STORAGE_KEY = 'raseedi_nav_state_v1';
export const FULL_LEDGER_STORAGE_KEY = 'raseedi_full_ledger_v1';

export const DEFAULT_ROUTE_STATE: RouteState = {
  activeNav: 'home',
  homeTab: 'transactions',
  activeWalletId: null,
};

const VALID_NAV_VIEWS = new Set<AppNavView>(['home', 'budget', 'wallets', 'more']);
const VALID_HOME_TABS = new Set<HomeSubTab>(['transactions', 'statistics', 'templates']);

export function normalizeRouteState(partial: Partial<RouteState> | null | undefined): RouteState {
  const rawNav = partial?.activeNav;
  const activeNav: AppNavView =
    rawNav && VALID_NAV_VIEWS.has(rawNav) ? rawNav : DEFAULT_ROUTE_STATE.activeNav;

  const rawHomeTab = partial?.homeTab;
  const homeTab: HomeSubTab =
    rawHomeTab && VALID_HOME_TABS.has(rawHomeTab) ? rawHomeTab : DEFAULT_ROUTE_STATE.homeTab;

  const rawWalletId = typeof partial?.activeWalletId === 'string' ? partial.activeWalletId.trim() : '';
  const activeWalletId = activeNav === 'wallets' && rawWalletId.length > 0 ? rawWalletId : null;

  return {
    activeNav,
    homeTab,
    activeWalletId,
  };
}

export function areRoutesEqual(a: RouteState, b: RouteState): boolean {
  if (a.activeNav !== b.activeNav) return false;
  if (a.activeNav === 'home' && a.homeTab !== b.homeTab) return false;
  if (a.activeNav === 'wallets' && (a.activeWalletId || null) !== (b.activeWalletId || null)) {
    return false;
  }
  return true;
}

export function buildHashRoute(route: RouteState): string {
  const normalized = normalizeRouteState(route);

  switch (normalized.activeNav) {
    case 'home':
      if (normalized.homeTab === 'statistics') return '#/home/statistics';
      if (normalized.homeTab === 'templates') return '#/home/templates';
      return '#/home';
    case 'budget':
      return '#/budget';
    case 'wallets':
      if (normalized.activeWalletId) {
        return `#/wallet/${encodeURIComponent(normalized.activeWalletId)}`;
      }
      return '#/wallets';
    case 'more':
      return '#/more';
  }
}

export function parseHashRoute(hash: string | null | undefined): Partial<RouteState> | null {
  if (!hash || typeof hash !== 'string') return null;

  const cleaned = hash.trim().replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleaned) return null;

  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const head = segments[0].toLowerCase();

  if (head === 'home') {
    const sub = segments[1]?.toLowerCase();
    if (sub === 'statistics') {
      return { activeNav: 'home', homeTab: 'statistics', activeWalletId: null };
    }
    if (sub === 'templates') {
      return { activeNav: 'home', homeTab: 'templates', activeWalletId: null };
    }
    return { activeNav: 'home', homeTab: 'transactions', activeWalletId: null };
  }

  if (head === 'budget') {
    return { activeNav: 'budget', activeWalletId: null };
  }

  if (head === 'wallets') {
    return { activeNav: 'wallets', activeWalletId: null };
  }

  if (head === 'wallet') {
    const rawId = segments.slice(1).join('/');
    if (!rawId) {
      return { activeNav: 'wallets', activeWalletId: null };
    }
    try {
      const decoded = decodeURIComponent(rawId).trim();
      return {
        activeNav: 'wallets',
        activeWalletId: decoded.length > 0 ? decoded : null,
      };
    } catch {
      return { activeNav: 'wallets', activeWalletId: rawId.trim() || null };
    }
  }

  if (head === 'more') {
    return { activeNav: 'more', activeWalletId: null };
  }

  return null;
}

export function serializeRouteForStorage(route: RouteState): string {
  return JSON.stringify(normalizeRouteState(route));
}

export function parseStoredRoute(raw: string | null | undefined): RouteState | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RouteState>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.activeNav || !VALID_NAV_VIEWS.has(parsed.activeNav)) return null;
    return normalizeRouteState(parsed);
  } catch {
    return null;
  }
}

export function resolveInitialRoute(
  hash: string | null | undefined,
  storedRaw?: string | null,
  localStoredRaw?: string | null
): RouteState {
  const fromHash = parseHashRoute(hash);
  const fromStorage = parseStoredRoute(storedRaw) ?? parseStoredRoute(localStoredRaw);

  if (fromHash) {
    return normalizeRouteState({
      homeTab: fromHash.homeTab ?? fromStorage?.homeTab ?? DEFAULT_ROUTE_STATE.homeTab,
      activeNav: fromHash.activeNav ?? DEFAULT_ROUTE_STATE.activeNav,
      activeWalletId: fromHash.activeWalletId ?? null,
    });
  }

  if (fromStorage) {
    return fromStorage;
  }

  return { ...DEFAULT_ROUTE_STATE };
}

export function buildUrlWithHash(pathname: string, search: string, route: RouteState): string {
  const cleanPath = pathname || '/';
  const cleanSearch = search || '';
  return `${cleanPath}${cleanSearch}${buildHashRoute(route)}`;
}

/**
 * Reads persisted route state from sessionStorage first, falling back to localStorage
 * so full browser refreshes, PWA relaunches, and standalone webviews restore the exact tab.
 */
export function safeReadSessionNav(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromSession = window.sessionStorage.getItem(NAV_STORAGE_KEY);
    if (fromSession) return fromSession;
  } catch {
    // Ignore sessionStorage access errors
  }
  try {
    return window.localStorage.getItem(NAV_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persists route state to both sessionStorage and localStorage for instant restoration on reload.
 */
export function safeWriteSessionNav(route: RouteState): void {
  if (typeof window === 'undefined') return;
  const serialized = serializeRouteForStorage(route);
  try {
    window.sessionStorage.setItem(NAV_STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota or private browsing errors
  }
  try {
    window.localStorage.setItem(NAV_STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function safeReadFullLedgerPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const fromSession = window.sessionStorage.getItem(FULL_LEDGER_STORAGE_KEY);
    if (fromSession !== null) return fromSession === '1';
  } catch {
    // Ignore
  }
  try {
    return window.localStorage.getItem(FULL_LEDGER_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function safeWriteFullLedgerPref(isOpen: boolean): void {
  if (typeof window === 'undefined') return;
  const val = isOpen ? '1' : '0';
  try {
    if (isOpen) {
      window.sessionStorage.setItem(FULL_LEDGER_STORAGE_KEY, val);
    } else {
      window.sessionStorage.removeItem(FULL_LEDGER_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
  try {
    if (isOpen) {
      window.localStorage.setItem(FULL_LEDGER_STORAGE_KEY, val);
    } else {
      window.localStorage.removeItem(FULL_LEDGER_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}
