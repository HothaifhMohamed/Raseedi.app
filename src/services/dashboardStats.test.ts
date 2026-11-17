import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMonthlyCashflowProgress,
  getRecentTransactions,
} from './dashboardStats';
import { Transaction } from '../types';

function makeTx(id: string, date: string, time = '12:00', createdAt = 1000): Transaction {
  return {
    id,
    type: 'expense',
    amount: 100,
    currency: 'EGP',
    walletId: 'w-1',
    categoryId: 'cat-1',
    date,
    time,
    priority: 'normal',
    doesNotAffectBalance: false,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('dashboardStats', () => {
  describe('computeMonthlyCashflowProgress', () => {
    it('handles empty cashflow without division by zero', () => {
      const res = computeMonthlyCashflowProgress(0, 0);
      assert.equal(res.status, 'empty');
      assert.equal(res.expenseToIncomeRatioPct, 0);
      assert.equal(res.net, 0);
    });

    it('computes healthy share when expenses are well below income', () => {
      const res = computeMonthlyCashflowProgress(10000, 2500);
      assert.equal(res.status, 'healthy');
      assert.equal(res.incomeSharePct, 80);
      assert.equal(res.expenseSharePct, 20);
      assert.equal(res.expenseToIncomeRatioPct, 25);
      assert.equal(res.net, 7500);
    });

    it('marks balanced when expenses are between 70% and 100% of income', () => {
      const res = computeMonthlyCashflowProgress(10000, 8500);
      assert.equal(res.status, 'balanced');
      assert.equal(res.expenseToIncomeRatioPct, 85);
    });

    it('marks overspent when expenses exceed income', () => {
      const res = computeMonthlyCashflowProgress(4000, 6000);
      assert.equal(res.status, 'overspent');
      assert.equal(res.net, -2000);
      assert.equal(res.expenseToIncomeRatioPct, 150);
    });
  });

  describe('getRecentTransactions', () => {
    it('sorts descending by date, time, and createdAt without mutating source array', () => {
      const list = [
        makeTx('tx-old', '2026-11-01', '09:00', 100),
        makeTx('tx-mid', '2026-11-10', '10:00', 200),
        makeTx('tx-latest-1', '2026-11-15', '18:30', 300),
        makeTx('tx-latest-2', '2026-11-15', '18:30', 500),
      ];
      const snapshotOrder = list.map((t) => t.id);
      const recent = getRecentTransactions(list, 3);

      assert.deepEqual(
        recent.map((t) => t.id),
        ['tx-latest-2', 'tx-latest-1', 'tx-mid']
      );
      assert.deepEqual(
        list.map((t) => t.id),
        snapshotOrder
      );
    });
  });
});
