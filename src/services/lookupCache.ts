/**
 * Fast O(1) Lookup Indexers, Bounded TTL Cache, Memoized Date Headers & Pagination Helpers
 * Eliminates O(N*M) linear scans inside hot transaction/report render loops and redundant reads.
 */

export function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && item.id) {
      map.set(item.id, item);
    }
  }
  return map;
}

export function createIdSet(ids: readonly string[]): Set<string> {
  return new Set(ids);
}

export interface PaginatedSlice<T> {
  visibleItems: T[];
  renderedCount: number;
  totalCount: number;
  remainingCount: number;
  hasMore: boolean;
}

export function paginateList<T>(items: readonly T[], visibleLimit: number): PaginatedSlice<T> {
  const totalCount = items.length;
  const safeLimit = Math.max(1, Math.floor(Number.isFinite(visibleLimit) ? visibleLimit : 1));
  if (totalCount <= safeLimit) {
    return {
      visibleItems: items as T[],
      renderedCount: totalCount,
      totalCount,
      remainingCount: 0,
      hasMore: false,
    };
  }
  return {
    visibleItems: items.slice(0, safeLimit),
    renderedCount: safeLimit,
    totalCount,
    remainingCount: totalCount - safeLimit,
    hasMore: true,
  };
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Lightweight bounded in-memory TTL cache for semi-static lookups (e.g., user directory lookups).
 */
export class TtlMemoryCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(options?: { maxEntries?: number; defaultTtlMs?: number }) {
    this.maxEntries = Math.max(10, options?.maxEntries ?? 120);
    this.defaultTtlMs = Math.max(1000, options?.defaultTtlMs ?? 2 * 60 * 1000);
  }

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (now >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number, now = Date.now()): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, {
      value,
      expiresAt: now + Math.max(500, ttlMs ?? this.defaultTtlMs),
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

const DAY_HEADER_CACHE_MAX = 400;
const dayHeaderCache = new Map<string, string>();

/**
 * Memoized day header formatter so scrolling or re-rendering large transaction lists
 * never allocates repeated Date/Intl locale strings for the same date key.
 */
export function formatCachedDayHeader(
  dateStr: string,
  language: 'ar' | 'en',
  digitFormat: 'arabic' | 'western' | string,
  toArabicNumeralsFn: (n: number | string) => string
): string {
  const cacheKey = `${dateStr}|${language}|${digitFormat}`;
  const cached = dayHeaderCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const dt = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(dt.getTime())) {
    return dateStr;
  }
  const dayNum = dt.getDate();
  const formattedDay = digitFormat === 'arabic' ? toArabicNumeralsFn(dayNum) : dayNum;
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';
  const weekday = dt.toLocaleDateString(locale, { weekday: 'long' });
  const month = dt.toLocaleDateString(locale, { month: 'long' });
  const formatted = `${weekday}، ${formattedDay} ${month}`;

  if (dayHeaderCache.size >= DAY_HEADER_CACHE_MAX) {
    const oldest = dayHeaderCache.keys().next().value;
    if (oldest !== undefined) dayHeaderCache.delete(oldest);
  }
  dayHeaderCache.set(cacheKey, formatted);
  return formatted;
}

export function clearDayHeaderCache(): void {
  dayHeaderCache.clear();
}

export interface CachedDirectoryUser {
  uid: string;
  email: string;
  displayName: string;
  username?: string;
}

/**
 * Shared 2-minute bounded TTL cache for exact `@username` and email hash directory lookups.
 * Shared here so `firebase.ts` can invalidate on username change without circular imports.
 */
export const userDirectoryLookupCache = new TtlMemoryCache<CachedDirectoryUser | null>({
  maxEntries: 100,
  defaultTtlMs: 2 * 60 * 1000,
});

export function invalidateUserLookupCache(key?: string): void {
  if (key) {
    userDirectoryLookupCache.delete(key);
  } else {
    userDirectoryLookupCache.clear();
  }
}

