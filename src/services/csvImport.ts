/**
 * CSV Import Parser, Auto Column Mapper & Duplicate Detector
 */
import { Category, Transaction, TransactionType } from '../types';
import { normalizeArabicText, normalizeDigits } from './dialectParser';

export interface CsvColumnMapping {
  dateIndex: number; // -1 if unmapped
  amountIndex: number; // -1 if unmapped
  typeIndex: number; // -1 if unmapped (optional: defaults to expense unless negative or income keyword)
  categoryIndex: number; // -1 if unmapped
  notesIndex: number; // -1 if unmapped
}

export interface CsvParsedTable {
  headers: string[];
  rows: string[][];
}

export interface CsvPreviewRow {
  rowIndex: number;
  date: string;
  amount: number;
  type: TransactionType;
  categoryId: string;
  categoryLabel: string;
  notes: string;
  isDuplicate: boolean;
  isValid: boolean;
  errorReason?: string;
}

/**
 * RFC-4180 compliant CSV parser handling BOM, quoted fields, escaped quotes, CRLF/LF.
 */
export function parseCsvText(rawText: string): CsvParsedTable {
  const cleanText = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return { headers: [], rows: [] };

  const records: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    const next = cleanText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (ch === '\r' && next === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((cell) => cell !== '')) records.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentField.trim());
        if (currentRow.some((cell) => cell !== '')) records.push(currentRow);
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell !== '')) records.push(currentRow);
  }

  if (records.length === 0) return { headers: [], rows: [] };
  return {
    headers: records[0],
    rows: records.slice(1),
  };
}

/**
 * Smart column mapping detection from Arabic or English header names
 */
export function autoDetectCsvMapping(headers: string[]): CsvColumnMapping {
  const mapping: CsvColumnMapping = {
    dateIndex: -1,
    amountIndex: -1,
    typeIndex: -1,
    categoryIndex: -1,
    notesIndex: -1,
  };

  headers.forEach((h, idx) => {
    const norm = normalizeArabicText(h);
    if (
      mapping.dateIndex === -1 &&
      (norm.includes('تاريخ') || norm.includes('date') || norm.includes('day'))
    ) {
      mapping.dateIndex = idx;
    } else if (
      mapping.amountIndex === -1 &&
      (norm.includes('مبلغ') || norm.includes('قيمه') || norm.includes('amount') || norm.includes('value') || norm.includes('total'))
    ) {
      mapping.amountIndex = idx;
    } else if (
      mapping.typeIndex === -1 &&
      (norm.includes('نوع') || norm.includes('type') || norm.includes('kind'))
    ) {
      mapping.typeIndex = idx;
    } else if (
      mapping.categoryIndex === -1 &&
      (norm.includes('تصنيف') || norm.includes('فئه') || norm.includes('category'))
    ) {
      mapping.categoryIndex = idx;
    } else if (
      mapping.notesIndex === -1 &&
      (norm.includes('ملاحظ') || norm.includes('وصف') || norm.includes('تفاصيل') || norm.includes('note') || norm.includes('desc') || norm.includes('memo'))
    ) {
      mapping.notesIndex = idx;
    }
  });

  // Fallback heuristics if headers were generic
  if (mapping.dateIndex === -1 && headers.length >= 1) mapping.dateIndex = 0;
  if (mapping.amountIndex === -1 && headers.length >= 2) mapping.amountIndex = 1;

  return mapping;
}

/**
 * Normalize date string to YYYY-MM-DD (supports YYYY-MM-DD, DD/MM/YYYY, YYYY/MM/DD)
 */
export function normalizeCsvDate(raw: string): string | null {
  const cleaned = normalizeDigits(raw || '').trim().split(' ')[0];
  if (!cleaned) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }

  return null;
}

function buildDuplicateKey(date: string, amount: number, type: TransactionType): string {
  return `${date}|${amount.toFixed(3)}|${type}`;
}

/**
 * Map CSV rows to preview transactions with duplicate detection against existing transactions
 */
export function mapCsvRowsToTransactions(params: {
  rows: string[][];
  mapping: CsvColumnMapping;
  categories: Category[];
  existingTransactions: Transaction[];
}): {
  previewRows: CsvPreviewRow[];
  validCount: number;
  duplicateCount: number;
} {
  const { rows, mapping, categories, existingTransactions } = params;

  // Pre-index existing transactions in O(N) for fast duplicate detection even at 5,000+ rows
  const existingKeys = new Set<string>();
  for (const tx of existingTransactions) {
    existingKeys.add(buildDuplicateKey(tx.date, tx.amount, tx.type));
  }

  const fallbackCategory =
    categories.find((c) => c.id === 'cat-other') || categories[0];

  let validCount = 0;
  let duplicateCount = 0;

  const previewRows: CsvPreviewRow[] = rows.map((row, idx) => {
    const rawDate = mapping.dateIndex >= 0 ? row[mapping.dateIndex] || '' : '';
    const rawAmount = mapping.amountIndex >= 0 ? row[mapping.amountIndex] || '' : '';
    const rawType = mapping.typeIndex >= 0 ? row[mapping.typeIndex] || '' : '';
    const rawCat = mapping.categoryIndex >= 0 ? row[mapping.categoryIndex] || '' : '';
    const rawNotes = mapping.notesIndex >= 0 ? row[mapping.notesIndex] || '' : '';

    const normalizedDate = normalizeCsvDate(rawDate);

    // Parse amount (strip currency codes/spaces/thousands commas)
    const numericStr = normalizeDigits(rawAmount)
      .replace(/,/g, '')
      .replace(/[^\d.-]/g, '');
    const parsedNum = parseFloat(numericStr);
    const amount = isFinite(parsedNum) ? Math.abs(parsedNum) : NaN;

    // Infer type
    const normType = normalizeArabicText(rawType);
    let type: TransactionType = 'expense';
    if (
      normType.includes('دخل') ||
      normType.includes('ايراد') ||
      normType.includes('income') ||
      normType.includes('credit') ||
      normType.includes('deposit')
    ) {
      type = 'income';
    } else if (normType.includes('تحويل') || normType.includes('transfer')) {
      type = 'transfer';
    } else if (mapping.typeIndex === -1 && parsedNum < 0) {
      type = 'expense';
    }

    // Match category
    let matchedCat = fallbackCategory;
    if (rawCat.trim()) {
      const normCat = normalizeArabicText(rawCat);
      const found = categories.find(
        (c) =>
          normalizeArabicText(c.nameAr) === normCat ||
          normalizeArabicText(c.nameEn) === normCat ||
          normalizeArabicText(c.nameAr).includes(normCat) ||
          normalizeArabicText(c.nameEn).includes(normCat)
      );
      if (found) matchedCat = found;
    }

    const isValid = Boolean(normalizedDate && !isNaN(amount) && amount > 0);
    const key = normalizedDate && isValid ? buildDuplicateKey(normalizedDate, amount, type) : '';
    const isDuplicate = Boolean(isValid && key && existingKeys.has(key));

    if (isValid) validCount++;
    if (isDuplicate) duplicateCount++;

    return {
      rowIndex: idx + 1,
      date: normalizedDate || rawDate,
      amount: isValid ? amount : 0,
      type,
      categoryId: matchedCat?.id || 'cat-other',
      categoryLabel: matchedCat?.nameAr || rawCat || 'أخرى',
      notes: rawNotes.trim(),
      isDuplicate,
      isValid,
      errorReason: !normalizedDate
        ? 'Invalid date'
        : isNaN(amount) || amount <= 0
        ? 'Invalid amount'
        : undefined,
    };
  });

  return { previewRows, validCount, duplicateCount };
}
