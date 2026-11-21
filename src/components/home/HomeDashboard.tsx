import React, { useMemo, useState } from 'react';
import {
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Zap,
  CalendarClock,
  AlertTriangle,
  BellRing,
  Save,
  X,
  Building2,
  ClipboardCheck,
  Wallet as WalletIcon,
  Plus,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  calculateTotalBalance,
  calculateIncomeExpenseNet,
  getTransactionsInDateRange,
  calculateSafeToSpend,
  getActiveBudgetAlerts,
  getUpcomingDebtReminders,
  getActiveFiscalMonthStr,
  getCustomMonthDateRange,
} from '../../services/calculations';
import {
  computeMonthlyCashflowProgress,
  getRecentTransactions,
} from '../../services/dashboardStats';
import { MoneyText } from '../common/MoneyText';
import { HairlineEmptyState } from '../common/HairlineVisuals';
import { DashboardSkeleton } from '../common/SkeletonLoaders';
import { indexById } from '../../services/lookupCache';

interface HomeDashboardProps {
  onOpenFullLedger: () => void;
  onOpenStatistics: () => void;
  onOpenTemplates: () => void;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  onOpenFullLedger,
  onOpenStatistics,
  onOpenTemplates,
}) => {
  const {
    isOrgWorkspace,
    isOrgLoading,
    activeOrganization,
    activeOrgRole,
    canOrgWrite,
    isOrgReadOnly,
    pendingApprovalsCount,
    openOrgHub,
    wallets,
    transactions,
    categories,
    debts,
    budgets,
    settings,
    updateSettings,
    setActiveNav,
    setIsBackupOpen,
    setEditingTransaction,
    setIsAddModalOpen,
    t,
    isRTL,
  } = useApp();

  const [hideBalance, setHideBalance] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState(false);

  const ArrowEnd = isRTL ? ChevronLeft : ChevronRight;

  // Total available balance across active non-excluded wallets
  const totalBalance = useMemo(() => {
    return calculateTotalBalance(wallets, settings.mainCurrency, settings.customExchangeRates, {
      excludeDebts: settings.excludeDebtsFromBalance,
      debts,
    });
  }, [
    wallets,
    settings.mainCurrency,
    settings.customExchangeRates,
    settings.ratesUpdatedAtMs,
    settings.excludeDebtsFromBalance,
    debts,
  ]);

  // Current fiscal month Income vs Expense metrics + progress bar data
  const currentMonthCashflow = useMemo(() => {
    const now = new Date();
    const activeMonthStr = getActiveFiscalMonthStr(now, settings.firstDayOfMonth || 1);
    const fiscalRange = getCustomMonthDateRange(activeMonthStr, settings.firstDayOfMonth || 1);
    const filtered = getTransactionsInDateRange(
      transactions,
      fiscalRange.startDate,
      fiscalRange.endDate
    );
    const stats = calculateIncomeExpenseNet(
      filtered,
      settings.mainCurrency,
      settings.customExchangeRates,
      settings.useRateAtTransactionTime
    );
    return computeMonthlyCashflowProgress(stats.income, stats.expense);
  }, [
    transactions,
    settings.firstDayOfMonth,
    settings.mainCurrency,
    settings.customExchangeRates,
    settings.ratesUpdatedAtMs,
    settings.useRateAtTransactionTime,
  ]);

  // Safe-to-spend daily allowance
  const safeToSpend = useMemo(() => {
    return calculateSafeToSpend(
      budgets,
      transactions,
      settings.mainCurrency,
      settings.customExchangeRates,
      new Date(),
      settings.firstDayOfMonth || 1
    );
  }, [
    budgets,
    transactions,
    settings.mainCurrency,
    settings.customExchangeRates,
    settings.ratesUpdatedAtMs,
    settings.firstDayOfMonth,
  ]);

  // Smart Alerts (Budget thresholds + Upcoming debts)
  const activeBudgetAlerts = useMemo(() => {
    if (!settings.notificationsEnabled || !(settings.budgetAlertsEnabled ?? true)) return [];
    return getActiveBudgetAlerts(
      budgets,
      transactions,
      settings.mainCurrency,
      settings.customExchangeRates,
      new Date(),
      settings.firstDayOfMonth || 1
    );
  }, [
    settings.notificationsEnabled,
    settings.budgetAlertsEnabled,
    budgets,
    transactions,
    settings.mainCurrency,
    settings.customExchangeRates,
    settings.ratesUpdatedAtMs,
    settings.firstDayOfMonth,
  ]);

  const upcomingDebtReminders = useMemo(() => {
    if (!settings.notificationsEnabled || !(settings.debtRemindersEnabled ?? true)) return [];
    return getUpcomingDebtReminders(debts, new Date());
  }, [settings.notificationsEnabled, settings.debtRemindersEnabled, debts]);

  // Backup nudge check
  const lastBackupActivityAt = Math.max(settings.lastBackupAt || 0, settings.lastCloudSyncAt || 0);
  const showBackupNudge = useMemo(() => {
    if (transactions.length === 0) return false;
    const now = Date.now();
    if (
      settings.backupReminderDismissedAt &&
      now - settings.backupReminderDismissedAt < FOURTEEN_DAYS_MS
    ) {
      return false;
    }
    if (!lastBackupActivityAt) return true;
    return now - lastBackupActivityAt > FOURTEEN_DAYS_MS;
  }, [transactions.length, lastBackupActivityAt, settings.backupReminderDismissedAt]);

  // Recent 6 transactions for bottom section
  const recentTransactions = useMemo(() => getRecentTransactions(transactions, 6), [transactions]);

  const activeWalletsCount = useMemo(
    () => wallets.filter((w) => !w.isArchived).length,
    [wallets]
  );

  const categoriesById = useMemo(() => indexById(categories), [categories]);
  const walletsById = useMemo(() => indexById(wallets), [wallets]);

  const canWriteTx = !isOrgWorkspace || (!isOrgReadOnly && canOrgWrite);

  if (isOrgWorkspace && isOrgLoading && transactions.length === 0 && wallets.length === 0) {
    return <DashboardSkeleton isRTL={isRTL} />;
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 space-y-4" dir={isRTL ? 'rtl' : 'ltr'} data-testid="home-smart-dashboard">
      {/* Contextual Backup Nudge */}
      {showBackupNudge && (
        <div className="p-3 rounded-2xl bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/35 flex items-center justify-between gap-2 text-xs transition-all duration-300">
          <div className="flex items-center gap-2 min-w-0">
            <Save className="w-4 h-4 text-[var(--color-gold-text)] shrink-0" />
            <span className="text-[var(--color-ink)] truncate font-medium">
              {lastBackupActivityAt
                ? isRTL
                  ? 'مر أكثر من 14 يوماً على آخر نسخة احتياطية'
                  : 'Over 14 days since your last backup'
                : isRTL
                ? 'احفظ نسخة احتياطية لبياناتك بأمان'
                : 'Back up your financial records safely'}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsBackupOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold text-[11px] min-h-[36px] active:scale-95 transition-all duration-300"
            >
              {isRTL ? 'نسخ الآن' : 'Backup'}
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ backupReminderDismissedAt: Date.now() })}
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-xl min-h-[36px] min-w-[36px] flex items-center justify-center"
              aria-label={isRTL ? 'إخفاء التذكير' : 'Dismiss reminder'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Enterprise Workspace Quick Hub Shortcut */}
      {isOrgWorkspace && activeOrganization && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => openOrgHub(pendingApprovalsCount > 0 ? 'approvals' : 'reports')}
            data-testid="home-open-org-hub-btn"
            className="w-full p-3.5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-accent)]/35 flex items-center justify-between gap-2 text-xs hover:border-[var(--color-accent)] transition-all duration-300 min-h-[48px]"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Building2 className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
              <span className="font-semibold text-[var(--color-ink)] truncate">
                {t('orgHubTitle')} — {activeOrganization.name}
              </span>
            </div>
            <span className="text-[11px] font-bold text-[var(--color-accent)] shrink-0 flex items-center gap-0.5">
              <span>{isRTL ? 'فتح المركز' : 'Open Hub'}</span>
              <ArrowEnd className="w-3.5 h-3.5" />
            </span>
          </button>

          {pendingApprovalsCount > 0 && (
            <button
              type="button"
              onClick={() => openOrgHub('approvals')}
              className="w-full p-3.5 rounded-2xl bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/35 flex items-center justify-between gap-2 text-xs hover:opacity-95 transition-all duration-300 min-h-[48px]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ClipboardCheck className="w-4 h-4 text-[var(--color-gold-text)] shrink-0" />
                <span className="font-semibold text-[var(--color-ink)] truncate">
                  {isRTL
                    ? pendingApprovalsCount === 1
                      ? 'معاملة واحدة بانتظار المراجعة والاعتماد'
                      : `${pendingApprovalsCount} معاملات بانتظار المراجعة والاعتماد`
                    : pendingApprovalsCount === 1
                    ? '1 transaction awaiting approval'
                    : `${pendingApprovalsCount} transactions awaiting approval`}
                </span>
              </div>
              <span className="text-[11px] font-bold text-[var(--color-gold-text)] shrink-0">
                {isRTL ? 'مراجعة' : 'Review'}
              </span>
            </button>
          )}
        </div>
      )}

      {/* TOP SECTION: Major Financial Summary Hero Card */}
      {settings.showCurrentBalance && (
        <section
          data-testid="smart-dashboard-hero"
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--color-hero-from)] via-[var(--color-hero-via)] to-[var(--color-hero-to)] text-[#FFFDF8] p-5 sm:p-6 shadow-[0_16px_36px_-12px_rgba(10,75,71,0.42)] border border-[var(--color-gold)]/30 transition-all duration-300"
        >
          {/* Subtle Gold Ambient Glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 -end-16 w-48 h-48 rounded-full bg-[var(--color-gold)]/20 blur-2xl"
          />

          <div className="relative space-y-5">
            {/* Hero Header Row */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <span className="text-xs font-medium text-[#E5DEC9] block">
                  {isOrgWorkspace && activeOrganization
                    ? `${isRTL ? 'إجمالي الرصيد المتاح' : 'Total Available Balance'} · ${activeOrganization.name}`
                    : isRTL
                    ? 'إجمالي الرصيد المتاح'
                    : 'Total Available Balance'}
                </span>

                <div className="flex items-baseline gap-2 pt-0.5">
                  {hideBalance ? (
                    <span className="text-3xl sm:text-4xl font-bold tracking-tight text-white num-tabular">
                      ••••••••
                    </span>
                  ) : (
                    <MoneyText
                      amount={totalBalance}
                      currency={settings.mainCurrency}
                      className="text-3xl sm:text-4xl font-bold text-white tracking-tight"
                    />
                  )}
                </div>

                <div className="flex items-center gap-2 text-[11px] text-white/75 pt-0.5 flex-wrap">
                  <span className="inline-flex items-center gap-1">
                    <WalletIcon className="w-3.5 h-3.5 text-[#E2B954]" />
                    <span>
                      {activeWalletsCount} {t('navWallets')}
                    </span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => setActiveNav('wallets')}
                    className="text-[#E2B954] hover:underline font-semibold inline-flex items-center gap-0.5 min-h-[28px]"
                  >
                    <span>{isRTL ? 'إدارة المحافظ' : 'Manage Wallets'}</span>
                    <ArrowEnd className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setHideBalance((prev) => !prev)}
                className="min-h-[44px] min-w-[44px] rounded-2xl bg-white/10 hover:bg-white/18 border border-white/15 text-white flex items-center justify-center transition-all duration-300 active:scale-95 shrink-0"
                aria-label={hideBalance ? t('showBalances') : t('hideBalances')}
                title={hideBalance ? t('showBalances') : t('hideBalances')}
              >
                {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Current Month Cashflow Progress Bar (Income vs Expenses) */}
            <div className="rounded-2xl bg-black/22 border border-white/12 p-3.5 space-y-2.5 backdrop-blur-xs">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-[#EFE7D2]">
                  {isRTL ? 'تدفق الشهر الحالي (الدخل مقابل المصروفات)' : 'This Month (Income vs Expenses)'}
                </span>
                <span className="font-bold num-tabular text-[#E2B954]">
                  {currentMonthCashflow.status === 'empty'
                    ? isRTL
                      ? 'لا توجد حركة'
                      : 'No activity'
                    : isRTL
                    ? `نسبة الصرف ${currentMonthCashflow.expenseToIncomeRatioPct}%`
                    : `${currentMonthCashflow.expenseToIncomeRatioPct}% spent`}
                </span>
              </div>

              {/* Dual-segment visual progress bar */}
              <div
                data-testid="monthly-cashflow-progress-bar"
                className="w-full h-2.5 rounded-full bg-white/15 overflow-hidden flex"
                role="progressbar"
                aria-valuenow={currentMonthCashflow.incomeSharePct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                {currentMonthCashflow.status === 'empty' ? (
                  <div className="w-full h-full bg-white/10" />
                ) : (
                  <>
                    <div
                      className="h-full bg-gradient-to-r from-[#56C288] to-[#E2B954] transition-all duration-300"
                      style={{ width: `${currentMonthCashflow.incomeSharePct}%` }}
                    />
                    <div
                      className="h-full bg-[#E27B6A] transition-all duration-300"
                      style={{ width: `${currentMonthCashflow.expenseSharePct}%` }}
                    />
                  </>
                )}
              </div>

              {/* Income & Expense Numbers */}
              <div className="grid grid-cols-2 gap-3 pt-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-7 h-7 rounded-full bg-[#56C288]/20 text-[#7CE0A9] flex items-center justify-center shrink-0">
                    <TrendingUp className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <span className="block text-[10px] text-white/70">{t('income')}</span>
                    {hideBalance ? (
                      <span className="text-xs font-bold text-white num-tabular">••••</span>
                    ) : (
                      <MoneyText
                        amount={currentMonthCashflow.income}
                        currency={settings.mainCurrency}
                        className="text-xs sm:text-sm font-bold text-[#8FEAB7] block truncate"
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 min-w-0 justify-end">
                  <div className="min-w-0 text-end">
                    <span className="block text-[10px] text-white/70">{t('expense')}</span>
                    {hideBalance ? (
                      <span className="text-xs font-bold text-white num-tabular">••••</span>
                    ) : (
                      <MoneyText
                        amount={currentMonthCashflow.expense}
                        currency={settings.mainCurrency}
                        className="text-xs sm:text-sm font-bold text-[#F5A89B] block truncate"
                      />
                    )}
                  </div>
                  <span className="w-7 h-7 rounded-full bg-[#E27B6A]/22 text-[#F5A89B] flex items-center justify-center shrink-0">
                    <TrendingDown className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* MIDDLE COMPACT INSIGHTS & QUICK TOOLS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Daily Safe-to-Spend Compact Card */}
        <button
          type="button"
          onClick={() => setActiveNav('budget')}
          className={`w-full p-4 rounded-2xl border text-start flex items-center justify-between gap-3 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.99] min-h-[68px] ${
            safeToSpend.hasBudget && safeToSpend.isNegative
              ? 'bg-[var(--color-expense)]/10 border-[var(--color-expense)]/30'
              : 'bg-[var(--color-surface)] border-[var(--color-line)] hover:border-[var(--color-accent)]/45'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                safeToSpend.hasBudget && safeToSpend.isNegative
                  ? 'bg-[var(--color-expense)]/15 text-[var(--color-expense)]'
                  : 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
              }`}
            >
              <CalendarClock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-[var(--color-muted)]">
                {isRTL ? 'المتاح للصرف يومياً' : 'Daily Safe-to-Spend'}
              </div>
              {safeToSpend.hasBudget ? (
                <div className="flex items-baseline gap-1.5 flex-wrap mt-0.5">
                  {hideBalance ? (
                    <span className="text-base font-bold text-[var(--color-ink)] num-tabular">••••</span>
                  ) : (
                    <MoneyText
                      amount={safeToSpend.dailySafeAmount}
                      currency={settings.mainCurrency}
                      className={`text-base font-bold ${
                        safeToSpend.isNegative
                          ? 'text-[var(--color-expense)]'
                          : 'text-[var(--color-ink)]'
                      }`}
                    />
                  )}
                  <span className="text-[11px] text-[var(--color-muted)]">
                    · {isRTL ? `${safeToSpend.daysLeftInMonth} يوم متبقي` : `${safeToSpend.daysLeftInMonth}d left`}
                  </span>
                </div>
              ) : (
                <div className="text-xs font-semibold text-[var(--color-accent)] mt-0.5">
                  {isRTL ? 'حدد ميزانية شهرية للتوجيه الذكي' : 'Set a monthly budget'}
                </div>
              )}
            </div>
          </div>
          <ArrowEnd className="w-4 h-4 text-[var(--color-muted)] shrink-0" />
        </button>

        {/* Quick Tools: Statistics & Quick Templates */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onOpenStatistics}
            data-testid="dashboard-open-stats-btn"
            className="p-3.5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)]/50 flex flex-col justify-between gap-2 text-start transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] min-h-[68px]"
          >
            <span className="w-8 h-8 rounded-full bg-[var(--color-accent)]/12 text-[var(--color-accent)] flex items-center justify-center">
              <BarChart3 className="w-4 h-4" />
            </span>
            <span className="text-xs font-bold text-[var(--color-ink)] truncate">
              {t('tabStatistics')}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenTemplates}
            data-testid="dashboard-open-templates-btn"
            className="p-3.5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-gold)]/60 flex flex-col justify-between gap-2 text-start transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] min-h-[68px]"
          >
            <span className="w-8 h-8 rounded-full bg-[var(--color-gold)]/18 text-[var(--color-gold-text)] flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </span>
            <span className="text-xs font-bold text-[var(--color-ink)] truncate">
              {t('tabTemplates')}
            </span>
          </button>
        </div>
      </div>

      {/* Smart Alerts (only rendered when budget/debt triggers exist) */}
      {!dismissedAlerts && (activeBudgetAlerts.length > 0 || upcomingDebtReminders.length > 0) && (
        <div className="p-3.5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-gold)]/40 space-y-2 text-xs transition-all duration-300">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-[var(--color-gold-text)]">
              <BellRing className="w-4 h-4 shrink-0" />
              <span>{isRTL ? 'تنبيهات ذكية' : 'Smart Alerts'}</span>
            </div>
            <button
              type="button"
              onClick={() => setDismissedAlerts(true)}
              aria-label={isRTL ? 'إخفاء التنبيهات' : 'Dismiss alerts'}
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-xl min-h-[36px] min-w-[36px] flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1.5">
            {activeBudgetAlerts.slice(0, 2).map((alert) => (
              <button
                key={alert.budgetId}
                type="button"
                onClick={() => setActiveNav('budget')}
                className={`w-full px-3 py-2.5 rounded-xl text-start flex items-center justify-between gap-2 transition-all duration-300 min-h-[44px] ${
                  alert.level === 'exceeded'
                    ? 'bg-[var(--color-expense)]/10 text-[var(--color-expense)]'
                    : 'bg-[var(--color-gold-soft)] text-[var(--color-gold-text)]'
                }`}
              >
                <span className="flex items-center gap-2 truncate font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {alert.level === 'exceeded'
                      ? isRTL
                        ? `تجاوزت ميزانية "${alert.budgetName}"`
                        : `Budget "${alert.budgetName}" exceeded`
                      : isRTL
                      ? `اقتربت من حد ميزانية "${alert.budgetName}"`
                      : `Approaching "${alert.budgetName}" limit`}
                  </span>
                </span>
                <span className="font-bold num-tabular shrink-0">{alert.percentage}%</span>
              </button>
            ))}

            {upcomingDebtReminders.slice(0, 2).map((debt) => (
              <button
                key={debt.debtId}
                type="button"
                onClick={() => setActiveNav('more')}
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-start flex items-center justify-between gap-2 text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-all duration-300 min-h-[44px]"
              >
                <span className="truncate font-medium">
                  {debt.isOverdue
                    ? isRTL
                      ? `دين متأخر: ${debt.personName} (${debt.dueDate})`
                      : `Overdue debt: ${debt.personName} (${debt.dueDate})`
                    : debt.daysUntilDue === 0
                    ? isRTL
                      ? `موعد استحقاق اليوم: ${debt.personName}`
                      : `Due today: ${debt.personName}`
                    : isRTL
                    ? `دين مستحق خلال ${debt.daysUntilDue} يوم: ${debt.personName}`
                    : `Due in ${debt.daysUntilDue}d: ${debt.personName}`}
                </span>
                <MoneyText
                  amount={debt.remainingAmount}
                  currency={debt.currency}
                  className="font-bold text-[var(--color-accent)] shrink-0"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* BOTTOM SECTION: Recent Transactions List + "View Full Ledger" CTA */}
      <section className="space-y-2.5" data-testid="recent-transactions-section">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <h2 className="font-title text-base font-bold text-[var(--color-ink)]">
            {isRTL ? 'أحدث المعاملات' : 'Recent Transactions'}
          </h2>
          <button
            type="button"
            onClick={onOpenFullLedger}
            data-testid="view-full-ledger-btn"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-all duration-300 min-h-[40px]"
          >
            <span>{isRTL ? 'عرض السجل بالكامل' : 'View Full Ledger'}</span>
            <ArrowEnd className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl overflow-hidden divide-y divide-[var(--color-line)] shadow-xs">
          {recentTransactions.length === 0 ? (
            <HairlineEmptyState
              figure="drawer"
              surface="surface"
              title={isRTL ? 'لا توجد معاملات مسجلة بعد' : 'No transactions recorded yet'}
              description={
                isRTL
                  ? 'ابدأ بتسجيل أول دخل أو مصروف ليظهر هنا بشكل فوري ومرتب.'
                  : 'Record your first income or expense to see your cashflow here.'
              }
              action={
                canWriteTx ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTransaction(null);
                      setIsAddModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] rounded-xl text-xs font-semibold hover:opacity-95 transition-all duration-300 min-h-[44px]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{isRTL ? 'إضافة معاملة' : 'Add Transaction'}</span>
                  </button>
                ) : undefined
              }
            />
          ) : (
            recentTransactions.map((tx) => {
              const cat = categoriesById.get(tx.categoryId);
              const wallet = walletsById.get(tx.walletId);
              const toWallet = tx.toWalletId ? walletsById.get(tx.toWalletId) : undefined;
              const catName = isRTL ? cat?.nameAr || 'عام' : cat?.nameEn || 'General';
              const isApprovedEmployeeLocked =
                isOrgWorkspace &&
                activeOrgRole === 'employee' &&
                (tx.approvalStatus === 'approved' || tx.approvalStatus === 'paid');
              const canEdit = canWriteTx && !isApprovedEmployeeLocked;

              const iconConfig =
                tx.type === 'income'
                  ? {
                      bg: 'bg-[var(--color-income)]/14 text-[var(--color-income)]',
                      Icon: ArrowDownLeft,
                    }
                  : tx.type === 'transfer'
                  ? {
                      bg: 'bg-[var(--color-gold)]/18 text-[var(--color-gold-text)]',
                      Icon: ArrowLeftRight,
                    }
                  : {
                      bg: 'bg-[var(--color-expense)]/14 text-[var(--color-expense)]',
                      Icon: ArrowUpRight,
                    };

              const TypeIcon = iconConfig.Icon;

              return (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => {
                    if (canEdit) {
                      setEditingTransaction(tx);
                      setIsAddModalOpen(true);
                    }
                  }}
                  className={`w-full p-3.5 sm:px-4 flex items-center justify-between gap-3 text-start transition-all duration-300 min-h-[64px] ${
                    canEdit
                      ? 'hover:bg-[var(--color-surface-subtle)]/70 active:scale-[0.995] cursor-pointer'
                      : 'cursor-default'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Circular Colored Icon indicating Transaction Type */}
                    <span
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconConfig.bg}`}
                      aria-hidden="true"
                    >
                      <TypeIcon className="w-4 h-4 stroke-[2.3]" />
                    </span>

                    <div className="min-w-0 space-y-0.5">
                      <div className="text-[13px] font-bold text-[var(--color-ink)] truncate">
                        {tx.type === 'transfer'
                          ? `${wallet?.name || ''} ➔ ${toWallet?.name || ''}`
                          : catName}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)] truncate">
                        {tx.type !== 'transfer' && wallet?.name && (
                          <>
                            <span className="truncate">{wallet.name}</span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span className="num-tabular shrink-0">{tx.date}</span>
                        {tx.notes && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate max-w-[120px]">{tx.notes}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-end shrink-0">
                    <MoneyText
                      amount={tx.amount}
                      currency={tx.currency}
                      type={tx.type}
                      showSign={true}
                      colorByType={true}
                      className="text-sm font-bold"
                    />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {transactions.length > 0 && (
          <button
            type="button"
            onClick={onOpenFullLedger}
            className="w-full py-3 px-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-xs font-bold text-[var(--color-accent)] flex items-center justify-center gap-2 transition-all duration-300 active:scale-[0.99] min-h-[46px]"
          >
            <span>
              {isRTL
                ? `عرض السجل بالكامل (${transactions.length})`
                : `View Full Ledger (${transactions.length})`}
            </span>
            <ArrowEnd className="w-4 h-4" />
          </button>
        )}
      </section>
    </div>
  );
};
