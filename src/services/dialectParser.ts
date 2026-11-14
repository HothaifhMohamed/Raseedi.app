/**
 * On-device Egyptian Arabic & English dialect quick-entry parser.
 * Parses phrases like "غدا 50", "بنزين ٢٠٠", "راتب 8000", "coffee 65.5"
 * completely locally with zero network calls.
 */
import { Category, TransactionType } from '../types';
import { normalizeMixedNumericText } from './numbers';

export interface DialectParseResult {
  amount: number;
  type: TransactionType;
  categoryId: string;
  matchedKeyword?: string;
  notes: string;
}

/**
 * Convert Eastern Arabic / Persian digits to Western ASCII digits
 */
export function normalizeDigits(input: string): string {
  return normalizeMixedNumericText(input);
}

/**
 * Normalize Arabic text for forgiving dialect matching (remove tashkeel, unify alef/teh/yeh)
 */
export function normalizeArabicText(input: string): string {
  return normalizeDigits(input)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // strip harakat/tashkeel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Built-in Egyptian Arabic & English keyword dictionary mapped to default category IDs
 */
const EGYPTIAN_SYNONYMS: Array<{ categoryId: string; type?: TransactionType; keywords: string[] }> = [
  {
    categoryId: 'cat-salary',
    type: 'income',
    keywords: ['راتب', 'مرتب', 'قبض', 'مكافاه', 'مكافاة', 'بونص', 'حافز', 'معاش', 'salary', 'payroll', 'bonus'],
  },
  {
    categoryId: 'cat-freelance',
    type: 'income',
    keywords: ['فريلانس', 'شغل', 'مشروع', 'عموله', 'تصميم', 'برمجه', 'استشاره', 'اتعاب', 'freelance', 'client', 'project'],
  },
  {
    categoryId: 'cat-withdraw',
    type: 'income',
    keywords: ['استرداد', 'كاش باك', 'هديه فلوس', 'تحويل ليا', 'ايراد', 'دخل', 'refund', 'cashback', 'income'],
  },
  {
    categoryId: 'cat-restaurants',
    type: 'expense',
    keywords: [
      'غدا', 'غداء', 'فطار', 'فطور', 'عشا', 'عشاء', 'اكل', 'مطعم', 'سندوتش', 'ساندوتش',
      'بيتزا', 'شاورما', 'كشري', 'فول', 'طعميه', 'برجر', 'دليفري', 'طلبات', 'lunch', 'dinner', 'breakfast', 'food', 'restaurant',
    ],
  },
  {
    categoryId: 'cat-cafes',
    type: 'expense',
    keywords: [
      'قهوه', 'شاي', 'كافيه', 'كوفي', 'نسكافيه', 'كابتشينو', 'لاتيه', 'عصير', 'مشروب', 'مياه غازيه',
      'بيبسي', 'ستاربكس', 'coffee', 'cafe', 'tea', 'latte', 'juice',
    ],
  },
  {
    categoryId: 'cat-groceries',
    type: 'expense',
    keywords: [
      'سوبرماركت', 'سوبر ماركت', 'بقاله', 'خضار', 'فاكهه', 'لبن', 'حليب', 'عيش', 'خبز', 'لحمه',
      'فراخ', 'جبنه', 'تموين', 'كارفور', 'كازيون', 'بيم', 'فتح الله', 'سوق', 'groceries', 'market', 'supermarket',
    ],
  },
  {
    categoryId: 'cat-fuel',
    type: 'expense',
    keywords: [
      'بنزين', 'سولار', 'تفويله', 'تفويل', 'زيت عربيه', 'صيانه', 'ركنه', 'سايس', 'جراج', 'غسيل عربيه',
      'fuel', 'gas', 'petrol', 'parking',
    ],
  },
  {
    categoryId: 'cat-transport',
    type: 'expense',
    keywords: [
      'اوبر', 'كريم', 'ان درايف', 'مواصلات', 'مترو', 'ميكروباص', 'توك توك', 'توكتوك', 'تاكسي',
      'اتوبيس', 'باص', 'مشوار', 'سفر', 'قطر', 'تذكره', 'uber', 'careem', 'taxi', 'metro', 'bus', 'transport',
    ],
  },
  {
    categoryId: 'cat-bills',
    type: 'expense',
    keywords: [
      'كهربا', 'كهرباء', 'مياه', 'ميه', 'غاز', 'نت', 'انترنت', 'وي', 'فودافون', 'اورانج', 'اتصالات',
      'شحن', 'رصيد', 'باقه', 'موبايل', 'تليفون', 'فاتوره', 'اشتراك', 'bill', 'internet', 'electricity', 'wifi', 'phone',
    ],
  },
  {
    categoryId: 'cat-rent',
    type: 'expense',
    keywords: ['ايجار', 'شقه', 'سكن', 'بواب', 'عقار', 'صيانه عماره', 'rent', 'housing', 'apartment'],
  },
  {
    categoryId: 'cat-pharmacy',
    type: 'expense',
    keywords: ['دوا', 'دواء', 'صيدليه', 'علاج', 'برشام', 'فيتامين', 'pharmacy', 'medicine'],
  },
  {
    categoryId: 'cat-health',
    type: 'expense',
    keywords: ['دكتور', 'كشف', 'عياده', 'مستشفي', 'تحاليل', 'اشعه', 'اسنان', 'طبيب', 'doctor', 'clinic', 'hospital'],
  },
  {
    categoryId: 'cat-shopping',
    type: 'expense',
    keywords: ['لبس', 'هدوم', 'ملابس', 'شوبينج', 'مول', 'كوتشي', 'جزمه', 'شنطه', 'shopping', 'clothes', 'shoes'],
  },
  {
    categoryId: 'cat-education',
    type: 'expense',
    keywords: ['كورس', 'درس', 'كتب', 'كتاب', 'مدرسه', 'جامعه', 'تعليم', 'محاضره', 'course', 'books', 'school'],
  },
  {
    categoryId: 'cat-entertainment',
    type: 'expense',
    keywords: ['سينما', 'خروجه', 'فسحه', 'ملاهي', 'جيم', 'نادي', 'بلايستيشن', 'لعبه', 'ترفيه', 'cinema', 'gym', 'game'],
  },
  {
    categoryId: 'cat-gifts',
    type: 'expense',
    keywords: ['هديه', 'نقطه', 'عزومه', 'عيد ميلاد', 'gift', 'birthday'],
  },
  {
    categoryId: 'cat-charity',
    type: 'expense',
    keywords: ['صدقه', 'تبرع', 'زكاه', 'خير', 'charity', 'donation', 'zakat'],
  },
];

/**
 * Parse a quick-entry dialect string into structured transaction fields.
 * Returns null if no positive numeric amount can be extracted.
 */
export function parseDialectQuickEntry(
  rawInput: string,
  categories: Category[]
): DialectParseResult | null {
  if (!rawInput || !rawInput.trim()) return null;

  const digitsNormalized = normalizeDigits(rawInput);
  // Extract first number (e.g., 50, 200, 45.5, 1,500)
  const sanitizedForNum = digitsNormalized.replace(/(?<=\d),(?=\d{3})/g, '');
  const numberMatch = sanitizedForNum.match(/\d+(?:\.\d+)?/);
  if (!numberMatch) return null;

  const amount = parseFloat(numberMatch[0]);
  if (!isFinite(amount) || amount <= 0) return null;

  // Remaining text without the matched number becomes keyword source + notes
  const withoutAmount = sanitizedForNum
    .replace(numberMatch[0], ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normPhrase = normalizeArabicText(withoutAmount);
  const words = normPhrase.split(' ').filter(Boolean);

  let matchedCategory: Category | undefined;
  let inferredType: TransactionType | undefined;
  let matchedKeyword: string | undefined;

  // 1. Check built-in Egyptian Arabic + English synonym dictionary (longest keyword match first)
  let bestKeywordLength = 0;
  for (const entry of EGYPTIAN_SYNONYMS) {
    for (const kw of entry.keywords) {
      const normKw = normalizeArabicText(kw);
      const isMatch =
        normPhrase === normKw ||
        words.includes(normKw) ||
        (normKw.length >= 3 && normPhrase.includes(normKw));

      if (isMatch && normKw.length > bestKeywordLength) {
        const foundCat = categories.find((c) => c.id === entry.categoryId);
        if (foundCat) {
          matchedCategory = foundCat;
          inferredType = entry.type || (foundCat.type === 'income' ? 'income' : 'expense');
          matchedKeyword = kw;
          bestKeywordLength = normKw.length;
        }
      }
    }
  }

  // 2. Fallback: match directly against user/custom category Arabic & English names
  if (!matchedCategory && normPhrase.length > 0) {
    for (const cat of categories) {
      if (cat.isHidden) continue;
      const ar = normalizeArabicText(cat.nameAr);
      const en = normalizeArabicText(cat.nameEn);
      if (
        (ar && (normPhrase.includes(ar) || words.some((w) => w.length >= 2 && ar.includes(w)))) ||
        (en && (normPhrase.includes(en) || words.some((w) => w.length >= 3 && en.includes(w))))
      ) {
        matchedCategory = cat;
        inferredType = cat.type === 'income' ? 'income' : 'expense';
        matchedKeyword = cat.nameAr;
        break;
      }
    }
  }

  // 3. Fallback category if amount found with unrecognized text
  if (!matchedCategory) {
    const fallbackOther =
      categories.find((c) => c.id === 'cat-other') ||
      categories.find((c) => !c.isHidden && c.type !== 'income') ||
      categories[0];
    matchedCategory = fallbackOther;
    inferredType = 'expense';
  }

  const finalType: TransactionType =
    inferredType || (matchedCategory?.type === 'income' ? 'income' : 'expense');

  return {
    amount,
    type: finalType,
    categoryId: matchedCategory?.id || 'cat-other',
    matchedKeyword,
    notes: withoutAmount,
  };
}
