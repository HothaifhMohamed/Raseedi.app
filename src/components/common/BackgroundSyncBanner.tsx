import React from 'react';
import { AlertCircle, CheckCircle2, CloudUpload, RefreshCw, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const BackgroundSyncBanner: React.FC = () => {
  const {
    backgroundImportSync,
    retryBackgroundImportCloudSync,
    dismissBackgroundImportCloudSync,
    isRTL,
  } = useApp();

  if (backgroundImportSync.status === 'idle') {
    return null;
  }

  const { status, processed, total, percent, error } = backgroundImportSync;
  const formattedProcessed = processed.toLocaleString('en-US');
  const formattedTotal = total.toLocaleString('en-US');

  return (
    <div
      data-testid="background-sync-banner"
      data-sync-status={status}
      className={`px-3.5 py-2 border-b text-xs shrink-0 transition-colors ${
        status === 'error'
          ? 'bg-[var(--color-expense)]/10 border-[var(--color-expense)]/25 text-[var(--color-expense)]'
          : status === 'synced'
          ? 'bg-[var(--color-income)]/10 border-[var(--color-income)]/25 text-[var(--color-income)]'
          : 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/25 text-[var(--color-ink)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {status === 'syncing' && (
            <CloudUpload className="w-4 h-4 text-[var(--color-accent)] animate-pulse shrink-0" />
          )}
          {status === 'synced' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {status === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}

          <div className="min-w-0 flex-1">
            {status === 'syncing' && (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold truncate">
                  {isRTL
                    ? `جاري المزامنة مع السحابة: ${formattedProcessed} من ${formattedTotal} معاملة`
                    : `Syncing to Cloud: ${formattedProcessed} / ${formattedTotal} transactions`}
                </span>
                <span className="text-[11px] font-bold text-[var(--color-accent)] num-tabular shrink-0">
                  {percent}%
                </span>
              </div>
            )}
            {status === 'synced' && (
              <span className="font-bold">
                {isRTL
                  ? `تمت مزامنة ${formattedTotal} معاملة مع السحابة بنجاح`
                  : `Synced ${formattedTotal} transactions to Cloud successfully`}
              </span>
            )}
            {status === 'error' && (
              <span className="font-semibold">
                {error ||
                  (isRTL
                    ? 'تعذرت المزامنة في الخلفية — بياناتك محفوظة محلياً بأمان.'
                    : 'Background cloud sync failed — your data is safely saved locally.')}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {status === 'error' && (
            <button
              type="button"
              data-testid="background-sync-retry-btn"
              onClick={retryBackgroundImportCloudSync}
              className="px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-bold flex items-center gap-1 min-h-[28px]"
            >
              <RefreshCw className="w-3 h-3" />
              <span>{isRTL ? 'إعادة المحاولة' : 'Retry'}</span>
            </button>
          )}
          {status !== 'syncing' && (
            <button
              type="button"
              onClick={dismissBackgroundImportCloudSync}
              aria-label={isRTL ? 'إغلاق' : 'Dismiss'}
              className="p-1 rounded-md hover:bg-black/5 text-current opacity-75 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {status === 'syncing' && (
        <div className="mt-1.5 space-y-1">
          <div className="w-full h-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-line)] overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent)] transition-all duration-300 ease-out rounded-full"
              style={{ width: `${Math.max(3, Math.min(100, percent))}%` }}
            />
          </div>
          <div className="text-[10px] text-[var(--color-muted)]">
            {isRTL
              ? 'تم الحفظ محلياً بالفعل — يمكنك متابعة العمل والتصفح بحرية أثناء اكتمال الرفع.'
              : 'Already saved locally — you can keep using the app freely while cloud upload finishes.'}
          </div>
        </div>
      )}
    </div>
  );
};
