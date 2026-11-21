import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseImportFileBufferAsync,
  mapCsvRowsToTransactionsChunked,
  buildImportedTransactionsPayloadChunked,
  commitImportedTransactionsWithCloudSync,
} from './csvImport';
import { ImportProgressState } from './importProgress';
import { Category, Transaction, Wallet } from '../types';

const SAMPLE_WALLETS: Wallet[] = [
  {
    id: 'w-main',
    name: 'الخزينة الرئيسية',
    currency: 'EGP',
    initialBalance: 1000,
    balance: 1000,
    color: '#0D9488',
    icon: 'Wallet',
    isArchived: false,
    order: 1,
    workspaceId: 'personal',
  },
];

const SAMPLE_CATEGORIES: Category[] = [
  {
    id: 'cat-food',
    nameAr: 'طعام وشراب',
    nameEn: 'Food',
    icon: 'Utensils',
    color: '#F59E0B',
    type: 'expense',
    order: 1,
  },
  {
    id: 'cat-salary',
    nameAr: 'راتب',
    nameEn: 'Salary',
    icon: 'Briefcase',
    color: '#10B981',
    type: 'income',
    order: 2,
  },
  {
    id: 'cat-other',
    nameAr: 'أخرى',
    nameEn: 'Other',
    icon: 'Layers',
    color: '#7A7468',
    type: 'both',
    order: 99,
  },
];

function buildLargeCsvBuffer(rowCount: number): Uint8Array {
  const lines: string[] = ['Date,Amount,Category,Wallet,Notes'];
  for (let i = 0; i < rowCount; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((i % 12) + 1).padStart(2, '0');
    const amount = i % 5 === 0 ? String(500 + i) : String(-(25 + (i % 90)));
    const cat = i % 5 === 0 ? 'راتب' : 'طعام وشراب';
    const wallet = i % 3 === 0 ? 'الخزينة الرئيسية' : 'محفظة جديدة';
    lines.push(`2026-${month}-${day},${amount},${cat},${wallet},Row ${i + 1}`);
  }
  return new TextEncoder().encode(lines.join('\n'));
}

