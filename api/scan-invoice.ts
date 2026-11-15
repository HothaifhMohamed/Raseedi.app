import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI, Type } from '@google/genai';

const ALLOWED_SCAN_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SCAN_DECODED_BYTES = 2_200_000; // ~2.2MB decoded image
const GEMINI_SCAN_MODEL = 'gemini-4-hydrogen';

export interface CategorySummary {
  id: string;
  nameAr: string;
  nameEn: string;
  type: string;
}

export interface ScanInvoiceBody {
  imageBase64?: string;
  mimeType?: string;
  categories?: CategorySummary[];
  orgId?: string;
}

export interface ScannedInvoiceResponse {
  amount: number;
  date: string;
  categoryId: string;
  merchant: string;
  notes: string;
  type: 'expense';
}

export interface VercelRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, unknown>;
}

export interface VercelResponse extends ServerResponse {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
}

export function getLocalTodayDateString(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function validateScanInvoicePayload(body: unknown):
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
  const payload = (body && typeof body === 'object' ? body : {}) as ScanInvoiceBody;
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

  const normalizedCategories: CategorySummary[] = Array.isArray(categories)
    ? categories.filter(
        (c): c is CategorySummary =>
          Boolean(c) &&
          typeof c.id === 'string' &&
          (c.type === 'expense' || c.type === 'both')
      )
    : [];

  return {
    ok: true,
    cleanBase64,
    mimeType,
    categories: normalizedCategories,
  };
}

export function normalizeScannedInvoiceResult(
  rawText: string,
  expenseCategories: CategorySummary[],
  fallbackDate: string
): ScannedInvoiceResponse {
  const parsed = JSON.parse(rawText) as {
    amount?: number;
    date?: string;
    categoryId?: string;
    merchant?: string;
    notes?: string;
  };

  const validCategoryIds = new Set(expenseCategories.map((c) => c.id));
  const resolvedCategoryId =
    parsed.categoryId && (validCategoryIds.size === 0 || validCategoryIds.has(parsed.categoryId))
      ? parsed.categoryId
      : expenseCategories.find((c) => c.id === 'cat-other')?.id ||
        expenseCategories[0]?.id ||
        'cat-other';

  const dateMatch =
    typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date.trim());

  return {
    amount:
      typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) && parsed.amount > 0
        ? Math.round(parsed.amount * 1000) / 1000
        : 0,
    date: dateMatch ? parsed.date!.trim() : fallbackDate,
    categoryId: resolvedCategoryId,
    merchant: typeof parsed.merchant === 'string' ? parsed.merchant.trim().slice(0, 60) : '',
    notes: typeof parsed.notes === 'string' ? parsed.notes.trim().slice(0, 120) : '',
    type: 'expense',
  };
}

async function readJsonBody(req: VercelRequest): Promise<unknown> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body);
    }
    return req.body;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const maxBodyBytes = 3_500_000;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.byteLength;
    if (totalBytes > maxBodyBytes) {
      throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 });
    }
    chunks.push(buf);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const maybeVercelRes = res as Partial<VercelResponse>;
  if (typeof maybeVercelRes.status === 'function' && typeof maybeVercelRes.json === 'function') {
    maybeVercelRes.status(statusCode).json(payload);
    return;
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: 'METHOD_NOT_ALLOWED',
      message: 'Method not allowed. Use POST.',
    });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    sendJson(res, 503, {
      error: 'GEMINI_API_KEY_MISSING',
      message: 'مفتاح الذكاء الاصطناعي غير مضبوط على الخادم.',
    });
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = await readJsonBody(req);
  } catch (err: unknown) {
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as { status?: unknown }).status)
        : 400;
    if (status === 413) {
      sendJson(res, 413, {
        error: 'PAYLOAD_TOO_LARGE',
        message: 'حجم البيانات المرسلة يتجاوز الحد المسموح.',
      });
      return;
    }
    sendJson(res, 400, {
      error: 'BAD_REQUEST',
      message: 'صيغة الطلب غير صالحة.',
    });
    return;
  }

  const validation = validateScanInvoicePayload(parsedBody);
  if (validation.ok === false) {
    sendJson(res, validation.status, {
      error: validation.error,
      message: validation.message,
    });
    return;
  }

  const { cleanBase64, mimeType, categories: expenseCategories } = validation;
  const categoriesGuide = expenseCategories.length
    ? expenseCategories.map((c) => `- "${c.id}": ${c.nameAr} (${c.nameEn})`).join('\n')
    : '- "cat-restaurants": مطاعم\n- "cat-groceries": سوبرماركت\n- "cat-cafes": كافيهات\n- "cat-bills": فواتير\n- "cat-pharmacy": صيدلية\n- "cat-other": أخرى';

  const fallbackDate = getLocalTodayDateString();

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
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

    const result = normalizeScannedInvoiceResult(rawText, expenseCategories, fallbackDate);
    sendJson(res, 200, result);
  } catch (error) {
    console.error('Vercel invoice scan error:', error);
    sendJson(res, 500, {
      error: 'SCAN_FAILED',
      message: 'تعذر تحليل الفاتورة عبر الذكاء الاصطناعي. تأكد من وضوح الصورة والاتصال بالإنترنت.',
    });
  }
}
