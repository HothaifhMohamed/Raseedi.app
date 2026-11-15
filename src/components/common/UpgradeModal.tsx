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
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SUPPORT_CONFIG } from '../../constants/support';
import { formatPricingMoney, PRICING_CONFIG, PricingCurrency } from '../../config/pricing';

export const UpgradeModal: React.FC = () => {
  const {
    isUpgradeModalOpen,
    setIsUpgradeModalOpen,
    isPro,
    isBusinessPro,
    planTier,
    proEntitlement,
    user,
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
    settings,
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

  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [trialMessage, setTrialMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [isStartingTrial, setIsStartingTrial] = useState(false);

  const [activationCode, setActivationCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeSuccess, setCodeSuccess] = useState<string | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const isDev = import.meta.env.DEV;

  React.useEffect(() => {
    if (!isUpgradeModalOpen) return;
    if (isOrgWorkspace || isBusinessPro) {
      setTierTab('business_pro');
    }
    const defaultOrgId =
      (activeOrganization && eligibleOrgs.some((o) => o.orgId === activeOrganization.id)
        ? activeOrganization.id
        : eligibleOrgs[0]?.orgId) || '';
    setSelectedOrgId((prev) =>
      prev && eligibleOrgs.some((o) => o.orgId === prev) ? prev : defaultOrgId
    );
  }, [isUpgradeModalOpen, isOrgWorkspace, isBusinessPro, activeOrganization, eligibleOrgs]);

  if (!isUpgradeModalOpen) return null;

  const lang = isRTL ? 'ar' : 'en';
  const targetBusinessOrgId =
    tierTab === 'business_pro' && selectedOrgId ? selectedOrgId : undefined;

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

  const handleRedeemCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError(null);
    setCodeSuccess(null);

    const trimmed = activationCode.trim();
    if (!trimmed) return;

    setIsRedeeming(true);
    try {
      const result = await redeemProCode(trimmed, targetBusinessOrgId);
      if (!result.ok) {
        setCodeError(
          result.error ||
            (isRTL
              ? 'كود التفعيل غير صحيح أو مستخدم بالفعل.'
              : 'Activation code is invalid or already redeemed.')
        );
        return;
      }

      setActivationCode('');
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
        isRTL
          ? `تم تفعيل باقة ${tierLabel}${cycleLabel ? ` (${cycleLabel})` : ''} بنجاح!`
          : `${tierLabel}${cycleLabel ? ` (${cycleLabel})` : ''} activated successfully!`
      );
      window.setTimeout(() => setCodeSuccess(null), 4000);
    } finally {
      setIsRedeeming(false);
    }
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
                {tierTab === 'business_pro'
                  ? isRTL
                    ? 'رصيدي للأعمال والمؤسسات'
                    : 'Raseedi Business PRO'
                  : isRTL
                  ? 'رصيدي برو للأفراد'
                  : 'Raseedi Personal PRO'}
              </h2>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">
                {isRTL
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
          {/* Active Subscription Banner */}
          {isPro && (
            <div className="p-3 bg-[var(--color-income)]/10 border border-[var(--color-income)]/30 rounded-xl text-xs text-[var(--color-income)] font-medium flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>
                  {planTier === 'business_pro'
                    ? isRTL
                      ? 'اشتراك Business PRO مفعّل على حسابك'
                      : 'Business PRO is active on your account'
                    : isRTL
                    ? 'اشتراك Personal PRO مفعّل على حسابك'
                    : 'Personal PRO is active on your account'}
                </span>
              </div>
              {proEntitlement?.expiresAt && (
                <span className="text-[10px] font-mono shrink-0" dir="ltr">
                  {new Date(proEntitlement.expiresAt).toLocaleDateString()}
                </span>
              )}
            </div>
          )}

          {restoreStatus && (
            <div className="p-2.5 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 rounded-lg text-xs text-[var(--color-accent)] font-medium text-center">
              {restoreStatus}
            </div>
          )}

          {/* Tier Tabs + Currency Toggle */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex bg-[var(--color-bg)] p-1 rounded-xl border border-[var(--color-line)] flex-1 min-w-[230px]">
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

          {/* PERSONAL PRICING CARDS */}
          {tierTab === 'personal_pro' && (
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
          {tierTab === 'business_pro' && (
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

          {/* Tier Limits Comparison Strip */}
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

          {/* Cloud Backup Note */}
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

          {/* Feature List */}
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

          {/* Server-Verified Activation Code Redemption (always accessible for initial activation, renewals & extra seats) */}
          <form
            onSubmit={handleRedeemCode}
            className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
                <KeyRound className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                <span>
                  {isPro
                    ? isRTL
                      ? 'تجديد الاشتراك أو تفعيل كود جديد'
                      : 'Renew Subscription or Redeem New Code'
                    : isRTL
                    ? 'تفعيل بالكود الخاص بك'
                    : 'Activate with License Code'}
                </span>
              </div>
              {!user?.isLoggedIn && (
                <button
                  type="button"
                  onClick={() => void signInWithGoogleAccount()}
                  className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline shrink-0"
                >
                  {isRTL ? 'تسجيل دخول جوجل' : 'Sign in with Google'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={activationCode}
                onChange={(e) => {
                  setActivationCode(e.target.value);
                  setCodeError(null);
                }}
                placeholder="RSD-PRO-XXXX-XXXX"
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
              <p data-testid="upgrade-code-error" className="text-[11px] text-[var(--color-expense)] font-medium">{codeError}</p>
            )}
            {codeSuccess && (
              <p data-testid="upgrade-code-success" className="text-[11px] text-[var(--color-income)] font-medium">{codeSuccess}</p>
            )}
          </form>

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
          {isDev ? (
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
