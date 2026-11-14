import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSafeToSpend,
  calculateWeeklyInsight,
  calculateMonthEndForecast,
  calculateMonthlySummary,
  getActiveBudgetAlerts,
  getUpcomingDebtReminders,
  chunkTransactionsForBackup,
  generateSyntheticTransactions,
  groupTransactionsByDay,
  calculateIncomeExpenseNet,
} from './calculations';
import { parseDialectQuickEntry } from './dialectParser';
import {
  encryptBackupJson,
  decryptBackupJson,
  isEncryptedBackupPayload,
} from './security';
import {
  parseCsvText,
  autoDetectCsvMapping,
  mapCsvRowsToTransactions,
} from './csvImport';
import { DEFAULT_CATEGORIES, validateBackupSchema } from './db';
import { Budget, Debt, Transaction } from '../types';

test('safe-to-spend: computes remaining / days left and negative warning state', () => {
  const refDate = new Date('2025-05-22T12:00:00'); // May has 31 days -> 10 days left (22..31 inclusive)
  const budgets: Budget[] = [
    {
      id: 'b1',
      name: 'Monthly Overall',
      amount: 10000,
      month: '2025-05',
      rollover: false,
    },
  ];
  const txs: Transaction[] = [
    {
      id: 't1',
      type: 'expense',
      amount: 4000,
      currency: 'EGP',
      date: '2025-05-10',
      time: '10:00',
      categoryId: 'cat-groceries',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: 1,
      updatedAt: 1,
    },
  ];

  const ok = calculateSafeToSpend(budgets, txs, 'EGP', undefined, refDate);
  assert.equal(ok.hasBudget, true);
  assert.equal(ok.daysLeftInMonth, 10);
  assert.equal(ok.remaining, 6000);
  assert.equal(ok.dailySafeAmount, 600);
  assert.equal(ok.isNegative, false);

  // Exceed budget -> negative safe-to-spend
  const overTxs: Transaction[] = [
    ...txs,
    {
      ...txs[0],
      id: 't2',
      amount: 7500,
    },
  ];
  const over = calculateSafeToSpend(budgets, overTxs, 'EGP', undefined, refDate);
  assert.equal(over.remaining, -1500);
  assert.equal(over.dailySafeAmount, -150);
  assert.equal(over.isNegative, true);

  // No budget case
  const noBudget = calculateSafeToSpend([], txs, 'EGP', undefined, refDate);
  assert.equal(noBudget.hasBudget, false);
});

test('dialectParser: parses Egyptian Arabic & Eastern Arabic digits on-device', () => {
  const res1 = parseDialectQuickEntry('غدا 50', DEFAULT_CATEGORIES);
  assert.ok(res1);
  assert.equal(res1.amount, 50);
  assert.equal(res1.type, 'expense');
  assert.equal(res1.categoryId, 'cat-restaurants');

  const res2 = parseDialectQuickEntry('بنزين ٢٠٠', DEFAULT_CATEGORIES);
  assert.ok(res2);
  assert.equal(res2.amount, 200);
  assert.equal(res2.type, 'expense');
  assert.equal(res2.categoryId, 'cat-fuel');

  const res3 = parseDialectQuickEntry('راتب 8000', DEFAULT_CATEGORIES);
  assert.ok(res3);
  assert.equal(res3.amount, 8000);
  assert.equal(res3.type, 'income');
  assert.equal(res3.categoryId, 'cat-salary');

  const res4 = parseDialectQuickEntry('قهوة ستاربكس 125.5', DEFAULT_CATEGORIES);
  assert.ok(res4);
  assert.equal(res4.amount, 125.5);
  assert.equal(res4.categoryId, 'cat-cafes');

  assert.equal(parseDialectQuickEntry('لا يوجد رقم', DEFAULT_CATEGORIES), null);
});

test('security: AES-GCM + PBKDF2 backup encryption & decryption round-trip', async () => {
  const samplePayload = JSON.stringify({
    version: 1,
    transactions: [{ id: 't1', amount: 150 }],
  });

  const encrypted = await encryptBackupJson(samplePayload, 'MySecretPass123');
  assert.equal(isEncryptedBackupPayload(encrypted), true);
  assert.equal(isEncryptedBackupPayload(samplePayload), false);

  const decrypted = await decryptBackupJson(encrypted, 'MySecretPass123');
  assert.equal(decrypted, samplePayload);

  await assert.rejects(() => decryptBackupJson(encrypted, 'WrongPassword'));
});

