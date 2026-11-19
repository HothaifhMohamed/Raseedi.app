import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_PBKDF2_HASH_REGEX,
  buildDirectAdminSubscriptionPatch,
  generateRandomLicenseCodeBrowser,
  hashAdminPinBrowser,
  hashLicenseCodeBrowser,
  isApiEndpointUnavailableResponse,
  isAuthorizedPrimaryAdminUser,
  verifyAdminPinBrowser,
} from './adminAuth';
import {
  hashAdminPinServer,
  hashLicenseCodeServer,
  verifyAdminPinHashServer,
} from './serverSecurity';
import { stripSensitivePinFromSettings, stripSensitivePinsFromWallets } from './security';

describe('Vercel & Server Primary Admin Access (adminAuth)', () => {
  it('immediately authorizes verified primary admin regardless of email casing or whitespace', () => {
    assert.equal(
      isAuthorizedPrimaryAdminUser({
        uid: 'admin-uid-1',
        email: 'Hapaypal2003@gmail.com',
        emailVerified: true,
      }),
      true
    );
    assert.equal(
      isAuthorizedPrimaryAdminUser({
        uid: 'admin-uid-1',
        email: '  HAPAYPAL2003@GMAIL.COM  ',
        emailVerified: true,
      }),
      true
    );
    assert.equal(
      isAuthorizedPrimaryAdminUser({
        uid: 'admin-uid-1',
        email: 'hapaypal2003@gmail.com',
      }),
      true
    );
  });

  it('strictly rejects unverified, guest, null, or non-admin accounts', () => {
    assert.equal(isAuthorizedPrimaryAdminUser(null), false);
    assert.equal(
      isAuthorizedPrimaryAdminUser({
        uid: '',
        email: 'hapaypal2003@gmail.com',
        emailVerified: true,
      }),
      false
    );
    assert.equal(
      isAuthorizedPrimaryAdminUser({
        uid: 'admin-uid-1',
        email: 'hapaypal2003@gmail.com',
        emailVerified: false,
      }),
      false
    );
    assert.equal(
      isAuthorizedPrimaryAdminUser({
        uid: 'other-uid',
        email: 'someone@gmail.com',
        emailVerified: true,
      }),
      false
    );
  });

  it('detects Vercel static 404/HTML responses as unavailable while preserving real JSON security rejections', () => {
    assert.equal(isApiEndpointUnavailableResponse(404, 'text/html; charset=utf-8'), true);
    assert.equal(isApiEndpointUnavailableResponse(404, 'application/json'), true);
    assert.equal(isApiEndpointUnavailableResponse(405, 'text/plain'), true);
    assert.equal(isApiEndpointUnavailableResponse(200, 'text/html; charset=utf-8'), true);

    // Real Express JSON security errors must NOT trigger static fallback
    assert.equal(isApiEndpointUnavailableResponse(401, 'application/json; charset=utf-8'), false);
    assert.equal(isApiEndpointUnavailableResponse(403, 'application/json'), false);
    assert.equal(isApiEndpointUnavailableResponse(409, 'application/json'), false);
    assert.equal(isApiEndpointUnavailableResponse(429, 'application/json'), false);
    assert.equal(isApiEndpointUnavailableResponse(200, 'application/json'), false);
  });

  it('produces PBKDF2-SHA256 admin PIN hashes valid in Firestore rules, browser verifier, AND Node server verifier', async () => {
    const hash = await hashAdminPinBrowser('RaseediAdmin#2026');
    assert.match(hash, ADMIN_PBKDF2_HASH_REGEX);
    assert.match(
      hash,
      /^(scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}|pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64})$/
    );

    assert.equal(await verifyAdminPinBrowser('RaseediAdmin#2026', hash), 'match');
    assert.equal(await verifyAdminPinBrowser('  RaseediAdmin#2026 ', hash), 'match');
    assert.equal(await verifyAdminPinBrowser('WrongPin99', hash), 'mismatch');

    // Cross-compatible with Node server verifyAdminPinHashServer
    assert.equal(verifyAdminPinHashServer('RaseediAdmin#2026', hash), true);
    assert.equal(verifyAdminPinHashServer('WrongPin99', hash), false);
  });

  it('detects legacy server scrypt hashes in browser so UI can offer Google re-auth upgrade', async () => {
    const serverHash = hashAdminPinServer('ServerPin#99');
    assert.equal(await verifyAdminPinBrowser('ServerPin#99', serverHash), 'server_scrypt_only');
    assert.equal(verifyAdminPinHashServer('ServerPin#99', serverHash), true);
  });

  it('hashes browser-generated license codes identically to server SHA-256 hash', async () => {
    const generated = await generateRandomLicenseCodeBrowser({
      tier: 'business',
      cycle: 'lifetime',
    });
    assert.match(generated.code, /^RSD-BIZ-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(generated.planTier, 'business_pro');
    assert.equal(generated.proPlan, 'code');
    assert.equal(generated.codeHash, hashLicenseCodeServer(generated.code));
    assert.equal(await hashLicenseCodeBrowser(generated.code), hashLicenseCodeServer(generated.code));
  });

  it('builds direct admin subscription patches restricted strictly to Firestore rules allowed keys', () => {
    const allowedKeys = new Set([
      'isPro',
      'proActive',
      'planTier',
      'proPlan',
      'billingCycle',
      'startedAt',
      'expiresAt',
      'proExpiresAt',
      'redeemedCouponCode',
    ]);

    const bizYearly = buildDirectAdminSubscriptionPatch({
      planTier: 'business_pro',
      billingCycle: 'yearly',
      nowMs: 1_700_000_000_000,
    });
    assert.deepEqual(
      Object.keys(bizYearly).filter((k) => !allowedKeys.has(k)),
      []
    );
    assert.equal(bizYearly.isPro, true);
    assert.equal(bizYearly.proPlan, 'business_yearly');
    assert.equal(bizYearly.expiresAt, 1_700_000_000_000 + 365 * 24 * 60 * 60 * 1000);

    const freeCancel = buildDirectAdminSubscriptionPatch({
      planTier: 'free',
      billingCycle: 'free',
    });
    assert.equal(freeCancel.isPro, false);
    assert.equal(freeCancel.planTier, 'free');
    assert.equal(freeCancel.expiresAt, null);
  });

  it('never leaks app PIN or wallet PINs into backup/meta settings or wallets payloads', () => {
    const cleanedSettings = stripSensitivePinFromSettings({
      language: 'ar',
      isAppLockEnabled: true,
      appPin: 'pbkdf2$100000$hash',
      appPinSalt: 'salt1234',
    });
    assert.equal('appPin' in cleanedSettings, false);
    assert.equal('appPinSalt' in cleanedSettings, false);
    assert.equal(cleanedSettings.isAppLockEnabled, false);

    const cleanedWallets = stripSensitivePinsFromWallets([
      {
        id: 'w1',
        name: 'Cash',
        type: 'cash',
        balance: 500,
        currency: 'EGP',
        color: '#000',
        isLocked: true,
        pin: 'pbkdf2$100000$hash',
        pinSalt: 'salt5678',
      },
    ]);
    assert.equal('pin' in cleanedWallets[0], false);
    assert.equal('pinSalt' in cleanedWallets[0], false);
    assert.equal(cleanedWallets[0].isLocked, false);
  });
});
