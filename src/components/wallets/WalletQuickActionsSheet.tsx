import React, { useEffect } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Edit2,
  PauseCircle,
  PlayCircle,
  ReceiptText,
  Trash2,
  X,
} from 'lucide-react';
import { Wallet } from '../../types';
import { IconRenderer } from '../common/IconRenderer';
import { MoneyText } from '../common/MoneyText';
import { canTransferFromWallet } from '../../services/walletQuickActions';

interface WalletQuickActionsSheetProps {
  wallet: Wallet | null;
  allWallets: Wallet[];
  isBalanceHidden?: boolean;
  isRTL: boolean;
  onClose: () => void;
  onDeposit: (wallet: Wallet) => void;
  onWithdraw: (wallet: Wallet) => void;
  onTransfer: (wallet: Wallet) => void;
  onViewTransactions: (wallet: Wallet) => void;
  onEdit: (wallet: Wallet) => void;
  onToggleArchive: (wallet: Wallet) => void;
  onDelete: (wallet: Wallet) => void;
}

export const WalletQuickActionsSheet: React.FC<WalletQuickActionsSheetProps> = ({
  wallet,
  allWallets,
  isBalanceHidden = false,
  isRTL,
  onClose,
  onDeposit,
  onWithdraw,
  onTransfer,
  onViewTransactions,
  onEdit,
  onToggleArchive,
  onDelete,
}) => {
  useEffect(() => {
    if (!wallet) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [wallet, onClose]);

  if (!wallet) return null;

  const cardColor = wallet.color?.startsWith('#') ? wallet.color : '#3A605B';
  const canTransfer = canTransferFromWallet(wallet, allWallets);
  const ChevronEnd = isRTL ? ChevronLeft : ChevronRight;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="wallet-quick-actions-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-quick-actions-title"
        data-testid="wallet-quick-actions-sheet"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[var(--color-surface)] border-t sm:border border-[var(--color-line)] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 pb-[env(safe-area-inset-bottom)] sm:pb-0"
      >
        {/* Mobile grab handle */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-[var(--color-line)]" aria-hidden="true" />
        </div>

        {/* Header: Wallet Identity & Balance */}
        <div className="px-4 pt-3 pb-3.5 border-b border-[var(--color-line)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 shadow-xs"
              style={{ backgroundColor: cardColor }}
            >
              <IconRenderer name={wallet.icon || 'Wallet'} className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3
                id="wallet-quick-actions-title"
                className="text-sm font-bold text-[var(--color-ink)] truncate"
              >
                {wallet.name}
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] mt-0.5 flex-wrap">
                <span className="font-mono">{wallet.currency}</span>
                <span aria-hidden="true">·</span>
                {isBalanceHidden ? (
                  <span className="font-semibold text-[var(--color-ink)]">••••••••</span>
                ) : (
                  <MoneyText
                    amount={wallet.balance}
                    currency={wallet.currency}
                    className="font-bold text-[var(--color-ink)] num-tabular"
                  />
                )}
                {wallet.isArchived && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[var(--color-warning-text)] font-medium">
                      {isRTL ? 'متوقفة مؤقتاً' : 'Paused'}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={isRTL ? 'إغلاق القائمة السريعة' : 'Close quick actions'}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Primary Balance Actions: Add Funds & Withdraw Funds */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              data-testid="quick-action-deposit"
              onClick={() => onDeposit(wallet)}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--color-income)]/10 hover:bg-[var(--color-income)]/15 active:scale-[0.98] border border-[var(--color-income)]/25 text-[var(--color-income)] transition-all min-h-[58px] text-start"
            >
              <span className="w-9 h-9 rounded-lg bg-[var(--color-income)]/15 flex items-center justify-center shrink-0">
                <ArrowDownLeft className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold leading-tight truncate">
                  {isRTL ? 'إضافة رصيد' : 'Add Funds'}
                </span>
                <span className="block text-[10px] opacity-80 mt-0.5 truncate">
                  {isRTL ? 'إيداع أو دخل' : 'Deposit / Income'}
                </span>
              </span>
            </button>

            <button
              type="button"
              data-testid="quick-action-withdraw"
              onClick={() => onWithdraw(wallet)}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--color-expense)]/10 hover:bg-[var(--color-expense)]/15 active:scale-[0.98] border border-[var(--color-expense)]/25 text-[var(--color-expense)] transition-all min-h-[58px] text-start"
            >
              <span className="w-9 h-9 rounded-lg bg-[var(--color-expense)]/15 flex items-center justify-center shrink-0">
                <ArrowUpRight className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold leading-tight truncate">
                  {isRTL ? 'سحب رصيد' : 'Withdraw'}
                </span>
                <span className="block text-[10px] opacity-80 mt-0.5 truncate">
                  {isRTL ? 'صرف أو سحب' : 'Expense / Out'}
                </span>
              </span>
            </button>
          </div>

          {/* Core Navigation & Transfer List */}
          <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] divide-y divide-[var(--color-line)] overflow-hidden">
            <button
              type="button"
              data-testid="quick-action-transfer"
              disabled={!canTransfer}
              onClick={() => onTransfer(wallet)}
              className="w-full px-3.5 py-3 flex items-center justify-between gap-3 text-start transition-colors hover:bg-[var(--color-surface)] disabled:opacity-45 disabled:cursor-not-allowed min-h-[54px]"
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-lg bg-[var(--color-accent)]/12 text-[var(--color-accent)] flex items-center justify-center shrink-0">
                  <ArrowLeftRight className="w-4 h-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[var(--color-ink)] truncate">
                    {isRTL ? 'تحويل رصيد بين المحافظ' : 'Transfer Between Wallets'}
                  </span>
                  <span className="block text-[11px] text-[var(--color-muted)] truncate mt-0.5">
                    {canTransfer
                      ? isRTL
                        ? 'نقل رصيد من هذه المحفظة إلى محفظة أخرى'
                        : 'Move funds from this wallet to another'
                      : isRTL
                      ? 'يتطلب وجود محفظتين على الأقل'
                      : 'Requires at least 2 wallets'}
                  </span>
                </span>
              </span>
              <ChevronEnd className="w-4 h-4 text-[var(--color-muted)] shrink-0" />
            </button>

            <button
              type="button"
              data-testid="quick-action-view-transactions"
              onClick={() => onViewTransactions(wallet)}
              className="w-full px-3.5 py-3 flex items-center justify-between gap-3 text-start transition-colors hover:bg-[var(--color-surface)] min-h-[54px]"
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] flex items-center justify-center shrink-0">
                  <ReceiptText className="w-4 h-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[var(--color-ink)] truncate">
                    {isRTL ? 'عرض المعاملات' : 'View Transactions'}
                  </span>
                  <span className="block text-[11px] text-[var(--color-muted)] truncate mt-0.5">
                    {isRTL ? 'تصفح كشف حساب المحفظة بالكامل' : 'Browse wallet ledger and history'}
                  </span>
                </span>
              </span>
              <ChevronEnd className="w-4 h-4 text-[var(--color-muted)] shrink-0" />
            </button>

            <button
              type="button"
              data-testid="quick-action-edit"
              onClick={() => onEdit(wallet)}
              className="w-full px-3.5 py-3 flex items-center justify-between gap-3 text-start transition-colors hover:bg-[var(--color-surface)] min-h-[54px]"
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] flex items-center justify-center shrink-0">
                  <Edit2 className="w-4 h-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[var(--color-ink)] truncate">
                    {isRTL ? 'تعديل المحفظة' : 'Edit Wallet'}
                  </span>
                  <span className="block text-[11px] text-[var(--color-muted)] truncate mt-0.5">
                    {isRTL ? 'تغيير الاسم، العملة، اللون أو الرصيد الافتتاحي' : 'Update name, currency, color, or opening balance'}
                  </span>
                </span>
              </span>
              <ChevronEnd className="w-4 h-4 text-[var(--color-muted)] shrink-0" />
            </button>
          </div>

          {/* Secondary Lifecycle Actions: Pause/Resume & Delete */}
          <div className="grid grid-cols-2 gap-2.5 pt-0.5">
            <button
              type="button"
              data-testid="quick-action-toggle-archive"
              onClick={() => onToggleArchive(wallet)}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-semibold text-[var(--color-ink)] transition-colors min-h-[46px]"
            >
              {wallet.isArchived ? (
                <>
                  <PlayCircle className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <span className="truncate">{isRTL ? 'إعادة تفعيل' : 'Resume Wallet'}</span>
                </>
              ) : (
                <>
                  <PauseCircle className="w-4 h-4 text-[var(--color-muted)] shrink-0" />
                  <span className="truncate">{isRTL ? 'إيقاف مؤقت' : 'Pause Wallet'}</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid="quick-action-delete"
              onClick={() => onDelete(wallet)}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-[var(--color-expense)]/10 hover:bg-[var(--color-expense)]/15 border border-[var(--color-expense)]/25 text-xs font-semibold text-[var(--color-expense)] transition-colors min-h-[46px]"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{isRTL ? 'حذف المحفظة' : 'Delete Wallet'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
