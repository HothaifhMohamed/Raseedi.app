/**
 * Spreadsheet (Excel .xlsx/.xls) & CSV Import Parser,
 * Auto Column Mapper, Validator & Duplicate Detector
 */
import * as XLSX from 'xlsx';
import { Category, Transaction, TransactionType } from '../types';
import { normalizeArabicText, normalizeDigits } from './dialectParser';
import { normalizeArabicPersianNumerals } from './numbers';

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

export interface TabularImportData extends CsvParsedTable {
  records: Record<string, string>[];
  fileType: 'csv' | 'xlsx' | 'xls';
  sheetNames?: string[];
  activeSheet?: string;
}

export type ParseImportFileResult =
  | { ok: true; data: TabularImportData }
  | {
      ok: false;
      errorCode: 'UNSUPPORTED_FORMAT' | 'EMPTY_FILE' | 'CORRUPT_FILE';
      errorAr: string;
      errorEn: string;
    };

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
  errorReasonAr?: string;
}

function isValidCalendarYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function formatUtcYmd(dt: Date): string | null {
  if (isNaN(dt.getTime())) return null;
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth() + 1;
  const day = dt.getUTCDate();
  if (!isValidCalendarYmd(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Converts headers + rows into a normalized Array of Objects (JSON records).
 */
export function rowsToRecordObjects(
  headers: string[],
  rows: string[][]
): Record<string, string>[] {
  const seenKeys = new Map<string, number>();
  const uniqueHeaders = headers.map((h, idx) => {
    const base = (h || '').trim() || `column_${idx + 1}`;
    const count = seenKeys.get(base) || 0;
    seenKeys.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });

  return rows.map((row) => {
    const obj: Record<string, string> = {};
    uniqueHeaders.forEach((key, idx) => {
      obj[key] = row[idx] !== undefined ? String(row[idx]).trim() : '';
    });
    return obj;
  });
}

function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Validates file extension, MIME type, and magic bytes to reject unsupported files
 * (such as PDF, images, Word docs, archives, or binaries) cleanly before parsing.
 */
export function validateImportFile(params: {
  fileName: string;
  mimeType?: string;
  bytes?: Uint8Array;
}):
  | { ok: true; kind: 'csv' | 'xlsx' | 'xls' }
  | {
      ok: false;
      errorCode: 'UNSUPPORTED_FORMAT' | 'EMPTY_FILE';
      errorAr: string;
      errorEn: string;
    } {
  const { fileName, mimeType = '', bytes } = params;
  const lowerName = (fileName || '').trim().toLowerCase();
  const lowerMime = (mimeType || '').trim().toLowerCase();

  const unsupported = {
    ok: false as const,
    errorCode: 'UNSUPPORTED_FORMAT' as const,
    errorAr:
      'صيغة الملف غير مدعومة! يُسمح فقط بملفات Excel (.xlsx, .xls) أو CSV (.csv). لا يمكن استيراد الصور أو ملفات PDF.',
    errorEn:
      'Unsupported file format! Only Excel (.xlsx, .xls) and CSV (.csv) files are supported. Images and PDFs cannot be imported here.',
  };

  if (bytes && bytes.length === 0) {
    return {
      ok: false,
      errorCode: 'EMPTY_FILE',
      errorAr: 'الملف المختار فارغ ولا يحتوي على بيانات.',
      errorEn: 'The selected file is empty.',
    };
  }

  // Explicitly block images / PDFs / audio / video by MIME or magic bytes
  if (
    lowerMime.startsWith('image/') ||
    lowerMime.startsWith('video/') ||
    lowerMime.startsWith('audio/') ||
    lowerMime === 'application/pdf'
  ) {
    return unsupported;
  }

  if (bytes) {
    // PDF: %PDF-
    if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return unsupported;
    // PNG: 89 50 4E 47
    if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47])) return unsupported;
    // JPEG: FF D8 FF
    if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return unsupported;
    // GIF: GIF8
    if (startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38])) return unsupported;
    // WEBP: RIFF....WEBP
    if (
      bytes.length >= 12 &&
      startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return unsupported;
    }
  }

  let kind: 'csv' | 'xlsx' | 'xls' | null = null;
  if (lowerName.endsWith('.xlsx')) kind = 'xlsx';
  else if (lowerName.endsWith('.xls')) kind = 'xls';
  else if (lowerName.endsWith('.csv')) kind = 'csv';

  if (!kind) {
    return unsupported;
  }

  // If marked .csv, make sure it isn't a binary file (null bytes outside UTF-16 BOM)
  if (kind === 'csv' && bytes) {
    const hasUtf16Bom =
      startsWithBytes(bytes, [0xff, 0xfe]) || startsWithBytes(bytes, [0xfe, 0xff]);
    if (!hasUtf16Bom) {
      const sampleLen = Math.min(bytes.length, 512);
      for (let i = 0; i < sampleLen; i++) {
        if (bytes[i] === 0x00) {
          return unsupported;
        }
      }
    }
  }

  return { ok: true, kind };
}