test('csvImport: parses quoted CSV, auto-detects Arabic/English columns, detects duplicates', () => {
  const csv = [
    'التاريخ,المبلغ,النوع,التصنيف,ملاحظات',
    '2025-05-10,120.50,مصروف,مطاعم,"غداء عمل, وسط البلد"',
    '11/05/2025,8000,دخل,راتب شهري,مرتب مايو',
    '2025-05-12,95,مصروف,مواصلات,مشوار أوبر',
  ].join('\n');

  const table = parseCsvText(csv);
  assert.equal(table.headers.length, 5);
  assert.equal(table.rows.length, 3);

  const mapping = autoDetectCsvMapping(table.headers);
  assert.equal(mapping.dateIndex, 0);
  assert.equal(mapping.amountIndex, 1);
  assert.equal(mapping.typeIndex, 2);
  assert.equal(mapping.categoryIndex, 3);
  assert.equal(mapping.notesIndex, 4);

  const existing: Transaction[] = [
    {
      id: 'existing-1',
      type: 'expense',
      amount: 120.5,
      currency: 'EGP',
      date: '2025-05-10',
      time: '12:00',
      categoryId: 'cat-restaurants',
      walletId: 'w-cash',
      priority: 'normal',
      doesNotAffectBalance: false,
      createdAt: 1,
      updatedAt: 1,
    },
  ];

  const mapped = mapCsvRowsToTransactions({
    rows: table.rows,
    mapping,
    categories: DEFAULT_CATEGORIES,
    existingTransactions: existing,
  });

  assert.equal(mapped.validCount, 3);
  assert.equal(mapped.duplicateCount, 1);
  assert.equal(mapped.previewRows[0].isDuplicate, true);
  assert.equal(mapped.previewRows[0].notes, 'غداء عمل, وسط البلد');
  assert.equal(mapped.previewRows[1].date, '2025-05-11');
  assert.equal(mapped.previewRows[1].type, 'income');
  assert.equal(mapped.previewRows[2].isDuplicate, false);
});

test('weeklyInsight & monthEndForecast: calculates week-over-week category delta and month projection', () => {
  const now = new Date('2025-05-15T12:00:00');
  const txs: Transaction[] = [
    // This week (May 9..15): 600 restaurants
    {
      id: 'tw1',
      type: 'expense',
      amount: 600,
      currency: 'EGP',
      date: '2025-05-14',
      time: '13:00',
      categoryId: 'cat-restaurants',
      walletId: 'w1',
      priority: 'normal',
      doesNotAffectBalance: false,
      createdAt: 1,
      updatedAt: 1,
    },
    // Last week (May 2..8): 400 restaurants
    {
      id: 'lw1',
      type: 'expense',
      amount: 400,
      currency: 'EGP',
      date: '2025-05-05',
      time: '13:00',
      categoryId: 'cat-restaurants',
      walletId: 'w1',
      priority: 'normal',
      doesNotAffectBalance: false,
      createdAt: 1,
      updatedAt: 1,
    },
    // Earlier in month (May 1): 500 bills (total in May so far = 1500 over 15 days -> 100/day -> 3100 projected for 31-day May)
    {
      id: 'm1',
      type: 'expense',
      amount: 500,
      currency: 'EGP',
      date: '2025-05-01',
      time: '10:00',
      categoryId: 'cat-bills',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: 1,
      updatedAt: 1,
    },
  ];

  const insight = calculateWeeklyInsight(txs, DEFAULT_CATEGORIES, 'EGP', undefined, now);
  assert.equal(insight.hasData, true);
  assert.equal(insight.thisWeekTotal, 600);
  assert.equal(insight.lastWeekTotal, 400);
  assert.equal(insight.totalDiffPct, 50);
  assert.equal(insight.topCategoryId, 'cat-restaurants');
  assert.equal(insight.topCategoryDiffPct, 50);

  const forecast = calculateMonthEndForecast(txs, 'EGP', undefined, now);
  assert.equal(forecast.spentSoFar, 1500);
  assert.equal(forecast.daysElapsed, 15);
  assert.equal(forecast.totalDaysInMonth, 31);
  assert.equal(forecast.dailyAverage, 100);
  assert.equal(forecast.projectedTotal, 3100);
});

test('performance: 5,000 generated transactions group, aggregate, insight, forecast & CSV-dup check under 500ms', () => {
  const now = new Date('2025-05-15T12:00:00');
  const start = performance.now();
  const fiveThousand = generateSyntheticTransactions(5000, now);

  const grouped = groupTransactionsByDay(fiveThousand, 'EGP');
  const totals = calculateIncomeExpenseNet(fiveThousand, 'EGP');
  const insight = calculateWeeklyInsight(fiveThousand, DEFAULT_CATEGORIES, 'EGP', undefined, now);
  const forecast = calculateMonthEndForecast(fiveThousand, 'EGP', undefined, now);
  const dupCheck = mapCsvRowsToTransactions({
    rows: fiveThousand.slice(0, 100).map((t) => [t.date, String(t.amount), t.type, 'مطاعم', t.notes || '']),
    mapping: { dateIndex: 0, amountIndex: 1, typeIndex: 2, categoryIndex: 3, notesIndex: 4 },
    categories: DEFAULT_CATEGORIES,
    existingTransactions: fiveThousand,
  });

  const elapsedMs = performance.now() - start;

  assert.equal(fiveThousand.length, 5000);
  assert.ok(grouped.length > 0);
  assert.ok(totals.expense > 0);
  assert.equal(insight.hasData, true);
  assert.ok(forecast.projectedTotal > 0);
  assert.equal(dupCheck.duplicateCount, 100);
  assert.ok(elapsedMs < 500, `Expected 5,000-tx pipeline under 500ms, took ${elapsedMs.toFixed(1)}ms`);
});

