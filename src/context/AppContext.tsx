/**
 * Global Application State for Raseedi (رَصِيدِي)
 * Supports isolated Personal Local-First Workspace & Enterprise Organization Workspaces.
 */
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import {
  Transaction,
  Wallet,
  Category,
  Budget,
  Debt,
  SavingsGoal,
  Template,
  AppSettings,
  PriorityLevel,
  UserAccount,
  VerifiedProEntitlement,
  PlanTier,
  Organization,
  OrganizationMember,
  OrganizationRole,
  CostCenter,
  BusinessParty,
  AuditLogEntry,
  AuditLogAction,
  OrgWorkspaceData,
  AppNotificationItem,
  MoneyCircle,
  OrganizationIndustry,
} from '../types';
import {
  loadInitialData,
  persistData,
  generateDemoSeedData,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  DEFAULT_WALLETS,
  mergeSettingsWithDefaults,
  AppDatabaseData,
  saveVerifiedProCache,
  loadVerifiedProCache,
  clearLocalAppStorageAndDb,
  savePreRestoreSnapshot,
  loadPreRestoreSnapshot,
  loadOrgWorkspaces,
  saveOrgWorkspaces,
  createStarterOrgCategories,
  createStarterCostCentersForIndustry,
} from '../services/db';
import { translations } from '../services/i18n';
import {
  calculateNextDueDate,
  doesTransactionAffectAccounting,
  formatLocalDate,
  generateNextVoucherNumber,
  getTransactionWalletDeltas,
  isDateInLockedPeriod,
  parseLocalDate,
} from '../services/calculations';
import {
  convertCurrency,
  fetchLiveExchangeRates,
  getCachedExchangeRatesMeta,
  roundCurrency,
  setLiveExchangeRatesRuntime,
} from '../services/currency';
import { verifyAndUpgradePin } from '../services/security';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogle,
  signOutGoogle,
  ensureUserProfile,
  fetchUserProfile,
  fetchCloudBackupMeta,
  saveCloudBackup,
  fetchCloudBackup,
  redeemProCodeWithServer,
  startBusinessTrialWithServer,
  fetchScanQuotaFromServer,
  deleteAccountFromServer,
  syncOrganizationMetaToCloud,
  isEntitlementActive,
  resolvePlanTierFromProfile,
  CloudBackupPayload,
  ScanQuotaInfo,
} from '../services/firebase';
import {
  buildAppNotifications,
  dispatchBrowserNotification,
} from '../services/notifications';

export interface FilterState {
  type: 'all' | 'income' | 'expense';
  walletId?: string;
  categoryId?: string;
  priority?: PriorityLevel;
  group?: string;
  contact?: string;
  startDate?: string;
  endDate?: string;
  searchQuery: string;
}

export interface UndoAction {
  id: string;
  message: string;
  action: () => void;
}

export interface WalletDependencies {
  transactionsCount: number;
  budgetsCount: number;
  templatesCount: number;
  goalsCount: number;
  totalCount: number;
}

export interface CategoryDependencies {
  transactionsCount: number;
  budgetsCount: number;
  templatesCount: number;
  totalCount: number;
}

export type OrgHubTab = 'approvals' | 'cost_centers' | 'parties' | 'team' | 'reports';

interface AppContextType {
  // Core Data (reflects active Workspace: Personal OR Active Organization)
  isLoading: boolean;
  transactions: Transaction[];
  wallets: Wallet[];
  categories: Category[];
  budgets: Budget[];
  debts: Debt[];
  goals: SavingsGoal[];
  templates: Template[];
  moneyCircles: MoneyCircle[];
  settings: AppSettings;
  user: UserAccount | null;
  hasCompletedOnboarding: boolean;

  // Dual Workspace & Enterprise State
  activeWorkspace: string; // 'personal' | orgId
  orgWorkspaces: Record<string, OrgWorkspaceData>;
  isOrgWorkspace: boolean;
  organizationsList: Organization[];
  activeOrganization: Organization | null;
  orgMembers: OrganizationMember[];
  orgCostCenters: CostCenter[];
  orgParties: BusinessParty[];
  orgAuditLogs: AuditLogEntry[];
  activeOrgRole: OrganizationRole | null;
  canOrgWrite: boolean;
  canOrgApprove: boolean;
  canOrgManage: boolean;
  pendingApprovalsCount: number;
  switchWorkspace: (workspaceId: string) => void;
  createOrganization: (params: {
    name: string;
    currency: string;
    industry?: OrganizationIndustry;
    vatRate?: number;
    taxNumber?: string;
    approvalThreshold?: number;
    loadSampleData?: boolean;
  }) => Organization;
  joinOrganizationByCode: (inviteCode: string) => { ok: boolean; orgName?: string; error?: string };
  updateOrganizationSettings: (updates: Partial<Organization>) => void;
  lockAccountingPeriod: (lockedUntilDate: string | undefined) => void;

  // Enterprise Operations
  approveOrgTransaction: (txId: string) => void;
  rejectOrgTransaction: (txId: string, reason: string) => void;
  addCostCenter: (data: Omit<CostCenter, 'id' | 'orgId' | 'createdAt'>) => CostCenter | null;
  updateCostCenter: (id: string, updates: Partial<CostCenter>) => void;
  deleteCostCenter: (id: string) => void;
  addBusinessParty: (data: Omit<BusinessParty, 'id' | 'orgId' | 'createdAt'>) => BusinessParty | null;
  updateBusinessParty: (id: string, updates: Partial<BusinessParty>) => void;
  deleteBusinessParty: (id: string) => void;
  addOrUpdateOrgMember: (member: Omit<OrganizationMember, 'joinedAt'>) => void;
  removeOrgMember: (uid: string) => void;

  // Unified Enterprise Hub Modal
  isOrgHubOpen: boolean;
  setIsOrgHubOpen: (open: boolean) => void;
  orgHubTab: OrgHubTab;
  setOrgHubTab: (tab: OrgHubTab) => void;
  openOrgHub: (tab?: OrgHubTab) => void;

  // Active View / Modals
  activeNav: 'home' | 'budget' | 'wallets' | 'more';
  setActiveNav: (nav: 'home' | 'budget' | 'wallets' | 'more') => void;
  activeWalletId: string | null;
  setActiveWalletId: (id: string | null) => void;
  homeTab: 'transactions' | 'statistics' | 'templates';
  setHomeTab: (tab: 'transactions' | 'statistics' | 'templates') => void;
  isAddModalOpen: boolean;
  setIsAddModalOpen: (open: boolean) => void;
  editingTransaction: Transaction | null;
  setEditingTransaction: (t: Transaction | null) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isFilterOpen: boolean;
  setIsFilterOpen: (open: boolean) => void;
  isBackupOpen: boolean;
  setIsBackupOpen: (open: boolean) => void;
  isReportsOpen: boolean;
  setIsReportsOpen: (open: boolean) => void;
  isCategoriesManagerOpen: boolean;
  setIsCategoriesManagerOpen: (open: boolean) => void;
  isCurrenciesManagerOpen: boolean;
  setIsCurrenciesManagerOpen: (open: boolean) => void;
  isUpgradeModalOpen: boolean;
  setIsUpgradeModalOpen: (open: boolean) => void;

  // Currency Picker Modal
  currencyPickerOpen: boolean;
  currencyPickerSelectedCode?: string;
  openCurrencyPicker: (onSelect: (code: string) => void, selectedCode?: string) => void;
  closeCurrencyPicker: () => void;
  onCurrencySelectCallback: ((code: string) => void) | null;

  // Filters & Multi-Select
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  resetFilters: () => void;
  selectedTransactionIds: string[];
  toggleSelectTransaction: (id: string) => void;
  selectAllTransactions: (ids: string[]) => void;
  clearSelectedTransactions: () => void;
  changeSelectedTransactionsCategory: (categoryId: string) => void;

  // Security / App Lock
  isAppLocked: boolean;
  unlockApp: (pin: string) => Promise<boolean>;
  lockedWalletIds: string[];
  unlockWallet: (walletId: string, pin: string) => Promise<boolean>;

  // Pro & Monetization & Cloud Sync
  isPro: boolean;
  isBusinessPro: boolean;
  planTier: PlanTier;
  proEntitlement: VerifiedProEntitlement | null;
  redeemProCode: (code: string) => Promise<{ ok: boolean; error?: string }>;
  startBusinessTrial: () => Promise<{ ok: boolean; error?: string }>;
  devActivateProPreview: (tier?: 'personal_pro' | 'business_pro') => void;
  restorePurchases: () => Promise<boolean>;
  scanQuota: ScanQuotaInfo | null;
  setScanQuota: React.Dispatch<React.SetStateAction<ScanQuotaInfo | null>>;
  refreshScanQuota: () => Promise<void>;
  isCloudSyncing: boolean;
  cloudSyncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  cloudSyncError: string | null;
  cloudSkippedAttachmentsWarning: number;
  cloudConflict: { cloudUpdatedAtMs: number } | null;
  lastCloudBackupExists: boolean;
  signInWithGoogleAccount: () => Promise<{ restored: boolean; isProRestored: boolean } | null>;
  signOutGoogleAccount: () => Promise<void>;
  syncToCloudNow: (forceOverwrite?: boolean) => Promise<boolean>;
  restoreFromCloudNow: () => Promise<boolean>;
  resolveCloudConflictOverwrite: () => Promise<boolean>;
  clearCloudConflict: () => void;
  deleteAccountAndData: () => Promise<boolean>;

  // Backup Pre-Restore Snapshot Safety
  preRestoreSnapshotDate: number | null;
  createPreRestoreSnapshot: () => Promise<void>;
  revertPreRestoreSnapshot: () => Promise<boolean>;

  // Notifications Center
  notifications: AppNotificationItem[];
  unreadNotificationsCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  // Live Exchange Rates
  ratesLastUpdated: string | null;
  isRefreshingRates: boolean;
  refreshExchangeRates: () => Promise<boolean>;

  // Undo Notification
  undoAction: UndoAction | null;
  setUndoAction: (action: UndoAction | null) => void;
  triggerUndo: () => void;

  // CRUD Operations
  addTransaction: (data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Transaction;
  importTransactionsBatch: (items: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[]) => number;
  updateTransaction: (id: string, data: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  deleteSelectedTransactions: () => void;
  moveSelectedTransactions: (toWalletId: string) => void;
  duplicateTransaction: (id: string) => void;

  addWallet: (data: Omit<Wallet, 'id'>) => Wallet;
  updateWallet: (id: string, data: Partial<Wallet>) => void;
  getWalletDependencies: (id: string) => WalletDependencies;
  deleteWallet: (id: string) => void;
  migrateAndDeleteWallet: (walletId: string, targetWalletId: string) => void;

  addCategory: (data: Omit<Category, 'id'>) => Category;
  updateCategory: (id: string, data: Partial<Category>) => void;
  getCategoryDependencies: (id: string) => CategoryDependencies;
  deleteCategory: (id: string) => void;
  migrateAndDeleteCategory: (categoryId: string, targetCategoryId: string) => void;

  addBudget: (data: Omit<Budget, 'id'>) => Budget;
  updateBudget: (id: string, data: Partial<Budget>) => void;
  deleteBudget: (id: string) => void;

  addDebt: (data: Omit<Debt, 'id' | 'createdAt' | 'payments' | 'isSettled'>) => Debt;
  updateDebt: (id: string, data: Partial<Debt>) => void;
  recordDebtPayment: (
    debtId: string,
    payment: { amount: number; date: string; walletId?: string; notes?: string },
    logAsTx: boolean
  ) => void;
  deleteDebt: (id: string) => void;

  addGoal: (data: Omit<SavingsGoal, 'id' | 'createdAt' | 'isCompleted'>) => SavingsGoal;
  updateGoal: (id: string, data: Partial<SavingsGoal>) => void;
  contributeToGoal: (goalId: string, amount: number, walletId?: string, isWithdrawal?: boolean) => void;
  deleteGoal: (id: string) => void;

  addTemplate: (data: Omit<Template, 'id'>) => Template;
  updateTemplate: (id: string, data: Partial<Template>) => void;
  deleteTemplate: (id: string) => void;
  applyTemplate: (templateId: string) => void;

  addMoneyCircle: (
    data: Omit<MoneyCircle, 'id' | 'createdAt' | 'paidMonths' | 'hasReceivedPayout'>
  ) => MoneyCircle;
  updateMoneyCircle: (id: string, updates: Partial<MoneyCircle>) => void;
  deleteMoneyCircle: (id: string) => void;
  toggleMoneyCircleMonthPaid: (circleId: string, monthNumber: number, logWalletTx?: boolean) => void;
  markMoneyCirclePayoutReceived: (circleId: string, logWalletTx?: boolean) => void;

  updateSettings: (partial: Partial<AppSettings>) => void;
  completeOnboarding: (mainCurrency: string, firstWalletName: string, initialBalance: number) => void;
  loadDemoData: () => void;
  resetAllData: () => void;

  // Helpers
  t: (key: keyof typeof translations.ar) => string;
  isRTL: boolean;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);

  // Personal Workspace State (source for Personal IndexedDB root_state)
  const [personalTransactions, setPersonalTransactions] = useState<Transaction[]>([]);
  const [personalWallets, setPersonalWallets] = useState<Wallet[]>(DEFAULT_WALLETS);
  const [personalCategories, setPersonalCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [personalBudgets, setPersonalBudgets] = useState<Budget[]>([]);
  const [personalDebts, setPersonalDebts] = useState<Debt[]>([]);
  const [personalGoals, setPersonalGoals] = useState<SavingsGoal[]>([]);
  const [personalTemplates, setPersonalTemplates] = useState<Template[]>([]);
  const [personalMoneyCircles, setPersonalMoneyCircles] = useState<MoneyCircle[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [user, setUser] = useState<UserAccount | null>(null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);

  // Dual Workspace / Enterprise State
  const [activeWorkspace, setActiveWorkspace] = useState<string>('personal');
  const [orgWorkspaces, setOrgWorkspaces] = useState<Record<string, OrgWorkspaceData>>({});

  // Cloud Sync State
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const [cloudSkippedAttachmentsWarning, setCloudSkippedAttachmentsWarning] = useState(0);
  const [cloudConflict, setCloudConflict] = useState<{ cloudUpdatedAtMs: number } | null>(null);
  const [lastCloudBackupExists, setLastCloudBackupExists] = useState(false);
  const [preRestoreSnapshotDate, setPreRestoreSnapshotDate] = useState<number | null>(null);
  const skipNextAutoSyncRef = React.useRef(false);

  // Verified server PRO entitlement
  const [verifiedPro, setVerifiedPro] = useState<VerifiedProEntitlement | null>(null);
  const [devProTierPreview, setDevProTierPreview] = useState<null | 'personal_pro' | 'business_pro'>(null);
  const [scanQuota, setScanQuota] = useState<ScanQuotaInfo | null>(null);

  // Live Exchange Rates status
  const [ratesLastUpdated, setRatesLastUpdated] = useState<string | null>(null);
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);

  // Nav & Tabs & Modals
  const [activeNav, setActiveNav] = useState<'home' | 'budget' | 'wallets' | 'more'>('home');
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [homeTab, setHomeTab] = useState<'transactions' | 'statistics' | 'templates'>('transactions');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isReportsOpen, setIsReportsOpen] = useState(false);
  const [isCategoriesManagerOpen, setIsCategoriesManagerOpen] = useState(false);
  const [isCurrenciesManagerOpen, setIsCurrenciesManagerOpen] = useState(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [isOrgHubOpen, setIsOrgHubOpen] = useState(false);
  const [orgHubTab, setOrgHubTab] = useState<OrgHubTab>('approvals');

  const openOrgHub = useCallback((tab: OrgHubTab = 'approvals') => {
    setOrgHubTab(tab);
    setIsOrgHubOpen(true);
  }, []);

  // Currency Picker Modal
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [currencyPickerSelectedCode, setCurrencyPickerSelectedCode] = useState<string | undefined>(undefined);
  const [onCurrencySelectCallback, setOnCurrencySelectCallback] = useState<((code: string) => void) | null>(null);

  // Multi-Select & Undo
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [isAppLocked, setIsAppLocked] = useState(false);
  const [lockedWalletIds, setLockedWalletIds] = useState<string[]>([]);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);

  // Notifications Read State
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());

