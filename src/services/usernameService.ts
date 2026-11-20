import type { OrganizationMember } from '../types';

export const USERNAME_REGEX = /^[a-z0-9_]{3,30}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'help',
  'owner',
  'raseedi',
  'official',
  'staff',
  'moderator',
  'mod',
  'null',
  'undefined',
  'api',
  'auth',
  'login',
  'signup',
  'settings',
  'billing',
  'security',
]);

export interface UsernameValidationResult {
  valid: boolean;
  normalized: string;
  errorAr?: string;
  errorEn?: string;
}

export function normalizeUsername(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

export function formatUsernameHandle(raw?: string | null): string {
  const normalized = normalizeUsername(raw || '');
  return normalized ? `@${normalized}` : '';
}

export function validateUsernameFormat(raw: string): UsernameValidationResult {
  const normalized = normalizeUsername(raw);
  if (!normalized) {
    return {
      valid: false,
      normalized: '',
      errorAr: 'يرجى إدخال اسم مستخدم صالح.',
      errorEn: 'Please enter a valid username.',
    };
  }
  if (normalized.length < 3) {
    return {
      valid: false,
      normalized,
      errorAr: 'يجب أن يتكون اسم المستخدم من 3 أحرف على الأقل.',
      errorEn: 'Username must be at least 3 characters long.',
    };
  }
  if (normalized.length > 30) {
    return {
      valid: false,
      normalized,
      errorAr: 'يجب ألا يتجاوز اسم المستخدم 30 حرفاً.',
      errorEn: 'Username must not exceed 30 characters.',
    };
  }
  if (!USERNAME_REGEX.test(normalized)) {
    return {
      valid: false,
      normalized,
      errorAr: 'استخدم أحرفاً إنجليزية صغيرة وأرقاماً والشرطة السفلية (_) فقط.',
      errorEn: 'Use lowercase English letters, numbers, and underscores (_) only.',
    };
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return {
      valid: false,
      normalized,
      errorAr: 'اسم المستخدم هذا محجوز للنظام، يرجى اختيار اسم آخر.',
      errorEn: 'This username is reserved by the system. Please choose another.',
    };
  }
  return { valid: true, normalized };
}

export type MemberLookupQuery =
  | { kind: 'email'; normalized: string }
  | { kind: 'username'; normalized: string }
  | { kind: 'invalid'; normalized: string; errorAr: string; errorEn: string };

export function parseMemberLookupQuery(raw: string): MemberLookupQuery {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return {
      kind: 'invalid',
      normalized: '',
      errorAr: 'يرجى إدخال البريد الإلكتروني أو اسم المستخدم (@username).',
      errorEn: 'Please enter an email address or @username.',
    };
  }

  // If it contains '@' not solely at index 0, treat as email address
  const atIndex = trimmed.indexOf('@');
  if (atIndex > 0) {
    const email = trimmed.toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      return {
        kind: 'invalid',
        normalized: email,
        errorAr: 'صيغة البريد الإلكتروني غير صحيحة.',
        errorEn: 'Invalid email address format.',
      };
    }
    return { kind: 'email', normalized: email };
  }

  const check = validateUsernameFormat(trimmed);
  if (!check.valid) {
    return {
      kind: 'invalid',
      normalized: check.normalized,
      errorAr:
        check.errorAr ||
        'يرجى إدخال بريد إلكتروني صحيح أو اسم مستخدم (@username) من 3 إلى 30 حرفاً.',
      errorEn:
        check.errorEn ||
        'Please enter a valid email address or @username (3-30 lowercase chars).',
    };
  }
  return { kind: 'username', normalized: check.normalized };
}

/**
 * Deterministic SHA-256 hex hash of normalized lowercase email.
 * Used as the document ID in `userEmailIndex/{emailHash}` so exact-email
 * lookups work directly via Firestore without exposing PII in paths or allowing listing.
 */
export async function computeEmailLookupHash(email: string): Promise<string> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !EMAIL_REGEX.test(normalized)) {
    throw new Error('INVALID_EMAIL_FOR_HASH');
  }
  const encoded = new TextEncoder().encode(normalized);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export interface SeatAvailabilityResult {
  canAdd: boolean;
  activeCount: number;
  effectiveSeatLimit: number;
  remainingSeats: number;
  alreadyMember: boolean;
  reason?: 'ALREADY_MEMBER' | 'SEAT_LIMIT_REACHED';
}

export function checkOrgSeatAvailability(
  members: Array<Pick<OrganizationMember, 'uid' | 'status'>>,
  seatLimit?: number,
  extraSeats = 0,
  targetUid?: string
): SeatAvailabilityResult {
  const baseSeats = typeof seatLimit === 'number' && Number.isFinite(seatLimit) && seatLimit > 0 ? Math.floor(seatLimit) : 5;
  const bonusSeats = typeof extraSeats === 'number' && Number.isFinite(extraSeats) && extraSeats > 0 ? Math.floor(extraSeats) : 0;
  const effectiveSeatLimit = baseSeats + bonusSeats;

  const activeCount = members.filter((m) => m.status !== 'suspended').length;
  const alreadyMember = Boolean(targetUid && members.some((m) => m.uid === targetUid));
  const remainingSeats = Math.max(0, effectiveSeatLimit - activeCount);

  if (alreadyMember) {
    return {
      canAdd: false,
      activeCount,
      effectiveSeatLimit,
      remainingSeats,
      alreadyMember: true,
      reason: 'ALREADY_MEMBER',
    };
  }

  if (activeCount >= effectiveSeatLimit) {
    return {
      canAdd: false,
      activeCount,
      effectiveSeatLimit,
      remainingSeats: 0,
      alreadyMember: false,
      reason: 'SEAT_LIMIT_REACHED',
    };
  }

  return {
    canAdd: true,
    activeCount,
    effectiveSeatLimit,
    remainingSeats,
    alreadyMember: false,
  };
}
