/**
 * Spreadsheet (Excel .xlsx/.xls) & CSV Import Parser,
 * Auto Column Mapper, Validator & Duplicate Detector
 */
import * as XLSX from 'xlsx';
import { Category, MerchantRule, Transaction, TransactionType, Wallet } from '../types';
import { normalizeArabicText, normalizeDigits } from './dialectParser';
import { normalizeArabicPersianNumerals } from './numbers';
import { normalizeWorkspaceId } from './workspaceSync';
import { matchMerchantRule } from './merchantRules';
import {
  buildImportProgressState,
  ImportProgressState,
  yieldToMainThread,
} from './importProgress';

export interface CsvColumnMapping {
  dateIndex: number; // -1 if unmapped
  amountIndex: number; // -1 if unmapped
  typeIndex?: number; // optional legacy override; when -1/omitted uses Smart Amount (>0 income, <0 expense) & To-Wallet (transfer)
  categoryIndex: number; // -1 if unmapped
  notesIndex: number; // -1 if unmapped
  walletIndex?: number; // -1 or undefined if unmapped (auto-routes & auto-creates wallets)
  toWalletIndex?: number; // -1 or undefined if unmapped (non-empty value marks row as Transfer & auto-creates destination wallet)
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
  isNewCategory?: boolean;
  walletId?: string;
  walletName?: string;
  isNewWallet?: boolean;
  toWalletId?: string;
  toWalletName?: string;
  isNewToWallet?: boolean;
  costCenterId?: string;
  matchedRuleKeyword?: string;
  workspaceId?: string;
  notes: string;
  isDuplicate: boolean;
  isValid: boolean;
  errorReason?: string;
  errorReasonAr?: string;
}

