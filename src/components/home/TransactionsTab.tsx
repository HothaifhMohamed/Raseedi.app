import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  Search,
  CheckSquare,
  Square,
  Trash2,
  Copy,
  Edit2,
  FolderInput,
  Tags,
  X,
  Paperclip,
  MoreVertical,
  Lock,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Transaction } from '../../types';
import {
  groupTransactionsByDay,
  isDateInLockedPeriod,
  toArabicNumerals,
} from '../../services/calculations';
import { normalizeApprovalStatus } from '../../services/entitlements';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { AdBanner } from '../common/AdBanner';
import { MoneyText } from '../common/MoneyText';
import { HairlineEmptyState } from '../common/HairlineVisuals';
import { resetScrollToTop } from '../../hooks/useScrollToTop';
import { useScrollRestoration } from '../../hooks/useScrollRestoration';
import {
  getBrowserSessionStorage,
  parseSavedVisibleLimit,
  readScrollPositionFromStorage,
  saveScrollPositionToStorage,
  TRANSACTIONS_LIMIT_STORAGE_KEY,
  TRANSACTIONS_SCROLL_STORAGE_KEY,
} from '../../services/scrollRestoration';

export const TransactionsTab: React.FC = () => {
  const {
    isOrgWorkspace,
    activeOrganization,
    activeOrgRole,
    canOrgWrite,
    isOrgReadOnly,
    orgHasMoreTx,
    loadMoreOrgTransactions,
    orgCostCenters,
    transactions,
    wallets,
    categories,
    settings,
    filters,
    setFilters,
    resetFilters,
    selectedTransactionIds,
    toggleSelectTransaction,
    selectAllTransactions,
    clearSelectedTransactions,
    deleteSelectedTransactions,
    moveSelectedTransactions,
    changeSelectedTransactionsCategory,
    deleteTransaction,
    duplicateTransaction,
    setEditingTransaction,
    isAddModalOpen,
    setIsAddModalOpen,
    setIsFilterOpen,
    t,
    isRTL,
  } = useApp();

  const [activeMenuTxId, setActiveMenuTxId] = useState<string | null>(null);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [visibleTxLimit, setVisibleTxLimit] = useState(() =>
    parseSavedVisibleLimit(
      getBrowserSessionStorage()?.getItem(TRANSACTIONS_LIMIT_STORAGE_KEY),
      60
    )
  );
  const [isLoadingMoreCloud, setIsLoadingMoreCloud] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const wasAddModalOpenRef = useRef(false);
  const shouldRestoreAfterEditRef = useRef(false);

  const { handleScroll, saveScrollNow, restoreScrollNow } = useScrollRestoration(
    containerRef,
    TRANSACTIONS_SCROLL_STORAGE_KEY,
    { restoreOnMount: true }
  );

  // Open cleanly at the top only when no saved transactions scroll position exists
  useLayoutEffect(() => {
    const saved = readScrollPositionFromStorage(
      getBrowserSessionStorage(),
      TRANSACTIONS_SCROLL_STORAGE_KEY
    );
    if (saved <= 0) {
      resetScrollToTop(containerRef.current);
    }
  }, []);

  // Restore saved scroll position immediately after closing/saving Edit Transaction modal
  useLayoutEffect(() => {
    if (isAddModalOpen) {
      wasAddModalOpenRef.current = true;
      return;
    }
    if (wasAddModalOpenRef.current || shouldRestoreAfterEditRef.current) {
      wasAddModalOpenRef.current = false;
      restoreScrollNow();
    }
  }, [isAddModalOpen, transactions, restoreScrollNow]);

  useEffect(() => {
    if (isAddModalOpen || !shouldRestoreAfterEditRef.current) return;
    restoreScrollNow();
    const rafId =
      typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(() => {
            restoreScrollNow();
            shouldRestoreAfterEditRef.current = false;
          })
        : null;
    if (rafId === null) {
      shouldRestoreAfterEditRef.current = false;
    }
    return () => {
      if (rafId !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [isAddModalOpen, transactions, restoreScrollNow]);

  const handleOpenEditTransaction = useCallback(
    (tx: Transaction) => {
      saveScrollNow();
      saveScrollPositionToStorage(
        getBrowserSessionStorage(),
        TRANSACTIONS_LIMIT_STORAGE_KEY,
        visibleTxLimit
      );
      shouldRestoreAfterEditRef.current = true;
      setEditingTransaction(tx);
      setIsAddModalOpen(true);
    },
    [saveScrollNow, visibleTxLimit, setEditingTransaction, setIsAddModalOpen]
  );

  useEffect(() => {
    if (!activeMenuTxId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenuTxId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeMenuTxId]);

  // Reset window size when filters change
  useEffect(() => {
    setVisibleTxLimit(60);
  }, [filters]);

  // Apply filters & search
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // 1. Type
      if (filters.type !== 'all') {
        if (filters.type === 'income' && tx.type !== 'income') return false;
        if (filters.type === 'expense' && tx.type !== 'expense') return false;
      }
      // 2. Wallet
      if (filters.walletId && tx.walletId !== filters.walletId && tx.toWalletId !== filters.walletId) {
        return false;
      }
      // 3. Category
      if (filters.categoryId && tx.categoryId !== filters.categoryId) {
        return false;
      }
      // 4. Priority
      if (filters.priority && tx.priority !== filters.priority) {
        return false;
      }
      // 5. Group
      if (filters.group && tx.group !== filters.group) {
        return false;
      }
      // 6. Contact
      if (filters.contact && tx.contact?.toLowerCase() !== filters.contact.toLowerCase()) {
        return false;
      }
      // 7. Date range
      if (filters.startDate && tx.date < filters.startDate) return false;
      if (filters.endDate && tx.date > filters.endDate) return false;

      // 8. Full-text search
      if (filters.searchQuery.trim()) {
        const q = filters.searchQuery.toLowerCase().trim();
        const cat = categories.find((c) => c.id === tx.categoryId);
        const catName = ((cat?.nameAr || '') + ' ' + (cat?.nameEn || '')).toLowerCase();
        const w = wallets.find((w) => w.id === tx.walletId);
        const wName = (w?.name || '').toLowerCase();
        const notes = (tx.notes || '').toLowerCase();
        const contact = (tx.contact || '').toLowerCase();
        const group = (tx.group || '').toLowerCase();

        const match =
          catName.includes(q) ||
          wName.includes(q) ||
          notes.includes(q) ||
          contact.includes(q) ||
          group.includes(q) ||
          String(tx.amount).includes(q);

        if (!match) return false;
      }

      return true;
    });
  }, [transactions, filters, categories, wallets]);

  // Group by day (preserving full day group subtotals, windowing rendered rows)
  const dayGroups = useMemo(() => {
    return groupTransactionsByDay(
      filteredTransactions,
      settings.mainCurrency,
      settings.customExchangeRates
    );
  }, [filteredTransactions, settings.mainCurrency, settings.customExchangeRates]);

  const { visibleDayGroups, renderedCount } = useMemo(() => {
    const sliced: typeof dayGroups = [];
    let count = 0;
    for (const group of dayGroups) {
      if (count >= visibleTxLimit) break;
      const remaining = visibleTxLimit - count;
      if (group.transactions.length <= remaining) {
        sliced.push(group);
        count += group.transactions.length;
      } else {
        sliced.push({
          ...group,
          transactions: group.transactions.slice(0, remaining),
        });
        count += remaining;
      }
    }
    return { visibleDayGroups: sliced, renderedCount: count };
  }, [dayGroups, visibleTxLimit]);

  const hasMoreTransactions = renderedCount < filteredTransactions.length;

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMoreTransactions || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleTxLimit((prev) => prev + 80);
        }
      },
      { root: containerRef.current, rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreTransactions, renderedCount]);

  const formatDateHeader = (dateStr: string) => {
    const dt = new Date(dateStr + 'T00:00:00');
    const dayNum = dt.getDate();
    const formattedDay = settings.digitFormat === 'arabic' ? toArabicNumerals(dayNum) : dayNum;

    const weekday = dt.toLocaleDateString(settings.language === 'ar' ? 'ar-EG' : 'en-US', {
      weekday: 'long',
    });
    const month = dt.toLocaleDateString(settings.language === 'ar' ? 'ar-EG' : 'en-US', {
      month: 'long',
    });

    return `${weekday}، ${formattedDay} ${month}`;
  };

  const isMultiSelectActive = selectedTransactionIds.length > 0;
  const allFilteredIds = filteredTransactions.map((t) => t.id);

  return (
    <div
      ref={containerRef}
      onScroll={isAddModalOpen ? undefined : handleScroll}
      data-testid="transactions-tab-root"
      className="flex flex-col flex-1 min-h-0 overflow-y-auto pb-28"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div
        ref={topRef}
        data-testid="transactions-tab-top-anchor"
        className="scroll-mt-28 h-px w-full pointer-events-none shrink-0"
        aria-hidden="true"
      />
      {activeMenuTxId && (
        <div
          data-testid="tx-menu-backdrop"
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-transparent"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setActiveMenuTxId(null);
          }}
        />
      )}
      {/* Search Bar & Multi-Select Trigger */}
      <div className="px-4 py-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-muted)]" />
          <input
            type="text"
            value={filters.searchQuery}
            onChange={(e) => setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))}
            placeholder={t('searchPlaceholder')}
            className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl py-2 ps-9 pe-8 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
          />
          {filters.searchQuery && (
            <button
              onClick={() => setFilters((prev) => ({ ...prev, searchQuery: '' }))}
              className="absolute top-1/2 -translate-y-1/2 end-3 text-[var(--color-muted)] hover:text-[var(--color-ink)] p-1 min-h-[36px] min-w-[36px] flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Multi-select toggle (hidden for read-only Viewer) */}
        {(!isOrgWorkspace || canOrgWrite) && (
          <button
            onClick={() => {
              if (isMultiSelectActive) {
                clearSelectedTransactions();
              } else {
                selectAllTransactions(allFilteredIds);
              }
            }}
            className={`p-2.5 rounded-xl border transition-all duration-300 min-h-[44px] min-w-[44px] flex items-center justify-center ${
              isMultiSelectActive
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
            title={isRTL ? 'تحديد متعدد' : 'Multi-select'}
          >
            {isMultiSelectActive ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Quick Filter Chips Bar */}
      <div className="px-4 pb-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setIsFilterOpen(true)}
          className="p-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)] shrink-0 min-h-[40px] min-w-[40px] flex items-center justify-center transition-all duration-300"
          title={t('filter')}
        >
          <Search className="w-3.5 h-3.5 text-[var(--color-accent)]" />
        </button>

        <button
          onClick={() => setFilters((p) => ({ ...p, type: 'all' }))}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all duration-300 min-h-[40px] border ${
            filters.type === 'all'
              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] shadow-xs'
              : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          {t('filterAll')}
        </button>

        <button
          onClick={() => setFilters((p) => ({ ...p, type: 'income' }))}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all duration-300 min-h-[40px] border ${
            filters.type === 'income'
              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] shadow-xs'
              : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          {t('filterIncome')}
        </button>

        <button
          onClick={() => setFilters((p) => ({ ...p, type: 'expense' }))}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all duration-300 min-h-[40px] border ${
            filters.type === 'expense'
              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] shadow-xs'
              : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          {t('filterExpense')}
        </button>

        {wallets.map((w) => (
          <button
            key={w.id}
            onClick={() =>
              setFilters((p) => ({
                ...p,
                walletId: p.walletId === w.id ? undefined : w.id,
              }))
            }
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all duration-300 min-h-[40px] border ${
              filters.walletId === w.id
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] shadow-xs'
                : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {w.name}
          </button>
        ))}

        {(filters.type !== 'all' ||
          Boolean(filters.walletId) ||
          Boolean(filters.categoryId) ||
          Boolean(filters.priority) ||
          Boolean(filters.group) ||
          Boolean(filters.contact) ||
          Boolean(filters.startDate) ||
          Boolean(filters.endDate) ||
          Boolean(filters.searchQuery)) && (
          <button
            onClick={resetFilters}
            className="px-3 py-1.5 rounded-xl text-xs text-[var(--color-expense)] bg-[var(--color-expense)]/10 hover:bg-[var(--color-expense)]/20 shrink-0 font-semibold min-h-[40px] transition-all duration-300"
          >
            {isRTL ? 'مسح التصفية' : 'Reset'}
          </button>
        )}
      </div>

      {/* Multi-Select Action Bar */}
      {isMultiSelectActive && (
        <div className="mx-4 my-1 p-2.5 bg-[var(--color-surface)] border border-[var(--color-accent)]/40 rounded-xl flex items-center justify-between text-xs shadow-xs animate-in fade-in duration-150">
          <span className="font-bold text-[var(--color-accent)]">
            {selectedTransactionIds.length} {t('selectedItems')}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowCategoryModal(true)}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] text-[var(--color-ink)] flex items-center gap-1 hover:border-[var(--color-muted)] min-h-[36px]"
              title={isRTL ? 'تغيير التصنيف' : 'Change category'}
            >
              <Tags className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isRTL ? 'التصنيف' : 'Category'}</span>
            </button>
            <button
              onClick={() => setMoveModalOpen(true)}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] text-[var(--color-ink)] flex items-center gap-1 hover:border-[var(--color-muted)] min-h-[36px]"
              title={t('moveToWallet')}
            >
              <FolderInput className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('moveToWallet')}</span>
            </button>
            <button
              onClick={() => setConfirmDeleteSelected(true)}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--color-expense)]/10 text-[var(--color-expense)] border border-[var(--color-expense)]/20 flex items-center gap-1 hover:bg-[var(--color-expense)]/20 min-h-[36px]"
              title={t('delete')}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('delete')}</span>
            </button>
            <button
              onClick={clearSelectedTransactions}
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Transactions List Grouped by Day (Ledger Style) */}
      {dayGroups.length === 0 ? (
        <div className="px-4 pt-2">
          <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
            <HairlineEmptyState
              figure="drawer"
              surface="surface"
              title={isRTL ? 'لا توجد معاملات مسجلة بعد' : 'No transactions recorded yet'}
              description={
                isRTL
                  ? 'ابدأ بتسجيل أول دخل أو مصروف ليظهر هنا بشكل مرتب.'
                  : 'Record your first income or expense to keep your ledger organized.'
              }
              action={
                <button
                  onClick={() => {
                    setEditingTransaction(null);
                    setIsAddModalOpen(true);
                  }}
                  className="px-4 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] rounded-xl text-xs font-semibold hover:opacity-95 min-h-[40px] flex items-center"
                >
                  {isRTL ? '+ إضافة معاملة' : '+ Add Transaction'}
                </button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4 px-4 pt-1">
          {visibleDayGroups.map((group, groupIndex) => (
            <React.Fragment key={group.date}>
            <div className="space-y-1">
              {/* Day Header with Subtotal */}
              <div className="flex items-center justify-between px-1 py-1 text-xs text-[var(--color-muted)] font-medium border-b border-[var(--color-line)]">
                <span>{formatDateHeader(group.date)}</span>
                <MoneyText
                  amount={group.subtotal}
                  currency={settings.mainCurrency}
                  showSign={true}
                  className="font-medium text-xs text-[var(--color-muted)]"
                />
              </div>

              {/* Transactions Ledger Rows with Thin Dividers */}
              <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-visible divide-y divide-[var(--color-line)]">
                {group.transactions.map((tx: Transaction) => {
                  const cat = categories.find((c) => c.id === tx.categoryId);
                  const wallet = wallets.find((w) => w.id === tx.walletId);
                  const toWallet = tx.toWalletId ? wallets.find((w) => w.id === tx.toWalletId) : null;
                  const isSelected = selectedTransactionIds.includes(tx.id);
                  const dotColor = cat?.color || 'var(--color-accent)';
                  const catName = isRTL ? cat?.nameAr || 'عام' : cat?.nameEn || 'General';
                  const isMenuOpen = activeMenuTxId === tx.id;

                  const isLockedByPeriod =
                    isOrgWorkspace &&
                    isDateInLockedPeriod(tx.date, activeOrganization?.lockedUntilDate);
                  const txStatus = normalizeApprovalStatus(tx.approvalStatus);
                  const isApprovedEmployeeLocked =
                    isOrgWorkspace &&
                    activeOrgRole === 'employee' &&
                    (txStatus === 'approved' || txStatus === 'paid');
                  const canMutateTx =
                    !isOrgWorkspace ||
                    (!isOrgReadOnly && canOrgWrite && !isLockedByPeriod && !isApprovedEmployeeLocked);
                  const costCenter = tx.costCenterId
                    ? orgCostCenters.find((cc) => cc.id === tx.costCenterId)
                    : null;

                  return (
                    <div
                      key={tx.id}
                      onClick={() => {
                        if (isMultiSelectActive) {
                          toggleSelectTransaction(tx.id);
                        } else if (canMutateTx) {
                          handleOpenEditTransaction(tx);
                        }
                      }}
                      className={`p-3.5 flex items-center justify-between gap-3 ${
                        canMutateTx || isMultiSelectActive ? 'cursor-pointer hover:bg-[var(--color-bg)]' : 'cursor-default'
                      } transition-colors relative ${
                        isSelected ? 'bg-[var(--color-accent)]/5' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Checkbox if multi-select active */}
                        {isMultiSelectActive && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectTransaction(tx.id);
                            }}
                            className="text-[var(--color-muted)] hover:text-[var(--color-accent)] p-1 min-h-[32px] min-w-[32px] flex items-center justify-center shrink-0"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[var(--color-accent)]" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        )}

                        <div className="min-w-0">
                          {/* Category Dot + Name + Enterprise Badges */}
                          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: dotColor }}
                            />
                            <span className="text-xs font-semibold text-[var(--color-ink)] truncate">
                              {catName}
                            </span>

                            {/* Approval Status Badge */}
                            {isOrgWorkspace && txStatus === 'pending' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-[var(--color-warning)]/15 text-[var(--color-warning-text)]">
                                {t('pendingApprovalBadge')}
                              </span>
                            )}
                            {isOrgWorkspace && txStatus === 'rejected' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-[var(--color-expense)]/15 text-[var(--color-expense)]">
                                {t('rejectedBadge')}
                              </span>
                            )}
                            {isOrgWorkspace && txStatus === 'paid' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-[var(--color-income)]/15 text-[var(--color-income)]">
                                {t('paidBadge')}
                              </span>
                            )}
                            {isOrgWorkspace && txStatus === 'approved' && tx.reviewedAt && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-[var(--color-income)]/15 text-[var(--color-income)]">
                                {t('approvedBadge')}
                              </span>
                            )}
                            {isOrgWorkspace && txStatus === 'draft' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]">
                                {isRTL ? 'مسودة' : 'Draft'}
                              </span>
                            )}

                            {isLockedByPeriod && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]"
                                title={t('periodLock')}
                              >
                                <Lock className="w-2.5 h-2.5" />
                              </span>
                            )}

                            {/* Priority badge if not normal */}
                            {!settings.showPrioritiesInStatsOnly && tx.priority !== 'normal' && (
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                                  tx.priority === 'essential'
                                    ? 'bg-[var(--color-expense)]/15 text-[var(--color-expense)]'
                                    : 'bg-[var(--color-warning)]/15 text-[var(--color-warning-text)]'
                                }`}
                              >
                                {t(
                                  tx.priority === 'essential'
                                    ? 'priorityEssential'
                                    : 'priorityLeisure'
                                )}
                              </span>
                            )}

                            {((tx.attachments && tx.attachments.length > 0) ||
                              (tx.attachmentPaths && tx.attachmentPaths.length > 0)) && (
                              <Paperclip className="w-3 h-3 text-[var(--color-muted)]" />
                            )}
                          </div>

                          {/* Secondary line: time, wallet, invoice #, cost center, contact, notes */}
                          <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-[var(--color-muted)]">
                            <span>{tx.time}</span>
                            <span>•</span>
                            <span className="truncate">
                              {tx.type === 'transfer'
                                ? `${wallet?.name} ➔ ${toWallet?.name}`
                                : wallet?.name}
                            </span>
                            {tx.invoiceNumber && (
                              <>
                                <span>•</span>
                                <span className="font-mono text-[10px] text-[var(--color-ink)]" dir="ltr">
                                  #{tx.invoiceNumber}
                                </span>
                              </>
                            )}
                            {costCenter && (
                              <>
                                <span>•</span>
                                <span className="text-[10px] text-[var(--color-accent)] font-medium">
                                  {isRTL ? costCenter.nameAr : costCenter.nameEn}
                                </span>
                              </>
                            )}
                            {tx.contact && (
                              <>
                                <span>•</span>
                                <span className="text-[var(--color-ink)] truncate">{tx.contact}</span>
                              </>
                            )}
                            {tx.notes && (
                              <>
                                <span>•</span>
                                <span className="truncate max-w-[120px]">{tx.notes}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Amount and ⋮ Menu */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-end">
                          <MoneyText
                            amount={tx.amount}
                            currency={tx.currency}
                            type={tx.type}
                            showSign={true}
                            colorByType={true}
                            className="text-sm font-bold block"
                          />
                          {isOrgWorkspace && typeof tx.taxAmount === 'number' && tx.taxAmount > 0 && (
                            <span className="text-[9px] text-[var(--color-muted)] block num-tabular">
                              {isRTL ? 'ضريبة:' : 'VAT:'}{' '}
                              <MoneyText amount={tx.taxAmount} currency={tx.currency} />
                            </span>
                          )}
                          {tx.type === 'transfer' && tx.transferFee && tx.transferFee > 0 && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-line)] text-[10px] text-[var(--color-muted)] num-tabular">
                              {isRTL ? `+ ${tx.transferFee} ${tx.currency} رسوم` : `+ ${tx.transferFee} ${tx.currency} fee`}
                            </span>
                          )}
                          {tx.doesNotAffectBalance && (
                            <span className="text-[9px] text-[var(--color-muted)] block">
                              {isRTL ? '(لا يؤثر)' : '(No effect)'}
                            </span>
                          )}
                        </div>

                        {/* ⋮ Dropdown Menu Button */}
                        {canMutateTx && (
                          <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setActiveMenuTxId(isMenuOpen ? null : tx.id)}
                              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
                              title={isRTL ? 'خيارات' : 'Options'}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {/* Popover Dropdown Menu */}
                            {isMenuOpen && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className={`absolute end-0 top-full mt-1 z-50 w-36 py-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl shadow-lg text-xs animate-in fade-in zoom-in-95 duration-200 ${
                                  isRTL ? 'text-right' : 'text-left'
                                }`}
                              >
                                <button
                                  onClick={() => {
                                    setActiveMenuTxId(null);
                                    handleOpenEditTransaction(tx);
                                  }}
                                  className="w-full px-3 py-2 flex items-center gap-2 hover:bg-[var(--color-bg)] text-[var(--color-ink)] min-h-[36px]"
                                >
                                  <Edit2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                                  <span>{isRTL ? 'تعديل' : 'Edit'}</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveMenuTxId(null);
                                    duplicateTransaction(tx.id);
                                  }}
                                  className="w-full px-3 py-2 flex items-center gap-2 hover:bg-[var(--color-bg)] text-[var(--color-ink)] min-h-[36px]"
                                >
                                  <Copy className="w-3.5 h-3.5 text-[var(--color-muted)]" />
                                  <span>{t('duplicate')}</span>
                                </button>
                                <div className="h-px bg-[var(--color-line)] my-1" />
                                <button
                                  onClick={() => {
                                    setActiveMenuTxId(null);
                                    deleteTransaction(tx.id);
                                  }}
                                  className="w-full px-3 py-2 flex items-center gap-2 hover:bg-[var(--color-expense)]/10 text-[var(--color-expense)] min-h-[36px]"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>{t('delete')}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {groupIndex === 0 && <AdBanner variant="native-card" />}
            </React.Fragment>
          ))}

          {hasMoreTransactions && (
            <div ref={loadMoreRef} className="pt-1">
              <button
                type="button"
                onClick={() => setVisibleTxLimit((prev) => prev + 80)}
                className="w-full py-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-semibold text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors min-h-[44px]"
              >
                {isRTL
                  ? `عرض المزيد (${renderedCount} من ${filteredTransactions.length})`
                  : `Load more (${renderedCount} of ${filteredTransactions.length})`}
              </button>
            </div>
          )}

          {isOrgWorkspace && orgHasMoreTx && !hasMoreTransactions && (
            <div className="pt-1">
              <button
                type="button"
                disabled={isLoadingMoreCloud}
                onClick={() => {
                  setIsLoadingMoreCloud(true);
                  void loadMoreOrgTransactions().finally(() => {
                    setIsLoadingMoreCloud(false);
                    setVisibleTxLimit((prev) => prev + 200);
                  });
                }}
                className="w-full py-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-accent)]/40 text-xs font-semibold text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors min-h-[44px] disabled:opacity-50"
              >
                {isLoadingMoreCloud
                  ? isRTL
                    ? 'جاري تحميل معاملات أقدم من السحابة...'
                    : 'Loading older cloud transactions...'
                  : isRTL
                  ? 'تحميل معاملات أقدم من السحابة'
                  : 'Load older transactions from Cloud'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Multi-Delete */}
      <ConfirmationModal
        isOpen={confirmDeleteSelected}
        onClose={() => setConfirmDeleteSelected(false)}
        onConfirm={deleteSelectedTransactions}
        title={isRTL ? 'حذف المعاملات المحددة' : 'Delete Selected Transactions'}
        message={
          isRTL
            ? `هل أنت متأكد من حذف ${selectedTransactionIds.length} معاملة دفعة واحدة؟`
            : `Are you sure you want to delete ${selectedTransactionIds.length} transactions?`
        }
        confirmLabel={t('delete')}
        cancelLabel={isRTL ? 'إلغاء' : 'Cancel'}
      />

      {/* Move Selected Modal */}
      {moveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
            <h3 className="font-bold text-sm mb-2">{t('moveToWallet')}</h3>
            <p className="text-xs text-[var(--color-muted)] mb-4">
              {isRTL
                ? `اختر المحفظة المستهدفة لنقل ${selectedTransactionIds.length} معاملة إليها:`
                : `Select target wallet to move ${selectedTransactionIds.length} transactions:`}
            </p>
            <div className="space-y-1.5 max-h-56 overflow-y-auto mb-4">
              {wallets.map((w) => (
                <button
                  key={w.id}
                  onClick={() => {
                    moveSelectedTransactions(w.id);
                    setMoveModalOpen(false);
                  }}
                  className="w-full p-2.5 rounded-lg border border-[var(--color-line)] hover:bg-[var(--color-bg)] text-xs text-start flex items-center justify-between min-h-[44px]"
                >
                  <span className="font-medium text-[var(--color-ink)]">{w.name}</span>
                  <span className="text-[11px] text-[var(--color-muted)]">{w.currency}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setMoveModalOpen(false)}
              className="w-full py-2 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] rounded-lg text-xs min-h-[44px]"
            >
              {isRTL ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Change Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
            <h3 className="font-bold text-sm mb-2">
              {isRTL ? 'تغيير تصنيف المعاملات المحددة' : 'Change Selected Transactions Category'}
            </h3>
            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto mb-4">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    changeSelectedTransactionsCategory(c.id);
                    setShowCategoryModal(false);
                  }}
                  className="p-2 rounded-lg border border-[var(--color-line)] hover:bg-[var(--color-bg)] text-xs flex items-center gap-2 text-start min-h-[44px]"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="truncate text-[var(--color-ink)] font-medium">
                    {isRTL ? c.nameAr : c.nameEn}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowCategoryModal(false)}
              className="w-full py-2 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] rounded-lg text-xs min-h-[44px]"
            >
              {isRTL ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