  // Entitlement computations (strictly checking expiresAt)
  const isPro =
    isEntitlementActive(verifiedPro) || (import.meta.env.DEV && devProTierPreview !== null);

  const planTier: PlanTier = useMemo(() => {
    if (import.meta.env.DEV && devProTierPreview) return devProTierPreview;
    return resolvePlanTierFromProfile(verifiedPro);
  }, [verifiedPro, devProTierPreview]);

  const isBusinessPro = planTier === 'business_pro';

  // Active workspace projection
  const activeOrgData: OrgWorkspaceData | null =
    activeWorkspace !== 'personal' && orgWorkspaces[activeWorkspace]
      ? orgWorkspaces[activeWorkspace]
      : null;
  const isOrgWorkspace = activeOrgData !== null;
  const activeOrganization = activeOrgData?.organization || null;

  const transactions = activeOrgData ? activeOrgData.transactions : personalTransactions;
  const wallets = activeOrgData ? activeOrgData.wallets : personalWallets;
  const categories = activeOrgData ? activeOrgData.categories : personalCategories;
  const budgets = activeOrgData ? activeOrgData.budgets : personalBudgets;
  const debts = activeOrgData ? activeOrgData.debts : personalDebts;
  const goals = activeOrgData ? activeOrgData.goals : personalGoals;
  const templates = activeOrgData ? activeOrgData.templates : personalTemplates;

  const orgMembers = activeOrgData ? activeOrgData.members : [];
  const orgCostCenters = activeOrgData ? activeOrgData.costCenters : [];
  const orgParties = activeOrgData ? activeOrgData.parties : [];
  const orgAuditLogs = activeOrgData ? activeOrgData.auditLogs : [];

  const organizationsList = useMemo(
    () => Object.values(orgWorkspaces).map((w) => w.organization),
    [orgWorkspaces]
  );

  const activeOrgRole: OrganizationRole | null = useMemo(() => {
    if (!activeOrgData) return null;
    const uid = user?.id || 'local-owner';
    const match =
      activeOrgData.members.find((m) => m.uid === uid) ||
      activeOrgData.members.find((m) => m.uid === 'local-owner');
    if (match) return match.role;
    if (activeOrgData.organization.ownerUid === uid || activeOrgData.organization.ownerUid === 'local-owner') {
      return 'owner';
    }
    return 'employee';
  }, [activeOrgData, user?.id]);

  const canOrgWrite = !isOrgWorkspace || activeOrgRole !== 'viewer';
  const canOrgApprove =
    !isOrgWorkspace ||
    activeOrgRole === 'owner' ||
    activeOrgRole === 'admin' ||
    activeOrgRole === 'accountant';
  const canOrgManage =
    !isOrgWorkspace || activeOrgRole === 'owner' || activeOrgRole === 'admin';

  const pendingApprovalsCount = useMemo(
    () =>
      isOrgWorkspace
        ? transactions.filter((tx) => tx.approvalStatus === 'pending_approval').length
        : 0,
    [isOrgWorkspace, transactions]
  );

  // Refs for latest snapshots
  const latestPersonalRef = React.useRef<AppDatabaseData>({
    transactions: personalTransactions,
    wallets: personalWallets,
    categories: personalCategories,
    budgets: personalBudgets,
    debts: personalDebts,
    goals: personalGoals,
    templates: personalTemplates,
    moneyCircles: personalMoneyCircles,
    settings,
    user,
    hasCompletedOnboarding,
  });
  latestPersonalRef.current = {
    transactions: personalTransactions,
    wallets: personalWallets,
    categories: personalCategories,
    budgets: personalBudgets,
    debts: personalDebts,
    goals: personalGoals,
    templates: personalTemplates,
    moneyCircles: personalMoneyCircles,
    settings,
    user,
    hasCompletedOnboarding,
  };

  const latestOrgRef = React.useRef({ activeWorkspace, orgWorkspaces });
  latestOrgRef.current = { activeWorkspace, orgWorkspaces };

  const savePersonalState = useCallback(
    (updates?: Partial<AppDatabaseData>) => {
      const snap = latestPersonalRef.current;
      const nextData: AppDatabaseData = {
        transactions: updates?.transactions ?? snap.transactions,
        wallets: updates?.wallets ?? snap.wallets,
        categories: updates?.categories ?? snap.categories,
        budgets: updates?.budgets ?? snap.budgets,
        debts: updates?.debts ?? snap.debts,
        goals: updates?.goals ?? snap.goals,
        templates: updates?.templates ?? snap.templates,
        moneyCircles: updates?.moneyCircles ?? snap.moneyCircles,
        settings: updates?.settings ?? snap.settings,
        user: updates?.user !== undefined ? updates.user : snap.user,
        hasCompletedOnboarding: updates?.hasCompletedOnboarding ?? snap.hasCompletedOnboarding,
      };
      void persistData(nextData);
    },
    []
  );

  const updateActiveOrgWorkspace = useCallback(
    (updater: (prev: OrgWorkspaceData) => OrgWorkspaceData) => {
      const { activeWorkspace: wsId, orgWorkspaces: map } = latestOrgRef.current;
      const current = map[wsId];
      if (!current) return;
      const updated = updater(current);
      const nextMap = { ...map, [wsId]: updated };
      setOrgWorkspaces(nextMap);
      void saveOrgWorkspaces(wsId, nextMap);
    },
    []
  );

  const createAuditEntry = useCallback(
    (
      orgId: string,
      action: AuditLogAction,
      entityType: AuditLogEntry['entityType'],
      entityId: string,
      summary: string,
      before?: unknown,
      after?: unknown
    ): AuditLogEntry => {
      return {
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        orgId,
        action,
        entityType,
        entityId,
        actorUid: user?.id || 'local-owner',
        actorName: user?.name || (settings.language === 'en' ? 'Account Owner' : 'مالك المؤسسة'),
        summary,
        before,
        after,
        timestamp: Date.now(),
      };
    },
    [user?.id, user?.name, settings.language]
  );

  const applyVerifiedProState = useCallback(async (entitlement: VerifiedProEntitlement | null) => {
    setVerifiedPro(entitlement);
    await saveVerifiedProCache(entitlement);
  }, []);

  const refreshScanQuota = useCallback(async () => {
    if (!auth.currentUser) {
      setScanQuota(null);
      return;
    }
    try {
      const q = await fetchScanQuotaFromServer();
      if (q) setScanQuota(q);
    } catch {
      // Non-fatal
    }
  }, []);

