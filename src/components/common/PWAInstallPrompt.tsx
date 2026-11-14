import React, { useState, useEffect } from 'react';
import { Download, Share2, WifiOff, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export const PWAInstallPrompt: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const { t, isRTL } = useApp();

  if (isInstalled || dismissed) return null;

  if (isInstallable) {
    return (
      <div className="mx-4 my-2 p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center shrink-0">
            <Download className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-[var(--color-ink)]">{t('installApp')}</div>
            <div className="text-[11px] text-[var(--color-muted)]">
              {isRTL ? 'تطبيق رَصِيدِي على الشاشة الرئيسية' : 'Raseedi App on home screen'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={install}
            className="px-3 py-1.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] text-xs font-semibold rounded-lg transition min-h-[36px]"
          >
            {isRTL ? 'تثبيت' : 'Install'}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
            aria-label="Dismiss install banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (isIOS) {
    return (
      <>
        <div className="mx-4 my-2 p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <Share2 className="w-4 h-4 text-[var(--color-accent)]" />
            <div className="text-xs text-[var(--color-ink)]">
              {isRTL ? <>تثبيت التطبيق على <bdi dir="ltr">iPhone / iPad</bdi></> : 'Install app on iOS'}
            </div>
          </div>
          <button
            onClick={() => setShowIOSGuide(true)}
            className="px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] border border-[var(--color-accent)]/40 rounded-lg hover:bg-[var(--color-accent)]/10 min-h-[36px]"
          >
            {isRTL ? 'طريقة التثبيت' : 'How to install'}
          </button>
        </div>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
              <h3 className="text-sm font-bold mb-3">
                {isRTL ? <>تثبيت التطبيق على جهاز <bdi dir="ltr">Apple</bdi></> : 'Install on Apple Device'}
              </h3>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed mb-4">
                {isRTL ? (
                  <>
                    1. اضغط على أيقونة <strong>المشاركة (<bdi dir="ltr">Share</bdi>)</strong> في شريط متصفح <bdi dir="ltr">Safari</bdi>.<br />
                    2. مرر للأسفل واضغط على <strong>إضافة إلى الصفحة الرئيسية (<bdi dir="ltr">Add to Home Screen</bdi>)</strong>.
                  </>
                ) : (
                  <>
                    1. Tap the <strong>Share</strong> button in Safari toolbar.<br />
                    2. Scroll down and tap <strong>Add to Home Screen</strong>.
                  </>
                )}
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs transition min-h-[44px]"
              >
                {isRTL ? 'فهمت ذلك' : 'Got it'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed top-2 inset-x-4 z-50 mx-auto max-w-md bg-[var(--color-warning)] text-[#1C1A17] text-xs font-semibold px-3 py-2 rounded-lg flex items-center justify-center gap-2 shadow-md">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>وضع عدم الاتصال — بياناتك محفوظة محلياً وتعمل بدون إنترنت</span>
    </div>
  );
};
