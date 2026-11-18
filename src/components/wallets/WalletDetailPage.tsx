import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Search,
  TrendingUp,
  TrendingDown,
  Trash2,
  Copy,
  Edit2,
  FolderInput,
  Tags,
  CheckSquare,
  Square,
  Plus,
  MoreVertical,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MoneyText } from '../common/MoneyText';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { HairlineEmptyState } from '../common/HairlineVisuals';
import { resetScrollToTop, useScrollToTop } from '../../hooks/useScrollToTop';
import {
  doesTransactionAffectAccounting,
  getEffectiveTransactionAmount,
} from '../../services/calculations';

interface WalletDetailPageProps {
  walletId: string;
}

export const WalletDetailPage: React.FC<WalletDetailPageProps> = ({ walletId }) => {
  const {
    wallets,
    transactions,
    categories,
    settings,
    navigateBackFromWallet,
    setEditingTransaction,
    setIsAddModalOpen,
    deleteTransaction,
    duplicateTransaction,
    selectedTransactionIds,
    toggleSelectTransaction,
    selectAllTransactions,
    clearSelectedTransactions,
    deleteSelectedTransactions,
    moveSelectedTransactions,
    changeSelectedTransactionsCategory,
    isRTL,
    t,
  } = useApp();

  const wallet = wallets.find((w) => w.id === walletId);

  const [filterType, setFilterType] = useState<'all' | 'expense' | 'income' | 'transfer'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [activeMenuTxId, setActiveMenuTxId] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(60);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  useScrollToTop(scrollContainerRef, [walletId]);

  useModalBackHandler(showMoveModal, () => setShowMoveModal(false), 'wallet-detail-move');
  useModalBackHandler(showCategoryModal, () => setShowCategoryModal(false), 'wallet-detail-category');

  useEffect(() => {
    if (!activeMenuTxId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenuTxId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeMenuTxId]);

  useEffect(() => {
    setVisibleLimit(60);
  }, [walletId, filterType, searchQuery]);

  // Filter transactions for this wallet
  const walletTransactions = useMemo(() => {
    return transactions.filter(
      (tx) => tx.walletId === walletId || tx.toWalletId === walletId
    );
  }, [transactions, walletId]);

  useEffect(() => {
    resetScrollToTop(scrollContainerRef.current);
    const timer = window.setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
      topRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
      resetScrollToTop(scrollContainerRef.current);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [walletId, walletTransactions]);

  // Filtered list based on search and type
  const filteredTransactions = useMemo(() => {
    return walletTransactions.filter((tx) => {
      if (filterType !== 'all' && tx.type !== filterType) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const cat = categories.find((c) => c.id === tx.categoryId);
        const matchNote = tx.notes?.toLowerCase().includes(q);
        const matchCat = cat?.nameAr.toLowerCase().includes(q) || cat?.nameEn.toLowerCase().includes(q);
        const matchContact = tx.contact?.toLowerCase().includes(q);
        const matchGroup = tx.group?.toLowerCase().includes(q);
        if (!matchNote && !matchCat && !matchContact && !matchGroup) return false;
      }
      return true;
    });
  }, [walletTransactions, filterType, searchQuery, categories]);

  // Statistics for this wallet
  const stats = useMemo(() => {
    let income = 0;
    let expense = 0;
    const catTotals: Record<string, number> = {};

    for (const tx of walletTransactions) {
      if (!doesTransactionAffectAccounting(tx)) continue;
      const effectiveAmount = getEffectiveTransactionAmount(tx);
      if (tx.type === 'income') {
        income += effectiveAmount;
      } else if (tx.type === 'expense') {
        expense += effectiveAmount;
        catTotals[tx.categoryId] = (catTotals[tx.categoryId] || 0) + effectiveAmount;
      }
    }

    const topCategories = Object.entries(catTotals)
      .map(([catId, amount]) => {
        const cat = categories.find((c) => c.id === catId);
        return {
          catId,
          name: isRTL ? cat?.nameAr || catId : cat?.nameEn || catId,
          color: cat?.color || 'var(--color-accent)',
          amount,
        };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    return { income, expense, topCategories };
  }, [walletTransactions, categories, isRTL]);

  if (!wallet) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-sm text-[var(--color-muted)] mb-4">
          {isRTL ? 'المحفظة غير موجودة' : 'Wallet not found'}
        </p>
        <button
          onClick={navigateBackFromWallet}
          className="px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl text-xs font-medium min-h-[44px]"
        >
          {isRTL ? 'العودة للمحافظ' : 'Back to Wallets'}
        </button>
      </div>
    );
  }

  const allFilteredIds = filteredTransactions.map((t) => t.id);
  const isAllSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedTransactionIds.includes(id));

  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  return (
    <div
      ref={scrollContainerRef}
      data-testid="wallet-detail-scroll-container"
      className="flex-1 flex flex-col pb-24 overflow-y-auto"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div
        ref={topRef}
        data-testid="wallet-detail-top-anchor"
        className="scroll-mt-0 h-px w-full pointer-events-none shrink-0"
        aria-hidden="true"
      />
      {activeMenuTxId && (
        <div
          data-testid="wallet-tx-menu-backdrop"
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
      {/* Top Header */}
      <div className="sticky top-0 z-20 bg-[var(--color-bg)] border-b border-[var(--color-line)] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={navigateBackFromWallet}
            className="w-10 h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] flex items-center justify-center text-[var(--color-ink)] hover:bg-[var(--color-bg)] transition-colors min-h-[44px] min-w-[44px]"
            aria-label={isRTL ? 'رجوع' : 'Back'}
          >
            <BackIcon className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-title text-base font-bold text-[var(--color-ink)] leading-tight">
              {wallet.name}
            </h1>
            <span className="text-xs text-[var(--color-muted)] font-mono">{wallet.currency}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowStats(!showStats)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors min-h-[44px] ${
              showStats
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                : 'bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-line)] hover:text-[var(--color-ink)]'
            }`}
          >
            {isRTL ? 'الإحصائيات' : 'Stats'}
          </button>
          <button
            onClick={() => {
              setEditingTransaction(null);
              setIsAddModalOpen(true);
            }}
            className="w-10 h-10 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] flex items-center justify-center min-h-[44px] min-w-[44px]"
            title={isRTL ? 'إضافة معاملة' : 'Add Transaction'}
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Wallet Hero Balance Card (Credit Card Style) */}
        <div
          className="rounded-2xl p-5 border border-white/15 text-white shadow-[0_12px_28px_-10px_rgba(9,50,37,0.35)] relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${
              wallet.color?.startsWith('#') ? wallet.color : '#0E5A43'
            } 0%, color-mix(in srgb, ${
              wallet.color?.startsWith('#') ? wallet.color : '#0E5A43'
            } 74%, #061A14) 100%)`,
          }}
        >
          <div>
            <span className="text-xs opacity-80 block mb-1">
              {isRTL ? 'رصيد المحفظة الحالي' : 'Current Wallet Balance'}
            </span>
            <div className="text-3xl font-bold tracking-tight mb-4">
              <MoneyText
                amount={wallet.balance}
                currency={wallet.currency}
                className="text-3xl font-bold text-white tracking-tight"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/15 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-white/20 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <span className="block opacity-75 text-[11px]">{isRTL ? 'الدخل' : 'Income'}</span>
                  <MoneyText
                    amount={stats.income}
                    currency={wallet.currency}
                    className="font-semibold text-white"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-white/20 flex items-center justify-center shrink-0">
                  <TrendingDown className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <span className="block opacity-75 text-[11px]">{isRTL ? 'المصروفات' : 'Expenses'}</span>
                  <MoneyText
                    amount={stats.expense}
                    currency={wallet.currency}
                    className="font-semibold text-white"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Optional Stats Panel */}
        {showStats && (
          <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
            <h3 className="text-xs font-bold text-[var(--color-ink)]">
              {isRTL ? 'أعلى تصنيفات المصروفات' : 'Top Expense Categories'}
            </h3>
            {stats.topCategories.length === 0 ? (
              <p className="text-xs text-[var(--color-muted)] py-2">
                {isRTL ? 'لا توجد مصروفات مسجلة بعد' : 'No expenses recorded yet'}
              </p>
            ) : (
              <div className="space-y-2">
                {stats.topCategories.map((item) => {
                  const pct = stats.expense > 0 ? (item.amount / stats.expense) * 100 : 0;
                  return (
                    <div key={item.catId} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full inline-block"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="text-[var(--color-ink)]">{item.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MoneyText
                            amount={item.amount}
                            currency={wallet.currency}
                            className="text-xs text-[var(--color-muted)]"
                          />
                          <span className="text-[10px] text-[var(--color-muted)] font-mono">
                            ({pct.toFixed(0)}%)
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${pct}%`, backgroundColor: item.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isRTL ? 'بحث في معاملات المحفظة...' : 'Search wallet transactions...'}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl py-2.5 ps-9 pe-3 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
            {(
              [
                { id: 'all', label: isRTL ? 'الكل' : 'All' },
                { id: 'expense', label: isRTL ? 'مصروفات' : 'Expenses' },
                { id: 'income', label: isRTL ? 'دخل' : 'Income' },
                { id: 'transfer', label: isRTL ? 'تحويلات' : 'Transfers' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterType(tab.id)}
                className={`px-3 py-1.5 rounded-lg border text-xs whitespace-nowrap transition-colors min-h-[38px] ${
                  filterType === tab.id
                    ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] font-semibold shadow-xs'
                    : 'bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-line)] hover:border-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Multi-Select Toolbar (when items selected) */}
        {selectedTransactionIds.length > 0 && (
          <div className="sticky top-14 z-20 p-2.5 bg-[var(--color-surface)] border border-[var(--color-accent)]/40 rounded-xl flex items-center justify-between text-xs shadow-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[var(--color-accent)]">
                {selectedTransactionIds.length} {isRTL ? 'محدد' : 'selected'}
              </span>
              <button
                onClick={clearSelectedTransactions}
                className="text-[var(--color-muted)] hover:text-[var(--color-ink)] underline text-[11px]"
              >
                {isRTL ? 'إلغاء' : 'Clear'}
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowCategoryModal(true)}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] text-[var(--color-ink)] flex items-center gap-1 hover:border-[var(--color-muted)] min-h-[36px]"
                title={isRTL ? 'تغيير التصنيف' : 'Change category'}
              >
                <Tags className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isRTL ? 'التصنيف' : 'Category'}</span>
              </button>
              <button
                onClick={() => setShowMoveModal(true)}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] text-[var(--color-ink)] flex items-center gap-1 hover:border-[var(--color-muted)] min-h-[36px]"
                title={isRTL ? 'نقل لمحفظة أخرى' : 'Move to wallet'}
              >
                <FolderInput className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isRTL ? 'نقل' : 'Move'}</span>
              </button>
              <button
                onClick={deleteSelectedTransactions}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--color-expense)]/10 text-[var(--color-expense)] border border-[var(--color-expense)]/20 flex items-center gap-1 hover:bg-[var(--color-expense)]/20 min-h-[36px]"
                title={isRTL ? 'حذف المحدد' : 'Delete selected'}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isRTL ? 'حذف' : 'Delete'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Transactions Section Header */}
        <div className="flex items-center justify-between text-xs text-[var(--color-muted)] pt-1">
          <span>
            {isRTL ? 'سجل المعاملات' : 'Transactions Ledger'} ({filteredTransactions.length})
          </span>
          {filteredTransactions.length > 0 && (
            <button
              onClick={() => {
                if (isAllSelected) clearSelectedTransactions();
                else selectAllTransactions(allFilteredIds);
              }}
              className="flex items-center gap-1 text-[11px] hover:text-[var(--color-ink)] min-h-[36px]"
            >
              {isAllSelected ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                  <span>{isRTL ? 'إلغاء تحديد الكل' : 'Deselect all'}</span>
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5" />
                  <span>{isRTL ? 'تحديد الكل' : 'Select all'}</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Transactions Ledger List */}
        {filteredTransactions.length === 0 ? (
          <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
            <HairlineEmptyState
              figure="drawer"
              surface="surface"
              title={
                isRTL
                  ? 'لا توجد معاملات مسجلة في هذه المحفظة'
                  : 'No transactions recorded in this wallet'
              }
              description={
                isRTL
                  ? 'أضف أول معاملة لهذه المحفظة لتبدأ في متابعة حركاتها.'
                  : 'Add your first transaction to track activity in this wallet.'
              }
            />
          </div>
        ) : (
          <>
          <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-visible divide-y divide-[var(--color-line)]">
            {filteredTransactions.slice(0, visibleLimit).map((tx) => {
              const isSelected = selectedTransactionIds.includes(tx.id);
              const cat = categories.find((c) => c.id === tx.categoryId);
              const catName = isRTL ? cat?.nameAr || 'عام' : cat?.nameEn || 'General';
              const dotColor = cat?.color || 'var(--color-accent)';
              const isMenuOpen = activeMenuTxId === tx.id;

              return (
                <div
                  key={tx.id}
                  onClick={() => {
                    setEditingTransaction(tx);
                    setIsAddModalOpen(true);
                  }}
                  className={`p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-[var(--color-bg)] transition-colors relative ${
                    isSelected ? 'bg-[var(--color-accent)]/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Checkbox for multi-select */}
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

                    <div className="min-w-0">
                      {/* Category Dot + Name */}
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: dotColor }}
                        />
                        <span className="text-xs font-semibold text-[var(--color-ink)] truncate">
                          {catName}
                        </span>
                        {tx.contact && (
                          <span className="text-[10px] text-[var(--color-muted)] bg-[var(--color-bg)] px-1.5 py-0.5 rounded border border-[var(--color-line)] truncate">
                            {tx.contact}
                          </span>
                        )}
                      </div>

                      {/* Notes / Date */}
                      <div className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
                        <span>{tx.date}</span>
                        {tx.notes && <span className="truncate max-w-[150px]">• {tx.notes}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Amount & Actions */}
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
                      {tx.type === 'transfer' && tx.transferFee && tx.transferFee > 0 && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-line)] text-[10px] text-[var(--color-muted)] num-tabular">
                          {isRTL ? `+ ${tx.transferFee} ${tx.currency} رسوم` : `+ ${tx.transferFee} ${tx.currency} fee`}
                        </span>
                      )}
                    </div>

                    {/* ⋮ Dropdown Menu */}
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setActiveMenuTxId(isMenuOpen ? null : tx.id)}
                        className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
                        title={isRTL ? 'خيارات' : 'Options'}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

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
                              setEditingTransaction(tx);
                              setIsAddModalOpen(true);
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
                  </div>
                </div>
              );
            })}
          </div>
          {visibleLimit < filteredTransactions.length && (
            <button
              type="button"
              onClick={() => setVisibleLimit((prev) => prev + 80)}
              className="w-full py-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-semibold text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors min-h-[44px]"
            >
              {isRTL
                ? `عرض المزيد (${visibleLimit} من ${filteredTransactions.length})`
                : `Load more (${visibleLimit} of ${filteredTransactions.length})`}
            </button>
          )}
          </>
        )}
      </div>

      {/* Move Selected Modal */}
      {showMoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-sm bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-4 space-y-3">
            <h3 className="font-bold text-sm text-[var(--color-ink)]">
              {isRTL ? 'نقل المعاملات المحددة إلى محفظة' : 'Move Selected Transactions'}
            </h3>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {wallets.map((w) => (
                <button
                  key={w.id}
                  onClick={() => {
                    moveSelectedTransactions(w.id);
                    setShowMoveModal(false);
                  }}
                  className="w-full p-2.5 rounded-lg border border-[var(--color-line)] hover:bg-[var(--color-bg)] text-xs text-start flex items-center justify-between min-h-[44px]"
                >
                  <span className="font-medium text-[var(--color-ink)]">{w.name}</span>
                  <span className="text-[11px] text-[var(--color-muted)]">{w.currency}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowMoveModal(false)}
              className="w-full py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
            >
              {isRTL ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Change Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-sm bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-4 space-y-3">
            <h3 className="font-bold text-sm text-[var(--color-ink)]">
              {isRTL ? 'تغيير تصنيف المعاملات المحددة' : 'Change Selected Transactions Category'}
            </h3>
            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
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
              className="w-full py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
            >
              {isRTL ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
