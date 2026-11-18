import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Budget, Category, Transaction, Wallet } from '../types/index.js';
import { computeTransactionUpdate } from './transactionUpdate.js';
import {
  calculateBudgetProgress,
  calculateIncomeExpenseNet,
  calculateMonthlySummary,
  getCustomMonthDateRange,
  getTransactionsInDateRange,
  roundMoney,
} from './calculations.js';

function makeWallet(id: string, name: string, balance: number, currency = 'EGP', balanceMinor?: number): Wallet {
  return {
    id,
    name,
    currency,
    initialBalance: balance,
    balance,
    ...(balanceMinor !== undefined ? { balanceMinor } : {}),
    color: '#3A605B',
    icon: 'Wallet',
    isArchived: false,
  };
}

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    amount: 100,
    currency: 'EGP',
    date: '2026-11-10',
    time: '12:00',
    categoryId: 'cat-food',
    walletId: 'w-cash',
    notes: '',
    priority: 'normal',
    doesNotAffectBalance: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

const TEST_CATS: Category[] = [
  { id: 'cat-food', nameAr: 'طعام', nameEn: 'Food', icon: 'Utensils', color: '#B5523B', type: 'expense', order: 1 },
  { id: 'cat-salary', nameAr: 'راتب', nameEn: 'Salary', icon: 'Wallet', color: '#5E7F3A', type: 'income', order: 2 },
];

