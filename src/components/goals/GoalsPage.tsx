import React, { useState } from 'react';
import {
  Target,
  Plus,
  Trophy,
  Calendar,
  Edit2,
  Trash2,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SavingsGoal } from '../../types';
import { IconRenderer } from '../common/IconRenderer';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { MoneyText } from '../common/MoneyText';
import { getCurrencyDecimals, roundCurrency } from '../../services/currency';

const GOAL_ICONS = ['Target', 'Trophy', 'Car', 'Home', 'Plane', 'ShieldCheck', 'Smartphone', 'GraduationCap', 'Heart'];
const GOAL_COLORS = [
  '#1E6F73', // Deep Turquoise
  '#5E7F3A', // Olive
  '#C99A2E', // Ochre
  '#B5523B', // Terracotta
  '#7A4E6D', // Plum
];

export const GoalsPage: React.FC = () => {
  const {
    goals,
    wallets,
    settings,
    addGoal,
    updateGoal,
    contributeToGoal,
    deleteGoal,
    openCurrencyPicker,
    t,
    isRTL,
  } = useApp();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [contributeGoal, setContributeGoal] = useState<{ goal: SavingsGoal; isWithdrawal: boolean } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form State
  const [goalName, setGoalName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [currentAmount, setCurrentAmount] = useState('0');
  const [currency, setCurrency] = useState(settings.mainCurrency);
  const [deadline, setDeadline] = useState('');
  const [goalIcon, setGoalIcon] = useState('Target');
  const [goalColor, setGoalColor] = useState(GOAL_COLORS[0]);
  const [linkedWalletId, setLinkedWalletId] = useState('');

  // Contribution Form
  const [actionAmount, setActionAmount] = useState('');
  const [selectedWalletId, setSelectedWalletId] = useState(wallets[0]?.id || '');

  const openAddModal = (g?: SavingsGoal) => {
    if (g) {
      setEditingGoal(g);
      setGoalName(g.name);
      setTargetAmount(String(g.targetAmount));
      setCurrentAmount(String(g.currentAmount));
      setCurrency(g.currency);
      setDeadline(g.deadline || '');
      setGoalIcon(g.icon);
      setGoalColor(g.color.startsWith('#') ? g.color : GOAL_COLORS[0]);
      setLinkedWalletId(g.walletId || '');
    } else {
      setEditingGoal(null);
      setGoalName('');
      setTargetAmount('');
      setCurrentAmount('0');
      setCurrency(settings.mainCurrency);
      setDeadline('');
      setGoalIcon('Target');
      setGoalColor(GOAL_COLORS[0]);
      setLinkedWalletId(wallets[0]?.id || '');
    }
    setIsAddModalOpen(true);
  };

  const handleSaveGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseFloat(targetAmount);
    const curr = parseFloat(currentAmount) || 0;
    if (!goalName.trim() || isNaN(target) || target <= 0) return;

    const payload = {
      name: goalName.trim(),
      targetAmount: target,
      currentAmount: curr,
      currency,
      deadline: deadline || undefined,
      icon: goalIcon,
      color: goalColor,
      walletId: linkedWalletId || undefined,
    };

    if (editingGoal) {
      updateGoal(editingGoal.id, payload);
    } else {
      addGoal(payload);
    }

    setIsAddModalOpen(false);
  };

  const handleContributionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contributeGoal) return;
    const amountNum = parseFloat(actionAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    contributeToGoal(
      contributeGoal.goal.id,
      amountNum,
      selectedWalletId || undefined,
      contributeGoal.isWithdrawal
    );

    setContributeGoal(null);
    setActionAmount('');
  };

  return (
    <div className="flex flex-col flex-1 px-4 py-3 pb-24 space-y-4">
      {/* Header */}
      <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between shadow-xs">
        <div>
          <h2 className="text-sm font-bold text-[var(--color-ink)] flex items-center gap-2">
            <Target className="w-5 h-5 text-[var(--color-accent)]" />
            <span>{t('goalsTitle')}</span>
          </h2>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            {isRTL ? 'حدد أهداف ادخار لأحلامك المستقبلية وراقب تقدمك' : 'Set savings goals and track your progress'}
          </p>
        </div>

        <button
          onClick={() => openAddModal()}
          className="flex items-center gap-1.5 px-3 py-2 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs transition min-h-[38px]"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>{t('addGoal')}</span>
        </button>
      </div>

      {/* Goals List */}
      {goals.length === 0 ? (
        <div className="p-8 my-6 text-center bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex flex-col items-center">
          <div className="w-12 h-12 rounded-xl bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center mb-3">
            <Trophy className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[var(--color-ink)] mb-1">{t('noGoals')}</h3>
          <p className="text-xs text-[var(--color-muted)] max-w-xs leading-relaxed mb-5">
            {isRTL
              ? 'ابدأ بتحديد هدف مالي (شراء سيارة، صندوق طوارئ، رحلة سياحية) وربطه بمحفظتك.'
              : 'Start by setting a financial goal and link it to your wallet.'}
          </p>
          <button
            onClick={() => openAddModal()}
            className="flex items-center gap-1.5 px-4 py-2 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs transition min-h-[44px]"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>{t('addGoal')}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3.5">
          {goals.map((g) => {
            const percentage = g.targetAmount > 0 ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0;
            const remaining = Math.max(0, g.targetAmount - g.currentAmount);
            const isDone = g.currentAmount >= g.targetAmount;
            const barColor = g.color?.startsWith('#') ? g.color : 'var(--color-accent)';

            return (
              <div
                key={g.id}
                className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3 relative overflow-hidden"
              >
                {/* Top: Icon + Name + Actions */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-xs shrink-0"
                      style={{ backgroundColor: barColor }}
                    >
                      <IconRenderer name={g.icon || 'Target'} className="w-5 h-5" />
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[var(--color-ink)]">{g.name}</h3>
                        {isDone && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-income)]/15 text-[var(--color-income)] font-bold flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            <span>{isRTL ? 'مكتمل!' : 'Completed!'}</span>
                          </span>
                        )}
                      </div>

                      {g.deadline && (
                        <div className="text-[11px] text-[var(--color-muted)] mt-0.5 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          <span>{isRTL ? `الموعد: ${g.deadline}` : `Target: ${g.deadline}`}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openAddModal(g)}
                      className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(g.id)}
                      className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-expense)] min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar & Amounts */}
                <div className="space-y-1.5">
                  <div className="w-full h-2 rounded-full bg-[var(--color-bg)] border border-[var(--color-line)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%`, backgroundColor: barColor }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-[var(--color-muted)]">{isRTL ? 'مدخر:' : 'Saved:'}</span>
                      <MoneyText
                        amount={g.currentAmount}
                        currency={g.currency}
                        type="income"
                        colorByType={true}
                        className="font-bold text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-1 text-[var(--color-muted)]">
                      <span>{isRTL ? 'الهدف:' : 'Goal:'}</span>
                      <MoneyText
                        amount={g.targetAmount}
                        currency={g.currency}
                        className="text-xs font-semibold text-[var(--color-ink)]"
                      />
                      <span>({percentage}%)</span>
                    </div>
                  </div>

                  {!isDone && (
                    <div className="text-[11px] text-[var(--color-muted)] text-right flex items-center justify-end gap-1">
                      <span>{isRTL ? 'متبقي للهدف:' : 'Remaining:'}</span>
                      <MoneyText
                        amount={remaining}
                        currency={g.currency}
                        className="text-xs font-medium text-[var(--color-muted)]"
                      />
                    </div>
                  )}
                </div>

                {/* Action Buttons: Deposit or Withdraw */}
                <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-line)]">
                  <button
                    onClick={() => setContributeGoal({ goal: g, isWithdrawal: false })}
                    className="flex-1 py-2 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs transition flex items-center justify-center gap-1.5 min-h-[40px]"
                  >
                    <ArrowDownLeft className="w-4 h-4" />
                    <span>{isRTL ? 'إيداع ادخار' : 'Deposit'}</span>
                  </button>

                  <button
                    onClick={() => setContributeGoal({ goal: g, isWithdrawal: true })}
                    className="flex-1 py-2 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] font-semibold rounded-lg text-xs transition flex items-center justify-center gap-1.5 min-h-[40px]"
                  >
                    <ArrowUpRight className="w-4 h-4 text-[var(--color-expense)]" />
                    <span>{isRTL ? 'سحب من الهدف' : 'Withdraw'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Goal Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-4">
              <h3 className="text-sm font-bold">
                {editingGoal ? (isRTL ? 'تعديل هدف الادخار' : 'Edit Goal') : t('addGoal')}
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveGoal} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">{t('goalName')}</label>
                <input
                  type="text"
                  required
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  placeholder={isRTL ? 'مثال: شراء سيارة جديدة، صندوق طوارئ...' : 'e.g. New car fund'}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">{t('targetAmount')}</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {isRTL ? 'العملة' : 'Currency'}
                  </label>
                  <button
                    type="button"
                    onClick={() => openCurrencyPicker((code) => setCurrency(code), currency)}
                    className="w-full py-2 px-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs font-semibold text-[var(--color-accent)] text-center min-h-[44px] flex items-center justify-center"
                  >
                    {currency}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">{t('currentSaved')}</label>
                  <input
                    type="number"
                    step="any"
                    value={currentAmount}
                    onChange={(e) => setCurrentAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">{t('deadline')}</label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full px-2 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px]"
                  />
                </div>
              </div>

              {/* Icon Picker */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5">
                  {isRTL ? 'الأيقونة' : 'Icon'}
                </label>
                <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
                  {GOAL_ICONS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => setGoalIcon(ic)}
                      className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors shrink-0 min-h-[36px] min-w-[36px] ${
                        goalIcon === ic
                          ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                          : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)]'
                      }`}
                    >
                      <IconRenderer name={ic} className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Selection */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5">
                  {isRTL ? 'اللون والسمة' : 'Color theme'}
                </label>
                <div className="flex items-center gap-2">
                  {GOAL_COLORS.map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setGoalColor(col)}
                      className={`h-8 flex-1 rounded-lg border-2 transition-transform ${
                        goalColor === col ? 'border-[var(--color-ink)] scale-105' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: col }}
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs transition min-h-[44px]"
              >
                {editingGoal ? t('submitSaveTransaction') : t('save')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Deposit / Withdraw Modal */}
      {contributeGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-4">
              <h3 className="text-sm font-bold">
                {contributeGoal.isWithdrawal
                  ? (isRTL ? 'سحب من الهدف' : 'Withdraw from goal')
                  : (isRTL ? 'إيداع في الهدف' : 'Deposit to goal')}
                : {contributeGoal.goal.name}
              </h3>
              <button
                onClick={() => setContributeGoal(null)}
                className="p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleContributionSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">{t('amount')}</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={actionAmount}
                  onChange={(e) => setActionAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                  {isRTL ? 'المحفظة المرتبطة (خصم/إضافة)' : 'Linked Wallet'}
                </label>
                <select
                  value={selectedWalletId}
                  onChange={(e) => setSelectedWalletId(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px]"
                >
                  <option value="">{isRTL ? 'بدون تعديل رصيد محفظة' : 'No wallet balance change'}</option>
                  {wallets.map((w) => {
                    const dec = getCurrencyDecimals(w.currency, settings.decimalPlaces);
                    return (
                      <option key={w.id} value={w.id}>
                        {w.name} ({roundCurrency(w.balance, dec).toFixed(dec)} {w.currency})
                      </option>
                    );
                  })}
                </select>
              </div>

              <button
                type="submit"
                className={`w-full py-2.5 font-semibold rounded-lg text-xs transition min-h-[44px] ${
                  contributeGoal.isWithdrawal
                    ? 'bg-[var(--color-expense)] text-white hover:opacity-90'
                    : 'bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:opacity-90'
                }`}
              >
                {contributeGoal.isWithdrawal
                  ? (isRTL ? 'تأكيد السحب' : 'Confirm Withdrawal')
                  : (isRTL ? 'تأكيد الإيداع' : 'Confirm Deposit')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmationModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) deleteGoal(confirmDeleteId);
        }}
        title={isRTL ? 'حذف الهدف' : 'Delete Goal'}
        message={isRTL ? 'هل أنت متأكد من حذف هذا الهدف؟' : 'Are you sure you want to delete this goal?'}
        confirmLabel={isRTL ? 'حذف' : 'Delete'}
        cancelLabel={isRTL ? 'إلغاء' : 'Cancel'}
      />
    </div>
  );
};
