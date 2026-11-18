import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTransactionsByDateRange,
  isFirestoreMissingIndexError,
  mergeTransactionsById,
  sortTransactionsDescending,
} from './orgTransactionQuery';
import { Transaction } from '../types';

const makeTx = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx-1',
  type: 'expense',
  amount: 100,
  currency: 'EGP',
  date: '2026-11-10',
  time: '12:00',
  categoryId: 'cat-1',
  walletId: 'w-1',
  priority: 'normal',
  doesNotAffectBalance: false,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

test('isFirestoreMissingIndexError detects Firestore index precondition errors', () => {
  assert.equal(
    isFirestoreMissingIndexError({
      code: 'failed-precondition',
      message: 'The query requires an index. You can create it here: https://console.firebase.google.com/...',
    }),
    true
  );
  assert.equal(
    isFirestoreMissingIndexError(new Error('The query requires an index')),
    true
  );
  assert.equal(
    isFirestoreMissingIndexError({ code: 'permission-denied', message: 'Missing permissions' }),
    false
  );
});

test('sortTransactionsDescending orders by date desc, time desc, then createdAt desc', () => {
  const sorted = sortTransactionsDescending([
    makeTx({ id: 'old', date: '2026-11-01', time: '09:00', createdAt: 100 }),
    makeTx({ id: 'same-day-early', date: '2026-11-18', time: '08:00', createdAt: 200 }),
    makeTx({ id: 'same-day-late', date: '2026-11-18', time: '14:30', createdAt: 150 }),
    makeTx({ id: 'no-date', date: '', time: '', createdAt: 50 }),
  ]);
  assert.deepEqual(
    sorted.map((t) => t.id),
    ['same-day-late', 'same-day-early', 'old', 'no-date']
  );
});

test('mergeTransactionsById merges without duplicates and prefers newer updatedAt', () => {
  const merged = mergeTransactionsById(
    [makeTx({ id: 'a', amount: 250, updatedAt: 2000, date: '2026-11-18' })],
    [
      makeTx({ id: 'a', amount: 100, updatedAt: 1000, date: '2026-11-18' }),
      makeTx({ id: 'b', amount: 500, updatedAt: 1500, date: '2026-11-17' }),
    ]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((t) => t.id === 'a')?.amount, 250);
  assert.equal(merged.find((t) => t.id === 'b')?.amount, 500);
});

test('filterTransactionsByDateRange excludes deleted records and respects inclusive dates', () => {
  const filtered = filterTransactionsByDateRange(
    [
      makeTx({ id: 'in-1', date: '2026-11-15' }),
      makeTx({ id: 'in-2', date: '2026-11-18' }),
      makeTx({ id: 'deleted', date: '2026-11-16', deletedAt: 12345 }),
      makeTx({ id: 'too-old', date: '2026-10-31' }),
    ],
    '2026-11-01',
    '2026-11-30'
  );
  assert.deepEqual(
    filtered.map((t) => t.id),
    ['in-2', 'in-1']
  );
});
