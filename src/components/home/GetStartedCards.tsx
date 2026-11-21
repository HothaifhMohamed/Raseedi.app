/**
 * Dismissible "Get Started" checklist cards for Personal accounts.
 * Each card can be dismissed individually via × and stays hidden across reloads.
 */
import React from 'react';
import {
  Wallet as WalletIcon,
  TrendingUp,
  PieChart,
  Target,
  X,
  ArrowUpLeft,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { GetStartedCardItem, GetStartedTaskId } from '../../services/homeSections';

interface GetStartedCardsProps {
  cards: GetStartedCardItem[];
  isRTL: boolean;
  onDismiss: (id: GetStartedTaskId) => void;
  onAction: (id: GetStartedTaskId) => void;
}

const ICON_BY_TASK: Record<GetStartedTaskId, React.ReactNode> = {
  add_wallet_or_asset: <WalletIcon className="w-4 h-4 text-[var(--color-accent)]" />,
  record_first_income: <TrendingUp className="w-4 h-4 text-[var(--color-income)]" />,
  set_monthly_budget: <PieChart className="w-4 h-4 text-[var(--color-gold-text)]" />,
  add_savings_goal: <Target className="w-4 h-4 text-[var(--color-accent)]" />,
};

export const GetStartedCards: React.FC<GetStartedCardsProps> = ({
  cards,
  isRTL,
  onDismiss,
  onAction,
}) => {
  if (!cards || cards.length === 0) return null;

  return (
    <section data-testid="get-started-section" className="space-y-2.5">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--color-muted)]">
          <Sparkles className="w-3.5 h-3.5 text-[var(--color-gold-text)]" />
          <span>{isRTL ? 'البدء السريع' : 'Get Started'}</span>
        </div>
        <span className="text-[11px] font-medium text-[var(--color-muted)]">
          {isRTL ? 'يمكنك إخفاء أي بطاقة' : 'Dismiss any card anytime'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {cards.map((card) => (
          <div
            key={card.id}
            data-testid={`get-started-card-${card.id}`}
            className="relative bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl p-3.5 flex flex-col justify-between gap-3 shadow-xs"
          >
            <button
              type="button"
              data-testid={`dismiss-get-started-${card.id}`}
              onClick={() => onDismiss(card.id)}
              aria-label={isRTL ? 'إخفاء البطاقة' : 'Dismiss card'}
              className="absolute top-2.5 end-2.5 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-subtle)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="pe-7">
              <div className="w-8 h-8 rounded-xl bg-[var(--color-surface-subtle)] border border-[var(--color-line)] flex items-center justify-center mb-2">
                {ICON_BY_TASK[card.id]}
              </div>
              <h3 className="text-sm font-extrabold text-[var(--color-ink)] leading-snug">
                {isRTL ? card.titleAr : card.titleEn}
              </h3>
              <p className="mt-1 text-xs text-[var(--color-muted)] leading-relaxed">
                {isRTL ? card.subtitleAr : card.subtitleEn}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onAction(card.id)}
              className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-[var(--color-surface-subtle)] border border-[var(--color-line)] hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:text-[var(--color-on-accent)] text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>{isRTL ? card.ctaAr : card.ctaEn}</span>
              {isRTL ? (
                <ArrowUpLeft className="w-3.5 h-3.5" />
              ) : (
                <ArrowUpRight className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};