export interface CsvImportMappingResult {
  previewRows: CsvPreviewRow[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  autoCreatedWallets: Wallet[];
  autoCreatedCategories: Category[];
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

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export { escapeCsvCell } from './csvEscape';

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
    if (UNSAFE_OBJECT_KEYS.has(base)) return null;
    const count = seenKeys.get(base) || 0;
    seenKeys.set(base, count + 1);
    const candidate = count === 0 ? base : `${base}_${count + 1}`;
    return UNSAFE_OBJECT_KEYS.has(candidate) ? null : candidate;
  });

  return rows.map((row) => {
    const obj: Record<string, string> = {};
    uniqueHeaders.forEach((key, idx) => {
      if (!key) return;
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
 * Non-blocking chunked conversion of headers + rows into JSON records.
 */
export async function rowsToRecordObjectsAsync(
  headers: string[],
  rows: string[][],
  chunkSize = 200,
  onProgress?: (processed: number, total: number) => void,
  shouldAbort?: () => boolean
): Promise<Record<string, string>[]> {
  const seenKeys = new Map<string, number>();
  const uniqueHeaders = headers.map((h, idx) => {
    const base = (h || '').trim() || `column_${idx + 1}`;
    if (UNSAFE_OBJECT_KEYS.has(base)) return null;
    const count = seenKeys.get(base) || 0;
    seenKeys.set(base, count + 1);
    const candidate = count === 0 ? base : `${base}_${count + 1}`;
    return UNSAFE_OBJECT_KEYS.has(candidate) ? null : candidate;
  });

  const safeChunk = Math.max(50, Math.floor(chunkSize));
  const total = rows.length;
  const result: Record<string, string>[] = new Array(total);

  for (let start = 0; start < total; start += safeChunk) {
    if (shouldAbort?.()) return result.slice(0, start);
    const end = Math.min(total, start + safeChunk);
    for (let r = start; r < end; r++) {
      const row = rows[r];
      const obj: Record<string, string> = {};
      for (let c = 0; c < uniqueHeaders.length; c++) {
        const key = uniqueHeaders[c];
        if (!key) continue;
        obj[key] = row[c] !== undefined ? String(row[c]).trim() : '';
      }
      result[r] = obj;
    }
    onProgress?.(end, total);
    if (end < total) {
      await yieldToMainThread();
    }
  }
  return result;
}

/**
 * Non-blocking RFC-4180 CSV parser that yields to the main thread every ~200 rows
 * so large spreadsheets never freeze the browser UI.
 */
export async function parseCsvTextAsync(
  rawText: string,
  options?: {
    chunkSize?: number;
    onProgress?: (processed: number, total: number) => void;
    shouldAbort?: () => boolean;
  }
): Promise<CsvParsedTable & { records: Record<string, string>[] }> {
  const cleanText = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return { headers: [], rows: [], records: [] };

  const delimiter = detectCsvDelimiter(cleanText);
  const rawRecords: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  const totalChars = cleanText.length;
  const yieldRowInterval = Math.max(100, options?.chunkSize ?? 200);
  let rowsSinceYield = 0;

  for (let i = 0; i < totalChars; i++) {
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
        if (currentRow.some((cell) => cell !== '')) {
          rawRecords.push(currentRow);
          rowsSinceYield++;
        }
        currentRow = [];
        currentField = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentField.trim());
        if (currentRow.some((cell) => cell !== '')) {
          rawRecords.push(currentRow);
          rowsSinceYield++;
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }

    if (rowsSinceYield >= yieldRowInterval) {
      rowsSinceYield = 0;
      if (options?.shouldAbort?.()) {
        return { headers: [], rows: [], records: [] };
      }
      options?.onProgress?.(Math.min(i + 1, totalChars), totalChars);
      await yieldToMainThread();
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell !== '')) rawRecords.push(currentRow);
  }

  options?.onProgress?.(totalChars, totalChars);

  if (rawRecords.length === 0) return { headers: [], rows: [], records: [] };
  const headers = rawRecords[0];
  const rows = rawRecords.slice(1);
  const records = await rowsToRecordObjectsAsync(
    headers,
    rows,
    yieldRowInterval,
    undefined,
    options?.shouldAbort
  );
  return { headers, rows, records };
}

/**
 * Non-blocking chunked parser for Excel (.xlsx / .xls) and CSV files.
 * Yields to the browser between chunks and reports real parsing progress.
 */
export async function parseImportFileBufferAsync(params: {
  bytes: Uint8Array;
  fileName: string;
  mimeType?: string;
  sheetName?: string;
  chunkSize?: number;
  onProgress?: (processed: number, total: number) => void;
  shouldAbort?: () => boolean;
}): Promise<ParseImportFileResult> {
  const { bytes, fileName, mimeType, sheetName, chunkSize = 200, onProgress, shouldAbort } = params;
  const check = validateImportFile({ fileName, mimeType, bytes });
  if (!check.ok) {
    return check;
  }

  if (check.kind === 'csv') {
    onProgress?.(0, Math.max(1, bytes.length));
    await yieldToMainThread();
    if (shouldAbort?.()) {
      return {
        ok: false,
        errorCode: 'EMPTY_FILE',
        errorAr: 'تم إلغاء القراءة.',
        errorEn: 'Parsing cancelled.',
      };
    }
    const decoded = decodeCsvBytes(bytes);
    const parsed = await parseCsvTextAsync(decoded, {
      chunkSize,
      onProgress,
      shouldAbort,
    });
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
    onProgress?.(10, 100);
    await yieldToMainThread();
    if (shouldAbort?.()) {
      return {
        ok: false,
        errorCode: 'EMPTY_FILE',
        errorAr: 'تم إلغاء القراءة.',
        errorEn: 'Parsing cancelled.',
      };
    }

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

    onProgress?.(40, 100);
    await yieldToMainThread();

    const extractSheetAoa = (name: string): unknown[][] => {
      const ws = workbook.Sheets[name];
      if (!ws) return [];
      return XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: '',
        blankrows: false,
        raw: true,
      });
    };

    const formatAoaChunked = async (aoa: unknown[][]): Promise<string[][]> => {
      const safeChunk = Math.max(100, Math.floor(chunkSize));
      const formatted: string[][] = [];
      for (let start = 0; start < aoa.length; start += safeChunk) {
        if (shouldAbort?.()) return formatted;
        const end = Math.min(aoa.length, start + safeChunk);
        for (let i = start; i < end; i++) {
          const r = aoa[i];
          if (!Array.isArray(r)) continue;
          const mapped = r.map(formatSpreadsheetCell);
          if (mapped.some((cell) => cell !== '')) {
            formatted.push(mapped);
          }
        }
        const pct = 40 + Math.round((end / Math.max(1, aoa.length)) * 50);
        onProgress?.(pct, 100);
        if (end < aoa.length) {
          await yieldToMainThread();
        }
      }
      return formatted;
    };

    let selectedSheet =
      sheetName && workbook.SheetNames.includes(sheetName)
        ? sheetName
        : workbook.SheetNames[0];
    let rawGrid = await formatAoaChunked(extractSheetAoa(selectedSheet));

    if (rawGrid.length < 2 && !sheetName) {
      for (const candidate of workbook.SheetNames) {
        if (candidate === selectedSheet) continue;
        const candidateGrid = await formatAoaChunked(extractSheetAoa(candidate));
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

    const normalizedGrid: string[][] = new Array(rawGrid.length);
    const safeChunk = Math.max(100, Math.floor(chunkSize));
    for (let start = 0; start < rawGrid.length; start += safeChunk) {
      if (shouldAbort?.()) break;
      const end = Math.min(rawGrid.length, start + safeChunk);
      for (let i = start; i < end; i++) {
        const sliced = rawGrid[i].slice(0, maxCols);
        while (sliced.length < maxCols) sliced.push('');
        normalizedGrid[i] = sliced;
      }
      if (end < rawGrid.length) {
        await yieldToMainThread();
      }
    }

    const headers = normalizedGrid[0];
    const rows = normalizedGrid.slice(1);
    const records = await rowsToRecordObjectsAsync(headers, rows, safeChunk, undefined, shouldAbort);
    onProgress?.(100, 100);

    return {
      ok: true,
      data: {
        headers,
        rows,
        records,
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

const ARABIC_MONTH_TO_ENGLISH: ReadonlyArray<[RegExp, string]> = [
  [/يناير/g, 'Jan'],
  [/فبراير/g, 'Feb'],
  [/مارس/g, 'Mar'],
  [/[أاإآ]بريل/g, 'Apr'],
  [/مايو/g, 'May'],
  [/يوني[وهة]/g, 'Jun'],
  [/يولي[وهة]/g, 'Jul'],
  [/[أاإآ]غسطس/g, 'Aug'],
  [/سبتمبر/g, 'Sep'],
  [/[أاإآ]كتوبر/g, 'Oct'],
  [/نوفمبر/g, 'Nov'],
  [/ديسمبر/g, 'Dec'],
];

const ENGLISH_MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Translates complex Arabic date strings (e.g. "15 نوفمبر، 2026 06:57 PM")
 * into standard English date strings parseable by `new Date()` / `Date.parse()`.
 */
export function parseArabicDate(dateString: string): string {
  if (!dateString) return '';

  let cleaned = normalizeDigits(String(dateString))
    // Replace Arabic comma with English comma
    .replace(/\u060C/g, ',')
    // Strip optional Arabic weekday prefixes (e.g. "الأحد، ")
    .replace(
      /(?:^|\s)(?:الأحد|الاحد|الإثنين|الاثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|الجمعه|السبت)\s*,?/g,
      ' '
    )
    // Normalize standalone Arabic AM/PM markers
    .replace(/(?:^|\s)(?:صباحاً|صباحا|ص)(?=\s|$)/g, ' AM')
    .replace(/(?:^|\s)(?:مساءً|مساء|م)(?=\s|$)/g, ' PM');

  for (const [pattern, engShort] of ARABIC_MONTH_TO_ENGLISH) {
    cleaned = cleaned.replace(pattern, engShort);
  }

  return cleaned
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Smart column mapping detection from Arabic or English header names.
 * Note: checks destination transfer wallet ("الى (المحفظة)") BEFORE general wallet ("المحفظة").
 */
export function autoDetectCsvMapping(headers: string[]): CsvColumnMapping {
  const mapping: CsvColumnMapping = {
    dateIndex: -1,
    amountIndex: -1,
    typeIndex: -1,
    categoryIndex: -1,
    notesIndex: -1,
    walletIndex: -1,
    toWalletIndex: -1,
  };

  let fallbackCategoryIndex = -1;

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
        norm.includes('cost') ||
        norm.includes('amount') ||
        norm.includes('value') ||
        norm.includes('total') ||
        norm.includes('price') ||
        norm.includes('sum'))
    ) {
      mapping.amountIndex = idx;
    } else if (
      mapping.toWalletIndex === -1 &&
      (norm.includes('الي (المحفظه)') ||
        norm.includes('الي المحفظه') ||
        norm.includes('الي محفظه') ||
        norm.includes('to (wallet)') ||
        norm.includes('to wallet') ||
        norm.includes('towallet') ||
        norm.includes('destination wallet') ||
        norm.includes('to account') ||
        norm === 'الي' ||
        norm === 'to')
    ) {
      mapping.toWalletIndex = idx;
    } else if (
      mapping.walletIndex === -1 &&
      (norm.includes('محفظه') || norm.includes('wallet') || norm.includes('account'))
    ) {
      mapping.walletIndex = idx;
    } else if (
      mapping.typeIndex === -1 &&
      (norm.includes('نوع') || norm.includes('حركه') || norm.includes('type') || norm.includes('kind'))
    ) {
      mapping.typeIndex = idx;
    } else if (
      norm.includes('القسم الرئيسي') ||
      norm.includes('تصنيف') ||
      norm.includes('فئه') ||
      norm.includes('بند') ||
      norm.includes('category') ||
      norm.includes('قسم')
    ) {
      const isPrimaryCategory =
        norm.includes('القسم الرئيسي') ||
        norm.includes('تصنيف') ||
        norm.includes('category') ||
        !norm.includes('فرعي');
      if (isPrimaryCategory && mapping.categoryIndex === -1) {
        mapping.categoryIndex = idx;
      } else if (fallbackCategoryIndex === -1) {
        fallbackCategoryIndex = idx;
      }
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

  if (mapping.categoryIndex === -1 && fallbackCategoryIndex !== -1) {
    mapping.categoryIndex = fallbackCategoryIndex;
  }

  // Fallback heuristics only if headers weren't recognized AND indices aren't already claimed
  const usedIndices = new Set(
    Object.values(mapping).filter((v): v is number => typeof v === 'number' && v >= 0)
  );
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
 * Normalize date string, Arabic date string, Date object, or Excel serial number to YYYY-MM-DD strictly.
 * Rejects invalid calendar dates such as 2025-02-30 or month 13.
 */
export function normalizeCsvDate(raw: string | number | Date): string | null {
  if (raw instanceof Date) {
    return formatUtcYmd(raw);
  }

  const normalized = parseArabicDate(String(raw ?? ''));
  if (!normalized) return null;

  // Excel serial number (e.g., 45788 -> 2025-05-11), valid between 1970 and 2100
  if (/^\d{4,5}(\.\d+)?$/.test(normalized)) {
    const serial = Math.floor(Number(normalized));
    if (serial >= 25569 && serial <= 73050) {
      const utcMs = (serial - 25569) * 86400 * 1000;
      return formatUtcYmd(new Date(utcMs));
    }
    return null;
  }

  // YYYY-MM-DD or YYYY/MM/DD (with optional T/space time suffix)
  const isoMatch = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (!isValidCalendarYmd(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY (with optional space time suffix)
  const dmyMatch = normalized.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/);
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    if (!isValidCalendarYmd(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // DD Mon, YYYY [optional time] (e.g. "15 Nov, 2026 06:57 PM")
  const dMonYMatch = normalized.match(
    /^(\d{1,2})[-\s]+([A-Za-z]+)\s*,?\s*(\d{4})(?:\s.*)?$/
  );
  if (dMonYMatch) {
    const d = Number(dMonYMatch[1]);
    const m = ENGLISH_MONTH_INDEX[dMonYMatch[2].toLowerCase()];
    const y = Number(dMonYMatch[3]);
    if (!m || !isValidCalendarYmd(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Mon DD, YYYY [optional time] (e.g. "Nov 15, 2026 06:57 PM")
  const monDYMatch = normalized.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})(?:\s.*)?$/
  );
  if (monDYMatch) {
    const m = ENGLISH_MONTH_INDEX[monDYMatch[1].toLowerCase()];
    const d = Number(monDYMatch[2]);
    const y = Number(monDYMatch[3]);
    if (!m || !isValidCalendarYmd(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // YYYY Mon DD (e.g. "2026 Nov 15")
  const yMonDMatch = normalized.match(
    /^(\d{4})[-\s]+([A-Za-z]+)[-\s]+(\d{1,2})(?:\s.*)?$/
  );
  if (yMonDMatch) {
    const y = Number(yMonDMatch[1]);
    const m = ENGLISH_MONTH_INDEX[yMonDMatch[2].toLowerCase()];
    const d = Number(yMonDMatch[3]);
    if (!m || !isValidCalendarYmd(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Reject strings without a 4-digit year
  if (!/\d{4}/.test(normalized)) return null;

  const parsedMs = Date.parse(normalized);
  if (!Number.isNaN(parsedMs)) {
    const parsed = new Date(parsedMs);
    const y = parsed.getFullYear();
    const m = parsed.getMonth() + 1;
    const d = parsed.getDate();
    if (!isValidCalendarYmd(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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

const AUTO_WALLET_COLORS = [
  '#3A605B',
  '#3E4E63',
  '#6A5243',
  '#1E6F73',
  '#5E7F3A',
  '#7E4C76',
  '#9E6F38',
];

const AUTO_CATEGORY_COLORS = [
  '#1E6F73',
  '#B5523B',
  '#5E7F3A',
  '#C99A2E',
  '#545E75',
  '#8F4A63',
  '#415B76',
  '#6A5243',
];

function computeDeterministicIdHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Map CSV / Excel rows to preview transactions with:
 * - Smart Amount Parsing (>0 => income, <0 => expense with Math.abs)
 * - Transfer detection when "To Wallet" ("الى (المحفظة)") has a value
 * - Auto-Wallet routing & creation (initialBalance: 0) for unknown wallet names
 * - Auto-Categorization & creation for unknown categories in the matching transaction type
 * - Strict date/amount validation and duplicate detection
 */
export function mapCsvRowsToTransactions(params: {
  rows: string[][];
  mapping: CsvColumnMapping;
  categories: Category[];
  existingTransactions: Transaction[];
  wallets?: Wallet[];
  defaultCurrency?: string;
  workspaceId?: string;
  merchantRules?: MerchantRule[];
}): CsvImportMappingResult {
  const {
    rows,
    mapping,
    categories,
    existingTransactions,
    wallets = [],
    defaultCurrency = wallets[0]?.currency || 'EGP',
    workspaceId,
    merchantRules = [],
  } = params;
  const safeWorkspaceId = normalizeWorkspaceId(workspaceId);
  const categoryById = new Map<string, Category>(categories.map((c) => [c.id, c]));
  const walletById = new Map<string, Wallet>(wallets.map((w) => [w.id, w]));

  // Pre-index existing transactions in O(N) for fast duplicate detection even at 5,000+ rows
  const existingKeys = new Set<string>();
  for (const tx of existingTransactions) {
    if (tx.deletedAt) continue;
    existingKeys.add(buildDuplicateKey(tx.date, tx.amount, tx.type));
  }

  const fallbackCategory =
    categories.find((c) => c.id === 'cat-other') || categories[0];

  const walletColIdx = mapping.walletIndex ?? -1;
  const toWalletColIdx = mapping.toWalletIndex ?? -1;
  const typeColIdx = mapping.typeIndex ?? -1;

  // Track existing + auto-created wallets deterministically without duplicating within the batch
  const usedWalletIds = new Set(wallets.map((w) => w.id));
  const autoCreatedWallets: Wallet[] = [];
  const autoWalletByNormName = new Map<string, Wallet>();

  const resolveOrCreateWallet = (rawName: string): { wallet?: Wallet; isNew: boolean } => {
    const trimmed = rawName.trim();
    if (!trimmed) return { wallet: undefined, isNew: false };
    const normW = normalizeArabicText(trimmed);
    if (!normW) return { wallet: undefined, isNew: false };

    // 1. Exact match in existing wallets
    const exactExisting = wallets.find((w) => normalizeArabicText(w.name) === normW);
    if (exactExisting) return { wallet: exactExisting, isNew: false };

    // 2. Safe partial match in existing wallets (e.g., "كاش" -> "المحفظة النقدية (كاش)")
    if (normW.length >= 3) {
      const partialExisting = wallets.find((w) => {
        const wNorm = normalizeArabicText(w.name);
        return wNorm.length >= 3 && (wNorm.includes(normW) || normW.includes(wNorm));
      });
      if (partialExisting) return { wallet: partialExisting, isNew: false };
    }

    // 3. Previously queued auto-created wallet in this import batch
    const alreadyCreated = autoWalletByNormName.get(normW);
    if (alreadyCreated) return { wallet: alreadyCreated, isNew: true };

    // 4. Create a brand new wallet with initialBalance: 0
    const baseHash = computeDeterministicIdHash(normW);
    let id = `w-imp-${baseHash}`;
    let suffix = 1;
    while (usedWalletIds.has(id)) {
      id = `w-imp-${baseHash}-${suffix++}`;
    }
    usedWalletIds.add(id);

    const newWallet: Wallet = {
      id,
      name: trimmed,
      currency: defaultCurrency,
      initialBalance: 0,
      initialBalanceMinor: 0,
      balance: 0,
      balanceMinor: 0,
      color: AUTO_WALLET_COLORS[(wallets.length + autoCreatedWallets.length) % AUTO_WALLET_COLORS.length],
      icon: 'Wallet',
      isArchived: false,
      workspaceId: safeWorkspaceId,
      order: wallets.length + autoCreatedWallets.length + 1,
    };
    autoCreatedWallets.push(newWallet);
    autoWalletByNormName.set(normW, newWallet);
    return { wallet: newWallet, isNew: true };
  };

  // Track existing + auto-created categories
  const usedCatIds = new Set(categories.map((c) => c.id));
  const autoCreatedCategories: Category[] = [];
  const autoCatByNormName = new Map<string, Category>();

  const resolveOrCreateCategory = (
    rawCatName: string,
    txType: TransactionType
  ): { category: Category; isNew: boolean } => {
    const trimmed = rawCatName.trim();
    if (!trimmed) {
      return {
        category: fallbackCategory || {
          id: 'cat-other',
          nameAr: 'أخرى',
          nameEn: 'Other',
          icon: 'Layers',
          color: '#7A7468',
          type: 'both',
          order: 99,
        },
        isNew: false,
      };
    }

    const normCat = normalizeArabicText(trimmed);
    const desiredCatType: 'expense' | 'income' = txType === 'income' ? 'income' : 'expense';

    // 1. Exact match in existing categories
    const exact = categories.find(
      (c) => normalizeArabicText(c.nameAr) === normCat || normalizeArabicText(c.nameEn) === normCat
    );
    if (exact) return { category: exact, isNew: false };

    // 2. Safe partial match in existing non-"other" categories
    if (normCat.length >= 3) {
      const partialMatches = categories.filter((c) => {
        if (c.id === 'cat-other') return false;
        const ar = normalizeArabicText(c.nameAr);
        const en = normalizeArabicText(c.nameEn);
        return (
          (ar.length >= 3 && (ar.includes(normCat) || normCat.includes(ar))) ||
          (en.length >= 3 && (en.includes(normCat) || normCat.includes(en)))
        );
      });
      if (partialMatches.length > 0) {
        const typePreferred =
          partialMatches.find((c) => c.type === desiredCatType || c.type === 'both') ||
          partialMatches[0];
        return { category: typePreferred, isNew: false };
      }
    }

    // 3. Previously queued auto-created category in this import batch
    const alreadyCreated = autoCatByNormName.get(normCat);
    if (alreadyCreated) {
      if (alreadyCreated.type !== 'both' && alreadyCreated.type !== desiredCatType) {
        alreadyCreated.type = 'both';
      }
      return { category: alreadyCreated, isNew: true };
    }

    // 4. Create a brand new category under the appropriate transaction type
    const baseHash = computeDeterministicIdHash(normCat);
    let id = `cat-imp-${baseHash}`;
    let suffix = 1;
    while (usedCatIds.has(id)) {
      id = `cat-imp-${baseHash}-${suffix++}`;
    }
    usedCatIds.add(id);

    const newCat: Category = {
      id,
      nameAr: trimmed,
      nameEn: trimmed,
      icon: 'Tag',
      color:
        AUTO_CATEGORY_COLORS[(categories.length + autoCreatedCategories.length) % AUTO_CATEGORY_COLORS.length],
      type: desiredCatType,
      order: categories.length + autoCreatedCategories.length + 1,
    };
    autoCreatedCategories.push(newCat);
    autoCatByNormName.set(normCat, newCat);
    return { category: newCat, isNew: true };
  };

  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  const previewRows: CsvPreviewRow[] = rows.map((row, idx) => {
    const rawDate = mapping.dateIndex >= 0 ? row[mapping.dateIndex] || '' : '';
    const rawAmount = mapping.amountIndex >= 0 ? row[mapping.amountIndex] || '' : '';
    const rawType = typeColIdx >= 0 ? row[typeColIdx] || '' : '';
    const rawCat = mapping.categoryIndex >= 0 ? row[mapping.categoryIndex] || '' : '';
    const rawNotes = mapping.notesIndex >= 0 ? row[mapping.notesIndex] || '' : '';
    const rawWallet = walletColIdx >= 0 ? row[walletColIdx] || '' : '';
    const rawToWallet = toWalletColIdx >= 0 ? row[toWalletColIdx] || '' : '';

    const normalizedDate = normalizeCsvDate(rawDate);
    const parsedAmount = parseImportAmount(rawAmount);
    const amount = parsedAmount ? parsedAmount.amount : NaN;
    const isValidAmount = Boolean(parsedAmount && amount > 0);
    const isValid = Boolean(normalizedDate && isValidAmount);

    // Smart transaction type inference:
    // 1) Non-empty "الى (المحفظة)" (To Wallet) -> Transfer
    // 2) Negative amount (< 0) -> Expense (stored positive via Math.abs)
    // 3) Optional explicit legacy type column override (if explicitly mapped & populated)
    // 4) Positive amount (> 0) -> Income
    const normType = normalizeArabicText(rawType);
    let type: TransactionType = 'income';
    if (rawToWallet.trim()) {
      type = 'transfer';
    } else if (parsedAmount?.isNegative) {
      type = 'expense';
    } else if (typeColIdx >= 0 && normType) {
      if (normType.includes('تحويل') || normType.includes('transfer')) {
        type = 'transfer';
      } else if (
        normType.includes('مصروف') ||
        normType.includes('صرف') ||
        normType.includes('خصم') ||
        normType.includes('expense') ||
        normType.includes('debit') ||
        normType.includes('outflow')
      ) {
        type = 'expense';
      } else if (
        normType.includes('دخل') ||
        normType.includes('ايراد') ||
        normType.includes('ايداع') ||
        normType.includes('income') ||
        normType.includes('credit') ||
        normType.includes('deposit')
      ) {
        type = 'income';
      } else {
        type = 'income';
      }
    } else {
      type = 'income';
    }

    // Only auto-create wallets and categories for valid rows (so invalid/skipped rows never pollute user lists)
    let matchedWallet: Wallet | undefined;
    let isNewWallet = false;
    let matchedToWallet: Wallet | undefined;
    let isNewToWallet = false;
    let matchedCat: Category = fallbackCategory;
    let isNewCategory = false;
    let matchedCostCenterId: string | undefined;
    let matchedRuleKeyword: string | undefined;

    if (isValid) {
      const ruleMatch =
        merchantRules.length > 0
          ? matchMerchantRule(`${rawNotes} ${rawCat}`.trim(), merchantRules, type)
          : null;

      if (ruleMatch) {
        matchedRuleKeyword = ruleMatch.rule.keyword;
        if (ruleMatch.costCenterId) {
          matchedCostCenterId = ruleMatch.costCenterId;
        }
      }

      if (!rawWallet.trim() && ruleMatch?.walletId && walletById.has(ruleMatch.walletId)) {
        matchedWallet = walletById.get(ruleMatch.walletId);
        isNewWallet = false;
      } else {
        const srcRes = resolveOrCreateWallet(rawWallet);
        matchedWallet = srcRes.wallet;
        isNewWallet = srcRes.isNew;
      }

      if (type === 'transfer' && rawToWallet.trim()) {
        const dstRes = resolveOrCreateWallet(rawToWallet);
        matchedToWallet = dstRes.wallet;
        isNewToWallet = dstRes.isNew;
      }

      if (!rawCat.trim() && ruleMatch?.categoryId && categoryById.has(ruleMatch.categoryId)) {
        matchedCat = categoryById.get(ruleMatch.categoryId)!;
        isNewCategory = false;
      } else {
        const catRes = resolveOrCreateCategory(rawCat, type);
        if (
          (catRes.isNew || catRes.category.id === 'cat-other') &&
          ruleMatch?.categoryId &&
          categoryById.has(ruleMatch.categoryId)
        ) {
          if (catRes.isNew) {
            // Avoid keeping an unused auto-created category if this was the row that created it
            const createdIdx = autoCreatedCategories.findIndex((c) => c.id === catRes.category.id);
            if (createdIdx >= 0 && autoCreatedCategories.length - 1 === createdIdx) {
              autoCreatedCategories.pop();
              autoCatByNormName.delete(normalizeArabicText(rawCat.trim()));
              usedCatIds.delete(catRes.category.id);
            }
          }
          matchedCat = categoryById.get(ruleMatch.categoryId)!;
          isNewCategory = false;
        } else {
          matchedCat = catRes.category;
          isNewCategory = catRes.isNew;
        }
      }
    } else if (rawCat.trim()) {
      // Keep display label clean for invalid preview row without mutating autoCreatedCategories
      matchedCat = {
        ...(fallbackCategory || { id: 'cat-other', nameAr: 'أخرى', nameEn: 'Other', icon: 'Layers', color: '#7A7468', type: 'both', order: 99 }),
        nameAr: rawCat.trim(),
        nameEn: rawCat.trim(),
      };
    }

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
      isNewCategory,
      walletId: matchedWallet?.id,
      walletName: matchedWallet?.name || (rawWallet.trim() || undefined),
      isNewWallet,
      toWalletId: matchedToWallet?.id,
      toWalletName: matchedToWallet?.name || (rawToWallet.trim() || undefined),
      isNewToWallet,
      ...(matchedCostCenterId ? { costCenterId: matchedCostCenterId } : {}),
      ...(matchedRuleKeyword ? { matchedRuleKeyword } : {}),
      workspaceId: safeWorkspaceId,
      notes: rawNotes.trim(),
      isDuplicate,
      isValid,
      errorReason,
      errorReasonAr,
    };
  });

  return {
    previewRows,
    validCount,
    invalidCount,
    duplicateCount,
    autoCreatedWallets,
    autoCreatedCategories,
  };
}

/**
 * Non-blocking chunked version of `mapCsvRowsToTransactions` that processes rows
 * in chunks of ~200 rows, yields between chunks, pre-indexes existing wallets/categories
 * in O(1) Maps, and invokes `onProgress(processed, total)` continuously.
 */
export async function mapCsvRowsToTransactionsChunked(params: {
  rows: string[][];
  mapping: CsvColumnMapping;
  categories: Category[];
  existingTransactions: Transaction[];
  wallets?: Wallet[];
  defaultCurrency?: string;
  workspaceId?: string;
  merchantRules?: MerchantRule[];
  chunkSize?: number;
  onProgress?: (processed: number, total: number) => void;
  shouldAbort?: () => boolean;
}): Promise<CsvImportMappingResult> {
  const {
    rows,
    mapping,
    categories,
    existingTransactions,
    wallets = [],
    defaultCurrency = wallets[0]?.currency || 'EGP',
    workspaceId,
    merchantRules = [],
    chunkSize = 200,
    onProgress,
    shouldAbort,
  } = params;
  const safeWorkspaceId = normalizeWorkspaceId(workspaceId);
  const safeChunk = Math.max(50, Math.floor(chunkSize));
  const categoryById = new Map<string, Category>(categories.map((c) => [c.id, c]));
  const walletById = new Map<string, Wallet>(wallets.map((w) => [w.id, w]));

  const existingKeys = new Set<string>();
  for (let i = 0; i < existingTransactions.length; i++) {
    const tx = existingTransactions[i];
    if (tx.deletedAt) continue;
    existingKeys.add(buildDuplicateKey(tx.date, tx.amount, tx.type));
  }

  const fallbackCategory =
    categories.find((c) => c.id === 'cat-other') || categories[0];

  const walletColIdx = mapping.walletIndex ?? -1;
  const toWalletColIdx = mapping.toWalletIndex ?? -1;
  const typeColIdx = mapping.typeIndex ?? -1;

  // Pre-normalize existing wallets & categories once (O(W + C)) instead of per row (O(N * (W + C)))
  const exactWalletByNorm = new Map<string, Wallet>();
  const normalizedWallets: Array<{ norm: string; wallet: Wallet }> = [];
  const usedWalletIds = new Set<string>();
  for (const w of wallets) {
    usedWalletIds.add(w.id);
    const norm = normalizeArabicText(w.name);
    if (norm) {
      if (!exactWalletByNorm.has(norm)) exactWalletByNorm.set(norm, w);
      normalizedWallets.push({ norm, wallet: w });
    }
  }
  const autoCreatedWallets: Wallet[] = [];
  const autoWalletByNormName = new Map<string, Wallet>();
  const resolvedWalletCache = new Map<string, { wallet?: Wallet; isNew: boolean }>();

  const resolveOrCreateWallet = (rawName: string): { wallet?: Wallet; isNew: boolean } => {
    const trimmed = rawName.trim();
    if (!trimmed) return { wallet: undefined, isNew: false };
    const normW = normalizeArabicText(trimmed);
    if (!normW) return { wallet: undefined, isNew: false };

    const cached = resolvedWalletCache.get(normW);
    if (cached) return cached;

    const exactExisting = exactWalletByNorm.get(normW);
    if (exactExisting) {
      const res = { wallet: exactExisting, isNew: false };
      resolvedWalletCache.set(normW, res);
      return res;
    }

    if (normW.length >= 3) {
      const partialExisting = normalizedWallets.find(
        ({ norm }) => norm.length >= 3 && (norm.includes(normW) || normW.includes(norm))
      );
      if (partialExisting) {
        const res = { wallet: partialExisting.wallet, isNew: false };
        resolvedWalletCache.set(normW, res);
        return res;
      }
    }

    const alreadyCreated = autoWalletByNormName.get(normW);
    if (alreadyCreated) {
      const res = { wallet: alreadyCreated, isNew: true };
      resolvedWalletCache.set(normW, res);
      return res;
    }

    const baseHash = computeDeterministicIdHash(normW);
    let id = `w-imp-${baseHash}`;
    let suffix = 1;
    while (usedWalletIds.has(id)) {
      id = `w-imp-${baseHash}-${suffix++}`;
    }
    usedWalletIds.add(id);

    const newWallet: Wallet = {
      id,
      name: trimmed,
      currency: defaultCurrency,
      initialBalance: 0,
      initialBalanceMinor: 0,
      balance: 0,
      balanceMinor: 0,
      color:
        AUTO_WALLET_COLORS[
          (wallets.length + autoCreatedWallets.length) % AUTO_WALLET_COLORS.length
        ],
      icon: 'Wallet',
      isArchived: false,
      workspaceId: safeWorkspaceId,
      order: wallets.length + autoCreatedWallets.length + 1,
    };
    autoCreatedWallets.push(newWallet);
    autoWalletByNormName.set(normW, newWallet);
    const res = { wallet: newWallet, isNew: true };
    resolvedWalletCache.set(normW, res);
    return res;
  };

  const exactCategoryByNorm = new Map<string, Category>();
  const normalizedCategories: Array<{ ar: string; en: string; category: Category }> = [];
  const usedCatIds = new Set<string>();
  for (const c of categories) {
    usedCatIds.add(c.id);
    const ar = normalizeArabicText(c.nameAr);
    const en = normalizeArabicText(c.nameEn);
    if (ar && !exactCategoryByNorm.has(ar)) exactCategoryByNorm.set(ar, c);
    if (en && !exactCategoryByNorm.has(en)) exactCategoryByNorm.set(en, c);
    if (c.id !== 'cat-other') {
      normalizedCategories.push({ ar, en, category: c });
    }
  }
  const autoCreatedCategories: Category[] = [];
  const autoCatByNormName = new Map<string, Category>();

  const resolveOrCreateCategory = (
    rawCatName: string,
    txType: TransactionType
  ): { category: Category; isNew: boolean } => {
    const trimmed = rawCatName.trim();
    if (!trimmed) {
      return {
        category: fallbackCategory || {
          id: 'cat-other',
          nameAr: 'أخرى',
          nameEn: 'Other',
          icon: 'Layers',
          color: '#7A7468',
          type: 'both',
          order: 99,
        },
        isNew: false,
      };
    }

    const normCat = normalizeArabicText(trimmed);
    const desiredCatType: 'expense' | 'income' = txType === 'income' ? 'income' : 'expense';

    const exact = exactCategoryByNorm.get(normCat);
    if (exact) return { category: exact, isNew: false };

    if (normCat.length >= 3) {
      const partialMatches: Category[] = [];
      for (const item of normalizedCategories) {
        if (
          (item.ar.length >= 3 && (item.ar.includes(normCat) || normCat.includes(item.ar))) ||
          (item.en.length >= 3 && (item.en.includes(normCat) || normCat.includes(item.en)))
        ) {
          partialMatches.push(item.category);
        }
      }
      if (partialMatches.length > 0) {
        const typePreferred =
          partialMatches.find((c) => c.type === desiredCatType || c.type === 'both') ||
          partialMatches[0];
        return { category: typePreferred, isNew: false };
      }
    }

    const alreadyCreated = autoCatByNormName.get(normCat);
    if (alreadyCreated) {
      if (alreadyCreated.type !== 'both' && alreadyCreated.type !== desiredCatType) {
        alreadyCreated.type = 'both';
      }
      return { category: alreadyCreated, isNew: true };
    }

    const baseHash = computeDeterministicIdHash(normCat);
    let id = `cat-imp-${baseHash}`;
    let suffix = 1;
    while (usedCatIds.has(id)) {
      id = `cat-imp-${baseHash}-${suffix++}`;
    }
    usedCatIds.add(id);

    const newCat: Category = {
      id,
      nameAr: trimmed,
      nameEn: trimmed,
      icon: 'Tag',
      color:
        AUTO_CATEGORY_COLORS[
          (categories.length + autoCreatedCategories.length) % AUTO_CATEGORY_COLORS.length
        ],
      type: desiredCatType,
      order: categories.length + autoCreatedCategories.length + 1,
    };
    autoCreatedCategories.push(newCat);
    autoCatByNormName.set(normCat, newCat);
    return { category: newCat, isNew: true };
  };

  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;
  const total = rows.length;
  const previewRows: CsvPreviewRow[] = new Array(total);

  for (let start = 0; start < total; start += safeChunk) {
    if (shouldAbort?.()) {
      return {
        previewRows: previewRows.slice(0, start),
        validCount,
        invalidCount,
        duplicateCount,
        autoCreatedWallets,
        autoCreatedCategories,
      };
    }

    const end = Math.min(total, start + safeChunk);
    for (let idx = start; idx < end; idx++) {
      const row = rows[idx];
      const rawDate = mapping.dateIndex >= 0 ? row[mapping.dateIndex] || '' : '';
      const rawAmount = mapping.amountIndex >= 0 ? row[mapping.amountIndex] || '' : '';
      const rawType = typeColIdx >= 0 ? row[typeColIdx] || '' : '';
      const rawCat = mapping.categoryIndex >= 0 ? row[mapping.categoryIndex] || '' : '';
      const rawNotes = mapping.notesIndex >= 0 ? row[mapping.notesIndex] || '' : '';
      const rawWallet = walletColIdx >= 0 ? row[walletColIdx] || '' : '';
      const rawToWallet = toWalletColIdx >= 0 ? row[toWalletColIdx] || '' : '';

      const normalizedDate = normalizeCsvDate(rawDate);
      const parsedAmount = parseImportAmount(rawAmount);
      const amount = parsedAmount ? parsedAmount.amount : NaN;
      const isValidAmount = Boolean(parsedAmount && amount > 0);
      const isValid = Boolean(normalizedDate && isValidAmount);

      const normType = normalizeArabicText(rawType);
      let type: TransactionType = 'income';
      if (rawToWallet.trim()) {
        type = 'transfer';
      } else if (parsedAmount?.isNegative) {
        type = 'expense';
      } else if (typeColIdx >= 0 && normType) {
        if (normType.includes('تحويل') || normType.includes('transfer')) {
          type = 'transfer';
        } else if (
          normType.includes('مصروف') ||
          normType.includes('صرف') ||
          normType.includes('خصم') ||
          normType.includes('expense') ||
          normType.includes('debit') ||
          normType.includes('outflow')
        ) {
          type = 'expense';
        } else if (
          normType.includes('دخل') ||
          normType.includes('ايراد') ||
          normType.includes('ايداع') ||
          normType.includes('income') ||
          normType.includes('credit') ||
          normType.includes('deposit')
        ) {
          type = 'income';
        } else {
          type = 'income';
        }
      } else {
        type = 'income';
      }

      let matchedWallet: Wallet | undefined;
      let isNewWallet = false;
      let matchedToWallet: Wallet | undefined;
      let isNewToWallet = false;
      let matchedCat: Category = fallbackCategory;
      let isNewCategory = false;
      let matchedCostCenterId: string | undefined;
      let matchedRuleKeyword: string | undefined;

      if (isValid) {
        const ruleMatch =
          merchantRules.length > 0
            ? matchMerchantRule(`${rawNotes} ${rawCat}`.trim(), merchantRules, type)
            : null;

        if (ruleMatch) {
          matchedRuleKeyword = ruleMatch.rule.keyword;
          if (ruleMatch.costCenterId) {
            matchedCostCenterId = ruleMatch.costCenterId;
          }
        }

        if (!rawWallet.trim() && ruleMatch?.walletId && walletById.has(ruleMatch.walletId)) {
          matchedWallet = walletById.get(ruleMatch.walletId);
          isNewWallet = false;
        } else {
          const srcRes = resolveOrCreateWallet(rawWallet);
          matchedWallet = srcRes.wallet;
          isNewWallet = srcRes.isNew;
        }

        if (type === 'transfer' && rawToWallet.trim()) {
          const dstRes = resolveOrCreateWallet(rawToWallet);
          matchedToWallet = dstRes.wallet;
          isNewToWallet = dstRes.isNew;
        }

        if (!rawCat.trim() && ruleMatch?.categoryId && categoryById.has(ruleMatch.categoryId)) {
          matchedCat = categoryById.get(ruleMatch.categoryId)!;
          isNewCategory = false;
        } else {
          const catRes = resolveOrCreateCategory(rawCat, type);
          if (
            (catRes.isNew || catRes.category.id === 'cat-other') &&
            ruleMatch?.categoryId &&
            categoryById.has(ruleMatch.categoryId)
          ) {
            if (catRes.isNew) {
              const createdIdx = autoCreatedCategories.findIndex((c) => c.id === catRes.category.id);
              if (createdIdx >= 0 && autoCreatedCategories.length - 1 === createdIdx) {
                autoCreatedCategories.pop();
                autoCatByNormName.delete(normalizeArabicText(rawCat.trim()));
                usedCatIds.delete(catRes.category.id);
              }
            }
            matchedCat = categoryById.get(ruleMatch.categoryId)!;
            isNewCategory = false;
          } else {
            matchedCat = catRes.category;
            isNewCategory = catRes.isNew;
          }
        }
      } else if (rawCat.trim()) {
        matchedCat = {
          ...(fallbackCategory || {
            id: 'cat-other',
            nameAr: 'أخرى',
            nameEn: 'Other',
            icon: 'Layers',
            color: '#7A7468',
            type: 'both',
            order: 99,
          }),
          nameAr: rawCat.trim(),
          nameEn: rawCat.trim(),
        };
      }

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

      previewRows[idx] = {
        rowIndex: idx + 1,
        date: normalizedDate || rawDate,
        amount: isValid ? amount : 0,
        type,
        categoryId: matchedCat?.id || 'cat-other',
        categoryLabel: matchedCat?.nameAr || rawCat || 'أخرى',
        isNewCategory,
        walletId: matchedWallet?.id,
        walletName: matchedWallet?.name || (rawWallet.trim() || undefined),
        isNewWallet,
        toWalletId: matchedToWallet?.id,
        toWalletName: matchedToWallet?.name || (rawToWallet.trim() || undefined),
        isNewToWallet,
        ...(matchedCostCenterId ? { costCenterId: matchedCostCenterId } : {}),
        ...(matchedRuleKeyword ? { matchedRuleKeyword } : {}),
        workspaceId: safeWorkspaceId,
        notes: rawNotes.trim(),
        isDuplicate,
        isValid,
        errorReason,
        errorReasonAr,
      };
    }

    onProgress?.(end, total);
    if (end < total) {
      await yieldToMainThread();
    }
  }

  return {
    previewRows,
    validCount,
    invalidCount,
    duplicateCount,
    autoCreatedWallets,
    autoCreatedCategories,
  };
}

export function buildImportedTransactionsPayload(params: {
  rows: CsvPreviewRow[];
  existingWallets: Wallet[];
  newWallets: Wallet[];
  fallbackWalletId?: string;
  defaultCurrency: string;
  workspaceId?: string;
}): {
  transactions: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[];
  taggedNewWallets: Wallet[];
} {
  const safeWorkspaceId = normalizeWorkspaceId(params.workspaceId);
  const taggedNewWallets: Wallet[] = params.newWallets.map((w) => ({
    ...w,
    workspaceId: safeWorkspaceId,
  }));
  const fallbackWallet =
    params.existingWallets.find((w) => w.id === params.fallbackWalletId) ||
    params.existingWallets[0];

  const walletById = new Map<string, Wallet>();
  for (const w of params.existingWallets) walletById.set(w.id, w);
  for (const w of taggedNewWallets) walletById.set(w.id, w);

  const transactions: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[] = params.rows.map(
    (r) => {
      const rowWallet =
        (r.walletId && walletById.get(r.walletId)) ||
        fallbackWallet ||
        taggedNewWallets[0];
      return {
        type: r.type,
        amount: r.amount,
        currency: rowWallet?.currency || params.defaultCurrency,
        date: r.date,
        time: '12:00',
        categoryId: r.categoryId,
        walletId: rowWallet?.id || '',
        ...(r.type === 'transfer' && r.toWalletId ? { toWalletId: r.toWalletId } : {}),
        ...(r.costCenterId ? { costCenterId: r.costCenterId } : {}),
        notes: r.notes,
        priority: 'normal' as const,
        doesNotAffectBalance: false,
        workspaceId: safeWorkspaceId,
        deletedAt: null,
      };
    }
  );

  return {
    transactions,
    taggedNewWallets,
  };
}

export async function buildImportedTransactionsPayloadChunked(params: {
  rows: CsvPreviewRow[];
  existingWallets: Wallet[];
  newWallets: Wallet[];
  fallbackWalletId?: string;
  defaultCurrency: string;
  workspaceId?: string;
  chunkSize?: number;
  onProgress?: (processed: number, total: number) => void;
}): Promise<{
  transactions: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[];
  taggedNewWallets: Wallet[];
}> {
  const safeWorkspaceId = normalizeWorkspaceId(params.workspaceId);
  const taggedNewWallets: Wallet[] = params.newWallets.map((w) => ({
    ...w,
    workspaceId: safeWorkspaceId,
  }));
  const fallbackWallet =
    params.existingWallets.find((w) => w.id === params.fallbackWalletId) ||
    params.existingWallets[0];

  const walletById = new Map<string, Wallet>();
  for (const w of params.existingWallets) walletById.set(w.id, w);
  for (const w of taggedNewWallets) walletById.set(w.id, w);

  const total = params.rows.length;
  const safeChunk = Math.max(50, Math.floor(params.chunkSize ?? 200));
  const transactions: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[] = new Array(total);

  for (let start = 0; start < total; start += safeChunk) {
    const end = Math.min(total, start + safeChunk);
    for (let i = start; i < end; i++) {
      const r = params.rows[i];
      const rowWallet =
        (r.walletId && walletById.get(r.walletId)) ||
        fallbackWallet ||
        taggedNewWallets[0];
      transactions[i] = {
        type: r.type,
        amount: r.amount,
        currency: rowWallet?.currency || params.defaultCurrency,
        date: r.date,
        time: '12:00',
        categoryId: r.categoryId,
        walletId: rowWallet?.id || '',
        ...(r.type === 'transfer' && r.toWalletId ? { toWalletId: r.toWalletId } : {}),
        ...(r.costCenterId ? { costCenterId: r.costCenterId } : {}),
        notes: r.notes,
        priority: 'normal' as const,
        doesNotAffectBalance: false,
        workspaceId: safeWorkspaceId,
        deletedAt: null,
      };
    }
    params.onProgress?.(end, total);
    if (end < total) {
      await yieldToMainThread();
    }
  }

  return {
    transactions,
    taggedNewWallets,
  };
}

export interface CommitSpreadsheetImportResult {
  importedCount: number;
  workspaceId: string;
  cloudSynced: boolean;
  localOnly: boolean;
  error?: string;
}

/**
 * Persists imported spreadsheet transactions locally tagged with the active workspaceId
 * and immediately triggers Cloud Sync (Firestore unified path + backup) in the same flow.
 * Never reports `cloudSynced: true` unless Firestore confirmation succeeds.
 * Emits smooth 4-stage progress updates without blocking the main thread.
 */
export async function commitImportedTransactionsWithCloudSync(params: {
  rows: CsvPreviewRow[];
  existingWallets: Wallet[];
  newWallets: Wallet[];
  newCategories: Category[];
  fallbackWalletId?: string;
  defaultCurrency: string;
  workspaceId?: string;
  hasCloudSync?: boolean;
  onProgress?: (state: ImportProgressState) => void;
  persistImportLocally: (payload: {
    transactions: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[];
    newWallets: Wallet[];
    newCategories: Category[];
    workspaceId: string;
    onProgress?: (processed: number, total: number) => void;
  }) => Promise<{ importedCount: number; createdTransactions: Transaction[] }>;
  syncToCloud?: (payload: {
    workspaceId: string;
    createdTransactions: Transaction[];
    onProgress?: (processed: number, total: number) => void;
  }) => Promise<{ ok: boolean; error?: string }>;
}): Promise<CommitSpreadsheetImportResult> {
  const safeWorkspaceId = normalizeWorkspaceId(params.workspaceId);
  const totalRows = params.rows.length;
  const hasCloudSync = params.hasCloudSync ?? Boolean(params.syncToCloud);

  params.onProgress?.(
    buildImportProgressState({
      stage: 'validating',
      processed: 0,
      total: totalRows,
      hasCloudSync,
    })
  );

  const { transactions, taggedNewWallets } = await buildImportedTransactionsPayloadChunked({
    rows: params.rows,
    existingWallets: params.existingWallets,
    newWallets: params.newWallets,
    fallbackWalletId: params.fallbackWalletId,
    defaultCurrency: params.defaultCurrency,
    workspaceId: safeWorkspaceId,
    onProgress: (processed, total) => {
      params.onProgress?.(
        buildImportProgressState({
          stage: 'validating',
          processed,
          total,
          hasCloudSync,
        })
      );
    },
  });

  if (transactions.length === 0) {
    return {
      importedCount: 0,
      workspaceId: safeWorkspaceId,
      cloudSynced: false,
      localOnly: false,
    };
  }

  params.onProgress?.(
    buildImportProgressState({
      stage: 'saving_local',
      processed: 0,
      total: transactions.length,
      hasCloudSync,
    })
  );

  const localRes = await params.persistImportLocally({
    transactions,
    newWallets: taggedNewWallets,
    newCategories: params.newCategories,
    workspaceId: safeWorkspaceId,
    onProgress: (processed, total) => {
      params.onProgress?.(
        buildImportProgressState({
          stage: 'saving_local',
          processed,
          total,
          hasCloudSync,
        })
      );
    },
  });

  if (localRes.importedCount <= 0) {
    return {
      importedCount: 0,
      workspaceId: safeWorkspaceId,
      cloudSynced: false,
      localOnly: false,
    };
  }

  params.onProgress?.(
    buildImportProgressState({
      stage: 'saving_local',
      processed: localRes.importedCount,
      total: localRes.importedCount,
      hasCloudSync,
    })
  );

  if (!params.syncToCloud) {
    params.onProgress?.(
      buildImportProgressState({
        stage: 'saving_local',
        processed: localRes.importedCount,
        total: localRes.importedCount,
        hasCloudSync: false,
        overridePercent: 100,
      })
    );
    return {
      importedCount: localRes.importedCount,
      workspaceId: safeWorkspaceId,
      cloudSynced: false,
      localOnly: true,
    };
  }

  params.onProgress?.(
    buildImportProgressState({
      stage: 'syncing_cloud',
      processed: 0,
      total: localRes.importedCount,
      hasCloudSync: true,
    })
  );

  try {
    const cloudRes = await params.syncToCloud({
      workspaceId: safeWorkspaceId,
      createdTransactions: localRes.createdTransactions,
      onProgress: (processed, total) => {
        params.onProgress?.(
          buildImportProgressState({
            stage: 'syncing_cloud',
            processed,
            total: total || localRes.importedCount,
            hasCloudSync: true,
          })
        );
      },
    });
    if (!cloudRes.ok) {
      return {
        importedCount: localRes.importedCount,
        workspaceId: safeWorkspaceId,
        cloudSynced: false,
        localOnly: true,
        error: cloudRes.error,
      };
    }
    params.onProgress?.(
      buildImportProgressState({
        stage: 'syncing_cloud',
        processed: localRes.importedCount,
        total: localRes.importedCount,
        hasCloudSync: true,
        overridePercent: 100,
      })
    );
    return {
      importedCount: localRes.importedCount,
      workspaceId: safeWorkspaceId,
      cloudSynced: true,
      localOnly: false,
    };
  } catch (err) {
    return {
      importedCount: localRes.importedCount,
      workspaceId: safeWorkspaceId,
      cloudSynced: false,
      localOnly: true,
      error: err instanceof Error ? err.message : String(err || 'Cloud sync failed'),
    };
  }
}

