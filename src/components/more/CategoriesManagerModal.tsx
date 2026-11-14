import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  X,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Category } from '../../types';
import { IconRenderer } from '../common/IconRenderer';
import { ConfirmationModal } from '../common/ConfirmationModal';

const CATEGORY_COLORS = [
  '#B5523B', // Terracotta
  '#C99A2E', // Ochre
  '#5E7F3A', // Olive
  '#1E6F73', // Deep Turquoise
  '#7A4E6D', // Plum
  '#6B5E50', // Warm Gray
  '#9E4732', // Rust
  '#4A6B53', // Slate Moss
  '#A86D4A', // Desert Clay
  '#485B73', // Indigo Slate
  '#B88728', // Mustard Gold
  '#698B68', // Sage Green
  '#8C5158', // Dusty Brick
  '#4A453E', // Espresso
];

const CATEGORY_ICONS = [
  'Utensils', 'Coffee', 'ShoppingCart', 'Car', 'Fuel', 'Receipt',
  'Home', 'ShoppingBag', 'HeartPulse', 'Pill', 'GraduationCap', 'Tv',
  'Plane', 'Gift', 'HandHeart', 'Briefcase', 'Laptop', 'ArrowDownToLine', 'Layers'
];

interface CategoriesManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CategoriesManagerModal: React.FC<CategoriesManagerModalProps> = ({ isOpen, onClose }) => {
  const {
    categories,
    addCategory,
    updateCategory,
    getCategoryDependencies,
    deleteCategory,
    migrateAndDeleteCategory,
    t,
    isRTL,
  } = useApp();

  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dependencyCatId, setDependencyCatId] = useState<string | null>(null);
  const [migrationTargetCatId, setMigrationTargetCatId] = useState<string>('');

  // Form State
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState(CATEGORY_ICONS[0]);
  const [type, setType] = useState<'expense' | 'income' | 'both'>('expense');

  const openForm = (cat?: Category) => {
    if (cat) {
      setEditingCat(cat);
      setNameAr(cat.nameAr);
      setNameEn(cat.nameEn);
      setColor(cat.color);
      setIcon(cat.icon);
      setType(cat.type);
    } else {
      setEditingCat(null);
      setNameAr('');
      setNameEn('');
      setColor(CATEGORY_COLORS[0]);
      setIcon(CATEGORY_ICONS[0]);
      setType('expense');
    }
    setIsFormOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameAr.trim()) return;

    const payload = {
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim() || nameAr.trim(),
      color,
      icon,
      type,
      order: categories.length + 1,
    };

    if (editingCat) {
      updateCategory(editingCat.id, payload);
    } else {
      addCategory(payload);
    }

    setIsFormOpen(false);
  };

  const handleMoveOrder = (catId: string, direction: 'up' | 'down') => {
    const idx = categories.findIndex((c) => c.id === catId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= categories.length) return;

    const reordered = [...categories];
    const temp = reordered[idx];
    reordered[idx] = reordered[targetIdx];
    reordered[targetIdx] = temp;

    reordered.forEach((c, i) => {
      updateCategory(c.id, { order: i + 1 });
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md max-h-[85vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl text-[var(--color-ink)] shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-line)] bg-[var(--color-bg)]">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-[var(--color-accent)]" />
            <h3 className="text-sm font-bold">{t('categoriesManager')}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => openForm()}
              className="flex items-center gap-1 px-3 py-1.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs transition min-h-[36px]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isRTL ? 'إضافة تصنيف' : 'Add Category'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Categories List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {categories.map((c, index) => (
            <div
              key={c.id}
              className={`p-3 rounded-lg border flex items-center justify-between text-xs transition ${
                c.isHidden
                  ? 'bg-[var(--color-bg)] border-[var(--color-line)] opacity-50'
                  : 'bg-[var(--color-surface)] border-[var(--color-line)]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: c.color }}
                />
                <div>
                  <div className="font-semibold text-[var(--color-ink)]">
                    {isRTL ? c.nameAr : c.nameEn}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted)]">
                    {c.type === 'expense'
                      ? (isRTL ? 'مصروف' : 'Expense')
                      : c.type === 'income'
                      ? (isRTL ? 'دخل' : 'Income')
                      : (isRTL ? 'شامل' : 'Both')}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1">
                {/* Reorder Buttons */}
                <button
                  disabled={index === 0}
                  onClick={() => handleMoveOrder(c.id, 'up')}
                  className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-20 min-h-[32px] min-w-[32px] flex items-center justify-center"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={index === categories.length - 1}
                  onClick={() => handleMoveOrder(c.id, 'down')}
                  className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-20 min-h-[32px] min-w-[32px] flex items-center justify-center"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>

                {/* Hide / Show */}
                <button
                  onClick={() => updateCategory(c.id, { isHidden: !c.isHidden })}
                  className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[32px] min-w-[32px] flex items-center justify-center"
                  title={c.isHidden ? (isRTL ? 'إظهار التصنيف' : 'Show category') : (isRTL ? 'إخفاء التصنيف' : 'Hide category')}
                >
                  {c.isHidden ? (
                    <EyeOff className="w-3.5 h-3.5 text-[var(--color-warning-text)]" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Edit */}
                <button
                  onClick={() => openForm(c)}
                  className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-accent)] min-h-[32px] min-w-[32px] flex items-center justify-center"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>

                {/* Delete */}
                <button
                  onClick={() => {
                    const deps = getCategoryDependencies(c.id);
                    if (deps.totalCount > 0) {
                      const firstOther = categories.find((other) => other.id !== c.id);
                      setMigrationTargetCatId(firstOther?.id || '');
                      setDependencyCatId(c.id);
                    } else {
                      setConfirmDeleteId(c.id);
                    }
                  }}
                  className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-expense)] min-h-[32px] min-w-[32px] flex items-center justify-center"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add / Edit Form Modal */}
        {isFormOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--color-line)]">
                <h4 className="text-sm font-bold">
                  {editingCat ? (isRTL ? 'تعديل التصنيف' : 'Edit Category') : (isRTL ? 'إضافة تصنيف جديد' : 'New Category')}
                </h4>
                <button
                  onClick={() => setIsFormOpen(false)}
                  className="p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {isRTL ? 'الاسم بالعربية' : 'Arabic Name'}
                  </label>
                  <input
                    type="text"
                    required
                    value={nameAr}
                    onChange={(e) => setNameAr(e.target.value)}
                    placeholder={isRTL ? 'مثال: اشتراكات رقمية' : 'e.g. اشتراكات'}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {isRTL ? 'الاسم بالإنجليزية' : 'English Name'}
                  </label>
                  <input
                    type="text"
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    placeholder="e.g. Digital Subscriptions"
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {isRTL ? 'نوع التصنيف' : 'Category Type'}
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as any)}
                    className="w-full px-2 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px]"
                  >
                    <option value="expense">{isRTL ? 'مصروفات فقط' : 'Expense only'}</option>
                    <option value="income">{isRTL ? 'دخل فقط' : 'Income only'}</option>
                    <option value="both">{isRTL ? 'شامل (مصروف ودخل)' : 'Both (Expense & Income)'}</option>
                  </select>
                </div>

                {/* Color Selection - 14 Muted Earthy Colors */}
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {isRTL ? 'اللون (ألوان ترابية هادئة)' : 'Color (Muted Earthy)'}
                  </label>
                  <div className="flex items-center gap-1.5 overflow-x-auto py-1.5 no-scrollbar">
                    {CATEGORY_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`w-7 h-7 rounded-full shrink-0 border-2 transition-transform min-h-[28px] ${
                          color === c ? 'border-[var(--color-ink)] scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                {/* Icon Selection */}
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {isRTL ? 'الأيقونة' : 'Icon'}
                  </label>
                  <div className="flex items-center gap-2 overflow-x-auto py-1.5 no-scrollbar">
                    {CATEGORY_ICONS.map((ic) => (
                      <button
                        key={ic}
                        type="button"
                        onClick={() => setIcon(ic)}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors shrink-0 min-h-[36px] min-w-[36px] ${
                          icon === ic
                            ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                            : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)]'
                        }`}
                      >
                        <IconRenderer name={ic} className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs transition min-h-[44px]"
                >
                  {isRTL ? 'حفظ التصنيف' : 'Save Category'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Delete Confirmation (No Dependencies) */}
        <ConfirmationModal
          isOpen={!!confirmDeleteId}
          onClose={() => setConfirmDeleteId(null)}
          onConfirm={() => {
            if (confirmDeleteId) deleteCategory(confirmDeleteId);
          }}
          title={isRTL ? 'حذف التصنيف' : 'Delete Category'}
          message={isRTL ? 'هل تريد حذف هذا التصنيف؟' : 'Are you sure you want to delete this category?'}
          confirmLabel={isRTL ? 'حذف' : 'Delete'}
          cancelLabel={isRTL ? 'إلغاء' : 'Cancel'}
        />

        {/* Dependency Safety Modal (Hide vs Migrate & Delete) */}
        {dependencyCatId && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
            <div
              className="w-full max-w-sm rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 space-y-4 shadow-xl"
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-[var(--color-warning-text)] shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-[var(--color-ink)]">
                    {isRTL ? 'التصنيف مستخدم في معاملات' : 'Category Has Linked Records'}
                  </h4>
                  <p className="text-xs text-[var(--color-muted)] mt-1 leading-relaxed">
                    {(() => {
                      const deps = getCategoryDependencies(dependencyCatId);
                      return isRTL
                        ? `يرتبط هذا التصنيف بـ ${deps.transactionsCount} معاملة و${deps.budgetsCount} ميزانية و${deps.templatesCount} قالب. يمكنك إخفاؤه أو نقل السجلات لتصنيف آخر.`
                        : `Linked to ${deps.transactionsCount} transaction(s), ${deps.budgetsCount} budget(s), and ${deps.templatesCount} template(s). Hide it or migrate first.`;
                    })()}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1">
                  {isRTL ? 'نقل السجلات إلى التصنيف:' : 'Migrate records to:'}
                </label>
                <select
                  value={migrationTargetCatId}
                  onChange={(e) => setMigrationTargetCatId(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[42px]"
                >
                  {categories
                    .filter((cat) => cat.id !== dependencyCatId)
                    .map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {isRTL ? cat.nameAr : cat.nameEn}
                      </option>
                    ))}
                </select>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    updateCategory(dependencyCatId, { isHidden: true });
                    setDependencyCatId(null);
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-1.5 min-h-[42px]"
                >
                  <EyeOff className="w-4 h-4" />
                  <span>{isRTL ? 'إخفاء التصنيف (آمن)' : 'Hide Category (Safe)'}</span>
                </button>

                <button
                  type="button"
                  disabled={!migrationTargetCatId}
                  onClick={() => {
                    migrateAndDeleteCategory(dependencyCatId, migrationTargetCatId);
                    setDependencyCatId(null);
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-expense)]/12 border border-[var(--color-expense)]/30 text-[var(--color-expense)] text-xs font-bold min-h-[42px] disabled:opacity-40"
                >
                  {isRTL ? 'نقل السجلات وحذف التصنيف' : 'Migrate & Delete Category'}
                </button>

                <button
                  type="button"
                  onClick={() => setDependencyCatId(null)}
                  className="w-full py-2 rounded-xl text-xs text-[var(--color-muted)] min-h-[38px]"
                >
                  {isRTL ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
