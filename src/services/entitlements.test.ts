import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  GRACE_PERIOD_DAYS,
  canRoleApproveOrg,
  canRoleEditOrg,
  canRoleManageOrg,
  computeOrgSeatLimit,
  computeOrgSubscriptionState,
  normalizeApprovalStatus,
} from './entitlements';
import {
  calculateVatBreakdown,
  doesTransactionAffectAccounting,
  getTransactionWalletDeltas,
  applyWalletUpdates,
} from './calculations';
import { buildAppNotifications } from './notifications';
import {
  MAX_AUTO_CLOUD_BACKUPS,
  getBackupIdsToPrune,
  buildCompactBackupHistorySnapshotJson,
} from './backupHistory';
import { DEFAULT_SETTINGS } from './db';
import { fromMinor, toMinor, roundCurrency } from './currency';
import { PRICING_CONFIG } from '../config/pricing';
import type { Transaction, Wallet } from '../types';

test('VAT minor-unit precision across 2-decimal (EGP) and 3-decimal (KWD, BHD, OMR, JOD, TND) currencies', () => {
  // Exclusive VAT in EGP: 100.00 + 14% = 114.00
  const egpExcl = calculateVatBreakdown(100, 14, false, 'EGP');
  assert.equal(egpExcl.netAmount, 100);
  assert.equal(egpExcl.taxAmount, 14);
  assert.equal(egpExcl.grossAmount, 114);
  assert.equal(toMinor(egpExcl.taxAmount, 'EGP'), 1400);
  assert.equal(fromMinor(toMinor(egpExcl.grossAmount, 'EGP'), 'EGP'), 114);

  // Inclusive VAT in KWD (3 decimals, 5%): 10.500 KWD -> net 10.000, vat 0.500
  const kwdIncl = calculateVatBreakdown(10.5, 5, true, 'KWD');
  assert.equal(kwdIncl.netAmount, 10);
  assert.equal(kwdIncl.taxAmount, 0.5);
  assert.equal(kwdIncl.grossAmount, 10.5);
  assert.equal(toMinor(kwdIncl.taxAmount, 'KWD'), 500);
  assert.equal(toMinor(kwdIncl.grossAmount, 'KWD'), 10500);

  // 3-decimal precision check across all supported 3-decimal currencies
  for (const code of ['KWD', 'BHD', 'OMR', 'JOD', 'TND'] as const) {
    const minor = toMinor(12.345, code);
    assert.equal(minor, 12345);
    assert.equal(fromMinor(minor, code), 12.345);
    assert.equal(roundCurrency(12.3454, code), 12.345);
  }
});

test('Org subscription lifecycle transitions: free never expires; trial >7d silent; <=7d/3d/0d alerts -> 7d grace -> read-only', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0);

  // Free org never triggers expiry notifications or read-only restrictions
  const freeOrg = computeOrgSubscriptionState(
    { planTier: 'free', billingCycle: 'free', expiresAt: null },
    now
  );
  assert.equal(freeOrg.status, 'active');
  assert.equal(freeOrg.canWrite, true);
  assert.equal(freeOrg.isReadOnly, false);
  assert.equal(freeOrg.expiryNotificationStage, 'none');

  // 10-day remaining trial must NOT fire an expiry notification yet (window is <= 7 days)
  const trial10d = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'trial', expiresAt: now + 10 * DAY_MS },
    now
  );
  assert.equal(trial10d.status, 'trial');
  assert.equal(trial10d.canWrite, true);
  assert.equal(trial10d.isReadOnly, false);
  assert.equal(trial10d.expiryNotificationStage, 'none');
  assert.equal(trial10d.seatLimit, PRICING_CONFIG.businessPro.includedSeats);

  // 6-day remaining trial keeps trial status and fires 7d expiry stage
  const trial6d = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'trial', expiresAt: now + 6 * DAY_MS },
    now
  );
  assert.equal(trial6d.status, 'trial');
  assert.equal(trial6d.canWrite, true);
  assert.equal(trial6d.expiryNotificationStage, '7d');

  // Paid plan at 6 days remaining becomes expiring_soon
  const paid6d = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'monthly', expiresAt: now + 6 * DAY_MS },
    now
  );
  assert.equal(paid6d.status, 'expiring_soon');
  assert.equal(paid6d.expiryNotificationStage, '7d');

  const active = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'yearly', expiresAt: now + 60 * DAY_MS, extraSeats: 3 },
    now
  );
  assert.equal(active.status, 'active');
  assert.equal(active.expiryNotificationStage, 'none');
  assert.equal(active.seatLimit, computeOrgSeatLimit(3));
  assert.equal(active.seatLimit, 8);
  assert.equal(active.monthlyScanLimit, PRICING_CONFIG.businessPro.monthlyAiScans);

  const exp3d = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'monthly', expiresAt: now + 3 * DAY_MS },
    now
  );
  assert.equal(exp3d.status, 'expiring_soon');
  assert.equal(exp3d.expiryNotificationStage, '3d');

  const exp0d = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'monthly', expiresAt: now + 6 * 3600 * 1000 },
    now
  );
  assert.equal(exp0d.expiryNotificationStage, '0d');

  const inGrace = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'monthly', expiresAt: now - 3 * DAY_MS },
    now
  );
  assert.equal(inGrace.status, 'grace');
  assert.equal(inGrace.isGracePeriod, true);
  assert.equal(inGrace.canWrite, true);
  assert.equal(inGrace.isReadOnly, false);
  assert.equal(inGrace.graceDaysRemaining, GRACE_PERIOD_DAYS - 3);

  const pastGrace = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'monthly', expiresAt: now - (GRACE_PERIOD_DAYS + 1) * DAY_MS },
    now
  );
  assert.equal(pastGrace.status, 'read_only');
  assert.equal(pastGrace.isReadOnly, true);
  assert.equal(pastGrace.canWrite, false);
  assert.equal(pastGrace.expiryNotificationStage, 'expired');
  assert.equal(pastGrace.monthlyScanLimit, 0);
});

