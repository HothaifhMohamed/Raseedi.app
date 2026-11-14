import React from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import { formatLocalDate } from '../../services/calculations';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
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
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected application error',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Raseedi ErrorBoundary caught error:', error, info);
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

    return (
      <div
        className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)] flex items-center justify-center p-4"
        dir={isArabic ? 'rtl' : 'ltr'}
      >
        <div className="w-full max-w-sm bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-6 space-y-4 text-center shadow-sm">
          <div className="w-12 h-12 rounded-xl bg-[var(--color-expense)]/10 text-[var(--color-expense)] flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h1 className="font-title text-lg font-bold text-[var(--color-ink)]">
              {isArabic ? 'حدث خطأ غير متوقع' : 'Something went wrong'}
            </h1>
            <p className="text-xs text-[var(--color-muted)] leading-relaxed">
              {isArabic
                ? 'بياناتك محفوظة بأمان على جهازك. يمكنك تنزيل نسخة احتياطية الآن ثم إعادة تحميل التطبيق.'
                : 'Your data is safely stored on your device. You can export a JSON backup before reloading.'}
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
              onClick={this.handleEmergencyJsonExport}
              className="w-full py-2.5 px-4 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold rounded-xl text-xs flex items-center justify-center gap-2 hover:opacity-95 min-h-[44px]"
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

            <button
              type="button"
              onClick={this.handleReload}
              className="w-full py-2.5 px-4 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-semibold rounded-xl text-xs flex items-center justify-center gap-2 hover:border-[var(--color-muted)] min-h-[44px]"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{isArabic ? 'إعادة تحميل التطبيق' : 'Reload App'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
