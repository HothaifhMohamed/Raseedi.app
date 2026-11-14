import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  isDestructive = true,
}) => {
  const { t } = useApp();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
        <div className="flex items-center gap-3 mb-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              isDestructive
                ? 'bg-[var(--color-expense)]/10 text-[var(--color-expense)]'
                : 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-[var(--color-ink)] leading-tight">{title}</h3>
        </div>

        <p className="text-xs text-[var(--color-muted)] leading-relaxed mb-5">{message}</p>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition min-h-[44px] ${
              isDestructive
                ? 'bg-[var(--color-expense)] text-white hover:opacity-90'
                : 'bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:opacity-90'
            }`}
          >
            {confirmLabel || t('confirmDelete')}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] transition-colors min-h-[44px]"
          >
            {cancelLabel || t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
