import React, { useEffect, useState } from 'react';
import {
  Cloud,
  ShieldCheck,
  Sparkles,
  UserRound,
  Loader2,
  AlertCircle,
  Globe,
  Wallet,
  PieChart,
  Users,
  WifiOff,
  Building2,
  RefreshCw,
  ChevronDown,
  Headphones,
  FileText,
  HelpCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { auth } from '../../services/firebase';
import { SUPPORT_CONFIG } from '../../constants/support';
import { BrandLogo } from '../common/BrandLogo';
import { DirectPWAInstallButton } from '../common/PWAInstallPrompt';
import { SupportAndLegalModal } from '../more/SupportAndLegalModal';

interface FeatureHighlight {
  icon: React.ComponentType<{ className?: string }>;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
}

interface FaqItem {
  id: string;
  questionAr: string;
  questionEn: string;
  answerAr: string;
  answerEn: string;
}

const KEY_FEATURES: FeatureHighlight[] = [
  {
    icon: Wallet,
    titleAr: 'المحافظ والأصول',
    titleEn: 'Wallets & Assets',
    descAr: 'فصل واضح بين السيولة المتاحة للصرف والمدخرات والأصول وصافي الثروة.',
    descEn: 'Clear separation between spendable liquidity, savings, assets, and net worth.',
  },
  {
    icon: PieChart,
    titleAr: 'الميزانيات والتقارير',
    titleEn: 'Budgets & Insights',
    descAr: 'حدود صرف شهرية، تنبيهات مبكرة، وتحليلات مرئية للتدفقات النقدية.',
    descEn: 'Monthly spending limits, early alerts, and visual cashflow analytics.',
  },
  {
    icon: Users,
    titleAr: 'الجمعيات والديون',
    titleEn: 'Money Circles & Debts',
    descAr: 'تنظيم الجمعيات المالية، متابعة الأقساط والالتزامات، وتذكيرات الاستحقاق.',
    descEn: 'Track money circles (ROSCAs), installments, debts, and due-date reminders.',
  },
  {
    icon: WifiOff,
    titleAr: 'يعمل بدون إنترنت',
    titleEn: 'Offline-First & Multi-Currency',
    descAr: 'سجّل معاملاتك بعملات متعددة في أي وقت وتُزامَن تلقائياً عند الاتصال.',
    descEn: 'Log multi-currency entries anytime offline with automatic sync on reconnect.',
  },
  {
    icon: Building2,
    titleAr: 'مساحات عمل للشركات',
    titleEn: 'Business Workspaces',
    descAr: 'إدارة حسابات الفرق، الصلاحيات، الاعتمادات، وسندات القبض والصرف.',
    descEn: 'Manage team workspaces, role permissions, approvals, and formal vouchers.',
  },
  {
    icon: RefreshCw,
    titleAr: 'نسخ سحابي تلقائي',
    titleEn: 'Automatic Cloud Backups',
    descAr: 'حفظ سحابي سريع بعد المعاملات مع الاحتفاظ بآخر 7 نسخ وتصدير JSON/CSV.',
    descEn: 'Fast post-transaction cloud snapshots (last 7 kept) plus JSON/CSV exports.',
  },
];

const QUICK_FAQS: FaqItem[] = [
  {
    id: 'free',
    questionAr: 'هل تطبيق رَصِيدِي مجاني للاستخدام؟',
    questionEn: 'Is Raseedi free to use?',
    answerAr:
      'نعم، يمكنك استخدام المزايا الأساسية للمحافظ والمصاريف والميزانيات والجمعيات مجاناً، مع إمكانية الترقية الاختيارية إلى باقة PRO أو Business لإزالة الإعلانات وفتح أدوات متقدمة.',
    answerEn:
      'Yes. Core expense tracking, wallets, budgets, and money circles are free to use, with optional PRO and Business plans for an ad-free experience and advanced team tools.',
  },
  {
    id: 'privacy',
    questionAr: 'أين تُحفظ بياناتي المالية وهل هي آمنة؟',
    questionEn: 'Where is my financial data stored and is it private?',
    answerAr:
      'في وضع الزائر تبقى بياناتك محلياً على متصفحك فقط. وعند تسجيل الدخول بحساب جوجل تُحفظ بياناتك في مساحة سحابية معزولة خاصة بحسابك فقط، ولا نبيع أو نشارك سجلاتك المالية مع أي طرف ثالث.',
    answerEn:
      'In Guest Mode, all data stays strictly on your browser. When signed in with Google, your records sync to your isolated cloud space and are never sold or shared with third parties.',
  },
  {
    id: 'offline',
    questionAr: 'هل يعمل التطبيق بدون اتصال بالإنترنت؟',
    questionEn: 'Does Raseedi work offline?',
    answerAr:
      'نعم، يمكنك تثبيت التطبيق كتطبيق ويب (PWA) وتسجيل معاملاتك دون إنترنت، وعند عودة الاتصال تتم مزامنة النسخة الاحتياطية السحابية تلقائياً.',
    answerEn:
      'Yes. You can install Raseedi as a PWA, log transactions offline, and your cloud backup syncs automatically once connectivity returns.',
  },
  {
    id: 'workspaces',
    questionAr: 'هل يمكنني الفصل بين مصاريفي الشخصية وحسابات شركتي؟',
    questionEn: 'Can I separate personal expenses from company finances?',
    answerAr:
      'بالتأكيد. يوفر رَصِيدِي مساحات عمل مستقلة تماماً تتيح لك التبديل بسلاسة بين حسابك الشخصي وحسابات المؤسسة دون تداخل في الأرصدة أو التقارير.',
    answerEn:
      'Yes. Raseedi provides fully isolated workspaces so you can switch seamlessly between your personal finances and business accounts without mixing balances or reports.',
  },
];

export const AuthGateScreen: React.FC = () => {
  const {
    user,
    signInWithGoogleAccount,
    enterGuestMode,
    loadDemoData,
    cloudSyncError,
    settings,
    updateSettings,
    isRTL,
  } = useApp();

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInFailedFallback, setSignInFailedFallback] = useState(false);
  const [openFaqId, setOpenFaqId] = useState<string | null>(QUICK_FAQS[0].id);
  const [legalModalState, setLegalModalState] = useState<{
    isOpen: boolean;
    tab: 'support' | 'legal';
  }>({ isOpen: false, tab: 'legal' });

  // Support automated verification jump (?autostart=1) directly into demo session
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      loadDemoData();
    }
  }, [loadDemoData]);

  // Clear transient error notice immediately if user becomes authenticated
  useEffect(() => {
    if (user?.isLoggedIn) {
      setSignInFailedFallback(false);
    }
  }, [user?.isLoggedIn]);

  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    setSignInFailedFallback(false);
    setIsSigningIn(true);
    try {
      const res = await signInWithGoogleAccount();
      // Never show an error if login actually succeeded or Firebase Auth has an active user
      if (!res && !auth.currentUser) {
        setSignInFailedFallback(true);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  // Prefer live cloudSyncError (exact cause from Firebase Auth) over generic fallback;
  // never capture a stale cloudSyncError inside the async click closure.
  const displayedAuthError = user?.isLoggedIn
    ? null
    : cloudSyncError ||
      (signInFailedFallback
        ? isRTL
          ? 'تعذر إتمام تسجيل الدخول بحساب جوجل. حاول مرة أخرى أو جرب الدخول كزائر.'
          : 'Could not complete Google sign-in. Please try again or continue as Guest.'
        : null);

  return (
    <div
      className="min-h-screen w-full overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)] flex flex-col items-center px-4 py-6 sm:py-10"
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="auth-gate-screen"
    >
      <div className="w-full max-w-lg space-y-5">
        {/* Primary Auth Card */}
        <section className="w-full rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] shadow-xl p-5 sm:p-7 space-y-5">
          {/* Top Row: Brand & Language Toggle */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BrandLogo
                className="w-12 h-12 rounded-xl object-cover shadow-sm shrink-0"
                title={isRTL ? 'رَصِيدِي' : 'Raseedi'}
              />
              <div className="min-w-0">
                <h1 className="font-title text-xl font-bold text-[var(--color-ink)] truncate">
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
              className="px-2.5 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[11px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)] flex items-center gap-1.5 min-h-[36px] shrink-0"
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
                ? 'سجّل دخولك بحساب جوجل لاستعادة بياناتك واشتراكك تلقائياً من السحابة أو ابدأ التجربة مباشرة كزائر بدون تسجيل.'
                : 'Sign in with Google to automatically restore your cloud backup & subscription, or start exploring right away in Guest Mode.'}
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
                    : 'Automatically checks cloud storage on login to restore wallets, ledger, and PRO access.'}
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
              <Sparkles className="w-4 h-4 text-[var(--color-gold)] shrink-0 mt-0.5" />
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
          {displayedAuthError && (
            <div
              role="alert"
              data-testid="auth-gate-error-banner"
              className="p-3 rounded-xl bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 text-[11px] text-[var(--color-expense)] flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{displayedAuthError}</span>
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

            <DirectPWAInstallButton variant="auth" />
          </div>

          <p className="text-[11px] text-center text-[var(--color-muted)] leading-relaxed">
            {isRTL
              ? 'ملاحظة: في وضع الزائر تُحفظ بياناتك محلياً فقط على هذا المتصفح، ويمكنك ربط حساب جوجل لاحقاً في أي وقت.'
              : 'In Guest Mode, data stays locally on this browser. You can link a Google account anytime later.'}
          </p>
        </section>

        {/* About Raseedi & Key Features (Public Overview for Visitors) */}
        <section
          aria-labelledby="auth-about-heading"
          data-testid="auth-gate-overview-section"
          className="w-full rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 space-y-4"
        >
          <div className="space-y-1.5">
            <h2
              id="auth-about-heading"
              className="font-title text-base font-bold text-[var(--color-ink)]"
            >
              {isRTL ? 'عن تطبيق رَصِيدِي' : 'About Raseedi'}
            </h2>
            <p className="text-xs text-[var(--color-muted)] leading-relaxed">
              {isRTL
                ? '«رَصِيدِي» هو منصة مالية عربية متكاملة تساعد الأفراد ورواد الأعمال على تتبع المصروفات والدخل، تنظيم المحافظ والأصول، ضبط الميزانيات الشهرية، متابعة الديون والجمعيات، وإدارة حسابات المؤسسات بوضوح وخصوصية كاملة.'
                : 'Raseedi is a comprehensive personal and business finance web app built to track income and expenses, organize wallets and assets, control monthly budgets, manage debts and money circles, and run isolated company workspaces with full privacy.'}
            </p>
          </div>

          <div className="space-y-2.5">
            <h3 className="text-xs font-bold text-[var(--color-ink)]">
              {isRTL ? 'أبرز المميزات' : 'Key Features'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {KEY_FEATURES.map((feat) => {
                const Icon = feat.icon;
                return (
                  <div
                    key={feat.titleEn}
                    className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] flex items-start gap-2.5 min-w-0"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--color-ink)] leading-snug">
                        {isRTL ? feat.titleAr : feat.titleEn}
                      </div>
                      <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mt-0.5">
                        {isRTL ? feat.descAr : feat.descEn}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Concise FAQ Section */}
        <section
          aria-labelledby="auth-faq-heading"
          data-testid="auth-gate-faq-section"
          className="w-full rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 space-y-3"
        >
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
            <h2
              id="auth-faq-heading"
              className="font-title text-base font-bold text-[var(--color-ink)]"
            >
              {isRTL ? 'أسئلة شائعة' : 'Frequently Asked Questions'}
            </h2>
          </div>

          <div className="space-y-2">
            {QUICK_FAQS.map((item) => {
              const isExpanded = openFaqId === item.id;
              return (
                <div
                  key={item.id}
                  className="rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] overflow-hidden"
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setOpenFaqId(isExpanded ? null : item.id)}
                    className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-start min-h-[42px] hover:bg-[var(--color-surface-subtle)]/40 transition-colors"
                  >
                    <span className="text-xs font-semibold text-[var(--color-ink)] leading-snug">
                      {isRTL ? item.questionAr : item.questionEn}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-[var(--color-muted)] shrink-0 transition-transform duration-150 ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isExpanded && (
                    <div className="px-3.5 pb-3 pt-0.5 text-[11px] text-[var(--color-muted)] leading-relaxed border-t border-[var(--color-line)]/60">
                      {isRTL ? item.answerAr : item.answerEn}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Direct Legal & Support Footer Links (Accessible Without Sign-In) */}
        <footer
          data-testid="auth-gate-legal-footer"
          className="w-full rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] p-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="auth-gate-legal-btn"
              onClick={() => setLegalModalState({ isOpen: true, tab: 'legal' })}
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-xs font-semibold text-[var(--color-ink)] flex items-center justify-center gap-2 transition-colors min-h-[42px]"
            >
              <FileText className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
              <span>
                {isRTL ? 'سياسة الخصوصية وشروط الاستخدام' : 'Privacy Policy & Terms'}
              </span>
            </button>

            <button
              type="button"
              data-testid="auth-gate-support-btn"
              onClick={() => setLegalModalState({ isOpen: true, tab: 'support' })}
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-xs font-semibold text-[var(--color-ink)] flex items-center justify-center gap-2 transition-colors min-h-[42px]"
            >
              <Headphones className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
              <span>{isRTL ? 'الدعم والتواصل' : 'Support & Contact'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted)]">
            <span>
              {isRTL ? 'للتواصل المباشر:' : 'Direct contact:'}{' '}
              <a
                href={`mailto:${SUPPORT_CONFIG.email}`}
                className="font-semibold text-[var(--color-accent)] hover:underline"
                dir="ltr"
              >
                {SUPPORT_CONFIG.email}
              </a>
            </span>
            <span aria-hidden="true">•</span>
            <span>
              {isRTL ? '© رَصِيدِي للإدارة المالية' : '© Raseedi Finance'}
            </span>
          </div>
        </footer>
      </div>

      {/* Pre-Login Privacy Policy, Terms & Support Modal */}
      <SupportAndLegalModal
        isOpen={legalModalState.isOpen}
        onClose={() => setLegalModalState((prev) => ({ ...prev, isOpen: false }))}
        initialTab={legalModalState.tab}
        hideUpgradeAction={true}
      />
    </div>
  );
};
