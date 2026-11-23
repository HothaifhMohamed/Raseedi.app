import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { DAY_MS } from './entitlements';
import {
  isPrimarySystemAdminEmail,
  PRIMARY_SYSTEM_ADMIN_EMAIL,
} from './licenseCodes';

const ALLOWED_SCAN_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SCAN_DECODED_BYTES = 2_200_000; // ~2.2MB decoded image

export type ServerSupportedPlanTier = 'free' | 'personal_pro' | 'business_pro';
export type ServerSupportedBillingCycle = 'free' | 'monthly' | 'yearly' | 'lifetime' | 'trial' | 'code';
export type ServerActivationPlan =
  | 'monthly'
  | 'yearly'
  | 'lifetime'
  | 'business_monthly'
  | 'business_yearly'
  | 'code';

export interface CategorySummary {
  id: string;
  nameAr: string;
  nameEn: string;
  type: string;
}

export interface ScannedReceiptOutput {
  amount: number;
  date: string;
  categoryId: string;
  merchant: string;
  notes: string;
  type: 'expense';
}

export function getLocalTodayDateString(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function sanitizeScanCategories(raw: unknown): CategorySummary[] {
  if (!Array.isArray(raw)) return [];
  const out: CategorySummary[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id.trim().slice(0, 128) : '';
    const type = typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : '';
    if (!id || (type !== 'expense' && type !== 'both')) continue;
    out.push({
      id,
      nameAr: typeof obj.nameAr === 'string' ? obj.nameAr.trim().slice(0, 80) : id,
      nameEn: typeof obj.nameEn === 'string' ? obj.nameEn.trim().slice(0, 80) : id,
      type,
    });
    if (out.length >= 100) break;
  }
  return out;
}

export function validateClientLocalDate(
  raw: unknown,
  serverNow: Date = new Date()
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const candidateUtc = Date.UTC(year, month - 1, day);
  const check = new Date(candidateUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  // Real timezones span UTC-12 to UTC+14 (<= 1 calendar day from server UTC); allow +/- 2 days tolerance.
  const serverTodayUtc = Date.UTC(
    serverNow.getUTCFullYear(),
    serverNow.getUTCMonth(),
    serverNow.getUTCDate()
  );
  const diffDays = Math.abs(candidateUtc - serverTodayUtc) / DAY_MS;
  if (diffDays > 2) return null;

  return trimmed;
}

export function validateScanReceiptPayload(
  body: unknown,
  serverNow: Date = new Date()
):
  | {
      ok: true;
      cleanBase64: string;
      mimeType: string;
      categories: CategorySummary[];
      clientLocalDate: string | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
    } {
  const payload = (body && typeof body === 'object' ? body : {}) as {
    imageBase64?: unknown;
    mimeType?: unknown;
    categories?: unknown;
    clientLocalDate?: unknown;
  };
  const { imageBase64, mimeType, categories, clientLocalDate } = payload;

  if (typeof mimeType !== 'string' || !ALLOWED_SCAN_MIME_TYPES.has(mimeType)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MIME_TYPE',
      message: 'صيغة الصورة غير مدعومة. استخدم JPEG أو PNG أو WebP.',
    };
  }

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_IMAGE',
      message: 'صورة الفاتورة مطلوبة للتحليل.',
    };
  }

  const rawBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
  const cleanBase64 = rawBase64 ? rawBase64.replace(/\s+/g, '') : '';
  if (!cleanBase64 || !/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_IMAGE',
      message: 'بيانات الصورة غير صالحة.',
    };
  }

  const decodedBytes = Buffer.from(cleanBase64, 'base64').byteLength;
  if (decodedBytes <= 0 || decodedBytes > MAX_SCAN_DECODED_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'IMAGE_TOO_LARGE',
      message: 'حجم صورة الفاتورة كبير جداً (الحد الأقصى 2 ميجابايت).',
    };
  }

  return {
    ok: true,
    cleanBase64,
    mimeType,
    categories: sanitizeScanCategories(categories),
    clientLocalDate: validateClientLocalDate(clientLocalDate, serverNow),
  };
}

