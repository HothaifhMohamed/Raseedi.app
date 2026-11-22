import React from 'react';
import { Coins, PlayCircle, Crown, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useOrg } from '../../context/OrgContext';
import {
  CREDITS_AD_REWARD,
  CreditRewardRedemptionId,
  getCreditRedemptionOption,
  shouldShowRaseediCreditsUi,
} from '../../services/raseediCredits';

export interface CreditsContextualPromptProps {
  redemptionId: CreditRewardRedemptionId;
  onRedeemed?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export const CreditsContextualPrompt: React.FC<CreditsContextualPromptProps> = ({
  redemptionId,
  onRedeemed,
  onDismiss,
  className = '',
}) => {
  const {
    subscriptionSummary,
    creditsState,
    redeemCreditOption,
    setIsRewardedAdModalOpen,
    setIsUpgradeModalOpen,
    isRTL,
  } = useApp();
  const { activeOrgSubscriptionState } = useOrg();

  const canShowCredits = shouldShowRaseediCreditsUi(subscriptionSummary, {
    activeOrgSubscriptionState,
  });

  if (!canShowCredits) {
    return null;
  }

  const option = getCreditRedemptionOption(redemptionId);
  const canAfford = creditsState.balance >= option.cost;
  const needed = Math.max(0, option.cost - creditsState.balance);

  const handleRedeemNow = () => {
    const res = redeemCreditOption(redemptionId);
    if (res.ok && onRedeemed) {
      onRedeemed();
    }
  };

  return (
    <div
      className={`p-3 rounded-xl bg-gradient-to-l from-[var(--color-gold-soft)]/80 via-[var(--color-bg)] to-[var(--color-accent)]/8 border border-[var(--color-gold)]/45 space-y-2.5 ${className}`}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid={`credits-contextual-prompt-${redemptionId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Coins className="w-4 h-4 text-[var(--color-gold-text)] shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-0.5">
            <div className="text-xs font-bold text-[var(--color-ink)]">
              {canAfford
                ? isRTL
                  ? `افتح هذه الميزة فوراً بـ ${option.cost} نقطة 🪙`
                  : `Unlock instantly with ${option.cost} Credits 🪙`
                : isRTL
                ? `رصيدك ${creditsState.balance} نقطة (تحتاج ${needed} نقطة إضافية)`
                : `Balance: ${creditsState.balance} credits (need ${needed} more)`}
            </div>
            <p className="text-[11px] text-[var(--color-muted)] leading-snug">
              {isRTL ? option.descriptionAr : option.descriptionEn}
            </p>
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-ink)] px-1"
            aria-label={isRTL ? 'إخفاء' : 'Dismiss'}
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canAfford ? (
          <button
            type="button"
            onClick={handleRedeemNow}
            data-testid={`contextual-redeem-btn-${redemptionId}`}
            className="flex-1 min-w-[140px] py-2 px-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity min-h-[40px]"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isRTL ? `استبدال ${option.cost} نقطة الآن 🪙` : `Redeem ${option.cost} Credits Now 🪙`}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIsRewardedAdModalOpen(true)}
            data-testid={`contextual-watch-ad-btn-${redemptionId}`}
            className="flex-1 min-w-[140px] py-2 px-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity min-h-[40px]"
          >
            <PlayCircle className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isRTL
                ? `شاهد إعلاناً (+${CREDITS_AD_REWARD} نقاط)`
                : `Watch Ad (+${CREDITS_AD_REWARD} Credits)`}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setIsUpgradeModalOpen(true)}
          className="py-2 px-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-gold)] text-[var(--color-ink)] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors min-h-[40px]"
        >
          <Crown className="w-3.5 h-3.5 text-[var(--color-gold-text)] shrink-0" />
          <span>{isRTL ? 'ترقية إلى PRO' : 'Upgrade PRO'}</span>
        </button>
      </div>
    </div>
  );
};
