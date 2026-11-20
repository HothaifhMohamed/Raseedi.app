export type ImportStage =
  | 'parsing'
  | 'validating'
  | 'saving_local'
  | 'syncing_cloud';

export interface ImportProgressState {
  active: boolean;
  stage: ImportStage;
  processed: number;
  total: number;
  percent: number;
  labelAr: string;
  labelEn: string;
  detailAr?: string;
  detailEn?: string;
  hasCloudSync?: boolean;
}

export interface ImportStageMeta {
  id: ImportStage;
  stepNumber: 1 | 2 | 3 | 4;
  labelAr: string;
  labelEn: string;
}

export const IMPORT_STAGES: readonly ImportStageMeta[] = [
  {
    id: 'parsing',
    stepNumber: 1,
    labelAr: 'قراءة وتحليل الملف',
    labelEn: 'Reading & parsing file',
  },
  {
    id: 'validating',
    stepNumber: 2,
    labelAr: 'التحقق من صحة البيانات والمحافظ',
    labelEn: 'Validating data & wallets',
  },
  {
    id: 'saving_local',
    stepNumber: 3,
    labelAr: 'الحفظ في قاعدة البيانات المحلية',
    labelEn: 'Saving to local database',
  },
  {
    id: 'syncing_cloud',
    stepNumber: 4,
    labelAr: 'المزامنة مع السحابة (Firestore)',
    labelEn: 'Syncing with Cloud (Firestore)',
  },
] as const;

export const IMPORT_STAGE_ORDER: Record<ImportStage, number> = {
  parsing: 1,
  validating: 2,
  saving_local: 3,
  syncing_cloud: 4,
};

export function getImportStageMeta(stage: ImportStage): ImportStageMeta {
  return IMPORT_STAGES.find((s) => s.id === stage) ?? IMPORT_STAGES[0];
}

/**
 * Yields control back to the browser event loop so painting, scrolling,
 * and progress bar animations remain responsive during heavy batch loops.
 */
export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame === 'function' &&
      typeof document !== 'undefined' &&
      document.visibilityState !== 'hidden'
    ) {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      // Fallback timer guarantees progress even if rAF is throttled in background tabs
      const timer = setTimeout(done, 16);
      (globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame(() => {
        clearTimeout(timer);
        done();
      });
      return;
    }
    setTimeout(resolve, 0);
  });
}

/**
 * Computes a smooth, monotonically increasing 0–100 percentage across the 4 import stages.
 */
export function calculateStageProgress(
  stage: ImportStage,
  processed: number,
  total: number,
  hasCloudSync = true
): number {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const safeProcessed =
    Number.isFinite(processed) && processed > 0
      ? safeTotal > 0
        ? Math.min(processed, safeTotal)
        : processed
      : 0;
  const ratio = safeTotal > 0 ? safeProcessed / safeTotal : 0;

  const ranges: Record<ImportStage, [number, number]> = hasCloudSync
    ? {
        parsing: [0, 15],
        validating: [15, 40],
        saving_local: [40, 65],
        syncing_cloud: [65, 100],
      }
    : {
        parsing: [0, 20],
        validating: [20, 55],
        saving_local: [55, 100],
        syncing_cloud: [100, 100],
      };

  const [start, end] = ranges[stage];
  const value = start + (end - start) * ratio;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildImportProgressState(params: {
  stage: ImportStage;
  processed: number;
  total: number;
  hasCloudSync?: boolean;
  active?: boolean;
  detailAr?: string;
  detailEn?: string;
  overridePercent?: number;
}): ImportProgressState {
  const meta = getImportStageMeta(params.stage);
  const hasCloudSync = params.hasCloudSync ?? true;
  const safeTotal = Math.max(0, Math.floor(Number.isFinite(params.total) ? params.total : 0));
  const safeProcessed = Math.max(
    0,
    Math.floor(
      Number.isFinite(params.processed)
        ? safeTotal > 0
          ? Math.min(params.processed, safeTotal)
          : params.processed
        : 0
    )
  );
  const percent =
    typeof params.overridePercent === 'number' && Number.isFinite(params.overridePercent)
      ? Math.max(0, Math.min(100, Math.round(params.overridePercent)))
      : calculateStageProgress(params.stage, safeProcessed, safeTotal, hasCloudSync);

  return {
    active: params.active ?? true,
    stage: params.stage,
    processed: safeProcessed,
    total: safeTotal,
    percent,
    labelAr: meta.labelAr,
    labelEn: meta.labelEn,
    detailAr: params.detailAr,
    detailEn: params.detailEn,
    hasCloudSync,
  };
}

export function formatImportProgressCounter(
  processed: number,
  total: number,
  percent: number,
  isRTL: boolean
): string {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  const fmt = new Intl.NumberFormat(isRTL ? 'en-US' : 'en-US');
  if (total > 0) {
    const safeProcessed = Math.min(Math.max(0, Math.floor(processed)), Math.floor(total));
    if (isRTL) {
      return `تمت معالجة ${fmt.format(safeProcessed)} من ${fmt.format(Math.floor(total))} معاملة • ${safePercent}%`;
    }
    return `Processed ${fmt.format(safeProcessed)} of ${fmt.format(Math.floor(total))} transactions • ${safePercent}%`;
  }
  return isRTL ? `جاري التجهيز • ${safePercent}%` : `Preparing • ${safePercent}%`;
}
