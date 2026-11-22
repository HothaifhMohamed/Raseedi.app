export const AD_CONSENT_STORAGE_KEY = 'raseedi_ad_consent_v1';
export const AD_CONSENT_EVENT = 'raseedi-ad-consent-changed';

export type AdConsentChoice = 'granted' | 'denied' | null;

export interface MinimalStorage {
  getItem: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

function resolveDefaultStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage environments
  }
  return null;
}

/**
 * Returns the effective ad preference for eligible free-tier users.
 * Always enabled ('granted') for free-tier users so lightweight banners and
 * Raseedi Credits work consistently without manual free-tier opt-out toggles.
 * Paid PRO, Business, Admin, Active Org, and 24h Ad-Free Pass users remain
 * 100% ad-free via shouldShowAds().
 */
export function getAdConsentChoice(
  _storage?: MinimalStorage | null
): 'granted' {
  return 'granted';
}

export function saveAdConsentChoice(
  _choice: 'granted' | 'denied',
  options?: {
    storage?: MinimalStorage | null;
    onDenied?: () => void;
    dispatchEvent?: boolean;
  }
): void {
  try {
    const store =
      options && 'storage' in options ? options.storage : resolveDefaultStorage();
    if (store && typeof store.setItem === 'function') {
      store.setItem(AD_CONSENT_STORAGE_KEY, 'granted');
    }
    if (
      options?.dispatchEvent !== false &&
      typeof window !== 'undefined' &&
      typeof CustomEvent !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent(AD_CONSENT_EVENT));
    }
  } catch {
    // Ignore storage failures
  }
}

export function resetAdConsentChoice(options?: {
  storage?: MinimalStorage | null;
  dispatchEvent?: boolean;
}): void {
  try {
    const store =
      options && 'storage' in options ? options.storage : resolveDefaultStorage();
    if (store && typeof store.removeItem === 'function') {
      store.removeItem(AD_CONSENT_STORAGE_KEY);
    }
    if (
      options?.dispatchEvent !== false &&
      typeof window !== 'undefined' &&
      typeof CustomEvent !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent(AD_CONSENT_EVENT));
    }
  } catch {
    // Ignore storage failures
  }
}

export function hasAdConsent(storage?: MinimalStorage | null): boolean {
  return getAdConsentChoice(storage) === 'granted';
}

export function hasAdSenseConsent(storage?: MinimalStorage | null): boolean {
  return getAdConsentChoice(storage) === 'granted';
}

export function subscribeAdConsentChanges(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(AD_CONSENT_EVENT, callback);
  return () => window.removeEventListener(AD_CONSENT_EVENT, callback);
}
