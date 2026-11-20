import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDayHeaderCache,
  createIdSet,
  formatCachedDayHeader,
  indexById,
  paginateList,
  TtlMemoryCache,
} from './lookupCache';

test('indexById builds O(1) lookup map preserving latest entry per id', () => {
  const items = [
    { id: 'c1', name: 'طعام' },
    { id: 'c2', name: 'مواصلات' },
    { id: 'c3', name: 'إيجار' },
  ];
  const map = indexById(items);
  assert.equal(map.size, 3);
  assert.equal(map.get('c2')?.name, 'مواصلات');
  assert.equal(map.get('missing'), undefined);
});

test('createIdSet enables O(1) membership checks for multi-select', () => {
  const set = createIdSet(['tx-1', 'tx-2', 'tx-3']);
  assert.equal(set.has('tx-2'), true);
  assert.equal(set.has('tx-99'), false);
});

test('paginateList slices large arrays cleanly and computes remaining count', () => {
  const data = Array.from({ length: 120 }, (_, i) => i + 1);
  const page1 = paginateList(data, 30);
  assert.equal(page1.visibleItems.length, 30);
  assert.equal(page1.renderedCount, 30);
  assert.equal(page1.totalCount, 120);
  assert.equal(page1.remainingCount, 90);
  assert.equal(page1.hasMore, true);

  const pageAll = paginateList(data, 150);
  assert.equal(pageAll.visibleItems.length, 120);
  assert.equal(pageAll.hasMore, false);
  assert.equal(pageAll.remainingCount, 0);
});

test('TtlMemoryCache respects expiration, eviction cap, and invalidation', () => {
  const cache = new TtlMemoryCache<string>({ maxEntries: 10, defaultTtlMs: 5000 });
  cache.set('k1', 'alice', 5000, 1000);
  assert.equal(cache.get('k1', 4000), 'alice');
  assert.equal(cache.get('k1', 6000), undefined);

  for (let i = 0; i < 12; i++) {
    cache.set(`key-${i}`, `val-${i}`, 10000, 1000);
  }
  assert.equal(cache.size, 10);
  assert.equal(cache.get('key-0', 2000), undefined);
  assert.equal(cache.get('key-11', 2000), 'val-11');

  cache.clear();
  assert.equal(cache.size, 0);
});

test('formatCachedDayHeader memoizes formatted headers cleanly', () => {
  clearDayHeaderCache();
  let calls = 0;
  const toArabic = (n: number | string) => {
    calls += 1;
    return String(n);
  };
  const first = formatCachedDayHeader('2026-05-15', 'ar', 'arabic', toArabic);
  const second = formatCachedDayHeader('2026-05-15', 'ar', 'arabic', toArabic);
  assert.equal(first, second);
  assert.equal(calls, 1, 'second call should hit cache without recomputing');
});
