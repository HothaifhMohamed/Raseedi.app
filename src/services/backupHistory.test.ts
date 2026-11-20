import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompactBackupHistorySnapshotJson,
  computeBackupHistoryCounts,
  reconcileBackupHistorySummary,
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

function makeOrgWorkspace(orgId: string, txCount: number, walletCount: number): OrgWorkspaceData {
  const wallets = Array.from({ length: walletCount }, (_, i) =>
    makeWallet(`${orgId}-w-${i}`, `Org Wallet ${i + 1}`)
  );
  const transactions = Array.from({ length: txCount }, (_, i) =>
    makeTx(`${orgId}-tx-${i}`, { walletId: wallets[0]?.id || 'w-org', workspaceId: orgId })
  );
  return {
    organization: {
      id: orgId,
      name: `Org ${orgId}`,
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

test('computeBackupHistoryCounts aggregates personal, org workspaces, and active cloud org counts while skipping soft-deleted tx', () => {
  const counts = computeBackupHistoryCounts(
    {
      transactions: [makeTx('p-1'), makeTx('p-2', { deletedAt: 1_700_000_005_000 })],
      wallets: [makeWallet('w-personal', 'Cash')],
      orgWorkspaces: {
        'org-a': makeOrgWorkspace('org-a', 42, 2),
      },
    },
    { extraTransactions: 3406, extraWallets: 3 }
  );

  assert.equal(counts.personalTransactionsCount, 1);
  assert.equal(counts.orgTransactionsCount, 3448);
  assert.equal(counts.totalTransactions, 3449);
  assert.equal(counts.personalWalletsCount, 1);
  assert.equal(counts.orgWalletsCount, 5);
  assert.equal(counts.walletsCount, 6);
});

test('reconcileBackupHistorySummary recovers accurate counts from legacy 0-tx snapshotJson containing orgWorkspaces', () => {
  const snapshot = buildCompactBackupHistorySnapshotJson({
    transactions: [],
    wallets: [makeWallet('w-personal', 'Personal')],
    categories: [],
    budgets: [],
    debts: [],
    goals: [],
    templates: [],
    moneyCircles: [],
    orgWorkspaces: {
      'org-local': makeOrgWorkspace('org-local', 85, 2),
    },
    activeCloudOrgCounts: { transactions: 3406, wallets: 4 },
    settings: DEFAULT_SETTINGS,
    hasCompletedOnboarding: true,
    updatedAtMs: 1_700_000_123_000,
  });

  const legacyEntry: BackupHistorySummary = {
    id: 'auto_1',
    uid: 'u-1',
    source: 'auto',
    createdAtMs: 1_700_000_123_000,
    totalTransactions: 0,
    storedTransactionsCount: 0,
    walletsCount: 1,
  };

  const reconciled = reconcileBackupHistorySummary(legacyEntry, snapshot.snapshotJson);
  assert.equal(reconciled.totalTransactions, 3491);
  assert.equal(reconciled.storedTransactionsCount, 85);
  assert.equal(reconciled.walletsCount, 7);
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
  assert.ok(elapsedMs < 2000, `Expected fast O(N) serialization, took ${elapsedMs}ms`);

  // Verify JSON is strictly valid
  const parsed = JSON.parse(res.snapshotJson) as { transactions: Transaction[] };
  assert.equal(parsed.transactions.length, res.storedTransactionsCount);
});
