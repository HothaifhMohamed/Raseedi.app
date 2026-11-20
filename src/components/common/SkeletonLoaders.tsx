import React from 'react';

/**
 * Lightweight, cohesive Skeleton Loaders matched to Raseedi's exact design tokens
 * (--color-surface, --color-bg, --color-line) to eliminate blank flashes during
 * workspace switches and lazy-loaded modals/views.
 */

export const DashboardSkeleton: React.FC<{ isRTL?: boolean }> = ({ isRTL = true }) => (
  <div
    data-testid="dashboard-skeleton"
    dir={isRTL ? 'rtl' : 'ltr'}
    aria-busy="true"
    className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 space-y-4 animate-pulse"
  >
    {/* Hero Balance Card Skeleton */}
    <div className="rounded-2xl p-5 bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-3.5 w-28 rounded-md bg-[var(--color-line)]/70" />
        <div className="h-8 w-8 rounded-xl bg-[var(--color-line)]/60" />
      </div>
      <div className="h-9 w-44 rounded-lg bg-[var(--color-line)]/80" />
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[var(--color-line)]/60">
        <div className="space-y-1.5">
          <div className="h-3 w-16 rounded bg-[var(--color-line)]/60" />
          <div className="h-4 w-24 rounded bg-[var(--color-line)]/80" />
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-16 rounded bg-[var(--color-line)]/60" />
          <div className="h-4 w-24 rounded bg-[var(--color-line)]/80" />
        </div>
      </div>
    </div>

    {/* Quick Shortcuts Skeleton */}
    <div className="grid grid-cols-3 gap-2.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-20 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] p-3 flex flex-col justify-between"
        >
          <div className="w-7 h-7 rounded-lg bg-[var(--color-line)]/70" />
          <div className="h-3 w-16 rounded bg-[var(--color-line)]/70" />
        </div>
      ))}
    </div>

    {/* Recent Ledger Skeleton */}
    <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="p-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl bg-[var(--color-line)]/65 shrink-0" />
            <div className="space-y-1.5 flex-1 max-w-[180px]">
              <div className="h-3.5 w-28 rounded bg-[var(--color-line)]/80" />
              <div className="h-2.5 w-20 rounded bg-[var(--color-line)]/55" />
            </div>
          </div>
          <div className="h-4 w-16 rounded bg-[var(--color-line)]/75 shrink-0" />
        </div>
      ))}
    </div>
  </div>
);

export const TransactionsListSkeleton: React.FC<{ isRTL?: boolean }> = ({ isRTL = true }) => (
  <div
    data-testid="transactions-skeleton"
    dir={isRTL ? 'rtl' : 'ltr'}
    aria-busy="true"
    className="flex-1 min-h-0 overflow-y-auto px-4 pt-2 pb-28 space-y-4 animate-pulse"
  >
    {/* Search bar placeholder */}
    <div className="h-11 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]" />

    {/* Filter chips placeholder */}
    <div className="flex items-center gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-9 w-20 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] shrink-0"
        />
      ))}
    </div>

    {/* Day Group Skeletons */}
    {[0, 1].map((g) => (
      <div key={g} className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="h-3 w-28 rounded bg-[var(--color-line)]/70" />
          <div className="h-3 w-16 rounded bg-[var(--color-line)]/70" />
        </div>
        <div className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
          {[0, 1, 2].map((r) => (
            <div key={r} className="p-3.5 flex items-center justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <div className="h-3.5 w-32 rounded bg-[var(--color-line)]/80" />
                <div className="h-2.5 w-44 rounded bg-[var(--color-line)]/55" />
              </div>
              <div className="h-4 w-16 rounded bg-[var(--color-line)]/75 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export const ModalOverlaySkeleton: React.FC = () => (
  <div
    data-testid="modal-loading-skeleton"
    aria-busy="true"
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
  >
    <div className="w-full max-w-lg rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 shadow-xl space-y-4 animate-pulse">
      <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)]">
        <div className="h-4 w-36 rounded bg-[var(--color-line)]/80" />
        <div className="h-7 w-7 rounded-lg bg-[var(--color-line)]/60" />
      </div>
      <div className="space-y-3">
        <div className="h-16 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]" />
        <div className="h-24 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]" />
        <div className="grid grid-cols-2 gap-2.5">
          <div className="h-12 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]" />
          <div className="h-12 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]" />
        </div>
      </div>
    </div>
  </div>
);

export const InlineSectionSkeleton: React.FC = () => (
  <div
    aria-busy="true"
    className="p-4 space-y-3 animate-pulse"
  >
    <div className="h-24 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)]" />
    <div className="grid grid-cols-2 gap-3">
      <div className="h-20 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]" />
      <div className="h-20 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)]" />
    </div>
    <div className="h-36 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)]" />
  </div>
);
