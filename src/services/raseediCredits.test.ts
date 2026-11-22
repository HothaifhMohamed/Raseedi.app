import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADSTERRA_SMARTLINK_URL,
  CREDITS_24H_MS,
  CREDITS_AD_COOLDOWN_MS,
  CREDITS_AD_COUNTDOWN_MS,
  CREDITS_AD_MAX_TICK_DELTA_MS,
  CREDITS_AD_REWARD,
  CREDITS_DAILY_AD_LIMIT,
  CREDITS_STREAK_3_REWARD,
  CREDITS_STREAK_7_REWARD,
  CREDITS_WELCOME_BONUS,
  advanceRewardedAdSession,
  claimRewardedAdReward,
  consumeBonusReceiptScan,
  consumeExportPass,
  createInitialCreditsState,
  evaluateDailyStreak,
  getRewardedAdAvailability,
  getRewardedAdRemainingMs,
  isAdFreePassActive,
  isProPassActive,
  mergeRaseediCreditsStates,
  recordRewardedAdOpenAttempt,
  redeemCredits,
  shouldShowRaseediCreditsUi,
  startRewardedAdSession,
} from './raseediCredits';
import { computeUserSubscriptionSummary, shouldShowAds } from './subscriptionHelpers';
import { buildCspDirectives } from './serverSecurity';

const BASE_DAY_1 = new Date(2026, 10, 22, 10, 0, 0).getTime(); // 2026-11-22 10:00 local

test('Smartlink URL and initial welcome bonus (15 credits once) match exact specification', () => {
  assert.equal(
    ADSTERRA_SMARTLINK_URL,
    'https://araplhn.org/4/68b50cb65897ac345cf0ff99a6ac732a'
  );

  const initial = createInitialCreditsState(BASE_DAY_1);
  assert.equal(initial.balance, CREDITS_WELCOME_BONUS);
  assert.equal(initial.balance, 15);
  assert.equal(initial.welcomeBonusClaimed, true);
  assert.equal(initial.streakCount, 1);
  assert.equal(initial.ledger.length, 1);
  assert.equal(initial.ledger[0].type, 'welcome');
  assert.equal(initial.ledger[0].delta, 15);
});

