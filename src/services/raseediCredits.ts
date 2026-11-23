import type { PlanTier } from '../types';
import type { UserSubscriptionSummary } from './subscriptionHelpers';

export const ADSTERRA_SMARTLINK_URL =
  'https://araplhn.org/4/68b50cb65897ac345cf0ff99a6ac732a';

export const CREDITS_STORAGE_KEY_PREFIX = 'raseedi_credits_state_v1';
export const CREDITS_WELCOME_BONUS = 15;
export const CREDITS_AD_REWARD = 10;
export const CREDITS_AD_COUNTDOWN_SECONDS = 10;
export const CREDITS_AD_COUNTDOWN_MS = CREDITS_AD_COUNTDOWN_SECONDS * 1000;
export const CREDITS_AD_MAX_TICK_DELTA_MS = 1000;
export const CREDITS_DAILY_AD_LIMIT = 5;
export const CREDITS_AD_COOLDOWN_MS = 60 * 1000;
export const CREDITS_STREAK_3_DAYS = 3;
export const CREDITS_STREAK_3_REWARD = 5;
export const CREDITS_STREAK_7_DAYS = 7;
export const CREDITS_STREAK_7_REWARD = 15;
export const CREDITS_PRO_PASS_GOAL = 50;
export const CREDITS_24H_MS = 24 * 60 * 60 * 1000;
export const CREDITS_MAX_LEDGER_ENTRIES = 60;

export type CreditRewardRedemptionId =
  | 'ai_scans_2'
  | 'export_report_1'
  | 'ad_free_24h'
  | 'pro_pass_24h';

export type CreditLedgerEntryType =
  | 'welcome'
  | 'ad_reward'
  | 'streak_3'
  | 'streak_7'
  | 'redeem_ai_scans'
  | 'redeem_export'
  | 'redeem_ad_free_24h'
  | 'redeem_pro_pass_24h'
  | 'consume_ai_scan'
  | 'consume_export';

export interface CreditLedgerEntry {
  id: string;
  type: CreditLedgerEntryType;
  delta: number;
  balanceAfter: number;
  timestamp: number;
  noteAr: string;
  noteEn: string;
}

export interface RaseediCreditsState {
  version: 1;
  ownerId?: string;
  balance: number;
  welcomeBonusClaimed: boolean;
  adsWatchedDate: string; // Local YYYY-MM-DD
  adsWatchedToday: number;
  lastAdClaimAtMs: number;
  maxObservedNowMs: number;
  streakCount: number;
  lastStreakDate: string; // Local YYYY-MM-DD
  claimedStreakMilestones: string[]; // e.g. ['cycle:2026-11-22:3']
  streakCycleStartDate: string; // Local YYYY-MM-DD of day 1 in current streak cycle
  bonusReceiptScans: number;
  exportPasses: number;
  adFreeUntilMs: number;
  proPassUntilMs: number;
  ledger: CreditLedgerEntry[];
  updatedAtMs: number;
}

export interface CreditsStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface CreditRedemptionOption {
  id: CreditRewardRedemptionId;
  cost: number;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  badgeAr: string;
  badgeEn: string;
}

export const CREDIT_REDEMPTION_CATALOG: readonly CreditRedemptionOption[] = [
  {
    id: 'ai_scans_2',
    cost: 10,
    titleAr: 'مسحتان إضافيتان للفواتير بالذكاء الاصطناعي',
    titleEn: '+2 AI Receipt Scans',
    descriptionAr: 'تُضاف فوراً إلى رصيدك المتاح لتحليل الفواتير بالذكاء الاصطناعي.',
    descriptionEn: 'Added instantly to your available AI receipt scanning balance.',
    badgeAr: '+2 مسح ذكي',
    badgeEn: '+2 AI Scans',
  },
  {
    id: 'export_report_1',
    cost: 15,
    titleAr: 'تصدير تقرير احترافي (PDF / Excel)',
    titleEn: '1 Pro Report Export (PDF / Excel)',
    descriptionAr: 'يمنحك بطاقة تصدير كاملة لمرة واحدة لتقارير PDF أو Excel / CSV.',
    descriptionEn: 'Grants 1 full export pass for PDF or Excel / CSV financial reports.',
    badgeAr: 'تصدير واحد',
    badgeEn: '1 Export',
  },
  {
    id: 'ad_free_24h',
    cost: 25,
    titleAr: 'إخفاء الإعلانات لمدة 24 ساعة',
    titleEn: '24h Ad-Free Quiet Focus',
    descriptionAr: 'وضع التركيز الهادئ — إخفاء جميع البانرات الإعلانية لمدة 24 ساعة متواصلة.',
    descriptionEn: 'Quiet Focus Mode — hides all banner ads for 24 continuous hours.',
    badgeAr: '24 ساعة هادئة',
    badgeEn: '24h Ad-Free',
  },
  {
    id: 'pro_pass_24h',
    cost: 50,
    titleAr: 'بطاقة تجربة PRO الكاملة لمدة 24 ساعة',
    titleEn: '24h Full PRO Pass',
    descriptionAr: 'تفعيل تجربة PRO الكاملة مع المحافظ والتقارير وبدون إعلانات لمدة 24 ساعة.',
    descriptionEn: 'Unlock full PRO features, reports, and ad-free experience for 24 hours.',
    badgeAr: 'يوم PRO مجاني',
    badgeEn: '24h PRO Pass',
  },
] as const;

