/**
 * Merchant / Keyword Auto-Categorization Rules Modal.
 * Lets users (especially Organization workspaces, and Personal too) define simple rules:
 * Keyword / Merchant -> Category (+ optional Wallet & Cost Center in Organizations).
 * Rules apply automatically during manual entry and CSV/Excel import.
 */
import React, { useMemo, useState } from 'react';
import {
  Wand2,
  Plus,
  Trash2,
  X,
  CheckCircle2,
  ToggleLeft,
  ToggleRight,
  Search,
  Edit3,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MerchantRule, MerchantRuleMatchType } from '../../types';
import {
  matchMerchantRule,
  MAX_MERCHANT_RULES_PER_WORKSPACE,
  sanitizeMerchantRules,
} from '../../services/merchantRules';

interface MerchantRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MerchantRulesModal: React.FC<MerchantRulesModalProps> = ({ isOpen, onClose }) => {
  const {
    categories,
    wallets,
    settings,
    updateSettings,
    isRTL,
    activeWorkspace,
    isOrgWorkspace,
    activeOrganization,
    orgCostCenters,
  } = useApp();

  const workspaceKey =
    isOrgWorkspace && activeOrganization
      ? activeOrganization.id
      : activeWorkspace || 'personal';
  const workspaceName =
    isOrgWorkspace && activeOrganization
      ? activeOrganization.name
      : isRTL
      ? 'الحساب الشخصي'
      : 'Personal Account';