test('Rewarded ad requires 10s countdown, awards +10, enforces 60s cooldown, 5/day cap, resets next local day, and resists backward clock tampering', () => {
  let state = createInitialCreditsState(BASE_DAY_1);
  let now = BASE_DAY_1;

  // Start ad #1
  const s1 = startRewardedAdSession(state, now, { isOnline: true, openAttempted: true });
  assert.equal(s1.ok, true);
  if (!s1.ok) return;

  // Advance only 5 active seconds -> trying to claim MUST fail
  let activeS1 = s1.session;
  for (let sec = 0; sec < 5; sec++) {
    activeS1 = advanceRewardedAdSession(activeS1, {
      deltaMs: 1000,
      isVisibleAndFocused: true,
      isOnline: true,
    });
  }
  const earlyClaim = claimRewardedAdReward(state, activeS1, now + 5000, { isOnline: true });
  assert.equal(earlyClaim.ok, false);
  if (!earlyClaim.ok) {
    assert.equal(earlyClaim.reason, 'countdown_incomplete');
    assert.equal(earlyClaim.remainingCountdownMs, 5000);
  }

  // Advance remaining 5 active seconds -> claiming succeeds (+10 -> 25)
  for (let sec = 0; sec < 5; sec++) {
    activeS1 = advanceRewardedAdSession(activeS1, {
      deltaMs: 1000,
      isVisibleAndFocused: true,
      isOnline: true,
    });
  }
  now += CREDITS_AD_COUNTDOWN_MS;
  const claim1 = claimRewardedAdReward(state, activeS1, now, { isOnline: true });
  assert.equal(claim1.ok, true);
  if (!claim1.ok) return;
  state = claim1.state;
  assert.equal(claim1.awarded, CREDITS_AD_REWARD);
  assert.equal(state.balance, 25);
  assert.equal(state.adsWatchedToday, 1);
  assert.equal(state.ledger[0].type, 'ad_reward');

  // Re-claiming same session (rapid double-click) MUST fail once marked claimed
  const dupClaim = claimRewardedAdReward(
    state,
    { ...activeS1, claimed: true },
    now + 100,
    { isOnline: true }
  );
  assert.equal(dupClaim.ok, false);

  // Cooldown (60s) blocks immediate second watch
  const duringCooldown = startRewardedAdSession(state, now + 30_000, { isOnline: true });
  assert.equal(duringCooldown.ok, false);
  if (!duringCooldown.ok) {
    assert.equal(duringCooldown.reason, 'cooldown');
    assert.equal(duringCooldown.availability.cooldownRemainingSeconds, 30);
  }

  // Backward clock tampering MUST NOT bypass cooldown!
  const clockRolledBack = startRewardedAdSession(state, now - 120_000, { isOnline: true });
  assert.equal(clockRolledBack.ok, false);
  if (!clockRolledBack.ok) {
    assert.equal(clockRolledBack.reason, 'cooldown');
  }

  // Complete remaining 4 ads today (total 5)
  for (let i = 2; i <= CREDITS_DAILY_AD_LIMIT; i++) {
    now += CREDITS_AD_COOLDOWN_MS + 1000;
    const started = startRewardedAdSession(state, now, { isOnline: true, openAttempted: true });
    assert.equal(started.ok, true, `Ad #${i} should be allowed after cooldown`);
    if (!started.ok) return;
    let sess = started.session;
    for (let sec = 0; sec < 10; sec++) {
      sess = advanceRewardedAdSession(sess, {
        deltaMs: 1000,
        isVisibleAndFocused: true,
        isOnline: true,
      });
    }
    now += CREDITS_AD_COUNTDOWN_MS;
    const claimed = claimRewardedAdReward(state, sess, now, { isOnline: true });
    assert.equal(claimed.ok, true);
    if (!claimed.ok) return;
    state = claimed.state;
  }

  assert.equal(state.adsWatchedToday, 5);
  assert.equal(state.balance, 15 + 5 * 10);

  // 6th ad on the same local day MUST be blocked even after cooldown
  now += CREDITS_AD_COOLDOWN_MS * 2;
  const blocked6 = startRewardedAdSession(state, now, { isOnline: true });
  assert.equal(blocked6.ok, false);
  if (!blocked6.ok) {
    assert.equal(blocked6.reason, 'daily_limit');
    assert.equal(blocked6.availability.remainingToday, 0);
  }

  // Rolling system clock backward to yesterday MUST NOT reset daily limit
  const yesterdayTamper = getRewardedAdAvailability(state, BASE_DAY_1 - CREDITS_24H_MS);
  assert.equal(yesterdayTamper.canWatch, false);
  assert.equal(yesterdayTamper.reason, 'daily_limit');

  // Advancing to next local calendar day resets daily limit to 0/5 automatically
  const tomorrowMs = new Date(2026, 10, 23, 9, 0, 0).getTime();
  const tomorrowAvail = getRewardedAdAvailability(state, tomorrowMs);
  assert.equal(tomorrowAvail.canWatch, true);
  assert.equal(tomorrowAvail.watchedToday, 0);
  assert.equal(tomorrowAvail.remainingToday, 5);
});