export function getCreditRedemptionOption(
  id: CreditRewardRedemptionId
): CreditRedemptionOption {
  const found = CREDIT_REDEMPTION_CATALOG.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Unknown credit redemption id: ${id}`);
  }
  return found;
}

export function getLocalDateKey(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalDayDiff(fromDateKey: string, toDateKey: string): number {
  const parse = (key: string): number | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]) - 1;
    const d = Number(match[3]);
    return Date.UTC(y, m, d);
  };
  const a = parse(fromDateKey);
  const b = parse(toDateKey);
  if (a === null || b === null) return 999;
  return Math.round((b - a) / CREDITS_24H_MS);
}

function makeLedgerEntry(
  type: CreditLedgerEntryType,
  delta: number,
  balanceAfter: number,
  timestamp: number,
  noteAr: string,
  noteEn: string
): CreditLedgerEntry {
  return {
    id: `cr_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    delta,
    balanceAfter,
    timestamp,
    noteAr,
    noteEn,
  };
}

function appendLedger(
  ledger: CreditLedgerEntry[],
  entry: CreditLedgerEntry
): CreditLedgerEntry[] {
  return [entry, ...ledger].slice(0, CREDITS_MAX_LEDGER_ENTRIES);
}

/**
 * Computes effective monotonic timestamp to resist backward system-clock tampering.
 */
export function resolveSafeNowMs(
  state: Pick<RaseediCreditsState, 'maxObservedNowMs'>,
  nowMs: number = Date.now()
): number {
  const safeInput = Number.isFinite(nowMs) && nowMs > 0 ? Math.floor(nowMs) : Date.now();
  const floor =
    Number.isFinite(state.maxObservedNowMs) && state.maxObservedNowMs > 0
      ? Math.floor(state.maxObservedNowMs)
      : 0;
  return Math.max(safeInput, floor);
}

export function getCreditsScopeId(userId?: string | null): string {
  return userId && userId.trim() ? userId.trim() : 'guest';
}

export function isCreditsStorageKey(key: string): boolean {
  return (
    key === CREDITS_STORAGE_KEY_PREFIX ||
    key.startsWith(`${CREDITS_STORAGE_KEY_PREFIX}:`)
  );
}

/**
 * Returns true ONLY when the credits state is an untouched default welcome state
 * (no ads watched, no streak progression beyond day 1, no redemptions/passes, no real activity).
 * Used to guarantee a brand-new default state never overwrites real persisted or cloud credits.
 */
export function isDefaultInitialCreditsState(state: RaseediCreditsState): boolean {
  const hasOnlyWelcomeLedger =
    state.ledger.length === 0 ||
    (state.ledger.length === 1 && state.ledger[0].type === 'welcome');
  return (
    state.balance === CREDITS_WELCOME_BONUS &&
    state.adsWatchedToday === 0 &&
    state.lastAdClaimAtMs === 0 &&
    state.streakCount <= 1 &&
    state.claimedStreakMilestones.length === 0 &&
    state.bonusReceiptScans === 0 &&
    state.exportPasses === 0 &&
    state.adFreeUntilMs === 0 &&
    state.proPassUntilMs === 0 &&
    hasOnlyWelcomeLedger
  );
}

export function createInitialCreditsState(
  nowMs: number = Date.now(),
  ownerId?: string
): RaseediCreditsState {
  const today = getLocalDateKey(nowMs);
  const entry = makeLedgerEntry(
    'welcome',
    CREDITS_WELCOME_BONUS,
    CREDITS_WELCOME_BONUS,
    nowMs,
    'رصيد ترحيبي مجاني للبدء في نقاط رصيدي',
    'Welcome bonus to try Raseedi Credits'
  );
  const trimmedOwner = ownerId && ownerId.trim() ? ownerId.trim() : undefined;
  return {
    version: 1,
    ...(trimmedOwner ? { ownerId: trimmedOwner } : {}),
    balance: CREDITS_WELCOME_BONUS,
    welcomeBonusClaimed: true,
    adsWatchedDate: today,
    adsWatchedToday: 0,
    lastAdClaimAtMs: 0,
    maxObservedNowMs: nowMs,
    streakCount: 1,
    lastStreakDate: today,
    claimedStreakMilestones: [],
    streakCycleStartDate: today,
    bonusReceiptScans: 0,
    exportPasses: 0,
    adFreeUntilMs: 0,
    proPassUntilMs: 0,
    ledger: [entry],
    // Keep updatedAtMs at 0 on fresh unmodified default state so it never outranks saved/cloud history
    updatedAtMs: 0,
  };
}

