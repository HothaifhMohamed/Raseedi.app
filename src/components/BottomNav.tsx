import React from 'react';
import { Home, PieChart, Plus, Wallet, MoreHorizontal } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const BottomNav: React.FC = () => {
  const {
    isOrgWorkspace,
    canOrgWrite,
    activeNav,
    setActiveNav,
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
    setActiveNav(nav);
    if (nav !== 'wallets') {
      setActiveWalletId(null);
    }
  };

  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-[var(--color-surface)] border-t border-[var(--color-line)] px-3 py-1.5 flex items-center justify-around max-w-lg mx-auto shadow-sm">
      {/* 1. Home */}
      <button
        onClick={() => handleNavClick('home')}
        className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-lg transition-colors min-h-[44px] min-w-[56px] ${
          activeNav === 'home'
            ? 'text-[var(--color-accent)] font-semibold'
            : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
        }`}
      >
        <Home className={`w-5 h-5 ${activeNav === 'home' ? 'stroke-[2.5]' : 'stroke-2'}`} />
        <span className="text-xs mt-0.5">{t('navHome')}</span>
      </button>

      {/* 2. Budget */}
      <button
        onClick={() => handleNavClick('budget')}
        className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-lg transition-colors min-h-[44px] min-w-[56px] ${
          activeNav === 'budget'
            ? 'text-[var(--color-accent)] font-semibold'
            : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
        }`}
      >
        <PieChart className={`w-5 h-5 ${activeNav === 'budget' ? 'stroke-[2.5]' : 'stroke-2'}`} />
        <span className="text-xs mt-0.5">{t('navBudget')}</span>
      </button>

      {/* 3. Center Big "+" Button */}
      <div className="relative -top-3 flex items-center justify-center px-1">
        <button
          onClick={handleOpenAdd}
          disabled={!canAddTransaction}
          title={
            !canAddTransaction
              ? isRTL
                ? 'صلاحية مشاهد فقط — لا يمكنك الإضافة'
                : 'Viewer role — read-only access'
              : t('navAdd')
          }
          className={`w-12 h-12 rounded-full flex items-center justify-center shadow-md ring-4 ring-[var(--color-bg)] transition-all ${
            canAddTransaction
              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:opacity-95 active:scale-95'
              : 'bg-[var(--color-line)] text-[var(--color-muted)] cursor-not-allowed opacity-70'
          }`}
          aria-label={t('navAdd')}
        >
          <Plus className="w-6 h-6 stroke-[2.5]" />
        </button>
      </div>

      {/* 4. Wallets */}
      <button
        onClick={() => handleNavClick('wallets')}
        className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-lg transition-colors min-h-[44px] min-w-[56px] ${
          activeNav === 'wallets'
            ? 'text-[var(--color-accent)] font-semibold'
            : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
        }`}
      >
        <Wallet className={`w-5 h-5 ${activeNav === 'wallets' ? 'stroke-[2.5]' : 'stroke-2'}`} />
        <span className="text-xs mt-0.5">{t('navWallets')}</span>
      </button>

      {/* 5. More */}
      <button
        onClick={() => handleNavClick('more')}
        className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-lg transition-colors min-h-[44px] min-w-[56px] ${
          activeNav === 'more'
            ? 'text-[var(--color-accent)] font-semibold'
            : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
        }`}
      >
        <MoreHorizontal className={`w-5 h-5 ${activeNav === 'more' ? 'stroke-[2.5]' : 'stroke-2'}`} />
        <span className="text-xs mt-0.5">{t('navMore')}</span>
      </button>
    </nav>
  );
};