test('monthlySummary, budgetAlerts, debtReminders & backup chunking work accurately', () => {
  const now = new Date('2025-05-15T12:00:00');
  const txs: Transaction[] = [
    {
      id: 'c1',
      type: 'expense',
      amount: 900,
      currency: 'EGP',
      date: '2025-05-10',
      time: '12:00',
      categoryId: 'cat-restaurants',
      walletId: 'w1',
      priority: 'normal',
      doesNotAffectBalance: false,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'c2',
      type: 'expense',
      amount: 1200,
      currency: 'EGP',
      date: '2025-05-12',
      time: '12:00',
      categoryId: 'cat-groceries',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: 2,
      updatedAt: 2,
    },
    {
      id: 'p1',
      type: 'expense',
      amount: 1000,
      currency: 'EGP',
      date: '2025-04-10',
      time: '12:00',
      categoryId: 'cat-groceries',
      walletId: 'w1',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: 3,
      updatedAt: 3,
    },
  ];

  const summary = calculateMonthlySummary(txs, DEFAULT_CATEGORIES, 'EGP', undefined, now, 1);
  assert.equal(summary.hasData, true);
  assert.equal(summary.thisMonthExpense, 2100);
  assert.equal(summary.prevMonthExpense, 1000);
  assert.equal(summary.expenseDiffPct, 110);
  assert.equal(summary.topCategories[0].categoryId, 'cat-groceries');
  assert.equal(summary.topCategories[1].categoryId, 'cat-restaurants');

  const budgets: Budget[] = [
    { id: 'b-warn', name: 'Restaurants', amount: 1000, month: '2025-05', categoryId: 'cat-restaurants', rollover: false },
    { id: 'b-over', name: 'Groceries', amount: 1000, month: '2025-05', categoryId: 'cat-groceries', rollover: false },
  ];
  const alerts = getActiveBudgetAlerts(budgets, txs, 'EGP', undefined, now, 1);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].budgetId, 'b-over');
  assert.equal(alerts[0].level, 'exceeded');
  assert.equal(alerts[1].budgetId, 'b-warn');
  assert.equal(alerts[1].level, 'warning');

  const debts: Debt[] = [
    {
      id: 'd-soon',
      type: 'i_owe',
      personName: 'Khaled',
      totalAmount: 500,
      paidAmount: 0,
      currency: 'EGP',
      dueDate: '2025-05-17',
      payments: [],
      isSettled: false,
      createdAt: 1,
    },
    {
      id: 'd-far',
      type: 'owed_to_me',
      personName: 'Sara',
      totalAmount: 300,
      paidAmount: 0,
      currency: 'EGP',
      dueDate: '2025-05-30',
      payments: [],
      isSettled: false,
      createdAt: 1,
    },
  ];
  const reminders = getUpcomingDebtReminders(debts, now);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].debtId, 'd-soon');
  assert.equal(reminders[0].daysUntilDue, 2);

  const chunks = chunkTransactionsForBackup(Array.from({ length: 900 }, (_, i) => i), 400);
  assert.deepEqual(
    chunks.map((c) => c.length),
    [400, 400, 100]
  );
});

test('validateBackupSchema: accepts moneyCircles, orgWorkspaces, and activeWorkspace and rejects invalid shapes', () => {
  const validPayload = {
    version: 2,
    transactions: [],
    wallets: [],
    categories: DEFAULT_CATEGORIES,
    moneyCircles: [{ id: 'mc-1', name: 'جمعية الشهر' }],
    orgWorkspaces: {
      'org-1': {
        organization: { id: 'org-1', name: 'شركة الأمل' },
        members: [],
        costCenters: [],
        parties: [],
        transactions: [],
        wallets: [],
        categories: [],
        budgets: [],
        auditLogs: [],
      },
    },
    activeWorkspace: 'org-1',
  };

  assert.equal(validateBackupSchema(validPayload).valid, true);

  assert.equal(
    validateBackupSchema({ ...validPayload, moneyCircles: 'invalid' }).reason,
    'INVALID_MONEY_CIRCLES_FIELD'
  );
  assert.equal(
    validateBackupSchema({ ...validPayload, orgWorkspaces: [] }).reason,
    'INVALID_ORG_WORKSPACES_FIELD'
  );
  assert.equal(
    validateBackupSchema({
      ...validPayload,
      orgWorkspaces: { 'org-1': { organization: { id: 'mismatch' } } },
    }).reason,
    'INVALID_ORG_WORKSPACE_ITEM'
  );
  assert.equal(
    validateBackupSchema({ ...validPayload, activeWorkspace: 123 }).reason,
    'INVALID_ACTIVE_WORKSPACE_FIELD'
  );
});