export function normalizeCreditsState(
  raw: unknown,
  nowMs: number = Date.now()
): RaseediCreditsState {
  if (!raw || typeof raw !== 'object') {
    return createInitialCreditsState(nowMs);
  }
  const obj = raw as Partial<RaseediCreditsState>;
  const today = getLocalDateKey(nowMs);
  const safeMax = Math.max(
    nowMs,
    typeof obj.maxObservedNowMs === 'number' && Number.isFinite(obj.maxObservedNowMs)
      ? Math.floor(obj.maxObservedNowMs)
      : 0
  );
  const welcomeBonusClaimed = Boolean(obj.welcomeBonusClaimed);
  let balance =
    typeof obj.balance === 'number' && Number.isFinite(obj.balance)
      ? Math.max(0, Math.floor(obj.balance))
      : 0;
  let ledger: CreditLedgerEntry[] = Array.isArray(obj.ledger)
    ? obj.ledger
        .filter(
          (item): item is CreditLedgerEntry =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.delta === 'number'
        )
        .slice(0, CREDITS_MAX_LEDGER_ENTRIES)
    : [];

  if (!welcomeBonusClaimed) {
    balance += CREDITS_WELCOME_BONUS;
    ledger = appendLedger(
      ledger,
      makeLedgerEntry(
        'welcome',
        CREDITS_WELCOME_BONUS,
        balance,
        safeMax,
        'رصيد ترحيبي مجاني للبدء في نقاط رصيدي',
        'Welcome bonus to try Raseedi Credits'
      )
    );
  }

  const normalizedOwnerId =
    typeof obj.ownerId === 'string' && obj.ownerId.trim() ? obj.ownerId.trim() : undefined;

  return {
    version: 1,
    ...(normalizedOwnerId ? { ownerId: normalizedOwnerId } : {}),
    balance,
    welcomeBonusClaimed: true,
    adsWatchedDate:
      typeof obj.adsWatchedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.adsWatchedDate)
        ? obj.adsWatchedDate
        : today,
    adsWatchedToday:
      typeof obj.adsWatchedToday === 'number' && Number.isFinite(obj.adsWatchedToday)
        ? Math.max(0, Math.min(CREDITS_DAILY_AD_LIMIT, Math.floor(obj.adsWatchedToday)))
        : 0,
    lastAdClaimAtMs:
      typeof obj.lastAdClaimAtMs === 'number' && Number.isFinite(obj.lastAdClaimAtMs)
        ? Math.max(0, Math.floor(obj.lastAdClaimAtMs))
        : 0,
    maxObservedNowMs: safeMax,
    streakCount:
      typeof obj.streakCount === 'number' && Number.isFinite(obj.streakCount)
        ? Math.max(1, Math.floor(obj.streakCount))
        : 1,
    lastStreakDate:
      typeof obj.lastStreakDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.lastStreakDate)
        ? obj.lastStreakDate
        : today,
    claimedStreakMilestones: Array.isArray(obj.claimedStreakMilestones)
      ? obj.claimedStreakMilestones.filter((m): m is string => typeof m === 'string')
      : [],
    streakCycleStartDate:
      typeof obj.streakCycleStartDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(obj.streakCycleStartDate)
        ? obj.streakCycleStartDate
        : typeof obj.lastStreakDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.lastStreakDate)
        ? obj.lastStreakDate
        : today,
    bonusReceiptScans:
      typeof obj.bonusReceiptScans === 'number' && Number.isFinite(obj.bonusReceiptScans)
        ? Math.max(0, Math.floor(obj.bonusReceiptScans))
        : 0,
    exportPasses:
      typeof obj.exportPasses === 'number' && Number.isFinite(obj.exportPasses)
        ? Math.max(0, Math.floor(obj.exportPasses))
        : 0,
    adFreeUntilMs:
      typeof obj.adFreeUntilMs === 'number' && Number.isFinite(obj.adFreeUntilMs)
        ? Math.max(0, Math.floor(obj.adFreeUntilMs))
        : 0,
    proPassUntilMs:
      typeof obj.proPassUntilMs === 'number' && Number.isFinite(obj.proPassUntilMs)
        ? Math.max(0, Math.floor(obj.proPassUntilMs))
        : 0,
    ledger,
    updatedAtMs:
      typeof obj.updatedAtMs === 'number' && Number.isFinite(obj.updatedAtMs)
        ? Math.max(0, Math.floor(obj.updatedAtMs))
        : 0,
  };
}

export interface DailyStreakEvaluation {
  state: RaseediCreditsState;
  changed: boolean;
  rewardAwarded: number;
  milestoneHit: 3 | 7 | null;
}

/**
 * Evaluates daily consecutive login streak using local calendar dates.
 * - Day 3 consecutive -> +5 credits
 * - Day 7 consecutive -> +15 credits (starts a fresh cycle on day 8)
 * - Missing a day resets streak to 1 without granting a milestone.
 * - Backward clock skew never re-triggers or resets earned milestones.
 */
