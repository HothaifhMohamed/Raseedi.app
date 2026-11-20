/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { useModalBackHandler } from './hooks/useModalBackHandler';
import { resetScrollToTop } from './hooks/useScrollToTop';
import {
  clearScrollPositionInStorage,
  getBrowserSessionStorage,
  TRANSACTIONS_LIMIT_STORAGE_KEY,
  TRANSACTIONS_SCROLL_STORAGE_KEY,
} from './services/scrollRestoration';
import { Navbar } from './components/Navbar';
import { BottomNav } from './components/BottomNav';
import { SplashScreen } from './components/SplashScreen';
import { OnboardingModal } from './components/OnboardingModal';
import { HomeDashboard } from './components/home/HomeDashboard';
import { TransactionsTab } from './components/home/TransactionsTab';
import { WalletsPage } from './components/wallets/WalletsPage';
import { WalletDetailPage } from './components/wallets/WalletDetailPage';
import { BudgetPage } from './components/budget/BudgetPage';
import { MoreMenu } from './components/more/MoreMenu';
import { UndoSnackbar } from './components/common/UndoSnackbar';
import { ToastNotification } from './components/common/ToastNotification';
import { PinLockModal } from './components/common/PinLockModal';
import { PWAInstallPrompt, OfflineIndicator } from './components/common/PWAInstallPrompt';
import { BackgroundSyncBanner } from './components/common/BackgroundSyncBanner';
import { AppUpdateBanner } from './components/common/AppUpdateBanner';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import {
  InlineSectionSkeleton,
  ModalOverlaySkeleton,
} from './components/common/SkeletonLoaders';
import {
  AdConsentBanner,
  hasAdSenseConsent,
  subscribeAdConsentChanges,
} from './components/common/AdConsentBanner';
import { AuthGateScreen } from './components/auth/AuthGateScreen';
import { LogoutConfirmationModal } from './components/more/LogoutConfirmationModal';

