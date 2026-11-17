import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, PlusSquare, Share2, WifiOff, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  getPWAInstallSnapshot,
  initPWAInstallCapture,
  subscribePWAInstall,
  triggerPWAInstall,
} from '../../services/pwaInstallStore';
import { canShowDirectInstallButton } from '../../services/pwaInstallLogic';

export function usePWAInstall() {
  const [snapshot, setSnapshot] = useState(() => getPWAInstallSnapshot());

  useEffect(() => {
    initPWAInstallCapture();
    setSnapshot(getPWAInstallSnapshot());
    return subscribePWAInstall(() => {
      setSnapshot(getPWAInstallSnapshot());
    });
  }, []);

  const install = async () => {
    const outcome = await triggerPWAInstall();
    return outcome === 'accepted';
  };

  return {
    isInstallable: snapshot.isInstallable,
    isInstalled: snapshot.isInstalled,
    isIOS: snapshot.isIOS,
    actionKind: snapshot.actionKind,
    install,
  };
}

export const IOSInstallGuideModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const { isRTL } = useApp();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]"
      onClick={onClose}
      data-testid="ios-install-guide-modal"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[var(--color-accent)]/12 text-[var(--color-accent)] flex items-center justify-center shrink-0">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--color-ink)]">
                {isRTL ? (
                  <>
                    تثبيت التطبيق على <bdi dir="ltr">iPhone / iPad</bdi>
                  </>
                ) : (
                  'Install Raseedi on iOS'
                )}
              </h3>
              <p className="text-[11px] text-[var(--color-muted)]">
                {isRTL ? 'خطوتان سريعتان من متصفح Safari' : 'Two quick steps from Safari'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-bg)] min-h-[36px] min-w-[36px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <ol className="space-y-2.5 text-xs text-[var(--color-ink)]">
          <li className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
            <span className="w-5 h-5 rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-bold flex items-center justify-center shrink-0">
              1
            </span>
            <div className="leading-relaxed">
              {isRTL ? (
                <>
                  اضغط على أيقونة <strong>المشاركة</strong>{' '}
                  <span dir="ltr" className="inline-flex items-center gap-1 font-semibold">
                    (Share) <Share2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                  </span>{' '}
                  في شريط متصفح <bdi dir="ltr">Safari</bdi>
                </>
              ) : (
                <>
                  Tap the <strong>Share</strong> icon{' '}
                  <Share2 className="inline w-3.5 h-3.5 text-[var(--color-accent)] align-text-bottom" /> in the Safari browser bar.
                </>
              )}
            </div>
          </li>

          <li className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
            <span className="w-5 h-5 rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-bold flex items-center justify-center shrink-0">
              2
            </span>
            <div className="leading-relaxed">
              {isRTL ? (
                <>
                  مرر للأسفل واختر <strong>إضافة إلى الشاشة الرئيسية</strong>{' '}
                  <span dir="ltr" className="inline-flex items-center gap-1 font-semibold">
                    (Add to Home Screen) <PlusSquare className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                  </span>
                </>
              ) : (
                <>
                  Scroll down and tap <strong>Add to Home Screen</strong>{' '}
                  <PlusSquare className="inline w-3.5 h-3.5 text-[var(--color-accent)] align-text-bottom" />.
                </>
              )}
            </div>
          </li>
        </ol>

        <button
          type="button"
          onClick={onClose}
          data-testid="ios-install-guide-close"
          className="w-full py-2.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-semibold rounded-xl text-xs transition min-h-[44px]"
        >
          {isRTL ? 'فهمت ذلك' : 'Got it'}
        </button>
      </div>
    </div>
  );
};