export function evaluateDailyStreak(
  state: RaseediCreditsState,
  nowMs: number = Date.now()
): DailyStreakEvaluation {
  const effectiveNowMs = resolveSafeNowMs(state, nowMs);
  const todayKey = getLocalDateKey(effectiveNowMs);
  const dayDiff = getLocalDayDiff(state.lastStreakDate, todayKey);

  // Same day or backward clock skew -> no streak progression
  if (dayDiff <= 0) {
    if (effectiveNowMs > state.maxObservedNowMs) {
      return {
        state: { ...state, maxObservedNowMs: effectiveNowMs },
        changed: true,
        rewardAwarded: 0,
        milestoneHit: null,
      };
    }
    return { state, changed: false, rewardAwarded: 0, milestoneHit: null };
  }

  let nextStreak = 1;
  let nextCycleStart = todayKey;

  if (dayDiff === 1) {
    // Consecutive day! If previous day completed a 7-day cycle, start a fresh 7-day cycle at Day 1
    if (state.streakCount >= CREDITS_STREAK_7_DAYS) {
      nextStreak = 1;
      nextCycleStart = todayKey;
    } else {
      nextStreak = state.streakCount + 1;
      nextCycleStart = state.streakCycleStartDate || state.lastStreakDate;
    }
  } else {
    // Missed >= 1 day -> reset streak to Day 1
    nextStreak = 1;
    nextCycleStart = todayKey;
  }

  let nextBalance = state.balance;
  let nextLedger = state.ledger;
  const nextMilestones = [...state.claimedStreakMilestones];
  let rewardAwarded = 0;
  let milestoneHit: 3 | 7 | null = null;

  const milestoneKey3 = `${nextCycleStart}:${CREDITS_STREAK_3_DAYS}`;
  const milestoneKey7 = `${nextCycleStart}:${CREDITS_STREAK_7_DAYS}`;

  if (nextStreak === CREDITS_STREAK_3_DAYS && !nextMilestones.includes(milestoneKey3)) {
    rewardAwarded = CREDITS_STREAK_3_REWARD;
    milestoneHit = 3;
    nextBalance += rewardAwarded;
    nextMilestones.push(milestoneKey3);
    nextLedger = appendLedger(
      nextLedger,
      makeLedgerEntry(
        'streak_3',
        rewardAwarded,
        nextBalance,
        effectiveNowMs,
        'مكافأة الدخول المتتالي (3 أيام)',
        '3-day consecutive login streak bonus'
      )
    );
  } else if (nextStreak === CREDITS_STREAK_7_DAYS && !nextMilestones.includes(milestoneKey7)) {
    rewardAwarded = CREDITS_STREAK_7_REWARD;
    milestoneHit = 7;
    nextBalance += rewardAwarded;
    nextMilestones.push(milestoneKey7);
    nextLedger = appendLedger(
      nextLedger,
      makeLedgerEntry(
        'streak_7',
        rewardAwarded,
        nextBalance,
        effectiveNowMs,
        'مكافأة الدخول المتتالي (7 أيام)',
        '7-day consecutive login streak bonus'
      )
    );
  }

  // Keep daily ad count clean when advancing to a newer local date
  const adDayDiff = getLocalDayDiff(state.adsWatchedDate, todayKey);
  const nextAdsDate = adDayDiff > 0 ? todayKey : state.adsWatchedDate;
  const nextAdsCount = adDayDiff > 0 ? 0 : state.adsWatchedToday;

  const nextState: RaseediCreditsState = {
    ...state,
    balance: nextBalance,
    adsWatchedDate: nextAdsDate,
    adsWatchedToday: nextAdsCount,
    maxObservedNowMs: effectiveNowMs,
    streakCount: nextStreak,
    lastStreakDate: todayKey,
    streakCycleStartDate: nextCycleStart,
    claimedStreakMilestones: nextMilestones.slice(-20),
    ledger: nextLedger,
    updatedAtMs: effectiveNowMs,
  };

  return {
    state: nextState,
    changed: true,
    rewardAwarded,
    milestoneHit,
  };
}

export interface RewardedAdAvailability {
  canWatch: boolean;
  reason: 'ok' | 'daily_limit' | 'cooldown';
  watchedToday: number;
  remainingToday: number;
  dailyLimit: number;
  cooldownRemainingMs: number;
  cooldownRemainingSeconds: number;
}

export function getEffectiveAdsWatchedToday(
  state: RaseediCreditsState,
  nowMs: number = Date.now()
): number {
  const effectiveNowMs = resolveSafeNowMs(state, nowMs);
  const todayKey = getLocalDateKey(effectiveNowMs);
  const dayDiff = getLocalDayDiff(state.adsWatchedDate, todayKey);
  // Only reset when date moves strictly forward; backward clock keeps count locked
  if (dayDiff > 0) return 0;
  return Math.max(0, state.adsWatchedToday);
}

export function getRewardedAdAvailability(
  state: RaseediCreditsState,
  nowMs: number = Date.now()
): RewardedAdAvailability {
  const effectiveNowMs = resolveSafeNowMs(state, nowMs);
  const watchedToday = getEffectiveAdsWatchedToday(state, effectiveNowMs);
  const remainingToday = Math.max(0, CREDITS_DAILY_AD_LIMIT - watchedToday);

  if (watchedToday >= CREDITS_DAILY_AD_LIMIT) {
    return {
      canWatch: false,
      reason: 'daily_limit',
      watchedToday,
      remainingToday: 0,
      dailyLimit: CREDITS_DAILY_AD_LIMIT,
      cooldownRemainingMs: 0,
      cooldownRemainingSeconds: 0,
    };
  }

  const elapsedSinceLastClaim =
    state.lastAdClaimAtMs > 0 ? effectiveNowMs - state.lastAdClaimAtMs : CREDITS_AD_COOLDOWN_MS;
  const cooldownRemainingMs = Math.max(0, CREDITS_AD_COOLDOWN_MS - elapsedSinceLastClaim);

  if (cooldownRemainingMs > 0) {
    return {
      canWatch: false,
      reason: 'cooldown',
      watchedToday,
      remainingToday,
      dailyLimit: CREDITS_DAILY_AD_LIMIT,
      cooldownRemainingMs,
      cooldownRemainingSeconds: Math.ceil(cooldownRemainingMs / 1000),
    };
  }

  return {
    canWatch: true,
    reason: 'ok',
    watchedToday,
    remainingToday,
    dailyLimit: CREDITS_DAILY_AD_LIMIT,
    cooldownRemainingMs: 0,
    cooldownRemainingSeconds: 0,
  };
}

