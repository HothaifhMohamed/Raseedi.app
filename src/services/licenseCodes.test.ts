import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMARY_SYSTEM_ADMIN_EMAIL,
  isPrimarySystemAdminEmail,
} from './licenseCodes';
import {
  buildAdminCustomClaims,
  hashAdminPinServer,
  isAllowedCorsOrigin,
  isServerAdminUser,
  resolveActivationPlanDetails,
  validateNewAdminPin,
  validateWebhookOrgPlanMatch,
  verifyAdminPinHashServer,
  verifyTimingSafePasscode,
} from './serverSecurity';
import {
  decodeFirestoreDocumentFields,
  encodeFirestoreDocumentFields,
} from './firestoreRest';

describe('system admin identity and serverSecurity hardening', () => {
  it('verifies timing-safe passcodes against env configuration only', () => {
    assert.equal(verifyTimingSafePasscode('secret-pass-99', 'secret-pass-99'), true);
    assert.equal(verifyTimingSafePasscode('  secret-pass-99 ', 'secret-pass-99'), true);
    assert.equal(verifyTimingSafePasscode('wrong-pass', 'secret-pass-99'), false);
    assert.equal(verifyTimingSafePasscode('anything', ''), false);
    assert.equal(verifyTimingSafePasscode('', 'secret-pass-99'), false);
  });

  it('locks system admin exclusively to verified hapaypal2003@gmail.com', () => {
    assert.equal(PRIMARY_SYSTEM_ADMIN_EMAIL, 'hapaypal2003@gmail.com');
    assert.equal(isPrimarySystemAdminEmail('Hapaypal2003@gmail.com'), true);
    assert.equal(isPrimarySystemAdminEmail('  hapaypal2003@gmail.com '), true);
    assert.equal(isPrimarySystemAdminEmail('other@gmail.com'), false);
    assert.equal(isPrimarySystemAdminEmail(null), false);

    // Verified primary system admin passes (case-insensitive, whitespace-trimmed, default when ADMIN_EMAILS unset/empty)
    assert.equal(
      isServerAdminUser(
        { email: '  Hapaypal2003@gmail.com  ', email_verified: true },
        undefined
      ),
      true
    );
    assert.equal(
      isServerAdminUser(
        { email: 'HAPAYPAL2003@GMAIL.COM', email_verified: true },
        ''
      ),
      true
    );
    assert.equal(
      isServerAdminUser(
        { email: 'Hapaypal2003@gmail.com', email_verified: true },
        'hapaypal2003@gmail.com'
      ),
      true
    );
    assert.equal(
      isServerAdminUser({
        email: 'hapaypal2003@gmail.com',
        email_verified: true,
        admin: true,
      }),
      true
    );

    // Unverified email is strictly rejected even with admin:true
    assert.equal(
      isServerAdminUser({
        email: 'hapaypal2003@gmail.com',
        email_verified: false,
        admin: true,
      }),
      false
    );

    // Any other email is strictly rejected EVEN if it carries admin:true or appears in ADMIN_EMAILS
    assert.equal(
      isServerAdminUser(
        { email: 'OpsAdmin@Example.com', email_verified: true, admin: true },
        'opsadmin@example.com,hapaypal2003@gmail.com'
      ),
      false
    );
    assert.equal(
      isServerAdminUser({ email_verified: true, admin: true }),
      false
    );
    assert.equal(isServerAdminUser(null, 'hapaypal2003@gmail.com'), false);

    const added = buildAdminCustomClaims({ orgRole: 'owner', tier: 'pro' });
    assert.equal(added.changed, true);
    assert.deepEqual(added.claims, { orgRole: 'owner', tier: 'pro', admin: true });

    const unchanged = buildAdminCustomClaims({ admin: true, orgRole: 'owner' });
    assert.equal(unchanged.changed, false);
    assert.deepEqual(unchanged.claims, { admin: true, orgRole: 'owner' });
  });

  it('hashes and verifies Admin PINs using unique salted scrypt digests', () => {
    assert.equal(validateNewAdminPin('123').ok, false);
    assert.equal(validateNewAdminPin('a'.repeat(33)).ok, false);
    assert.equal(validateNewAdminPin('  739182  ').ok, true);

    const hashA = hashAdminPinServer('Raseedi#2026');
    const hashB = hashAdminPinServer('Raseedi#2026');
    assert.match(hashA, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.notEqual(hashA, hashB); // Unique random salt every time
    assert.equal(verifyAdminPinHashServer('Raseedi#2026', hashA), true);
    assert.equal(verifyAdminPinHashServer('  Raseedi#2026 ', hashB), true);
    assert.equal(verifyAdminPinHashServer('WrongPin', hashA), false);
    assert.equal(verifyAdminPinHashServer('Raseedi#2026', 'plaintext'), false);
    assert.equal(verifyAdminPinHashServer('Raseedi#2026', null), false);
  });

  it('round-trips Firestore REST field encoding and decoding cleanly', () => {
    const input = {
      pinHash: `scrypt$${'a'.repeat(32)}$${'b'.repeat(128)}`,
      updatedByEmail: 'hapaypal2003@gmail.com',
      updatedAtMs: 1_760_000_000_000,
      used: false,
      usedBy: null,
      tags: ['admin', 'security'],
    };
    const encoded = encodeFirestoreDocumentFields(input);
    const decoded = decodeFirestoreDocumentFields(encoded);
    assert.deepEqual(decoded, input);
  });

  it('enforces strict CORS origin allowlist checks including reverse-proxy forwardedHost', () => {
    assert.equal(isAllowedCorsOrigin('http://localhost:3000', 'localhost:3000', 'http'), true);
    assert.equal(
      isAllowedCorsOrigin('https://ais-dev-example.run.app', 'localhost:3000', 'http', {
        forwardedHost: 'ais-dev-example.run.app',
      }),
      true
    );
    assert.equal(
      isAllowedCorsOrigin('https://app.raseedi.example', 'localhost:3000', 'https', {
        appUrl: 'https://app.raseedi.example',
      }),
      true
    );
    assert.equal(
      isAllowedCorsOrigin('https://evil-attacker.example', 'localhost:3000', 'http', {
        appUrl: 'https://app.raseedi.example',
        forwardedHost: 'ais-dev-example.run.app',
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
