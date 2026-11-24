import {
  shouldLoadMonetagZone,
  type ResolveMonetagEligibilityParams,
} from './monetag';

/**
 * Initial grace period after entering the main app shell before the first
 * timed/periodic ad may appear (90 seconds).
 */
export const TIMED_AD_INITIAL_GRACE_MS = 90_000;

/**
 * Minimum periodic interval after closing a timed ad before the next one
 * may appear (4.5 minutes = 270 seconds — strictly within the 4–5 minute policy).
 */
export const TIMED_AD_INTERVAL_MS = 270_000;

/**
 * Hard cap on timed/periodic ad impressions per browser session so Free users
 * are never spammed.
 */
export const TIMED_AD_MAX_PER_SESSION = 3;

export interface TimedAdSessionState {
  sessionStartedAtMs: number;
  shownCount: number;
  isVisible: boolean;
  lastShownAtMs: number | null;
  lastDismissedAtMs: number | null;
  activeImpressionId: string | null;
}

export interface TimedAdEligibilityInput extends ResolveMonetagEligibilityParams {
  /** True while TransactionModal or any active modal/dialog is open (strictly blocks timed ads). */
  hasBlockingModalOpen: boolean;
  /** True only while document is visible (never opens unseen in a background tab). */
  isDocumentVisible: boolean;
}

export type TimedAdBlockReason =
  | 'ready'
  | 'ineligible_user_or_env'
  | 'modal_open'
  | 'document_hidden'
  | 'already_visible'
  | 'session_cap_reached'
  | 'grace_period'
  | 'cooldown_interval';

export interface TimedAdTriggerEvaluation {
  eligible: boolean;
  reason: TimedAdBlockReason;
  nextCheckInMs: number;
  remainingInSession: number;
}

export function createTimedAdSessionState(nowMs: number = Date.now()): TimedAdSessionState {
  const safeNow = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  return {
    sessionStartedAtMs: safeNow,
    shownCount: 0,
    isVisible: false,
    lastShownAtMs: null,
    lastDismissedAtMs: null,
    activeImpressionId: null,
  };
}

/**
 * Returns `true` if the current session is completely ineligible to ever show
 * the timed/periodic ad (PRO, Business, Admin, Active Paid/Trial Org, 24h PRO Pass,
 * 24h Credits Ad-Free Pass, offline, no consent, AuthGate/Splash/Onboarding/PIN-Lock,
 * or unresolved entitlement).
 */
export function isFreeUserEligibleForTimedAd(
  eligibility: ResolveMonetagEligibilityParams
): boolean {
  return shouldLoadMonetagZone(eligibility);
}

/**
 * Returns `true` if a currently visible timed ad MUST be hidden immediately
 * (e.g. user opened TransactionModal/any dialog, upgraded to PRO/Org, redeemed Ad-Free,
 * went offline, or locked/left the shell).
 */
export function shouldHideActiveTimedPeriodicAd(
  eligibility: TimedAdEligibilityInput
): boolean {
  if (!isFreeUserEligibleForTimedAd(eligibility)) return true;
  if (eligibility.hasBlockingModalOpen) return true;
  return false;
}

/**
 * Evaluates whether a timed/periodic ad may trigger at `nowMs`.
 *
 * Strictly enforces:
 * 1) Free users ONLY (PRO / Business / Admin / Active Org / 24h Ad-Free / 24h PRO Pass blocked).
 * 2) Never triggers while any modal/dialog (especially TransactionModal) is open.
 * 3) Never triggers while tab is hidden.
 * 4) Initial 90-second grace period from session start.
 * 5) 4.5-minute (270s) interval after dismissal before subsequent impressions.
 * 6) Maximum of 3 impressions per session.
 */
export function canTriggerTimedPeriodicAd(
  state: TimedAdSessionState,
  eligibility: TimedAdEligibilityInput,
  nowMs: number = Date.now()
): TimedAdTriggerEvaluation {
  const remainingInSession = Math.max(0, TIMED_AD_MAX_PER_SESSION - state.shownCount);

  if (!isFreeUserEligibleForTimedAd(eligibility)) {
    return {
      eligible: false,
      reason: 'ineligible_user_or_env',
      nextCheckInMs: TIMED_AD_INTERVAL_MS,
      remainingInSession,
    };
  }

  if (state.shownCount >= TIMED_AD_MAX_PER_SESSION) {
    return {
      eligible: false,
      reason: 'session_cap_reached',
      nextCheckInMs: 0,
      remainingInSession: 0,
    };
  }

  if (state.isVisible) {
    return {
      eligible: false,
      reason: 'already_visible',
      nextCheckInMs: TIMED_AD_INTERVAL_MS,
      remainingInSession,
    };
  }

  if (eligibility.hasBlockingModalOpen) {
    return {
      eligible: false,
      reason: 'modal_open',
      nextCheckInMs: 5_000,
      remainingInSession,
    };
  }

  if (!eligibility.isDocumentVisible) {
    return {
      eligible: false,
      reason: 'document_hidden',
      nextCheckInMs: 5_000,
      remainingInSession,
    };
  }

  const safeNow = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();

  if (state.shownCount === 0) {
    const elapsedSinceStart = Math.max(0, safeNow - state.sessionStartedAtMs);
    const remainingGrace = Math.max(0, TIMED_AD_INITIAL_GRACE_MS - elapsedSinceStart);
    if (remainingGrace > 0) {
      return {
        eligible: false,
        reason: 'grace_period',
        nextCheckInMs: remainingGrace,
        remainingInSession,
      };
    }
    return {
      eligible: true,
      reason: 'ready',
      nextCheckInMs: 0,
      remainingInSession,
    };
  }

  const anchorMs = state.lastDismissedAtMs ?? state.lastShownAtMs ?? state.sessionStartedAtMs;
  const elapsedSinceDismiss = Math.max(0, safeNow - anchorMs);
  const remainingInterval = Math.max(0, TIMED_AD_INTERVAL_MS - elapsedSinceDismiss);
  if (remainingInterval > 0) {
    return {
      eligible: false,
      reason: 'cooldown_interval',
      nextCheckInMs: remainingInterval,
      remainingInSession,
    };
  }

  return {
    eligible: true,
    reason: 'ready',
    nextCheckInMs: 0,
    remainingInSession,
  };
}

export function openTimedPeriodicAd(
  state: TimedAdSessionState,
  nowMs: number = Date.now()
): TimedAdSessionState {
  if (state.isVisible || state.shownCount >= TIMED_AD_MAX_PER_SESSION) {
    return state;
  }
  const safeNow = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  const nextCount = state.shownCount + 1;
  return {
    ...state,
    shownCount: nextCount,
    isVisible: true,
    lastShownAtMs: safeNow,
    activeImpressionId: `timed_ad_${nextCount}_${safeNow}`,
  };
}

export function dismissTimedPeriodicAd(
  state: TimedAdSessionState,
  nowMs: number = Date.now()
): TimedAdSessionState {
  if (!state.isVisible) {
    return state;
  }
  const safeNow = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  return {
    ...state,
    isVisible: false,
    lastDismissedAtMs: safeNow,
    activeImpressionId: null,
  };
}
