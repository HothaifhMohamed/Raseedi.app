import express, { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp, getApps, cert, App as FirebaseAdminApp } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { PRICING_CONFIG } from './src/config/pricing';
import {
  DAY_MS,
  computeOrgSeatLimit,
  computeOrgSubscriptionState,
} from './src/services/entitlements';
import {
  createStarterOrgCategories,
  createStarterCostCentersForIndustry,
} from './src/services/db';
import { toMinor } from './src/services/currency';
import type {
  OrganizationIndustry,
  OrganizationRole,
  Wallet,
} from './src/types';
import {
  commitFirestoreWriteWithToken,
  fetchFirestoreDocumentWithToken,
  isFirestorePermissionDeniedError,
  listFirestoreDocumentsWithToken,
} from './src/services/firestoreRest';
import {
  isPrimarySystemAdminEmail,
  PRIMARY_SYSTEM_ADMIN_EMAIL,
} from './src/services/licenseCodes';
import {
  buildAdminCustomClaims,
  generateRandomLicenseCodeServer,
  getLocalTodayDateString,
  hashAdminPinServer,
  hashLicenseCodeServer,
  isAllowedCorsOrigin,
  isServerAdminUser,
  normalizeScannedReceiptResult,
  resolveActivationPlanDetails,
  ServerActivationPlan,
  ServerSupportedBillingCycle,
  ServerSupportedPlanTier,
  validateNewAdminPin,
  validateScanReceiptPayload,
  validateWebhookOrgPlanMatch,
  verifyAdminPinHashServer,
  verifyTimingSafePasscode,
} from './src/services/serverSecurity';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_SCAN_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
const ADMIN_SESSION_SECRET = crypto.randomBytes(32);
const ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;
const VALID_ORG_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_INDUSTRIES = new Set<OrganizationIndustry>([
  'retail',
  'restaurant',
  'tech',
  'construction',
  'medical',
  'general',
]);
const INVITABLE_ROLES = new Set<Exclude<OrganizationRole, 'owner'>>([
  'admin',
  'accountant',
  'employee',
  'viewer',
]);
const MANAGEABLE_ROLES = new Set<Exclude<OrganizationRole, 'owner'>>([
  'admin',
  'accountant',
  'employee',
  'viewer',
]);

type SupportedPlanTier = ServerSupportedPlanTier;
type SupportedBillingCycle = ServerSupportedBillingCycle;
type SupportedActivationPlan = ServerActivationPlan;

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig {
  const candidates = [
    path.resolve(__dirname, 'firebase-applet-config.json'),
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, 'utf8')) as FirebaseAppletConfig;
    }
  }
  throw new Error('firebase-applet-config.json not found');
}

const firebaseConfig = loadFirebaseAppletConfig();

function getAdminApp(): FirebaseAdminApp {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (saJson) {
    const parsed = JSON.parse(saJson);
    return initializeApp({
      credential: cert(parsed),
      projectId: firebaseConfig.projectId,
    });
  }

  return initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminApp = getAdminApp();
const adminAuth = getAuth(adminApp);
const adminDb = firebaseConfig.firestoreDatabaseId
  ? getFirestore(adminApp, firebaseConfig.firestoreDatabaseId)
  : getFirestore(adminApp);

interface AuthenticatedRequest extends Request {
  authUser?: DecodedIdToken;
}

let adminDbReady = true;

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice('Bearer '.length).trim();
}

async function probeAdminDbAccess(): Promise<boolean> {
  try {
    await adminDb.collection('users').limit(1).get();
    adminDbReady = true;
    return true;
  } catch (err) {
    if (isFirestorePermissionDeniedError(err)) {
      adminDbReady = false;
      console.info(
        'Firebase Admin Firestore permissions unavailable in runtime; using user-token & local-first fallbacks.'
      );
      return false;
    }
    return adminDbReady;
  }
}

function respondCloudAdminUnavailable(res: Response, fallbackMessage?: string): void {
  res.status(503).json({
    error: 'CLOUD_ADMIN_UNAVAILABLE',
    fallback: 'local_first',
    message:
      fallbackMessage ||
      'خدمة الإدارة السحابية غير مفعلة على هذا الخادم؛ يتم الحفظ محلياً وفي نسختك السحابية.',
  });
}

function isAdminRequestUser(authUser?: DecodedIdToken): boolean {
  return isServerAdminUser(
    authUser,
    process.env.ADMIN_EMAILS || PRIMARY_SYSTEM_ADMIN_EMAIL
  );
}

interface AdminPanelPinState {
  pinHash: string | null;
  source: 'firestore' | 'env' | 'unset';
  updatedAtMs: number | null;
}

let cachedAdminPinState: { pinHash: string; updatedAtMs: number } | null = null;

function getBootstrapEnvPasscode(): string {
  return (process.env.ADMIN_PASSCODE || process.env.ADMIN_PANEL_PASSCODE || '').trim();
}

async function loadAdminPanelPinState(adminIdToken?: string): Promise<AdminPanelPinState> {
  if (adminDbReady) {
    try {
      const snap = await adminDb.collection('adminSecurity').doc('panelConfig').get();
      if (snap.exists) {
        const data = snap.data() as Record<string, unknown> | undefined;
        const pinHash = typeof data?.pinHash === 'string' ? data.pinHash.trim() : '';
        const updatedAtMs =
          typeof data?.updatedAtMs === 'number' && Number.isFinite(data.updatedAtMs)
            ? data.updatedAtMs
            : null;
        if (pinHash) {
          cachedAdminPinState = { pinHash, updatedAtMs: updatedAtMs || Date.now() };
          return { pinHash, source: 'firestore', updatedAtMs };
        }
      }
    } catch (err) {
      if (isFirestorePermissionDeniedError(err)) {
        adminDbReady = false;
      }
    }
  }

  if (!adminDbReady && adminIdToken) {
    const restDoc = await fetchFirestoreDocumentWithToken({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      documentPath: 'adminSecurity/panelConfig',
      idToken: adminIdToken,
    });
    if (restDoc.exists && restDoc.data) {
      const pinHash = typeof restDoc.data.pinHash === 'string' ? restDoc.data.pinHash.trim() : '';
      const updatedAtMs =
        typeof restDoc.data.updatedAtMs === 'number' && Number.isFinite(restDoc.data.updatedAtMs)
          ? restDoc.data.updatedAtMs
          : null;
      if (pinHash) {
        cachedAdminPinState = { pinHash, updatedAtMs: updatedAtMs || Date.now() };
        return { pinHash, source: 'firestore', updatedAtMs };
      }
    }
  }

  if (cachedAdminPinState?.pinHash) {
    return {
      pinHash: cachedAdminPinState.pinHash,
      source: 'firestore',
      updatedAtMs: cachedAdminPinState.updatedAtMs,
    };
  }

  const envPasscode = getBootstrapEnvPasscode();
  if (envPasscode) {
    return { pinHash: null, source: 'env', updatedAtMs: null };
  }

  return { pinHash: null, source: 'unset', updatedAtMs: null };
}

