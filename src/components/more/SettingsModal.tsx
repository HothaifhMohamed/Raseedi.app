import React, { useEffect, useMemo, useState } from 'react';
import {
  Settings as SettingsIcon,
  Moon,
  Sun,
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
  KeyRound,
  ShieldCheck,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { hashPin } from '../../services/security';
import {
  AdminCouponCycle,
  AdminCouponTier,
  generateAdminLicenseCode,
  verifyAdminPassword,
} from '../../services/licenseCodes';
import {
  AdminIssuedCodeRecord,
  fetchRecentAdminIssuedCodes,
  registerAdminIssuedCodeInDb,
} from '../../services/firebase';
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
  initialOpenAdminPanel?: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialOpenAdminPanel = false,
}) => {
  const {
    settings,
    wallets,
    user,
    isPro,
    isAdminUser,
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
    t,
    isRTL,
  } = useApp();

  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
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

  // Secret Admin Coupon Generator Panel State (only usable by verified admin)
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminPasswordError, setAdminPasswordError] = useState<string | null>(null);
  const [adminCouponTier, setAdminCouponTier] = useState<AdminCouponTier>('pro');
  const [adminCouponCycle, setAdminCouponCycle] = useState<AdminCouponCycle>('yearly');
  const [adminTargetEmail, setAdminTargetEmail] = useState('');
  const [generatedAdminCode, setGeneratedAdminCode] = useState<string | null>(null);
  const [adminCodeSyncStatus, setAdminCodeSyncStatus] = useState<'idle' | 'syncing' | 'cloud_synced' | 'local_only'>('idle');
  const [recentAdminCodes, setRecentAdminCodes] = useState<AdminIssuedCodeRecord[]>([]);
  const [copiedAdminCode, setCopiedAdminCode] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsAdminPanelOpen(false);
      setIsAdminUnlocked(false);
      setAdminPasswordInput('');
      setAdminPasswordError(null);
      setAdminTargetEmail('');
      setAdminCodeSyncStatus('idle');
      setCopiedAdminCode(false);
      return;
    }
    if (initialOpenAdminPanel && isAdminUser) {
      setIsAdminPanelOpen(true);
    }
    setLockDateInput(activeOrganization?.lockedUntilDate || '');
    setOrgVatDraft(String(activeOrganization?.vatRate ?? 14));
    setOrgThresholdDraft(String(activeOrganization?.approvalThreshold ?? 0));
    setRateDrafts({});
    setRateSyncFeedback(null);
  }, [isOpen, initialOpenAdminPanel, isAdminUser, activeOrganization?.id, activeOrganization?.lockedUntilDate]);

  useEffect(() => {
    if (!isOpen || !isAdminUser || !isAdminUnlocked) return;
    let active = true;
    void fetchRecentAdminIssuedCodes(6).then((records) => {
      if (active) setRecentAdminCodes(records);
    });
    return () => {
      active = false;
    };
  }, [isOpen, isAdminUser, isAdminUnlocked]);

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
              ? 'تم تحديث أسعار الصرف المباشرة وحفظها للعمل بدون إنترنت.'
              : 'Live exchange rates updated and cached for offline use.',
          }
        : {
            text: isRTL
              ? 'تعذر الاتصال بخدمة الأسعار الآن — يتم استخدام آخر أسعار محفوظة أو الافتراضية.'
              : 'Could not reach rate feed right now — using cached or fallback rates.',
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
          {/* 1. Language & Theme */}
          <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-[var(--color-ink)]">
              {isRTL ? 'اللغة والمظهر' : 'Appearance & Language'}
            </h4>

            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-muted)]">{t('themeSetting')}</span>
              <div className="flex items-center gap-1 p-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg">
                <button
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
              </div>
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

          {/* 6. Danger Zone: Delete Data & Delete Account */}
          <div className="p-4 bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 rounded-xl space-y-2.5">
            <h4 className="text-xs font-bold text-[var(--color-expense)]">
              {isRTL ? 'إدارة البيانات والحساب' : 'Data & Account Management'}
            </h4>

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

          {/* 7. Secret Admin Coupon Generator & PRO License Panel (Visible exclusively to verified admin email) */}
          {isAdminUser && (
            <div
              data-testid="admin-panel-section"
              className="p-4 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-3"
            >
              <button
                type="button"
                onClick={() => {
                  setIsAdminPanelOpen((prev) => !prev);
                  setAdminPasswordError(null);
                }}
                data-testid="admin-panel-toggle"
                className="w-full flex items-center justify-between text-xs font-bold text-[var(--color-ink)] min-h-[36px]"
              >
                <span className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[var(--color-accent)]" />
                  <span>{isRTL ? 'لوحة المدير / تفعيل التراخيص' : 'Admin Panel / License Activation'}</span>
                </span>
                <span className="text-[11px] font-medium text-[var(--color-muted)]">
                  {isAdminUnlocked
                    ? isRTL
                      ? 'مفتوحة'
                      : 'Unlocked'
                    : isAdminPanelOpen
                    ? isRTL
                      ? 'إخفاء'
                      : 'Hide'
                    : isRTL
                    ? 'فتح'
                    : 'Open'}
                </span>
              </button>

              {isAdminPanelOpen && !isAdminUnlocked && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (verifyAdminPassword(adminPasswordInput)) {
                      setIsAdminUnlocked(true);
                      setAdminPasswordInput('');
                      setAdminPasswordError(null);
                    } else {
                      setAdminPasswordError(
                        isRTL ? 'كلمة مرور المدير غير صحيحة.' : 'Incorrect admin passcode.'
                      );
                    }
                  }}
                  className="pt-2 border-t border-[var(--color-line)] space-y-2"
                >
                  <label className="block text-[11px] text-[var(--color-muted)]">
                    {isRTL ? 'أدخل كلمة مرور المدير للوصول لمولّد الأكواد' : 'Enter admin passcode to unlock coupon generator'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      dir="ltr"
                      value={adminPasswordInput}
                      onChange={(e) => {
                        setAdminPasswordInput(e.target.value);
                        setAdminPasswordError(null);
                      }}
                      placeholder={isRTL ? 'كلمة مرور المدير...' : 'Admin passcode...'}
                      data-testid="admin-password-input"
                      className="flex-1 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[40px]"
                    />
                    <button
                      type="submit"
                      data-testid="admin-unlock-btn"
                      className="px-3.5 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] rounded-lg text-xs font-semibold hover:opacity-95 min-h-[40px] shrink-0"
                    >
                      {isRTL ? 'دخول' : 'Unlock'}
                    </button>
                  </div>
                  {adminPasswordError && (
                    <p data-testid="admin-password-error" className="text-[11px] text-[var(--color-expense)] font-medium">
                      {adminPasswordError}
                    </p>
                  )}
                </form>
              )}

              {isAdminPanelOpen && isAdminUnlocked && (
                <div className="pt-3 border-t border-[var(--color-line)] space-y-3" data-testid="admin-coupon-panel">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-income)]">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>{isRTL ? 'مولّد أكواد التفعيل المشفرة' : 'Encrypted License Code Generator'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAdminUnlocked(false);
                        setGeneratedAdminCode(null);
                        setAdminCodeSyncStatus('idle');
                        setCopiedAdminCode(false);
                      }}
                      className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    >
                      {isRTL ? 'قفل اللوحة' : 'Lock'}
                    </button>
                  </div>

                  {/* Tier Selection */}
                  <div className="space-y-1.5">
                    <span className="block text-[11px] text-[var(--color-muted)]">
                      {isRTL ? 'نوع الباقة' : 'Plan Tier'}
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setAdminCouponTier('pro')}
                        data-testid="admin-tier-pro"
                        className={`py-2 px-2.5 rounded-lg text-xs font-semibold border transition-colors min-h-[38px] ${
                          adminCouponTier === 'pro'
                            ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                            : 'bg-[var(--color-surface)] text-[var(--color-ink)] border-[var(--color-line)]'
                        }`}
                      >
                        {isRTL ? 'باقة PRO للأفراد' : 'Personal PRO'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminCouponTier('business')}
                        data-testid="admin-tier-business"
                        className={`py-2 px-2.5 rounded-lg text-xs font-semibold border transition-colors min-h-[38px] ${
                          adminCouponTier === 'business'
                            ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                            : 'bg-[var(--color-surface)] text-[var(--color-ink)] border-[var(--color-line)]'
                        }`}
                      >
                        {isRTL ? 'باقة Business للأعمال' : 'Business PRO'}
                      </button>
                    </div>
                  </div>

                  {/* Cycle Selection */}
                  <div className="space-y-1.5">
                    <span className="block text-[11px] text-[var(--color-muted)]">
                      {isRTL ? 'مدة الصلاحية' : 'Validity Duration'}
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'monthly', ar: 'شهري', en: 'Monthly' },
                          { id: 'yearly', ar: 'سنوي', en: 'Yearly' },
                          { id: 'lifetime', ar: 'مدى الحياة', en: 'Lifetime' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setAdminCouponCycle(opt.id)}
                          data-testid={`admin-cycle-${opt.id}`}
                          className={`py-2 px-2 rounded-lg text-[11px] font-semibold border transition-colors min-h-[36px] ${
                            adminCouponCycle === opt.id
                              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                              : 'bg-[var(--color-surface)] text-[var(--color-ink)] border-[var(--color-line)]'
                          }`}
                        >
                          {isRTL ? opt.ar : opt.en}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Optional Target Email Binding */}
                  <div className="space-y-1">
                    <label className="block text-[11px] text-[var(--color-muted)]">
                      {isRTL ? 'بريد المستخدم المستهدف (اختياري)' : 'Target User Email (Optional)'}
                    </label>
                    <input
                      type="email"
                      dir="ltr"
                      value={adminTargetEmail}
                      onChange={(e) => setAdminTargetEmail(e.target.value)}
                      placeholder="user@gmail.com"
                      data-testid="admin-target-email-input"
                      className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] min-h-[38px]"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={adminCodeSyncStatus === 'syncing'}
                    onClick={async () => {
                      const code = generateAdminLicenseCode({
                        tier: adminCouponTier,
                        cycle: adminCouponCycle,
                      });
                      setGeneratedAdminCode(code);
                      setCopiedAdminCode(false);
                      setAdminCodeSyncStatus('syncing');

                      const syncRes = await registerAdminIssuedCodeInDb({
                        code,
                        tier: adminCouponTier,
                        cycle: adminCouponCycle,
                        planTier: adminCouponTier === 'business' ? 'business_pro' : 'personal_pro',
                        targetEmail: adminTargetEmail.trim() || undefined,
                      });
                      setAdminCodeSyncStatus(
                        syncRes.savedCloud || syncRes.savedServer ? 'cloud_synced' : 'local_only'
                      );
                      if (syncRes.savedCloud) {
                        const updatedList = await fetchRecentAdminIssuedCodes(6);
                        setRecentAdminCodes(updatedList);
                      }
                    }}
                    data-testid="admin-generate-code-btn"
                    className="w-full py-2.5 px-3 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold rounded-lg text-xs flex items-center justify-center gap-2 hover:opacity-95 transition-opacity min-h-[42px] disabled:opacity-60"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>
                      {adminCodeSyncStatus === 'syncing'
                        ? isRTL
                          ? 'جاري التوليد والحفظ...'
                          : 'Generating & Saving...'
                        : isRTL
                        ? 'توليد كود تفعيل فريد'
                        : 'Generate Unique Code'}
                    </span>
                  </button>

                  {generatedAdminCode && (
                    <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-accent)]/40 rounded-lg space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <code
                          dir="ltr"
                          data-testid="admin-generated-code"
                          className="text-xs font-mono font-bold text-[var(--color-ink)] select-all break-all"
                        >
                          {generatedAdminCode}
                        </code>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard?.writeText(generatedAdminCode);
                            } catch {
                              // Ignore clipboard permission errors
                            }
                            setCopiedAdminCode(true);
                            window.setTimeout(() => setCopiedAdminCode(false), 2500);
                          }}
                          data-testid="admin-copy-code-btn"
                          className="px-2.5 py-1.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-line)] text-[11px] font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] flex items-center gap-1 shrink-0 min-h-[32px]"
                        >
                          {copiedAdminCode ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-[var(--color-income)]" />
                              <span>{isRTL ? 'تم النسخ' : 'Copied'}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                              <span>{isRTL ? 'نسخ' : 'Copy'}</span>
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-[10px] text-[var(--color-muted)]">
                        {adminCodeSyncStatus === 'cloud_synced'
                          ? isRTL
                            ? 'تم حفظ الكود في قاعدة البيانات بنجاح. سيتم تفعيله تلقائياً للمستخدم عند إدخاله.'
                            : 'Code saved to database. Ready for one-time activation by the target user.'
                          : isRTL
                          ? 'انسخ الكود وأدخله في نافذة الترقية (PRO) لتفعيل الباقة فوراً على أي جهاز.'
                          : 'Copy and paste this code in the Upgrade modal to activate immediately on any device.'}
                      </p>
                    </div>
                  )}

                  {recentAdminCodes.length > 0 && (
                    <div className="pt-2 border-t border-[var(--color-line)] space-y-1.5">
                      <div className="text-[10px] font-semibold text-[var(--color-muted)]">
                        {isRTL ? 'آخر الأكواد المسجلة في قاعدة البيانات' : 'Recent Database-Linked Codes'}
                      </div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {recentAdminCodes.map((rec) => (
                          <div
                            key={rec.codeHash}
                            className="px-2.5 py-1.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between gap-2 text-[10px]"
                          >
                            <div className="min-w-0">
                              <span className="font-semibold text-[var(--color-ink)]">
                                {rec.planTier === 'business_pro' ? 'Business' : 'PRO'} • {rec.cycle}
                              </span>
                              {rec.targetEmail && (
                                <span className="block text-[var(--color-muted)] truncate" dir="ltr">
                                  {rec.targetEmail}
                                </span>
                              )}
                            </div>
                            <span
                              className={`shrink-0 font-semibold ${
                                rec.usedBy ? 'text-[var(--color-muted)]' : 'text-[var(--color-income)]'
                              }`}
                            >
                              {rec.usedBy
                                ? isRTL
                                  ? 'مستخدم'
                                  : 'Used'
                                : isRTL
                                ? 'متاح'
                                : 'Active'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
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
    </div>
  );
};
