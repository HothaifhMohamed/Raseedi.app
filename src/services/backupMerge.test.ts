import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSafeCloudBackupWrite,
  CloudBackupWriteCandidate,
  prepareCloudBackupChunks,
  MAX_CLOUD_BACKUP_CHUNKS,
  MAX_CLOUD_BACKUP_TRANSACTIONS,
} from './backupMerge';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './db';

const makeLocalCandidate = (
  overrides?: Partial<CloudBackupWriteCandidate>
): CloudBackupWriteCandidate => ({
  transactions: [],
  wallets: [],
  categories: DEFAULT_CATEGORIES,
  budgets: [],
  debts: [],
  goals: [],
  templates: [],
  moneyCircles: [],
  settings: DEFAULT_SETTINGS,
  hasCompletedOnboarding: true,
  ...overrides,
});

const sampleTx = {
  id: 'tx-cloud-1',
  type: 'expense' as const,
  amount: 250,
  currency: 'EGP',
  date: '2026-11-17',
  time: '12:00',
  categoryId: 'cat-restaurants',
  walletId: 'w-1',
  priority: 'normal' as const,
  doesNotAffectBalance: false,
  createdAt: 1000,
  updatedAt: 1000,
};

test('auto sync blocks overwriting non-empty cloud transactions with empty local array', () => {
  const decision = resolveSafeCloudBackupWrite({
    localData: makeLocalCandidate({ transactions: [] }),
    existingCloud: { totalTransactions: 12 },
    source: 'auto',
  });
  assert.equal(decision.action, 'skip_empty_local');
});

test('manual sync preserves and merges cloud transactions when local transactions are empty', () => {
  const decision = resolveSafeCloudBackupWrite({
    localData: makeLocalCandidate({ transactions: [] }),
    existingCloud: {
      totalTransactions: 1,
      data: makeLocalCandidate({
        transactions: [sampleTx],
        wallets: [
          {
            id: 'w-1',
            name: 'Cloud Wallet',
            currency: 'EGP',
            initialBalance: 1000,
            balance: 750,
            color: '#0E5A43',
            icon: 'Wallet',
            isArchived: false,
            order: 1,
          },
        ],
      }),
    },
    source: 'manual',
  });
  assert.equal(decision.action, 'write');
  if (decision.action === 'write') {
    assert.equal(decision.preservedFromCloud, true);
    assert.equal(decision.mergedData.transactions.length, 1);
    assert.equal(decision.mergedData.transactions[0].id, 'tx-cloud-1');
    assert.equal(decision.mergedData.wallets.length, 1);
  }
});

test('allows writing empty array only when allowEmptyOverwrite is explicitly true', () => {
  const decision = resolveSafeCloudBackupWrite({
    localData: makeLocalCandidate({ transactions: [] }),
    existingCloud: { totalTransactions: 5 },
    source: 'manual',
    allowEmptyOverwrite: true,
  });
  assert.equal(decision.action, 'write');
  if (decision.action === 'write') {
    assert.equal(decision.mergedData.transactions.length, 0);
  }
});

test('prepareCloudBackupChunks throws BACKUP_TOO_LARGE instead of silently truncating transactions or chunks', () => {
  assert.equal(MAX_CLOUD_BACKUP_TRANSACTIONS, 40_000);
  assert.equal(MAX_CLOUD_BACKUP_CHUNKS, 99);

  // Within limits: returns exact chunks and storedTxCount
  const items = Array.from({ length: 10 }, (_, idx) => ({ id: `tx-${idx}` }));
  const prepared = prepareCloudBackupChunks(
    items,
    (list) => [list.slice(0, 4), list.slice(4, 8), list.slice(8)],
    { maxTransactions: 10, maxChunks: 3 }
  );
  assert.equal(prepared.chunks.length, 3);
  assert.equal(prepared.storedTxCount, 10);

  // Transaction count exceeds maxTransactions -> throws BACKUP_TOO_LARGE
  assert.throws(
    () =>
      prepareCloudBackupChunks(
        items,
        (list) => [list],
        { maxTransactions: 9, maxChunks: 99 }
      ),
    /BACKUP_TOO_LARGE/
  );

  // Chunk count exceeds maxChunks (e.g. > 99) -> throws BACKUP_TOO_LARGE instead of .slice(0, 99)
  assert.throws(
    () =>
      prepareCloudBackupChunks(
        Array.from({ length: 100 }, (_, idx) => ({ id: `tx-${idx}` })),
        (list) => list.map((item) => [item]),
        { maxTransactions: 40_000, maxChunks: 99 }
      ),
    /BACKUP_TOO_LARGE/
  );

  // Chunk builder drops items silently -> throws BACKUP_TOO_LARGE
  assert.throws(
    () =>
      prepareCloudBackupChunks(
        items,
        (list) => [list.slice(0, 8)],
        { maxTransactions: 10, maxChunks: 99 }
      ),
    /BACKUP_TOO_LARGE/
  );
});

