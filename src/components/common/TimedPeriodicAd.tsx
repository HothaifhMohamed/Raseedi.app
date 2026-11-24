import React, { useEffect, useMemo, useState } from 'react';
import { X, Crown, Coins, ExternalLink, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useOrg } from '../../context/OrgContext';
import { MONETAG_ZONE_ID, syncMonetagZoneScript } from '../../services/monetag';
import { CREDITS_AD_REWARD, REWARDED_AD_LINK_URL } from '../../services/raseediCredits';
import {
  TIMED_AD_MAX_PER_SESSION,
  canTriggerTimedPeriodicAd,
  createTimedAdSessionState,
  dismissTimedPeriodicAd,
  isFreeUserEligibleForTimedAd,
  openTimedPeriodicAd,
  shouldHideActiveTimedPeriodicAd,
  type TimedAdEligibilityInput,
  type TimedAdSessionState,
} from '../../services/timedPeriodicAd';

interface TimedPeriodicAdProps {
  hasBlockingModalOpen: boolean;
  isBrowserOnline: boolean;
  hasConsentForAds: boolean;
  isMainShellReady: boolean;
  isEntitlementResolved: boolean;
}

function readDocumentVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return !document.hidden;
}

/**
 * Disciplined, non-intrusive timed/periodic ad card strictly for Free users.
 * - Hidden completely for PRO, Business, Admin, Active Paid/Trial Organizations,
 *   and 24h Credits Ad-Free / 24h PRO Pass holders.
 * - Respects 90s initial grace period, 4.5-minute periodic interval after dismissal,
 *   and a hard 3-impressions/session cap.
 * - Never displays while TransactionModal or any active modal/dialog is open, and
 *   immediately hides if the user opens any modal or upgrades.
 * - Anchored cleanly above the floating BottomNav so it never covers navigation buttons
 *   and causes zero horizontal overflow in RTL/LTR and Light/Dark modes.
 */
