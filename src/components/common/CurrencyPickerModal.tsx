import React, { useState, useMemo } from 'react';
import { Search, X, Check, RefreshCw } from 'lucide-react';
import { CURRENCIES } from '../../services/currency';
import { Currency } from '../../types';
import { useApp } from '../../context/AppContext';

interface CurrencyPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (currencyCode: string) => void;
  selectedCode?: string;
  title?: string;
}

export const CurrencyPickerModal: React.FC<CurrencyPickerModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  selectedCode,
  title,
}) => {
  const [search, setSearch] = useState('');
  const [rateFallbackMsg, setRateFallbackMsg] = useState<string | null>(null);
  const {
    isRTL,
    t,
    settings,
    ratesLastUpdated,
    isRefreshingRates,
    refreshExchangeRates,
  } = useApp();

  const handleRefreshFromPicker = async () => {
    setRateFallbackMsg(null);
    const ok = await refreshExchangeRates(true);
    if (!ok) {
      setRateFallbackMsg(
        isRTL
          ? 'تعذر جلب أحدث الأسعار، سيتم استخدام آخر أسعار محفوظة.'
          : 'Could not fetch latest rates, using last saved rates.'
      );
    }
  };

  const filteredCurrencies = useMemo(() => {
    if (!search.trim()) return CURRENCIES;
    const query = search.toLowerCase().trim();
    return CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(query) ||
        c.nameAr.toLowerCase().includes(query) ||
        c.nameEn.toLowerCase().includes(query) ||
        c.symbol.toLowerCase().includes(query)
    );
  }, [search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md max-h-[85vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl shadow-xl overflow-hidden text-[var(--color-ink)]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)] bg-[var(--color-bg)]">
          <h2 className="text-base font-bold text-[var(--color-ink)]">
            {title || t('mainCurrency')}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center"
            aria-label="Close currency picker"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search bar + Exchange Rate Status Strip */}
        <div className="p-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] space-y-2">
          <div className="relative">
            <Search className="absolute top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted)] start-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isRTL ? 'ابحث بالاسم أو الرمز (EGP, SAR, USD...)' : 'Search by name or code (EGP, SAR, USD...)'}
              className="w-full py-2.5 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] placeholder:text-[var(--color-muted)] ps-9 pe-8 focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25 min-h-[44px]"
              autoFocus
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute top-1/2 -translate-y-1/2 end-3 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[32px] min-w-[32px] flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-[var(--color-muted)]">
            <span>
              {settings.useUpdatedExchangeRates
                ? ratesLastUpdated
                  ? isRTL
                    ? `آخر تحديث للأسعار: ${ratesLastUpdated}`
                    : `Rates updated: ${ratesLastUpdated}`
                  : isRTL
                  ? 'أسعار مرجعية افتراضية (بدون اتصال)'
                  : 'Static fallback rates (offline)'
                : isRTL
                ? 'استخدام أسعار الصرف الثابتة'
                : 'Using static exchange rates'}
            </span>
            {settings.useUpdatedExchangeRates && (
              <button
                type="button"
                onClick={() => void handleRefreshFromPicker()}
                disabled={isRefreshingRates}
                className="inline-flex items-center gap-1 text-[var(--color-accent)] font-semibold hover:underline disabled:opacity-50 min-h-[28px]"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingRates ? 'animate-spin' : ''}`} />
                <span>{isRTL ? 'تحديث الآن' : 'Refresh'}</span>
              </button>
            )}
          </div>
          {rateFallbackMsg && (
            <div className="px-2.5 py-1.5 rounded-lg bg-[var(--color-warning)]/12 border border-[var(--color-warning)]/30 text-[11px] font-medium text-[var(--color-warning-text)]">
              {rateFallbackMsg}
            </div>
          )}
        </div>

        {/* Currency List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-line)] p-2">
          {filteredCurrencies.length === 0 ? (
            <div className="text-center py-10 text-[var(--color-muted)] text-xs">
              {isRTL ? 'لا توجد عملة مطابقة لبحثك' : 'No matching currencies'}
            </div>
          ) : (
            filteredCurrencies.map((curr: Currency) => {
              const isSelected = selectedCode === curr.code;
              return (
                <button
                  key={curr.code}
                  onClick={() => {
                    onSelect(curr.code);
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors min-h-[44px] ${
                    isSelected
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold'
                      : 'hover:bg-[var(--color-bg)] text-[var(--color-ink)]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl leading-none">{curr.flag}</span>
                    <div className="text-start">
                      <div className="text-xs font-semibold flex items-center gap-2">
                        <span>{isRTL ? curr.nameAr : curr.nameEn}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            isSelected
                              ? 'bg-[var(--color-on-accent)]/15 text-[var(--color-on-accent)]'
                              : 'bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]'
                          }`}
                        >
                          {curr.code}
                        </span>
                      </div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          isSelected ? 'text-[var(--color-on-accent)]/80' : 'text-[var(--color-muted)]'
                        }`}
                      >
                        {isRTL ? curr.nameEn : curr.nameAr} • {curr.symbol}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-[var(--color-on-accent)] text-[var(--color-accent)] flex items-center justify-center shrink-0">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
