import React, { useMemo, useState } from 'react';
import {
  Users,
  Plus,
  X,
  CheckCircle2,
  Trash2,
  Edit2,
  Coins,
  Sparkles,
  Wallet as WalletIcon,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { calculateMoneyCircleSummary } from '../../services/calculations';
import { MoneyText } from '../common/MoneyText';
import { MoneyCircle } from '../../types';

interface MoneyCirclesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MoneyCirclesModal: React.FC<MoneyCirclesModalProps> = ({ isOpen, onClose }) => {
  const {
    moneyCircles,
    wallets,
    settings,
    addMoneyCircle,
    updateMoneyCircle,
    deleteMoneyCircle,
    toggleMoneyCircleMonthPaid,
    markMoneyCirclePayoutReceived,
    openCurrencyPicker,
    t,
    isRTL,
  } = useApp();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MoneyCircle | null>(null);
  const [name, setName] = useState('');
  const [monthlyShare, setMonthlyShare] = useState('');
  const [currency, setCurrency] = useState(settings.mainCurrency);
  const [totalMonths, setTotalMonths] = useState('10');
  const [myTurnMonth, setMyTurnMonth] = useState('1');
  const [walletId, setWalletId] = useState('');
  const [notes, setNotes] = useState('');
  const [syncWithWallet, setSyncWithWallet] = useState(true);

  const totals = useMemo(() => {
    let monthlyCommitment = 0;
    let activeCount = 0;
    moneyCircles.forEach((circle) => {
      const s = calculateMoneyCircleSummary(circle);
      if (!s.isCompleted) {
        activeCount++;
        monthlyCommitment += circle.monthlyShare;
      }
    });
    return { activeCount, monthlyCommitment };
  }, [moneyCircles]);

  if (!isOpen) return null;

  const openNew = () => {
    setEditing(null);
    setName('');
    setMonthlyShare('');
    setCurrency(settings.mainCurrency);
    setTotalMonths('10');
    setMyTurnMonth('1');
    setWalletId(wallets.find((w) => !w.isArchived)?.id || '');
    setNotes('');
    setShowForm(true);
  };

  const openEdit = (circle: MoneyCircle) => {
    setEditing(circle);
    setName(circle.name);
    setMonthlyShare(String(circle.monthlyShare));
    setCurrency(circle.currency);
    setTotalMonths(String(circle.totalMonths));
    setMyTurnMonth(String(circle.myTurnMonth));
    setWalletId(circle.walletId || '');
    setNotes(circle.notes || '');
    setShowForm(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const monthsNum = Math.max(2, Math.min(60, Math.floor(Number(totalMonths) || 10)));
    const turnNum = Math.max(1, Math.min(monthsNum, Math.floor(Number(myTurnMonth) || 1)));
    const shareNum = Math.max(0.01, Number(monthlyShare) || 0);
    if (!name.trim() || shareNum <= 0) return;

    if (editing) {
      updateMoneyCircle(editing.id, {
        name: name.trim(),
        monthlyShare: shareNum,
        currency,
        totalMonths: monthsNum,
        myTurnMonth: turnNum,
        walletId: walletId || undefined,
        notes: notes.trim() || undefined,
      });
    } else {
      addMoneyCircle({
        name: name.trim(),
        monthlyShare: shareNum,
        currency,
        totalMonths: monthsNum,
        myTurnMonth: turnNum,
        walletId: walletId || undefined,
        notes: notes.trim() || undefined,
      });
    }
    setShowForm(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <div
        data-testid="money-circles-modal"
        className="w-full max-w-lg max-h-[90vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl shadow-2xl overflow-hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--color-line)] bg-[var(--color-bg)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
            <div className="min-w-0">
              <h2 className="font-title leading-snug text-base font-bold text-[var(--color-ink)] truncate">
                {t('moneyCircles')}
              </h2>
              <p className="text-[11px] text-[var(--color-muted)]">
                {isRTL
                  ? 'تنظيم الأقساط الشهرية ومواعيد القبض بسهولة'
                  : 'Track monthly installments and your payout turn'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="add-money-circle-btn"
              onClick={openNew}
              className="px-3 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center gap-1 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>{t('addMoneyCircle')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              className="w-11 h-11 rounded-xl border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary Strip */}
        <div className="px-4 py-2.5 border-b border-[var(--color-line)] bg-[var(--color-surface)] flex items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-muted)]">
              {isRTL ? 'الجمعيات النشطة:' : 'Active:'}
            </span>
            <span className="font-bold text-[var(--color-ink)] num-tabular">
              {totals.activeCount}
            </span>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={syncWithWallet}
              onChange={(e) => setSyncWithWallet(e.target.checked)}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
            <span>{isRTL ? 'قيد تلقائي بالمحفظة' : 'Auto wallet entry'}</span>
          </label>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {showForm && (
            <form
              onSubmit={handleSave}
              className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/40 space-y-2.5"
            >
              <div className="text-xs font-bold text-[var(--color-ink)]">
                {editing
                  ? isRTL
                    ? 'تعديل بيانات الجمعية'
                    : 'Edit Money Circle'
                  : t('addMoneyCircle')}
              </div>

              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isRTL ? 'اسم الجمعية (مثال: جمعية العمل أو العائلة)' : 'Circle name'}
                className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
              />

              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  value={monthlyShare}
                  onChange={(e) => setMonthlyShare(e.target.value)}
                  placeholder={t('monthlyShare')}
                  className="col-span-2 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={() => openCurrencyPicker((code) => setCurrency(code), currency)}
                  className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs font-bold text-[var(--color-accent)] min-h-[44px]"
                >
                  {currency}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[var(--color-muted)] mb-1">
                    {t('totalMonths')}
                  </label>
                  <input
                    type="number"
                    min="2"
                    max="60"
                    required
                    value={totalMonths}
                    onChange={(e) => setTotalMonths(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--color-muted)] mb-1">
                    {t('myTurnMonth')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={Number(totalMonths) || 60}
                    required
                    value={myTurnMonth}
                    onChange={(e) => setMyTurnMonth(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                  />
                </div>
              </div>

              <select
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
              >
                <option value="">
                  {isRTL ? 'بدون ربط بمحفظة (تتبع فقط)' : 'No linked wallet (track only)'}
                </option>
                {wallets
                  .filter((w) => !w.isArchived)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.currency})
                    </option>
                  ))}
              </select>

              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={isRTL ? 'ملاحظات أو اسم منظم الجمعية' : 'Organizer / notes'}
                className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-lg border border-[var(--color-line)] text-xs text-[var(--color-muted)] min-h-[44px]"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  data-testid="save-money-circle-btn"
                  className="flex-1 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px]"
                >
                  {t('save')}
                </button>
              </div>
            </form>
          )}

          {moneyCircles.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--color-muted)] space-y-2 bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
              <Coins className="w-8 h-8 mx-auto text-[var(--color-accent)]/60" />
              <p>
                {isRTL
                  ? 'لم تقم بإضافة أي جمعية مالية بعد. اضغط "إنشاء جمعية جديدة" للبدء.'
                  : 'No money circles yet. Tap "Create Money Circle" to start tracking.'}
              </p>
            </div>
          ) : (
            moneyCircles.map((circle) => {
              const summary = calculateMoneyCircleSummary(circle);
              const linkedWallet = circle.walletId
                ? wallets.find((w) => w.id === circle.walletId)
                : null;
              const months = Array.from({ length: circle.totalMonths }, (_, idx) => idx + 1);

              return (
                <div
                  key={circle.id}
                  data-testid={`money-circle-card-${circle.id}`}
                  className="p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-[var(--color-ink)]">{circle.name}</h3>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)]/12 text-[var(--color-accent)] font-semibold">
                          {isRTL ? `دوري: شهر ${circle.myTurnMonth}` : `My turn: M${circle.myTurnMonth}`}
                        </span>
                        {circle.hasReceivedPayout && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-income)]/15 text-[var(--color-income)] font-bold inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            {isRTL ? 'تم القبض' : 'Payout Received'}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)] mt-1 flex items-center gap-2 flex-wrap">
                        <span>
                          {t('monthlyShare')}:{' '}
                          <MoneyText
                            amount={circle.monthlyShare}
                            currency={circle.currency}
                            className="font-bold text-[var(--color-ink)]"
                          />
                        </span>
                        <span>•</span>
                        <span>
                          {isRTL ? 'إجمالي القبض:' : 'Pool:'}{' '}
                          <MoneyText
                            amount={summary.totalPoolAmount}
                            currency={circle.currency}
                            className="font-bold text-[var(--color-accent)]"
                          />
                        </span>
                      </div>
                      {linkedWallet && (
                        <div className="text-[10px] text-[var(--color-muted)] mt-0.5 flex items-center gap-1">
                          <WalletIcon className="w-3 h-3 text-[var(--color-accent)]" />
                          <span>{linkedWallet.name}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEdit(circle)}
                        className="p-2 text-[var(--color-muted)] hover:text-[var(--color-accent)] rounded-lg min-h-[38px]"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMoneyCircle(circle.id)}
                        className="p-2 text-[var(--color-muted)] hover:text-[var(--color-expense)] rounded-lg min-h-[38px]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--color-muted)]">
                        {t('paidMonthsLabel')}: {summary.paidCount} / {circle.totalMonths} (
                        {summary.progressPct}%)
                      </span>
                      <span className="text-[var(--color-muted)]">
                        {isRTL ? 'المتبقي:' : 'Left:'}{' '}
                        <MoneyText amount={summary.totalRemaining} currency={circle.currency} className="font-semibold" />
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[var(--color-line)]/60 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--color-accent)] transition-all"
                        style={{ width: `${summary.progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Interactive Monthly Grid */}
                  <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5">
                    {months.map((m) => {
                      const isPaid = circle.paidMonths.includes(String(m));
                      const isMyTurn = m === circle.myTurnMonth;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => toggleMoneyCircleMonthPaid(circle.id, m, syncWithWallet)}
                          className={`py-2 px-1 rounded-lg text-[11px] font-bold border transition-colors min-h-[38px] flex items-center justify-center gap-1 ${
                            isPaid
                              ? 'bg-[var(--color-income)] text-white border-[var(--color-income)]'
                              : isMyTurn
                              ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning-text)] border-[var(--color-warning)]'
                              : 'bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-line)] hover:border-[var(--color-accent)]'
                          }`}
                          title={isMyTurn ? (isRTL ? 'شهر دورك للقبض' : 'Your payout month') : undefined}
                        >
                          <span>{isRTL ? `ش${m}` : `M${m}`}</span>
                          {isMyTurn && !isPaid && <Sparkles className="w-3 h-3" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Confirm Payout Received Button */}
                  {!circle.hasReceivedPayout && (
                    <button
                      type="button"
                      data-testid={`mark-payout-${circle.id}`}
                      onClick={() => markMoneyCirclePayoutReceived(circle.id, syncWithWallet)}
                      className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-accent)]/12 border border-[var(--color-accent)]/40 text-[var(--color-accent)] text-xs font-bold hover:bg-[var(--color-accent)] hover:text-[var(--color-on-accent)] transition-colors min-h-[44px] flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {t('markPayoutReceived')} ({summary.totalPoolAmount} {circle.currency})
                      </span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
