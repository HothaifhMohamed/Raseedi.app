import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toArabicNumerals,
  formatCurrencyAmount,
  evaluateCalculatorExpression,
  calculateTotalBalance,
  calculateIncomeExpenseNet,
  calculateBudgetProgress,
  calculateNextDueDate,
  formatLocalDate,
  parseLocalDate,
  getCustomMonthDateRange,
  getActiveFiscalMonthStr,
  calculateSafeToSpend,
  calculateMonthEndForecast,
  getTransactionWalletDeltas,
  doesTransactionAffectAccounting,
  calculateVatBreakdown,
  calculateEnterprisePnL,
  calculateCostCenterReport,
  calculateAgingReport,
  calculateMoneyCircleSummary,
  generateNextVoucherNumber,
} from './calculations';
import { convertCurrency, roundCurrency, getCurrencyDecimals } from './currency';
import {
  mergeSettingsWithDefaults,
  createStarterOrgCategories,
  createStarterCostCentersForIndustry,
} from './db';
import { SUPPORT_CONFIG } from '../constants/support';
import {
  Wallet,
  Transaction,
  Budget,
  RecurrenceRule,
  Category,
  CostCenter,
  BusinessParty,
  MoneyCircle,
} from '../types';

test('toArabicNumerals converts western digits to arabic digits', () => {
  assert.equal(toArabicNumerals('12345'), '١٢٣٤٥');
  assert.equal(toArabicNumerals('10.50 ج.م'), '١٠.٥٠ ج.م');
});

test('evaluateCalculatorExpression computes mathematical expressions correctly', () => {
  assert.equal(evaluateCalculatorExpression('10 + 20 * 2').result, 50);
  assert.equal(evaluateCalculatorExpression('(15 + 5) ÷ 4').result, 5);
  assert.equal(evaluateCalculatorExpression('100 − 25.5').result, 74.5);
  assert.equal(evaluateCalculatorExpression('50 × 2').result, 100);
  assert.equal(evaluateCalculatorExpression('').result, 0);
  // Live typing trailing operator test
  assert.equal(evaluateCalculatorExpression('50 + ').result, 50);
  assert.equal(evaluateCalculatorExpression('50 + ').error, false);
});

test('convertCurrency converts accurately using rate table', () => {
  // USD to USD
  assert.equal(convertCurrency(100, 'USD', 'USD'), 100);
  // EGP rate is ~50.2, USD is 1.0 -> 50.2 EGP = 1.00 USD
  const inUSD = convertCurrency(50.2, 'EGP', 'USD');
  assert.equal(inUSD, 1);
  // Custom rate override
  const custom = convertCurrency(100, 'USD', 'EGP', { EGP: 50 });
  assert.equal(custom, 5000);
});

test('calculateTotalBalance aggregates wallets with currency conversion', () => {
  const wallets: Wallet[] = [
    {
      id: 'w1',
      name: 'Cash',
      currency: 'EGP',
      initialBalance: 1000,
      balance: 1000,
      color: '#3A605B',
      icon: 'Wallet',
      isArchived: false,
      order: 1,
    },
    {
      id: 'w2',
      name: 'USD Account',
      currency: 'USD',
      initialBalance: 100,
      balance: 100,
      color: '#3E4E63',
      icon: 'CreditCard',
      isArchived: false,
      order: 2,
    },
  ];

  // In USD: 100 USD + (1000 EGP / 50.2 = ~19.92 USD) = 119.92
  const totalInUSD = calculateTotalBalance(wallets, 'USD');
  assert.ok(totalInUSD > 115 && totalInUSD < 125);

  // In EGP with custom rate 50: 1000 + (100 * 50) = 6000
  const totalInEGP = calculateTotalBalance(wallets, 'EGP', { EGP: 50, USD: 1 });
  assert.equal(totalInEGP, 6000);
});

