import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOrgReceiptScannerRole,
  isSafeWebhookId,
  isSensitiveRevocationPath,
  resolveAdminSessionSecret,
} from './serverSecurity';
import {
  hashPin,
  MIN_PIN_PBKDF2_ITERATIONS,
  stripSensitivePinFromSettings,
  stripSensitivePinFromWallet,
  stripSensitivePinsFromWallets,
  verifyPin,
} from './security';
import {
  AppDatabaseData,
  buildLightweightLegacyCache,
  DEFAULT_SETTINGS,
  validateBackupSchema,
} from './db';
import { buildCompactBackupHistorySnapshotJson } from './backupHistory';
import type { Transaction, Wallet } from '../types';

test('isSafeWebhookId: accepts valid IDs and rejects path traversal, spaces, empty, or overlong strings', () => {
  assert.equal(isSafeWebhookId('evt_12345-ABC_xyz'), true);
  assert.equal(isSafeWebhookId('a'.repeat(120)), true);

  assert.equal(isSafeWebhookId(''), false);
  assert.equal(isSafeWebhookId('a'.repeat(121)), false);
  assert.equal(isSafeWebhookId('../users/admin'), false);
  assert.equal(isSafeWebhookId('evt/slash'), false);
  assert.equal(isSafeWebhookId('evt with space'), false);
  assert.equal(isSafeWebhookId('evt.dot'), false);
  assert.equal(isSafeWebhookId(12345), false);
  assert.equal(isSafeWebhookId(null), false);
});

test('resolveAdminSessionSecret: uses env secret when >= 32 chars and falls back to 32 random bytes otherwise', () => {
  const longSecret = 'super-strong-admin-session-secret-key-2026-prod';
  const fromEnv = resolveAdminSessionSecret(longSecret);
  assert.equal(fromEnv.toString('utf8'), longSecret);

  const tooShort = resolveAdminSessionSecret('short-secret');
  assert.equal(tooShort.length, 32);
  assert.notEqual(tooShort.toString('utf8'), 'short-secret');

  const fallbackA = resolveAdminSessionSecret(undefined);
  const fallbackB = resolveAdminSessionSecret('');
  assert.equal(fallbackA.length, 32);
  assert.equal(fallbackB.length, 32);
  assert.notEqual(fallbackA.toString('hex'), fallbackB.toString('hex'));
});

test('isSensitiveRevocationPath: enforces checkRevoked on admin, account deletion, org deletion & ownership transfer', () => {
  assert.equal(isSensitiveRevocationPath('/api/admin/status'), true);
  assert.equal(isSensitiveRevocationPath('/api/admin/organizations/org-1/subscription'), true);
  assert.equal(isSensitiveRevocationPath('/api/delete-account'), true);
  assert.equal(isSensitiveRevocationPath('/api/org/delete'), true);
  assert.equal(isSensitiveRevocationPath('/api/org/transfer-ownership'), true);

  assert.equal(isSensitiveRevocationPath('/api/health'), false);
  assert.equal(isSensitiveRevocationPath('/api/scan-receipt'), false);
  assert.equal(isSensitiveRevocationPath('/api/org/create'), false);
});

test('isOrgReceiptScannerRole: allows owner/admin/accountant/employee and blocks viewer or unknown roles', () => {
  assert.equal(isOrgReceiptScannerRole('owner'), true);
  assert.equal(isOrgReceiptScannerRole('admin'), true);
  assert.equal(isOrgReceiptScannerRole('accountant'), true);
  assert.equal(isOrgReceiptScannerRole('employee'), true);

  assert.equal(isOrgReceiptScannerRole('viewer'), false);
  assert.equal(isOrgReceiptScannerRole(''), false);
  assert.equal(isOrgReceiptScannerRole(undefined), false);
  assert.equal(isOrgReceiptScannerRole('superadmin'), false);
});

test('verifyPin: accepts standard 100k PBKDF2 hashes and rejects downgraded <100k PBKDF2 iteration counts', async () => {
  const { hash, salt } = await hashPin('4829');
  assert.ok(hash.startsWith(`pbkdf2$${MIN_PIN_PBKDF2_ITERATIONS}$`));
  assert.equal(await verifyPin('4829', hash, salt), true);
  assert.equal(await verifyPin('0000', hash, salt), false);

  // Craft a valid-looking PBKDF2 hash with downgraded iterations (1000 < 100,000)
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode('4829'), { name: 'PBKDF2' }, false, ['deriveBits']);
  const weakBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(`raseedi-pin-v2:${salt}`), iterations: 1000, hash: 'SHA-256' },
    baseKey,
    256
  );
  const weakHex = Array.from(new Uint8Array(weakBits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const downgradedHash = `pbkdf2$1000$${weakHex}`;

  // Must strictly reject downgraded PBKDF2 hashes even if the PIN matches
  assert.equal(await verifyPin('4829', downgradedHash, salt), false);
  assert.equal(await verifyPin('4829', `pbkdf2$0$${weakHex}`, salt), false);
  assert.equal(await verifyPin('4829', `pbkdf2$NaN$${weakHex}`, salt), false);
});