test('parseImportFileBufferAsync parses 600-row CSV asynchronously with progress callbacks', async () => {
  const bytes = buildLargeCsvBuffer(600);
  const progressPoints: Array<[number, number]> = [];

  const parsed = await parseImportFileBufferAsync({
    bytes,
    fileName: 'bulk_600.csv',
    mimeType: 'text/csv',
    chunkSize: 150,
    onProgress: (processed, total) => {
      progressPoints.push([processed, total]);
    },
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.rows.length, 600);
  assert.equal(parsed.data.records.length, 600);
  assert.ok(progressPoints.length >= 3, 'should emit incremental parsing progress');
  const last = progressPoints[progressPoints.length - 1];
  assert.equal(last[0], last[1]);
});

test('mapCsvRowsToTransactionsChunked maps 600 rows with O(1) wallet/category resolution and progress', async () => {
  const bytes = buildLargeCsvBuffer(600);
  const parsed = await parseImportFileBufferAsync({
    bytes,
    fileName: 'bulk_600.csv',
    chunkSize: 200,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const progressSteps: number[] = [];
  const mapped = await mapCsvRowsToTransactionsChunked({
    rows: parsed.data.rows,
    mapping: {
      dateIndex: 0,
      amountIndex: 1,
      categoryIndex: 2,
      walletIndex: 3,
      notesIndex: 4,
    },
    categories: SAMPLE_CATEGORIES,
    existingTransactions: [],
    wallets: SAMPLE_WALLETS,
    defaultCurrency: 'EGP',
    workspaceId: 'personal',
    chunkSize: 200,
    onProgress: (processed) => progressSteps.push(processed),
  });

  assert.equal(mapped.validCount, 600);
  assert.equal(mapped.invalidCount, 0);
  assert.equal(mapped.autoCreatedWallets.length, 1);
  assert.equal(mapped.autoCreatedWallets[0].name, 'محفظة جديدة');
  assert.deepEqual(progressSteps, [200, 400, 600]);
});

test('commitImportedTransactionsWithCloudSync emits validating -> saving_local -> syncing_cloud progress up to 100%', async () => {
  const bytes = buildLargeCsvBuffer(450);
  const parsed = await parseImportFileBufferAsync({
    bytes,
    fileName: 'bulk_450.csv',
    chunkSize: 200,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const mapped = await mapCsvRowsToTransactionsChunked({
    rows: parsed.data.rows,
    mapping: {
      dateIndex: 0,
      amountIndex: 1,
      categoryIndex: 2,
      walletIndex: 3,
      notesIndex: 4,
    },
    categories: SAMPLE_CATEGORIES,
    existingTransactions: [],
    wallets: SAMPLE_WALLETS,
    defaultCurrency: 'EGP',
    workspaceId: 'personal',
    chunkSize: 200,
  });

  const payload = await buildImportedTransactionsPayloadChunked({
    rows: mapped.previewRows,
    existingWallets: SAMPLE_WALLETS,
    newWallets: mapped.autoCreatedWallets,
    defaultCurrency: 'EGP',
    workspaceId: 'personal',
    chunkSize: 200,
  });
  assert.equal(payload.transactions.length, 450);

  const stagesSeen: string[] = [];
  const percents: number[] = [];

  const result = await commitImportedTransactionsWithCloudSync({
    rows: mapped.previewRows,
    existingWallets: SAMPLE_WALLETS,
    newWallets: mapped.autoCreatedWallets,
    newCategories: mapped.autoCreatedCategories,
    defaultCurrency: 'EGP',
    workspaceId: 'personal',
    hasCloudSync: true,
    onProgress: (state: ImportProgressState) => {
      if (stagesSeen[stagesSeen.length - 1] !== state.stage) {
        stagesSeen.push(state.stage);
      }
      percents.push(state.percent);
    },
    persistImportLocally: async ({ transactions, onProgress }) => {
      onProgress?.(Math.floor(transactions.length / 2), transactions.length);
      const created: Transaction[] = transactions.map((tx, idx) => ({
        ...tx,
        id: `tx-bulk-${idx}`,
        createdAt: 1000 + idx,
        updatedAt: 1000 + idx,
      }));
      onProgress?.(transactions.length, transactions.length);
      return { importedCount: created.length, createdTransactions: created };
    },
    syncToCloud: async ({ createdTransactions, onProgress }) => {
      onProgress?.(425, createdTransactions.length);
      onProgress?.(createdTransactions.length, createdTransactions.length);
      return { ok: true };
    },
  });

  assert.equal(result.importedCount, 450);
  assert.equal(result.cloudSynced, true);
  assert.equal(result.localOnly, false);
  assert.deepEqual(stagesSeen, ['validating', 'saving_local', 'syncing_cloud']);
  assert.equal(percents[percents.length - 1], 100);
  // Monotonically non-decreasing percent
  for (let i = 1; i < percents.length; i++) {
    assert.ok(
      percents[i] >= percents[i - 1],
      `Progress percent should be non-decreasing (${percents[i - 1]} -> ${percents[i]})`
    );
  }
});

test('mapCsvRowsToTransactionsChunked applies merchantRules for category, wallet, and costCenterId', async () => {
  const mapped = await mapCsvRowsToTransactionsChunked({
    rows: [
      ['2026-05-01', '-180', '', '', 'مشوار اوبر للمكتب'],
      ['2026-05-02', '5000', 'راتب', 'كاش', 'دفعة شهرية'],
    ],
    mapping: {
      dateIndex: 0,
      amountIndex: 1,
      categoryIndex: 2,
      walletIndex: 3,
      notesIndex: 4,
    },
    categories: SAMPLE_CATEGORIES,
    existingTransactions: [],
    wallets: SAMPLE_WALLETS,
    defaultCurrency: 'EGP',
    workspaceId: 'org-1',
    merchantRules: [
      {
        id: 'mr-uber',
        keyword: 'أوبر',
        matchType: 'contains',
        type: 'expense',
        categoryId: 'cat-food',
        walletId: 'w-main',
        costCenterId: 'cc-sales',
        isEnabled: true,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
  });

  assert.equal(mapped.validCount, 2);
  assert.equal(mapped.previewRows[0].categoryId, 'cat-food');
  assert.equal(mapped.previewRows[0].walletId, 'w-main');
  assert.equal(mapped.previewRows[0].costCenterId, 'cc-sales');
  assert.equal(mapped.previewRows[0].matchedRuleKeyword, 'أوبر');

  const payload = await buildImportedTransactionsPayloadChunked({
    rows: mapped.previewRows,
    existingWallets: SAMPLE_WALLETS,
    newWallets: mapped.autoCreatedWallets,
    defaultCurrency: 'EGP',
    workspaceId: 'org-1',
  });
  assert.equal(payload.transactions[0].costCenterId, 'cc-sales');
});

