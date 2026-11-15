import React, { useState, useMemo } from 'react';
import {
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  Wallet as WalletIcon,
  AlertTriangle,
  Sparkles,
  Save,
  X,
  CalendarClock,
  BellRing,
  BarChart3,
  ClipboardCheck,
  Building2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  calculateTotalBalance,
  calculateIncomeExpenseNet,
  getTransactionsInDateRange,
  calculateBudgetProgress,
  calculateSafeToSpend,
  calculateWeeklyInsight,
  calculateMonthlySummary,
  getActiveBudgetAlerts,
  getUpcomingDebtReminders,
  getActiveFiscalMonthStr,
  getCustomMonthDateRange,
  formatLocalDate,
} from '../../services/calculations';
import { MoneyText } from '../common/MoneyText';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export const SummaryCards: React.FC = () => {
  const {
    isOrgWorkspace,
    activeOrganization,
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
    t,
    isRTL,
  } = useApp();

  const [hideBalance, setHideBalance] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'yesterday' | 'week' | 'month'>('month');
  const [dismissedAlerts, setDismissedAlerts] = useState(false);

  // Total balance
  const totalBalance = useMemo(() => {
    return calculateTotalBalance(wallets, settings.mainCurrency, settings.customExchangeRates, {
      excludeDebts: settings.excludeDebtsFromBalance,
      debts,
    });
  }, [wallets, settings.mainCurrency, settings.customExchangeRates, settings.excludeDebtsFromBalance, debts]);

  // Safe-to-spend daily metric (respects custom fiscal month start day & rollover)
  const safeToSpend = useMemo(() => {
    return calculateSafeToSpend(
      budgets,
      transactions,
      settings.mainCurrency,
      settings.customExchangeRates,
      new Date(),
      settings.firstDayOfMonth || 1
    );
  }, [budgets, transactions, settings.mainCurrency, settings.customExchangeRates, settings.firstDayOfMonth]);

  // Weekly insight (this week vs last week per top category)
  const weeklyInsight = useMemo(() => {
    return calculateWeeklyInsight(
      transactions,
      categories,
      settings.mainCurrency,
      settings.customExchangeRates
    );
  }, [transactions, categories, settings.mainCurrency, settings.customExchangeRates]);

  // Monthly Summary Card (MoM comparison + top 3 categories)
  const monthlySummary = useMemo(() => {
    return calculateMonthlySummary(
      transactions,
      categories,
      settings.mainCurrency,
      settings.customExchangeRates,
      new Date(),
      settings.firstDayOfMonth || 1
    );
  }, [transactions, categories, settings.mainCurrency, settings.customExchangeRates, settings.firstDayOfMonth]);

  // Real In-App Budget Alerts (80% warning / 100% exceeded) & Debt Reminders
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
    settings.firstDayOfMonth,
  ]);

  const upcomingDebtReminders = useMemo(() => {
    if (!settings.notificationsEnabled || !(settings.debtRemindersEnabled ?? true)) return [];
    return getUpcomingDebtReminders(debts, new Date());
  }, [settings.notificationsEnabled, settings.debtRemindersEnabled, debts]);

  // Backup nudge check (>14 days since latest local OR cloud backup)
  const lastBackupActivityAt = Math.max(settings.lastBackupAt || 0, settings.lastCloudSyncAt || 0);
  const showBackupNudge = useMemo(() => {
    if (transactions.length === 0) return false;
    const now = Date.now();
    if (settings.backupReminderDismissedAt && now - settings.backupReminderDismissedAt < FOURTEEN_DAYS_MS) {
      return false;
    }
    if (!lastBackupActivityAt) return true;
    return now - lastBackupActivityAt > FOURTEEN_DAYS_MS;
  }, [transactions.length, lastBackupActivityAt, settings.backupReminderDismissedAt]);

  // Helper date ranges (respecting firstDayOfWeek and custom firstDayOfMonth)
  const dateRanges = useMemo(() => {
    const now = new Date();
    const todayStr = formatLocalDate(now);

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = formatLocalDate(yesterday);

    const currentDay = now.getDay();
    const diffToStart = (currentDay - settings.firstDayOfWeek + 7) % 7;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - diffToStart);
    const weekStartStr = formatLocalDate(weekStart);

    const activeMonthStr = getActiveFiscalMonthStr(now, settings.firstDayOfMonth || 1);
    const fiscalRange = getCustomMonthDateRange(activeMonthStr, settings.firstDayOfMonth || 1);

    return {
      today: { start: todayStr, end: todayStr },
      yesterday: { start: yesterdayStr, end: yesterdayStr },
      week: { start: weekStartStr, end: todayStr },
      month: { start: fiscalRange.startDate, end: fiscalRange.endDate },
    };
  }, [settings.firstDayOfWeek, settings.firstDayOfMonth]);

  // Period stats
  const periodStats = useMemo(() => {
    const range = dateRanges[selectedPeriod];
    const filtered = getTransactionsInDateRange(transactions, range.start, range.end);
    return calculateIncomeExpenseNet(
      filtered,
      settings.mainCurrency,
      settings.customExchangeRates,
      settings.useRateAtTransactionTime
    );
  }, [transactions, selectedPeriod, dateRanges, settings]);

  // Budget status for indicator
  const overallBudgetStatus = useMemo(() => {
    if (!settings.showBudgetIndicator) return null;
    const currentMonth = getActiveFiscalMonthStr(new Date(), settings.firstDayOfMonth || 1);
    const overall = budgets.find((b) => b.month === currentMonth && !b.categoryId && !b.walletId);
    if (!overall) return null;

    return {
      budget: overall,
      ...calculateBudgetProgress(overall, transactions, settings.mainCurrency, settings.customExchangeRates, {
        firstDayOfMonth: settings.firstDayOfMonth || 1,
        allBudgets: budgets,
      }),
    };
  }, [budgets, transactions, settings]);

  // Plain-language weekly insight sentence
  const weeklyInsightSentence = useMemo(() => {
    if (!weeklyInsight.hasData) return '';
    const catName = isRTL
      ? weeklyInsight.topCategoryNameAr || 'أخرى'
      : weeklyInsight.topCategoryNameEn || 'Other';

    if (weeklyInsight.lastWeekTotal === 0) {
      return isRTL
        ? `أنفقت هذا الأسبوع أعلى مبلغ في تصنيف "${catName}".`
        : `Your top spending category this week is "${catName}".`;
    }

    const absDiff = Math.abs(weeklyInsight.totalDiffPct);
    if (weeklyInsight.totalDiffPct > 5) {
      return isRTL
        ? `مصاريفك هذا الأسبوع أعلى بـ ${absDiff}% من الأسبوع الماضي، وأعلاها في "${catName}".`
        : `Spending is ${absDiff}% higher than last week, led by "${catName}".`;
    }
    if (weeklyInsight.totalDiffPct < -5) {
      return isRTL
        ? `مصاريفك هذا الأسبوع أقل بـ ${absDiff}% من الأسبوع الماضي، وأعلاها في "${catName}".`
        : `Spending is ${absDiff}% lower than last week, led by "${catName}".`;
    }
    return isRTL
      ? `مصاريفك هذا الأسبوع مستقرة مقارنة بالأسبوع الماضي، وأعلاها في "${catName}".`
      : `Spending this week is steady vs last week, led by "${catName}".`;
  }, [weeklyInsight, isRTL]);

  return (
    <div className="px-4 pt-3 pb-1 space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* 0. Dismissible Backup Nudge (>14 days since last local or cloud backup) */}
      {showBackupNudge && (
        <div className="p-3 rounded-xl bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Save className="w-4 h-4 text-[var(--color-warning-text)] shrink-0" />
            <span className="text-[var(--color-ink)] truncate">
              {lastBackupActivityAt
                ? isRTL
                  ? 'مر أكثر من 14 يوماً على آخر نسخة احتياطية'
                  : 'Over 14 days since your last backup'
                : isRTL
                ? 'احفظ نسخة احتياطية لبياناتك المحلية'
                : 'Back up your local data safely'}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsBackupOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold text-[11px] min-h-[32px]"
            >
              {isRTL ? 'نسخ الآن' : 'Backup'}
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ backupReminderDismissedAt: Date.now() })}
              className="p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg min-h-[32px] min-w-[32px] flex items-center justify-center"
              aria-label={isRTL ? 'إخفاء التذكير' : 'Dismiss reminder'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 0.5 Enterprise Quick Hub & Pending Approvals Shortcut */}
      {isOrgWorkspace && activeOrganization && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => openOrgHub(pendingApprovalsCount > 0 ? 'approvals' : 'reports')}
            data-testid="home-open-org-hub-btn"
            className="w-full p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-accent)]/35 flex items-center justify-between gap-2 text-xs hover:border-[var(--color-accent)] transition-colors min-h-[44px]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
              <span className="font-semibold text-[var(--color-ink)] truncate">
                {t('orgHubTitle')} — {activeOrganization.name}
              </span>
            </div>
            <span className="text-[11px] font-bold text-[var(--color-accent)] shrink-0">
              {isRTL ? 'فتح المركز ←' : 'Open Hub →'}
            </span>
          </button>

          {pendingApprovalsCount > 0 && (
            <button
              type="button"
              onClick={() => openOrgHub('approvals')}
              className="w-full p-3 rounded-xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 flex items-center justify-between gap-2 text-xs hover:bg-[var(--color-accent)]/15 transition-colors min-h-[44px]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <ClipboardCheck className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
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
              <span className="text-[11px] font-bold text-[var(--color-accent)] shrink-0">
                {isRTL ? 'مراجعة ←' : 'Review →'}
              </span>
            </button>
          )}
        </div>
      )}

      {/* 1. Main Current Balance Card (Paper-like, large hero number) */}
      {settings.showCurrentBalance && (
        <div className="rounded-xl bg-[var(--color-surface)] p-5 border border-[var(--color-line)] shadow-sm">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-[var(--color-muted)]">
              {isOrgWorkspace && activeOrganization
                ? `${t('currentBalance')} — ${activeOrganization.name}`
                : t('currentBalance')}
            </span>
            <button
              onClick={() => setHideBalance(!hideBalance)}
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
              aria-label={hideBalance ? t('showBalances') : t('hideBalances')}
            >
              {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Large Hero Balance */}
          <div className="flex items-baseline gap-2 mb-3">
            {hideBalance ? (
              <span className="text-3xl sm:text-4xl font-bold text-[var(--color-ink)] tracking-tight">
                ••••••••
              </span>
            ) : (
              <MoneyText
                amount={totalBalance}
                currency={settings.mainCurrency}
                className="text-3xl sm:text-4xl font-bold text-[var(--color-ink)] tracking-tight"
              />
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[var(--color-line)] text-xs text-[var(--color-muted)]">
            <div className="flex items-center gap-1.5 flex-wrap">
              <WalletIcon className="w-3.5 h-3.5 text-[var(--color-accent)]" />
              <span>
                {wallets.length} {t('navWallets')}
              </span>
              {wallets.some((w) => !w.isArchived && w.excludeFromTotal) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]">
                  {(() => {
                    const excludedCount = wallets.filter((w) => !w.isArchived && w.excludeFromTotal).length;
                    return isRTL
                      ? `${excludedCount} مستثناة من الإجمالي`
                      : `${excludedCount} excluded`;
                  })()}
                </span>
              )}
            </div>
            <button
              onClick={() => setActiveNav('wallets')}
              className="text-[var(--color-accent)] hover:underline font-medium text-xs flex items-center gap-1 min-h-[36px] shrink-0"
            >
              <span>{isRTL ? 'عرض المحافظ ←' : 'View Wallets →'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 1.5 Safe-to-Spend Daily Allowance */}
      <div
        className={`rounded-xl p-4 border transition-colors ${
          safeToSpend.hasBudget && safeToSpend.isNegative
            ? 'bg-[var(--color-expense)]/10 border-[var(--color-expense)]/30'
            : 'bg-[var(--color-surface)] border-[var(--color-line)]'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-muted)]">
              <CalendarClock
                className={`w-3.5 h-3.5 ${
                  safeToSpend.hasBudget && safeToSpend.isNegative
                    ? 'text-[var(--color-expense)]'
                    : 'text-[var(--color-accent)]'
                }`}
              />
              <span>{isRTL ? 'المتاح للصرف يومياً' : 'Daily Safe-to-Spend'}</span>
            </div>

            {safeToSpend.hasBudget ? (
              <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                {hideBalance ? (
                  <span className="text-2xl font-bold text-[var(--color-ink)]">••••</span>
                ) : (
                  <MoneyText
                    amount={safeToSpend.dailySafeAmount}
                    currency={settings.mainCurrency}
                    className={`text-2xl font-bold tracking-tight ${
                      safeToSpend.isNegative
                        ? 'text-[var(--color-expense)]'
                        : 'text-[var(--color-ink)]'
                    }`}
                  />
                )}
                <span className="text-[11px] text-[var(--color-muted)]">
                  {isRTL
                    ? `• متبقي ${safeToSpend.daysLeftInMonth} يوم في الشهر`
                    : `• ${safeToSpend.daysLeftInMonth} days left`}
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-[var(--color-muted)] mt-1">
                {isRTL
                  ? 'حدد ميزانية شهرية لحساب حد الصرف اليومي الآمن.'
                  : 'Set a monthly budget to see your daily safe-to-spend limit.'}
              </p>
            )}
          </div>

          {!safeToSpend.hasBudget ? (
            <button
              type="button"
              onClick={() => setActiveNav('budget')}
              className="shrink-0 text-xs font-semibold text-[var(--color-accent)] hover:underline min-h-[36px] px-2"
            >
              {isRTL ? 'تحديد ميزانية ←' : 'Set a budget →'}
            </button>
          ) : safeToSpend.isNegative ? (
            <span className="shrink-0 px-2 py-1 rounded-lg bg-[var(--color-expense)]/15 text-[var(--color-expense)] text-[11px] font-bold">
              {isRTL ? 'تجاوز الميزانية' : 'Over budget'}
            </span>
          ) : null}
        </div>
      </div>

      {/* 2. Budget Alert Indicator (if enabled) */}
      {overallBudgetStatus && (
        <div
          onClick={() => setActiveNav('budget')}
          className={`p-3 rounded-xl border cursor-pointer transition-colors flex items-center justify-between gap-3 ${
            overallBudgetStatus.isExceeded
              ? 'bg-[var(--color-expense)]/10 border-[var(--color-expense)]/30 text-[var(--color-expense)]'
              : overallBudgetStatus.isWarning
              ? 'bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30 text-[var(--color-warning-text)]'
              : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-ink)]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              className={`w-4 h-4 shrink-0 ${
                overallBudgetStatus.isExceeded
                  ? 'text-[var(--color-expense)]'
                  : overallBudgetStatus.isWarning
                  ? 'text-[var(--color-warning-text)]'
                  : 'text-[var(--color-accent)]'
              }`}
            />
            <div className="text-xs">
              <div className="font-bold">
                {overallBudgetStatus.isExceeded
                  ? t('budgetExceeded')
                  : overallBudgetStatus.isWarning
                  ? t('budgetWarning')
                  : t('budgetGood')}
              </div>
              <div className="text-[11px] opacity-80 mt-0.5">
                {isRTL
                  ? `تم صرف ${overallBudgetStatus.percentage}% من الميزانية العامة`
                  : `${overallBudgetStatus.percentage}% of overall budget spent`}
              </div>
            </div>
          </div>
          <div className="text-xs font-semibold shrink-0">
            <MoneyText
              amount={overallBudgetStatus.remaining}
              currency={settings.mainCurrency}
              className="text-xs font-semibold text-[var(--color-accent)]"
            />{' '}
            <span className="text-[var(--color-muted)]">{isRTL ? 'متبقي' : 'left'}</span>
          </div>
        </div>
      )}

      {/* 3. Period Selector Pills (Flat hairline border — one selected rule) */}
      <div className="bg-[var(--color-surface)] p-1 rounded-xl border border-[var(--color-line)] flex items-center justify-between">
        {(['today', 'yesterday', 'week', 'month'] as const).map((period) => (
          <button
            key={period}
            onClick={() => setSelectedPeriod(period)}
            className={`flex-1 py-1.5 text-xs rounded-lg transition-colors min-h-[38px] ${
              selectedPeriod === period
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold shadow-xs'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {t(
              period === 'today'
                ? 'today'
                : period === 'yesterday'
                ? 'yesterday'
                : period === 'week'
                ? 'thisWeek'
                : 'thisMonth'
            )}
          </button>
        ))}
      </div>

      {/* 4. Income, Expense, Net 3-Column Summary Cards */}
      <div className="grid grid-cols-3 gap-2">
        {/* Income Card */}
        <div className="p-2.5 sm:p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl min-w-0">
          <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-income)] mb-1">
            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
            <span>{t('income')}</span>
          </div>
          <div className="font-bold leading-snug break-words">
            {hideBalance ? (
              <span className="text-xs sm:text-sm text-[var(--color-ink)]">••••</span>
            ) : (
              <MoneyText
                amount={periodStats.income}
                currency={settings.mainCurrency}
                type="income"
                colorByType={true}
                className="text-[11px] sm:text-sm font-bold"
              />
            )}
          </div>
        </div>

        {/* Expense Card */}
        <div className="p-2.5 sm:p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl min-w-0">
          <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-expense)] mb-1">
            <TrendingDown className="w-3.5 h-3.5 shrink-0" />
            <span>{t('expense')}</span>
          </div>
          <div className="font-bold leading-snug break-words">
            {hideBalance ? (
              <span className="text-xs sm:text-sm text-[var(--color-ink)]">••••</span>
            ) : (
              <MoneyText
                amount={periodStats.expense}
                currency={settings.mainCurrency}
                type="expense"
                colorByType={true}
                className="text-[11px] sm:text-sm font-bold"
              />
            )}
          </div>
        </div>

        {/* Net Balance Card */}
        <div className="p-2.5 sm:p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl min-w-0">
          <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-muted)] mb-1">
            <span>{t('net')}</span>
          </div>
          <div className="font-bold leading-snug break-words">
            {hideBalance ? (
              <span className="text-xs sm:text-sm text-[var(--color-ink)]">••••</span>
            ) : (
              <MoneyText
                amount={periodStats.net}
                currency={settings.mainCurrency}
                showSign={true}
                type={periodStats.net >= 0 ? 'income' : 'expense'}
                colorByType={true}
                className="text-[11px] sm:text-sm font-bold"
              />
            )}
          </div>
        </div>
      </div>

      {/* 5. In-App Smart Alerts (Budget 80%/100% & Upcoming/Overdue Debts) */}
      {!dismissedAlerts && (activeBudgetAlerts.length > 0 || upcomingDebtReminders.length > 0) && (
        <div className="p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-warning)]/35 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-[var(--color-warning-text)]">
              <BellRing className="w-4 h-4 shrink-0" />
              <span>{isRTL ? 'تنبيهات ذكية' : 'Smart Alerts'}</span>
            </div>
            <button
              type="button"
              onClick={() => setDismissedAlerts(true)}
              aria-label={isRTL ? 'إخفاء التنبيهات' : 'Dismiss alerts'}
              className="p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg min-h-[28px] min-w-[28px] flex items-center justify-center"
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
                className={`w-full px-2.5 py-2 rounded-lg text-start flex items-center justify-between gap-2 transition-colors ${
                  alert.level === 'exceeded'
                    ? 'bg-[var(--color-expense)]/10 text-[var(--color-expense)]'
                    : 'bg-[var(--color-warning)]/10 text-[var(--color-warning-text)]'
                }`}
              >
                <span className="truncate font-semibold">
                  {alert.level === 'exceeded'
                    ? isRTL
                      ? `تجاوزت ميزانية "${alert.budgetName}"`
                      : `Budget "${alert.budgetName}" exceeded`
                    : isRTL
                    ? `اقتربت من حد ميزانية "${alert.budgetName}"`
                    : `Approaching "${alert.budgetName}" limit`}
                </span>
                <span className="font-bold num-tabular shrink-0">{alert.percentage}%</span>
              </button>
            ))}

            {upcomingDebtReminders.slice(0, 2).map((debt) => (
              <button
                key={debt.debtId}
                type="button"
                onClick={() => setActiveNav('more')}
                className="w-full px-2.5 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-start flex items-center justify-between gap-2 text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-colors"
              >
                <span className="truncate">
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

      {/* 6. Weekly Insight Card */}
      {weeklyInsight.hasData && (
        <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-start gap-2.5 text-xs">
          <Sparkles className="w-4 h-4 text-[var(--color-accent)] shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[var(--color-ink)] leading-relaxed">
              {weeklyInsightSentence}
            </div>
            <div className="text-[11px] text-[var(--color-muted)] mt-0.5 flex items-center gap-2 flex-wrap">
              <span>
                {isRTL ? 'هذا الأسبوع:' : 'This week:'}{' '}
                <MoneyText
                  amount={weeklyInsight.thisWeekTotal}
                  currency={settings.mainCurrency}
                  className="font-semibold text-[var(--color-ink)]"
                />
              </span>
              <span>•</span>
              <span>
                {isRTL ? 'الأسبوع الماضي:' : 'Last week:'}{' '}
                <MoneyText
                  amount={weeklyInsight.lastWeekTotal}
                  currency={settings.mainCurrency}
                  className="font-medium text-[var(--color-muted)]"
                />
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 7. Monthly Summary Card (MoM expense comparison + top 3 categories) */}
      {monthlySummary.hasData && monthlySummary.thisMonthExpense > 0 && (
        <div className="p-3.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-[var(--color-ink)]">
              <BarChart3 className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
              <span>{isRTL ? 'ملخص الشهر المالي' : 'Monthly Summary'}</span>
            </div>
            {monthlySummary.prevMonthExpense > 0 && (
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold num-tabular ${
                  monthlySummary.expenseDiffPct > 0
                    ? 'bg-[var(--color-expense)]/12 text-[var(--color-expense)]'
                    : 'bg-[var(--color-income)]/12 text-[var(--color-income)]'
                }`}
              >
                {monthlySummary.expenseDiffPct > 0
                  ? `+${monthlySummary.expenseDiffPct}%`
                  : `${monthlySummary.expenseDiffPct}%`}{' '}
                {isRTL ? 'عن الشهر السابق' : 'vs last month'}
              </span>
            )}
          </div>

          {monthlySummary.topCategories.length > 0 && (
            <div className="space-y-1.5">
              {monthlySummary.topCategories.map((cat) => (
                <div key={cat.categoryId} className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="text-[var(--color-ink)] font-medium truncate">
                      {isRTL ? cat.nameAr : cat.nameEn}
                    </span>
                    <span className="text-[10px] text-[var(--color-muted)] num-tabular">
                      ({cat.sharePct}%)
                    </span>
                  </div>
                  <MoneyText
                    amount={cat.amount}
                    currency={settings.mainCurrency}
                    className="font-semibold text-[var(--color-ink)] shrink-0"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
