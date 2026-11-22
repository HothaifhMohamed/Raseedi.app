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
 * Default-enabled ('granted') so lightweight banners and Raseedi Credits
 * work immediately out of the box without a blocking popup on launch.
 * Returns 'denied' only if the user explicitly opted out from Settings / Privacy Policy.
 */
export function getAdConsentChoice(
  storage?: MinimalStorage | null
): 'granted' | 'denied' {
  try {
    const store = storage === undefined ? resolveDefaultStorage() : storage;
    if (!store) return 'granted';
    const raw = store.getItem(AD_CONSENT_STORAGE_KEY);
    if (raw === 'denied') return 'denied';
    return 'granted';
  } catch {
    return 'granted';
  }
}

export function saveAdConsentChoice(
  choice: 'granted' | 'denied',
  options?: {
    storage?: MinimalStorage | null;
    onDenied?: () => void;
    dispatchEvent?: boolean;
  }
): void {
  try {
    if (choice === 'denied') {
      options?.onDenied?.();
    }
    const store =
      options && 'storage' in options ? options.storage : resolveDefaultStorage();
    if (store && typeof store.setItem === 'function') {
      store.setItem(AD_CONSENT_STORAGE_KEY, choice);
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