/**
 * Decodes raw CSV bytes cleanly, supporting UTF-8 BOM, UTF-16 LE/BE, UTF-8,
 * and falling back to Windows-1256 (Arabic Excel CSV) so Arabic text never garbles.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  // UTF-8 BOM
  if (startsWithBytes(bytes, [0xef, 0xbb, 0xbf])) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  // UTF-16 LE BOM
  if (startsWithBytes(bytes, [0xff, 0xfe])) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  // UTF-16 BE BOM
  if (startsWithBytes(bytes, [0xfe, 0xff])) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  // Try strict UTF-8 first
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Fallback to Windows-1256 (standard Arabic ANSI encoding from legacy Excel exports)
    try {
      return new TextDecoder('windows-1256').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

function detectCsvDelimiter(firstLineSample: string): ',' | ';' | '\t' {
  let commas = 0;
  let semis = 0;
  let tabs = 0;
  let inQuotes = false;

  for (let i = 0; i < firstLineSample.length; i++) {
    const ch = firstLineSample[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === '\n' || ch === '\r') break;
      if (ch === ',') commas++;
      else if (ch === ';') semis++;
      else if (ch === '\t') tabs++;
    }
  }

  if (semis > commas && semis >= tabs) return ';';
  if (tabs > commas && tabs > semis) return '\t';
  return ',';
}

/**
 * RFC-4180 compliant CSV parser handling BOM, quoted fields, escaped quotes,
 * CRLF/LF, and auto-detected delimiters (`,`, `;`, `\t`).
 */
export function parseCsvText(rawText: string): CsvParsedTable & { records: Record<string, string>[] } {
  const cleanText = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return { headers: [], rows: [], records: [] };

  const delimiter = detectCsvDelimiter(cleanText);
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
      } else if (ch === delimiter) {
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

  if (records.length === 0) return { headers: [], rows: [], records: [] };
  const headers = records[0];
  const rows = records.slice(1);
  return {
    headers,
    rows,
    records: rowsToRecordObjects(headers, rows),
  };
}

function formatSpreadsheetCell(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    if (isNaN(cell.getTime())) return '';
    // SheetJS stores parsed dates using UTC or local noon; adjust slightly for timezone offset rounding
    const adjusted = new Date(cell.getTime() + 12 * 3600 * 1000);
    return formatUtcYmd(adjusted) || '';
  }
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return '';
    return String(cell);
  }
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  return String(cell).trim();
}

/**
 * Parses an Excel (.xlsx / .xls) or CSV file buffer into a uniform table + JSON array of objects.
 */
