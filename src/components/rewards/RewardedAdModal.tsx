import React, { useEffect, useState } from 'react';
import {
  X,
  PlayCircle,
  ExternalLink,
  Clock,
  CheckCircle2,
  ShieldCheck,
  Coins,
  AlertCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useOrg } from '../../context/OrgContext';
import {
  AdConsentChoice,
  getAdConsentChoice,
  saveAdConsentChoice,
  subscribeAdConsentChanges,
} from '../common/AdConsentBanner';
import {
  ADSTERRA_SMARTLINK_URL,
  CREDITS_AD_COUNTDOWN_SECONDS,
  CREDITS_AD_REWARD,
  CREDITS_DAILY_AD_LIMIT,
  RewardedAdSession,
  getRewardedAdAvailability,
  shouldShowRaseediCreditsUi,
  startRewardedAdSession,
} from '../../services/raseediCredits';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';

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

  const [consentChoice, setConsentChoice] = useState<AdConsentChoice>(() => getAdConsentChoice());
  const [session, setSession] = useState<RewardedAdSession | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  useModalBackHandler(isRewardedAdModalOpen, () => setIsRewardedAdModalOpen(false), 'rewarded-ad-modal');

  useEffect(() => {
    return subscribeAdConsentChanges(() => {
      setConsentChoice(getAdConsentChoice());
    });
  }, []);

  // Reset modal transient state whenever opened/closed
  useEffect(() => {
    if (isRewardedAdModalOpen) {
      setNowMs(Date.now());
      setSession(null);
      setClaimSuccess(false);
      setStatusError(null);
      setConsentChoice(getAdConsentChoice());
    }
  }, [isRewardedAdModalOpen]);

  // 250ms smooth tick while countdown or cooldown is active
  const availability = getRewardedAdAvailability(creditsState, nowMs);
  const isCountingDown = Boolean(session && !session.claimed && nowMs < session.readyAtMs);
  const isCoolingDown = !session && !availability.canWatch && availability.reason === 'cooldown';

  useEffect(() => {
    if (!isRewardedAdModalOpen) return;
    if (!isCountingDown && !isCoolingDown) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRewardedAdModalOpen, isCountingDown, isCoolingDown]);

  if (!isRewardedAdModalOpen || !canShowCredits) {
    return null;
  }

  const remainingCountdownMs = session ? Math.max(0, session.readyAtMs - nowMs) : 0;
  const remainingSeconds = Math.ceil(remainingCountdownMs / 1000);
  const countdownProgress = session
    ? Math.min(
        100,
        Math.max(
          0,
          ((CREDITS_AD_COUNTDOWN_SECONDS * 1000 - remainingCountdownMs) /
            (CREDITS_AD_COUNTDOWN_SECONDS * 1000)) *
            100
        )
      )
    : 0;
  const isReadyToClaim = Boolean(session && !session.claimed && remainingCountdownMs <= 0);
  const hasConsent = consentChoice === 'granted';

  const handleStartWatch = () => {
    setStatusError(null);
    const currentNow = Date.now();
    setNowMs(currentNow);
    const started = startRewardedAdSession(creditsState, currentNow);
    if (started.ok === false) {
      if (started.reason === 'daily_limit') {
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
  };

  const handleClaim = () => {
    if (!session || session.claimed) return;
    const result = claimRewardedAdCredits(session);
    if (result.ok === true) {
      setSession({ ...session, claimed: true });
      setClaimSuccess(true);
      setStatusError(null);
      setNowMs(Date.now());
    } else if (result.reason === 'countdown_incomplete') {
      setStatusError(
        isRTL
          ? 'يرجى الانتظار حتى اكتمال العدّاد (10 ثوانٍ).'
          : 'Please wait until the 10-second countdown completes.'
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
          {!hasConsent ? (
            <div className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-gold)]/40 space-y-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-[var(--color-accent)] shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-xs font-bold text-[var(--color-ink)]">
                    {isRTL ? 'موافقة الخصوصية مطلوبة أولاً' : 'Privacy Consent Required First'}
                  </div>
                  <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                    {isRTL
                      ? 'لا نفتح رابط الإعلان أبداً دون موافقتك الصريحة على تفضيلات الإعلانات. بياناتك المالية في «رصيدي» تبقى خاصة تماماً.'
                      : 'We never open the ad link without your explicit ad consent. Your Raseedi financial data remains strictly private.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => saveAdConsentChoice('granted')}
                className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold hover:opacity-95 transition-opacity min-h-[44px]"
              >
                {isRTL ? 'الموافقة والمتابعة لمشاهدة الإعلان' : 'Accept Ad Preferences & Continue'}
              </button>
            </div>
          ) : claimSuccess ? (
            <div className="py-3 text-center space-y-3" data-testid="rewarded-ad-claimed-state">
              <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent)]/12 border border-[var(--color-accent)]/30 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-[var(--color-accent)]" />
              </div>
              <div className="space-y-1">
                <h4 className="font-title text-sm font-bold text-[var(--color-ink)]">
                  {isRTL ? `تمت إضافة +${CREDITS_AD_REWARD} نقاط إلى رصيدك 🪙` : `+${CREDITS_AD_REWARD} Credits Added 🪙`}
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
            <div className="space-y-4">
              {/* Countdown card */}
              <div className="p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-center space-y-3">
                <div className="flex items-center justify-center gap-2 text-xs font-bold text-[var(--color-ink)]">
                  <Clock className="w-4 h-4 text-[var(--color-gold-text)]" />
                  <span>
                    {isReadyToClaim
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
                    className="h-full rounded-full bg-gradient-to-l from-[var(--color-gold)] to-[var(--color-accent)] transition-all duration-200"
                    style={{ width: `${countdownProgress}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)]">
                  <span>{isRTL ? 'المدة المطلوبة: 10 ثوانٍ' : 'Required: 10 seconds'}</span>
                  <span className="font-bold num-tabular text-[var(--color-gold-text)]">
                    {isReadyToClaim ? '0s' : `${remainingSeconds}s`}
                  </span>
                </div>
              </div>

              {/* Claim button (strictly disabled until 10s complete) */}
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
                  {isReadyToClaim
                    ? isRTL
                      ? `استلام +${CREDITS_AD_REWARD} نقاط 🪙`
                      : `Claim +${CREDITS_AD_REWARD} Credits 🪙`
                    : isRTL
                    ? `استلام +${CREDITS_AD_REWARD} نقاط (${remainingSeconds}ث)`
                    : `Claim +${CREDITS_AD_REWARD} Credits (${remainingSeconds}s)`}
                </span>
              </button>

              {/* Re-open link fallback if popup blocked */}
              <div className="text-center">
                <a
                  href={ADSTERRA_SMARTLINK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-accent)] hover:underline py-1"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isRTL
                      ? 'لم تفتح صفحة الإعلان؟ اضغط لإعادة فتحها'
                      : "Ad tab didn't open? Tap to reopen"}
                  </span>
                </a>
              </div>
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
                      ? 'ينطلق عدّاد 10 ثوانٍ داخل «رصيدي»، وبعد انتهائه تستلم +10 نقاط فوراً.'
                      : 'A 10-second timer runs inside Raseedi; once done, claim +10 credits instantly.'}
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
                  data-testid="start-rewarded-ad-link"
                  className="w-full py-3 px-4 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-2 shadow-sm hover:opacity-95 transition-opacity min-h-[46px]"
                >
                  <PlayCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {isRTL
                      ? `شاهد إعلاناً للحصول على +${CREDITS_AD_REWARD} نقاط`
                      : `Watch Ad to Earn +${CREDITS_AD_REWARD} Credits`}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-85" />
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
            <div className="p-2.5 rounded-xl bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 text-[11px] font-medium text-[var(--color-expense)]">
              {statusError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
