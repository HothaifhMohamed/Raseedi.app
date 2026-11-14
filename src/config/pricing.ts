/**
 * Unified Pricing & Entitlements Configuration for Raseedi (رَصِيدِي)
 * Business / Enterprise pricing is structured at ~2x Personal PRO.
 */
import { BillingCycle, PlanTier } from '../types';

export type PricingCurrency = 'USD' | 'EGP';

export interface PlanPriceOption {
  id: 'personal_monthly' | 'personal_yearly' | 'personal_lifetime' | 'business_monthly' | 'business_yearly';
  planTier: Exclude<PlanTier, 'free'>;
  billingCycle: Exclude<BillingCycle, 'free' | 'code' | 'trial'>;
  usd: number;
  egp: number;
  monthlyAiScans: number;
  includedSeats: number;
}

export const PRICING_CONFIG = {
  trialDays: 14,
  free: {
    maxWallets: 3,
    maxBudgets: 1,
    monthlyAiScans: 3,
    includedSeats: 1,
  },
  personalPro: {
    monthlyAiScans: 200,
    includedSeats: 1,
    monthly: {
      id: 'personal_monthly' as const,
      planTier: 'personal_pro' as const,
      billingCycle: 'monthly' as const,
      usd: 2.99,
      egp: 99,
      monthlyAiScans: 200,
      includedSeats: 1,
    },
    yearly: {
      id: 'personal_yearly' as const,
      planTier: 'personal_pro' as const,
      billingCycle: 'yearly' as const,
      usd: 24.99,
      egp: 799,
      monthlyAiScans: 200,
      includedSeats: 1,
    },
    lifetime: {
      id: 'personal_lifetime' as const,
      planTier: 'personal_pro' as const,
      billingCycle: 'lifetime' as const,
      usd: 59.99,
      egp: 1999,
      monthlyAiScans: 200,
      includedSeats: 1,
    },
  },
  businessPro: {
    monthlyAiScans: 250,
    includedSeats: 5,
    extraSeatMonthly: {
      usd: 1.0,
      egp: 35,
    },
    monthly: {
      id: 'business_monthly' as const,
      planTier: 'business_pro' as const,
      billingCycle: 'monthly' as const,
      usd: 5.99,
      egp: 199,
      monthlyAiScans: 250,
      includedSeats: 5,
    },
    yearly: {
      id: 'business_yearly' as const,
      planTier: 'business_pro' as const,
      billingCycle: 'yearly' as const,
      usd: 49.99,
      egp: 1599,
      monthlyAiScans: 250,
      includedSeats: 5,
    },
  },
} as const;

export function getMonthlyAiScanLimit(planTier: PlanTier, isPro: boolean): number {
  if (!isPro || planTier === 'free') return PRICING_CONFIG.free.monthlyAiScans;
  if (planTier === 'business_pro') return PRICING_CONFIG.businessPro.monthlyAiScans;
  return PRICING_CONFIG.personalPro.monthlyAiScans;
}

export function formatPricingMoney(
  amount: number,
  currency: PricingCurrency,
  language: 'ar' | 'en'
): string {
  const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  if (currency === 'USD') {
    return `$${formatted}`;
  }
  return language === 'ar' ? `${formatted} ج.م` : `EGP ${formatted}`;
}
