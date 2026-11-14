import express, { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp, getApps, cert, App as FirebaseAdminApp } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_SCAN_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SCAN_DECODED_BYTES = 2_200_000; // ~2.2MB decoded image
const FREE_MONTHLY_SCAN_LIMIT = 3;
const PERSONAL_PRO_MONTHLY_SCAN_LIMIT = 200;
const BUSINESS_PRO_MONTHLY_SCAN_LIMIT = 250;
const DAY_MS = 24 * 60 * 60 * 1000;

type SupportedPlanTier = 'free' | 'personal_pro' | 'business_pro';
type SupportedBillingCycle = 'free' | 'monthly' | 'yearly' | 'lifetime' | 'trial' | 'code';
type SupportedActivationPlan =
  | 'monthly'
  | 'yearly'
  | 'lifetime'
  | 'business_monthly'
  | 'business_yearly'
  | 'code';

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

interface CategorySummary {
  id: string;
  nameAr: string;
  nameEn: string;
  type: string;
}

function getLocalTodayString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function getUtcMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function hashActivationCodeServer(rawCode: string): string {
  const normalized = rawCode.trim().toUpperCase();
  return crypto
    .createHash('sha256')
    .update(`raseedi-license:${normalized}`)
    .digest('hex');
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
      scanLimit: FREE_MONTHLY_SCAN_LIMIT,
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
      scanLimit: FREE_MONTHLY_SCAN_LIMIT,
    };
  }

  const rawPlan = String(userData.proPlan || '');
  const rawTier = String(userData.planTier || '');
  const isBusiness =
    rawTier === 'business_pro' ||
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
    scanLimit: isBusiness ? BUSINESS_PRO_MONTHLY_SCAN_LIMIT : PERSONAL_PRO_MONTHLY_SCAN_LIMIT,
  };
}