export type RewardedAdPauseReason = 'none' | 'background' | 'offline' | 'open_blocked';

export interface RewardedAdSession {
  sessionId: string;
  startedAtMs: number;
  readyAtMs: number;
  activeElapsedMs: number;
  openAttempted: boolean;
  openAttempts: number;
  pauseReason: RewardedAdPauseReason;
  claimed: boolean;
}

export interface StartRewardedAdOptions {
  isOnline?: boolean;
  openAttempted?: boolean;
}

export function startRewardedAdSession(
  state: RaseediCreditsState,
  nowMs: number = Date.now(),
  options?: StartRewardedAdOptions
):
  | { ok: true; session: RewardedAdSession }
  | {
      ok: false;
      reason: 'daily_limit' | 'cooldown' | 'offline';
      availability: RewardedAdAvailability;
    } {
  const effectiveNowMs = resolveSafeNowMs(state, nowMs);
  const availability = getRewardedAdAvailability(state, effectiveNowMs);

  if (options?.isOnline === false) {
    return {
      ok: false,
      reason: 'offline',
      availability,
    };
  }

  if (!availability.canWatch) {
    return {
      ok: false,
      reason: availability.reason === 'daily_limit' ? 'daily_limit' : 'cooldown',
      availability,
    };
  }

  const openAttempted = options?.openAttempted !== false;
  return {
    ok: true,
    session: {
      sessionId: `ad_${effectiveNowMs}_${Math.random().toString(36).slice(2, 9)}`,
      startedAtMs: effectiveNowMs,
      readyAtMs: effectiveNowMs + CREDITS_AD_COUNTDOWN_MS,
      activeElapsedMs: 0,
      openAttempted,
      openAttempts: openAttempted ? 1 : 0,
      pauseReason: openAttempted ? 'none' : 'open_blocked',
      claimed: false,
    },
  };
}

export function recordRewardedAdOpenAttempt(
  session: RewardedAdSession,
  options: { succeeded: boolean; isOnline?: boolean }
): RewardedAdSession {
  if (session.claimed) return session;
  if (options.isOnline === false) {
    return {
      ...session,
      pauseReason: 'offline',
    };
  }
  const nextAttempts = session.openAttempts + 1;
  if (options.succeeded) {
    return {
      ...session,
      openAttempted: true,
      openAttempts: nextAttempts,
      pauseReason: session.pauseReason === 'open_blocked' ? 'none' : session.pauseReason,
    };
  }
  return {
    ...session,
    openAttempts: nextAttempts,
    pauseReason: 'open_blocked',
  };
}

export interface AdvanceRewardedAdTick {
  deltaMs: number;
  isVisibleAndFocused: boolean;
  isOnline: boolean;
}

/**
 * Advances active foreground countdown time ONLY when:
 * 1) internet connection is online,
 * 2) Smartlink open attempt has been verified,
 * 3) app tab is visible AND focused.
 * Caps each tick to CREDITS_AD_MAX_TICK_DELTA_MS (1000ms) so background
 * timer throttling bursts cannot skip the 10-second verification window.
 */
export function advanceRewardedAdSession(
  session: RewardedAdSession,
  tick: AdvanceRewardedAdTick
): RewardedAdSession {
  if (session.claimed) return session;

  if (!tick.isOnline) {
    return session.pauseReason === 'offline'
      ? session
      : { ...session, pauseReason: 'offline' };
  }

  if (!session.openAttempted) {
    return session.pauseReason === 'open_blocked'
      ? session
      : { ...session, pauseReason: 'open_blocked' };
  }

  if (!tick.isVisibleAndFocused) {
    return session.pauseReason === 'background'
      ? session
      : { ...session, pauseReason: 'background' };
  }

  const rawDelta = Number.isFinite(tick.deltaMs) ? Math.floor(tick.deltaMs) : 0;
  const safeDelta = Math.max(0, Math.min(CREDITS_AD_MAX_TICK_DELTA_MS, rawDelta));
  const nextElapsed = Math.min(
    CREDITS_AD_COUNTDOWN_MS,
    Math.max(0, session.activeElapsedMs) + safeDelta
  );

  if (nextElapsed === session.activeElapsedMs && session.pauseReason === 'none') {
    return session;
  }

  return {
    ...session,
    activeElapsedMs: nextElapsed,
    pauseReason: 'none',
  };
}