export const DirectPWAInstallButton: React.FC<{
  variant: 'auth' | 'menu';
}> = ({ variant }) => {
  const {
    t,
    isRTL,
    canInstallPWA,
    isPWAInstalled,
    isIOSDevice,
    promptPWAInstall,
    showToast,
  } = useApp();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const shouldShow = canShowDirectInstallButton({
    isInstalled: isPWAInstalled,
    hasDeferredPrompt: canInstallPWA,
    isIOS: isIOSDevice,
  });

  if (!shouldShow) {
    return null;
  }

  const handleInstallClick = async () => {
    if (canInstallPWA) {
      const accepted = await promptPWAInstall();
      if (accepted) {
        showToast(
          isRTL ? 'تم تثبيت تطبيق رَصِيدِي على جهازك بنجاح' : 'Raseedi installed on your device',
          'success'
        );
      }
      return;
    }

    if (isIOSDevice) {
      setShowIOSGuide(true);
    }
  };

  const ArrowIcon = isRTL ? ChevronLeft : ChevronRight;
  const Icon = canInstallPWA ? Download : Share2;

  if (variant === 'auth') {
    return (
      <>
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          data-testid="direct-pwa-install-btn-auth"
          className="w-full py-2.5 px-4 rounded-xl bg-[var(--color-accent)]/8 hover:bg-[var(--color-accent)]/14 border border-[var(--color-accent)]/35 text-[var(--color-ink)] font-semibold text-xs flex items-center justify-center gap-2 transition-colors min-h-[44px]"
        >
          <Icon className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
          <span>{t('installApp')}</span>
        </button>
        <IOSInstallGuideModal isOpen={showIOSGuide} onClose={() => setShowIOSGuide(false)} />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleInstallClick()}
        data-testid="direct-pwa-install-btn-menu"
        className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
          <div>
            <div className="font-semibold text-[var(--color-ink)]">{t('installApp')}</div>
            <div className="text-[11px] text-[var(--color-muted)]">
              {canInstallPWA
                ? isRTL
                  ? 'تثبيت رَصِيدِي كتطبيق مستقل للوصول السريع'
                  : 'Install Raseedi as a standalone app for quick access'
                : isRTL
                ? 'طريقة التثبيت عبر زر المشاركة في متصفح Safari'
                : 'Install via Safari Share → Add to Home Screen'}
            </div>
          </div>
        </div>
        <ArrowIcon className="w-4 h-4 text-[var(--color-muted)] shrink-0" />
      </button>
      <IOSInstallGuideModal isOpen={showIOSGuide} onClose={() => setShowIOSGuide(false)} />
    </>
  );
};

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
            type="button"
            onClick={() => void install()}
            className="px-3 py-1.5 bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] text-xs font-semibold rounded-lg transition min-h-[36px]"
          >
            {isRTL ? 'تثبيت' : 'Install'}
          </button>
          <button
            type="button"
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
              {t('installApp')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            className="px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] border border-[var(--color-accent)]/40 rounded-lg hover:bg-[var(--color-accent)]/10 min-h-[36px]"
          >
            {isRTL ? 'طريقة التثبيت' : 'How to install'}
          </button>
        </div>

        <IOSInstallGuideModal isOpen={showIOSGuide} onClose={() => setShowIOSGuide(false)} />
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setIsDismissed(false);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setIsDismissed(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isOnline || isDismissed) return;
    const timer = window.setTimeout(() => {
      setIsDismissed(true);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [isOnline, isDismissed]);

  if (isOnline || isDismissed) return null;

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="relative w-full bg-[var(--color-warning)]/95 text-[#1C1A17] text-[11px] font-medium px-3 py-1 border-b border-black/10 flex items-center justify-between gap-2"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">
          وضع عدم الاتصال — بياناتك محفوظة محلياً وتعمل بدون إنترنت
        </span>
      </div>
      <button
        type="button"
        onClick={() => setIsDismissed(true)}
        data-testid="offline-banner-dismiss"
        aria-label="إغلاق تنبيه وضع عدم الاتصال"
        className="p-0.5 rounded hover:bg-black/10 text-[#1C1A17] shrink-0 flex items-center justify-center"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
