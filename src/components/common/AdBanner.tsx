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
  mountAdsterraBanner320x50,
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

export const AdBanner: React.FC<AdBannerProps> = ({
  variant = 'banner',
  className = '',
}) => {
  const { isPro, subscriptionSummary, hasActiveAdFreePass, setIsUpgradeModalOpen, isRTL } = useApp();
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

  // Ensure zero lingering ad iframes when user is PRO/Business or rejects consent
  useEffect(() => {
    if (!showAds || consentChoice === 'denied') {
      teardownAdsterraBanner320x50();
    }
  }, [showAds, consentChoice]);

  // Mount isolated 320x50 Adsterra banner iframe strictly once per active view
  useEffect(() => {
    if (!canRenderAdsterra || !slotHostRef.current) return;
    return mountAdsterraBanner320x50(slotHostRef.current, {
      title: isRTL ? 'إعلان' : 'Advertisement',
      onError: () => setAdLoadFailed(true),
    });
  }, [canRenderAdsterra, isRTL]);

  if (!showAds || !hasConsent) {
    return null;
  }

  return (
    <aside
      aria-label={isRTL ? 'إعلان' : 'Advertisement'}
      className={`shrink-0 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-2.5 py-2 transition-colors max-w-full overflow-hidden ${className}`}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-ad-variant={variant}
      data-ad-format="banner-320x50"
      data-ad-network="adsterra"
    >
      {canRenderAdsterra ? (
        <div className="space-y-1.5 max-w-full overflow-hidden">
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
          <div className="w-full flex items-center justify-center overflow-hidden">
            <div
              ref={slotHostRef}
              className="w-[320px] max-w-full h-[50px] rounded-md overflow-hidden bg-[var(--color-surface-subtle)]/40 flex items-center justify-center"
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2.5 min-h-[50px]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] shrink-0 leading-none">
              {isRTL ? 'إعلان' : 'Ad'}
            </span>
            <span className="text-[11px] text-[var(--color-muted)] leading-snug line-clamp-2">
              {isRTL ? (
                <>
                  تجربة هادئة بدون إعلانات مع باقة <bdi dir="ltr">PRO</bdi>
                </>
              ) : (
                'Calm, ad-free experience with Raseedi PRO'
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