test('Rewarded ad countdown pauses on background/blur, clamps large tick bursts, blocks when offline, and requires verified Smartlink open attempt', () => {
  const state = createInitialCreditsState(BASE_DAY_1);

  // 1. Offline start is strictly blocked
  const offlineStart = startRewardedAdSession(state, BASE_DAY_1, { isOnline: false });
  assert.equal(offlineStart.ok, false);
  if (!offlineStart.ok) {
    assert.equal(offlineStart.reason, 'offline');
  }

  // 2. Starting with unverified open attempt prevents progress & claiming until openAttempted=true
  const unverifiedStart = startRewardedAdSession(state, BASE_DAY_1, {
    isOnline: true,
    openAttempted: false,
  });
  assert.equal(unverifiedStart.ok, true);
  if (!unverifiedStart.ok) return;

  let sess = unverifiedStart.session;
  assert.equal(sess.pauseReason, 'open_blocked');
  sess = advanceRewardedAdSession(sess, {
    deltaMs: 1000,
    isVisibleAndFocused: true,
    isOnline: true,
  });
  assert.equal(sess.activeElapsedMs, 0);

  const blockedClaim = claimRewardedAdReward(state, sess, BASE_DAY_1 + 15_000, { isOnline: true });
  assert.equal(blockedClaim.ok, false);
  if (!blockedClaim.ok) {
    assert.equal(blockedClaim.reason, 'open_not_verified');
  }

  // Reopening link while online verifies open attempt
  sess = recordRewardedAdOpenAttempt(sess, { succeeded: true, isOnline: true });
  assert.equal(sess.openAttempted, true);
  assert.equal(sess.pauseReason, 'none');

  // 3. Background / blur pauses countdown and adds 0ms
  sess = advanceRewardedAdSession(sess, {
    deltaMs: 1000,
    isVisibleAndFocused: true,
    isOnline: true,
  });
  assert.equal(sess.activeElapsedMs, 1000);

  sess = advanceRewardedAdSession(sess, {
    deltaMs: 5000,
    isVisibleAndFocused: false,
    isOnline: true,
  });
  assert.equal(sess.pauseReason, 'background');
  assert.equal(sess.activeElapsedMs, 1000);

  // 4. Returning with a huge throttled deltaMs (e.g. 30s) is clamped to CREDITS_AD_MAX_TICK_DELTA_MS (1000ms)
  sess = advanceRewardedAdSession(sess, {
    deltaMs: 30_000,
    isVisibleAndFocused: true,
    isOnline: true,
  });
  assert.equal(sess.pauseReason, 'none');
  assert.equal(sess.activeElapsedMs, 1000 + CREDITS_AD_MAX_TICK_DELTA_MS);

  // 5. Going offline during countdown pauses and adds 0ms
  sess = advanceRewardedAdSession(sess, {
    deltaMs: 1000,
    isVisibleAndFocused: true,
    isOnline: false,
  });
  assert.equal(sess.pauseReason, 'offline');
  assert.equal(sess.activeElapsedMs, 2000);

  // Finish remaining 8 active seconds while online & focused
  for (let i = 0; i < 8; i++) {
    sess = advanceRewardedAdSession(sess, {
      deltaMs: 1000,
      isVisibleAndFocused: true,
      isOnline: true,
    });
  }
  assert.equal(getRewardedAdRemainingMs(sess), 0);

  // 6. Trying to claim while offline is strictly rejected even after 10s elapsed!
  const offlineClaim = claimRewardedAdReward(state, sess, BASE_DAY_1 + 20_000, {
    isOnline: false,
  });
  assert.equal(offlineClaim.ok, false);
  if (!offlineClaim.ok) {
    assert.equal(offlineClaim.reason, 'offline');
  }

  // 7. Claiming online with verified open attempt + 10s active countdown succeeds
  const onlineClaim = claimRewardedAdReward(state, sess, BASE_DAY_1 + 21_000, {
    isOnline: true,
  });
  assert.equal(onlineClaim.ok, true);
  if (onlineClaim.ok) {
    assert.equal(onlineClaim.state.balance, 25);
  }
});

test('Daily consecutive login streak awards +5 on Day 3 and +15 on Day 7 without double-claiming, and resets on missed day', () => {
  let state = createInitialCreditsState(BASE_DAY_1);

  // Same day login -> no change
  const sameDay = evaluateDailyStreak(state, BASE_DAY_1 + 3600_000);
  assert.equal(sameDay.rewardAwarded, 0);
  assert.equal(sameDay.state.streakCount, 1);

  // Day 2 -> streak 2, no reward yet
  const d2 = evaluateDailyStreak(sameDay.state, new Date(2026, 10, 23, 10, 0, 0).getTime());
  assert.equal(d2.state.streakCount, 2);
  assert.equal(d2.rewardAwarded, 0);

  // Day 3 -> streak 3, +5 bonus!
  const d3 = evaluateDailyStreak(d2.state, new Date(2026, 10, 24, 10, 0, 0).getTime());
  assert.equal(d3.state.streakCount, 3);
  assert.equal(d3.rewardAwarded, CREDITS_STREAK_3_REWARD);
  assert.equal(d3.milestoneHit, 3);
  assert.equal(d3.state.balance, 20);

  // Re-evaluating same Day 3 -> zero duplicate reward
  const d3Again = evaluateDailyStreak(d3.state, new Date(2026, 10, 24, 18, 0, 0).getTime());
  assert.equal(d3Again.rewardAwarded, 0);
  assert.equal(d3Again.state.balance, 20);

  // Days 4, 5, 6 -> no milestone yet
  const d4 = evaluateDailyStreak(d3Again.state, new Date(2026, 10, 25, 10, 0, 0).getTime());
  const d5 = evaluateDailyStreak(d4.state, new Date(2026, 10, 26, 10, 0, 0).getTime());
  const d6 = evaluateDailyStreak(d5.state, new Date(2026, 10, 27, 10, 0, 0).getTime());
  assert.equal(d6.state.streakCount, 6);
  assert.equal(d6.state.balance, 20);

  // Day 7 -> streak 7, +15 bonus!
  const d7 = evaluateDailyStreak(d6.state, new Date(2026, 10, 28, 10, 0, 0).getTime());
  assert.equal(d7.state.streakCount, 7);
  assert.equal(d7.rewardAwarded, CREDITS_STREAK_7_REWARD);
  assert.equal(d7.milestoneHit, 7);
  assert.equal(d7.state.balance, 35);

  // Missing a day (jumping from Nov 28 to Nov 30) resets streak to Day 1
  const missed = evaluateDailyStreak(d7.state, new Date(2026, 10, 30, 10, 0, 0).getTime());
  assert.equal(missed.state.streakCount, 1);
  assert.equal(missed.rewardAwarded, 0);
});