export function getRewardedAdRemainingMs(session: RewardedAdSession | null): number {
  if (!session) return 0;
  const elapsed = Number.isFinite(session.activeElapsedMs)
    ? Math.max(0, session.activeElapsedMs)
    : 0;
  return Math.max(0, CREDITS_AD_COUNTDOWN_MS - elapsed);
}

export type ClaimRewardedAdResult =
  | { ok: true; state: RaseediCreditsState; awarded: number }
  | {
      ok: false;
      reason:
        | 'already_claimed'
        | 'offline'
        | 'open_not_verified'
        | 'countdown_incomplete'
        | 'daily_limit'
        | 'cooldown';
      remainingCountdownMs?: number;
    };

export interface ClaimRewardedAdOptions {
  isOnline?: boolean;
}

export function claimRewardedAdReward(
  state: RaseediCreditsState,
  session: RewardedAdSession | null,
  nowMs: number = Date.now(),
  options?: ClaimRewardedAdOptions
): ClaimRewardedAdResult {
  if (!session || session.claimed) {
    return { ok: false, reason: 'already_claimed' };
  }

  if (options?.isOnline === false) {
    return { ok: false, reason: 'offline' };
  }

  if (!session.openAttempted) {
    return { ok: false, reason: 'open_not_verified' };
  }

  const effectiveNowMs = resolveSafeNowMs(state, nowMs);
  const remainingCountdownMs = getRewardedAdRemainingMs(session);
  if (remainingCountdownMs > 0) {
    return {
      ok: false,
      reason: 'countdown_incomplete',
      remainingCountdownMs,
    };
  }

  const availability = getRewardedAdAvailability(state, effectiveNowMs);
  if (!availability.canWatch) {
    return {
      ok: false,
      reason: availability.reason === 'daily_limit' ? 'daily_limit' : 'cooldown',
    };
  }

  const todayKey = getLocalDateKey(effectiveNowMs);
  const nextWatchedToday = availability.watchedToday + 1;
  const nextBalance = state.balance + CREDITS_AD_REWARD;

  const nextState: RaseediCreditsState = {
    ...state,
    balance: nextBalance,
    adsWatchedDate: todayKey,
    adsWatchedToday: nextWatchedToday,
    lastAdClaimAtMs: effectiveNowMs,
    maxObservedNowMs: effectiveNowMs,
    ledger: appendLedger(
      state.ledger,
      makeLedgerEntry(
        'ad_reward',
        CREDITS_AD_REWARD,
        nextBalance,
        effectiveNowMs,
        'مشاهدة إعلان مكافأة',
        'Rewarded ad view'
      )
    ),
    updatedAtMs: effectiveNowMs,
  };

  return {
    ok: true,
    state: nextState,
    awarded: CREDITS_AD_REWARD,
  };
}

export type RedeemCreditResult =
  | { ok: true; state: RaseediCreditsState; option: CreditRedemptionOption }
  | { ok: false; reason: 'insufficient_balance'; needed: number; option: CreditRedemptionOption };

export function redeemCredits(
  state: RaseediCreditsState,
  redemptionId: CreditRewardRedemptionId,
  nowMs: number = Date.now()
): RedeemCreditResult {
  const option = getCreditRedemptionOption(redemptionId);
  if (state.balance < option.cost) {
    return {
      ok: false,
      reason: 'insufficient_balance',
      needed: option.cost - state.balance,
      option,
    };
  }

  const effectiveNowMs = resolveSafeNowMs(state, nowMs);
  const nextBalance = state.balance - option.cost;

  let nextBonusScans = state.bonusReceiptScans;
  let nextExportPasses = state.exportPasses;
  let nextAdFreeUntilMs = state.adFreeUntilMs;
  let nextProPassUntilMs = state.proPassUntilMs;
  let ledgerType: CreditLedgerEntryType = 'redeem_ai_scans';

  switch (redemptionId) {
    case 'ai_scans_2':
      nextBonusScans += 2;
      ledgerType = 'redeem_ai_scans';
      break;
    case 'export_report_1':
      nextExportPasses += 1;
      ledgerType = 'redeem_export';
      break;
    case 'ad_free_24h':
      nextAdFreeUntilMs = Math.max(effectiveNowMs, state.adFreeUntilMs) + CREDITS_24H_MS;
      ledgerType = 'redeem_ad_free_24h';
      break;
    case 'pro_pass_24h':
      nextProPassUntilMs = Math.max(effectiveNowMs, state.proPassUntilMs) + CREDITS_24H_MS;
      ledgerType = 'redeem_pro_pass_24h';
      break;
  }

  const nextState: RaseediCreditsState = {
    ...state,
    balance: nextBalance,
    bonusReceiptScans: nextBonusScans,
    exportPasses: nextExportPasses,
    adFreeUntilMs: nextAdFreeUntilMs,
    proPassUntilMs: nextProPassUntilMs,
    maxObservedNowMs: effectiveNowMs,
    ledger: appendLedger(
      state.ledger,
      makeLedgerEntry(
        ledgerType,
        -option.cost,
        nextBalance,
        effectiveNowMs,
        `استبدال: ${option.titleAr}`,
        `Redeemed: ${option.titleEn}`
      )
    ),
    updatedAtMs: effectiveNowMs,
  };

  return { ok: true, state: nextState, option };
}

