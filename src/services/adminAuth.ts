import { isPrimarySystemAdminEmail } from './licenseCodes';
import type { BillingCycle, PlanTier, ProPlanCode } from '../types';
import { DAY_MS } from './entitlements';

export const ADMIN_PBKDF2_ITERATIONS = 100_000;
export const ADMIN_SCRYPT_HASH_REGEX = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i;
export const ADMIN_PBKDF2_HASH_REGEX = /^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/i;
export const DIRECT_ADMIN_SESSION_PREFIX = 'direct-firestore:';
export const ADMIN_PANEL_SESSION_STORAGE_KEY = 'raseedi_admin_panel_session_v1';
export const ADMIN_PANEL_SESSION_TTL_MS = 30 * 60 * 1000;

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredAdminPanelSession {
  uid: string;
  token: string;
  expiresAt: number;
  pinSource: 'firestore' | 'env' | 'unset';
  pinUpdatedAtMs: number | null;
}

function getDefaultSessionStorage(): SessionStorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function isAdminSessionExpired(
  expiresAt?: number | null,
  nowMs: number = Date.now()
): boolean {
  return typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}

export function normalizeAdminSessionExpiry(
  expiresAt?: number | null,
  nowMs: number = Date.now()
): number {
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > nowMs) {
    return expiresAt;
  }
  return nowMs + ADMIN_PANEL_SESSION_TTL_MS;
}

