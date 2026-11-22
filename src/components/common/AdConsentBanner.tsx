import React from 'react';
import { teardownAdsterraBanner320x50 } from '../../services/adsterra';
import {
  type AdConsentChoice,
  getAdConsentChoice,
  saveAdConsentChoice as saveAdConsentChoiceBase,
  resetAdConsentChoice,
  hasAdConsent,
  hasAdSenseConsent,
  subscribeAdConsentChanges,
} from '../../services/adConsent';

export {
  type AdConsentChoice,
  getAdConsentChoice,
  resetAdConsentChoice,
  hasAdConsent,
  hasAdSenseConsent,
  subscribeAdConsentChanges,
};

export function saveAdConsentChoice(choice: 'granted' | 'denied'): void {
  saveAdConsentChoiceBase(choice, {
    onDenied: () => teardownAdsterraBanner320x50(),
  });
}

/**
 * Floating main-screen consent popup has been intentionally removed so free users
 * are never interrupted on launch. Ad disclosure and preference management now
 * live calmly inside Settings and the Privacy Policy.
 */
export const AdConsentBanner: React.FC = () => {
  return null;
};
