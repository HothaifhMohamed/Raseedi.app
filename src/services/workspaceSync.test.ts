import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from '../types';
import {
  buildWorkspaceTransactionRecord,
  canPerformAutomaticCloudWrite,
  extractTransactionFromWorkspaceDoc,
  getWorkspaceTransactionDocPath,
  getWorkspaceTransactionsPath,
  isActiveWorkspaceTransaction,
  isTransactionInWorkspace,
  normalizeWorkspaceId,
  reconcileWorkspaceTransactions,
  shouldBlockEmptyCloudOverwrite,
  tagTransactionsWithWorkspace,
  tagWalletsWithWorkspace,
} from './workspaceSync';
import { Wallet } from '../types';

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    amount: 120.5,
    currency: 'EGP',
    date: '2026-05-10',
    time: '14:30',
    categoryId: 'cat-food',
    walletId: 'w-primary',
    priority: 'normal',
    doesNotAffectBalance: false,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

describe('workspaceSync unified path and workspace isolation', () => {
  it('builds consistent Firestore collection and doc paths for personal and custom workspaces', () => {
    assert.equal(normalizeWorkspaceId(undefined), 'personal');
    assert.equal(normalizeWorkspaceId(''), 'personal');
    assert.equal(normalizeWorkspaceId('personal'), 'personal');
    assert.equal(normalizeWorkspaceId('org-acme_01'), 'org-acme_01');
    assert.equal(
      getWorkspaceTransactionsPath('uid123', 'personal'),
      'users/uid123/workspaces/personal/transactions'
    );
    assert.equal(
      getWorkspaceTransactionsPath('uid123', 'org-acme'),
      'users/uid123/workspaces/org-acme/transactions'
    );
    assert.equal(
      getWorkspaceTransactionDocPath('uid123', 'org-acme', 'tx-99'),
      'users/uid123/workspaces/org-acme/transactions/tx-99'
    );
  });

  it('strictly isolates transactions per workspaceId (treating missing workspaceId as personal)', () => {
    const personalImplicit = makeTx({ id: 'tx-p1' });
    const personalExplicit = makeTx({ id: 'tx-p2', workspaceId: 'personal' });
    const orgA = makeTx({ id: 'tx-o1', workspaceId: 'org-A' });
    const deletedPersonal = makeTx({ id: 'tx-del', workspaceId: 'personal', deletedAt: 1700000100000 });

    assert.equal(isTransactionInWorkspace(personalImplicit, 'personal'), true);
    assert.equal(isTransactionInWorkspace(personalExplicit, 'personal'), true);
    assert.equal(isTransactionInWorkspace(orgA, 'personal'), false);

    assert.equal(isTransactionInWorkspace(personalImplicit, 'org-A'), false);
    assert.equal(isTransactionInWorkspace(orgA, 'org-A'), true);
    assert.equal(isTransactionInWorkspace(orgA, 'org-B'), false);

    assert.equal(isActiveWorkspaceTransaction(deletedPersonal, 'personal'), false);
  });

  it('serializes and extracts workspace transaction records while stripping oversized inline attachments and enforcing workspaceId', () => {
    const hugeBase64 = 'data:image/png;base64,' + 'A'.repeat(30_000);
    const smallUrl = 'https://storage.example.com/receipt.jpg';
    const tx = makeTx({
      id: 'tx-55',
      notes: undefined,
      attachments: [hugeBase64, smallUrl],
    });

    const { record, skippedAttachmentsCount } = buildWorkspaceTransactionRecord(
      'user-abc',
      'org-alpha',
      tx
    );

    assert.equal(skippedAttachmentsCount, 1);
    assert.equal(record.uid, 'user-abc');
    assert.equal(record.workspaceId, 'org-alpha');
    assert.equal(record.id, 'tx-55');
    assert.deepEqual(record.payload.attachments, [smallUrl]);
    assert.equal('notes' in record.payload, false);

    // Extracting for matching workspace succeeds
    const extracted = extractTransactionFromWorkspaceDoc(
      record as unknown as Record<string, unknown>,
      'org-alpha'
    );
    assert.ok(extracted);
    assert.equal(extracted?.id, 'tx-55');
    assert.equal(extracted?.workspaceId, 'org-alpha');
    assert.equal(extracted?.amount, 120.5);

    // Extracting for another workspace returns null (isolation guarantee)
    assert.equal(
      extractTransactionFromWorkspaceDoc(record as unknown as Record<string, unknown>, 'personal'),
      null
    );
  });

  it('reconciles Cloud-First without leaking other workspaces or reviving deleted cloud transactions', () => {
    const cloudPersonal = [
      makeTx({ id: 'tx-cloud-1', date: '2026-05-12', workspaceId: 'personal', updatedAt: 2000 }),
      makeTx({ id: 'tx-cloud-2', date: '2026-05-09', workspaceId: 'personal', updatedAt: 1000 }),
      makeTx({ id: 'tx-leak-org', date: '2026-05-15', workspaceId: 'org-other', updatedAt: 3000 }),
    ];
    const localCache = [
      makeTx({ id: 'tx-stale-deleted', date: '2026-05-14', workspaceId: 'personal', updatedAt: 1500 }),
      makeTx({ id: 'tx-offline-new', date: '2026-05-13', workspaceId: 'personal', updatedAt: 4000 }),
    ];

    const reconciled = reconcileWorkspaceTransactions(cloudPersonal, localCache, {
      activeWorkspaceId: 'personal',
      hasServerSnapshot: true,
      pendingLocalIds: ['tx-offline-new'],
    });

    assert.deepEqual(
      reconciled.map((t) => t.id),
      ['tx-offline-new', 'tx-cloud-1', 'tx-cloud-2']
    );
  });

  it('blocks automatic cloud writes before isCloudLoaded completes and blocks empty overwrites across backup and unified collections', () => {
    assert.equal(
      canPerformAutomaticCloudWrite({
        isAuthenticated: true,
        isCloudLoaded: false,
        isEmergencyRecoveryActive: false,
      }),
      false
    );
    assert.equal(
      canPerformAutomaticCloudWrite({
        isAuthenticated: true,
        isCloudLoaded: true,
        isEmergencyRecoveryActive: true,
      }),
      false
    );
    assert.equal(
      canPerformAutomaticCloudWrite({
        isAuthenticated: false,
        isCloudLoaded: true,
        isEmergencyRecoveryActive: false,
      }),
      false
    );
    assert.equal(
      canPerformAutomaticCloudWrite({
        isAuthenticated: true,
        isCloudLoaded: true,
        isEmergencyRecoveryActive: false,
      }),
      true
    );

    // Protect when unified cloud has transactions even if legacy backup meta count is 0
    assert.equal(
      shouldBlockEmptyCloudOverwrite({
        localTransactionsCount: 0,
        cloudBackupTransactionsCount: 0,
        hasUnifiedCloudTransactions: true,
      }),
      true
    );
    assert.equal(
      shouldBlockEmptyCloudOverwrite({
        localTransactionsCount: 0,
        cloudBackupTransactionsCount: 5,
        hasUnifiedCloudTransactions: false,
      }),
      true
    );
    // Allow write when local has imported transactions
    assert.equal(
      shouldBlockEmptyCloudOverwrite({
        localTransactionsCount: 3,
        cloudBackupTransactionsCount: 5,
        hasUnifiedCloudTransactions: true,
      }),
      false
    );
  });

  it('tags transactions and wallets cleanly with normalized workspaceId', () => {
    const txs = tagTransactionsWithWorkspace([makeTx({ id: 't-1' })], 'org-99');
    assert.equal(txs[0].workspaceId, 'org-99');

    const wallets: Wallet[] = [
      {
        id: 'w-1',
        name: 'Cash',
        currency: 'EGP',
        initialBalance: 0,
        balance: 0,
        color: '#000',
        icon: 'Wallet',
        isArchived: false,
        order: 0,
      },
    ];
    const taggedWallets = tagWalletsWithWorkspace(wallets, '');
    assert.equal(taggedWallets[0].workspaceId, 'personal');
  });
});
