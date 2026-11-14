/**
 * Security utilities:
 * - PIN hashing using PBKDF2-SHA256 (100,000 iterations) with per-PIN salt
 * - Transparent verification & upgrade from legacy plain-text and legacy single-SHA-256 PINs
 * - Persistent escalating PIN lockout (5 attempts -> 30s, 60s, 120s...)
 * - AES-256-GCM + PBKDF2 backup file encryption/decryption
 */

const PIN_PBKDF2_ITERATIONS = 100_000;
const PIN_PBKDF2_PREFIX = `pbkdf2$${PIN_PBKDF2_ITERATIONS}$`;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function legacySha256Pin(pin: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${pin}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hashBuffer));
}

async function pbkdf2PinHash(pin: string, salt: string, iterations = PIN_PBKDF2_ITERATIONS): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return `pbkdf2$${iterations}$${bytesToHex(new Uint8Array(derivedBits))}`;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function hashPin(pin: string, providedSalt?: string): Promise<{ hash: string; salt: string }> {
  const salt =
    providedSalt || bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await pbkdf2PinHash(pin, salt, PIN_PBKDF2_ITERATIONS);
  return { hash, salt };
}

export async function verifyPin(pin: string, storedHash?: string, storedSalt?: string): Promise<boolean> {
  if (!storedHash) return false;

  if (!storedSalt) {
    return timingSafeStringEqual(pin, storedHash);
  }

  if (storedHash.startsWith('pbkdf2$')) {
    const parts = storedHash.split('$');
    const iter = Number(parts[1]) || PIN_PBKDF2_ITERATIONS;
    const expected = await pbkdf2PinHash(pin, storedSalt, iter);
    return timingSafeStringEqual(expected, storedHash);
  }

  // Legacy single-SHA-256 fallback
  const legacyHash = await legacySha256Pin(pin, storedSalt);
  return timingSafeStringEqual(legacyHash, storedHash);
}

export interface VerifyPinResult {
  valid: boolean;
  needsUpgrade: boolean;
  newHash?: string;
  newSalt?: string;
}

/**
 * Verify PIN and transparently migrate legacy plain-text or legacy single-SHA-256 PINs to PBKDF2-SHA256
 */
export async function verifyAndUpgradePin(
  pin: string,
  storedHash?: string,
  storedSalt?: string
): Promise<VerifyPinResult> {
  if (!storedHash) return { valid: false, needsUpgrade: false };

  // 1. Modern PBKDF2-SHA256 hash
  if (storedSalt && storedHash.startsWith(PIN_PBKDF2_PREFIX)) {
    const valid = await verifyPin(pin, storedHash, storedSalt);
    return { valid, needsUpgrade: false };
  }

  // 2. Legacy salted single-SHA-256 or legacy plain-text PIN -> upgrade to PBKDF2
  const valid = await verifyPin(pin, storedHash, storedSalt);
  if (!valid) {
    return { valid: false, needsUpgrade: false };
  }

  const { hash: newHash, salt: newSalt } = await hashPin(pin);
  return { valid: true, needsUpgrade: true, newHash, newSalt };
}

// =============================================================================
// Persistent Escalating PIN Lockout (5 wrong attempts -> 30s, doubling)
// =============================================================================

