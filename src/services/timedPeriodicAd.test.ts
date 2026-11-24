import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TIMED_AD_INITIAL_GRACE_MS,
  TIMED_AD_INTERVAL_MS,
  TIMED_AD_MAX_PER_SESSION,
  canTriggerTimedPeriodicAd,
  createTimedAdSessionState,
  dismissTimedPeriodicAd,
  openTimedPeriodicAd,
  shouldHideActiveTimedPeriodicAd,
  type TimedAdEligibilityInput,
} from './timedPeriodicAd';
import { computeUserSubscriptionSummary } from './subscriptionHelpers';
import { MONETAG_ZONE_ID } from './monetag';
import { REWARDED_AD_LINK_URL } from './raseediCredits';

const T0 = new Date(2026, 10, 24, 12, 0, 0).getTime();

function makeFreeEligibility(
  overrides: Partial<TimedAdEligibilityInput> = {}
): TimedAdEligibilityInput {
  const freeSummary = computeUserSubscriptionSummary({
    verifiedPro: null,
    isAdminUser: false,
    nowMs: T0,
  });
  return {
    subscriptionSummary: freeSummary,
    isProFlag: false,
    creditsAdFreeActive: false,
    activeOrgSubscriptionState: null,
    hasConsent: true,
    isOnline: true,
    isMainShellReady: true,
    isEntitlementResolved: true,
    hasBlockingModalOpen: false,
    isDocumentVisible: true,
    ...overrides,
  };
}

test('TimedPeriodicAd enforces 90s initial grace period, 4.5-minute cooldown interval, and max 3 impressions per session', () => {
  assert.equal(TIMED_AD_INITIAL_GRACE_MS, 90_000);
  assert.ok(
    TIMED_AD_INTERVAL_MS >= 240_000 && TIMED_AD_INTERVAL_MS <= 300_000,
    'Periodic interval must be between 4 and 5 minutes'
  );
  assert.equal(TIMED_AD_MAX_PER_SESSION, 3);

  const eligibility = makeFreeEligibility();
  let state = createTimedAdSessionState(T0);

  // Before 90s grace period -> strictly blocked
  const at0 = canTriggerTimedPeriodicAd(state, eligibility, T0);
  assert.equal(at0.eligible, false);
  assert.equal(at0.reason, 'grace_period');
  assert.equal(at0.nextCheckInMs, 90_000);

  const at89 = canTriggerTimedPeriodicAd(state, eligibility, T0 + 89_000);
  assert.equal(at89.eligible, false);
  assert.equal(at89.reason, 'grace_period');
  assert.equal(at89.nextCheckInMs, 1_000);

  // At 90s -> impression #1 ready!
  const at90 = canTriggerTimedPeriodicAd(state, eligibility, T0 + 90_000);
  assert.equal(at90.eligible, true);
  assert.equal(at90.reason, 'ready');

  state = openTimedPeriodicAd(state, T0 + 90_000);
  assert.equal(state.isVisible, true);
  assert.equal(state.shownCount, 1);

  // While visible, cannot trigger another impression
  const whileOpen = canTriggerTimedPeriodicAd(state, eligibility, T0 + 95_000);
  assert.equal(whileOpen.eligible, false);
  assert.equal(whileOpen.reason, 'already_visible');

  // Dismiss impression #1 at T0 + 100s
  const dismiss1At = T0 + 100_000;
  state = dismissTimedPeriodicAd(state, dismiss1At);
  assert.equal(state.isVisible, false);

  // Immediately after dismissal or 3 minutes later -> still in 4.5m cooldown interval
  const at3m = canTriggerTimedPeriodicAd(state, eligibility, dismiss1At + 180_000);
  assert.equal(at3m.eligible, false);
  assert.equal(at3m.reason, 'cooldown_interval');
  assert.equal(at3m.nextCheckInMs, TIMED_AD_INTERVAL_MS - 180_000);

  // After 4.5 minutes -> impression #2 ready!
  const t2 = dismiss1At + TIMED_AD_INTERVAL_MS;
  assert.equal(canTriggerTimedPeriodicAd(state, eligibility, t2).eligible, true);
  state = openTimedPeriodicAd(state, t2);
  assert.equal(state.shownCount, 2);
  state = dismissTimedPeriodicAd(state, t2 + 5_000);

  // After another 4.5 minutes -> impression #3 ready!
  const t3 = t2 + 5_000 + TIMED_AD_INTERVAL_MS;
  assert.equal(canTriggerTimedPeriodicAd(state, eligibility, t3).eligible, true);
  state = openTimedPeriodicAd(state, t3);
  assert.equal(state.shownCount, 3);
  state = dismissTimedPeriodicAd(state, t3 + 5_000);

  // 4th impression in same session MUST be permanently blocked even hours later!
  const afterCap = canTriggerTimedPeriodicAd(
    state,
    eligibility,
    t3 + 5_000 + TIMED_AD_INTERVAL_MS * 10
  );
  assert.equal(afterCap.eligible, false);
  assert.equal(afterCap.reason, 'session_cap_reached');
  assert.equal(afterCap.remainingInSession, 0);
});

