import React, { useEffect, useState } from 'react';
import { Building2, ChevronDown, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getCurrency } from '../services/currency';
import { CurrencyPickerModal } from './common/CurrencyPickerModal';

export const OnboardingModal: React.FC = () => {
  const {
    hasCompletedOnboarding,
    completeOnboarding,
    createOrganization,
    loadDemoData,
    categories,
    updateSettings,
    settings,
    t,
    isRTL,
  } = useApp();

  const [step, setStep] = useState(1);
  const [accountMode, setAccountMode] = useState<'personal' | 'organization'>('personal');
  const [selectedCurrency, setSelectedCurrency] = useState(settings.mainCurrency || 'EGP');
  const [currencyModalOpen, setCurrencyModalOpen] = useState(false);

  // Step 2: First Wallet (Personal) or Org Details (Organization)
  const [walletName, setWalletName] = useState(isRTL ? 'المحفظة النقدية (كاش)' : 'Cash Wallet');
  const [initialBalance, setInitialBalance] = useState('1000');

  const [orgName, setOrgName] = useState(isRTL ? 'شركتي الناشئة' : 'My Business');
  const [orgVatRate, setOrgVatRate] = useState('14');
  const [orgLoadSample, setOrgLoadSample] = useState(true);

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

  const handleFinish = () => {
    updateSettings({ mainCurrency: selectedCurrency });
    if (accountMode === 'organization') {
      completeOnboarding(
        selectedCurrency,
        isRTL ? 'المحفظة الشخصية' : 'Personal Cash',
        0
      );
      createOrganization({
        name: orgName.trim() || (isRTL ? 'مؤسستي' : 'My Organization'),
        currency: selectedCurrency,
        vatRate: Number(orgVatRate) >= 0 ? Number(orgVatRate) : 14,
        loadSampleData: orgLoadSample,
      });
      return;
    }
    completeOnboarding(selectedCurrency, walletName, parseFloat(initialBalance) || 0);
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
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] flex items-center justify-center font-bold text-sm">
                ر
              </div>
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
                    type="number"
                    step="any"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(e.target.value)}
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
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={orgVatRate}
                    onChange={(e) => setOrgVatRate(e.target.value)}
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
                      ? 'تجهيز خزينة وبنك ومراكز تكلفة مبدئية'
                      : 'Pre-populate treasury, bank & cost centers'}
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
                onClick={() => setStep(step + 1)}
                className="flex-1 py-2.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs transition-opacity min-h-[44px]"
              >
                {isRTL ? 'التالي' : 'Next'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                className="flex-1 py-2.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-bold rounded-lg text-xs transition-opacity min-h-[44px]"
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
