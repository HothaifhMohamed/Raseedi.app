import React, { useState, useRef, useEffect } from 'react';
import {
  MoreVertical,
  SlidersHorizontal,
  Save,
  Settings as SettingsIcon,
  Globe,
  Sun,
  Moon,
  ChevronDown,
  Sparkles,
  Bell,
  Building2,
  User,
  Plus,
  KeyRound,
  Check,
  CheckCheck,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Cloud,
  LogIn,
  LogOut,
  UploadCloud,
  Trash2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getCurrency } from '../services/currency';
import {
  isWebNotificationSupported,
  requestBrowserNotificationPermission,
} from '../services/notifications';
import { AppNotificationItem, Organization, OrganizationIndustry, OrganizationRole } from '../types';
import { BrandLogo } from './common/BrandLogo';
import { normalizeArabicPersianNumerals, parseLocalizedNumber } from '../services/numbers';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import {
  formatWorkspaceDeleteConfirmMessage,
  resolveWorkspaceOrgPermissions,
} from '../services/workspaceCleanup';
import { auth, resolveFirebaseUserEmail } from '../services/firebase';
import { canUserAccessAdminPanelUi } from '../services/adminAuth';

export const Navbar: React.FC = () => {
  const {
    user,
    signInWithGoogleAccount,
    settings,
    updateSettings,
    openCurrencyPicker,
    setIsSettingsOpen,
    setIsFilterOpen,
    setIsBackupOpen,
    setIsUpgradeModalOpen,
    isPro,
    isBusinessPro,
    subscriptionSummary,
    isAdminUser,
    openAdminPanel,
    cloudSyncStatus,
    filters,
    activeWorkspace,
    isOrgWorkspace,
    isOrgLoading,
    orgSyncPendingWrites,
    activeOrgSubscriptionState,
    isOrgReadOnly,
    orgActionError,
    clearOrgActionError,
    pendingJoinCode,
    clearPendingJoinCode,
    legacyLocalOrgs,
    openOrgMigrationModal,
    orgMigrationSuccessMessage,
    clearOrgMigrationSuccessMessage,
    organizationsList,
    orgRefs,
    localOrgWorkspaces,
    activeOrganization,
    activeOrgRole,
    switchWorkspace,
    createOrganization,
    joinOrganizationByCode,
    deleteOrganization,
    notifications,
    unreadNotificationsCount,
    markNotificationRead,
    markAllNotificationsRead,
    setActiveNav,
    openOrgHub,
    setIsAddModalOpen,
    setIsLogoutModalOpen,
    isWorkspaceModalOpen,
    setIsWorkspaceModalOpen,
    showToast,
    t,
    isRTL,
  } = useApp();

  const roleLabels: Record<OrganizationRole, { ar: string; en: string }> = {
    owner: { ar: t('roleOwner'), en: t('roleOwner') },
    admin: { ar: t('roleAdmin'), en: t('roleAdmin') },
    accountant: { ar: t('roleAccountant'), en: t('roleAccountant') },
    employee: { ar: t('roleEmployee'), en: t('roleEmployee') },
    viewer: { ar: t('roleViewer'), en: t('roleViewer') },
  };

  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [dropdownTop, setDropdownTop] = useState(60);

  // Create / Join Org quick modals
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showJoinOrg, setShowJoinOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgCurrency, setNewOrgCurrency] = useState(settings.mainCurrency || 'EGP');
  const [newOrgIndustry, setNewOrgIndustry] = useState<OrganizationIndustry>('general');
  const [newOrgVat, setNewOrgVat] = useState('14');
  const [newOrgTaxNumber, setNewOrgTaxNumber] = useState('');
  const [newOrgThreshold, setNewOrgThreshold] = useState('1000');
  const [newOrgSample, setNewOrgSample] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [createOrgError, setCreateOrgError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isSubmittingOrg, setIsSubmittingOrg] = useState(false);
  const [isSigningInOrg, setIsSigningInOrg] = useState(false);
  const [deleteTargetOrg, setDeleteTargetOrg] = useState<Organization | null>(null);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [deleteWorkspaceError, setDeleteWorkspaceError] = useState<string | null>(null);
  const [notifPermission, setNotifPermission] = useState<string>(() =>
    isWebNotificationSupported() ? Notification.permission : 'unsupported'
  );

  useModalBackHandler(isWorkspaceModalOpen, () => setIsWorkspaceModalOpen(false), 'navbar-workspace-selector');
  useModalBackHandler(showCreateOrg, () => setShowCreateOrg(false), 'navbar-create-org');
  useModalBackHandler(
    showJoinOrg,
    () => {
      setShowJoinOrg(false);
      clearPendingJoinCode();
    },
    'navbar-join-org'
  );

  useEffect(() => {
    if (pendingJoinCode && !showJoinOrg) {
      setInviteCodeInput(pendingJoinCode);
      setJoinError(null);
      setShowJoinOrg(true);
    }
  }, [pendingJoinCode]);

  const headerRef = useRef<HTMLElement>(null);

  const currentCurrency = getCurrency(settings.mainCurrency || 'EGP');

  const hasSyncAlert = cloudSyncStatus === 'error';

  const hasActiveFilters =
    filters.type !== 'all' ||
    !!filters.walletId ||
    !!filters.categoryId ||
    !!filters.priority ||
    !!filters.group ||
    !!filters.contact ||
    !!filters.searchQuery;

  const updateDropdownAnchor = () => {
    const rect = headerRef.current?.getBoundingClientRect();
    if (rect) {
      setDropdownTop(Math.max(56, Math.round(rect.bottom + 6)));
    }
  };

  const openWorkspaceSelectorModal = () => {
    setIsNotifOpen(false);
    setIsOverflowOpen(false);
    setIsWorkspaceModalOpen(true);
  };

  useEffect(() => {
    if (!isNotifOpen && !isOverflowOpen && !isWorkspaceModalOpen) return;
    updateDropdownAnchor();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsNotifOpen(false);
        setIsOverflowOpen(false);
        setIsWorkspaceModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isNotifOpen, isOverflowOpen, isWorkspaceModalOpen, setIsWorkspaceModalOpen]);

  const toggleLanguage = () => {
    updateSettings({ language: settings.language === 'ar' ? 'en' : 'ar' });
    setIsOverflowOpen(false);
  };

  const toggleTheme = () => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
    setIsOverflowOpen(false);
  };

  const handleRequestBrowserPermission = async () => {
    const res = await requestBrowserNotificationPermission();
    setNotifPermission(res);
    if (res === 'granted') {
      updateSettings({ notificationsEnabled: true });
    }
  };

  const handleNotificationClick = (item: AppNotificationItem) => {
    markNotificationRead(item.id);
    setIsNotifOpen(false);
    if (item.actionTarget === 'upgrade') {
      setIsUpgradeModalOpen(true);
    } else if (item.actionTarget === 'budget') {
      setActiveNav('budget');
    } else if (item.actionTarget === 'approvals') {
      openOrgHub('approvals');
    } else if (item.actionTarget === 'add') {
      setIsAddModalOpen(true);
    } else if (item.actionTarget === 'debts') {
      setActiveNav('more');
    }
  };

  const handleOrgSignIn = async () => {
    setIsSigningInOrg(true);
    setCreateOrgError(null);
    setJoinError(null);
    try {
      await signInWithGoogleAccount();
    } catch {
      const msg = isRTL ? 'تعذر تسجيل الدخول بحساب جوجل.' : 'Google sign-in failed.';
      setCreateOrgError(msg);
      setJoinError(msg);
    } finally {
      setIsSigningInOrg(false);
    }
  };

  const handleCreateOrgSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newOrgName.trim();
    if (!trimmed) return;
    setIsSubmittingOrg(true);
    setCreateOrgError(null);
    try {
      const vatParsed = parseLocalizedNumber(newOrgVat);
      const thresholdParsed = parseLocalizedNumber(newOrgThreshold);
      await createOrganization({
        name: trimmed,
        currency: newOrgCurrency,
        industry: newOrgIndustry,
        vatRate: Number.isFinite(vatParsed) && vatParsed >= 0 ? vatParsed : 14,
        taxNumber: newOrgTaxNumber.trim() || undefined,
        approvalThreshold: Number.isFinite(thresholdParsed) && thresholdParsed >= 0 ? thresholdParsed : 1000,
        loadSampleData: newOrgSample,
      });
      setNewOrgName('');
      setNewOrgTaxNumber('');
      setNewOrgIndustry('general');
      setShowCreateOrg(false);
      setIsWorkspaceModalOpen(false);
      setIsOverflowOpen(false);
    } catch (err: any) {
      setCreateOrgError(
        err?.message || (isRTL ? 'تعذر إنشاء المؤسسة السحابية.' : 'Failed to create cloud organization.')
      );
    } finally {
      setIsSubmittingOrg(false);
    }
  };

  const handleJoinOrgSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.isLoggedIn) {
      setJoinError(t('signInRequiredForCloudOrg'));
      return;
    }
    setJoinError(null);
    setIsSubmittingOrg(true);
    try {
      const res = await joinOrganizationByCode(inviteCodeInput.trim());
      if (!res.ok) {
        setJoinError(
          res.error ||
            (isRTL ? 'كود الدعوة غير صحيح أو منتهي الصلاحية.' : 'Invalid or expired invite code.')
        );
        return;
      }
      clearPendingJoinCode();
      setInviteCodeInput('');
      setShowJoinOrg(false);
      setIsWorkspaceModalOpen(false);
      setIsOverflowOpen(false);
    } catch (err: any) {
      setJoinError(
        err?.message || (isRTL ? 'تعذر الانضمام للمؤسسة.' : 'Failed to join organization.')
      );
    } finally {
      setIsSubmittingOrg(false);
    }
  };

  return (
    <>
      <header
        ref={headerRef}
        className="sticky top-0 z-30 w-full bg-[var(--color-bg)]/85 backdrop-blur-lg border-b border-[var(--color-line)]/80 px-3 sm:px-4 py-2 flex items-center justify-between gap-2 transition-all duration-300"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Left / Start: Brand Logo + Desktop Title + Smart Truncated Workspace Badge */}
        <div className="flex items-center gap-2 min-w-0">
          <BrandLogo className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover shadow-sm shrink-0" title={t('appName')} />
          <span
            data-testid="navbar-app-title"
            className="hidden sm:inline font-title text-base sm:text-lg font-bold text-[var(--color-ink)] leading-normal whitespace-nowrap"
          >
            {t('appName')}
          </span>

          <button
            type="button"
            data-testid="navbar-workspace-badge"
            onClick={openWorkspaceSelectorModal}
            aria-expanded={isWorkspaceModalOpen}
            title={
              isOrgWorkspace && activeOrganization
                ? activeOrganization.name
                : t('personalWorkspace')
            }
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all duration-300 min-h-[36px] max-w-[138px] sm:max-w-[175px] min-w-0 ${
              isWorkspaceModalOpen
                ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)] text-[var(--color-accent)] shadow-sm'
                : 'bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/15 border-[var(--color-accent)]/25 text-[var(--color-ink)]'
            }`}
          >
            {isOrgWorkspace ? (
              <Building2 className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
            ) : (
              <User className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
            )}
            <span data-testid="navbar-workspace-badge-label" className="truncate">
              {isOrgWorkspace && activeOrganization
                ? activeOrganization.name
                : t('personalWorkspace')}
            </span>
            {isOrgWorkspace && (
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isOrgLoading
                    ? 'bg-[var(--color-accent)] animate-pulse'
                    : orgSyncPendingWrites
                    ? 'bg-amber-500'
                    : 'bg-[var(--color-income)]'
                }`}
              />
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 text-[var(--color-muted)] shrink-0 transition-transform duration-300 ${
                isWorkspaceModalOpen ? 'rotate-180 text-[var(--color-accent)]' : ''
              }`}
            />
          </button>
        </div>

        {/* Right / End Controls: Notifications Bell + Currency Chip + Overflow Menu */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Notification Bell */}
          <button
            type="button"
            data-testid="navbar-notifications-btn"
            onClick={() => {
              updateDropdownAnchor();
              setIsOverflowOpen(false);
              setIsWorkspaceModalOpen(false);
              setIsNotifOpen((prev) => !prev);
            }}
            aria-label={t('notificationsCenter')}
            aria-expanded={isNotifOpen}
            className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors duration-300 min-h-[38px] min-w-[38px] relative ${
              isNotifOpen
                ? 'bg-[var(--color-surface)] border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-expense)] text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
              </span>
            )}
          </button>

          {/* Currency Switcher Chip */}
          <button
            type="button"
            data-testid="navbar-currency-btn"
            onClick={() => {
              setIsNotifOpen(false);
              setIsOverflowOpen(false);
              setIsWorkspaceModalOpen(false);
              openCurrencyPicker(
                (code) => {
                  updateSettings({ mainCurrency: code });
                  showToast(
                    isRTL
                      ? `تم تغيير عملة العرض الرئيسية إلى ${code}`
                      : `Display currency changed to ${code}`,
                    'success'
                  );
                },
                settings.mainCurrency
              );
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-colors duration-300 min-h-[38px] cursor-pointer"
            title={t('mainCurrency')}
            aria-label={t('mainCurrency')}
          >
            <span className="text-sm leading-none">{currentCurrency.flag}</span>
            <span className="font-mono text-[var(--color-accent)] font-bold">
              {currentCurrency.code}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-[var(--color-muted)]" />
          </button>

          {/* Single Overflow Menu Trigger */}
          <button
            type="button"
            data-testid="navbar-overflow-btn"
            onClick={() => {
              updateDropdownAnchor();
              setIsNotifOpen(false);
              setIsWorkspaceModalOpen(false);
              setIsOverflowOpen((prev) => !prev);
            }}
            aria-expanded={isOverflowOpen}
            className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors duration-300 min-h-[38px] min-w-[38px] relative ${
              isOverflowOpen || hasActiveFilters
                ? 'bg-[var(--color-surface)] border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
            aria-label={isRTL ? 'خيارات إضافية' : 'More options'}
          >
            <MoreVertical className="w-4 h-4" />
            {(hasActiveFilters || hasSyncAlert) && (
              <span
                className={`absolute top-1 end-1 w-2 h-2 rounded-full ${
                  hasSyncAlert
                    ? 'bg-[var(--color-expense)]'
                    : 'bg-[var(--color-accent)]'
                }`}
              />
            )}
          </button>
        </div>
      </header>

      {/* Isolated Backdrop + Floating Header Popovers (Notifications & Overflow) */}
      {(isNotifOpen || isOverflowOpen) && (
        <>
          <div
            data-testid="navbar-dropdown-backdrop"
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[1px] transition-opacity duration-200 animate-in fade-in"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsNotifOpen(false);
              setIsOverflowOpen(false);
            }}
          />

          <div
            className="fixed inset-x-0 z-50 pointer-events-none flex justify-center px-3 sm:px-4"
            style={{ top: `${dropdownTop}px` }}
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            <div className="w-full max-w-lg md:max-w-2xl lg:max-w-4xl flex justify-end">
              {/* Notifications Center Popover */}
              {isNotifOpen && (
                <div
                  data-testid="navbar-notifications-dropdown"
                  onClick={(e) => e.stopPropagation()}
                  className="pointer-events-auto w-full max-w-sm sm:w-80 bg-white dark:bg-[#17231E] border border-[var(--color-line)] rounded-2xl shadow-xl overflow-hidden transition-all duration-200 animate-in fade-in zoom-in-95"
                >
                  <div className="px-3 py-2.5 border-b border-[var(--color-line)] flex items-center justify-between bg-[var(--color-surface-subtle)]">
                    <span className="text-xs font-bold text-[var(--color-ink)]">
                      {t('notificationsCenter')}
                    </span>
                    {unreadNotificationsCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllNotificationsRead}
                        className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline flex items-center gap-1"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>{t('markAllRead')}</span>
                      </button>
                    )}
                  </div>

                  {/* Browser Push Notification Permission Prompt */}
                  {isWebNotificationSupported() && notifPermission === 'default' && (
                    <div className="p-2.5 bg-[var(--color-accent)]/10 border-b border-[var(--color-line)] flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[var(--color-ink)]">
                        {isRTL ? 'تفعيل إشعارات المتصفح للتنبيهات؟' : 'Enable browser alerts?'}
                      </span>
                      <button
                        type="button"
                        onClick={handleRequestBrowserPermission}
                        className="px-2.5 py-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-semibold shrink-0"
                      >
                        {isRTL ? 'تفعيل' : 'Enable'}
                      </button>
                    </div>
                  )}

                  <div className="max-h-72 overflow-y-auto divide-y divide-[var(--color-line)]">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[var(--color-muted)]">
                        {t('noNotifications')}
                      </div>
                    ) : (
                      notifications.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleNotificationClick(item)}
                          className={`w-full p-3 text-start hover:bg-[var(--color-bg)] transition-colors flex items-start gap-2.5 ${
                            !item.read ? 'bg-[var(--color-accent)]/[0.04]' : ''
                          }`}
                        >
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                              item.severity === 'danger'
                                ? 'bg-[var(--color-expense)]/15 text-[var(--color-expense)]'
                                : item.severity === 'warning'
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                : 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                            }`}
                          >
                            {item.severity === 'info' ? (
                              <Bell className="w-3.5 h-3.5" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-semibold text-[var(--color-ink)] truncate">
                                {isRTL ? item.titleAr : item.titleEn}
                              </span>
                              {!item.read && (
                                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] shrink-0" />
                              )}
                            </div>
                            <p className="text-[11px] text-[var(--color-muted)] mt-0.5 leading-snug">
                              {isRTL ? item.messageAr : item.messageEn}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Overflow 3-Dot Dropdown Menu (Quick Actions Only) */}
              {isOverflowOpen && (
                <div
                  data-testid="navbar-overflow-dropdown"
                  onClick={(e) => e.stopPropagation()}
                  className="pointer-events-auto w-64 sm:w-72 max-h-[calc(100vh-84px)] overflow-y-auto bg-white dark:bg-[#17231E] border border-[var(--color-line)] rounded-2xl shadow-xl py-1.5 divide-y divide-[var(--color-line)] transition-all duration-200 animate-in fade-in zoom-in-95"
                >
                  {/* Section 1: Filter & Quick Backup */}
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsFilterOpen(true);
                        setIsOverflowOpen(false);
                      }}
                      className="w-full px-3 py-2 text-xs flex items-center justify-between text-[var(--color-ink)] hover:bg-[var(--color-bg)] transition-colors text-start min-h-[40px]"
                    >
                      <div className="flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4 text-[var(--color-muted)]" />
                        <span>{t('filter')}</span>
                      </div>
                      {hasActiveFilters && (
                        <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsBackupOpen(true);
                        setIsOverflowOpen(false);
                      }}
                      className="w-full px-3 py-2 text-xs flex items-center justify-between text-[var(--color-ink)] hover:bg-[var(--color-bg)] transition-colors text-start min-h-[40px]"
                    >
                      <div className="flex items-center gap-2">
                        <Save className="w-4 h-4 text-[var(--color-muted)]" />
                        <span>{t('quickSave')}</span>
                      </div>
                      {hasSyncAlert && (
                        <span className="text-[10px] font-semibold text-[var(--color-expense)]">
                          {isRTL ? 'خطأ' : 'Sync'}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Section 3: Language & Theme */}
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={toggleLanguage}
                      className="w-full px-3 py-2 text-xs flex items-center justify-between text-[var(--color-ink)] hover:bg-[var(--color-bg)] transition-colors text-start min-h-[40px]"
                    >
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-[var(--color-muted)]" />
                        <span>{isRTL ? 'اللغة' : 'Language'}</span>
                      </div>
                      <span className="text-[11px] font-semibold text-[var(--color-muted)] font-mono">
                        {settings.language === 'ar' ? 'English' : 'عربي'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={toggleTheme}
                      className="w-full px-3 py-2 text-xs flex items-center justify-between text-[var(--color-ink)] hover:bg-[var(--color-bg)] transition-colors text-start min-h-[40px]"
                    >
                      <div className="flex items-center gap-2">
                        {settings.theme === 'dark' ? (
                          <Sun className="w-4 h-4 text-[var(--color-muted)]" />
                        ) : (
                          <Moon className="w-4 h-4 text-[var(--color-muted)]" />
                        )}
                        <span>{isRTL ? 'المظهر' : 'Theme'}</span>
                      </div>
                      <span className="text-[11px] font-medium text-[var(--color-muted)]">
                        {settings.theme === 'dark' ? (isRTL ? 'فاتح' : 'Light') : isRTL ? 'داكن' : 'Dark'}
                      </span>
                    </button>
                  </div>

                  {/* Section 4: PRO / Admin & Settings */}
                  <div className="py-1">
                    {canUserAccessAdminPanelUi({
                      isAdminUser,
                      authUser: auth.currentUser
                        ? {
                            uid: auth.currentUser.uid,
                            email: resolveFirebaseUserEmail(auth.currentUser),
                            emailVerified: auth.currentUser.emailVerified,
                            providerData: auth.currentUser.providerData,
                          }
                        : null,
                      appUser: user,
                    }) ? (
                      <button
                        type="button"
                        data-testid="navbar-admin-panel-btn"
                        onClick={() => {
                          openAdminPanel();
                          setIsOverflowOpen(false);
                        }}
                        className="w-full px-3 py-2 text-xs flex items-center justify-between text-[var(--color-accent)] font-semibold hover:bg-[var(--color-bg)] transition-colors text-start min-h-[40px]"
                      >
                        <div className="flex items-center gap-2">
                          <KeyRound className="w-4 h-4 shrink-0" />
                          <span>{isRTL ? 'لوحة إدارة الاشتراكات' : 'Admin Subscriptions Panel'}</span>
                        </div>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setIsUpgradeModalOpen(true);
                          setIsOverflowOpen(false);
                        }}
                        className="w-full px-3 py-2 text-xs flex items-center justify-between text-[var(--color-accent)] font-semibold hover:bg-[var(--color-bg)] transition-colors text-start min-h-[40px]"
                      >
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4" />
                          <span>
                            {isBusinessPro ? (
                              isRTL ? (
                                <>
                                  باقة <bdi dir="ltr">Business PRO</bdi>
                                </>
                              ) : (
                                'Business PRO'
                              )
                            ) : isPro ? (
                              isRTL ? (
                                <>
                                  حساب <bdi dir="ltr">PRO</bdi> مفعّل
                                </>
                              ) : (
                                'PRO Active'
                              )
                            ) : isRTL ? (
                              <>
                                ترقية لـ <bdi dir="ltr">PRO</bdi>
                              </>
                            ) : (
                              'Upgrade PRO'
                            )}
                          </span>
                        </div>
                        {!isPro && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                            {isRTL ? 'مزايا' : 'New'}
                          </span>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setIsSettingsOpen(true);
                        setIsOverflowOpen(false);
                      }}
                      className="w-full px-3 py-2 text-xs flex items-center gap-2 text-[var(--color-ink)] hover:bg-[var(--color-bg)] transition-colors text-start min-h-[40px]"
                    >
                      <SettingsIcon className="w-4 h-4 text-[var(--color-muted)]" />
                      <span>{t('settings')}</span>
                    </button>
                  </div>

                  {/* Section 5: Sign Out */}
                  <div className="py-1">
                    <button
                      type="button"
                      data-testid="navbar-signout-btn"
                      onClick={() => {
                        setIsOverflowOpen(false);
                        setIsWorkspaceModalOpen(false);
                        setIsLogoutModalOpen(true);
                      }}
                      className="w-full px-3 py-2 text-xs flex items-center gap-2 text-[var(--color-expense)] font-semibold hover:bg-[var(--color-expense)]/10 transition-colors text-start min-h-[42px]"
                    >
                      <LogOut className="w-4 h-4 shrink-0" />
                      <span>
                        {user?.isLoggedIn
                          ? isRTL
                            ? 'تسجيل الخروج'
                            : 'Sign Out'
                          : isRTL
                          ? 'خروج ومسح بيانات الزائر'
                          : 'Exit Guest & Wipe Device'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Contextual Cloud Org / Migration / Read-only Banners */}
      {orgMigrationSuccessMessage && (
        <div
          dir={isRTL ? 'rtl' : 'ltr'}
          className="px-3 py-2 bg-[var(--color-income)]/12 border-b border-[var(--color-income)]/30 text-[11px] text-[var(--color-income)] flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate font-semibold">{orgMigrationSuccessMessage}</span>
          </div>
          <button
            type="button"
            onClick={clearOrgMigrationSuccessMessage}
            aria-label={t('close')}
            className="p-1 rounded hover:bg-[var(--color-income)]/15 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {orgActionError && (
        <div
          dir={isRTL ? 'rtl' : 'ltr'}
          className="px-3 py-2 bg-[var(--color-expense)]/12 border-b border-[var(--color-expense)]/30 text-[11px] text-[var(--color-expense)] flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate font-semibold">{orgActionError}</span>
          </div>
          <button
            type="button"
            onClick={clearOrgActionError}
            aria-label={t('close')}
            className="p-1 rounded hover:bg-[var(--color-expense)]/15 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isOrgWorkspace && isOrgReadOnly && (
        <div
          dir={isRTL ? 'rtl' : 'ltr'}
          className="px-3 py-2 bg-amber-500/12 border-b border-amber-500/30 text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2"
        >
          <span className="font-semibold leading-snug">{t('orgReadOnlyBanner')}</span>
          <button
            type="button"
            onClick={() => setIsUpgradeModalOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[10px] font-bold shrink-0"
          >
            {isRTL ? 'ترقية الباقة' : 'Upgrade'}
          </button>
        </div>
      )}

      {subscriptionSummary.isExpiringSoon &&
        !subscriptionSummary.isAdminOverride &&
        subscriptionSummary.daysRemaining !== null && (
          <div
            data-testid="subscription-expiry-banner"
            dir={isRTL ? 'rtl' : 'ltr'}
            className="px-3 py-2 bg-amber-500/12 border-b border-amber-500/30 text-[11px] text-amber-800 dark:text-amber-300 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-1.5 min-w-0 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {isRTL
                  ? `تنبيه: باقتك (${subscriptionSummary.isBusinessPro ? 'Business PRO' : 'Personal PRO'}) تنتهي خلال ${subscriptionSummary.daysRemaining} أيام`
                  : `Reminder: Your ${subscriptionSummary.isBusinessPro ? 'Business PRO' : 'Personal PRO'} plan expires in ${subscriptionSummary.daysRemaining} day(s)`}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsUpgradeModalOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[10px] font-bold"
              >
                {isRTL ? 'تجديد الاشتراك' : 'Renew'}
              </button>
              <button
                type="button"
                onClick={() => setIsUpgradeModalOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-[var(--color-surface)] border border-amber-500/40 text-amber-800 dark:text-amber-200 text-[10px] font-bold"
              >
                {isRTL ? 'تغيير الباقة' : 'Change Plan'}
              </button>
            </div>
          </div>
        )}

      {!isOrgWorkspace && legacyLocalOrgs.length > 0 && (
        <div
          dir={isRTL ? 'rtl' : 'ltr'}
          className="px-3 py-2 bg-[var(--color-accent)]/10 border-b border-[var(--color-accent)]/25 text-[11px] text-[var(--color-ink)] flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <UploadCloud className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
            <span className="truncate font-medium">
              {isRTL
                ? `يوجد ${legacyLocalOrgs.length} مؤسسة محلية جاهزة للترحيل إلى السحابة`
                : `${legacyLocalOrgs.length} local org(s) ready for Cloud Migration`}
            </span>
          </div>
          <button
            type="button"
            onClick={openOrgMigrationModal}
            className="px-2.5 py-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[10px] font-bold shrink-0"
          >
            {isRTL ? 'ترحيل الآن' : 'Migrate'}
          </button>
        </div>
      )}

      {/* Standalone Workspace Selector Modal / Bottom Sheet */}
      {isWorkspaceModalOpen && (
        <div
          data-testid="workspace-selector-backdrop"
          onClick={() => setIsWorkspaceModalOpen(false)}
          dir={isRTL ? 'rtl' : 'ltr'}
          className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
        >
          <div
            data-testid="workspace-selector-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-selector-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-white dark:bg-[#17231E] border border-[var(--color-line)] rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
          >
            {/* Mobile Bottom Sheet Handle */}
            <div className="sm:hidden flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1 rounded-full bg-[var(--color-line)]" />
            </div>

            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent)] flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="workspace-selector-title"
                    className="font-title text-base font-bold text-[var(--color-ink)] truncate"
                  >
                    {isRTL ? 'اختر مساحة العمل' : 'Select Workspace'}
                  </h2>
                  <p className="text-[11px] text-[var(--color-muted)] truncate">
                    {isRTL
                      ? 'بدّل بين حسابك الشخصي ومؤسساتك بضغطة واحدة'
                      : 'Switch seamlessly between personal ledger and organizations'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="workspace-modal-close-btn"
                onClick={() => setIsWorkspaceModalOpen(false)}
                aria-label={t('close')}
                className="w-8 h-8 rounded-lg border border-[var(--color-line)] bg-white dark:bg-[#1E2E27] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Workspace Choices */}
            <div className="max-h-[55vh] overflow-y-auto p-3 space-y-2">
              {/* Personal Workspace Option */}
              <button
                type="button"
                data-testid="workspace-modal-personal-btn"
                onClick={() => {
                  switchWorkspace('personal');
                  setIsWorkspaceModalOpen(false);
                }}
                className={`w-full p-3 rounded-xl border text-start flex items-center justify-between gap-3 transition-all duration-200 min-h-[56px] ${
                  activeWorkspace === 'personal'
                    ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-accent)] shadow-xs'
                    : 'bg-white dark:bg-[#1E2E27] border-[var(--color-line)] text-[var(--color-ink)] hover:border-[var(--color-accent)]/50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      activeWorkspace === 'personal'
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                        : 'bg-[var(--color-surface-subtle)] text-[var(--color-muted)]'
                    }`}
                  >
                    <User className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[var(--color-ink)] truncate">
                      {t('personalWorkspace')}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)] truncate mt-0.5">
                      {isRTL ? 'حساب شخصي مشفر ومعزول' : 'Personal encrypted ledger'}
                    </div>
                  </div>
                </div>
                {activeWorkspace === 'personal' && (
                  <div className="w-6 h-6 rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                )}
              </button>

              {/* Organizations List */}
              {organizationsList.map((org) => {
                const active = activeWorkspace === org.id;
                const perm = resolveWorkspaceOrgPermissions({
                  org,
                  orgRefs,
                  localOrgWorkspaces,
                  currentUserId: user?.id,
                  activeWorkspace,
                  activeOrgRole,
                });
                return (
                  <div
                    key={org.id}
                    className={`w-full rounded-xl border flex items-center justify-between gap-1 transition-all duration-200 min-h-[56px] ${
                      active
                        ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-accent)] shadow-xs'
                        : 'bg-white dark:bg-[#1E2E27] border-[var(--color-line)] text-[var(--color-ink)] hover:border-[var(--color-accent)]/50'
                    }`}
                  >
                    <button
                      type="button"
                      data-testid={`workspace-modal-org-${org.id}`}
                      onClick={() => {
                        switchWorkspace(org.id);
                        setIsWorkspaceModalOpen(false);
                      }}
                      className="flex-1 min-w-0 p-3 text-start flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            active
                              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                              : 'bg-[var(--color-surface-subtle)] text-[var(--color-muted)]'
                          }`}
                        >
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-bold text-[var(--color-ink)] truncate">
                              {org.name}
                            </span>
                            {perm.role ? (
                              <span
                                data-testid={active ? 'workspace-modal-role-badge' : undefined}
                                className="px-1.5 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-bold text-[9px] shrink-0"
                              >
                                {roleLabels[perm.role][isRTL ? 'ar' : 'en']}
                              </span>
                            ) : perm.isLocalOnly ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold text-[9px] shrink-0">
                                {isRTL ? 'محلية' : 'Local'}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-[var(--color-muted)] truncate mt-0.5 flex items-center gap-1.5">
                            <span className="font-mono font-semibold">{org.currency}</span>
                            <span>•</span>
                            <span>{isRTL ? 'مساحة مؤسسة' : 'Enterprise'}</span>
                          </div>
                        </div>
                      </div>
                      {active && (
                        <div className="w-6 h-6 rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] flex items-center justify-center shrink-0">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      )}
                    </button>

                    {perm.canDelete && (
                      <div className="pe-2 shrink-0 flex items-center">
                        <button
                          type="button"
                          data-testid={`workspace-modal-delete-org-${org.id}`}
                          aria-label={
                            isRTL ? `حذف مساحة العمل ${org.name}` : `Delete workspace ${org.name}`
                          }
                          title={isRTL ? 'حذف مساحة العمل' : 'Delete workspace'}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteWorkspaceError(null);
                            setDeleteTargetOrg(org);
                          }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-rose-500/75 hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer Quick Actions */}
            <div className="p-3 border-t border-[var(--color-line)] bg-[var(--color-surface-subtle)] flex flex-col sm:grid sm:grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="workspace-modal-create-org-btn"
                onClick={() => {
                  setIsWorkspaceModalOpen(false);
                  setShowCreateOrg(true);
                }}
                className="px-3 py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-1.5 min-h-[42px] hover:opacity-95"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span className="truncate">{t('createOrganization')}</span>
              </button>
              <button
                type="button"
                data-testid="workspace-modal-join-org-btn"
                onClick={() => {
                  setJoinError(null);
                  setIsWorkspaceModalOpen(false);
                  setShowJoinOrg(true);
                }}
                className="px-3 py-2.5 rounded-xl bg-white dark:bg-[#1E2E27] border border-[var(--color-line)] text-[var(--color-ink)] text-xs font-semibold flex items-center justify-center gap-1.5 min-h-[42px] hover:border-[var(--color-accent)]"
              >
                <KeyRound className="w-4 h-4 text-[var(--color-muted)] shrink-0" />
                <span className="truncate">{t('joinOrganization')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workspace Permanent Delete Confirmation Modal */}
      {deleteTargetOrg && (
        <div
          data-testid="workspace-delete-confirm-backdrop"
          onClick={() => {
            if (!isDeletingWorkspace) setDeleteTargetOrg(null);
          }}
          dir={isRTL ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            data-testid="workspace-delete-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-delete-confirm-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-[#17231E] border border-[var(--color-expense)]/40 rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h3
                  id="workspace-delete-confirm-title"
                  className="font-title text-sm font-bold text-[var(--color-ink)]"
                >
                  {isRTL ? 'تأكيد حذف مساحة العمل' : 'Confirm Workspace Deletion'}
                </h3>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {formatWorkspaceDeleteConfirmMessage(deleteTargetOrg.name, isRTL)}
                </p>
              </div>
            </div>

            {deleteWorkspaceError && (
              <div className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-300 font-medium">
                {deleteWorkspaceError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                data-testid="workspace-delete-cancel-btn"
                disabled={isDeletingWorkspace}
                onClick={() => {
                  setDeleteTargetOrg(null);
                  setDeleteWorkspaceError(null);
                }}
                className="px-4 py-2 rounded-xl border border-[var(--color-line)] bg-white dark:bg-[#1E2E27] text-xs font-semibold text-[var(--color-ink)] min-h-[40px] disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                data-testid="workspace-delete-confirm-btn"
                disabled={isDeletingWorkspace}
                onClick={async () => {
                  if (!deleteTargetOrg) return;
                  setIsDeletingWorkspace(true);
                  setDeleteWorkspaceError(null);
                  try {
                    await deleteOrganization(deleteTargetOrg.name, deleteTargetOrg.id);
                    setDeleteTargetOrg(null);
                  } catch (err: any) {
                    setDeleteWorkspaceError(
                      err?.message ||
                        (isRTL
                          ? 'تعذر حذف مساحة العمل حالياً.'
                          : 'Failed to delete workspace.')
                    );
                  } finally {
                    setIsDeletingWorkspace(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold min-h-[40px] flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeletingWorkspace && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isRTL ? 'حذف نهائياً' : 'Delete Permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Organization Modal */}
      {showCreateOrg && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleCreateOrgSubmit}
            dir={isRTL ? 'rtl' : 'ltr'}
            className="w-full max-w-sm bg-white dark:bg-[#17231E] border border-[var(--color-line)] rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[var(--color-accent)]" />
                <h2 className="font-title text-base font-bold text-[var(--color-ink)]">
                  {t('createOrganization')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateOrg(false)}
                aria-label={isRTL ? 'إغلاق' : 'Close'}
                className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!user?.isLoggedIn && (
              <div className="p-3 rounded-xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 space-y-2 text-xs">
                <p className="text-[var(--color-ink)] font-medium leading-relaxed">
                  {isRTL
                    ? 'يمكنك إنشاء المؤسسة والبدء فوراً محلياً، أو تسجيل الدخول بجوجل للمزامنة السحابية ومشاركة الفريق.'
                    : 'Create your organization locally right away, or sign in with Google for cloud sync & team collaboration.'}
                </p>
                <button
                  type="button"
                  disabled={isSigningInOrg}
                  onClick={() => void handleOrgSignIn()}
                  className="w-full py-2 px-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] text-xs font-bold flex items-center justify-center gap-2 min-h-[38px] disabled:opacity-50 hover:border-[var(--color-accent)]"
                >
                  {isSigningInOrg ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4 text-[var(--color-accent)]" />
                  )}
                  <span>
                    {isRTL ? 'تسجيل الدخول بحساب جوجل (اختياري)' : 'Sign in with Google (Optional)'}
                  </span>
                </button>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                  {t('orgName')}
                </label>
                <input
                  type="text"
                  required
                  disabled={isSubmittingOrg}
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder={isRTL ? 'مثال: شركة النور للتجارة' : 'e.g. Al-Noor Trading Co.'}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px] disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {t('mainCurrency')}
                  </label>
                  <select
                    disabled={isSubmittingOrg}
                    value={newOrgCurrency}
                    onChange={(e) => setNewOrgCurrency(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px] disabled:opacity-60"
                  >
                    {['EGP', 'SAR', 'AED', 'KWD', 'BHD', 'OMR', 'JOD', 'USD', 'EUR'].map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {t('vatRate')} (%)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    disabled={isSubmittingOrg}
                    value={newOrgVat}
                    onChange={(e) => setNewOrgVat(normalizeArabicPersianNumerals(e.target.value))}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px] disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {t('taxNumber')}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    disabled={isSubmittingOrg}
                    value={newOrgTaxNumber}
                    onChange={(e) => setNewOrgTaxNumber(e.target.value)}
                    placeholder="TRN-..."
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px] disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                    {isRTL ? 'سقف الاعتماد التلقائي' : 'Approval Threshold'}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    disabled={isSubmittingOrg}
                    value={newOrgThreshold}
                    onChange={(e) => setNewOrgThreshold(normalizeArabicPersianNumerals(e.target.value))}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px] disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                  {t('industryLabel')}
                </label>
                <select
                  disabled={isSubmittingOrg}
                  value={newOrgIndustry}
                  onChange={(e) => setNewOrgIndustry(e.target.value as OrganizationIndustry)}
                  data-testid="create-org-industry-select"
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[44px] disabled:opacity-60"
                >
                  <option value="general">{t('industryGeneral')}</option>
                  <option value="retail">{t('industryRetail')}</option>
                  <option value="restaurant">{t('industryRestaurant')}</option>
                  <option value="tech">{t('industryTech')}</option>
                  <option value="construction">{t('industryConstruction')}</option>
                  <option value="medical">{t('industryMedical')}</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-xs text-[var(--color-ink)] cursor-pointer pt-1">
                <input
                  type="checkbox"
                  disabled={isSubmittingOrg}
                  checked={newOrgSample}
                  onChange={(e) => setNewOrgSample(e.target.checked)}
                  className="rounded border-[var(--color-line)] accent-[var(--color-accent)] w-4 h-4"
                />
                <span>
                  {isRTL
                    ? 'إضافة ميزانيات تقديرية مبدئية لمراكز التكلفة'
                    : 'Include sample budgets for cost centers'}
                </span>
              </label>

              <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
                <Cloud className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                <span>
                  {isRTL
                    ? 'يتم حفظ بيانات الشركة محلياً أولاً مع مزامنة سحابية تلقائية عند تسجيل الدخول وتجربة 14 يوماً.'
                    : 'Local-first workspace with automatic cloud backup when signed in & 14-day Business trial.'}
                </span>
              </div>
            </div>

            {createOrgError && (
              <p className="text-[11px] text-[var(--color-expense)] font-medium">{createOrgError}</p>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                disabled={isSubmittingOrg}
                onClick={() => setShowCreateOrg(false)}
                className="px-4 py-2.5 rounded-xl border border-[var(--color-line)] text-xs font-semibold text-[var(--color-muted)] min-h-[44px]"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmittingOrg}
                className="flex-1 py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmittingOrg && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{t('createOrganization')}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Join Organization Modal */}
      {showJoinOrg && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleJoinOrgSubmit}
            dir={isRTL ? 'rtl' : 'ltr'}
            className="w-full max-w-sm bg-white dark:bg-[#17231E] border border-[var(--color-line)] rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[var(--color-accent)]" />
                <h2 className="font-title text-base font-bold text-[var(--color-ink)]">
                  {t('joinOrganization')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowJoinOrg(false);
                  clearPendingJoinCode();
                }}
                aria-label={isRTL ? 'إغلاق' : 'Close'}
                className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!user?.isLoggedIn && (
              <div className="p-3 rounded-xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 space-y-2 text-xs">
                <p className="text-[var(--color-ink)] font-medium leading-relaxed">
                  {t('signInRequiredForCloudOrg')}
                </p>
                <button
                  type="button"
                  disabled={isSigningInOrg}
                  onClick={() => void handleOrgSignIn()}
                  className="w-full py-2 px-3 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-2 min-h-[40px] disabled:opacity-50"
                >
                  {isSigningInOrg ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" />
                  )}
                  <span>
                    {isRTL ? 'تسجيل الدخول بحساب جوجل' : 'Sign in with Google'}
                  </span>
                </button>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[var(--color-muted)] mb-1">
                {t('inviteCode')}
              </label>
              <input
                type="text"
                required
                dir="ltr"
                disabled={!user?.isLoggedIn || isSubmittingOrg}
                value={inviteCodeInput}
                onChange={(e) => {
                  setInviteCodeInput(e.target.value.toUpperCase());
                  setJoinError(null);
                }}
                placeholder="RSD-XXXX-XXXX"
                className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs font-mono text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px] disabled:opacity-60"
              />
              {joinError && (
                <p className="text-[11px] text-[var(--color-expense)] mt-1.5">{joinError}</p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isSubmittingOrg}
                onClick={() => {
                  setShowJoinOrg(false);
                  clearPendingJoinCode();
                }}
                className="px-4 py-2.5 rounded-xl border border-[var(--color-line)] text-xs font-semibold text-[var(--color-muted)] min-h-[44px]"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={!user?.isLoggedIn || isSubmittingOrg}
                className="flex-1 py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmittingOrg && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{t('joinOrganization')}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