test('TimedPeriodicAd never triggers while a modal/TransactionModal is open or tab is hidden, and immediately hides active ad when a modal opens', () => {
  const state = createTimedAdSessionState(T0);
  const afterGrace = T0 + TIMED_AD_INITIAL_GRACE_MS + 1_000;

  // Blocked while TransactionModal or any modal is open
  const withModalOpen = makeFreeEligibility({ hasBlockingModalOpen: true });
  const modalEval = canTriggerTimedPeriodicAd(state, withModalOpen, afterGrace);
  assert.equal(modalEval.eligible, false);
  assert.equal(modalEval.reason, 'modal_open');

  // Blocked while document is hidden
  const hiddenTab = makeFreeEligibility({ isDocumentVisible: false });
  const hiddenEval = canTriggerTimedPeriodicAd(state, hiddenTab, afterGrace);
  assert.equal(hiddenEval.eligible, false);
  assert.equal(hiddenEval.reason, 'document_hidden');

  // When an ad is visible and the user taps '+' to open TransactionModal -> MUST hide immediately
  assert.equal(shouldHideActiveTimedPeriodicAd(withModalOpen), true);
  assert.equal(shouldHideActiveTimedPeriodicAd(makeFreeEligibility()), false);
});

test('TimedPeriodicAd is strictly blocked for PRO, Business, Admin, Active Paid/Trial Organizations, 24h PRO Pass, and 24h Ad-Free Pass', () => {
  const state = createTimedAdSessionState(T0);
  const afterGrace = T0 + TIMED_AD_INITIAL_GRACE_MS + 5_000;

  // 1. Personal PRO
  const proSummary = computeUserSubscriptionSummary({
    verifiedPro: {
      isPro: true,
      planTier: 'personal_pro',
      billingCycle: 'monthly',
      expiresAt: T0 + 30 * 86400_000,
    },
    nowMs: T0,
  });
  const proEval = canTriggerTimedPeriodicAd(
    state,
    makeFreeEligibility({ subscriptionSummary: proSummary, isProFlag: true }),
    afterGrace
  );
  assert.equal(proEval.eligible, false);
  assert.equal(proEval.reason, 'ineligible_user_or_env');
  assert.equal(
    shouldHideActiveTimedPeriodicAd(
      makeFreeEligibility({ subscriptionSummary: proSummary, isProFlag: true })
    ),
    true
  );

  // 2. Business PRO
  const businessSummary = computeUserSubscriptionSummary({
    verifiedPro: {
      isPro: true,
      planTier: 'business_pro',
      billingCycle: 'yearly',
      expiresAt: T0 + 365 * 86400_000,
    },
    nowMs: T0,
  });
  assert.equal(
    canTriggerTimedPeriodicAd(
      state,
      makeFreeEligibility({ subscriptionSummary: businessSummary, isProFlag: true }),
      afterGrace
    ).eligible,
    false
  );

  // 3. Admin override
  const adminSummary = computeUserSubscriptionSummary({
    verifiedPro: null,
    isAdminUser: true,
    nowMs: T0,
  });
  assert.equal(
    canTriggerTimedPeriodicAd(
      state,
      makeFreeEligibility({ subscriptionSummary: adminSummary }),
      afterGrace
    ).eligible,
    false
  );

  // 4. Active Paid / Trial Organization workspace
  assert.equal(
    canTriggerTimedPeriodicAd(
      state,
      makeFreeEligibility({
        activeOrgSubscriptionState: {
          planTier: 'business_pro',
          isReadOnly: false,
          status: 'active',
        },
      }),
      afterGrace
    ).eligible,
    false
  );
  assert.equal(
    canTriggerTimedPeriodicAd(
      state,
      makeFreeEligibility({
        activeOrgSubscriptionState: {
          planTier: 'business_pro',
          isReadOnly: false,
          status: 'trial',
        },
      }),
      afterGrace
    ).eligible,
    false
  );

  // 5. Expired / Read-only Organization falls back to Free eligibility
  assert.equal(
    canTriggerTimedPeriodicAd(
      state,
      makeFreeEligibility({
        activeOrgSubscriptionState: {
          planTier: 'business_pro',
          isReadOnly: true,
          status: 'expired',
        },
      }),
      afterGrace
    ).eligible,
    true
  );

  // 6. 24h Credits Ad-Free Pass
  assert.equal(
    canTriggerTimedPeriodicAd(
      state,
      makeFreeEligibility({ creditsAdFreeActive: true }),
      afterGrace
    ).eligible,
    false
  );

  // 7. 24h Credits PRO Pass (isProFlag true while credits pass active)
  const creditsProPass = computeUserSubscriptionSummary({
    verifiedPro: {
      isPro: true,
      planTier: 'personal_pro',
      billingCycle: 'monthly',
      expiresAt: T0 + 12 * 3600_000,
    },
    nowMs: T0,
  });
  assert.equal(
    canTriggerTimedPeriodicAd(
      state,
      makeFreeEligibility({ subscriptionSummary: creditsProPass, isProFlag: true }),
      afterGrace
    ).eligible,
    false
  );

  // 8. Offline, no consent, Splash/AuthGate, or unresolved entitlement
  assert.equal(
    canTriggerTimedPeriodicAd(state, makeFreeEligibility({ isOnline: false }), afterGrace).eligible,
    false
  );
  assert.equal(
    canTriggerTimedPeriodicAd(state, makeFreeEligibility({ hasConsent: false }), afterGrace).eligible,
    false
  );
  assert.equal(
    canTriggerTimedPeriodicAd(state, makeFreeEligibility({ isMainShellReady: false }), afterGrace)
      .eligible,
    false
  );
  assert.equal(
    canTriggerTimedPeriodicAd(
      state,
      makeFreeEligibility({ isEntitlementResolved: false }),
      afterGrace
    ).eligible,
    false
  );
});

