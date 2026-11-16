import React, { useEffect, useState } from 'react';
import {
  Cloud,
  ShieldCheck,
  Sparkles,
  UserRound,
  Loader2,
  AlertCircle,
  Globe,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BrandLogo } from '../common/BrandLogo';

export const AuthGateScreen: React.FC = () => {
  const {
    signInWithGoogleAccount,
    enterGuestMode,
    loadDemoData,
    cloudSyncError,
    settings,
    updateSettings,
    isRTL,
  } = useApp();

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Support automated verification jump (?autostart=1) directly into demo session
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      loadDemoData();
    }
  }, [loadDemoData]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      const res = await signInWithGoogleAccount();
      if (!res) {
        setAuthError(
          cloudSyncError ||
            (isRTL
              ? 'تعذر إتمام تسجيل الدخول بحساب جوجل. حاول مرة أخرى أو جرب الدخول كزائر.'
              : 'Could not complete Google sign-in. Please try again or continue as Guest.')
        );
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)] flex flex-col justify-center items-center p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="auth-gate-screen"
    >
      <div className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] shadow-xl p-6 sm:p-7 space-y-6">
        {/* Top Row: Brand & Language Toggle */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandLogo className="w-11 h-11 rounded-xl shadow-xs shrink-0" />
            <div>
              <h1 className="font-title text-xl font-bold text-[var(--color-ink)] tracking-tight">
                {isRTL ? 'رَصِيدِي' : 'Raseedi'}
              </h1>
              <p className="text-xs text-[var(--color-muted)]">
                {isRTL
                  ? 'إدارة المال والأعمال بذكاء وخصوصية'
                  : 'Smart Personal & Business Finance'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => updateSettings({ language: isRTL ? 'en' : 'ar' })}
            className="px-2.5 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[11px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)] flex items-center gap-1.5 min-h-[36px]"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{settings.language === 'ar' ? 'English' : 'عربي'}</span>
          </button>
        </div>

        {/* Welcome Message */}
        <div className="space-y-2">
          <h2 className="font-title text-lg font-bold text-[var(--color-ink)] leading-snug">
            {isRTL ? 'مرحباً بك في رَصِيدِي' : 'Welcome to Raseedi'}
          </h2>
          <p className="text-xs text-[var(--color-muted)] leading-relaxed">
            {isRTL
              ? 'سجّل دخولك بحساب جوجل لاستعادة بياناتك واشتراكك تلقائياً من السحابة أو البدء بحساب جديد محمي بالكامل.'
              : 'Sign in with Google to automatically restore your cloud backup & subscription, or start exploring in Guest Mode.'}
          </p>
        </div>

        {/* Concise Trust Highlights */}
        <div className="space-y-2.5 p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-xs">
          <div className="flex items-start gap-2.5">
            <Cloud className="w-4 h-4 text-[var(--color-accent)] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[var(--color-ink)]">
                {isRTL ? 'استرجاع سحابي تلقائي فوري' : 'Instant Cloud Sync & Restore'}
              </div>
              <div className="text-[11px] text-[var(--color-muted)] mt-0.5">
                {isRTL
                  ? 'يتم فحص السحابة فور تسجيل الدخول واستعادة كافة محافظك ومعاملاتك.'
                  : 'Automatically checks Firestore on login to restore wallets, ledger, and PRO access.'}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 pt-2 border-t border-[var(--color-line)]">
            <ShieldCheck className="w-4 h-4 text-[var(--color-income)] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[var(--color-ink)]">
                {isRTL ? 'عزل تام وخصوصية لكل حساب' : 'Strict Device Privacy & Isolation'}
              </div>
              <div className="text-[11px] text-[var(--color-muted)] mt-0.5">
                {isRTL
                  ? 'عند تسجيل الخروج يتم مسح البيانات المحلية من الجهاز تماماً لمنع تداخل الحسابات.'
                  : 'Signing out clears all local caches completely so multi-user devices stay isolated.'}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 pt-2 border-t border-[var(--color-line)]">
            <Sparkles className="w-4 h-4 text-[var(--color-accent)] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[var(--color-ink)]">
                {isRTL ? 'الأفراد والشركات في مكان واحد' : 'Personal & Enterprise Workspaces'}
              </div>
              <div className="text-[11px] text-[var(--color-muted)] mt-0.5">
                {isRTL
                  ? 'حافظ على مصاريفك الشخصية مفصولة عن حسابات المؤسسة وفريق العمل.'
                  : 'Keep personal budgets cleanly separated from company teams and approvals.'}
              </div>
            </div>
          </div>
        </div>

        {/* Auth Error Notice */}
        {(authError || cloudSyncError) && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 text-[11px] text-[var(--color-expense)] flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{authError || cloudSyncError}</span>
          </div>
        )}

        {/* Primary & Secondary Entry Actions */}
        <div className="space-y-2.5">
          <button
            type="button"
            data-testid="auth-gate-google-btn"
            disabled={isSigningIn}
            onClick={() => void handleGoogleSignIn()}
            className="w-full py-3 px-4 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] font-bold text-sm hover:opacity-95 transition-opacity flex items-center justify-center gap-2.5 shadow-sm min-h-[48px] disabled:opacity-60"
          >
            {isSigningIn ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M21.35 11.1h-9.17v2.92h5.27c-.23 1.24-.92 2.29-1.97 2.99v2.49h3.18c1.86-1.71 2.94-4.24 2.94-7.21 0-.69-.06-1.35-.25-1.19z"
                />
                <path
                  fill="currentColor"
                  d="M12.18 22c2.66 0 4.89-.88 6.52-2.38l-3.18-2.49c-.88.59-2.01.95-3.34.95-2.57 0-4.74-1.73-5.52-4.07H3.38v2.56C5.01 19.8 8.34 22 12.18 22z"
                />
                <path
                  fill="currentColor"
                  d="M6.66 14.01a5.88 5.88 0 0 1 0-4.02V7.43H3.38a9.99 9.99 0 0 0 0 9.14l3.28-2.56z"
                />
                <path
                  fill="currentColor"
                  d="M12.18 5.92c1.45 0 2.75.5 3.77 1.48l2.82-2.82C17.06 2.99 14.84 2 12.18 2 8.34 2 5.01 4.2 3.38 7.43l3.28 2.56c.78-2.34 2.95-4.07 5.52-4.07z"
                />
              </svg>
            )}
            <span>
              {isSigningIn
                ? isRTL
                  ? 'جاري تسجيل الدخول وفحص السحابة...'
                  : 'Signing in & checking cloud...'
                : isRTL
                ? 'تسجيل الدخول بحساب جوجل'
                : 'Sign in with Google'}
            </span>
          </button>

          <button
            type="button"
            data-testid="auth-gate-guest-btn"
            disabled={isSigningIn}
            onClick={enterGuestMode}
            className="w-full py-3 px-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[var(--color-ink)] font-semibold text-xs flex items-center justify-center gap-2 transition-colors min-h-[46px] disabled:opacity-50"
          >
            <UserRound className="w-4 h-4 text-[var(--color-muted)] shrink-0" />
            <span>
              {isRTL ? 'الدخول كزائر (تجربة بدون تسجيل)' : 'Continue as Guest (Try without signing in)'}
            </span>
          </button>
        </div>

        <p className="text-[11px] text-center text-[var(--color-muted)] leading-relaxed">
          {isRTL
            ? 'ملاحظة: في وضع الزائر تُحفظ بياناتك محلياً فقط على هذا المتصفح، ويمكنك ربط حساب جوجل لاحقاً في أي وقت.'
            : 'In Guest Mode, data stays locally on this browser. You can link a Google account anytime later.'}
        </p>
      </div>
    </div>
  );
};