export interface PinLockoutState {
  failedAttempts: number;
  lockCount: number;
  lockedUntilMs: number;
  isLocked: boolean;
  remainingLockSeconds: number;
  attemptsRemaining: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PIN_MAX_ATTEMPTS = 5;
const PIN_BASE_LOCKOUT_MS = 30_000;
const PIN_LOCKOUT_PREFIX = 'raseedi_pin_lockout_v1:';

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function readRawLockout(lockKey: string, storage: StorageLike | null): {
  failedAttempts: number;
  lockCount: number;
  lockedUntilMs: number;
} {
  if (!storage) return { failedAttempts: 0, lockCount: 0, lockedUntilMs: 0 };
  try {
    const raw = storage.getItem(`${PIN_LOCKOUT_PREFIX}${lockKey}`);
    if (!raw) return { failedAttempts: 0, lockCount: 0, lockedUntilMs: 0 };
    const parsed = JSON.parse(raw) as Partial<{
      failedAttempts: number;
      lockCount: number;
      lockedUntilMs: number;
    }>;
    return {
      failedAttempts: Math.max(0, Number(parsed.failedAttempts || 0)),
      lockCount: Math.max(0, Number(parsed.lockCount || 0)),
      lockedUntilMs: Math.max(0, Number(parsed.lockedUntilMs || 0)),
    };
  } catch {
    return { failedAttempts: 0, lockCount: 0, lockedUntilMs: 0 };
  }
}

export function getPinLockoutState(
  lockKey: string,
  nowMs: number = Date.now(),
  storage: StorageLike | null = getDefaultStorage()
): PinLockoutState {
  const raw = readRawLockout(lockKey, storage);
  const remainingMs = Math.max(0, raw.lockedUntilMs - nowMs);
  const isLocked = remainingMs > 0;
  return {
    failedAttempts: raw.failedAttempts,
    lockCount: raw.lockCount,
    lockedUntilMs: raw.lockedUntilMs,
    isLocked,
    remainingLockSeconds: isLocked ? Math.ceil(remainingMs / 1000) : 0,
    attemptsRemaining: Math.max(0, PIN_MAX_ATTEMPTS - raw.failedAttempts),
  };
}

export function recordFailedPinAttempt(
  lockKey: string,
  nowMs: number = Date.now(),
  storage: StorageLike | null = getDefaultStorage()
): PinLockoutState {
  const current = readRawLockout(lockKey, storage);
  if (current.lockedUntilMs > nowMs) {
    return getPinLockoutState(lockKey, nowMs, storage);
  }

  let failedAttempts = current.failedAttempts + 1;
  let lockCount = current.lockCount;
  let lockedUntilMs = 0;

  if (failedAttempts >= PIN_MAX_ATTEMPTS) {
    lockCount += 1;
    failedAttempts = 0;
    const durationMs = PIN_BASE_LOCKOUT_MS * Math.pow(2, lockCount - 1);
    lockedUntilMs = nowMs + durationMs;
  }

  if (storage) {
    try {
      storage.setItem(
        `${PIN_LOCKOUT_PREFIX}${lockKey}`,
        JSON.stringify({ failedAttempts, lockCount, lockedUntilMs })
      );
    } catch {
      // Ignore quota errors
    }
  }

  return getPinLockoutState(lockKey, nowMs, storage);
}

export function resetPinLockout(
  lockKey: string,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    storage.removeItem(`${PIN_LOCKOUT_PREFIX}${lockKey}`);
  } catch {
    // Ignore
  }
}

// =============================================================================
// Password-Encrypted JSON Backup (PBKDF2 + AES-256-GCM)
// =============================================================================

export interface EncryptedBackupEnvelope {
  raseediEncrypted: 1;
  alg: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // Base64
  iv: string; // Base64
  ciphertext: string; // Base64
}

const PBKDF2_ITERATIONS = 100_000;

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function isEncryptedBackupPayload(rawJson: string): boolean {
  try {
    const parsed = JSON.parse(rawJson);
    return Boolean(
      parsed &&
      parsed.raseediEncrypted === 1 &&
      typeof parsed.ciphertext === 'string' &&
      typeof parsed.iv === 'string' &&
      typeof parsed.salt === 'string'
    );
  } catch {
    return false;
  }
}

export async function encryptBackupJson(plainJson: string, password: string): Promise<string> {
  if (!password) {
    throw new Error('Password is required for encrypted backup');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);

  const encoded = new TextEncoder().encode(plainJson);
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoded
  );

  const envelope: EncryptedBackupEnvelope = {
    raseediEncrypted: 1,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuf)),
  };

  return JSON.stringify(envelope, null, 2);
}

export async function decryptBackupJson(encryptedPayload: string, password: string): Promise<string> {
  if (!password) {
    throw new Error('Password is required to decrypt backup');
  }
  const parsed = JSON.parse(encryptedPayload) as EncryptedBackupEnvelope;
  if (parsed?.raseediEncrypted !== 1 || !parsed.salt || !parsed.iv || !parsed.ciphertext) {
    throw new Error('Invalid encrypted backup format');
  }

  const salt = base64ToBytes(parsed.salt);
  const iv = base64ToBytes(parsed.iv);
  const ciphertext = base64ToBytes(parsed.ciphertext);
  const iterations = parsed.iterations || PBKDF2_ITERATIONS;

  const key = await deriveAesKey(password, salt, iterations);
  const decryptedBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource
  );

  return new TextDecoder().decode(decryptedBuf);
}