test('TimedPeriodicAd component & App integration enforce fast close button, BottomNav clearance, RTL hygiene, modal suppression, and Monetag zone wiring', () => {
  const componentSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/common/TimedPeriodicAd.tsx'),
    'utf8'
  );
  const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

  // Component checks
  assert.ok(componentSrc.includes('data-testid="timed-ad-close-btn"'));
  assert.ok(componentSrc.includes('bottom-[calc(5.25rem+env(safe-area-inset-bottom))]'));
  assert.ok(componentSrc.includes('MONETAG_ZONE_ID'));
  assert.ok(componentSrc.includes('REWARDED_AD_LINK_URL'));
  assert.equal(MONETAG_ZONE_ID, '12339417');
  assert.equal(REWARDED_AD_LINK_URL, 'https://uplcm.com/4/12339410');
  assert.ok(
    !/tracking-(wide|wider|widest|\[)/.test(componentSrc),
    'RTL letter-spacing rule: TimedPeriodicAd must never use wide tracking utilities'
  );

  // App.tsx wiring checks
  assert.ok(appSrc.includes('<TimedPeriodicAd'));
  assert.ok(appSrc.includes('hasBlockingModalOpen={Boolean('));
  assert.ok(appSrc.includes('isAddModalOpen ||'));
  assert.ok(appSrc.includes('isRewardedAdModalOpen ||'));
});
