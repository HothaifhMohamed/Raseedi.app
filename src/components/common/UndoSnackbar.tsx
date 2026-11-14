import React, { useEffect } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const UndoSnackbar: React.FC = () => {
  const { undoAction, triggerUndo, setUndoAction, t } = useApp();

  useEffect(() => {
    if (!undoAction) return;

    const timer = setTimeout(() => {
      setUndoAction(null);
    }, 5000);

    return () => clearTimeout(timer);
  }, [undoAction, setUndoAction]);

  if (!undoAction) return null;

  return (
    <div className="fixed bottom-20 inset-x-4 z-40 mx-auto max-w-sm flex items-center justify-between p-3.5 bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] rounded-xl shadow-lg animate-in slide-in-from-bottom-4 duration-150">
      <span className="text-xs font-semibold text-[var(--color-ink)] truncate px-1">
        {undoAction.message}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={triggerUndo}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] text-xs font-semibold rounded-lg transition-opacity min-h-[36px]"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t('undo')}</span>
        </button>
        <button
          onClick={() => setUndoAction(null)}
          className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
          aria-label="Dismiss snackbar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
