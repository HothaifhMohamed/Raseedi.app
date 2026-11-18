import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_LICENSE_CODE_PREFIX,
  LICENSE_CODE_PREFIX,
  getLicensePrefixForTier,
  isSignedLicenseFormat,
} from './licenseCodes';
import {
  generateRandomLicenseCodeServer,
  hashLicenseCodeServer,
  isAllowedCorsOrigin,
  isServerAdminUser,
  resolveActivationPlanDetails,
  validateWebhookOrgPlanMatch,
  verifyTimingSafePasscode,
} from './serverSecurity';

describe('licenseCodes format helpers and serverSecurity hardening', () => {
  it('detects RSD-PRO-* and RSD-BIZ-* formats and resolves tier prefixes', () => {
    assert.equal(getLicensePrefixForTier('pro'), LICENSE_CODE_PREFIX);
    assert.equal(getLicensePrefixForTier('business'), BUSINESS_LICENSE_CODE_PREFIX);
    assert.equal(isSignedLicenseFormat('rsd-pro-abcd-efgh-ijkl'), true);
    assert.equal(isSignedLicenseFormat('RSD-BIZ-1234-5678-90AB'), true);
    assert.equal(isSignedLicenseFormat('LEGACY-CODE-123'), false);
  });

  it('generates server-side random license codes and deterministic SHA-256 hashes', () => {
    const c1 = generateRandomLicenseCodeServer({ tier: 'pro', cycle: 'monthly' });
    const c2 = generateRandomLicenseCodeServer({ tier: 'business', cycle: 'yearly' });
    assert.ok(c1.code.startsWith(LICENSE_CODE_PREFIX));
    assert.ok(c2.code.startsWith(BUSINESS_LICENSE_CODE_PREFIX));
    assert.notEqual(c1.code, c2.code);
    assert.equal(c1.codeHash, hashLicenseCodeServer(`  ${c1.code.toLowerCase()}  `));
    assert.equal(c1.codeHash.length, 64);
    assert.match(c1.codePreview, /^RSD-PRO-\*{4}-/);
  });

  it('verifies timing-safe passcodes against env configuration only', () => {
    assert.equal(verifyTimingSafePasscode('secret-pass-99', 'secret-pass-99'), true);
    assert.equal(verifyTimingSafePasscode('  secret-pass-99 ', 'secret-pass-99'), true);
    assert.equal(verifyTimingSafePasscode('wrong-pass', 'secret-pass-99'), false);
    assert.equal(verifyTimingSafePasscode('anything', ''), false);
    assert.equal(verifyTimingSafePasscode('', 'secret-pass-99'), false);
  });

  it('authorizes admins solely via verified custom claim or ADMIN_EMAILS env list', () => {
    assert.equal(isServerAdminUser({ email_verified: true, admin: true }), true);
    assert.equal(isServerAdminUser({ email_verified: false, admin: true }), false);
    assert.equal(
      isServerAdminUser(
        { email: 'OpsAdmin@Example.com', email_verified: true },
        'opsadmin@example.com,sec@example.com'
      ),
      true
    );
    assert.equal(
      isServerAdminUser(
        { email: 'user@example.com', email_verified: true },
        'opsadmin@example.com'
      ),
      false
    );
    assert.equal(isServerAdminUser(null, 'opsadmin@example.com'), false);
  });

  it('enforces strict CORS origin allowlist checks', () => {
    assert.equal(isAllowedCorsOrigin('http://localhost:3000', 'localhost:3000', 'http'), true);
    assert.equal(
      isAllowedCorsOrigin('https://app.raseedi.example', 'localhost:3000', 'https', {
        appUrl: 'https://app.raseedi.example',
      }),
      true
    );
    assert.equal(
      isAllowedCorsOrigin('https://evil-attacker.example', 'localhost:3000', 'http', {
        appUrl: 'https://app.raseedi.example',
      }),
      false
    );
  });

  it('throws INVALID_PLAN for unknown activation plans and enforces webhook orgId plan matches', () => {
    const biz = resolveActivationPlanDetails('business_yearly', { nowMs: 1_760_000_000_000 });
    assert.equal(biz.planTier, 'business_pro');
    assert.equal(biz.billingCycle, 'yearly');

    assert.throws(() => resolveActivationPlanDetails('unknown_plan'), /INVALID_PLAN/);
    assert.throws(
      () => resolveActivationPlanDetails(undefined, { tier: 'invalid', cycle: 'monthly' }),
      /INVALID_PLAN/
    );

    assert.equal(validateWebhookOrgPlanMatch('personal_pro', 'org-123'), false);
    assert.equal(validateWebhookOrgPlanMatch('business_pro', 'org-123'), true);
    assert.equal(validateWebhookOrgPlanMatch('personal_pro', null), true);
  });
});