test('All 4 redemption options deduct exact credits, grant exact entitlements, consume passes, and expire after 24h', () => {
  let state = { ...createInitialCreditsState(BASE_DAY_1), balance: 100 };

  // 1. AI Receipt Scans (+2 scans for 10 credits)
  const rScans = redeemCredits(state, 'ai_scans_2', BASE_DAY_1);
  assert.equal(rScans.ok, true);
  if (!rScans.ok) return;
  state = rScans.state;
  assert.equal(state.balance, 90);
  assert.equal(state.bonusReceiptScans, 2);
  const usedScan = consumeBonusReceiptScan(state, BASE_DAY_1 + 1000);
  assert.equal(usedScan.ok, true);
  if (!usedScan.ok) return;
  state = usedScan.state;
  assert.equal(state.bonusReceiptScans, 1);

  // 2. Pro Report Export (1 pass for 15 credits)
  const rExport = redeemCredits(state, 'export_report_1', BASE_DAY_1 + 2000);
  assert.equal(rExport.ok, true);
  if (!rExport.ok) return;
  state = rExport.state;
  assert.equal(state.balance, 75);
  assert.equal(state.exportPasses, 1);
  const usedExport = consumeExportPass(state, BASE_DAY_1 + 3000);
  assert.equal(usedExport.ok, true);
  if (!usedExport.ok) return;
  state = usedExport.state;
  assert.equal(state.exportPasses, 0);

  // 3. 24h Ad-Free Quiet Focus Mode (25 credits)
  const rAdFree = redeemCredits(state, 'ad_free_24h', BASE_DAY_1 + 4000);
  assert.equal(rAdFree.ok, true);
  if (!rAdFree.ok) return;
  state = rAdFree.state;
  assert.equal(state.balance, 50);
  assert.equal(isAdFreePassActive(state, BASE_DAY_1 + 5000), true);
  assert.equal(isProPassActive(state, BASE_DAY_1 + 5000), false);
  assert.equal(isAdFreePassActive(state, BASE_DAY_1 + 4000 + CREDITS_24H_MS + 1), false);

  // 4. 24h Full PRO Pass (50 credits)
  const rPro = redeemCredits(state, 'pro_pass_24h', BASE_DAY_1 + 6000);
  assert.equal(rPro.ok, true);
  if (!rPro.ok) return;
  state = rPro.state;
  assert.equal(state.balance, 0);
  assert.equal(isProPassActive(state, BASE_DAY_1 + 7000), true);
  assert.equal(isAdFreePassActive(state, BASE_DAY_1 + 7000), true);
  assert.equal(isProPassActive(state, BASE_DAY_1 + 6000 + CREDITS_24H_MS + 1), false);

  // Insufficient balance rejection
  const failRedeem = redeemCredits(state, 'ai_scans_2', BASE_DAY_1 + 8000);
  assert.equal(failRedeem.ok, false);
  if (!failRedeem.ok) {
    assert.equal(failRedeem.reason, 'insufficient_balance');
    assert.equal(failRedeem.needed, 10);
  }
});

