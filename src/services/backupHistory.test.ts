import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompactBackupHistorySnapshotJson,
  computeBackupHistoryCounts,
  reconcileBackupHistorySummary,
  resolveBackupHistoryDisplayForWorkspace,
  BackupHistorySummary,
} from './backupHistory';
import { DEFAULT_SETTINGS } from './db';
import type { OrgWorkspaceData, Transaction, Wallet } from '../types';

function makeTx(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type: 'expense',
    amount: 125,
    currency: 'EGP',
    walletId: 'w-1',
    categoryId: 'cat-1',
    priority: 'normal',
    doesNotAffectBalance: false,
    date: '2026-11-15',
    time: '10:30',
    notes: `Note for ${id}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeWallet(id: string, name: string): Wallet {
  return {
    id,
    name,
    currency: 'EGP',
    initialBalance: 0,
    balance: 1000,
    color: '#0D9488',
    icon: 'Wallet',
    isArchived: false,
    order: 1,
  };
}

function makeOrgWorkspace(
  orgId: string,
  txCount: number,
  walletCount: number,
  orgName?: string
): OrgWorkspaceData {
  const wallets = Array.from({ length: walletCount }, (_, i) =>
    makeWallet(`${orgId}-w-${i}`, `Org Wallet ${i + 1}`)
  );
  const transactions = Array.from({ length: txCount }, (_, i) =>
    makeTx(`${orgId}-tx-${i}`, { walletId: wallets[0]?.id || 'w-org', workspaceId: orgId })
  );
  return {
    organization: {
      id: orgId,
      name: orgName || `Org ${orgId}`,
      currency: 'EGP',
      vatRate: 14,
      approvalThreshold: 2000,
      ownerUid: 'u-1',
      planTier: 'business_pro',
      seatLimit: 5,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
    members: [],
    costCenters: [],
    parties: [],
    wallets,
    categories: [],
    transactions,
    budgets: [],
    debts: [],
    goals: [],
    templates: [],
    auditLogs: [],
  };
}

test('computeBackupHistoryCounts aggregates personal, org workspaces, and active cloud org counts without double-counting', () => {
  const counts = computeBackupHistoryCounts(
    {
      transactions: [makeTx('p-1'), makeTx('p-2', { deletedAt: 1_700_000_005_000 })],
      wallets: [makeWallet('w-personal', 'Cash')],
      orgWorkspaces: {
        'org-a': makeOrgWorkspace('org-a', 42, 2, 'شركة ألف'),
      },
    },
    {
      extraOrgId: 'org-cloud-b',
      extraOrgName: 'شركة باء السحابية',
      extraTransactions: 3406,
      extraWallets: 3,
    }
  );

  assert.equal(counts.personalTransactionsCount, 1);
  assert.equal(counts.orgTransactionsCount, 3448);
  assert.equal(counts.totalTransactions, 3449);
  assert.equal(counts.personalWalletsCount, 1);
  assert.equal(counts.orgWalletsCount, 5);
  assert.equal(counts.walletsCount, 6);
  assert.equal(counts.workspaceCounts['org-a'].transactionsCount, 42);
  assert.equal(counts.workspaceCounts['org-cloud-b'].transactionsCount, 3406);

  // Deduplicate if extraOrgId already exists in orgWorkspaces
  const dedupCounts = computeBackupHistoryCounts(
    {
      transactions: [makeTx('p-1')],
      wallets: [makeWallet('w-personal', 'Cash')],
      orgWorkspaces: {
        'org-a': makeOrgWorkspace('org-a', 42, 2, 'شركة ألف'),
      },
    },
    {
      extraOrgId: 'org-a',
      extraOrgName: 'شركة ألف',
      extraTransactions: 42,
      extraWallets: 2,
    }
  );
  assert.equal(dedupCounts.totalTransactions, 43);
  assert.equal(dedupCounts.walletsCount, 3);
});

test('buildCompactBackupHistorySnapshotJson & resolveBackupHistoryDisplayForWorkspace preserve exact uncapped per-workspace counts beyond 150-tx cap', () => {
  const snapshot = buildCompactBackupHistorySnapshotJson({
    transactions: Array.from({ length: 12 }, (_, i) => makeTx(`p-${i}`)),
    wallets: [makeWallet('w-p1', 'Cash'), makeWallet('w-p2', 'Bank')],
    categories: [],
    budgets: [],
    debts: [],
    goals: [],
    templates: [],
    moneyCircles: [],
    orgWorkspaces: {
      'org-local-a': makeOrgWorkspace('org-local-a', 420, 5, 'مؤسسة النيل'),
    },
    activeWorkspace: 'org-cloud-b',
    activeCloudOrgCounts: {
      orgId: 'org-cloud-b',
      orgName: 'شركة النور السحابية',
      transactions: 3406,
      wallets: 4,
    },
    settings: DEFAULT_SETTINGS,
    hasCompletedOnboarding: true,
    updatedAtMs: 1_700_000_123_000,
  });

  const baseEntry: BackupHistorySummary = {
    id: 'auto_1',
    uid: 'u-1',
    source: 'auto',
    createdAtMs: 1_700_000_123_000,
    totalTransactions: 3838,
    storedTransactionsCount: snapshot.storedTransactionsCount,
    walletsCount: 11,
  };

  const reconciled = reconcileBackupHistorySummary(baseEntry, snapshot.snapshotJson);

  // 1. Inside Personal workspace -> shows exact 12 tx & 2 wallets (NOT 150 or 3,838 or 11 wallets!)
  const personalView = resolveBackupHistoryDisplayForWorkspace(reconciled, 'personal', {
    isRTL: true,
  });
  assert.equal(personalView.transactionsCount, 12);
  assert.equal(personalView.walletsCount, 2);
  assert.equal(personalView.scopeLabel, 'الحساب الشخصي');
  assert.equal(personalView.matchesActiveWorkspace, true);
  assert.equal(personalView.isTruncatedEstimate, false);

  // 2. Inside Local Org A (420 tx > 150 JSON cap) -> shows EXACT 420 tx & 5 wallets!
  const orgAView = resolveBackupHistoryDisplayForWorkspace(reconciled, 'org-local-a', {
    isRTL: true,
  });
  assert.equal(orgAView.transactionsCount, 420);
  assert.equal(orgAView.walletsCount, 5);
  assert.equal(orgAView.scopeLabel, 'مؤسسة النيل');
  assert.equal(orgAView.matchesActiveWorkspace, true);
  assert.equal(orgAView.isTruncatedEstimate, false);

  // 3. Inside Cloud Org B (3,406 tx) -> shows EXACT 3,406 tx & 4 wallets!
  const orgBView = resolveBackupHistoryDisplayForWorkspace(reconciled, 'org-cloud-b', {
    isRTL: true,
  });
  assert.equal(orgBView.transactionsCount, 3406);
  assert.equal(orgBView.walletsCount, 4);
  assert.equal(orgBView.scopeLabel, 'شركة النور السحابية');
  assert.equal(orgBView.matchesActiveWorkspace, true);
  assert.equal(orgBView.isTruncatedEstimate, false);

  // 4. Inside a newly created Org C not present in this older snapshot -> clearly labels snapshot's actual scope
  const orgCView = resolveBackupHistoryDisplayForWorkspace(reconciled, 'org-brand-new-c', {
    isRTL: true,
    activeWorkspaceName: 'مؤسسة جديدة',
  });
  assert.equal(orgCView.matchesActiveWorkspace, false);
  assert.equal(orgCView.scopeLabel, 'شركة النور السحابية');
  assert.equal(orgCView.transactionsCount, 3406);
  assert.equal(orgCView.walletsCount, 4);
});

test('reconcileBackupHistorySummary detects legacy pre-fix 150-tx org truncation and scopes cleanly', () => {
  // Simulate a legacy snapshot JSON saved before workspaceCounts existed (org transactions capped at 150)
  const legacyOrg = makeOrgWorkspace('org-legacy', 150, 3, 'مؤسسة قديمة');
  const legacySnapshotJson = JSON.stringify({
    schemaVersion: 2,
    transactions: [makeTx('p-1'), makeTx('p-2')],
    wallets: [makeWallet('w-p1', 'Personal')],
    orgWorkspaces: {
      'org-legacy': legacyOrg,
    },
    activeWorkspace: 'org-legacy',
  });

  const legacyEntry: BackupHistorySummary = {
    id: 'auto_legacy',
    uid: 'u-1',
    source: 'auto',
    createdAtMs: 1_700_000_123_000,
    totalTransactions: 0,
    storedTransactionsCount: 0,
    walletsCount: 1,
  };

  const reconciled = reconcileBackupHistorySummary(legacyEntry, legacySnapshotJson);
  const orgView = resolveBackupHistoryDisplayForWorkspace(reconciled, 'org-legacy', {
    isRTL: true,
  });
  assert.equal(orgView.transactionsCount, 150);
  assert.equal(orgView.walletsCount, 3);
  assert.equal(orgView.isTruncatedEstimate, true);
  assert.equal(orgView.scopeLabel, 'مؤسسة قديمة');

  const personalView = resolveBackupHistoryDisplayForWorkspace(reconciled, 'personal', {
    isRTL: true,
  });
  assert.equal(personalView.transactionsCount, 2);
  assert.equal(personalView.walletsCount, 1);
  assert.equal(personalView.isTruncatedEstimate, false);
});

test('buildCompactBackupHistorySnapshotJson handles 3,500+ transactions swiftly within maxBytes limit', () => {
  const bigTxs = Array.from({ length: 3500 }, (_, i) =>
    makeTx(`bulk-${i}`, {
      date: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      createdAt: 1_700_000_000_000 + i,
    })
  );

  const startedAt = Date.now();
  const res = buildCompactBackupHistorySnapshotJson(
    {
      transactions: bigTxs,
      wallets: [makeWallet('w-1', 'Main')],
      categories: [],
      budgets: [],
      debts: [],
      goals: [],
      templates: [],
      moneyCircles: [],
      settings: DEFAULT_SETTINGS,
      hasCompletedOnboarding: true,
      updatedAtMs: 1_700_000_999_000,
    },
    250_000
  );
  const elapsedMs = Date.now() - startedAt;

  const byteLen = new TextEncoder().encode(res.snapshotJson).length;
  assert.ok(byteLen <= 250_000, `Snapshot byte length ${byteLen} exceeded 250,000`);
  assert.ok(res.storedTransactionsCount > 200, 'Should retain hundreds of newest transactions');
  assert.equal(res.truncated, true);
  assert.equal(res.workspaceCounts.personal.transactionsCount, 3500);
  assert.ok(elapsedMs < 2000, `Expected fast O(N) serialization, took ${elapsedMs}ms`);

  // Verify JSON is strictly valid
  const parsed = JSON.parse(res.snapshotJson) as { transactions: Transaction[] };
  assert.equal(parsed.transactions.length, res.storedTransactionsCount);
});
