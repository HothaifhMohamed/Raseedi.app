import React from 'react';
import { Loader2 } from 'lucide-react';

export const SplashScreen: React.FC = () => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--color-bg)] text-[var(--color-ink)] p-6 select-none">
      {/* Brand Emblem */}
      <div className="w-20 h-20 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] flex items-center justify-center mb-4 shadow-sm">
        <span className="font-title font-bold text-3xl">ر</span>
      </div>

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
