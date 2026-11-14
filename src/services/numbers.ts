/**
 * Numeric & Arabic/Persian numeral normalization utilities for Raseedi (رَصِيدِي)
 */

const NUMERAL_MAP: Record<string, string> = {
  // Eastern Arabic-Indic digits (٠-٩)
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  // Extended Arabic-Indic / Persian digits (۰-۹)
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  // Arabic decimal & thousands separators
  '٫': '.',
  '،': '.',
  '٬': '',
};

/**
 * Converts Eastern Arabic (٠١٢٣٤٥٦٧٨٩) and Persian (۰۱۲۳۴۵۶۷۸۹) digits to Western ASCII digits (0-9),
 * and converts Arabic decimal separators (٫ and ،) to a standard dot (.).
 */
export function normalizeArabicPersianNumerals(input: string): string {
  if (!input) return '';
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    out += ch in NUMERAL_MAP ? NUMERAL_MAP[ch] : ch;
  }
  return out;
}

/**
 * Variant for mixed text + numbers (like Quick Entry "قهوة ٣٣،٥"):
 * converts all Arabic/Persian digits to ASCII and turns ، between digits into '.',
 * without turning prose punctuation commas into periods.
 */
export function normalizeMixedNumericText(input: string): string {
  if (!input) return '';
  return input
    .replace(/[٠-٩۰-۹٫٬]/g, (ch) => NUMERAL_MAP[ch] ?? ch)
    .replace(/(?<=\d)،(?=\d)/g, '.');
}

/**
 * Normalizes a numeric/decimal input string on change (keeps digits, dot, and optional leading sign/math ops).
 */
export function sanitizeDecimalInput(
  input: string,
  options?: { allowNegative?: boolean; allowMathOps?: boolean }
): string {
  const normalized = normalizeArabicPersianNumerals(input);
  if (options?.allowMathOps) {
    return normalized;
  }
  const allowNeg = options?.allowNegative ?? false;
  let result = '';
  let hasDot = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch >= '0' && ch <= '9') {
      result += ch;
    } else if ((ch === '.' || ch === ',') && !hasDot) {
      result += '.';
      hasDot = true;
    } else if (allowNeg && ch === '-' && i === 0) {
      result += ch;
    }
  }
  return result;
}

/**
 * Parses a potentially Arabic/Persian-digit numeric string into a finite JS number (or NaN if invalid).
 */
export function parseLocalizedNumber(input: string | number | null | undefined): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  if (!input) return NaN;
  const normalized = normalizeArabicPersianNumerals(String(input))
    .replace(/\s+/g, '')
    // Strip ASCII thousands commas when followed by 3 digits and end/dot (e.g. 1,500.25)
    .replace(/(?<=\d),(?=\d{3}(?:[.,]|$))/g, '')
    .replace(/,/g, '.');
  if (!normalized || normalized === '-' || normalized === '.') return NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}
