import React from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BrandLogo } from './common/BrandLogo';

export const SplashScreen: React.FC = () => {
  const { t, isRTL } = useApp();

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--color-bg)] text-[var(--color-ink)] p-6 select-none">
      {/* Brand Emblem */}
      <BrandLogo className="w-20 h-20 rounded-2xl mb-4 shadow-sm" title={t('appName')} />

      <h1 className="font-title text-2xl font-bold text-[var(--color-ink)] tracking-tight mb-1">
        {t('appName')}
      </h1>
      <p className="text-xs text-[var(--color-muted)] font-medium mb-8">
        {t('tagline')}
      </p>

      {/* Loading Spinner */}
      <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
        <Loader2 className="w-4 h-4 text-[var(--color-accent)] animate-spin" />
        <span>{isRTL ? 'جاري تهيئة البيانات...' : 'Initializing your data...'}</span>
      </div>
    </div>
  );
};
