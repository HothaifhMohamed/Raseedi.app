import type { BillingCycle, PlanTier, VerifiedProEntitlement } from '../types';

export const SUBSCRIPTION_DAY_MS = 24 * 60 * 60 * 1000;
export const SUBSCRIPTION_EXPIRY_WARNING_DAYS = 7;

export interface UserSubscriptionSummary {
  isPro: boolean;
  planTier: PlanTier;
  isBusinessPro: boolean;
  billingCycle: BillingCycle;
  startedAt: number | null;
  expiresAt: number | null;
  isLifetime: boolean;
  daysRemaining: number | null;
  isExpiringSoon: boolean;
  isExpired: boolean;
  isAdminOverride: boolean;
  activatedViaCode: boolean;
  codePreview?: string;
}

export function normalizePlanTierInput(
  rawPlanTier?: string | null,
  rawProPlan?: string | null,
  isActive: boolean = true
): PlanTier {
  if (!isActive) return 'free';
  const tier = typeof rawPlanTier === 'string' ? rawPlanTier.trim().toLowerCase() : '';
  const plan = typeof rawProPlan === 'string' ? rawProPlan.trim().toLowerCase() : '';

  if (
    tier === 'business_pro' ||
    tier === 'business' ||
    plan === 'business_monthly' ||
    plan === 'business_yearly' ||
    plan === 'trial'
  ) {
    return 'business_pro';
  }

  if (
    tier === 'personal_pro' ||
    tier === 'pro' ||
    plan === 'monthly' ||
    plan === 'yearly' ||
    plan === 'lifetime' ||
    plan === 'code'
  ) {
    return 'personal_pro';
  }

  if (tier === 'free' || plan === 'free') {
    return 'free';
  }

  return 'personal_pro';
}

export function resolveBillingCycleInput(
  rawBillingCycle?: string | null,
  rawProPlan?: string | null,
  expiresAt?: number | null,
  isActive: boolean = true
): BillingCycle {
  if (!isActive) return 'free';
  const cycle = typeof rawBillingCycle === 'string' ? rawBillingCycle.trim().toLowerCase() : '';
  const plan = typeof rawProPlan === 'string' ? rawProPlan.trim().toLowerCase() : '';

  if (
    cycle === 'monthly' ||
    cycle === 'yearly' ||
    cycle === 'lifetime' ||
    cycle === 'trial' ||
    cycle === 'code'
  ) {
    if (cycle === 'code' && (expiresAt === null || expiresAt === undefined)) {
      return 'lifetime';
    }
    return cycle;
  }

  if (plan === 'monthly' || plan === 'business_monthly') return 'monthly';
  if (plan === 'yearly' || plan === 'business_yearly') return 'yearly';
  if (plan === 'trial') return 'trial';
  if (plan === 'lifetime' || expiresAt === null || expiresAt === undefined) return 'lifetime';
  return 'code';
}

