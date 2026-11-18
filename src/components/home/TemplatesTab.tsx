import React, { useState } from 'react';
import {
  Bookmark,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  X,
  Zap,
  Crown,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Template, TransactionType, PriorityLevel } from '../../types';
import { formatCurrencyAmount } from '../../services/calculations';
import { normalizeArabicPersianNumerals, parseLocalizedNumber } from '../../services/numbers';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { MoneyText } from '../common/MoneyText';

export const TemplatesTab: React.FC = () => {
  const {
    templates,
    wallets,
    categories,
    settings,
    applyTemplate,
    deleteTemplate,
    addTemplate,
    updateTemplate,
    isPro,
    setIsUpgradeModalOpen,
    t,
    isRTL,
  } = useApp();

  const [appliedNotification, setAppliedNotification] = useState<string | null>(null);
  const [deleteTmplId, setDeleteTmplId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  // Modal Form State
  const [tmplName, setTmplName] = useState('');
  const [tmplType, setTmplType] = useState<TransactionType>('expense');
  const [tmplAmount, setTmplAmount] = useState('');
  const [tmplWalletId, setTmplWalletId] = useState('');
  const [tmplCategoryId, setTmplCategoryId] = useState('');
  const [tmplNotes, setTmplNotes] = useState('');
  const [tmplPriority, setTmplPriority] = useState<PriorityLevel>('normal');

  const openCreateModal = (tmpl?: Template) => {
    if (!tmpl && !isPro && templates.length >= 3) {
      setIsUpgradeModalOpen(true);
      return;
    }

    if (tmpl) {
      setEditingTemplate(tmpl);
      setTmplName(tmpl.name);
      setTmplType(tmpl.type);
      setTmplAmount(String(tmpl.amount));
      setTmplWalletId(tmpl.walletId);
      setTmplCategoryId(tmpl.categoryId);
      setTmplNotes(tmpl.notes || '');
      setTmplPriority(tmpl.priority);
    } else {
      setEditingTemplate(null);
      setTmplName('');
      setTmplType('expense');
      setTmplAmount('');
      setTmplWalletId(wallets[0]?.id || '');
      setTmplCategoryId(categories[0]?.id || '');
      setTmplNotes('');
      setTmplPriority('normal');
    }
    setIsCreateModalOpen(true);
  };

  const handleSaveTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseLocalizedNumber(tmplAmount);
    if (!tmplName.trim() || isNaN(amountNum) || amountNum <= 0) return;

    const selectedWallet = wallets.find((w) => w.id === tmplWalletId) || wallets[0];

    const payload = {
      name: tmplName.trim(),
      type: tmplType,
      amount: amountNum,
      currency: selectedWallet?.currency || settings.mainCurrency,
      walletId: tmplWalletId || wallets[0]?.id || '',
      categoryId: tmplCategoryId || categories[0]?.id || '',
      notes: tmplNotes.trim(),
      priority: tmplPriority,
      doesNotAffectBalance: false,
    };

    if (editingTemplate) {
      updateTemplate(editingTemplate.id, payload);
    } else {
      addTemplate(payload);
    }

    setIsCreateModalOpen(false);
  };

  const handleApply = (tmpl: Template) => {
    applyTemplate(tmpl.id);
    setAppliedNotification(
      isRTL
        ? `تمت إضافة: "${tmpl.name}" كمعاملة بلمسة واحدة!`
        : `Added "${tmpl.name}" with one tap!`
    );
    setTimeout(() => {
      setAppliedNotification(null);
    }, 3000);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-3 pb-24 space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* 1-Tap Success Alert */}
      {appliedNotification && (
        <div className="p-3 bg-[var(--color-income)]/10 border border-[var(--color-income)]/30 text-[var(--color-income)] rounded-xl flex items-center gap-2 text-xs font-semibold animate-in fade-in duration-150">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{appliedNotification}</span>
        </div>
      )}

      {/* Header with "Add Template" button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-ink)] font-bold">
          <Bookmark className="w-4 h-4 text-[var(--color-warning-text)]" />
          <span>
            {isRTL ? 'قوالب المعاملات الجاهزة' : 'Transaction Templates'} ({templates.length})
          </span>
        </div>

        <button
          onClick={() => openCreateModal()}
          className="flex items-center gap-1 px-3 py-1.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 transition-opacity min-h-[38px]"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('addTemplate')}</span>
          {!isPro && templates.length >= 3 && (
            <Crown className="w-3 h-3 ms-0.5" />
          )}
        </button>
      </div>

      {/* Free limit banner */}
      {!isPro && templates.length >= 3 && (
        <div className="p-2.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>{isRTL ? 'وصلت للحد المجاني (3 قوالب)' : 'Free limit reached (3 templates)'}</span>
          <button
            onClick={() => setIsUpgradeModalOpen(true)}
            className="text-[var(--color-accent)] font-semibold hover:underline flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            <span>{isRTL ? <>ترقية لـ <bdi dir="ltr">PRO</bdi></> : 'Upgrade PRO'}</span>
          </button>
        </div>
      )}

      {/* Templates List */}
      {templates.length === 0 ? (
        <div className="p-8 my-4 text-center bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex flex-col items-center">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-warning)]/10 text-[var(--color-warning-text)] flex items-center justify-center mb-2">
            <Zap className="w-5 h-5" />
          </div>
          <p className="text-xs text-[var(--color-muted)] max-w-xs leading-relaxed mb-4">
            {isRTL
              ? 'القوالب هي معاملات جاهزة لإدخال أسرع'
              : 'Templates are ready-made transactions for faster entry'}
          </p>
          <button
            onClick={() => openCreateModal()}
            className="flex items-center gap-1.5 px-4 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>{t('addTemplate')}</span>
          </button>
        </div>
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden divide-y divide-[var(--color-line)]">
          {templates.map((tmpl) => {
            const cat = categories.find((c) => c.id === tmpl.categoryId);
            const wallet = wallets.find((w) => w.id === tmpl.walletId);
            const dotColor = cat?.color || '#1E6F73';

            return (
              <div
                key={tmpl.id}
                className="p-3.5 flex items-center justify-between gap-3 hover:bg-[var(--color-bg)] transition-colors group"
              >
                {/* Clickable Area to Add Immediately */}
                <div
                  onClick={() => handleApply(tmpl)}
                  className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: dotColor }}
                  />

                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-2">
                      <span className="truncate">{tmpl.name}</span>
                      <span className="text-[10px] text-[var(--color-accent)] font-semibold px-1.5 py-0.2 bg-[var(--color-accent)]/10 rounded shrink-0">
                        {isRTL ? 'نقرة للإضافة ⚡' : 'Tap to add ⚡'}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)] mt-0.5 truncate">
                      {wallet?.name} • {isRTL ? cat?.nameAr : cat?.nameEn}
                    </div>
                  </div>
                </div>

                {/* Amount & Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <MoneyText
                    amount={tmpl.amount}
                    currency={tmpl.currency}
                    type={tmpl.type}
                    showSign={true}
                    colorByType={true}
                    className="text-sm font-bold block text-end"
                  />

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openCreateModal(tmpl)}
                      className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center"
                      title={t('edit')}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTmplId(tmpl.id)}
                      className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-expense)] rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center"
                      title={t('delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Template Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-4">
              <h3 className="font-title text-sm font-bold">
                {editingTemplate ? (isRTL ? 'تعديل القالب' : 'Edit Template') : t('addTemplate')}
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTemplate} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {isRTL ? 'اسم القالب' : 'Template Name'}
                </label>
                <input
                  type="text"
                  required
                  value={tmplName}
                  onChange={(e) => setTmplName(e.target.value)}
                  placeholder="مثال: قهوة الصباح، غداء العمل..."
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {t('amount')}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    required
                    value={tmplAmount}
                    onChange={(e) => setTmplAmount(normalizeArabicPersianNumerals(e.target.value))}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] num-tabular min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {isRTL ? 'النوع' : 'Type'}
                  </label>
                  <select
                    value={tmplType}
                    onChange={(e) => setTmplType(e.target.value as TransactionType)}
                    className="w-full px-2 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                  >
                    <option value="expense">{t('typeExpense')}</option>
                    <option value="income">{t('typeIncome')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {t('fromWallet')}
                  </label>
                  <select
                    value={tmplWalletId}
                    onChange={(e) => setTmplWalletId(e.target.value)}
                    className="w-full px-2 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                  >
                    {wallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {t('category')}
                  </label>
                  <select
                    value={tmplCategoryId}
                    onChange={(e) => setTmplCategoryId(e.target.value)}
                    className="w-full px-2 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {isRTL ? c.nameAr : c.nameEn}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {t('notes')}
                </label>
                <input
                  type="text"
                  value={tmplNotes}
                  onChange={(e) => setTmplNotes(e.target.value)}
                  placeholder="ملاحظة اختيارية..."
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 transition-opacity min-h-[44px]"
                >
                  {editingTemplate ? t('submitSaveTransaction') : t('save')}
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2.5 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] rounded-xl text-xs min-h-[44px]"
                >
                  {t('cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Delete */}
      <ConfirmationModal
        isOpen={!!deleteTmplId}
        onClose={() => setDeleteTmplId(null)}
        onConfirm={() => {
          if (deleteTmplId) deleteTemplate(deleteTmplId);
        }}
        title={isRTL ? 'حذف القالب' : 'Delete Template'}
        message={isRTL ? 'هل أنت متأكد من حذف هذا القالب؟' : 'Are you sure you want to delete this template?'}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
};
