import React, { useEffect, useState } from 'react';
import { Cookie, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useOrg } from '../../context/OrgContext';
import { shouldShowAds } from '../../services/subscriptionHelpers';
import { teardownAdsterraBanner320x50 } from '../../services/adsterra';

const AD_CONSENT_STORAGE_KEY = 'raseedi_ad_consent_v1';
const AD_CONSENT_EVENT = 'raseedi-ad-consent-changed';

export type AdConsentChoice = 'granted' | 'denied' | null;

export function getAdConsentChoice(): AdConsentChoice {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(AD_CONSENT_STORAGE_KEY);
    if (raw === 'granted' || raw === 'denied') return raw;
    return null;
  } catch {
    return null;
  }
}

export function saveAdConsentChoice(choice: 'granted' | 'denied'): void {
  try {
    if (choice === 'denied') {
      teardownAdsterraBanner320x50();
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AD_CONSENT_STORAGE_KEY, choice);
      window.dispatchEvent(new CustomEvent(AD_CONSENT_EVENT));
    }
  } catch {
    // Ignore storage failures
  }
}

export function resetAdConsentChoice(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(AD_CONSENT_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent(AD_CONSENT_EVENT));
    }
  } catch {
    // Ignore
  }
}

export function hasAdSenseConsent(): boolean {
  return getAdConsentChoice() === 'granted';
}

export function hasAdConsent(): boolean {
  return getAdConsentChoice() === 'granted';
}

export function subscribeAdConsentChanges(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(AD_CONSENT_EVENT, callback);
  return () => window.removeEventListener(AD_CONSENT_EVENT, callback);
}

export const AdConsentBanner: React.FC = () => {
  const { isPro, subscriptionSummary, hasActiveAdFreePass, isRTL } = useApp();
  const { activeOrgSubscriptionState } = useOrg();
  const [choice, setChoice] = useState<AdConsentChoice>(() => getAdConsentChoice());

  const showAds = shouldShowAds(subscriptionSummary, {
    isProFlag: isPro,
    creditsAdFreeActive: hasActiveAdFreePass,
    activeOrgSubscriptionState,
  });

  useEffect(() => {
    return subscribeAdConsentChanges(() => {
      setChoice(getAdConsentChoice());
    });
  }, []);

  if (!showAds || choice !== null) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label={isRTL ? 'إعدادات الخصوصية والإعلانات' : 'Privacy & Ad Preferences'}
      className="fixed bottom-20 inset-x-0 z-40 px-3 pb-2 pointer-events-none"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="max-w-lg mx-auto bg-[var(--color-surface)] border border-[var(--color-gold)]/45 rounded-2xl p-3.5 shadow-xl pointer-events-auto space-y-2.5">
        <div className="flex items-start gap-2.5">
          <Cookie className="w-5 h-5 text-[var(--color-gold)] shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
              <span>
                {isRTL ? 'إعدادات الخصوصية وملفات تعريف الارتباط' : 'Privacy & Cookie Preferences'}
              </span>
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
            </h3>
            <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
              {isRTL ? (
                <>
                  نستخدم ملفات تعريف الارتباط لعرض إعلانات خفيفة محدودة (مثل <bdi dir="ltr">Adsterra</bdi>) لدعم النسخة المجانية. بياناتك المالية تبقى خاصة تماماً ولا تُشارك أبداً مع أي معلن.
                </>
              ) : (
                'We use cookies to display lightweight ads (such as Adsterra) in the free tier. Your financial ledger data stays strictly private and is never shared with advertisers.'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => saveAdConsentChoice('granted')}
            className="flex-1 py-2 px-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold hover:opacity-95 transition-opacity min-h-[44px]"
          >
            {isRTL ? 'موافقة على الإعلانات' : 'Accept Ads & Cookies'}
          </button>
          <button
            type="button"
            onClick={() => saveAdConsentChoice('denied')}
            className="flex-1 py-2 px-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] text-xs font-semibold hover:border-[var(--color-muted)] transition-colors min-h-[44px]"
          >
            {isRTL ? 'رفض الإعلانات' : 'Decline'}
          </button>
        </div>
      </div>
    </div>
  );
};

