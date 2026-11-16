import React, { useEffect, useRef, useState } from 'react';
import { Crown, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { hasAdSenseConsent, subscribeAdConsentChanges } from './AdConsentBanner';
import { shouldShowAds } from '../../services/subscriptionHelpers';

export interface AdBannerProps {
  variant?: 'banner' | 'native-card';
  adSlot?: string;
  fallbackTitleAr?: string;
  fallbackTitleEn?: string;
  fallbackBodyAr?: string;
  fallbackBodyEn?: string;
  className?: string;
}

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>;
  }
}

export const AdBanner: React.FC<AdBannerProps> = ({
  variant = 'banner',
  adSlot,
  fallbackTitleAr,
  fallbackTitleEn,
  fallbackBodyAr,
  fallbackBodyEn,
  className = '',
}) => {
  const { isPro, subscriptionSummary, setIsUpgradeModalOpen, isRTL } = useApp();
  const showAds = shouldShowAds(subscriptionSummary) && !isPro;
  const adRef = useRef<HTMLModElement | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [adLoadFailed, setAdLoadFailed] = useState(false);
  const [hasConsent, setHasConsent] = useState<boolean>(() => hasAdSenseConsent());

  const adSenseClient =
    import.meta.env.VITE_ADSENSE_CLIENT_ID?.trim() || 'ca-pub-7802456807447662';
  const resolvedSlot = adSlot?.trim() || import.meta.env.VITE_ADSENSE_SLOT_ID?.trim() || '0000000000';
  const canTryAdSense = Boolean(adSenseClient) && isOnline && !adLoadFailed && hasConsent;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const unsubscribeConsent = subscribeAdConsentChanges(() => {
      setHasConsent(hasAdSenseConsent());
    });
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribeConsent();
    };
  }, []);

  useEffect(() => {
    if (!showAds || !canTryAdSense) return;

    const scriptId = 'raseedi-adsense-script';
    const existingScript =
      document.getElementById(scriptId) ||
      document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adSenseClient)}`;
      script.onerror = () => setAdLoadFailed(true);
      document.head.appendChild(script);
    }

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      setAdLoadFailed(true);
    }
  }, [showAds, canTryAdSense, adSenseClient]);

  if (!showAds || !adSenseClient) return null;

  const titleText = isRTL
    ? fallbackTitleAr || 'رَصِيدِي برو — تحكم مالي أذكى بدون إعلانات'
    : fallbackTitleEn || 'Raseedi PRO — Smarter finance, zero ads';

  const bodyText = isRTL
    ? fallbackBodyAr || (
        <>
          افتح ماسح الفواتير <bdi dir="ltr">Gemini AI</bdi>، المرفقات غير المحدودة، وتقارير <bdi dir="ltr">PDF</bdi> الاحترافية.
        </>
      )
    : fallbackBodyEn || 'Unlock Gemini AI receipt scanning, unlimited photo attachments, and Pro PDF reports.';

  if (variant === 'native-card') {
    return (
      <div
        className={`bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-3 space-y-2 transition-colors max-w-full overflow-hidden ${className}`}
        dir={isRTL ? 'rtl' : 'ltr'}
        data-ad-variant="native-card"
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
            <Crown className="w-3 h-3 shrink-0" />
            <span>{isRTL ? 'إزالة الإعلانات' : 'Remove Ads'}</span>
          </button>
        </div>

        {canTryAdSense ? (
          <div className="overflow-hidden max-w-full rounded-lg min-h-[64px]">
            <ins
              ref={adRef}
              className="adsbygoogle"
              style={{ display: 'block', maxWidth: '100%', overflow: 'hidden' }}
              data-ad-client={adSenseClient}
              data-ad-slot={resolvedSlot}
              data-ad-format="fluid"
              data-full-width-responsive="true"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsUpgradeModalOpen(true)}
            className="w-full text-start flex items-start gap-2.5 group"
          >
            <Sparkles className="w-4 h-4 text-[var(--color-accent)] shrink-0 mt-0.5" />
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
      </div>
    );
  }

  return (
    <div
      className={`bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-3 py-2.5 transition-colors max-w-full overflow-hidden ${className}`}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-ad-variant="banner"
    >
      {canTryAdSense ? (
        <div className="space-y-1.5 max-w-full overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]">
              {isRTL ? 'إعلان' : 'Ad'}
            </span>
            <button
              type="button"
              onClick={() => setIsUpgradeModalOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-accent)] hover:underline"
            >
              <Crown className="w-3 h-3" />
              <span>{isRTL ? 'إزالة الإعلانات' : 'Remove Ads'}</span>
            </button>
          </div>
          <div className="overflow-hidden max-w-full">
            <ins
              ref={adRef}
              className="adsbygoogle"
              style={{ display: 'block', maxWidth: '100%', overflow: 'hidden' }}
              data-ad-client={adSenseClient}
              data-ad-slot={resolvedSlot}
              data-ad-format="horizontal"
              data-full-width-responsive="true"
            />
          </div>
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
            <Crown className="w-3 h-3 shrink-0" />
            <span>{isRTL ? 'إزالة الإعلانات' : 'Remove Ads'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
