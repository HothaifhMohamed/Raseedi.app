import React, { useState, useMemo } from 'react';
import { FileText, Download, Printer, X, Lock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  doesTransactionAffectAccounting,
  getEffectiveTransactionAmount,
  getTransactionsInDateRange,
} from '../../services/calculations';
import { convertCurrency } from '../../services/currency';
import { escapeCsvCell } from '../../services/csvEscape';
import { MoneyText } from '../common/MoneyText';
import { HairlineFigure } from '../common/HairlineVisuals';
import { BrandLogo } from '../common/BrandLogo';
import { indexById, paginateList } from '../../services/lookupCache';

interface ReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ReportsModal: React.FC<ReportsModalProps> = ({ isOpen, onClose }) => {
  const { transactions, categories, wallets, settings, isPro, setIsUpgradeModalOpen, t, isRTL } = useApp();

  const [period, setPeriod] = useState<'weekly' | 'monthly'>('monthly');
  const [visibleRows, setVisibleRows] = useState<number>(30);

  const categoriesById = useMemo(() => indexById(categories), [categories]);
  const walletsById = useMemo(() => indexById(wallets), [wallets]);

  // Compute date range
  const { startDate, endDate, periodLabel } = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');

    if (period === 'weekly') {
      const diff = now.getDate() - now.getDay();
      const weekStart = new Date(now.setDate(diff));
      const s = `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}`;
      const e = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      return { startDate: s, endDate: e, periodLabel: isRTL ? 'التقرير المالي الأسبوعي' : 'Weekly Financial Report' };
    } else {
      const s = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
      const e = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      return { startDate: s, endDate: e, periodLabel: isRTL ? 'التقرير المالي الشهري' : 'Monthly Financial Report' };
    }
  }, [period, isRTL]);

  const reportTransactions = useMemo(() => {
    return getTransactionsInDateRange(transactions, startDate, endDate);
  }, [transactions, startDate, endDate]);

  const paginatedReportRows = useMemo(
    () => paginateList(reportTransactions, visibleRows),
    [reportTransactions, visibleRows]
  );

  const { incomeTotal, expenseTotal, netTotal } = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const tx of reportTransactions) {
      if (!doesTransactionAffectAccounting(tx) || tx.type === 'transfer') continue;
      const inMain = convertCurrency(
        getEffectiveTransactionAmount(tx),
        tx.currency,
        settings.mainCurrency,
        settings.customExchangeRates
      );
      if (tx.type === 'income') inc += inMain;
      if (tx.type === 'expense') exp += inMain;
    }
    return { incomeTotal: inc, expenseTotal: exp, netTotal: inc - exp };
  }, [reportTransactions, settings.mainCurrency, settings.customExchangeRates]);

  const executeExportCSV = () => {
    const headers = ['التاريخ', 'الوقت', 'النوع', 'المبلغ', 'العملة', 'المحفظة', 'التصنيف', 'الأولوية', 'الملاحظات'];
    const rows = reportTransactions.map((tx) => {
      const cat = categoriesById.get(tx.categoryId);
      const w = walletsById.get(tx.walletId);
      return [
        tx.date,
        tx.time,
        tx.type === 'expense' ? 'مصروف' : tx.type === 'income' ? 'دخل' : 'تحويل',
        tx.amount,
        tx.currency,
        w?.name || '',
        cat?.nameAr || '',
        tx.priority,
        tx.notes || '',
      ]
        .map(escapeCsvCell)
        .join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `raseedi-report-${period}-${startDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Pro-gated Export CSV
  const handleExportCSV = () => {
    if (!isPro) {
      setIsUpgradeModalOpen(true);
      return;
    }
    executeExportCSV();
  };

  // Pro-gated Print PDF
  const handlePrint = () => {
    if (!isPro) {
      setIsUpgradeModalOpen(true);
      return;
    }
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:p-0 print:bg-white print:text-black">
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl text-[var(--color-ink)] shadow-xl overflow-hidden print:max-w-none print:max-h-none print:border-none print:shadow-none print:bg-white print:text-black">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-line)] bg-[var(--color-bg)] print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[var(--color-accent)]" />
            <h3 className="text-sm font-bold text-[var(--color-ink)]">{t('reports')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Interactive Preview Accent Card (hidden in print) */}
          <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between gap-3 print:hidden">
            <div className="min-w-0">
              <div className="text-xs font-bold text-[var(--color-ink)]">{periodLabel}</div>
              <div className="text-[11px] text-[var(--color-muted)] mt-0.5 num-tabular">
                {startDate} — {endDate}
              </div>
            </div>
            <HairlineFigure
              figure="plot"
              surface="bg"
              tone="accent"
              intensity={0.78}
              stroke={1.05}
              label={periodLabel}
              className="w-16 shrink-0"
            />
          </div>

          {/* Period Toggle & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <div className="flex items-center gap-1 p-1 bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
              <button
                onClick={() => {
                  setPeriod('weekly');
                  setVisibleRows(30);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors min-h-[36px] ${
                  period === 'weekly'
                    ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {isRTL ? 'تقرير أسبوعي' : 'Weekly'}
              </button>
              <button
                onClick={() => {
                  setPeriod('monthly');
                  setVisibleRows(30);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors min-h-[36px] ${
                  period === 'monthly'
                    ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {isRTL ? 'تقرير شهري' : 'Monthly'}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] rounded-lg text-xs font-medium min-h-[36px]"
              >
                {!isPro && <Lock className="w-3 h-3 text-[var(--color-warning-text)]" />}
                <Printer className="w-3.5 h-3.5" />
                <span>{isRTL ? <>طباعة <bdi dir="ltr">PDF</bdi></> : 'Print PDF'}</span>
              </button>
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] rounded-lg text-xs font-semibold min-h-[36px]"
              >
                {!isPro && <Lock className="w-3 h-3" />}
                <Download className="w-3.5 h-3.5" />
                <bdi dir="ltr">Excel / CSV</bdi>
              </button>
            </div>
          </div>

          {/* Printable Report Card */}
          <div className="p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] print:bg-white print:border-black print:text-black space-y-4">
            <div className="border-b pb-3 border-[var(--color-line)] print:border-black flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <BrandLogo
                  className="w-10 h-10 rounded-xl object-cover shadow-sm shrink-0"
                  title={t('appName')}
                  lazy={true}
                />
                <div className="min-w-0">
                  <h1 className="text-base font-bold text-[var(--color-ink)] print:text-black">
                    {t('appName')} — {periodLabel}
                  </h1>
                  <p className="text-xs text-[var(--color-muted)] print:text-gray-600 mt-0.5">
                    {isRTL ? `الفترة من ${startDate} إلى ${endDate}` : `From ${startDate} to ${endDate}`}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-[var(--color-accent)] print:text-black font-mono">
                  {reportTransactions.length} {isRTL ? 'معاملة مسجلة' : 'transactions'}
                </span>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg print:border-gray-300">
                <span className="text-[11px] text-[var(--color-income)] block mb-1">
                  {isRTL ? 'إجمالي الدخل' : 'Total Income'}
                </span>
                <MoneyText
                  amount={incomeTotal}
                  currency={settings.mainCurrency}
                  type="income"
                  colorByType={true}
                  className="text-xs font-bold"
                />
              </div>
              <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg print:border-gray-300">
                <span className="text-[11px] text-[var(--color-expense)] block mb-1">
                  {isRTL ? 'إجمالي المصروف' : 'Total Expense'}
                </span>
                <MoneyText
                  amount={expenseTotal}
                  currency={settings.mainCurrency}
                  type="expense"
                  colorByType={true}
                  className="text-xs font-bold"
                />
              </div>
              <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg print:border-gray-300">
                <span className="text-[11px] text-[var(--color-muted)] block mb-1">
                  {isRTL ? 'الصافي المالي' : 'Net'}
                </span>
                <MoneyText
                  amount={netTotal}
                  currency={settings.mainCurrency}
                  showSign={true}
                  type={netTotal >= 0 ? 'income' : 'expense'}
                  colorByType={true}
                  className="text-xs font-bold"
                />
              </div>
            </div>

            {/* Transactions Table */}
            <div className="space-y-1.5 pt-2">
              <h4 className="text-xs font-bold text-[var(--color-ink)] print:text-black">
                {isRTL ? 'تفاصيل المعاملات:' : 'Transaction Details:'}
              </h4>
              <div className="max-h-60 overflow-y-auto print:max-h-none divide-y divide-[var(--color-line)] print:divide-gray-300 text-xs">
                {paginatedReportRows.visibleItems.map((tx) => {
                  const cat = categoriesById.get(tx.categoryId);
                  return (
                    <div key={tx.id} className="py-2 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-[var(--color-ink)] print:text-black">
                          {isRTL ? cat?.nameAr : cat?.nameEn || tx.notes}
                        </div>
                        <div className="text-[10px] text-[var(--color-muted)] print:text-gray-500">
                          {tx.date} {tx.notes ? `• ${tx.notes}` : ''}
                        </div>
                      </div>
                      <MoneyText
                        amount={tx.amount}
                        currency={tx.currency}
                        type={tx.type}
                        showSign={true}
                        colorByType={true}
                        className="text-xs font-bold"
                      />
                    </div>
                  );
                })}
              </div>
              {paginatedReportRows.hasMore && (
                <button
                  type="button"
                  onClick={() => setVisibleRows((prev) => prev + 50)}
                  className="w-full mt-2 py-2 px-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[11px] font-semibold text-[var(--color-accent)] transition-colors print:hidden min-h-[38px]"
                >
                  {isRTL
                    ? `عرض المزيد (${paginatedReportRows.remainingCount} متبقي)`
                    : `Show more (${paginatedReportRows.remainingCount} remaining)`}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-[var(--color-line)] bg-[var(--color-bg)] print:hidden">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-[var(--color-surface)] border border-[var(--color-line)] hover:bg-[var(--color-bg)] font-semibold rounded-lg text-xs text-[var(--color-ink)] min-h-[44px]"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
};
