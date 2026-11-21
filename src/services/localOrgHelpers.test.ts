import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendLocalOrgAuditLog,
  applyOrgTxBalanceToWallets,
  buildLocalOrgWorkspace,
  doesOrgTxCountTowardBalance,
  formatUnmigratedOrgExtrasNotice,
  getUnmigratedOrgExtrasSummary,
  isRetainedExtrasOnlyWorkspace,
  recalculateLocalOrgWallets,
  retainUnmigratedLocalOrgExtras,
} from './localOrgHelpers';
import {
  getLocalTodayDateString,
  normalizeScannedReceiptResult,
  validateScanReceiptPayload,
} from './serverSecurity';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, validateBackupSchema } from './db';
import { Transaction } from '../types';

test('buildLocalOrgWorkspace initializes localFirstMode org with wallets, minor units, and owner member', () => {
  const now = 1_750_000_000_000;
  const ws = buildLocalOrgWorkspace({
    name: 'أكاديمية طيبة',
    currency: 'EGP',
    industry: 'general',
    vatRate: 14,
    approvalThreshold: 1500,
    taxNumber: 'TRN-12345',
    loadSampleData: true,
    actor: { uid: 'local-owner', name: 'أحمد' },
    now,
  });

  assert.equal(ws.organization.name, 'أكاديمية طيبة');
  assert.equal(ws.organization.currency, 'EGP');
  assert.equal(ws.organization.localFirstMode, true);
  assert.equal(ws.organization.vatRate, 14);
  assert.equal(ws.organization.approvalThreshold, 1500);
  assert.equal(ws.organization.taxNumber, 'TRN-12345');

  assert.equal(ws.wallets.length, 1);
  assert.equal(ws.wallets[0].name, 'الخزينة الرئيسية');
  assert.equal(ws.wallets[0].initialBalance, 0);
  assert.equal(ws.wallets[0].balance, 0);
  assert.equal(ws.wallets[0].balanceMinor, 0);
  assert.equal(ws.members.length, 1);
  assert.equal(ws.members[0].role, 'owner');
  assert.equal(ws.members[0].status, 'active');
  assert.ok(ws.categories.length > 0);
  assert.ok(ws.costCenters.length > 0);
  assert.equal(ws.auditLogs.length, 1);
});

test('applyOrgTxBalanceToWallets respects approval status and direction', () => {
  const ws = buildLocalOrgWorkspace({
    name: 'شركة الاختبار',
    currency: 'EGP',
    loadSampleData: true,
    actor: { uid: 'u1', name: 'Owner' },
    now: 1_750_000_000_000,
  });
  const mainWallet = ws.wallets[0];
  const baseBalance = mainWallet.balance;

  const pendingTx: Transaction = {
    id: 'tx-pending',
    type: 'expense',
    amount: 500,
    currency: 'EGP',
    date: '2026-05-01',
    time: '10:00',
    categoryId: 'cat-other',
    walletId: mainWallet.id,
    notes: 'Pending receipt',
    priority: 'normal',
    doesNotAffectBalance: false,
    approvalStatus: 'pending',
    createdAt: 1,
    updatedAt: 1,
  };

  assert.equal(doesOrgTxCountTowardBalance(pendingTx), false);
  const afterPending = applyOrgTxBalanceToWallets(ws.wallets, pendingTx, {}, 1);
  assert.equal(afterPending[0].balance, baseBalance);

  const approvedTx: Transaction = { ...pendingTx, id: 'tx-approved', approvalStatus: 'approved' };
  assert.equal(doesOrgTxCountTowardBalance(approvedTx), true);
  const afterApprove = applyOrgTxBalanceToWallets(ws.wallets, approvedTx, {}, 1);
  assert.equal(afterApprove[0].balance, baseBalance - 500);
  assert.equal(afterApprove[0].balanceMinor, (baseBalance - 500) * 100);

  const afterReverse = applyOrgTxBalanceToWallets(afterApprove, approvedTx, {}, -1);
  assert.equal(afterReverse[0].balance, baseBalance);
});