test('RBAC role helpers enforce owner/admin/accountant/employee/viewer boundaries', () => {
  assert.equal(canRoleEditOrg('owner'), true);
  assert.equal(canRoleEditOrg('admin'), true);
  assert.equal(canRoleEditOrg('accountant'), true);
  assert.equal(canRoleEditOrg('employee'), true);
  assert.equal(canRoleEditOrg('viewer'), false);

  assert.equal(canRoleApproveOrg('owner'), true);
  assert.equal(canRoleApproveOrg('admin'), true);
  assert.equal(canRoleApproveOrg('accountant'), true);
  assert.equal(canRoleApproveOrg('employee'), false);
  assert.equal(canRoleApproveOrg('viewer'), false);

  assert.equal(canRoleManageOrg('owner'), true);
  assert.equal(canRoleManageOrg('admin'), true);
  assert.equal(canRoleManageOrg('accountant'), false);
  assert.equal(canRoleManageOrg('employee'), false);
  assert.equal(canRoleManageOrg('viewer'), false);
});

test('Approval invariants & transfer wallet deltas with 3-decimal currencies', () => {
  assert.equal(normalizeApprovalStatus(undefined), 'approved');
  assert.equal(normalizeApprovalStatus('pending_approval'), 'pending');
  assert.equal(normalizeApprovalStatus('paid'), 'paid');

  const makeTx = (overrides: Partial<Transaction>): Transaction => ({
    id: 'tx-1',
    type: 'expense',
    amount: 10,
    currency: 'KWD',
    categoryId: 'c1',
    walletId: 'w1',
    date: '2026-06-01',
    time: '12:00',
    priority: 'normal',
    doesNotAffectBalance: false,
    notes: 'Test',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });

  assert.equal(doesTransactionAffectAccounting(makeTx({ approvalStatus: 'draft' })), false);
  assert.equal(doesTransactionAffectAccounting(makeTx({ approvalStatus: 'pending' })), false);
  assert.equal(doesTransactionAffectAccounting(makeTx({ approvalStatus: 'pending_approval' })), false);
  assert.equal(doesTransactionAffectAccounting(makeTx({ approvalStatus: 'rejected' })), false);
  assert.equal(doesTransactionAffectAccounting(makeTx({ approvalStatus: 'approved', deletedAt: 100 })), false);
  assert.equal(doesTransactionAffectAccounting(makeTx({ approvalStatus: 'approved' })), true);
  assert.equal(doesTransactionAffectAccounting(makeTx({ approvalStatus: 'paid' })), true);

  const transferDeltas = getTransactionWalletDeltas(
    makeTx({
      type: 'transfer',
      amount: 10.125,
      transferFee: 0.25,
      currency: 'KWD',
      walletId: 'w-kwd',
      toWalletId: 'w-bhd',
      convertedAmount: 12.345,
      approvalStatus: 'approved',
    })
  );
  assert.equal(transferDeltas.sourceDelta, -10.375);
  assert.equal(transferDeltas.destDelta, 12.345);
});

