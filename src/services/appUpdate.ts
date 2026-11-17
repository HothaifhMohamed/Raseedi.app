import { registerSW } from 'virtual:pwa-register';
import {
  buildNoCacheUrl,
  isNewerBuildAvailable,
  parseVersionManifest,
  shouldAttemptAutoReload,
  shouldAttemptChunkRecoveryReload,
  VersionManifest,
} from './appUpdateLogic';

export interface AppUpdateState {
  updateAvailable: boolean;
  isUpdating: boolean;
  dismissed: boolean;
  remoteManifest: VersionManifest | null;
}

type UpdateListener = (state: AppUpdateState) => void;

const RELOAD_KEY_STORAGE = 'raseedi_last_reloaded_build';
const RELOAD_TS_STORAGE = 'raseedi_last_reload_ts';
const STARTUP_AUTO_RELOAD_WINDOW_MS = 6_000;
const MIN_VERSION_CHECK_INTERVAL_MS = 15_000;
const PERIODIC_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const CURRENT_BUILD_ID =
  typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : '';

const listeners = new Set<UpdateListener>();

let state: AppUpdateState = {
  updateAvailable: false,
  isUpdating: false,
  dismissed: false,
  remoteManifest: null,
};

let initialized = false;
let bootTimestampMs = Date.now();
let lastCheckMs = 0;
let swRegistration: ServiceWorkerRegistration | undefined;
let updateServiceWorkerFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
let reloadInProgress = false;

function emitState(): void {
  const snapshot = { ...state };
  listeners.forEach((listener) => listener(snapshot));
}

function setState(patch: Partial<AppUpdateState>): void {
  state = { ...state, ...patch };
  emitState();
}

export function getAppUpdateState(): AppUpdateState {
  return { ...state };
}

export function subscribeAppUpdate(listener: UpdateListener): () => void {
  listeners.add(listener);
  listener({ ...state });
  return () => {
    listeners.delete(listener);
  };
}

export function dismissAppUpdateBanner(): void {
  setState({ dismissed: true });
}

function readSessionReloadHistory(): {
  lastReloadedKey: string | null;
  lastReloadTimestampMs: number | null;
} {
  try {
    const key = window.sessionStorage.getItem(RELOAD_KEY_STORAGE);
    const tsRaw = window.sessionStorage.getItem(RELOAD_TS_STORAGE);
    const ts = tsRaw ? Number(tsRaw) : null;
    return {
      lastReloadedKey: key,
      lastReloadTimestampMs: ts !== null && Number.isFinite(ts) ? ts : null,
    };
  } catch {
    return { lastReloadedKey: null, lastReloadTimestampMs: null };
  }
}

function recordSessionReload(targetKey: string, nowMs: number): void {
  try {
    window.sessionStorage.setItem(RELOAD_KEY_STORAGE, targetKey);
    window.sessionStorage.setItem(RELOAD_TS_STORAGE, String(nowMs));
  } catch {
    // Ignore storage quota/privacy-mode restrictions
  }
}

async function clearHtmlNavigationCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter(
          (name) =>
            name.includes('html-navigation') ||
            name.includes('manifest')
        )
        .map((name) => window.caches.delete(name))
    );
  } catch {
    // Non-fatal
  }
}

function isUserActivelyEditing(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.tagName === 'SELECT' ||
      (active as HTMLElement).isContentEditable)
  ) {
    return true;
  }
  // Check for any open modal overlay (.fixed.z-50)
  return Boolean(document.querySelector('.fixed.z-50'));
}

async function performGuardedReload(targetKey: string): Promise<void> {
  if (reloadInProgress) return;
  const nowMs = Date.now();
  const { lastReloadedKey, lastReloadTimestampMs } = readSessionReloadHistory();
  if (
    !shouldAttemptAutoReload({
      targetKey,
      lastReloadedKey,
      nowMs,
      lastReloadTimestampMs,
    })
  ) {
    return;
  }

  reloadInProgress = true;
  setState({ isUpdating: true });
  recordSessionReload(targetKey, nowMs);

  await clearHtmlNavigationCaches();

  if (swRegistration?.waiting) {
    try {
      swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      // Ignore postMessage failure
    }
  }

  if (updateServiceWorkerFn) {
    try {
      await updateServiceWorkerFn(true);
    } catch {
      // Fallback below
    }
  }

  window.location.reload();
}

const CHUNK_RELOAD_TS_STORAGE = 'raseedi_chunk_reload_ts';