function resolveActivationPlanDetails(plan?: string): {
  proPlan: SupportedActivationPlan;
  planTier: Exclude<SupportedPlanTier, 'free'>;
  billingCycle: Exclude<SupportedBillingCycle, 'free' | 'trial' | 'code'>;
  expiresAt: number | null;
} {
  const now = Date.now();
  switch (plan) {
    case 'monthly':
      return {
        proPlan: 'monthly',
        planTier: 'personal_pro',
        billingCycle: 'monthly',
        expiresAt: now + 30 * DAY_MS,
      };
    case 'yearly':
      return {
        proPlan: 'yearly',
        planTier: 'personal_pro',
        billingCycle: 'yearly',
        expiresAt: now + 365 * DAY_MS,
      };
    case 'business_monthly':
      return {
        proPlan: 'business_monthly',
        planTier: 'business_pro',
        billingCycle: 'monthly',
        expiresAt: now + 30 * DAY_MS,
      };
    case 'business_yearly':
      return {
        proPlan: 'business_yearly',
        planTier: 'business_pro',
        billingCycle: 'yearly',
        expiresAt: now + 365 * DAY_MS,
      };
    case 'lifetime':
    case 'code':
    default:
      return {
        proPlan: plan === 'lifetime' ? 'lifetime' : 'code',
        planTier: 'personal_pro',
        billingCycle: 'lifetime',
        expiresAt: null,
      };
  }
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
  const app = express();
  app.set('trust proxy', 1);

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
      message: 'محاولات تفعيل كثيرة. يرجى المحاولة بعد عدة دقائق.',
    },
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'raseedi-server' });
  });

  app.get(
    '/api/scan-quota',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const uid = req.authUser!.uid;
        const month = getUtcMonthKey();
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
      const quotaRef = adminDb.collection('users').doc(uid).collection('scanQuotas').doc(monthKey);
      let quotaIncremented = false;

      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          res.status(503).json({
            error: 'GEMINI_API_KEY_MISSING',
            message: 'مفتاح الذكاء الاصطناعي غير مضبوط على الخادم.',
          });
          return;
        }

        const { imageBase64, mimeType, categories } = req.body as {
          imageBase64?: string;
          mimeType?: string;
          categories?: CategorySummary[];
        };

        if (typeof mimeType !== 'string' || !ALLOWED_SCAN_MIME_TYPES.has(mimeType)) {
          res.status(400).json({
            error: 'INVALID_MIME_TYPE',
            message: 'صيغة الصورة غير مدعومة. استخدم JPEG أو PNG أو WebP.',
          });
          return;
        }

        if (!imageBase64 || typeof imageBase64 !== 'string') {
          res.status(400).json({
            error: 'INVALID_IMAGE',
            message: 'صورة الفاتورة مطلوبة للتحليل.',
          });
          return;
        }

        const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
        if (!cleanBase64 || !/^[A-Za-z0-9+/=]+$/.test(cleanBase64.replace(/\s+/g, ''))) {
          res.status(400).json({
            error: 'INVALID_IMAGE',
            message: 'بيانات الصورة غير صالحة.',
          });
          return;
        }

        const decodedBytes = Buffer.from(cleanBase64, 'base64').byteLength;
        if (decodedBytes <= 0 || decodedBytes > MAX_SCAN_DECODED_BYTES) {
          res.status(413).json({
            error: 'IMAGE_TOO_LARGE',
            message: 'حجم صورة الفاتورة كبير جداً (الحد الأقصى 2 ميجابايت).',
          });
          return;
        }

        // Atomic monthly quota check & increment with expiry verification
        const quotaState = await adminDb.runTransaction(async (tx) => {
          const userRef = adminDb.collection('users').doc(uid);
          const [userSnap, quotaSnap] = await Promise.all([tx.get(userRef), tx.get(quotaRef)]);

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
            quotaRef,
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

        if (!quotaState.allowed) {
          res.status(429).json({
            error: 'QUOTA_EXCEEDED',
            used: quotaState.used,
            limit: quotaState.limit,
            remaining: 0,
            isPro: quotaState.isPro,
            message: quotaState.isPro
              ? `بلغت الحد الشهري لمسح الفواتير (${quotaState.limit} فاتورة لهذا الشهر).`
              : 'استنفدت 3 محاولات مسح مجانية هذا الشهر — قم بالترقية إلى PRO للمتابعة.',
          });
          return;
        }
        quotaIncremented = true;

        const expenseCategories = Array.isArray(categories)
          ? categories.filter((c) => c.type === 'expense' || c.type === 'both')
          : [];

        const categoriesGuide = expenseCategories.length
          ? expenseCategories.map((c) => `- "${c.id}": ${c.nameAr} (${c.nameEn})`).join('\n')
          : '- "cat-restaurants": مطاعم\n- "cat-groceries": سوبرماركت\n- "cat-cafes": كافيهات\n- "cat-bills": فواتير\n- "cat-pharmacy": صيدلية\n- "cat-other": أخرى';

        const fallbackDate = getLocalTodayString();

        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
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

        const parsed = JSON.parse(rawText) as {
          amount?: number;
          date?: string;
          categoryId?: string;
          merchant?: string;
          notes?: string;
          type?: string;
        };

        const validCategoryIds = new Set(expenseCategories.map((c) => c.id));
        const resolvedCategoryId =
          parsed.categoryId && (validCategoryIds.size === 0 || validCategoryIds.has(parsed.categoryId))
            ? parsed.categoryId
            : expenseCategories.find((c) => c.id === 'cat-other')?.id || expenseCategories[0]?.id || 'cat-other';

        const dateMatch = typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date.trim());

        res.json({
          amount:
            typeof parsed.amount === 'number' && isFinite(parsed.amount) && parsed.amount > 0
              ? Math.round(parsed.amount * 1000) / 1000
              : 0,
          date: dateMatch ? parsed.date!.trim() : fallbackDate,
          categoryId: resolvedCategoryId,
          merchant: typeof parsed.merchant === 'string' ? parsed.merchant.trim().slice(0, 60) : '',
          notes: typeof parsed.notes === 'string' ? parsed.notes.trim().slice(0, 120) : '',
          type: 'expense',
          quota: {
            used: quotaState.used,
            limit: quotaState.limit,
            remaining: quotaState.remaining,
            isPro: quotaState.isPro,
          },
        });
      } catch (error) {
        if (quotaIncremented) {
          await quotaRef
            .set(
              {
                count: FieldValue.increment(-1),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            )
            .catch(() => {});
        }
        console.error('Receipt scan error:', error);
        res.status(500).json({
          error: 'SCAN_FAILED',
          message: 'تعذر تحليل الفاتورة عبر الذكاء الاصطناعي. تأكد من وضوح الصورة والاتصال بالإنترنت.',
        });
      }
    }
  );

  // Payment Webhook Skeleton (Paymob / Fawry / Stripe) with HMAC verification & idempotency
  app.post(
    '/api/webhooks/payment',
    express.raw({ type: 'application/json', limit: '64kb' }),
    async (req: Request, res: Response) => {
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

      try {
        const event = JSON.parse(rawBody) as {
          eventId?: string;
          uid?: string;
          plan?: SupportedActivationPlan;
          status?: string;
        };

        if (!event.eventId || !event.uid || event.status !== 'paid') {
          res.status(400).json({ error: 'INVALID_WEBHOOK_PAYLOAD' });
          return;
        }

        const planInfo = resolveActivationPlanDetails(event.plan);
        const eventRef = adminDb.collection('paymentWebhooks').doc(event.eventId.slice(0, 120));
        const userRef = adminDb.collection('users').doc(event.uid.slice(0, 128));

        const outcome = await adminDb.runTransaction(async (tx) => {
          const eventSnap = await tx.get(eventRef);
          if (eventSnap.exists) {
            return { duplicate: true };
          }
          tx.set(eventRef, {
            uid: event.uid,
            plan: planInfo.proPlan,
            processedAt: FieldValue.serverTimestamp(),
          });
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
          return { duplicate: false };
        });

        res.json({ ok: true, duplicate: outcome.duplicate });
      } catch (err) {
        console.error('Payment webhook error:', err);
        res.status(500).json({ error: 'WEBHOOK_PROCESSING_FAILED' });
      }
    }
  );

  // Small JSON parser for non-scan API routes
  app.use('/api', express.json({ limit: '64kb' }));

  app.post(
    '/api/redeem-code',
    redeemIpLimiter,
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      const email = req.authUser!.email || '';
      const rawCode = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

      if (!rawCode || rawCode.length > 64) {
        res.status(400).json({
          error: 'INVALID_CODE_FORMAT',
          message: 'يرجى إدخال كود تفعيل صالح.',
        });
        return;
      }

      const codeHash = hashActivationCodeServer(rawCode);

      try {
        const result = await adminDb.runTransaction(async (tx) => {
          const codeRef = adminDb.collection('activationCodes').doc(codeHash);
          const userRef = adminDb.collection('users').doc(uid);

          const [codeSnap, userSnap] = await Promise.all([tx.get(codeRef), tx.get(userRef)]);
          if (!codeSnap.exists) {
            return { status: 404 as const, error: 'INVALID_CODE', message: 'كود التفعيل غير صحيح.' };
          }

          const codeData = codeSnap.data() as {
            plan?: string;
            usedBy?: string | null;
          };

          if (codeData.usedBy && codeData.usedBy !== uid) {
            return {
              status: 409 as const,
              error: 'CODE_ALREADY_USED',
              message: 'تم استخدام هذا الكود مسبقاً بحساب آخر.',
            };
          }

          const resolved = resolveActivationPlanDetails(codeData.plan);

          if (!codeData.usedBy) {
            tx.update(codeRef, {
              usedBy: uid,
              usedAt: FieldValue.serverTimestamp(),
            });
          }

          const userUpdates: Record<string, unknown> = {
            uid,
            isPro: true,
            proPlan: resolved.proPlan,
            planTier: resolved.planTier,
            billingCycle: resolved.billingCycle,
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
            isPro: true,
            proPlan: resolved.proPlan,
            planTier: resolved.planTier,
            billingCycle: resolved.billingCycle,
            expiresAt: resolved.expiresAt,
          };
        });

        if (result.status !== 200) {
          res.status(result.status).json({ error: result.error, message: result.message });
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
        });
      } catch (err) {
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

      try {
        const result = await adminDb.runTransaction(async (tx) => {
          const userRef = adminDb.collection('users').doc(uid);
          const userSnap = await tx.get(userRef);
          const existing = userSnap.data() || {};

          if (existing.hasUsedBusinessTrial) {
            return {
              status: 409 as const,
              error: 'TRIAL_ALREADY_USED',
              message: 'تم استخدام الفترة التجريبية لباقة الأعمال على هذا الحساب مسبقاً.',
            };
          }

          const expiresAt = Date.now() + 14 * DAY_MS;
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
        console.error('Business trial error:', err);
        res.status(500).json({
          error: 'TRIAL_START_FAILED',
          message: 'تعذر تفعيل التجربة المجانية حالياً.',
        });
      }
    }
  );

  app.post(
    '/api/delete-account',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.authUser!.uid;
      try {
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
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
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
