/**
 * License Code Format Types & Constants
 * All license generation, HMAC/hash verification, and admin authorization run exclusively server-side.
 */
export type AdminCouponTier = 'pro' | 'business';
export type AdminCouponCycle = 'monthly' | 'yearly' | 'lifetime';

export const LICENSE_CODE_PREFIX = 'RSD-PRO-';
export const BUSINESS_LICENSE_CODE_PREFIX = 'RSD-BIZ-';
export const PRIMARY_SYSTEM_ADMIN_EMAIL = 'hapaypal2003@gmail.com';

export function isPrimarySystemAdminEmail(email?: string | null): boolean {
  if (typeof email !== 'string') return false;
  return email.trim().toLowerCase() === PRIMARY_SYSTEM_ADMIN_EMAIL;
}

export function getLicensePrefixForTier(tier: AdminCouponTier): string {
  return tier === 'business' ? BUSINESS_LICENSE_CODE_PREFIX : LICENSE_CODE_PREFIX;
}

export function isSignedLicenseFormat(rawCode: string): boolean {
  const normalized = String(rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
  return (
    normalized.startsWith(LICENSE_CODE_PREFIX) ||
    normalized.startsWith(BUSINESS_LICENSE_CODE_PREFIX)
  );
}
