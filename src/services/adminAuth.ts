import { isPrimarySystemAdminEmail } from './licenseCodes';
import type { AdminCouponCycle, AdminCouponTier } from './licenseCodes';
import type { BillingCycle, PlanTier, ProPlanCode } from '../types';
import { DAY_MS } from './entitlements';

export const ADMIN_PBKDF2_ITERATIONS = 100_000;
export const ADMIN_SCRYPT_HASH_REGEX = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i;
export const ADMIN_PBKDF2_HASH_REGEX = /^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/i;
export const DIRECT_ADMIN_SESSION_PREFIX = 'direct-firestore:';

const UNSAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PRO_CODE_PREFIX = 'RSD-PRO-';
const BIZ_CODE_PREFIX = 'RSD-BIZ-';

export interface AdminIdentityCandidate {
  uid?: string | null;
  email?: string | null;
  emailVerified?: boolean | null;
}

/**
 * Pure check determining whether a signed-in Firebase Auth user is the exclusive
 * verified system admin (`hapaypal2003@gmail.com`).
 * Case-insensitive and whitespace-tolerant; requires non-empty uid and verified email.
 */
export function isAuthorizedPrimaryAdminUser(
  candidate?: AdminIdentityCandidate | null
): boolean {
  if (!candidate) return false;
  const uid = typeof candidate.uid === 'string' ? candidate.uid.trim() : '';
  if (!uid) return false;
  if (candidate.emailVerified === false) return false;
  return isPrimarySystemAdminEmail(candidate.email);
}

/**
 * Detect whether an HTTP response from `/api/admin/*` indicates that the Express
 * backend is not hosted on this deployment (e.g., Vercel static SPA hosting returning
 * 404/405 or an HTML fallback page), as opposed to a genuine JSON security rejection
 * (400/401/403/409/429) from a live Express server.
 */
export function isApiEndpointUnavailableResponse(
  status: number,
  contentType?: string | null
): boolean {
  if (status === 404 || status === 405 || status === 501) {
    return true;
  }
  const normalizedType = typeof contentType === 'string' ? contentType.trim().toLowerCase() : '';
  if (normalizedType && !normalizedType.includes('application/json')) {
    return true;
  }
  return false;
}

export function isDirectAdminSessionToken(token?: string | null): boolean {
  return typeof token === 'string' && token.startsWith(DIRECT_ADMIN_SESSION_PREFIX);
}