  const refreshExchangeRates = useCallback(async (force = true): Promise<boolean> => {
    setIsRefreshingRates(true);
    try {
      const result = await fetchLiveExchangeRates(force);
      if (result) {
        const formatted = new Date(result.fetchedAtMs).toLocaleDateString(
          latestPersonalRef.current.settings.language === 'ar' ? 'ar-EG' : 'en-US',
          { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        );
        setRatesLastUpdated(formatted);
        setSettings((prev) => {
          const next = { ...prev, ratesLastUpdated: formatted, ratesUpdatedAtMs: result.fetchedAtMs };
          void persistData({ ...latestPersonalRef.current, settings: next });
          return next;
        });
        return true;
      }
      return false;
    } finally {
      setIsRefreshingRates(false);
    }
  }, []);

  const createPreRestoreSnapshot = useCallback(async () => {
    await savePreRestoreSnapshot(latestPersonalRef.current);
    setPreRestoreSnapshotDate(Date.now());
  }, []);

  const revertPreRestoreSnapshot = useCallback(async (): Promise<boolean> => {
    const snap = await loadPreRestoreSnapshot();
    if (!snap) return false;
    skipNextAutoSyncRef.current = true;
    const restoredData = snap.data;
    setPersonalTransactions(restoredData.transactions);
    setPersonalWallets(restoredData.wallets);
    setPersonalCategories(restoredData.categories);
    setPersonalBudgets(restoredData.budgets);
    setPersonalDebts(restoredData.debts);
    setPersonalGoals(restoredData.goals);
    setPersonalTemplates(restoredData.templates);
    setPersonalMoneyCircles(restoredData.moneyCircles || []);
    setSettings((prev) => ({
      ...mergeSettingsWithDefaults(restoredData.settings),
      lastKnownCloudUpdatedAtMs: prev.lastKnownCloudUpdatedAtMs,
    }));
    setHasCompletedOnboarding(restoredData.hasCompletedOnboarding);
    await persistData({ ...restoredData, user: latestPersonalRef.current.user });
    return true;
  }, []);

  const applyCloudBackupLocally = useCallback(
    (backup: CloudBackupPayload, currentUser: UserAccount | null) => {
      skipNextAutoSyncRef.current = true;
      const prevSettings = latestPersonalRef.current.settings;
      const resolvedOnboarded = Boolean(backup.hasCompletedOnboarding ?? true);
      const mergedSettings: AppSettings = {
        ...mergeSettingsWithDefaults(backup.settings),
        lastCloudSyncAt: backup.updatedAtMs || Date.now(),
        lastKnownCloudUpdatedAtMs: backup.updatedAtMs || prevSettings.lastKnownCloudUpdatedAtMs || Date.now(),
      };
      // Respect user deletions post-onboarding: never force DEFAULT_* when onboarded
      const resolvedWallets = backup.wallets?.length
        ? backup.wallets
        : resolvedOnboarded
        ? []
        : DEFAULT_WALLETS;
      const resolvedCategories = backup.categories?.length
        ? backup.categories
        : resolvedOnboarded
        ? []
        : DEFAULT_CATEGORIES;
      const resolvedTransactions = backup.transactions || [];
      const resolvedBudgets = backup.budgets || [];
      const resolvedDebts = backup.debts || [];
      const resolvedGoals = backup.goals || [];
      const resolvedTemplates = backup.templates || [];
      const resolvedMoneyCircles = backup.moneyCircles || [];

      setPersonalTransactions(resolvedTransactions);
      setPersonalWallets(resolvedWallets);
      setPersonalCategories(resolvedCategories);
      setPersonalBudgets(resolvedBudgets);
      setPersonalDebts(resolvedDebts);
      setPersonalGoals(resolvedGoals);
      setPersonalTemplates(resolvedTemplates);
      setPersonalMoneyCircles(resolvedMoneyCircles);
      setSettings(mergedSettings);
      setHasCompletedOnboarding(resolvedOnboarded);
      setCloudConflict(null);
      setCloudSyncStatus('synced');
      setCloudSyncError(null);

      if (backup.orgWorkspaces && typeof backup.orgWorkspaces === 'object' && !Array.isArray(backup.orgWorkspaces)) {
        const restoredOrgs = backup.orgWorkspaces;
        const resolvedActiveWs =
          backup.activeWorkspace && restoredOrgs[backup.activeWorkspace]
            ? backup.activeWorkspace
            : 'personal';
        setOrgWorkspaces(restoredOrgs);
        setActiveWorkspace(resolvedActiveWs);
        void saveOrgWorkspaces(resolvedActiveWs, restoredOrgs);
      }

      void persistData({
        transactions: resolvedTransactions,
        wallets: resolvedWallets,
        categories: resolvedCategories,
        budgets: resolvedBudgets,
        debts: resolvedDebts,
        goals: resolvedGoals,
        templates: resolvedTemplates,
        moneyCircles: resolvedMoneyCircles,
        settings: mergedSettings,
        user: currentUser,
        hasCompletedOnboarding: resolvedOnboarded,
      });
    },
    []
  );

  const devActivateProPreview = useCallback((tier: 'personal_pro' | 'business_pro' = 'business_pro') => {
    if (!import.meta.env.DEV) return;
    setDevProTierPreview(tier);
    setIsUpgradeModalOpen(false);
  }, []);

  const redeemProCode = useCallback(
    async (code: string): Promise<{ ok: boolean; error?: string }> => {
      if (!auth.currentUser) {
        return {
          ok: false,
          error:
            latestPersonalRef.current.settings.language === 'en'
              ? 'Please sign in with Google first so your PRO license is linked to your account.'
              : 'يرجى تسجيل الدخول بحساب جوجل أولاً لربط اشتراك PRO بحسابك.',
        };
      }
      try {
        const res = await redeemProCodeWithServer(code);
        const entitlement: VerifiedProEntitlement = {
          uid: auth.currentUser.uid,
          isPro: true,
          proPlan: res.proPlan,
          planTier: res.planTier,
          billingCycle: res.billingCycle,
          expiresAt: res.expiresAt,
          proExpiresAt: res.expiresAt,
          verifiedAt: Date.now(),
        };
        await applyVerifiedProState(entitlement);
        await refreshScanQuota();
        return { ok: true };
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : latestPersonalRef.current.settings.language === 'en'
            ? 'Failed to verify activation code.'
            : 'تعذر التحقق من كود التفعيل.';
        return { ok: false, error: msg };
      }
    },
    [applyVerifiedProState, refreshScanQuota]
  );

  const startBusinessTrial = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!auth.currentUser) {
      return {
        ok: false,
        error:
          latestPersonalRef.current.settings.language === 'en'
            ? 'Please sign in with Google first to activate your 14-day Business Trial.'
            : 'يرجى تسجيل الدخول بحساب جوجل أولاً لتفعيل الفترة التجريبية لباقة الأعمال (14 يوماً).',
      };
    }
    try {
      const res = await startBusinessTrialWithServer();
      const entitlement: VerifiedProEntitlement = {
        uid: auth.currentUser.uid,
        isPro: true,
        proPlan: res.proPlan,
        planTier: res.planTier,
        billingCycle: res.billingCycle,
        expiresAt: res.expiresAt,
        proExpiresAt: res.expiresAt,
        verifiedAt: Date.now(),
      };
      await applyVerifiedProState(entitlement);
      await refreshScanQuota();
      return { ok: true };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : latestPersonalRef.current.settings.language === 'en'
          ? 'Could not activate trial.'
          : 'تعذر تفعيل الفترة التجريبية.';
      return { ok: false, error: msg };
    }
  }, [applyVerifiedProState, refreshScanQuota]);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (isEntitlementActive(verifiedPro)) {
      return true;
    }
    if (auth.currentUser) {
      try {
        const profile = await fetchUserProfile(auth.currentUser.uid);
        if (profile && isEntitlementActive(profile)) {
          await applyVerifiedProState({
            uid: auth.currentUser.uid,
            isPro: true,
            proPlan: profile.proPlan || 'code',
            planTier: profile.planTier,
            billingCycle: profile.billingCycle,
            expiresAt: profile.proExpiresAt ?? profile.expiresAt,
            proExpiresAt: profile.proExpiresAt ?? profile.expiresAt,
            verifiedAt: Date.now(),
          });
          await refreshScanQuota();
          return true;
        }
      } catch (err) {
        console.warn('Cloud PRO restore error:', err);
      }
    }
    return false;
  }, [verifiedPro, applyVerifiedProState, refreshScanQuota]);

  // Filters
  const [filters, setFilters] = useState<FilterState>({
    type: 'all',
    searchQuery: '',
  });

  const resetFilters = useCallback(() => {
    setFilters({
      type: 'all',
      searchQuery: '',
    });
  }, []);

  // Sync HTML dir and dark class
  useEffect(() => {
    const isRtl = settings.language === 'ar';
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = settings.language;
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.language, settings.theme]);

  // Recurring transactions processor (preserves loadedData.user!)
  const processRecurringTransactions = useCallback(
    (loadedData: AppDatabaseData, initialWallets: Wallet[]) => {
      const existingTx = loadedData.transactions || [];
      const customRates = loadedData.settings?.customExchangeRates;
      const today = formatLocalDate(new Date());
      const newTxList: Transaction[] = [];
      const updatedTx = existingTx.map((item) => ({
        ...item,
        recurrenceRule: item.recurrenceRule ? { ...item.recurrenceRule } : undefined,
      }));
      const updatedWallets = initialWallets.map((w) => ({ ...w }));

      for (const tx of updatedTx) {
        if (tx.isRecurring && tx.recurrenceRule) {
          const rule = { ...tx.recurrenceRule };
          if (!rule.anchorDayOfMonth && tx.date) {
            rule.anchorDayOfMonth = parseLocalDate(tx.date).getDate();
          }
          let dueDate = rule.nextDueDate;

          while (dueDate && dueDate <= today) {
            if (rule.maxOccurrences && rule.occurrencesCount >= rule.maxOccurrences) break;
            if (rule.endDate && dueDate > rule.endDate) break;

            const generated: Transaction = {
              ...tx,
              id: `recurring-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              date: dueDate,
              isRecurring: false,
              recurrenceRule: undefined,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            newTxList.push(generated);

            if (doesTransactionAffectAccounting(generated)) {
              const sourceWallet = updatedWallets.find((w) => w.id === generated.walletId);
              if (generated.type === 'expense' && sourceWallet) {
                const delta = convertCurrency(
                  generated.amount,
                  generated.currency,
                  sourceWallet.currency,
                  customRates
                );
                sourceWallet.balance = roundCurrency(sourceWallet.balance - delta, sourceWallet.currency);
              } else if (generated.type === 'income' && sourceWallet) {
                const delta = convertCurrency(
                  generated.amount,
                  generated.currency,
                  sourceWallet.currency,
                  customRates
                );
                sourceWallet.balance = roundCurrency(sourceWallet.balance + delta, sourceWallet.currency);
              } else if (generated.type === 'transfer' && generated.toWalletId) {
                if (sourceWallet) {
                  const totalSource = generated.amount + (generated.transferFee || 0);
                  const srcDelta = convertCurrency(
                    totalSource,
                    generated.currency,
                    sourceWallet.currency,
                    customRates
                  );
                  sourceWallet.balance = roundCurrency(
                    sourceWallet.balance - srcDelta,
                    sourceWallet.currency
                  );
                }
                const destWallet = updatedWallets.find((w) => w.id === generated.toWalletId);
                if (destWallet) {
                  const destDelta =
                    generated.convertedAmount ??
                    convertCurrency(
                      generated.amount,
                      generated.currency,
                      destWallet.currency,
                      customRates
                    );
                  destWallet.balance = roundCurrency(destWallet.balance + destDelta, destWallet.currency);
                }
              }
            }

            rule.occurrencesCount += 1;
            rule.lastGeneratedDate = dueDate;
            dueDate = calculateNextDueDate(rule, dueDate);
            rule.nextDueDate = dueDate;
          }

          tx.recurrenceRule = rule;
        }
      }

      if (newTxList.length > 0) {
        const allTx = [...newTxList, ...updatedTx];
        setPersonalTransactions(allTx);
        setPersonalWallets(updatedWallets);
        // Preserve loadedData.user rather than setting user: null!
        void persistData({
          ...loadedData,
          transactions: allTx,
          wallets: updatedWallets,
          user: loadedData.user || null,
        });
      }
    },
    []
  );

  // Load from database on startup
  useEffect(() => {
    async function init() {
      const [data, cachedPro, preSnap, orgData] = await Promise.all([
        loadInitialData(),
        loadVerifiedProCache(),
        loadPreRestoreSnapshot(),
        loadOrgWorkspaces(),
      ]);

      const onboarded = Boolean(data.hasCompletedOnboarding);
      const resolvedWallets = data.wallets?.length
        ? data.wallets
        : onboarded
        ? []
        : DEFAULT_WALLETS;
      const resolvedCategories = data.categories?.length
        ? data.categories
        : onboarded
        ? []
        : DEFAULT_CATEGORIES;

      setPersonalTransactions(data.transactions || []);
      setPersonalWallets(resolvedWallets);
      setPersonalCategories(resolvedCategories);
      setPersonalBudgets(data.budgets || []);
      setPersonalDebts(data.debts || []);
      setPersonalGoals(data.goals || []);
      const resolvedSettings = mergeSettingsWithDefaults(data.settings);
      setPersonalTemplates(data.templates || []);
      setPersonalMoneyCircles(data.moneyCircles || []);
      setSettings(resolvedSettings);
      setUser(data.user || null);
      setHasCompletedOnboarding(onboarded);
      setOrgWorkspaces(orgData.workspaces || {});
      setActiveWorkspace(
        orgData.activeWorkspace && orgData.workspaces?.[orgData.activeWorkspace]
          ? orgData.activeWorkspace
          : 'personal'
      );

      if (preSnap) {
        setPreRestoreSnapshotDate(preSnap.updatedAt);
      }

      if (cachedPro && isEntitlementActive(cachedPro) && (!data.user || cachedPro.uid === data.user.id)) {
        setVerifiedPro(cachedPro);
      } else if (cachedPro && !isEntitlementActive(cachedPro)) {
        void saveVerifiedProCache(null);
      }

      const cachedRates = getCachedExchangeRatesMeta();
      if (data.settings?.useUpdatedExchangeRates && cachedRates) {
        setLiveExchangeRatesRuntime(cachedRates.rates);
        setRatesLastUpdated(
          new Date(cachedRates.fetchedAtMs).toLocaleDateString(
            data.settings.language === 'ar' ? 'ar-EG' : 'en-US',
            { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
          )
        );
      } else if (data.settings?.ratesLastUpdated) {
        setRatesLastUpdated(data.settings.ratesLastUpdated);
      }

      if (data.settings?.isAppLockEnabled && data.settings?.appPin) {
        setIsAppLocked(true);
      }

      processRecurringTransactions(
        {
          ...data,
          wallets: resolvedWallets,
          categories: resolvedCategories,
          settings: resolvedSettings,
        },
        resolvedWallets
      );

      setTimeout(() => {
        setIsLoading(false);
      }, 400);
    }
    void init();
  }, [processRecurringTransactions]);

  // Refresh or disable live exchange rates when setting toggles
  useEffect(() => {
    if (isLoading) return;
    if (!settings.useUpdatedExchangeRates) {
      setLiveExchangeRatesRuntime(null);
      return;
    }
    void fetchLiveExchangeRates(false).then((res) => {
      if (res) {
        const formatted = new Date(res.fetchedAtMs).toLocaleDateString(
          settings.language === 'ar' ? 'ar-EG' : 'en-US',
          { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        );
        setRatesLastUpdated(formatted);
      }
    });
  }, [isLoading, settings.useUpdatedExchangeRates, settings.language]);

  // Firebase Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setLastCloudBackupExists(false);
        setScanQuota(null);
        return;
      }

      const nextUser: UserAccount = {
        id: firebaseUser.uid,
        name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Raseedi User',
        email: firebaseUser.email || '',
        avatarUrl: firebaseUser.photoURL || undefined,
        isLoggedIn: true,
      };
      setUser(nextUser);

      try {
        const [profile, cloudMeta] = await Promise.all([
          ensureUserProfile(firebaseUser),
          fetchCloudBackupMeta(firebaseUser.uid).catch(() => null),
        ]);

        const active = isEntitlementActive(profile);
        const entitlement: VerifiedProEntitlement = {
          uid: firebaseUser.uid,
          isPro: active,
          proPlan: active ? profile.proPlan || 'code' : 'free',
          planTier: resolvePlanTierFromProfile(profile),
          billingCycle: active ? profile.billingCycle || 'lifetime' : 'free',
          expiresAt: profile.proExpiresAt ?? profile.expiresAt ?? null,
          proExpiresAt: profile.proExpiresAt ?? profile.expiresAt ?? null,
          verifiedAt: Date.now(),
        };
        await applyVerifiedProState(entitlement);

        setLastCloudBackupExists(Boolean(cloudMeta));
        void refreshScanQuota();

        const snap = latestPersonalRef.current;
        if (cloudMeta && snap.transactions.length === 0 && !snap.hasCompletedOnboarding) {
          const cloudBackup = await fetchCloudBackup(firebaseUser.uid);
          if (cloudBackup) {
            applyCloudBackupLocally(cloudBackup, nextUser);
          }
        } else if (
          cloudMeta &&
          cloudMeta.updatedAtMs > (snap.settings.lastKnownCloudUpdatedAtMs || 0)
        ) {
          setCloudConflict({ cloudUpdatedAtMs: cloudMeta.updatedAtMs });
        }
      } catch (err) {
        console.warn('Cloud auth sync warning:', err);
      }
    });

    return () => unsubscribe();
  }, [applyCloudBackupLocally, applyVerifiedProState, refreshScanQuota]);

  const signInWithGoogleAccount = useCallback(async (): Promise<{
    restored: boolean;
    isProRestored: boolean;
  } | null> => {
    setIsCloudSyncing(true);
    setCloudSyncError(null);
    try {
      const { firebaseUser, profile } = await signInWithGoogle();
      const nextUser: UserAccount = {
        id: firebaseUser.uid,
        name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Raseedi User',
        email: firebaseUser.email || '',
        avatarUrl: firebaseUser.photoURL || undefined,
        isLoggedIn: true,
      };
      setUser(nextUser);

      const active = isEntitlementActive(profile);
      await applyVerifiedProState({
        uid: firebaseUser.uid,
        isPro: active,
        proPlan: active ? profile.proPlan || 'code' : 'free',
        planTier: resolvePlanTierFromProfile(profile),
        billingCycle: active ? profile.billingCycle || 'lifetime' : 'free',
        expiresAt: profile.proExpiresAt ?? profile.expiresAt ?? null,
        proExpiresAt: profile.proExpiresAt ?? profile.expiresAt ?? null,
        verifiedAt: Date.now(),
      });
      void refreshScanQuota();

      const cloudMeta = await fetchCloudBackupMeta(firebaseUser.uid).catch(() => null);
      setLastCloudBackupExists(Boolean(cloudMeta));

      const snap = latestPersonalRef.current;
      let restored = false;
      if (cloudMeta && (snap.transactions.length === 0 || !snap.hasCompletedOnboarding)) {
        const cloudBackup = await fetchCloudBackup(firebaseUser.uid);
        if (cloudBackup) {
          applyCloudBackupLocally(cloudBackup, nextUser);
          restored = true;
        }
      } else {
        if (
          cloudMeta &&
          cloudMeta.updatedAtMs > (snap.settings.lastKnownCloudUpdatedAtMs || 0)
        ) {
          setCloudConflict({ cloudUpdatedAtMs: cloudMeta.updatedAtMs });
        }
        savePersonalState({ user: nextUser });
      }

      return { restored, isProRestored: active };
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : latestPersonalRef.current.settings.language === 'en'
          ? 'Google sign-in failed'
          : 'تعذر تسجيل الدخول بحساب جوجل';
      setCloudSyncError(msg);
      return null;
    } finally {
      setIsCloudSyncing(false);
    }
  }, [applyCloudBackupLocally, applyVerifiedProState, refreshScanQuota, savePersonalState]);

  const signOutGoogleAccount = useCallback(async () => {
    setIsCloudSyncing(true);
    try {
      await signOutGoogle();
      setUser(null);
      setLastCloudBackupExists(false);
      setCloudConflict(null);
      setCloudSyncStatus('idle');
      setCloudSyncError(null);
      setScanQuota(null);
      await applyVerifiedProState(null);
      savePersonalState({ user: null });
    } finally {
      setIsCloudSyncing(false);
    }
  }, [applyVerifiedProState, savePersonalState]);

  const syncToCloudNow = useCallback(async (forceOverwrite = false): Promise<boolean> => {
    if (!auth.currentUser) return false;
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setCloudSyncError(null);
    const snap = latestPersonalRef.current;

    try {
      await ensureUserProfile(auth.currentUser);

      if (!forceOverwrite) {
        const cloudMeta = await fetchCloudBackupMeta(auth.currentUser.uid);
        if (
          cloudMeta &&
          cloudMeta.updatedAtMs > (snap.settings.lastKnownCloudUpdatedAtMs || 0)
        ) {
          setCloudConflict({ cloudUpdatedAtMs: cloudMeta.updatedAtMs });
          setCloudSyncStatus('error');
          setCloudSyncError(
            snap.settings.language === 'en'
              ? 'A newer cloud backup exists from another device. Restore it or confirm overwrite.'
              : 'توجد نسخة سحابية أحدث من جهاز آخر. يمكنك استعادتها أو تأكيد استبدالها.'
          );
          return false;
        }
      }

      const { syncedAt, updatedAtMs, skippedAttachmentsCount } = await saveCloudBackup(
        auth.currentUser.uid,
        {
          transactions: snap.transactions,
          wallets: snap.wallets,
          categories: snap.categories,
          budgets: snap.budgets,
          debts: snap.debts,
          goals: snap.goals,
          templates: snap.templates,
          moneyCircles: snap.moneyCircles,
          orgWorkspaces: latestOrgRef.current.orgWorkspaces,
          activeWorkspace: latestOrgRef.current.activeWorkspace,
          settings: snap.settings,
          hasCompletedOnboarding: snap.hasCompletedOnboarding,
        }
      );

      setCloudSkippedAttachmentsWarning(skippedAttachmentsCount);
      setLastCloudBackupExists(true);
      setCloudConflict(null);
      setCloudSyncStatus('synced');
      skipNextAutoSyncRef.current = true;
      setSettings((prev) => {
        const next = {
          ...prev,
          lastCloudSyncAt: syncedAt,
          lastKnownCloudUpdatedAtMs: updatedAtMs,
          lastBackupAt: syncedAt,
        };
        void persistData({ ...latestPersonalRef.current, settings: next });
        return next;
      });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Cloud backup failed';
      setCloudSyncStatus('error');
      setCloudSyncError(msg);
      return false;
    } finally {
      setIsCloudSyncing(false);
    }
  }, []);

  const restoreFromCloudNow = useCallback(async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setCloudSyncError(null);
    try {
      await createPreRestoreSnapshot();
      const [profile, cloudBackup] = await Promise.all([
        fetchUserProfile(auth.currentUser.uid),
        fetchCloudBackup(auth.currentUser.uid),
      ]);

      const active = isEntitlementActive(profile);
      await applyVerifiedProState({
        uid: auth.currentUser.uid,
        isPro: active,
        proPlan: active ? profile?.proPlan || 'code' : 'free',
        planTier: resolvePlanTierFromProfile(profile),
        billingCycle: active ? profile?.billingCycle || 'lifetime' : 'free',
        expiresAt: profile?.proExpiresAt ?? profile?.expiresAt ?? null,
        proExpiresAt: profile?.proExpiresAt ?? profile?.expiresAt ?? null,
        verifiedAt: Date.now(),
      });
      void refreshScanQuota();

      if (cloudBackup) {
        applyCloudBackupLocally(cloudBackup, latestPersonalRef.current.user);
        setLastCloudBackupExists(true);
        return true;
      }
      setCloudSyncStatus('idle');
      return active;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Cloud restore failed';
      setCloudSyncStatus('error');
      setCloudSyncError(msg);
      return false;
    } finally {
      setIsCloudSyncing(false);
    }
  }, [applyCloudBackupLocally, applyVerifiedProState, createPreRestoreSnapshot, refreshScanQuota]);

  const resolveCloudConflictOverwrite = useCallback(async () => syncToCloudNow(true), [syncToCloudNow]);
  const clearCloudConflict = useCallback(() => setCloudConflict(null), []);

  const deleteAccountAndData = useCallback(async (): Promise<boolean> => {
    try {
      if (auth.currentUser) {
        await deleteAccountFromServer();
        await signOutGoogle().catch(() => {});
      }
      await clearLocalAppStorageAndDb();
      setPersonalTransactions([]);
      setPersonalWallets(DEFAULT_WALLETS);
      setPersonalCategories(DEFAULT_CATEGORIES);
      setPersonalBudgets([]);
      setPersonalDebts([]);
      setPersonalGoals([]);
      setPersonalTemplates([]);
      setPersonalMoneyCircles([]);
      setOrgWorkspaces({});
      setActiveWorkspace('personal');
      setSettings(DEFAULT_SETTINGS);
      setUser(null);
      setVerifiedPro(null);
      setDevProTierPreview(null);
      setScanQuota(null);
      setPreRestoreSnapshotDate(null);
      setLastCloudBackupExists(false);
      setCloudConflict(null);
      setCloudSyncStatus('idle');
      setCloudSyncError(null);
      setHasCompletedOnboarding(false);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Account deletion failed';
      setCloudSyncError(msg);
      return false;
    }
  }, []);

  // Auto cloud sync (personal state)
  useEffect(() => {
    if (!user?.isLoggedIn || !auth.currentUser || !hasCompletedOnboarding) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (cloudConflict) return;
    if (skipNextAutoSyncRef.current) {
      skipNextAutoSyncRef.current = false;
      return;
    }

    const timer = window.setTimeout(async () => {
      if (!auth.currentUser) return;
      const snap = latestPersonalRef.current;
      try {
        setCloudSyncStatus('syncing');
        const cloudMeta = await fetchCloudBackupMeta(auth.currentUser.uid);
        if (
          cloudMeta &&
          cloudMeta.updatedAtMs > (snap.settings.lastKnownCloudUpdatedAtMs || 0)
        ) {
          setCloudConflict({ cloudUpdatedAtMs: cloudMeta.updatedAtMs });
          setCloudSyncStatus('error');
          setCloudSyncError(
            snap.settings.language === 'en'
              ? 'Newer cloud backup detected. Open Backup to restore or overwrite.'
              : 'توجد نسخة سحابية أحدث. افتح النسخ الاحتياطي للاستعادة أو التأكيد.'
          );
          return;
        }

        const { syncedAt, updatedAtMs, skippedAttachmentsCount } = await saveCloudBackup(
          auth.currentUser.uid,
          {
            transactions: snap.transactions,
            wallets: snap.wallets,
            categories: snap.categories,
            budgets: snap.budgets,
            debts: snap.debts,
            goals: snap.goals,
            templates: snap.templates,
            moneyCircles: snap.moneyCircles,
            orgWorkspaces: latestOrgRef.current.orgWorkspaces,
            activeWorkspace: latestOrgRef.current.activeWorkspace,
            settings: snap.settings,
            hasCompletedOnboarding: snap.hasCompletedOnboarding,
          }
        );

        setCloudSkippedAttachmentsWarning(skippedAttachmentsCount);
        setLastCloudBackupExists(true);
        setCloudSyncStatus('synced');
        setCloudSyncError(null);
        skipNextAutoSyncRef.current = true;
        setSettings((prev) => {
          const next = {
            ...prev,
            lastCloudSyncAt: syncedAt,
            lastKnownCloudUpdatedAtMs: updatedAtMs,
          };
          void persistData({ ...latestPersonalRef.current, settings: next });
          return next;
        });
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : snap.settings.language === 'en'
            ? 'Auto cloud sync failed'
            : 'فشلت المزامنة السحابية التلقائية';
        setCloudSyncStatus('error');
        setCloudSyncError(msg);
      }
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [
    user?.isLoggedIn,
    hasCompletedOnboarding,
    cloudConflict,
    personalTransactions,
    personalWallets,
    personalCategories,
    personalBudgets,
    personalDebts,
    personalGoals,
    personalTemplates,
    personalMoneyCircles,
    orgWorkspaces,
    activeWorkspace,
    settings,
  ]);

  // Real-time Notifications Center + Web Notification API trigger
  const notifications = useMemo(() => {
    const raw = buildAppNotifications({
      budgets,
      transactions,
      debts,
      settings,
      pendingApprovalsCount,
    });
    return raw.map((item) => ({
      ...item,
      read: readNotificationIds.has(item.id),
    }));
  }, [budgets, transactions, debts, settings, pendingApprovalsCount, readNotificationIds]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const markNotificationRead = useCallback((id: string) => {
    setReadNotificationIds((prev) => new Set(prev).add(id));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setReadNotificationIds(new Set(notifications.map((n) => n.id)));
  }, [notifications]);

  // Fire browser Notification API when urgent alerts exist and permission is granted
  useEffect(() => {
    if (isLoading || !settings.notificationsEnabled) return;
    const urgent = notifications.find((n) => n.severity === 'danger' && !n.read);
    if (urgent) {
      dispatchBrowserNotification(
        settings.language === 'en' ? urgent.titleEn : urgent.titleAr,
        settings.language === 'en' ? urgent.messageEn : urgent.messageAr,
        urgent.id
      );
    }
  }, [isLoading, settings.notificationsEnabled, settings.language, notifications]);

  // Translation helper
  const t = useCallback(
    (key: keyof typeof translations.ar): string => {
      const lang = settings.language === 'en' ? 'en' : 'ar';
      return translations[lang][key] || translations.ar[key] || String(key);
    },
    [settings.language]
  );

  // Currency Picker triggers
  const openCurrencyPicker = useCallback((onSelect: (code: string) => void, selectedCode?: string) => {
    setCurrencyPickerSelectedCode(selectedCode);
    setOnCurrencySelectCallback(() => onSelect);
    setCurrencyPickerOpen(true);
  }, []);

  const closeCurrencyPicker = useCallback(() => {
    setCurrencyPickerOpen(false);
    setCurrencyPickerSelectedCode(undefined);
    setOnCurrencySelectCallback(null);
  }, []);

  // Multi-select
  const toggleSelectTransaction = useCallback((id: string) => {
    setSelectedTransactionIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);
  const selectAllTransactions = useCallback((ids: string[]) => setSelectedTransactionIds(ids), []);
  const clearSelectedTransactions = useCallback(() => setSelectedTransactionIds([]), []);

  // Security Unlock
  const unlockApp = useCallback(
    async (pin: string) => {
      const result = await verifyAndUpgradePin(pin, settings.appPin, settings.appPinSalt);
      if (result.valid) {
        setIsAppLocked(false);
        if (result.needsUpgrade && result.newHash && result.newSalt) {
          const updatedSettings = {
            ...settings,
            appPin: result.newHash,
            appPinSalt: result.newSalt,
          };
          setSettings(updatedSettings);
          savePersonalState({ settings: updatedSettings });
        }
        return true;
      }
      return false;
    },
    [settings, savePersonalState]
  );

  const unlockWallet = useCallback(
    async (walletId: string, pin: string) => {
      const wallet = wallets.find((w) => w.id === walletId);
      if (wallet) {
        const result = await verifyAndUpgradePin(pin, wallet.pin, wallet.pinSalt);
        if (result.valid) {
          setLockedWalletIds((prev) => prev.filter((id) => id !== walletId));
          if (result.needsUpgrade && result.newHash && result.newSalt) {
            if (isOrgWorkspace) {
              updateActiveOrgWorkspace((org) => ({
                ...org,
                wallets: org.wallets.map((w) =>
                  w.id === walletId ? { ...w, pin: result.newHash, pinSalt: result.newSalt } : w
                ),
              }));
            } else {
              const updatedWallets = personalWallets.map((w) =>
                w.id === walletId ? { ...w, pin: result.newHash, pinSalt: result.newSalt } : w
              );
              setPersonalWallets(updatedWallets);
              savePersonalState({ wallets: updatedWallets });
            }
          }
          return true;
        }
      }
      return false;
    },
    [wallets, isOrgWorkspace, personalWallets, updateActiveOrgWorkspace, savePersonalState]
  );

  const triggerUndo = useCallback(() => {
    if (undoAction) {
      undoAction.action();
      setUndoAction(null);
    }
  }, [undoAction]);

  // ===========================================================================
  // Workspace Management (Personal <-> Organizations)
  // ===========================================================================
  const switchWorkspace = useCallback((workspaceId: string) => {
    setSelectedTransactionIds([]);
    setActiveWalletId(null);
    resetFilters();
    if (workspaceId === 'personal' || latestOrgRef.current.orgWorkspaces[workspaceId]) {
      setActiveWorkspace(workspaceId);
      void saveOrgWorkspaces(workspaceId, latestOrgRef.current.orgWorkspaces);
    }
  }, [resetFilters]);

  const createOrganization = useCallback(
    (params: {
      name: string;
      currency: string;
      industry?: OrganizationIndustry;
      vatRate?: number;
      taxNumber?: string;
      approvalThreshold?: number;
      loadSampleData?: boolean;
    }): Organization => {
      const now = Date.now();
      const orgId = `org-${now}-${Math.random().toString(36).slice(2, 6)}`;
      const inviteCode = `RS-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.floor(
        100 + Math.random() * 899
      )}`;
      const ownerUid = user?.id || 'local-owner';
      const industry: OrganizationIndustry = params.industry || 'general';
      const org: Organization = {
        id: orgId,
        name: params.name.trim() || (settings.language === 'en' ? 'My Company' : 'شركتي'),
        currency: params.currency || settings.mainCurrency,
        mainCurrency: params.currency || settings.mainCurrency,
        industry,
        vatRate: params.vatRate ?? 14,
        taxNumber: params.taxNumber?.trim() || undefined,
        approvalThreshold: params.approvalThreshold ?? 2000,
        inviteCode,
        ownerUid,
        ownerId: ownerUid,
        extraSeats: 0,
        createdAt: now,
        updatedAt: now,
      };

      const ownerMember: OrganizationMember = {
        uid: ownerUid,
        email: user?.email || 'owner@company.local',
        displayName: user?.name || (settings.language === 'en' ? 'Owner' : 'المالك'),
        role: 'owner',
        department: settings.language === 'en' ? 'Management' : 'الإدارة العامة',
        status: 'active',
        joinedAt: now,
      };

      const starterWallets: Wallet[] = [
        {
          id: `org-w-bank-${now}`,
          name: settings.language === 'en' ? 'Company Bank Account' : 'حساب البنك التجاري',
          currency: org.currency,
          initialBalance: params.loadSampleData ? 250000 : 0,
          balance: params.loadSampleData ? 250000 : 0,
          color: '#1E6F73',
          icon: 'Landmark',
          isArchived: false,
          order: 1,
          walletType: 'bank_account',
        },
        {
          id: `org-w-petty-${now}`,
          name: settings.language === 'en' ? 'Petty Cash Treasury' : 'خزينة النثرية (عُهدة)',
          currency: org.currency,
          initialBalance: params.loadSampleData ? 15000 : 0,
          balance: params.loadSampleData ? 15000 : 0,
          color: '#3A605B',
          icon: 'Wallet',
          isArchived: false,
          order: 2,
          walletType: 'petty_cash',
          custodianMemberUid: ownerUid,
        },
      ];

      const starterCostCenters: CostCenter[] = createStarterCostCentersForIndustry(
        orgId,
        industry,
        params.loadSampleData,
        now
      );

      const todayStr = formatLocalDate(new Date());
      const starterParties: BusinessParty[] = params.loadSampleData
        ? [
            {
              id: `party-vendor-${now}`,
              orgId,
              type: 'vendor',
              name: 'شركة التوريدات الحديثة',
              currency: org.currency,
              balance: 18500,
              dueDate: todayStr,
              notes: 'فاتورة توريد أجهزة ومعدات',
              createdAt: now,
            },
            {
              id: `party-client-${now}`,
              orgId,
              type: 'client',
              name: 'مجموعة الأفق التجارية',
              currency: org.currency,
              balance: 42000,
              dueDate: todayStr,
              notes: 'مستحقات عقد استشارات Q4',
              createdAt: now,
            },
          ]
        : [];

      const starterTx: Transaction[] = params.loadSampleData
        ? [
            {
              id: `org-tx-1-${now}`,
              workspaceId: orgId,
              type: 'income',
              amount: 85500,
              taxAmount: 10500,
              taxRate: org.vatRate,
              isTaxInclusive: true,
              currency: org.currency,
              date: todayStr,
              time: '10:30',
              categoryId: 'org-cat-sales',
              walletId: starterWallets[0].id,
              costCenterId: starterCostCenters[1]?.id || starterCostCenters[0]?.id,
              partyId: starterParties[1].id,
              invoiceNumber: 'INV-2026-101',
              voucherNumber: 'RV-0001',
              notes: 'إيراد عقد توريد وتنفيذ شامل ضريبة القيمة المضافة',
              priority: 'essential',
              doesNotAffectBalance: false,
              approvalStatus: 'approved',
              submittedBy: ownerUid,
              submittedByName: ownerMember.displayName,
              createdAt: now - 30000,
              updatedAt: now - 30000,
            },
            {
              id: `org-tx-2-${now}`,
              workspaceId: orgId,
              type: 'expense',
              amount: 11400,
              taxAmount: 1400,
              taxRate: org.vatRate,
              isTaxInclusive: true,
              currency: org.currency,
              date: todayStr,
              time: '12:15',
              categoryId: 'org-cat-suppliers',
              walletId: starterWallets[0].id,
              costCenterId: starterCostCenters[0]?.id,
              partyId: starterParties[0].id,
              invoiceNumber: 'BILL-882',
              voucherNumber: 'PV-0001',
              notes: 'مستلزمات مكتبية ومعدات تشغيل',
              priority: 'essential',
              doesNotAffectBalance: false,
              approvalStatus: 'pending_approval',
              isReimbursement: true,
              submittedBy: 'emp-sample',
              submittedByName: 'كريم أحمد (موظف)',
              createdAt: now - 10000,
              updatedAt: now - 10000,
            },
          ]
        : [];

      const workspaceData: OrgWorkspaceData = {
        organization: org,
        members: [ownerMember],
        costCenters: starterCostCenters,
        parties: starterParties,
        wallets: starterWallets,
        categories: createStarterOrgCategories(industry),
        transactions: starterTx,
        budgets: [],
        debts: [],
        goals: [],
        templates: [],
        auditLogs: [
          {
            id: `audit-init-${now}`,
            orgId,
            action: 'create',
            entityType: 'organization',
            entityId: orgId,
            actorUid: ownerUid,
            actorName: ownerMember.displayName,
            summary: `Created organization "${org.name}" (${industry})`,
            timestamp: now,
          },
        ],
      };

      const nextMap = { ...latestOrgRef.current.orgWorkspaces, [orgId]: workspaceData };
      setOrgWorkspaces(nextMap);
      setActiveWorkspace(orgId);
      setHasCompletedOnboarding(true);
      void saveOrgWorkspaces(orgId, nextMap);
      savePersonalState({ hasCompletedOnboarding: true });
      void syncOrganizationMetaToCloud(workspaceData);
      return org;
    },
    [user?.id, user?.email, user?.name, settings.language, settings.mainCurrency, savePersonalState]
  );

  const joinOrganizationByCode = useCallback(
    (inviteCode: string): { ok: boolean; orgName?: string; error?: string } => {
      const normalized = inviteCode.trim().toUpperCase();
      if (!normalized) {
        return {
          ok: false,
          error: settings.language === 'en' ? 'Enter a valid invite code' : 'أدخل رمز دعوة صحيح',
        };
      }

      const foundEntry = Object.entries(latestOrgRef.current.orgWorkspaces).find(
        ([, ws]) => ws.organization.inviteCode.toUpperCase() === normalized
      );

      if (!foundEntry) {
        return {
          ok: false,
          error:
            settings.language === 'en'
              ? 'No organization matched that invite code on this device.'
              : 'لم يتم العثور على شركة مطابقة لرمز الدعوة هذا على الجهاز.',
        };
      }

      const [orgId, ws] = foundEntry;
      const uid = user?.id || 'local-member';
      const exists = ws.members.some((m) => m.uid === uid);
      if (!exists) {
        const nextWs: OrgWorkspaceData = {
          ...ws,
          members: [
            ...ws.members,
            {
              uid,
              email: user?.email || 'member@company.local',
              displayName: user?.name || 'Team Member',
              role: 'employee',
              status: 'active',
              joinedAt: Date.now(),
            },
          ],
        };
        const nextMap = { ...latestOrgRef.current.orgWorkspaces, [orgId]: nextWs };
        setOrgWorkspaces(nextMap);
        void saveOrgWorkspaces(orgId, nextMap);
      }
      setActiveWorkspace(orgId);
      return { ok: true, orgName: ws.organization.name };
    },
    [user?.id, user?.email, user?.name, settings.language]
  );

  const updateOrganizationSettings = useCallback(
    (updates: Partial<Organization>) => {
      if (!isOrgWorkspace || !canOrgManage) return;
      updateActiveOrgWorkspace((org) => {
        const updatedOrg = { ...org.organization, ...updates, updatedAt: Date.now() };
        const log = createAuditEntry(
          org.organization.id,
          'update',
          'organization',
          org.organization.id,
          'Updated organization settings',
          org.organization,
          updatedOrg
        );
        const nextWs = {
          ...org,
          organization: updatedOrg,
          auditLogs: [log, ...org.auditLogs],
        };
        void syncOrganizationMetaToCloud(nextWs);
        return nextWs;
      });
    },
    [isOrgWorkspace, canOrgManage, updateActiveOrgWorkspace, createAuditEntry]
  );

  const lockAccountingPeriod = useCallback(
    (lockedUntilDate: string | undefined) => {
      if (!isOrgWorkspace || !canOrgManage) return;
      updateActiveOrgWorkspace((org) => {
        const updatedOrg = { ...org.organization, lockedUntilDate, updatedAt: Date.now() };
        const log = createAuditEntry(
          org.organization.id,
          'lock_period',
          'organization',
          org.organization.id,
          lockedUntilDate
            ? `Locked accounting period through ${lockedUntilDate}`
            : 'Unlocked accounting period',
          org.organization.lockedUntilDate,
          lockedUntilDate
        );
        return {
          ...org,
          organization: updatedOrg,
          auditLogs: [log, ...org.auditLogs],
        };
      });
    },
    [isOrgWorkspace, canOrgManage, updateActiveOrgWorkspace, createAuditEntry]
  );

  const approveOrgTransaction = useCallback(
    (txId: string) => {
      if (!isOrgWorkspace || !canOrgApprove) return;
      updateActiveOrgWorkspace((org) => {
        const target = org.transactions.find((t) => t.id === txId);
        if (!target || target.approvalStatus === 'approved') return org;

        const approvedTx: Transaction = {
          ...target,
          approvalStatus: 'approved',
          reviewedBy: user?.name || user?.id || 'Reviewer',
          reviewedAt: Date.now(),
          rejectionReason: undefined,
          updatedAt: Date.now(),
        };

        const { sourceDelta, destDelta } = getTransactionWalletDeltas(approvedTx);
        const updatedWallets = org.wallets.map((w) => {
          if (w.id === approvedTx.walletId && sourceDelta !== 0) {
            const deltaInWallet = convertCurrency(
              sourceDelta,
              approvedTx.currency,
              w.currency,
              settings.customExchangeRates
            );
            return { ...w, balance: roundCurrency(w.balance + deltaInWallet, w.currency) };
          }
          if (approvedTx.toWalletId && w.id === approvedTx.toWalletId && destDelta !== 0) {
            return { ...w, balance: roundCurrency(w.balance + destDelta, w.currency) };
          }
          return w;
        });

        const log = createAuditEntry(
          org.organization.id,
          'approve',
          'transaction',
          txId,
          `Approved ${approvedTx.type} ${approvedTx.amount} ${approvedTx.currency}`,
          target,
          approvedTx
        );

        return {
          ...org,
          transactions: org.transactions.map((t) => (t.id === txId ? approvedTx : t)),
          wallets: updatedWallets,
          auditLogs: [log, ...org.auditLogs],
        };
      });
    },
    [
      isOrgWorkspace,
      canOrgApprove,
      updateActiveOrgWorkspace,
      user?.name,
      user?.id,
      settings.customExchangeRates,
      createAuditEntry,
    ]
  );

  const rejectOrgTransaction = useCallback(
    (txId: string, reason: string) => {
      if (!isOrgWorkspace || !canOrgApprove) return;
      updateActiveOrgWorkspace((org) => {
        const target = org.transactions.find((t) => t.id === txId);
        if (!target) return org;

        // If previously approved, reverse treasury balance impact
        let updatedWallets = org.wallets;
        const oldDeltas = getTransactionWalletDeltas(target);
        if (oldDeltas.sourceDelta !== 0 || oldDeltas.destDelta !== 0) {
          updatedWallets = org.wallets.map((w) => {
            if (w.id === target.walletId && oldDeltas.sourceDelta !== 0) {
              const deltaInWallet = convertCurrency(
                oldDeltas.sourceDelta,
                target.currency,
                w.currency,
                settings.customExchangeRates
              );
              return { ...w, balance: roundCurrency(w.balance - deltaInWallet, w.currency) };
            }
            if (target.toWalletId && w.id === target.toWalletId && oldDeltas.destDelta !== 0) {
              return { ...w, balance: roundCurrency(w.balance - oldDeltas.destDelta, w.currency) };
            }
            return w;
          });
        }

        const rejectedTx: Transaction = {
          ...target,
          approvalStatus: 'rejected',
          reviewedBy: user?.name || user?.id || 'Reviewer',
          reviewedAt: Date.now(),
          rejectionReason: reason.trim() || 'Rejected',
          updatedAt: Date.now(),
        };

        const log = createAuditEntry(
          org.organization.id,
          'reject',
          'transaction',
          txId,
          `Rejected transaction: ${rejectedTx.rejectionReason}`,
          target,
          rejectedTx
        );

        return {
          ...org,
          transactions: org.transactions.map((t) => (t.id === txId ? rejectedTx : t)),
          wallets: updatedWallets,
          auditLogs: [log, ...org.auditLogs],
        };
      });
    },
    [
      isOrgWorkspace,
      canOrgApprove,
      updateActiveOrgWorkspace,
      settings.customExchangeRates,
      user?.name,
      user?.id,
      createAuditEntry,
    ]
  );

  const addCostCenter = useCallback(
    (data: Omit<CostCenter, 'id' | 'orgId' | 'createdAt'>): CostCenter | null => {
      if (!isOrgWorkspace || !canOrgApprove) return null;
      const orgId = activeOrganization!.id;
      const newCC: CostCenter = {
        ...data,
        id: `cc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        orgId,
        createdAt: Date.now(),
      };
      updateActiveOrgWorkspace((org) => ({
        ...org,
        costCenters: [newCC, ...org.costCenters],
        auditLogs: [
          createAuditEntry(orgId, 'create', 'cost_center', newCC.id, `Created cost center ${newCC.code}`),
          ...org.auditLogs,
        ],
      }));
      return newCC;
    },
    [isOrgWorkspace, canOrgApprove, activeOrganization, updateActiveOrgWorkspace, createAuditEntry]
  );

  const updateCostCenter = useCallback(
    (id: string, updates: Partial<CostCenter>) => {
      if (!isOrgWorkspace || !canOrgApprove) return;
      updateActiveOrgWorkspace((org) => ({
        ...org,
        costCenters: org.costCenters.map((cc) => (cc.id === id ? { ...cc, ...updates } : cc)),
      }));
    },
    [isOrgWorkspace, canOrgApprove, updateActiveOrgWorkspace]
  );

  const deleteCostCenter = useCallback(
    (id: string) => {
      if (!isOrgWorkspace || !canOrgManage) return;
      updateActiveOrgWorkspace((org) => ({
        ...org,
        costCenters: org.costCenters.filter((cc) => cc.id !== id),
        transactions: org.transactions.map((tx) =>
          tx.costCenterId === id ? { ...tx, costCenterId: undefined } : tx
        ),
        auditLogs: [
          createAuditEntry(org.organization.id, 'delete', 'cost_center', id, `Deleted cost center ${id}`),
          ...org.auditLogs,
        ],
      }));
    },
    [isOrgWorkspace, canOrgManage, updateActiveOrgWorkspace, createAuditEntry]
  );

  const addBusinessParty = useCallback(
    (data: Omit<BusinessParty, 'id' | 'orgId' | 'createdAt'>): BusinessParty | null => {
      if (!isOrgWorkspace || !canOrgApprove) return null;
      const orgId = activeOrganization!.id;
      const newParty: BusinessParty = {
        ...data,
        id: `party-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        orgId,
        createdAt: Date.now(),
      };
      updateActiveOrgWorkspace((org) => ({
        ...org,
        parties: [newParty, ...org.parties],
        auditLogs: [
          createAuditEntry(orgId, 'create', 'party', newParty.id, `Created ${newParty.type} "${newParty.name}"`),
          ...org.auditLogs,
        ],
      }));
      return newParty;
    },
    [isOrgWorkspace, canOrgApprove, activeOrganization, updateActiveOrgWorkspace, createAuditEntry]
  );

  const updateBusinessParty = useCallback(
    (id: string, updates: Partial<BusinessParty>) => {
      if (!isOrgWorkspace || !canOrgApprove) return;
      updateActiveOrgWorkspace((org) => ({
        ...org,
        parties: org.parties.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      }));
    },
    [isOrgWorkspace, canOrgApprove, updateActiveOrgWorkspace]
  );

  const deleteBusinessParty = useCallback(
    (id: string) => {
      if (!isOrgWorkspace || !canOrgManage) return;
      updateActiveOrgWorkspace((org) => ({
        ...org,
        parties: org.parties.filter((p) => p.id !== id),
        transactions: org.transactions.map((tx) =>
          tx.partyId === id ? { ...tx, partyId: undefined } : tx
        ),
      }));
    },
    [isOrgWorkspace, canOrgManage, updateActiveOrgWorkspace]
  );

  const addOrUpdateOrgMember = useCallback(
    (member: Omit<OrganizationMember, 'joinedAt'>) => {
      if (!isOrgWorkspace || !canOrgManage) return;
      updateActiveOrgWorkspace((org) => {
        const exists = org.members.find((m) => m.uid === member.uid);
        const updatedMembers = exists
          ? org.members.map((m) => (m.uid === member.uid ? { ...m, ...member } : m))
          : [...org.members, { ...member, joinedAt: Date.now() }];
        const log = createAuditEntry(
          org.organization.id,
          'role_change',
          'member',
          member.uid,
          `Member "${member.displayName}" role -> ${member.role}`
        );
        return {
          ...org,
          members: updatedMembers,
          auditLogs: [log, ...org.auditLogs],
        };
      });
    },
    [isOrgWorkspace, canOrgManage, updateActiveOrgWorkspace, createAuditEntry]
  );

  const removeOrgMember = useCallback(
    (uid: string) => {
      if (!isOrgWorkspace || !canOrgManage) return;
      updateActiveOrgWorkspace((org) => ({
        ...org,
        members: org.members.filter((m) => m.uid !== uid || m.role === 'owner'),
      }));
    },
    [isOrgWorkspace, canOrgManage, updateActiveOrgWorkspace]
  );

  // ===========================================================================
  // Unified CRUD: Transactions (respecting Personal vs Organization invariants)
  // ===========================================================================
  const applyDeltasToWallets = useCallback(
    (walletList: Wallet[], tx: Transaction, multiplier: 1 | -1): Wallet[] => {
      const { sourceDelta, destDelta } = getTransactionWalletDeltas(tx);
      if (sourceDelta === 0 && destDelta === 0) return walletList;

      return walletList.map((w) => {
        if (w.id === tx.walletId && sourceDelta !== 0) {
          const deltaInWallet = convertCurrency(
            sourceDelta,
            tx.currency,
            w.currency,
            settings.customExchangeRates
          );
          return { ...w, balance: roundCurrency(w.balance + deltaInWallet * multiplier, w.currency) };
        }
        if (tx.toWalletId && w.id === tx.toWalletId && destDelta !== 0) {
          return { ...w, balance: roundCurrency(w.balance + destDelta * multiplier, w.currency) };
        }
        return w;
      });
    },
    [settings.customExchangeRates]
  );

  const addTransaction = useCallback(
    (data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Transaction => {
      const now = Date.now();
      let approvalStatus = data.approvalStatus;

      if (isOrgWorkspace && activeOrganization) {
        if (isDateInLockedPeriod(data.date, activeOrganization.lockedUntilDate)) {
          throw new Error(
            settings.language === 'en'
              ? `Period locked through ${activeOrganization.lockedUntilDate}`
              : `الفترة المحاسبية مغلقة حتى تاريخ ${activeOrganization.lockedUntilDate}`
          );
        }
        const needsApproval =
          activeOrgRole === 'employee' ||
          data.isReimbursement ||
          (data.type === 'expense' &&
            activeOrganization.approvalThreshold > 0 &&
            convertCurrency(
              data.amount,
              data.currency,
              activeOrganization.currency,
              settings.customExchangeRates
            ) > activeOrganization.approvalThreshold);
        if (!approvalStatus) {
          approvalStatus = needsApproval ? 'pending_approval' : 'approved';
        }
      }

      const autoVoucherNumber =
        isOrgWorkspace && !data.voucherNumber?.trim()
          ? generateNextVoucherNumber(transactions, data.type)
          : data.voucherNumber?.trim() || undefined;

      const newTx: Transaction = {
        ...data,
        ...(isOrgWorkspace
          ? {
              workspaceId: activeWorkspace,
              approvalStatus: approvalStatus || 'approved',
              voucherNumber: autoVoucherNumber,
              submittedBy: data.submittedBy || user?.id || 'local-owner',
              submittedByName:
                data.submittedByName ||
                user?.name ||
                (settings.language === 'en' ? 'Member' : 'عضو الفريق'),
            }
          : {}),
        id: `tx-${now}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
        updatedAt: now,
      };

      const updatedWallets = applyDeltasToWallets(wallets, newTx, 1);

      const nextSettings: AppSettings = {
        ...settings,
        lastUsedTransactionType: newTx.type,
        ...(settings.useLastUsedWallet ? { lastUsedWalletId: newTx.walletId } : {}),
      };
      setSettings(nextSettings);

      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({
          ...org,
          transactions: [newTx, ...org.transactions],
          wallets: updatedWallets,
          auditLogs: [
            createAuditEntry(
              org.organization.id,
              'create',
              'transaction',
              newTx.id,
              `Added ${newTx.type} ${newTx.amount} ${newTx.currency} (${newTx.approvalStatus})`,
              undefined,
              newTx
            ),
            ...org.auditLogs,
          ],
        }));
        savePersonalState({ settings: nextSettings });
      } else {
        const nextTx = [newTx, ...personalTransactions];
        setPersonalTransactions(nextTx);
        setPersonalWallets(updatedWallets);
        savePersonalState({ transactions: nextTx, wallets: updatedWallets, settings: nextSettings });
      }

      return newTx;
    },
    [
      isOrgWorkspace,
      activeOrganization,
      activeOrgRole,
      activeWorkspace,
      transactions,
      user?.id,
      user?.name,
      settings,
      wallets,
      applyDeltasToWallets,
      updateActiveOrgWorkspace,
      createAuditEntry,
      personalTransactions,
      savePersonalState,
    ]
  );

  const importTransactionsBatch = useCallback(
    (items: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[]) => {
      if (items.length === 0) return 0;

      const baseNow = Date.now();
      const newTxs: Transaction[] = items.map((data, idx) => ({
        ...data,
        ...(isOrgWorkspace
          ? {
              workspaceId: activeWorkspace,
              approvalStatus: data.approvalStatus || 'approved',
            }
          : {}),
        id: `csv-${baseNow}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: baseNow - idx,
        updatedAt: baseNow - idx,
      }));

      let updatedWallets = [...wallets];
      for (const tx of newTxs) {
        updatedWallets = applyDeltasToWallets(updatedWallets, tx, 1);
      }

      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({
          ...org,
          transactions: [...newTxs, ...org.transactions],
          wallets: updatedWallets,
        }));
      } else {
        const nextTx = [...newTxs, ...personalTransactions];
        setPersonalTransactions(nextTx);
        setPersonalWallets(updatedWallets);
        savePersonalState({ transactions: nextTx, wallets: updatedWallets });
      }
      return newTxs.length;
    },
    [
      isOrgWorkspace,
      activeWorkspace,
      wallets,
      applyDeltasToWallets,
      updateActiveOrgWorkspace,
      personalTransactions,
      savePersonalState,
    ]
  );

  const updateTransaction = useCallback(
    (id: string, updates: Partial<Transaction>) => {
      const oldTx = transactions.find((t) => t.id === id);
      if (!oldTx) return;

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return;
        if (
          isDateInLockedPeriod(oldTx.date, activeOrganization.lockedUntilDate) ||
          (updates.date && isDateInLockedPeriod(updates.date, activeOrganization.lockedUntilDate))
        ) {
          return;
        }
        if (activeOrgRole === 'employee' && oldTx.approvalStatus === 'approved') {
          return;
        }
      }

      let updatedWallets = applyDeltasToWallets(wallets, oldTx, -1);
      const mergedTx: Transaction = {
        ...oldTx,
        ...updates,
        updatedAt: Date.now(),
      };
      updatedWallets = applyDeltasToWallets(updatedWallets, mergedTx, 1);

      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({
          ...org,
          transactions: org.transactions.map((t) => (t.id === id ? mergedTx : t)),
          wallets: updatedWallets,
          auditLogs: [
            createAuditEntry(
              org.organization.id,
              'update',
              'transaction',
              id,
              `Updated transaction ${mergedTx.amount} ${mergedTx.currency}`,
              oldTx,
              mergedTx
            ),
            ...org.auditLogs,
          ],
        }));
      } else {
        const nextTx = personalTransactions.map((t) => (t.id === id ? mergedTx : t));
        setPersonalTransactions(nextTx);
        setPersonalWallets(updatedWallets);
        savePersonalState({ transactions: nextTx, wallets: updatedWallets });
      }
    },
    [
      transactions,
      isOrgWorkspace,
      activeOrganization,
      canOrgWrite,
      activeOrgRole,
      wallets,
      applyDeltasToWallets,
      updateActiveOrgWorkspace,
      createAuditEntry,
      personalTransactions,
      savePersonalState,
    ]
  );

  const deleteTransaction = useCallback(
    (id: string) => {
      const oldTx = transactions.find((t) => t.id === id);
      if (!oldTx) return;

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgApprove && oldTx.approvalStatus === 'approved') return;
        if (isDateInLockedPeriod(oldTx.date, activeOrganization.lockedUntilDate)) return;
      }

      const updatedWallets = applyDeltasToWallets(wallets, oldTx, -1);

      if (isOrgWorkspace) {
        const prevSnapshot = latestOrgRef.current.orgWorkspaces[activeWorkspace];
        updateActiveOrgWorkspace((org) => ({
          ...org,
          transactions: org.transactions.filter((t) => t.id !== id),
          wallets: updatedWallets,
          auditLogs: [
            createAuditEntry(
              org.organization.id,
              'delete',
              'transaction',
              id,
              `Deleted ${oldTx.type} ${oldTx.amount} ${oldTx.currency}`,
              oldTx,
              undefined
            ),
            ...org.auditLogs,
          ],
        }));
        if (prevSnapshot) {
          setUndoAction({
            id: `undo-${Date.now()}`,
            message: t('transactionDeleted'),
            action: () => {
              updateActiveOrgWorkspace(() => prevSnapshot);
            },
          });
        }
      } else {
        const prevTx = personalTransactions;
        const prevWallets = personalWallets;
        const nextTx = personalTransactions.filter((t) => t.id !== id);
        setPersonalTransactions(nextTx);
        setPersonalWallets(updatedWallets);
        savePersonalState({ transactions: nextTx, wallets: updatedWallets });

        setUndoAction({
          id: `undo-${Date.now()}`,
          message: t('transactionDeleted'),
          action: () => {
            setPersonalTransactions(prevTx);
            setPersonalWallets(prevWallets);
            savePersonalState({ transactions: prevTx, wallets: prevWallets });
          },
        });
      }
    },
    [
      transactions,
      isOrgWorkspace,
      activeOrganization,
      canOrgApprove,
      wallets,
      applyDeltasToWallets,
      activeWorkspace,
      updateActiveOrgWorkspace,
      createAuditEntry,
      t,
      personalTransactions,
      personalWallets,
      savePersonalState,
    ]
  );

  const deleteSelectedTransactions = useCallback(() => {
    if (selectedTransactionIds.length === 0) return;

    const toDeleteSet = new Set(selectedTransactionIds);
    let updatedWallets = [...wallets];

    for (const id of selectedTransactionIds) {
      const oldTx = transactions.find((t) => t.id === id);
      if (!oldTx) continue;
      if (
        isOrgWorkspace &&
        activeOrganization &&
        isDateInLockedPeriod(oldTx.date, activeOrganization.lockedUntilDate)
      ) {
        toDeleteSet.delete(id);
        continue;
      }
      updatedWallets = applyDeltasToWallets(updatedWallets, oldTx, -1);
    }

    if (toDeleteSet.size === 0) {
      setSelectedTransactionIds([]);
      return;
    }

    if (isOrgWorkspace) {
      const prevWs = latestOrgRef.current.orgWorkspaces[activeWorkspace];
      updateActiveOrgWorkspace((org) => ({
        ...org,
        transactions: org.transactions.filter((t) => !toDeleteSet.has(t.id)),
        wallets: updatedWallets,
      }));
      setSelectedTransactionIds([]);
      if (prevWs) {
        setUndoAction({
          id: `undo-multi-${Date.now()}`,
          message: t('transactionsDeleted'),
          action: () => updateActiveOrgWorkspace(() => prevWs),
        });
      }
    } else {
      const previousTx = [...personalTransactions];
      const previousWallets = [...personalWallets];
      const nextTx = personalTransactions.filter((t) => !toDeleteSet.has(t.id));
      setPersonalTransactions(nextTx);
      setPersonalWallets(updatedWallets);
      setSelectedTransactionIds([]);
      savePersonalState({ transactions: nextTx, wallets: updatedWallets });

      setUndoAction({
        id: `undo-multi-${Date.now()}`,
        message: t('transactionsDeleted'),
        action: () => {
          setPersonalTransactions(previousTx);
          setPersonalWallets(previousWallets);
          savePersonalState({ transactions: previousTx, wallets: previousWallets });
        },
      });
    }
  }, [
    selectedTransactionIds,
    wallets,
    transactions,
    isOrgWorkspace,
    activeOrganization,
    applyDeltasToWallets,
    activeWorkspace,
    updateActiveOrgWorkspace,
    t,
    personalTransactions,
    personalWallets,
    savePersonalState,
  ]);

  const moveSelectedTransactions = useCallback(
    (toWalletId: string) => {
      if (selectedTransactionIds.length === 0) return;

      const targetWalletOrig = wallets.find((w) => w.id === toWalletId);
      if (!targetWalletOrig) return;

      const toMoveSet = new Set(selectedTransactionIds);
      const updatedWallets = wallets.map((w) => ({ ...w }));
      const targetWallet = updatedWallets.find((w) => w.id === toWalletId)!;
      let anyMoved = false;

      const nextTx = transactions.map((tx) => {
        if (!toMoveSet.has(tx.id) || tx.walletId === toWalletId) return tx;
        if (tx.type === 'transfer' && tx.toWalletId === toWalletId) return tx;
        if (
          isOrgWorkspace &&
          activeOrganization &&
          isDateInLockedPeriod(tx.date, activeOrganization.lockedUntilDate)
        ) {
          return tx;
        }

        anyMoved = true;
        const fee = tx.type === 'transfer' && tx.transferFee && tx.transferFee > 0 ? tx.transferFee : 0;
        const oldWallet = updatedWallets.find((w) => w.id === tx.walletId);
        const amountInOldWallet = oldWallet
          ? convertCurrency(tx.amount, tx.currency, oldWallet.currency, settings.customExchangeRates)
          : tx.amount;
        const feeInOldWallet =
          fee > 0
            ? oldWallet
              ? convertCurrency(fee, tx.currency, oldWallet.currency, settings.customExchangeRates)
              : fee
            : 0;
        const amountInTargetWallet = convertCurrency(
          tx.amount,
          tx.currency,
          targetWallet.currency,
          settings.customExchangeRates
        );
        const feeInTargetWallet =
          fee > 0
            ? convertCurrency(fee, tx.currency, targetWallet.currency, settings.customExchangeRates)
            : 0;

        if (doesTransactionAffectAccounting(tx)) {
          if (tx.type === 'expense') {
            if (oldWallet) oldWallet.balance = roundCurrency(oldWallet.balance + amountInOldWallet, oldWallet.currency);
            targetWallet.balance = roundCurrency(targetWallet.balance - amountInTargetWallet, targetWallet.currency);
          } else if (tx.type === 'income') {
            if (oldWallet) oldWallet.balance = roundCurrency(oldWallet.balance - amountInOldWallet, oldWallet.currency);
            targetWallet.balance = roundCurrency(targetWallet.balance + amountInTargetWallet, targetWallet.currency);
          } else if (tx.type === 'transfer') {
            if (oldWallet) {
              oldWallet.balance = roundCurrency(
                oldWallet.balance + amountInOldWallet + feeInOldWallet,
                oldWallet.currency
              );
            }
            targetWallet.balance = roundCurrency(
              targetWallet.balance - (amountInTargetWallet + feeInTargetWallet),
              targetWallet.currency
            );
          }
        }

        const currencyDiffers = !!oldWallet && oldWallet.currency !== targetWallet.currency;
        return {
          ...tx,
          walletId: toWalletId,
          ...(currencyDiffers
            ? {
                amount: amountInTargetWallet,
                currency: targetWallet.currency,
                ...(fee > 0 ? { transferFee: feeInTargetWallet } : {}),
              }
            : {}),
          updatedAt: Date.now(),
        };
      });

      setSelectedTransactionIds([]);
      if (!anyMoved) return;

      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({
          ...org,
          transactions: nextTx,
          wallets: updatedWallets,
        }));
      } else {
        const previousTx = [...personalTransactions];
        const previousWallets = [...personalWallets];
        setPersonalTransactions(nextTx);
        setPersonalWallets(updatedWallets);
        savePersonalState({ transactions: nextTx, wallets: updatedWallets });
        setUndoAction({
          id: `undo-move-${Date.now()}`,
          message:
            settings.language === 'en'
              ? 'Transactions moved to wallet'
              : 'تم نقل المعاملات المحددة وتحديث الأرصدة',
          action: () => {
            setPersonalTransactions(previousTx);
            setPersonalWallets(previousWallets);
            savePersonalState({ transactions: previousTx, wallets: previousWallets });
          },
        });
      }
    },
    [
      selectedTransactionIds,
      wallets,
      transactions,
      isOrgWorkspace,
      activeOrganization,
      settings.customExchangeRates,
      settings.language,
      updateActiveOrgWorkspace,
      personalTransactions,
      personalWallets,
      savePersonalState,
    ]
  );

  const changeSelectedTransactionsCategory = useCallback(
    (newCategoryId: string) => {
      if (selectedTransactionIds.length === 0) return;
      const toChangeSet = new Set(selectedTransactionIds);
      const nextTx = transactions.map((t) =>
        toChangeSet.has(t.id) ? { ...t, categoryId: newCategoryId, updatedAt: Date.now() } : t
      );

      setSelectedTransactionIds([]);
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, transactions: nextTx }));
      } else {
        setPersonalTransactions(nextTx);
        savePersonalState({ transactions: nextTx });
      }
    },
    [selectedTransactionIds, transactions, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const duplicateTransaction = useCallback(
    (id: string) => {
      const orig = transactions.find((t) => t.id === id);
      if (!orig) return;

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

      addTransaction({
        ...orig,
        date: todayStr,
        time: timeStr,
        approvalStatus: undefined,
        reviewedBy: undefined,
        reviewedAt: undefined,
        rejectionReason: undefined,
        isRecurring: false,
        recurrenceRule: undefined,
      });
    },
    [transactions, addTransaction]
  );

  // ===========================================================================
  // Wallets CRUD + Safe Dependency Check & Migration
  // ===========================================================================
  const getWalletDependencies = useCallback(
    (id: string): WalletDependencies => {
      const transactionsCount = transactions.filter(
        (tx) => tx.walletId === id || tx.toWalletId === id
      ).length;
      const budgetsCount = budgets.filter((b) => b.walletId === id).length;
      const templatesCount = templates.filter(
        (tm) => tm.walletId === id || tm.toWalletId === id
      ).length;
      const goalsCount = goals.filter((g) => g.walletId === id).length;
      return {
        transactionsCount,
        budgetsCount,
        templatesCount,
        goalsCount,
        totalCount: transactionsCount + budgetsCount + templatesCount + goalsCount,
      };
    },
    [transactions, budgets, templates, goals]
  );

  const addWallet = useCallback(
    (data: Omit<Wallet, 'id'>) => {
      const newWallet: Wallet = {
        ...data,
        id: `w-${Date.now()}`,
        balance: data.initialBalance,
        isArchived: false,
        order: wallets.length + 1,
      };
      const nextWallets = [...wallets, newWallet];
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, wallets: nextWallets }));
      } else {
        setPersonalWallets(nextWallets);
        savePersonalState({ wallets: nextWallets });
      }
      return newWallet;
    },
    [wallets, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const updateWallet = useCallback(
    (id: string, updates: Partial<Wallet>) => {
      const nextWallets = wallets.map((w) => (w.id === id ? { ...w, ...updates } : w));
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, wallets: nextWallets }));
      } else {
        setPersonalWallets(nextWallets);
        savePersonalState({ wallets: nextWallets });
      }
    },
    [wallets, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const migrateAndDeleteWallet = useCallback(
    (walletId: string, targetWalletId: string) => {
      const targetWallet = wallets.find((w) => w.id === targetWalletId);
      const sourceWallet = wallets.find((w) => w.id === walletId);
      if (!targetWallet || !sourceWallet || walletId === targetWalletId) return;

      const migratedTx = transactions.map((tx) => {
        if (tx.walletId !== walletId && tx.toWalletId !== walletId) return tx;
        return {
          ...tx,
          walletId: tx.walletId === walletId ? targetWalletId : tx.walletId,
          toWalletId: tx.toWalletId === walletId ? targetWalletId : tx.toWalletId,
          updatedAt: Date.now(),
        };
      });
      const migratedBudgets = budgets.map((b) =>
        b.walletId === walletId ? { ...b, walletId: targetWalletId } : b
      );
      const migratedTemplates = templates.map((tm) => ({
        ...tm,
        walletId: tm.walletId === walletId ? targetWalletId : tm.walletId,
        toWalletId: tm.toWalletId === walletId ? targetWalletId : tm.toWalletId,
      }));
      const migratedGoals = goals.map((g) =>
        g.walletId === walletId ? { ...g, walletId: targetWalletId } : g
      );

      // Carry over remaining source balance to target wallet converted in target currency
      const convertedRemaining = convertCurrency(
        sourceWallet.balance,
        sourceWallet.currency,
        targetWallet.currency,
        settings.customExchangeRates
      );
      const nextWallets = wallets
        .filter((w) => w.id !== walletId)
        .map((w) =>
          w.id === targetWalletId
            ? { ...w, balance: roundCurrency(w.balance + convertedRemaining, w.currency) }
            : w
        );

      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({
          ...org,
          wallets: nextWallets,
          transactions: migratedTx,
          budgets: migratedBudgets,
          templates: migratedTemplates,
          goals: migratedGoals,
        }));
      } else {
        setPersonalWallets(nextWallets);
        setPersonalTransactions(migratedTx);
        setPersonalBudgets(migratedBudgets);
        setPersonalTemplates(migratedTemplates);
        setPersonalGoals(migratedGoals);
        savePersonalState({
          wallets: nextWallets,
          transactions: migratedTx,
          budgets: migratedBudgets,
          templates: migratedTemplates,
          goals: migratedGoals,
        });
      }
    },
    [
      wallets,
      transactions,
      budgets,
      templates,
      goals,
      settings.customExchangeRates,
      isOrgWorkspace,
      updateActiveOrgWorkspace,
      savePersonalState,
    ]
  );

  const deleteWallet = useCallback(
    (id: string) => {
      if (getWalletDependencies(id).totalCount > 0) return;
      const nextWallets = wallets.filter((w) => w.id !== id);
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, wallets: nextWallets }));
      } else {
        setPersonalWallets(nextWallets);
        savePersonalState({ wallets: nextWallets });
      }
    },
    [wallets, getWalletDependencies, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  // ===========================================================================
  // Categories CRUD + Safe Dependency Check & Migration
  // ===========================================================================
  const getCategoryDependencies = useCallback(
    (id: string): CategoryDependencies => {
      const transactionsCount = transactions.filter((tx) => tx.categoryId === id).length;
      const budgetsCount = budgets.filter((b) => b.categoryId === id).length;
      const templatesCount = templates.filter((tm) => tm.categoryId === id).length;
      return {
        transactionsCount,
        budgetsCount,
        templatesCount,
        totalCount: transactionsCount + budgetsCount + templatesCount,
      };
    },
    [transactions, budgets, templates]
  );

  const addCategory = useCallback(
    (data: Omit<Category, 'id'>) => {
      const newCat: Category = {
        ...data,
        id: `cat-${Date.now()}`,
        order: categories.length + 1,
      };
      const nextCategories = [...categories, newCat];
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, categories: nextCategories }));
      } else {
        setPersonalCategories(nextCategories);
        savePersonalState({ categories: nextCategories });
      }
      return newCat;
    },
    [categories, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const updateCategory = useCallback(
    (id: string, updates: Partial<Category>) => {
      const nextCategories = categories.map((c) => (c.id === id ? { ...c, ...updates } : c));
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, categories: nextCategories }));
      } else {
        setPersonalCategories(nextCategories);
        savePersonalState({ categories: nextCategories });
      }
    },
    [categories, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const migrateAndDeleteCategory = useCallback(
    (categoryId: string, targetCategoryId: string) => {
      if (categoryId === targetCategoryId) return;
      const migratedTx = transactions.map((tx) =>
        tx.categoryId === categoryId ? { ...tx, categoryId: targetCategoryId, updatedAt: Date.now() } : tx
      );
      const migratedBudgets = budgets.map((b) =>
        b.categoryId === categoryId ? { ...b, categoryId: targetCategoryId } : b
      );
      const migratedTemplates = templates.map((tm) =>
        tm.categoryId === categoryId ? { ...tm, categoryId: targetCategoryId } : tm
      );
      const nextCategories = categories.filter((c) => c.id !== categoryId);

      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({
          ...org,
          categories: nextCategories,
          transactions: migratedTx,
          budgets: migratedBudgets,
          templates: migratedTemplates,
        }));
      } else {
        setPersonalCategories(nextCategories);
        setPersonalTransactions(migratedTx);
        setPersonalBudgets(migratedBudgets);
        setPersonalTemplates(migratedTemplates);
        savePersonalState({
          categories: nextCategories,
          transactions: migratedTx,
          budgets: migratedBudgets,
          templates: migratedTemplates,
        });
      }
    },
    [
      transactions,
      budgets,
      templates,
      categories,
      isOrgWorkspace,
      updateActiveOrgWorkspace,
      savePersonalState,
    ]
  );

  const deleteCategory = useCallback(
    (id: string) => {
      if (getCategoryDependencies(id).totalCount > 0) return;
      const nextCategories = categories.filter((c) => c.id !== id);
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, categories: nextCategories }));
      } else {
        setPersonalCategories(nextCategories);
        savePersonalState({ categories: nextCategories });
      }
    },
    [categories, getCategoryDependencies, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  // ===========================================================================
  // Budgets, Debts, Goals, Templates
  // ===========================================================================
  const addBudget = useCallback(
    (data: Omit<Budget, 'id'>) => {
      const newBudget: Budget = { ...data, id: `b-${Date.now()}` };
      const nextBudgets = [...budgets, newBudget];
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, budgets: nextBudgets }));
      } else {
        setPersonalBudgets(nextBudgets);
        savePersonalState({ budgets: nextBudgets });
      }
      return newBudget;
    },
    [budgets, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const updateBudget = useCallback(
    (id: string, updates: Partial<Budget>) => {
      const nextBudgets = budgets.map((b) => (b.id === id ? { ...b, ...updates } : b));
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, budgets: nextBudgets }));
      } else {
        setPersonalBudgets(nextBudgets);
        savePersonalState({ budgets: nextBudgets });
      }
    },
    [budgets, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const deleteBudget = useCallback(
    (id: string) => {
      const nextBudgets = budgets.filter((b) => b.id !== id);
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, budgets: nextBudgets }));
      } else {
        setPersonalBudgets(nextBudgets);
        savePersonalState({ budgets: nextBudgets });
      }
    },
    [budgets, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const addDebt = useCallback(
    (data: Omit<Debt, 'id' | 'createdAt' | 'payments' | 'isSettled'>) => {
      const newDebt: Debt = {
        ...data,
        id: `debt-${Date.now()}`,
        payments: [],
        isSettled: data.paidAmount >= data.totalAmount,
        createdAt: Date.now(),
      };
      const nextDebts = [newDebt, ...debts];
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, debts: nextDebts }));
      } else {
        setPersonalDebts(nextDebts);
        savePersonalState({ debts: nextDebts });
      }
      return newDebt;
    },
    [debts, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const updateDebt = useCallback(
    (id: string, updates: Partial<Debt>) => {
      const nextDebts = debts.map((d) => (d.id === id ? { ...d, ...updates } : d));
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, debts: nextDebts }));
      } else {
        setPersonalDebts(nextDebts);
        savePersonalState({ debts: nextDebts });
      }
    },
    [debts, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const recordDebtPayment = useCallback(
    (
      debtId: string,
      payment: { amount: number; date: string; walletId?: string; notes?: string },
      logAsTx: boolean
    ) => {
      const target = debts.find((d) => d.id === debtId);
      if (!target) return;

      const newPaid = target.paidAmount + payment.amount;
      const paymentItem = { id: `p-${Date.now()}`, ...payment };

      let nextDue = target.dueDate;
      if (target.dueDate && target.monthlyInstallment) {
        nextDue = calculateNextDueDate(
          {
            frequency: 'monthly',
            interval: 1,
            anchorDayOfMonth: parseLocalDate(target.dueDate).getDate(),
            occurrencesCount: 0,
            nextDueDate: target.dueDate,
          },
          target.dueDate
        );
      }

      const updatedDebt: Debt = {
        ...target,
        paidAmount: newPaid,
        isSettled: newPaid >= target.totalAmount,
        dueDate: nextDue,
        payments: [paymentItem, ...target.payments],
      };

      const nextDebts = debts.map((d) => (d.id === debtId ? updatedDebt : d));
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, debts: nextDebts }));
      } else {
        setPersonalDebts(nextDebts);
        savePersonalState({ debts: nextDebts });
      }

      if (logAsTx && payment.walletId) {
        const isIncome = target.type === 'owed_to_me';
        const fallbackCatId = categories.find((c) =>
          isIncome ? c.type === 'income' : c.type === 'expense'
        )?.id || 'cat-other';

        addTransaction({
          type: isIncome ? 'income' : 'expense',
          amount: payment.amount,
          currency: target.currency,
          date: payment.date,
          time: '12:00',
          categoryId: categories.some((c) => c.id === (isIncome ? 'cat-withdraw' : 'cat-bills'))
            ? isIncome
              ? 'cat-withdraw'
              : 'cat-bills'
            : fallbackCatId,
          walletId: payment.walletId,
          notes: `${isIncome ? 'استرداد دين من' : 'سداد دين إلى'}: ${target.personName} - ${payment.notes || ''}`,
          contact: target.personName,
          priority: 'essential',
          doesNotAffectBalance: false,
        });
      }
    },
    [debts, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState, categories, addTransaction]
  );

  const deleteDebt = useCallback(
    (id: string) => {
      const nextDebts = debts.filter((d) => d.id !== id);
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, debts: nextDebts }));
      } else {
        setPersonalDebts(nextDebts);
        savePersonalState({ debts: nextDebts });
      }
    },
    [debts, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const addGoal = useCallback(
    (data: Omit<SavingsGoal, 'id' | 'createdAt' | 'isCompleted'>) => {
      const newGoal: SavingsGoal = {
        ...data,
        id: `goal-${Date.now()}`,
        isCompleted: data.currentAmount >= data.targetAmount,
        createdAt: Date.now(),
      };
      const nextGoals = [newGoal, ...goals];
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, goals: nextGoals }));
      } else {
        setPersonalGoals(nextGoals);
        savePersonalState({ goals: nextGoals });
      }
      return newGoal;
    },
    [goals, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const updateGoal = useCallback(
    (id: string, updates: Partial<SavingsGoal>) => {
      const nextGoals = goals.map((g) => (g.id === id ? { ...g, ...updates } : g));
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, goals: nextGoals }));
      } else {
        setPersonalGoals(nextGoals);
        savePersonalState({ goals: nextGoals });
      }
    },
    [goals, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const contributeToGoal = useCallback(
    (goalId: string, amount: number, walletId?: string, isWithdrawal = false) => {
      const target = goals.find((g) => g.id === goalId);
      if (!target) return;

      const newSaved = isWithdrawal
        ? Math.max(0, target.currentAmount - amount)
        : target.currentAmount + amount;

      const updatedGoal: SavingsGoal = {
        ...target,
        currentAmount: newSaved,
        isCompleted: newSaved >= target.targetAmount,
      };

      const nextGoals = goals.map((g) => (g.id === goalId ? updatedGoal : g));
      let nextWallets = wallets;
      if (walletId) {
        const targetWallet = wallets.find((w) => w.id === walletId);
        if (targetWallet) {
          const balanceChange = isWithdrawal ? amount : -amount;
          nextWallets = wallets.map((w) =>
            w.id === walletId
              ? { ...w, balance: roundCurrency(w.balance + balanceChange, w.currency) }
              : w
          );
        }
      }

      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, goals: nextGoals, wallets: nextWallets }));
      } else {
        setPersonalGoals(nextGoals);
        setPersonalWallets(nextWallets);
        savePersonalState({ goals: nextGoals, wallets: nextWallets });
      }
    },
    [goals, wallets, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const deleteGoal = useCallback(
    (id: string) => {
      const nextGoals = goals.filter((g) => g.id !== id);
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, goals: nextGoals }));
      } else {
        setPersonalGoals(nextGoals);
        savePersonalState({ goals: nextGoals });
      }
    },
    [goals, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const addTemplate = useCallback(
    (data: Omit<Template, 'id'>) => {
      const newTemplate: Template = { ...data, id: `tmpl-${Date.now()}` };
      const nextTemplates = [...templates, newTemplate];
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, templates: nextTemplates }));
      } else {
        setPersonalTemplates(nextTemplates);
        savePersonalState({ templates: nextTemplates });
      }
      return newTemplate;
    },
    [templates, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const updateTemplate = useCallback(
    (id: string, updates: Partial<Template>) => {
      const nextTemplates = templates.map((t) => (t.id === id ? { ...t, ...updates } : t));
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, templates: nextTemplates }));
      } else {
        setPersonalTemplates(nextTemplates);
        savePersonalState({ templates: nextTemplates });
      }
    },
    [templates, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const deleteTemplate = useCallback(
    (id: string) => {
      const nextTemplates = templates.filter((t) => t.id !== id);
      if (isOrgWorkspace) {
        updateActiveOrgWorkspace((org) => ({ ...org, templates: nextTemplates }));
      } else {
        setPersonalTemplates(nextTemplates);
        savePersonalState({ templates: nextTemplates });
      }
    },
    [templates, isOrgWorkspace, updateActiveOrgWorkspace, savePersonalState]
  );

  const applyTemplate = useCallback(
    (templateId: string) => {
      const tmpl = templates.find((t) => t.id === templateId);
      if (!tmpl) return;

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const todayStr = formatLocalDate(now);
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

      let convertedAmount: number | undefined = undefined;
      if (tmpl.type === 'transfer' && tmpl.toWalletId) {
        const fromW = wallets.find((w) => w.id === tmpl.walletId);
        const toW = wallets.find((w) => w.id === tmpl.toWalletId);
        if (fromW && toW) {
          convertedAmount = convertCurrency(
            tmpl.amount,
            fromW.currency,
            toW.currency,
            settings.customExchangeRates
          );
        }
      }

      addTransaction({
        type: tmpl.type,
        amount: tmpl.amount,
        currency: tmpl.currency,
        date: todayStr,
        time: timeStr,
        categoryId: tmpl.categoryId,
        walletId: tmpl.walletId,
        toWalletId: tmpl.toWalletId,
        convertedAmount,
        transferFee: tmpl.transferFee,
        notes: tmpl.notes,
        priority: tmpl.priority,
        group: tmpl.group,
        contact: tmpl.contact,
        doesNotAffectBalance: tmpl.doesNotAffectBalance,
      });
    },
    [templates, wallets, settings.customExchangeRates, addTransaction]
  );

  // ===========================================================================
  // Personal Money Circles (الجمعيات المالية)
  // ===========================================================================
  const addMoneyCircle = useCallback(
    (
      data: Omit<MoneyCircle, 'id' | 'createdAt' | 'paidMonths' | 'hasReceivedPayout'>
    ): MoneyCircle => {
      const circle: MoneyCircle = {
        ...data,
        id: `mc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        paidMonths: [],
        hasReceivedPayout: false,
        createdAt: Date.now(),
      };
      const next = [circle, ...personalMoneyCircles];
      setPersonalMoneyCircles(next);
      savePersonalState({ moneyCircles: next });
      return circle;
    },
    [personalMoneyCircles, savePersonalState]
  );

  const updateMoneyCircle = useCallback(
    (id: string, updates: Partial<MoneyCircle>) => {
      const next = personalMoneyCircles.map((c) => (c.id === id ? { ...c, ...updates } : c));
      setPersonalMoneyCircles(next);
      savePersonalState({ moneyCircles: next });
    },
    [personalMoneyCircles, savePersonalState]
  );

  const deleteMoneyCircle = useCallback(
    (id: string) => {
      const next = personalMoneyCircles.filter((c) => c.id !== id);
      setPersonalMoneyCircles(next);
      savePersonalState({ moneyCircles: next });
    },
    [personalMoneyCircles, savePersonalState]
  );

  const toggleMoneyCircleMonthPaid = useCallback(
    (circleId: string, monthNumber: number, logWalletTx = true) => {
      const target = personalMoneyCircles.find((c) => c.id === circleId);
      if (!target) return;
      const key = String(monthNumber);
      const alreadyPaid = target.paidMonths.includes(key);
      const nextPaidMonths = alreadyPaid
        ? target.paidMonths.filter((m) => m !== key)
        : [...target.paidMonths, key];

      const nextCircles = personalMoneyCircles.map((c) =>
        c.id === circleId ? { ...c, paidMonths: nextPaidMonths } : c
      );

      if (!alreadyPaid && logWalletTx && target.walletId) {
        const linkedW = personalWallets.find((w) => w.id === target.walletId);
        if (linkedW) {
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const txAmountInWallet = convertCurrency(
            target.monthlyShare,
            target.currency,
            linkedW.currency,
            settings.customExchangeRates
          );
          const newTx: Transaction = {
            id: `tx-mc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            type: 'expense',
            amount: target.monthlyShare,
            currency: target.currency,
            date: formatLocalDate(now),
            time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
            categoryId: personalCategories.find((c) => c.type === 'expense' || c.type === 'both')?.id || 'cat-other',
            walletId: linkedW.id,
            notes:
              settings.language === 'en'
                ? `Money Circle installment #${monthNumber} — ${target.name}`
                : `قسط جمعية "${target.name}" (الشهر ${monthNumber})`,
            priority: 'essential',
            doesNotAffectBalance: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          const nextTx = [newTx, ...personalTransactions];
          const nextWallets = personalWallets.map((w) =>
            w.id === linkedW.id
              ? { ...w, balance: roundCurrency(w.balance - txAmountInWallet, w.currency) }
              : w
          );
          setPersonalTransactions(nextTx);
          setPersonalWallets(nextWallets);
          setPersonalMoneyCircles(nextCircles);
          savePersonalState({
            moneyCircles: nextCircles,
            transactions: nextTx,
            wallets: nextWallets,
          });
          return;
        }
      }

      setPersonalMoneyCircles(nextCircles);
      savePersonalState({ moneyCircles: nextCircles });
    },
    [
      personalMoneyCircles,
      personalWallets,
      personalCategories,
      personalTransactions,
      settings.customExchangeRates,
      settings.language,
      savePersonalState,
    ]
  );

  const markMoneyCirclePayoutReceived = useCallback(
    (circleId: string, logWalletTx = true) => {
      const target = personalMoneyCircles.find((c) => c.id === circleId);
      if (!target || target.hasReceivedPayout) return;
      const totalPayout = roundCurrency(target.monthlyShare * target.totalMonths, target.currency);
      const nextCircles = personalMoneyCircles.map((c) =>
        c.id === circleId ? { ...c, hasReceivedPayout: true } : c
      );

      if (logWalletTx && target.walletId) {
        const linkedW = personalWallets.find((w) => w.id === target.walletId);
        if (linkedW) {
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const payoutInWallet = convertCurrency(
            totalPayout,
            target.currency,
            linkedW.currency,
            settings.customExchangeRates
          );
          const newTx: Transaction = {
            id: `tx-mcpay-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            type: 'income',
            amount: totalPayout,
            currency: target.currency,
            date: formatLocalDate(now),
            time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
            categoryId: personalCategories.find((c) => c.type === 'income' || c.type === 'both')?.id || 'cat-other',
            walletId: linkedW.id,
            notes:
              settings.language === 'en'
                ? `Money Circle payout received — ${target.name}`
                : `استلام قبض جمعية "${target.name}"`,
            priority: 'essential',
            doesNotAffectBalance: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          const nextTx = [newTx, ...personalTransactions];
          const nextWallets = personalWallets.map((w) =>
            w.id === linkedW.id
              ? { ...w, balance: roundCurrency(w.balance + payoutInWallet, w.currency) }
              : w
          );
          setPersonalTransactions(nextTx);
          setPersonalWallets(nextWallets);
          setPersonalMoneyCircles(nextCircles);
          savePersonalState({
            moneyCircles: nextCircles,
            transactions: nextTx,
            wallets: nextWallets,
          });
          return;
        }
      }

      setPersonalMoneyCircles(nextCircles);
      savePersonalState({ moneyCircles: nextCircles });
    },
    [
      personalMoneyCircles,
      personalWallets,
      personalCategories,
      personalTransactions,
      settings.customExchangeRates,
      settings.language,
      savePersonalState,
    ]
  );

  // Settings & Onboarding
  const updateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      setSettings((prev) => {
        const next = mergeSettingsWithDefaults({
          ...prev,
          ...partial,
          socialLinks: partial.socialLinks
            ? { ...(prev.socialLinks || {}), ...partial.socialLinks }
            : prev.socialLinks,
        });
        savePersonalState({ settings: next });
        return next;
      });
    },
    [savePersonalState]
  );

  const completeOnboarding = useCallback(
    (mainCurrency: string, firstWalletName: string, initialBalance: number) => {
      const firstWallet: Wallet = {
        id: 'w-primary',
        name: firstWalletName || 'المحفظة الرئيسية',
        currency: mainCurrency,
        initialBalance: initialBalance || 0,
        balance: initialBalance || 0,
        color: '#3A605B',
        icon: 'Wallet',
        isArchived: false,
        order: 1,
      };

      const updatedSettings: AppSettings = { ...settings, mainCurrency };
      setPersonalWallets([firstWallet]);
      setSettings(updatedSettings);
      setHasCompletedOnboarding(true);
      setActiveWorkspace('personal');

      savePersonalState({
        wallets: [firstWallet],
        settings: updatedSettings,
        hasCompletedOnboarding: true,
      });
    },
    [settings, savePersonalState]
  );

  const loadDemoData = useCallback(() => {
    const demo = generateDemoSeedData(settings.mainCurrency);
    if (demo.transactions) setPersonalTransactions(demo.transactions);
    if (demo.templates) setPersonalTemplates(demo.templates);
    if (demo.budgets) setPersonalBudgets(demo.budgets);
    if (demo.debts) setPersonalDebts(demo.debts);
    if (demo.goals) setPersonalGoals(demo.goals);
    setHasCompletedOnboarding(true);
    setActiveWorkspace('personal');

    savePersonalState({
      transactions: demo.transactions,
      templates: demo.templates,
      budgets: demo.budgets,
      debts: demo.debts,
      goals: demo.goals,
      hasCompletedOnboarding: true,
    });
  }, [settings.mainCurrency, savePersonalState]);

  const resetAllData = useCallback(() => {
    const freshData: AppDatabaseData = {
      transactions: [],
      wallets: DEFAULT_WALLETS,
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      debts: [],
      goals: [],
      templates: [],
      moneyCircles: [],
      settings: DEFAULT_SETTINGS,
      user: latestPersonalRef.current.user,
      hasCompletedOnboarding: false,
    };

    setPersonalTransactions([]);
    setPersonalWallets(DEFAULT_WALLETS);
    setPersonalCategories(DEFAULT_CATEGORIES);
    setPersonalBudgets([]);
    setPersonalDebts([]);
    setPersonalGoals([]);
    setPersonalTemplates([]);
    setPersonalMoneyCircles([]);
    setOrgWorkspaces({});
    setActiveWorkspace('personal');
    setSettings(DEFAULT_SETTINGS);
    setHasCompletedOnboarding(false);

    void saveOrgWorkspaces('personal', {});
    void persistData(freshData);
  }, []);

  const isRTL = settings.language === 'ar';

  return (
    <AppContext.Provider
      value={{
        isLoading,
        transactions,
        wallets,
        categories,
        budgets,
        debts,
        goals,
        templates,
        moneyCircles: personalMoneyCircles,
        settings,
        user,
        hasCompletedOnboarding,

        activeWorkspace,
        orgWorkspaces,
        isOrgWorkspace,
        organizationsList,
        activeOrganization,
        orgMembers,
        orgCostCenters,
        orgParties,
        orgAuditLogs,
        activeOrgRole,
        canOrgWrite,
        canOrgApprove,
        canOrgManage,
        pendingApprovalsCount,
        switchWorkspace,
        createOrganization,
        joinOrganizationByCode,
        updateOrganizationSettings,
        lockAccountingPeriod,

        approveOrgTransaction,
        rejectOrgTransaction,
        addCostCenter,
        updateCostCenter,
        deleteCostCenter,
        addBusinessParty,
        updateBusinessParty,
        deleteBusinessParty,
        addOrUpdateOrgMember,
        removeOrgMember,

        isOrgHubOpen,
        setIsOrgHubOpen,
        orgHubTab,
        setOrgHubTab,
        openOrgHub,

        activeNav,
        setActiveNav,
        activeWalletId,
        setActiveWalletId,
        homeTab,
        setHomeTab,
        isAddModalOpen,
        setIsAddModalOpen,
        editingTransaction,
        setEditingTransaction,
        isSettingsOpen,
        setIsSettingsOpen,
        isFilterOpen,
        setIsFilterOpen,
        isBackupOpen,
        setIsBackupOpen,
        isReportsOpen,
        setIsReportsOpen,
        isCategoriesManagerOpen,
        setIsCategoriesManagerOpen,
        isCurrenciesManagerOpen,
        setIsCurrenciesManagerOpen,
        isUpgradeModalOpen,
        setIsUpgradeModalOpen,

        currencyPickerOpen,
        currencyPickerSelectedCode,
        openCurrencyPicker,
        closeCurrencyPicker,
        onCurrencySelectCallback,

        filters,
        setFilters,
        resetFilters,
        selectedTransactionIds,
        toggleSelectTransaction,
        selectAllTransactions,
        clearSelectedTransactions,
        changeSelectedTransactionsCategory,

        isAppLocked,
        unlockApp,
        lockedWalletIds,
        unlockWallet,

        isPro,
        isBusinessPro,
        planTier,
        proEntitlement: verifiedPro,
        redeemProCode,
        startBusinessTrial,
        devActivateProPreview,
        restorePurchases,
        scanQuota,
        setScanQuota,
        refreshScanQuota,
        isCloudSyncing,
        cloudSyncStatus,
        cloudSyncError,
        cloudSkippedAttachmentsWarning,
        cloudConflict,
        lastCloudBackupExists,
        signInWithGoogleAccount,
        signOutGoogleAccount,
        syncToCloudNow,
        restoreFromCloudNow,
        resolveCloudConflictOverwrite,
        clearCloudConflict,
        deleteAccountAndData,

        preRestoreSnapshotDate,
        createPreRestoreSnapshot,
        revertPreRestoreSnapshot,

        notifications,
        unreadNotificationsCount,
        markNotificationRead,
        markAllNotificationsRead,

        ratesLastUpdated,
        isRefreshingRates,
        refreshExchangeRates,

        undoAction,
        setUndoAction,
        triggerUndo,

        addTransaction,
        importTransactionsBatch,
        updateTransaction,
        deleteTransaction,
        deleteSelectedTransactions,
        moveSelectedTransactions,
        duplicateTransaction,

        addWallet,
        updateWallet,
        getWalletDependencies,
        deleteWallet,
        migrateAndDeleteWallet,

        addCategory,
        updateCategory,
        getCategoryDependencies,
        deleteCategory,
        migrateAndDeleteCategory,

        addBudget,
        updateBudget,
        deleteBudget,

        addDebt,
        updateDebt,
        recordDebtPayment,
        deleteDebt,

        addGoal,
        updateGoal,
        contributeToGoal,
        deleteGoal,

        addTemplate,
        updateTemplate,
        deleteTemplate,
        applyTemplate,

        addMoneyCircle,
        updateMoneyCircle,
        deleteMoneyCircle,
        toggleMoneyCircleMonthPaid,
        markMoneyCirclePayoutReceived,

        updateSettings,
        completeOnboarding,
        loadDemoData,
        resetAllData,

        t,
        isRTL,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
