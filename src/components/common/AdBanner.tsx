import React, { useEffect, useRef, useState } from 'react';
import { Crown } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useOrg } from '../../context/OrgContext';
import {
  AdConsentChoice,
  getAdConsentChoice,
  subscribeAdConsentChanges,
} from './AdConsentBanner';
import { shouldShowAds } from '../../services/subscriptionHelpers';
import {
  AdBannerLoadState,
  AdBannerTheme,
  ADSTERRA_NO_FILL_TIMEOUT_MS,
  mountAdsterraBanner320x50,
  resolveAdBannerVisibility,
  teardownAdsterraBanner320x50,
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

function resolveDocumentTheme(themeSetting?: string): AdBannerTheme {
  if (themeSetting === 'dark') return 'dark';
  if (themeSetting === 'light') return 'light';
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return 'dark';
  }
  return 'light';
}

export const AdBanner: React.FC<AdBannerProps> = ({
  variant = 'banner',
  className = '',
}) => {
  const {
    isPro,
    subscriptionSummary,
    hasActiveAdFreePass,
    setIsUpgradeModalOpen,
    isRTL,
    settings,
  } = useApp();
  const { activeOrgSubscriptionState } = useOrg();

  const showAds = shouldShowAds(subscriptionSummary, {
    isProFlag: isPro,
    creditsAdFreeActive: hasActiveAdFreePass,
    activeOrgSubscriptionState,
  });

  const slotHostRef = useRef<HTMLDivElement | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [loadState, setLoadState] = useState<AdBannerLoadState>('loading');
  const [consentChoice, setConsentChoice] = useState<AdConsentChoice>(() => getAdConsentChoice());

  const hasConsent = consentChoice === 'granted';
  const bannerTheme: AdBannerTheme = resolveDocumentTheme(settings?.theme);
  const visibility = resolveAdBannerVisibility({
    showAds,
    hasConsent,
    isOnline,
    loadState,
  });
  const shouldMountIframe = visibility === 'loading-hidden' || visibility === 'visible';

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setLoadState('loading');
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
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

  // Ensure zero lingering ad iframes when hidden (PRO/Business/Admin/Active Org/No-Fill/Offline)
  useEffect(() => {
    if (!shouldMountIframe) {
      teardownAdsterraBanner320x50();
    }
  }, [shouldMountIframe]);

  // Mount isolated 320x50 Adsterra banner iframe strictly once per active view.
  // Stays collapsed (0px, opacity-0) until Adsterra confirms an actual creative
  // filled; collapses completely on No-Fill, timeout, or script error.
  useEffect(() => {
    if (!shouldMountIframe || !slotHostRef.current) return;
    return mountAdsterraBanner320x50(slotHostRef.current, {
      title: isRTL ? 'إعلان' : 'Advertisement',
      theme: bannerTheme,
      timeoutMs: ADSTERRA_NO_FILL_TIMEOUT_MS,
      onFilled: () => setLoadState('filled'),
      onNoFill: () => setLoadState('no-fill'),
      onError: () => setLoadState('error'),
    });
  }, [shouldMountIframe, isRTL, bannerTheme]);

  if (visibility === 'hidden') {
    return null;
  }

  const isVisible = visibility === 'visible';

  return (
    <aside
      aria-label={isRTL ? 'إعلان' : 'Advertisement'}
      aria-hidden={!isVisible}
      className={
        isVisible
          ? `shrink-0 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-2.5 py-2 transition-opacity duration-200 opacity-100 max-w-full overflow-hidden ${className}`
          : 'h-0 max-h-0 m-0 p-0 border-0 overflow-hidden opacity-0 pointer-events-none select-none'
      }
      dir={isRTL ? 'rtl' : 'ltr'}
      data-ad-variant={variant}
      data-ad-format="banner-320x50"
      data-ad-network="adsterra"
      data-ad-state={loadState}
      data-testid="adsterra-banner-container"
    >
      <div className="space-y-1.5 max-w-full overflow-hidden">
        {isVisible && (
          <div className="flex items-center justify-between gap-2">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] leading-none">
              {isRTL ? 'إعلان' : 'Ad'}
            </span>
            <button
              type="button"
              onClick={() => setIsUpgradeModalOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-accent)] hover:underline min-h-[24px]"
            >
              <Crown className="w-3 h-3 shrink-0 text-[var(--color-gold)]" />
              <span>{isRTL ? 'إزالة الإعلانات' : 'Remove Ads'}</span>
            </button>
          </div>
        )}
        <div className="w-full flex items-center justify-center overflow-hidden">
          <div
            ref={slotHostRef}
            className="w-[320px] max-w-full h-[50px] rounded-md overflow-hidden bg-transparent flex items-center justify-center"
          />
        </div>
      </div>
    </aside>
  );
};
