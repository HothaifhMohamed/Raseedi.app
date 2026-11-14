import React, { useMemo } from 'react';
import { SlidersHorizontal, X, RotateCcw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PriorityLevel } from '../../types';

export const FilterModal: React.FC = () => {
  const {
    isFilterOpen,
    setIsFilterOpen,
    filters,
    setFilters,
    resetFilters,
    wallets,
    categories,
    transactions,
    t,
    isRTL,
  } = useApp();

  const pastGroups = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.group?.trim()) set.add(tx.group.trim());
    });
    return Array.from(set);
  }, [transactions]);

  const pastContacts = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.contact?.trim()) set.add(tx.contact.trim());
    });
    return Array.from(set);
  }, [transactions]);

  if (!isFilterOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="w-full sm:max-w-md max-h-[85vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-line)] rounded-t-2xl sm:rounded-xl shadow-xl overflow-hidden text-[var(--color-ink)]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-line)] bg-[var(--color-bg)]">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-[var(--color-accent)]" />
            <h3 className="text-sm font-bold text-[var(--color-ink)]">{t('filter')}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={resetFilters}
              className="text-xs text-[var(--color-expense)] hover:underline flex items-center gap-1 min-h-[36px] px-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t('clearFilters')}</span>
            </button>
            <button
              onClick={() => setIsFilterOpen(false)}
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 1. Transaction Type */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5">
              {isRTL ? 'نوع المعاملة' : 'Transaction Type'}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'all', label: t('filterAll') },
                { id: 'income', label: t('filterIncome') },
                { id: 'expense', label: t('filterExpense') },
              ].map((tp) => (
                <button
                  key={tp.id}
                  onClick={() => setFilters((prev) => ({ ...prev, type: tp.id as any }))}
                  className={`py-2 text-xs font-semibold rounded-lg transition-colors border min-h-[38px] ${
                    filters.type === tp.id
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] shadow-xs'
                      : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {tp.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Wallet Filter */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5">
              {t('filterWallet')}
            </label>
            <select
              value={filters.walletId || ''}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, walletId: e.target.value || undefined }))
              }
              className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px]"
            >
              <option value="">{isRTL ? 'جميع المحافظ' : 'All Wallets'}</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.currency})
                </option>
              ))}
            </select>
          </div>

          {/* 3. Category Filter */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5">
              {t('filterCategory')}
            </label>
            <select
              value={filters.categoryId || ''}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, categoryId: e.target.value || undefined }))
              }
              className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px]"
            >
              <option value="">{isRTL ? 'جميع التصنيفات' : 'All Categories'}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {isRTL ? c.nameAr : c.nameEn}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Priority Filter */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5">
              {t('filterPriority')}
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { id: undefined, label: isRTL ? 'الكل' : 'All' },
                { id: 'essential', label: t('priorityEssential') },
                { id: 'normal', label: t('priorityNormal') },
                { id: 'leisure', label: t('priorityLeisure') },
              ].map((pr) => (
                <button
                  key={String(pr.id)}
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, priority: pr.id as PriorityLevel | undefined }))
                  }
                  className={`py-1.5 text-xs font-semibold rounded-lg transition-colors border min-h-[38px] ${
                    filters.priority === pr.id
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] shadow-xs'
                      : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {pr.label}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Group Filter */}
          {pastGroups.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5">
                {t('filterGroup')}
              </label>
              <select
                value={filters.group || ''}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, group: e.target.value || undefined }))
                }
                className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px]"
              >
                <option value="">{isRTL ? 'جميع المجموعات' : 'All Groups'}</option>
                {pastGroups.map((g) => (
                  <option key={g} value={g}>
                    #{g}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 6. Contact Filter */}
          {pastContacts.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5">
                {t('filterContact')}
              </label>
              <select
                value={filters.contact || ''}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, contact: e.target.value || undefined }))
                }
                className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px]"
              >
                <option value="">{isRTL ? 'جميع جهات الاتصال' : 'All Contacts'}</option>
                {pastContacts.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 7. Date Range Filter */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5">
              {t('filterDateRange')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-[var(--color-muted)] block mb-1">
                  {isRTL ? 'من تاريخ:' : 'From:'}
                </span>
                <input
                  type="date"
                  value={filters.startDate || ''}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, startDate: e.target.value || undefined }))
                  }
                  className="w-full px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[40px]"
                />
              </div>
              <div>
                <span className="text-[10px] text-[var(--color-muted)] block mb-1">
                  {isRTL ? 'إلى تاريخ:' : 'To:'}
                </span>
                <input
                  type="date"
                  value={filters.endDate || ''}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, endDate: e.target.value || undefined }))
                  }
                  className="w-full px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[40px]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-line)] bg-[var(--color-bg)]">
          <button
            onClick={() => setIsFilterOpen(false)}
            className="w-full py-2.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs transition min-h-[44px]"
          >
            {isRTL ? 'تطبيق التصفية' : 'Apply Filters'}
          </button>
        </div>
      </div>
    </div>
  );
};