export function consumeBonusReceiptScan(
  state: RaseediCreditsState,
  nowMs: number = Date.now()
): { ok: true; state: RaseediCreditsState } | { ok: false } {
  if (state.bonusReceiptScans <= 0) return { ok: false };
  const effectiveNowMs = resolveSafeNowMs(state, nowMs);
  return {
    ok: true,
    state: {
      ...state,
      bonusReceiptScans: state.bonusReceiptScans - 1,
      maxObservedNowMs: effectiveNowMs,
      ledger: appendLedger(
        state.ledger,
        makeLedgerEntry(
          'consume_ai_scan',
          0,
          state.balance,
          effectiveNowMs,
          'استخدام مسح إضافي للفاتورة بالذكاء الاصطناعي',
          'Used 1 bonus AI receipt scan'
        )
      ),
      updatedAtMs: effectiveNowMs,
    },
  };
}

export function consumeExportPass(
  state: RaseediCreditsState,
  nowMs: number = Date.now()
): { ok: true; state: RaseediCreditsState } | { ok: false } {
  if (state.exportPasses <= 0) return { ok: false };
  const effectiveNowMs = resolveSafeNowMs(state, nowMs);
  return {
    ok: true,
    state: {
      ...state,
      exportPasses: state.exportPasses - 1,
      maxObservedNowMs: effectiveNowMs,
      ledger: appendLedger(
        state.ledger,
        makeLedgerEntry(
          'consume_export',
          0,
          state.balance,
          effectiveNowMs,
          'استخدام بطاقة تصدير تقرير احترافي',
          'Used 1 Pro report export pass'
        )
      ),
      updatedAtMs: effectiveNowMs,
    },
  };
}

export function isAdFreePassActive(
  state: Pick<RaseediCreditsState, 'adFreeUntilMs' | 'proPassUntilMs' | 'maxObservedNowMs'>,
  nowMs: number = Date.now()
): boolean {
  const effectiveNowMs = resolveSafeNowMs(state, nowMs);
  return state.adFreeUntilMs > effectiveNowMs || state.proPassUntilMs > effectiveNowMs;
}

export function isProPassActive(
  state: Pick<RaseediCreditsState, 'proPassUntilMs' | 'maxObservedNowMs'>,
  nowMs: number = Date.now()
): boolean {
  const effectiveNowMs = resolveSafeNowMs(state, nowMs);
  return state.proPassUntilMs > effectiveNowMs;
}

