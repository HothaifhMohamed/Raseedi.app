import React, { useEffect, useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  AppUpdateState,
  applyPendingAppUpdate,
  dismissAppUpdateBanner,
  getAppUpdateState,
  subscribeAppUpdate,
} from '../../services/appUpdate';

export const AppUpdateBanner: React.FC = () => {
  const { isRTL } = useApp();
  const [updateState, setUpdateState] = useState<AppUpdateState>(() => getAppUpdateState());

  useEffect(() => {
    return subscribeAppUpdate(setUpdateState);
  }, []);

  if (!updateState.updateAvailable || updateState.dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      data-testid="app-update-banner"
      dir={isRTL ? 'rtl' : 'ltr'}
      className="sticky top-0 z-50 w-full bg-[var(--color-accent)] text-[var(--color-on-accent)] px-3 py-2 border-b border-black/10 shadow-sm flex items-center justify-between gap-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="w-4 h-4 shrink-0" />
        <span className="text-xs font-semibold truncate">
          {updateState.isUpdating
            ? isRTL
              ? 'جاري تحديث التطبيق إلى أحدث إصدار...'
              : 'Updating to the latest version...'
            : isRTL
            ? 'يتوفر تحديث جديد لتطبيق رَصِيدِي'
            : 'A new update is available for Raseedi'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => void applyPendingAppUpdate()}
          disabled={updateState.isUpdating}
          data-testid="app-update-now-btn"
          className="px-2.5 py-1 rounded-lg bg-[var(--color-on-accent)] text-[var(--color-accent)] text-[11px] font-bold flex items-center gap-1 hover:opacity-90 transition disabled:opacity-60 min-h-[32px]"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${updateState.isUpdating ? 'animate-spin' : ''}`}
          />
          <span>{isRTL ? 'تحديث الآن' : 'Update Now'}</span>
        </button>

        {!updateState.isUpdating && (
          <button
            type="button"
            onClick={() => dismissAppUpdateBanner()}
            data-testid="app-update-dismiss-btn"
            aria-label={isRTL ? 'إخفاء تنبيه التحديث' : 'Dismiss update notification'}
            className="p-1 rounded-lg hover:bg-black/10 transition min-h-[32px] min-w-[32px] flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