export function computeUserSubscriptionSummary(params: {
  verifiedPro?: Partial<VerifiedProEntitlement> | null;
  isAdminUser?: boolean;
  devPreviewTier?: 'personal_pro' | 'business_pro' | null;
  nowMs?: number;
}): UserSubscriptionSummary {
  const {
    verifiedPro = null,
    isAdminUser = false,
    devPreviewTier = null,
    nowMs = Date.now(),
  } = params;

  if (isAdminUser) {
    return {
      isPro: true,
      planTier: 'business_pro',
      isBusinessPro: true,
      billingCycle: 'lifetime',
      startedAt: verifiedPro?.startedAt ?? verifiedPro?.verifiedAt ?? null,
      expiresAt: null,
      isLifetime: true,
      daysRemaining: null,
      isExpiringSoon: false,
      isExpired: false,
      isAdminOverride: true,
      activatedViaCode: false,
    };
  }

  if (devPreviewTier) {
    return {
      isPro: true,
      planTier: devPreviewTier,
      isBusinessPro: devPreviewTier === 'business_pro',
      billingCycle: 'yearly',
      startedAt: nowMs,
      expiresAt: nowMs + 365 * SUBSCRIPTION_DAY_MS,
      isLifetime: false,
      daysRemaining: 365,
      isExpiringSoon: false,
      isExpired: false,
      isAdminOverride: false,
      activatedViaCode: false,
    };
  }

  if (!verifiedPro) {
    return {
      isPro: false,
      planTier: 'free',
      isBusinessPro: false,
      billingCycle: 'free',
      startedAt: null,
      expiresAt: null,
      isLifetime: false,
      daysRemaining: null,
      isExpiringSoon: false,
      isExpired: false,
      isAdminOverride: false,
      activatedViaCode: false,
    };
  }

  const hasActiveFlag = Boolean(verifiedPro.isPro || verifiedPro.proActive);
  const rawExpiry = verifiedPro.proExpiresAt ?? verifiedPro.expiresAt ?? null;
  const expiresAt =
    typeof rawExpiry === 'number' && Number.isFinite(rawExpiry) && rawExpiry > 0 ? rawExpiry : null;
  const isExpired = Boolean(hasActiveFlag && expiresAt !== null && expiresAt <= nowMs);
  const isActive = hasActiveFlag && !isExpired;

  if (!isActive) {
    return {
      isPro: false,
      planTier: 'free',
      isBusinessPro: false,
      billingCycle: 'free',
      startedAt: verifiedPro.startedAt ?? verifiedPro.verifiedAt ?? null,
      expiresAt,
      isLifetime: false,
      daysRemaining: isExpired ? 0 : null,
      isExpiringSoon: false,
      isExpired,
      isAdminOverride: false,
      activatedViaCode: Boolean(verifiedPro.activatedViaCode),
      codePreview: verifiedPro.codePreview,
    };
  }

  const planTier = normalizePlanTierInput(
    verifiedPro.planTier as string | undefined,
    verifiedPro.proPlan as string | undefined,
    true
  );
  const billingCycle = resolveBillingCycleInput(
    verifiedPro.billingCycle as string | undefined,
    verifiedPro.proPlan as string | undefined,
    expiresAt,
    true
  );
  const isLifetime = billingCycle === 'lifetime' || expiresAt === null;
  const daysRemaining =
    expiresAt !== null && !isLifetime
      ? Math.max(0, Math.ceil((expiresAt - nowMs) / SUBSCRIPTION_DAY_MS))
      : null;
  const isExpiringSoon =
    !isLifetime &&
    daysRemaining !== null &&
    daysRemaining > 0 &&
    daysRemaining <= SUBSCRIPTION_EXPIRY_WARNING_DAYS;

  return {
    isPro: true,
    planTier,
    isBusinessPro: planTier === 'business_pro',
    billingCycle,
    startedAt: verifiedPro.startedAt ?? verifiedPro.verifiedAt ?? null,
    expiresAt,
    isLifetime,
    daysRemaining,
    isExpiringSoon,
    isExpired: false,
    isAdminOverride: false,
    activatedViaCode: Boolean(verifiedPro.activatedViaCode),
    codePreview: verifiedPro.codePreview,
  };
}

export function shouldShowPersonalUpgradeUi(
  summary: Pick<UserSubscriptionSummary, 'isPro' | 'isAdminOverride'>
): boolean {
  return !summary.isAdminOverride && !summary.isPro;
}

export function shouldShowBusinessUpgradeUi(
  summary: Pick<UserSubscriptionSummary, 'isBusinessPro' | 'isAdminOverride'>
): boolean {
  return !summary.isAdminOverride && !summary.isBusinessPro;
}

export interface ShouldShowAdsOptions {
  isProFlag?: boolean;
  activeOrgSubscriptionState?: {
    planTier?: PlanTier;
    status?: string;
    isReadOnly?: boolean;
  } | null;
}

export function shouldShowAds(
  summary: Pick<UserSubscriptionSummary, 'isPro' | 'isAdminOverride'> & {
    isBusinessPro?: boolean;
    planTier?: PlanTier;
  },
  options?: ShouldShowAdsOptions
): boolean {
  if (options?.isProFlag) return false;
  if (summary.isAdminOverride || summary.isPro || summary.isBusinessPro) return false;
  if (summary.planTier && summary.planTier !== 'free') return false;

  const orgSub = options?.activeOrgSubscriptionState;
  if (orgSub && orgSub.planTier && orgSub.planTier !== 'free' && !orgSub.isReadOnly) {
    return false;
  }

  return true;
}

