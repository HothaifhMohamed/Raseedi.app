/**
 * Modal / Bottom Sheet to reorder Home Dashboard sections per workspace
 * (Personal vs each Organization independently).
 */
import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, LayoutGrid, RotateCcw, X, Check } from 'lucide-react';
import { HomeSectionId } from '../../types';
import {
  getDefaultHomeSectionOrder,
  HOME_SECTION_METADATA,
  moveHomeSection,
  resolveHomeSectionOrder,
} from '../../services/homeSections';

interface ArrangeSectionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentOrder: HomeSectionId[];
  isOrgWorkspace: boolean;
  workspaceLabel: string;
  isRTL: boolean;
  onSaveOrder: (nextOrder: HomeSectionId[]) => void;
}

export const ArrangeSectionsModal: React.FC<ArrangeSectionsModalProps> = ({
  isOpen,
  onClose,
  currentOrder,
  isOrgWorkspace,
  workspaceLabel,
  isRTL,
  onSaveOrder,
}) => {
  const [draft, setDraft] = useState<HomeSectionId[]>(() =>
    resolveHomeSectionOrder(currentOrder, isOrgWorkspace)
  );

  useEffect(() => {
    if (isOpen) {
      setDraft(resolveHomeSectionOrder(currentOrder, isOrgWorkspace));
    }
  }, [isOpen, currentOrder, isOrgWorkspace]);

  if (!isOpen) return null;

  const handleMove = (id: HomeSectionId, direction: 'up' | 'down') => {
    setDraft((prev) => moveHomeSection(prev, id, direction));
  };

  const handleReset = () => {
    setDraft(getDefaultHomeSectionOrder(isOrgWorkspace));
  };

  const handleApply = () => {
    onSaveOrder(draft);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        data-testid="arrange-sections-modal"
        className="w-full sm:max-w-lg bg-[var(--color-surface)] border border-[var(--color-line)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-line)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-[var(--color-accent)]/12 text-[var(--color-accent)] flex items-center justify-center shrink-0">
              <LayoutGrid className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-[var(--color-ink)] truncate">
                {isRTL ? 'إعادة ترتيب أقسام الرئيسية' : 'Arrange Home Sections'}
              </h2>
              <p className="text-xs text-[var(--color-muted)] truncate">
                {isRTL
                  ? `الترتيب محفوظ بشكل مستقل لمساحة: ${workspaceLabel}`
                  : `Saved independently for workspace: ${workspaceLabel}`}
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

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {draft.map((id, index) => {
            const meta = HOME_SECTION_METADATA[id];
            if (!meta) return null;
            const isFirst = index === 0;
            const isLast = index === draft.length - 1;
            return (
              <div
                key={id}
                data-testid={`arrange-section-row-${id}`}
                className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-2xl bg-[var(--color-surface-subtle)] border border-[var(--color-line)]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-6 h-6 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-extrabold text-[var(--color-muted)] flex items-center justify-center shrink-0 num-tabular">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--color-ink)] truncate">
                      {isRTL ? meta.labelAr : meta.labelEn}
                    </p>
                    <p className="text-[11px] text-[var(--color-muted)] truncate">
                      {isRTL ? meta.descriptionAr : meta.descriptionEn}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-testid={`arrange-up-${id}`}
                    disabled={isFirst}
                    onClick={() => handleMove(id, 'up')}
                    aria-label={isRTL ? 'تحريك لأعلى' : 'Move up'}
                    className="w-10 h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] flex items-center justify-center text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    data-testid={`arrange-down-${id}`}
                    disabled={isLast}
                    onClick={() => handleMove(id, 'down')}
                    aria-label={isRTL ? 'تحريك لأسفل' : 'Move down'}
                    className="w-10 h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] flex items-center justify-center text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--color-line)] bg-[var(--color-surface)] flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-xl text-xs font-bold text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-subtle)] transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{isRTL ? 'استعادة الافتراضي' : 'Reset Default'}</span>
          </button>

          <button
            type="button"
            data-testid="arrange-sections-save"
            onClick={handleApply}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 min-h-[44px] rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-[var(--color-on-accent)] text-sm font-bold shadow-sm transition-colors"
          >
            <Check className="w-4 h-4" />
            <span>{isRTL ? 'حفظ الترتيب' : 'Save Order'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