export const TimedPeriodicAd: React.FC<TimedPeriodicAdProps> = ({
  hasBlockingModalOpen,
  isBrowserOnline,
  hasConsentForAds,
  isMainShellReady,
  isEntitlementResolved,
}) => {
  const {
    subscriptionSummary,
    isPro,
    hasActiveAdFreePass,
    setIsUpgradeModalOpen,
    setIsRewardedAdModalOpen,
    isRTL,
  } = useApp();
  const { activeOrgSubscriptionState } = useOrg();

  const [sessionState, setSessionState] = useState<TimedAdSessionState>(() =>
    createTimedAdSessionState(Date.now())
  );
  const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(() => readDocumentVisible());

  const eligibility: TimedAdEligibilityInput = useMemo(
    () => ({
      subscriptionSummary,
      isProFlag: isPro,
      creditsAdFreeActive: hasActiveAdFreePass,
      activeOrgSubscriptionState,
      hasConsent: hasConsentForAds,
      isOnline: isBrowserOnline,
      isMainShellReady,
      isEntitlementResolved,
      hasBlockingModalOpen,
      isDocumentVisible,
    }),
    [
      subscriptionSummary,
      isPro,
      hasActiveAdFreePass,
      activeOrgSubscriptionState,
      hasConsentForAds,
      isBrowserOnline,
      isMainShellReady,
      isEntitlementResolved,
      hasBlockingModalOpen,
      isDocumentVisible,
    ]
  );

  const isFreeEligible = isFreeUserEligibleForTimedAd(eligibility);

  // Track document visibility so timed ads only trigger when user is actively viewing the app
  useEffect(() => {
    const onVisibility = () => setIsDocumentVisible(readDocumentVisible());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Immediately hide if a blocking modal opens or the user loses Free-ad eligibility
  useEffect(() => {
    if (!sessionState.isVisible) return;
    if (shouldHideActiveTimedPeriodicAd(eligibility)) {
      setSessionState((prev) => dismissTimedPeriodicAd(prev, Date.now()));
    }
  }, [sessionState.isVisible, eligibility]);

  // Schedule next check precisely using the pure scheduler (90s initial grace, 4.5m interval, max 3/session)
  useEffect(() => {
    if (!isFreeEligible) return;
    if (sessionState.isVisible || sessionState.shownCount >= TIMED_AD_MAX_PER_SESSION) {
      return;
    }

    const now = Date.now();
    const evaluation = canTriggerTimedPeriodicAd(sessionState, eligibility, now);

    if (evaluation.eligible) {
      syncMonetagZoneScript(true);
      setSessionState((prev) => openTimedPeriodicAd(prev, now));
      return;
    }

    if (evaluation.reason === 'session_cap_reached' || evaluation.reason === 'ineligible_user_or_env') {
      return;
    }

    if (evaluation.reason === 'modal_open' || evaluation.reason === 'document_hidden') {
      // Wait for dependency change (modal closing / tab becoming visible) instead of busy-polling
      return;
    }

    const delayMs = Math.max(1000, evaluation.nextCheckInMs + 50);
    const timer = window.setTimeout(() => {
      const triggerNow = Date.now();
      const recheck = canTriggerTimedPeriodicAd(sessionState, eligibility, triggerNow);
      if (recheck.eligible) {
        syncMonetagZoneScript(true);
        setSessionState((prev) => openTimedPeriodicAd(prev, triggerNow));
      }
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [isFreeEligible, sessionState, eligibility]);

  if (!isFreeEligible || !sessionState.isVisible || hasBlockingModalOpen) {
    return null;
  }

  const handleDismiss = () => {
    setSessionState((prev) => dismissTimedPeriodicAd(prev, Date.now()));
  };

  const handleOpenRewardedCredits = () => {
    handleDismiss();
    setIsRewardedAdModalOpen(true);
  };

  const handleOpenUpgrade = () => {
    handleDismiss();
    setIsUpgradeModalOpen(true);
  };

  return (
    <div
      className="fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[35] px-3 pointer-events-none flex justify-center no-print"
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="timed-periodic-ad-wrapper"
      data-monetag-slot={MONETAG_ZONE_ID}
    >
      <aside
        role="complementary"
        aria-label={isRTL ? 'إعلان مجاني برعاية' : 'Sponsored Free-tier Ad'}
        data-testid="timed-periodic-ad"
        className="pointer-events-auto w-full max-w-md rounded-2xl bg-[var(--color-surface)]/96 backdrop-blur-xl border border-[var(--color-gold)]/45 shadow-[0_14px_34px_-8px_rgba(14,94,88,0.24)] dark:shadow-[0_16px_38px_-8px_rgba(4,16,15,0.85)] overflow-hidden text-[var(--color-ink)] transition-all duration-300"
      >
        {/* Top bar: subtle sponsored label + prominent fast Close button */}
        <div className="px-3.5 py-2 bg-[var(--color-bg)]/90 border-b border-[var(--color-line)] flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/35 text-[10px] font-bold text-[var(--color-gold-text)] shrink-0">
              <Sparkles className="w-3 h-3 shrink-0" />
              <span>{isRTL ? 'إعلان' : 'Sponsored'}</span>
            </span>
            <span className="text-[11px] text-[var(--color-muted)] truncate">
              {isRTL ? 'يدعم استمرار «رصيدي» مجاناً' : 'Helps keep Raseedi free'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label={isRTL ? 'إغلاق الإعلان' : 'Close ad'}
            data-testid="timed-ad-close-btn"
            className="w-8 h-8 min-h-[32px] min-w-[32px] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)] flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Compact sponsored content + clean actions */}
        <div className="p-3.5 space-y-2.5 min-w-0">
          <div className="flex items-start justify-between gap-2.5 min-w-0">
            <div className="min-w-0 space-y-0.5">
              <p className="font-title text-xs font-bold text-[var(--color-ink)] leading-snug">
                {isRTL
                  ? 'حوّل مشاهدتك إلى مكافأة أو أزل الإعلانات بالكامل'
                  : 'Turn ad views into rewards or go completely ad-free'}
              </p>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                {isRTL
                  ? `اكسب +${CREDITS_AD_REWARD} نقاط رصيدي من إعلان مكافأة سريع، أو استمتع بتجربة خالية تماماً من الإعلانات مع PRO.`
                  : `Earn +${CREDITS_AD_REWARD} Raseedi Credits with a quick rewarded ad, or unlock a 100% ad-free PRO experience.`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a
              href={REWARDED_AD_LINK_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                handleOpenRewardedCredits();
              }}
              data-testid="timed-ad-reward-cta"
              className="py-2 px-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-bold flex items-center justify-center gap-1.5 min-h-[38px] hover:opacity-95 transition-opacity truncate"
            >
              <Coins className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {isRTL ? `اكسب +${CREDITS_AD_REWARD} نقاط` : `Earn +${CREDITS_AD_REWARD} Credits`}
              </span>
              <ExternalLink className="w-3 h-3 shrink-0 opacity-85" />
            </a>

            <button
              type="button"
              onClick={handleOpenUpgrade}
              data-testid="timed-ad-upgrade-cta"
              className="py-2 px-2.5 rounded-xl bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/45 text-[var(--color-gold-text)] text-[11px] font-bold flex items-center justify-center gap-1.5 min-h-[38px] hover:opacity-95 transition-opacity truncate"
            >
              <Crown className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {isRTL ? 'بدون إعلانات (PRO)' : 'Remove Ads (PRO)'}
              </span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
