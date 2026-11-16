import React, { useState } from 'react';
import { AlertTriangle, CloudUpload, Loader2, LogOut, ShieldAlert, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const LogoutConfirmationModal: React.FC = () => {
  const {
    isLogoutModalOpen,
    setIsLogoutModalOpen,
    user,
    hasUnsyncedLocalChanges,
    signOutAndResetDevice,
    isRTL,
  } = useApp();

  const [isProcessing, setIsProcessing] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  if (!isLogoutModalOpen) return null;

  const isGoogleUser = Boolean(user?.isLoggedIn);

  const handleClose = () => {
    if (isProcessing) return;
    setBackupError(null);
    setIsLogoutModalOpen(false);
  };

  const handleConfirmLogout = async (backupFirst: boolean) => {
    setBackupError(null);
    setIsProcessing(true);
    try {
      const res = await signOutAndResetDevice({ backupFirst });
      if (!res.ok) {
        setBackupError(
          res.error ||
            (isRTL
              ? 'تعذر إتمام النسخ الاحتياطي السحابي قبل الخروج. يمكنك الخروج بدون نسخ احتياطي أو المحاولة مجدداً.'
              : 'Cloud backup failed before sign out. Retry or choose immediate sign out.')
        );
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      data-testid="logout-confirmation-modal"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-2xl space-y-4 animate-in fade-in duration-150"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[var(--color-expense)]/12 text-[var(--color-expense)] flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-title text-sm font-bold text-[var(--color-ink)]">
                {isGoogleUser
                  ? isRTL
                    ? 'تأكيد تسجيل الخروج'
                    : 'Confirm Sign Out'
                  : isRTL
                  ? 'الخروج من وضع الزائر'
                  : 'Exit Guest Session'}
              </h3>
              {isGoogleUser && user?.email && (
                <p className="text-[11px] text-[var(--color-muted)] truncate max-w-[200px]" dir="ltr">
                  {user.email}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={isProcessing}
            onClick={handleClose}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[var(--color-ink)] leading-relaxed">
          {isGoogleUser
            ? isRTL
              ? 'هل تريد عمل نسخة احتياطية سحابية أخيرة قبل الخروج؟ سيتم مسح كافة البيانات المحلية من هذا الجهاز بعد الخروج للحفاظ على خصوصيتك.'
              : 'Do you want to create one last cloud backup before signing out? All local data on this device will be wiped after sign-out to protect your privacy.'
            : isRTL
            ? 'سيتم مسح كافة البيانات المحلية لوضع الزائر من هذا الجهاز والعودة إلى شاشة البداية للحفاظ على خصوصيتك.'
            : 'All local Guest Mode data on this device will be completely wiped and you will return to the welcome screen.'}
        </p>

        {hasUnsyncedLocalChanges && (
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {isGoogleUser
                ? isRTL
                  ? 'توجد تعديلات محلية حديثة لم تتم مزامنتها مع السحابة بعد.'
                  : 'You have recent local changes that have not been synced to cloud yet.'
                : isRTL
                ? 'بياناتك محفوظة محلياً فقط كزائر وستُحذف نهائياً عند الخروج.'
                : 'Your guest data is stored locally only and will be permanently removed on exit.'}
            </span>
          </div>
        )}

        {backupError && (
          <div className="p-2.5 rounded-xl bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 text-[11px] text-[var(--color-expense)] font-medium">
            {backupError}
          </div>
        )}

        <div className="space-y-2 pt-1">
          {isGoogleUser && (
            <button
              type="button"
              data-testid="logout-backup-and-exit-btn"
              disabled={isProcessing}
              onClick={() => void handleConfirmLogout(true)}
              className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-2 hover:opacity-95 transition-opacity min-h-[44px] disabled:opacity-60"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <CloudUpload className="w-4 h-4 shrink-0" />
              )}
              <span>
                {isRTL ? 'نسخ احتياطي سحابي ثم خروج' : 'Cloud Backup & Sign Out'}
              </span>
            </button>
          )}

          <button
            type="button"
            data-testid="logout-wipe-now-btn"
            disabled={isProcessing}
            onClick={() => void handleConfirmLogout(false)}
            className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-expense)] text-white text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity min-h-[44px] disabled:opacity-60"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <LogOut className="w-4 h-4 shrink-0" />
            )}
            <span>
              {isRTL
                ? 'خروج ومسح البيانات المحلية فوراً'
                : 'Sign Out & Wipe Device Now'}
            </span>
          </button>

          <button
            type="button"
            data-testid="logout-cancel-btn"
            disabled={isProcessing}
            onClick={handleClose}
            className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)] text-xs font-semibold min-h-[42px]"
          >
            {isRTL ? 'إلغاء' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
};
