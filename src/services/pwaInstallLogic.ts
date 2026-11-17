export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface StandaloneDetectionEnv {
  displayModeStandalone?: boolean;
  displayModeWindowControlsOverlay?: boolean;
  navigatorStandalone?: boolean;
  referrer?: string;
}

export type PWAInstallActionKind = 'none' | 'native-prompt' | 'ios-guide';

export interface PWAInstallCapabilityInput {
  isInstalled: boolean;
  hasDeferredPrompt: boolean;
  isIOS: boolean;
}

/**
 * Checks whether the application is currently running in an installed standalone PWA context.
 */
export function detectStandaloneMode(env: StandaloneDetectionEnv): boolean {
  if (env.displayModeStandalone === true) return true;
  if (env.displayModeWindowControlsOverlay === true) return true;
  if (env.navigatorStandalone === true) return true;
  if (typeof env.referrer === 'string' && env.referrer.startsWith('android-app://')) {
    return true;
  }
  return false;
}

/**
 * Checks whether the current browser runs on iOS / iPadOS (where beforeinstallprompt is unsupported).
 */
export function detectIOSDevice(userAgent: string, maxTouchPoints = 0): boolean {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return false;
  if (/iphone|ipad|ipod/.test(ua)) return true;
  // iPadOS 13+ reports Macintosh in UA while preserving touch points > 1
  if (/macintosh/.test(ua) && maxTouchPoints > 1) return true;
  return false;
}

/**
 * Resolves the direct install action available to the user.
 * Always returns 'none' when already installed/running standalone.
 */
export function getInstallActionKind(input: PWAInstallCapabilityInput): PWAInstallActionKind {
  if (input.isInstalled) return 'none';
  if (input.hasDeferredPrompt) return 'native-prompt';
  if (input.isIOS) return 'ios-guide';
  return 'none';
}

/**
 * Determines whether the direct "Install App" button should be displayed in UI surfaces.
 */
export function canShowDirectInstallButton(input: PWAInstallCapabilityInput): boolean {
  return getInstallActionKind(input) !== 'none';
}
