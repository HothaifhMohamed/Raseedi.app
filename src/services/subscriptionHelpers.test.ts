import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSubscriptionDatesUpdate,
  computeAdminDirectSubscriptionPayload,
  computeUserSubscriptionSummary,
  normalizePlanTierInput,
  resolveAppEntryStage,
  resolvePostGoogleSignInAction,
  shouldShowAds,
  shouldShowBusinessUpgradeUi,
  shouldShowPersonalUpgradeUi,
  shouldShowUpgradeActionButtons,
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
    assert.equal(shouldShowUpgradeActionButtons(summary), true);
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
    assert.equal(shouldShowUpgradeActionButtons(summary), false);
  });

  it('hides Renew and Change Plan buttons for Business PRO + Lifetime subscribers', () => {
    const nowMs = 1_760_000_000_000;
    const businessLifetime = computeUserSubscriptionSummary({
      verifiedPro: {
        uid: 'u-biz-life',
        isPro: true,
        proActive: true,
        planTier: 'business_pro',
        proPlan: 'code',
        billingCycle: 'lifetime',
        expiresAt: null,
        verifiedAt: nowMs - 15 * SUBSCRIPTION_DAY_MS,
      },
      nowMs,
    });

    assert.equal(businessLifetime.isBusinessPro, true);
    assert.equal(businessLifetime.isLifetime, true);
    assert.equal(shouldShowUpgradeActionButtons(businessLifetime), false);

    // Personal Lifetime CAN still upgrade/switch to Business PRO
    const personalLifetime = computeUserSubscriptionSummary({
      verifiedPro: {
        uid: 'u-per-life',
        isPro: true,
        proActive: true,
        planTier: 'personal_pro',
        proPlan: 'lifetime',
        billingCycle: 'lifetime',
        expiresAt: null,
        verifiedAt: nowMs - 15 * SUBSCRIPTION_DAY_MS,
      },
      nowMs,
    });
    assert.equal(shouldShowUpgradeActionButtons(personalLifetime), true);
  });

  it('stacks duration cumulatively when renewing the same active tier', () => {
    const nowMs = 1_760_000_000_000;
    const existingExpiry = nowMs + 12 * SUBSCRIPTION_DAY_MS;
    const result = calculateSubscriptionDatesUpdate({
      currentTier: 'personal_pro',
      currentExpiresAt: existingExpiry,
      currentBillingCycle: 'monthly',
      currentIsPro: true,
      newTier: 'personal_pro',
      newCycle: 'monthly',
      nowMs,
    });

    assert.equal(result.actionMode, 'cumulative_renewal');
    assert.equal(result.isCumulativeRenewal, true);
    assert.equal(result.isPlanSwitch, false);
    assert.equal(result.shouldWarnForfeiture, false);
    assert.equal(result.baseMs, existingExpiry);
    assert.equal(result.expiresAt, existingExpiry + 30 * SUBSCRIPTION_DAY_MS);
  });

  it('flags plan switch warning and resets expiry to nowMs when switching to a different tier with remaining days', () => {
    const nowMs = 1_760_000_000_000;
    const existingExpiry = nowMs + 18 * SUBSCRIPTION_DAY_MS;
    const result = calculateSubscriptionDatesUpdate({
      currentTier: 'personal_pro',
      currentExpiresAt: existingExpiry,
      currentBillingCycle: 'monthly',
      currentIsPro: true,
      newTier: 'business_pro',
      newCycle: 'yearly',
      nowMs,
    });

    assert.equal(result.actionMode, 'plan_switch');
    assert.equal(result.isCumulativeRenewal, false);
    assert.equal(result.isPlanSwitch, true);
    assert.equal(result.shouldWarnForfeiture, true);
    assert.equal(result.replacedDaysRemaining, 18);
    assert.equal(result.replacedIsLifetime, false);
    assert.equal(result.baseMs, nowMs);
    assert.equal(result.expiresAt, nowMs + 365 * SUBSCRIPTION_DAY_MS);
  });

  it('builds Admin direct edit and cancel payloads cleanly', () => {
    const nowMs = 1_760_000_000_000;
    const bizMonthly = computeAdminDirectSubscriptionPayload({
      planTier: 'business_pro',
      billingCycle: 'monthly',
      nowMs,
    });
    assert.equal(bizMonthly.isPro, true);
    assert.equal(bizMonthly.proActive, true);
    assert.equal(bizMonthly.planTier, 'business_pro');
    assert.equal(bizMonthly.proPlan, 'business_monthly');
    assert.equal(bizMonthly.expiresAt, nowMs + 30 * SUBSCRIPTION_DAY_MS);

    const cancelled = computeAdminDirectSubscriptionPayload({
      planTier: 'free',
      billingCycle: 'free',
      nowMs,
    });
    assert.equal(cancelled.isPro, false);
    assert.equal(cancelled.proActive, false);
    assert.equal(cancelled.planTier, 'free');
    assert.equal(cancelled.proPlan, 'free');
    assert.equal(cancelled.expiresAt, null);
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
