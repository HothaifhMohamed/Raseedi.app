/**
 * Global Application State for Raseedi (رَصِيدِي)
 * Supports isolated Personal Local-First Workspace & Enterprise Organization Workspaces.
 */
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
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
  OrganizationInvite,
  OrganizationRole,
  OrgRef,
  CostCenter,
  BusinessParty,
  AuditLogEntry,
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
  loadActiveWorkspacePref,
  saveActiveWorkspacePref,
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
import {
  canRoleApproveOrg,
  canRoleEditOrg,
  canRoleManageOrg,
  computeOrgSeatLimit,
  computeOrgSubscriptionState,
  normalizeApprovalStatus,
  OrgSubscriptionState,
} from '../services/entitlements';
import { verifyAndUpgradePin } from '../services/security';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogle,
  reauthenticateWithGoogle,
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
  createOrgOnServer,
  createOrgInviteOnServer,
  fetchOrgInvitesFromServer,
  revokeOrgInviteOnServer,
  joinOrgByInviteCode,
  manageOrgMemberOnServer,
  transferOrgOwnershipOnServer,
  deleteOrgOnServer,
  flushPendingOrgUploads,
  isEntitlementActive,
  resolvePlanTierFromProfile,
  CloudBackupPayload,
  ScanQuotaInfo,
} from '../services/firebase';
import { EntitlementProvider, EntitlementContextValue, useEntitlement } from './EntitlementContext';
import { OrgProvider, OrgContextValue, useOrg } from './OrgContext';
import {
  subscribeUserOrgRefs,
  subscribeActiveOrganization,
  loadMoreOrgTransactions as fetchMoreOrgTransactionsCloud,
  createOrgTransactionCloud,
  updateOrgTransactionCloud,
  approveOrRejectOrMarkPaidOrgTxCloud,
  softDeleteOrgTransactionCloud,
  restoreOrgTransactionCloud,
  updateOrgTxAttachmentPathsCloud,
  moveOrgTransactionsCloud,
  batchUpdateOrgTransactionsCategoryCloud,
  importOrgTransactionsBatchCloud,
  recalculateOrgBalancesFromApproved,
  upsertOrgWalletCloud,
  deleteOrgWalletCloud,
  upsertOrgCategoryCloud,
  deleteOrgCategoryCloud,
  upsertOrgBudgetCloud,
  deleteOrgBudgetCloud,
  upsertOrgCostCenterCloud,
  deleteOrgCostCenterCloud,
  upsertOrgPartyCloud,
  deleteOrgPartyCloud,
  updateOrgSettingsCloud,
  OrgActorInfo,
} from '../services/orgCloud';
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
  // Core Data (reflects active Workspace: Personal OR Active Cloud Organization)
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

  // Dual Workspace & Cloud Enterprise State
  activeWorkspace: string; // 'personal' | orgId
  orgRefs: OrgRef[];
  isOrgWorkspace: boolean;
  isOrgLoading: boolean;
  orgSyncPendingWrites: boolean;
  orgActionError: string | null;
  clearOrgActionError: () => void;
  orgTrashTransactions: Transaction[];
  orgHasMoreTx: boolean;
  loadMoreOrgTransactions: () => Promise<void>;
  organizationsList: Organization[];
  activeOrganization: Organization | null;
  activeOrgSubscriptionState: OrgSubscriptionState | null;
  isOrgReadOnly: boolean;
  activeOrgMemberStatus: 'active' | 'suspended' | 'invited' | null;
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
  }) => Promise<Organization>;
  joinOrganizationByCode: (
    inviteCode: string
  ) => Promise<{ ok: boolean; orgId?: string; orgName?: string; error?: string }>;
  pendingJoinCode: string | null;
  clearPendingJoinCode: () => void;
  updateOrganizationSettings: (updates: Partial<Organization>) => void;
  lockAccountingPeriod: (lockedUntilDate: string | undefined) => void;

  // Legacy Local-to-Cloud Org Migration Wizard
  legacyLocalOrgs: OrgWorkspaceData[];
  isOrgMigrationModalOpen: boolean;
  openOrgMigrationModal: () => void;
  dismissLegacyOrgMigration: () => void;
  completeLegacyOrgMigration: (migratedOrgIds: string[]) => Promise<void>;
  queueLegacyOrgsForMigration: (workspaces: Record<string, OrgWorkspaceData>) => void;

  // Enterprise Operations
  approveOrgTransaction: (txId: string) => void;
  rejectOrgTransaction: (txId: string, reason: string) => void;
  markOrgTransactionPaid: (txId: string) => void;
  restoreOrgTransaction: (txId: string) => void;
  recalculateOrgBalances: () => Promise<void>;
  attachOrgReceiptPaths: (txId: string, attachmentPaths: string[], fallbackTx?: Transaction) => Promise<void>;
  addCostCenter: (data: Omit<CostCenter, 'id' | 'orgId' | 'createdAt'>) => CostCenter | null;
  updateCostCenter: (id: string, updates: Partial<CostCenter>) => void;
  deleteCostCenter: (id: string) => void;
  addBusinessParty: (data: Omit<BusinessParty, 'id' | 'orgId' | 'createdAt'>) => BusinessParty | null;
  updateBusinessParty: (id: string, updates: Partial<BusinessParty>) => void;
  deleteBusinessParty: (id: string) => void;

  // Team, Invites & Ownership (Admin SDK)
  createOrgInvite: (
    role: Exclude<OrganizationRole, 'owner'>,
    expiresInDays?: number,
    maxUses?: number
  ) => Promise<{ invite: OrganizationInvite; code: string }>;
  listOrgInvites: () => Promise<OrganizationInvite[]>;
  revokeOrgInvite: (inviteId: string) => Promise<void>;
  manageOrgMember: (params: {
    targetUid: string;
    action: 'change_role' | 'suspend' | 'reactivate' | 'remove' | 'set_spending_limit';
    role?: Exclude<OrganizationRole, 'owner'>;
    spendingLimit?: number | null;
    department?: string;
  }) => Promise<void>;
  transferOrgOwnership: (newOwnerUid: string) => Promise<void>;
  deleteOrganization: (confirmName: string) => Promise<void>;

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
  redeemProCode: (code: string, orgId?: string) => Promise<{ ok: boolean; error?: string }>;
  startBusinessTrial: (orgId?: string) => Promise<{ ok: boolean; error?: string }>;
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
  reauthenticateGoogleAccount: () => Promise<boolean>;
  deleteAccountAndData: () => Promise<{ ok: boolean; errorCode?: string; errorMessage?: string }>;

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

  // Dual Workspace / Cloud Enterprise State
  const [activeWorkspace, setActiveWorkspace] = useState<string>('personal');
  const [orgRefs, setOrgRefs] = useState<OrgRef[]>([]);
  const [orgRefsLoaded, setOrgRefsLoaded] = useState(false);
  const [isOrgLoading, setIsOrgLoading] = useState(false);
  const [orgSyncPendingWrites, setOrgSyncPendingWrites] = useState(false);
  const [orgActionError, setOrgActionError] = useState<string | null>(null);
  const [activeCloudOrg, setActiveCloudOrg] = useState<Organization | null>(null);
  const [activeCloudMembers, setActiveCloudMembers] = useState<OrganizationMember[]>([]);
  const [activeCloudWallets, setActiveCloudWallets] = useState<Wallet[]>([]);
  const [activeCloudCategories, setActiveCloudCategories] = useState<Category[]>([]);
  const [activeCloudBudgets, setActiveCloudBudgets] = useState<Budget[]>([]);
  const [activeCloudCostCenters, setActiveCloudCostCenters] = useState<CostCenter[]>([]);
  const [activeCloudParties, setActiveCloudParties] = useState<BusinessParty[]>([]);
  const [activeCloudTransactions, setActiveCloudTransactions] = useState<Transaction[]>([]);
  const [activeCloudTrashTransactions, setActiveCloudTrashTransactions] = useState<Transaction[]>([]);
  const [extraOrgTransactions, setExtraOrgTransactions] = useState<Transaction[]>([]);
  const [extraOrgTrashTransactions, setExtraOrgTrashTransactions] = useState<Transaction[]>([]);
  const [orgTxLastCursor, setOrgTxLastCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [orgHasMoreTx, setOrgHasMoreTx] = useState(false);
  const [activeCloudAuditLogs, setActiveCloudAuditLogs] = useState<AuditLogEntry[]>([]);

  // Legacy IndexedDB/JSON Organization Migration State
  const [legacyLocalOrgs, setLegacyLocalOrgs] = useState<OrgWorkspaceData[]>([]);
  const [isOrgMigrationModalOpen, setIsOrgMigrationModalOpen] = useState(false);
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('join');
      if (fromUrl && fromUrl.trim()) {
        sessionStorage.setItem('raseedi_pending_join_code', fromUrl.trim().toUpperCase());
        return fromUrl.trim().toUpperCase();
      }
      return sessionStorage.getItem('raseedi_pending_join_code') || null;
    } catch {
      return null;
    }
  });

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
  const activeOrgRef = useMemo(
    () => (activeWorkspace !== 'personal' ? orgRefs.find((r) => r.orgId === activeWorkspace) || null : null),
    [activeWorkspace, orgRefs]
  );

  const isOrgWorkspace =
    activeWorkspace !== 'personal' &&
    Boolean(user?.isLoggedIn) &&
    (Boolean(activeCloudOrg) || Boolean(activeOrgRef));

  const activeOrganization: Organization | null = useMemo(() => {
    if (!isOrgWorkspace) return null;
    if (activeCloudOrg) return activeCloudOrg;
    if (activeOrgRef) {
      return {
        id: activeOrgRef.orgId,
        name: activeOrgRef.orgName,
        currency: activeOrgRef.currency || 'EGP',
        vatRate: 14,
        approvalThreshold: 5000,
        ownerUid: '',
        createdAt: activeOrgRef.joinedAt || Date.now(),
        updatedAt: Date.now(),
      };
    }
    return null;
  }, [isOrgWorkspace, activeCloudOrg, activeOrgRef]);

  const orgTransactions = useMemo(() => {
    if (extraOrgTransactions.length === 0) return activeCloudTransactions;
    const seen = new Set(activeCloudTransactions.map((t) => t.id));
    return [...activeCloudTransactions, ...extraOrgTransactions.filter((t) => !seen.has(t.id))];
  }, [activeCloudTransactions, extraOrgTransactions]);

  const orgTrashTransactions = useMemo(() => {
    if (extraOrgTrashTransactions.length === 0) return activeCloudTrashTransactions;
    const seen = new Set(activeCloudTrashTransactions.map((t) => t.id));
    return [...activeCloudTrashTransactions, ...extraOrgTrashTransactions.filter((t) => !seen.has(t.id))];
  }, [activeCloudTrashTransactions, extraOrgTrashTransactions]);

  const transactions = isOrgWorkspace ? orgTransactions : personalTransactions;
  const wallets = isOrgWorkspace ? activeCloudWallets : personalWallets;
  const categories = isOrgWorkspace ? activeCloudCategories : personalCategories;
  const budgets = isOrgWorkspace ? activeCloudBudgets : personalBudgets;
  const debts = isOrgWorkspace ? [] : personalDebts;
  const goals = isOrgWorkspace ? [] : personalGoals;
  const templates = isOrgWorkspace ? [] : personalTemplates;

  const orgMembers = isOrgWorkspace ? activeCloudMembers : [];
  const orgCostCenters = isOrgWorkspace ? activeCloudCostCenters : [];
  const orgParties = isOrgWorkspace ? activeCloudParties : [];
  const orgAuditLogs = isOrgWorkspace ? activeCloudAuditLogs : [];

  const organizationsList: Organization[] = useMemo(() => {
    return orgRefs.map((refItem) => {
      if (activeCloudOrg && activeCloudOrg.id === refItem.orgId) {
        return activeCloudOrg;
      }
      return {
        id: refItem.orgId,
        name: refItem.orgName,
        currency: refItem.currency || 'EGP',
        vatRate: 14,
        approvalThreshold: 5000,
        ownerUid: refItem.role === 'owner' && user?.id ? user.id : '',
        createdAt: refItem.joinedAt || Date.now(),
        updatedAt: Date.now(),
      };
    });
  }, [orgRefs, activeCloudOrg, user?.id]);

  const activeOrgMember = useMemo(() => {
    if (!isOrgWorkspace || !user?.id) return null;
    return activeCloudMembers.find((m) => m.uid === user.id) || null;
  }, [isOrgWorkspace, activeCloudMembers, user?.id]);

  const activeOrgRole: OrganizationRole | null = useMemo(() => {
    if (!isOrgWorkspace) return null;
    if (activeOrgMember) return activeOrgMember.role;
    if (activeOrgRef) return activeOrgRef.role;
    if (activeCloudOrg && user?.id && activeCloudOrg.ownerUid === user.id) return 'owner';
    return 'viewer';
  }, [isOrgWorkspace, activeOrgMember, activeOrgRef, activeCloudOrg, user?.id]);

  const activeOrgMemberStatus: 'active' | 'suspended' | 'invited' | null = useMemo(() => {
    if (!isOrgWorkspace) return null;
    return activeOrgMember?.status || activeOrgRef?.status || 'active';
  }, [isOrgWorkspace, activeOrgMember, activeOrgRef]);

  const activeOrgSubscriptionState: OrgSubscriptionState | null = useMemo(() => {
    if (!isOrgWorkspace || !activeCloudOrg) return null;
    return computeOrgSubscriptionState({
      planTier: activeCloudOrg.planTier || 'business_pro',
      billingCycle: activeCloudOrg.billingCycle || 'trial',
      expiresAt: activeCloudOrg.expiresAt ?? null,
      extraSeats: activeCloudOrg.extraSeats || 0,
      seatLimit: activeCloudOrg.seatLimit ?? computeOrgSeatLimit(activeCloudOrg.extraSeats || 0),
    });
  }, [isOrgWorkspace, activeCloudOrg]);

  const isOrgReadOnly = Boolean(isOrgWorkspace && activeOrgSubscriptionState?.isReadOnly);

  const canOrgWrite =
    !isOrgWorkspace ||
    (activeOrgMemberStatus === 'active' && !isOrgReadOnly && canRoleEditOrg(activeOrgRole));
  const canOrgApprove =
    !isOrgWorkspace ||
    (activeOrgMemberStatus === 'active' && !isOrgReadOnly && canRoleApproveOrg(activeOrgRole));
  const canOrgManage =
    !isOrgWorkspace ||
    (activeOrgMemberStatus === 'active' && !isOrgReadOnly && canRoleManageOrg(activeOrgRole));

  const pendingApprovalsCount = useMemo(
    () =>
      isOrgWorkspace
        ? transactions.filter((tx) => normalizeApprovalStatus(tx.approvalStatus) === 'pending').length
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

  const getOrgActor = useCallback((): OrgActorInfo => {
    const uid = auth.currentUser?.uid || user?.id || '';
    const name =
      user?.name ||
      auth.currentUser?.displayName ||
      auth.currentUser?.email?.split('@')[0] ||
      (settings.language === 'en' ? 'Member' : 'عضو الفريق');
    return { uid, name };
  }, [user?.id, user?.name, settings.language]);

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

  const clearOrgActionError = useCallback(() => setOrgActionError(null), []);

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
      const targetOrgId = activeWorkspace !== 'personal' ? activeWorkspace : undefined;
      const q = await fetchScanQuotaFromServer(targetOrgId);
      if (q) setScanQuota(q);
    } catch {
      // Non-fatal
    }
  }, [activeWorkspace]);

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
        const legacyList = Object.values(backup.orgWorkspaces).filter(
          (w): w is OrgWorkspaceData => Boolean(w && w.organization && w.organization.id)
        );
        if (legacyList.length > 0) {
          setLegacyLocalOrgs(legacyList);
          setIsOrgMigrationModalOpen(true);
          void saveOrgWorkspaces('personal', backup.orgWorkspaces);
        }
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
    async (code: string, orgId?: string): Promise<{ ok: boolean; error?: string }> => {
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
        const res = await redeemProCodeWithServer(code, orgId);
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

  const startBusinessTrial = useCallback(
    async (orgId?: string): Promise<{ ok: boolean; error?: string }> => {
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
        const res = await startBusinessTrialWithServer(orgId);
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
    },
    [applyVerifiedProState, refreshScanQuota]
  );

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

      const savedWsPref = loadActiveWorkspacePref();
      if (savedWsPref && savedWsPref !== 'personal') {
        setActiveWorkspace(savedWsPref);
      }

      const legacyList = Object.values(orgData.workspaces || {}).filter(
        (w): w is OrgWorkspaceData => Boolean(w && w.organization && w.organization.id)
      );
      if (legacyList.length > 0) {
        setLegacyLocalOrgs(legacyList);
        setIsOrgMigrationModalOpen(true);
      }

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
        setOrgRefs([]);
        setOrgRefsLoaded(false);
        setActiveWorkspace('personal');
        saveActiveWorkspacePref('personal');
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

  // Subscribe to user's organization memberships (/users/{uid}/orgRefs)
  useEffect(() => {
    if (!user?.isLoggedIn || !user.id) {
      setOrgRefs([]);
      setOrgRefsLoaded(false);
      return;
    }
    const unsub = subscribeUserOrgRefs(
      user.id,
      (refs) => {
        setOrgRefs(refs);
        setOrgRefsLoaded(true);
      },
      (err) => {
        console.warn('Failed to listen orgRefs:', err);
        setOrgRefsLoaded(true);
      }
    );
    return () => unsub();
  }, [user?.isLoggedIn, user?.id]);

  // Validate activeWorkspace against server-managed orgRefs
  useEffect(() => {
    if (!orgRefsLoaded || activeWorkspace === 'personal') return;
    const match = orgRefs.find((r) => r.orgId === activeWorkspace);
    if (!match || match.status === 'suspended') {
      setActiveWorkspace('personal');
      saveActiveWorkspacePref('personal');
      if (match?.status === 'suspended') {
        setOrgActionError(
          settings.language === 'en'
            ? 'Your membership in this organization is suspended.'
            : 'تم تعليق عضويتك في هذه المؤسسة.'
        );
      }
    }
  }, [orgRefsLoaded, orgRefs, activeWorkspace, settings.language]);

  // Subscribe cleanly ONLY to the active cloud organization
  const activeOrgRefRoleForSub = useMemo<OrganizationRole>(() => {
    if (activeOrgRef?.role) return activeOrgRef.role;
    return 'viewer';
  }, [activeOrgRef?.role]);

  useEffect(() => {
    if (!user?.isLoggedIn || activeWorkspace === 'personal' || !activeOrgRef || activeOrgRef.status === 'suspended') {
      setIsOrgLoading(false);
      setActiveCloudOrg(null);
      setActiveCloudMembers([]);
      setActiveCloudWallets([]);
      setActiveCloudCategories([]);
      setActiveCloudBudgets([]);
      setActiveCloudCostCenters([]);
      setActiveCloudParties([]);
      setActiveCloudTransactions([]);
      setActiveCloudTrashTransactions([]);
      setExtraOrgTransactions([]);
      setExtraOrgTrashTransactions([]);
      setOrgTxLastCursor(null);
      setOrgHasMoreTx(false);
      setActiveCloudAuditLogs([]);
      setOrgSyncPendingWrites(false);
      return;
    }

    setIsOrgLoading(true);
    setExtraOrgTransactions([]);
    setExtraOrgTrashTransactions([]);
    setOrgTxLastCursor(null);

    const unsub = subscribeActiveOrganization(
      activeWorkspace,
      activeOrgRefRoleForSub,
      {
        onOrganization: (org) => {
          setActiveCloudOrg(org);
          setIsOrgLoading(false);
        },
        onMembers: (members) => setActiveCloudMembers(members),
        onWallets: (w) => setActiveCloudWallets(w),
        onCategories: (c) => setActiveCloudCategories(c),
        onBudgets: (b) => setActiveCloudBudgets(b),
        onCostCenters: (cc) => setActiveCloudCostCenters(cc),
        onParties: (p) => setActiveCloudParties(p),
        onTransactions: (activeTxs, trashTxs, meta) => {
          setActiveCloudTransactions(activeTxs);
          setActiveCloudTrashTransactions(trashTxs);
          setOrgTxLastCursor(meta.lastCursor);
          setOrgHasMoreTx(meta.hasMore);
          setOrgSyncPendingWrites(meta.hasPendingWrites);
          setIsOrgLoading(false);
        },
        onAuditLogs: (logs) => setActiveCloudAuditLogs(logs),
        onError: (scope, err) => {
          console.warn(`Org listener error (${scope}):`, err);
          setIsOrgLoading(false);
        },
      }
    );

    return () => unsub();
  }, [user?.isLoggedIn, activeWorkspace, activeOrgRef?.orgId, activeOrgRef?.status, activeOrgRefRoleForSub]);

  // Refresh scan quota when active workspace changes
  useEffect(() => {
    if (!user?.isLoggedIn) return;
    void refreshScanQuota();
  }, [activeWorkspace, user?.isLoggedIn, refreshScanQuota]);

  // Auto-process ?join=CODE URL link once signed in
  const processingJoinRef = React.useRef(false);
  useEffect(() => {
    if (!user?.isLoggedIn || !auth.currentUser || !pendingJoinCode || processingJoinRef.current) return;
    processingJoinRef.current = true;
    const codeToRedeem = pendingJoinCode;
    void joinOrgByInviteCode(codeToRedeem)
      .then((res) => {
        setPendingJoinCode(null);
        try {
          sessionStorage.removeItem('raseedi_pending_join_code');
          const url = new URL(window.location.href);
          if (url.searchParams.has('join')) {
            url.searchParams.delete('join');
            window.history.replaceState({}, '', url.toString());
          }
        } catch {
          // ignore
        }
        setActiveWorkspace(res.orgId);
        saveActiveWorkspacePref(res.orgId);
        setHasCompletedOnboarding(true);
        savePersonalState({ hasCompletedOnboarding: true });
      })
      .catch((err) => {
        setPendingJoinCode(null);
        try {
          sessionStorage.removeItem('raseedi_pending_join_code');
          const url = new URL(window.location.href);
          if (url.searchParams.has('join')) {
            url.searchParams.delete('join');
            window.history.replaceState({}, '', url.toString());
          }
        } catch {
          // ignore
        }
        setOrgActionError(
          err instanceof Error
            ? err.message
            : settings.language === 'en'
            ? 'Could not join organization with invite link.'
            : 'تعذر الانضمام للمؤسسة عبر رابط الدعوة.'
        );
      })
      .finally(() => {
        processingJoinRef.current = false;
      });
  }, [user?.isLoggedIn, pendingJoinCode, savePersonalState, settings.language]);

  // Flush pending offline Storage attachment uploads when back online
  const activeTransactionsRef = React.useRef<Transaction[]>([]);
  activeTransactionsRef.current = activeCloudTransactions;
  useEffect(() => {
    if (!user?.isLoggedIn) return;
    const handleFlush = () => {
      void flushPendingOrgUploads(async (item, uploadedPath) => {
        const targetTx = activeTransactionsRef.current.find((t) => t.id === item.txId);
        if (!targetTx) return;
        const nextPaths = [
          ...(targetTx.attachmentPaths || []).filter((p) => !p.includes(item.id)),
          uploadedPath,
        ];
        await updateOrgTxAttachmentPathsCloud(item.orgId, targetTx, nextPaths);
      });
    };
    handleFlush();
    window.addEventListener('online', handleFlush);
    return () => window.removeEventListener('online', handleFlush);
  }, [user?.isLoggedIn]);

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

  const reauthenticateGoogleAccount = useCallback(async (): Promise<boolean> => {
    try {
      await reauthenticateWithGoogle();
      return true;
    } catch {
      return false;
    }
  }, []);

  const deleteAccountAndData = useCallback(
    async (): Promise<{ ok: boolean; errorCode?: string; errorMessage?: string }> => {
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
        setOrgRefs([]);
        setOrgRefsLoaded(false);
        setActiveCloudOrg(null);
        setActiveWorkspace('personal');
        saveActiveWorkspacePref('personal');
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
        return { ok: true };
      } catch (err) {
        const errorCode =
          typeof err === 'object' && err && 'code' in err
            ? String((err as { code?: unknown }).code || '')
            : undefined;
        const msg = err instanceof Error ? err.message : 'Account deletion failed';
        setCloudSyncError(msg);
        return { ok: false, errorCode, errorMessage: msg };
      }
    },
    []
  );

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
      isOrgWorkspace,
      orgName: activeOrganization?.name,
      orgSubscriptionState: activeOrgSubscriptionState,
    });
    return raw.map((item) => ({
      ...item,
      read: readNotificationIds.has(item.id),
    }));
  }, [
    budgets,
    transactions,
    debts,
    settings,
    pendingApprovalsCount,
    isOrgWorkspace,
    activeOrganization?.name,
    activeOrgSubscriptionState,
    readNotificationIds,
  ]);

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
            if (isOrgWorkspace && activeOrganization) {
              const upgraded = { ...wallet, pin: result.newHash, pinSalt: result.newSalt };
              void upsertOrgWalletCloud(activeOrganization.id, upgraded, false, getOrgActor()).catch(
                () => {}
              );
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
    [wallets, isOrgWorkspace, activeOrganization, personalWallets, getOrgActor, savePersonalState]
  );

  const triggerUndo = useCallback(() => {
    if (undoAction) {
      undoAction.action();
      setUndoAction(null);
    }
  }, [undoAction]);

  // ===========================================================================
  // Workspace Management (Personal <-> Cloud Organizations)
  // ===========================================================================
  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      setSelectedTransactionIds([]);
      setActiveWalletId(null);
      setOrgActionError(null);
      resetFilters();
      if (workspaceId === 'personal') {
        setActiveWorkspace('personal');
        saveActiveWorkspacePref('personal');
        return;
      }
      if (orgRefs.some((r) => r.orgId === workspaceId)) {
        setActiveWorkspace(workspaceId);
        saveActiveWorkspacePref(workspaceId);
      }
    },
    [resetFilters, orgRefs]
  );

  const clearPendingJoinCode = useCallback(() => {
    setPendingJoinCode(null);
    try {
      sessionStorage.removeItem('raseedi_pending_join_code');
    } catch {
      // ignore
    }
  }, []);

  const openOrgMigrationModal = useCallback(() => {
    if (legacyLocalOrgs.length > 0) {
      setIsOrgMigrationModalOpen(true);
    }
  }, [legacyLocalOrgs.length]);

  const dismissLegacyOrgMigration = useCallback(() => {
    setIsOrgMigrationModalOpen(false);
  }, []);

  const completeLegacyOrgMigration = useCallback(async (migratedOrgIds: string[]) => {
    const idSet = new Set(migratedOrgIds);
    const currentStored = await loadOrgWorkspaces();
    const remainingMap: Record<string, OrgWorkspaceData> = {};
    for (const [k, ws] of Object.entries(currentStored.workspaces || {})) {
      if (!idSet.has(k) && !idSet.has(ws?.organization?.id)) {
        remainingMap[k] = ws;
      }
    }
    await saveOrgWorkspaces('personal', remainingMap);
    setLegacyLocalOrgs((prev) => {
      const next = prev.filter((item) => !idSet.has(item.organization.id));
      if (next.length === 0) {
        setIsOrgMigrationModalOpen(false);
      }
      return next;
    });
  }, []);

  const queueLegacyOrgsForMigration = useCallback((workspaces: Record<string, OrgWorkspaceData>) => {
    const list = Object.values(workspaces || {}).filter(
      (w): w is OrgWorkspaceData => Boolean(w && w.organization && w.organization.id)
    );
    if (list.length === 0) return;
    void saveOrgWorkspaces('personal', workspaces);
    setLegacyLocalOrgs(list);
    setIsOrgMigrationModalOpen(true);
  }, []);

  const createOrganization = useCallback(
    async (params: {
      name: string;
      currency: string;
      industry?: OrganizationIndustry;
      vatRate?: number;
      taxNumber?: string;
      approvalThreshold?: number;
      loadSampleData?: boolean;
    }): Promise<Organization> => {
      if (!auth.currentUser || !user?.isLoggedIn) {
        throw new Error(
          settings.language === 'en'
            ? 'Please sign in with Google first to create a Cloud Organization.'
            : 'يرجى تسجيل الدخول بحساب جوجل أولاً لإنشاء مؤسسة سحابية.'
        );
      }

      const res = await createOrgOnServer({
        name: params.name.trim() || (settings.language === 'en' ? 'My Company' : 'شركتي'),
        currency: params.currency || settings.mainCurrency,
        industry: params.industry || 'general',
        vatRate: params.vatRate ?? 14,
        approvalThreshold: params.approvalThreshold ?? 2000,
        taxNumber: params.taxNumber?.trim() || undefined,
        loadSampleData: Boolean(params.loadSampleData),
      });

      setActiveWorkspace(res.orgId);
      saveActiveWorkspacePref(res.orgId);
      setHasCompletedOnboarding(true);
      savePersonalState({ hasCompletedOnboarding: true });
      return res.organization;
    },
    [user?.isLoggedIn, settings.language, settings.mainCurrency, savePersonalState]
  );

  const joinOrganizationByCode = useCallback(
    async (
      inviteCode: string
    ): Promise<{ ok: boolean; orgId?: string; orgName?: string; error?: string }> => {
      const normalized = inviteCode.trim().toUpperCase();
      if (!normalized) {
        return {
          ok: false,
          error: settings.language === 'en' ? 'Enter a valid invite code' : 'أدخل رمز دعوة صحيح',
        };
      }
      if (!auth.currentUser || !user?.isLoggedIn) {
        return {
          ok: false,
          error:
            settings.language === 'en'
              ? 'Please sign in with Google first to join an organization.'
              : 'يرجى تسجيل الدخول بحساب جوجل أولاً للانضمام إلى المؤسسة.',
        };
      }

      try {
        const res = await joinOrgByInviteCode(normalized);
        setActiveWorkspace(res.orgId);
        saveActiveWorkspacePref(res.orgId);
        setHasCompletedOnboarding(true);
        savePersonalState({ hasCompletedOnboarding: true });
        return { ok: true, orgId: res.orgId, orgName: res.orgName };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : settings.language === 'en'
              ? 'Could not join organization.'
              : 'تعذر الانضمام إلى المؤسسة.',
        };
      }
    },
    [user?.isLoggedIn, settings.language, savePersonalState]
  );

  const loadMoreOrgTransactions = useCallback(async () => {
    if (!isOrgWorkspace || !activeOrganization || !orgTxLastCursor || !orgHasMoreTx) return;
    try {
      const res = await fetchMoreOrgTransactionsCloud(activeOrganization.id, orgTxLastCursor, 200);
      if (res.active.length > 0) {
        setExtraOrgTransactions((prev) => [...prev, ...res.active]);
      }
      if (res.trash.length > 0) {
        setExtraOrgTrashTransactions((prev) => [...prev, ...res.trash]);
      }
      setOrgTxLastCursor(res.lastCursor);
      setOrgHasMoreTx(res.hasMore);
    } catch (err) {
      setOrgActionError(err instanceof Error ? err.message : 'Failed to load more transactions');
    }
  }, [isOrgWorkspace, activeOrganization, orgTxLastCursor, orgHasMoreTx]);

  const updateOrganizationSettings = useCallback(
    (updates: Partial<Organization>) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgManage) return;
      void updateOrgSettingsCloud(
        activeOrganization.id,
        activeOrganization,
        updates,
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Update failed'));
    },
    [isOrgWorkspace, activeOrganization, canOrgManage, getOrgActor]
  );

  const lockAccountingPeriod = useCallback(
    (lockedUntilDate: string | undefined) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgManage) return;
      void updateOrgSettingsCloud(
        activeOrganization.id,
        activeOrganization,
        { lockedUntilDate: lockedUntilDate || undefined },
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Lock failed'));
    },
    [isOrgWorkspace, activeOrganization, canOrgManage, getOrgActor]
  );

  const approveOrgTransaction = useCallback(
    (txId: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return;
      const target = orgTransactions.find((tx) => tx.id === txId);
      if (!target || normalizeApprovalStatus(target.approvalStatus) === 'approved') return;
      void approveOrRejectOrMarkPaidOrgTxCloud(
        activeOrganization.id,
        target,
        'approved',
        activeCloudWallets,
        settings.customExchangeRates,
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Approval failed'));
    },
    [
      isOrgWorkspace,
      activeOrganization,
      canOrgApprove,
      orgTransactions,
      activeCloudWallets,
      settings.customExchangeRates,
      getOrgActor,
    ]
  );

  const rejectOrgTransaction = useCallback(
    (txId: string, reason: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return;
      const target = orgTransactions.find((tx) => tx.id === txId);
      if (!target) return;
      void approveOrRejectOrMarkPaidOrgTxCloud(
        activeOrganization.id,
        target,
        'rejected',
        activeCloudWallets,
        settings.customExchangeRates,
        getOrgActor(),
        reason.trim() || 'Rejected'
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Rejection failed'));
    },
    [
      isOrgWorkspace,
      activeOrganization,
      canOrgApprove,
      orgTransactions,
      activeCloudWallets,
      settings.customExchangeRates,
      getOrgActor,
    ]
  );

  const markOrgTransactionPaid = useCallback(
    (txId: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return;
      const target = orgTransactions.find((tx) => tx.id === txId);
      if (!target || normalizeApprovalStatus(target.approvalStatus) === 'paid') return;
      void approveOrRejectOrMarkPaidOrgTxCloud(
        activeOrganization.id,
        target,
        'paid',
        activeCloudWallets,
        settings.customExchangeRates,
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Mark paid failed'));
    },
    [
      isOrgWorkspace,
      activeOrganization,
      canOrgApprove,
      orgTransactions,
      activeCloudWallets,
      settings.customExchangeRates,
      getOrgActor,
    ]
  );

  const restoreOrgTransaction = useCallback(
    (txId: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgWrite) return;
      const target = orgTrashTransactions.find((tx) => tx.id === txId);
      if (!target) return;
      void restoreOrgTransactionCloud(
        activeOrganization.id,
        target,
        activeCloudWallets,
        settings.customExchangeRates,
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Restore failed'));
    },
    [
      isOrgWorkspace,
      activeOrganization,
      canOrgWrite,
      orgTrashTransactions,
      activeCloudWallets,
      settings.customExchangeRates,
      getOrgActor,
    ]
  );

  const recalculateOrgBalances = useCallback(async () => {
    if (!isOrgWorkspace || !activeOrganization || !canOrgManage) return;
    await recalculateOrgBalancesFromApproved(
      activeOrganization.id,
      activeCloudWallets,
      orgTransactions,
      settings.customExchangeRates,
      getOrgActor()
    );
  }, [
    isOrgWorkspace,
    activeOrganization,
    canOrgManage,
    activeCloudWallets,
    orgTransactions,
    settings.customExchangeRates,
    getOrgActor,
  ]);

  const attachOrgReceiptPaths = useCallback(
    async (txId: string, attachmentPaths: string[], fallbackTx?: Transaction) => {
      if (!isOrgWorkspace || !activeOrganization) return;
      const target =
        orgTransactions.find((tx) => tx.id === txId) || fallbackTx;
      if (!target) return;
      await updateOrgTxAttachmentPathsCloud(
        activeOrganization.id,
        target,
        attachmentPaths
      );
    },
    [isOrgWorkspace, activeOrganization, orgTransactions]
  );

  const addCostCenter = useCallback(
    (data: Omit<CostCenter, 'id' | 'orgId' | 'createdAt'>): CostCenter | null => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return null;
      const newCC: CostCenter = {
        ...data,
        id: `cc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        orgId: activeOrganization.id,
        createdAt: Date.now(),
      };
      void upsertOrgCostCenterCloud(
        activeOrganization.id,
        newCC,
        activeOrganization.currency,
        true,
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Cost center create failed'));
      return newCC;
    },
    [isOrgWorkspace, activeOrganization, canOrgApprove, getOrgActor]
  );

  const updateCostCenter = useCallback(
    (id: string, updates: Partial<CostCenter>) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return;
      const existing = activeCloudCostCenters.find((c) => c.id === id);
      if (!existing) return;
      void upsertOrgCostCenterCloud(
        activeOrganization.id,
        { ...existing, ...updates },
        activeOrganization.currency,
        false,
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Cost center update failed'));
    },
    [isOrgWorkspace, activeOrganization, canOrgApprove, activeCloudCostCenters, getOrgActor]
  );

  const deleteCostCenter = useCallback(
    (id: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgManage) return;
      void deleteOrgCostCenterCloud(activeOrganization.id, id, getOrgActor()).catch((err) =>
        setOrgActionError(err instanceof Error ? err.message : 'Cost center delete failed')
      );
    },
    [isOrgWorkspace, activeOrganization, canOrgManage, getOrgActor]
  );

  const addBusinessParty = useCallback(
    (data: Omit<BusinessParty, 'id' | 'orgId' | 'createdAt'>): BusinessParty | null => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return null;
      const newParty: BusinessParty = {
        ...data,
        id: `party-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        orgId: activeOrganization.id,
        createdAt: Date.now(),
      };
      void upsertOrgPartyCloud(activeOrganization.id, newParty, true, getOrgActor()).catch((err) =>
        setOrgActionError(err instanceof Error ? err.message : 'Party create failed')
      );
      return newParty;
    },
    [isOrgWorkspace, activeOrganization, canOrgApprove, getOrgActor]
  );

  const updateBusinessParty = useCallback(
    (id: string, updates: Partial<BusinessParty>) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return;
      const existing = activeCloudParties.find((p) => p.id === id);
      if (!existing) return;
      void upsertOrgPartyCloud(
        activeOrganization.id,
        { ...existing, ...updates },
        false,
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Party update failed'));
    },
    [isOrgWorkspace, activeOrganization, canOrgApprove, activeCloudParties, getOrgActor]
  );

  const deleteBusinessParty = useCallback(
    (id: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgManage) return;
      void deleteOrgPartyCloud(activeOrganization.id, id, getOrgActor()).catch((err) =>
        setOrgActionError(err instanceof Error ? err.message : 'Party delete failed')
      );
    },
    [isOrgWorkspace, activeOrganization, canOrgManage, getOrgActor]
  );

  const createOrgInvite = useCallback(
    async (
      role: Exclude<OrganizationRole, 'owner'>,
      expiresInDays = 7,
      maxUses = 5
    ): Promise<{ invite: OrganizationInvite; code: string }> => {
      if (!isOrgWorkspace || !activeOrganization) {
        throw new Error('NO_ACTIVE_ORG');
      }
      return createOrgInviteOnServer(activeOrganization.id, role, expiresInDays, maxUses);
    },
    [isOrgWorkspace, activeOrganization]
  );

  const listOrgInvites = useCallback(async (): Promise<OrganizationInvite[]> => {
    if (!isOrgWorkspace || !activeOrganization || !canRoleManageOrg(activeOrgRole)) return [];
    return fetchOrgInvitesFromServer(activeOrganization.id);
  }, [isOrgWorkspace, activeOrganization, activeOrgRole]);

  const revokeOrgInvite = useCallback(
    async (inviteId: string) => {
      if (!isOrgWorkspace || !activeOrganization) return;
      await revokeOrgInviteOnServer(activeOrganization.id, inviteId);
    },
    [isOrgWorkspace, activeOrganization]
  );

  const manageOrgMember = useCallback(
    async (params: {
      targetUid: string;
      action: 'change_role' | 'suspend' | 'reactivate' | 'remove' | 'set_spending_limit';
      role?: Exclude<OrganizationRole, 'owner'>;
      spendingLimit?: number | null;
      department?: string;
    }) => {
      if (!isOrgWorkspace || !activeOrganization) return;
      await manageOrgMemberOnServer({
        orgId: activeOrganization.id,
        ...params,
      });
    },
    [isOrgWorkspace, activeOrganization]
  );

  const transferOrgOwnership = useCallback(
    async (newOwnerUid: string) => {
      if (!isOrgWorkspace || !activeOrganization) return;
      await transferOrgOwnershipOnServer(activeOrganization.id, newOwnerUid);
    },
    [isOrgWorkspace, activeOrganization]
  );

  const deleteOrganization = useCallback(
    async (confirmName: string) => {
      if (!isOrgWorkspace || !activeOrganization) return;
      await deleteOrgOnServer(activeOrganization.id, confirmName);
      setActiveWorkspace('personal');
      saveActiveWorkspacePref('personal');
      setIsOrgHubOpen(false);
    },
    [isOrgWorkspace, activeOrganization]
  );

  // ===========================================================================
  // Unified CRUD: Transactions (respecting Personal vs Cloud Organization)
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
      let approvalStatus = normalizeApprovalStatus(data.approvalStatus);

      if (isOrgWorkspace && activeOrganization) {
        if (isOrgReadOnly) {
          throw new Error(
            settings.language === 'en'
              ? 'Organization subscription expired (Read-Only mode). Renew Business PRO to continue.'
              : 'انتهت صلاحية باقة المؤسسة (وضع القراءة فقط). قم بتجديد الباقة للمتابعة.'
          );
        }
        if (activeOrgMemberStatus === 'suspended' || !canOrgWrite) {
          throw new Error(
            settings.language === 'en'
              ? 'Your role or status does not allow adding transactions.'
              : 'صلاحيتك الحالية لا تسمح بإضافة معاملات جديدة.'
          );
        }
        if (isDateInLockedPeriod(data.date, activeOrganization.lockedUntilDate)) {
          throw new Error(
            settings.language === 'en'
              ? `Period locked through ${activeOrganization.lockedUntilDate}`
              : `الفترة المحاسبية مغلقة حتى تاريخ ${activeOrganization.lockedUntilDate}`
          );
        }
        if (
          activeOrgRole === 'employee' &&
          activeOrgMember?.spendingLimit &&
          activeOrgMember.spendingLimit > 0
        ) {
          const convertedAmt = convertCurrency(
            data.amount,
            data.currency,
            activeOrganization.currency,
            settings.customExchangeRates
          );
          if (convertedAmt > activeOrgMember.spendingLimit) {
            throw new Error(
              settings.language === 'en'
                ? `Amount exceeds your spending limit (${activeOrgMember.spendingLimit} ${activeOrganization.currency})`
                : `المبلغ يتجاوز سقف الصرف المحدد لك (${activeOrgMember.spendingLimit} ${activeOrganization.currency})`
            );
          }
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

        if (activeOrgRole === 'employee') {
          approvalStatus = approvalStatus === 'draft' ? 'draft' : 'pending';
        } else if (!approvalStatus) {
          approvalStatus = needsApproval ? 'pending' : 'approved';
        }
      }

      const autoVoucherNumber =
        isOrgWorkspace && !data.voucherNumber?.trim()
          ? generateNextVoucherNumber(transactions, data.type)
          : data.voucherNumber?.trim() || undefined;

      const actor = getOrgActor();
      const newTx: Transaction = {
        ...data,
        ...(isOrgWorkspace && activeOrganization
          ? {
              workspaceId: activeOrganization.id,
              approvalStatus: approvalStatus || 'approved',
              voucherNumber: autoVoucherNumber,
              submittedBy: data.submittedBy || actor.uid,
              submittedByName: data.submittedByName || actor.name,
              deletedAt: null,
            }
          : {}),
        id: `tx-${now}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
        updatedAt: now,
      };

      const nextSettings: AppSettings = {
        ...settings,
        lastUsedTransactionType: newTx.type,
        ...(settings.useLastUsedWallet ? { lastUsedWalletId: newTx.walletId } : {}),
      };
      setSettings(nextSettings);

      if (isOrgWorkspace && activeOrganization) {
        void createOrgTransactionCloud(
          activeOrganization.id,
          newTx,
          activeCloudWallets,
          settings.customExchangeRates,
          actor
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Transaction create failed'));
        savePersonalState({ settings: nextSettings });
      } else {
        const updatedWallets = applyDeltasToWallets(personalWallets, newTx, 1);
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
      isOrgReadOnly,
      activeOrgMemberStatus,
      canOrgWrite,
      activeOrgRole,
      activeOrgMember,
      transactions,
      getOrgActor,
      settings,
      activeCloudWallets,
      applyDeltasToWallets,
      personalWallets,
      personalTransactions,
      savePersonalState,
    ]
  );

  const importTransactionsBatch = useCallback(
    (items: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[]) => {
      if (items.length === 0) return 0;

      const baseNow = Date.now();
      const actor = getOrgActor();
      const filteredItems =
        isOrgWorkspace && activeOrganization
          ? items.filter((d) => !isDateInLockedPeriod(d.date, activeOrganization.lockedUntilDate))
          : items;
      if (filteredItems.length === 0) return 0;

      const newTxs: Transaction[] = filteredItems.map((data, idx) => ({
        ...data,
        ...(isOrgWorkspace && activeOrganization
          ? {
              workspaceId: activeOrganization.id,
              approvalStatus:
                activeOrgRole === 'employee'
                  ? 'pending'
                  : normalizeApprovalStatus(data.approvalStatus) || 'approved',
              submittedBy: data.submittedBy || actor.uid,
              submittedByName: data.submittedByName || actor.name,
              deletedAt: null,
            }
          : {}),
        id: `csv-${baseNow}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: baseNow - idx,
        updatedAt: baseNow - idx,
      }));

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return 0;
        void importOrgTransactionsBatchCloud(
          activeOrganization.id,
          newTxs,
          activeCloudWallets,
          settings.customExchangeRates,
          actor
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Batch import failed'));
        return newTxs.length;
      }

      let updatedWallets = [...personalWallets];
      for (const tx of newTxs) {
        updatedWallets = applyDeltasToWallets(updatedWallets, tx, 1);
      }
      const nextTx = [...newTxs, ...personalTransactions];
      setPersonalTransactions(nextTx);
      setPersonalWallets(updatedWallets);
      savePersonalState({ transactions: nextTx, wallets: updatedWallets });
      return newTxs.length;
    },
    [
      getOrgActor,
      isOrgWorkspace,
      activeOrganization,
      activeOrgRole,
      canOrgWrite,
      activeCloudWallets,
      settings.customExchangeRates,
      personalWallets,
      applyDeltasToWallets,
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
          setOrgActionError(
            settings.language === 'en'
              ? `Period locked through ${activeOrganization.lockedUntilDate}`
              : `الفترة المحاسبية مغلقة حتى ${activeOrganization.lockedUntilDate}`
          );
          return;
        }
        const normOld = normalizeApprovalStatus(oldTx.approvalStatus);
        if (activeOrgRole === 'employee' && (normOld === 'approved' || normOld === 'paid')) {
          setOrgActionError(
            settings.language === 'en'
              ? 'Approved or paid transactions cannot be edited by an employee.'
              : 'لا يمكن للموظف تعديل معاملة تم اعتمادها أو صرفها.'
          );
          return;
        }
        const nextAmount = updates.amount ?? oldTx.amount;
        const nextCurrency = updates.currency ?? oldTx.currency;
        if (
          activeOrgRole === 'employee' &&
          activeOrgMember?.spendingLimit &&
          activeOrgMember.spendingLimit > 0
        ) {
          const converted = convertCurrency(
            nextAmount,
            nextCurrency,
            activeOrganization.currency,
            settings.customExchangeRates
          );
          if (converted > activeOrgMember.spendingLimit) {
            setOrgActionError(
              settings.language === 'en'
                ? `Amount exceeds your spending limit (${activeOrgMember.spendingLimit} ${activeOrganization.currency})`
                : `المبلغ يتجاوز سقف الصرف المحدد لك (${activeOrgMember.spendingLimit} ${activeOrganization.currency})`
            );
            return;
          }
        }

        const mergedTx: Transaction = {
          ...oldTx,
          ...updates,
          approvalStatus:
            normalizeApprovalStatus(updates.approvalStatus ?? oldTx.approvalStatus) || 'approved',
          updatedAt: Date.now(),
        };
        void updateOrgTransactionCloud(
          activeOrganization.id,
          oldTx,
          mergedTx,
          activeCloudWallets,
          settings.customExchangeRates,
          getOrgActor()
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Update failed'));
        return;
      }

      let updatedWallets = applyDeltasToWallets(personalWallets, oldTx, -1);
      const mergedTx: Transaction = {
        ...oldTx,
        ...updates,
        updatedAt: Date.now(),
      };
      updatedWallets = applyDeltasToWallets(updatedWallets, mergedTx, 1);

      const nextTx = personalTransactions.map((t) => (t.id === id ? mergedTx : t));
      setPersonalTransactions(nextTx);
      setPersonalWallets(updatedWallets);
      savePersonalState({ transactions: nextTx, wallets: updatedWallets });
    },
    [
      transactions,
      isOrgWorkspace,
      activeOrganization,
      canOrgWrite,
      activeOrgRole,
      activeOrgMember,
      settings.language,
      settings.customExchangeRates,
      activeCloudWallets,
      getOrgActor,
      applyDeltasToWallets,
      personalWallets,
      personalTransactions,
      savePersonalState,
    ]
  );

  const deleteTransaction = useCallback(
    (id: string) => {
      const oldTx = transactions.find((t) => t.id === id);
      if (!oldTx) return;

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return;
        const normOld = normalizeApprovalStatus(oldTx.approvalStatus);
        if (!canOrgApprove && (normOld === 'approved' || normOld === 'paid')) {
          setOrgActionError(
            settings.language === 'en'
              ? 'Only accountants or admins can delete approved transactions.'
              : 'لا يملك الموظف صلاحية حذف معاملة معتمدة.'
          );
          return;
        }
        if (isDateInLockedPeriod(oldTx.date, activeOrganization.lockedUntilDate)) {
          setOrgActionError(
            settings.language === 'en'
              ? `Period locked through ${activeOrganization.lockedUntilDate}`
              : `الفترة المحاسبية مغلقة حتى ${activeOrganization.lockedUntilDate}`
          );
          return;
        }

        const actor = getOrgActor();
        const orgId = activeOrganization.id;
        void softDeleteOrgTransactionCloud(
          orgId,
          oldTx,
          activeCloudWallets,
          settings.customExchangeRates,
          actor
        )
          .then(() => {
            setUndoAction({
              id: `undo-${Date.now()}`,
              message: t('transactionDeleted'),
              action: () => {
                void restoreOrgTransactionCloud(
                  orgId,
                  { ...oldTx, deletedAt: Date.now() },
                  activeCloudWallets,
                  settings.customExchangeRates,
                  actor
                ).catch((err) =>
                  setOrgActionError(err instanceof Error ? err.message : 'Restore failed')
                );
              },
            });
          })
          .catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Delete failed'));
        return;
      }

      const updatedWallets = applyDeltasToWallets(personalWallets, oldTx, -1);
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
    },
    [
      transactions,
      isOrgWorkspace,
      activeOrganization,
      canOrgWrite,
      canOrgApprove,
      settings.language,
      settings.customExchangeRates,
      getOrgActor,
      activeCloudWallets,
      applyDeltasToWallets,
      personalWallets,
      personalTransactions,
      savePersonalState,
      t,
    ]
  );

  const deleteSelectedTransactions = useCallback(() => {
    if (selectedTransactionIds.length === 0) return;

    if (isOrgWorkspace && activeOrganization) {
      if (!canOrgWrite) {
        setSelectedTransactionIds([]);
        return;
      }
      const actor = getOrgActor();
      const orgId = activeOrganization.id;
      const deletable = selectedTransactionIds
        .map((id) => orgTransactions.find((tx) => tx.id === id))
        .filter((tx): tx is Transaction => {
          if (!tx) return false;
          if (isDateInLockedPeriod(tx.date, activeOrganization.lockedUntilDate)) return false;
          const norm = normalizeApprovalStatus(tx.approvalStatus);
          if (!canOrgApprove && (norm === 'approved' || norm === 'paid')) return false;
          if (activeOrgRole === 'employee' && tx.submittedBy !== actor.uid) return false;
          return true;
        });

      setSelectedTransactionIds([]);
      if (deletable.length === 0) return;

      void (async () => {
        // Track running wallet state sequentially to avoid stale balance overwrites
        let runningWallets = activeCloudWallets.map((w) => ({ ...w }));
        for (const tx of deletable) {
          await softDeleteOrgTransactionCloud(
            orgId,
            tx,
            runningWallets,
            settings.customExchangeRates,
            actor
          );
          runningWallets = applyDeltasToWallets(runningWallets, tx, -1);
        }
      })().catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Batch delete failed'));
      return;
    }

    const toDeleteSet = new Set(selectedTransactionIds);
    let updatedWallets = [...personalWallets];
    for (const id of selectedTransactionIds) {
      const oldTx = personalTransactions.find((t) => t.id === id);
      if (!oldTx) continue;
      updatedWallets = applyDeltasToWallets(updatedWallets, oldTx, -1);
    }

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
  }, [
    selectedTransactionIds,
    isOrgWorkspace,
    activeOrganization,
    canOrgWrite,
    canOrgApprove,
    activeOrgRole,
    getOrgActor,
    orgTransactions,
    activeCloudWallets,
    settings.customExchangeRates,
    applyDeltasToWallets,
    personalWallets,
    personalTransactions,
    savePersonalState,
    t,
  ]);

  const moveSelectedTransactions = useCallback(
    (toWalletId: string) => {
      if (selectedTransactionIds.length === 0) return;

      const targetWalletOrig = wallets.find((w) => w.id === toWalletId);
      if (!targetWalletOrig) return;

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) {
          setSelectedTransactionIds([]);
          return;
        }
        const toMoveSet = new Set(selectedTransactionIds);
        const txsToMove = orgTransactions.filter((tx) => {
          if (!toMoveSet.has(tx.id) || tx.walletId === toWalletId) return false;
          if (tx.type === 'transfer' && tx.toWalletId === toWalletId) return false;
          if (isDateInLockedPeriod(tx.date, activeOrganization.lockedUntilDate)) return false;
          return true;
        });
        setSelectedTransactionIds([]);
        if (txsToMove.length === 0) return;
        const fromId = txsToMove[0].walletId;
        void moveOrgTransactionsCloud(
          activeOrganization.id,
          txsToMove,
          fromId,
          toWalletId,
          activeCloudWallets,
          settings.customExchangeRates,
          getOrgActor()
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Move failed'));
        return;
      }

      const toMoveSet = new Set(selectedTransactionIds);
      const updatedWallets = personalWallets.map((w) => ({ ...w }));
      const targetWallet = updatedWallets.find((w) => w.id === toWalletId)!;
      let anyMoved = false;

      const nextTx = personalTransactions.map((tx) => {
        if (!toMoveSet.has(tx.id) || tx.walletId === toWalletId) return tx;
        if (tx.type === 'transfer' && tx.toWalletId === toWalletId) return tx;

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
    },
    [
      selectedTransactionIds,
      wallets,
      isOrgWorkspace,
      activeOrganization,
      canOrgWrite,
      orgTransactions,
      activeCloudWallets,
      settings.customExchangeRates,
      settings.language,
      getOrgActor,
      personalWallets,
      personalTransactions,
      savePersonalState,
    ]
  );

  const changeSelectedTransactionsCategory = useCallback(
    (newCategoryId: string) => {
      if (selectedTransactionIds.length === 0) return;
      const toChangeSet = new Set(selectedTransactionIds);

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) {
          setSelectedTransactionIds([]);
          return;
        }
        const txsToUpdate = orgTransactions.filter(
          (tx) => toChangeSet.has(tx.id) && !isDateInLockedPeriod(tx.date, activeOrganization.lockedUntilDate)
        );
        setSelectedTransactionIds([]);
        if (txsToUpdate.length === 0) return;
        void batchUpdateOrgTransactionsCategoryCloud(
          activeOrganization.id,
          txsToUpdate,
          newCategoryId,
          getOrgActor()
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Batch category update failed'));
        return;
      }

      const nextTx = personalTransactions.map((t) =>
        toChangeSet.has(t.id) ? { ...t, categoryId: newCategoryId, updatedAt: Date.now() } : t
      );
      setSelectedTransactionIds([]);
      setPersonalTransactions(nextTx);
      savePersonalState({ transactions: nextTx });
    },
    [
      selectedTransactionIds,
      isOrgWorkspace,
      activeOrganization,
      canOrgWrite,
      orgTransactions,
      getOrgActor,
      personalTransactions,
      savePersonalState,
    ]
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
        approvedBy: undefined,
        reviewedBy: undefined,
        reviewedAt: undefined,
        rejectionReason: undefined,
        voucherNumber: undefined,
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
        id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        balance: data.initialBalance,
        isArchived: false,
        order: wallets.length + 1,
      };
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return newWallet;
        void upsertOrgWalletCloud(activeOrganization.id, newWallet, true, getOrgActor()).catch((err) =>
          setOrgActionError(err instanceof Error ? err.message : 'Wallet create failed')
        );
        return newWallet;
      }
      const nextWallets = [...personalWallets, newWallet];
      setPersonalWallets(nextWallets);
      savePersonalState({ wallets: nextWallets });
      return newWallet;
    },
    [wallets.length, isOrgWorkspace, activeOrganization, canOrgWrite, getOrgActor, personalWallets, savePersonalState]
  );

  const updateWallet = useCallback(
    (id: string, updates: Partial<Wallet>) => {
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return;
        const existing = activeCloudWallets.find((w) => w.id === id);
        if (!existing) return;
        void upsertOrgWalletCloud(
          activeOrganization.id,
          { ...existing, ...updates },
          false,
          getOrgActor()
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Wallet update failed'));
        return;
      }
      const nextWallets = personalWallets.map((w) => (w.id === id ? { ...w, ...updates } : w));
      setPersonalWallets(nextWallets);
      savePersonalState({ wallets: nextWallets });
    },
    [isOrgWorkspace, activeOrganization, canOrgWrite, activeCloudWallets, getOrgActor, personalWallets, savePersonalState]
  );

  const migrateAndDeleteWallet = useCallback(
    (walletId: string, targetWalletId: string) => {
      const targetWallet = wallets.find((w) => w.id === targetWalletId);
      const sourceWallet = wallets.find((w) => w.id === walletId);
      if (!targetWallet || !sourceWallet || walletId === targetWalletId) return;

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgManage) return;
        const affectedTxs = orgTransactions.filter(
          (tx) => tx.walletId === walletId || tx.toWalletId === walletId
        );
        const actor = getOrgActor();
        const convertedInit = convertCurrency(
          sourceWallet.initialBalance || 0,
          sourceWallet.currency,
          targetWallet.currency,
          settings.customExchangeRates
        );
        void (async () => {
          if (convertedInit !== 0) {
            await upsertOrgWalletCloud(
              activeOrganization.id,
              {
                ...targetWallet,
                initialBalance: roundCurrency(
                  (targetWallet.initialBalance || 0) + convertedInit,
                  targetWallet.currency
                ),
                balance: roundCurrency(targetWallet.balance + convertedInit, targetWallet.currency),
              },
              false,
              actor
            );
          }
          await deleteOrgWalletCloud(
            activeOrganization.id,
            walletId,
            actor,
            affectedTxs,
            targetWalletId,
            activeCloudWallets,
            settings.customExchangeRates
          );
        })().catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Wallet migration failed'));
        return;
      }

      const migratedTx = personalTransactions.map((tx) => {
        if (tx.walletId !== walletId && tx.toWalletId !== walletId) return tx;
        return {
          ...tx,
          walletId: tx.walletId === walletId ? targetWalletId : tx.walletId,
          toWalletId: tx.toWalletId === walletId ? targetWalletId : tx.toWalletId,
          updatedAt: Date.now(),
        };
      });
      const migratedBudgets = personalBudgets.map((b) =>
        b.walletId === walletId ? { ...b, walletId: targetWalletId } : b
      );
      const migratedTemplates = personalTemplates.map((tm) => ({
        ...tm,
        walletId: tm.walletId === walletId ? targetWalletId : tm.walletId,
        toWalletId: tm.toWalletId === walletId ? targetWalletId : tm.toWalletId,
      }));
      const migratedGoals = personalGoals.map((g) =>
        g.walletId === walletId ? { ...g, walletId: targetWalletId } : g
      );

      const convertedRemaining = convertCurrency(
        sourceWallet.balance,
        sourceWallet.currency,
        targetWallet.currency,
        settings.customExchangeRates
      );
      const nextWallets = personalWallets
        .filter((w) => w.id !== walletId)
        .map((w) =>
          w.id === targetWalletId
            ? { ...w, balance: roundCurrency(w.balance + convertedRemaining, w.currency) }
            : w
        );

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
    },
    [
      wallets,
      isOrgWorkspace,
      activeOrganization,
      canOrgManage,
      orgTransactions,
      getOrgActor,
      settings.customExchangeRates,
      activeCloudWallets,
      personalTransactions,
      personalBudgets,
      personalTemplates,
      personalGoals,
      personalWallets,
      savePersonalState,
    ]
  );

  const deleteWallet = useCallback(
    (id: string) => {
      if (getWalletDependencies(id).totalCount > 0) return;
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgManage) return;
        void deleteOrgWalletCloud(activeOrganization.id, id, getOrgActor()).catch((err) =>
          setOrgActionError(err instanceof Error ? err.message : 'Wallet delete failed')
        );
        return;
      }
      const nextWallets = personalWallets.filter((w) => w.id !== id);
      setPersonalWallets(nextWallets);
      savePersonalState({ wallets: nextWallets });
    },
    [getWalletDependencies, isOrgWorkspace, activeOrganization, canOrgManage, getOrgActor, personalWallets, savePersonalState]
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
        id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        order: categories.length + 1,
      };
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return newCat;
        void upsertOrgCategoryCloud(activeOrganization.id, newCat, true, getOrgActor()).catch((err) =>
          setOrgActionError(err instanceof Error ? err.message : 'Category create failed')
        );
        return newCat;
      }
      const nextCategories = [...personalCategories, newCat];
      setPersonalCategories(nextCategories);
      savePersonalState({ categories: nextCategories });
      return newCat;
    },
    [categories.length, isOrgWorkspace, activeOrganization, canOrgWrite, getOrgActor, personalCategories, savePersonalState]
  );

  const updateCategory = useCallback(
    (id: string, updates: Partial<Category>) => {
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return;
        const existing = activeCloudCategories.find((c) => c.id === id);
        if (!existing) return;
        void upsertOrgCategoryCloud(
          activeOrganization.id,
          { ...existing, ...updates },
          false,
          getOrgActor()
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Category update failed'));
        return;
      }
      const nextCategories = personalCategories.map((c) => (c.id === id ? { ...c, ...updates } : c));
      setPersonalCategories(nextCategories);
      savePersonalState({ categories: nextCategories });
    },
    [isOrgWorkspace, activeOrganization, canOrgWrite, activeCloudCategories, getOrgActor, personalCategories, savePersonalState]
  );

  const migrateAndDeleteCategory = useCallback(
    (categoryId: string, targetCategoryId: string) => {
      if (categoryId === targetCategoryId) return;

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgManage) return;
        const affectedTxs = orgTransactions.filter((tx) => tx.categoryId === categoryId);
        void deleteOrgCategoryCloud(
          activeOrganization.id,
          categoryId,
          getOrgActor(),
          affectedTxs,
          targetCategoryId
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Category migration failed'));
        return;
      }

      const migratedTx = personalTransactions.map((tx) =>
        tx.categoryId === categoryId ? { ...tx, categoryId: targetCategoryId, updatedAt: Date.now() } : tx
      );
      const migratedBudgets = personalBudgets.map((b) =>
        b.categoryId === categoryId ? { ...b, categoryId: targetCategoryId } : b
      );
      const migratedTemplates = personalTemplates.map((tm) =>
        tm.categoryId === categoryId ? { ...tm, categoryId: targetCategoryId } : tm
      );
      const nextCategories = personalCategories.filter((c) => c.id !== categoryId);

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
    },
    [
      isOrgWorkspace,
      activeOrganization,
      canOrgManage,
      orgTransactions,
      getOrgActor,
      personalTransactions,
      personalBudgets,
      personalTemplates,
      personalCategories,
      savePersonalState,
    ]
  );

  const deleteCategory = useCallback(
    (id: string) => {
      if (getCategoryDependencies(id).totalCount > 0) return;
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgManage) return;
        void deleteOrgCategoryCloud(activeOrganization.id, id, getOrgActor()).catch((err) =>
          setOrgActionError(err instanceof Error ? err.message : 'Category delete failed')
        );
        return;
      }
      const nextCategories = personalCategories.filter((c) => c.id !== id);
      setPersonalCategories(nextCategories);
      savePersonalState({ categories: nextCategories });
    },
    [getCategoryDependencies, isOrgWorkspace, activeOrganization, canOrgManage, getOrgActor, personalCategories, savePersonalState]
  );

  // ===========================================================================
  // Budgets, Debts, Goals, Templates
  // ===========================================================================
  const addBudget = useCallback(
    (data: Omit<Budget, 'id'>) => {
      const newBudget: Budget = { ...data, id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 5)}` };
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return newBudget;
        void upsertOrgBudgetCloud(
          activeOrganization.id,
          newBudget,
          activeOrganization.currency,
          true,
          getOrgActor()
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Budget create failed'));
        return newBudget;
      }
      const nextBudgets = [...personalBudgets, newBudget];
      setPersonalBudgets(nextBudgets);
      savePersonalState({ budgets: nextBudgets });
      return newBudget;
    },
    [isOrgWorkspace, activeOrganization, canOrgWrite, getOrgActor, personalBudgets, savePersonalState]
  );

  const updateBudget = useCallback(
    (id: string, updates: Partial<Budget>) => {
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return;
        const existing = activeCloudBudgets.find((b) => b.id === id);
        if (!existing) return;
        void upsertOrgBudgetCloud(
          activeOrganization.id,
          { ...existing, ...updates },
          activeOrganization.currency,
          false,
          getOrgActor()
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Budget update failed'));
        return;
      }
      const nextBudgets = personalBudgets.map((b) => (b.id === id ? { ...b, ...updates } : b));
      setPersonalBudgets(nextBudgets);
      savePersonalState({ budgets: nextBudgets });
    },
    [isOrgWorkspace, activeOrganization, canOrgWrite, activeCloudBudgets, getOrgActor, personalBudgets, savePersonalState]
  );

  const deleteBudget = useCallback(
    (id: string) => {
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgManage) return;
        void deleteOrgBudgetCloud(activeOrganization.id, id, getOrgActor()).catch((err) =>
          setOrgActionError(err instanceof Error ? err.message : 'Budget delete failed')
        );
        return;
      }
      const nextBudgets = personalBudgets.filter((b) => b.id !== id);
      setPersonalBudgets(nextBudgets);
      savePersonalState({ budgets: nextBudgets });
    },
    [isOrgWorkspace, activeOrganization, canOrgManage, getOrgActor, personalBudgets, savePersonalState]
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
      const nextDebts = [newDebt, ...personalDebts];
      setPersonalDebts(nextDebts);
      savePersonalState({ debts: nextDebts });
      return newDebt;
    },
    [personalDebts, savePersonalState]
  );

  const updateDebt = useCallback(
    (id: string, updates: Partial<Debt>) => {
      const nextDebts = personalDebts.map((d) => (d.id === id ? { ...d, ...updates } : d));
      setPersonalDebts(nextDebts);
      savePersonalState({ debts: nextDebts });
    },
    [personalDebts, savePersonalState]
  );

  const recordDebtPayment = useCallback(
    (
      debtId: string,
      payment: { amount: number; date: string; walletId?: string; notes?: string },
      logAsTx: boolean
    ) => {
      const target = personalDebts.find((d) => d.id === debtId);
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

      const nextDebts = personalDebts.map((d) => (d.id === debtId ? updatedDebt : d));
      setPersonalDebts(nextDebts);
      savePersonalState({ debts: nextDebts });

      if (logAsTx && payment.walletId) {
        const isIncome = target.type === 'owed_to_me';
        const fallbackCatId =
          personalCategories.find((c) => (isIncome ? c.type === 'income' : c.type === 'expense'))
            ?.id || 'cat-other';

        addTransaction({
          type: isIncome ? 'income' : 'expense',
          amount: payment.amount,
          currency: target.currency,
          date: payment.date,
          time: '12:00',
          categoryId: personalCategories.some(
            (c) => c.id === (isIncome ? 'cat-withdraw' : 'cat-bills')
          )
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
    [personalDebts, savePersonalState, personalCategories, addTransaction]
  );

  const deleteDebt = useCallback(
    (id: string) => {
      const nextDebts = personalDebts.filter((d) => d.id !== id);
      setPersonalDebts(nextDebts);
      savePersonalState({ debts: nextDebts });
    },
    [personalDebts, savePersonalState]
  );

  const addGoal = useCallback(
    (data: Omit<SavingsGoal, 'id' | 'createdAt' | 'isCompleted'>) => {
      const newGoal: SavingsGoal = {
        ...data,
        id: `goal-${Date.now()}`,
        isCompleted: data.currentAmount >= data.targetAmount,
        createdAt: Date.now(),
      };
      const nextGoals = [newGoal, ...personalGoals];
      setPersonalGoals(nextGoals);
      savePersonalState({ goals: nextGoals });
      return newGoal;
    },
    [personalGoals, savePersonalState]
  );

  const updateGoal = useCallback(
    (id: string, updates: Partial<SavingsGoal>) => {
      const nextGoals = personalGoals.map((g) => (g.id === id ? { ...g, ...updates } : g));
      setPersonalGoals(nextGoals);
      savePersonalState({ goals: nextGoals });
    },
    [personalGoals, savePersonalState]
  );

  const contributeToGoal = useCallback(
    (goalId: string, amount: number, walletId?: string, isWithdrawal = false) => {
      const target = personalGoals.find((g) => g.id === goalId);
      if (!target) return;

      const newSaved = isWithdrawal
        ? Math.max(0, target.currentAmount - amount)
        : target.currentAmount + amount;

      const updatedGoal: SavingsGoal = {
        ...target,
        currentAmount: newSaved,
        isCompleted: newSaved >= target.targetAmount,
      };

      const nextGoals = personalGoals.map((g) => (g.id === goalId ? updatedGoal : g));
      let nextWallets = personalWallets;
      if (walletId) {
        const targetWallet = personalWallets.find((w) => w.id === walletId);
        if (targetWallet) {
          const balanceChange = isWithdrawal ? amount : -amount;
          nextWallets = personalWallets.map((w) =>
            w.id === walletId
              ? { ...w, balance: roundCurrency(w.balance + balanceChange, w.currency) }
              : w
          );
        }
      }

      setPersonalGoals(nextGoals);
      setPersonalWallets(nextWallets);
      savePersonalState({ goals: nextGoals, wallets: nextWallets });
    },
    [personalGoals, personalWallets, savePersonalState]
  );

  const deleteGoal = useCallback(
    (id: string) => {
      const nextGoals = personalGoals.filter((g) => g.id !== id);
      setPersonalGoals(nextGoals);
      savePersonalState({ goals: nextGoals });
    },
    [personalGoals, savePersonalState]
  );

  const addTemplate = useCallback(
    (data: Omit<Template, 'id'>) => {
      const newTemplate: Template = { ...data, id: `tmpl-${Date.now()}` };
      const nextTemplates = [...personalTemplates, newTemplate];
      setPersonalTemplates(nextTemplates);
      savePersonalState({ templates: nextTemplates });
      return newTemplate;
    },
    [personalTemplates, savePersonalState]
  );

  const updateTemplate = useCallback(
    (id: string, updates: Partial<Template>) => {
      const nextTemplates = personalTemplates.map((t) => (t.id === id ? { ...t, ...updates } : t));
      setPersonalTemplates(nextTemplates);
      savePersonalState({ templates: nextTemplates });
    },
    [personalTemplates, savePersonalState]
  );

  const deleteTemplate = useCallback(
    (id: string) => {
      const nextTemplates = personalTemplates.filter((t) => t.id !== id);
      setPersonalTemplates(nextTemplates);
      savePersonalState({ templates: nextTemplates });
    },
    [personalTemplates, savePersonalState]
  );

  const applyTemplate = useCallback(
    (templateId: string) => {
      const tmpl = personalTemplates.find((t) => t.id === templateId);
      if (!tmpl) return;

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const todayStr = formatLocalDate(now);
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

      let convertedAmount: number | undefined = undefined;
      if (tmpl.type === 'transfer' && tmpl.toWalletId) {
        const fromW = personalWallets.find((w) => w.id === tmpl.walletId);
        const toW = personalWallets.find((w) => w.id === tmpl.toWalletId);
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
    [personalTemplates, personalWallets, settings.customExchangeRates, addTransaction]
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
            categoryId:
              personalCategories.find((c) => c.type === 'expense' || c.type === 'both')?.id ||
              'cat-other',
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
            categoryId:
              personalCategories.find((c) => c.type === 'income' || c.type === 'both')?.id ||
              'cat-other',
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
      saveActiveWorkspacePref('personal');

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
    saveActiveWorkspacePref('personal');

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
    setActiveWorkspace('personal');
    saveActiveWorkspacePref('personal');
    setSettings(DEFAULT_SETTINGS);
    setHasCompletedOnboarding(false);

    void persistData(freshData);
  }, []);

  const isRTL = settings.language === 'ar';

  const entitlementValue: EntitlementContextValue = useMemo(
    () => ({
      isPro,
      isBusinessPro,
      planTier,
      proEntitlement: verifiedPro,
      scanQuota,
      setScanQuota,
      refreshScanQuota,
      isUpgradeModalOpen,
      setIsUpgradeModalOpen,
      redeemProCode,
      startBusinessTrial,
      devActivateProPreview,
      restorePurchases,
    }),
    [
      isPro,
      isBusinessPro,
      planTier,
      verifiedPro,
      scanQuota,
      refreshScanQuota,
      isUpgradeModalOpen,
      redeemProCode,
      startBusinessTrial,
      devActivateProPreview,
      restorePurchases,
    ]
  );

  const orgValue: OrgContextValue = useMemo(
    () => ({
      activeWorkspace,
      orgRefs,
      isOrgWorkspace,
      isOrgLoading,
      orgSyncPendingWrites,
      orgActionError,
      clearOrgActionError,
      orgTrashTransactions,
      orgHasMoreTx,
      loadMoreOrgTransactions,
      organizationsList,
      activeOrganization,
      activeOrgSubscriptionState,
      isOrgReadOnly,
      activeOrgMemberStatus,
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
      pendingJoinCode,
      clearPendingJoinCode,
      updateOrganizationSettings,
      lockAccountingPeriod,
      legacyLocalOrgs,
      isOrgMigrationModalOpen,
      openOrgMigrationModal,
      dismissLegacyOrgMigration,
      completeLegacyOrgMigration,
      queueLegacyOrgsForMigration,
      approveOrgTransaction,
      rejectOrgTransaction,
      markOrgTransactionPaid,
      restoreOrgTransaction,
      recalculateOrgBalances,
      attachOrgReceiptPaths,
      addCostCenter,
      updateCostCenter,
      deleteCostCenter,
      addBusinessParty,
      updateBusinessParty,
      deleteBusinessParty,
      createOrgInvite,
      listOrgInvites,
      revokeOrgInvite,
      manageOrgMember,
      transferOrgOwnership,
      deleteOrganization,
      isOrgHubOpen,
      setIsOrgHubOpen,
      orgHubTab,
      setOrgHubTab,
      openOrgHub,
    }),
    [
      activeWorkspace,
      orgRefs,
      isOrgWorkspace,
      isOrgLoading,
      orgSyncPendingWrites,
      orgActionError,
      clearOrgActionError,
      orgTrashTransactions,
      orgHasMoreTx,
      loadMoreOrgTransactions,
      organizationsList,
      activeOrganization,
      activeOrgSubscriptionState,
      isOrgReadOnly,
      activeOrgMemberStatus,
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
      pendingJoinCode,
      clearPendingJoinCode,
      updateOrganizationSettings,
      lockAccountingPeriod,
      legacyLocalOrgs,
      isOrgMigrationModalOpen,
      openOrgMigrationModal,
      dismissLegacyOrgMigration,
      completeLegacyOrgMigration,
      queueLegacyOrgsForMigration,
      approveOrgTransaction,
      rejectOrgTransaction,
      markOrgTransactionPaid,
      restoreOrgTransaction,
      recalculateOrgBalances,
      attachOrgReceiptPaths,
      addCostCenter,
      updateCostCenter,
      deleteCostCenter,
      addBusinessParty,
      updateBusinessParty,
      deleteBusinessParty,
      createOrgInvite,
      listOrgInvites,
      revokeOrgInvite,
      manageOrgMember,
      transferOrgOwnership,
      deleteOrganization,
      isOrgHubOpen,
      orgHubTab,
      openOrgHub,
    ]
  );

  return (
    <EntitlementProvider value={entitlementValue}>
      <OrgProvider value={orgValue}>
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
        orgRefs,
        isOrgWorkspace,
        isOrgLoading,
        orgSyncPendingWrites,
        orgActionError,
        clearOrgActionError,
        orgTrashTransactions,
        orgHasMoreTx,
        loadMoreOrgTransactions,
        organizationsList,
        activeOrganization,
        activeOrgSubscriptionState,
        isOrgReadOnly,
        activeOrgMemberStatus,
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
        pendingJoinCode,
        clearPendingJoinCode,
        updateOrganizationSettings,
        lockAccountingPeriod,

        legacyLocalOrgs,
        isOrgMigrationModalOpen,
        openOrgMigrationModal,
        dismissLegacyOrgMigration,
        completeLegacyOrgMigration,
        queueLegacyOrgsForMigration,

        approveOrgTransaction,
        rejectOrgTransaction,
        markOrgTransactionPaid,
        restoreOrgTransaction,
        recalculateOrgBalances,
        attachOrgReceiptPaths,
        addCostCenter,
        updateCostCenter,
        deleteCostCenter,
        addBusinessParty,
        updateBusinessParty,
        deleteBusinessParty,

        createOrgInvite,
        listOrgInvites,
        revokeOrgInvite,
        manageOrgMember,
        transferOrgOwnership,
        deleteOrganization,

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
        reauthenticateGoogleAccount,
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
      </OrgProvider>
    </EntitlementProvider>
  );
};

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

export { useEntitlement, useOrg };
