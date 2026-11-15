import React, { useEffect, useState } from 'react';
import { Cookie, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const AD_CONSENT_STORAGE_KEY = 'raseedi_ad_consent_v1';
const AD_CONSENT_EVENT = 'raseedi-ad-consent-changed';

export type AdConsentChoice = 'granted' | 'denied' | null;

const EEA_UK_TIMEZONES = new Set<string>([
  'Atlantic/Azores',
  'Atlantic/Canary',
  'Atlantic/Madeira',
  'Atlantic/Reykjavik',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Belfast',
  'Europe/Berlin',
  'Europe/Bratislava',
  'Europe/Brussels',
  'Europe/Bucharest',
  'Europe/Budapest',
  'Europe/Busingen',
  'Europe/Copenhagen',
  'Europe/Dublin',
  'Europe/Gibraltar',
  'Europe/Guernsey',
  'Europe/Helsinki',
  'Europe/Isle_of_Man',
  'Europe/Jersey',
  'Europe/Lisbon',
  'Europe/Ljubljana',
  'Europe/London',
  'Europe/Luxembourg',
  'Europe/Madrid',
  'Europe/Malta',
  'Europe/Mariehamn',
  'Europe/Nicosia',
  'Europe/Oslo',
  'Europe/Paris',
  'Europe/Prague',
  'Europe/Riga',
  'Europe/Rome',
  'Europe/Sofia',
  'Europe/Stockholm',
  'Europe/Tallinn',
  'Europe/Vaduz',
  'Europe/Vienna',
  'Europe/Vilnius',
  'Europe/Warsaw',
  'Europe/Zagreb',
  'Asia/Nicosia',
]);

export function isEeaOrUkUser(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return EEA_UK_TIMEZONES.has(tz);
  } catch {
    return false;
  }
}

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
  if (!isEeaOrUkUser()) return true;
  return getAdConsentChoice() === 'granted';
}

export function subscribeAdConsentChanges(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(AD_CONSENT_EVENT, callback);
  return () => window.removeEventListener(AD_CONSENT_EVENT, callback);
}

export const AdConsentBanner: React.FC = () => {
  const { isPro, isRTL } = useApp();
  const [choice, setChoice] = useState<AdConsentChoice>(() => getAdConsentChoice());
  const adSenseClient =
    import.meta.env.VITE_ADSENSE_CLIENT_ID?.trim() || 'ca-pub-7802456807447662';
  const isEea = isEeaOrUkUser();

  useEffect(() => {
    return subscribeAdConsentChanges(() => {
      setChoice(getAdConsentChoice());
    });
  }, []);

  if (isPro || !adSenseClient || !isEea || choice !== null) {
    return null;
  }

  return (
    <div
      className="fixed bottom-16 inset-x-0 z-40 px-3 pb-2 pointer-events-none"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="max-w-lg mx-auto bg-[var(--color-surface)] border border-[var(--color-accent)]/40 rounded-2xl p-3.5 shadow-xl pointer-events-auto space-y-2.5">
        <div className="flex items-start gap-2.5">
          <Cookie className="w-5 h-5 text-[var(--color-accent)] shrink-0 mt-0.5" />
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
                  نستخدم ملفات تعريف الارتباط لعرض إعلانات <bdi dir="ltr">Google AdSense</bdi> في النسخة المجانية. بياناتك المالية تبقى خاصة ولا تُشارك مع المعلنين.
                </>
              ) : (
                'We use cookies to serve Google AdSense ads in the free tier. Your financial ledger data stays private and is never shared with advertisers.'
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
            {isRTL ? 'موافقة على ملفات الارتباط' : 'Accept Cookies'}
          </button>
          <button
            type="button"
            onClick={() => saveAdConsentChoice('denied')}
            className="flex-1 py-2 px-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] text-xs font-semibold hover:border-[var(--color-muted)] transition-colors min-h-[44px]"
          >
            {isRTL ? 'رفض الإعلانات المخصصة' : 'Reject Cookies'}
          </button>
        </div>
      </div>
    </div>
  );
};