export function getRemainingPassTime(
  untilMs: number,
  nowMs: number = Date.now()
): { active: boolean; hours: number; minutes: number; totalMs: number } {
  const totalMs = Math.max(0, untilMs - nowMs);
  if (totalMs <= 0) {
    return { active: false, hours: 0, minutes: 0, totalMs: 0 };
  }
  const totalMinutes = Math.ceil(totalMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { active: true, hours, minutes, totalMs };
}

export interface CreditsEntitlementCheckOptions {
  activeOrgSubscriptionState?: {
    planTier?: PlanTier;
    status?: string;
    isReadOnly?: boolean;
  } | null;
}

/**
 * Raseedi Credits UI and rewarded ads MUST be strictly hidden from any paid
 * PRO, Business PRO, Admin, or active paid/trial organization subscriber.
 * Note: a free user with a temporary 24h Credits PRO Pass still sees their
 * Credits card so they can track their active 24h PRO Pass countdown.
 */
export function shouldShowRaseediCreditsUi(
  paidSummary: Pick<UserSubscriptionSummary, 'isPro' | 'isAdminOverride'> & {
    isBusinessPro?: boolean;
    planTier?: PlanTier;
  },
  options?: CreditsEntitlementCheckOptions
): boolean {
  if (paidSummary.isAdminOverride || paidSummary.isPro || paidSummary.isBusinessPro) {
    return false;
  }
  if (paidSummary.planTier && paidSummary.planTier !== 'free') {
    return false;
  }
  const orgSub = options?.activeOrgSubscriptionState;
  if (orgSub && orgSub.planTier && orgSub.planTier !== 'free' && !orgSub.isReadOnly) {
    return false;
  }
  return true;
}

/**
 * Merges local and cloud/backup credit states safely without losing earned
 * credits or weakening anti-abuse high-water-mark timestamps.
 * A fresh default welcome state can NEVER clobber a real persisted or cloud state.
 */
export function mergeRaseediCreditsStates(
  local: RaseediCreditsState,
  incoming: RaseediCreditsState | null | undefined,
  nowMs: number = Date.now()
): RaseediCreditsState {
  if (!incoming) return local;
  const normalizedIncoming = normalizeCreditsState(incoming, nowMs);
  const localIsDefault = isDefaultInitialCreditsState(local);
  const incomingIsDefault = isDefaultInitialCreditsState(normalizedIncoming);

  let base: RaseediCreditsState;
  if (localIsDefault && !incomingIsDefault) {
    base = normalizedIncoming;
  } else if (!localIsDefault && incomingIsDefault) {
    base = local;
  } else {
    base =
      normalizedIncoming.updatedAtMs > local.updatedAtMs ? normalizedIncoming : local;
  }
  const other = base === normalizedIncoming ? local : normalizedIncoming;

  const maxObserved = Math.max(
    nowMs,
    local.maxObservedNowMs,
    normalizedIncoming.maxObservedNowMs
  );
  const sameAdDay = local.adsWatchedDate === normalizedIncoming.adsWatchedDate;
  const latestAdDate =
    getLocalDayDiff(local.adsWatchedDate, normalizedIncoming.adsWatchedDate) >= 0
      ? normalizedIncoming.adsWatchedDate
      : local.adsWatchedDate;

  const streakDayDiff = getLocalDayDiff(base.lastStreakDate, other.lastStreakDate);
  let resolvedLastStreakDate = base.lastStreakDate;
  let resolvedStreakCount = base.streakCount;
  let resolvedStreakCycleStartDate = base.streakCycleStartDate;

  if (streakDayDiff > 0 && !isDefaultInitialCreditsState(other)) {
    resolvedLastStreakDate = other.lastStreakDate;
    resolvedStreakCount = other.streakCount;
    resolvedStreakCycleStartDate = other.streakCycleStartDate;
  } else if (streakDayDiff === 0 && other.streakCount > base.streakCount) {
    resolvedStreakCount = other.streakCount;
    resolvedStreakCycleStartDate = other.streakCycleStartDate;
  }

  const resolvedOwnerId = local.ownerId || normalizedIncoming.ownerId;

  return {
    ...base,
    ...(resolvedOwnerId ? { ownerId: resolvedOwnerId } : {}),
    welcomeBonusClaimed: true,
    maxObservedNowMs: maxObserved,
    adsWatchedDate: latestAdDate,
    adsWatchedToday: sameAdDay
      ? Math.max(local.adsWatchedToday, normalizedIncoming.adsWatchedToday)
      : latestAdDate === normalizedIncoming.adsWatchedDate
      ? normalizedIncoming.adsWatchedToday
      : local.adsWatchedToday,
    lastAdClaimAtMs: Math.max(local.lastAdClaimAtMs, normalizedIncoming.lastAdClaimAtMs),
    lastStreakDate: resolvedLastStreakDate,
    streakCount: resolvedStreakCount,
    streakCycleStartDate: resolvedStreakCycleStartDate,
    adFreeUntilMs: Math.max(local.adFreeUntilMs, normalizedIncoming.adFreeUntilMs),
    proPassUntilMs: Math.max(local.proPassUntilMs, normalizedIncoming.proPassUntilMs),
    claimedStreakMilestones: Array.from(
      new Set([...base.claimedStreakMilestones, ...other.claimedStreakMilestones])
    ).slice(-20),
  };
}

export function getCreditsStorageKey(userId?: string | null): string {
  return `${CREDITS_STORAGE_KEY_PREFIX}:${getCreditsScopeId(userId)}`;
}

function resolveCreditsStorage(override?: CreditsStorageLike): CreditsStorageLike | null {
  if (override) return override;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function loadCreditsStateFromStorage(
  userId?: string | null,
  nowMs: number = Date.now(),
  options?: { storage?: CreditsStorageLike; fallbackToGuest?: boolean }
): RaseediCreditsState {
  const scopeId = getCreditsScopeId(userId);
  try {
    const storage = resolveCreditsStorage(options?.storage);
    if (!storage) {
      return createInitialCreditsState(nowMs, scopeId);
    }
    const scopedKey = getCreditsStorageKey(userId);
    const raw = storage.getItem(scopedKey);
    if (raw) {
      return {
        ...normalizeCreditsState(JSON.parse(raw), nowMs),
        ownerId: scopeId,
      };
    }
    // Migrate non-default guest activity into newly signed-in free account once if no account state exists yet
    if (userId && userId.trim() && options?.fallbackToGuest !== false) {
      const guestRaw = storage.getItem(getCreditsStorageKey(null));
      if (guestRaw) {
        const normalizedGuest = normalizeCreditsState(JSON.parse(guestRaw), nowMs);
        if (!isDefaultInitialCreditsState(normalizedGuest)) {
          return {
            ...normalizedGuest,
            ownerId: scopeId,
          };
        }
      }
    }
    return createInitialCreditsState(nowMs, scopeId);
  } catch {
    return createInitialCreditsState(nowMs, scopeId);
  }
}

export function saveCreditsStateToStorage(
  state: RaseediCreditsState,
  userId?: string | null,
  options?: { storage?: CreditsStorageLike }
): void {
  try {
    const storage = resolveCreditsStorage(options?.storage);
    if (!storage) return;
    const scopeId = getCreditsScopeId(userId);
    const scopedKey = getCreditsStorageKey(userId);
    storage.setItem(scopedKey, JSON.stringify({ ...state, ownerId: scopeId }));
  } catch {
    // Ignore storage quota errors
  }
}

export function removeCreditsStateFromStorage(
  userId?: string | null,
  options?: { storage?: CreditsStorageLike }
): void {
  try {
    const storage = resolveCreditsStorage(options?.storage);
    if (!storage || !storage.removeItem) return;
    storage.removeItem(getCreditsStorageKey(userId));
  } catch {
    // Ignore storage errors
  }
}