test('calculateIncomeExpenseNet computes net balance correctly', () => {
  const transactions: Transaction[] = [
    {
      id: 't1',
      type: 'income',
      amount: 5000,
      currency: 'EGP',
      date: '2026-11-01',
      time: '10:00',
      categoryId: 'salary',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 't2',
      type: 'expense',
      amount: 1500,
      currency: 'EGP',
      date: '2026-11-02',
      time: '12:00',
      categoryId: 'groceries',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: 2,
      updatedAt: 2,
    },
    {
      id: 't3',
      type: 'expense',
      amount: 500,
      currency: 'EGP',
      date: '2026-11-02',
      time: '14:00',
      categoryId: 'cafes',
      walletId: 'w1',
      priority: 'leisure',
      doesNotAffectBalance: true, // Should not affect net!
      createdAt: 3,
      updatedAt: 3,
    },
  ];

  const stats = calculateIncomeExpenseNet(transactions, 'EGP');
  assert.equal(stats.income, 5000);
  assert.equal(stats.expense, 1500);
  assert.equal(stats.net, 3500);
});

test('calculateBudgetProgress identifies warning and exceeded status', () => {
  const budget: Budget = {
    id: 'b1',
    name: 'Groceries Budget',
    amount: 1000,
    month: '2026-11',
    categoryId: 'groceries',
    rollover: false,
  };

  const transactions: Transaction[] = [
    {
      id: 't1',
      type: 'expense',
      amount: 850,
      currency: 'EGP',
      date: '2026-11-05',
      time: '10:00',
      categoryId: 'groceries',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: 1,
      updatedAt: 1,
    },
  ];

  const progress = calculateBudgetProgress(budget, transactions, 'EGP');
  assert.equal(progress.spent, 850);
  assert.equal(progress.remaining, 150);
  assert.equal(progress.percentage, 85);
  assert.equal(progress.isWarning, true);
  assert.equal(progress.isExceeded, false);
});

test('calculateNextDueDate advances recurrence rules accurately', () => {
  const dailyRule: RecurrenceRule = {
    frequency: 'daily',
    interval: 1,
    occurrencesCount: 0,
    nextDueDate: '2026-11-01',
  };
  assert.equal(calculateNextDueDate(dailyRule, '2026-11-01'), '2026-11-02');

  const monthlyRule: RecurrenceRule = {
    frequency: 'monthly',
    interval: 1,
    occurrencesCount: 0,
    nextDueDate: '2026-11-01',
  };
  assert.equal(calculateNextDueDate(monthlyRule, '2026-11-01'), '2026-12-01');
});

