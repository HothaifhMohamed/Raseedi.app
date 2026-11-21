import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNetWorthSeries,
  calculateBalanceAdjustment,
  calculateSavingsAndCashflow,
  calculateWealthBreakdown,
  getWalletAssetClass,
} from './wealthAnalytics';
import { Debt, Transaction, Wallet } from '../types';

test('getWalletAssetClass defaults legacy wallets to spendable and recognizes assets', () => {
  assert.equal(getWalletAssetClass({}), 'spendable');
  assert.equal(getWalletAssetClass({ assetClass: 'asset' }), 'asset');
  assert.equal(getWalletAssetClass({ assetSubtype: 'gold' }), 'asset');
  assert.equal(getWalletAssetClass({ assetSubtype: 'certificate' }), 'asset');
  assert.equal(getWalletAssetClass({ assetSubtype: 'cash' }), 'spendable');
});

test('calculateWealthBreakdown separates spendable liquidity, owned assets, debt, and net worth', () => {
  const wallets: Wallet[] = [
    {
      id: 'w1',
      name: 'Cash',
      currency: 'EGP',
      initialBalance: 10000,
      balance: 10000,
      color: '#1E6F73',
      icon: 'Wallet',
      isArchived: false,
      // Legacy wallet with no assetClass => spendable
    },
    {
      id: 'w2',
      name: 'Gold Savings',
      currency: 'EGP',
      initialBalance: 50000,
      balance: 50000,
      color: '#C99A2E',
      icon: 'Coins',
      isArchived: false,
      assetClass: 'asset',
      assetSubtype: 'gold',
    },
    {
      id: 'w3',
      name: 'Archived Asset',
      currency: 'EGP',
      initialBalance: 20000,
      balance: 20000,
      color: '#5E7F3A',
      icon: 'Home',
      isArchived: true,
      assetClass: 'asset',
    },
    {
      id: 'w4',
      name: 'Excluded Spendable',
      currency: 'EGP',
      initialBalance: 5000,
      balance: 5000,
      color: '#545E75',
      icon: 'CreditCard',
      isArchived: false,
      excludeFromTotal: true,
    },
  ];

  const debts: Debt[] = [
    {
      id: 'd1',
      type: 'i_owe',
      personName: 'Bank Loan',
      totalAmount: 15000,
      paidAmount: 5000, // 10,000 remaining
      currency: 'EGP',
      payments: [],
      isSettled: false,
      createdAt: 1000,
    },
    {
      id: 'd2',
      type: 'owed_to_me',
      personName: 'Friend',
      totalAmount: 3000,
      paidAmount: 0,
      currency: 'EGP',
      payments: [],
      isSettled: false,
      createdAt: 1000,
    },
    {
      id: 'd3',
      type: 'i_owe',
      personName: 'Settled Loan',
      totalAmount: 4000,
      paidAmount: 4000,
      currency: 'EGP',
      payments: [],
      isSettled: true,
      createdAt: 1000,
    },
  ];

  const breakdown = calculateWealthBreakdown({
    wallets,
    debts,
    mainCurrency: 'EGP',
  });

  assert.equal(breakdown.spendableTotal, 10000);
  assert.equal(breakdown.ownedAssetsTotal, 50000);
  assert.equal(breakdown.totalAssets, 60000);
  assert.equal(breakdown.totalDebtIowe, 10000);
  assert.equal(breakdown.totalOwedToMe, 3000);
  assert.equal(breakdown.netWorth, 50000); // 60,000 - 10,000
  assert.equal(breakdown.spendableCount, 2); // w1 + w4 (active)
  assert.equal(breakdown.ownedAssetsCount, 1); // w2
});

test('calculateSavingsAndCashflow handles positive, negative, and zero-income periods accurately', () => {
  const pos = calculateSavingsAndCashflow(20000, 12000, 'EGP');
  assert.equal(pos.netCashflow, 8000);
  assert.equal(pos.cashflowStatus, 'positive');
  assert.equal(pos.savingsRatePct, 40);

  const neg = calculateSavingsAndCashflow(10000, 12500, 'EGP');
  assert.equal(neg.netCashflow, -2500);
  assert.equal(neg.cashflowStatus, 'negative');
  assert.equal(neg.savingsRatePct, -25);

  const noIncome = calculateSavingsAndCashflow(0, 500, 'EGP');
  assert.equal(noIncome.netCashflow, -500);
  assert.equal(noIncome.cashflowStatus, 'negative');
  assert.equal(noIncome.savingsRatePct, null);

  const zero = calculateSavingsAndCashflow(0, 0, 'EGP');
  assert.equal(zero.netCashflow, 0);
  assert.equal(zero.cashflowStatus, 'neutral');
  assert.equal(zero.savingsRatePct, null);
});

test('buildNetWorthSeries reconstructs accurate historical trajectory across 1M / 3M / 1Y / ALL', () => {
  const now = new Date(2026, 4, 15); // 2026-05-15
  const txs: Transaction[] = [
    {
      id: 't1',
      type: 'income',
      amount: 10000,
      currency: 'EGP',
      date: '2026-05-01',
      time: '10:00',
      categoryId: 'cat-salary',
      walletId: 'w1',
      priority: 'normal',
      doesNotAffectBalance: false,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 't2',
      type: 'expense',
      amount: 3000,
      currency: 'EGP',
      date: '2026-05-10',
      time: '10:00',
      categoryId: 'cat-groceries',
      walletId: 'w1',
      priority: 'normal',
      doesNotAffectBalance: false,
      createdAt: 2,
      updatedAt: 2,
    },
  ];

  // Current net worth is 50,000. Net cashflow in last 30 days = +7,000, so 30 days ago was 43,000.
  const series1M = buildNetWorthSeries({
    timeframe: '1M',
    currentNetWorth: 50000,
    transactions: txs,
    mainCurrency: 'EGP',
    now,
    language: 'en',
  });

  assert.equal(series1M.endValue, 50000);
  assert.equal(series1M.startValue, 43000);
  assert.equal(series1M.delta, 7000);
  assert.ok(series1M.points.length >= 10);
});

test('calculateBalanceAdjustment computes positive, negative, and zero adjustment plans', () => {
  const inc = calculateBalanceAdjustment(1000, 1450.5, 'EGP');
  assert.equal(inc.transactionType, 'income');
  assert.equal(inc.absAmount, 450.5);
  assert.equal(inc.delta, 450.5);

  const dec = calculateBalanceAdjustment(1000, 800, 'EGP');
  assert.equal(dec.transactionType, 'expense');
  assert.equal(dec.absAmount, 200);
  assert.equal(dec.delta, -200);

  const same = calculateBalanceAdjustment(1000, 1000, 'EGP');
  assert.equal(same.transactionType, null);
  assert.equal(same.absAmount, 0);
});
