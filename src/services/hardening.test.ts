import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCspDirectives,
  isOrgReceiptScannerRole,
  isPreviewIframeRuntime,
  isProductionRuntime,
  isSafeWebhookId,
  isSensitiveRevocationPath,
  resolveAdminSessionSecret,
  resolveTrustProxySetting,
  validateClientLocalDate,
  validateScanReceiptPayload,
} from './serverSecurity';
import { escapeCsvCell } from './csvEscape';
import { parseJsonNonBlocking } from './importProgress';
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

test('resolveAdminSessionSecret: throws clear error in production when missing or shorter than 32 chars', () => {
  assert.throws(
    () => resolveAdminSessionSecret(undefined, { isProduction: true }),
    /ADMIN_SESSION_SECRET is required in production/
  );
  assert.throws(
    () => resolveAdminSessionSecret('too-short-secret', { isProduction: true }),
    /ADMIN_SESSION_SECRET is required in production/
  );
  const validSecret = 'a-very-strong-production-secret-key-2026-01';
  assert.equal(
    resolveAdminSessionSecret(validSecret, { isProduction: true }).toString('utf8'),
    validSecret
  );
});

test('resolveTrustProxySetting and runtime flags: safe defaults for Vercel, Cloud Run, localhost, and explicit env overrides', () => {
  assert.equal(isProductionRuntime({ NODE_ENV: 'production' }), true);
  assert.equal(isProductionRuntime({ VERCEL_ENV: 'production' }), true);
  assert.equal(isProductionRuntime({ NODE_ENV: 'development' }), false);

  assert.equal(isPreviewIframeRuntime({ NODE_ENV: 'production' }), false);
  assert.equal(isPreviewIframeRuntime({ NODE_ENV: 'development' }), true);
  assert.equal(
    isPreviewIframeRuntime({ NODE_ENV: 'production', APP_URL: 'https://ais-pre-abc.run.app' }),
    true
  );

  assert.equal(resolveTrustProxySetting({ VERCEL: '1' }), 1);
  assert.equal(resolveTrustProxySetting({ K_SERVICE: 'raseedi-svc' }), 1);
  assert.equal(resolveTrustProxySetting({}), 'loopback');
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: 'false' }), false);
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: '2' }), 2);
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: 'loopback' }), 'loopback');
});

test('buildCspDirectives: enforces clickjacking protection and strips ws: in production while preserving Firebase and AdSense', () => {
  const prod = buildCspDirectives({ isProduction: true, allowPreviewFraming: false });
  assert.deepEqual(prod.frameAncestors, ["'self'"]);
  assert.equal(prod.connectSrc.includes('ws:'), false);
  assert.equal(prod.connectSrc.includes('wss:'), true);
  assert.equal(prod.scriptSrc.includes('https://pagead2.googlesyndication.com'), true);
  assert.equal(prod.connectSrc.includes('https://*.googleapis.com'), true);

  const preview = buildCspDirectives({ isProduction: false, allowPreviewFraming: true });
  assert.ok(preview.frameAncestors.includes('https://aistudio.google.com'));
  assert.equal(preview.connectSrc.includes('ws:'), true);
});

test('validateClientLocalDate and validateScanReceiptPayload: accept valid timezone dates and reject drift or impossible dates', () => {
  const serverNow = new Date(Date.UTC(2026, 4, 15, 22, 30, 0)); // 2026-05-15 UTC
  assert.equal(validateClientLocalDate('2026-05-16', serverNow), '2026-05-16');
  assert.equal(validateClientLocalDate('2026-05-14', serverNow), '2026-05-14');
  assert.equal(validateClientLocalDate('2026-05-20', serverNow), null);
  assert.equal(validateClientLocalDate('2026-02-30', serverNow), null);
  assert.equal(validateClientLocalDate('not-a-date', serverNow), null);

  const payloadCheck = validateScanReceiptPayload(
    {
      imageBase64: 'AAAA',
      mimeType: 'image/jpeg',
      categories: [],
      clientLocalDate: '2026-05-16',
    },
    serverNow
  );
  assert.equal(payloadCheck.ok, true);
  if (payloadCheck.ok) {
    assert.equal(payloadCheck.clientLocalDate, '2026-05-16');
  }
});

test('parseJsonNonBlocking and escapeCsvCell: parse small and large JSON payloads and neutralize CSV formulas', async () => {
  const small = await parseJsonNonBlocking<{ ok: boolean }>('{"ok":true}');
  assert.equal(small.ok, true);

  const bigArray = Array.from({ length: 1500 }, (_, i) => ({ id: `tx-${i}`, note: 'x'.repeat(40) }));
  const largeJson = JSON.stringify({ items: bigArray });
  assert.ok(largeJson.length > 65_536);
  const parsedLarge = await parseJsonNonBlocking<{ items: Array<{ id: string }> }>(largeJson);
  assert.equal(parsedLarge.items.length, 1500);

  assert.equal(escapeCsvCell('=CMD()'), `"'=CMD()"`);
  assert.equal(escapeCsvCell('+123'), `"'+123"`);
  assert.equal(escapeCsvCell('hello "world"'), `"hello ""world"""`);
});

