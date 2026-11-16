/**
 * Cryptographic Self-Verifying License Code Generator & Verifier + Admin Gate
 * Pure TypeScript HMAC-SHA256 implementation — runs identically offline, on Vercel, and in Node.
 */
import type { BillingCycle, PlanTier, ProPlanCode } from '../types';

export type AdminCouponTier = 'pro' | 'business';
export type AdminCouponCycle = 'monthly' | 'yearly' | 'lifetime';

export const ADMIN_PANEL_PASSCODE = '2026';
export const LICENSE_CODE_PREFIX = 'RSD-PRO-';
export const BUSINESS_LICENSE_CODE_PREFIX = 'RSD-BIZ-';
export const AUTHORIZED_ADMIN_EMAILS = ['hapaypal2003@gmail.com'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const LICENSE_SIGNING_SECRET = 'Raseedi::License::HMAC::2026::v1::9F4C8E2A';
const ALPHANUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Base32-like unambiguous alphabet

// ---------------------------------------------------------------------------
// Pure TypeScript SHA-256 & HMAC-SHA256 (synchronous, zero external deps)
// ---------------------------------------------------------------------------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8Bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256(data: Uint8Array): Uint8Array {
  const len = data.length;
  const bitLen = len * 8;
  const paddedLen = ((len + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  view.setUint32(paddedLen - 8, hi, false);
  view.setUint32(paddedLen - 4, lo, false);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, H[i], false);
  }
  return out;
}

function hmacSha256(secret: string, message: string): Uint8Array {
  const blockSize = 64;
  let keyBytes = utf8Bytes(secret);
  if (keyBytes.length > blockSize) {
    keyBytes = sha256(keyBytes);
  }
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(keyBytes);

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }

  const msgBytes = utf8Bytes(message);
  const inner = new Uint8Array(blockSize + msgBytes.length);
  inner.set(iKeyPad);
  inner.set(msgBytes, blockSize);
  const innerHash = sha256(inner);

  const outer = new Uint8Array(blockSize + innerHash.length);
  outer.set(oKeyPad);
  outer.set(innerHash, blockSize);
  return sha256(outer);
}

function bytesToToken(bytes: Uint8Array, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHANUM[bytes[i % bytes.length] % ALPHANUM.length];
  }
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function generateNonce(length = 6): string {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToToken(bytes, length);
}

// ---------------------------------------------------------------------------
// Public Admin & License Code API
// ---------------------------------------------------------------------------