test('security: verifyAndUpgradePin migrates legacy plain-text and legacy SHA-256 PINs to PBKDF2', async () => {
  const { hashPin, verifyPin, verifyAndUpgradePin } = await import('./security');

  // 1. Modern PBKDF2-SHA256 salted PIN verification
  const { hash, salt } = await hashPin('1234');
  assert.ok(hash.startsWith('pbkdf2$100000$'), 'Hash should use pbkdf2$100000$ prefix');
  assert.equal(hash.length, 'pbkdf2$100000$'.length + 64);
  assert.equal(salt.length, 32, 'Salt hex string should be 32 chars');
  assert.equal(await verifyPin('1234', hash, salt), true);
  assert.equal(await verifyPin('9999', hash, salt), false);

  // 2. Legacy plain-text PIN: no salt stored -> auto-upgrades to PBKDF2
  const legacyPlainPin = '5678';
  const legacyCheck = await verifyAndUpgradePin('5678', legacyPlainPin);
  assert.equal(legacyCheck.valid, true);
  assert.equal(legacyCheck.needsUpgrade, true);
  assert.ok(legacyCheck.newHash?.startsWith('pbkdf2$100000$'));
  assert.ok(legacyCheck.newSalt);
  assert.equal(await verifyPin('5678', legacyCheck.newHash, legacyCheck.newSalt), true);

  // 3. Legacy single-SHA-256 salted PIN -> auto-upgrades to PBKDF2
  const legacySalt = '0123456789abcdef0123456789abcdef';
  const digestBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${legacySalt}:4321`));
  const legacySha256Hex = Array.from(new Uint8Array(digestBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const shaCheck = await verifyAndUpgradePin('4321', legacySha256Hex, legacySalt);
  assert.equal(shaCheck.valid, true);
  assert.equal(shaCheck.needsUpgrade, true);
  assert.ok(shaCheck.newHash?.startsWith('pbkdf2$100000$'));
  assert.equal(await verifyPin('4321', shaCheck.newHash, shaCheck.newSalt), true);
});

test('formatLocalDate and parseLocalDate avoid UTC timezone day shifts', () => {
  const localLateNight = new Date(2026, 4, 15, 23, 55, 0);
  assert.equal(formatLocalDate(localLateNight), '2026-05-15');

  const parsed = parseLocalDate('2026-05-15');
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 4);
  assert.equal(parsed.getDate(), 15);

  const rule: RecurrenceRule = {
    frequency: 'monthly',
    interval: 1,
    occurrencesCount: 0,
    nextDueDate: '2026-01-15',
  };
  assert.equal(calculateNextDueDate(rule, '2026-01-15'), '2026-02-15');
});

test('getCustomMonthDateRange and getActiveFiscalMonthStr respect firstDayOfMonth and short months', () => {
  // Standard calendar month
  const standard = getCustomMonthDateRange('2025-05', 1);
  assert.equal(standard.startDate, '2025-05-01');
  assert.equal(standard.endDate, '2025-05-31');
  assert.equal(standard.totalDays, 31);

  // Payday cycle starting on 25th
  const cycle25 = getCustomMonthDateRange('2025-05', 25);
  assert.equal(cycle25.startDate, '2025-05-25');
  assert.equal(cycle25.endDate, '2025-06-24');
  assert.equal(cycle25.totalDays, 31);

  // Leap year Feb with firstDayOfMonth = 31 (clamped without gaps/overlaps)
  const janLeap = getCustomMonthDateRange('2024-01', 31);
  assert.equal(janLeap.startDate, '2024-01-31');
  assert.equal(janLeap.endDate, '2024-02-28');
  assert.equal(janLeap.totalDays, 29);

  // Active fiscal month resolution
  assert.equal(getActiveFiscalMonthStr(new Date(2025, 4, 24), 25), '2025-04');
  assert.equal(getActiveFiscalMonthStr(new Date(2025, 4, 25), 25), '2025-05');
});

test('calculateBudgetProgress applies custom firstDayOfMonth and dynamic rollover surplus/deficit', () => {
  const budgets: Budget[] = [
    {
      id: 'b-apr',
      name: 'April Budget',
      amount: 1000,
      month: '2025-04',
      rollover: false,
    },
    {
      id: 'b-may',
      name: 'May Budget',
      amount: 1000,
      month: '2025-05',
      rollover: true,
    },
  ];

  const txs: Transaction[] = [
    // Falls in 2025-04 fiscal cycle (2025-04-25 .. 2025-05-24) when firstDayOfMonth=25
    {
      id: 'tx-apr-cycle',
      type: 'expense',
      amount: 700,
      currency: 'EGP',
      date: '2025-05-10',
      time: '12:00',
      categoryId: 'cat-groceries',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: 1,
      updatedAt: 1,
    },
    // Falls in 2025-05 fiscal cycle (2025-05-25 .. 2025-06-24) when firstDayOfMonth=25
    {
      id: 'tx-may-cycle',
      type: 'expense',
      amount: 500,
      currency: 'EGP',
      date: '2025-05-26',
      time: '12:00',
      categoryId: 'cat-groceries',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: 2,
      updatedAt: 2,
    },
  ];

  const mayProgress = calculateBudgetProgress(budgets[1], txs, 'EGP', undefined, {
    firstDayOfMonth: 25,
    allBudgets: budgets,
  });

  // April remaining = 1000 - 700 = 300 surplus rolled over -> May totalAllowed = 1300, spent = 500 -> remaining = 800
  assert.equal(mayProgress.effectiveRolloverAmount, 300);
  assert.equal(mayProgress.spent, 500);
  assert.equal(mayProgress.remaining, 800);

  // Verify Safe-to-Spend & Month-End Forecast honor firstDayOfMonth=25 on 2025-05-26
  const refDate = new Date(2025, 4, 26, 12, 0, 0); // 2nd day of 31-day fiscal cycle (May 25 .. Jun 24)
  const safe = calculateSafeToSpend(budgets, txs, 'EGP', undefined, refDate, 25);
  assert.equal(safe.hasBudget, true);
  assert.equal(safe.daysLeftInMonth, 30);
  assert.equal(safe.remaining, 800);

  const forecast = calculateMonthEndForecast(txs, 'EGP', undefined, refDate, 25);
  assert.equal(forecast.daysElapsed, 2);
  assert.equal(forecast.totalDaysInMonth, 31);
  assert.equal(forecast.spentSoFar, 500);
  assert.equal(forecast.dailyAverage, 250);
  assert.equal(forecast.projectedTotal, 7750);
});

test('formatLocalDate() defaults to current local date', () => {
  const defaultToday = formatLocalDate();
  assert.match(defaultToday, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(defaultToday, formatLocalDate(new Date()));
});

test('getTransactionWalletDeltas deducts amount + transferFee from source and credits net convertedAmount to dest', () => {
  const transferWithFee = getTransactionWalletDeltas({
    type: 'transfer',
    amount: 1000,
    transferFee: 15,
    convertedAmount: 20, // e.g., EGP -> USD
    toWalletId: 'w-usd',
    doesNotAffectBalance: false,
  });
  assert.equal(transferWithFee.sourceDelta, -1015);
  assert.equal(transferWithFee.destDelta, 20);

  const transferSameCurrencyNoExplicitConverted = getTransactionWalletDeltas({
    type: 'transfer',
    amount: 500,
    transferFee: 10,
    toWalletId: 'w-bank',
    doesNotAffectBalance: false,
  });
  assert.equal(transferSameCurrencyNoExplicitConverted.sourceDelta, -510);
  assert.equal(transferSameCurrencyNoExplicitConverted.destDelta, 500);

  const ignoredTx = getTransactionWalletDeltas({
    type: 'transfer',
    amount: 500,
    transferFee: 10,
    convertedAmount: 500,
    toWalletId: 'w-bank',
    doesNotAffectBalance: true,
  });
  assert.equal(ignoredTx.sourceDelta, 0);
  assert.equal(ignoredTx.destDelta, 0);
});

test('security: escalating persistent PIN lockout triggers 30s then 60s lock after 5 failed attempts', async () => {
  const { getPinLockoutState, recordFailedPinAttempt, resetPinLockout } = await import('./security');
  const backing = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backing.set(k, v);
    },
    removeItem: (k: string) => {
      backing.delete(k);
    },
  };

  let now = 1_000_000;
  for (let i = 0; i < 4; i++) {
    const s = recordFailedPinAttempt('app', now, mockStorage);
    assert.equal(s.isLocked, false);
    assert.equal(s.attemptsRemaining, 4 - i);
  }

  const firstLock = recordFailedPinAttempt('app', now, mockStorage);
  assert.equal(firstLock.isLocked, true);
  assert.equal(firstLock.remainingLockSeconds, 30);

  // Wait 31s -> unlocked again, fail 5 more times -> 60s lockout
  now += 31_000;
  assert.equal(getPinLockoutState('app', now, mockStorage).isLocked, false);
  for (let i = 0; i < 4; i++) {
    recordFailedPinAttempt('app', now, mockStorage);
  }
  const secondLock = recordFailedPinAttempt('app', now, mockStorage);
  assert.equal(secondLock.isLocked, true);
  assert.equal(secondLock.remainingLockSeconds, 60);

  resetPinLockout('app', mockStorage);
  const reset = getPinLockoutState('app', now, mockStorage);
  assert.equal(reset.isLocked, false);
  assert.equal(reset.attemptsRemaining, 5);
});

test('currency: 3-decimal currencies (KWD, BHD, OMR, JOD, TND, LYD, IQD) round & convert accurately', () => {
  for (const code of ['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'LYD', 'IQD']) {
    assert.equal(getCurrencyDecimals(code), 3, `${code} must use 3 decimals`);
    assert.equal(roundCurrency(12.3456, code), 12.346);
  }
  assert.equal(getCurrencyDecimals('EGP'), 2);
  assert.equal(roundCurrency(12.3456, 'EGP'), 12.35);

  const kwdConverted = convertCurrency(10, 'USD', 'KWD', { USD: 1, KWD: 0.3075 });
  assert.equal(kwdConverted, 3.075);
});

test('safe parser: evaluateCalculatorExpression handles unary minus, nested parens, div-by-zero, and rejects injection', () => {
  assert.equal(evaluateCalculatorExpression('-5 + 3').result, -2);
  assert.equal(evaluateCalculatorExpression('((10 + 5) * 2 - 4) / 2').result, 13);

  const divZero = evaluateCalculatorExpression('10 / (5 - 5)');
  assert.equal(divZero.error, true);

  const injection = evaluateCalculatorExpression('process.exit(1)');
  assert.equal(injection.error, true);
  assert.equal(injection.result, 0);

  const bracketInjection = evaluateCalculatorExpression('1+alert(1)');
  assert.equal(bracketInjection.error, true);
});

test('recurrence: anchorDayOfMonth prevents month-end drift across short & leap February', () => {
  const jan31Rule: RecurrenceRule = {
    frequency: 'monthly',
    interval: 1,
    anchorDayOfMonth: 31,
    occurrencesCount: 0,
    nextDueDate: '2026-01-31',
  };
  const febDate = calculateNextDueDate(jan31Rule, '2026-01-31');
  assert.equal(febDate, '2026-02-28');

  // Next month restores anchor 31 instead of drifting to 28
  const marDate = calculateNextDueDate(jan31Rule, febDate);
  assert.equal(marDate, '2026-03-31');

  // Leap year Feb 29
  const leapJanRule: RecurrenceRule = {
    frequency: 'monthly',
    interval: 1,
    anchorDayOfMonth: 31,
    occurrencesCount: 0,
    nextDueDate: '2024-01-31',
  };
  assert.equal(calculateNextDueDate(leapJanRule, '2024-01-31'), '2024-02-29');
});

test('accounting invariant: pending_approval & rejected transactions never affect balances, budgets, or P&L', () => {
  const txs: Transaction[] = [
    {
      id: 'tx-ok',
      type: 'expense',
      amount: 1000,
      currency: 'EGP',
      date: '2026-11-10',
      time: '10:00',
      categoryId: 'cat-ops',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      approvalStatus: 'approved',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'tx-pending',
      type: 'expense',
      amount: 5000,
      currency: 'EGP',
      date: '2026-11-10',
      time: '11:00',
      categoryId: 'cat-ops',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      approvalStatus: 'pending_approval',
      createdAt: 2,
      updatedAt: 2,
    },
    {
      id: 'tx-rejected',
      type: 'income',
      amount: 9000,
      currency: 'EGP',
      date: '2026-11-10',
      time: '12:00',
      categoryId: 'cat-sales',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      approvalStatus: 'rejected',
      createdAt: 3,
      updatedAt: 3,
    },
  ];

  assert.equal(doesTransactionAffectAccounting(txs[0]), true);
  assert.equal(doesTransactionAffectAccounting(txs[1]), false);
  assert.equal(doesTransactionAffectAccounting(txs[2]), false);

  assert.deepEqual(getTransactionWalletDeltas(txs[1]), { sourceDelta: 0, destDelta: 0 });
  assert.deepEqual(getTransactionWalletDeltas(txs[2]), { sourceDelta: 0, destDelta: 0 });

  const stats = calculateIncomeExpenseNet(txs, 'EGP');
  assert.equal(stats.income, 0);
  assert.equal(stats.expense, 1000);
  assert.equal(stats.net, -1000);

  const budget: Budget = {
    id: 'b-ops',
    name: 'Ops',
    amount: 2000,
    month: '2026-11',
    rollover: false,
  };
  const prog = calculateBudgetProgress(budget, txs, 'EGP');
  assert.equal(prog.spent, 1000);
  assert.equal(prog.remaining, 1000);

  const cats: Category[] = [
    { id: 'cat-ops', nameAr: 'تشغيل', nameEn: 'Ops', icon: 'Tag', color: '#000', type: 'expense', isDefault: true, order: 1 },
  ];
  const pnl = calculateEnterprisePnL(txs, cats, 'EGP');
  assert.equal(pnl.grossRevenue, 0);
  assert.equal(pnl.totalExpensesGross, 1000);
  assert.equal(pnl.operatingProfit, -1000);
});

test('enterprise VAT engine: calculateVatBreakdown computes 14% tax inclusive and exclusive accurately', () => {
  const inclusive = calculateVatBreakdown(1140, 14, true, 'EGP');
  assert.equal(inclusive.netAmount, 1000);
  assert.equal(inclusive.taxAmount, 140);
  assert.equal(inclusive.grossAmount, 1140);

  const exclusive = calculateVatBreakdown(1000, 14, false, 'EGP');
  assert.equal(exclusive.netAmount, 1000);
  assert.equal(exclusive.taxAmount, 140);
  assert.equal(exclusive.grossAmount, 1140);
});

test('enterprise reporting: calculateCostCenterReport & calculateAgingReport buckets (0-30, 31-60, 61-90, 90+)', () => {
  const costCenters: CostCenter[] = [
    {
      id: 'cc1',
      orgId: 'org1',
      code: 'OPS-01',
      nameAr: 'التشغيل',
      nameEn: 'Operations',
      budgetAllocated: 10000,
      isActive: true,
      createdAt: 1,
    },
  ];
  const txs: Transaction[] = [
    {
      id: 't1',
      type: 'expense',
      amount: 2500,
      currency: 'EGP',
      date: '2026-11-05',
      time: '10:00',
      categoryId: 'c1',
      walletId: 'w1',
      costCenterId: 'cc1',
      priority: 'essential',
      doesNotAffectBalance: false,
      approvalStatus: 'approved',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 't2',
      type: 'expense',
      amount: 9999,
      currency: 'EGP',
      date: '2026-11-06',
      time: '10:00',
      categoryId: 'c1',
      walletId: 'w1',
      costCenterId: 'cc1',
      priority: 'essential',
      doesNotAffectBalance: false,
      approvalStatus: 'pending_approval',
      createdAt: 2,
      updatedAt: 2,
    },
  ];
  const ccReport = calculateCostCenterReport(costCenters, txs, 'EGP');
  assert.equal(ccReport[0].spent, 2500);
  assert.equal(ccReport[0].remaining, 7500);
  assert.equal(ccReport[0].utilizationPct, 25);

  const parties: BusinessParty[] = [
    { id: 'p1', orgId: 'o1', type: 'vendor', name: 'V 15d', currency: 'EGP', balance: 1000, dueDate: '2026-11-15', createdAt: 1 },
    { id: 'p2', orgId: 'o1', type: 'vendor', name: 'V 45d', currency: 'EGP', balance: 2000, dueDate: '2026-10-16', createdAt: 1 },
    { id: 'p3', orgId: 'o1', type: 'client', name: 'C 75d', currency: 'EGP', balance: 3000, dueDate: '2026-09-16', createdAt: 1 },
    { id: 'p4', orgId: 'o1', type: 'client', name: 'C 120d', currency: 'EGP', balance: 4000, dueDate: '2026-08-02', createdAt: 1 },
  ];
  const aging = calculateAgingReport(parties, 'EGP', undefined, '2026-11-30');
  assert.equal(aging.payablesTotal, 3000);
  assert.equal(aging.payablesBuckets.bucket0_30, 1000);
  assert.equal(aging.payablesBuckets.bucket31_60, 2000);
  assert.equal(aging.receivablesTotal, 7000);
  assert.equal(aging.receivablesBuckets.bucket61_90, 3000);
  assert.equal(aging.receivablesBuckets.bucket90Plus, 4000);
});

test('mergeSettingsWithDefaults hydrates official socialLinks when missing or blank', () => {
  const missingSocial = mergeSettingsWithDefaults({ language: 'en' });
  assert.equal(missingSocial.socialLinks?.facebookUrl, 'https://www.facebook.com/share/1EzjP2pVDf/');
  assert.equal(missingSocial.socialLinks?.instagramUrl, 'https://www.instagram.com/raseedi.app');
  assert.equal(missingSocial.socialLinks?.facebookUrl, SUPPORT_CONFIG.defaultFacebookUrl);
  assert.equal(missingSocial.socialLinks?.instagramUrl, SUPPORT_CONFIG.defaultInstagramUrl);

  const blankSocial = mergeSettingsWithDefaults({
    socialLinks: { facebookUrl: '   ', instagramUrl: '' },
  });
  assert.equal(blankSocial.socialLinks?.facebookUrl, SUPPORT_CONFIG.defaultFacebookUrl);
  assert.equal(blankSocial.socialLinks?.instagramUrl, SUPPORT_CONFIG.defaultInstagramUrl);

  const customSocial = mergeSettingsWithDefaults({
    socialLinks: {
      facebookUrl: 'https://www.facebook.com/custom.page',
      instagramUrl: 'https://www.instagram.com/custom.page',
    },
  });
  assert.equal(customSocial.socialLinks?.facebookUrl, 'https://www.facebook.com/custom.page');
  assert.equal(customSocial.socialLinks?.instagramUrl, 'https://www.instagram.com/custom.page');
  assert.equal(customSocial.isPro, false);
});

test('calculateMoneyCircleSummary computes pool total, progress, next unpaid month, and completion', () => {
  const circle: MoneyCircle = {
    id: 'mc-1',
    name: 'جمعية العمل',
    monthlyShare: 1500,
    currency: 'EGP',
    totalMonths: 6,
    myTurnMonth: 3,
    paidMonths: ['1', '2', '2'], // duplicate guarded
    hasReceivedPayout: false,
    createdAt: 1,
  };

  const summary = calculateMoneyCircleSummary(circle);
  assert.equal(summary.totalPoolAmount, 9000);
  assert.equal(summary.paidCount, 2);
  assert.equal(summary.remainingMonths, 4);
  assert.equal(summary.totalPaid, 3000);
  assert.equal(summary.totalRemaining, 6000);
  assert.equal(summary.progressPct, 33);
  assert.equal(summary.nextUnpaidMonthNumber, 3);
  assert.equal(summary.isCompleted, false);

  const completed = calculateMoneyCircleSummary({
    ...circle,
    paidMonths: ['1', '2', '3', '4', '5', '6'],
    hasReceivedPayout: true,
  });
  assert.equal(completed.progressPct, 100);
  assert.equal(completed.nextUnpaidMonthNumber, null);
  assert.equal(completed.isCompleted, true);
});

test('generateNextVoucherNumber increments RV, PV, and TV prefixes sequentially', () => {
  const txs: Pick<Transaction, 'type' | 'voucherNumber'>[] = [
    { type: 'income', voucherNumber: 'RV-0001' },
    { type: 'income', voucherNumber: 'RV-0009' },
    { type: 'expense', voucherNumber: 'PV-0003' },
    { type: 'transfer', voucherNumber: 'TV-0002' },
  ];

  assert.equal(generateNextVoucherNumber(txs, 'income'), 'RV-0010');
  assert.equal(generateNextVoucherNumber(txs, 'expense'), 'PV-0004');
  assert.equal(generateNextVoucherNumber(txs, 'transfer'), 'TV-0003');
  assert.equal(generateNextVoucherNumber([], 'expense'), 'PV-0001');
});

test('industry starter generators tailor categories and typed cost centers per industry', () => {
  const techCats = createStarterOrgCategories('tech');
  assert.ok(techCats.some((c) => c.nameEn.includes('SaaS')));
  const restaurantCats = createStarterOrgCategories('restaurant');
  assert.ok(restaurantCats.some((c) => c.nameEn.includes('Food') || c.nameEn.includes('Raw Ingredients')));

  const techCenters = createStarterCostCentersForIndustry('org-1', 'tech', true, 123);
  assert.equal(techCenters.length, 2);
  assert.equal(techCenters[0].type, 'project');
  assert.equal(techCenters[0].budgetAllocated, 120000);

  const retailCenters = createStarterCostCentersForIndustry('org-2', 'retail', false, 456);
  assert.equal(retailCenters[0].type, 'branch');
  assert.equal(retailCenters[0].budgetAllocated, 50000);
});




