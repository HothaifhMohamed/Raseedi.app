import React from 'react';
import { Loader2 } from 'lucide-react';
import { BrandLogo } from './common/BrandLogo';

export const SplashScreen: React.FC = () => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--color-bg)] text-[var(--color-ink)] p-6 select-none">
      {/* Brand Emblem */}
      <BrandLogo className="w-20 h-20 rounded-2xl mb-4 shadow-sm" />

      <h1 className="font-title text-2xl font-bold text-[var(--color-ink)] tracking-tight mb-1">
        رَصِيدِي
      </h1>
      <p className="text-xs text-[var(--color-muted)] font-medium mb-8">
        متتبع المصاريف والميزانية الشخصية
      </p>

      {/* Loading Spinner */}
      <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
        <Loader2 className="w-4 h-4 text-[var(--color-accent)] animate-spin" />
        <span>جاري تهيئة البيانات...</span>
      </div>
    </div>
  );
};
