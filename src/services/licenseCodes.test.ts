import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_PANEL_PASSCODE,
  AUTHORIZED_ADMIN_EMAILS,
  BUSINESS_LICENSE_CODE_PREFIX,
  LICENSE_CODE_PREFIX,
  computeLicenseCodeHash,
  generateAdminLicenseCode,
  isAuthorizedAdminEmail,
  isAuthorizedAdminUser,
  isSignedLicenseFormat,
  verifyAdminPassword,
  verifySignedLicenseCode,
} from './licenseCodes';

describe('licenseCodes admin gate and cryptographic coupon engine', () => {
  it('authorizes only verified authorized admin emails (case-insensitive)', () => {
    assert.equal(AUTHORIZED_ADMIN_EMAILS.includes('hapaypal2003@gmail.com'), true);
    assert.equal(isAuthorizedAdminEmail('Hapaypal2003@gmail.com'), true);
    assert.equal(isAuthorizedAdminEmail('  hapaypal2003@gmail.com  '), true);
    assert.equal(isAuthorizedAdminEmail('user@gmail.com'), false);
    assert.equal(isAuthorizedAdminEmail(''), false);
    assert.equal(isAuthorizedAdminEmail(null), false);

    assert.equal(
      isAuthorizedAdminUser({ email: 'Hapaypal2003@gmail.com', isLoggedIn: true, emailVerified: true }),
      true
    );
    assert.equal(
      isAuthorizedAdminUser({ email: 'hapaypal2003@gmail.com', isLoggedIn: false, emailVerified: true }),
      false
    );
    assert.equal(
      isAuthorizedAdminUser({ email: 'hapaypal2003@gmail.com', isLoggedIn: true, emailVerified: false }),
      false
    );
    assert.equal(
      isAuthorizedAdminUser({ email: 'other@gmail.com', isLoggedIn: true, emailVerified: true }),
      false
    );
    assert.equal(isAuthorizedAdminUser(null), false);
  });

  it('computes deterministic 64-char hex SHA-256 hash matching server prefixing', () => {
    const h1 = computeLicenseCodeHash('RSD-PRO-PYTEST01-ABCDEFGH');
    const h2 = computeLicenseCodeHash('  rsd-pro-pytest01-abcdefgh ');
    assert.equal(h1.length, 64);
    assert.match(h1, /^[0-9a-f]{64}$/);
    assert.equal(h1, h2);
  });

  it('validates the secret admin password accurately', () => {
    assert.equal(verifyAdminPassword(ADMIN_PANEL_PASSCODE), true);
    assert.equal(verifyAdminPassword(`  ${ADMIN_PANEL_PASSCODE}  `), true);
    assert.equal(verifyAdminPassword('wrong_password'), false);
    assert.equal(verifyAdminPassword(''), false);
  });

  it('generates unique RSD-PRO-* and RSD-BIZ-* codes for each tier', () => {
    const c1 = generateAdminLicenseCode({ tier: 'pro', cycle: 'monthly' });
    const c2 = generateAdminLicenseCode({ tier: 'pro', cycle: 'monthly' });
    const b1 = generateAdminLicenseCode({ tier: 'business', cycle: 'yearly' });
    assert.ok(c1.startsWith(LICENSE_CODE_PREFIX));
    assert.ok(c2.startsWith(LICENSE_CODE_PREFIX));
    assert.ok(b1.startsWith(BUSINESS_LICENSE_CODE_PREFIX));
    assert.notEqual(c1, c2);
    assert.equal(isSignedLicenseFormat(c1), true);
    assert.equal(isSignedLicenseFormat(b1), true);
  });

  it('round-trips Personal PRO monthly, yearly, and lifetime codes accurately', () => {
    const fixedNow = 1_760_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;

    const monthlyCode = generateAdminLicenseCode({ tier: 'pro', cycle: 'monthly', nonce: 'TEST01' });
    const resMonthly = verifySignedLicenseCode(monthlyCode, fixedNow);
    assert.equal(resMonthly.valid, true);
    if (resMonthly.valid) {
      assert.equal(resMonthly.planTier, 'personal_pro');
      assert.equal(resMonthly.proPlan, 'monthly');
      assert.equal(resMonthly.billingCycle, 'monthly');
      assert.equal(resMonthly.expiresAt, fixedNow + 30 * dayMs);
    }

    const yearlyCode = generateAdminLicenseCode({ tier: 'pro', cycle: 'yearly', nonce: 'TEST02' });
    const resYearly = verifySignedLicenseCode(yearlyCode.toLowerCase(), fixedNow);
    assert.equal(resYearly.valid, true);
    if (resYearly.valid) {
      assert.equal(resYearly.planTier, 'personal_pro');
      assert.equal(resYearly.proPlan, 'yearly');
      assert.equal(resYearly.billingCycle, 'yearly');
      assert.equal(resYearly.expiresAt, fixedNow + 365 * dayMs);
    }

    const lifetimeCode = generateAdminLicenseCode({ tier: 'pro', cycle: 'lifetime', nonce: 'TEST03' });
    const resLifetime = verifySignedLicenseCode(lifetimeCode, fixedNow);
    assert.equal(resLifetime.valid, true);
    if (resLifetime.valid) {
      assert.equal(resLifetime.planTier, 'personal_pro');
      assert.equal(resLifetime.proPlan, 'lifetime');
      assert.equal(resLifetime.billingCycle, 'lifetime');
      assert.equal(resLifetime.expiresAt, null);
    }
  });

  it('round-trips Business PRO monthly, yearly, and lifetime RSD-BIZ codes accurately', () => {
    const fixedNow = 1_760_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;

    const bizYearly = generateAdminLicenseCode({ tier: 'business', cycle: 'yearly', nonce: 'BIZ999' });
    assert.ok(bizYearly.startsWith('RSD-BIZ-'));
    const resBiz = verifySignedLicenseCode(bizYearly, fixedNow);
    assert.equal(resBiz.valid, true);
    if (resBiz.valid) {
      assert.equal(resBiz.planTier, 'business_pro');
      assert.equal(resBiz.proPlan, 'business_yearly');
      assert.equal(resBiz.billingCycle, 'yearly');
      assert.equal(resBiz.expiresAt, fixedNow + 365 * dayMs);
    }

    const bizLifetime = generateAdminLicenseCode({ tier: 'business', cycle: 'lifetime', nonce: 'BIZ888' });
    assert.ok(bizLifetime.startsWith('RSD-BIZ-'));
    const resBizLife = verifySignedLicenseCode(bizLifetime, fixedNow);
    assert.equal(resBizLife.valid, true);
    if (resBizLife.valid) {
      assert.equal(resBizLife.planTier, 'business_pro');
      assert.equal(resBizLife.billingCycle, 'lifetime');
      assert.equal(resBizLife.expiresAt, null);
    }
  });

  it('rejects tampered or forged RSD-PRO and RSD-BIZ codes strictly', () => {
    const valid = generateAdminLicenseCode({ tier: 'business', cycle: 'lifetime', nonce: 'ABC123' });
    // Mutate signature last char
    const lastChar = valid[valid.length - 1];
    const replacement = lastChar === 'A' ? 'B' : 'A';
    const tamperedSig = valid.slice(0, -1) + replacement;
    const r1 = verifySignedLicenseCode(tamperedSig);
    assert.equal(r1.valid, false);
    if (!r1.valid) {
      assert.equal(r1.isSignedFormat, true);
      assert.equal(r1.reason, 'INVALID_SIGNATURE');
    }

    // Mutate tier from Personal ('P') to Business ('B') without recomputing HMAC
    const personal = generateAdminLicenseCode({ tier: 'pro', cycle: 'yearly', nonce: 'ABC123' });
    const tamperedTier = personal.replace('RSD-PRO-PY', 'RSD-PRO-BY');
    const r2 = verifySignedLicenseCode(tamperedTier);
    assert.equal(r2.valid, false);

    // Non-RSD-PRO/RSD-BIZ legacy codes return isSignedFormat = false
    const r3 = verifySignedLicenseCode('RASEEDI-1234-5678');
    assert.equal(r3.valid, false);
    if (!r3.valid) {
      assert.equal(r3.isSignedFormat, false);
      assert.equal(r3.reason, 'NOT_SIGNED_FORMAT');
    }
  });
});
