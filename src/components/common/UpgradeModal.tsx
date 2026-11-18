import React, { useState } from 'react';
import {
  X,
  Check,
  Sparkles,
  Shield,
  RotateCcw,
  KeyRound,
  MessageCircle,
  Mail,
  Cloud,
  Loader2,
  Building2,
  User,
  Clock,
  Users,
  ExternalLink,
  AlertTriangle,
  Crown,
  Calendar,
  LogOut,
  LogIn,
  Lock,
  ChevronDown,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SUPPORT_CONFIG } from '../../constants/support';
import { formatPricingMoney, PRICING_CONFIG, PricingCurrency } from '../../config/pricing';
import { previewProCodeWithServer } from '../../services/firebase';
import {
  calculateSubscriptionDatesUpdate,
  shouldShowUpgradeActionButtons,
} from '../../services/subscriptionHelpers';

export const UpgradeModal: React.FC = () => {
  const {
    isUpgradeModalOpen,
    setIsUpgradeModalOpen,
    isPro,
    isBusinessPro,
    planTier,
    proEntitlement,
    subscriptionSummary,
    isAdminUser,
    openAdminPanel,
    user,
    setIsLogoutModalOpen,
    orgRefs,
    organizationsList,
    isOrgWorkspace,
    activeOrganization,
    activeOrgSubscriptionState,
    redeemProCode,
    startBusinessTrial,
    devActivateProPreview,
    restorePurchases,
    signInWithGoogleAccount,
    isRTL,
    t,
  } = useApp();

  const eligibleOrgs = React.useMemo(() => {
    const map = new Map<string, { orgId: string; orgName: string; currency: string }>();
    for (const r of orgRefs) {
      if (r.role === 'owner' || r.role === 'admin') {
        map.set(r.orgId, { orgId: r.orgId, orgName: r.orgName, currency: r.currency || 'EGP' });
      }
    }
    for (const org of organizationsList) {
      if (org?.id && !map.has(org.id)) {
        map.set(org.id, { orgId: org.id, orgName: org.name, currency: org.currency || 'EGP' });
      }
    }
    return Array.from(map.values());
  }, [orgRefs, organizationsList]);

  const [tierTab, setTierTab] = useState<'personal_pro' | 'business_pro'>(
    isOrgWorkspace || isBusinessPro ? 'business_pro' : 'personal_pro'
  );
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [personalCycle, setPersonalCycle] = useState<'monthly' | 'yearly' | 'lifetime'>('yearly');
  const [businessCycle, setBusinessCycle] = useState<'monthly' | 'yearly'>('yearly');
  const [currencyMode, setCurrencyMode] = useState<PricingCurrency>('EGP');
  const [subscriberActionMode, setSubscriberActionMode] = useState<'none' | 'renew' | 'switch'>('none');

  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [trialMessage, setTrialMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [isStartingTrial, setIsStartingTrial] = useState(false);

  const [activationCode, setActivationCode] = useState('');
  const [isCouponBoxOpen, setIsCouponBoxOpen] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeSuccess, setCodeSuccess] = useState<string | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSigningInGoogle, setIsSigningInGoogle] = useState(false);
  const [pendingSwitchConfirmation, setPendingSwitchConfirmation] = useState<{
    code: string;
    targetTier: 'personal_pro' | 'business_pro';
    targetCycle: 'monthly' | 'yearly' | 'lifetime';
    replacedDaysRemaining: number | null;
    replacedIsLifetime: boolean;
  } | null>(null);
  const isDev = import.meta.env.DEV;

  React.useEffect(() => {
    if (!isUpgradeModalOpen) {
      setSubscriberActionMode('none');
      setIsCouponBoxOpen(false);
      setPendingSwitchConfirmation(null);
      setCodeError(null);
      return;
    }
    if (isAdminUser) {
      setIsUpgradeModalOpen(false);
      openAdminPanel();
      return;
    }
    if (isOrgWorkspace || isBusinessPro || subscriptionSummary.isPro) {
      setTierTab(isBusinessPro ? 'business_pro' : subscriptionSummary.isPro ? 'business_pro' : 'personal_pro');
    } else {
      setTierTab('personal_pro');
    }
    const defaultOrgId =
      (activeOrganization && eligibleOrgs.some((o) => o.orgId === activeOrganization.id)
        ? activeOrganization.id
        : eligibleOrgs[0]?.orgId) || '';
    setSelectedOrgId((prev) =>
      prev && eligibleOrgs.some((o) => o.orgId === prev) ? prev : defaultOrgId
    );
  }, [
    isUpgradeModalOpen,
    isAdminUser,
    isOrgWorkspace,
    isBusinessPro,
    subscriptionSummary.isPro,
    activeOrganization,
    eligibleOrgs,
    setIsUpgradeModalOpen,
    openAdminPanel,
  ]);

  if (!isUpgradeModalOpen || isAdminUser) return null;

  const lang = isRTL ? 'ar' : 'en';
  const targetBusinessOrgId =
    tierTab === 'business_pro' && selectedOrgId ? selectedOrgId : undefined;
  const isSubscribedUser = subscriptionSummary.isPro && !subscriptionSummary.isAdminOverride;
  const isPersonalSubscribedOnly = isSubscribedUser && !subscriptionSummary.isBusinessPro;
  const showSubscriberActionButtons = shouldShowUpgradeActionButtons(subscriptionSummary);
  const isHighestTierPermanent = isSubscribedUser && !showSubscriberActionButtons;
  const showFullPricingCatalog =
    !isHighestTierPermanent && (!isSubscribedUser || subscriberActionMode !== 'none');
  const showPersonalCatalog = !isSubscribedUser || subscriberActionMode === 'switch';

  const formatSubDate = (ms: number | null) => {
    if (!ms) return isRTL ? 'غير محدد' : 'N/A';
    try {
      return new Date(ms).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return new Date(ms).toLocaleDateString();
    }
  };

  const cycleHumanLabel = (() => {
    switch (subscriptionSummary.billingCycle) {
      case 'monthly':
        return isRTL ? 'شهري' : 'Monthly';
      case 'yearly':
        return isRTL ? 'سنوي' : 'Yearly';
      case 'lifetime':
        return isRTL ? 'مدى الحياة' : 'Lifetime';
      case 'trial':
        return isRTL ? 'فترة تجريبية مجانية' : 'Free Trial';
      case 'code':
        return isRTL ? 'كود تفعيل' : 'Activation Code';
      default:
        return isRTL ? 'مجاني' : 'Free';
    }
  })();

  const handleGoogleSignInInline = async () => {
    setIsSigningInGoogle(true);
    setCodeError(null);
    try {
      await signInWithGoogleAccount();
    } finally {
      setIsSigningInGoogle(false);
    }
  };

  const handleDevActivate = () => {
    if (isDev) {
      devActivateProPreview(tierTab);
    }
  };

  const handleStartTrial = async () => {
    setTrialMessage(null);
    if (!user?.isLoggedIn) {
      const signed = await signInWithGoogleAccount();
      if (!signed) {
        setTrialMessage({
          type: 'err',
          text: isRTL
            ? 'يرجى تسجيل الدخول بحساب Google أولاً لتفعيل الفترة التجريبية المجانية.'
            : 'Please sign in with Google first to start your free Business trial.',
        });
        return;
      }
    }

    setIsStartingTrial(true);
    try {
      const res = await startBusinessTrial(targetBusinessOrgId);
      if (res.ok) {
        setTrialMessage({
          type: 'ok',
          text: isRTL
            ? `تم تفعيل الفترة التجريبية المجانية لباقة Business PRO لمدة ${PRICING_CONFIG.trialDays} يوماً!`
            : `${PRICING_CONFIG.trialDays}-day Business PRO free trial activated!`,
        });
      } else {
        setTrialMessage({
          type: 'err',
          text:
            res.error ||
            (isRTL ? 'تعذر تفعيل التجربة المجانية.' : 'Could not activate free trial.'),
        });
      }
    } finally {
      setIsStartingTrial(false);
    }
  };

  const executeRedeemCode = async (trimmedCode: string) => {
    setIsRedeeming(true);
    setCodeError(null);
    setCodeSuccess(null);
    try {
      const result = await redeemProCode(trimmedCode, targetBusinessOrgId);
      if (!result.ok) {
        setCodeError(
          result.error ||
            (isRTL
              ? 'كود التفعيل غير صحيح أو مستخدم بالفعل.'
              : 'Activation code is invalid or already redeemed.')
        );
        return;
      }

      setPendingSwitchConfirmation(null);
      setActivationCode('');
      setSubscriberActionMode('none');
      const tierLabel =
        result.planTier === 'business_pro'
          ? isRTL
            ? 'Business PRO للأعمال'
            : 'Business PRO'
          : isRTL
          ? 'Personal PRO للأفراد'
          : 'Personal PRO';
      const cycleLabel =
        result.billingCycle === 'monthly'
          ? isRTL
            ? 'شهري'
            : 'Monthly'
          : result.billingCycle === 'yearly'
          ? isRTL
            ? 'سنوي'
            : 'Yearly'
          : result.billingCycle === 'lifetime'
          ? isRTL
            ? 'مدى الحياة'
            : 'Lifetime'
          : '';
      setCodeSuccess(
        result.isCumulativeRenewal
          ? isRTL
            ? `مبروك! 🎉 تم تجديد باقة ${tierLabel} وإضافة المدة الجديدة فوق رصيدك المتبقي بنجاح!`
            : `Renewed! 🎉 ${tierLabel} duration added cumulatively onto your remaining balance!`
          : isRTL
          ? `مبروك! 🎉 تم تفعيل باقة ${tierLabel}${cycleLabel ? ` (${cycleLabel})` : ''} بنجاح على حسابك!`
          : `Congratulations! 🎉 ${tierLabel}${cycleLabel ? ` (${cycleLabel})` : ''} activated successfully!`
      );
      window.setTimeout(() => setCodeSuccess(null), 8000);
    } finally {
      setIsRedeeming(false);
    }
  };

  const handleRedeemCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError(null);
    setCodeSuccess(null);

    if (!user?.isLoggedIn) {
      setCodeError(
        isRTL
          ? 'يجب تسجيل الدخول بحساب جوجل أولاً لربط الاشتراك وسحابياً.'
          : 'Please sign in with Google first to link your subscription to the cloud.'
      );
      return;
    }

    const trimmed = activationCode.trim();
    if (!trimmed) return;

    // If user already has an active subscription, inspect target tier before redeeming so cross-tier switches warn first
    if (isSubscribedUser) {
      let targetTier: 'personal_pro' | 'business_pro' | null = null;
      let targetCycle: 'monthly' | 'yearly' | 'lifetime' | null = null;

      const preview = await previewProCodeWithServer(trimmed, targetBusinessOrgId);
      if (preview.valid && preview.planTier && preview.billingCycle) {
        targetTier = preview.planTier === 'business_pro' ? 'business_pro' : 'personal_pro';
        targetCycle = preview.billingCycle;
      }

      if (targetTier && targetCycle) {
        const dateCheck = calculateSubscriptionDatesUpdate({
          currentTier: subscriptionSummary.planTier,
          currentExpiresAt: subscriptionSummary.expiresAt,
          currentBillingCycle: subscriptionSummary.billingCycle,
          currentIsPro: subscriptionSummary.isPro,
          newTier: targetTier,
          newCycle: targetCycle,
        });
        if (dateCheck.shouldWarnForfeiture) {
          setPendingSwitchConfirmation({
            code: trimmed,
            targetTier,
            targetCycle,
            replacedDaysRemaining: dateCheck.replacedDaysRemaining,
            replacedIsLifetime: dateCheck.replacedIsLifetime,
          });
          return;
        }
      }
    }

    await executeRedeemCode(trimmed);
  };

  const handleRestore = async () => {
    setIsRestoring(true);
    try {
      if (!user?.isLoggedIn) {
        const res = await signInWithGoogleAccount();
        if (res?.isProRestored) {
          setRestoreStatus(
            isRTL
              ? 'تمت استعادة اشتراك PRO وبياناتك من حساب جوجل بنجاح!'
              : 'PRO subscription restored from your Google account!'
          );
          window.setTimeout(() => setRestoreStatus(null), 3500);
          return;
        }
      }

      const success = await restorePurchases();
      if (success) {
        setRestoreStatus(
          isRTL ? 'تمت استعادة اشتراك PRO بنجاح' : 'PRO subscription restored successfully'
        );
      } else {
        setRestoreStatus(
          isRTL
            ? 'لم يُعثر على اشتراك مرتبط بهذا الحساب. يمكنك إدخال كود التفعيل أو التواصل معنا.'
            : 'No linked PRO subscription found for this account. Enter your code or contact support.'
        );
      }
      window.setTimeout(() => setRestoreStatus(null), 3500);
    } finally {
      setIsRestoring(false);
    }
  };

  const personalFeatures: React.ReactNode[] = isRTL
    ? [
        'إزالة الإعلانات نهائياً في جميع شاشات التطبيق',
        <>
          حتى <bdi dir="ltr">200</bdi> عملية مسح فواتير شهرياً بالذكاء الاصطناعي (<bdi dir="ltr">Gemini AI</bdi>)
        </>,
        'محافظ وميزانيات غير محدودة + استيراد كشوف CSV',
        <>
          النسخ الاحتياطي السحابي المشفر واستعادة البيانات عبر <bdi dir="ltr">Google</bdi>
        </>,
        <>
          تصدير تقارير <bdi dir="ltr">PDF</bdi> و<bdi dir="ltr">Excel</bdi> وإرفاق صور الفواتير
        </>,
      ]
    : [
        'Remove all ads permanently across the entire app',
        'Up to 200 AI receipt scans / month with instant auto-fill',
        'Unlimited wallets, budgets, recurring rules & CSV bank imports',
        'Google Cloud Backup & automatic restore across devices',
        'Pro PDF & Excel exports plus unlimited receipt photo attachments',
      ];

  const businessFeatures: React.ReactNode[] = isRTL
    ? [
        'تعدد مساحات الشركات والمؤسسات مع فصل تام عن الحساب الشخصي',
        <>
          <bdi dir="ltr">5</bdi> مقاعد فريق مضمنة (<bdi dir="ltr">Owner / Admin / Accountant / Employee / Viewer</bdi>)
        </>,
        'دورة اعتماد المصاريف واسترداد الموظفين + قفل الفترات المحاسبية',
        'إدارة ضريبة القيمة المضافة (شامل / مضاف) ومراكز التكلفة وتقارير الأرباح والخسائر',
        'تتبع الموردين والعملاء وتقارير أعمار الديون وسجل تدقيق غير قابل للتعديل',
        <>
          حتى <bdi dir="ltr">250</bdi> عملية مسح فواتير بالذكاء الاصطناعي شهرياً
        </>,
      ]
    : [
        'Multi-organization workspaces completely isolated from Personal data',
        '5 team seats included with 5-tier RBAC (Owner, Admin, Accountant, Employee, Viewer)',
        'Expense approval workflow, employee reimbursements & Accounting Period Lock',
        'VAT accounting (Inclusive/Exclusive), Cost Centers & P&L Income Statements',
        'Vendors/Clients AP & AR Aging (0-30/60/90+) & immutable Audit Log',
        'Up to 250 AI receipt scans / month + extra seats at $1 (35 EGP) / mo',
      ];

  const activeFeatures = tierTab === 'business_pro' ? businessFeatures : personalFeatures;

  const selectedPriceDisplay =
    tierTab === 'business_pro'
      ? formatPricingMoney(
          currencyMode === 'USD'
            ? PRICING_CONFIG.businessPro[businessCycle].usd
            : PRICING_CONFIG.businessPro[businessCycle].egp,
          currencyMode,
          lang
        )
      : formatPricingMoney(
          currencyMode === 'USD'
            ? PRICING_CONFIG.personalPro[personalCycle].usd
            : PRICING_CONFIG.personalPro[personalCycle].egp,
          currencyMode,
          lang
        );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4">
      <div
        className="w-full max-w-lg bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl overflow-hidden shadow-2xl animate-in fade-in duration-150 flex flex-col max-h-[90vh]"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[var(--color-line)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] flex items-center justify-center shrink-0">
              {tierTab === 'business_pro' ? (
                <Building2 className="w-4 h-4" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </div>
            <div>
              <h2 className="font-title text-base sm:text-lg font-bold leading-snug text-[var(--color-ink)]">
                {isSubscribedUser
                  ? isRTL
                    ? 'إدارة اشتراكك في رَصِيدِي'
                    : 'Manage Your Subscription'
                  : tierTab === 'business_pro'
                  ? isRTL
                    ? 'رصيدي للأعمال والمؤسسات'
                    : 'Raseedi Business PRO'
                  : isRTL
                  ? 'رصيدي برو للأفراد'
                  : 'Raseedi Personal PRO'}
              </h2>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">
                {isSubscribedUser
                  ? isRTL
                    ? 'تفاصيل الباقة المفعلة، التواريخ، والتجديد'
                    : 'Active plan details, dates & renewal options'
                  : isRTL
                  ? 'أسعار واضحة للأفراد والشركات مع تجربة مجانية للأعمال'
                  : 'Transparent plans for Personal & Enterprise with 14-day Business trial'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsUpgradeModalOpen(false)}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors min-h-[36px] min-w-[36px]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Google Account Connection Status Bar */}
          <div
            data-testid="upgrade-google-status-card"
            className={`p-3 rounded-xl border flex items-center justify-between gap-2.5 ${
              user?.isLoggedIn
                ? 'bg-[var(--color-bg)] border-[var(--color-line)]'
                : 'bg-amber-500/10 border-amber-500/30'
            }`}
          >
            {user?.isLoggedIn ? (
              <>
                <div className="flex items-center gap-2.5 min-w-0">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.name}
                      className="w-9 h-9 rounded-full border border-[var(--color-line)] shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] flex items-center justify-center text-xs font-bold shrink-0">
                      {(user.name || 'R').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[var(--color-ink)] truncate">
                      {user.name}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)] truncate" dir="ltr">
                      {user.email}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsUpgradeModalOpen(false);
                    setIsLogoutModalOpen(true);
                  }}
                  aria-label={isRTL ? 'تسجيل الخروج' : 'Sign Out'}
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[11px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-expense)] flex items-center gap-1 shrink-0 min-h-[34px]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{isRTL ? 'خروج' : 'Sign Out'}</span>
                </button>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-amber-800 dark:text-amber-300">
                    {isRTL ? 'أنت في وضع الزائر (بدون حساب جوجل)' : 'Guest Mode (Not Signed In)'}
                  </div>
                  <div className="text-[11px] text-[var(--color-muted)] mt-0.5">
                    {isRTL
                      ? 'سجّل الدخول بحساب جوجل لحفظ اشتراكك وتفعيل الأكواد السحابية.'
                      : 'Sign in with Google to activate license codes and preserve PRO access.'}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="upgrade-google-signin-btn"
                  disabled={isSigningInGoogle}
                  onClick={() => void handleGoogleSignInInline()}
                  className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center gap-1.5 shrink-0 min-h-[38px] disabled:opacity-60"
                >
                  {isSigningInGoogle ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <LogIn className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{isRTL ? 'دخول بجوجل' : 'Google Login'}</span>
                </button>
              </>
            )}
          </div>

          {/* Subscriber Status Dashboard (Replaces free pricing when already subscribed) */}
          {isSubscribedUser && (
            <div
              data-testid="subscriber-dashboard-card"
              className="p-4 rounded-2xl bg-[var(--color-income)]/10 border border-[var(--color-income)]/30 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[var(--color-income)]/20 text-[var(--color-income)] flex items-center justify-center shrink-0">
                    <Crown className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-[var(--color-income)]">
                      {isRTL ? 'الباقة النشطة حالياً' : 'Current Active Subscription'}
                    </div>
                    <h3 className="font-title text-sm sm:text-base font-bold text-[var(--color-ink)]">
                      {subscriptionSummary.isBusinessPro
                        ? isRTL
                          ? 'باقة Business PRO للأعمال'
                          : 'Business PRO'
                        : isRTL
                        ? 'باقة Personal PRO للأفراد'
                        : 'Personal PRO'}
                    </h3>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[var(--color-income)] text-white text-[10px] font-bold shrink-0">
                  {cycleHumanLabel}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                <div className="p-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]">
                  <div className="text-[10px] text-[var(--color-muted)] flex items-center gap-1">
                    <Calendar className="w-3 h-3 shrink-0" />
                    <span>{isRTL ? 'تاريخ البداية' : 'Start Date'}</span>
                  </div>
                  <div className="text-xs font-bold text-[var(--color-ink)] mt-0.5">
                    {formatSubDate(subscriptionSummary.startedAt)}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]">
                  <div className="text-[10px] text-[var(--color-muted)] flex items-center gap-1">
                    <Calendar className="w-3 h-3 shrink-0" />
                    <span>{isRTL ? 'تاريخ الانتهاء' : 'Expiry Date'}</span>
                  </div>
                  <div className="text-xs font-bold text-[var(--color-ink)] mt-0.5">
                    {subscriptionSummary.isLifetime
                      ? isRTL
                        ? 'مدى الحياة'
                        : 'Lifetime'
                      : formatSubDate(subscriptionSummary.expiresAt)}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] col-span-2 sm:col-span-1">
                  <div className="text-[10px] text-[var(--color-muted)] flex items-center gap-1">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>{isRTL ? 'الأيام المتبقية' : 'Days Remaining'}</span>
                  </div>
                  <div
                    className={`text-xs font-bold mt-0.5 ${
                      subscriptionSummary.isExpiringSoon
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-[var(--color-income)]'
                    }`}
                  >
                    {subscriptionSummary.isLifetime
                      ? isRTL
                        ? 'دائم بدون انتهاء'
                        : 'Unlimited'
                      : isRTL
                      ? `${subscriptionSummary.daysRemaining ?? 0} يوم`
                      : `${subscriptionSummary.daysRemaining ?? 0} day(s)`}
                  </div>
                </div>
              </div>

              {subscriptionSummary.isExpiringSoon && (
                <div
                  data-testid="upgrade-expiring-soon-alert"
                  className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/35 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2 font-semibold"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    {isRTL
                      ? `تنبيه: اشتراكك ينتهي خلال ${subscriptionSummary.daysRemaining} أيام. جدّد الآن لضمان استمرار المزايا.`
                      : `Heads up: Your subscription expires in ${subscriptionSummary.daysRemaining} day(s). Renew now to stay covered.`}
                  </span>
                </div>
              )}

              {showSubscriberActionButtons && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    data-testid="subscriber-renew-toggle-btn"
                    onClick={() => {
                      const next = subscriberActionMode === 'renew' ? 'none' : 'renew';
                      setSubscriberActionMode(next);
                      if (next === 'renew') {
                        setTierTab(subscriptionSummary.isBusinessPro ? 'business_pro' : 'personal_pro');
                      }
                    }}
                    className="flex-1 min-w-[130px] py-2 px-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[40px]"
                  >
                    {isRTL ? 'تجديد الاشتراك' : 'Renew Subscription'}
                  </button>
                  <button
                    type="button"
                    data-testid="subscriber-switch-toggle-btn"
                    onClick={() => {
                      const next = subscriberActionMode === 'switch' ? 'none' : 'switch';
                      setSubscriberActionMode(next);
                      if (next === 'switch') {
                        setTierTab(subscriptionSummary.isBusinessPro ? 'personal_pro' : 'business_pro');
                      }
                    }}
                    className="flex-1 min-w-[130px] py-2 px-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] text-xs font-bold hover:border-[var(--color-accent)] min-h-[40px]"
                  >
                    {isRTL ? 'تغيير الباقة' : 'Change Plan'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Plan Switch Informative Warning Banner when user selects "تغيير الباقة" */}
          {isSubscribedUser && subscriberActionMode === 'switch' && showSubscriberActionButtons && (
            <div
              data-testid="subscriber-switch-info-banner"
              className="p-3 rounded-xl bg-amber-500/12 border border-amber-500/35 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-bold">
                  {isRTL ? 'ملاحظة حول تغيير الباقة:' : 'Note about changing plans:'}
                </div>
                <div className="text-[11px] leading-relaxed">
                  {isRTL
                    ? 'التحويل إلى باقة مختلفة يستبدل المدة المتبقية من باقتك الحالية ويبدأ احتساب الباقة الجديدة من تاريخ التفعيل. أما تجديد نفس الباقة فيضيف المدة الجديدة تراكمياً.'
                    : 'Switching to a different plan replaces your remaining days and starts fresh, whereas renewing the same plan stacks cumulatively.'}
                </div>
              </div>
            </div>
          )}

          {/* Personal PRO exclusive Business Upgrade prompt (when not expanding switcher) */}
          {isPersonalSubscribedOnly && subscriberActionMode === 'none' && (
            <div
              data-testid="personal-pro-upgrade-business-card"
              className="p-3.5 rounded-xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 flex items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <Building2 className="w-5 h-5 text-[var(--color-accent)] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--color-ink)]">
                    {isRTL ? 'الترقية إلى باقة المؤسسات والشركات' : 'Upgrade to Business PRO'}
                  </div>
                  <div className="text-[11px] text-[var(--color-muted)] mt-0.5">
                    {isRTL
                      ? 'افتح مساحات الشركات، 5 مقاعد فريق، دورة الاعتماد، وضريبة القيمة المضافة.'
                      : 'Unlock multi-org workspaces, 5 team seats, expense approvals & VAT.'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                data-testid="open-business-upgrade-btn"
                onClick={() => {
                  setTierTab('business_pro');
                  setSubscriberActionMode('switch');
                }}
                className="px-3 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold shrink-0 min-h-[40px]"
              >
                {isRTL ? 'عرض الأعمال' : 'View Business'}
              </button>
            </div>
          )}

          {restoreStatus && (
            <div className="p-2.5 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 rounded-lg text-xs text-[var(--color-accent)] font-medium text-center">
              {restoreStatus}
            </div>
          )}

          {/* Tier Tabs + Currency Toggle (Hidden cleanly for active subscribers unless renewing/switching) */}
          {showFullPricingCatalog && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex bg-[var(--color-bg)] p-1 rounded-xl border border-[var(--color-line)] flex-1 min-w-[230px]">
                {(!isSubscribedUser || (!isBusinessPro && subscriberActionMode === 'renew')) && (
                  <button
                    type="button"
                    onClick={() => setTierTab('personal_pro')}
                    className={`flex-1 py-2 px-2.5 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors min-h-[38px] ${
                      tierTab === 'personal_pro'
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-sm'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    <User className="w-3.5 h-3.5 shrink-0" />
                    <span>{isRTL ? 'باقات الأفراد' : t('personalPlan')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTierTab('business_pro')}
                  className={`flex-1 py-2 px-2.5 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors min-h-[38px] ${
                    tierTab === 'business_pro'
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-sm'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{isRTL ? 'باقات المؤسسات والشركات' : t('businessPlan')}</span>
                </button>
              </div>

              <div className="flex bg-[var(--color-bg)] p-1 rounded-xl border border-[var(--color-line)]">
                {(['EGP', 'USD'] as const).map((cur) => (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setCurrencyMode(cur)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors min-h-[34px] ${
                      currencyMode === cur
                        ? 'bg-[var(--color-surface)] text-[var(--color-accent)] border border-[var(--color-line)]'
                        : 'text-[var(--color-muted)]'
                    }`}
                  >
                    {cur}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PERSONAL PRICING CARDS */}
          {showFullPricingCatalog && showPersonalCatalog && tierTab === 'personal_pro' && (
            <div className="grid grid-cols-3 gap-2 pt-2">
              {(['monthly', 'yearly', 'lifetime'] as const).map((cycle) => {
                const opt = PRICING_CONFIG.personalPro[cycle];
                const isSelected = personalCycle === cycle;
                const price = currencyMode === 'USD' ? opt.usd : opt.egp;
                return (
                  <button
                    key={cycle}
                    type="button"
                    onClick={() => setPersonalCycle(cycle)}
                    className={`p-3 rounded-xl border text-center relative transition-all min-h-[100px] flex flex-col justify-center ${
                      isSelected
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 shadow-sm'
                        : 'border-[var(--color-line)] bg-[var(--color-bg)] hover:border-[var(--color-muted)]'
                    }`}
                  >
                    {cycle === 'yearly' && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[9px] font-bold rounded-full whitespace-nowrap">
                        {isRTL ? 'الأوفر' : 'Best Value'}
                      </span>
                    )}
                    <span className="text-[11px] font-semibold text-[var(--color-accent)] mb-1">
                      {cycle === 'monthly'
                        ? isRTL
                          ? 'شهري'
                          : 'Monthly'
                        : cycle === 'yearly'
                        ? isRTL
                          ? 'سنوي'
                          : 'Yearly'
                        : isRTL
                        ? 'مدى الحياة'
                        : 'Lifetime'}
                    </span>
                    <span className="text-base sm:text-lg font-bold text-[var(--color-ink)] num-tabular" dir="ltr">
                      {formatPricingMoney(price, currencyMode, lang)}
                    </span>
                    <span className="text-[10px] text-[var(--color-muted)] mt-0.5">
                      {cycle === 'monthly'
                        ? isRTL
                          ? '/ شهر'
                          : '/ mo'
                        : cycle === 'yearly'
                        ? isRTL
                          ? '/ سنة'
                          : '/ yr'
                        : isRTL
                        ? 'دفعة واحدة'
                        : 'One-time'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* BUSINESS / ENTERPRISE PRICING CARDS (~2x Personal) */}
          {showFullPricingCatalog && tierTab === 'business_pro' && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3 pt-2">
                {(['monthly', 'yearly'] as const).map((cycle) => {
                  const opt = PRICING_CONFIG.businessPro[cycle];
                  const isSelected = businessCycle === cycle;
                  const price = currencyMode === 'USD' ? opt.usd : opt.egp;
                  return (
                    <button
                      key={cycle}
                      type="button"
                      onClick={() => setBusinessCycle(cycle)}
                      className={`p-3.5 rounded-xl border text-center relative transition-all min-h-[104px] flex flex-col justify-center ${
                        isSelected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 shadow-sm'
                          : 'border-[var(--color-line)] bg-[var(--color-bg)] hover:border-[var(--color-muted)]'
                      }`}
                    >
                      {cycle === 'yearly' && (
                        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[9px] font-bold rounded-full whitespace-nowrap">
                          {isRTL ? 'وفر 30%' : 'Save 30%'}
                        </span>
                      )}
                      <span className="text-xs font-semibold text-[var(--color-accent)] mb-1">
                        {cycle === 'monthly'
                          ? isRTL
                            ? 'أعمال شهري'
                            : 'Business Monthly'
                          : isRTL
                          ? 'أعمال سنوي'
                          : 'Business Yearly'}
                      </span>
                      <span className="text-xl font-bold text-[var(--color-ink)] num-tabular" dir="ltr">
                        {formatPricingMoney(price, currencyMode, lang)}
                      </span>
                      <span className="text-[10px] text-[var(--color-muted)] mt-1">
                        {isRTL
                          ? `يشمل 5 مقاعد • مقعد إضافي ${formatPricingMoney(
                              currencyMode === 'USD'
                                ? PRICING_CONFIG.businessPro.extraSeatMonthly.usd
                                : PRICING_CONFIG.businessPro.extraSeatMonthly.egp,
                              currencyMode,
                              lang
                            )}/ش`
                          : `5 seats included • extra ${formatPricingMoney(
                              currencyMode === 'USD'
                                ? PRICING_CONFIG.businessPro.extraSeatMonthly.usd
                                : PRICING_CONFIG.businessPro.extraSeatMonthly.egp,
                              currencyMode,
                              lang
                            )}/mo`}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Target Cloud Organization selector for Business PRO */}
              {eligibleOrgs.length > 0 && (
                <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-1.5">
                  <label className="text-[11px] font-semibold text-[var(--color-muted)] block">
                    {isRTL ? 'المؤسسة المستهدفة للترقية / التجديد:' : 'Target Organization:'}
                  </label>
                  <select
                    value={selectedOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] min-h-[40px]"
                  >
                    {eligibleOrgs.map((orgRef) => (
                      <option key={orgRef.orgId} value={orgRef.orgId}>
                        {orgRef.orgName} ({orgRef.currency})
                      </option>
                    ))}
                  </select>
                  {activeOrganization?.id === selectedOrgId && activeOrgSubscriptionState && (
                    <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)] pt-0.5">
                      <span>
                        {activeOrgSubscriptionState.isReadOnly
                          ? isRTL
                            ? 'الحالة: منتهي (للقراءة فقط)'
                            : 'Status: Expired (Read-Only)'
                          : activeOrgSubscriptionState.isGracePeriod
                          ? isRTL
                            ? `فترة السماح (${activeOrgSubscriptionState.graceDaysRemaining} أيام متبقية)`
                            : `Grace Period (${activeOrgSubscriptionState.graceDaysRemaining}d left)`
                          : activeOrgSubscriptionState.daysRemaining !== null
                          ? isRTL
                            ? `الحالة: نشط (${activeOrgSubscriptionState.daysRemaining} يوم متبقي)`
                            : `Status: Active (${activeOrgSubscriptionState.daysRemaining}d left)`
                          : isRTL
                          ? 'الحالة: نشط'
                          : 'Status: Active'}
                      </span>
                      <span className="num-tabular" dir="ltr">
                        {activeOrgSubscriptionState.seatLimit} {isRTL ? 'مقاعد' : 'seats'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 14-Day Free Business Trial CTA */}
              {(!isBusinessPro || activeOrgSubscriptionState?.isReadOnly) && (
                <div className="p-3 rounded-xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 flex items-center justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <Clock className="w-4 h-4 text-[var(--color-accent)] shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <div className="font-bold text-[var(--color-ink)]">
                        {t('freeTrial14Days')}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {isRTL
                          ? `جرب كامل ميزات الشركات وفريق العمل لمدة ${PRICING_CONFIG.trialDays} يوماً مجاناً.`
                          : `Try full Enterprise accounting & ${PRICING_CONFIG.businessPro.includedSeats} team seats free for ${PRICING_CONFIG.trialDays} days.`}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleStartTrial}
                    disabled={isStartingTrial}
                    className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold shrink-0 min-h-[40px] flex items-center gap-1 disabled:opacity-60"
                  >
                    {isStartingTrial && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{isRTL ? 'ابدأ التجربة' : 'Start Trial'}</span>
                  </button>
                </div>
              )}

              {trialMessage && (
                <p
                  className={`text-[11px] font-medium ${
                    trialMessage.type === 'ok'
                      ? 'text-[var(--color-income)]'
                      : 'text-[var(--color-expense)]'
                  }`}
                >
                  {trialMessage.text}
                </p>
              )}
            </div>
          )}

          {/* Tier Limits Comparison Strip (Only shown to Free users, never nagging PRO subscribers) */}
          {!isSubscribedUser && (
            <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-center text-[11px]">
              <div>
                <div className="text-[var(--color-muted)]">
                  {isRTL ? 'أفراد مجاني ($0)' : 'Free ($0)'}
                </div>
                <div className="font-bold text-[var(--color-ink)]">
                  {PRICING_CONFIG.free.monthlyAiScans} {isRTL ? 'مسح/ش' : 'scans'}
                </div>
                <div className="text-[10px] text-[var(--color-muted)] mt-0.5">
                  {isRTL
                    ? `${PRICING_CONFIG.free.maxWallets} محافظ • ميزانية واحدة`
                    : `${PRICING_CONFIG.free.maxWallets} wallets • 1 budget`}
                </div>
              </div>
              <div className="border-x border-[var(--color-line)]">
                <div className="text-[var(--color-accent)] font-semibold">Personal PRO</div>
                <div className="font-bold text-[var(--color-ink)]">
                  {PRICING_CONFIG.personalPro.monthlyAiScans} {isRTL ? 'مسح/ش' : 'scans'}
                </div>
                <div className="text-[10px] text-[var(--color-muted)] mt-0.5">
                  {isRTL ? 'غير محدود' : 'Unlimited'}
                </div>
              </div>
              <div>
                <div className="text-[var(--color-accent)] font-semibold">Business PRO</div>
                <div className="font-bold text-[var(--color-ink)] flex items-center justify-center gap-1">
                  <span>{PRICING_CONFIG.businessPro.monthlyAiScans}</span>
                  <Users className="w-3 h-3 text-[var(--color-muted)]" />
                  <span>5</span>
                </div>
                <div className="text-[10px] text-[var(--color-muted)] mt-0.5">
                  {isRTL ? 'شركات + 5 مقاعد' : 'Orgs + 5 seats'}
                </div>
              </div>
            </div>
          )}

          {/* Cloud Backup & Feature List (hidden cleanly on highest Business Lifetime permanent plan) */}
          {!isHighestTierPermanent && (
            <>
              <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-[11px] text-[var(--color-muted)] leading-relaxed flex items-start gap-2">
                <Cloud className="w-4 h-4 text-[var(--color-accent)] shrink-0 mt-0.5" />
                <span>
                  {isRTL ? (
                    <>
                      عند ربط بريدك الإلكتروني في <bdi dir="ltr">Google</bdi>، يتم حفظ اشتراك <bdi dir="ltr">PRO</bdi> وبياناتك سحابياً لاستعادتها فوراً على أي هاتف جديد.
                    </>
                  ) : (
                    'Link your Google account to automatically preserve your PRO access and financial backups across devices.'
                  )}
                </span>
              </div>

              <div className="space-y-2 pt-1 border-t border-[var(--color-line)]">
                <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">
                  {tierTab === 'business_pro'
                    ? isRTL
                      ? 'مزايا باقة الأعمال والمؤسسات'
                      : 'Enterprise Capabilities'
                    : isRTL
                    ? 'مزايا باقة الأفراد PRO'
                    : 'Personal PRO Benefits'}
                </h3>
                <ul className="space-y-2 text-xs text-[var(--color-ink)]">
                  {activeFeatures.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)] flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Activation Code Toggle & Collapsible Form (Hidden by default) */}
              <div className="space-y-2.5">
                <button
                  type="button"
                  data-testid="toggle-coupon-box-btn"
                  aria-expanded={isCouponBoxOpen}
                  onClick={() => {
                    setIsCouponBoxOpen((prev) => !prev);
                    setCodeError(null);
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-xs font-semibold text-[var(--color-ink)] flex items-center justify-between gap-2 transition-colors min-h-[44px]"
                >
                  <span className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                    <span>{isRTL ? 'هل لديك كود تفعيل؟' : 'Have an activation code?'}</span>
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-[var(--color-muted)] transition-transform ${
                      isCouponBoxOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {(isCouponBoxOpen || codeSuccess || codeError) && (
                  <form
                    onSubmit={handleRedeemCode}
                    data-testid="upgrade-coupon-form"
                    className={`p-3 rounded-xl border space-y-2.5 animate-in fade-in duration-150 ${
                      !user?.isLoggedIn
                        ? 'bg-amber-500/5 border-amber-500/30'
                        : 'bg-[var(--color-bg)] border-[var(--color-line)]'
                    }`}
                  >
                    {!user?.isLoggedIn && (
                      <div
                        data-testid="upgrade-guest-code-lock"
                        className="p-2.5 rounded-lg bg-amber-500/12 border border-amber-500/30 text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2 font-medium"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Lock className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {isRTL
                              ? 'يجب تسجيل الدخول بحساب جوجل أولاً لربط الاشتراك وسحابياً.'
                              : 'Please sign in with Google first to link your subscription to the cloud.'}
                          </span>
                        </div>
                        <button
                          type="button"
                          data-testid="upgrade-code-google-required-btn"
                          disabled={isSigningInGoogle}
                          onClick={() => void handleGoogleSignInInline()}
                          className="text-[11px] font-bold text-[var(--color-accent)] hover:underline shrink-0"
                        >
                          {isRTL ? 'دخول بجوجل' : 'Google Login'}
                        </button>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <input
                        id="upgrade-coupon-code-input"
                        type="text"
                        value={activationCode}
                        onChange={(e) => {
                          setActivationCode(e.target.value);
                          setCodeError(null);
                        }}
                        placeholder="RSD-BIZ-XXXX-XXXX / RSD-PRO-XXXX-XXXX"
                        dir="ltr"
                        disabled={isRedeeming}
                        data-testid="upgrade-license-code-input"
                        className="flex-1 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs font-mono text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px] disabled:opacity-60"
                      />
                      <button
                        type="submit"
                        disabled={isRedeeming || !activationCode.trim()}
                        data-testid="upgrade-activate-code-btn"
                        className="px-3.5 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold hover:opacity-95 transition-opacity min-h-[44px] disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                      >
                        {isRedeeming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{isRTL ? 'تفعيل' : 'Activate'}</span>
                      </button>
                    </div>
                    {codeError && (
                      <p data-testid="upgrade-code-error" className="text-[11px] text-[var(--color-expense)] font-medium">
                        {codeError}
                      </p>
                    )}
                    {codeSuccess && (
                      <div
                        data-testid="upgrade-code-success"
                        className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in duration-150"
                      >
                        <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>{codeSuccess}</span>
                      </div>
                    )}
                  </form>
                )}

                {/* Plan-Switch Forfeiture Confirmation Dialog */}
                {pendingSwitchConfirmation && (
                  <div
                    data-testid="plan-switch-warning-modal"
                    className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/50 space-y-3 animate-in fade-in duration-150"
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1 text-xs">
                        <h4 className="font-bold text-amber-900 dark:text-amber-200">
                          {isRTL ? 'تنبيه: ستفقد المدة المتبقية عند تغيير الباقة' : 'Warning: Remaining Plan Time Will Be Replaced'}
                        </h4>
                        <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                          {pendingSwitchConfirmation.replacedIsLifetime
                            ? isRTL
                              ? 'أنت مشترك حالياً في باقة دائمة. عند التحويل لباقة أخرى سيتم استبدال باقتك السابقة بالباقة الجديدة.'
                              : 'You currently have a lifetime plan. Switching tiers replaces your previous plan with the new one.'
                            : isRTL
                            ? `لا يزال متبقياً في باقتك الحالية (${pendingSwitchConfirmation.replacedDaysRemaining ?? 0} يوم). عند التحويل إلى باقة أخرى، ستفقد المدة المتبقية من الباقة القديمة ويبدأ احتساب الباقة الجديدة من اليوم.`
                            : `You still have ${pendingSwitchConfirmation.replacedDaysRemaining ?? 0} day(s) remaining on your current plan. Switching to another tier forfeits those remaining days and starts the new plan today.`}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isRedeeming}
                        data-testid="confirm-plan-switch-btn"
                        onClick={() => void executeRedeemCode(pendingSwitchConfirmation.code)}
                        className="flex-1 py-2 px-3 rounded-lg bg-amber-600 text-white text-xs font-bold min-h-[38px] flex items-center justify-center gap-1.5 disabled:opacity-60"
                      >
                        {isRedeeming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{isRTL ? 'تأكيد التحويل والتفعيل' : 'Confirm Switch & Activate'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isRedeeming}
                        data-testid="cancel-plan-switch-btn"
                        onClick={() => setPendingSwitchConfirmation(null)}
                        className="py-2 px-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] text-xs font-semibold min-h-[38px]"
                      >
                        {isRTL ? 'إلغاء' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Follow Us on Social Media */}
          <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2" data-testid="upgrade-follow-us">
            <div className="text-[11px] font-semibold text-[var(--color-muted)]">
              {t('followUs')}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={SUPPORT_CONFIG.defaultFacebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="upgrade-social-facebook"
                className="group px-2.5 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[#1877F2]/60 flex items-center justify-between gap-2 text-xs text-[var(--color-ink)] transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden="true"
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-[#1877F2]/12 text-[#1877F2]"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                      <path d="M13.5 22v-8h2.7l.4-3h-3.1V9.1c0-.9.3-1.5 1.6-1.5h1.7V4.9c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1V11H7.7v3h2.7v8h3.1z" />
                    </svg>
                  </span>
                  <span className="font-semibold truncate">{t('facebookPage')}</span>
                </div>
                <ExternalLink className="w-3 h-3 text-[var(--color-muted)] group-hover:text-[#1877F2] shrink-0" />
              </a>

              <a
                href={SUPPORT_CONFIG.defaultInstagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="upgrade-social-instagram"
                className="group px-2.5 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[#E1306C]/60 flex items-center justify-between gap-2 text-xs text-[var(--color-ink)] transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden="true"
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-[#E1306C]/12 text-[#E1306C]"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                    </svg>
                  </span>
                  <span className="font-semibold truncate">{t('instagramPage')}</span>
                </div>
                <ExternalLink className="w-3 h-3 text-[var(--color-muted)] group-hover:text-[#E1306C] shrink-0" />
              </a>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-[var(--color-line)] bg-[var(--color-bg)] space-y-2.5 shrink-0">
          {!isHighestTierPermanent && (
            isDev ? (
              <button
                type="button"
                onClick={handleDevActivate}
                className="w-full py-2.5 px-4 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium text-sm rounded-xl hover:opacity-95 transition-opacity flex items-center justify-center gap-2 shadow-sm min-h-[44px]"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {tierTab === 'business_pro'
                    ? isRTL
                      ? `معاينة Business PRO (${selectedPriceDisplay})`
                      : `Preview Business PRO (${selectedPriceDisplay})`
                    : isRTL
                    ? `معاينة Personal PRO (${selectedPriceDisplay})`
                    : `Preview Personal PRO (${selectedPriceDisplay})`}
                </span>
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={SUPPORT_CONFIG.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold text-xs rounded-xl hover:opacity-95 transition-opacity flex items-center justify-center gap-1.5 min-h-[44px]"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" />
                  <span>{isRTL ? 'طلب كود عبر واتساب' : 'Get Code via WhatsApp'}</span>
                </a>
                <a
                  href={`mailto:${SUPPORT_CONFIG.email}?subject=${encodeURIComponent(
                    tierTab === 'business_pro' ? 'طلب باقة رصيدي للأعمال' : 'طلب اشتراك رصيدي PRO'
                  )}`}
                  className="py-2.5 px-3 bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] font-semibold text-xs rounded-xl hover:border-[var(--color-accent)] transition-colors flex items-center justify-center gap-1.5 min-h-[44px]"
                >
                  <Mail className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <span>{isRTL ? 'طلب عبر البريد' : 'Order via Email'}</span>
                </a>
              </div>
            )
          )}

          <div className="flex items-center justify-between text-xs text-[var(--color-muted)] px-1">
            <button
              type="button"
              onClick={handleRestore}
              disabled={isRestoring}
              className="hover:text-[var(--color-ink)] transition-colors flex items-center gap-1 min-h-[44px] disabled:opacity-50"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isRestoring ? 'animate-spin' : ''}`} />
              <span>{isRTL ? 'استعادة اشتراك السحابة' : 'Restore Cloud PRO'}</span>
            </button>
            <span className="flex items-center gap-1 text-[11px]">
              <Shield className="w-3 h-3 text-[var(--color-accent)]" />
              <span>{isRTL ? 'ربط دائم عبر جوجل' : 'Synced via Google'}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
