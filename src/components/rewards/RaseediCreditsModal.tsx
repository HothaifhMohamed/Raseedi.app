import React, { useEffect, useState } from 'react';
import {
  X,
  Coins,
  Flame,
  PlayCircle,
  ScanLine,
  FileText,
  EyeOff,
  Crown,
  Clock,
  History,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useOrg } from '../../context/OrgContext';
import {
  CREDITS_AD_REWARD,
  CREDITS_PRO_PASS_GOAL,
  CREDITS_STREAK_3_DAYS,
  CREDITS_STREAK_3_REWARD,
  CREDITS_STREAK_7_DAYS,
  CREDITS_STREAK_7_REWARD,
  CREDIT_REDEMPTION_CATALOG,
  CreditRewardRedemptionId,
  getRemainingPassTime,
  getRewardedAdAvailability,
  shouldShowRaseediCreditsUi,
} from '../../services/raseediCredits';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';

export const RaseediCreditsModal: React.FC = () => {
  const {
    isCreditsModalOpen,
    setIsCreditsModalOpen,
    setIsRewardedAdModalOpen,
    setIsUpgradeModalOpen,
    subscriptionSummary,
    creditsState,
    creditsNowMs,
    hasActiveProPass,
    hasActiveAdFreePass,
    redeemCreditOption,
    isRTL,
  } = useApp();
  const { activeOrgSubscriptionState } = useOrg();

  const canShowCredits = shouldShowRaseediCreditsUi(subscriptionSummary, {
    activeOrgSubscriptionState,
  });

  const [tickNowMs, setTickNowMs] = useState<number>(() => Date.now());
  const [activeTab, setActiveTab] = useState<'store' | 'history'>('store');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useModalBackHandler(isCreditsModalOpen, () => setIsCreditsModalOpen(false), 'raseedi-credits-modal');

  useEffect(() => {
    if (!isCreditsModalOpen) return;
    setTickNowMs(Date.now());
    setFeedbackError(null);
    const interval = window.setInterval(() => setTickNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isCreditsModalOpen]);

  if (!isCreditsModalOpen || !canShowCredits) {
    return null;
  }

  const effectiveNow = Math.max(creditsNowMs, tickNowMs);
  const adAvailability = getRewardedAdAvailability(creditsState, effectiveNow);
  const proPassRemaining = getRemainingPassTime(creditsState.proPassUntilMs, effectiveNow);
  const adFreeRemaining = getRemainingPassTime(creditsState.adFreeUntilMs, effectiveNow);
  const proGoalPercent = Math.min(
    100,
    Math.round((creditsState.balance / CREDITS_PRO_PASS_GOAL) * 100)
  );
  const remainingToProGoal = Math.max(0, CREDITS_PRO_PASS_GOAL - creditsState.balance);

  const handleRedeem = (id: CreditRewardRedemptionId) => {
    setFeedbackError(null);
    const res = redeemCreditOption(id);
    if (res.ok === false) {
      setFeedbackError(
        isRTL
          ? `تحتاج ${res.needed} نقطة إضافية لتفعيل «${res.option.titleAr}». شاهد إعلاناً سريعاً لجمع +10 نقاط.`
          : `You need ${res.needed} more credits for "${res.option.titleEn}". Watch a quick ad for +10 credits.`
      );
    }
  };

  const renderRewardIcon = (id: CreditRewardRedemptionId) => {
    switch (id) {
      case 'ai_scans_2':
        return <ScanLine className="w-4 h-4 text-[var(--color-accent)]" />;
      case 'export_report_1':
        return <FileText className="w-4 h-4 text-[var(--color-accent)]" />;
      case 'ad_free_24h':
        return <EyeOff className="w-4 h-4 text-[var(--color-gold-text)]" />;
      case 'pro_pass_24h':
        return <Crown className="w-4 h-4 text-[var(--color-gold-text)]" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-xs p-3 sm:p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
      role="dialog"
      aria-modal="true"
      aria-label={isRTL ? 'نقاط رصيدي ومتجر المكافآت' : 'Raseedi Credits & Rewards Store'}
      data-testid="raseedi-credits-modal"
    >
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl bg-[var(--color-surface)] border border-[var(--color-gold)]/40 shadow-2xl overflow-hidden text-[var(--color-ink)]">
        {/* Header */}
        <div className="px-4 py-3.5 bg-[var(--color-bg)] border-b border-[var(--color-line)] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/40 flex items-center justify-center shrink-0">
              <Coins className="w-5 h-5 text-[var(--color-gold-text)]" />
            </span>
            <div className="min-w-0">
              <h2 className="font-title text-sm font-bold text-[var(--color-ink)] truncate">
                {isRTL ? 'نقاط رصيدي 🪙' : 'Raseedi Credits 🪙'}
              </h2>
              <p className="text-[11px] text-[var(--color-muted)] truncate">
                {isRTL
                  ? 'اجمع النقاط واستبدلها بمزايا PRO مجاناً'
                  : 'Earn credits and unlock PRO perks for free'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCreditsModalOpen(false)}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Balance & Free PRO Day Progress */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-[var(--color-accent)]/12 via-[var(--color-bg)] to-[var(--color-gold-soft)] border border-[var(--color-gold)]/35 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold text-[var(--color-muted)]">
                  {isRTL ? 'رصيدك الحالي' : 'Current Balance'}
                </div>
                <div
                  className="text-2xl font-extrabold text-[var(--color-ink)] num-tabular flex items-baseline gap-1.5 mt-0.5"
                  data-testid="credits-modal-balance"
                >
                  <span>{creditsState.balance}</span>
                  <span className="text-xs font-bold text-[var(--color-gold-text)]">
                    {isRTL ? 'نقطة 🪙' : 'Credits 🪙'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsRewardedAdModalOpen(true)}
                data-testid="credits-modal-watch-ad-btn"
                className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold shadow-sm hover:opacity-95 transition-opacity min-h-[42px]"
              >
                <PlayCircle className="w-4 h-4 shrink-0" />
                <span>
                  {isRTL ? `شاهد إعلاناً (+${CREDITS_AD_REWARD})` : `Watch Ad (+${CREDITS_AD_REWARD})`}
                </span>
              </button>
            </div>

            {/* Progress bar toward 24h PRO Pass (50 credits) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-[var(--color-ink)]">
                  {isRTL ? 'التقدم نحو يوم PRO مجاني (50 نقطة)' : 'Progress to Free 24h PRO Day (50)'}
                </span>
                <span className="font-bold num-tabular text-[var(--color-accent)]">
                  {Math.min(creditsState.balance, CREDITS_PRO_PASS_GOAL)} / {CREDITS_PRO_PASS_GOAL}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[var(--color-surface)] border border-[var(--color-line)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-[var(--color-gold)] to-[var(--color-accent)] transition-all duration-300"
                  style={{ width: `${proGoalPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-[var(--color-muted)]">
                <span>
                  {remainingToProGoal === 0
                    ? isRTL
                      ? 'جاهز لتفعيل بطاقة PRO لمدة 24 ساعة الآن!'
                      : 'Ready to activate your 24h PRO Pass now!'
                    : isRTL
                    ? `متبقي ${remainingToProGoal} نقطة ليوم PRO مجاني`
                    : `${remainingToProGoal} more credits for a free PRO day`}
                </span>
                <span>
                  {adAvailability.canWatch
                    ? isRTL
                      ? `متاح ${adAvailability.remainingToday}/${adAvailability.dailyLimit} اليوم`
                      : `${adAvailability.remainingToday}/${adAvailability.dailyLimit} ads left today`
                    : adAvailability.reason === 'cooldown'
                    ? isRTL
                      ? `تهدئة: ${adAvailability.cooldownRemainingSeconds}ث`
                      : `Cooldown: ${adAvailability.cooldownRemainingSeconds}s`
                    : isRTL
                    ? 'اكتمل الحد اليومي (5/5)'
                    : 'Daily limit reached (5/5)'}
                </span>
              </div>
            </div>

            {/* Active Perks Strip */}
            {(hasActiveProPass ||
              hasActiveAdFreePass ||
              creditsState.bonusReceiptScans > 0 ||
              creditsState.exportPasses > 0) && (
              <div className="pt-2 border-t border-[var(--color-line)]/70 flex flex-wrap gap-1.5">
                {hasActiveProPass && proPassRemaining.active && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/35 text-[11px] font-bold text-[var(--color-accent)]"
                    data-testid="active-pro-pass-chip"
                  >
                    <Crown className="w-3 h-3 shrink-0" />
                    <span>
                      {isRTL
                        ? `PRO 24 ساعة نشط (${proPassRemaining.hours}س ${proPassRemaining.minutes}د)`
                        : `24h PRO Active (${proPassRemaining.hours}h ${proPassRemaining.minutes}m)`}
                    </span>
                  </span>
                )}
                {!hasActiveProPass && hasActiveAdFreePass && adFreeRemaining.active && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/40 text-[11px] font-bold text-[var(--color-gold-text)]"
                    data-testid="active-adfree-chip"
                  >
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>
                      {isRTL
                        ? `بدون إعلانات (${adFreeRemaining.hours}س ${adFreeRemaining.minutes}د)`
                        : `Ad-Free (${adFreeRemaining.hours}h ${adFreeRemaining.minutes}m)`}
                    </span>
                  </span>
                )}
                {creditsState.bonusReceiptScans > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[11px] font-semibold text-[var(--color-ink)]">
                    <ScanLine className="w-3 h-3 text-[var(--color-accent)]" />
                    <span>
                      {isRTL
                        ? `${creditsState.bonusReceiptScans} مسح ذكي إضافي`
                        : `${creditsState.bonusReceiptScans} bonus AI scans`}
                    </span>
                  </span>
                )}
                {creditsState.exportPasses > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[11px] font-semibold text-[var(--color-ink)]">
                    <FileText className="w-3 h-3 text-[var(--color-accent)]" />
                    <span>
                      {isRTL
                        ? `${creditsState.exportPasses} بطاقة تصدير تقرير`
                        : `${creditsState.exportPasses} report export pass`}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Daily Consecutive Login Streak Card */}
          <div className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-[var(--color-gold-text)] shrink-0" />
                <span className="text-xs font-bold text-[var(--color-ink)]">
                  {isRTL ? 'سلسلة الدخول اليومي المتتالي' : 'Daily Login Streak'}
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-lg bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/35 text-[11px] font-bold text-[var(--color-gold-text)] num-tabular">
                {isRTL
                  ? `${creditsState.streakCount} / ${CREDITS_STREAK_7_DAYS} أيام`
                  : `Day ${creditsState.streakCount} / ${CREDITS_STREAK_7_DAYS}`}
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((dayNum) => {
                const reached = creditsState.streakCount >= dayNum;
                const isMilestone = dayNum === CREDITS_STREAK_3_DAYS || dayNum === CREDITS_STREAK_7_DAYS;
                return (
                  <div
                    key={dayNum}
                    className={`rounded-lg py-1.5 px-1 text-center border transition-colors ${
                      reached
                        ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/45 text-[var(--color-accent)]'
                        : isMilestone
                        ? 'bg-[var(--color-gold-soft)]/60 border-[var(--color-gold)]/35 text-[var(--color-gold-text)]'
                        : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)]'
                    }`}
                  >
                    <div className="text-[10px] font-bold num-tabular">{dayNum}</div>
                    <div className="text-[9px] font-semibold mt-0.5 leading-none">
                      {dayNum === CREDITS_STREAK_3_DAYS
                        ? `+${CREDITS_STREAK_3_REWARD}`
                        : dayNum === CREDITS_STREAK_7_DAYS
                        ? `+${CREDITS_STREAK_7_REWARD}`
                        : reached
                        ? '✓'
                        : '•'}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--color-muted)]">
              {isRTL
                ? `افتح التطبيق يومياً لتحصل على +${CREDITS_STREAK_3_REWARD} نقاط في اليوم 3 و +${CREDITS_STREAK_7_REWARD} نقطة في اليوم 7 تلقائياً.`
                : `Open Raseedi daily to earn +${CREDITS_STREAK_3_REWARD} credits on Day 3 and +${CREDITS_STREAK_7_REWARD} on Day 7 automatically.`}
            </p>
          </div>

          {/* Segmented Tabs: Store vs History */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
            <button
              type="button"
              onClick={() => setActiveTab('store')}
              className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors min-h-[38px] ${
                activeTab === 'store'
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isRTL ? 'استبدال النقاط' : 'Redeem Store'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors min-h-[38px] ${
                activeTab === 'history'
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>{isRTL ? `سجل النقاط (${creditsState.ledger.length})` : `History (${creditsState.ledger.length})`}</span>
            </button>
          </div>

          {feedbackError && (
            <div className="p-2.5 rounded-xl bg-[var(--color-gold-soft)] border border-[var(--color-gold)]/45 text-[11px] font-medium text-[var(--color-ink)] flex items-center justify-between gap-2">
              <span>{feedbackError}</span>
              <button
                type="button"
                onClick={() => setIsRewardedAdModalOpen(true)}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-bold"
              >
                {isRTL ? 'شاهد إعلاناً' : 'Watch Ad'}
              </button>
            </div>
          )}

          {activeTab === 'store' ? (
            <div className="space-y-2.5" data-testid="credits-redemption-store">
              {CREDIT_REDEMPTION_CATALOG.map((option) => {
                const canAfford = creditsState.balance >= option.cost;
                return (
                  <div
                    key={option.id}
                    className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)]/50 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-center shrink-0 mt-0.5">
                        {renderRewardIcon(option.id)}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-xs font-bold text-[var(--color-ink)]">
                            {isRTL ? option.titleAr : option.titleEn}
                          </h4>
                        </div>
                        <p className="text-[11px] text-[var(--color-muted)] leading-snug">
                          {isRTL ? option.descriptionAr : option.descriptionEn}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRedeem(option.id)}
                      data-testid={`redeem-credit-${option.id}`}
                      className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold min-h-[40px] transition-all flex flex-col items-center justify-center leading-tight ${
                        canAfford
                          ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:opacity-95 shadow-xs'
                          : 'bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-gold)]'
                      }`}
                    >
                      <span className="num-tabular font-extrabold">
                        {isRTL ? `${option.cost} نقطة` : `${option.cost} cr`}
                      </span>
                      <span className="text-[10px] font-semibold opacity-90">
                        {canAfford
                          ? isRTL
                            ? 'استبدال'
                            : 'Redeem'
                          : isRTL
                          ? 'اجمع نقاطاً'
                          : 'Need more'}
                      </span>
                    </button>
                  </div>
                );
              })}

              {/* Subtle permanent PRO link */}
              <button
                type="button"
                onClick={() => {
                  setIsCreditsModalOpen(false);
                  setIsUpgradeModalOpen(true);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-gold)] text-[11px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors flex items-center justify-center gap-1.5"
              >
                <Crown className="w-3.5 h-3.5 text-[var(--color-gold-text)]" />
                <span>
                  {isRTL
                    ? 'تفضّل تجربة دائمة بلا إعلانات؟ تعرّف على باقات PRO'
                    : 'Prefer permanent ad-free access? Explore PRO plans'}
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-2" data-testid="credits-ledger-list">
              {creditsState.ledger.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--color-muted)]">
                  {isRTL ? 'لا توجد حركات نقاط بعد.' : 'No credit activity yet.'}
                </div>
              ) : (
                creditsState.ledger.map((item) => {
                  const isPositive = item.delta > 0;
                  const isZero = item.delta === 0;
                  const formattedDate = new Date(item.timestamp).toLocaleString(
                    isRTL ? 'ar-EG' : 'en-US',
                    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
                  );
                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <CheckCircle2
                          className={`w-4 h-4 shrink-0 mt-0.5 ${
                            isPositive
                              ? 'text-[var(--color-income)]'
                              : isZero
                              ? 'text-[var(--color-accent)]'
                              : 'text-[var(--color-gold-text)]'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[var(--color-ink)]">
                            {isRTL ? item.noteAr : item.noteEn}
                          </div>
                          <div className="text-[10px] text-[var(--color-muted)] mt-0.5">
                            {formattedDate} • {isRTL ? `الرصيد: ${item.balanceAfter}` : `Bal: ${item.balanceAfter}`}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-xs font-bold num-tabular px-2 py-0.5 rounded-lg ${
                          isPositive
                            ? 'bg-[var(--color-income)]/12 text-[var(--color-income)]'
                            : isZero
                            ? 'bg-[var(--color-surface)] text-[var(--color-muted)]'
                            : 'bg-[var(--color-gold-soft)] text-[var(--color-gold-text)]'
                        }`}
                      >
                        {isPositive ? `+${item.delta}` : item.delta === 0 ? '✓' : item.delta}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
