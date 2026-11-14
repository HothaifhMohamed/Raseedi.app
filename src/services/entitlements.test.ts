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
} from './calculations';
import { fromMinor, toMinor, roundCurrency } from './currency';
import { PRICING_CONFIG } from '../config/pricing';
import type { Transaction } from '../types';

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

test('Org subscription lifecycle transitions: trial -> active -> 14d/3d/0d alerts -> 7d grace -> read-only', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0);

  const trial = computeOrgSubscriptionState(
    { planTier: 'business_pro', billingCycle: 'trial', expiresAt: now + 10 * DAY_MS },
    now
  );
  assert.equal(trial.status, 'trial');
  assert.equal(trial.canWrite, true);
  assert.equal(trial.isReadOnly, false);
  assert.equal(trial.expiryNotificationStage, '14d');
  assert.equal(trial.seatLimit, PRICING_CONFIG.businessPro.includedSeats);

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
