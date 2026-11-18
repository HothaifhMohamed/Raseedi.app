export const WALLETS_SCROLL_STORAGE_KEY = 'walletsScrollPos';
export const TRANSACTIONS_SCROLL_STORAGE_KEY = 'transactionsScrollPos';
export const TRANSACTIONS_LIMIT_STORAGE_KEY = 'transactionsVisibleLimit';

export interface ScrollStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function getBrowserSessionStorage(): ScrollStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function parseSavedScrollPosition(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const trimmed = String(raw).trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

export function parseSavedVisibleLimit(
  raw: string | null | undefined,
  defaultLimit = 60
): number {
  const parsed = parseSavedScrollPosition(raw);
  return parsed > defaultLimit ? parsed : defaultLimit;
}

export function saveScrollPositionToStorage(
  storage: Pick<ScrollStorageLike, 'setItem'> | null | undefined,
  key: string,
  scrollTop: number
): number {
  const normalized = Number.isFinite(scrollTop) && scrollTop > 0 ? Math.round(scrollTop) : 0;
  if (!storage) return normalized;
  try {
    storage.setItem(key, String(normalized));
  } catch {
    // Ignore sessionStorage quota or private-mode security errors
  }
  return normalized;
}

export function readScrollPositionFromStorage(
  storage: Pick<ScrollStorageLike, 'getItem'> | null | undefined,
  key: string
): number {
  if (!storage) return 0;
  try {
    return parseSavedScrollPosition(storage.getItem(key));
  } catch {
    return 0;
  }
}

export function clearScrollPositionInStorage(
  storage: Pick<ScrollStorageLike, 'removeItem'> | null | undefined,
  key: string
): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
}

export interface ThrottledScrollSaver {
  save: (scrollTop: number) => void;
  flush: () => void;
  cancel: () => void;
}

/**
 * Throttles scroll persistence writes during 60fps scrolling while guaranteeing
 * a trailing flush for the final resting scroll offset.
 */
export function createThrottledScrollSaver(
  onSave: (scrollTop: number) => void,
  delayMs = 100
): ThrottledScrollSaver {
  let lastRunAt = 0;
  let pendingValue: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const commit = (val: number) => {
    lastRunAt = Date.now();
    pendingValue = null;
    onSave(val);
  };

  const cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    pendingValue = null;
  };

  const flush = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (pendingValue !== null) {
      const val = pendingValue;
      commit(val);
    }
  };

  const save = (scrollTop: number) => {
    const normalized = Number.isFinite(scrollTop) && scrollTop > 0 ? Math.round(scrollTop) : 0;
    const now = Date.now();
    const elapsed = now - lastRunAt;

    if (lastRunAt === 0 || elapsed >= delayMs) {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      commit(normalized);
      return;
    }

    pendingValue = normalized;
    if (timerId === null) {
      timerId = setTimeout(() => {
        timerId = null;
        if (pendingValue !== null) {
          commit(pendingValue);
        }
      }, Math.max(10, delayMs - elapsed));
    }
  };

  return { save, flush, cancel };
}