export function normalizeScannedReceiptResult(
  rawText: string,
  expenseCategories: CategorySummary[],
  fallbackDate: string
): ScannedReceiptOutput {
  const parsed = JSON.parse(rawText) as {
    amount?: unknown;
    date?: unknown;
    categoryId?: unknown;
    merchant?: unknown;
    notes?: unknown;
  };

  const validCategoryIds = new Set(expenseCategories.map((c) => c.id));
  const rawCat = typeof parsed.categoryId === 'string' ? parsed.categoryId.trim() : '';
  const resolvedCategoryId =
    rawCat && (validCategoryIds.size === 0 || validCategoryIds.has(rawCat))
      ? rawCat
      : expenseCategories.find((c) => c.id === 'cat-other')?.id ||
        expenseCategories[0]?.id ||
        'cat-other';

  const dateStr = typeof parsed.date === 'string' ? parsed.date.trim() : '';
  const dateMatch = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);

  return {
    amount:
      typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) && parsed.amount > 0
        ? Math.round(parsed.amount * 1000) / 1000
        : 0,
    date: dateMatch ? dateStr : fallbackDate,
    categoryId: resolvedCategoryId,
    merchant: typeof parsed.merchant === 'string' ? parsed.merchant.trim().slice(0, 60) : '',
    notes: typeof parsed.notes === 'string' ? parsed.notes.trim().slice(0, 120) : '',
    type: 'expense',
  };
}

export function resolveActivationPlanDetails(
  plan?: string,
  options?: { tier?: string; cycle?: string; baseMs?: number; nowMs?: number }
): {
  proPlan: ServerActivationPlan;
  planTier: Exclude<ServerSupportedPlanTier, 'free'>;
  billingCycle: Exclude<ServerSupportedBillingCycle, 'free' | 'trial' | 'code'>;
  expiresAt: number | null;
} {
  const now = options?.nowMs ?? Date.now();
  const base = options?.baseMs && options.baseMs > now ? options.baseMs : now;

  const rawTier = (options?.tier || '').trim().toLowerCase();
  const rawCycle = (options?.cycle || '').trim().toLowerCase();
  const normalizedPlan = typeof plan === 'string' ? plan.trim().toLowerCase() : '';

  if (rawTier) {
    if (rawTier === 'business' || rawTier === 'business_pro') {
      if (rawCycle === 'monthly') {
        return {
          proPlan: 'business_monthly',
          planTier: 'business_pro',
          billingCycle: 'monthly',
          expiresAt: base + 30 * DAY_MS,
        };
      }
      if (rawCycle === 'yearly') {
        return {
          proPlan: 'business_yearly',
          planTier: 'business_pro',
          billingCycle: 'yearly',
          expiresAt: base + 365 * DAY_MS,
        };
      }
      if (rawCycle === 'lifetime') {
        return {
          proPlan: 'code',
          planTier: 'business_pro',
          billingCycle: 'lifetime',
          expiresAt: null,
        };
      }
      if (rawCycle) {
        throw new Error('INVALID_PLAN');
      }
    } else if (rawTier === 'personal' || rawTier === 'personal_pro' || rawTier === 'pro') {
      if (rawCycle === 'monthly') {
        return {
          proPlan: 'monthly',
          planTier: 'personal_pro',
          billingCycle: 'monthly',
          expiresAt: base + 30 * DAY_MS,
        };
      }
      if (rawCycle === 'yearly') {
        return {
          proPlan: 'yearly',
          planTier: 'personal_pro',
          billingCycle: 'yearly',
          expiresAt: base + 365 * DAY_MS,
        };
      }
      if (rawCycle === 'lifetime') {
        return {
          proPlan: 'lifetime',
          planTier: 'personal_pro',
          billingCycle: 'lifetime',
          expiresAt: null,
        };
      }
      if (rawCycle) {
        throw new Error('INVALID_PLAN');
      }
    } else {
      throw new Error('INVALID_PLAN');
    }
  }

  let canonicalPlan = normalizedPlan;
  if (!canonicalPlan && rawTier) {
    if (rawTier === 'business' || rawTier === 'business_pro') {
      canonicalPlan = 'business_monthly';
    } else if (rawTier === 'personal' || rawTier === 'personal_pro' || rawTier === 'pro') {
      canonicalPlan = 'lifetime';
    }
  }

  switch (canonicalPlan) {
    case 'monthly':
      return {
        proPlan: 'monthly',
        planTier: 'personal_pro',
        billingCycle: 'monthly',
        expiresAt: base + 30 * DAY_MS,
      };
    case 'yearly':
      return {
        proPlan: 'yearly',
        planTier: 'personal_pro',
        billingCycle: 'yearly',
        expiresAt: base + 365 * DAY_MS,
      };
    case 'business_monthly':
      return {
        proPlan: 'business_monthly',
        planTier: 'business_pro',
        billingCycle: 'monthly',
        expiresAt: base + 30 * DAY_MS,
      };
    case 'business_yearly':
      return {
        proPlan: 'business_yearly',
        planTier: 'business_pro',
        billingCycle: 'yearly',
        expiresAt: base + 365 * DAY_MS,
      };
    case 'lifetime':
      return {
        proPlan: 'lifetime',
        planTier: 'personal_pro',
        billingCycle: 'lifetime',
        expiresAt: null,
      };
    case 'code':
      return {
        proPlan: 'code',
        planTier: 'personal_pro',
        billingCycle: 'lifetime',
        expiresAt: null,
      };
    default:
      throw new Error('INVALID_PLAN');
  }
}

