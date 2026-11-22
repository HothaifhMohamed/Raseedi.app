import React, { useEffect, useRef, useState } from 'react';
import { Crown, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useOrg } from '../../context/OrgContext';
import {
  AdConsentChoice,
  getAdConsentChoice,
  subscribeAdConsentChanges,
} from './AdConsentBanner';
import { shouldShowAds } from '../../services/subscriptionHelpers';
import {
  mountAdsterraNativeBanner,
  teardownAdsterraNativeBanner,
} from '../../services/adsterra';

export interface AdBannerProps {
  variant?: 'banner' | 'native-card';
  adSlot?: string;
  fallbackTitleAr?: string;
  fallbackTitleEn?: string;
  fallbackBodyAr?: string;
  fallbackBodyEn?: string;
  className?: string;
}

export const AdBanner: React.FC<AdBannerProps> = ({
  variant = 'banner',
  fallbackTitleAr,
  fallbackTitleEn,
  fallbackBodyAr,
  fallbackBodyEn,
  className = '',
}) => {
  const { isPro, subscriptionSummary, setIsUpgradeModalOpen, isRTL } = useApp();
  const { activeOrgSubscriptionState } = useOrg();

  const showAds = shouldShowAds(subscriptionSummary, {
    isProFlag: isPro,
    activeOrgSubscriptionState,
  });

  const slotHostRef = useRef<HTMLDivElement | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [adLoadFailed, setAdLoadFailed] = useState(false);
  const [consentChoice, setConsentChoice] = useState<AdConsentChoice>(() => getAdConsentChoice());

  const hasConsent = consentChoice === 'granted';
  const canRenderAdsterra = showAds && hasConsent && isOnline && !adLoadFailed;

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setAdLoadFailed(false);
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const unsubscribeConsent = subscribeAdConsentChanges(() => {
      setConsentChoice(getAdConsentChoice());
    });
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribeConsent();
    };
  }, []);

  // Ensure zero lingering ad scripts or DOM when user is PRO/Business or rejects consent
  useEffect(() => {
    if (!showAds || consentChoice === 'denied') {
      teardownAdsterraNativeBanner();
    }
  }, [showAds, consentChoice]);

  // Mount singleton Adsterra Native Banner container & inject script strictly once
  useEffect(() => {
    if (!canRenderAdsterra || !slotHostRef.current) return;
    return mountAdsterraNativeBanner(slotHostRef.current, {
      onError: () => setAdLoadFailed(true),
    });
  }, [canRenderAdsterra]);

  if (!showAds || !hasConsent) {
    return null;
  }

  const titleText = isRTL
    ? fallbackTitleAr || 'رَصِيدِي برو — تحكم مالي أذكى بدون إعلانات'
    : fallbackTitleEn || 'Raseedi PRO — Smarter finance, zero ads';

  const bodyText = isRTL
    ? fallbackBodyAr || (
        <>
          افتح ماسح الفواتير <bdi dir="ltr">Gemini AI</bdi>، المرفقات غير المحدودة، وتقارير <bdi dir="ltr">PDF</bdi> الاحترافية.
        </>
      )
    : fallbackBodyEn ||
      'Unlock Gemini AI receipt scanning, unlimited photo attachments, and Pro PDF reports.';

  if (variant === 'native-card') {
    return (
      <aside
        aria-label={isRTL ? 'إعلان' : 'Advertisement'}
        className={`shrink-0 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-3 space-y-2 transition-colors max-w-full overflow-hidden ${className}`}
        dir={isRTL ? 'rtl' : 'ltr'}
        data-ad-variant="native-card"
        data-ad-network="adsterra"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]">
            {isRTL ? 'إعلان' : 'Ad'}
          </span>
          <button
            type="button"
            onClick={() => setIsUpgradeModalOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors min-h-[32px]"
          >
            <Crown className="w-3 h-3 shrink-0 text-[var(--color-gold)]" />
            <span>{isRTL ? 'إزالة الإعلانات' : 'Remove Ads'}</span>
          </button>
        </div>

        {canRenderAdsterra ? (
          <div
            ref={slotHostRef}
            className="overflow-hidden max-w-full rounded-lg min-h-[72px] bg-[var(--color-surface-subtle)]/50"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsUpgradeModalOpen(true)}
            className="w-full text-start flex items-start gap-2.5 group"
          >
            <Sparkles className="w-4 h-4 text-[var(--color-gold)] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-xs font-bold text-[var(--color-ink)] group-hover:text-[var(--color-accent)] transition-colors">
                {titleText}
              </div>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                {bodyText}
              </p>
            </div>
          </button>
        )}
      </aside>
    );
  }

  return (
    <aside
      aria-label={isRTL ? 'إعلان' : 'Advertisement'}
      className={`shrink-0 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-3 py-2.5 transition-colors max-w-full overflow-hidden ${className}`}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-ad-variant="banner"
      data-ad-network="adsterra"
    >
      {canRenderAdsterra ? (
        <div className="space-y-1.5 max-w-full overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]">
              {isRTL ? 'إعلان' : 'Ad'}
            </span>
            <button
              type="button"
              onClick={() => setIsUpgradeModalOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-accent)] hover:underline min-h-[28px]"
            >
              <Crown className="w-3 h-3 shrink-0 text-[var(--color-gold)]" />
              <span>{isRTL ? 'إزالة الإعلانات' : 'Remove Ads'}</span>
            </button>
          </div>
          <div
            ref={slotHostRef}
            className="overflow-hidden max-w-full rounded-lg min-h-[64px] bg-[var(--color-surface-subtle)]/50"
          />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] shrink-0">
              {isRTL ? 'إعلان' : 'Ad'}
            </span>
            <span className="text-[11px] text-[var(--color-muted)] leading-snug line-clamp-2">
              {isRTL ? (
                <>
                  تجربة بدون إعلانات مع باقة <bdi dir="ltr">PRO</bdi>
                </>
              ) : (
                'Ad-free experience with Raseedi PRO'
              )}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsUpgradeModalOpen(true)}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[11px] font-semibold text-[var(--color-accent)] transition-colors min-h-[34px]"
          >
            <Crown className="w-3 h-3 shrink-0 text-[var(--color-gold)]" />
            <span>{isRTL ? 'إزالة الإعلانات' : 'Remove Ads'}</span>
          </button>
        </div>
      )}
    </aside>
  );
};