export function isAuthorizedAdminEmail(email?: string | null): boolean {
  if (typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return (AUTHORIZED_ADMIN_EMAILS as readonly string[]).includes(normalized);
}

export function isAuthorizedAdminUser(
  user?: {
    email?: string | null;
    isLoggedIn?: boolean;
    emailVerified?: boolean | null;
  } | null
): boolean {
  if (!user) return false;
  if (user.isLoggedIn === false) return false;
  if (user.emailVerified === false) return false;
  return isAuthorizedAdminEmail(user.email);
}

export function computeLicenseCodeHash(rawCode: string): string {
  const normalized = String(rawCode || '').trim().toUpperCase();
  const digest = sha256(utf8Bytes(`raseedi-license:${normalized}`));
  let hex = '';
  for (let i = 0; i < digest.length; i++) {
    hex += digest[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function verifyAdminPassword(input: string): boolean {
  const trimmed = String(input || '').trim();
  return timingSafeEqual(trimmed, ADMIN_PANEL_PASSCODE);
}

export function getLicensePrefixForTier(tier: AdminCouponTier): string {
  return tier === 'business' ? BUSINESS_LICENSE_CODE_PREFIX : LICENSE_CODE_PREFIX;
}

export function generateAdminLicenseCode(params: {
  tier: AdminCouponTier;
  cycle: AdminCouponCycle;
  nonce?: string;
}): string {
  const tierFlag = params.tier === 'business' ? 'B' : 'P';
  const cycleFlag = params.cycle === 'monthly' ? 'M' : params.cycle === 'yearly' ? 'Y' : 'L';
  const rawNonce = (params.nonce || generateNonce(6))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
    .padEnd(6, 'X');

  const payloadSegment = `${tierFlag}${cycleFlag}${rawNonce}`;
  const macBytes = hmacSha256(LICENSE_SIGNING_SECRET, payloadSegment);
  const sigSegment = bytesToToken(macBytes, 8);
  return `${getLicensePrefixForTier(params.tier)}${payloadSegment}-${sigSegment}`;
}

export interface VerifiedSignedLicenseResult {
  valid: true;
  code: string;
  tier: AdminCouponTier;
  cycle: AdminCouponCycle;
  planTier: PlanTier;
  proPlan: ProPlanCode;
  billingCycle: BillingCycle;
  expiresAt: number | null;
}

export interface InvalidSignedLicenseResult {
  valid: false;
  isSignedFormat: boolean;
  reason: 'NOT_SIGNED_FORMAT' | 'MALFORMED_CODE' | 'INVALID_SIGNATURE';
}

export type LicenseVerificationResult =
  | VerifiedSignedLicenseResult
  | InvalidSignedLicenseResult;

export function isSignedLicenseFormat(rawCode: string): boolean {
  const normalized = String(rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
  return (
    normalized.startsWith(LICENSE_CODE_PREFIX) ||
    normalized.startsWith(BUSINESS_LICENSE_CODE_PREFIX)
  );
}

export function verifySignedLicenseCode(
  rawCode: string,
  nowMs: number = Date.now()
): LicenseVerificationResult {
  const normalized = String(rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
  const matchedPrefix = normalized.startsWith(BUSINESS_LICENSE_CODE_PREFIX)
    ? BUSINESS_LICENSE_CODE_PREFIX
    : normalized.startsWith(LICENSE_CODE_PREFIX)
    ? LICENSE_CODE_PREFIX
    : null;

  if (!matchedPrefix) {
    return { valid: false, isSignedFormat: false, reason: 'NOT_SIGNED_FORMAT' };
  }

  const rest = normalized.slice(matchedPrefix.length);
  const parts = rest.split('-');
  if (parts.length !== 2) {
    return { valid: false, isSignedFormat: true, reason: 'MALFORMED_CODE' };
  }

  const [payloadSegment, sigSegment] = parts;
  if (payloadSegment.length !== 8 || sigSegment.length !== 8) {
    return { valid: false, isSignedFormat: true, reason: 'MALFORMED_CODE' };
  }

  const tierChar = payloadSegment[0];
  const cycleChar = payloadSegment[1];
  if ((tierChar !== 'P' && tierChar !== 'B') || (cycleChar !== 'M' && cycleChar !== 'Y' && cycleChar !== 'L')) {
    return { valid: false, isSignedFormat: true, reason: 'MALFORMED_CODE' };
  }

  if (matchedPrefix === BUSINESS_LICENSE_CODE_PREFIX && tierChar !== 'B') {
    return { valid: false, isSignedFormat: true, reason: 'INVALID_SIGNATURE' };
  }

  const expectedMac = hmacSha256(LICENSE_SIGNING_SECRET, payloadSegment);
  const expectedSig = bytesToToken(expectedMac, 8);
  if (!timingSafeEqual(sigSegment, expectedSig)) {
    return { valid: false, isSignedFormat: true, reason: 'INVALID_SIGNATURE' };
  }

  const tier: AdminCouponTier = tierChar === 'B' ? 'business' : 'pro';
  const cycle: AdminCouponCycle =
    cycleChar === 'M' ? 'monthly' : cycleChar === 'Y' ? 'yearly' : 'lifetime';

  const planTier: PlanTier = tier === 'business' ? 'business_pro' : 'personal_pro';
  const billingCycle: BillingCycle = cycle;
  const proPlan: ProPlanCode =
    tier === 'business'
      ? cycle === 'monthly'
        ? 'business_monthly'
        : cycle === 'yearly'
        ? 'business_yearly'
        : 'code'
      : cycle;

  const expiresAt =
    cycle === 'monthly'
      ? nowMs + 30 * DAY_MS
      : cycle === 'yearly'
      ? nowMs + 365 * DAY_MS
      : null;

  return {
    valid: true,
    code: `${matchedPrefix}${payloadSegment}-${sigSegment}`,
    tier,
    cycle,
    planTier,
    proPlan,
    billingCycle,
    expiresAt,
  };
}
