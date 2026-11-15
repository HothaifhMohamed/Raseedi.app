/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { BottomNav } from './components/BottomNav';
import { SplashScreen } from './components/SplashScreen';
import { OnboardingModal } from './components/OnboardingModal';
import { SummaryCards } from './components/home/SummaryCards';
import { TransactionsTab } from './components/home/TransactionsTab';
import { StatisticsTab } from './components/home/StatisticsTab';
import { TemplatesTab } from './components/home/TemplatesTab';
import { WalletsPage } from './components/wallets/WalletsPage';
import { WalletDetailPage } from './components/wallets/WalletDetailPage';
import { BudgetPage } from './components/budget/BudgetPage';
import { MoreMenu } from './components/more/MoreMenu';
import { TransactionModal } from './components/TransactionModal';
import { FilterModal } from './components/home/FilterModal';
import { CurrencyPickerModal } from './components/common/CurrencyPickerModal';
import { UpgradeModal } from './components/common/UpgradeModal';
import { SettingsModal } from './components/more/SettingsModal';
import { BackupModal } from './components/more/BackupModal';
import { UndoSnackbar } from './components/common/UndoSnackbar';
import { ToastNotification } from './components/common/ToastNotification';
import { PinLockModal } from './components/common/PinLockModal';
import { PWAInstallPrompt, OfflineIndicator } from './components/common/PWAInstallPrompt';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import {
  AdConsentBanner,
  hasAdSenseConsent,
  subscribeAdConsentChanges,
} from './components/common/AdConsentBanner';
import { OrganizationHubModal } from './components/organization/OrganizationHubModal';
import { OrgMigrationWizardModal } from './components/organization/OrgMigrationWizardModal';

const MainLayout: React.FC = () => {
  const {
    isLoading,
    hasCompletedOnboarding,
    isAppLocked,
    unlockApp,
    activeNav,
    activeWalletId,
    homeTab,
    setHomeTab,
    isAddModalOpen,
    setIsAddModalOpen,
    editingTransaction,
    currencyPickerOpen,
    currencyPickerSelectedCode,
    closeCurrencyPicker,
    onCurrencySelectCallback,
    isSettingsOpen,
    setIsSettingsOpen,
    openAdminPanelRequested,
    isBackupOpen,
    setIsBackupOpen,
    isPro,
    t,
    isRTL,
  } = useApp();

  const [hasConsentForAds, setHasConsentForAds] = React.useState<boolean>(() => hasAdSenseConsent());

  React.useEffect(() => {
    return subscribeAdConsentChanges(() => {
      setHasConsentForAds(hasAdSenseConsent());
    });
  }, []);

  React.useEffect(() => {
    const adSenseClient =
      import.meta.env.VITE_ADSENSE_CLIENT_ID?.trim() || 'ca-pub-7802456807447662';
    const scriptId = 'raseedi-adsense-script';
    const existingScript =
      document.getElementById(scriptId) ||
      document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]');

    if (isPro || !hasConsentForAds) {
      if (existingScript && existingScript.id === scriptId) {
        existingScript.remove();
      }
      return;
    }

    if (!adSenseClient || existingScript) return;

    const script = document.createElement('script');
    script.id = scriptId;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adSenseClient)}`;
    document.head.appendChild(script);
  }, [isPro, hasConsentForAds]);

  // Show splash screen while loading
  if (isLoading) {
    return <SplashScreen />;
  }

  // App Lock PIN screen
  if (isAppLocked) {
    return (
      <PinLockModal
        isOpen={true}
        lockoutKey="app"
        onVerify={unlockApp}
        onSuccess={() => {}}
        title={isRTL ? 'تطبيق رَصِيدِي مقفل' : 'Raseedi is Locked'}
        onCancel={undefined}
      />
    );
  }

  // First-run onboarding wizard
  if (!hasCompletedOnboarding) {
    return <OnboardingModal />;
  }

  return (
    <div
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)] flex flex-col font-sans transition-colors duration-150"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Mobile-centric container centered on desktop with clean borders */}
      <div className="w-full max-w-lg mx-auto min-h-screen flex flex-col bg-[var(--color-bg)] sm:border-x sm:border-[var(--color-line)] shadow-sm relative">
        {/* Offline indicator banner */}
        <OfflineIndicator />

        {/* Top Navbar */}
        <Navbar />

        {/* In-app PWA install prompt button/banner */}
        <PWAInstallPrompt />

        {/* Dynamic View Router */}
        <main className="flex-1 flex flex-col">
          {/* HOME VIEW */}
          {activeNav === 'home' && (
            <div className="flex flex-col flex-1">
              {/* Financial Summary Metrics Card */}
              <SummaryCards />

              {/* 3 Home Tabs: Transactions, Statistics, Templates */}
              <div className="px-4 py-2 border-b border-[var(--color-line)] bg-[var(--color-bg)] sticky top-[53px] z-20">
                <div className="flex items-center p-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
                  <button
                    onClick={() => setHomeTab('transactions')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[36px] ${
                      homeTab === 'transactions'
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    {t('tabTransactions')}
                  </button>
                  <button
                    onClick={() => setHomeTab('statistics')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[36px] ${
                      homeTab === 'statistics'
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    {t('tabStatistics')}
                  </button>
                  <button
                    onClick={() => setHomeTab('templates')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[36px] ${
                      homeTab === 'templates'
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    {t('tabTemplates')}
                  </button>
                </div>
              </div>

              {/* Active Tab View */}
              {homeTab === 'transactions' && <TransactionsTab />}
              {homeTab === 'statistics' && <StatisticsTab />}
              {homeTab === 'templates' && <TemplatesTab />}
            </div>
          )}

          {/* BUDGET VIEW */}
          {activeNav === 'budget' && <BudgetPage />}

          {/* WALLETS VIEW (If a wallet is selected, render WalletDetailPage full page) */}
          {activeNav === 'wallets' && (
            activeWalletId ? <WalletDetailPage walletId={activeWalletId} /> : <WalletsPage />
          )}

          {/* MORE VIEW */}
          {activeNav === 'more' && <MoreMenu />}
        </main>

        {/* Global Bottom Navigation */}
        <BottomNav />

        {/* Add/Edit Transaction Modal */}
        <TransactionModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          editTransaction={editingTransaction}
        />

        {/* Multidimensional Filter Modal */}
        <FilterModal />

        {/* Undo Floating Snackbar & Alert Toast */}
        <UndoSnackbar />
        <ToastNotification />

        {/* EEA/UK Cookie Consent Banner before loading AdSense */}
        <AdConsentBanner />

        {/* Global Upgrade to PRO Modal */}
        <UpgradeModal />

        {/* Global Settings & Backup Modals (accessible from Header overflow menu & More tab) */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          initialOpenAdminPanel={openAdminPanelRequested}
        />
        <BackupModal isOpen={isBackupOpen} onClose={() => setIsBackupOpen(false)} />

        {/* Unified Enterprise Workspace Hub Modal */}
        <OrganizationHubModal />

        {/* Legacy Local-to-Cloud Org Migration Wizard */}
        <OrgMigrationWizardModal />

        {/* Global Currency Picker Modal */}
        {onCurrencySelectCallback && (
          <CurrencyPickerModal
            isOpen={currencyPickerOpen}
            onClose={closeCurrencyPicker}
            selectedCode={currencyPickerSelectedCode}
            onSelect={onCurrencySelectCallback}
          />
        )}
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <MainLayout />
      </AppProvider>
    </ErrorBoundary>
  );
}