test('recalculateLocalOrgWallets recomputes from initialBalance and ignores pending/rejected/deleted transactions', () => {
  const ws = buildLocalOrgWorkspace({
    name: 'أكاديمية طيبة',
    currency: 'EGP',
    loadSampleData: true,
    actor: { uid: 'u1', name: 'Owner' },
    now: 1_750_000_000_000,
  });
  const wCash = ws.wallets[0];

  const txs: Transaction[] = [
    {
      id: 't1',
      type: 'income',
      amount: 1000,
      currency: 'EGP',
      date: '2026-05-01',
      time: '09:00',
      categoryId: 'cat-sales',
      walletId: wCash.id,
      notes: 'Approved income',
      priority: 'normal',
      doesNotAffectBalance: false,
      approvalStatus: 'approved',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 't2',
      type: 'expense',
      amount: 250,
      currency: 'EGP',
      date: '2026-05-02',
      time: '11:00',
      categoryId: 'cat-other',
      walletId: wCash.id,
      notes: 'Paid expense',
      priority: 'normal',
      doesNotAffectBalance: false,
      approvalStatus: 'paid',
      createdAt: 2,
      updatedAt: 2,
    },
    {
      id: 't3',
      type: 'expense',
      amount: 9999,
      currency: 'EGP',
      date: '2026-05-03',
      time: '12:00',
      categoryId: 'cat-other',
      walletId: wCash.id,
      notes: 'Rejected should be ignored',
      priority: 'normal',
      doesNotAffectBalance: false,
      approvalStatus: 'rejected',
      createdAt: 3,
      updatedAt: 3,
    },
    {
      id: 't4',
      type: 'expense',
      amount: 4000,
      currency: 'EGP',
      date: '2026-05-04',
      time: '12:00',
      categoryId: 'cat-other',
      walletId: wCash.id,
      notes: 'Deleted should be ignored',
      priority: 'normal',
      doesNotAffectBalance: false,
      approvalStatus: 'approved',
      deletedAt: 123456,
      createdAt: 4,
      updatedAt: 4,
    },
  ];

  const corruptedWs = {
    ...ws,
    wallets: ws.wallets.map((w, i) => (i === 0 ? { ...w, balance: -999 } : w)),
    transactions: txs,
  };

  const recalculated = recalculateLocalOrgWallets(corruptedWs, {}, { uid: 'u1', name: 'Owner' });
  assert.equal(recalculated.wallets[0].balance, 1000 - 250);
  assert.equal(recalculated.auditLogs[0].action, 'recalculate');

  const logs = appendLocalOrgAuditLog(
    recalculated,
    'update',
    'organization',
    recalculated.organization.id,
    { uid: 'u1', name: 'Owner' },
    'اختبار السجل'
  );
  assert.equal(logs[0].summary, 'اختبار السجل');
});

test('serverSecurity receipt scan validation and normalization helpers work reliably', () => {
  const badMime = validateScanReceiptPayload({
    imageBase64: 'YWJj',
    mimeType: 'application/pdf',
  });
  assert.equal(badMime.ok, false);
  if (badMime.ok === false) {
    assert.equal(badMime.status, 400);
    assert.equal(badMime.error, 'INVALID_MIME_TYPE');
  }

  const badImg = validateScanReceiptPayload({
    imageBase64: '',
    mimeType: 'image/jpeg',
  });
  assert.equal(badImg.ok, false);

  const valid = validateScanReceiptPayload({
    imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    mimeType: 'image/png',
    categories: [
      { id: 'cat-food', nameAr: 'طعام', nameEn: 'Food', type: 'expense' },
      { id: 'cat-salary', nameAr: 'راتب', nameEn: 'Salary', type: 'income' },
    ],
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.categories.length, 1);
    assert.equal(valid.categories[0].id, 'cat-food');
  }

  const today = getLocalTodayDateString(new Date('2026-06-15T12:00:00Z'));
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);

  const normalized = normalizeScannedReceiptResult(
    JSON.stringify({
      amount: 145.6789,
      date: 'not-a-date',
      categoryId: 'non-existent',
      merchant: 'Carrefour Egypt',
      notes: 'مشتريات البقالة',
    }),
    [
      { id: 'cat-groceries', nameAr: 'بقالة', nameEn: 'Groceries', type: 'expense' },
      { id: 'cat-other', nameAr: 'أخرى', nameEn: 'Other', type: 'expense' },
    ],
    '2026-06-15'
  );
  assert.equal(normalized.amount, 145.679);
  assert.equal(normalized.date, '2026-06-15');
  assert.equal(normalized.categoryId, 'cat-other');
  assert.equal(normalized.merchant, 'Carrefour Egypt');
  assert.equal(normalized.type, 'expense');
});

