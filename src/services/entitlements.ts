/**
 * Shared Pure Entitlement & Organization Subscription State Logic
 * Single source of truth used by both Client UI and Express Server (`server.ts`).
 */
import { PRICING_CONFIG, getMonthlyAiScanLimit } from '../config/pricing';
import type { BillingCycle, Organization, OrganizationRole, PlanTier } from '../types';
import { normalizeApprovalStatus } from './calculations';

export { normalizeApprovalStatus };

export const DAY_MS = 24 * 60 * 60 * 1000;
export const GRACE_PERIOD_DAYS = 7;
export const EXPIRING_SOON_WINDOW_DAYS = 14;

export type OrgSubscriptionLifecycleStatus =
  | 'trial'
  | 'active'
  | 'expiring_soon'
  | 'grace'
  | 'read_only';

export type ExpiryNotificationStage = 'none' | '14d' | '3d' | '0d' | 'grace' | 'expired';

export interface OrgSubscriptionState {
  status: OrgSubscriptionLifecycleStatus;
  planTier: PlanTier;
  billingCycle: BillingCycle;
  expiresAt: number | null;
  graceEndsAt: number | null;
  daysRemaining: number | null;
  graceDaysRemaining: number | null;
  isGracePeriod: boolean;
  isReadOnly: boolean;
  canWrite: boolean;
  expiryNotificationStage: ExpiryNotificationStage;
  seatLimit: number;
  monthlyScanLimit: number;
}

export function computeOrgSeatLimit(extraSeats = 0): number {
  const safeExtra = Math.max(0, Math.floor(Number.isFinite(extraSeats) ? extraSeats : 0));
  return PRICING_CONFIG.businessPro.includedSeats + safeExtra;
}

export function canRoleEditOrg(role: OrganizationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'accountant' || role === 'employee';
}

export function canRoleApproveOrg(role: OrganizationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'accountant';
}

