import { Category } from '../types';
import { formatLocalDate } from './calculations';
import { auth, ScanQuotaInfo } from './firebase';

export interface ScannedReceiptResult {
  amount: number;
  date: string;
  categoryId: string;
  merchant: string;
  notes: string;
  type: 'expense';
  quota?: ScanQuotaInfo;
}

export class ReceiptScanError extends Error {
  code: string;
  quota?: ScanQuotaInfo;

  constructor(code: string, message: string, quota?: ScanQuotaInfo) {
    super(message);
    this.code = code;
    this.quota = quota;
  }
}

/**
 * Resize/compress receipt image on-device before sending to server-side Gemini proxy
 */
export async function prepareReceiptImageDataUrl(file: File): Promise<{
  dataUrl: string;
  mimeType: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.onload = (event) => {
      const rawUrl = event.target?.result as string;
      if (!rawUrl) {
        reject(new Error('EMPTY_FILE'));
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error('INVALID_IMAGE'));
      img.onload = () => {
        const maxDim = 1280;
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl: rawUrl, mimeType: file.type || 'image/jpeg' });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ dataUrl: compressed, mimeType: 'image/jpeg' });
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Scan receipt image via Vercel Serverless /api/scan-invoice endpoint
 */
export async function scanReceiptWithAI(
  imageBase64: string,
  mimeType: string,
  categories: Category[],
  isRTL = true,
  orgId?: string
): Promise<ScannedReceiptResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ReceiptScanError(
      'OFFLINE',
      isRTL
        ? 'أنت غير متصل بالإنترنت. يتطلب مسح الفواتير بالذكاء الاصطناعي اتصالاً بالإنترنت.'
        : 'You are offline. AI receipt scanning requires an internet connection.'
    );
  }

  let idToken: string | null = null;
  if (auth.currentUser) {
    try {
      idToken = await auth.currentUser.getIdToken();
    } catch {
      idToken = null;
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  let response: Response;
  try {
    response = await fetch('/api/scan-invoice', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        imageBase64,
        mimeType,
        ...(orgId ? { orgId } : {}),
        categories: categories
          .filter((c) => !c.isHidden)
          .map((c) => ({
            id: c.id,
            nameAr: c.nameAr,
            nameEn: c.nameEn,
            type: c.type,
          })),
      }),
    });
  } catch {
    throw new ReceiptScanError(
      'NETWORK_ERROR',
      isRTL
        ? 'تعذر الاتصال بخدمة مسح الفواتير. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.'
        : 'Could not reach the receipt scanner service. Check your connection and try again.'
    );
  }

  let payload: Partial<ScannedReceiptResult> & {
    error?: string;
    message?: string;
    used?: number;
    limit?: number;
    remaining?: number;
    isPro?: boolean;
  };
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const quotaInfo: ScanQuotaInfo | undefined =
      typeof payload.used === 'number' && typeof payload.limit === 'number'
        ? {
            month: new Date().toISOString().slice(0, 7),
            used: payload.used,
            limit: payload.limit,
            remaining: Number(payload.remaining || 0),
            isPro: Boolean(payload.isPro),
          }
        : undefined;

    if (response.status === 401 || payload.error === 'UNAUTHORIZED') {
      throw new ReceiptScanError(
        'AUTH_REQUIRED',
        payload.message ||
          (isRTL
            ? 'سجّل الدخول بحساب جوجل لاستخدام مسح الفواتير.'
            : 'Sign in with Google to use AI receipt scanning.'),
        quotaInfo
      );
    }

    if (payload.error === 'QUOTA_EXCEEDED' || response.status === 429) {
      throw new ReceiptScanError(
        payload.error || 'QUOTA_EXCEEDED',
        payload.message ||
          (isRTL
            ? 'استنفدت الحد الشهري لمسح الفواتير.'
            : 'Monthly AI receipt scan limit reached.'),
        quotaInfo
      );
    }

    if (payload.error === 'GEMINI_API_KEY_MISSING' && !isRTL) {
      throw new ReceiptScanError('GEMINI_API_KEY_MISSING', 'AI API key is not configured on the server.');
    }

    throw new ReceiptScanError(
      payload.error || 'SCAN_FAILED',
      payload.message ||
        (isRTL
          ? 'فشل تحليل الفاتورة. جرب صورة أوضح أو أدخل البيانات يدوياً.'
          : 'Failed to analyze receipt. Try a clearer image or enter manually.'),
      quotaInfo
    );
  }

  const today = formatLocalDate(new Date());
  const validCatIds = new Set(categories.map((c) => c.id));
  const fallbackCat =
    categories.find((c) => c.id === 'cat-other')?.id ||
    categories.find((c) => c.type === 'expense' || c.type === 'both')?.id ||
    'cat-other';

  return {
    amount: typeof payload.amount === 'number' && payload.amount > 0 ? payload.amount : 0,
    date:
      typeof payload.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
        ? payload.date
        : today,
    categoryId:
      payload.categoryId && validCatIds.has(payload.categoryId) ? payload.categoryId : fallbackCat,
    merchant: typeof payload.merchant === 'string' ? payload.merchant.trim() : '',
    notes: typeof payload.notes === 'string' ? payload.notes : '',
    type: 'expense',
    quota: payload.quota,
  };
}