export function isValidAdminPinLength(pin: string): boolean {
  const clean = typeof pin === 'string' ? pin.trim() : '';
  return clean.length >= 4 && clean.length <= 32;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function constantTimeHexEqual(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function getWebCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error('WEB_CRYPTO_UNAVAILABLE');
}

async function derivePbkdf2Hex(pin: string, saltHex: string): Promise<string> {
  const webCrypto = getWebCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await webCrypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await webCrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(saltHex),
      iterations: ADMIN_PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

/**
 * Hash an Admin PIN in the browser using WebCrypto PBKDF2-SHA256 (100,000 iterations,
 * 16-byte random hex salt). Matches both `firestore.rules` `isValidAdminPanelConfig`
 * and Node server `verifyAdminPinHashServer`.
 */
export async function hashAdminPinBrowser(pin: string): Promise<string> {
  const cleanPin = typeof pin === 'string' ? pin.trim() : '';
  if (!isValidAdminPinLength(cleanPin)) {
    throw new Error('INVALID_PIN_LENGTH');
  }
  const webCrypto = getWebCrypto();
  const saltBytes = new Uint8Array(16);
  webCrypto.getRandomValues(saltBytes);
  const saltHex = bytesToHex(saltBytes);
  const hashHex = await derivePbkdf2Hex(cleanPin, saltHex);
  return `pbkdf2$${ADMIN_PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

export type BrowserPinVerifyResult = 'match' | 'mismatch' | 'server_scrypt_only';

/**
 * Verify an Admin PIN in the browser against a stored hash from `adminConfig/security`.
 * Returns `'server_scrypt_only'` if the stored hash uses Node's `scrypt$` format which
 * browser WebCrypto cannot execute natively, allowing the UI to prompt Google re-auth reset.
 */
export async function verifyAdminPinBrowser(
  pin: string,
  storedHash?: string | null
): Promise<BrowserPinVerifyResult> {
  if (typeof pin !== 'string' || typeof storedHash !== 'string') return 'mismatch';
  const cleanPin = pin.trim();
  const cleanHash = storedHash.trim();
  if (!cleanPin || !cleanHash) return 'mismatch';

  if (ADMIN_SCRYPT_HASH_REGEX.test(cleanHash)) {
    return 'server_scrypt_only';
  }
  if (!ADMIN_PBKDF2_HASH_REGEX.test(cleanHash)) {
    return 'mismatch';
  }

  const parts = cleanHash.split('$');
  const saltHex = parts[2];
  const expectedHex = parts[3];
  try {
    const derivedHex = await derivePbkdf2Hex(cleanPin, saltHex);
    return constantTimeHexEqual(derivedHex, expectedHex) ? 'match' : 'mismatch';
  } catch {
    return 'mismatch';
  }
}

/**
 * Browser-side SHA-256 license code hash — bit-for-bit identical to `hashLicenseCodeServer`.
 */
export async function hashLicenseCodeBrowser(rawCode: string): Promise<string> {
  const normalized = String(rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
  const webCrypto = getWebCrypto();
  const data = new TextEncoder().encode(`raseedi-license:${normalized}`);
  const digest = await webCrypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

function randomAlphabetSegmentBrowser(length: number): string {
  const webCrypto = getWebCrypto();
  const bytes = new Uint8Array(length);
  webCrypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += UNSAFE_ALPHABET[bytes[i] % UNSAFE_ALPHABET.length];
  }
  return out;
}

export async function generateRandomLicenseCodeBrowser(params: {
  tier: AdminCouponTier;
  cycle: AdminCouponCycle;
}): Promise<{
  code: string;
  codeHash: string;
  codePreview: string;
  tier: AdminCouponTier;
  planTier: 'personal_pro' | 'business_pro';
  proPlan: ProPlanCode;
  cycle: AdminCouponCycle;
}> {
  const tier: AdminCouponTier = params.tier === 'business' ? 'business' : 'pro';
  const cycle: AdminCouponCycle =
    params.cycle === 'monthly' || params.cycle === 'yearly' || params.cycle === 'lifetime'
      ? params.cycle
      : 'yearly';
  const prefix = tier === 'business' ? BIZ_CODE_PREFIX : PRO_CODE_PREFIX;
  const seg1 = randomAlphabetSegmentBrowser(4);
  const seg2 = randomAlphabetSegmentBrowser(4);
  const seg3 = randomAlphabetSegmentBrowser(4);
  const code = `${prefix}${seg1}-${seg2}-${seg3}`;
  const codeHash = await hashLicenseCodeBrowser(code);
  const codePreview = `${prefix}****-${seg3}`;
  const planTier: 'personal_pro' | 'business_pro' =
    tier === 'business' ? 'business_pro' : 'personal_pro';
  const proPlan: ProPlanCode =
    tier === 'business'
      ? cycle === 'monthly'
        ? 'business_monthly'
        : cycle === 'yearly'
        ? 'business_yearly'
        : 'code'
      : cycle;

  return {
    code,
    codeHash,
    codePreview,
    tier,
    planTier,
    proPlan,
    cycle,
  };
}

/**
 * Pure helper computing ONLY the subscription fields permitted by `firestore.rules`
 * (`isAdmin()` branch on `users/{userId}`) for direct admin updates on Vercel.
 */
export function buildDirectAdminSubscriptionPatch(params: {
  planTier: PlanTier;
  billingCycle: 'free' | 'monthly' | 'yearly' | 'lifetime';
  customDays?: number | null;
  nowMs?: number;
}): {
  isPro: boolean;
  proActive: boolean;
  planTier: PlanTier;
  proPlan: ProPlanCode;
  billingCycle: BillingCycle;
  startedAt: number | null;
  expiresAt: number | null;
  proExpiresAt: number | null;
  redeemedCouponCode: string | null;
} {
  const now = typeof params.nowMs === 'number' && Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
  const tier = params.planTier;
  const cycle = params.billingCycle;

  if (tier === 'free' || cycle === 'free') {
    return {
      isPro: false,
      proActive: false,
      planTier: 'free',
      proPlan: 'free',
      billingCycle: 'free',
      startedAt: null,
      expiresAt: null,
      proExpiresAt: null,
      redeemedCouponCode: null,
    };
  }

  const normalizedTier: 'personal_pro' | 'business_pro' =
    tier === 'business_pro' ? 'business_pro' : 'personal_pro';
  const normalizedCycle: 'monthly' | 'yearly' | 'lifetime' =
    cycle === 'monthly' || cycle === 'yearly' || cycle === 'lifetime' ? cycle : 'yearly';

  const proPlan: ProPlanCode =
    normalizedTier === 'business_pro'
      ? normalizedCycle === 'monthly'
        ? 'business_monthly'
        : normalizedCycle === 'yearly'
        ? 'business_yearly'
        : 'code'
      : normalizedCycle;

  let expiresAt: number | null = null;
  if (normalizedCycle !== 'lifetime') {
    const customDays =
      typeof params.customDays === 'number' &&
      Number.isFinite(params.customDays) &&
      params.customDays > 0
        ? Math.min(3650, Math.round(params.customDays))
        : null;
    const durationDays = customDays ?? (normalizedCycle === 'monthly' ? 30 : 365);
    expiresAt = now + durationDays * DAY_MS;
  }

  return {
    isPro: true,
    proActive: true,
    planTier: normalizedTier,
    proPlan,
    billingCycle: normalizedCycle,
    startedAt: now,
    expiresAt,
    proExpiresAt: expiresAt,
    redeemedCouponCode: 'ADMIN_GRANTED',
  };
}