describe('computeTransactionUpdate delta accounting & monthly statistics parity', () => {
  it('expense increase deducts only the positive delta and updates that month stats & budget', () => {
    const cash = makeWallet('w-cash', 'Cash', 900); // started at 1000, spent 100
    const tx = makeTx({ id: 'tx-exp', type: 'expense', amount: 100, date: '2026-11-10', walletId: 'w-cash' });
    const budget: Budget = { id: 'b-nov', name: 'Nov Food', amount: 500, month: '2026-11', categoryId: 'cat-food', rollover: false };

    const res = computeTransactionUpdate(tx, { amount: 160 }, [cash]);
    assert.equal(res.oldAmount, 100);
    assert.equal(res.newAmount, 160);
    assert.equal(res.amountDiff, 60);
    // 900 - 60 = 840
    assert.equal(res.updatedWallets[0].balance, 840);

    const updatedTxs = [res.mergedTx];
    const novSummary = calculateMonthlySummary(updatedTxs, TEST_CATS, 'EGP', undefined, new Date(2026, 10, 16), 1);
    assert.equal(novSummary.thisMonthExpense, 160);

    const budgetProgress = calculateBudgetProgress(budget, updatedTxs, 'EGP');
    assert.equal(budgetProgress.spent, 160);
    assert.equal(budgetProgress.remaining, 340);
  });

  it('expense decrease refunds the negative delta back to wallet and reduces monthly expense', () => {
    const cash = makeWallet('w-cash', 'Cash', 700); // started at 1000, spent 300
    const tx = makeTx({ id: 'tx-exp', type: 'expense', amount: 300, date: '2026-11-05', walletId: 'w-cash' });

    const res = computeTransactionUpdate(tx, { amount: 180 }, [cash]);
    assert.equal(res.amountDiff, -120);
    // 700 + 120 = 820
    assert.equal(res.updatedWallets[0].balance, 820);

    const novSummary = calculateMonthlySummary([res.mergedTx], TEST_CATS, 'EGP', undefined, new Date(2026, 10, 16), 1);
    assert.equal(novSummary.thisMonthExpense, 180);
  });

  it('income increase adds positive delta and income decrease deducts negative delta', () => {
    const bank = makeWallet('w-bank', 'Bank', 5000);
    const tx = makeTx({ id: 'tx-inc', type: 'income', amount: 1000, categoryId: 'cat-salary', date: '2026-11-01', walletId: 'w-bank' });

    const up = computeTransactionUpdate(tx, { amount: 1450 }, [bank]);
    assert.equal(up.amountDiff, 450);
    assert.equal(up.updatedWallets[0].balance, 5450);

    const down = computeTransactionUpdate(up.mergedTx, { amount: 800 }, up.updatedWallets);
    assert.equal(down.amountDiff, -650);
    // 5450 - 650 = 4800
    assert.equal(down.updatedWallets[0].balance, 4800);

    const novSummary = calculateMonthlySummary([down.mergedTx], TEST_CATS, 'EGP', undefined, new Date(2026, 10, 16), 1);
    assert.equal(novSummary.thisMonthIncome, 800);
  });

  it('handles changing wallet on edit: refunds old wallet fully and charges/credits new wallet fully', () => {
    // Wallet A had 1000, spent 250 -> 750. Wallet B has 2000.
    const walletA = makeWallet('w-a', 'Wallet A', 750);
    const walletB = makeWallet('w-b', 'Wallet B', 2000);
    const expTx = makeTx({ id: 'tx-move', type: 'expense', amount: 250, walletId: 'w-a', date: '2026-11-12' });

    // Move expense to Wallet B and change amount to 320
    const movedExp = computeTransactionUpdate(expTx, { walletId: 'w-b', amount: 320 }, [walletA, walletB]);
    const nextA = movedExp.updatedWallets.find((w) => w.id === 'w-a')!;
    const nextB = movedExp.updatedWallets.find((w) => w.id === 'w-b')!;
    assert.equal(nextA.balance, 1000); // +250 refunded
    assert.equal(nextB.balance, 1680); // -320 deducted

    // Now test moving an Income of 500 from Wallet A (current 1500) to Wallet B (current 1000) with new amount 650
    const incA = makeWallet('w-a', 'Wallet A', 1500);
    const incB = makeWallet('w-b', 'Wallet B', 1000);
    const incTx = makeTx({ id: 'tx-inc-move', type: 'income', amount: 500, walletId: 'w-a', categoryId: 'cat-salary', date: '2026-11-12' });
    const movedInc = computeTransactionUpdate(incTx, { walletId: 'w-b', amount: 650 }, [incA, incB]);
    assert.equal(movedInc.updatedWallets.find((w) => w.id === 'w-a')!.balance, 1000); // -500 deducted from old wallet
    assert.equal(movedInc.updatedWallets.find((w) => w.id === 'w-b')!.balance, 1650); // +650 added to new wallet
  });

  it('updates statistics strictly in the transaction original month without leaking into other months', () => {
    const cash = makeWallet('w-cash', 'Cash', 2000);
    const septTx = makeTx({ id: 'tx-sep', type: 'expense', amount: 400, date: '2026-09-18', walletId: 'w-cash' });
    const novTx = makeTx({ id: 'tx-nov', type: 'expense', amount: 150, date: '2026-11-05', walletId: 'w-cash' });
    const septBudget: Budget = { id: 'b-sep', name: 'Sept Budget', amount: 1000, month: '2026-09', categoryId: 'cat-food', rollover: false };

    const res = computeTransactionUpdate(septTx, { amount: 550 }, [cash]);
    assert.equal(res.updatedWallets[0].balance, 1850); // 2000 - 150

    const allTxs = [res.mergedTx, novTx];
    const septRange = getCustomMonthDateRange('2026-09', 1);
    const septStats = calculateIncomeExpenseNet(
      getTransactionsInDateRange(allTxs, septRange.startDate, septRange.endDate),
      'EGP'
    );
    assert.equal(septStats.expense, 550);

    const septBudgetProgress = calculateBudgetProgress(septBudget, allTxs, 'EGP');
    assert.equal(septBudgetProgress.spent, 550);

    // Current month (Nov 2026) stays strictly 150
    const novSummary = calculateMonthlySummary(allTxs, TEST_CATS, 'EGP', undefined, new Date(2026, 10, 16), 1);
    assert.equal(novSummary.thisMonthExpense, 150);
  });

  it('keeps amountMinor and balanceMinor synchronized when editing an integer-minor transaction', () => {
    const orgWallet = makeWallet('w-org', 'Org Treasury', 900, 'EGP', 90000);
    const orgTx = makeTx({
      id: 'tx-org',
      type: 'expense',
      amount: 100,
      amountMinor: 10000,
      currency: 'EGP',
      walletId: 'w-org',
    });

    const res = computeTransactionUpdate(orgTx, { amount: 175.5 }, [orgWallet]);
    assert.equal(res.mergedTx.amount, 175.5);
    assert.equal(res.mergedTx.amountMinor, 17550);
    assert.equal(res.amountDiff, 75.5);
    assert.equal(res.updatedWallets[0].balance, 824.5);
    assert.equal(res.updatedWallets[0].balanceMinor, 82450);

    // Monthly stats read the exact updated amount (175.5) too
    const stats = calculateIncomeExpenseNet([res.mergedTx], 'EGP');
    assert.equal(stats.expense, 175.5);
  });

  it('handles type switch (expense -> income) on same wallet accurately', () => {
    const cash = makeWallet('w-cash', 'Cash', 800); // started 1000, spent 200
    const tx = makeTx({ id: 'tx-flip', type: 'expense', amount: 200, walletId: 'w-cash' });

    const res = computeTransactionUpdate(tx, { type: 'income', amount: 300 }, [cash]);
    // Reversing -200 gives +200 (1000), applying +300 income gives 1300 (+500 net)
    assert.equal(res.updatedWallets[0].balance, 1300);
  });

  it('rounds transaction amounts and handles self-transfers cleanly via Map aggregation', () => {
    assert.equal(roundMoney(10.129, 'EGP'), 10.13);
    assert.equal(roundMoney(10.129, 'KWD'), 10.129);

    const cash = makeWallet('w-cash', 'Cash', 1000, 'EGP', 100000);
    const selfTransfer = makeTx({
      id: 'tx-self',
      type: 'transfer',
      amount: 100,
      convertedAmount: 100,
      transferFee: 5.556,
      walletId: 'w-cash',
      toWalletId: 'w-cash',
    });

    const res = computeTransactionUpdate(
      selfTransfer,
      { amount: 200.129, transferFee: 2.345 },
      [cash]
    );
    assert.equal(res.mergedTx.amount, 200.13);
    assert.equal(res.mergedTx.transferFee, 2.35);
    // Reversing old self-transfer (+100 + 5.56 - 100 = +5.56) then applying new (-200.13 - 2.35 + 200.13 = -2.35) -> net +3.21
    assert.equal(res.updatedWallets[0].balance, 1003.21);
    assert.equal(res.updatedWallets[0].balanceMinor, 100321);
  });
});
