import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendLocalOrgAuditLog,
  applyOrgTxBalanceToWallets,
  buildLocalOrgWorkspace,
  doesOrgTxCountTowardBalance,
  recalculateLocalOrgWallets,
} from './localOrgHelpers';
import {
  getLocalTodayDateString,
  normalizeScannedInvoiceResult,
  validateScanInvoicePayload,
} from '../../api/scan-invoice';
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

test('api/scan-invoice validation and normalization helpers work reliably', () => {
  const badMime = validateScanInvoicePayload({
    imageBase64: 'YWJj',
    mimeType: 'application/pdf',
  });
  assert.equal(badMime.ok, false);
  if (badMime.ok === false) {
    assert.equal(badMime.status, 400);
    assert.equal(badMime.error, 'INVALID_MIME_TYPE');
  }

  const badImg = validateScanInvoicePayload({
    imageBase64: '',
    mimeType: 'image/jpeg',
  });
  assert.equal(badImg.ok, false);

  const valid = validateScanInvoicePayload({
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

  const normalized = normalizeScannedInvoiceResult(
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