export function validateWebhookOrgPlanMatch(
  planTier: ServerSupportedPlanTier,
  orgId?: string | null
): boolean {
  if (!orgId || !orgId.trim()) return true;
  return planTier === 'business_pro';
}

export function parseAdminEmailsEnv(raw?: string): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const clean = part.trim().toLowerCase();
    if (clean && clean.includes('@')) {
      out.add(clean);
    }
  }
  return out;
}

export function getEffectiveAdminAllowlist(raw?: string): Set<string> {
  const parsed = parseAdminEmailsEnv(raw);
  if (parsed.size === 0 || parsed.has(PRIMARY_SYSTEM_ADMIN_EMAIL)) {
    return new Set([PRIMARY_SYSTEM_ADMIN_EMAIL]);
  }
  return new Set([PRIMARY_SYSTEM_ADMIN_EMAIL]);
}

export function isServerAdminUser(
  decoded?: {
    email?: unknown;
    email_verified?: unknown;
    admin?: unknown;
  } | null,
  adminEmailsEnv?: string
): boolean {
  if (!decoded || decoded.email_verified !== true) return false;
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!email || !isPrimarySystemAdminEmail(email)) return false;

  const allowlist = getEffectiveAdminAllowlist(adminEmailsEnv);
  return allowlist.has(email) || decoded.admin === true;
}

export function validateNewAdminPin(pin: unknown):
  | { ok: true; pin: string }
  | { ok: false; error: string; message: string } {
  if (typeof pin !== 'string') {
    return {
      ok: false,
      error: 'INVALID_PIN_FORMAT',
      message: 'الرمز السري يجب أن يكون نصاً مكوناً من 4 إلى 32 حرفاً أو رقماً.',
    };
  }
  const trimmed = pin.trim();
  if (trimmed.length < 4 || trimmed.length > 32) {
    return {
      ok: false,
      error: 'INVALID_PIN_LENGTH',
      message: 'يجب أن يتكون الرمز السري من 4 إلى 32 حرفاً أو رقماً.',
    };
  }
  return { ok: true, pin: trimmed };
}

