import React from 'react';
import { Home, PieChart, Plus, Wallet, MoreHorizontal } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface BottomNavProps {
  onHomeReset?: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ onHomeReset }) => {
  const {
    isOrgWorkspace,
    canOrgWrite,
    activeNav,
    setActiveNav,
    setHomeTab,
    setActiveWalletId,
    setIsAddModalOpen,
    setEditingTransaction,
    t,
    isRTL,
  } = useApp();

  const canAddTransaction = !isOrgWorkspace || canOrgWrite;

  const handleOpenAdd = () => {
    if (!canAddTransaction) return;
    setEditingTransaction(null);
    setIsAddModalOpen(true);
  };

  const handleNavClick = (nav: 'home' | 'budget' | 'wallets' | 'more') => {
    setActiveWalletId(null);
    if (nav === 'home') {
      setHomeTab('transactions');
      onHomeReset?.();
    }
    setActiveNav(nav);
  };

  const navButtonClass = (isActive: boolean) =>
    `flex flex-col items-center justify-center py-1.5 px-2.5 rounded-2xl transition-all duration-300 min-h-[46px] min-w-[56px] active:scale-95 ${
      isActive
        ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)] font-bold'
        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-bg)]/60'
    }`;

  return (
    <div
      className="fixed bottom-3 inset-x-0 z-30 px-3 pointer-events-none flex justify-center no-print"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <nav
        aria-label={isRTL ? 'التنقل الرئيسي' : 'Main Navigation'}
        data-testid="floating-bottom-nav"
        className="pointer-events-auto w-full max-w-md rounded-2xl bg-[var(--color-surface)]/92 backdrop-blur-xl border border-[var(--color-line)] shadow-[0_12px_32px_-8px_rgba(14,94,88,0.18)] dark:shadow-[0_14px_34px_-8px_rgba(4,16,15,0.75)] px-2 py-1.5 flex items-center justify-between gap-1 transition-all duration-300"
      >
        {/* 1. Home */}
        <button
          type="button"
          onClick={() => handleNavClick('home')}
          data-testid="nav-home"
          className={navButtonClass(activeNav === 'home')}
        >
          <Home className={`w-5 h-5 transition-transform duration-300 ${activeNav === 'home' ? 'stroke-[2.5] scale-105' : 'stroke-2'}`} />
          <span className="text-[11px] mt-0.5 whitespace-nowrap">{t('navHome')}</span>
        </button>

        {/* 2. Budget */}
        <button
          type="button"
          onClick={() => handleNavClick('budget')}
          data-testid="nav-budget"
          className={navButtonClass(activeNav === 'budget')}
        >
          <PieChart className={`w-5 h-5 transition-transform duration-300 ${activeNav === 'budget' ? 'stroke-[2.5] scale-105' : 'stroke-2'}`} />
          <span className="text-[11px] mt-0.5 whitespace-nowrap">{t('navBudget')}</span>
        </button>

        {/* 3. Integrated Rounded-Square "+" Action Button */}
        <button
          type="button"
          onClick={handleOpenAdd}
          disabled={!canAddTransaction}
          data-testid="nav-add-transaction"
          title={
            !canAddTransaction
              ? isRTL
                ? 'صلاحية مشاهد فقط — لا يمكنك الإضافة'
                : 'Viewer role — read-only access'
              : t('navAdd')
          }
          aria-label={t('navAdd')}
          className={`w-12 h-11 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 min-h-[44px] min-w-[48px] ${
            canAddTransaction
              ? 'bg-gradient-to-br from-[var(--color-fab-from)] to-[var(--color-fab-to)] text-[var(--color-on-accent)] border border-[var(--color-gold)]/45 shadow-[0_6px_16px_-4px_rgba(14,94,88,0.42)] hover:scale-105 hover:shadow-[0_8px_20px_-4px_rgba(201,142,31,0.42)] active:scale-95'
              : 'bg-[var(--color-line)] text-[var(--color-muted)] cursor-not-allowed opacity-70'
          }`}
        >
          <Plus className="w-5 h-5 stroke-[2.6]" />
        </button>

        {/* 4. Wallets */}
        <button
          type="button"
          onClick={() => handleNavClick('wallets')}
          data-testid="nav-wallets"
          className={navButtonClass(activeNav === 'wallets')}
        >
          <Wallet className={`w-5 h-5 transition-transform duration-300 ${activeNav === 'wallets' ? 'stroke-[2.5] scale-105' : 'stroke-2'}`} />
          <span className="text-[11px] mt-0.5 whitespace-nowrap">{t('navWallets')}</span>
        </button>

        {/* 5. More */}
        <button
          type="button"
          onClick={() => handleNavClick('more')}
          data-testid="nav-more"
          className={navButtonClass(activeNav === 'more')}
        >
          <MoreHorizontal className={`w-5 h-5 transition-transform duration-300 ${activeNav === 'more' ? 'stroke-[2.5] scale-105' : 'stroke-2'}`} />
          <span className="text-[11px] mt-0.5 whitespace-nowrap">{t('navMore')}</span>
        </button>
      </nav>
    </div>
  );
};
