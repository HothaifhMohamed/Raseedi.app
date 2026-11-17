import React from 'react';
import { ArrowDown, ArrowUp, EyeOff, Lock } from 'lucide-react';
import { Wallet } from '../../types';
import { convertCurrency } from '../../services/currency';
import { IconRenderer } from '../common/IconRenderer';
import { MoneyText } from '../common/MoneyText';

interface WalletCardProps {
  wallet: Wallet;
  index: number;
  totalCount: number;
  isReorderMode: boolean;
  isLocked: boolean;
  isHidden: boolean;
  mainCurrency: string;
  customExchangeRates?: Record<string, number>;
  isOrgWorkspace: boolean;
  custodianName?: string;
  isRTL: boolean;
  onClick: () => void;
  onMove: (direction: 'up' | 'down') => void;
}

export const WalletCard: React.FC<WalletCardProps> = ({
  wallet: w,
  index,
  totalCount,
  isReorderMode,
  isLocked,
  isHidden,
  mainCurrency,
  customExchangeRates,
  isOrgWorkspace,
  custodianName,
  isRTL,
  onClick,
  onMove,
}) => {
  const cardColor = w.color?.startsWith('#') ? w.color : '#0E5A43';
  const isExcluded = Boolean(w.excludeFromTotal);

  const secondaryMeta = [
    w.isArchived ? (isRTL ? 'متوقفة مؤقتاً' : 'Paused') : null,
    isOrgWorkspace && w.walletType === 'petty_cash'
      ? custodianName
        ? `${isRTL ? 'عُهدة' : 'Custody'}: ${custodianName}`
        : isRTL
        ? 'عُهدة نثرية'
        : 'Petty Cash'
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const statusClasses = isExcluded
    ? w.isArchived
      ? 'opacity-65 grayscale-[45%] border-2 border-dashed border-white/40'
      : 'opacity-70 grayscale-[35%] border-2 border-dashed border-white/45'
    : w.isArchived
    ? 'opacity-75 grayscale-[25%] border border-white/15'
    : 'border border-white/15';

  return (
    <div
      data-wallet-id={w.id}
      data-excluded={isExcluded ? 'true' : 'false'}
      role={isReorderMode ? undefined : 'button'}
      tabIndex={isReorderMode ? undefined : 0}
      onClick={() => {
        if (!isReorderMode) onClick();
      }}
      onKeyDown={(e) => {
        if (!isReorderMode && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`relative overflow-hidden rounded-2xl p-5 min-h-[154px] flex flex-col justify-between text-white select-none shadow-[0_12px_28px_-10px_rgba(9,50,37,0.35)] transition-all duration-300 ${
        isReorderMode
          ? 'cursor-default ring-2 ring-[var(--color-accent)]/50'
          : 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-10px_rgba(9,50,37,0.45)] active:scale-[0.985]'
      } ${statusClasses}`}
      style={{
        background: `linear-gradient(135deg, ${cardColor} 0%, color-mix(in srgb, ${cardColor} 74%, #061A14) 100%)`,
      }}
    >
      {/* Subtle Gold Shimmer & Card Surface Accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -end-12 w-36 h-36 rounded-full bg-[#E2B954]/20 blur-2xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 pattern-wallet-lines opacity-65"
      />

      {/* Top Row: Wallet Icon + Name + Excluded Badge + Currency (or Reorder Controls) */}
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white/14 border border-white/20 backdrop-blur-xs flex items-center justify-center shrink-0">
            <IconRenderer name={w.icon || 'Wallet'} className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold tracking-tight leading-snug text-white truncate">
                {w.name}
              </h3>
              {isExcluded && (
                <span
                  data-testid="wallet-excluded-badge"
                  className="inline-flex items-center gap-1 bg-black/20 px-2 py-1 rounded-md text-xs font-semibold text-white/95 shrink-0"
                >
                  <EyeOff className="w-3.5 h-3.5 shrink-0" />
                  <span>{isRTL ? 'مستثناة' : 'Excluded'}</span>
                </span>
              )}
            </div>
            {secondaryMeta && (
              <div className="text-[11px] text-white/80 truncate mt-0.5">{secondaryMeta}</div>
            )}
          </div>
        </div>

        {isReorderMode ? (
          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <span className="text-[11px] font-mono font-bold px-2 py-1 rounded-lg bg-black/25 text-white/95 num-tabular">
              #{index + 1}
            </span>
            <button
              type="button"
              onClick={() => onMove('up')}
              disabled={index === 0}
              aria-label={isRTL ? `نقل ${w.name} لأعلى` : `Move ${w.name} up`}
              className={`p-2 rounded-xl bg-black/30 min-h-[40px] min-w-[40px] flex items-center justify-center transition-all duration-300 ${
                index === 0
                  ? 'opacity-35 cursor-not-allowed'
                  : 'hover:bg-black/45 active:scale-95 text-white'
              }`}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onMove('down')}
              disabled={index === totalCount - 1}
              aria-label={isRTL ? `نقل ${w.name} لأسفل` : `Move ${w.name} down`}
              className={`p-2 rounded-xl bg-black/30 min-h-[40px] min-w-[40px] flex items-center justify-center transition-all duration-300 ${
                index === totalCount - 1
                  ? 'opacity-35 cursor-not-allowed'
                  : 'hover:bg-black/45 active:scale-95 text-white'
              }`}
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <span
            className="font-mono text-xs font-bold tracking-wider text-[#F4E3B2] shrink-0 pt-0.5"
            dir="ltr"
          >
            {w.currency}
          </span>
        )}
      </div>

      {/* Bottom Row: Prominent Balance & Subtle Contactless Smart Chip */}
      <div className="relative flex items-end justify-between gap-3 pt-4 mt-2 border-t border-white/15">
        <div className="min-w-0 flex-1">
          <span className="text-[11px] text-white/80 block mb-0.5">
            {isRTL ? 'الرصيد المتاح' : 'Available Balance'}
          </span>
          <div className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            {isLocked ? (
              <span className="inline-flex items-center gap-1.5 text-lg font-bold text-[#F4E3B2]">
                <Lock className="w-4 h-4 shrink-0" />
                <span>
                  {isRTL ? (
                    <>
                      محمية برمز <bdi dir="ltr">PIN</bdi>
                    </>
                  ) : (
                    'PIN Protected'
                  )}
                </span>
              </span>
            ) : isHidden ? (
              <span className="num-tabular tracking-widest">••••••••</span>
            ) : (
              <>
                <MoneyText
                  amount={w.balance}
                  currency={w.currency}
                  className="text-2xl sm:text-3xl font-bold text-white tracking-tight"
                />
                {w.currency !== mainCurrency && (
                  <div className="text-[11px] text-[#F4E3B2]/95 mt-0.5 num-tabular font-medium">
                    ≈{' '}
                    <MoneyText
                      amount={convertCurrency(w.balance, w.currency, mainCurrency, customExchangeRates)}
                      currency={mainCurrency}
                      className="text-[11px] font-semibold text-[#F4E3B2]"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Subtle Contactless NFC & Smart Chip Emblem */}
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-1.5 text-white/40 shrink-0 pb-0.5 pointer-events-none select-none"
        >
          <svg
            viewBox="0 0 28 20"
            fill="none"
            className="w-7 h-5"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="1"
              y="1"
              width="26"
              height="18"
              rx="3.5"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M9 1V19M19 1V19M1 7H9M1 13H9M19 7H27M19 13H27M9 10H19"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          <svg
            viewBox="0 0 18 20"
            fill="none"
            className="w-4 h-4"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4.5 7.5C5.8 8.9 5.8 11.1 4.5 12.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M8.5 5C10.9 7.7 10.9 12.3 8.5 15"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M12.5 2.5C16.1 6.6 16.1 13.4 12.5 17.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>
    </div>
  );
};
