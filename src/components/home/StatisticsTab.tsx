import React, { useState, useMemo } from 'react';
import {
  PieChart as PieIcon,
  ShieldAlert,
  Wallet as WalletIcon,
  Crown,
  TrendingUp,
  TrendingDown,
  PiggyBank,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { IconRenderer } from '../common/IconRenderer';
import { convertCurrency } from '../../services/currency';
import {
  doesTransactionAffectAccounting,
  getEffectiveTransactionAmount,
  getTransactionsInDateRange,
  calculateMonthEndForecast,
  formatDisplayNumber,
  formatLocalDate,
  getActiveFiscalMonthStr,
  getCustomMonthDateRange,
  roundCurrency,
} from '../../services/calculations';
import {
  calculateSavingsAndCashflow,
  getTimeframeStartDate,
} from '../../services/wealthAnalytics';
import { MoneyText } from '../common/MoneyText';
import { AdBanner } from '../common/AdBanner';
import { HairlineEmptyState, HairlineFigure } from '../common/HairlineVisuals';
import { NetWorthCard } from './NetWorthCard';

const CHART_PALETTE = ['#B5523B', '#C99A2E', '#5E7F3A', '#1E6F73', '#7A4E6D', '#6B5E50'];

export const StatisticsTab: React.FC = () => {
  const {
    transactions,
    categories,
    wallets,
    settings,
    t,
    isRTL,
    isPro,
    isOrgWorkspace,
    setActiveNav,
    setIsUpgradeModalOpen,
  } = useApp();

  const [dateRangeOption, setDateRangeOption] = useState<'1M' | '3M' | '1Y' | 'ALL'>('1M');
  const [activeStatView, setActiveStatView] = useState<'category' | 'priority' | 'wallets'>('category');

  // Compute active date range (1M / 3M / 1Y / ALL)
  const activeDateRange = useMemo(() => {
    const now = new Date();
    const firstDay = settings.firstDayOfMonth || 1;
    const endStr = formatLocalDate(now);

    if (dateRangeOption === '1M') {
      const activeMonth = getActiveFiscalMonthStr(now, firstDay);
      const range = getCustomMonthDateRange(activeMonth, firstDay);
      return { start: range.startDate, end: range.endDate, label: isRTL ? 'شهر' : '1M' };
    }
    if (dateRangeOption === '3M') {
      const start = getTimeframeStartDate('3M', now);
      return {
        start: start ? formatLocalDate(start) : '1970-01-01',
        end: endStr,
        label: isRTL ? '٣ شهور' : '3M',
      };
    }
    if (dateRangeOption === '1Y') {
      const start = getTimeframeStartDate('1Y', now);
      return {
        start: start ? formatLocalDate(start) : `${now.getFullYear()}-01-01`,
        end: endStr,
        label: isRTL ? 'سنة' : '1Y',
      };
    }
    return { start: '1970-01-01', end: '2099-12-31', label: isRTL ? 'الكل' : 'All' };
  }, [dateRangeOption, settings.firstDayOfMonth, isRTL]);

  // Filter transactions
  const filteredTx = useMemo(() => {
    return getTransactionsInDateRange(transactions, activeDateRange.start, activeDateRange.end).filter(
      (tx) => doesTransactionAffectAccounting(tx)
    );
  }, [transactions, activeDateRange]);

  // Totals
  const { totalIncome, totalExpense } = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const tx of filteredTx) {
      const inMain = convertCurrency(
        getEffectiveTransactionAmount(tx),
        tx.currency,
        settings.mainCurrency,
        settings.customExchangeRates
      );
      if (tx.type === 'income') inc += inMain;
      if (tx.type === 'expense') exp += inMain;
    }
    return { totalIncome: inc, totalExpense: exp };
  }, [filteredTx, settings.mainCurrency, settings.customExchangeRates, settings.ratesUpdatedAtMs]);

  // Category Breakdown
  const categoryStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of filteredTx) {
      if (tx.type !== 'expense') continue;
      const inMain = convertCurrency(
        getEffectiveTransactionAmount(tx),
        tx.currency,
        settings.mainCurrency,
        settings.customExchangeRates
      );
      map.set(tx.categoryId, (map.get(tx.categoryId) || 0) + inMain);
    }

    const items = Array.from(map.entries()).map(([catId, amount], idx) => {
      const cat = categories.find((c) => c.id === catId);
      const percentage = totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0;
      const fallbackColor = CHART_PALETTE[idx % CHART_PALETTE.length];
      return {
        catId,
        cat,
        amount: roundCurrency(amount, settings.mainCurrency),
        percentage,
        color: cat?.color || fallbackColor,
      };
    });

    items.sort((a, b) => b.amount - a.amount);
    return items;
  }, [filteredTx, categories, totalExpense, settings.mainCurrency, settings.customExchangeRates, settings.ratesUpdatedAtMs]);

  // Priority Breakdown
  const priorityStats = useMemo(() => {
    let essential = 0;
    let normal = 0;
    let leisure = 0;

    for (const tx of filteredTx) {
      if (tx.type !== 'expense') continue;
      const inMain = convertCurrency(
        getEffectiveTransactionAmount(tx),
        tx.currency,
        settings.mainCurrency,
        settings.customExchangeRates
      );
      if (tx.priority === 'essential') essential += inMain;
      else if (tx.priority === 'leisure') leisure += inMain;
      else normal += inMain;
    }

    const total = essential + normal + leisure;
    return {
      essential: { amount: essential, pct: total > 0 ? Math.round((essential / total) * 100) : 0 },
      normal: { amount: normal, pct: total > 0 ? Math.round((normal / total) * 100) : 0 },
      leisure: { amount: leisure, pct: total > 0 ? Math.round((leisure / total) * 100) : 0 },
      total,
    };
  }, [filteredTx, settings.mainCurrency, settings.customExchangeRates, settings.ratesUpdatedAtMs]);

  // Wallet Comparison
  const walletStats = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    for (const tx of filteredTx) {
      if (tx.type === 'transfer') continue;
      const cur = map.get(tx.walletId) || { income: 0, expense: 0 };
      const inMain = convertCurrency(
        getEffectiveTransactionAmount(tx),
        tx.currency,
        settings.mainCurrency,
        settings.customExchangeRates
      );
      if (tx.type === 'income') cur.income += inMain;
      if (tx.type === 'expense') cur.expense += inMain;
      map.set(tx.walletId, cur);
    }

    return wallets.map((w) => {
      const stats = map.get(w.id) || { income: 0, expense: 0 };
      return {
        wallet: w,
        ...stats,
      };
    });
  }, [filteredTx, wallets, settings.mainCurrency, settings.customExchangeRates, settings.ratesUpdatedAtMs]);

  // SVG Doughnut Chart Calculation
  const doughnutSegments = useMemo(() => {
    let cumulative = 0;
    return categoryStats.slice(0, 6).map((item, i) => {
      const strokeDash = `${item.percentage} ${100 - item.percentage}`;
      const strokeDashoffset = 100 - cumulative + 25;
      cumulative += item.percentage;
      return {
        ...item,
        strokeDash,
        strokeDashoffset,
        color: item.color || CHART_PALETTE[i % CHART_PALETTE.length],
      };
    });
  }, [categoryStats]);

  const cashflowMetrics = useMemo(
    () => calculateSavingsAndCashflow(totalIncome, totalExpense, settings.mainCurrency),
    [totalIncome, totalExpense, settings.mainCurrency]
  );
  const netBalance = cashflowMetrics.netCashflow;

  const monthEndForecast = useMemo(() => {
    return calculateMonthEndForecast(
      transactions,
      settings.mainCurrency,
      settings.customExchangeRates,
      new Date(),
      settings.firstDayOfMonth || 1
    );
  }, [transactions, settings.mainCurrency, settings.customExchangeRates, settings.ratesUpdatedAtMs, settings.firstDayOfMonth]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-3 pb-24 space-y-4">
      {/* Quick Timeframe Filter Bar (1M / 3M / 1Y / All) */}
      <div className="flex items-center justify-between p-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
        {[
          { id: '1M', label: isRTL ? 'شهر (1M)' : '1M' },
          { id: '3M', label: isRTL ? '٣ شهور (3M)' : '3M' },
          { id: '1Y', label: isRTL ? 'سنة (1Y)' : '1Y' },
          { id: 'ALL', label: isRTL ? 'الكل' : 'All' },
        ].map((opt) => (
          <button
            key={opt.id}
            data-testid={`stats-tf-${opt.id}`}
            onClick={() => setDateRangeOption(opt.id as '1M' | '3M' | '1Y' | 'ALL')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[38px] ${
              dateRangeOption === opt.id
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Personal Net Worth Overview */}
      {!isOrgWorkspace && (
        <NetWorthCard
          onOpenWallets={() => setActiveNav('wallets')}
          onOpenDebts={() => setActiveNav('more')}
        />
      )}

      {/* Net Cashflow & Savings Rate Highlight Strip */}
      <div className={`grid gap-3 ${isOrgWorkspace ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
        <div className="p-3.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-muted)]">
              {cashflowMetrics.cashflowStatus === 'negative' ? (
                <TrendingDown className="w-3.5 h-3.5 text-[var(--color-expense)]" />
              ) : (
                <TrendingUp className="w-3.5 h-3.5 text-[var(--color-income)]" />
              )}
              <span>{isRTL ? 'صافي التدفق النقدي' : 'Net Cashflow'}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <MoneyText
                amount={netBalance}
                currency={settings.mainCurrency}
                showSign={true}
                colorByType={true}
                type={netBalance >= 0 ? 'income' : 'expense'}
                className="font-extrabold text-base"
              />
              <span
                className={`text-[11px] font-bold ${
                  cashflowMetrics.cashflowStatus === 'positive'
                    ? 'text-[var(--color-income)]'
                    : cashflowMetrics.cashflowStatus === 'negative'
                    ? 'text-[var(--color-expense)]'
                    : 'text-[var(--color-muted)]'
                }`}
              >
                ·{' '}
                {cashflowMetrics.cashflowStatus === 'positive'
                  ? isRTL
                    ? 'إيجابي'
                    : 'Positive'
                  : cashflowMetrics.cashflowStatus === 'negative'
                  ? isRTL
                    ? 'سلبي'
                    : 'Negative'
                  : isRTL
                  ? 'متوازن'
                  : 'Balanced'}
              </span>
            </div>
          </div>
        </div>

        {!isOrgWorkspace && (
          <div className="p-3.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-muted)]">
                <PiggyBank className="w-3.5 h-3.5 text-[var(--color-gold-text)]" />
                <span>{isRTL ? 'معدل الادخار' : 'Savings Rate'}</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className={`text-base font-extrabold num-tabular ${
                    cashflowMetrics.savingsRatePct === null
                      ? 'text-[var(--color-muted)]'
                      : cashflowMetrics.savingsRatePct >= 0
                      ? 'text-[var(--color-income)]'
                      : 'text-[var(--color-expense)]'
                  }`}
                >
                  {cashflowMetrics.savingsRatePct === null
                    ? '—'
                    : `${cashflowMetrics.savingsRatePct > 0 ? '+' : ''}${formatDisplayNumber(
                        cashflowMetrics.savingsRatePct,
                        1,
                        settings.digitFormat
                      )}%`}
                </span>
                <span className="text-[11px] text-[var(--color-muted)]">
                  {cashflowMetrics.savingsRatePct === null
                    ? isRTL
                      ? 'لا يوجد دخل بالفترة'
                      : 'No income in range'
                    : isRTL
                    ? 'من إجمالي الدخل'
                    : 'of income'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Income vs Expense Comparative Gauge */}
      <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl space-y-3">
        <div className="flex items-center justify-between text-xs font-medium">
          <span className="text-[var(--color-muted)]">
            {isRTL ? 'مقارنة الدخل والمصروف' : 'Income vs Expense'}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--color-muted)]">{isRTL ? 'الصافي:' : 'Net:'}</span>
            <MoneyText
              amount={netBalance}
              currency={settings.mainCurrency}
              showSign={true}
              colorByType={true}
              type={netBalance >= 0 ? 'income' : 'expense'}
              className="font-bold text-xs"
            />
          </div>
        </div>

        {/* Comparison Bar */}
        <div className="w-full h-2 rounded-full bg-[var(--color-bg)] border border-[var(--color-line)] overflow-hidden flex">
          {totalIncome + totalExpense > 0 ? (
            <>
              <div
                style={{ width: `${(totalIncome / (totalIncome + totalExpense)) * 100}%` }}
                className="bg-[var(--color-income)] transition-all duration-300"
              />
              <div
                style={{ width: `${(totalExpense / (totalIncome + totalExpense)) * 100}%` }}
                className="bg-[var(--color-expense)] transition-all duration-300"
              />
            </>
          ) : (
            <div className="w-full bg-[var(--color-line)]" />
          )}
        </div>

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-[var(--color-income)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-income)]" />
            <span className="text-[var(--color-muted)]">{isRTL ? 'دخل:' : 'Income:'}</span>
            <MoneyText
              amount={totalIncome}
              currency={settings.mainCurrency}
              type="income"
              colorByType={true}
              className="font-medium"
            />
          </div>

          <div className="flex items-center gap-1.5 text-[var(--color-expense)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-expense)]" />
            <span className="text-[var(--color-muted)]">{isRTL ? 'مصروف:' : 'Expense:'}</span>
            <MoneyText
              amount={totalExpense}
              currency={settings.mainCurrency}
              type="expense"
              colorByType={true}
              className="font-medium"
            />
          </div>
        </div>
      </div>

      {/* Month-End Forecast Card */}
      <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <HairlineFigure
            figure="plot"
            surface="surface"
            tone="accent"
            intensity={0.78}
            stroke={1.05}
            label={isRTL ? 'توقع مصروف نهاية الشهر' : 'Month-End Spend Forecast'}
            className="w-16 shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
              <TrendingUp className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
              <span>{isRTL ? 'توقع مصروف نهاية الشهر' : 'Month-End Spend Forecast'}</span>
            </div>
            <div className="text-[11px] text-[var(--color-muted)] mt-1">
              {isRTL
                ? `المتوسط اليومي: ${monthEndForecast.dailyAverage} ${settings.mainCurrency} (${monthEndForecast.daysElapsed} / ${monthEndForecast.totalDaysInMonth} يوم)`
                : `Daily avg: ${monthEndForecast.dailyAverage} ${settings.mainCurrency} (${monthEndForecast.daysElapsed}/${monthEndForecast.totalDaysInMonth} days)`}
            </div>
          </div>
        </div>
        <div className="text-end shrink-0">
          <span className="text-[10px] text-[var(--color-muted)] block">
            {isRTL ? 'الإجمالي المتوقع' : 'Projected'}
          </span>
          <MoneyText
            amount={monthEndForecast.projectedTotal}
            currency={settings.mainCurrency}
            className="text-base font-bold text-[var(--color-accent)]"
          />
        </div>
      </div>

      {/* Sub-view Switcher Pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        {[
          { id: 'category', label: isRTL ? 'حسب التصنيف' : 'By Category', icon: PieIcon, pro: false },
          { id: 'priority', label: isRTL ? 'حسب الأولوية' : 'By Priority', icon: ShieldAlert, pro: true },
          { id: 'wallets', label: isRTL ? 'مقارنة المحافظ' : 'Wallets Comparison', icon: WalletIcon, pro: true },
        ].map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeStatView === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.pro && !isPro) {
                  setIsUpgradeModalOpen(true);
                  return;
                }
                setActiveStatView(tab.id as any);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors border ${
                isSelected
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] shadow-xs'
                  : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.pro && !isPro && (
                <Crown className="w-3 h-3 text-[var(--color-warning-text)] ms-0.5" />
              )}
            </button>
          );
        })}
      </div>

      {/* 1. Category View (Doughnut Chart + Top List) */}
      {activeStatView === 'category' && (
        <div className="space-y-4">
          {categoryStats.length === 0 ? (
            <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
              <HairlineEmptyState
                figure="plot"
                surface="surface"
                title={isRTL ? 'لا توجد بيانات إحصائية بعد' : 'No statistical data yet'}
                description={
                  isRTL
                    ? 'لا توجد مصاريف مسجلة في هذه الفترة الزمنية لعرض الرسم البياني.'
                    : 'No expenses recorded in this period to display chart insights.'
                }
              />
            </div>
          ) : (
            <>
              {/* Doughnut Chart Card */}
              <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-around">
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 42 42" className="w-full h-full -rotate-90">
                    <circle
                      cx="21"
                      cy="21"
                      r="15.91549430918954"
                      fill="transparent"
                      stroke="var(--color-line)"
                      strokeWidth="6"
                    />
                    {doughnutSegments.map((seg, i) => (
                      <circle
                        key={i}
                        cx="21"
                        cy="21"
                        r="15.91549430918954"
                        fill="transparent"
                        stroke={seg.color}
                        strokeWidth="6"
                        strokeDasharray={seg.strokeDash}
                        strokeDashoffset={seg.strokeDashoffset}
                      />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] text-[var(--color-muted)]">
                      {isRTL ? 'إجمالي الصرف' : 'Total Expense'}
                    </span>
                    <MoneyText
                      amount={totalExpense}
                      currency={settings.mainCurrency}
                      className="text-xs font-bold text-[var(--color-ink)]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 max-w-[150px]">
                  {doughnutSegments.slice(0, 4).map((seg, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                      <span className="text-[var(--color-ink)] truncate text-[11px]">
                        {isRTL ? seg.cat?.nameAr : seg.cat?.nameEn}
                      </span>
                      <span className="text-[10px] text-[var(--color-muted)] font-mono">{seg.percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Progress Breakdown List */}
              <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl space-y-3">
                <h3 className="text-xs font-bold text-[var(--color-ink)]">
                  {isRTL ? 'أعلى التصنيفات إنفاقاً' : 'Top Spending Categories'}
                </h3>
                <div className="space-y-2.5">
                  {categoryStats.map((item) => (
                    <div key={item.catId} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="font-medium text-[var(--color-ink)]">
                            {isRTL ? item.cat?.nameAr : item.cat?.nameEn}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MoneyText
                            amount={item.amount}
                            currency={settings.mainCurrency}
                            className="font-bold text-[var(--color-ink)] text-xs"
                          />
                          <span className="text-[10px] text-[var(--color-muted)] font-mono w-7 text-left">
                            {item.percentage}%
                          </span>
                        </div>
                      </div>

                      {/* Bar */}
                      <div className="w-full h-1.5 rounded-full bg-[var(--color-bg)] border border-[var(--color-line)] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${item.percentage}%`,
                            backgroundColor: item.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 2. Priority View */}
      {activeStatView === 'priority' && (
        <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl space-y-4">
          <h3 className="text-xs font-bold text-[var(--color-ink)]">
            {isRTL ? 'توزيع المصاريف حسب الأولوية المالية' : 'Expense Breakdown by Priority'}
          </h3>

          <div className="space-y-3">
            {/* Essential */}
            <div className="p-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-expense)]" />
                  <span className="font-bold text-[var(--color-ink)]">
                    {t('priorityEssential')} {isRTL ? '(فواتير، تموين، مسكن)' : '(Bills, groceries, rent)'}
                  </span>
                </div>
                <span className="font-mono font-bold text-[var(--color-expense)]">
                  {priorityStats.essential.pct}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-line)] overflow-hidden">
                <div
                  className="h-full bg-[var(--color-expense)] rounded-full"
                  style={{ width: `${priorityStats.essential.pct}%` }}
                />
              </div>
              <div className="text-[11px] text-[var(--color-muted)]">
                <MoneyText
                  amount={priorityStats.essential.amount}
                  currency={settings.mainCurrency}
                  className="text-xs"
                />
              </div>
            </div>

            {/* Normal */}
            <div className="p-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent)]" />
                  <span className="font-bold text-[var(--color-ink)]">
                    {t('priorityNormal')} {isRTL ? '(مشتريات دورية، التزامات)' : '(Regular purchases)'}
                  </span>
                </div>
                <span className="font-mono font-bold text-[var(--color-accent)]">
                  {priorityStats.normal.pct}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-line)] overflow-hidden">
                <div
                  className="h-full bg-[var(--color-accent)] rounded-full"
                  style={{ width: `${priorityStats.normal.pct}%` }}
                />
              </div>
              <div className="text-[11px] text-[var(--color-muted)]">
                <MoneyText
                  amount={priorityStats.normal.amount}
                  currency={settings.mainCurrency}
                  className="text-xs"
                />
              </div>
            </div>

            {/* Leisure */}
            <div className="p-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-warning)]" />
                  <span className="font-bold text-[var(--color-ink)]">
                    {t('priorityLeisure')} {isRTL ? '(مطاعم، ترفيه، كافيهات)' : '(Dining, leisure)'}
                  </span>
                </div>
                <span className="font-mono font-bold text-[var(--color-warning-text)]">
                  {priorityStats.leisure.pct}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-line)] overflow-hidden">
                <div
                  className="h-full bg-[var(--color-warning)] rounded-full"
                  style={{ width: `${priorityStats.leisure.pct}%` }}
                />
              </div>
              <div className="text-[11px] text-[var(--color-muted)]">
                <MoneyText
                  amount={priorityStats.leisure.amount}
                  currency={settings.mainCurrency}
                  className="text-xs"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Wallets Comparison View */}
      {activeStatView === 'wallets' && (
        <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl space-y-3">
          <h3 className="text-xs font-bold text-[var(--color-ink)]">
            {isRTL ? 'مقارنة حركة المحافظ والحسابات' : 'Wallets Comparison'}
          </h3>
          <div className="space-y-2">
            {walletStats.map((item) => (
              <div
                key={item.wallet.id}
                className="p-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between"
              >
                <div>
                  <div className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                    <IconRenderer name={item.wallet.icon || 'Wallet'} className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                    <span>{item.wallet.name}</span>
                  </div>
                  <div className="text-[10px] text-[var(--color-muted)] mt-0.5">
                    {isRTL ? `عملة المحفظة: ${item.wallet.currency}` : `Wallet Currency: ${item.wallet.currency}`}
                  </div>
                </div>

                <div className="text-right text-xs">
                  <div className="font-medium">
                    <MoneyText
                      amount={item.income}
                      currency={settings.mainCurrency}
                      showSign={true}
                      type="income"
                      colorByType={true}
                      className="text-xs"
                    />
                  </div>
                  <div className="font-medium mt-0.5">
                    <MoneyText
                      amount={item.expense}
                      currency={settings.mainCurrency}
                      showSign={true}
                      type="expense"
                      colorByType={true}
                      className="text-xs"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AdBanner variant="banner" />
    </div>
  );
};
