/**
 * Personal Net Worth Card with Spendable vs Owned Assets vs Debt breakdown
 * and interactive 1M / 3M / 1Y / All SVG trend chart.
 */
import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Landmark,
  Wallet as WalletIcon,
  CreditCard,
  Plus,
  Coins,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatCurrencyAmount, formatDisplayNumber } from '../../services/calculations';
import {
  buildNetWorthSeries,
  calculateWealthBreakdown,
} from '../../services/wealthAnalytics';
import { NetWorthTimeframe } from '../../types';

interface NetWorthCardProps {
  onOpenWallets?: () => void;
  onOpenDebts?: () => void;
}

const TIMEFRAMES: { id: NetWorthTimeframe; labelAr: string; labelEn: string }[] = [
  { id: '1M', labelAr: 'شهر', labelEn: '1M' },
  { id: '3M', labelAr: '٣ شهور', labelEn: '3M' },
  { id: '1Y', labelAr: 'سنة', labelEn: '1Y' },
  { id: 'ALL', labelAr: 'الكل', labelEn: 'All' },
];

export const NetWorthCard: React.FC<NetWorthCardProps> = ({
  onOpenWallets,
  onOpenDebts,
}) => {
  const { wallets, debts, transactions, settings, isRTL } = useApp();
  const [timeframe, setTimeframe] = useState<NetWorthTimeframe>('3M');

  const hideAmounts = settings.showCurrentBalance === false;
  const fmt = (val: number) =>
    hideAmounts
      ? '••••'
      : formatCurrencyAmount(val, settings.mainCurrency, {
          decimalPlaces: settings.decimalPlaces,
          digitFormat: settings.digitFormat,
          language: settings.language,
        });

  const breakdown = useMemo(
    () =>
      calculateWealthBreakdown({
        wallets,
        debts,
        mainCurrency: settings.mainCurrency,
        customRates: settings.customExchangeRates,
      }),
    [wallets, debts, settings.mainCurrency, settings.customExchangeRates]
  );

  const series = useMemo(
    () =>
      buildNetWorthSeries({
        timeframe,
        currentNetWorth: breakdown.netWorth,
        transactions,
        mainCurrency: settings.mainCurrency,
        customRates: settings.customExchangeRates,
        language: settings.language,
      }),
    [
      timeframe,
      breakdown.netWorth,
      transactions,
      settings.mainCurrency,
      settings.customExchangeRates,
      settings.language,
    ]
  );

  // Build crisp responsive SVG path for net worth trajectory
  const chartGeometry = useMemo(() => {
    const pts = series.points;
    const width = 320;
    const height = 84;
    const padX = 6;
    const padY = 10;
    if (pts.length < 2) {
      return { linePath: '', areaPath: '', lastX: width - padX, lastY: height / 2, width, height };
    }
    const values = pts.map((p) => p.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal;

    const coords = pts.map((p, idx) => {
      const x = padX + (idx / (pts.length - 1)) * (width - padX * 2);
      const normY = range < 0.001 ? 0.5 : (p.value - minVal) / range;
      const y = height - padY - normY * (height - padY * 2);
      return { x, y };
    });

    const linePath = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(' ');
    const last = coords[coords.length - 1];
    const first = coords[0];
    const areaPath = `${linePath} L ${last.x.toFixed(1)} ${(height - 2).toFixed(1)} L ${first.x.toFixed(1)} ${(height - 2).toFixed(1)} Z`;

    return { linePath, areaPath, lastX: last.x, lastY: last.y, width, height };
  }, [series.points]);

  const isPositiveDelta = series.delta >= 0;

  return (
    <section
      data-testid="net-worth-card"
      className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-3xl p-4 sm:p-5 shadow-sm"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-muted)]">
            <Landmark className="w-4 h-4 text-[var(--color-gold-text)] shrink-0" />
            <span>{isRTL ? 'صافي الثروة' : 'Net Worth'}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
            <p
              data-testid="net-worth-value"
              className="text-2xl sm:text-3xl font-extrabold text-[var(--color-ink)] num-tabular tracking-tight"
            >
              {fmt(breakdown.netWorth)}
            </p>
            {!hideAmounts && (
              <span
                className={`inline-flex items-center gap-0.5 text-xs font-bold num-tabular ${
                  isPositiveDelta
                    ? 'text-[var(--color-income)]'
                    : 'text-[var(--color-expense)]'
                }`}
              >
                {isPositiveDelta ? (
                  <ArrowUpRight className="w-3.5 h-3.5" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5" />
                )}
                {isPositiveDelta ? '+' : ''}
                {fmt(series.delta)}
                {series.deltaPct !== null && (
                  <span className="opacity-85">
                    ({isPositiveDelta ? '+' : ''}
                    {formatDisplayNumber(series.deltaPct, 1, settings.digitFormat)}%)
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Timeframe Segmented Switcher */}
        <div
          role="group"
          aria-label={isRTL ? 'الفترة الزمنية لصافي الثروة' : 'Net worth timeframe'}
          className="inline-flex items-center rounded-xl bg-[var(--color-surface-subtle)] p-1 border border-[var(--color-line)]"
        >
          {TIMEFRAMES.map((tf) => {
            const active = timeframe === tf.id;
            return (
              <button
                key={tf.id}
                type="button"
                data-testid={`net-worth-tf-${tf.id}`}
                onClick={() => setTimeframe(tf.id)}
                className={`px-2.5 py-1.5 min-h-[34px] rounded-lg text-xs font-bold transition-colors ${
                  active
                    ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {isRTL ? tf.labelAr : tf.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {/* Trend Chart */}
      <div className="mt-3 pt-1">
        <div className="relative w-full h-[88px] overflow-visible" dir="ltr">
          <svg
            viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
            preserveAspectRatio="none"
            className="w-full h-full overflow-hidden"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="raseediNetWorthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={isPositiveDelta ? 'var(--color-accent)' : 'var(--color-expense)'}
                  stopOpacity="0.24"
                />
                <stop
                  offset="100%"
                  stopColor={isPositiveDelta ? 'var(--color-accent)' : 'var(--color-expense)'}
                  stopOpacity="0.0"
                />
              </linearGradient>
            </defs>
            {chartGeometry.areaPath && (
              <path d={chartGeometry.areaPath} fill="url(#raseediNetWorthGrad)" />
            )}
            {chartGeometry.linePath && (
              <path
                d={chartGeometry.linePath}
                fill="none"
                stroke={isPositiveDelta ? 'var(--color-accent)' : 'var(--color-expense)'}
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {series.points.length >= 2 && (
            <span
              aria-hidden="true"
              style={{
                left: `${(chartGeometry.lastX / chartGeometry.width) * 100}%`,
                top: `${(chartGeometry.lastY / chartGeometry.height) * 100}%`,
              }}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[var(--color-gold)] ring-2 ring-[var(--color-surface)] shadow-xs"
            />
          )}
        </div>
        {series.points.length >= 2 && (
          <div
            dir="ltr"
            data-testid="net-worth-axis-labels"
            className="flex items-center justify-between text-[11px] text-[var(--color-muted)] font-medium mt-1 num-tabular"
          >
            <span>{series.points[0].label}</span>
            <span>{series.points[Math.floor(series.points.length / 2)].label}</span>
            <span>{series.points[series.points.length - 1].label}</span>
          </div>
        )}
      </div>

      {/* Assets vs Debt & Spendable vs Owned Assets Breakdown */}
      <div className="mt-4 pt-3.5 border-t border-[var(--color-line)] grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <button
          type="button"
          onClick={onOpenWallets}
          className="text-start rounded-2xl bg-[var(--color-surface-subtle)] hover:border-[var(--color-accent)]/50 border border-[var(--color-line)] px-3.5 py-2.5 transition-colors min-h-[44px]"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-muted)]">
            <WalletIcon className="w-3.5 h-3.5 text-[var(--color-accent)]" />
            <span>{isRTL ? 'متاح للصرف (سيولة)' : 'Spendable Cash'}</span>
          </div>
          <p className="mt-1 text-sm font-extrabold text-[var(--color-ink)] num-tabular">
            {fmt(breakdown.spendableTotal)}
          </p>
        </button>

        <button
          type="button"
          onClick={onOpenWallets}
          className="text-start rounded-2xl bg-[var(--color-surface-subtle)] hover:border-[var(--color-gold)]/60 border border-[var(--color-line)] px-3.5 py-2.5 transition-colors min-h-[44px]"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-muted)]">
            <Coins className="w-3.5 h-3.5 text-[var(--color-gold-text)]" />
            <span>{isRTL ? 'أصول ومدخرات وممتلكات' : 'Owned Assets'}</span>
          </div>
          <p className="mt-1 text-sm font-extrabold text-[var(--color-ink)] num-tabular">
            {fmt(breakdown.ownedAssetsTotal)}
          </p>
          {breakdown.ownedAssetsCount === 0 && (
            <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-accent)]">
              <Plus className="w-3 h-3" />
              {isRTL ? 'أضف ذهب أو شهادة أو عقار' : 'Add gold, CD, or asset'}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenDebts}
          className="text-start rounded-2xl bg-[var(--color-surface-subtle)] hover:border-[var(--color-expense)]/50 border border-[var(--color-line)] px-3.5 py-2.5 transition-colors min-h-[44px]"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-muted)]">
            <CreditCard className="w-3.5 h-3.5 text-[var(--color-expense)]" />
            <span>{isRTL ? 'الديون والالتزامات' : 'Total Debt'}</span>
          </div>
          <p className="mt-1 text-sm font-extrabold text-[var(--color-expense)] num-tabular">
            {fmt(breakdown.totalDebtIowe)}
          </p>
          <span className="text-[11px] text-[var(--color-muted)] font-medium num-tabular">
            {isRTL ? 'إجمالي الأصول: ' : 'Total Assets: '}
            {fmt(breakdown.totalAssets)}
          </span>
        </button>
      </div>
    </section>
  );
};