test('stripSensitivePin helpers and backupHistory: never leak appPin/appPinSalt or wallet pin/pinSalt to cloud payloads', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    isAppLockEnabled: true,
    appPin: 'pbkdf2$100000$secret',
    appPinSalt: 'salt-123',
  };
  const wallet: Wallet = {
    id: 'w-1',
    name: 'الخزينة',
    currency: 'EGP',
    initialBalance: 100,
    balance: 100,
    color: '#111111',
    icon: 'Wallet',
    isArchived: false,
    order: 0,
    isLocked: true,
    pin: 'pbkdf2$100000$walletsecret',
    pinSalt: 'wsalt-456',
  };

  const cleanSettings = stripSensitivePinFromSettings(settings);
  assert.equal('appPin' in cleanSettings, false);
  assert.equal('appPinSalt' in cleanSettings, false);
  assert.equal(cleanSettings.isAppLockEnabled, false);
  // Original object must not be mutated
  assert.equal(settings.appPin, 'pbkdf2$100000$secret');

  const cleanWallet = stripSensitivePinFromWallet(wallet);
  assert.equal('pin' in cleanWallet, false);
  assert.equal('pinSalt' in cleanWallet, false);
  assert.equal(cleanWallet.isLocked, false);
  assert.equal(wallet.pin, 'pbkdf2$100000$walletsecret');

  const cleanWallets = stripSensitivePinsFromWallets([wallet]);
  assert.equal('pin' in cleanWallets[0], false);

  const history = buildCompactBackupHistorySnapshotJson({
    transactions: [],
    wallets: [wallet],
    categories: [],
    budgets: [],
    debts: [],
    goals: [],
    templates: [],
    moneyCircles: [],
    settings,
    hasCompletedOnboarding: true,
  });
  assert.equal(history.snapshotJson.includes('appPin'), false);
  assert.equal(history.snapshotJson.includes('pinSalt'), false);
  assert.equal(history.snapshotJson.includes('walletsecret'), false);
});

test('validateBackupSchema: strictly validates transaction date, type, and non-empty walletId', () => {
  const validTx = {
    id: 'tx-1',
    amount: 250,
    date: '2026-05-15',
    type: 'expense',
    walletId: 'w-cash',
  };
  assert.equal(validateBackupSchema({ transactions: [validTx], wallets: [] }).valid, true);

  // Invalid date format
  assert.equal(
    validateBackupSchema({ transactions: [{ ...validTx, date: '15/05/2026' }], wallets: [] }).reason,
    'INVALID_TRANSACTION_ITEM'
  );
  assert.equal(
    validateBackupSchema({ transactions: [{ ...validTx, date: '' }], wallets: [] }).reason,
    'INVALID_TRANSACTION_ITEM'
  );

  // Invalid type
  assert.equal(
    validateBackupSchema({ transactions: [{ ...validTx, type: 'hack' }], wallets: [] }).reason,
    'INVALID_TRANSACTION_ITEM'
  );

  // Missing or empty walletId
  assert.equal(
    validateBackupSchema({ transactions: [{ ...validTx, walletId: '' }], wallets: [] }).reason,
    'INVALID_TRANSACTION_ITEM'
  );
  assert.equal(
    validateBackupSchema({ transactions: [{ ...validTx, walletId: undefined }], wallets: [] }).reason,
    'INVALID_TRANSACTION_ITEM'
  );
});

test('buildLightweightLegacyCache: caps localStorage fallback to latest 200 attachment-stripped transactions', () => {
  const transactions: Transaction[] = Array.from({ length: 350 }, (_, i) => ({
    id: `tx-${i}`,
    type: 'expense',
    amount: 10 + i,
    currency: 'EGP',
    categoryId: 'cat-1',
    walletId: 'w-1',
    date: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    time: '12:00',
    notes: 'test',
    priority: 'normal',
    doesNotAffectBalance: false,
    createdAt: 1700000000000 + i,
    updatedAt: 1700000000000 + i,
    attachments: ['data:image/png;base64,AAAA'],
  }));

  const dbData: AppDatabaseData = {
    transactions,
    wallets: [],
    categories: [],
    budgets: [],
    debts: [],
    goals: [],
    templates: [],
    moneyCircles: [],
    settings: DEFAULT_SETTINGS,
    user: null,
    hasCompletedOnboarding: true,
  };

  const cache = buildLightweightLegacyCache(dbData);
  assert.equal(cache.transactions.length, 200);
  assert.equal(
    cache.transactions.every((t) => t.attachments === undefined),
    true
  );
});
