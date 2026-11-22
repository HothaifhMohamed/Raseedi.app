import React from 'react';
import { Coins, Flame, PlayCircle, Gift, Crown, Clock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useOrg } from '../../context/OrgContext';
import {
  CREDITS_AD_REWARD,
  CREDITS_PRO_PASS_GOAL,
  getRemainingPassTime,
  getRewardedAdAvailability,
  shouldShowRaseediCreditsUi,
} from '../../services/raseediCredits';

export const RaseediCreditsCard: React.FC = () => {
  const {
    subscriptionSummary,
    creditsState,
    creditsNowMs,
    hasActiveProPass,
    hasActiveAdFreePass,
    setIsCreditsModalOpen,
    setIsRewardedAdModalOpen,
    isRTL,
  } = useApp();
  const { activeOrgSubscriptionState } = useOrg();

  const canShowCredits = shouldShowRaseediCreditsUi(subscriptionSummary, {
    activeOrgSubscriptionState,
  });

  if (!canShowCredits) {
    return null;
  }

  const proGoalPercent = Math.min(
    100,
    Math.round((creditsState.balance / CREDITS_PRO_PASS_GOAL) * 100)
  );
  const adAvailability = getRewardedAdAvailability(creditsState, creditsNowMs);
  const proPassRemaining = getRemainingPassTime(creditsState.proPassUntilMs, creditsNowMs);
  const adFreeRemaining = getRemainingPassTime(creditsState.adFreeUntilMs, creditsNowMs);

  return (
    <section
      aria-label={isRTL ? 'نقاط رصيدي' : 'Raseedi Credits'}
      data-testid="more-raseedi-credits-card"
      className="shrink-0 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-gold)]/45 shadow-sm overflow-hidden transition-colors"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Subtle gold-petrol top header */}
      <div className="p-4 bg-gradient-to-l from-[var(--color-gold-soft)]/70 via-[var(--color-surface)] to-[var(--color-accent)]/8 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/40 flex items-center justify-center shrink-0">
              <Coins className="w-5 h-5 text-[var(--color-gold-text)]" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h2 className="font-title text-sm font-bold text-[var(--color-ink)]">
                  {isRTL ? 'نقاط رصيدي 🪙' : 'Raseedi Credits 🪙'}
                </h2>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/35 text-[10px] font-bold text-[var(--color-gold-text)]">
                  <Flame className="w-3 h-3 shrink-0" />
                  <span className="num-tabular">
                    {isRTL ? `${creditsState.streakCount} يوم` : `${creditsState.streakCount}d streak`}
                  </span>
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-muted)] mt-0.5">
                {isRTL
                  ? 'افتح مزايا PRO والتقارير والمسح الذكي مجاناً بالنقاط'
                  : 'Unlock PRO perks, reports & AI scans with credits'}
              </p>
            </div>
          </div>

          <div className="text-end shrink-0">
            <div
              className="text-lg font-extrabold text-[var(--color-ink)] num-tabular leading-tight"
              data-testid="credits-card-balance"
            >
              {creditsState.balance}
            </div>
            <div className="text-[10px] font-bold text-[var(--color-gold-text)]">
              {isRTL ? 'نقطة' : 'Credits'}
            </div>
          </div>
        </div>

        {/* Active 24h Pass Status Pill if running */}
        {(hasActiveProPass || hasActiveAdFreePass) && (
          <div className="flex flex-wrap gap-1.5">
            {hasActiveProPass && proPassRemaining.active && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/35 text-[11px] font-bold text-[var(--color-accent)]">
                <Crown className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isRTL
                    ? `تجربة PRO مفعّلة — متبقي ${proPassRemaining.hours}س ${proPassRemaining.minutes}د`
                    : `24h PRO Pass Active — ${proPassRemaining.hours}h ${proPassRemaining.minutes}m left`}
                </span>
              </span>
            )}
            {!hasActiveProPass && hasActiveAdFreePass && adFreeRemaining.active && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/40 text-[11px] font-bold text-[var(--color-gold-text)]">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isRTL
                    ? `وضع التركيز بدون إعلانات — متبقي ${adFreeRemaining.hours}س ${adFreeRemaining.minutes}د`
                    : `Ad-Free Focus Active — ${adFreeRemaining.hours}h ${adFreeRemaining.minutes}m left`}
                </span>
              </span>
            )}
          </div>
        )}

        {/* Progress bar toward Free 24h PRO Day (50 points) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--color-muted)] font-medium">
              {isRTL ? 'التقدم نحو يوم PRO مجاني' : 'Free 24h PRO Day Progress'}
            </span>
            <span className="font-bold text-[var(--color-accent)] num-tabular">
              {Math.min(creditsState.balance, CREDITS_PRO_PASS_GOAL)} / {CREDITS_PRO_PASS_GOAL}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--color-bg)] border border-[var(--color-line)] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-l from-[var(--color-gold)] to-[var(--color-accent)] transition-all duration-300"
              style={{ width: `${proGoalPercent}%` }}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => setIsRewardedAdModalOpen(true)}
            data-testid="credits-card-watch-ad-btn"
            className="py-2.5 px-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity min-h-[42px]"
          >
            <PlayCircle className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {adAvailability.canWatch
                ? isRTL
                  ? `شاهد إعلاناً (+${CREDITS_AD_REWARD})`
                  : `Watch Ad (+${CREDITS_AD_REWARD})`
                : isRTL
                ? `إعلان (+${CREDITS_AD_REWARD})`
                : `Ad (+${CREDITS_AD_REWARD})`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsCreditsModalOpen(true)}
            data-testid="credits-card-open-store-btn"
            className="py-2.5 px-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-gold)] text-[var(--color-ink)] text-xs font-bold flex items-center justify-center gap-1.5 transition-colors min-h-[42px]"
          >
            <Gift className="w-4 h-4 shrink-0 text-[var(--color-gold-text)]" />
            <span className="truncate">{isRTL ? 'متجر المكافآت' : 'Rewards Store'}</span>
          </button>
        </div>
      </div>
    </section>
  );
};
