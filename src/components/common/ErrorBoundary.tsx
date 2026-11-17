import React from 'react';
import { AlertTriangle, Download, RotateCcw, WifiOff } from 'lucide-react';
import { formatLocalDate } from '../../services/calculations';
import { isChunkLoadError } from '../../services/appUpdateLogic';
import { attemptChunkRecoveryReload } from '../../services/appUpdate';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  isChunkError: boolean;
  isOffline: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      isChunkError: false,
      isOffline: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const chunkError = isChunkLoadError(error);
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected application error',
      isChunkError: chunkError,
      isOffline: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Raseedi ErrorBoundary caught error:', error, info);
    if (isChunkLoadError(error)) {
      attemptChunkRecoveryReload();
    }
  }

  handleEmergencyJsonExport = () => {
    try {
      const raw = localStorage.getItem('raseedi_data_v1');
      const fallback = JSON.stringify({
        exportedAt: new Date().toISOString(),
        recovery: true,
        rawData: raw ? JSON.parse(raw) : null,
      }, null, 2);

      const blob = new Blob([raw || fallback], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `raseedi-emergency-backup-${formatLocalDate(new Date())}.json`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Emergency export failed:', err);
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isArabic =
      typeof document !== 'undefined' ? document.documentElement.lang !== 'en' : true;

    const titleText = this.state.isChunkError
      ? this.state.isOffline
        ? isArabic
          ? 'الاتصال بالإنترنت منقطع'
          : 'You are currently offline'
        : isArabic
        ? 'يتوفر تحديث جديد للتطبيق'
        : 'App update available'
      : isArabic
      ? 'حدث خطأ غير متوقع'
      : 'Something went wrong';

    const subtitleText = this.state.isChunkError
      ? this.state.isOffline
        ? isArabic
          ? 'تعذر تحميل هذا الجزء لعدم توفر اتصال بالإنترنت. تحقق من الاتصال ثم أعد المحاولة، بياناتك محفوظة بأمان.'
          : 'This view could not load while offline. Please check your connection and retry — your data is safely stored.'
        : isArabic
        ? 'تم رفع تحديث جديد للتطبيق. أعد تحميل الصفحة لتحميل أحدث نسخة دون التأثير على بياناتك.'
        : 'A newer version of Raseedi was deployed. Reload the page to fetch the latest bundle safely.'
      : isArabic
      ? 'بياناتك محفوظة بأمان على جهازك. يمكنك تنزيل نسخة احتياطية الآن ثم إعادة تحميل التطبيق.'
      : 'Your data is safely stored on your device. You can export a JSON backup before reloading.';

    return (
      <div
        className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)] flex items-center justify-center p-4"
        dir={isArabic ? 'rtl' : 'ltr'}
      >
        <div className="w-full max-w-sm bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-6 space-y-4 text-center shadow-sm">
          <div className="w-12 h-12 rounded-xl bg-[var(--color-expense)]/10 text-[var(--color-expense)] flex items-center justify-center mx-auto">
            {this.state.isChunkError && this.state.isOffline ? (
              <WifiOff className="w-6 h-6" />
            ) : (
              <AlertTriangle className="w-6 h-6" />
            )}
          </div>

          <div className="space-y-1.5">
            <h1 className="font-title text-lg font-bold text-[var(--color-ink)]">
              {titleText}
            </h1>
            <p className="text-xs text-[var(--color-muted)] leading-relaxed">
              {subtitleText}
            </p>
          </div>

          {this.state.errorMessage && (
            <div className="p-2.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[11px] text-[var(--color-muted)] font-mono break-words text-start" dir="ltr">
              {this.state.errorMessage}
            </div>
          )}

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full py-2.5 px-4 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold rounded-xl text-xs flex items-center justify-center gap-2 hover:opacity-95 min-h-[44px]"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{isArabic ? 'إعادة تحميل التطبيق' : 'Reload App'}</span>
            </button>

            <button
              type="button"
              onClick={this.handleEmergencyJsonExport}
              className="w-full py-2.5 px-4 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-semibold rounded-xl text-xs flex items-center justify-center gap-2 hover:border-[var(--color-muted)] min-h-[44px]"
            >
              <Download className="w-4 h-4" />
              <span>
                {isArabic ? (
                  <>
                    تصدير نسخة احتياطية (<bdi dir="ltr">JSON</bdi>)
                  </>
                ) : (
                  'Export JSON Backup'
                )}
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
