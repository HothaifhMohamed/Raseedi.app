/**
 * Dedicated Adjust Balance modal for Wallets & Owned Assets.
 * Reconciles current balance to a target balance cleanly via an adjustment transaction
 * (preserving ledger accuracy) or optionally by updating initialBalance directly.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, X, Check, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Wallet } from '../../types';
import { formatCurrencyAmount } from '../../services/calculations';
import { normalizeArabicPersianNumerals } from '../../services/numbers';
import { calculateBalanceAdjustment } from '../../services/wealthAnalytics';

interface AdjustBalanceModalProps {
  wallet: Wallet | null;
  isRTL: boolean;
  decimalPlaces: number;
  digitFormat: 'arabic' | 'western';
  language: 'ar' | 'en';
  onClose: () => void;
  onConfirmAdjustment: (params: {
    wallet: Wallet;
    targetBalance: number;
    mode: 'transaction' | 'opening_balance';
    note: string;
  }) => Promise<void> | void;
}

export const AdjustBalanceModal: React.FC<AdjustBalanceModalProps> = ({
  wallet,
  isRTL,
  decimalPlaces,
  digitFormat,
  language,
  onClose,
  onConfirmAdjustment,
}) => {
  const [targetInput, setTargetInput] = useState('');
  const [mode, setMode] = useState<'transaction' | 'opening_balance'>('transaction');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (wallet) {
      setTargetInput(String(wallet.balance));
      setMode('transaction');
      setNote('');
      setIsSaving(false);
    }
  }, [wallet]);

  const parsedTarget = useMemo(() => {
    const cleaned = normalizeArabicPersianNumerals(targetInput).replace(/,/g, '').trim();
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }, [targetInput]);

  const plan = useMemo(() => {
    if (!wallet || parsedTarget === null) return null;
    return calculateBalanceAdjustment(wallet.balance, parsedTarget, wallet.currency);
  }, [wallet, parsedTarget]);

  if (!wallet) return null;

  const fmt = (val: number) =>
    formatCurrencyAmount(val, wallet.currency, {
      decimalPlaces,
      digitFormat,
      language,
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedTarget === null || !plan || plan.transactionType === null || isSaving) return;
    setIsSaving(true);
    try {
      await onConfirmAdjustment({
        wallet,
        targetBalance: parsedTarget,
        mode,
        note: note.trim(),
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        data-testid="adjust-balance-modal"
        className="w-full sm:max-w-md bg-[var(--color-surface)] border border-[var(--color-line)] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--color-line)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-[var(--color-gold-soft)] text-[var(--color-gold-text)] flex items-center justify-center shrink-0">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-[var(--color-ink)] truncate">
                {isRTL ? 'تعديل الرصيد' : 'Adjust Balance'}
              </h2>
              <p className="text-xs text-[var(--color-muted)] truncate">{wallet.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-subtle)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="rounded-2xl bg-[var(--color-surface-subtle)] border border-[var(--color-line)] px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--color-muted)]">
              {isRTL ? 'الرصيد الحالي' : 'Current Balance'}
            </span>
            <span className="text-sm font-extrabold text-[var(--color-ink)] num-tabular">
              {fmt(wallet.balance)}
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--color-muted)] mb-1.5">
              {isRTL ? 'الرصيد الفعلي الجديد' : 'New Target Balance'} ({wallet.currency})
            </label>
            <input
              type="text"
              inputMode="decimal"
              data-testid="adjust-balance-input"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="w-full min-h-[48px] px-4 py-3 rounded-2xl bg-[var(--color-surface-subtle)] border border-[var(--color-line)] text-lg font-extrabold text-[var(--color-ink)] num-tabular focus:outline-none focus:border-[var(--color-accent)]"
              autoFocus
            />
          </div>

          {/* Live Delta Preview */}
          {plan && (
            <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-subtle)] px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--color-muted)]">
                {isRTL ? 'فرق التسوية' : 'Adjustment Delta'}
              </span>
              {plan.transactionType === null ? (
                <span className="text-xs font-bold text-[var(--color-muted)]">
                  {isRTL ? 'لا يوجد فرق' : 'No change'}
                </span>
              ) : (
                <span
                  className={`inline-flex items-center gap-1 text-sm font-extrabold num-tabular ${
                    plan.transactionType === 'income'
                      ? 'text-[var(--color-income)]'
                      : 'text-[var(--color-expense)]'
                  }`}
                >
                  {plan.transactionType === 'income' ? (
                    <ArrowUpRight className="w-4 h-4" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4" />
                  )}
                  {plan.transactionType === 'income' ? '+' : '-'}
                  {fmt(plan.absAmount)}
                </span>
              )}
            </div>
          )}

          {/* Mode Toggle */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[var(--color-muted)]">
              {isRTL ? 'طريقة التسوية' : 'Adjustment Method'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('transaction')}
                className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                  mode === 'transaction'
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
                    : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {isRTL ? 'قيد تسوية تلقائي' : 'Adjustment Entry'}
              </button>
              <button
                type="button"
                onClick={() => setMode('opening_balance')}
                className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                  mode === 'opening_balance'
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
                    : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {isRTL ? 'تعديل الرصيد الافتتاحي' : 'Update Opening Balance'}
              </button>
            </div>
            <p className="text-[11px] text-[var(--color-muted)]">
              {mode === 'transaction'
                ? isRTL
                  ? 'يسجّل عملية تسوية بالفرق للحفاظ على دقة السجل المالي وتاريخ المعاملات.'
                  : 'Records a balancing transaction for the difference so ledger history stays intact.'
                : isRTL
                ? 'يُعدّل الرصيد الافتتاحي للمحفظة مباشرة دون إضافة معاملة جديدة.'
                : 'Adjusts the wallet opening balance directly without adding a transaction.'}
            </p>
          </div>

          {mode === 'transaction' && (
            <div>
              <label className="block text-xs font-bold text-[var(--color-muted)] mb-1">
                {isRTL ? 'ملاحظة (اختياري)' : 'Note (Optional)'}
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isRTL ? 'مثال: تسوية جرد نقدي' : 'e.g. Cash reconciliation'}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[var(--color-surface-subtle)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>
          )}

          <button
            type="submit"
            data-testid="adjust-balance-confirm-btn"
            disabled={!plan || plan.transactionType === null || isSaving}
            className="w-full min-h-[48px] rounded-2xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] disabled:opacity-45 disabled:cursor-not-allowed text-[var(--color-on-accent)] text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Check className="w-4 h-4" />
            <span>
              {isSaving
                ? isRTL
                  ? 'جاري الحفظ...'
                  : 'Saving...'
                : isRTL
                ? 'تأكيد تعديل الرصيد'
                : 'Confirm Balance Adjustment'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
};
