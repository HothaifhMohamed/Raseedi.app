import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ToastNotification: React.FC = () => {
  const { toastMessage, clearToast, isRTL } = useApp();

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      clearToast();
    }, 6000);
    return () => clearTimeout(timer);
  }, [toastMessage, clearToast]);

  if (!toastMessage) return null;

  const variant = toastMessage.type || 'info';
  const styles =
    variant === 'warning'
      ? 'bg-[var(--color-surface)] border-[var(--color-warning)]/60 text-[var(--color-ink)]'
      : variant === 'error'
      ? 'bg-[var(--color-surface)] border-[var(--color-expense)]/60 text-[var(--color-ink)]'
      : 'bg-[var(--color-surface)] border-[var(--color-accent)]/50 text-[var(--color-ink)]';

  const Icon =
    variant === 'warning' || variant === 'error'
      ? AlertTriangle
      : variant === 'success'
      ? CheckCircle2
      : Info;

  const iconColor =
    variant === 'warning'
      ? 'text-[var(--color-warning-text)]'
      : variant === 'error'
      ? 'text-[var(--color-expense)]'
      : 'text-[var(--color-accent)]';

  return (
    <div
      role="alert"
      aria-live="assertive"
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`fixed top-16 inset-x-4 z-[80] mx-auto max-w-md flex items-start gap-2.5 p-3.5 border rounded-xl shadow-xl animate-in fade-in duration-150 ${styles}`}
    >
      <Icon className={`w-4.5 h-4.5 shrink-0 mt-0.5 ${iconColor}`} />
      <p className="flex-1 text-xs font-medium leading-relaxed text-[var(--color-ink)]">
        {toastMessage.text}
      </p>
      <button
        type="button"
        onClick={clearToast}
        aria-label={isRTL ? 'إغلاق التنبيه' : 'Dismiss notification'}
        className="p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg shrink-0 min-h-[28px] min-w-[28px] flex items-center justify-center"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
