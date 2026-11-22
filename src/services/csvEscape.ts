/**
 * Pure RFC-4180 CSV cell escaper with spreadsheet formula-injection protection.
 * Kept isolated from `csvImport.ts` so report exporters never bundle the Excel (`xlsx`) parser.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : '';
  }
  const raw = String(val);
  const safe =
    /^[=+\-@\t\r]/.test(raw) || /^[=+\-@\t\r]/.test(raw.trimStart())
      ? `'${raw}`
      : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
