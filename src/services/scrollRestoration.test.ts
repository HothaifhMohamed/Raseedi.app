import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WALLETS_SCROLL_STORAGE_KEY,
  TRANSACTIONS_SCROLL_STORAGE_KEY,
  parseSavedScrollPosition,
  parseSavedVisibleLimit,
  saveScrollPositionToStorage,
  readScrollPositionFromStorage,
  clearScrollPositionInStorage,
  createThrottledScrollSaver,
  type ScrollStorageLike,
} from './scrollRestoration';

function createMemoryStorage(): ScrollStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test('parseSavedScrollPosition safely handles valid, fractional, negative, and invalid inputs', () => {
  assert.equal(parseSavedScrollPosition('420'), 420);
  assert.equal(parseSavedScrollPosition('318.7'), 319);
  assert.equal(parseSavedScrollPosition('0'), 0);
  assert.equal(parseSavedScrollPosition('-25'), 0);
  assert.equal(parseSavedScrollPosition('not-a-number'), 0);
  assert.equal(parseSavedScrollPosition(null), 0);
  assert.equal(parseSavedScrollPosition(undefined), 0);
});

test('parseSavedVisibleLimit preserves higher limits and enforces minimum default', () => {
  assert.equal(parseSavedVisibleLimit('140', 60), 140);
  assert.equal(parseSavedVisibleLimit('20', 60), 60);
  assert.equal(parseSavedVisibleLimit(null, 60), 60);
});

test('save, read, and clear scroll positions work with sessionStorage keys and ignore throwing storage', () => {
  const storage = createMemoryStorage();

  const savedWallets = saveScrollPositionToStorage(storage, WALLETS_SCROLL_STORAGE_KEY, 512.4);
  assert.equal(savedWallets, 512);
  assert.equal(readScrollPositionFromStorage(storage, WALLETS_SCROLL_STORAGE_KEY), 512);

  const savedTx = saveScrollPositionToStorage(storage, TRANSACTIONS_SCROLL_STORAGE_KEY, 980);
  assert.equal(savedTx, 980);
  assert.equal(readScrollPositionFromStorage(storage, TRANSACTIONS_SCROLL_STORAGE_KEY), 980);

  clearScrollPositionInStorage(storage, TRANSACTIONS_SCROLL_STORAGE_KEY);
  assert.equal(readScrollPositionFromStorage(storage, TRANSACTIONS_SCROLL_STORAGE_KEY), 0);

  const brokenStorage: ScrollStorageLike = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(saveScrollPositionToStorage(brokenStorage, WALLETS_SCROLL_STORAGE_KEY, 100), 100);
  assert.equal(readScrollPositionFromStorage(brokenStorage, WALLETS_SCROLL_STORAGE_KEY), 0);
  clearScrollPositionInStorage(brokenStorage, WALLETS_SCROLL_STORAGE_KEY);
});

test('createThrottledScrollSaver throttles bursts and flushes trailing resting scroll offset', async () => {
  const calls: number[] = [];
  const saver = createThrottledScrollSaver((pos) => calls.push(pos), 50);

  saver.save(10);
  saver.save(120);
  saver.save(240);
  saver.save(365);

  // First event saves immediately; intermediate burst updates are throttled
  assert.deepEqual(calls, [10]);

  await new Promise((r) => setTimeout(r, 70));
  assert.deepEqual(calls, [10, 365]);

  // Immediate flush commits pending offset synchronously before unmount/click
  saver.save(410);
  saver.save(525);
  saver.flush();
  assert.deepEqual(calls, [10, 365, 525]);
  saver.cancel();
});