export function shouldShowUpgradeActionButtons(
  summary: Pick<UserSubscriptionSummary, 'isPro' | 'isBusinessPro' | 'isLifetime' | 'isAdminOverride'>
): boolean {
  if (summary.isAdminOverride || !summary.isPro) return false;
  return !(summary.isBusinessPro && summary.isLifetime);
}

export interface SubscriptionDateUpdateResult {
  actionMode: 'new' | 'cumulative_renewal' | 'plan_switch';
  baseMs: number;
  startedAt: number;
  expiresAt: number | null;
  isCumulativeRenewal: boolean;
  isPlanSwitch: boolean;
  shouldWarnForfeiture: boolean;
  replacedDaysRemaining: number | null;
  replacedIsLifetime: boolean;
}

export function calculateSubscriptionDatesUpdate(params: {
  currentTier: PlanTier;
  currentExpiresAt: number | null | undefined;
  currentBillingCycle?: BillingCycle | null;
  currentIsPro: boolean;
  newTier: Exclude<PlanTier, 'free'>;
  newCycle: 'monthly' | 'yearly' | 'lifetime';
  nowMs?: number;
}): SubscriptionDateUpdateResult {
  const {
    currentTier,
    currentExpiresAt,
    currentBillingCycle = null,
    currentIsPro,
    newTier,
    newCycle,
    nowMs = Date.now(),
  } = params;

  const isCurrentLifetime =
    currentIsPro &&
    currentTier !== 'free' &&
    (currentBillingCycle === 'lifetime' || currentExpiresAt === null || currentExpiresAt === undefined);
  const hasFutureExpiry =
    currentIsPro &&
    currentTier !== 'free' &&
    typeof currentExpiresAt === 'number' &&
    Number.isFinite(currentExpiresAt) &&
    currentExpiresAt > nowMs;

  const isCurrentActive = isCurrentLifetime || hasFutureExpiry;
  const isSameTier = isCurrentActive && currentTier === newTier;
  const isPlanSwitch = isCurrentActive && currentTier !== newTier;

  const replacedDaysRemaining = !isPlanSwitch
    ? 0
    : isCurrentLifetime
    ? null
    : Math.max(1, Math.ceil(((currentExpiresAt as number) - nowMs) / SUBSCRIPTION_DAY_MS));

  if (newCycle === 'lifetime') {
    return {
      actionMode: isPlanSwitch ? 'plan_switch' : isSameTier ? 'cumulative_renewal' : 'new',
      baseMs: nowMs,
      startedAt: nowMs,
      expiresAt: null,
      isCumulativeRenewal: false,
      isPlanSwitch,
      shouldWarnForfeiture: isPlanSwitch,
      replacedDaysRemaining,
      replacedIsLifetime: isPlanSwitch && isCurrentLifetime,
    };
  }

  const durationDays = newCycle === 'monthly' ? 30 : 365;
  const durationMs = durationDays * SUBSCRIPTION_DAY_MS;

  if (isSameTier && isCurrentLifetime) {
    return {
      actionMode: 'cumulative_renewal',
      baseMs: nowMs,
      startedAt: nowMs,
      expiresAt: null,
      isCumulativeRenewal: false,
      isPlanSwitch: false,
      shouldWarnForfeiture: false,
      replacedDaysRemaining: 0,
      replacedIsLifetime: false,
    };
  }

  if (isSameTier && hasFutureExpiry && typeof currentExpiresAt === 'number') {
    return {
      actionMode: 'cumulative_renewal',
      baseMs: currentExpiresAt,
      startedAt: nowMs,
      expiresAt: currentExpiresAt + durationMs,
      isCumulativeRenewal: true,
      isPlanSwitch: false,
      shouldWarnForfeiture: false,
      replacedDaysRemaining: 0,
      replacedIsLifetime: false,
    };
  }

  return {
    actionMode: isPlanSwitch ? 'plan_switch' : 'new',
    baseMs: nowMs,
    startedAt: nowMs,
    expiresAt: nowMs + durationMs,
    isCumulativeRenewal: false,
    isPlanSwitch,
    shouldWarnForfeiture: isPlanSwitch,
    replacedDaysRemaining,
    replacedIsLifetime: isPlanSwitch && isCurrentLifetime,
  };
}