export function hashAdminPinServer(pin: string): string {
  const cleanPin = pin.trim();
  if (cleanPin.length < 4 || cleanPin.length > 32) {
    throw new Error('INVALID_PIN_LENGTH');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(cleanPin, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyAdminPinHashServer(pin: string, storedHash?: string | null): boolean {
  if (typeof pin !== 'string' || typeof storedHash !== 'string') return false;
  const cleanPin = pin.trim();
  const cleanHash = storedHash.trim();
  if (!cleanPin || !cleanHash) return false;

  const parts = cleanHash.split('$');
  if (parts.length === 3 && parts[0] === 'scrypt') {
    const [, salt, expectedHex] = parts;
    if (!/^[0-9a-f]{32}$/i.test(salt) || !/^[0-9a-f]{128}$/i.test(expectedHex)) {
      return false;
    }

    try {
      const derived = crypto.scryptSync(cleanPin, salt, 64);
      const expected = Buffer.from(expectedHex, 'hex');
      if (derived.length !== expected.length) return false;
      return crypto.timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  if (parts.length === 4 && parts[0] === 'pbkdf2' && parts[1] === '100000') {
    const [, , salt, expectedHex] = parts;
    if (!/^[0-9a-f]{32}$/i.test(salt) || !/^[0-9a-f]{64}$/i.test(expectedHex)) {
      return false;
    }

    try {
      const derived = crypto.pbkdf2Sync(cleanPin, salt, 100_000, 32, 'sha256');
      const expected = Buffer.from(expectedHex, 'hex');
      if (derived.length !== expected.length) return false;
      return crypto.timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  return false;
}

export function buildAdminCustomClaims(
  existingClaims?: Record<string, unknown> | null
): { changed: boolean; claims: Record<string, unknown> } {
  const base =
    existingClaims && typeof existingClaims === 'object' && !Array.isArray(existingClaims)
      ? { ...existingClaims }
      : {};
  if (base.admin === true) {
    return { changed: false, claims: base };
  }
  return {
    changed: true,
    claims: {
      ...base,
      admin: true,
    },
  };
}

export function verifyTimingSafePasscode(input: string, configuredPasscode?: string): boolean {
  const cleanConfigured = typeof configuredPasscode === 'string' ? configuredPasscode.trim() : '';
  const cleanInput = typeof input === 'string' ? input.trim() : '';
  if (!cleanConfigured || !cleanInput) return false;
  const a = crypto.createHash('sha256').update(cleanInput, 'utf8').digest();
  const b = crypto.createHash('sha256').update(cleanConfigured, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function normalizeOriginString(candidate: string): string | null {
  try {
    const url = new URL(candidate.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowedCorsOrigin(
  origin: string | undefined,
  requestHost: string | undefined,
  protocol: string | undefined,
  env?: { appUrl?: string; allowedOrigins?: string; forwardedHost?: string }
): boolean {
  if (!origin) return true;
  const normalizedOrigin = normalizeOriginString(origin);
  if (!normalizedOrigin) return false;

  const allowed = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);

  const addHostVariants = (rawHost?: string) => {
    if (!rawHost) return;
    for (const part of rawHost.split(',')) {
      const cleanHost = part.trim().toLowerCase();
      if (!cleanHost) continue;
      const proto = (protocol || 'http').toLowerCase() === 'https' ? 'https' : 'http';
      allowed.add(`${proto}://${cleanHost}`);
      allowed.add(`https://${cleanHost}`);
      allowed.add(`http://${cleanHost}`);
    }
  };

  addHostVariants(requestHost);
  addHostVariants(env?.forwardedHost);

  if (env?.appUrl) {
    const parsedApp = normalizeOriginString(env.appUrl);
    if (parsedApp) allowed.add(parsedApp);
  }

  if (env?.allowedOrigins) {
    for (const part of env.allowedOrigins.split(',')) {
      const parsed = normalizeOriginString(part);
      if (parsed) allowed.add(parsed);
    }
  }

  return allowed.has(normalizedOrigin);
}

// =============================================================================
// Server Hardening Pure Helpers (Unit-Testable)
// =============================================================================

export const SAFE_WEBHOOK_ID_REGEX = /^[A-Za-z0-9_-]{1,120}$/;

export function isSafeWebhookId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_WEBHOOK_ID_REGEX.test(value);
}

export function isProductionRuntime(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

export function isPreviewIframeRuntime(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.ALLOW_PREVIEW_IFRAME === 'true') return true;
  if (!isProductionRuntime(env)) return true;
  const appUrl = String(env.APP_URL || '').trim();
  return /ais-(dev|pre)-/i.test(appUrl);
}

/**
 * Resolves the Express `trust proxy` configuration safely per hosting platform.
 * Prevents spoofed `X-Forwarded-For` headers when not behind a managed reverse proxy.
 */
export function resolveTrustProxySetting(
  env: Record<string, string | undefined> = process.env
): boolean | number | string {
  const explicit = typeof env.TRUST_PROXY === 'string' ? env.TRUST_PROXY.trim() : '';
  if (explicit) {
    const lower = explicit.toLowerCase();
    if (lower === 'false' || lower === '0' || lower === 'off') return false;
    if (/^\d+$/.test(lower)) {
      const hops = Number(lower);
      return Math.max(1, Math.min(10, hops));
    }
    if (lower === 'loopback' || lower === 'linklocal' || lower === 'uniquelocal') {
      return lower;
    }
    return explicit;
  }

  // Known single-hop managed reverse proxies (Vercel, Cloud Run, Render, Fly.io)
  if (
    env.VERCEL === '1' ||
    Boolean(env.VERCEL_ENV) ||
    Boolean(env.K_SERVICE) ||
    Boolean(env.RENDER) ||
    Boolean(env.FLY_APP_NAME)
  ) {
    return 1;
  }

  // Default for direct Node/localhost deployments: trust loopback only
  return 'loopback';
}

const ADSTERRA_CSP_HOSTS = [
  'https://bauval.org',
  'https://*.bauval.org',
  'https://araplhn.org',
  'https://*.araplhn.org',
  'https://*.effectivegatecpm.com',
  'https://*.highperformanceformat.com',
  'https://*.adsterratools.com',
];

export function buildCspDirectives(options: {
  isProduction: boolean;
  allowPreviewFraming: boolean;
}): Record<string, string[]> {
  const { isProduction, allowPreviewFraming } = options;

  const connectSrc = [
    "'self'",
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'https://*.firebaseapp.com',
    'https://*.firebasestorage.app',
    'https://*.gstatic.com',
    'https://apis.google.com',
    'https://accounts.google.com',
    'https://open.er-api.com',
    'https://cdn.jsdelivr.net',
    'https://api.frankfurter.dev',
    'https://pagead2.googlesyndication.com',
    'https://*.googlesyndication.com',
    'https://googleads.g.doubleclick.net',
    'https://*.doubleclick.net',
    'https://www.googletagservices.com',
    'https://adservice.google.com',
    'https://*.adtrafficquality.google',
    ...ADSTERRA_CSP_HOSTS,
    'wss:',
  ];

  if (!isProduction) {
    connectSrc.push('ws:');
  }

  const frameAncestors = allowPreviewFraming
    ? [
        "'self'",
        'https://aistudio.google.com',
        'https://*.google.com',
        'https://*.googleusercontent.com',
        'https://*.run.app',
      ]
    : ["'self'"];

  return {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "'unsafe-inline'",
      'https://apis.google.com',
      'https://accounts.google.com',
      'https://www.gstatic.com',
      'https://www.google.com',
      'https://*.firebaseapp.com',
      'https://pagead2.googlesyndication.com',
      'https://*.googlesyndication.com',
      'https://googleads.g.doubleclick.net',
      'https://www.googletagservices.com',
      'https://*.adtrafficquality.google',
      'https://adservice.google.com',
      ...ADSTERRA_CSP_HOSTS,
    ],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://bauval.org', 'https://araplhn.org', 'https:'],
    connectSrc,
    frameSrc: [
      "'self'",
      'https://*.firebaseapp.com',
      'https://accounts.google.com',
      'https://www.google.com',
      'https://googleads.g.doubleclick.net',
      'https://tpc.googlesyndication.com',
      'https://*.googlesyndication.com',
      'https://*.adtrafficquality.google',
      ...ADSTERRA_CSP_HOSTS,
    ],
    frameAncestors,
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  };
}

export function serializeCspDirectives(directives: Record<string, string[]>): string {
  const toKebab = (key: string) => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  return Object.entries(directives)
    .map(([key, values]) => `${toKebab(key)} ${values.join(' ')}`)
    .join('; ');
}

export function resolveAdminSessionSecret(
  envSecret?: string,
  options?: { isProduction?: boolean }
): Buffer {
  const trimmed = typeof envSecret === 'string' ? envSecret.trim() : '';
  if (trimmed.length >= 32) {
    return Buffer.from(trimmed, 'utf8');
  }
  if (options?.isProduction) {
    throw new Error(
      'ADMIN_SESSION_SECRET is required in production and must be at least 32 characters long. Configure ADMIN_SESSION_SECRET in your deployment environment variables.'
    );
  }
  return crypto.randomBytes(32);
}

/**
 * Derive a deterministic cross-instance admin session HMAC signing key so
 * multi-instance Cloud Run / preview deployments never reject a freshly issued
 * admin session token on the next request.
 *
 * Priority:
 * 1. Explicit `ADMIN_SESSION_SECRET` env var (>= 32 chars)
 * 2. Deterministic SHA-256 derived from the Firestore-stored salted `pinHash`
 *    + `projectId` + `databaseId` (identical across all server instances AND
 *    automatically revokes prior sessions whenever the Admin PIN is rotated)
 * 3. Per-process fallback secret
 */
export function deriveCrossInstanceAdminSessionKey(params: {
  envSecret?: string;
  pinHash?: string | null;
  projectId: string;
  databaseId?: string;
  fallbackSecret: Buffer;
}): Buffer {
  const trimmedEnv = typeof params.envSecret === 'string' ? params.envSecret.trim() : '';
  if (trimmedEnv.length >= 32) {
    return Buffer.from(trimmedEnv, 'utf8');
  }
  const cleanHash = typeof params.pinHash === 'string' ? params.pinHash.trim() : '';
  if (cleanHash.length >= 32) {
    return crypto
      .createHash('sha256')
      .update(
        `raseedi-admin-session-v2:${params.projectId}:${params.databaseId || '(default)'}:${cleanHash}`
      )
      .digest();
  }
  return params.fallbackSecret;
}

export function issueSignedAdminSessionToken(
  uid: string,
  signingKey: Buffer,
  ttlMs: number,
  nowMs: number = Date.now()
): { token: string; expiresAt: number } {
  const expiresAt = nowMs + ttlMs;
  const payload = `${uid}.${expiresAt}`;
  const sig = crypto.createHmac('sha256', signingKey).update(payload).digest('hex');
  return { token: `${payload}.${sig}`, expiresAt };
}

export function verifySignedAdminSessionToken(
  token: unknown,
  expectedUid: string,
  candidateKeys: ReadonlyArray<Buffer>,
  nowMs: number = Date.now()
): boolean {
  if (typeof token !== 'string' || !token.trim() || !expectedUid) return false;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return false;
  const [uid, expStr, sig] = parts;
  if (!uid || uid !== expectedUid) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= nowMs) return false;

  const sigBuf = Buffer.from(sig);
  for (const key of candidateKeys) {
    if (!key || key.length === 0) continue;
    const expectedSig = crypto.createHmac('sha256', key).update(`${uid}.${expStr}`).digest('hex');
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

export function isSensitiveRevocationPath(originalUrl: string): boolean {
  return /^\/api\/(admin|delete-account|org\/(delete|transfer-ownership))(\/|\?|$)/.test(
    String(originalUrl || '')
  );
}

const ALLOWED_ORG_SCANNER_ROLES = new Set(['owner', 'admin', 'accountant', 'employee']);

export function isOrgReceiptScannerRole(role: unknown): boolean {
  return typeof role === 'string' && ALLOWED_ORG_SCANNER_ROLES.has(role);
}

