import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeUserSubscriptionSummary,
  normalizePlanTierInput,
  resolveAppEntryStage,
  resolvePostGoogleSignInAction,
  shouldShowAds,
  shouldShowBusinessUpgradeUi,
  shouldShowPersonalUpgradeUi,
  SUBSCRIPTION_DAY_MS,
} from './subscriptionHelpers';

describe('subscriptionHelpers tier resolution, expiry alerts & auth gate transitions', () => {
  it('recognizes planTier === "business" and "business_pro" as business_pro', () => {
    assert.equal(normalizePlanTierInput('business', undefined, true), 'business_pro');
    assert.equal(normalizePlanTierInput('business_pro', undefined, true), 'business_pro');
    assert.equal(normalizePlanTierInput('pro', undefined, true), 'personal_pro');
    assert.equal(normalizePlanTierInput('personal_pro', undefined, true), 'personal_pro');
    assert.equal(normalizePlanTierInput('business', undefined, false), 'free');

    const nowMs = 1_760_000_000_000;
    const summary = computeUserSubscriptionSummary({
      verifiedPro: {
        uid: 'u-1',
        isPro: true,
        proActive: true,
        planTier: 'business' as unknown as 'business_pro',
        proPlan: 'code',
        billingCycle: 'yearly',
        expiresAt: nowMs + 60 * SUBSCRIPTION_DAY_MS,
        verifiedAt: nowMs - 10 * SUBSCRIPTION_DAY_MS,
      },
      nowMs,
    });

    assert.equal(summary.isPro, true);
    assert.equal(summary.planTier, 'business_pro');
    assert.equal(summary.isBusinessPro, true);
    assert.equal(shouldShowPersonalUpgradeUi(summary), false);
    assert.equal(shouldShowBusinessUpgradeUi(summary), false);
    assert.equal(shouldShowAds(summary), false);
  });

  it('grants Admin lifetime Business PRO and suppresses all upgrade UI and ads', () => {
    const summary = computeUserSubscriptionSummary({
      verifiedPro: null,
      isAdminUser: true,
    });

    assert.equal(summary.isPro, true);
    assert.equal(summary.planTier, 'business_pro');
    assert.equal(summary.isBusinessPro, true);
    assert.equal(summary.billingCycle, 'lifetime');
    assert.equal(summary.isLifetime, true);
    assert.equal(summary.isAdminOverride, true);
    assert.equal(summary.isExpiringSoon, false);
    assert.equal(shouldShowPersonalUpgradeUi(summary), false);
    assert.equal(shouldShowBusinessUpgradeUi(summary), false);
    assert.equal(shouldShowAds(summary), false);
  });

  it('hides personal upgrade prompts for Personal PRO while allowing Business PRO upgrade', () => {
    const nowMs = 1_760_000_000_000;
    const summary = computeUserSubscriptionSummary({
      verifiedPro: {
        uid: 'u-2',
        isPro: true,
        proPlan: 'yearly',
        planTier: 'personal_pro',
        billingCycle: 'yearly',
        expiresAt: nowMs + 30 * SUBSCRIPTION_DAY_MS,
        verifiedAt: nowMs - 5 * SUBSCRIPTION_DAY_MS,
      },
      nowMs,
    });

    assert.equal(summary.isPro, true);
    assert.equal(summary.isBusinessPro, false);
    assert.equal(summary.daysRemaining, 30);
    assert.equal(summary.isExpiringSoon, false);
    assert.equal(shouldShowPersonalUpgradeUi(summary), false);
    assert.equal(shouldShowBusinessUpgradeUi(summary), true);
    assert.equal(shouldShowAds(summary), false);
  });

  it('flags 7-day subscription expiry alert only for non-lifetime active subscriptions <= 7 days', () => {
    const nowMs = 1_760_000_000_000;

    const eightDaysLeft = computeUserSubscriptionSummary({
      verifiedPro: {
        uid: 'u-3',
        isPro: true,
        planTier: 'personal_pro',
        proPlan: 'monthly',
        billingCycle: 'monthly',
        expiresAt: nowMs + 8 * SUBSCRIPTION_DAY_MS,
        verifiedAt: nowMs - 22 * SUBSCRIPTION_DAY_MS,
      },
      nowMs,
    });
    assert.equal(eightDaysLeft.daysRemaining, 8);
    assert.equal(eightDaysLeft.isExpiringSoon, false);

    const sevenDaysLeft = computeUserSubscriptionSummary({
      verifiedPro: {
        uid: 'u-3',
        isPro: true,
        planTier: 'personal_pro',
        proPlan: 'monthly',
        billingCycle: 'monthly',
        expiresAt: nowMs + 7 * SUBSCRIPTION_DAY_MS,
        verifiedAt: nowMs - 23 * SUBSCRIPTION_DAY_MS,
      },
      nowMs,
    });
    assert.equal(sevenDaysLeft.daysRemaining, 7);
    assert.equal(sevenDaysLeft.isExpiringSoon, true);

    const twoDaysLeftBiz = computeUserSubscriptionSummary({
      verifiedPro: {
        uid: 'u-4',
        isPro: true,
        planTier: 'business_pro',
        proPlan: 'business_monthly',
        billingCycle: 'monthly',
        expiresAt: nowMs + 2 * SUBSCRIPTION_DAY_MS,
        verifiedAt: nowMs - 28 * SUBSCRIPTION_DAY_MS,
      },
      nowMs,
    });
    assert.equal(twoDaysLeftBiz.daysRemaining, 2);
    assert.equal(twoDaysLeftBiz.isExpiringSoon, true);

    const lifetimeUser = computeUserSubscriptionSummary({
      verifiedPro: {
        uid: 'u-5',
        isPro: true,
        planTier: 'personal_pro',
        proPlan: 'lifetime',
        billingCycle: 'lifetime',
        expiresAt: null,
        verifiedAt: nowMs - 100 * SUBSCRIPTION_DAY_MS,
      },
      nowMs,
    });
    assert.equal(lifetimeUser.isLifetime, true);
    assert.equal(lifetimeUser.isExpiringSoon, false);
    assert.equal(lifetimeUser.daysRemaining, null);
  });

  it('treats expired subscription as free and marks isExpired = true', () => {
    const nowMs = 1_760_000_000_000;
    const summary = computeUserSubscriptionSummary({
      verifiedPro: {
        uid: 'u-6',
        isPro: true,
        planTier: 'personal_pro',
        proPlan: 'monthly',
        billingCycle: 'monthly',
        expiresAt: nowMs - 1000,
        verifiedAt: nowMs - 31 * SUBSCRIPTION_DAY_MS,
      },
      nowMs,
    });

    assert.equal(summary.isPro, false);
    assert.equal(summary.planTier, 'free');
    assert.equal(summary.isExpired, true);
    assert.equal(shouldShowPersonalUpgradeUi(summary), true);
    assert.equal(shouldShowAds(summary), true);
  });

  it('enforces Auth Gate -> Onboarding -> App stage transitions cleanly', () => {
    assert.equal(
      resolveAppEntryStage({
        isLoading: true,
        isAppLocked: false,
        isLoggedIn: false,
        isGuestMode: false,
        hasCompletedOnboarding: false,
      }),
      'loading'
    );
    assert.equal(
      resolveAppEntryStage({
        isLoading: false,
        isAppLocked: false,
        isLoggedIn: false,
        isGuestMode: false,
        hasCompletedOnboarding: false,
      }),
      'auth_gate'
    );
    assert.equal(
      resolveAppEntryStage({
        isLoading: false,
        isAppLocked: false,
        isLoggedIn: true,
        isGuestMode: false,
        hasCompletedOnboarding: false,
      }),
      'onboarding'
    );
    assert.equal(
      resolveAppEntryStage({
        isLoading: false,
        isAppLocked: false,
        isLoggedIn: false,
        isGuestMode: true,
        hasCompletedOnboarding: false,
      }),
      'onboarding'
    );
    assert.equal(
      resolveAppEntryStage({
        isLoading: false,
        isAppLocked: false,
        isLoggedIn: false,
        isGuestMode: true,
        hasCompletedOnboarding: true,
      }),
      'app'
    );
  });

  it('branches post-Google sign-in flow: restores cloud backup automatically or starts onboarding for fresh accounts', () => {
    assert.equal(
      resolvePostGoogleSignInAction({
        hasCloudBackup: true,
        wasActiveGuest: false,
        hasLocalOnboarding: false,
        localTransactionsCount: 0,
      }),
      'restore_cloud_and_enter'
    );
    assert.equal(
      resolvePostGoogleSignInAction({
        hasCloudBackup: false,
        wasActiveGuest: false,
        hasLocalOnboarding: false,
        localTransactionsCount: 0,
      }),
      'start_onboarding'
    );
    assert.equal(
      resolvePostGoogleSignInAction({
        hasCloudBackup: false,
        wasActiveGuest: true,
        hasLocalOnboarding: true,
        localTransactionsCount: 3,
      }),
      'preserve_local_session'
    );
  });
});