export function parseImportFileBuffer(params: {
  bytes: Uint8Array;
  fileName: string;
  mimeType?: string;
  sheetName?: string;
}): ParseImportFileResult {
  const { bytes, fileName, mimeType, sheetName } = params;
  const check = validateImportFile({ fileName, mimeType, bytes });
  if (!check.ok) {
    return check;
  }

  if (check.kind === 'csv') {
    const decoded = decodeCsvBytes(bytes);
    const parsed = parseCsvText(decoded);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      return {
        ok: false,
        errorCode: 'EMPTY_FILE',
        errorAr: 'ملف CSV فارغ أو لا يحتوي على صفوف صالحة.',
        errorEn: 'CSV file is empty or has no data rows.',
      };
    }
    return {
      ok: true,
      data: {
        headers: parsed.headers,
        rows: parsed.rows,
        records: parsed.records,
        fileType: 'csv',
      },
    };
  }

  // Excel (.xlsx / .xls)
  try {
    const workbook = XLSX.read(bytes, {
      type: 'array',
      cellDates: true,
      cellNF: false,
      cellText: false,
    });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        ok: false,
        errorCode: 'EMPTY_FILE',
        errorAr: 'ملف الإكسل لا يحتوي على أي أوراق عمل.',
        errorEn: 'Excel workbook contains no worksheets.',
      };
    }

    const extractSheetRows = (name: string): string[][] => {
      const ws = workbook.Sheets[name];
      if (!ws) return [];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: '',
        blankrows: false,
        raw: true,
      });
      return aoa
        .map((r) => (Array.isArray(r) ? r.map(formatSpreadsheetCell) : []))
        .filter((r) => r.some((cell) => cell !== ''));
    };

    let selectedSheet = sheetName && workbook.SheetNames.includes(sheetName)
      ? sheetName
      : workbook.SheetNames[0];
    let rawGrid = extractSheetRows(selectedSheet);

    // If first sheet is empty and user didn't explicitly pick one, find first non-empty sheet
    if (rawGrid.length < 2 && !sheetName) {
      for (const candidate of workbook.SheetNames) {
        const candidateGrid = extractSheetRows(candidate);
        if (candidateGrid.length >= 2) {
          selectedSheet = candidate;
          rawGrid = candidateGrid;
          break;
        }
      }
    }

    if (rawGrid.length < 2) {
      return {
        ok: false,
        errorCode: 'EMPTY_FILE',
        errorAr: 'ورقة الإكسل فارغة أو لا تحتوي على صفوف بيانات بعد العناوين.',
        errorEn: 'Excel sheet is empty or has no data rows beneath the header row.',
      };
    }

    // Trim trailing completely-empty columns
    const maxCols = rawGrid.reduce((max, r) => {
      let lastNonEmpty = r.length - 1;
      while (lastNonEmpty >= 0 && r[lastNonEmpty] === '') lastNonEmpty--;
      return Math.max(max, lastNonEmpty + 1);
    }, 0);

    if (maxCols === 0) {
      return {
        ok: false,
        errorCode: 'EMPTY_FILE',
        errorAr: 'ورقة الإكسل فارغة.',
        errorEn: 'Excel sheet is empty.',
      };
    }

    const normalizedGrid = rawGrid.map((r) => {
      const sliced = r.slice(0, maxCols);
      while (sliced.length < maxCols) sliced.push('');
      return sliced;
    });

    const headers = normalizedGrid[0];
    const rows = normalizedGrid.slice(1);

    return {
      ok: true,
      data: {
        headers,
        rows,
        records: rowsToRecordObjects(headers, rows),
        fileType: check.kind,
        sheetNames: workbook.SheetNames,
        activeSheet: selectedSheet,
      },
    };
  } catch {
    return {
      ok: false,
      errorCode: 'CORRUPT_FILE',
      errorAr:
        'تعذرت قراءة ملف الإكسل — قد يكون الملف تالفاً أو محمياً بكلمة مرور أو ليس بصيغة Excel صالحة.',
      errorEn:
        'Could not read the Excel file — it may be corrupted, password-protected, or not a valid spreadsheet.',
    };
  }
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
    if (!norm) return;

    if (
      mapping.dateIndex === -1 &&
      (norm.includes('تاريخ') || norm.includes('date') || norm.includes('day') || norm === 'time')
    ) {
      mapping.dateIndex = idx;
    } else if (
      mapping.amountIndex === -1 &&
      (norm.includes('مبلغ') ||
        norm.includes('قيمه') ||
        norm.includes('سعر') ||
        norm.includes('تكلفه') ||
        norm.includes('amount') ||
        norm.includes('value') ||
        norm.includes('total') ||
        norm.includes('price') ||
        norm.includes('sum'))
    ) {
      mapping.amountIndex = idx;
    } else if (
      mapping.typeIndex === -1 &&
      (norm.includes('نوع') || norm.includes('حركه') || norm.includes('type') || norm.includes('kind'))
    ) {
      mapping.typeIndex = idx;
    } else if (
      mapping.categoryIndex === -1 &&
      (norm.includes('تصنيف') || norm.includes('فئه') || norm.includes('بند') || norm.includes('category'))
    ) {
      mapping.categoryIndex = idx;
    } else if (
      mapping.notesIndex === -1 &&
      (norm.includes('ملاحظ') ||
        norm.includes('بيان') ||
        norm.includes('وصف') ||
        norm.includes('تفاصيل') ||
        norm.includes('note') ||
        norm.includes('desc') ||
        norm.includes('memo') ||
        norm.includes('remark') ||
        norm.includes('detail'))
    ) {
      mapping.notesIndex = idx;
    }
  });

  // Fallback heuristics only if headers weren't recognized AND indices aren't already claimed
  const usedIndices = new Set(Object.values(mapping).filter((v) => v >= 0));
  if (mapping.dateIndex === -1 && headers.length >= 1 && !usedIndices.has(0)) {
    mapping.dateIndex = 0;
    usedIndices.add(0);
  }
  if (mapping.amountIndex === -1 && headers.length >= 2) {
    const candidate = !usedIndices.has(1) ? 1 : headers.findIndex((_, i) => !usedIndices.has(i));
    if (candidate >= 0) mapping.amountIndex = candidate;
  }

  return mapping;
}