export function saveVerifiedAdminSession(
  session: StoredAdminPanelSession,
  storage: SessionStorageLike | null = getDefaultSessionStorage()
): StoredAdminPanelSession {
  const normalized: StoredAdminPanelSession = {
    uid: String(session.uid || '').trim(),
    token: String(session.token || '').trim(),
    expiresAt: normalizeAdminSessionExpiry(session.expiresAt),
    pinSource:
      session.pinSource === 'firestore' || session.pinSource === 'env'
        ? session.pinSource
        : 'unset',
    pinUpdatedAtMs:
      typeof session.pinUpdatedAtMs === 'number' && Number.isFinite(session.pinUpdatedAtMs)
        ? session.pinUpdatedAtMs
        : null,
  };
  if (storage && normalized.uid && normalized.token) {
    try {
      storage.setItem(ADMIN_PANEL_SESSION_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore quota/private-mode storage errors
    }
  }
  return normalized;
}

export function loadVerifiedAdminSession(
  expectedUid?: string | null,
  nowMs: number = Date.now(),
  storage: SessionStorageLike | null = getDefaultSessionStorage()
): StoredAdminPanelSession | null {
  const cleanUid = typeof expectedUid === 'string' ? expectedUid.trim() : '';
  if (!cleanUid || !storage) return null;
  try {
    const raw = storage.getItem(ADMIN_PANEL_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAdminPanelSession>;
    if (
      !parsed ||
      typeof parsed.uid !== 'string' ||
      parsed.uid.trim() !== cleanUid ||
      typeof parsed.token !== 'string' ||
      !parsed.token.trim() ||
      isAdminSessionExpired(parsed.expiresAt, nowMs)
    ) {
      storage.removeItem(ADMIN_PANEL_SESSION_STORAGE_KEY);
      return null;
    }
    return {
      uid: cleanUid,
      token: parsed.token.trim(),
      expiresAt: Number(parsed.expiresAt),
      pinSource:
        parsed.pinSource === 'firestore' || parsed.pinSource === 'env'
          ? parsed.pinSource
          : 'unset',
      pinUpdatedAtMs:
        typeof parsed.pinUpdatedAtMs === 'number' && Number.isFinite(parsed.pinUpdatedAtMs)
          ? parsed.pinUpdatedAtMs
          : null,
    };
  } catch {
    return null;
  }
}

export function clearVerifiedAdminSession(
  storage: SessionStorageLike | null = getDefaultSessionStorage()
): void {
  if (!storage) return;
  try {
    storage.removeItem(ADMIN_PANEL_SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export interface AdminIdentityCandidate {
  uid?: string | null;
  id?: string | null;
  email?: string | null;
  emailVerified?: boolean | null;
  isLoggedIn?: boolean | null;
  providerData?: ReadonlyArray<{ email?: string | null } | null> | null;
}

function resolveCandidateEmails(candidate?: AdminIdentityCandidate | null): string[] {
  if (!candidate) return [];
  const emails: string[] = [];
  if (typeof candidate.email === 'string' && candidate.email.trim()) {
    emails.push(candidate.email.trim());
  }
  if (Array.isArray(candidate.providerData)) {
    for (const provider of candidate.providerData) {
      if (provider && typeof provider.email === 'string' && provider.email.trim()) {
        emails.push(provider.email.trim());
      }
    }
  }
  return emails;
}

/**
 * Pure check determining whether a signed-in Firebase Auth user is the exclusive
 * system admin (`hapaypal2003@gmail.com`) for UI visibility and opening the
 * PIN-protected Admin Panel gate.
 *
 * Intentionally does NOT require Custom Claims, `/api/admin/*` reachability,
 * `emailVerified === true`, or a specific workspace, so static Vercel deployments
 * never hide the Admin Panel button from the system owner.
 */
export function isAuthorizedPrimaryAdminUser(
  candidate?: AdminIdentityCandidate | null
): boolean {
  if (!candidate) return false;
  const uid =
    (typeof candidate.uid === 'string' && candidate.uid.trim()) ||
    (typeof candidate.id === 'string' && candidate.id.trim()) ||
    '';
  const hasAuthenticatedSession = Boolean(uid) || candidate.isLoggedIn === true;
  if (!hasAuthenticatedSession) return false;
  return resolveCandidateEmails(candidate).some((email) => isPrimarySystemAdminEmail(email));
}

/**
 * Stricter identity guard used before executing sensitive direct-Firestore
 * admin writes (matches Firestore Security Rules `isAdmin()` requiring
 * verified Firebase Auth email + non-empty uid).
 */
export function isVerifiedPrimaryAdminForSensitiveAction(
  candidate?: AdminIdentityCandidate | null
): boolean {
  if (!candidate) return false;
  const uid = typeof candidate.uid === 'string' ? candidate.uid.trim() : '';
  if (!uid) return false;
  if (candidate.emailVerified === false) return false;
  return resolveCandidateEmails(candidate).some((email) => isPrimarySystemAdminEmail(email));
}

/**
 * Single source of truth for displaying the Admin Panel trigger and mounting
 * the AdminCodePanelModal PIN gate across MoreMenu, SettingsModal, Navbar, and
 * all workspaces (Personal & Organization).
 */
export function canUserAccessAdminPanelUi(params: {
  isAdminUser?: boolean;
  authUser?: AdminIdentityCandidate | null;
  appUser?: AdminIdentityCandidate | null;
}): boolean {
  if (isAuthorizedPrimaryAdminUser(params.authUser)) {
    return true;
  }
  if (params.appUser?.isLoggedIn === true && isAuthorizedPrimaryAdminUser(params.appUser)) {
    return true;
  }
  if (
    params.isAdminUser === true &&
    (resolveCandidateEmails(params.authUser).some((e) => isPrimarySystemAdminEmail(e)) ||
      resolveCandidateEmails(params.appUser).some((e) => isPrimarySystemAdminEmail(e)))
  ) {
    return true;
  }
  return false;
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
 * Parse a YYYY-MM-DD calendar date string into end-of-day UTC epoch milliseconds
 * so admin-selected expiry dates cover the entire chosen calendar day.
 */
export function parseAdminExpiryDateInput(dateStr?: string | null): number | null {
  if (typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const check = new Date(ms);
  if (
    !Number.isFinite(ms) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/**
 * Pure helper computing ONLY the subscription fields permitted by `firestore.rules`
 * (`isAdmin()` branch on `users/{userId}`) for direct admin subscription management.
 * Supports:
 * - Tier/cycle activation (`monthly`, `yearly`, `lifetime`, or `free` cancellation)
 * - Custom duration in days (`customDays`)
 * - Explicit expiry date (`customExpiresAt` epoch ms)
 * - Cumulative extension (`extendDays` added onto `max(now, existingExpiresAt)`)
 */
export function buildDirectAdminSubscriptionPatch(params: {
  planTier: PlanTier;
  billingCycle: 'free' | 'monthly' | 'yearly' | 'lifetime';
  customDays?: number | null;
  customExpiresAt?: number | null;
  extendDays?: number | null;
  existingExpiresAt?: number | null;
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
  const now =
    typeof params.nowMs === 'number' && Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
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
        : 'lifetime'
      : normalizedCycle;

  let expiresAt: number | null = null;
  if (normalizedCycle !== 'lifetime') {
    if (
      typeof params.extendDays === 'number' &&
      Number.isFinite(params.extendDays) &&
      params.extendDays > 0
    ) {
      const clampedExtend = Math.min(3650, Math.round(params.extendDays));
      const baseMs =
        typeof params.existingExpiresAt === 'number' &&
        Number.isFinite(params.existingExpiresAt) &&
        params.existingExpiresAt > now
          ? params.existingExpiresAt
          : now;
      expiresAt = baseMs + clampedExtend * DAY_MS;
    } else if (
      typeof params.customExpiresAt === 'number' &&
      Number.isFinite(params.customExpiresAt) &&
      params.customExpiresAt > now
    ) {
      expiresAt = Math.round(params.customExpiresAt);
    } else {
      const customDays =
        typeof params.customDays === 'number' &&
        Number.isFinite(params.customDays) &&
        params.customDays > 0
          ? Math.min(3650, Math.round(params.customDays))
          : null;
      const durationDays = customDays ?? (normalizedCycle === 'monthly' ? 30 : 365);
      expiresAt = now + durationDays * DAY_MS;
    }
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
    redeemedCouponCode: null,
  };
}

/**
 * Pure helper computing ONLY the organization subscription fields permitted by
 * `firestore.rules` (`isAdmin()` branch on `organizations/{orgId}`).
 */
export function buildDirectAdminOrgSubscriptionPatch(params: {
  planTier: PlanTier;
  billingCycle: 'free' | 'monthly' | 'yearly' | 'lifetime';
  customDays?: number | null;
  customExpiresAt?: number | null;
  extendDays?: number | null;
  existingExpiresAt?: number | null;
  nowMs?: number;
}): {
  planTier: PlanTier;
  billingCycle: BillingCycle;
  plan: 'trial' | 'business_monthly' | 'business_yearly';
  expiresAt: number | null;
  subscriptionEndsAt: number | null;
  aiScansLimit: number;
} {
  const now =
    typeof params.nowMs === 'number' && Number.isFinite(params.nowMs) ? params.nowMs : Date.now();

  if (params.planTier === 'free' || params.billingCycle === 'free') {
    return {
      planTier: 'free',
      billingCycle: 'free',
      plan: 'business_monthly',
      expiresAt: null,
      subscriptionEndsAt: null,
      aiScansLimit: 5,
    };
  }

  const normalizedCycle: 'monthly' | 'yearly' | 'lifetime' =
    params.billingCycle === 'monthly' ||
    params.billingCycle === 'yearly' ||
    params.billingCycle === 'lifetime'
      ? params.billingCycle
      : 'yearly';

  let expiresAt: number | null = null;
  if (normalizedCycle !== 'lifetime') {
    if (
      typeof params.extendDays === 'number' &&
      Number.isFinite(params.extendDays) &&
      params.extendDays > 0
    ) {
      const clampedExtend = Math.min(3650, Math.round(params.extendDays));
      const baseMs =
        typeof params.existingExpiresAt === 'number' &&
        Number.isFinite(params.existingExpiresAt) &&
        params.existingExpiresAt > now
          ? params.existingExpiresAt
          : now;
      expiresAt = baseMs + clampedExtend * DAY_MS;
    } else if (
      typeof params.customExpiresAt === 'number' &&
      Number.isFinite(params.customExpiresAt) &&
      params.customExpiresAt > now
    ) {
      expiresAt = Math.round(params.customExpiresAt);
    } else {
      const customDays =
        typeof params.customDays === 'number' &&
        Number.isFinite(params.customDays) &&
        params.customDays > 0
          ? Math.min(3650, Math.round(params.customDays))
          : null;
      const durationDays = customDays ?? (normalizedCycle === 'monthly' ? 30 : 365);
      expiresAt = now + durationDays * DAY_MS;
    }
  }

  return {
    planTier: 'business_pro',
    billingCycle: normalizedCycle,
    plan: normalizedCycle === 'monthly' ? 'business_monthly' : 'business_yearly',
    expiresAt,
    subscriptionEndsAt: expiresAt,
    aiScansLimit: 250,
  };
}