test('Paid PRO, Business PRO, Admin, and Active Org users never see Raseedi Credits UI or ads, and 24h Ad-Free pass suppresses banners', () => {
  const freeSummary = computeUserSubscriptionSummary({ verifiedPro: null });
  const proSummary = computeUserSubscriptionSummary({
    verifiedPro: {
      uid: 'u-pro',
      isPro: true,
      proActive: true,
      planTier: 'personal_pro',
      proPlan: 'monthly',
      billingCycle: 'monthly',
      expiresAt: Date.now() + 30 * 86400000,
    },
  });
  const bizSummary = computeUserSubscriptionSummary({
    verifiedPro: {
      uid: 'u-biz',
      isPro: true,
      proActive: true,
      planTier: 'business_pro',
      proPlan: 'business_yearly',
      billingCycle: 'yearly',
      expiresAt: Date.now() + 365 * 86400000,
    },
  });
  const adminSummary = computeUserSubscriptionSummary({ verifiedPro: null, isAdminUser: true });

  // Eligible free user
  assert.equal(shouldShowRaseediCreditsUi(freeSummary), true);

  // Paid / Admin / Active Paid Org -> strictly hidden!
  assert.equal(shouldShowRaseediCreditsUi(proSummary), false);
  assert.equal(shouldShowRaseediCreditsUi(bizSummary), false);
  assert.equal(shouldShowRaseediCreditsUi(adminSummary), false);
  assert.equal(
    shouldShowRaseediCreditsUi(freeSummary, {
      activeOrgSubscriptionState: { planTier: 'business_pro', status: 'active', isReadOnly: false },
    }),
    false
  );

  // Free user with active 24h Ad-Free Focus Mode -> ads strictly hidden
  assert.equal(shouldShowAds(freeSummary, { creditsAdFreeActive: true }), false);
  assert.equal(shouldShowAds(freeSummary, { creditsAdFreeActive: false }), true);
});

test('mergeRaseediCreditsStates preserves monotonic high-water mark and latest ad usage across cloud sync', () => {
  const local = {
    ...createInitialCreditsState(BASE_DAY_1),
    balance: 35,
    adsWatchedToday: 3,
    lastAdClaimAtMs: BASE_DAY_1 + 200_000,
    maxObservedNowMs: BASE_DAY_1 + 250_000,
    updatedAtMs: BASE_DAY_1 + 250_000,
  };
  const olderCloud = {
    ...createInitialCreditsState(BASE_DAY_1),
    balance: 15,
    adsWatchedToday: 1,
    lastAdClaimAtMs: BASE_DAY_1 + 50_000,
    maxObservedNowMs: BASE_DAY_1 + 50_000,
    updatedAtMs: BASE_DAY_1 + 50_000,
  };

  const merged = mergeRaseediCreditsStates(local, olderCloud, BASE_DAY_1 + 250_000);
  assert.equal(merged.balance, 35);
  assert.equal(merged.adsWatchedToday, 3);
  assert.equal(merged.maxObservedNowMs, BASE_DAY_1 + 250_000);
});

test('CSP directives in serverSecurity.ts and vercel.json allow https://araplhn.org safely without weakening frame-ancestors', () => {
  const prod = buildCspDirectives({ isProduction: true, allowPreviewFraming: false });
  assert.equal(prod.scriptSrc.includes('https://araplhn.org'), true);
  assert.equal(prod.connectSrc.includes('https://araplhn.org'), true);
  assert.equal(prod.frameSrc.includes('https://araplhn.org'), true);
  assert.equal(prod.imgSrc.includes('https://araplhn.org'), true);
  assert.deepEqual(prod.frameAncestors, ["'self'"]);
  assert.equal(prod.connectSrc.includes('ws:'), false);

  const vercelJsonPath = path.resolve(process.cwd(), 'vercel.json');
  const vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8')) as {
    headers?: Array<{ headers?: Array<{ key: string; value: string }> }>;
  };
  const cspHeader = vercelConfig.headers
    ?.flatMap((rule) => rule.headers || [])
    .find((h) => h.key === 'Content-Security-Policy');

  assert.ok(cspHeader);
  assert.ok(cspHeader.value.includes("frame-ancestors 'self'"));
  assert.ok(cspHeader.value.includes('https://araplhn.org'));
  assert.ok(cspHeader.value.includes('https://*.araplhn.org'));
});
