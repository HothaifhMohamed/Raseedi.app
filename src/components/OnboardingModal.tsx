import React, { useEffect, useState } from 'react';
import { AlertCircle, AtSign, Building2, ChevronDown, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getCurrency } from '../services/currency';
import { normalizeArabicPersianNumerals, parseLocalizedNumber } from '../services/numbers';
import { normalizeUsername, validateUsernameFormat } from '../services/usernameService';
import { CurrencyPickerModal } from './common/CurrencyPickerModal';
import { BrandLogo } from './common/BrandLogo';

export const OnboardingModal: React.FC = () => {
  const {
    hasCompletedOnboarding,
    completeOnboarding,
    createOrganization,
    loadDemoData,
    updateUsername,
    user,
    categories,
    settings,
    t,
    isRTL,
  } = useApp();

  const [step, setStep] = useState(1);
  const [isFinishing, setIsFinishing] = useState(false);
  const [accountMode, setAccountMode] = useState<'personal' | 'organization'>('personal');
  const [selectedCurrency, setSelectedCurrency] = useState(settings.mainCurrency || 'EGP');
  const [currencyModalOpen, setCurrencyModalOpen] = useState(false);
  const [usernameInput, setUsernameInput] = useState(user?.username || '');
  const [usernameError, setUsernameError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.username && !usernameInput) {
      setUsernameInput(user.username);
    }
  }, [user?.username]);

  // Step 2: First Wallet (Personal) or Org Details (Organization)
  const [walletName, setWalletName] = useState(isRTL ? 'الخزينة الرئيسية' : 'Cash');
  const [initialBalance, setInitialBalance] = useState('0');

  const [orgName, setOrgName] = useState(isRTL ? 'شركتي الناشئة' : 'My Business');
  const [orgVatRate, setOrgVatRate] = useState('14');
  const [orgLoadSample, setOrgLoadSample] = useState(false);

  // Step 3: Selected Starter Categories
  const [selectedCatIds, setSelectedCatIds] = useState<string[]>(
    categories.slice(0, 8).map((c) => c.id)
  );

  // Automated test convenience: ?autostart=1 skips onboarding cleanly with demo seed
  useEffect(() => {
    if (hasCompletedOnboarding || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      loadDemoData();
    }
  }, [hasCompletedOnboarding, loadDemoData]);

  const toggleCat = (id: string) => {
    setSelectedCatIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const curr = getCurrency(selectedCurrency);

  const handleFinish = async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    setUsernameError(null);
    try {
      const normalizedHandle = normalizeUsername(usernameInput);
      if (user?.isLoggedIn && normalizedHandle && normalizedHandle !== user.username) {
        const formatCheck = validateUsernameFormat(normalizedHandle);
        if (!formatCheck.valid) {
          setUsernameError(isRTL ? formatCheck.errorAr || '' : formatCheck.errorEn || '');
          setStep(1);
          return;
        }
        const claimRes = await updateUsername(normalizedHandle);
        if (!claimRes.ok) {
          setUsernameError(
            claimRes.error ||
              (isRTL ? 'تعذر حفظ اسم المستخدم. جرّب اسماً آخر.' : 'Could not save username.')
          );
          setStep(1);
          return;
        }
      }

      if (accountMode === 'organization') {
        completeOnboarding(
          selectedCurrency,
          isRTL ? 'الخزينة الرئيسية' : 'Cash',
          0
        );
        await createOrganization({
          name: orgName.trim() || (isRTL ? 'مؤسستي' : 'My Organization'),
          currency: selectedCurrency,
          vatRate: parseLocalizedNumber(orgVatRate) >= 0 ? parseLocalizedNumber(orgVatRate) : 14,
          loadSampleData: orgLoadSample,
        });
        return;
      }
      const parsedBal = parseLocalizedNumber(initialBalance);
      completeOnboarding(selectedCurrency, walletName, Number.isFinite(parsedBal) ? parsedBal : 0);
    } finally {
      setIsFinishing(false);
    }
  };

  if (hasCompletedOnboarding) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)] p-4">
      <div
        className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-6 text-[var(--color-ink)] shadow-xl flex flex-col justify-between min-h-[520px]"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Top Indicator */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <BrandLogo className="w-10 h-10 rounded-xl object-cover shadow-sm shrink-0" title={t('appName')} />
              <span className="font-bold text-sm text-[var(--color-ink)]">{t('appName')}</span>
            </div>

            <span className="text-[11px] font-semibold text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-2 py-0.5 rounded-md border border-[var(--color-accent)]/20">
              {isRTL ? `خطوة ${step} من 3` : `Step ${step} of 3`}
            </span>
          </div>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mb-5">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step
                    ? 'w-8 bg-[var(--color-accent)]'
                    : s < step
                    ? 'w-4 bg-[var(--color-accent)]/50'
                    : 'w-4 bg-[var(--color-line)]'
                }`}
              />
            ))}
          </div>

          {/* STEP 1: Workspace Mode & Main Currency */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in">
              <div>
                <h2 className="text-base font-bold text-[var(--color-ink)] mb-1">
                  {isRTL ? 'اختر نوع الحساب والعملة' : 'Choose Mode & Currency'}
                </h2>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {isRTL
                    ? 'يمكنك استخدام رصيدي لإدارة مصاريفك الشخصية أو حسابات شركتك مع إمكانية التبديل لاحقاً.'
                    : 'Start with a Personal ledger or an Enterprise business workspace — you can switch anytime.'}
                </p>
              </div>

              {/* Workspace Type Cards */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAccountMode('personal')}
                  className={`p-3 rounded-xl border text-start transition-all min-h-[74px] flex flex-col justify-between ${
                    accountMode === 'personal'
                      ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-ink)]'
                      : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)]'
                  }`}
                >
                  <User
                    className={`w-4 h-4 ${
                      accountMode === 'personal' ? 'text-[var(--color-accent)]' : ''
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold text-[var(--color-ink)]">
                      {t('personalWorkspace')}
                    </div>
                    <div className="text-[10px] text-[var(--color-muted)]">
                      {isRTL ? 'أفراد وميزانية يومية' : 'Personal & daily budget'}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setAccountMode('organization')}
                  className={`p-3 rounded-xl border text-start transition-all min-h-[74px] flex flex-col justify-between ${
                    accountMode === 'organization'
                      ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-ink)]'
                      : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)]'
                  }`}
                >
                  <Building2
                    className={`w-4 h-4 ${
                      accountMode === 'organization' ? 'text-[var(--color-accent)]' : ''
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold text-[var(--color-ink)]">
                      {t('orgWorkspace')}
                    </div>
                    <div className="text-[10px] text-[var(--color-muted)]">
                      {isRTL ? 'اعتمادات وضرائب وفرق' : 'VAT, approvals & teams'}
                    </div>
                  </div>
                </button>
              </div>

              {/* Currency Picker Card */}
              <button
                type="button"
                onClick={() => setCurrencyModalOpen(true)}
                className="w-full p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] flex items-center justify-between transition-colors min-h-[52px]"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none">{curr.flag}</span>
                  <div className="text-start">
                    <div className="text-xs font-semibold text-[var(--color-ink)]">
                      {isRTL ? curr.nameAr : curr.nameEn}
                    </div>
                    <div className="text-[11px] text-[var(--color-accent)] font-mono mt-0.5">
                      {curr.code} ({curr.symbol})
                    </div>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" />
              </button>

              <div>
                <span className="text-[11px] text-[var(--color-muted)] block mb-1.5">
                  {isRTL ? 'عملات شائعة:' : 'Common currencies:'}
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {['EGP', 'SAR', 'AED', 'USD', 'KWD', 'EUR'].map((code) => {
                    const c = getCurrency(code);
                    const isSelected = selectedCurrency === code;
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setSelectedCurrency(code)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors min-h-[36px] border ${
                          isSelected
                            ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                            : 'bg-[var(--color-bg)] text-[var(--color-ink)] border-[var(--color-line)] hover:border-[var(--color-muted)]'
                        }`}
                      >
                        <span>{c.flag}</span>
                        <span>{c.code}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {user?.isLoggedIn && (
                <div className="pt-2 border-t border-[var(--color-line)] space-y-1.5">
                  <label className="block text-[11px] font-semibold text-[var(--color-ink)]">
                    {isRTL ? 'اسم المستخدم الفريد (اختياري)' : 'Unique Username (Optional)'}
                  </label>
                  <div className="relative">
                    <AtSign className="w-3.5 h-3.5 text-[var(--color-muted)] absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                    <input
                      type="text"
                      dir="ltr"
                      data-testid="onboarding-username-input"
                      value={usernameInput}
                      onChange={(e) => {
                        setUsernameInput(e.target.value.replace(/^@+/, ''));
                        setUsernameError(null);
                      }}
                      placeholder="ahmed_acc"
                      className="w-full ps-8 pe-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs font-mono text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[40px]"
                    />
                  </div>
                  <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">
                    {isRTL
                      ? 'يتيح لمالكي المؤسسات إضافتك مباشرة للفريق عبر @username دون روابط دعوة.'
                      : 'Allows organization owners to add you directly by @username without invite codes.'}
                  </p>
                  {usernameError && (
                    <div className="text-[11px] text-[var(--color-expense)] flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{usernameError}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: First Wallet OR Organization Setup */}
          {step === 2 && accountMode === 'personal' && (
            <div className="space-y-4 animate-in fade-in">
              <div>
                <h2 className="text-base font-bold text-[var(--color-ink)] mb-1">
                  {t('step2Wallet')}
                </h2>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {isRTL
                    ? 'أنشئ أول محفظة أو حساب تبدأ به لإيداع وتتبع مصاريفك.'
                    : 'Create your first wallet or account to start recording transactions.'}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {t('walletName')}
                  </label>
                  <input
                    type="text"
                    required
                    value={walletName}
                    onChange={(e) => setWalletName(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {t('initialBalance')} ({curr.code})
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(normalizeArabicPersianNumerals(e.target.value))}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs font-semibold text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && accountMode === 'organization' && (
            <div className="space-y-4 animate-in fade-in">
              <div>
                <h2 className="text-base font-bold text-[var(--color-ink)] mb-1">
                  {t('createOrganization')}
                </h2>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {isRTL
                    ? 'إعداد بيانات الشركة الأساسية، نسبة الضريبة، ومراكز التكلفة المبدئية.'
                    : 'Configure your business name, default VAT rate, and starter ledger.'}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {t('orgName')}
                  </label>
                  <input
                    type="text"
                    required
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {t('vatRate')} (%)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={orgVatRate}
                    onChange={(e) => setOrgVatRate(normalizeArabicPersianNumerals(e.target.value))}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs font-semibold text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-[var(--color-ink)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={orgLoadSample}
                    onChange={(e) => setOrgLoadSample(e.target.checked)}
                    className="rounded border-[var(--color-line)] accent-[var(--color-accent)] w-4 h-4"
                  />
                  <span>
                    {isRTL
                      ? 'تجهيز مراكز تكلفة بميزانيات تقديرية مبدئية'
                      : 'Pre-populate cost centers with sample budgets'}
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* STEP 3: Categories Preview */}
          {step === 3 && (
            <div className="space-y-3 animate-in fade-in">
              <div>
                <h2 className="text-base font-bold text-[var(--color-ink)] mb-1">
                  {t('step3Categories')}
                </h2>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {accountMode === 'organization'
                    ? isRTL
                      ? 'تم تجهيز دليل بنود تجاري يشمل الرواتب، الإيجار، التشغيل، المبيعات، والضرائب.'
                      : 'Prepared enterprise categories for payroll, rent, operations, sales & taxes.'
                    : isRTL
                    ? 'قمنا بتجهيز تصنيفات أساسية تناسب حياتك اليومية. يمكنك تعديلها في أي وقت.'
                    : 'We prepared standard categories for your daily expenses. You can customize them anytime.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto p-1 no-scrollbar">
                {categories.slice(0, 10).map((cat) => {
                  const isSelected = selectedCatIds.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCat(cat.id)}
                      className={`p-2 rounded-lg border flex items-center gap-2 text-xs transition-colors text-start min-h-[40px] ${
                        isSelected
                          ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-ink)]'
                          : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)]'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="truncate font-medium">
                        {isRTL ? cat.nameAr : cat.nameEn}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation Buttons */}
        <div className="pt-4 border-t border-[var(--color-line)] space-y-2">
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="py-2.5 px-4 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] font-semibold rounded-lg text-xs transition-colors min-h-[44px]"
              >
                {isRTL ? 'السابق' : 'Back'}
              </button>
            )}

            {step < 3 ? (
              <button
                type="button"
                onClick={() => {
                  if (step === 1 && user?.isLoggedIn && usernameInput.trim()) {
                    const formatCheck = validateUsernameFormat(usernameInput);
                    if (!formatCheck.valid) {
                      setUsernameError(
                        isRTL ? formatCheck.errorAr || '' : formatCheck.errorEn || ''
                      );
                      return;
                    }
                  }
                  setUsernameError(null);
                  setStep(step + 1);
                }}
                className="flex-1 py-2.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs transition-opacity min-h-[44px]"
              >
                {isRTL ? 'التالي' : 'Next'}
              </button>
            ) : (
              <button
                type="button"
                disabled={isFinishing}
                onClick={handleFinish}
                className="flex-1 py-2.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-bold rounded-lg text-xs transition-opacity min-h-[44px] disabled:opacity-60"
              >
                {t('startUsingApp')}
              </button>
            )}
          </div>

          {/* Quick Demo Data Loader Button */}
          <button
            type="button"
            onClick={loadDemoData}
            className="w-full py-2 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors min-h-[36px]"
          >
            {isRTL ? 'أو' : 'or'} {t('loadDemoData')}
          </button>
        </div>
      </div>

      <CurrencyPickerModal
        isOpen={currencyModalOpen}
        onClose={() => setCurrencyModalOpen(false)}
        selectedCode={selectedCurrency}
        onSelect={(code) => setSelectedCurrency(code)}
      />
    </div>
  );
};