export function computeAdminDirectSubscriptionPayload(params: {
  planTier: PlanTier;
  billingCycle: 'free' | 'monthly' | 'yearly' | 'lifetime';
  customDays?: number | null;
  nowMs?: number;
}): {
  isPro: boolean;
  proActive: boolean;
  planTier: PlanTier;
  proPlan: VerifiedProEntitlement['proPlan'];
  billingCycle: BillingCycle;
  startedAt: number | null;
  expiresAt: number | null;
  proExpiresAt: number | null;
} {
  const nowMs = params.nowMs ?? Date.now();
  if (params.planTier === 'free' || params.billingCycle === 'free') {
    return {
      isPro: false,
      proActive: false,
      planTier: 'free',
      proPlan: 'free',
      billingCycle: 'free',
      startedAt: null,
      expiresAt: null,
      proExpiresAt: null,
    };
  }

  const isBusiness = params.planTier === 'business_pro';
  if (params.billingCycle === 'lifetime') {
    return {
      isPro: true,
      proActive: true,
      planTier: params.planTier,
      proPlan: isBusiness ? 'code' : 'lifetime',
      billingCycle: 'lifetime',
      startedAt: nowMs,
      expiresAt: null,
      proExpiresAt: null,
    };
  }

  const defaultDays = params.billingCycle === 'monthly' ? 30 : 365;
  const days =
    typeof params.customDays === 'number' && Number.isFinite(params.customDays) && params.customDays > 0
      ? Math.round(params.customDays)
      : defaultDays;
  const expiresAt = nowMs + days * SUBSCRIPTION_DAY_MS;
  const proPlan: VerifiedProEntitlement['proPlan'] = isBusiness
    ? params.billingCycle === 'monthly'
      ? 'business_monthly'
      : 'business_yearly'
    : params.billingCycle;

  return {
    isPro: true,
    proActive: true,
    planTier: params.planTier,
    proPlan,
    billingCycle: params.billingCycle,
    startedAt: nowMs,
    expiresAt,
    proExpiresAt: expiresAt,
  };
}

export type AppEntryStage = 'loading' | 'locked' | 'auth_gate' | 'onboarding' | 'app';

export function resolveAppEntryStage(params: {
  isLoading: boolean;
  isAppLocked: boolean;
  isLoggedIn: boolean;
  isGuestMode: boolean;
  hasCompletedOnboarding: boolean;
}): AppEntryStage {
  const { isLoading, isAppLocked, isLoggedIn, isGuestMode, hasCompletedOnboarding } = params;
  if (isLoading) return 'loading';
  if (isAppLocked) return 'locked';
  if (!isLoggedIn && !isGuestMode) return 'auth_gate';
  if (!hasCompletedOnboarding) return 'onboarding';
  return 'app';
}

export type PostGoogleSignInAction =
  | 'restore_cloud_and_enter'
  | 'start_onboarding'
  | 'preserve_local_session';

export function resolvePostGoogleSignInAction(params: {
  hasCloudBackup: boolean;
  wasActiveGuest: boolean;
  hasLocalOnboarding: boolean;
  localTransactionsCount: number;
  sameSignedInUser?: boolean;
  hasCloudOnboarding?: boolean;
}): PostGoogleSignInAction {
  const {
    hasCloudBackup,
    wasActiveGuest,
    hasLocalOnboarding,
    localTransactionsCount,
    sameSignedInUser = false,
    hasCloudOnboarding = false,
  } = params;
  if (!wasActiveGuest) {
    if (hasCloudBackup) return 'restore_cloud_and_enter';
    if (hasCloudOnboarding || (sameSignedInUser && hasLocalOnboarding)) {
      return 'preserve_local_session';
    }
    return 'start_onboarding';
  }
  if (!hasLocalOnboarding && localTransactionsCount === 0) {
    if (hasCloudBackup) return 'restore_cloud_and_enter';
    if (hasCloudOnboarding) return 'preserve_local_session';
    return 'start_onboarding';
  }
  return 'preserve_local_session';
}
