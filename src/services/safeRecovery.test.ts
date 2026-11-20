import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFirestoreErrorForDisplay,
  mergeCloudAndLocalState,
  shouldRestoreCloudOnStartup,
} from './safeRecovery';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './db';
import { Transaction } from '../types';

const makeTx = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx-1',
  type: 'expense',
  amount: 100,
  currency: 'EGP',
  date: '2026-11-17',
  time: '12:00',
  categoryId: 'cat-restaurants',
  walletId: 'w-1',
  priority: 'normal',
  doesNotAffectBalance: false,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

test('shouldRestoreCloudOnStartup triggers when localStorage transactions are empty or cloud is newer', () => {
  assert.equal(
    shouldRestoreCloudOnStartup({
      localTransactionsCount: 0,
      hasCloudBackup: true,
      cloudUpdatedAtMs: 5000,
      localLastKnownCloudUpdatedAtMs: 5000,
    }),
    true
  );

  assert.equal(
    shouldRestoreCloudOnStartup({
      localTransactionsCount: 3,
      hasCloudBackup: true,
      cloudUpdatedAtMs: 9000,
      localLastKnownCloudUpdatedAtMs: 5000,
    }),
    true
  );

  assert.equal(
    shouldRestoreCloudOnStartup({
      localTransactionsCount: 3,
      hasCloudBackup: true,
      cloudUpdatedAtMs: 5000,
      localLastKnownCloudUpdatedAtMs: 5000,
    }),
    false
  );

  assert.equal(
    shouldRestoreCloudOnStartup({
      localTransactionsCount: 0,
      hasCloudBackup: false,
      cloudUpdatedAtMs: 0,
    }),
    false
  );
});

test('mergeCloudAndLocalState recovers all cloud transactions, merges local ones without loss, and sorts descending', () => {
  const merged = mergeCloudAndLocalState({
    localData: {
      transactions: [
        makeTx({ id: 'tx-local-only', date: '2026-11-18', time: '09:00', amount: 75 }),
      ],
      wallets: [],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      debts: [],
      goals: [],
      templates: [],
      moneyCircles: [],
      settings: DEFAULT_SETTINGS,
      hasCompletedOnboarding: true,
    },
    cloudData: {
      transactions: [
        makeTx({ id: 'tx-cloud-1', date: '2026-11-10', time: '10:00', amount: 300 }),
        makeTx({ id: 'tx-cloud-2', date: '2026-11-15', time: '14:00', amount: 500 }),
      ],
      wallets: [
        {
          id: 'w-1',
          name: 'Main Wallet',
          currency: 'EGP',
          initialBalance: 1000,
          balance: 1000,
          color: '#0E5A43',
          icon: 'Wallet',
          isArchived: false,
          order: 1,
        },
      ],
    },
  });

  assert.deepEqual(
    merged.transactions.map((t) => t.id),
    ['tx-local-only', 'tx-cloud-2', 'tx-cloud-1']
  );
  assert.equal(merged.wallets.length, 1);
  assert.equal(merged.wallets[0].id, 'w-1');
});

test('formatFirestoreErrorForDisplay produces clear diagnostic messages for index, permission, and offline errors', () => {
  const idxMsg = formatFirestoreErrorForDisplay(
    { code: 'failed-precondition', message: 'The query requires an index.' },
    true
  );
  assert.match(idxMsg, /failed-precondition/);
  assert.match(idxMsg, /requires an index/);

  const permAr = formatFirestoreErrorForDisplay(
    { code: 'permission-denied', message: 'Missing or insufficient permissions.' },
    true
  );
  assert.match(permAr, /صلاحية/);
  assert.doesNotMatch(permAr, /Missing or insufficient permissions/);

  const permEn = formatFirestoreErrorForDisplay(
    { code: 'permission-denied', message: 'Missing or insufficient permissions.' },
    false
  );
  assert.match(permEn, /Permission denied/i);

  const offlineMsg = formatFirestoreErrorForDisplay(
    { code: 'unavailable', message: 'client is offline' },
    false
  );
  assert.match(offlineMsg, /unavailable/);
});
