import React, { useState, useMemo } from 'react';
import {
  PieChart as BudgetIcon,
  Plus,
  AlertTriangle,
  Edit2,
  Trash2,
  X,
  Crown,
  Lock,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Budget } from '../../types';
import {
  formatCurrencyAmount,
  calculateBudgetProgress,
  getActiveFiscalMonthStr,
  getCustomMonthDateRange,
} from '../../services/calculations';
import { normalizeArabicPersianNumerals, parseLocalizedNumber } from '../../services/numbers';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { MoneyText } from '../common/MoneyText';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { HairlineEmptyState, HairlineFigure } from '../common/HairlineVisuals';
import { shouldShowPersonalUpgradeUi } from '../../services/subscriptionHelpers';

export const BudgetPage: React.FC = () => {
  const {
    budgets,
    categories,
    wallets,
    transactions,
    settings,
    addBudget,
    updateBudget,
    deleteBudget,
    isPro,
    subscriptionSummary,
    setIsUpgradeModalOpen,
    t,
    isRTL,
  } = useApp();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useModalBackHandler(isModalOpen, () => setIsModalOpen(false), 'budget-edit');
  useModalBackHandler(confirmDeleteId !== null, () => setConfirmDeleteId(null), 'budget-confirm-delete');

  // Form State
  const [budgetName, setBudgetName] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetMonth, setBudgetMonth] = useState('');
  const [budgetCategoryId, setBudgetCategoryId] = useState('');
  const [budgetWalletId, setBudgetWalletId] = useState('');
  const [rollover, setRollover] = useState(false);

  const currentMonthStr = useMemo(() => {
    return getActiveFiscalMonthStr(new Date(), settings.firstDayOfMonth || 1);
  }, [settings.firstDayOfMonth]);

  const openCreateModal = (b?: Budget) => {
    if (!b && !isPro && budgets.length >= 1) {
      setIsUpgradeModalOpen(true);
      return;
    }

    if (b) {
      setEditingBudget(b);
      setBudgetName(b.name);
      setBudgetAmount(String(b.amount));
      setBudgetMonth(b.month);
      setBudgetCategoryId(b.categoryId || '');
      setBudgetWalletId(b.walletId || '');
      setRollover(b.rollover);
    } else {
      setEditingBudget(null);
      setBudgetName('');
      setBudgetAmount('');
      setBudgetMonth(currentMonthStr);
      setBudgetCategoryId('');
      setBudgetWalletId('');
      setRollover(false);
    }
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseLocalizedNumber(budgetAmount);
    if (!budgetName.trim() || isNaN(amountNum) || amountNum <= 0) return;

    if (budgetCategoryId && !isPro) {
      setIsUpgradeModalOpen(true);
      return;
    }

    const payload = {
      name: budgetName.trim(),
      amount: amountNum,
      month: budgetMonth || currentMonthStr,
      categoryId: budgetCategoryId || undefined,
      walletId: budgetWalletId || undefined,
      rollover,
    };

    if (editingBudget) {
      updateBudget(editingBudget.id, payload);
    } else {
      addBudget(payload);
    }

    setIsModalOpen(false);
  };

  // Calculate status for each budget (respecting custom fiscal month start & dynamic rollover)
  const budgetStatuses = useMemo(() => {
    const firstDay = settings.firstDayOfMonth || 1;
    return budgets.map((b) => {
      const progress = calculateBudgetProgress(
        b,
        transactions,
        settings.mainCurrency,
        settings.customExchangeRates,
        {
          firstDayOfMonth: firstDay,
          allBudgets: budgets,
        }
      );
      const dateRange = getCustomMonthDateRange(b.month, firstDay);
      const cat = categories.find((c) => c.id === b.categoryId);
      const wallet = wallets.find((w) => w.id === b.walletId);
      return {
        budget: b,
        category: cat,
        wallet,
        dateRange,
        ...progress,
      };
    });
  }, [
    budgets,
    transactions,
    categories,
    wallets,
    settings.mainCurrency,
    settings.customExchangeRates,
    settings.ratesUpdatedAtMs,
    settings.firstDayOfMonth,
  ]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-3 pb-24 space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <HairlineFigure
            figure="terrain"
            surface="surface"
            tone="accent"
            intensity={0.75}
            stroke={1.0}
            label={t('budgetTitle')}
            className="w-12 sm:w-14 shrink-0"
          />
          <div className="min-w-0">
            <h2 className="font-title text-base font-bold text-[var(--color-ink)] leading-tight">
              {t('budgetTitle')}
            </h2>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              {isRTL ? 'تتبع حدود الصرف وضبط الميزانيات' : 'Track spending limits & monthly budgets'}
            </p>
          </div>
        </div>

        <button
          onClick={() => openCreateModal()}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 transition-opacity min-h-[44px] shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{t('addBudget')}</span>
          {shouldShowPersonalUpgradeUi(subscriptionSummary) && budgets.length >= 1 && (
            <Crown className="w-3.5 h-3.5 ms-0.5" />
          )}
        </button>
      </div>

      {/* Free Limit Warning Banner */}
      {shouldShowPersonalUpgradeUi(subscriptionSummary) && budgets.length >= 1 && (
        <div className="p-2.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>
            {isRTL ? (
              <>المجاني: ميزانية واحدة شاملة • ميزانيات التصنيفات لـ <bdi dir="ltr">PRO</bdi></>
            ) : (
              'Free: 1 overall budget • Per-category for PRO'
            )}
          </span>
          <button
            onClick={() => setIsUpgradeModalOpen(true)}
            className="text-[var(--color-accent)] font-semibold hover:underline flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            <span>{isRTL ? 'ترقية' : 'Upgrade'}</span>
          </button>
        </div>
      )}

      {/* Budgets List */}
      {budgetStatuses.length === 0 ? (
        <div className="my-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
          <HairlineEmptyState
            figure="plot"
            surface="surface"
            title={t('noBudgetsTitle')}
            description={t('noBudgetsDesc')}
            action={
              <button
                onClick={() => openCreateModal()}
                className="flex items-center gap-1.5 px-4 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 min-h-[44px]"
              >
                <Plus className="w-4 h-4" />
                <span>{t('addBudget')}</span>
              </button>
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {budgetStatuses.map((item) => (
            <div
              key={item.budget.id}
              className={`p-4 rounded-xl border transition-all ${
                item.isExceeded
                  ? 'bg-[var(--color-expense)]/10 border-[var(--color-expense)]/30'
                  : item.isWarning
                  ? 'bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30'
                  : 'bg-[var(--color-surface)] border border-[var(--color-line)]'
              }`}
            >
              {/* Top Row: Name + Badges + Edit/Delete */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      item.isExceeded
                        ? 'bg-[var(--color-expense)] text-white'
                        : item.isWarning
                        ? 'bg-[var(--color-warning)] text-[#1C1A17]'
                        : 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                    }`}
                  >
                    {item.isExceeded ? (
                      <AlertTriangle className="w-4 h-4" />
                    ) : (
                      <BudgetIcon className="w-4 h-4" />
                    )}
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-[var(--color-ink)]">{item.budget.name}</h3>
                    <div className="flex items-center flex-wrap gap-1.5 text-[10px] text-[var(--color-muted)] mt-0.5">
                      <span>{item.budget.month}</span>
                      {(settings.firstDayOfMonth || 1) > 1 && (
                        <span>({item.dateRange.startDate} → {item.dateRange.endDate})</span>
                      )}
                      {item.category && (
                        <>
                          <span>•</span>
                          <span>{isRTL ? item.category.nameAr : item.category.nameEn}</span>
                        </>
                      )}
                      {item.wallet && (
                        <>
                          <span>•</span>
                          <span>{item.wallet.name}</span>
                        </>
                      )}
                      {item.budget.rollover && (
                        <>
                          <span>•</span>
                          <span className="text-[var(--color-accent)]">
                            {item.effectiveRolloverAmount !== 0
                              ? `${isRTL ? 'مرحل:' : 'Rollover:'} ${item.effectiveRolloverAmount > 0 ? '+' : ''}${formatCurrencyAmount(item.effectiveRolloverAmount, settings.mainCurrency, { decimalPlaces: settings.decimalPlaces, digitFormat: settings.digitFormat, language: settings.language })}`
                              : isRTL ? 'ترحيل نشط' : 'Rollover'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openCreateModal(item.budget)}
                    className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center"
                    title={t('edit')}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(item.budget.id)}
                    className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-expense)] rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center"
                    title={t('delete')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1.5">
                <div className="w-full h-2 rounded-full bg-[var(--color-line)]/60 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      item.isExceeded
                        ? 'bg-[var(--color-expense)]'
                        : item.isWarning
                        ? 'bg-[var(--color-warning)]'
                        : 'bg-[var(--color-income)]'
                    }`}
                    style={{ width: `${Math.min(100, item.percentage)}%` }}
                  />
                </div>

                {/* Amounts & Percentage */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1 text-[var(--color-muted)]">
                    <span>{isRTL ? 'صُرف:' : 'Spent:'}</span>
                    <MoneyText
                      amount={item.spent}
                      currency={settings.mainCurrency}
                      className="font-bold text-[var(--color-ink)] text-xs"
                    />
                    <span>/</span>
                    <MoneyText
                      amount={item.budget.amount + item.effectiveRolloverAmount}
                      currency={settings.mainCurrency}
                      className="text-xs text-[var(--color-muted)]"
                    />
                  </div>

                  <span
                    className={`font-bold ${
                      item.isExceeded
                        ? 'text-[var(--color-expense)]'
                        : item.isWarning
                        ? 'text-[var(--color-warning-text)]'
                        : 'text-[var(--color-income)]'
                    }`}
                  >
                    {item.percentage}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Budget Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-4">
              <h3 className="font-title text-sm font-bold">
                {editingBudget ? t('editBudget') : t('addBudget')}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {t('budgetName')}
                </label>
                <input
                  type="text"
                  required
                  value={budgetName}
                  onChange={(e) => setBudgetName(e.target.value)}
                  placeholder="مثال: ميزانية المعيشة الشهرية..."
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {t('budgetAmount')}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    required
                    value={budgetAmount}
                    onChange={(e) => setBudgetAmount(normalizeArabicPersianNumerals(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] num-tabular min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {isRTL ? 'الشهر' : 'Month'}
                  </label>
                  <input
                    type="month"
                    required
                    value={budgetMonth}
                    onChange={(e) => setBudgetMonth(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>
              </div>

              {/* Category (Pro Feature) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[var(--color-ink)]">
                    {t('category')} ({isRTL ? 'اختياري' : 'Optional'})
                  </label>
                  {!isPro && (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-[var(--color-accent)]/15 text-[var(--color-accent)] flex items-center gap-0.5">
                      <Crown className="w-2.5 h-2.5" />
                      <bdi dir="ltr">PRO</bdi>
                    </span>
                  )}
                </div>
                <select
                  value={budgetCategoryId}
                  onChange={(e) => {
                    if (e.target.value && !isPro) {
                      setIsUpgradeModalOpen(true);
                    } else {
                      setBudgetCategoryId(e.target.value);
                    }
                  }}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                >
                  <option value="">{isRTL ? 'عام (كل التصنيفات)' : 'Overall (All categories)'}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {isRTL ? c.nameAr : c.nameEn} {!isPro ? '🔒 PRO' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Rollover Toggle */}
              <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
                <div>
                  <span className="block text-xs font-semibold text-[var(--color-ink)]">
                    {t('rolloverRemaining')}
                  </span>
                  <span className="text-[10px] text-[var(--color-muted)]">
                    {isRTL ? 'ترحيل الفائض أو العجز للشهر التالي' : 'Roll surplus/deficit to next month'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={rollover}
                  onChange={(e) => setRollover(e.target.checked)}
                  className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer min-h-[20px] min-w-[20px]"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 transition-opacity min-h-[44px]"
                >
                  {t('save')}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] rounded-xl text-xs min-h-[44px]"
                >
                  {t('cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmationModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) deleteBudget(confirmDeleteId);
        }}
        title={t('delete')}
        message={isRTL ? 'هل تريد حذف هذه الميزانية؟' : 'Are you sure you want to delete this budget?'}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
};