/**
 * Normalize date string, Date object, or Excel serial number to YYYY-MM-DD strictly.
 * Rejects invalid calendar dates such as 2025-02-30 or month 13.
 */
export function normalizeCsvDate(raw: string | number | Date): string | null {
  if (raw instanceof Date) {
    return formatUtcYmd(raw);
  }

  const cleaned = normalizeDigits(String(raw ?? ''))
    .trim()
    .split(/[T\s]/)[0];
  if (!cleaned) return null;

  // Excel serial number (e.g., 45788 -> 2025-05-11), valid between 1970 and 2100
  if (/^\d{4,5}(\.\d+)?$/.test(cleaned)) {
    const serial = Math.floor(Number(cleaned));
    if (serial >= 25569 && serial <= 73050) {
      const utcMs = (serial - 25569) * 86400 * 1000;
      return formatUtcYmd(new Date(utcMs));
    }
    return null;
  }

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (!isValidCalendarYmd(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    if (!isValidCalendarYmd(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Reject purely alphabetic or malformed short strings
  if (!/\d{4}/.test(cleaned)) return null;

  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    return formatUtcYmd(
      new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()))
    );
  }

  return null;
}

/**
 * Strictly parses a localized amount cell (supports Arabic/Persian digits, currency labels,
 * thousands separators, and accounting parentheses `(150.00)`). Returns null if invalid.
 */
export function parseImportAmount(raw: string): { amount: number; isNegative: boolean } | null {
  let text = normalizeArabicPersianNumerals(String(raw ?? '')).trim();
  if (!text) return null;

  let isNegative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    isNegative = true;
    text = text.slice(1, -1).trim();
  }

  // Strip known currency labels/symbols cleanly
  text = text
    .replace(
      /(ج\.م\.?|جنيه|ريال|ر\.س\.?|د\.إ\.?|د\.ك\.?|د\.ب\.?|د\.أ\.?|EGP|SAR|AED|USD|EUR|GBP|KWD|QAR|BHD|OMR|JOD|\$|€|£)/gi,
      ''
    )
    .replace(/\s+/g, '')
    .trim();

  if (!text) return null;

  // Reject any leftover alphabetic characters or invalid tokens (prevents corrupted text turning into numbers)
  if (/[a-zA-Z\u0600-\u06FF]/.test(text)) return null;

  // Handle thousands commas: e.g. 1,250.50 or 1,250 -> remove commas
  // (If it looks like "12,50" with no dot and 2 decimals after comma, treat comma as decimal separator)
  if (/^-?\d+,\d{1,2}$/.test(text) && !text.includes('.')) {
    text = text.replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null;

  const num = Number(text);
  if (!Number.isFinite(num)) return null;
  if (num < 0) isNegative = true;

  const absVal = Math.abs(num);
  if (absVal <= 0 || absVal > 1_000_000_000_000) return null;

  return { amount: absVal, isNegative };
}

function buildDuplicateKey(date: string, amount: number, type: TransactionType): string {
  return `${date}|${amount.toFixed(3)}|${type}`;
}

/**
 * Map CSV / Excel rows to preview transactions with strict validation and duplicate detection.
 */
export function mapCsvRowsToTransactions(params: {
  rows: string[][];
  mapping: CsvColumnMapping;
  categories: Category[];
  existingTransactions: Transaction[];
}): {
  previewRows: CsvPreviewRow[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
} {
  const { rows, mapping, categories, existingTransactions } = params;

  // Pre-index existing transactions in O(N) for fast duplicate detection even at 5,000+ rows
  const existingKeys = new Set<string>();
  for (const tx of existingTransactions) {
    if (tx.deletedAt) continue;
    existingKeys.add(buildDuplicateKey(tx.date, tx.amount, tx.type));
  }

  const fallbackCategory =
    categories.find((c) => c.id === 'cat-other') || categories[0];

  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  const previewRows: CsvPreviewRow[] = rows.map((row, idx) => {
    const rawDate = mapping.dateIndex >= 0 ? row[mapping.dateIndex] || '' : '';
    const rawAmount = mapping.amountIndex >= 0 ? row[mapping.amountIndex] || '' : '';
    const rawType = mapping.typeIndex >= 0 ? row[mapping.typeIndex] || '' : '';
    const rawCat = mapping.categoryIndex >= 0 ? row[mapping.categoryIndex] || '' : '';
    const rawNotes = mapping.notesIndex >= 0 ? row[mapping.notesIndex] || '' : '';

    const normalizedDate = normalizeCsvDate(rawDate);
    const parsedAmount = parseImportAmount(rawAmount);
    const amount = parsedAmount ? parsedAmount.amount : NaN;

    // Infer type
    const normType = normalizeArabicText(rawType);
    let type: TransactionType = 'expense';
    if (
      normType.includes('دخل') ||
      normType.includes('ايراد') ||
      normType.includes('ايداع') ||
      normType.includes('income') ||
      normType.includes('credit') ||
      normType.includes('deposit')
    ) {
      type = 'income';
    } else if (normType.includes('تحويل') || normType.includes('transfer')) {
      type = 'transfer';
    } else if (mapping.typeIndex === -1 && parsedAmount?.isNegative) {
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

    const isValid = Boolean(normalizedDate && parsedAmount && amount > 0);
    const key = normalizedDate && isValid ? buildDuplicateKey(normalizedDate, amount, type) : '';
    const isDuplicate = Boolean(isValid && key && existingKeys.has(key));

    if (isValid) validCount++;
    else invalidCount++;
    if (isDuplicate) duplicateCount++;

    let errorReason: string | undefined;
    let errorReasonAr: string | undefined;
    if (!normalizedDate && !parsedAmount) {
      errorReason = 'Invalid date & amount';
      errorReasonAr = 'التاريخ والمبلغ غير صالحين';
    } else if (!normalizedDate) {
      errorReason = 'Invalid date';
      errorReasonAr = 'تاريخ غير صالح';
    } else if (!parsedAmount) {
      errorReason = 'Invalid amount';
      errorReasonAr = 'مبلغ غير صالح';
    }

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
      errorReason,
      errorReasonAr,
    };
  });

  return { previewRows, validCount, invalidCount, duplicateCount };
}