const StatisticsTab = React.lazy(() =>
  import('./components/home/StatisticsTab').then((m) => ({ default: m.StatisticsTab }))
);
const TemplatesTab = React.lazy(() =>
  import('./components/home/TemplatesTab').then((m) => ({ default: m.TemplatesTab }))
);
const TransactionModal = React.lazy(() =>
  import('./components/TransactionModal').then((m) => ({ default: m.TransactionModal }))
);
const FilterModal = React.lazy(() =>
  import('./components/home/FilterModal').then((m) => ({ default: m.FilterModal }))
);
const CurrencyPickerModal = React.lazy(() =>
  import('./components/common/CurrencyPickerModal').then((m) => ({
    default: m.CurrencyPickerModal,
  }))
);
const UpgradeModal = React.lazy(() =>
  import('./components/common/UpgradeModal').then((m) => ({ default: m.UpgradeModal }))
);
const SettingsModal = React.lazy(() =>
  import('./components/more/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const BackupModal = React.lazy(() =>
  import('./components/more/BackupModal').then((m) => ({ default: m.BackupModal }))
);
const AdminCodePanelModal = React.lazy(() =>
  import('./components/more/AdminCodePanelModal').then((m) => ({
    default: m.AdminCodePanelModal,
  }))
);
const OrganizationHubModal = React.lazy(() =>
  import('./components/organization/OrganizationHubModal').then((m) => ({
    default: m.OrganizationHubModal,
  }))
);
const OrgMigrationWizardModal = React.lazy(() =>
  import('./components/organization/OrgMigrationWizardModal').then((m) => ({
    default: m.OrgMigrationWizardModal,
  }))
);

const MainLayout: React.FC = () => {
  const {
    isLoading,
    hasCompletedOnboarding,
    user,
    isGuestMode,
    isAppLocked,
    unlockApp,
    activeNav,
    activeWalletId,
    wallets,
    lockedWalletIds,
    homeTab,
    setHomeTab,
    isAddModalOpen,
    setIsAddModalOpen,
    editingTransaction,
    transactionDraft,
    currencyPickerOpen,
    currencyPickerSelectedCode,
    closeCurrencyPicker,
    onCurrencySelectCallback,
    isFilterOpen,
    setIsFilterOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    isBackupOpen,
    setIsBackupOpen,
    isUpgradeModalOpen,
    setIsUpgradeModalOpen,
    isLogoutModalOpen,
    setIsLogoutModalOpen,
    isAdminCodeModalOpen,
    setIsAdminCodeModalOpen,
    isOrgHubOpen,
    setIsOrgHubOpen,
    isOrgMigrationModalOpen,
    legacyLocalOrgs,
    isPro,
    t,
    isRTL,
  } = useApp();

  const [hasConsentForAds, setHasConsentForAds] = React.useState<boolean>(() => hasAdSenseConsent());
  const [showFullLedger, setShowFullLedger] = React.useState(false);

  React.useEffect(() => {
    if (activeNav !== 'home' || homeTab !== 'transactions') {
      setShowFullLedger(false);
    }
  }, [activeNav, homeTab]);

  React.useLayoutEffect(() => {
    resetScrollToTop();
  }, [activeNav, homeTab, showFullLedger, activeWalletId]);

  React.useEffect(() => {
    return subscribeAdConsentChanges(() => {
      setHasConsentForAds(hasAdSenseConsent());
    });
  }, []);

  React.useEffect(() => {
    const adSenseClient = import.meta.env.VITE_ADSENSE_CLIENT_ID?.trim() || '';
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

  const isMainShellReady =
    !isLoading && !isAppLocked && (Boolean(user?.isLoggedIn) || isGuestMode) && hasCompletedOnboarding;
  useModalBackHandler(isMainShellReady && isAddModalOpen, () => setIsAddModalOpen(false), 'add-tx');
  useModalBackHandler(isMainShellReady && isFilterOpen, () => setIsFilterOpen(false), 'filters');
  useModalBackHandler(isMainShellReady && isSettingsOpen, () => setIsSettingsOpen(false), 'settings');
  useModalBackHandler(isMainShellReady && isBackupOpen, () => setIsBackupOpen(false), 'backup');
  useModalBackHandler(isMainShellReady && isUpgradeModalOpen, () => setIsUpgradeModalOpen(false), 'upgrade');
  useModalBackHandler(isMainShellReady && isLogoutModalOpen, () => setIsLogoutModalOpen(false), 'logout');
  useModalBackHandler(
    isMainShellReady && isAdminCodeModalOpen,
    () => setIsAdminCodeModalOpen(false),
    'admin-code'
  );
  useModalBackHandler(isMainShellReady && isOrgHubOpen, () => setIsOrgHubOpen(false), 'org-hub');
  useModalBackHandler(
    isMainShellReady && currencyPickerOpen && Boolean(onCurrencySelectCallback),
    closeCurrencyPicker,
    'currency-picker'
  );

  const activeWalletIsLocked = Boolean(
    activeWalletId &&
      wallets.some((w) => w.id === activeWalletId && w.isLocked && w.pin && lockedWalletIds.includes(w.id))
  );

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

  // Mandatory Auth Gate before Onboarding when neither Google signed-in nor Guest Mode is active
  if (!user?.isLoggedIn && !isGuestMode) {
    return <AuthGateScreen />;
  }

  // First-run onboarding wizard
  if (!hasCompletedOnboarding) {
    return <OnboardingModal />;
  }

  const BackArrow = isRTL ? ArrowRight : ArrowLeft;

  return (
    <div
      className="h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-ink)] flex flex-col font-sans transition-colors duration-300"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Responsive container: mobile-first 375-430px, scales smoothly on tablet & desktop */}
      <div className="w-full max-w-lg md:max-w-2xl lg:max-w-4xl mx-auto h-full min-h-0 flex flex-col bg-[var(--color-bg)] md:border-x md:border-[var(--color-line)]/70 shadow-xs relative min-w-0 overflow-hidden">
        {/* Offline indicator banner */}
        <OfflineIndicator />

        {/* Top Navbar */}
        <Navbar />

        {/* Non-blocking background cloud sync progress banner for large imports */}
        <BackgroundSyncBanner />

        {/* In-app PWA install prompt button/banner */}
        <PWAInstallPrompt />

        {/* Dynamic View Router */}
        <main className="flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden">
          {/* HOME VIEW: Smart Dashboard by default, or clean sub-views without legacy tabs */}
          {activeNav === 'home' && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {homeTab === 'transactions' && !showFullLedger ? (
                <HomeDashboard
                  onOpenFullLedger={() => {
                    const storage = getBrowserSessionStorage();
                    clearScrollPositionInStorage(storage, TRANSACTIONS_SCROLL_STORAGE_KEY);
                    clearScrollPositionInStorage(storage, TRANSACTIONS_LIMIT_STORAGE_KEY);
                    setShowFullLedger(true);
                  }}
                  onOpenStatistics={() => setHomeTab('statistics')}
                  onOpenTemplates={() => setHomeTab('templates')}
                />
              ) : (
                <>
                  <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-2 shrink-0">
                    <button
                      type="button"
                      data-testid="home-subview-back-btn"
                      onClick={() => {
                        const storage = getBrowserSessionStorage();
                        clearScrollPositionInStorage(storage, TRANSACTIONS_SCROLL_STORAGE_KEY);
                        clearScrollPositionInStorage(storage, TRANSACTIONS_LIMIT_STORAGE_KEY);
                        setShowFullLedger(false);
                        setHomeTab('transactions');
                      }}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-xs font-bold text-[var(--color-ink)] transition-all duration-300 min-h-[42px]"
                    >
                      <BackArrow className="w-4 h-4 text-[var(--color-accent)]" />
                      <span>{isRTL ? 'العودة للوحة الرئيسية' : 'Back to Dashboard'}</span>
                    </button>

                    <span className="text-xs font-bold text-[var(--color-muted)]">
                      {homeTab === 'statistics'
                        ? t('tabStatistics')
                        : homeTab === 'templates'
                        ? t('tabTemplates')
                        : isRTL
                        ? 'سجل المعاملات الكامل'
                        : 'Full Ledger'}
                    </span>
                  </div>

                  {homeTab === 'transactions' && <TransactionsTab />}
                  {homeTab === 'statistics' && (
                    <React.Suspense fallback={<InlineSectionSkeleton />}>
                      <StatisticsTab />
                    </React.Suspense>
                  )}
                  {homeTab === 'templates' && (
                    <React.Suspense fallback={<InlineSectionSkeleton />}>
                      <TemplatesTab />
                    </React.Suspense>
                  )}
                </>
              )}
            </div>
          )}

          {/* BUDGET VIEW */}
          {activeNav === 'budget' && <BudgetPage />}

          {/* WALLETS VIEW (If a wallet is selected and unlocked, render WalletDetailPage full page) */}
          {activeNav === 'wallets' && (
            activeWalletId && !activeWalletIsLocked ? (
              <WalletDetailPage walletId={activeWalletId} />
            ) : (
              <WalletsPage />
            )
          )}

          {/* MORE VIEW */}
          {activeNav === 'more' && <MoreMenu />}
        </main>

        {/* Global Floating Glassmorphic Bottom Navigation */}
        <BottomNav
          onHomeReset={() => {
            const storage = getBrowserSessionStorage();
            clearScrollPositionInStorage(storage, TRANSACTIONS_SCROLL_STORAGE_KEY);
            clearScrollPositionInStorage(storage, TRANSACTIONS_LIMIT_STORAGE_KEY);
            setShowFullLedger(false);
          }}
        />

        {/* Add/Edit Transaction Modal (lazy-loaded on demand) */}
        {isAddModalOpen && (
          <React.Suspense fallback={<ModalOverlaySkeleton />}>
            <TransactionModal
              isOpen={isAddModalOpen}
              onClose={() => setIsAddModalOpen(false)}
              editTransaction={editingTransaction}
              presetDraft={transactionDraft}
            />
          </React.Suspense>
        )}

        {/* Multidimensional Filter Modal */}
        {isFilterOpen && (
          <React.Suspense fallback={<ModalOverlaySkeleton />}>
            <FilterModal />
          </React.Suspense>
        )}

        {/* Undo Floating Snackbar & Alert Toast */}
        <UndoSnackbar />
        <ToastNotification />

        {/* EEA/UK Cookie Consent Banner before loading AdSense */}
        <AdConsentBanner />

        {/* Global Upgrade to PRO Modal */}
        {isUpgradeModalOpen && (
          <React.Suspense fallback={<ModalOverlaySkeleton />}>
            <UpgradeModal />
          </React.Suspense>
        )}

        {/* Global Settings & Backup Modals (accessible from Header overflow menu & More tab) */}
        {isSettingsOpen && (
          <React.Suspense fallback={<ModalOverlaySkeleton />}>
            <SettingsModal
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
            />
          </React.Suspense>
        )}
        {isBackupOpen && (
          <React.Suspense fallback={<ModalOverlaySkeleton />}>
            <BackupModal isOpen={isBackupOpen} onClose={() => setIsBackupOpen(false)} />
          </React.Suspense>
        )}

        {/* Strict Logout Confirmation & Passcode-Protected Admin Panel */}
        <LogoutConfirmationModal />
        {isAdminCodeModalOpen && (
          <React.Suspense fallback={<ModalOverlaySkeleton />}>
            <AdminCodePanelModal />
          </React.Suspense>
        )}

        {/* Unified Enterprise Workspace Hub Modal */}
        {isOrgHubOpen && (
          <React.Suspense fallback={<ModalOverlaySkeleton />}>
            <OrganizationHubModal />
          </React.Suspense>
        )}

        {/* Legacy Local-to-Cloud Org Migration Wizard */}
        {isOrgMigrationModalOpen && legacyLocalOrgs.length > 0 && (
          <React.Suspense fallback={<ModalOverlaySkeleton />}>
            <OrgMigrationWizardModal />
          </React.Suspense>
        )}

        {/* Global Currency Picker Modal */}
        {currencyPickerOpen && onCurrencySelectCallback && (
          <React.Suspense fallback={<ModalOverlaySkeleton />}>
            <CurrencyPickerModal
              isOpen={currencyPickerOpen}
              onClose={closeCurrencyPicker}
              selectedCode={currencyPickerSelectedCode}
              onSelect={onCurrencySelectCallback}
            />
          </React.Suspense>
        )}
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppUpdateBanner />
        <MainLayout />
      </AppProvider>
    </ErrorBoundary>
  );
}
