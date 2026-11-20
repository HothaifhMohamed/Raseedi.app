import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackCloudUserProfile,
  classifyGoogleAuthError,
  executeGoogleSignInWithRecovery,
  formatDetailedGoogleAuthError,
  isTransientProfileSyncError,
  shouldAttemptCurrentUserRecovery,
  shouldIgnoreAuthStateChangeDuringInteractiveSignIn,
} from './googleAuthFlow';

describe('googleAuthFlow race guard, recovery, and error classification', () => {
  it('ignores onAuthStateChanged while interactive Google sign-in is active so syncRequestId is never invalidated on Attempt 1', async () => {
    let syncRequestId = 1;
    let activeInteractive = false;
    let onAuthStateChangedCalls = 0;

    // Simulate onAuthStateChanged listener with the fixed guard order
    const simulateOnAuthStateChanged = () => {
      onAuthStateChangedCalls += 1;
      if (shouldIgnoreAuthStateChangeDuringInteractiveSignIn(activeInteractive)) {
        return 'ignored';
      }
      syncRequestId += 1;
      return 'processed';
    };

    // Start interactive Google Sign-In (Attempt 1)
    activeInteractive = true;
    const reqId = ++syncRequestId; // reqId = 2

    const result = await executeGoogleSignInWithRecovery({
      signInWithPopup: async () => {
        // Firebase fires onAuthStateChanged synchronously/immediately as popup resolves
        const status = simulateOnAuthStateChanged();
        assert.equal(status, 'ignored');
        return {
          uid: 'uid_first_attempt',
          email: 'user@example.com',
          displayName: 'User One',
          getIdToken: async () => 'jwt_token',
        };
      },
      getCurrentUser: () => null,
      ensureUserProfile: async (u) => buildFallbackCloudUserProfile(u),
      buildFallbackProfile: (u) => buildFallbackCloudUserProfile(u),
      delay: async () => {},
    });

    // reqId MUST still match syncRequestId on Attempt 1!
    assert.equal(onAuthStateChangedCalls, 1);
    assert.equal(reqId, syncRequestId);
    assert.equal(result.firebaseUser.uid, 'uid_first_attempt');
    assert.equal(result.profileSyncDeferred, false);
    assert.equal(result.recoveredFromCurrentUser, false);

    // After interactive sign-in finishes, normal auth state changes are processed again
    activeInteractive = false;
    assert.equal(simulateOnAuthStateChanged(), 'processed');
    assert.equal(syncRequestId, reqId + 1);
  });

  it('recovers automatically when ensureUserProfile hits a transient permission/network error on the first try', async () => {
    let profileAttempts = 0;
    let tokenWarms = 0;

    const result = await executeGoogleSignInWithRecovery({
      signInWithPopup: async () => ({
        uid: 'uid_transient_retry',
        email: 'retry@example.com',
        getIdToken: async () => {
          tokenWarms += 1;
          return 'jwt_token';
        },
      }),
      getCurrentUser: () => null,
      ensureUserProfile: async (u) => {
        profileAttempts += 1;
        if (profileAttempts === 1) {
          throw { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
        }
        return { ...buildFallbackCloudUserProfile(u), hasCompletedOnboarding: true };
      },
      buildFallbackProfile: (u) => buildFallbackCloudUserProfile(u),
      delay: async () => {},
    });

    assert.equal(profileAttempts, 2);
    assert.equal(tokenWarms, 2);
    assert.equal(result.profileSyncDeferred, false);
    assert.equal(result.profile.hasCompletedOnboarding, true);
  });

  it('degrades gracefully to a fallback profile and schedules deferred sync instead of failing login if Firestore stays unreachable after OAuth succeeds', async () => {
    let profileAttempts = 0;
    let deferredUid: string | null = null;

    const result = await executeGoogleSignInWithRecovery({
      signInWithPopup: async () => ({
        uid: 'uid_offline_after_oauth',
        email: 'offline@example.com',
        displayName: 'Offline User',
      }),
      getCurrentUser: () => null,
      ensureUserProfile: async () => {
        profileAttempts += 1;
        throw { code: 'unavailable', message: 'The client is offline.' };
      },
      buildFallbackProfile: (u) => buildFallbackCloudUserProfile(u),
      scheduleDeferredProfileSync: (u) => {
        deferredUid = u.uid;
      },
      delay: async () => {},
    });

    assert.equal(profileAttempts, 2); // 1 initial + 1 bounded retry (no infinite loop)
    assert.equal(result.profileSyncDeferred, true);
    assert.equal(result.profile.uid, 'uid_offline_after_oauth');
    assert.equal(deferredUid, 'uid_offline_after_oauth');
  });

  it('recovers cleanly if signInWithPopup throws cancelled-popup-request while auth.currentUser is already signed in', async () => {
    const existingUser = {
      uid: 'uid_recovered_popup',
      email: 'recovered@example.com',
      displayName: 'Recovered User',
    };

    const result = await executeGoogleSignInWithRecovery({
      signInWithPopup: async () => {
        throw { code: 'auth/cancelled-popup-request', message: 'Popup cancelled' };
      },
      getCurrentUser: () => existingUser,
      waitAuthStateReady: async () => {},
      ensureUserProfile: async (u) => buildFallbackCloudUserProfile(u),
      buildFallbackProfile: (u) => buildFallbackCloudUserProfile(u),
      delay: async () => {},
    });

    assert.equal(result.recoveredFromCurrentUser, true);
    assert.equal(result.firebaseUser.uid, 'uid_recovered_popup');
    assert.equal(result.profileSyncDeferred, false);
  });

  it('rethrows popup error cleanly when user truly closed popup and auth.currentUser is null', async () => {
    await assert.rejects(
      () =>
        executeGoogleSignInWithRecovery({
          signInWithPopup: async () => {
            throw { code: 'auth/popup-closed-by-user', message: 'User closed popup' };
          },
          getCurrentUser: () => null,
          waitAuthStateReady: async () => {},
          ensureUserProfile: async (u) => buildFallbackCloudUserProfile(u),
          buildFallbackProfile: (u) => buildFallbackCloudUserProfile(u),
          delay: async () => {},
        }),
      (err: unknown) => classifyGoogleAuthError(err) === 'popup_closed'
    );
  });

  it('classifies Firebase Auth errors accurately and produces distinct Arabic & English copy', () => {
    assert.equal(classifyGoogleAuthError({ code: 'auth/popup-closed-by-user' }), 'popup_closed');
    assert.equal(classifyGoogleAuthError({ code: 'auth/popup-blocked' }), 'popup_blocked');
    assert.equal(
      classifyGoogleAuthError({ code: 'auth/cancelled-popup-request' }),
      'popup_cancelled'
    );
    assert.equal(
      classifyGoogleAuthError({ code: 'auth/network-request-failed' }),
      'network'
    );
    assert.equal(
      classifyGoogleAuthError({ code: 'auth/unauthorized-domain' }),
      'unauthorized_domain'
    );
    assert.equal(
      classifyGoogleAuthError({ code: 'auth/too-many-requests' }),
      'too_many_requests'
    );

    assert.equal(shouldAttemptCurrentUserRecovery({ code: 'auth/popup-blocked' }), false);
    assert.equal(shouldAttemptCurrentUserRecovery({ code: 'auth/unauthorized-domain' }), false);
    assert.equal(shouldAttemptCurrentUserRecovery({ code: 'auth/cancelled-popup-request' }), true);
    assert.equal(isTransientProfileSyncError({ code: 'unavailable' }), true);
    assert.equal(isTransientProfileSyncError({ code: 'auth/popup-blocked' }), false);

    const closedAr = formatDetailedGoogleAuthError({ code: 'auth/popup-closed-by-user' }, true);
    const blockedAr = formatDetailedGoogleAuthError({ code: 'auth/popup-blocked' }, true);
    const networkAr = formatDetailedGoogleAuthError({ code: 'auth/network-request-failed' }, true);
    const networkEn = formatDetailedGoogleAuthError({ code: 'auth/network-request-failed' }, false);

    assert.equal(closedAr.includes('إغلاق نافذة'), true);
    assert.equal(blockedAr.includes('النوافذ المنبثقة'), true);
    assert.equal(networkAr.includes('الإنترنت'), true);
    assert.equal(networkEn.includes('Network connection error'), true);
  });
});
