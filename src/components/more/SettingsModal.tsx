import React, { useEffect, useMemo, useState } from 'react';
import {
  Settings as SettingsIcon,
  Moon,
  Sun,
  Monitor,
  Lock,
  Bell,
  Trash2,
  UserX,
  X,
  Building2,
  LockKeyhole,
  Coins,
  RefreshCw,
  RotateCcw,
  LogOut,
  CloudDownload,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  AtSign,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  formatUsernameHandle,
  normalizeUsername,
  validateUsernameFormat,
} from '../../services/usernameService';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { hashPin } from '../../services/security';
import { auth, resolveFirebaseUserEmail } from '../../services/firebase';
import { canUserAccessAdminPanelUi } from '../../services/adminAuth';
import { getForceCloudSyncAvailability } from '../../services/workspaceSync';
import {
  CURRENCIES,
  getCurrency,
  getEffectiveCurrencyRate,
  getLiveExchangeRatesRuntime,
} from '../../services/currency';
import { normalizeArabicPersianNumerals, parseLocalizedNumber } from '../../services/numbers';
import {
  isWebNotificationSupported,
  requestBrowserNotificationPermission,
} from '../../services/notifications';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    settings,
    wallets,
    user,
    isPro,
    isAdminUser,
    openAdminPanel,
    updateSettings,
    resetAllData,
    deleteAccountAndData,
    reauthenticateGoogleAccount,
    isOrgWorkspace,
    activeOrganization,
    canOrgManage,
    updateOrganizationSettings,
    lockAccountingPeriod,
    ratesLastUpdated,
    isRefreshingRates,
    refreshExchangeRates,
    setIsLogoutModalOpen,
    emergencyCloudRecovery,
    isCloudSyncing,
    cloudDiagnosticsError,
    clearCloudDiagnosticsError,
    checkUsernameAvailable,
    updateUsername,
    t,
    isRTL,
  } = useApp();

  const canAccessAdminPanel = canUserAccessAdminPanelUi({
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
  });

  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [confirmForceCloudSync, setConfirmForceCloudSync] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const forceSyncAvailability = getForceCloudSyncAvailability({
    isLoggedIn: Boolean(user?.isLoggedIn),
    isOnline,
    isCloudSyncing,
  });
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [needsRecentReauth, setNeedsRecentReauth] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [showPinInput, setShowPinInput] = useState(false);
  const [notifPerm, setNotifPerm] = useState<string>(() =>
    isWebNotificationSupported() ? Notification.permission : 'unsupported'
  );
  const [lockDateInput, setLockDateInput] = useState(activeOrganization?.lockedUntilDate || '');
  const [orgVatDraft, setOrgVatDraft] = useState(String(activeOrganization?.vatRate ?? 14));
  const [orgThresholdDraft, setOrgThresholdDraft] = useState(
    String(activeOrganization?.approvalThreshold ?? 0)
  );
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  const [extraRateCodes, setExtraRateCodes] = useState<string[]>([]);
  const [rateSyncFeedback, setRateSyncFeedback] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);
  const [emergencyFeedback, setEmergencyFeedback] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);
  const [usernameDraft, setUsernameDraft] = useState(user?.username || '');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState(false);
  const [usernameFeedback, setUsernameFeedback] = useState<{
    text: string;
    type: 'ok' | 'error' | 'info';
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLockDateInput(activeOrganization?.lockedUntilDate || '');
    setOrgVatDraft(String(activeOrganization?.vatRate ?? 14));
    setOrgThresholdDraft(String(activeOrganization?.approvalThreshold ?? 0));
    setRateDrafts({});
    setRateSyncFeedback(null);
    setEmergencyFeedback(null);
    setUsernameDraft(user?.username || '');
    setUsernameFeedback(null);
    setCopiedUsername(false);
  }, [
    isOpen,
    activeOrganization?.id,
    activeOrganization?.lockedUntilDate,
    user?.username,
  ]);

  const editableCurrencyCodes = useMemo(() => {
    const base = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'EUR', 'GBP', 'TRY'];
    const set = new Set<string>([
      settings.mainCurrency,
      ...wallets.map((w) => w.currency),
      ...Object.keys(settings.customExchangeRates || {}),
      ...extraRateCodes,
      ...base,
    ]);
    set.delete('USD'); // USD is always 1.0 base
    return Array.from(set).filter(Boolean);
  }, [settings.mainCurrency, settings.customExchangeRates, wallets, extraRateCodes]);

  const availableAddRateCurrencies = useMemo(() => {
    const existing = new Set(['USD', ...editableCurrencyCodes]);
    return CURRENCIES.filter((c) => !existing.has(c.code));
  }, [editableCurrencyCodes]);

  if (!isOpen) return null;

  const liveRuntimeRates = getLiveExchangeRatesRuntime();
  const hasCustomRates = Object.keys(settings.customExchangeRates || {}).length > 0;

  const handleManualRateChange = (code: string, rawVal: string) => {
    const normalized = normalizeArabicPersianNumerals(rawVal);
    setRateDrafts((prev) => ({ ...prev, [code]: normalized }));
    if (!normalized.trim()) {
      const next = { ...(settings.customExchangeRates || {}) };
      delete next[code];
      updateSettings({ customExchangeRates: next });
      return;
    }
    const parsed = parseLocalizedNumber(normalized);
    if (!Number.isNaN(parsed) && parsed > 0) {
      updateSettings({
        customExchangeRates: {
          ...(settings.customExchangeRates || {}),
          [code]: parsed,
        },
      });
    }
  };

  const handleResetSingleRate = (code: string) => {
    setRateDrafts((prev) => {
      const copy = { ...prev };
      delete copy[code];
      return copy;
    });
    if (settings.customExchangeRates?.[code] !== undefined) {
      const next = { ...(settings.customExchangeRates || {}) };
      delete next[code];
      updateSettings({ customExchangeRates: next });
    }
  };

  const handleResetAllCustomRates = () => {
    setRateDrafts({});
    updateSettings({ customExchangeRates: {} });
  };

  const handleRefreshRatesNow = async () => {
    setRateSyncFeedback(null);
    if (!settings.useUpdatedExchangeRates) {
      updateSettings({ useUpdatedExchangeRates: true });
    }
    const ok = await refreshExchangeRates(true);
    setRateDrafts({});
    setRateSyncFeedback(
      ok
        ? {
            text: isRTL
              ? 'تم تحديث أسعار الصرف المباشرة وحفظها في السحابة والجهاز.'
              : 'Live exchange rates updated and synced to cloud & device.',
          }
        : {
            text: isRTL
              ? 'تعذر جلب أحدث الأسعار، سيتم استخدام آخر أسعار محفوظة.'
              : 'Could not fetch latest rates, using last saved rates.',
            isError: true,
          }
    );
  };

  const handleSavePin = async () => {
    if (pinInput.length !== 4) return;
    const { hash, salt } = await hashPin(pinInput);
    updateSettings({ isAppLockEnabled: true, appPin: hash, appPinSalt: salt });
    setShowPinInput(false);
    setPinInput('');
  };

  const handleCheckUsernameAvailability = async () => {
    const normalized = normalizeUsername(usernameDraft);
    const fmt = validateUsernameFormat(normalized);
    if (!fmt.valid) {
      setUsernameFeedback({
        text: isRTL ? fmt.errorAr || '' : fmt.errorEn || '',
        type: 'error',
      });
      return;
    }
    setIsCheckingUsername(true);
    setUsernameFeedback(null);
    try {
      const res = await checkUsernameAvailable(normalized);
      if (res.available) {
        setUsernameFeedback({
          text: isRTL
            ? `اسم المستخدم ${formatUsernameHandle(res.normalized)} متاح للاستخدام.`
            : `Username ${formatUsernameHandle(res.normalized)} is available.`,
          type: 'ok',
        });
      } else {
        setUsernameFeedback({
          text: isRTL
            ? res.errorAr || 'اسم المستخدم غير متاح.'
            : res.errorEn || 'Username is not available.',
          type: 'error',
        });
      }
    } finally {
      setIsCheckingUsername(false);
    }
  };

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeUsername(usernameDraft);
    const fmt = validateUsernameFormat(normalized);
    if (!fmt.valid) {
      setUsernameFeedback({
        text: isRTL ? fmt.errorAr || '' : fmt.errorEn || '',
        type: 'error',
      });
      return;
    }
    setIsSavingUsername(true);
    setUsernameFeedback(null);
    try {
      const res = await updateUsername(normalized);
      if (res.ok && res.username) {
        setUsernameDraft(res.username);
        setUsernameFeedback({
          text: isRTL
            ? `تم حفظ اسم المستخدم ${formatUsernameHandle(res.username)} بنجاح!`
            : `Username ${formatUsernameHandle(res.username)} saved successfully!`,
          type: 'ok',
        });
      } else {
        setUsernameFeedback({
          text:
            res.error ||
            (isRTL ? 'تعذر حفظ اسم المستخدم.' : 'Failed to save username.'),
          type: 'error',
        });
      }
    } finally {
      setIsSavingUsername(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md max-h-[90vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl text-[var(--color-ink)] shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-line)] bg-[var(--color-bg)]">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-[var(--color-accent)]" />
            <h3 className="text-sm font-bold text-[var(--color-ink)]">{t('settingsTitle')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Settings Form Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 0. Account Identity & Unique @username */}
          {user?.isLoggedIn && (
            <form
              onSubmit={handleSaveUsername}
              data-testid="settings-username-card"
              className="p-4 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                  <AtSign className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                  <span>{isRTL ? 'اسم المستخدم الفريد (@username)' : 'Unique Handle (@username)'}</span>
                </h4>
                {user.username && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(formatUsernameHandle(user.username || ''));
                      setCopiedUsername(true);
                      setTimeout(() => setCopiedUsername(false), 1800);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-accent)]/12 text-[var(--color-accent)] text-[10px] font-mono font-bold"
                    dir="ltr"
                  >
                    <span>{formatUsernameHandle(user.username)}</span>
                    {copiedUsername ? (
                      <Check className="w-3 h-3 text-[var(--color-income)]" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                )}
              </div>

              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                {isRTL
                  ? 'يُستخدم اسم المستخدم الفريد لإضافتك مباشرة إلى فرق المؤسسات بدون أكواد دعوة. يُسمح بالأحرف الإنجليزية والأرقام والشرطة السفلية (_).'
                  : 'Used by organization owners to add you directly to teams without invite codes. Lowercase letters, numbers, and underscores only.'}
              </p>

              <div className="flex items-center gap-1.5">
                <div className="relative flex-1 min-w-0">
                  <AtSign className="w-3.5 h-3.5 text-[var(--color-muted)] absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none" />
                  <input
                    type="text"
                    dir="ltr"
                    data-testid="settings-username-input"
                    value={usernameDraft}
                    onChange={(e) => {
                      setUsernameDraft(e.target.value.replace(/^@+/, ''));
                      setUsernameFeedback(null);
                    }}
                    placeholder="ahmed_acc"
                    className="w-full ps-7 pe-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs font-mono text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[38px]"
                  />
                </div>
                <button
                  type="button"
                  disabled={isCheckingUsername || isSavingUsername || !usernameDraft.trim()}
                  onClick={() => void handleCheckUsernameAvailability()}
                  className="px-2.5 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[var(--color-ink)] text-[11px] font-semibold min-h-[38px] shrink-0 disabled:opacity-45"
                >
                  {isCheckingUsername ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isRTL ? (
                    'فحص'
                  ) : (
                    'Check'
                  )}
                </button>
                <button
                  type="submit"
                  data-testid="settings-username-save-btn"
                  disabled={
                    isSavingUsername ||
                    !usernameDraft.trim() ||
                    normalizeUsername(usernameDraft) === user.username
                  }
                  className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-bold min-h-[38px] shrink-0 disabled:opacity-45"
                >
                  {isSavingUsername ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isRTL ? (
                    'حفظ'
                  ) : (
                    'Save'
                  )}
                </button>
              </div>

              {usernameFeedback && (
                <div
                  data-testid="settings-username-feedback"
                  className={`p-2 rounded-lg text-[11px] font-medium border ${
                    usernameFeedback.type === 'error'
                      ? 'bg-[var(--color-expense)]/10 border-[var(--color-expense)]/30 text-[var(--color-expense)]'
                      : 'bg-[var(--color-income)]/10 border-[var(--color-income)]/30 text-[var(--color-income)]'
                  }`}
                >
                  {usernameFeedback.text}
                </div>
              )}
            </form>
          )}

          {/* 1. Language & Theme */}
          <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-[var(--color-ink)]">
              {isRTL ? 'اللغة والمظهر' : 'Appearance & Language'}
            </h4>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--color-muted)]">{t('themeSetting')}</span>
                <div className="flex items-center gap-1 p-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg">
                  <button
                    type="button"
                    data-testid="theme-btn-dark"
                    aria-pressed={settings.theme === 'dark'}
                    onClick={() => updateSettings({ theme: 'dark' })}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors min-h-[32px] ${
                      settings.theme === 'dark'
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'داكن' : 'Dark'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="theme-btn-light"
                    aria-pressed={settings.theme === 'light'}
                    onClick={() => updateSettings({ theme: 'light' })}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors min-h-[32px] ${
                      settings.theme === 'light'
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'فاتح' : 'Light'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="theme-btn-system"
                    aria-pressed={settings.theme === 'system'}
                    onClick={() => updateSettings({ theme: 'system' })}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors min-h-[32px] ${
                      settings.theme === 'system'
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'تلقائي' : 'System'}</span>
                  </button>
                </div>
              </div>
              {settings.theme === 'system' && (
                <p className="text-[11px] text-[var(--color-muted)]">
                  {isRTL
                    ? 'يتبع مظهر الجهاز تلقائياً دون التأثير على الوضع اليدوي.'
                    : 'Follows your device appearance automatically.'}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('languageSetting')}</span>
              <div className="flex items-center gap-1 p-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg">
                <button
                  onClick={() => updateSettings({ language: 'ar' })}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors min-h-[32px] ${
                    settings.language === 'ar'
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  العربية
                </button>
                <button
                  onClick={() => updateSettings({ language: 'en' })}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors min-h-[32px] ${
                    settings.language === 'en'
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  English
                </button>
              </div>
            </div>
          </div>

          {/* 2. Numbers, Digits & Calendar Settings */}
          <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-[var(--color-ink)]">
              {isRTL ? 'الأرقام والتقويم' : 'Digits & Calendar'}
            </h4>

            {/* Digits format */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-muted)]">{t('digitFormatSetting')}</span>
              <div className="flex items-center gap-1 p-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg">
                <button
                  onClick={() => updateSettings({ digitFormat: 'western' })}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors min-h-[32px] ${
                    settings.digitFormat === 'western'
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  123
                </button>
                <button
                  onClick={() => updateSettings({ digitFormat: 'arabic' })}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors min-h-[32px] ${
                    settings.digitFormat === 'arabic'
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  ١٢٣
                </button>
              </div>
            </div>

            {/* Decimal places */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('decimalPlacesSetting')}</span>
              <div className="flex items-center gap-1 p-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg">
                {[0, 1, 2, 3].map((dec) => (
                  <button
                    key={dec}
                    onClick={() => updateSettings({ decimalPlaces: dec })}
                    className={`w-7 h-7 rounded-md text-xs font-semibold transition-colors min-h-[28px] ${
                      settings.decimalPlaces === dec
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    {dec}
                  </button>
                ))}
              </div>
            </div>

            {/* First Day of the Month */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('firstDayOfMonth')}</span>
              <select
                value={settings.firstDayOfMonth}
                onChange={(e) => updateSettings({ firstDayOfMonth: parseInt(e.target.value) || 1 })}
                className="px-2.5 py-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[36px]"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {isRTL ? `يوم ${day}` : `Day ${day}`}
                  </option>
                ))}
              </select>
            </div>

            {/* First Day of the Week */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('firstDayOfWeek')}</span>
              <select
                value={settings.firstDayOfWeek}
                onChange={(e) => updateSettings({ firstDayOfWeek: parseInt(e.target.value) || 6 })}
                className="px-2.5 py-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[36px]"
              >
                <option value={6}>{t('saturday')}</option>
                <option value={0}>{t('sunday')}</option>
                <option value={1}>{t('monday')}</option>
              </select>
            </div>
          </div>

          {/* 3. Transaction & Display Features */}
          <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-[var(--color-ink)]">
              {isRTL ? 'سلوك العرض والمعاملات' : 'Display & Transactions Behavior'}
            </h4>

            {/* Default filter */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-muted)]">{t('defaultFilterSetting')}</span>
              <select
                value={settings.defaultFilter}
                onChange={(e) => updateSettings({ defaultFilter: e.target.value as any })}
                className="px-2.5 py-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[36px]"
              >
                <option value="all">{t('filterAll')}</option>
                <option value="expense">{t('filterExpense')}</option>
                <option value="income">{t('filterIncome')}</option>
              </select>
            </div>

            {/* Exclude debts from balance */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('excludeDebtsSetting')}</span>
              <input
                type="checkbox"
                checked={settings.excludeDebtsFromBalance}
                onChange={(e) => updateSettings({ excludeDebtsFromBalance: e.target.checked })}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>

            {/* Show Current Balance */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('showCurrentBalanceSetting')}</span>
              <input
                type="checkbox"
                checked={settings.showCurrentBalance}
                onChange={(e) => updateSettings({ showCurrentBalance: e.target.checked })}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>

            {/* Show Budget Indicator on Home */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('showBudgetIndicatorSetting')}</span>
              <input
                type="checkbox"
                checked={settings.showBudgetIndicator}
                onChange={(e) => updateSettings({ showBudgetIndicator: e.target.checked })}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>

            {/* Show Calculator Keypad */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('showCalculatorKeypadSetting')}</span>
              <input
                type="checkbox"
                checked={settings.showCalculatorKeypad}
                onChange={(e) => updateSettings({ showCalculatorKeypad: e.target.checked })}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>

            {/* Use last-used wallet by default */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('useLastUsedWalletSetting')}</span>
              <input
                type="checkbox"
                checked={settings.useLastUsedWallet}
                onChange={(e) => updateSettings({ useLastUsedWallet: e.target.checked })}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>

            {/* Show priorities in stats only */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('showPrioritiesInStatsOnlySetting')}</span>
              <input
                type="checkbox"
                checked={settings.showPrioritiesInStatsOnly}
                onChange={(e) => updateSettings({ showPrioritiesInStatsOnly: e.target.checked })}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>

            {/* Use updated live exchange rates */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('useUpdatedExchangeRatesSetting')}</span>
              <input
                type="checkbox"
                checked={settings.useUpdatedExchangeRates}
                onChange={(e) => updateSettings({ useUpdatedExchangeRates: e.target.checked })}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>

            {/* Use rate at transaction time */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('useRateAtTransactionTimeSetting')}</span>
              <input
                type="checkbox"
                checked={settings.useRateAtTransactionTime}
                onChange={(e) => updateSettings({ useRateAtTransactionTime: e.target.checked })}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>
          </div>

          {/* 3b. Exchange Rates & Currencies (Live Sync + Manual Override) */}
          <div
            data-testid="settings-exchange-rates-section"
            className="p-4 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>{isRTL ? 'أسعار الصرف والعملات' : 'Exchange Rates & Currencies'}</span>
              </h4>
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-muted)]">
                {liveRuntimeRates && settings.useUpdatedExchangeRates
                  ? isRTL
                    ? 'متزامنة مباشرة'
                    : 'Live Synced'
                  : isRTL
                  ? 'أسعار محلية'
                  : 'Local Rates'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[11px] text-[var(--color-muted)]">
                {ratesLastUpdated
                  ? isRTL
                    ? `آخر تحديث: ${ratesLastUpdated}`
                    : `Last updated: ${ratesLastUpdated}`
                  : isRTL
                  ? 'السعر مقابل 1 دولار أمريكي (USD)'
                  : 'Rates relative to 1 USD'}
              </div>
              <button
                type="button"
                data-testid="refresh-rates-now-btn"
                disabled={isRefreshingRates}
                onClick={() => void handleRefreshRatesNow()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-semibold min-h-[34px] disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingRates ? 'animate-spin' : ''}`} />
                <span>
                  {isRefreshingRates
                    ? isRTL
                      ? 'جاري التحديث...'
                      : 'Refreshing...'
                    : isRTL
                    ? 'تحديث أسعار العملات الآن'
                    : 'Refresh Exchange Rates Now'}
                </span>
              </button>
            </div>

            {rateSyncFeedback && (
              <div
                className={`p-2 rounded-lg text-[11px] font-medium border ${
                  rateSyncFeedback.isError
                    ? 'bg-[var(--color-warning)]/12 border-[var(--color-warning)]/30 text-[var(--color-warning-text)]'
                    : 'bg-[var(--color-income)]/10 border-[var(--color-income)]/30 text-[var(--color-income)]'
                }`}
              >
                {rateSyncFeedback.text}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-[11px] font-semibold text-[var(--color-muted)]">
                {isRTL ? 'تعديل يدوي لسعر الصرف (1 USD =)' : 'Manual Rate Overrides (1 USD =)'}
              </span>
              {hasCustomRates && (
                <button
                  type="button"
                  onClick={handleResetAllCustomRates}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-accent)] hover:underline"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{isRTL ? 'استعادة التلقائي' : 'Reset All'}</span>
                </button>
              )}
            </div>

            <div className="max-h-52 overflow-y-auto space-y-1.5 pe-0.5">
              {editableCurrencyCodes.map((code) => {
                const cur = getCurrency(code);
                const effectiveRate = getEffectiveCurrencyRate(code, settings.customExchangeRates);
                const isCustom =
                  settings.customExchangeRates?.[code] !== undefined &&
                  settings.customExchangeRates[code] > 0;
                const displayVal =
                  rateDrafts[code] !== undefined
                    ? rateDrafts[code]
                    : String(Number(effectiveRate.toFixed(4)));

                return (
                  <div
                    key={code}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm shrink-0">{cur.flag}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1">
                          <span className="font-mono">{code}</span>
                          {isCustom && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[var(--color-accent)]/12 text-[var(--color-accent)] font-semibold">
                              {isRTL ? 'يدوي' : 'Custom'}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--color-muted)] truncate">
                          {isRTL ? cur.nameAr : cur.nameEn}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        aria-label={`${code} rate`}
                        value={displayVal}
                        onChange={(e) => handleManualRateChange(code, e.target.value)}
                        onBlur={() =>
                          setRateDrafts((prev) => {
                            const copy = { ...prev };
                            delete copy[code];
                            return copy;
                          })
                        }
                        className="w-24 px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-md text-xs font-bold text-center text-[var(--color-ink)] num-tabular min-h-[34px] focus:outline-none focus:border-[var(--color-accent)]"
                      />
                      {isCustom && (
                        <button
                          type="button"
                          onClick={() => handleResetSingleRate(code)}
                          title={isRTL ? 'استعادة السعر التلقائي' : 'Reset to auto rate'}
                          className="p-1.5 rounded-md border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[34px] min-w-[30px] flex items-center justify-center"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {availableAddRateCurrencies.length > 0 && (
              <div className="pt-1">
                <select
                  value=""
                  onChange={(e) => {
                    const code = e.target.value;
                    if (code) {
                      setExtraRateCodes((prev) => (prev.includes(code) ? prev : [code, ...prev]));
                    }
                  }}
                  className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-muted)] min-h-[36px]"
                >
                  <option value="">
                    {isRTL ? '+ إضافة عملة أخرى لتعديل سعرها...' : '+ Add another currency rate...'}
                  </option>
                  {availableAddRateCurrencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.code} — {isRTL ? c.nameAr : c.nameEn}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* 4. Security & App PIN Lock with Salted Hash */}
          <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[var(--color-accent)]" />
              <span>{isRTL ? 'الأمان وحماية التطبيق' : 'Security & PIN Lock'}</span>
            </h4>

            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-muted)]">{t('appLockPinSetting')}</span>
              <input
                type="checkbox"
                checked={settings.isAppLockEnabled}
                onChange={(e) => {
                  if (e.target.checked) {
                    setShowPinInput(true);
                  } else {
                    updateSettings({ isAppLockEnabled: false, appPin: undefined, appPinSalt: undefined });
                  }
                }}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>

            {settings.isAppLockEnabled && (
              <div className="text-[11px] text-[var(--color-accent)] font-medium">
                {isRTL ? (
                  <>
                    رمز <bdi dir="ltr">PIN</bdi> مفعل حالياً (مشفر بتقنية <bdi dir="ltr">PBKDF2</bdi>)
                  </>
                ) : (
                  'PIN is active (PBKDF2-SHA256 hashed)'
                )}
                <button
                  onClick={() => setShowPinInput(true)}
                  className="mx-2 text-[var(--color-ink)] underline"
                >
                  {isRTL ? 'تغيير الرمز' : 'Change PIN'}
                </button>
              </div>
            )}

            {showPinInput && (
              <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-line)] space-y-2">
                <label className="text-xs text-[var(--color-ink)] block">
                  {isRTL ? (
                    <>
                      أدخل 4 أرقام لرمز <bdi dir="ltr">PIN</bdi> الجديد:
                    </>
                  ) : (
                    'Enter 4-digit PIN:'
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pinInput}
                    onChange={(e) =>
                      setPinInput(normalizeArabicPersianNumerals(e.target.value).replace(/\D/g, ''))
                    }
                    placeholder="••••"
                    className="w-24 px-3 py-1.5 text-center font-mono tracking-widest bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-sm text-[var(--color-ink)] min-h-[36px]"
                  />
                  <button
                    disabled={pinInput.length !== 4}
                    onClick={handleSavePin}
                    className="px-3 py-1.5 bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-40 text-[var(--color-on-accent)] font-semibold rounded-lg text-xs min-h-[36px]"
                  >
                    {isRTL ? 'حفظ الرمز' : 'Save PIN'}
                  </button>
                  <button
                    onClick={() => setShowPinInput(false)}
                    className="px-2 py-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] text-xs min-h-[36px]"
                  >
                    {isRTL ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}

            <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">
              {isRTL
                ? 'تنويه: قفل التطبيق وقفل المحافظ يهدفان لخصوصية الواجهة محلياً فقط لمنع التصفح العابر ولا يشفّران ملفات التخزين المحلية؛ لتشفير ملفاتك استخدم خيار «النسخ الاحتياطي المشفر».'
                : 'Note: App Lock and Wallet PIN are local UI convenience locks against casual access and do not encrypt browser storage. Use Encrypted JSON Backup for AES-GCM file encryption.'}
            </p>
          </div>

          {/* 5. Notification Settings */}
          <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>{t('notificationSettings')}</span>
              </h4>
              {isWebNotificationSupported() && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-muted)]">
                  {notifPerm === 'granted'
                    ? isRTL
                      ? 'إشعارات المتصفح مفعّلة'
                      : 'Browser Active'
                    : notifPerm === 'denied'
                    ? isRTL
                      ? 'محظورة من المتصفح'
                      : 'Blocked'
                    : isRTL
                    ? 'غير مفعّلة'
                    : 'Not Granted'}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-muted)]">{t('dailyReminder')}</span>
              <input
                type="checkbox"
                checked={settings.notificationsEnabled}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  updateSettings({ notificationsEnabled: checked });
                  if (checked) {
                    const perm = await requestBrowserNotificationPermission();
                    setNotifPerm(perm);
                  }
                }}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('debtReminder')}</span>
              <input
                type="checkbox"
                checked={settings.debtRemindersEnabled ?? true}
                onChange={(e) => updateSettings({ debtRemindersEnabled: e.target.checked })}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-line)]">
              <span className="text-xs text-[var(--color-muted)]">{t('budgetAlerts')}</span>
              <input
                type="checkbox"
                checked={settings.budgetAlertsEnabled ?? true}
                onChange={(e) => updateSettings({ budgetAlertsEnabled: e.target.checked })}
                className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
              />
            </div>
          </div>

          {/* 5b. Organization Settings & Accounting Period Lock */}
          {isOrgWorkspace && activeOrganization && (
            <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                  <span>{isRTL ? 'إعدادات المؤسسة والضرائب' : 'Organization & Accounting'}</span>
                </h4>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-accent)]">
                  {activeOrganization.currency}
                </span>
              </div>

              {canOrgManage && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                        {t('vatRate')} (%)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={orgVatDraft}
                        onChange={(e) => {
                          const norm = normalizeArabicPersianNumerals(e.target.value);
                          setOrgVatDraft(norm);
                          const parsed = parseLocalizedNumber(norm);
                          if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) {
                            updateOrganizationSettings({ vatRate: parsed });
                          }
                        }}
                        className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[38px] num-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                        {t('taxNumber')}
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        value={activeOrganization.taxNumber || ''}
                        onChange={(e) => updateOrganizationSettings({ taxNumber: e.target.value })}
                        placeholder="TRN-..."
                        className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[38px]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                      {isRTL
                        ? `حد اعتماد المصروف التلقائي (${activeOrganization.currency})`
                        : `Auto-Approval Expense Limit (${activeOrganization.currency})`}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={orgThresholdDraft}
                      onChange={(e) => {
                        const norm = normalizeArabicPersianNumerals(e.target.value);
                        setOrgThresholdDraft(norm);
                        const parsed = parseLocalizedNumber(norm);
                        if (!Number.isNaN(parsed) && parsed >= 0) {
                          updateOrganizationSettings({ approvalThreshold: parsed });
                        }
                      }}
                      className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[38px] num-tabular"
                    />
                  </div>

                  <div className="pt-2 border-t border-[var(--color-line)] space-y-2">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-ink)]">
                      <LockKeyhole className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                      <span>{t('periodLock')}</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={lockDateInput}
                        onChange={(e) => setLockDateInput(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[38px]"
                      />
                      <button
                        type="button"
                        onClick={() => lockAccountingPeriod(lockDateInput || undefined)}
                        className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold min-h-[38px]"
                      >
                        {lockDateInput ? (isRTL ? 'قفل' : 'Lock') : isRTL ? 'فتح' : 'Unlock'}
                      </button>
                    </div>
                    {activeOrganization.lockedUntilDate && (
                      <p className="text-[10px] text-[var(--color-warning-text)]">
                        {isRTL
                          ? `الدفاتر مقفلة حتى تاريخ ${activeOrganization.lockedUntilDate}`
                          : `Books locked through ${activeOrganization.lockedUntilDate}`}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {canAccessAdminPanel && (
            <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-accent)]/35 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <span>{isRTL ? 'إدارة النظام الحصرية' : 'Exclusive System Administration'}</span>
                </h4>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-[var(--color-income)]/15 text-[var(--color-income)]">
                  {isRTL ? 'مالك النظام' : 'System Admin'}
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                {isRTL
                  ? 'إدارة اشتراكات الحسابات والمؤسسات مباشرة، وتحديث الرمز السري للوحة الإدارة.'
                  : 'Manage user and organization subscriptions directly, and update the Admin Panel PIN.'}
              </p>
              <button
                type="button"
                data-testid="settings-open-admin-panel-btn"
                onClick={() => {
                  onClose();
                  openAdminPanel();
                }}
                className="w-full py-2.5 px-3 bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:opacity-95 font-bold rounded-lg text-xs flex items-center justify-center gap-2 transition-opacity min-h-[44px]"
              >
                <KeyRound className="w-4 h-4 shrink-0" />
                <span>
                  {isRTL
                    ? 'فتح لوحة إدارة الاشتراكات'
                    : 'Open Admin Subscriptions Panel'}
                </span>
              </button>
            </div>
          )}

          {/* 6. Danger Zone: Safe Recovery, Sign Out, Delete Data & Delete Account */}
          <div className="p-4 bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 rounded-xl space-y-2.5">
            <h4 className="text-xs font-bold text-[var(--color-expense)]">
              {isRTL ? 'إدارة البيانات والحساب' : 'Data & Account Management'}
            </h4>

            <button
              type="button"
              data-testid="settings-emergency-recovery-btn"
              disabled={!forceSyncAvailability.canExecute}
              onClick={() => setConfirmForceCloudSync(true)}
              className="w-full py-2.5 px-3 bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:opacity-95 font-bold rounded-lg text-xs flex items-center justify-center gap-2 transition-opacity min-h-[44px] disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {isCloudSyncing ? (
                <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <CloudDownload className="w-4 h-4 shrink-0" />
              )}
              <span>
                {isRTL
                  ? 'مزامنة سحابية إجبارية (استرجاع البيانات)'
                  : 'Force Cloud Sync (Recover Data)'}
              </span>
            </button>

            {!forceSyncAvailability.canExecute && forceSyncAvailability.reason !== 'syncing' && (
              <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">
                {forceSyncAvailability.reason === 'guest'
                  ? isRTL
                    ? 'متاح فقط بعد تسجيل الدخول بحساب Google (معطّل في وضع الضيف).'
                    : 'Available only after signing in with Google (disabled in Guest mode).'
                  : isRTL
                  ? 'غير متاح حالياً لعدم توفر اتصال بالإنترنت.'
                  : 'Unavailable while offline. Connect to the internet to use cloud recovery.'}
              </p>
            )}

            {(emergencyFeedback || cloudDiagnosticsError) && (
              <div
                data-testid="settings-cloud-diagnostics-banner"
                className={`p-3 rounded-lg border text-[11px] space-y-1 ${
                  emergencyFeedback?.isError || cloudDiagnosticsError
                    ? 'bg-[var(--color-surface)] border-[var(--color-expense)]/45 text-[var(--color-expense)]'
                    : 'bg-[var(--color-surface)] border-[var(--color-income)]/45 text-[var(--color-income)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    {emergencyFeedback?.isError || cloudDiagnosticsError ? (
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <p className="font-medium leading-relaxed break-words select-text">
                      {cloudDiagnosticsError || emergencyFeedback?.text}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={isRTL ? 'إغلاق' : 'Dismiss'}
                    onClick={() => {
                      setEmergencyFeedback(null);
                      clearCloudDiagnosticsError();
                    }}
                    className="p-0.5 rounded hover:bg-black/10 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              data-testid="settings-signout-btn"
              onClick={() => {
                onClose();
                setIsLogoutModalOpen(true);
              }}
              className="w-full py-2.5 px-3 bg-[var(--color-surface)] border border-[var(--color-expense)]/40 text-[var(--color-expense)] hover:bg-[var(--color-expense)]/10 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 transition-colors min-h-[44px]"
            >
              <LogOut className="w-4 h-4" />
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

            <button
              type="button"
              onClick={() => setConfirmDeleteAll(true)}
              className="w-full py-2.5 px-3 bg-[var(--color-expense)] text-white hover:opacity-90 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 transition-opacity min-h-[44px]"
            >
              <Trash2 className="w-4 h-4" />
              <span>{t('deleteAllData')}</span>
            </button>

            <button
              type="button"
              disabled={isDeletingAccount}
              onClick={() => {
                setDeleteAccountError(null);
                setNeedsRecentReauth(false);
                setConfirmDeleteAccount(true);
              }}
              className="w-full py-2.5 px-3 bg-[var(--color-surface)] border border-[var(--color-expense)]/40 text-[var(--color-expense)] hover:bg-[var(--color-expense)]/10 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 transition-colors min-h-[44px] disabled:opacity-50"
            >
              <UserX className="w-4 h-4" />
              <span>
                {isRTL ? 'حذف حسابي وبياناتي السحابية' : 'Delete my account and cloud data'}
              </span>
            </button>

            {deleteAccountError && (
              <div className="p-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-expense)]/40 space-y-2">
                <p className="text-[11px] text-[var(--color-expense)] font-medium">
                  {deleteAccountError}
                </p>
                {needsRecentReauth && (
                  <button
                    type="button"
                    disabled={isDeletingAccount}
                    onClick={async () => {
                      setIsDeletingAccount(true);
                      setDeleteAccountError(null);
                      const reauthed = await reauthenticateGoogleAccount();
                      if (!reauthed) {
                        setIsDeletingAccount(false);
                        setDeleteAccountError(
                          isRTL
                            ? 'تعذر تأكيد الهوية عبر جوجل. حاول مرة أخرى.'
                            : 'Google re-authentication cancelled or failed.'
                        );
                        return;
                      }
                      const retry = await deleteAccountAndData();
                      setIsDeletingAccount(false);
                      if (retry.ok) {
                        setNeedsRecentReauth(false);
                        onClose();
                      } else {
                        setNeedsRecentReauth(retry.errorCode === 'RECENT_AUTH_REQUIRED');
                        setDeleteAccountError(
                          retry.errorMessage ||
                            (isRTL ? 'تعذر حذف الحساب حالياً.' : 'Failed to delete account.')
                        );
                      }
                    }}
                    className="w-full py-2 px-3 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold min-h-[38px] disabled:opacity-50"
                  >
                    {isRTL ? 'تأكيد الهوية عبر جوجل ثم الحذف النهائي' : 'Re-verify with Google & Delete'}
                  </button>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-line)] bg-[var(--color-bg)]">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-[var(--color-surface)] border border-[var(--color-line)] hover:bg-[var(--color-bg)] font-semibold rounded-lg text-xs text-[var(--color-ink)] min-h-[44px]"
          >
            {t('close')}
          </button>
        </div>
      </div>

      {/* Delete All Data Confirmation */}
      <ConfirmationModal
        isOpen={confirmDeleteAll}
        onClose={() => setConfirmDeleteAll(false)}
        onConfirm={() => {
          resetAllData();
          onClose();
        }}
        title={t('deleteAllData')}
        message={t('deleteAllDataConfirm')}
        confirmLabel={t('confirmDelete')}
        cancelLabel={t('cancel')}
      />

      {/* Delete Account & Cloud Data Confirmation */}
      <ConfirmationModal
        isOpen={confirmDeleteAccount}
        onClose={() => setConfirmDeleteAccount(false)}
        onConfirm={async () => {
          setIsDeletingAccount(true);
          setDeleteAccountError(null);
          setNeedsRecentReauth(false);
          const res = await deleteAccountAndData();
          setIsDeletingAccount(false);
          if (res.ok) {
            setConfirmDeleteAccount(false);
            onClose();
          } else {
            setNeedsRecentReauth(res.errorCode === 'RECENT_AUTH_REQUIRED');
            setDeleteAccountError(
              res.errorMessage ||
                (isRTL ? 'تعذر حذف الحساب حالياً.' : 'Failed to delete account right now.')
            );
          }
        }}
        title={isRTL ? 'حذف حسابي وبياناتي السحابية' : 'Delete my account and cloud data'}
        message={
          user?.isLoggedIn
            ? isRTL
              ? `سيتم حذف حسابك على الخادم وجميع نسخك الاحتياطية السحابية والمؤسسات الفردية وبيانات هذا الجهاز نهائياً ولا يمكن التراجع عن ذلك.${
                  isPro
                    ? ' تحذير مهم: سيؤدي حذف الحساب إلى فقدان اشتراك PRO المدفوع نهائياً.'
                    : ''
                } إذا كنت مالكاً لمؤسسة بها أعضاء آخرون، يجب نقل ملكيتها أولاً.`
              : `This permanently deletes your cloud account, cloud backups, solo organizations, and all local data on this device.${
                  isPro
                    ? ' Warning: Deleting your account permanently forfeits your active paid PRO license.'
                    : ''
                } Multi-member organizations you own must be transferred first.`
            : isRTL
            ? 'سيتم مسح جميع البيانات المحلية والإعدادات من هذا الجهاز نهائياً.'
            : 'This permanently clears all local data and settings from this device.'
        }
        confirmLabel={isRTL ? 'نعم، احذف الحساب والبيانات' : 'Delete Account & Data'}
        cancelLabel={t('cancel')}
      />

      {/* Force Cloud Sync Confirmation */}
      <ConfirmationModal
        isOpen={confirmForceCloudSync}
        onClose={() => setConfirmForceCloudSync(false)}
        onConfirm={() => {
          void (async () => {
            if (!forceSyncAvailability.canExecute) return;
            setEmergencyFeedback(null);
            const res = await emergencyCloudRecovery();
            if (res.ok) {
              const totalRecovered = res.recoveredPersonalCount + res.recoveredOrgCount;
              setEmergencyFeedback({
                text: isRTL
                  ? totalRecovered > 0
                    ? `تم استرجاع ${totalRecovered} معاملة بنجاح مباشرة من الخادم السحابي (الشخصي: ${res.recoveredPersonalCount}، المؤسسة: ${res.recoveredOrgCount}).`
                    : 'اكتمل الاتصال المباشر بالخادم السحابي ولا توجد معاملات إضافية للاسترجاع.'
                  : totalRecovered > 0
                  ? `Restored ${totalRecovered} transactions directly from server (Personal: ${res.recoveredPersonalCount}, Org: ${res.recoveredOrgCount}).`
                  : 'Direct server sync finished; no additional remote transactions were found.',
                isError: false,
              });
            } else {
              setEmergencyFeedback({
                text:
                  res.errorMessage ||
                  (isRTL
                    ? 'فشلت المزامنة السحابية الإجبارية.'
                    : 'Force cloud recovery failed.'),
                isError: true,
              });
            }
          })();
        }}
        title={isRTL ? 'تأكيد المزامنة السحابية الإجبارية' : 'Confirm Force Cloud Sync'}
        message={
          isRTL
            ? 'سيقوم هذا الإجراء بمسح الكاش المحلي للمعاملات على هذا الجهاز وإعادة تحميل أحدث نسخة محفوظة مباشرة من السحابة.\n\nتنبيه مهم: إذا كانت لديك تعديلات حديثة أو عمليات استيراد لم تكتمل مزامنتها السحابية بعد، فقد يتم استبدالها بالنسخة المحفوظة في السحابة.'
            : 'This action will clear the local transaction cache on this device and re-download the latest saved copy directly from the Cloud.\n\nImportant warning: Any recent local edits or imports that have not finished syncing to the Cloud yet may be replaced by the cloud copy.'
        }
        confirmLabel={isRTL ? 'نعم، استرجاع من السحابة' : 'Yes, Recover from Cloud'}
        cancelLabel={t('cancel')}
        isDestructive={true}
      />
    </div>
  );
};