  const rules = useMemo(
    () => sanitizeMerchantRules(settings.merchantRulesByWorkspace?.[workspaceKey]),
    [settings.merchantRulesByWorkspace, workspaceKey]
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [matchType, setMatchType] = useState<MerchantRuleMatchType>('contains');
  const [txType, setTxType] = useState<'expense' | 'income' | 'both'>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [walletId, setWalletId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [testInput, setTestInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const activeWallets = useMemo(() => wallets.filter((w) => !w.isArchived), [wallets]);
  const activeCostCenters = useMemo(
    () => (isOrgWorkspace ? orgCostCenters.filter((c) => c.isActive) : []),
    [isOrgWorkspace, orgCostCenters]
  );

  const testMatch = useMemo(() => {
    if (!testInput.trim()) return null;
    return matchMerchantRule(testInput, rules);
  }, [testInput, rules]);

  if (!isOpen) return null;

  const saveRulesList = (nextRules: MerchantRule[]) => {
    updateSettings({
      merchantRulesByWorkspace: {
        ...(settings.merchantRulesByWorkspace || {}),
        [workspaceKey]: nextRules.slice(0, MAX_MERCHANT_RULES_PER_WORKSPACE),
      },
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setKeyword('');
    setMatchType('contains');
    setTxType('expense');
    setCategoryId('');
    setWalletId('');
    setCostCenterId('');
    setErrorMsg('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKeyword = keyword.trim();
    if (!cleanKeyword) {
      setErrorMsg(isRTL ? 'أدخل كلمة مفتاحية أو اسم تاجر.' : 'Enter a keyword or merchant name.');
      return;
    }
    if (!categoryId && !walletId && !costCenterId) {
      setErrorMsg(
        isRTL
          ? 'اختر تصنيفاً أو محفظة (أو مركز تكلفة) على الأقل لتطبيق القاعدة.'
          : 'Select at least a category, wallet, or cost center to apply.'
      );
      return;
    }

    const now = Date.now();
    if (editingId) {
      const next = rules.map((r) =>
        r.id === editingId
          ? {
              ...r,
              keyword: cleanKeyword,
              matchType,
              type: txType,
              categoryId: categoryId || undefined,
              walletId: walletId || undefined,
              costCenterId: isOrgWorkspace && costCenterId ? costCenterId : undefined,
              updatedAt: now,
            }
          : r
      );
      saveRulesList(next);
      resetForm();
      return;
    }

    if (rules.length >= MAX_MERCHANT_RULES_PER_WORKSPACE) {
      setErrorMsg(
        isRTL
          ? `الحد الأقصى ${MAX_MERCHANT_RULES_PER_WORKSPACE} قاعدة لكل مساحة عمل.`
          : `Maximum ${MAX_MERCHANT_RULES_PER_WORKSPACE} rules per workspace.`
      );
      return;
    }

    const newRule: MerchantRule = {
      id: `mr-${now}-${Math.random().toString(36).slice(2, 6)}`,
      keyword: cleanKeyword,
      matchType,
      type: txType,
      ...(categoryId ? { categoryId } : {}),
      ...(walletId ? { walletId } : {}),
      ...(isOrgWorkspace && costCenterId ? { costCenterId } : {}),
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    };

    saveRulesList([newRule, ...rules]);
    resetForm();
  };

  const handleEdit = (rule: MerchantRule) => {
    setEditingId(rule.id);
    setKeyword(rule.keyword);
    setMatchType(rule.matchType || 'contains');
    setTxType(rule.type || 'both');
    setCategoryId(rule.categoryId || '');
    setWalletId(rule.walletId || '');
    setCostCenterId(rule.costCenterId || '');
    setErrorMsg('');
  };

  const handleToggle = (id: string) => {
    const next = rules.map((r) =>
      r.id === id ? { ...r, isEnabled: !r.isEnabled, updatedAt: Date.now() } : r
    );
    saveRulesList(next);
  };

  const handleDelete = (id: string) => {
    saveRulesList(rules.filter((r) => r.id !== id));
    if (editingId === id) resetForm();
  };

  const getCategoryLabel = (id?: string) => {
    if (!id) return null;
    const cat = categories.find((c) => c.id === id);
    return cat ? (isRTL ? cat.nameAr : cat.nameEn) : null;
  };

  const getWalletLabel = (id?: string) => {
    if (!id) return null;
    return wallets.find((w) => w.id === id)?.name || null;
  };

  const getCostCenterLabel = (id?: string) => {
    if (!id) return null;
    const cc = orgCostCenters.find((c) => c.id === id);
    return cc ? (isRTL ? cc.nameAr : cc.nameEn) : null;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        data-testid="merchant-rules-modal"
        className="w-full sm:max-w-2xl bg-[var(--color-surface)] border border-[var(--color-line)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-line)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[var(--color-accent)]/12 text-[var(--color-accent)] flex items-center justify-center shrink-0">
              <Wand2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-[var(--color-ink)] truncate">
                {isRTL ? 'قواعد التصنيف التلقائي للتجار' : 'Merchant Auto-Categorization Rules'}
              </h2>
              <p className="text-xs text-[var(--color-muted)] truncate">
                {isRTL
                  ? `${workspaceName} · تُطبَّق عند إضافة المعاملات وعند استيراد CSV/Excel`
                  : `${workspaceName} · Applied on transaction entry and CSV/Excel import`}
              </p>
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

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* Add / Edit Form */}
          <form
            onSubmit={handleSubmit}
            className="bg-[var(--color-surface-subtle)] border border-[var(--color-line)] rounded-2xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold text-[var(--color-ink)]">
                {editingId
                  ? isRTL
                    ? 'تعديل القاعدة'
                    : 'Edit Rule'
                  : isRTL
                  ? 'إضافة قاعدة جديدة'
                  : 'Add New Rule'}
              </h3>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-bold text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                >
                  {isRTL ? 'إلغاء التعديل' : 'Cancel'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-[var(--color-muted)] mb-1">
                  {isRTL ? 'الكلمة المفتاحية / اسم التاجر' : 'Keyword / Merchant Name'}
                </label>
                <input
                  type="text"
                  data-testid="merchant-rule-keyword-input"
                  value={keyword}
                  onChange={(e) => {
                    setKeyword(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder={isRTL ? 'مثال: أوبر، أمازون، كارفور، إيجار' : 'e.g. Uber, Amazon, Carrefour'}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-sm text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-[var(--color-muted)] mb-1">
                    {isRTL ? 'طريقة المطابقة' : 'Match Type'}
                  </label>
                  <select
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value as MerchantRuleMatchType)}
                    className="w-full min-h-[44px] px-2.5 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-bold text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="contains">{isRTL ? 'يحتوي على' : 'Contains'}</option>
                    <option value="starts_with">{isRTL ? 'يبدأ بـ' : 'Starts with'}</option>
                    <option value="exact">{isRTL ? 'مطابقة تامة' : 'Exact match'}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[var(--color-muted)] mb-1">
                    {isRTL ? 'نوع المعاملة' : 'Tx Type'}
                  </label>
                  <select
                    value={txType}
                    onChange={(e) => setTxType(e.target.value as 'expense' | 'income' | 'both')}
                    className="w-full min-h-[44px] px-2.5 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-bold text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="expense">{isRTL ? 'مصروف' : 'Expense'}</option>
                    <option value="income">{isRTL ? 'دخل' : 'Income'}</option>
                    <option value="both">{isRTL ? 'الكل' : 'Both'}</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-[var(--color-muted)] mb-1">
                  {isRTL ? 'التصنيف الافتراضي' : 'Default Category'}
                </label>
                <select
                  data-testid="merchant-rule-category-select"
                  value={categoryId}
                  onChange={(e) => {
                    const nextCatId = e.target.value;
                    setCategoryId(nextCatId);
                    const pickedCat = categories.find((c) => c.id === nextCatId);
                    if (pickedCat?.type === 'income' || pickedCat?.type === 'expense') {
                      setTxType(pickedCat.type);
                    }
                    setErrorMsg('');
                  }}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-bold text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">{isRTL ? '— بدون تغيير التصنيف —' : '— No category —'}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {isRTL ? c.nameAr : c.nameEn}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[var(--color-muted)] mb-1">
                  {isRTL ? 'المحفظة الافتراضية (اختياري)' : 'Default Wallet (Optional)'}
                </label>
                <select
                  value={walletId}
                  onChange={(e) => {
                    setWalletId(e.target.value);
                    setErrorMsg('');
                  }}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-bold text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">{isRTL ? '— بدون تغيير المحفظة —' : '— No wallet —'}</option>
                  {activeWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.currency})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isOrgWorkspace && activeCostCenters.length > 0 && (
              <div>
                <label className="block text-[11px] font-bold text-[var(--color-muted)] mb-1">
                  {isRTL ? 'مركز التكلفة الافتراضي (اختياري)' : 'Default Cost Center (Optional)'}
                </label>
                <select
                  value={costCenterId}
                  onChange={(e) => setCostCenterId(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-bold text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">{isRTL ? '— بدون مركز تكلفة —' : '— No cost center —'}</option>
                  {activeCostCenters.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.code} · {isRTL ? cc.nameAr : cc.nameEn}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {errorMsg && <p className="text-xs font-bold text-[var(--color-expense)]">{errorMsg}</p>}

            <button
              type="submit"
              data-testid="merchant-rule-save-btn"
              className="w-full min-h-[44px] rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-[var(--color-on-accent)] text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>
                {editingId
                  ? isRTL
                    ? 'حفظ التعديلات'
                    : 'Update Rule'
                  : isRTL
                  ? 'إضافة القاعدة'
                  : 'Add Rule'}
              </span>
            </button>
          </form>

          {/* Live Rule Tester */}
          {rules.length > 0 && (
            <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-muted)]">
                <Search className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>{isRTL ? 'اختبار القواعد مباشرة' : 'Test Your Rules'}</span>
              </div>
              <input
                type="text"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder={
                  isRTL
                    ? 'اكتب وصف عملية لتجربة المطابقة (مثال: مشوار أوبر للمكتب)...'
                    : 'Type a transaction note to test matching...'
                }
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-[var(--color-surface-subtle)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
              />
              {testInput.trim() && (
                <div className="text-xs font-bold">
                  {testMatch ? (
                    <span className="inline-flex items-center gap-1.5 text-[var(--color-income)]">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        {isRTL ? 'تطابق مع' : 'Matched'} «{testMatch.rule.keyword}»
                        {getCategoryLabel(testMatch.categoryId)
                          ? ` · ${getCategoryLabel(testMatch.categoryId)}`
                          : ''}
                        {getWalletLabel(testMatch.walletId)
                          ? ` · ${getWalletLabel(testMatch.walletId)}`
                          : ''}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[var(--color-muted)]">
                      {isRTL ? 'لا توجد قاعدة مطابقة لهذا النص.' : 'No matching rule found.'}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Rules List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold text-[var(--color-muted)]">
                {isRTL ? `القواعد المحفوظة (${rules.length})` : `Saved Rules (${rules.length})`}
              </h3>
            </div>

            {rules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--color-line)] p-6 text-center space-y-1.5">
                <p className="text-sm font-bold text-[var(--color-ink)]">
                  {isRTL ? 'لا توجد قواعد تصنيف تلقائي بعد' : 'No auto-categorization rules yet'}
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  {isRTL
                    ? 'أضف أسماء الموردين أو التجار المتكررين (مثل: أوبر، أمازون، فودافون) ليتم تصنيفها تلقائياً.'
                    : 'Add recurring merchants or vendors (e.g. Uber, Amazon) to auto-categorize entries and imports.'}
                </p>
              </div>
            ) : (
              rules.map((rule) => {
                const metaParts: string[] = [];
                const catName = getCategoryLabel(rule.categoryId);
                const wName = getWalletLabel(rule.walletId);
                const ccName = getCostCenterLabel(rule.costCenterId);
                if (catName) metaParts.push(catName);
                if (wName) metaParts.push(wName);
                if (ccName) metaParts.push(ccName);

                return (
                  <div
                    key={rule.id}
                    data-testid={`merchant-rule-item-${rule.id}`}
                    className={`flex items-center justify-between gap-3 px-3.5 py-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] transition-opacity ${
                      rule.isEnabled ? '' : 'opacity-60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-extrabold text-[var(--color-ink)] truncate">
                          {rule.keyword}
                        </p>
                        <span className="text-[11px] font-semibold text-[var(--color-muted)]">
                          ·{' '}
                          {rule.type === 'income'
                            ? isRTL
                              ? 'دخل'
                              : 'Income'
                            : rule.type === 'expense'
                            ? isRTL
                              ? 'مصروف'
                              : 'Expense'
                            : isRTL
                            ? 'الكل'
                            : 'Both'}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-muted)] truncate mt-0.5">
                        {metaParts.join(' · ')}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggle(rule.id)}
                        aria-label={rule.isEnabled ? 'Disable rule' : 'Enable rule'}
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--color-accent)] hover:bg-[var(--color-surface-subtle)] transition-colors"
                      >
                        {rule.isEnabled ? (
                          <ToggleRight className="w-6 h-6" />
                        ) : (
                          <ToggleLeft className="w-6 h-6 text-[var(--color-muted)]" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEdit(rule)}
                        aria-label={isRTL ? 'تعديل' : 'Edit'}
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-subtle)] transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(rule.id)}
                        aria-label={isRTL ? 'حذف' : 'Delete'}
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-expense)] hover:bg-[var(--color-expense)]/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