test('retainUnmigratedLocalOrgExtras preserves debts, goals, and templates safely while clearing migrated collections and passing backup schema validation', () => {
  const ws = buildLocalOrgWorkspace({
    name: 'مؤسسة النجاح',
    currency: 'EGP',
    loadSampleData: false,
    actor: { uid: 'u1', name: 'Owner' },
    now: 1_760_000_000_000,
  });

  // Empty extras check
  assert.equal(getUnmigratedOrgExtrasSummary(ws).hasUnmigratedExtras, false);
  assert.equal(isRetainedExtrasOnlyWorkspace(ws), false);

  const wsWithExtras = {
    ...ws,
    debts: [
      {
        id: 'debt-1',
        type: 'owed_to_me' as const,
        personName: 'شركة الموردين',
        totalAmount: 2500,
        paidAmount: 500,
        currency: 'EGP',
        dueDate: '2026-06-01',
        payments: [],
        isSettled: false,
        createdAt: 1000,
      },
    ],
    goals: [
      {
        id: 'goal-1',
        name: 'احتياطي الطوارئ',
        targetAmount: 50000,
        currentAmount: 12000,
        currency: 'EGP',
        color: '#0D5C53',
        icon: 'Target',
        isCompleted: false,
        createdAt: 1000,
      },
    ],
    templates: [
      {
        id: 'tpl-1',
        name: 'إيجار المكتب',
        type: 'expense' as const,
        amount: 8000,
        currency: 'EGP',
        categoryId: 'cat-rent',
        walletId: ws.wallets[0].id,
        priority: 'normal' as const,
        doesNotAffectBalance: false,
      },
    ],
  };

  const summary = getUnmigratedOrgExtrasSummary(wsWithExtras);
  assert.equal(summary.hasUnmigratedExtras, true);
  assert.equal(summary.debtsCount, 1);
  assert.equal(summary.goalsCount, 1);
  assert.equal(summary.templatesCount, 1);
  assert.equal(summary.totalCount, 3);

  const cloudOrgId = 'org-cloud-999';
  const retained = retainUnmigratedLocalOrgExtras(wsWithExtras, cloudOrgId, 1_760_000_099_000);

  assert.equal(isRetainedExtrasOnlyWorkspace(retained), true);
  assert.equal(retained.organization.id, cloudOrgId);
  assert.equal(retained.organization.migratedToCloudOrgId, cloudOrgId);
  assert.equal(retained.organization.localFirstMode, false);
  assert.equal(retained.organization.retainedLocalExtrasOnly, true);

  // Migrated collections cleared so they never double-count or confuse switchers
  assert.equal(retained.wallets.length, 0);
  assert.equal(retained.transactions.length, 0);
  assert.equal(retained.members.length, 0);
  assert.equal(retained.budgets.length, 0);

  // Unmigrated collections strictly preserved
  assert.equal(retained.debts.length, 1);
  assert.equal(retained.debts[0].id, 'debt-1');
  assert.equal(retained.goals.length, 1);
  assert.equal(retained.goals[0].id, 'goal-1');
  assert.equal(retained.templates.length, 1);
  assert.equal(retained.templates[0].id, 'tpl-1');

  // Backup schema validation passes when keyed under cloudOrgId
  const validation = validateBackupSchema({
    transactions: [],
    wallets: [],
    categories: DEFAULT_CATEGORIES,
    budgets: [],
    debts: [],
    goals: [],
    templates: [],
    moneyCircles: [],
    orgWorkspaces: { [cloudOrgId]: retained },
    activeWorkspace: cloudOrgId,
    settings: DEFAULT_SETTINGS,
    hasCompletedOnboarding: true,
  });
  assert.equal(validation.valid, true);

  // Localized user notices mention retained items
  const noticeAr = formatUnmigratedOrgExtrasNotice(summary, true);
  assert.match(noticeAr, /1 دين/);
  assert.match(noticeAr, /1 هدف/);
  assert.match(noticeAr, /1 قالب/);

  const noticeEn = formatUnmigratedOrgExtrasNotice(summary, false);
  assert.match(noticeEn, /1 debt/i);
  assert.match(noticeEn, /1 goal/i);
  assert.match(noticeEn, /1 template/i);
});

