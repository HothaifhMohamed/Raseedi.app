import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitialUserProfilePayload,
  buildSafeUserProfileUpdatePatch,
  formatUserFriendlyAuthError,
  isPermissionDeniedFirestoreError,
  OWNER_UPDATABLE_PROFILE_FIELDS,
  PRIVILEGED_PROFILE_FIELDS,
  shouldSurfaceCloudDiagnosticsError,
} from './userProfileSync';

describe('userProfileSync safe Firestore users/{uid} helpers', () => {
  it('builds a strictly rules-compliant initial user profile payload with free-tier defaults', () => {
    const payload = buildInitialUserProfilePayload({
      uid: 'uid_new_123',
      email: '  newuser@example.com  ',
      displayName: '  Ahmed Ali  ',
      photoURL: ' https://lh3.googleusercontent.com/avatar.png ',
      hasCompletedOnboarding: false,
    });

    assert.equal(payload.uid, 'uid_new_123');
    assert.equal(payload.email, 'newuser@example.com');
    assert.equal(payload.displayName, 'Ahmed Ali');
    assert.equal(payload.photoURL, 'https://lh3.googleusercontent.com/avatar.png');
    assert.equal(payload.isPro, false);
    assert.equal(payload.proActive, false);
    assert.equal(payload.proPlan, 'free');
    assert.equal(payload.planTier, 'free');
    assert.equal(payload.billingCycle, 'free');
    assert.equal(payload.startedAt, null);
    assert.equal(payload.expiresAt, null);
    assert.equal(payload.proExpiresAt, null);
    assert.equal(payload.hasUsedBusinessTrial, false);
    assert.equal(payload.hasCompletedOnboarding, false);
    assert.equal('isAdmin' in payload, false);
    assert.equal('activationCodeHash' in payload, false);
    assert.equal('createdAt' in payload, false);
  });

  it('omits empty displayName/photoURL and falls back to synthetic email when email is missing', () => {
    const payload = buildInitialUserProfilePayload({
      uid: 'uid_no_email',
      email: '   ',
      displayName: '',
      photoURL: null,
    });

    assert.equal(payload.email, 'uid_no_email@firebase.local');
    assert.equal('displayName' in payload, false);
    assert.equal('photoURL' in payload, false);
    assert.equal('hasCompletedOnboarding' in payload, false);
  });

  it('builds owner-only update patches that NEVER include createdAt or privileged fields and skips no-op writes', () => {
    const existing = {
      uid: 'uid_1',
      email: 'user@example.com',
      displayName: 'Sara',
      photoURL: 'https://example.com/a.png',
      hasCompletedOnboarding: true,
    };

    const noOp = buildSafeUserProfileUpdatePatch({
      uid: 'uid_1',
      email: 'user@example.com',
      displayName: 'Sara',
      photoURL: 'https://example.com/a.png',
      hasCompletedOnboarding: true,
      existing,
    });
    assert.equal(noOp.hasChanges, false);
    assert.deepEqual(noOp.patch, {});

    const updated = buildSafeUserProfileUpdatePatch({
      uid: 'uid_1',
      email: 'user-new@example.com',
      displayName: 'Sara M.',
      photoURL: 'https://example.com/b.png',
      hasCompletedOnboarding: true,
      existing: { ...existing, hasCompletedOnboarding: false },
    });

    assert.equal(updated.hasChanges, true);
    for (const key of Object.keys(updated.patch)) {
      assert.equal(OWNER_UPDATABLE_PROFILE_FIELDS.has(key), true, `Unexpected key: ${key}`);
      assert.equal(PRIVILEGED_PROFILE_FIELDS.has(key), false, `Privileged key leaked: ${key}`);
    }
    assert.equal(updated.patch.email, 'user-new@example.com');
    assert.equal(updated.patch.displayName, 'Sara M.');
    assert.equal(updated.patch.photoURL, 'https://example.com/b.png');
    assert.equal(updated.patch.hasCompletedOnboarding, true);
  });

  it('detects permission-denied errors across FirebaseError and serialized handleFirestoreError strings', () => {
    assert.equal(
      isPermissionDeniedFirestoreError({ code: 'permission-denied', message: 'Denied' }),
      true
    );
    assert.equal(
      isPermissionDeniedFirestoreError(
        new Error(
          JSON.stringify({
            error: 'Missing or insufficient permissions.',
            operationType: 'write',
            path: 'users/abc',
          })
        )
      ),
      true
    );
    assert.equal(isPermissionDeniedFirestoreError(new Error('network unavailable')), false);
  });

  it('suppresses noisy cloud diagnostics banner during initial account setup / onboarding', () => {
    assert.equal(
      shouldSurfaceCloudDiagnosticsError({
        isInitialAccountSetup: true,
        hasCompletedOnboarding: false,
      }),
      false
    );
    assert.equal(
      shouldSurfaceCloudDiagnosticsError({
        isInitialAccountSetup: true,
        hasCompletedOnboarding: true,
      }),
      false
    );
    assert.equal(
      shouldSurfaceCloudDiagnosticsError({
        isInitialAccountSetup: false,
        hasCompletedOnboarding: false,
      }),
      false
    );
    assert.equal(
      shouldSurfaceCloudDiagnosticsError({
        isInitialAccountSetup: false,
        hasCompletedOnboarding: true,
        recoveredByRetry: true,
      }),
      false
    );
    assert.equal(
      shouldSurfaceCloudDiagnosticsError({
        isInitialAccountSetup: false,
        hasCompletedOnboarding: true,
      }),
      true
    );
    assert.equal(
      shouldSurfaceCloudDiagnosticsError({
        isInitialAccountSetup: true,
        hasCompletedOnboarding: false,
        isExplicitRecoveryAction: true,
      }),
      true
    );
  });

  it('formats raw Firestore JSON errors into clean localized auth messages without leaking JSON', () => {
    const rawJsonErr = new Error(
      JSON.stringify({
        error: 'Missing or insufficient permissions.',
        operationType: 'write',
        path: 'users/u1',
      })
    );
    const arMsg = formatUserFriendlyAuthError(rawJsonErr, true);
    const enMsg = formatUserFriendlyAuthError(rawJsonErr, false);

    assert.equal(arMsg.includes('{'), false);
    assert.equal(enMsg.includes('{'), false);
    assert.equal(arMsg.includes('تهيئة'), true);
    assert.equal(enMsg.includes('cloud account setup'), true);
  });
});
