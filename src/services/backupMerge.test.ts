import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSafeCloudBackupWrite, CloudBackupWriteCandidate } from './backupMerge';
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