test('applyWalletUpdates recalculates balance and minor units across EGP and KWD', () => {
  const walletEgp: Wallet = {
    id: 'w1',
    name: 'كاش',
    icon: 'Banknote',
    color: '#0D9488',
    currency: 'EGP',
    initialBalance: 1000,
    balance: 1350,
    initialBalanceMinor: 100000,
    balanceMinor: 135000,
    isArchived: false,
    order: 1,
  };

  // Increasing initialBalance by +500 must shift balance from 1350 -> 1850
  const updatedEgp = applyWalletUpdates(walletEgp, {
    name: 'خزنة الشركة',
    color: '#2563EB',
    icon: 'Landmark',
    initialBalance: 1500,
  });
  assert.equal(updatedEgp.name, 'خزنة الشركة');
  assert.equal(updatedEgp.color, '#2563EB');
  assert.equal(updatedEgp.icon, 'Landmark');
  assert.equal(updatedEgp.initialBalance, 1500);
  assert.equal(updatedEgp.balance, 1850);
  assert.equal(updatedEgp.initialBalanceMinor, 150000);
  assert.equal(updatedEgp.balanceMinor, 185000);

  // 3-decimal KWD wallet update + currency change
  const walletKwd: Wallet = {
    id: 'w2',
    name: 'Kuwait',
    icon: 'Wallet',
    color: '#0D9488',
    currency: 'KWD',
    initialBalance: 10.25,
    balance: 15.375,
    isArchived: false,
    order: 2,
  };
  const updatedKwd = applyWalletUpdates(walletKwd, { initialBalance: 20.5 });
  assert.equal(updatedKwd.initialBalance, 20.5);
  assert.equal(updatedKwd.balance, 25.625);
  assert.equal(updatedKwd.initialBalanceMinor, 20500);
  assert.equal(updatedKwd.balanceMinor, 25625);

  // Explicit balance override takes precedence
  const explicit = applyWalletUpdates(walletEgp, { balance: 999 });
  assert.equal(explicit.balance, 999);
  assert.equal(explicit.balanceMinor, 99900);
});

test('buildAppNotifications skips org alerts on free tier and >7d trials, and emits when <=7d', () => {
  const nowMs = Date.UTC(2026, 5, 1, 12, 0, 0);
  const now = new Date(nowMs);
  const baseSettings = {
    ...DEFAULT_SETTINGS,
    notificationsEnabled: false,
    budgetAlertsEnabled: false,
    debtRemindersEnabled: false,
  };

  const freeState = computeOrgSubscriptionState(
    { planTier: 'free', billingCycle: 'free', expiresAt: null },
    nowMs
  );
  const freeNotifs = buildAppNotifications({
    budgets: [],
    transactions: [],
    debts: [],
    settings: baseSettings,
    isOrgWorkspace: true,
    orgName: 'Free Org',
    orgSubscriptionState: freeState,
    now,
  });
  assert.equal(freeNotifs.length, 0);

  const trial10dState = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'trial', expiresAt: nowMs + 10 * DAY_MS },
    nowMs
  );
  const trial10dNotifs = buildAppNotifications({
    budgets: [],
    transactions: [],
    debts: [],
    settings: baseSettings,
    isOrgWorkspace: true,
    orgName: 'Trial 10d Org',
    orgSubscriptionState: trial10dState,
    now,
  });
  assert.equal(trial10dNotifs.length, 0);

  const trial5dState = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'trial', expiresAt: nowMs + 5 * DAY_MS },
    nowMs
  );
  const trial5dNotifs = buildAppNotifications({
    budgets: [],
    transactions: [],
    debts: [],
    settings: baseSettings,
    isOrgWorkspace: true,
    orgName: 'Trial 5d Org',
    orgSubscriptionState: trial5dState,
    now,
  });
  assert.equal(trial5dNotifs.length, 1);
  assert.equal(trial5dNotifs[0].type, 'org_subscription_expiring');
});

test('backupHistory prunes beyond 7 backups and compacts large payloads safely', () => {
  assert.equal(MAX_AUTO_CLOUD_BACKUPS, 7);
  const entries = Array.from({ length: 9 }, (_, i) => ({
    id: `auto_${1000 + i}`,
    createdAtMs: 1000 + i,
  }));
  const toDelete = getBackupIdsToPrune(entries, 7);
  assert.deepEqual(toDelete, ['auto_1001', 'auto_1000']);

  const hugeBase64 = 'data:image/jpeg;base64,' + 'A'.repeat(20_000);
  const txs: Transaction[] = Array.from({ length: 40 }, (_, i) => ({
    id: `tx-${i}`,
    type: 'expense',
    amount: 50 + i,
    currency: 'EGP',
    categoryId: 'c1',
    walletId: 'w1',
    date: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`,
    time: '12:00',
    priority: 'normal',
    doesNotAffectBalance: false,
    notes: 'Item ' + 'X'.repeat(200),
    attachments: [hugeBase64],
    createdAt: i + 1,
    updatedAt: i + 1,
  }));

  const packed = buildCompactBackupHistorySnapshotJson(
    {
      transactions: txs,
      wallets: [],
      categories: [],
      budgets: [],
      debts: [],
      goals: [],
      templates: [],
      moneyCircles: [],
      settings: DEFAULT_SETTINGS,
      hasCompletedOnboarding: true,
      updatedAtMs: 5000,
    },
    3500
  );
  assert.ok(Buffer.byteLength(packed.snapshotJson, 'utf8') <= 3500);
  assert.equal(packed.truncated, true);
  assert.ok(packed.storedTransactionsCount > 0 && packed.storedTransactionsCount < txs.length);
  assert.equal(packed.snapshotJson.includes('data:image/jpeg'), false);
});