export function canRoleManageOrg(role: OrganizationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export function resolveOrgExpiresAt(
  org: Pick<Organization, 'expiresAt' | 'subscriptionEndsAt' | 'trialEndsAt' | 'billingCycle' | 'plan'>
): number | null {
  if (typeof org.expiresAt === 'number' && Number.isFinite(org.expiresAt) && org.expiresAt > 0) {
    return org.expiresAt;
  }
  if (
    typeof org.subscriptionEndsAt === 'number' &&
    Number.isFinite(org.subscriptionEndsAt) &&
    org.subscriptionEndsAt > 0
  ) {
    return org.subscriptionEndsAt;
  }
  if (typeof org.trialEndsAt === 'number' && Number.isFinite(org.trialEndsAt) && org.trialEndsAt > 0) {
    return org.trialEndsAt;
  }
  return null;
}

export function resolveOrgPlanTier(
  org: Pick<Organization, 'planTier' | 'plan'>
): PlanTier {
  if (org.planTier === 'free' || org.planTier === 'personal_pro' || org.planTier === 'business_pro') {
    return org.planTier;
  }
  if (org.plan === 'trial' || org.plan === 'business_monthly' || org.plan === 'business_yearly') {
    return 'business_pro';
  }
  return 'business_pro';
}

export function resolveOrgBillingCycle(
  org: Pick<Organization, 'billingCycle' | 'plan'>
): BillingCycle {
  if (
    org.billingCycle === 'free' ||
    org.billingCycle === 'monthly' ||
    org.billingCycle === 'yearly' ||
    org.billingCycle === 'lifetime' ||
    org.billingCycle === 'trial' ||
    org.billingCycle === 'code'
  ) {
    return org.billingCycle;
  }
  if (org.plan === 'business_yearly') return 'yearly';
  if (org.plan === 'business_monthly') return 'monthly';
  if (org.plan === 'trial') return 'trial';
  return 'monthly';
}

export function computeOrgSubscriptionState(
  org: Pick<
    Organization,
    | 'planTier'
    | 'plan'
    | 'billingCycle'
    | 'expiresAt'
    | 'subscriptionEndsAt'
    | 'trialEndsAt'
    | 'seatLimit'
    | 'maxSeats'
    | 'extraSeats'
    | 'aiScansLimit'
  >,
  nowMs: number = Date.now()
): OrgSubscriptionState {
  const planTier = resolveOrgPlanTier(org);
  const billingCycle = resolveOrgBillingCycle(org);
  const expiresAt = resolveOrgExpiresAt(org);
  const seatLimit =
    typeof org.seatLimit === 'number' && Number.isFinite(org.seatLimit) && org.seatLimit > 0
      ? Math.floor(org.seatLimit)
      : typeof org.maxSeats === 'number' && Number.isFinite(org.maxSeats) && org.maxSeats > 0
      ? Math.floor(org.maxSeats)
      : computeOrgSeatLimit(org.extraSeats || 0);

  if (planTier === 'free') {
    return {
      status: 'read_only',
      planTier: 'free',
      billingCycle: 'free',
      expiresAt,
      graceEndsAt: expiresAt,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      isGracePeriod: false,
      isReadOnly: true,
      canWrite: false,
      expiryNotificationStage: 'expired',
      seatLimit,
      monthlyScanLimit: PRICING_CONFIG.free.monthlyAiScans,
    };
  }

  // Lifetime / non-expiring subscription
  if (expiresAt === null) {
    return {
      status: billingCycle === 'trial' ? 'trial' : 'active',
      planTier,
      billingCycle,
      expiresAt: null,
      graceEndsAt: null,
      daysRemaining: null,
      graceDaysRemaining: null,
      isGracePeriod: false,
      isReadOnly: false,
      canWrite: true,
      expiryNotificationStage: 'none',
      seatLimit,
      monthlyScanLimit: getMonthlyAiScanLimit(planTier, true),
    };
  }

  const graceEndsAt = expiresAt + GRACE_PERIOD_DAYS * DAY_MS;
  const msUntilExpiry = expiresAt - nowMs;

  if (msUntilExpiry > 0) {
    const daysRemaining = Math.ceil(msUntilExpiry / DAY_MS);
    let expiryNotificationStage: ExpiryNotificationStage = 'none';
    if (daysRemaining <= 1) {
      expiryNotificationStage = '0d';
    } else if (daysRemaining <= 3) {
      expiryNotificationStage = '3d';
    } else if (daysRemaining <= EXPIRING_SOON_WINDOW_DAYS) {
      expiryNotificationStage = '14d';
    }

    const status: OrgSubscriptionLifecycleStatus =
      billingCycle === 'trial'
        ? 'trial'
        : daysRemaining <= EXPIRING_SOON_WINDOW_DAYS
        ? 'expiring_soon'
        : 'active';

    return {
      status,
      planTier,
      billingCycle,
      expiresAt,
      graceEndsAt,
      daysRemaining,
      graceDaysRemaining: GRACE_PERIOD_DAYS,
      isGracePeriod: false,
      isReadOnly: false,
      canWrite: true,
      expiryNotificationStage,
      seatLimit,
      monthlyScanLimit: getMonthlyAiScanLimit(planTier, true),
    };
  }

  // Subscription expired: check 7-day grace window
  const msUntilGraceEnd = graceEndsAt - nowMs;
  if (msUntilGraceEnd > 0) {
    const graceDaysRemaining = Math.ceil(msUntilGraceEnd / DAY_MS);
    return {
      status: 'grace',
      planTier,
      billingCycle,
      expiresAt,
      graceEndsAt,
      daysRemaining: 0,
      graceDaysRemaining,
      isGracePeriod: true,
      isReadOnly: false,
      canWrite: true,
      expiryNotificationStage: msUntilExpiry > -DAY_MS ? '0d' : 'grace',
      seatLimit,
      monthlyScanLimit: getMonthlyAiScanLimit(planTier, true),
    };
  }

  // Past grace period -> Read-Only mode (writes blocked, exports & read still permitted)
  return {
    status: 'read_only',
    planTier,
    billingCycle,
    expiresAt,
    graceEndsAt,
    daysRemaining: 0,
    graceDaysRemaining: 0,
    isGracePeriod: false,
    isReadOnly: true,
    canWrite: false,
    expiryNotificationStage: 'expired',
    seatLimit,
    monthlyScanLimit: 0,
  };
}
