import {
  BeforeInstallPromptEvent,
  PWAInstallActionKind,
  detectIOSDevice,
  detectStandaloneMode,
  getInstallActionKind,
} from './pwaInstallLogic';

export interface PWAInstallSnapshot {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  actionKind: PWAInstallActionKind;
}

type Listener = () => void;

let initialized = false;
let deferredPromptRef: BeforeInstallPromptEvent | null = null;
let installedViaEvent = false;
const listeners = new Set<Listener>();
let cachedSnapshot: PWAInstallSnapshot | null = null;

function computeRawState() {
  if (typeof window === 'undefined') {
    return {
      deferredPrompt: null as BeforeInstallPromptEvent | null,
      isInstallable: false,
      isInstalled: false,
      isIOS: false,
      actionKind: 'none' as PWAInstallActionKind,
    };
  }

  const standaloneMedia =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)').matches
      : false;
  const wcoMedia =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: window-controls-overlay)').matches
      : false;
  const navigatorStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  const referrer = typeof document !== 'undefined' ? document.referrer : '';

  const isInstalled =
    installedViaEvent ||
    detectStandaloneMode({
      displayModeStandalone: standaloneMedia,
      displayModeWindowControlsOverlay: wcoMedia,
      navigatorStandalone,
      referrer,
    });

  const userAgent = window.navigator?.userAgent || '';
  const maxTouchPoints = window.navigator?.maxTouchPoints || 0;
  const isIOS = detectIOSDevice(userAgent, maxTouchPoints);

  const hasDeferredPrompt = deferredPromptRef !== null && !isInstalled;
  const actionKind = getInstallActionKind({
    isInstalled,
    hasDeferredPrompt,
    isIOS,
  });

  return {
    deferredPrompt: hasDeferredPrompt ? deferredPromptRef : null,
    isInstallable: hasDeferredPrompt,
    isInstalled,
    isIOS,
    actionKind,
  };
}

function refreshCachedSnapshot(): PWAInstallSnapshot {
  const next = computeRawState();
  if (
    cachedSnapshot &&
    cachedSnapshot.deferredPrompt === next.deferredPrompt &&
    cachedSnapshot.isInstallable === next.isInstallable &&
    cachedSnapshot.isInstalled === next.isInstalled &&
    cachedSnapshot.isIOS === next.isIOS &&
    cachedSnapshot.actionKind === next.actionKind
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = next;
  return cachedSnapshot;
}

function notifyListeners(): void {
  refreshCachedSnapshot();
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // keep notifying other listeners
    }
  });
}

export function initPWAInstallCapture(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    event.preventDefault();
    deferredPromptRef = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    installedViaEvent = true;
    deferredPromptRef = null;
    notifyListeners();
  });

  if (typeof window.matchMedia === 'function') {
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const wcoQuery = window.matchMedia('(display-mode: window-controls-overlay)');
    const onDisplayModeChange = () => notifyListeners();

    if (typeof standaloneQuery.addEventListener === 'function') {
      standaloneQuery.addEventListener('change', onDisplayModeChange);
    }
    if (typeof wcoQuery.addEventListener === 'function') {
      wcoQuery.addEventListener('change', onDisplayModeChange);
    }
  }

  refreshCachedSnapshot();
}

export function getPWAInstallSnapshot(): PWAInstallSnapshot {
  return refreshCachedSnapshot();
}

export function subscribePWAInstall(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function triggerPWAInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const promptEvent = deferredPromptRef;
  if (!promptEvent || getPWAInstallSnapshot().isInstalled) {
    return 'unavailable';
  }

  try {
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    deferredPromptRef = null;
    if (outcome === 'accepted') {
      installedViaEvent = true;
    }
    notifyListeners();
    return outcome;
  } catch {
    deferredPromptRef = null;
    notifyListeners();
    return 'dismissed';
  }
}
