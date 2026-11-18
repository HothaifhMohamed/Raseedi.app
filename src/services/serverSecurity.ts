import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { DAY_MS } from './entitlements';

const ALLOWED_SCAN_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SCAN_DECODED_BYTES = 2_200_000; // ~2.2MB decoded image
const UNSAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const LICENSE_CODE_PREFIX = 'RSD-PRO-';
export const BUSINESS_LICENSE_CODE_PREFIX = 'RSD-BIZ-';

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

export function validateScanReceiptPayload(body: unknown):
  | {
      ok: true;
      cleanBase64: string;
      mimeType: string;
      categories: CategorySummary[];
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
  };
  const { imageBase64, mimeType, categories } = payload;

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

export function isServerAdminUser(
  decoded?: {
    email?: unknown;
    email_verified?: unknown;
    admin?: unknown;
  } | null,
  adminEmailsEnv?: string
): boolean {
  if (!decoded || decoded.email_verified !== true) return false;
  if (decoded.admin === true) return true;
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!email) return false;
  const allowlist = parseAdminEmailsEnv(adminEmailsEnv);
  return allowlist.has(email);
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
  env?: { appUrl?: string; allowedOrigins?: string }
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

  if (requestHost && requestHost.trim()) {
    const cleanHost = requestHost.trim().toLowerCase();
    const proto = (protocol || 'http').toLowerCase() === 'https' ? 'https' : 'http';
    allowed.add(`${proto}://${cleanHost}`);
    allowed.add(`https://${cleanHost}`);
    allowed.add(`http://${cleanHost}`);
  }

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

export function hashLicenseCodeServer(rawCode: string): string {
  const normalized = String(rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
  return crypto
    .createHash('sha256')
    .update(`raseedi-license:${normalized}`)
    .digest('hex');
}

function randomAlphabetSegment(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += UNSAFE_ALPHABET[bytes[i] % UNSAFE_ALPHABET.length];
  }
  return out;
}

export function generateRandomLicenseCodeServer(params: {
  tier: 'pro' | 'business';
  cycle: 'monthly' | 'yearly' | 'lifetime';
}): {
  code: string;
  codeHash: string;
  codePreview: string;
  tier: 'pro' | 'business';
  planTier: 'personal_pro' | 'business_pro';
  proPlan: ServerActivationPlan;
  cycle: 'monthly' | 'yearly' | 'lifetime';
} {
  const tier = params.tier === 'business' ? 'business' : 'pro';
  const cycle =
    params.cycle === 'monthly' || params.cycle === 'yearly' || params.cycle === 'lifetime'
      ? params.cycle
      : 'yearly';
  const prefix = tier === 'business' ? BUSINESS_LICENSE_CODE_PREFIX : LICENSE_CODE_PREFIX;
  const seg1 = randomAlphabetSegment(4);
  const seg2 = randomAlphabetSegment(4);
  const seg3 = randomAlphabetSegment(4);
  const code = `${prefix}${seg1}-${seg2}-${seg3}`;
  const codeHash = hashLicenseCodeServer(code);
  const codePreview = `${prefix}****-${seg3}`;
  const planTier: 'personal_pro' | 'business_pro' =
    tier === 'business' ? 'business_pro' : 'personal_pro';
  const proPlan: ServerActivationPlan =
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
