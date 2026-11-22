import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  PlayCircle,
  ExternalLink,
  Clock,
  CheckCircle2,
  Coins,
  AlertCircle,
  WifiOff,
  PauseCircle,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useOrg } from '../../context/OrgContext';
import {
  ADSTERRA_SMARTLINK_URL,
  CREDITS_AD_COUNTDOWN_MS,
  CREDITS_AD_REWARD,
  CREDITS_DAILY_AD_LIMIT,
  RewardedAdSession,
  advanceRewardedAdSession,
  getRewardedAdAvailability,
  getRewardedAdRemainingMs,
  recordRewardedAdOpenAttempt,
  shouldShowRaseediCreditsUi,
  startRewardedAdSession,
} from '../../services/raseediCredits';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';

function readInitialWindowFocus(): boolean {
  if (typeof document === 'undefined') return true;
  const visible = !document.hidden;
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  return visible && focused;
}

function readIsOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

export const RewardedAdModal: React.FC = () => {
  const {
    isRewardedAdModalOpen,
    setIsRewardedAdModalOpen,
    subscriptionSummary,
    creditsState,
    claimRewardedAdCredits,
    isRTL,
  } = useApp();
  const { activeOrgSubscriptionState } = useOrg();

  const canShowCredits = shouldShowRaseediCreditsUi(subscriptionSummary, {
    activeOrgSubscriptionState,
  });

  const [session, setSession] = useState<RewardedAdSession | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isOnline, setIsOnline] = useState<boolean>(() => readIsOnline());
  const [isVisibleAndFocused, setIsVisibleAndFocused] = useState<boolean>(() =>
    readInitialWindowFocus()
  );
  const [showReopenHint, setShowReopenHint] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const isWindowFocusedRef = useRef<boolean>(readInitialWindowFocus());
  const lastTickAtRef = useRef<number>(Date.now());
  const tabLeftAfterOpenRef = useRef<boolean>(false);
  const openHintTimerRef = useRef<number | null>(null);

  const readCurrentForegroundActive = () => {
    const visible = typeof document === 'undefined' ? true : !document.hidden;
    return visible && isWindowFocusedRef.current;
  };

  useModalBackHandler(
    isRewardedAdModalOpen,
    () => setIsRewardedAdModalOpen(false),
    'rewarded-ad-modal'
  );

  // Track visibility, focus, and network connectivity in real time
  useEffect(() => {
    if (!isRewardedAdModalOpen) return;

    const syncVisibilityChange = () => {
      const visible = typeof document === 'undefined' ? true : !document.hidden;
      if (!visible) {
        tabLeftAfterOpenRef.current = true;
        setShowReopenHint(false);
      } else {
        // Returning to a visible tab resumes cleanly
        isWindowFocusedRef.current = true;
        lastTickAtRef.current = Date.now();
      }
      const active = visible && isWindowFocusedRef.current;
      setIsVisibleAndFocused(active);
      setSession((prev) => {
        if (!prev || prev.claimed) return prev;
        return advanceRewardedAdSession(prev, {
          deltaMs: 0,
          isVisibleAndFocused: active,
          isOnline: readIsOnline(),
        });
      });
    };

    const handleBlur = () => {
      isWindowFocusedRef.current = false;
      tabLeftAfterOpenRef.current = true;
      setShowReopenHint(false);
      setIsVisibleAndFocused(false);
      setSession((prev) => {
        if (!prev || prev.claimed) return prev;
        return advanceRewardedAdSession(prev, {
          deltaMs: 0,
          isVisibleAndFocused: false,
          isOnline: readIsOnline(),
        });
      });
    };

    const handleFocus = () => {
      isWindowFocusedRef.current = true;
      const visible = typeof document === 'undefined' ? true : !document.hidden;
      lastTickAtRef.current = Date.now();
      setIsVisibleAndFocused(visible);
      setSession((prev) => {
        if (!prev || prev.claimed) return prev;
        return advanceRewardedAdSession(prev, {
          deltaMs: 0,
          isVisibleAndFocused: visible,
          isOnline: readIsOnline(),
        });
      });
    };

    const handleOnline = () => {
      lastTickAtRef.current = Date.now();
      setIsOnline(true);
      setStatusError((prev) => (prev ? null : prev));
      setSession((prev) => {
        if (!prev || prev.claimed) return prev;
        return advanceRewardedAdSession(prev, {
          deltaMs: 0,
          isVisibleAndFocused: readCurrentForegroundActive(),
          isOnline: true,
        });
      });
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSession((prev) => {
        if (!prev || prev.claimed) return prev;
        return advanceRewardedAdSession(prev, {
          deltaMs: 0,
          isVisibleAndFocused: readCurrentForegroundActive(),
          isOnline: false,
        });
      });
    };

    document.addEventListener('visibilitychange', syncVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      document.removeEventListener('visibilitychange', syncVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isRewardedAdModalOpen]);

  // Reset modal transient state whenever opened/closed
  useEffect(() => {
    if (openHintTimerRef.current !== null) {
      window.clearTimeout(openHintTimerRef.current);
      openHintTimerRef.current = null;
    }
    if (isRewardedAdModalOpen) {
      const now = Date.now();
      const initialActive = readInitialWindowFocus();
      isWindowFocusedRef.current = initialActive;
      lastTickAtRef.current = now;
      tabLeftAfterOpenRef.current = false;
      setNowMs(now);
      setSession(null);
      setClaimSuccess(false);
      setStatusError(null);
      setShowReopenHint(false);
      setIsOnline(readIsOnline());
      setIsVisibleAndFocused(initialActive);
    }
  }, [isRewardedAdModalOpen]);

  const availability = getRewardedAdAvailability(creditsState, nowMs);
  const remainingCountdownMs = getRewardedAdRemainingMs(session);
  const isCountingDown = Boolean(session && !session.claimed && remainingCountdownMs > 0);
  const isCoolingDown = !session && !availability.canWatch && availability.reason === 'cooldown';

  // Active-only 250ms tick (automatically pauses while hidden, unfocused, or offline)
  useEffect(() => {
    if (!isRewardedAdModalOpen) return;
    if (!isCountingDown && !isCoolingDown) return;

    lastTickAtRef.current = Date.now();
    const timer = window.setInterval(() => {
      const currentNow = Date.now();
      const deltaMs = Math.max(0, currentNow - lastTickAtRef.current);
      lastTickAtRef.current = currentNow;
      setNowMs(currentNow);

      const onlineNow = readIsOnline();
      const activeNow = readCurrentForegroundActive();
      setIsOnline(onlineNow);
      setIsVisibleAndFocused(activeNow);

      setSession((prev) => {
        if (!prev || prev.claimed) return prev;
        return advanceRewardedAdSession(prev, {
          deltaMs,
          isVisibleAndFocused: activeNow,
          isOnline: onlineNow,
        });
      });
    }, 250);

    return () => window.clearInterval(timer);
  }, [isRewardedAdModalOpen, isCountingDown, isCoolingDown]);

  if (!isRewardedAdModalOpen || !canShowCredits) {
    return null;
  }

  const remainingSeconds = Math.ceil(remainingCountdownMs / 1000);
  const countdownProgress = session
    ? Math.min(
        100,
        Math.max(
          0,
          ((CREDITS_AD_COUNTDOWN_MS - remainingCountdownMs) / CREDITS_AD_COUNTDOWN_MS) * 100
        )
      )
    : 0;

  const effectivePauseReason = !isOnline
    ? 'offline'
    : session && !session.openAttempted
    ? 'open_blocked'
    : session && (!isVisibleAndFocused || session.pauseReason === 'background') && remainingCountdownMs > 0
    ? 'background'
    : session?.pauseReason ?? 'none';

  const isReadyToClaim = Boolean(
    session &&
      !session.claimed &&
      session.openAttempted &&
      remainingCountdownMs <= 0 &&
      isOnline
  );

  const scheduleReopenFallbackHint = () => {
    if (openHintTimerRef.current !== null) {
      window.clearTimeout(openHintTimerRef.current);
    }
    tabLeftAfterOpenRef.current = false;
    setShowReopenHint(false);
    openHintTimerRef.current = window.setTimeout(() => {
      if (!tabLeftAfterOpenRef.current) {
        setShowReopenHint(true);
      }
      openHintTimerRef.current = null;
    }, 1200);
  };

  const handleStartWatch = (e: React.MouseEvent<HTMLAnchorElement>) => {
    setStatusError(null);
    const onlineNow = readIsOnline();
    setIsOnline(onlineNow);

    if (!onlineNow) {
      e.preventDefault();
      setStatusError(
        isRTL
          ? 'الاتصال بالإنترنت مطلوب لفتح رابط الإعلان وبدء التحقق واستلام النقاط.'
          : 'An active internet connection is required to open the ad and earn credits.'
      );
      return;
    }

    const currentNow = Date.now();
    lastTickAtRef.current = currentNow;
    setNowMs(currentNow);
    const started = startRewardedAdSession(creditsState, currentNow, {
      isOnline: onlineNow,
      openAttempted: true,
    });
    if (started.ok === false) {
      e.preventDefault();
      if (started.reason === 'offline') {
        setStatusError(
          isRTL
            ? 'الاتصال بالإنترنت مطلوب لفتح رابط الإعلان واستلام النقاط.'
            : 'An active internet connection is required to watch rewarded ads.'
        );
      } else if (started.reason === 'daily_limit') {
        setStatusError(
          isRTL
            ? `وصلت للحد الأقصى اليومي (${CREDITS_DAILY_AD_LIMIT} إعلانات). يعود العداد تلقائياً غداً.`
            : `Daily limit reached (${CREDITS_DAILY_AD_LIMIT} ads/day). Resets automatically tomorrow.`
        );
      } else {
        setStatusError(
          isRTL
            ? `يرجى الانتظار ${started.availability.cooldownRemainingSeconds} ثانية قبل الإعلان التالي.`
            : `Please wait ${started.availability.cooldownRemainingSeconds}s before watching another ad.`
        );
      }
      return;
    }

    setSession(started.session);
    scheduleReopenFallbackHint();
  };

  const handleReopenSmartlink = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const onlineNow = readIsOnline();
    setIsOnline(onlineNow);
    if (!onlineNow) {
      e.preventDefault();
      setStatusError(
        isRTL
          ? 'انقطع الاتصال بالإنترنت — يرجى الاتصال أولاً لإعادة فتح رابط الإعلان.'
          : 'You are offline — reconnect to the internet to reopen the ad link.'
      );
      return;
    }
    setStatusError(null);
    lastTickAtRef.current = Date.now();
    setSession((prev) =>
      prev ? recordRewardedAdOpenAttempt(prev, { succeeded: true, isOnline: true }) : prev
    );
    scheduleReopenFallbackHint();
  };

  const handleClaim = () => {
    if (!session || session.claimed) return;
    const onlineNow = readIsOnline();
    setIsOnline(onlineNow);

    const result = claimRewardedAdCredits(session, { isOnline: onlineNow });
    if (result.ok === true) {
      setSession({ ...session, claimed: true });
      setClaimSuccess(true);
      setStatusError(null);
      setNowMs(Date.now());
    } else if (result.reason === 'offline') {
      setStatusError(
        isRTL
          ? 'الاتصال بالإنترنت مطلوب لاستلام النقاط. أعد الاتصال ثم اضغط استلام.'
          : 'An internet connection is required to claim credits. Reconnect and try again.'
      );
    } else if (result.reason === 'open_not_verified') {
      setStatusError(
        isRTL
          ? 'يرجى فتح رابط الإعلان أولاً عبر زر «إعادة فتح رابط الإعلان» ثم إكمال العدّاد.'
          : 'Please open the ad link first using "Reopen Ad Link" before claiming.'
      );
    } else if (result.reason === 'countdown_incomplete') {
      setStatusError(
        isRTL
          ? 'يرجى البقاء في التطبيق حتى اكتمال العدّاد (10 ثوانٍ).'
          : 'Please stay in the app until the 10-second countdown completes.'
      );
    } else if (result.reason === 'daily_limit') {
      setStatusError(
        isRTL
          ? `وصلت للحد الأقصى اليومي (${CREDITS_DAILY_AD_LIMIT} إعلانات).`
          : `Daily limit (${CREDITS_DAILY_AD_LIMIT} ads) reached.`
      );
    } else if (result.reason === 'cooldown') {
      setStatusError(
        isRTL
          ? 'فترة التهدئة بين الإعلانات لا تزال نشطة (60 ثانية).'
          : 'Cooldown period (60s) is still active.'
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
      role="dialog"
      aria-modal="true"
      aria-label={isRTL ? 'إعلان مكافأة نقاط رصيدي' : 'Raseedi Credits Rewarded Ad'}
      data-testid="rewarded-ad-modal"
    >
      <div className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] border border-[var(--color-gold)]/45 shadow-2xl overflow-hidden text-[var(--color-ink)]">
        {/* Header */}
        <div className="px-4 py-3.5 bg-[var(--color-bg)] border-b border-[var(--color-line)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/35 flex items-center justify-center shrink-0">
              <Coins className="w-4 h-4 text-[var(--color-gold-text)]" />
            </span>
            <div className="min-w-0">
              <h3 className="font-title text-sm font-bold text-[var(--color-ink)] truncate">
                {isRTL ? 'شاهد إعلاناً واحصل على +10 نقاط 🪙' : 'Watch an Ad for +10 Credits 🪙'}
              </h3>
              <p className="text-[11px] text-[var(--color-muted)]">
                {isRTL
                  ? `المشاهدات اليوم: ${availability.watchedToday} / ${availability.dailyLimit}`
                  : `Today's views: ${availability.watchedToday} / ${availability.dailyLimit}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsRewardedAdModalOpen(false)}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Global Offline Warning inside Modal */}
          {!isOnline && !claimSuccess && (
            <div
              role="alert"
              data-testid="rewarded-ad-offline-banner"
              className="p-3 rounded-xl bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/35 text-[var(--color-expense)] text-xs flex items-start gap-2"
            >
              <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-bold">
                  {isRTL ? 'لا يوجد اتصال بالإنترنت' : 'No Internet Connection'}
                </p>
                <p className="text-[11px] leading-relaxed">
                  {isRTL
                    ? 'الاتصال بالإنترنت مطلوب لفتح الإعلان وإكمال التحقق واستلام النقاط. سيعود العدّاد للعمل تلقائياً عند عودة الاتصال.'
                    : 'An active internet connection is required to verify the ad and claim credits. Countdown resumes automatically when online.'}
                </p>
              </div>
            </div>
          )}

          {claimSuccess ? (
            <div className="py-3 text-center space-y-3" data-testid="rewarded-ad-claimed-state">
              <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent)]/12 border border-[var(--color-accent)]/30 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-[var(--color-accent)]" />
              </div>
              <div className="space-y-1">
                <h4 className="font-title text-sm font-bold text-[var(--color-ink)]">
                  {isRTL
                    ? `تمت إضافة +${CREDITS_AD_REWARD} نقاط إلى رصيدك 🪙`
                    : `+${CREDITS_AD_REWARD} Credits Added 🪙`}
                </h4>
                <p className="text-xs text-[var(--color-muted)]">
                  {isRTL
                    ? `رصيدك الحالي الآن ${creditsState.balance} نقطة • المتبقي اليوم ${availability.remainingToday} من ${availability.dailyLimit}`
                    : `Current balance: ${creditsState.balance} credits • ${availability.remainingToday}/${availability.dailyLimit} left today`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRewardedAdModalOpen(false)}
                className="w-full py-2.5 px-4 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px]"
              >
                {isRTL ? 'تم — العودة إلى رصيدي' : 'Done — Return to Raseedi'}
              </button>
            </div>
          ) : session ? (
            <div className="space-y-3.5">
              {/* Background / Blur Pause Banner */}
              {effectivePauseReason === 'background' && remainingCountdownMs > 0 && (
                <div
                  role="status"
                  data-testid="rewarded-ad-paused-banner"
                  className="p-3 rounded-xl bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/45 text-[var(--color-ink)] text-xs flex items-center gap-2.5"
                >
                  <PauseCircle className="w-4 h-4 text-[var(--color-gold-text)] shrink-0" />
                  <span className="font-semibold">
                    {isRTL
                      ? 'العدّاد متوقف مؤقتاً — عد للتطبيق لإكمال التحقق'
                      : 'Countdown paused — return to the app to complete verification'}
                  </span>
                </div>
              )}

              {/* Countdown card */}
              <div
                data-testid="rewarded-ad-countdown-card"
                data-pause-reason={effectivePauseReason}
                className="p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-center space-y-3"
              >
                <div className="flex items-center justify-center gap-2 text-xs font-bold text-[var(--color-ink)]">
                  {effectivePauseReason === 'offline' ? (
                    <WifiOff className="w-4 h-4 text-[var(--color-expense)] shrink-0" />
                  ) : effectivePauseReason === 'background' ? (
                    <PauseCircle className="w-4 h-4 text-[var(--color-gold-text)] shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-[var(--color-gold-text)] shrink-0" />
                  )}
                  <span>
                    {effectivePauseReason === 'offline'
                      ? isRTL
                        ? 'العدّاد متوقف مؤقتاً — بانتظار عودة الإنترنت'
                        : 'Paused — waiting for internet connection'
                      : effectivePauseReason === 'background' && remainingCountdownMs > 0
                      ? isRTL
                        ? 'عد للتطبيق لإكمال التحقق'
                        : 'Return to the app to complete verification'
                      : effectivePauseReason === 'open_blocked'
                      ? isRTL
                        ? 'افتح رابط الإعلان أولاً لبدء التحقق'
                        : 'Open the ad link first to start verification'
                      : isReadyToClaim
                      ? isRTL
                        ? 'اكتمل العدّاد! يمكنك استلام مكافأتك الآن'
                        : 'Countdown complete! Claim your reward now'
                      : isRTL
                      ? `جارٍ التحقق... انتظر ${remainingSeconds} ثانية`
                      : `Verifying view... ${remainingSeconds}s remaining`}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2.5 rounded-full bg-[var(--color-surface-subtle)] overflow-hidden border border-[var(--color-line)]">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${
                      effectivePauseReason === 'offline'
                        ? 'bg-[var(--color-expense)]/70'
                        : 'bg-gradient-to-l from-[var(--color-gold)] to-[var(--color-accent)]'
                    }`}
                    style={{ width: `${countdownProgress}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)]">
                  <span>
                    {isRTL ? 'المدة المطلوبة داخل التطبيق: 10 ثوانٍ' : 'Active in-app time: 10s'}
                  </span>
                  <span
                    data-testid="rewarded-ad-remaining-seconds"
                    className="font-bold num-tabular text-[var(--color-gold-text)]"
                  >
                    {remainingCountdownMs <= 0 ? '0s' : `${remainingSeconds}s`}
                  </span>
                </div>
              </div>

              {/* Claim button (strictly disabled until 10s active countdown + openAttempted + online) */}
              <button
                type="button"
                disabled={!isReadyToClaim}
                onClick={handleClaim}
                data-testid="claim-rewarded-ad-btn"
                className={`w-full py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 min-h-[46px] transition-all ${
                  isReadyToClaim
                    ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-md hover:opacity-95'
                    : 'bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] cursor-not-allowed opacity-75'
                }`}
              >
                <Coins className="w-4 h-4 shrink-0" />
                <span>
                  {!isOnline
                    ? isRTL
                      ? 'الاتصال بالإنترنت مطلوب للاستلام'
                      : 'Internet Required to Claim'
                    : isReadyToClaim
                    ? isRTL
                      ? `استلام +${CREDITS_AD_REWARD} نقاط 🪙`
                      : `Claim +${CREDITS_AD_REWARD} Credits 🪙`
                    : isRTL
                    ? `استلام +${CREDITS_AD_REWARD} نقاط (${remainingSeconds}ث)`
                    : `Claim +${CREDITS_AD_REWARD} Credits (${remainingSeconds}s)`}
                </span>
              </button>

              {/* Smartlink Blocked / Re-open Fallback */}
              {showReopenHint || !session.openAttempted ? (
                <div
                  data-testid="smartlink-reopen-box"
                  className="p-3 rounded-xl bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/40 space-y-2.5"
                >
                  <p className="text-[11px] text-[var(--color-ink)] leading-relaxed">
                    {isRTL
                      ? 'لم يفتح تبويب الإعلان أو تم حظره بواسطة المتصفح؟ اضغط الزر بالأسفل لإعادة فتح رابط الإعلان.'
                      : 'Ad tab blocked or failed to open? Tap below to reopen the ad link.'}
                  </p>
                  <a
                    href={ADSTERRA_SMARTLINK_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleReopenSmartlink}
                    data-testid="reopen-smartlink-btn"
                    className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-accent)] text-[var(--color-accent)] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[var(--color-accent)] hover:text-[var(--color-on-accent)] transition-colors min-h-[42px]"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>{isRTL ? 'إعادة فتح رابط الإعلان' : 'Reopen Ad Link'}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </a>
                </div>
              ) : (
                <div className="text-center">
                  <a
                    href={ADSTERRA_SMARTLINK_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleReopenSmartlink}
                    data-testid="reopen-smartlink-btn"
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-accent)] hover:underline py-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {isRTL
                        ? 'إعادة فتح رابط الإعلان'
                        : 'Reopen Ad Link'}
                    </span>
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2 text-xs text-[var(--color-muted)] leading-relaxed">
                <p className="font-semibold text-[var(--color-ink)]">
                  {isRTL ? 'كيف تعمل المكافأة؟' : 'How does this reward work?'}
                </p>
                <ul className="space-y-1 list-disc list-inside text-[11px]">
                  <li>
                    {isRTL
                      ? 'اضغط الزر بالأسفل لفتح الإعلان في تبويب آمن جديد.'
                      : 'Tap below to open the ad safely in a new tab.'}
                  </li>
                  <li>
                    {isRTL
                      ? 'عُد إلى «رصيدي» ليكتمل عدّاد 10 ثوانٍ بوجود اتصال بالإنترنت، ثم استلم +10 نقاط فوراً.'
                      : 'Return to Raseedi so the 10-second online timer completes, then claim +10 credits instantly.'}
                  </li>
                  <li>
                    {isRTL
                      ? 'الحد اليومي 5 مشاهدات مع فاصل 60 ثانية لحماية الحساب.'
                      : 'Up to 5 views/day with a 60-second cooldown between views.'}
                  </li>
                </ul>
              </div>

              {availability.canWatch ? (
                <a
                  href={ADSTERRA_SMARTLINK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleStartWatch}
                  aria-disabled={!isOnline}
                  data-testid="start-rewarded-ad-link"
                  className={`w-full py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-opacity min-h-[46px] ${
                    isOnline
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:opacity-95'
                      : 'bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] opacity-75'
                  }`}
                >
                  {isOnline ? (
                    <PlayCircle className="w-4 h-4 shrink-0" />
                  ) : (
                    <WifiOff className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    {!isOnline
                      ? isRTL
                        ? 'الاتصال بالإنترنت مطلوب للمشاهدة'
                        : 'Internet Connection Required'
                      : isRTL
                      ? `شاهد إعلاناً للحصول على +${CREDITS_AD_REWARD} نقاط`
                      : `Watch Ad to Earn +${CREDITS_AD_REWARD} Credits`}
                  </span>
                  {isOnline && <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-85" />}
                </a>
              ) : (
                <div
                  className="p-3 rounded-xl bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/35 flex items-center gap-2.5 text-xs text-[var(--color-ink)]"
                  data-testid="rewarded-ad-unavailable-notice"
                >
                  <AlertCircle className="w-4 h-4 text-[var(--color-gold-text)] shrink-0" />
                  <span>
                    {availability.reason === 'daily_limit'
                      ? isRTL
                        ? `أكملت الحد اليومي (${CREDITS_DAILY_AD_LIMIT}/${CREDITS_DAILY_AD_LIMIT} مشاهدات). عُد غداً لجمع المزيد من النقاط.`
                        : `You've reached today's limit (${CREDITS_DAILY_AD_LIMIT}/${CREDITS_DAILY_AD_LIMIT}). Come back tomorrow!`
                      : isRTL
                      ? `فترة التهدئة نشطة — يمكنك مشاهدة إعلان جديد خلال ${availability.cooldownRemainingSeconds} ثانية.`
                      : `Cooldown active — next rewarded ad available in ${availability.cooldownRemainingSeconds}s.`}
                  </span>
                </div>
              )}
            </div>
          )}

          {statusError && (
            <div
              role="alert"
              data-testid="rewarded-ad-error-banner"
              className="p-2.5 rounded-xl bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 text-[11px] font-medium text-[var(--color-expense)]"
            >
              {statusError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