export function attemptChunkRecoveryReload(): boolean {
  if (typeof window === 'undefined') return false;
  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  const nowMs = Date.now();
  let lastAttemptMs: number | null = null;
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RELOAD_TS_STORAGE);
    const parsed = raw ? Number(raw) : null;
    if (parsed !== null && Number.isFinite(parsed)) {
      lastAttemptMs = parsed;
    }
  } catch {
    // Ignore sessionStorage errors
  }

  if (
    !shouldAttemptChunkRecoveryReload({
      nowMs,
      lastAttemptMs,
      isOnline,
    })
  ) {
    return false;
  }

  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_TS_STORAGE, String(nowMs));
  } catch {
    // Ignore
  }

  void clearHtmlNavigationCaches().finally(() => {
    window.location.reload();
  });
  return true;
}

export async function applyPendingAppUpdate(): Promise<void> {
  const targetKey = state.remoteManifest?.buildId || `manual-${Date.now()}`;
  reloadInProgress = false; // Explicit user click always proceeds
  try {
    window.sessionStorage.removeItem(RELOAD_KEY_STORAGE);
    window.sessionStorage.removeItem(RELOAD_TS_STORAGE);
  } catch {
    // Ignore
  }
  await performGuardedReload(targetKey);
}

export async function checkForAppUpdate(options?: { force?: boolean }): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

  const nowMs = Date.now();
  if (!options?.force && nowMs - lastCheckMs < MIN_VERSION_CHECK_INTERVAL_MS) {
    return state.updateAvailable;
  }
  lastCheckMs = nowMs;

  if (swRegistration) {
    try {
      await swRegistration.update();
      if (swRegistration.waiting) {
        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch {
      // Offline or transient network error
    }
  }

  try {
    const res = await fetch(buildNoCacheUrl('/version.json', nowMs), {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
    if (!res.ok) return state.updateAvailable;
    const raw = (await res.json()) as unknown;
    const manifest = parseVersionManifest(raw);
    if (!manifest) return state.updateAvailable;

    if (isNewerBuildAvailable(CURRENT_BUILD_ID, manifest)) {
      setState({
        updateAvailable: true,
        dismissed: false,
        remoteManifest: manifest,
      });

      // If detected immediately on app startup before the user starts interacting,
      // auto-activate the new version seamlessly.
      const withinStartupWindow = Date.now() - bootTimestampMs <= STARTUP_AUTO_RELOAD_WINDOW_MS;
      if (withinStartupWindow && !isUserActivelyEditing()) {
        await performGuardedReload(manifest.buildId);
      }
      return true;
    }
  } catch {
    // Ignore transient offline / fetch errors
  }

  return state.updateAvailable;
}

export function initAppAutoUpdate(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  bootTimestampMs = Date.now();

  if ('serviceWorker' in navigator) {
    const hadControllerAtBoot = Boolean(navigator.serviceWorker.controller);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadControllerAtBoot) return;
      const targetKey = state.remoteManifest?.buildId || 'sw-controller-update';
      if (!isUserActivelyEditing()) {
        void performGuardedReload(targetKey);
      } else {
        setState({ updateAvailable: true, dismissed: false });
      }
    });

    try {
      updateServiceWorkerFn = registerSW({
        immediate: true,
        onRegisteredSW(_swScriptUrl, registration) {
          swRegistration = registration;
          if (!registration) return;

          void registration.update().catch(() => {});
          if (registration.waiting) {
            try {
              registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            } catch {
              // Ignore
            }
          }
        },
        onNeedRefresh() {
          setState({ updateAvailable: true, dismissed: false });
        },
        onNeedReload() {
          const targetKey = state.remoteManifest?.buildId || 'sw-activated-update';
          if (!isUserActivelyEditing()) {
            void performGuardedReload(targetKey);
          } else {
            setState({ updateAvailable: true, dismissed: false });
          }
        },
      });
    } catch {
      // Safe fallback when SW registration is skipped in unsupported/dev environments
    }
  }

  // Immediate check at boot
  void checkForAppUpdate({ force: true });

  // Re-check whenever user returns to the app or regains internet connectivity
  const handleResumeCheck = () => {
    if (document.visibilityState === 'visible') {
      void checkForAppUpdate();
    }
  };
  const handleFocusOrOnline = () => {
    void checkForAppUpdate();
  };

  document.addEventListener('visibilitychange', handleResumeCheck);
  window.addEventListener('focus', handleFocusOrOnline);
  window.addEventListener('online', handleFocusOrOnline);

  // Periodic background check every 5 minutes while app stays open
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void checkForAppUpdate();
    }
  }, PERIODIC_CHECK_INTERVAL_MS);
}