async function saveAdminPanelPinHash(params: {
  uid: string;
  email: string;
  pinHash: string;
  adminIdToken?: string;
}): Promise<{ ok: boolean; updatedAtMs: number; persistedToCloud: boolean; error?: string }> {
  const now = Date.now();
  const cleanEmail = params.email.trim().toLowerCase();

  if (adminDbReady) {
    try {
      const ref = adminDb.collection('adminSecurity').doc('panelConfig');
      const existingSnap = await ref.get();
      await ref.set(
        {
          pinHash: params.pinHash,
          updatedByUid: params.uid,
          updatedByEmail: cleanEmail,
          updatedAtMs: now,
          ...(existingSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      cachedAdminPinState = { pinHash: params.pinHash, updatedAtMs: now };
      return { ok: true, updatedAtMs: now, persistedToCloud: true };
    } catch (err) {
      if (isFirestorePermissionDeniedError(err)) {
        adminDbReady = false;
      } else {
        throw err;
      }
    }
  }

  if (params.adminIdToken) {
    const existingRest = await fetchFirestoreDocumentWithToken({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      documentPath: 'adminSecurity/panelConfig',
      idToken: params.adminIdToken,
    });
    const isNew = !existingRest.exists;
    const writeRes = await commitFirestoreWriteWithToken({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      documentPath: 'adminSecurity/panelConfig',
      idToken: params.adminIdToken,
      data: {
        pinHash: params.pinHash,
        updatedByUid: params.uid,
        updatedByEmail: cleanEmail,
        updatedAtMs: now,
      },
      updateMaskFields: [
        'pinHash',
        'updatedByUid',
        'updatedByEmail',
        'updatedAtMs',
        ...(isNew ? ['createdAt'] : []),
        'updatedAt',
      ],
      serverTimestampFields: isNew ? ['createdAt', 'updatedAt'] : ['updatedAt'],
    });
    if (writeRes.ok) {
      cachedAdminPinState = { pinHash: params.pinHash, updatedAtMs: now };
      return { ok: true, updatedAtMs: now, persistedToCloud: true };
    }
    return {
      ok: false,
      updatedAtMs: now,
      persistedToCloud: false,
      error: writeRes.errorText || `HTTP_${writeRes.status || 500}`,
    };
  }

  return {
    ok: false,
    updatedAtMs: now,
    persistedToCloud: false,
    error: 'MISSING_ADMIN_CREDENTIALS',
  };
}

async function verifyActiveAdminPin(
  suppliedPin: string,
  pinState: AdminPanelPinState
): Promise<boolean> {
  if (pinState.pinHash) {
    return verifyAdminPinHashServer(suppliedPin, pinState.pinHash);
  }
  const envPasscode = getBootstrapEnvPasscode();
  if (envPasscode) {
    return verifyTimingSafePasscode(suppliedPin, envPasscode);
  }
  return false;
}

async function ensureAdminCustomClaim(authUser?: DecodedIdToken): Promise<{
  synced: boolean;
  claimsUpdated: boolean;
}> {
  if (!authUser || authUser.email_verified !== true || !isAdminRequestUser(authUser)) {
    return { synced: false, claimsUpdated: false };
  }
  if (authUser.admin === true) {
    return { synced: true, claimsUpdated: false };
  }

  try {
    const userRecord = await adminAuth.getUser(authUser.uid);
    const { changed, claims } = buildAdminCustomClaims(
      userRecord.customClaims as Record<string, unknown> | undefined
    );
    if (changed) {
      await adminAuth.setCustomUserClaims(authUser.uid, claims);
    }
    return { synced: true, claimsUpdated: true };
  } catch (err) {
    console.warn(
      'Unable to auto-sync admin custom claim (check roles/firebaseauth.admin IAM permission):',
      err instanceof Error ? err.message : err
    );
    return { synced: false, claimsUpdated: false };
  }
}

function issueAdminSessionToken(uid: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  const payload = `${uid}.${expiresAt}`;
  const sig = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(payload)
    .digest('hex');
  return { token: `${payload}.${sig}`, expiresAt };
}

function verifyAdminSessionToken(token: unknown, expectedUid: string): boolean {
  if (typeof token !== 'string' || !token.trim()) return false;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return false;
  const [uid, expStr, sig] = parts;
  if (!uid || uid !== expectedUid) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;
  const expectedSig = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(`${uid}.${expStr}`)
    .digest('hex');
  if (sig.length !== expectedSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
}

// Persistent per-UID brute-force lock for /api/org/join (5 failures -> 15 min block)
async function checkJoinLockInDb(uid: string): Promise<number> {
  if (!adminDbReady) return 0;
  try {
    const ref = adminDb.collection('joinRateLimits').doc(uid);
    const snap = await ref.get();
    if (!snap.exists) return 0;
    const lockedUntil = Number(snap.data()?.lockedUntil || 0);
    if (lockedUntil > Date.now()) {
      return Math.ceil((lockedUntil - Date.now()) / 1000);
    }
    return 0;
  } catch {
    return 0;
  }
}

async function recordJoinFailureInDb(uid: string): Promise<void> {
  if (!adminDbReady) return;
  try {
    const ref = adminDb.collection('joinRateLimits').doc(uid);
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? Number(snap.data()?.failedCount || 0) : 0;
      const nextCount = current + 1;
      const now = Date.now();
      if (nextCount >= 5) {
        tx.set(ref, {
          failedCount: 0,
          lockedUntil: now + 15 * 60 * 1000,
          updatedAt: now,
        });
      } else {
        tx.set(ref, {
          failedCount: nextCount,
          lockedUntil: 0,
          updatedAt: now,
        });
      }
    });
  } catch {
    // Best-effort rate limit persistence
  }
}

async function clearJoinFailuresInDb(uid: string): Promise<void> {
  if (!adminDbReady) return;
  try {
    await adminDb.collection('joinRateLimits').doc(uid).delete();
  } catch {
    // Ignore cleanup errors
  }
}

function getUtcMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function hashActivationCodeServer(rawCode: string): string {
  return hashLicenseCodeServer(rawCode);
}

function hashInviteCodeServer(rawCode: string): string {
  const normalized = rawCode.trim().toUpperCase();
  return crypto
    .createHash('sha256')
    .update(`raseedi-org-invite:${normalized}`)
    .digest('hex');
}

function generateReadableInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `RSD-${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

function resolveUserEntitlement(userData?: Record<string, unknown>): {
  isPro: boolean;
  planTier: SupportedPlanTier;
  billingCycle: SupportedBillingCycle;
  expiresAt: number | null;
  scanLimit: number;
} {
  if (!userData || !userData.isPro) {
    return {
      isPro: false,
      planTier: 'free',
      billingCycle: 'free',
      expiresAt: null,
      scanLimit: PRICING_CONFIG.free.monthlyAiScans,
    };
  }

  const expiresAtRaw = userData.proExpiresAt ?? userData.expiresAt;
  const expiresAt = typeof expiresAtRaw === 'number' && Number.isFinite(expiresAtRaw) ? expiresAtRaw : null;
  if (expiresAt !== null && expiresAt <= Date.now()) {
    return {
      isPro: false,
      planTier: 'free',
      billingCycle: 'free',
      expiresAt,
      scanLimit: PRICING_CONFIG.free.monthlyAiScans,
    };
  }

  const rawPlan = String(userData.proPlan || '').trim().toLowerCase();
  const rawTier = String(userData.planTier || '').trim().toLowerCase();
  const isBusiness =
    rawTier === 'business_pro' ||
    rawTier === 'business' ||
    rawPlan === 'business_monthly' ||
    rawPlan === 'business_yearly' ||
    rawPlan === 'trial';

  const planTier: SupportedPlanTier = isBusiness ? 'business_pro' : 'personal_pro';
  const billingCycle: SupportedBillingCycle =
    userData.billingCycle === 'monthly' ||
    userData.billingCycle === 'yearly' ||
    userData.billingCycle === 'lifetime' ||
    userData.billingCycle === 'trial'
      ? userData.billingCycle
      : rawPlan === 'yearly' || rawPlan === 'business_yearly'
      ? 'yearly'
      : rawPlan === 'monthly' || rawPlan === 'business_monthly'
      ? 'monthly'
      : rawPlan === 'trial'
      ? 'trial'
      : 'lifetime';

  return {
    isPro: true,
    planTier,
    billingCycle,
    expiresAt,
    scanLimit: isBusiness
      ? PRICING_CONFIG.businessPro.monthlyAiScans
      : PRICING_CONFIG.personalPro.monthlyAiScans,
  };
}

async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'يجب تسجيل الدخول بحساب جوجل للمتابعة.',
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'رمز المصادقة مفقود.',
    });
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.authUser = decoded;
    next();
  } catch (err) {
    console.warn('Auth token verification failed:', err instanceof Error ? err.message : err);
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'انتهت صلاحية الجلسة أو الرمز غير صالح. أعد تسجيل الدخول.',
    });
  }
}

async function createApp() {
  await probeAdminDbAccess();
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const host = req.get('host') || undefined;
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
      .split(',')[0]
      .trim();

    if (
      !isAllowedCorsOrigin(origin, host, proto, {
        appUrl: process.env.APP_URL,
        allowedOrigins: process.env.ALLOWED_ORIGINS,
      })
    ) {
      res.status(403).json({
        error: 'CORS_FORBIDDEN',
        message: 'Origin not allowed',
      });
      return;
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Admin-Session'
      );
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  const scanIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'RATE_LIMITED',
      message: 'تم إرسال طلبات كثيرة خلال فترة قصيرة. انتظر قليلاً وحاول مجدداً.',
    },
  });

  const scanUidLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) =>
      (req as AuthenticatedRequest).authUser?.uid || ipKeyGenerator(req.ip || '127.0.0.1'),
    message: {
      error: 'RATE_LIMITED',
      message: 'تجاوزت الحد المسموح لطلبات المسح في الدقيقة. انتظر لحظة.',
    },
  });

  const redeemIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'RATE_LIMITED',
      message: 'محاولات كثيرة. يرجى المحاولة بعد عدة دقائق.',
    },
  });

  const orgWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) =>
      (req as AuthenticatedRequest).authUser?.uid || ipKeyGenerator(req.ip || '127.0.0.1'),
    message: {
      error: 'RATE_LIMITED',
      message: 'تم إرسال طلبات إدارة مؤسسة كثيرة. انتظر قليلاً وحاول مجدداً.',
    },
  });

  const joinIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'RATE_LIMITED',
      message: 'محاولات انضمام كثيرة. يرجى المحاولة بعد 15 دقيقة.',
    },
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'raseedi-server', cloudAdminReady: adminDbReady });
  });

  const resolveScanQuotaViaUserToken = async (
    uid: string,
    orgId: string,
    month: string,
    idToken: string
  ): Promise<{
    status: number;
    body: Record<string, unknown>;
  }> => {
    if (orgId) {
      const [orgDoc, memberDoc, quotaDoc] = await Promise.all([
        fetchFirestoreDocumentWithToken({
          projectId: firebaseConfig.projectId,
          databaseId: firebaseConfig.firestoreDatabaseId,
          documentPath: `organizations/${orgId}`,
          idToken,
        }),
        fetchFirestoreDocumentWithToken({
          projectId: firebaseConfig.projectId,
          databaseId: firebaseConfig.firestoreDatabaseId,
          documentPath: `organizations/${orgId}/members/${uid}`,
          idToken,
        }),
        fetchFirestoreDocumentWithToken({
          projectId: firebaseConfig.projectId,
          databaseId: firebaseConfig.firestoreDatabaseId,
          documentPath: `organizations/${orgId}/scanQuotas/${month}`,
          idToken,
        }),
      ]);

      if (orgDoc.exists && memberDoc.exists && memberDoc.data?.status === 'active') {
        const subState = computeOrgSubscriptionState(orgDoc.data as Record<string, unknown>);
        const usedFromDoc = quotaDoc.exists ? Number(quotaDoc.data?.count || 0) : 0;
        const usedFromOrg =
          orgDoc.data?.aiScansMonth === month ? Number(orgDoc.data?.aiScansUsed || 0) : 0;
        const used = Math.max(0, usedFromDoc || usedFromOrg);
        return {
          status: 200,
          body: {
            month,
            used,
            limit: subState.monthlyScanLimit,
            remaining: Math.max(0, subState.monthlyScanLimit - used),
            isPro: !subState.isReadOnly,
            planTier: subState.planTier,
            expiresAt: subState.expiresAt,
            proExpiresAt: subState.expiresAt,
            orgId,
          },
        };
      }

      if (orgDoc.forbidden || (memberDoc.exists && memberDoc.data?.status !== 'active')) {
        return {
          status: 403,
          body: { error: 'FORBIDDEN', message: 'لست عضواً نشطاً في هذه المؤسسة.' },
        };
      }
    }

    const [userDoc, quotaDoc] = await Promise.all([
      fetchFirestoreDocumentWithToken({
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        documentPath: `users/${uid}`,
        idToken,
      }),
      fetchFirestoreDocumentWithToken({
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        documentPath: `users/${uid}/scanQuotas/${month}`,
        idToken,
      }),
    ]);

    const entitlement = resolveUserEntitlement(userDoc.exists ? userDoc.data : undefined);
    const used = quotaDoc.exists ? Math.max(0, Number(quotaDoc.data?.count || 0)) : 0;
    return {
      status: 200,
      body: {
        month,
        used,
        limit: entitlement.scanLimit,
        remaining: Math.max(0, entitlement.scanLimit - used),
        isPro: entitlement.isPro,
        planTier: entitlement.planTier,
        expiresAt: entitlement.expiresAt,
        proExpiresAt: entitlement.expiresAt,
      },
    };
  };

  app.get(
    '/api/scan-quota',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const orgId = typeof req.query.orgId === 'string' ? req.query.orgId.trim() : '';
      const month = getUtcMonthKey();
      const idToken = extractBearerToken(req);

      if (orgId && !VALID_ORG_ID_REGEX.test(orgId)) {
        res.status(400).json({ error: 'INVALID_ORG_ID', message: 'معرف المؤسسة غير صالح.' });
        return;
      }

      if (!adminDbReady) {
        const restResult = await resolveScanQuotaViaUserToken(uid, orgId, month, idToken);
        res.status(restResult.status).json(restResult.body);
        return;
      }

      try {
        if (orgId) {
          const [orgSnap, memberSnap, quotaSnap] = await Promise.all([
            adminDb.collection('organizations').doc(orgId).get(),
            adminDb.collection('organizations').doc(orgId).collection('members').doc(uid).get(),
            adminDb.collection('organizations').doc(orgId).collection('scanQuotas').doc(month).get(),
          ]);
          if (!orgSnap.exists || !memberSnap.exists || memberSnap.data()?.status !== 'active') {
            res.status(403).json({ error: 'FORBIDDEN', message: 'لست عضواً نشطاً في هذه المؤسسة.' });
            return;
          }
          const subState = computeOrgSubscriptionState(orgSnap.data() as Record<string, unknown>);
          const used = Math.max(0, Number(quotaSnap.data()?.count || 0));
          res.json({
            month,
            used,
            limit: subState.monthlyScanLimit,
            remaining: Math.max(0, subState.monthlyScanLimit - used),
            isPro: !subState.isReadOnly,
            planTier: subState.planTier,
            expiresAt: subState.expiresAt,
            proExpiresAt: subState.expiresAt,
            orgId,
          });
          return;
        }

        const [userSnap, quotaSnap] = await Promise.all([
          adminDb.collection('users').doc(uid).get(),
          adminDb.collection('users').doc(uid).collection('scanQuotas').doc(month).get(),
        ]);
        const entitlement = resolveUserEntitlement(userSnap.data());
        const used = Math.max(0, Number(quotaSnap.data()?.count || 0));
        res.json({
          month,
          used,
          limit: entitlement.scanLimit,
          remaining: Math.max(0, entitlement.scanLimit - used),
          isPro: entitlement.isPro,
          planTier: entitlement.planTier,
          expiresAt: entitlement.expiresAt,
          proExpiresAt: entitlement.expiresAt,
        });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          const restResult = await resolveScanQuotaViaUserToken(uid, orgId, month, idToken);
          res.status(restResult.status).json(restResult.body);
          return;
        }
        console.error('Quota lookup error:', err);
        res.status(500).json({ error: 'QUOTA_LOOKUP_FAILED' });
      }
    }
  );

  // Strict 3mb JSON limit on receipt scan endpoint
  app.post(
    '/api/scan-receipt',
    scanIpLimiter,
    express.json({ limit: '3mb' }),
    requireFirebaseAuth,
    scanUidLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const monthKey = getUtcMonthKey();
      let activeQuotaRef = adminDb.collection('users').doc(uid).collection('scanQuotas').doc(monthKey);
      let quotaIncremented = false;
      let targetOrgId = '';

      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          res.status(503).json({
            error: 'GEMINI_API_KEY_MISSING',
            message: 'مفتاح الذكاء الاصطناعي غير مضبوط على الخادم.',
          });
          return;
        }

        const rawOrgId = (req.body as { orgId?: unknown } | undefined)?.orgId;
        targetOrgId = typeof rawOrgId === 'string' ? rawOrgId.trim() : '';
        if (targetOrgId && !VALID_ORG_ID_REGEX.test(targetOrgId)) {
          res.status(400).json({ error: 'INVALID_ORG_ID', message: 'معرف المؤسسة غير صالح.' });
          return;
        }

        const validated = validateScanReceiptPayload(req.body);
        if (validated.ok === false) {
          res.status(validated.status).json({
            error: validated.error,
            message: validated.message,
          });
          return;
        }

        const { cleanBase64, mimeType, categories: expenseCategories } = validated;

        if (targetOrgId) {
          activeQuotaRef = adminDb
            .collection('organizations')
            .doc(targetOrgId)
            .collection('scanQuotas')
            .doc(monthKey);
        }

        // Atomic monthly quota check & increment
        const quotaState = await adminDb.runTransaction(async (tx) => {
          if (targetOrgId) {
            const orgRef = adminDb.collection('organizations').doc(targetOrgId);
            const memberRef = orgRef.collection('members').doc(uid);
            const [orgSnap, memberSnap, quotaSnap] = await Promise.all([
              tx.get(orgRef),
              tx.get(memberRef),
              tx.get(activeQuotaRef),
            ]);

            if (!orgSnap.exists || !memberSnap.exists || memberSnap.data()?.status !== 'active') {
              return { forbidden: true as const };
            }
            const subState = computeOrgSubscriptionState(orgSnap.data() as Record<string, unknown>);
            if (subState.isReadOnly) {
              return { readOnly: true as const };
            }

            const currentCount = Math.max(0, Number(quotaSnap.data()?.count || 0));
            if (currentCount >= subState.monthlyScanLimit) {
              return {
                allowed: false as const,
                isPro: true,
                planTier: subState.planTier,
                used: currentCount,
                limit: subState.monthlyScanLimit,
                remaining: 0,
              };
            }

            const nextCount = currentCount + 1;
            tx.set(
              activeQuotaRef,
              {
                month: monthKey,
                count: nextCount,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            tx.update(orgRef, {
              aiScansUsed: nextCount,
              aiScansMonth: monthKey,
            });

            return {
              allowed: true as const,
              isPro: true,
              planTier: subState.planTier,
              used: nextCount,
              limit: subState.monthlyScanLimit,
              remaining: Math.max(0, subState.monthlyScanLimit - nextCount),
            };
          }

          const userRef = adminDb.collection('users').doc(uid);
          const [userSnap, quotaSnap] = await Promise.all([tx.get(userRef), tx.get(activeQuotaRef)]);

          const entitlement = resolveUserEntitlement(userSnap.data());
          const currentCount = Math.max(0, Number(quotaSnap.data()?.count || 0));

          if (currentCount >= entitlement.scanLimit) {
            return {
              allowed: false as const,
              isPro: entitlement.isPro,
              planTier: entitlement.planTier,
              used: currentCount,
              limit: entitlement.scanLimit,
              remaining: 0,
            };
          }

          const nextCount = currentCount + 1;
          tx.set(
            activeQuotaRef,
            {
              month: monthKey,
              count: nextCount,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          return {
            allowed: true as const,
            isPro: entitlement.isPro,
            planTier: entitlement.planTier,
            used: nextCount,
            limit: entitlement.scanLimit,
            remaining: Math.max(0, entitlement.scanLimit - nextCount),
          };
        });

        if ('forbidden' in quotaState && quotaState.forbidden) {
          res.status(403).json({
            error: 'FORBIDDEN',
            message: 'لست عضواً نشطاً في هذه المؤسسة.',
          });
          return;
        }
        if ('readOnly' in quotaState && quotaState.readOnly) {
          res.status(403).json({
            error: 'SUBSCRIPTION_READ_ONLY',
            message: 'انتهى اشتراك المؤسسة وفترة السماح. جدد الاشتراك لمتابعة المسح الضوئي.',
          });
          return;
        }

        if (!quotaState.allowed) {
          res.status(429).json({
            error: 'QUOTA_EXCEEDED',
            used: quotaState.used,
            limit: quotaState.limit,
            remaining: 0,
            isPro: quotaState.isPro,
            message: quotaState.isPro
              ? `بلغت الحد الشهري لمسح الفواتير (${quotaState.limit} فاتورة لهذا الشهر).`
              : `استنفدت ${PRICING_CONFIG.free.monthlyAiScans} محاولات مسح مجانية هذا الشهر — قم بالترقية إلى PRO للمتابعة.`,
          });
          return;
        }
        quotaIncremented = true;

        const categoriesGuide = expenseCategories.length
          ? expenseCategories.map((c) => `- "${c.id}": ${c.nameAr} (${c.nameEn})`).join('\n')
          : '- "cat-restaurants": مطاعم\n- "cat-groceries": سوبرماركت\n- "cat-cafes": كافيهات\n- "cat-bills": فواتير\n- "cat-pharmacy": صيدلية\n- "cat-other": أخرى';

        const fallbackDate = getLocalTodayDateString();

        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });

        const response = await ai.models.generateContent({
          model: GEMINI_SCAN_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: `Analyze this receipt or invoice image carefully and extract expense transaction details.
Return JSON matching the schema with:
- amount: Final total paid numeric amount (positive number; if unclear return 0).
- date: Receipt date formatted strictly as YYYY-MM-DD (if not visible, use "${fallbackDate}").
- categoryId: Choose the single best matching id from this exact category list:\n${categoriesGuide}
- merchant: Store, restaurant, pharmacy, or vendor name visible on the receipt (short string, or empty if unclear).
- notes: Short concise summary in Arabic (main items purchased, max 80 chars).
- type: Always "expense".`,
                },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                amount: { type: Type.NUMBER },
                date: { type: Type.STRING },
                categoryId: { type: Type.STRING },
                merchant: { type: Type.STRING },
                notes: { type: Type.STRING },
                type: { type: Type.STRING },
              },
              required: ['amount', 'date', 'categoryId', 'merchant', 'notes', 'type'],
            },
          },
        });

        const rawText = response.text;
        if (!rawText) {
          throw new Error('EMPTY_AI_RESPONSE');
        }

        const normalized = normalizeScannedReceiptResult(rawText, expenseCategories, fallbackDate);

        res.json({
          ...normalized,
          quota: {
            used: quotaState.used,
            limit: quotaState.limit,
            remaining: quotaState.remaining,
            isPro: quotaState.isPro,
          },
        });
      } catch (error) {
        if (quotaIncremented) {
          await adminDb
            .runTransaction(async (tx) => {
              const quotaSnap = await tx.get(activeQuotaRef);
              const currentQuota = Math.max(0, Number(quotaSnap.data()?.count || 0));
              const rolledBackQuota = Math.max(0, currentQuota - 1);
              tx.set(
                activeQuotaRef,
                {
                  month: monthKey,
                  count: rolledBackQuota,
                  updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
              if (targetOrgId) {
                const orgRef = adminDb.collection('organizations').doc(targetOrgId);
                const orgSnap = await tx.get(orgRef);
                if (orgSnap.exists) {
                  const prevOrgUsed = Math.max(0, Number(orgSnap.data()?.aiScansUsed || 0));
                  tx.update(orgRef, {
                    aiScansUsed: Math.max(0, prevOrgUsed - 1),
                    aiScansMonth: monthKey,
                  });
                }
              }
            })
            .catch(() => {});
        }
        if (isFirestorePermissionDeniedError(error)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('Receipt scan error:', error);
        res.status(500).json({
          error: 'SCAN_FAILED',
          message: 'تعذر تحليل الفاتورة عبر الذكاء الاصطناعي. تأكد من وضوح الصورة والاتصال بالإنترنت.',
        });
      }
    }
  );

  // Payment Webhook Handler (Paymob / Fawry / Stripe / Paddle) with HMAC verification & idempotency
  const handlePaymentWebhook = async (req: Request, res: Response) => {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET?.trim();
    if (!secret) {
      res.status(503).json({ error: 'WEBHOOK_SECRET_NOT_CONFIGURED' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const sigHeader = String(req.headers['x-raseedi-signature'] || req.headers['x-signature'] || '');
    const expectedSig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    if (!sigHeader || sigHeader.length !== expectedSig.length) {
      res.status(401).json({ error: 'INVALID_SIGNATURE' });
      return;
    }
    if (!crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expectedSig))) {
      res.status(401).json({ error: 'INVALID_SIGNATURE' });
      return;
    }

    let event: {
      eventId?: string;
      uid?: string;
      orgId?: string;
      plan?: string;
      extraSeats?: number;
      status?: string;
    };
    try {
      event = JSON.parse(rawBody) as typeof event;
    } catch {
      res.status(400).json({ error: 'INVALID_WEBHOOK_PAYLOAD' });
      return;
    }

    if (!event || typeof event !== 'object' || !event.eventId || (!event.uid && !event.orgId) || event.status !== 'paid') {
      res.status(400).json({ error: 'INVALID_WEBHOOK_PAYLOAD' });
      return;
    }

    const orgId = typeof event.orgId === 'string' ? event.orgId.trim() : '';
    if (orgId && !VALID_ORG_ID_REGEX.test(orgId)) {
      res.status(400).json({ error: 'INVALID_WEBHOOK_PAYLOAD' });
      return;
    }

    let planInfo: ReturnType<typeof resolveActivationPlanDetails>;
    try {
      planInfo = resolveActivationPlanDetails(event.plan);
    } catch {
      res.status(400).json({ error: 'INVALID_PLAN' });
      return;
    }

    if (!validateWebhookOrgPlanMatch(planInfo.planTier, orgId)) {
      res.status(400).json({ error: 'PLAN_ORG_MISMATCH' });
      return;
    }

    try {
      const extraSeats = Math.max(0, Math.floor(Number(event.extraSeats || 0)));
      const eventRef = adminDb.collection('paymentWebhooks').doc(event.eventId.slice(0, 120));

      const outcome = await adminDb.runTransaction(async (tx) => {
        const eventSnap = await tx.get(eventRef);
        if (eventSnap.exists) {
          return { duplicate: true };
        }

        const orgRef = orgId ? adminDb.collection('organizations').doc(orgId) : null;
        const orgSnap = orgRef ? await tx.get(orgRef) : null;

        tx.set(eventRef, {
          uid: event.uid || null,
          orgId: orgId || null,
          plan: planInfo.proPlan,
          extraSeats,
          processedAt: FieldValue.serverTimestamp(),
        });

        if (event.uid) {
          const userRef = adminDb.collection('users').doc(event.uid.slice(0, 128));
          tx.set(
            userRef,
            {
              uid: event.uid,
              isPro: true,
              proPlan: planInfo.proPlan,
              planTier: planInfo.planTier,
              billingCycle: planInfo.billingCycle,
              expiresAt: planInfo.expiresAt,
              proExpiresAt: planInfo.expiresAt,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        if (orgRef && orgSnap?.exists) {
          const existingExtra = Number(orgSnap.data()?.extraSeats || 0);
          const nextExtra = Math.max(existingExtra, extraSeats);
          tx.update(orgRef, {
            planTier: 'business_pro',
            billingCycle: planInfo.billingCycle,
            expiresAt: planInfo.expiresAt,
            extraSeats: nextExtra,
            seatLimit: computeOrgSeatLimit(nextExtra),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        return { duplicate: false };
      });

      res.json({ ok: true, duplicate: outcome.duplicate });
    } catch (err) {
      console.error('Payment webhook error:', err);
      res.status(500).json({ error: 'WEBHOOK_PROCESSING_FAILED' });
    }
  };

  app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '64kb' }), handlePaymentWebhook);
  app.post('/api/webhooks/payment', express.raw({ type: 'application/json', limit: '64kb' }), handlePaymentWebhook);

  // Small JSON parser for non-scan API routes
  app.use('/api', express.json({ limit: '64kb' }));

  app.get(
    '/api/admin/status',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const authUser = req.authUser!;
      const isAdmin = isAdminRequestUser(authUser);
      if (!isAdmin) {
        res.json({
          ok: true,
          isAdmin: false,
          pinConfigured: false,
          pinSource: 'unset',
          pinUpdatedAtMs: null,
          customClaimSynced: false,
          claimsUpdated: false,
        });
        return;
      }

      const idToken = extractBearerToken(req);
      const [claimSync, pinState] = await Promise.all([
        ensureAdminCustomClaim(authUser),
        loadAdminPanelPinState(idToken),
      ]);
      res.json({
        ok: true,
        isAdmin: true,
        pinConfigured: pinState.source !== 'unset',
        pinSource: pinState.source,
        pinUpdatedAtMs: pinState.updatedAtMs,
        customClaimSynced: claimSync.synced,
        claimsUpdated: claimSync.claimsUpdated,
      });
    }
  );

  app.post(
    '/api/admin/pin/setup',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const authUser = req.authUser!;
      if (!isAdminRequestUser(authUser)) {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: 'فقط مالك النظام المخول يمكنه ضبط الرمز السري للإدارة.',
        });
        return;
      }

      const idToken = extractBearerToken(req);
      const pinState = await loadAdminPanelPinState(idToken);
      if (pinState.source !== 'unset') {
        res.status(409).json({
          error: 'PIN_ALREADY_CONFIGURED',
          message: 'تم تعيين الرمز السري مسبقاً. افتح لوحة الإدارة لتغييره من الإعدادات.',
        });
        return;
      }

      const validation = validateNewAdminPin(req.body?.newPin);
      if (!validation.ok) {
        res.status(400).json({ error: validation.error, message: validation.message });
        return;
      }

      try {
        const pinHash = hashAdminPinServer(validation.pin);
        const saved = await saveAdminPanelPinHash({
          uid: authUser.uid,
          email: String(authUser.email || PRIMARY_SYSTEM_ADMIN_EMAIL),
          pinHash,
          adminIdToken: idToken,
        });
        if (!saved.ok) {
          res.status(500).json({
            error: 'PIN_SAVE_FAILED',
            message: 'تعذر حفظ الرمز السري المشفر في السحابة. حاول مرة أخرى.',
          });
          return;
        }
        const claimSync = await ensureAdminCustomClaim(authUser);
        const session = issueAdminSessionToken(authUser.uid);
        res.json({
          ok: true,
          adminSessionToken: session.token,
          expiresAt: session.expiresAt,
          pinConfigured: true,
          pinSource: 'firestore',
          pinUpdatedAtMs: saved.updatedAtMs,
          customClaimSynced: claimSync.synced,
          claimsUpdated: claimSync.claimsUpdated,
        });
      } catch (err) {
        console.error('Admin initial PIN setup error:', err);
        res.status(500).json({ error: 'PIN_SETUP_FAILED', message: 'تعذر إعداد الرمز السري حالياً.' });
      }
    }
  );

  app.post(
    '/api/admin/verify-passcode',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const authUser = req.authUser!;
      if (!isAdminRequestUser(authUser)) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'صلاحيات مالك النظام مطلوبة.' });
        return;
      }

      const idToken = extractBearerToken(req);
      const pinState = await loadAdminPanelPinState(idToken);
      if (pinState.source === 'unset') {
        res.status(412).json({
          error: 'ADMIN_PIN_NOT_SET',
          message: 'لم يتم تعيين الرمز السري للوحة الإدارة بعد. قم بتعيين رمز جديد الآن.',
        });
        return;
      }

      const supplied = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
      const valid = await verifyActiveAdminPin(supplied, pinState);
      if (!valid) {
        res.status(403).json({
          error: 'INVALID_PASSCODE',
          message: 'الرمز السري للوحة الإدارة غير صحيح.',
        });
        return;
      }

      const claimSync = await ensureAdminCustomClaim(authUser);
      const session = issueAdminSessionToken(authUser.uid);
      res.json({
        ok: true,
        adminSessionToken: session.token,
        expiresAt: session.expiresAt,
        pinSource: pinState.source,
        pinUpdatedAtMs: pinState.updatedAtMs,
        customClaimSynced: claimSync.synced,
        claimsUpdated: claimSync.claimsUpdated,
      });
    }
  );

  app.post(
    '/api/admin/pin/change',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const authUser = req.authUser!;
      if (!isAdminRequestUser(authUser)) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'صلاحيات مالك النظام مطلوبة.' });
        return;
      }
      if (!verifyAdminSessionToken(req.headers['x-admin-session'], authUser.uid)) {
        res.status(403).json({
          error: 'ADMIN_SESSION_REQUIRED',
          message: 'يتطلب التحقق من رمز مرور الإدارة أولاً.',
        });
        return;
      }

      const idToken = extractBearerToken(req);
      const currentPin = typeof req.body?.currentPin === 'string' ? req.body.currentPin : '';
      const pinState = await loadAdminPanelPinState(idToken);
      if (pinState.source !== 'unset') {
        const currentOk = await verifyActiveAdminPin(currentPin, pinState);
        if (!currentOk) {
          res.status(403).json({
            error: 'INVALID_CURRENT_PIN',
            message: 'الرمز السري الحالي غير صحيح.',
          });
          return;
        }
      }

      const validation = validateNewAdminPin(req.body?.newPin);
      if (!validation.ok) {
        res.status(400).json({ error: validation.error, message: validation.message });
        return;
      }
      if (currentPin.trim() && validation.pin === currentPin.trim()) {
        res.status(400).json({
          error: 'SAME_PIN_NOT_ALLOWED',
          message: 'يجب أن يختلف الرمز السري الجديد عن الرمز الحالي.',
        });
        return;
      }

      try {
        const pinHash = hashAdminPinServer(validation.pin);
        const saved = await saveAdminPanelPinHash({
          uid: authUser.uid,
          email: String(authUser.email || PRIMARY_SYSTEM_ADMIN_EMAIL),
          pinHash,
          adminIdToken: idToken,
        });
        if (!saved.ok) {
          res.status(500).json({
            error: 'PIN_SAVE_FAILED',
            message: 'تعذر حفظ الرمز السري الجديد في السحابة. حاول مرة أخرى.',
          });
          return;
        }

        const refreshedSession = issueAdminSessionToken(authUser.uid);
        res.json({
          ok: true,
          adminSessionToken: refreshedSession.token,
          expiresAt: refreshedSession.expiresAt,
          pinSource: 'firestore',
          updatedAtMs: saved.updatedAtMs,
        });
      } catch (err) {
        console.error('Admin PIN change error:', err);
        res.status(500).json({ error: 'PIN_CHANGE_FAILED', message: 'تعذر تحديث الرمز السري حالياً.' });
      }
    }
  );

  const mapAdminLicenseCodeRow = (docId: string, raw: Record<string, unknown>) => {
    const isUsed = Boolean(raw.used === true || raw.status === 'used' || raw.usedBy);
    return {
      codeHash: String(raw.codeHash || docId),
      codePreview: String(raw.codePreview || 'RSD-****'),
      tier: raw.tier === 'business' ? ('business' as const) : ('pro' as const),
      planTier: raw.planTier === 'business_pro' ? ('business_pro' as const) : ('personal_pro' as const),
      cycle:
        raw.cycle === 'monthly' || raw.cycle === 'yearly' || raw.cycle === 'lifetime'
          ? (raw.cycle as 'monthly' | 'yearly' | 'lifetime')
          : ('yearly' as const),
      status: isUsed ? ('used' as const) : ('unused' as const),
      used: isUsed,
      usedBy: typeof raw.usedBy === 'string' ? raw.usedBy : null,
      usedOrgId: typeof raw.usedOrgId === 'string' ? raw.usedOrgId : null,
      usedAt: typeof raw.usedAt === 'number' ? raw.usedAt : null,
      createdByUid: String(raw.createdByUid || ''),
      createdByEmail: String(raw.createdByEmail || ''),
      createdAtMs: typeof raw.createdAtMs === 'number' ? raw.createdAtMs : Date.now(),
    };
  };

  app.get(
    '/api/admin/license-codes',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const authUser = req.authUser!;
      if (!isAdminRequestUser(authUser)) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'صلاحيات مالك النظام مطلوبة.' });
        return;
      }
      if (!verifyAdminSessionToken(req.headers['x-admin-session'], authUser.uid)) {
        res.status(403).json({
          error: 'ADMIN_SESSION_REQUIRED',
          message: 'يتطلب التحقق من رمز مرور الإدارة أولاً.',
        });
        return;
      }

      if (adminDbReady) {
        try {
          const snap = await adminDb
            .collection('licenseCodes')
            .orderBy('createdAtMs', 'desc')
            .limit(50)
            .get();
          const codes = snap.docs.map((d) =>
            mapAdminLicenseCodeRow(d.id, d.data() as Record<string, unknown>)
          );
          res.json({ ok: true, codes });
          return;
        } catch (err) {
          if (isFirestorePermissionDeniedError(err)) {
            adminDbReady = false;
          } else {
            console.error('Admin list license codes error:', err);
            res.status(500).json({ error: 'LIST_LICENSE_CODES_FAILED' });
            return;
          }
        }
      }

      const idToken = extractBearerToken(req);
      const restRes = await listFirestoreDocumentsWithToken({
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        collectionPath: 'licenseCodes',
        idToken,
        pageSize: 100,
      });
      if (!restRes.ok) {
        if (restRes.forbidden) {
          res.status(403).json({ error: 'FORBIDDEN', message: 'تم رفض قراءة الأكواد من Firestore.' });
          return;
        }
        respondCloudAdminUnavailable(res);
        return;
      }
      const codes = restRes.docs
        .map((d) => mapAdminLicenseCodeRow(d.id, d.data))
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, 50);
      res.json({ ok: true, codes });
    }
  );

  app.post(
    '/api/admin/license-codes',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const authUser = req.authUser!;
      if (!isAdminRequestUser(authUser)) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'صلاحيات مالك النظام مطلوبة.' });
        return;
      }
      if (!verifyAdminSessionToken(req.headers['x-admin-session'], authUser.uid)) {
        res.status(403).json({
          error: 'ADMIN_SESSION_REQUIRED',
          message: 'يتطلب التحقق من رمز مرور الإدارة أولاً.',
        });
        return;
      }

      const rawTier = req.body?.tier === 'business' ? 'business' : 'pro';
      const rawCycle =
        req.body?.cycle === 'monthly' || req.body?.cycle === 'yearly' || req.body?.cycle === 'lifetime'
          ? req.body.cycle
          : 'yearly';
      const targetEmail =
        typeof req.body?.targetEmail === 'string' && req.body.targetEmail.trim()
          ? req.body.targetEmail.trim().toLowerCase().slice(0, 254)
          : null;

      const generated = generateRandomLicenseCodeServer({
        tier: rawTier,
        cycle: rawCycle,
      });
      const now = Date.now();
      const createdByEmail = String(authUser.email || PRIMARY_SYSTEM_ADMIN_EMAIL)
        .trim()
        .toLowerCase()
        .slice(0, 254);

      const baseDocData = {
        codeHash: generated.codeHash,
        codePreview: generated.codePreview,
        plan: generated.proPlan,
        tier: generated.tier,
        planTier: generated.planTier,
        cycle: generated.cycle,
        targetEmail,
        status: 'unused' as const,
        used: false,
        usedBy: null,
        usedOrgId: null,
        usedAt: null,
        createdByUid: authUser.uid,
        createdByEmail,
        createdAtMs: now,
      };

      const responseRecord = {
        codeHash: generated.codeHash,
        codePreview: generated.codePreview,
        tier: generated.tier,
        planTier: generated.planTier,
        cycle: generated.cycle,
        status: 'unused' as const,
        used: false,
        usedBy: null,
        usedOrgId: null,
        usedAt: null,
        createdByUid: authUser.uid,
        createdByEmail,
        createdAtMs: now,
      };

      if (adminDbReady) {
        try {
          await adminDb.collection('licenseCodes').doc(generated.codeHash).set({
            ...baseDocData,
            createdAt: FieldValue.serverTimestamp(),
          });
          res.json({ ok: true, code: generated.code, record: responseRecord });
          return;
        } catch (err) {
          if (isFirestorePermissionDeniedError(err)) {
            adminDbReady = false;
          } else {
            console.error('Admin create license code error:', err);
            res.status(500).json({ error: 'CREATE_LICENSE_CODE_FAILED' });
            return;
          }
        }
      }

      const idToken = extractBearerToken(req);
      const restWrite = await commitFirestoreWriteWithToken({
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        documentPath: `licenseCodes/${generated.codeHash}`,
        idToken,
        data: baseDocData,
        serverTimestampFields: ['createdAt'],
        currentDocumentExists: false,
      });

      if (!restWrite.ok) {
        if (restWrite.forbidden) {
          res.status(403).json({
            error: 'FORBIDDEN',
            message: 'تم رفض حفظ الكود في Firestore. تأكد من الصلاحيات.',
          });
          return;
        }
        respondCloudAdminUnavailable(res);
        return;
      }

      res.json({ ok: true, code: generated.code, record: responseRecord });
    }
  );

  const mapAdminUserRow = (docId: string, data: Record<string, unknown>) => {
    const ent = resolveUserEntitlement(data);
    const rowUid = String(data.uid || docId);
    const rowEmail = String(data.email || '');
    return {
      uid: rowUid,
      email: rowEmail,
      displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
      isAdmin: isPrimarySystemAdminEmail(rowEmail),
      isPro: ent.isPro,
      proActive: ent.isPro,
      planTier: ent.planTier,
      billingCycle: ent.billingCycle,
      startedAt: typeof data.startedAt === 'number' ? data.startedAt : null,
      expiresAt: ent.expiresAt,
      proExpiresAt: ent.expiresAt,
      lastSyncedAt: typeof data.lastSyncedAt === 'number' ? data.lastSyncedAt : undefined,
    };
  };

  app.get(
    '/api/admin/users',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const authUser = req.authUser!;
      if (!isAdminRequestUser(authUser)) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'صلاحيات مالك النظام مطلوبة.' });
        return;
      }
      if (!verifyAdminSessionToken(req.headers['x-admin-session'], authUser.uid)) {
        res.status(403).json({
          error: 'ADMIN_SESSION_REQUIRED',
          message: 'يتطلب التحقق من رمز مرور الإدارة أولاً.',
        });
        return;
      }

      const sortUsers = (users: ReturnType<typeof mapAdminUserRow>[]) =>
        users.sort((a, b) => {
          if (a.isPro !== b.isPro) return a.isPro ? -1 : 1;
          const aTime = a.lastSyncedAt || a.startedAt || 0;
          const bTime = b.lastSyncedAt || b.startedAt || 0;
          if (aTime !== bTime) return bTime - aTime;
          return (a.email || '').localeCompare(b.email || '');
        });

      if (adminDbReady) {
        try {
          const snap = await adminDb.collection('users').limit(200).get();
          const users = sortUsers(
            snap.docs.map((d) => mapAdminUserRow(d.id, d.data() as Record<string, unknown>))
          );
          res.json({ ok: true, users });
          return;
        } catch (err) {
          if (isFirestorePermissionDeniedError(err)) {
            adminDbReady = false;
          } else {
            console.error('Admin list users error:', err);
            res.status(500).json({ error: 'ADMIN_USERS_LIST_FAILED' });
            return;
          }
        }
      }

      const idToken = extractBearerToken(req);
      const restUsers = await listFirestoreDocumentsWithToken({
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        collectionPath: 'users',
        idToken,
        pageSize: 200,
      });
      if (!restUsers.ok) {
        if (restUsers.forbidden) {
          res.status(403).json({ error: 'FORBIDDEN', message: 'تم رفض قراءة قائمة الحسابات من Firestore.' });
          return;
        }
        respondCloudAdminUnavailable(res);
        return;
      }
      const users = sortUsers(restUsers.docs.map((d) => mapAdminUserRow(d.id, d.data)));
      res.json({ ok: true, users });
    }
  );

  app.post(
    '/api/admin/users/:uid/subscription',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const authUser = req.authUser!;
      if (!isAdminRequestUser(authUser)) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'صلاحيات مالك النظام مطلوبة.' });
        return;
      }
      if (!verifyAdminSessionToken(req.headers['x-admin-session'], authUser.uid)) {
        res.status(403).json({
          error: 'ADMIN_SESSION_REQUIRED',
          message: 'يتطلب التحقق من رمز مرور الإدارة أولاً.',
        });
        return;
      }

      const targetUid = typeof req.params?.uid === 'string' ? req.params.uid.trim() : '';
      if (!targetUid || !VALID_ORG_ID_REGEX.test(targetUid)) {
        res.status(400).json({ error: 'INVALID_UID' });
        return;
      }

      const rawTier = String(req.body?.planTier || 'free').trim();
      const rawCycle = String(req.body?.billingCycle || 'free').trim();
      const customDays =
        typeof req.body?.customDays === 'number' && Number.isFinite(req.body.customDays) && req.body.customDays > 0
          ? Math.round(req.body.customDays)
          : null;

      const planTier: SupportedPlanTier =
        rawTier === 'business_pro' ? 'business_pro' : rawTier === 'personal_pro' ? 'personal_pro' : 'free';
      const now = Date.now();
      let jsonFields: Record<string, unknown>;

      if (planTier === 'free' || rawCycle === 'free') {
        jsonFields = {
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
      } else {
        const cycle = rawCycle === 'monthly' || rawCycle === 'yearly' ? rawCycle : 'lifetime';
        const days = cycle === 'monthly' ? customDays ?? 30 : cycle === 'yearly' ? customDays ?? 365 : 0;
        const expiresAt = cycle === 'lifetime' ? null : now + days * DAY_MS;
        const proPlan =
          planTier === 'business_pro'
            ? cycle === 'monthly'
              ? 'business_monthly'
              : cycle === 'yearly'
              ? 'business_yearly'
              : 'code'
            : cycle;
        jsonFields = {
          isPro: true,
          proActive: true,
          planTier,
          proPlan,
          billingCycle: cycle,
          startedAt: now,
          expiresAt,
          proExpiresAt: expiresAt,
          redeemedCouponCode: null,
        };
      }

      if (adminDbReady) {
        try {
          await adminDb
            .collection('users')
            .doc(targetUid)
            .update({
              ...jsonFields,
              updatedAt: FieldValue.serverTimestamp(),
            });
          res.json({
            ok: true,
            uid: targetUid,
            ...jsonFields,
            updatedAt: new Date(now).toISOString(),
          });
          return;
        } catch (err) {
          if (isFirestorePermissionDeniedError(err)) {
            adminDbReady = false;
          } else {
            console.error('Admin update subscription error:', err);
            res.status(500).json({ error: 'ADMIN_UPDATE_SUBSCRIPTION_FAILED' });
            return;
          }
        }
      }

      const idToken = extractBearerToken(req);
      const restUpdate = await commitFirestoreWriteWithToken({
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        documentPath: `users/${targetUid}`,
        idToken,
        data: jsonFields,
        updateMaskFields: [...Object.keys(jsonFields), 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
        currentDocumentExists: true,
      });

      if (!restUpdate.ok) {
        if (restUpdate.forbidden) {
          res.status(403).json({
            error: 'FORBIDDEN',
            message: 'تم رفض تحديث اشتراك المستخدم من Firestore.',
          });
          return;
        }
        respondCloudAdminUnavailable(res);
        return;
      }

      res.json({
        ok: true,
        uid: targetUid,
        ...jsonFields,
        updatedAt: new Date(now).toISOString(),
      });
    }
  );

  app.post(
    '/api/redeem-code',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const email = req.authUser!.email || '';
      const rawCode = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
      const targetOrgId = typeof req.body?.orgId === 'string' ? req.body.orgId.trim() : '';
      const isPreview = req.body?.preview === true;

      if (!rawCode || rawCode.length > 64) {
        res.status(400).json({
          error: 'INVALID_CODE_FORMAT',
          message: 'يرجى إدخال كود تفعيل صالح.',
        });
        return;
      }

      if (targetOrgId && !VALID_ORG_ID_REGEX.test(targetOrgId)) {
        res.status(400).json({ error: 'INVALID_ORG_ID', message: 'معرف المؤسسة غير صالح.' });
        return;
      }

      if (!adminDbReady) {
        respondCloudAdminUnavailable(res);
        return;
      }

      const codeHash = hashActivationCodeServer(rawCode);

      try {
        const result = await adminDb.runTransaction(async (tx) => {
          const licenseRef = adminDb.collection('licenseCodes').doc(codeHash);
          const activationRef = adminDb.collection('activationCodes').doc(codeHash);
          const adminIssuedRef = adminDb.collection('adminIssuedCodes').doc(codeHash);
          const userRef = adminDb.collection('users').doc(uid);
          const orgRef = targetOrgId ? adminDb.collection('organizations').doc(targetOrgId) : null;
          const memberRef = orgRef ? orgRef.collection('members').doc(uid) : null;

          const [licenseSnap, activationSnap, adminIssuedSnap, userSnap, orgSnap, memberSnap] =
            await Promise.all([
              tx.get(licenseRef),
              tx.get(activationRef),
              tx.get(adminIssuedRef),
              tx.get(userRef),
              orgRef ? tx.get(orgRef) : Promise.resolve(null),
              memberRef ? tx.get(memberRef) : Promise.resolve(null),
            ]);

          const activeCodeRef = licenseSnap.exists
            ? licenseRef
            : activationSnap.exists
            ? activationRef
            : adminIssuedSnap.exists
            ? adminIssuedRef
            : null;
          const activeCodeSnap = licenseSnap.exists
            ? licenseSnap
            : activationSnap.exists
            ? activationSnap
            : adminIssuedSnap.exists
            ? adminIssuedSnap
            : null;

          if (!activeCodeRef || !activeCodeSnap || !activeCodeSnap.exists) {
            return {
              status: 404 as const,
              error: 'INVALID_CODE',
              message: 'كود التفعيل غير صحيح أو غير مسجل.',
            };
          }

          const codeData = activeCodeSnap.data() as {
            plan?: string;
            tier?: string;
            planTier?: string;
            cycle?: string;
            seats?: number;
            extraSeats?: number;
            targetEmail?: string | null;
            used?: boolean;
            status?: string;
            usedBy?: string | null;
            usedOrgId?: string | null;
          };

          if (
            codeData.targetEmail &&
            codeData.targetEmail.trim().toLowerCase() !== email.trim().toLowerCase()
          ) {
            return {
              status: 403 as const,
              error: 'TARGET_EMAIL_MISMATCH',
              message: 'هذا الكود مخصص لبريد إلكتروني آخر.',
            };
          }

          const isAlreadyClaimedOther =
            (codeData.usedBy && codeData.usedBy !== uid) ||
            ((codeData.used === true || codeData.status === 'used') && !codeData.usedBy);
          if (isAlreadyClaimedOther) {
            return {
              status: 409 as const,
              error: 'CODE_ALREADY_USED',
              message: 'تم استخدام هذا الكود مسبقاً بحساب آخر.',
            };
          }

          if (codeData.usedBy === uid) {
            if (isPreview) {
              return {
                status: 409 as const,
                error: 'CODE_ALREADY_USED',
                message: 'تم تفعيل هذا الكود مسبقاً على حسابك.',
              };
            }
            if (targetOrgId && codeData.usedOrgId && codeData.usedOrgId !== targetOrgId) {
              return {
                status: 409 as const,
                error: 'CODE_ALREADY_USED_OTHER_ORG',
                message: 'تم استخدام هذا الكود مسبقاً لمؤسسة أخرى.',
              };
            }
            const currentEntitlement = resolveUserEntitlement(userSnap.data());
            if (currentEntitlement.isPro) {
              return {
                status: 200 as const,
                isPro: true,
                proPlan: String(userSnap.data()?.proPlan || 'code') as SupportedActivationPlan,
                planTier: currentEntitlement.planTier as Exclude<SupportedPlanTier, 'free'>,
                billingCycle: currentEntitlement.billingCycle as Exclude<
                  SupportedBillingCycle,
                  'free' | 'trial' | 'code'
                >,
                expiresAt: currentEntitlement.expiresAt,
                seatLimit: orgSnap?.exists
                  ? Number(orgSnap.data()?.seatLimit || computeOrgSeatLimit(0))
                  : undefined,
              };
            }
          }

          const previewResolved = resolveActivationPlanDetails(codeData.plan, {
            tier: codeData.planTier || codeData.tier,
            cycle: codeData.cycle,
          });

          if (orgRef && previewResolved.planTier !== 'business_pro') {
            return {
              status: 400 as const,
              error: 'PERSONAL_CODE_FOR_ORG',
              message:
                'هذا الكود مخصص لباقة الأفراد ولا يصلح لترقية مؤسسة. أدخل كود باقة الأعمال أو فعّل بدون تحديد مؤسسة.',
            };
          }

          if (isPreview) {
            return {
              status: 200 as const,
              preview: true as const,
              tier: previewResolved.planTier === 'business_pro' ? ('business' as const) : ('pro' as const),
              planTier: previewResolved.planTier,
              proPlan: previewResolved.proPlan,
              billingCycle: previewResolved.billingCycle,
              expiresAt: previewResolved.expiresAt,
            };
          }

          const existingEntitlement = resolveUserEntitlement(userSnap.data());
          const existingOrgExpiresAt =
            orgSnap?.exists &&
            orgSnap.data()?.planTier === 'business_pro' &&
            orgSnap.data()?.billingCycle !== 'trial' &&
            typeof orgSnap.data()?.expiresAt === 'number'
              ? (orgSnap.data()?.expiresAt as number)
              : undefined;
          const existingUserExpiresAt =
            existingEntitlement.isPro &&
            existingEntitlement.planTier === previewResolved.planTier &&
            userSnap.data()?.billingCycle !== 'trial' &&
            typeof userSnap.data()?.expiresAt === 'number'
              ? (userSnap.data()?.expiresAt as number)
              : undefined;

          const resolved = resolveActivationPlanDetails(codeData.plan, {
            tier: codeData.planTier || codeData.tier,
            cycle: codeData.cycle,
            baseMs: targetOrgId ? existingOrgExpiresAt : existingUserExpiresAt,
          });

          let appliedSeatLimit: number | undefined;

          if (resolved.planTier === 'business_pro' && orgRef) {
            if (!orgSnap?.exists) {
              return { status: 404 as const, error: 'ORG_NOT_FOUND', message: 'المؤسسة غير موجودة.' };
            }
            const isOwner = orgSnap.data()?.ownerUid === uid;
            const isAdmin =
              memberSnap?.exists &&
              memberSnap.data()?.status === 'active' &&
              (memberSnap.data()?.role === 'owner' || memberSnap.data()?.role === 'admin');
            if (!isOwner && !isAdmin) {
              return {
                status: 403 as const,
                error: 'NOT_ORG_OWNER',
                message: 'فقط مالك المؤسسة أو المدير يمكنه ترقية باقة المؤسسة.',
              };
            }
            const codeExtraSeats =
              typeof codeData.seats === 'number' && Number.isFinite(codeData.seats)
                ? Math.max(0, Math.floor(codeData.seats) - PRICING_CONFIG.businessPro.includedSeats)
                : Math.max(0, Math.floor(Number(codeData.extraSeats ?? 0)));
            const currentExtraSeats = Math.max(0, Math.floor(Number(orgSnap.data()?.extraSeats ?? 0)));
            const nextExtra = Math.max(currentExtraSeats, codeExtraSeats);
            appliedSeatLimit = computeOrgSeatLimit(nextExtra);

            tx.update(orgRef, {
              planTier: 'business_pro',
              billingCycle: resolved.billingCycle,
              expiresAt: resolved.expiresAt,
              extraSeats: nextExtra,
              seatLimit: appliedSeatLimit,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          if (!codeData.usedBy) {
            tx.update(activeCodeRef, {
              status: 'used',
              used: true,
              usedBy: uid,
              usedOrgId: targetOrgId || null,
              usedAt: Date.now(),
              usedAtServer: FieldValue.serverTimestamp(),
            });
          }

          const nowMs = Date.now();
          const userUpdates: Record<string, unknown> = {
            uid,
            isPro: true,
            proActive: true,
            proPlan: resolved.proPlan,
            planTier: resolved.planTier,
            billingCycle: resolved.billingCycle,
            startedAt: nowMs,
            expiresAt: resolved.expiresAt,
            proExpiresAt: resolved.expiresAt,
            activationCodeHash: codeHash,
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (email) {
            userUpdates.email = email.slice(0, 254);
          }
          if (!userSnap.exists) {
            userUpdates.createdAt = FieldValue.serverTimestamp();
            if (!userUpdates.email) {
              userUpdates.email = `${uid}@firebase.local`;
            }
          }

          tx.set(userRef, userUpdates, { merge: true });

          return {
            status: 200 as const,
            preview: false as const,
            isPro: true,
            proPlan: resolved.proPlan,
            planTier: resolved.planTier,
            billingCycle: resolved.billingCycle,
            expiresAt: resolved.expiresAt,
            isCumulativeRenewal: Boolean(targetOrgId ? existingOrgExpiresAt : existingUserExpiresAt),
            seatLimit: appliedSeatLimit,
          };
        });

        if (result.status !== 200) {
          res.status(result.status).json({ error: result.error, message: result.message });
          return;
        }

        if ('preview' in result && result.preview) {
          res.json({
            ok: true,
            preview: true,
            valid: true,
            tier: result.tier,
            planTier: result.planTier,
            proPlan: result.proPlan,
            billingCycle: result.billingCycle,
            expiresAt: result.expiresAt,
          });
          return;
        }

        res.json({
          ok: true,
          isPro: true,
          proPlan: result.proPlan,
          planTier: result.planTier,
          billingCycle: result.billingCycle,
          expiresAt: result.expiresAt,
          proExpiresAt: result.expiresAt,
          isCumulativeRenewal: Boolean(result.isCumulativeRenewal),
          ...(result.seatLimit !== undefined ? { seatLimit: result.seatLimit } : {}),
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'INVALID_PLAN') {
          res.status(400).json({
            error: 'INVALID_PLAN',
            message: 'بيانات الخطة المرتبطة بهذا الكود غير صالحة.',
          });
          return;
        }
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('Redeem code error:', err);
        res.status(500).json({
          error: 'REDEEM_FAILED',
          message: 'تعذر التحقق من كود التفعيل حالياً. حاول مرة أخرى.',
        });
      }
    }
  );

  // 14-day Free Business Trial (one per authenticated user)
  app.post(
    '/api/start-business-trial',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const email = req.authUser!.email || '';
      const targetOrgId = typeof req.body?.orgId === 'string' ? req.body.orgId.trim() : '';

      if (targetOrgId && !VALID_ORG_ID_REGEX.test(targetOrgId)) {
        res.status(400).json({ error: 'INVALID_ORG_ID', message: 'معرف المؤسسة غير صالح.' });
        return;
      }

      try {
        const result = await adminDb.runTransaction(async (tx) => {
          const userRef = adminDb.collection('users').doc(uid);
          const orgRef = targetOrgId ? adminDb.collection('organizations').doc(targetOrgId) : null;
          const memberRef = orgRef ? orgRef.collection('members').doc(uid) : null;
          const [userSnap, orgSnap, memberSnap] = await Promise.all([
            tx.get(userRef),
            orgRef ? tx.get(orgRef) : Promise.resolve(null),
            memberRef ? tx.get(memberRef) : Promise.resolve(null),
          ]);
          const existing = userSnap.data() || {};

          if (existing.hasUsedBusinessTrial) {
            return {
              status: 409 as const,
              error: 'TRIAL_ALREADY_USED',
              message: 'تم استخدام الفترة التجريبية لباقة الأعمال على هذا الحساب مسبقاً.',
            };
          }

          if (orgRef) {
            if (!orgSnap?.exists) {
              return { status: 404 as const, error: 'ORG_NOT_FOUND', message: 'المؤسسة غير موجودة.' };
            }
            const isOwner = orgSnap.data()?.ownerUid === uid;
            const isAdmin =
              memberSnap?.exists &&
              memberSnap.data()?.status === 'active' &&
              (memberSnap.data()?.role === 'owner' || memberSnap.data()?.role === 'admin');
            if (!isOwner && !isAdmin) {
              return {
                status: 403 as const,
                error: 'NOT_ORG_OWNER',
                message: 'فقط مالك المؤسسة أو المدير يمكنه تفعيل التجربة المجانية للمؤسسة.',
              };
            }
          }

          const expiresAt = Date.now() + PRICING_CONFIG.trialDays * DAY_MS;

          if (orgRef && orgSnap?.exists) {
            tx.update(orgRef, {
              planTier: 'business_pro',
              billingCycle: 'trial',
              expiresAt,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          const updates: Record<string, unknown> = {
            uid,
            isPro: true,
            proPlan: 'trial',
            planTier: 'business_pro',
            billingCycle: 'trial',
            expiresAt,
            proExpiresAt: expiresAt,
            hasUsedBusinessTrial: true,
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (email) updates.email = email.slice(0, 254);
          if (!userSnap.exists) {
            updates.createdAt = FieldValue.serverTimestamp();
            if (!updates.email) updates.email = `${uid}@firebase.local`;
          }

          tx.set(userRef, updates, { merge: true });

          return {
            status: 200 as const,
            expiresAt,
          };
        });

        if (result.status !== 200) {
          res.status(result.status).json({ error: result.error, message: result.message });
          return;
        }

        res.json({
          ok: true,
          isPro: true,
          proPlan: 'trial',
          planTier: 'business_pro',
          billingCycle: 'trial',
          expiresAt: result.expiresAt,
          proExpiresAt: result.expiresAt,
        });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('Business trial error:', err);
        res.status(500).json({
          error: 'TRIAL_START_FAILED',
          message: 'تعذر تفعيل التجربة المجانية حالياً.',
        });
      }
    }
  );

  // ===========================================================================
  // Cloud Multi-User Organization Lifecycle & RBAC Endpoints
  // ===========================================================================
  app.post(
    '/api/org/create',
    orgWriteLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const email = req.authUser!.email || `${uid}@firebase.local`;
      const displayName = (req.authUser!.name || email.split('@')[0] || 'Owner').slice(0, 120);

      const {
        name,
        currency = 'EGP',
        industry = 'general',
        vatRate = 14,
        approvalThreshold = 5000,
        taxNumber,
        loadSampleData = false,
        skipStarterSeed = false,
        preferredOrgId,
      } = req.body as {
        name?: string;
        currency?: string;
        industry?: OrganizationIndustry;
        vatRate?: number;
        approvalThreshold?: number;
        taxNumber?: string;
        loadSampleData?: boolean;
        skipStarterSeed?: boolean;
        preferredOrgId?: string;
      };

      const cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : '';
      const cleanCurrency = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase().slice(0, 8) : 'EGP';
      const cleanIndustry: OrganizationIndustry = VALID_INDUSTRIES.has(industry) ? industry : 'general';
      const cleanVatRate = Math.max(0, Math.min(100, Number.isFinite(Number(vatRate)) ? Number(vatRate) : 14));
      const cleanThreshold = Math.max(0, Math.min(1_000_000_000, Number.isFinite(Number(approvalThreshold)) ? Number(approvalThreshold) : 5000));
      const cleanTaxNumber = typeof taxNumber === 'string' && taxNumber.trim() ? taxNumber.trim().slice(0, 64) : undefined;

      if (!cleanName) {
        res.status(400).json({ error: 'INVALID_ORG_NAME', message: 'يرجى إدخال اسم المؤسسة.' });
        return;
      }

      const orgId =
        typeof preferredOrgId === 'string' && VALID_ORG_ID_REGEX.test(preferredOrgId.trim())
          ? preferredOrgId.trim()
          : `org-${crypto.randomUUID().slice(0, 12)}`;
      const now = Date.now();

      if (!adminDbReady) {
        respondCloudAdminUnavailable(
          res,
          'تم حفظ المؤسسة محلياً وفي نسختك السحابية لعدم توفر صلاحيات الإدارة على الخادم.'
        );
        return;
      }

      try {
        const txResult = await adminDb.runTransaction(async (tx) => {
          const userRef = adminDb.collection('users').doc(uid);
          const orgRef = adminDb.collection('organizations').doc(orgId);
          const [userSnap, existingOrgSnap] = await Promise.all([tx.get(userRef), tx.get(orgRef)]);

          if (existingOrgSnap.exists) {
            return {
              status: 409 as const,
              error: 'ORG_ALREADY_EXISTS',
              message: 'المؤسسة موجودة مسبقاً.',
            };
          }

          const userData = userSnap.data() as Record<string, unknown> | undefined;
          const entitlement = resolveUserEntitlement(userData);
          const hasActiveBusiness = entitlement.isPro && entitlement.planTier === 'business_pro';
          const canStartTrial = !userData?.hasUsedBusinessTrial;

          if (!hasActiveBusiness && !canStartTrial) {
            return {
              status: 403 as const,
              error: 'BUSINESS_PLAN_REQUIRED',
              message: 'يتطلب إنشاء مؤسسة جديدة تفعيل باقة الأعمال (Business PRO).',
            };
          }

          const billingCycle = hasActiveBusiness ? entitlement.billingCycle : 'trial';
          const expiresAt = hasActiveBusiness
            ? entitlement.expiresAt
            : now + PRICING_CONFIG.trialDays * DAY_MS;
          const seatLimit = computeOrgSeatLimit(0);

          if (!hasActiveBusiness) {
            const userUpdates: Record<string, unknown> = {
              uid,
              email: email.slice(0, 254),
              displayName,
              isPro: true,
              proPlan: 'trial',
              planTier: 'business_pro',
              billingCycle: 'trial',
              expiresAt,
              proExpiresAt: expiresAt,
              hasUsedBusinessTrial: true,
              updatedAt: FieldValue.serverTimestamp(),
            };
            if (!userSnap.exists) {
              userUpdates.createdAt = FieldValue.serverTimestamp();
            }
            tx.set(userRef, userUpdates, { merge: true });
          }

          const orgPayload: Record<string, unknown> = {
            id: orgId,
            name: cleanName,
            currency: cleanCurrency,
            industry: cleanIndustry,
            vatRate: cleanVatRate,
            approvalThreshold: cleanThreshold,
            ownerUid: uid,
            planTier: 'business_pro',
            billingCycle,
            expiresAt,
            seatLimit,
            extraSeats: 0,
            aiScansUsed: 0,
            aiScansMonth: getUtcMonthKey(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (cleanTaxNumber) orgPayload.taxNumber = cleanTaxNumber;

          tx.set(orgRef, orgPayload);

          const memberRef = orgRef.collection('members').doc(uid);
          const memberPayload = {
            uid,
            email: email.slice(0, 254),
            displayName,
            role: 'owner' as const,
            status: 'active' as const,
            joinedAt: now,
            updatedAt: FieldValue.serverTimestamp(),
          };
          tx.set(memberRef, memberPayload);

          const userOrgRef = userRef.collection('orgRefs').doc(orgId);
          tx.set(userOrgRef, {
            orgId,
            orgName: cleanName,
            role: 'owner',
            status: 'active',
            currency: cleanCurrency,
            joinedAt: now,
          });

          const auditId = `log-${now}-${crypto.randomBytes(3).toString('hex')}`;
          tx.set(orgRef.collection('auditLogs').doc(auditId), {
            id: auditId,
            orgId,
            action: 'create',
            entityType: 'organization',
            entityId: orgId,
            actorUid: uid,
            actorName: displayName,
            summary: `تأسيس مساحة عمل المؤسسة السحابية: ${cleanName}`,
            timestamp: now,
            createdAt: FieldValue.serverTimestamp(),
          });

          return {
            status: 200 as const,
            billingCycle,
            expiresAt,
            seatLimit,
            memberPayload,
          };
        });

        if (txResult.status !== 200) {
          res.status(txResult.status).json({ error: txResult.error, message: txResult.message });
          return;
        }

        // Seed starter wallets, categories, and cost centers in a batch if not migrating
        if (!skipStarterSeed) {
          const orgRef = adminDb.collection('organizations').doc(orgId);
          const batch = adminDb.batch();

          const starterWallets: Wallet[] = [
            {
              id: `org-w-cash-${now}`,
              name: 'الخزينة الرئيسية',
              currency: cleanCurrency,
              initialBalance: 0,
              initialBalanceMinor: 0,
              balance: 0,
              balanceMinor: 0,
              color: '#3A605B',
              icon: 'Wallet',
              isArchived: false,
              order: 1,
              walletType: 'standard',
            },
          ];

          for (const w of starterWallets) {
            batch.set(orgRef.collection('wallets').doc(w.id), {
              id: w.id,
              orgId,
              balanceMinor: w.balanceMinor ?? toMinor(w.balance, w.currency),
              payload: w,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          const starterCategories = createStarterOrgCategories(cleanIndustry);
          for (const cat of starterCategories) {
            batch.set(orgRef.collection('categories').doc(cat.id), {
              id: cat.id,
              orgId,
              payload: cat,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          const starterCostCenters = createStarterCostCentersForIndustry(orgId, cleanIndustry, loadSampleData, now);
          for (const cc of starterCostCenters) {
            batch.set(orgRef.collection('costCenters').doc(cc.id), {
              ...cc,
              budgetAllocatedMinor: toMinor(cc.budgetAllocated, cleanCurrency),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          await batch.commit();
        }

        res.json({
          ok: true,
          orgId,
          organization: {
            id: orgId,
            name: cleanName,
            currency: cleanCurrency,
            industry: cleanIndustry,
            vatRate: cleanVatRate,
            taxNumber: cleanTaxNumber,
            approvalThreshold: cleanThreshold,
            ownerUid: uid,
            planTier: 'business_pro',
            billingCycle: txResult.billingCycle,
            expiresAt: txResult.expiresAt,
            seatLimit: txResult.seatLimit,
            extraSeats: 0,
            createdAt: now,
            updatedAt: now,
          },
        });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(
            res,
            'تم حفظ المؤسسة محلياً وفي نسختك السحابية لعدم توفر صلاحيات الإدارة على الخادم.'
          );
          return;
        }
        console.error('Org create error:', err);
        res.status(500).json({
          error: 'ORG_CREATE_FAILED',
          message: 'تعذر إنشاء المؤسسة على السحابة. حاول مرة أخرى.',
        });
      }
    }
  );

  app.post(
    '/api/org/invite',
    orgWriteLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const actorName = (req.authUser!.name || req.authUser!.email || 'Admin').slice(0, 120);
      const {
        orgId,
        role = 'employee',
        expiresInDays = 7,
        maxUses = 5,
      } = req.body as {
        orgId?: string;
        role?: Exclude<OrganizationRole, 'owner'>;
        expiresInDays?: number;
        maxUses?: number;
      };

      const cleanOrgId = typeof orgId === 'string' ? orgId.trim() : '';
      if (!VALID_ORG_ID_REGEX.test(cleanOrgId)) {
        res.status(400).json({ error: 'INVALID_ORG_ID', message: 'معرف المؤسسة غير صالح.' });
        return;
      }
      if (!INVITABLE_ROLES.has(role)) {
        res.status(400).json({ error: 'INVALID_ROLE', message: 'الدور الوظيفي المختار غير صالح.' });
        return;
      }

      const days = Math.max(1, Math.min(30, Math.floor(Number(expiresInDays) || 7)));
      const uses = Math.max(1, Math.min(50, Math.floor(Number(maxUses) || 5)));

      try {
        const orgRef = adminDb.collection('organizations').doc(cleanOrgId);
        const memberRef = orgRef.collection('members').doc(uid);
        const [orgSnap, memberSnap] = await Promise.all([orgRef.get(), memberRef.get()]);

        if (!orgSnap.exists || !memberSnap.exists || memberSnap.data()?.status !== 'active') {
          res.status(403).json({ error: 'FORBIDDEN', message: 'ليس لديك صلاحية الوصول لهذه المؤسسة.' });
          return;
        }
        const callerRole = String(memberSnap.data()?.role || '');
        if (callerRole !== 'owner' && callerRole !== 'admin') {
          res.status(403).json({ error: 'FORBIDDEN', message: 'فقط المالك أو المدير يمكنهما إنشاء دعوات.' });
          return;
        }

        const subState = computeOrgSubscriptionState(orgSnap.data() as Record<string, unknown>);
        if (subState.isReadOnly) {
          res.status(403).json({
            error: 'SUBSCRIPTION_READ_ONLY',
            message: 'المؤسسة في وضع القراءة فقط. جدد الاشتراك لإرسال دعوات جديدة.',
          });
          return;
        }

        const rawCode = generateReadableInviteCode();
        const codeHash = hashInviteCodeServer(rawCode);
        const inviteId = `inv-${crypto.randomUUID().slice(0, 12)}`;
        const now = Date.now();
        const expiresAt = now + days * DAY_MS;

        const batch = adminDb.batch();
        batch.set(orgRef.collection('invites').doc(inviteId), {
          id: inviteId,
          orgId: cleanOrgId,
          codeHash,
          role,
          createdBy: uid,
          createdAt: now,
          expiresAt,
          maxUses: uses,
          usedCount: 0,
          status: 'active',
        });

        const auditId = `log-${now}-${crypto.randomBytes(3).toString('hex')}`;
        batch.set(orgRef.collection('auditLogs').doc(auditId), {
          id: auditId,
          orgId: cleanOrgId,
          action: 'invite_create',
          entityType: 'invite',
          entityId: inviteId,
          actorUid: uid,
          actorName,
          summary: `إنشاء رابط دعوة جديد بدور (${role}) صالحة لـ ${days} أيام`,
          timestamp: now,
          createdAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();

        res.json({
          ok: true,
          invite: {
            id: inviteId,
            orgId: cleanOrgId,
            role,
            createdBy: uid,
            createdAt: now,
            expiresAt,
            maxUses: uses,
            usedCount: 0,
            status: 'active',
          },
          code: rawCode,
        });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('Create invite error:', err);
        res.status(500).json({ error: 'INVITE_CREATE_FAILED', message: 'تعذر إنشاء الدعوة حالياً.' });
      }
    }
  );

  app.get(
    '/api/org/invites',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const orgId = typeof req.query.orgId === 'string' ? req.query.orgId.trim() : '';
      if (!VALID_ORG_ID_REGEX.test(orgId)) {
        res.status(400).json({ error: 'INVALID_ORG_ID', message: 'معرف المؤسسة غير صالح.' });
        return;
      }
      try {
        const orgRef = adminDb.collection('organizations').doc(orgId);
        const memberSnap = await orgRef.collection('members').doc(uid).get();
        if (!memberSnap.exists || memberSnap.data()?.status !== 'active') {
          res.status(403).json({ error: 'FORBIDDEN' });
          return;
        }
        const role = String(memberSnap.data()?.role || '');
        if (role !== 'owner' && role !== 'admin') {
          res.status(403).json({ error: 'FORBIDDEN' });
          return;
        }
        const snap = await orgRef.collection('invites').orderBy('createdAt', 'desc').limit(25).get();
        const invites = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: data.id,
            orgId: data.orgId,
            role: data.role,
            createdBy: data.createdBy,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
            maxUses: data.maxUses,
            usedCount: data.usedCount,
            status: data.status,
          };
        });
        res.json({ ok: true, invites });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('List invites error:', err);
        res.status(500).json({ error: 'INVITES_LIST_FAILED' });
      }
    }
  );

  app.post(
    '/api/org/invite/revoke',
    orgWriteLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const actorName = (req.authUser!.name || req.authUser!.email || 'Admin').slice(0, 120);
      const { orgId, inviteId } = req.body as { orgId?: string; inviteId?: string };

      const cleanOrgId = typeof orgId === 'string' ? orgId.trim() : '';
      const cleanInviteId = typeof inviteId === 'string' ? inviteId.trim() : '';
      if (!VALID_ORG_ID_REGEX.test(cleanOrgId) || !VALID_ORG_ID_REGEX.test(cleanInviteId)) {
        res.status(400).json({ error: 'INVALID_PARAMS', message: 'معرف الدعوة غير صالح.' });
        return;
      }

      try {
        const orgRef = adminDb.collection('organizations').doc(cleanOrgId);
        const memberSnap = await orgRef.collection('members').doc(uid).get();
        const role = String(memberSnap.data()?.role || '');
        if (!memberSnap.exists || memberSnap.data()?.status !== 'active' || (role !== 'owner' && role !== 'admin')) {
          res.status(403).json({ error: 'FORBIDDEN', message: 'صلاحية غير كافية لإلغاء الدعوة.' });
          return;
        }
        const now = Date.now();
        const batch = adminDb.batch();
        batch.update(orgRef.collection('invites').doc(cleanInviteId), { status: 'revoked' });
        const auditId = `log-${now}-${crypto.randomBytes(3).toString('hex')}`;
        batch.set(orgRef.collection('auditLogs').doc(auditId), {
          id: auditId,
          orgId: cleanOrgId,
          action: 'invite_revoke',
          entityType: 'invite',
          entityId: cleanInviteId,
          actorUid: uid,
          actorName,
          summary: `إلغاء رابط الدعوة (${cleanInviteId})`,
          timestamp: now,
          createdAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();
        res.json({ ok: true });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('Revoke invite error:', err);
        res.status(500).json({ error: 'INVITE_REVOKE_FAILED' });
      }
    }
  );

  app.post(
    '/api/org/join',
    joinIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const email = (req.authUser!.email || `${uid}@firebase.local`).slice(0, 254);
      const displayName = (req.authUser!.name || email.split('@')[0] || 'Member').slice(0, 120);

      const remainingLockSec = await checkJoinLockInDb(uid);
      if (remainingLockSec > 0) {
        res.status(429).json({
          error: 'JOIN_LOCKED',
          message: `تم حظر محاولات الانضمام مؤقتاً بسبب رموز غير صحيحة. حاول بعد ${Math.ceil(remainingLockSec / 60)} دقيقة.`,
        });
        return;
      }

      const rawCode = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
      if (!rawCode || rawCode.length > 64) {
        res.status(400).json({ error: 'INVALID_CODE', message: 'يرجى إدخال رمز دعوة صالح.' });
        return;
      }

      const codeHash = hashInviteCodeServer(rawCode);

      try {
        const inviteQuery = await adminDb
          .collectionGroup('invites')
          .where('codeHash', '==', codeHash)
          .limit(1)
          .get();

        if (inviteQuery.empty) {
          await recordJoinFailureInDb(uid);
          res.status(404).json({
            error: 'INVITE_NOT_FOUND',
            message: 'رمز الدعوة غير صحيح أو منتهي الصلاحية.',
          });
          return;
        }

        const matchedInviteDoc = inviteQuery.docs[0];
        const inviteRef = matchedInviteDoc.ref;
        const orgRef = inviteRef.parent.parent!;
        const orgId = orgRef.id;

        const outcome = await adminDb.runTransaction(async (tx) => {
          const [inviteSnap, orgSnap, memberSnap, activeMembersSnap] = await Promise.all([
            tx.get(inviteRef),
            tx.get(orgRef),
            tx.get(orgRef.collection('members').doc(uid)),
            tx.get(orgRef.collection('members').where('status', '==', 'active')),
          ]);

          if (!inviteSnap.exists || !orgSnap.exists) {
            return { status: 404 as const, error: 'INVITE_NOT_FOUND', message: 'رمز الدعوة غير صالح.' };
          }

          const inviteData = inviteSnap.data() as {
            status: string;
            expiresAt: number;
            maxUses: number;
            usedCount: number;
            role: Exclude<OrganizationRole, 'owner'>;
          };
          const orgData = orgSnap.data() as Record<string, unknown>;
          const now = Date.now();

          if (inviteData.status !== 'active' || inviteData.expiresAt <= now || inviteData.usedCount >= inviteData.maxUses) {
            return {
              status: 410 as const,
              error: 'INVITE_EXPIRED',
              message: 'انتهت صلاحية هذا الرمز أو تم استهلاك الحد الأقصى للانضمام.',
            };
          }

          const subState = computeOrgSubscriptionState(orgData);
          if (subState.isReadOnly) {
            return {
              status: 403 as const,
              error: 'ORG_READ_ONLY',
              message: 'اشتراك هذه المؤسسة منتهٍ حالياً ولا يمكن قبول أعضاء جدد.',
            };
          }

          if (memberSnap.exists) {
            const existingStatus = memberSnap.data()?.status;
            if (existingStatus === 'suspended') {
              return {
                status: 403 as const,
                error: 'MEMBER_SUSPENDED',
                message: 'تم تعليق عضويتك في هذه المؤسسة. تواصل مع المسؤول.',
              };
            }
            return {
              status: 200 as const,
              alreadyMember: true,
              orgId,
              orgName: String(orgData.name || ''),
              role: String(memberSnap.data()?.role || inviteData.role),
            };
          }

          const activeCount = activeMembersSnap.size;
          if (activeCount >= subState.seatLimit) {
            return {
              status: 403 as const,
              error: 'SEAT_LIMIT_REACHED',
              message: `وصلت المؤسسة للحد الأقصى للمقاعد (${subState.seatLimit}). اطلب من المالك ترقية الباقة أو إضافة مقاعد.`,
            };
          }

          const assignedRole = INVITABLE_ROLES.has(inviteData.role) ? inviteData.role : 'employee';
          const nextUsedCount = inviteData.usedCount + 1;
          const nextInviteStatus = nextUsedCount >= inviteData.maxUses ? 'exhausted' : 'active';

          tx.update(inviteRef, {
            usedCount: nextUsedCount,
            status: nextInviteStatus,
          });

          tx.set(orgRef.collection('members').doc(uid), {
            uid,
            email,
            displayName,
            role: assignedRole,
            status: 'active',
            joinedAt: now,
            updatedAt: FieldValue.serverTimestamp(),
          });

          tx.set(adminDb.collection('users').doc(uid).collection('orgRefs').doc(orgId), {
            orgId,
            orgName: String(orgData.name || '').slice(0, 120),
            role: assignedRole,
            status: 'active',
            currency: String(orgData.currency || 'EGP'),
            joinedAt: now,
          });

          const auditId = `log-${now}-${crypto.randomBytes(3).toString('hex')}`;
          tx.set(orgRef.collection('auditLogs').doc(auditId), {
            id: auditId,
            orgId,
            action: 'member_join',
            entityType: 'member',
            entityId: uid,
            actorUid: uid,
            actorName: displayName,
            summary: `انضمام عضو جديد: ${displayName} (${assignedRole})`,
            timestamp: now,
            createdAt: FieldValue.serverTimestamp(),
          });

          return {
            status: 200 as const,
            alreadyMember: false,
            orgId,
            orgName: String(orgData.name || ''),
            role: assignedRole,
          };
        });

        if (outcome.status !== 200) {
          await recordJoinFailureInDb(uid);
          res.status(outcome.status).json({ error: outcome.error, message: outcome.message });
          return;
        }

        await clearJoinFailuresInDb(uid);
        res.json({
          ok: true,
          orgId: outcome.orgId,
          orgName: outcome.orgName,
          role: outcome.role,
          alreadyMember: outcome.alreadyMember,
        });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('Org join error:', err);
        res.status(500).json({ error: 'ORG_JOIN_FAILED', message: 'تعذر إتمام الانضمام حالياً.' });
      }
    }
  );

  app.post(
    '/api/org/member',
    orgWriteLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const actorName = (req.authUser!.name || req.authUser!.email || 'Admin').slice(0, 120);
      const { orgId, targetUid, action, role, spendingLimit, department } = req.body as {
        orgId?: string;
        targetUid?: string;
        action?: 'change_role' | 'suspend' | 'reactivate' | 'remove' | 'set_spending_limit';
        role?: Exclude<OrganizationRole, 'owner'>;
        spendingLimit?: number | null;
        department?: string;
      };

      const cleanOrgId = typeof orgId === 'string' ? orgId.trim() : '';
      const cleanTargetUid = typeof targetUid === 'string' ? targetUid.trim() : '';
      if (!VALID_ORG_ID_REGEX.test(cleanOrgId) || !VALID_ORG_ID_REGEX.test(cleanTargetUid)) {
        res.status(400).json({ error: 'INVALID_PARAMS', message: 'بيانات العضو أو المؤسسة غير صالحة.' });
        return;
      }

      try {
        const orgRef = adminDb.collection('organizations').doc(cleanOrgId);
        const result = await adminDb.runTransaction(async (tx) => {
          const [orgSnap, callerSnap, targetSnap, activeSnap] = await Promise.all([
            tx.get(orgRef),
            tx.get(orgRef.collection('members').doc(uid)),
            tx.get(orgRef.collection('members').doc(cleanTargetUid)),
            tx.get(orgRef.collection('members').where('status', '==', 'active')),
          ]);

          if (!orgSnap.exists || !callerSnap.exists || callerSnap.data()?.status !== 'active') {
            return { status: 403 as const, error: 'FORBIDDEN', message: 'صلاحية غير كافية.' };
          }
          const callerRole = String(callerSnap.data()?.role || '');
          if (callerRole !== 'owner' && callerRole !== 'admin') {
            return { status: 403 as const, error: 'FORBIDDEN', message: 'فقط المالك أو المدير يمكنهما إدارة الفريق.' };
          }
          if (!targetSnap.exists) {
            return { status: 404 as const, error: 'MEMBER_NOT_FOUND', message: 'العضو غير موجود.' };
          }
          const targetData = targetSnap.data() as Record<string, unknown>;
          if (targetData.role === 'owner' || cleanTargetUid === orgSnap.data()?.ownerUid) {
            return {
              status: 400 as const,
              error: 'CANNOT_MODIFY_OWNER',
              message: 'لا يمكن تعديل أو إزالة مالك المؤسسة. استخدم خيار نقل الملكية أولاً.',
            };
          }

          const orgCurrency = String(orgSnap.data()?.currency || 'EGP');
          const subState = computeOrgSubscriptionState(orgSnap.data() as Record<string, unknown>);
          if (subState.isReadOnly) {
            return {
              status: 403 as const,
              error: 'SUBSCRIPTION_READ_ONLY',
              message: 'المؤسسة في وضع القراءة فقط. جدد الاشتراك لتعديل الفريق.',
            };
          }

          const now = Date.now();
          const targetRef = orgRef.collection('members').doc(cleanTargetUid);
          const targetOrgRef = adminDb.collection('users').doc(cleanTargetUid).collection('orgRefs').doc(cleanOrgId);
          const auditId = `log-${now}-${crypto.randomBytes(3).toString('hex')}`;
          let summary = '';

          if (action === 'remove') {
            tx.delete(targetRef);
            tx.delete(targetOrgRef);
            summary = `إزالة العضو ${targetData.displayName || cleanTargetUid} من المؤسسة`;
          } else if (action === 'suspend') {
            tx.update(targetRef, { status: 'suspended', updatedAt: FieldValue.serverTimestamp() });
            tx.set(targetOrgRef, { status: 'suspended' }, { merge: true });
            summary = `تعليق صلاحيات العضو ${targetData.displayName || cleanTargetUid}`;
          } else if (action === 'reactivate') {
            if (activeSnap.size >= subState.seatLimit && targetData.status !== 'active') {
              return {
                status: 403 as const,
                error: 'SEAT_LIMIT_REACHED',
                message: `بلغت الحد الأقصى للمقاعد النشطة (${subState.seatLimit}).`,
              };
            }
            tx.update(targetRef, { status: 'active', updatedAt: FieldValue.serverTimestamp() });
            tx.set(targetOrgRef, { status: 'active' }, { merge: true });
            summary = `إعادة تفعيل العضو ${targetData.displayName || cleanTargetUid}`;
          } else if (action === 'change_role') {
            if (!role || !MANAGEABLE_ROLES.has(role)) {
              return { status: 400 as const, error: 'INVALID_ROLE', message: 'الدور الوظيفي غير صالح.' };
            }
            tx.update(targetRef, { role, updatedAt: FieldValue.serverTimestamp() });
            tx.set(targetOrgRef, { role }, { merge: true });
            summary = `تغيير دور ${targetData.displayName || cleanTargetUid} إلى ${role}`;
          } else if (action === 'set_spending_limit') {
            const cleanLimit =
              spendingLimit === null || spendingLimit === undefined || spendingLimit <= 0
                ? null
                : Math.min(1_000_000_000, Number(spendingLimit));
            const updates: Record<string, unknown> = {
              spendingLimit: cleanLimit,
              spendingLimitMinor: cleanLimit !== null ? toMinor(cleanLimit, orgCurrency) : null,
              updatedAt: FieldValue.serverTimestamp(),
            };
            if (typeof department === 'string') {
              updates.department = department.trim().slice(0, 80);
            }
            tx.update(targetRef, updates);
            summary = cleanLimit
              ? `تعيين حد الصرف للعضو ${targetData.displayName || cleanTargetUid}: ${cleanLimit} ${orgCurrency}`
              : `إلغاء حد الصرف للعضو ${targetData.displayName || cleanTargetUid}`;
          } else {
            return { status: 400 as const, error: 'INVALID_ACTION', message: 'الإجراء المطلوب غير مدعوم.' };
          }

          tx.set(orgRef.collection('auditLogs').doc(auditId), {
            id: auditId,
            orgId: cleanOrgId,
            action: action === 'remove' ? 'member_remove' : 'role_change',
            entityType: 'member',
            entityId: cleanTargetUid,
            actorUid: uid,
            actorName,
            summary,
            timestamp: now,
            createdAt: FieldValue.serverTimestamp(),
          });

          return { status: 200 as const };
        });

        if (result.status !== 200) {
          res.status(result.status).json({ error: result.error, message: result.message });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('Manage member error:', err);
        res.status(500).json({ error: 'MEMBER_UPDATE_FAILED', message: 'تعذر تحديث بيانات العضو.' });
      }
    }
  );

  app.post(
    '/api/org/transfer-ownership',
    orgWriteLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const actorName = (req.authUser!.name || req.authUser!.email || 'Owner').slice(0, 120);
      const { orgId, newOwnerUid } = req.body as { orgId?: string; newOwnerUid?: string };

      const cleanOrgId = typeof orgId === 'string' ? orgId.trim() : '';
      const cleanNewOwner = typeof newOwnerUid === 'string' ? newOwnerUid.trim() : '';
      if (!VALID_ORG_ID_REGEX.test(cleanOrgId) || !VALID_ORG_ID_REGEX.test(cleanNewOwner) || cleanNewOwner === uid) {
        res.status(400).json({ error: 'INVALID_PARAMS', message: 'اختر عضواً آخر نشطاً لنقل الملكية.' });
        return;
      }

      try {
        const orgRef = adminDb.collection('organizations').doc(cleanOrgId);
        const result = await adminDb.runTransaction(async (tx) => {
          const [orgSnap, newOwnerMemberSnap] = await Promise.all([
            tx.get(orgRef),
            tx.get(orgRef.collection('members').doc(cleanNewOwner)),
          ]);
          if (!orgSnap.exists || orgSnap.data()?.ownerUid !== uid) {
            return { status: 403 as const, error: 'FORBIDDEN', message: 'فقط المالك الحالي يمكنه نقل الملكية.' };
          }
          if (!newOwnerMemberSnap.exists || newOwnerMemberSnap.data()?.status !== 'active') {
            return { status: 400 as const, error: 'TARGET_NOT_ACTIVE', message: 'المالك الجديد يجب أن يكون عضواً نشطاً.' };
          }

          const now = Date.now();
          tx.update(orgRef, { ownerUid: cleanNewOwner, updatedAt: FieldValue.serverTimestamp() });
          tx.update(orgRef.collection('members').doc(uid), { role: 'admin', updatedAt: FieldValue.serverTimestamp() });
          tx.update(orgRef.collection('members').doc(cleanNewOwner), { role: 'owner', updatedAt: FieldValue.serverTimestamp() });
          tx.set(adminDb.collection('users').doc(uid).collection('orgRefs').doc(cleanOrgId), { role: 'admin' }, { merge: true });
          tx.set(adminDb.collection('users').doc(cleanNewOwner).collection('orgRefs').doc(cleanOrgId), { role: 'owner' }, { merge: true });

          const auditId = `log-${now}-${crypto.randomBytes(3).toString('hex')}`;
          tx.set(orgRef.collection('auditLogs').doc(auditId), {
            id: auditId,
            orgId: cleanOrgId,
            action: 'transfer_ownership',
            entityType: 'organization',
            entityId: cleanOrgId,
            actorUid: uid,
            actorName,
            summary: `نقل ملكية المؤسسة إلى ${newOwnerMemberSnap.data()?.displayName || cleanNewOwner}`,
            timestamp: now,
            createdAt: FieldValue.serverTimestamp(),
          });

          return { status: 200 as const };
        });

        if (result.status !== 200) {
          res.status(result.status).json({ error: result.error, message: result.message });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('Transfer ownership error:', err);
        res.status(500).json({ error: 'TRANSFER_OWNERSHIP_FAILED', message: 'تعذر نقل الملكية حالياً.' });
      }
    }
  );

  app.post(
    '/api/org/delete',
    orgWriteLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const { orgId, confirmName } = req.body as { orgId?: string; confirmName?: string };
      const cleanOrgId = typeof orgId === 'string' ? orgId.trim() : '';

      if (!VALID_ORG_ID_REGEX.test(cleanOrgId)) {
        res.status(400).json({ error: 'INVALID_ORG_ID', message: 'معرف المؤسسة غير صالح.' });
        return;
      }

      try {
        const orgRef = adminDb.collection('organizations').doc(cleanOrgId);
        const [orgSnap, membersSnap] = await Promise.all([
          orgRef.get(),
          orgRef.collection('members').get(),
        ]);

        if (!orgSnap.exists) {
          const userOrgRef = adminDb.collection('users').doc(uid).collection('orgRefs').doc(cleanOrgId);
          const refSnap = await userOrgRef.get();
          if (refSnap.exists) {
            const refData = refSnap.data() as Record<string, unknown> | undefined;
            const refOrgName = String(refData?.orgName || '').trim();
            if (refOrgName && (confirmName || '').trim() !== refOrgName) {
              res.status(400).json({
                error: 'CONFIRM_NAME_MISMATCH',
                message: 'اسم المؤسسة المؤكد غير مطابق. اكتب اسم المؤسسة بدقة للحذف.',
              });
              return;
            }
            await userOrgRef.delete();
            res.json({ ok: true, orphanCleaned: true });
            return;
          }
          res.status(404).json({ error: 'ORG_NOT_FOUND', message: 'المؤسسة غير موجودة.' });
          return;
        }
        const orgData = orgSnap.data() as Record<string, unknown>;
        if (orgData.ownerUid !== uid) {
          res.status(403).json({ error: 'FORBIDDEN', message: 'فقط مالك المؤسسة يمكنه حذفها.' });
          return;
        }
        if ((confirmName || '').trim() !== String(orgData.name || '').trim()) {
          res.status(400).json({
            error: 'CONFIRM_NAME_MISMATCH',
            message: 'اسم المؤسسة المؤكد غير مطابق. اكتب اسم المؤسسة بدقة للحذف.',
          });
          return;
        }

        // Delete orgRefs across all members first
        const refBatch = adminDb.batch();
        for (const m of membersSnap.docs) {
          refBatch.delete(adminDb.collection('users').doc(m.id).collection('orgRefs').doc(cleanOrgId));
        }
        await refBatch.commit();

        await adminDb.recursiveDelete(orgRef);
        res.json({ ok: true });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('Delete org error:', err);
        res.status(500).json({ error: 'ORG_DELETE_FAILED', message: 'تعذر حذف المؤسسة حالياً.' });
      }
    }
  );

  app.post(
    '/api/delete-account',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const authTimeSec = Number(req.authUser!.auth_time || 0);
      const nowSec = Math.floor(Date.now() / 1000);
      if (!authTimeSec || nowSec - authTimeSec > 300) {
        res.status(403).json({
          error: 'RECENT_AUTH_REQUIRED',
          message: 'لدواعي الأمان، أعد تسجيل الدخول بحساب جوجل خلال آخر 5 دقائق ثم أعد المحاولة.',
        });
        return;
      }

      try {
        const orgRefsSnap = await adminDb.collection('users').doc(uid).collection('orgRefs').get();
        for (const refDoc of orgRefsSnap.docs) {
          const orgId = refDoc.id;
          const orgRef = adminDb.collection('organizations').doc(orgId);
          const [orgSnap, membersSnap] = await Promise.all([
            orgRef.get(),
            orgRef.collection('members').where('status', '==', 'active').get(),
          ]);
          if (orgSnap.exists && orgSnap.data()?.ownerUid === uid && membersSnap.size > 1) {
            res.status(409).json({
              error: 'ORG_OWNERSHIP_TRANSFER_REQUIRED',
              message: `أنت مالك مؤسسة "${orgSnap.data()?.name || orgId}" وبها أعضاء نشطون. انقل الملكية أو احذف المؤسسة أولاً.`,
            });
            return;
          }
        }

        // Remove memberships or solo-owned orgs before deleting user document
        for (const refDoc of orgRefsSnap.docs) {
          const orgId = refDoc.id;
          const orgRef = adminDb.collection('organizations').doc(orgId);
          const orgSnap = await orgRef.get();
          if (orgSnap.exists && orgSnap.data()?.ownerUid === uid) {
            await adminDb.recursiveDelete(orgRef);
          } else {
            await orgRef.collection('members').doc(uid).delete().catch(() => {});
          }
        }

        await adminDb.recursiveDelete(adminDb.collection('users').doc(uid));
        try {
          await adminAuth.deleteUser(uid);
        } catch (authErr: unknown) {
          const code =
            typeof authErr === 'object' && authErr && 'code' in authErr
              ? String((authErr as { code?: unknown }).code)
              : '';
          if (code !== 'auth/user-not-found') {
            throw authErr;
          }
        }
        res.json({ ok: true });
      } catch (err) {
        if (isFirestorePermissionDeniedError(err)) {
          adminDbReady = false;
          respondCloudAdminUnavailable(res);
          return;
        }
        console.error('Account deletion error:', err);
        res.status(500).json({
          error: 'DELETE_ACCOUNT_FAILED',
          message: 'تعذر حذف الحساب والبيانات السحابية. حاول مرة أخرى.',
        });
      }
    }
  );

  // Clean JSON error response for oversized bodies or malformed JSON
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (
      req.path.startsWith('/api/') &&
      typeof err === 'object' &&
      err !== null &&
      'status' in err
    ) {
      const status = Number((err as { status?: unknown }).status) || 400;
      if (status === 413) {
        res.status(413).json({
          error: 'PAYLOAD_TOO_LARGE',
          message: 'حجم البيانات المرسلة يتجاوز الحد المسموح.',
        });
        return;
      }
      res.status(status).json({
        error: 'BAD_REQUEST',
        message: 'صيغة الطلب غير صالحة.',
      });
      return;
    }
    next(err);
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ...(hmrDisabled ? { hmr: false, ws: false } : { hmr: { server: httpServer } }),
      },
      appType: 'spa',
    });

    if (hmrDisabled) {
      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const transformed = await vite.transformRequest('/@vite/client');
          if (!transformed?.code) {
            next();
            return;
          }
          const patchedCode = transformed.code.replace(
            /const transport = normalizeModuleRunnerTransport\(\(\(\) => \{[\s\S]*?\}\)\(\)\);/,
            'const transport = normalizeModuleRunnerTransport({ connect() {}, disconnect() {}, send() {} });'
          );
          res.status(200).type('application/javascript').set('Cache-Control', 'no-cache').send(patchedCode);
        } catch {
          next();
        }
      });
    }

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const setNoStoreHeaders = (res: Response) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    };

    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          const baseName = path.basename(filePath);
          if (
            baseName === 'index.html' ||
            baseName === 'version.json' ||
            baseName === 'sw.js' ||
            baseName === 'registerSW.js' ||
            baseName === 'manifest.json'
          ) {
            setNoStoreHeaders(res);
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      setNoStoreHeaders(res);
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return httpServer;
}

createApp()
  .then((httpServer) => {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Raseedi server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
