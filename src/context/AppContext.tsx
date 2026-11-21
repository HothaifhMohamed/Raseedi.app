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
  BillingCycle,
  ProPlanCode,
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
  persistDataDebounced,
  generateDemoSeedData,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  DEFAULT_WALLETS,
  createCleanDefaultWallet,
  mergeSettingsWithDefaults,
  AppDatabaseData,
  saveVerifiedProCache,
  loadVerifiedProCache,
  clearLocalAppStorageAndDb,
  loadGuestModePref,
  saveGuestModePref,
  loadUnsyncedDirtyFlag,
  saveUnsyncedDirtyFlag,
  savePreRestoreSnapshot,
  loadPreRestoreSnapshot,
  loadOrgWorkspaces,
  saveOrgWorkspaces,
  deleteLocalOrgWorkspaceStorage,
  loadActiveWorkspacePref,
  saveActiveWorkspacePref,
} from '../services/db';
import { translations } from '../services/i18n';
import {
  initPWAInstallCapture,
  getPWAInstallSnapshot,
  subscribePWAInstall,
  triggerPWAInstall,
  PWAInstallSnapshot,
} from '../services/pwaInstallStore';
import {
  applyWalletUpdates,
  calculateNextDueDate,
  doesTransactionAffectAccounting,
  formatLocalDate,
  generateNextVoucherNumber,
  getTransactionWalletDeltas,
  isDateInLockedPeriod,
  parseLocalDate,
} from '../services/calculations';
import { TransactionDraftPreset } from '../services/walletQuickActions';
import {
  buildUpdatedTransaction,
  computeTransactionUpdate,
} from '../services/transactionUpdate';
import {
  convertCurrency,
  fetchLiveExchangeRatesDetailed,
  getCachedExchangeRatesMeta,
  getLiveExchangeRatesRuntime,
  roundCurrency,
  saveLiveExchangeRatesCache,
  setLiveExchangeRatesRuntime,
  toMinor,
} from '../services/currency';
import {
  canRoleApproveOrg,
  canRoleEditOrg,
  canRoleManageOrg,
  computeOrgSeatLimit,
  computeOrgSubscriptionState,
  DAY_MS,
  normalizeApprovalStatus,
  OrgSubscriptionState,
} from '../services/entitlements';
import {
  appendLocalOrgAuditLog,
  applyOrgTxBalanceToWallets,
  buildLocalOrgWorkspace,
  formatUnmigratedOrgExtrasNotice,
  getUnmigratedOrgExtrasSummary,
  isRetainedExtrasOnlyWorkspace,
  recalculateLocalOrgWallets,
  retainUnmigratedLocalOrgExtras,
  UnmigratedOrgExtrasSummary,
} from '../services/localOrgHelpers';
import { verifyAndUpgradePin } from '../services/security';
import { isPrimarySystemAdminEmail } from '../services/licenseCodes';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogle,
  reauthenticateWithGoogle,
  signOutGoogle,
  ensureUserProfile,
  checkUsernameAvailabilityCloud,
  claimUserUsernameCloud,
  markUserOnboardingCompletedCloud,
  fetchUserProfile,
  subscribeUserProfile,
  fetchCloudBackupMeta,
  saveCloudBackup,
  fetchCloudBackup,
  fetchCloudBackupHistory,
  fetchCloudBackupFromHistory,
  fetchLatestCloudBackupFromHistory,
  bootstrapAdminStatusOnServer,
  resolveFirebaseUserEmail,
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
  flushPendingOrgUploads,
  syncOrganizationMetaToCloud,
  syncUserCurrencyRatesToCloud,
  upsertWorkspaceTransactionCloud,
  batchUpsertWorkspaceTransactionsCloud,
  deleteWorkspaceTransactionCloud,
  batchDeleteWorkspaceTransactionsCloud,
  fetchWorkspaceTransactionsCloud,
  subscribeWorkspaceTransactions,
  syncWorkspaceTransactionsWithZeroGuard,
  removeOrgWorkspaceFromBackupMeta,
  isOfflineFirestoreError,
  isEntitlementActive,
  resolvePlanTierFromProfile,
  CloudBackupPayload,
  ScanQuotaInfo,
} from '../services/firebase';
import { isFirestoreMissingIndexError } from '../services/orgTransactionQuery';
import {
  formatFirestoreErrorForDisplay,
  mergeCloudAndLocalState,
  shouldRestoreCloudOnStartup,
} from '../services/safeRecovery';
import {
  formatUserFriendlyAuthError,
  shouldSurfaceCloudDiagnosticsError,
} from '../services/userProfileSync';
import { shouldIgnoreAuthStateChangeDuringInteractiveSignIn } from '../services/googleAuthFlow';
import {
  applyThemeToDocument,
  canPerformAutomaticCloudWrite,
  isActiveWorkspaceTransaction,
  normalizeThemePreference,
  normalizeWorkspaceId,
  readStoredThemePreference,
  reconcileThemeSettings,
  reconcileWorkspaceTransactions,
  resolveWorkspaceSyncPriority,
  tagTransactionsWithWorkspace,
  tagWalletsWithWorkspace,
  writeStoredThemePreference,
} from '../services/workspaceSync';
import {
  resolveFallbackWorkspaceAfterDelete,
  resolveWorkspaceOrgPermissions,
} from '../services/workspaceCleanup';
import type { BackupHistorySummary } from '../services/backupHistory';
import {
  UserSubscriptionSummary,
  computeUserSubscriptionSummary,
  resolvePostGoogleSignInAction,
} from '../services/subscriptionHelpers';
import { extractAccountDeleteErrorCode, shouldFallbackAccountDeleteError } from '../services/accountDeletion';
import {
  canUserAccessAdminPanelUi,
  isAuthorizedPrimaryAdminUser,
} from '../services/adminAuth';
import { EntitlementProvider, EntitlementContextValue, useEntitlement } from './EntitlementContext';
import { OrgProvider, OrgContextValue, useOrg } from './OrgContext';
import {
  subscribeUserOrgRefs,
  subscribeActiveOrganization,
  forceFetchOrgTransactionsFromServer,
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
  createCloudOrganizationDirect,
  deleteOrganizationWorkspaceCloud,
  lookupUserForOrgDirectAdd,
  addOrgMemberDirectlyCloud,
  manageOrgMemberDirectlyCloud,
  DirectOrgUserLookupResult,
  OrgActorInfo,
} from '../services/orgCloud';
import { yieldToMainThread } from '../services/importProgress';
import {
  buildAppNotifications,
  dispatchBrowserNotification,
} from '../services/notifications';
import {
  AppNavView,
  HomeSubTab,
  RaseediHistoryState,
  RouteState,
  areRoutesEqual,
  buildUrlWithHash,
  normalizeRouteState,
  parseHashRoute,
  resolveInitialRoute,
  safeReadSessionNav,
  safeWriteSessionNav,
} from '../services/navigation';
import {
  assignSequentialWalletOrder,
  getNextWalletOrder,
  sortWalletsByOrder,
} from '../services/walletOrder';

export interface BackgroundImportSyncState {
  status: 'idle' | 'syncing' | 'synced' | 'error';
  workspaceId: string | null;
  processed: number;
  total: number;
  percent: number;
  error: string | null;
}

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

export interface ToastMessage {
  id: string;
  text: string;
  type?: 'info' | 'warning' | 'error' | 'success';
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
  isGuestMode: boolean;
  enterGuestMode: () => void;

  // Dual Workspace & Cloud Enterprise State
  activeWorkspace: string; // 'personal' | orgId
  orgRefs: OrgRef[];
  localOrgWorkspaces: Record<string, OrgWorkspaceData>;
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
  upgradeLocalOrgToCloud: (
    orgId: string,
    onProgress?: (completed: number, total: number) => void
  ) => Promise<{
    ok: boolean;
    orgId?: string;
    error?: string;
    retainedExtrasNotice?: string;
  }>;
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
  orgMigrationSuccessMessage: string | null;
  clearOrgMigrationSuccessMessage: () => void;
  setOrgMigrationSuccessMessage: (msg: string | null) => void;
  openOrgMigrationModal: () => void;
  dismissLegacyOrgMigration: () => void;
  completeLegacyOrgMigration: (
    migratedOrgIds: string[],
    options?: {
      keepLocalWorkspaces?: boolean;
      migratedToCloudIds?: Record<string, string>;
    }
  ) => Promise<{
    retainedOrgs: Array<{
      orgId: string;
      orgName: string;
      summary: UnmigratedOrgExtrasSummary;
    }>;
  }>;
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

  // Team, Direct Member Add & Ownership
  createOrgInvite: (
    role: Exclude<OrganizationRole, 'owner'>,
    expiresInDays?: number,
    maxUses?: number
  ) => Promise<{ invite: OrganizationInvite; code: string }>;
  listOrgInvites: () => Promise<OrganizationInvite[]>;
  revokeOrgInvite: (inviteId: string) => Promise<void>;
  searchUserForOrg: (identifier: string) => Promise<DirectOrgUserLookupResult | null>;
  addOrgMemberDirectly: (params: {
    identifier: string;
    targetUser?: DirectOrgUserLookupResult | null;
    role: Exclude<OrganizationRole, 'owner'>;
    department?: string;
    spendingLimit?: number;
  }) => Promise<OrganizationMember>;
  manageOrgMember: (params: {
    targetUid: string;
    action: 'change_role' | 'suspend' | 'reactivate' | 'remove' | 'set_spending_limit';
    role?: Exclude<OrganizationRole, 'owner'>;
    spendingLimit?: number | null;
    department?: string;
  }) => Promise<void>;
  transferOrgOwnership: (newOwnerUid: string) => Promise<void>;
  deleteOrganization: (confirmName: string, targetOrgId?: string) => Promise<void>;

  // Unified Enterprise Hub Modal
  isOrgHubOpen: boolean;
  setIsOrgHubOpen: (open: boolean) => void;
  orgHubTab: OrgHubTab;
  setOrgHubTab: (tab: OrgHubTab) => void;
  openOrgHub: (tab?: OrgHubTab) => void;
  isWorkspaceModalOpen: boolean;
  setIsWorkspaceModalOpen: (open: boolean) => void;

  // Active View / Modals
  activeNav: AppNavView;
  setActiveNav: (nav: AppNavView) => void;
  activeWalletId: string | null;
  setActiveWalletId: (id: string | null) => void;
  homeTab: HomeSubTab;
  setHomeTab: (tab: HomeSubTab) => void;
  navigateBackFromWallet: () => void;
  registerModalBackHandler: (modalId: string, onClose: () => void) => void;
  unregisterModalBackHandler: (modalId: string) => void;
  isAddModalOpen: boolean;
  setIsAddModalOpen: (open: boolean) => void;
  editingTransaction: Transaction | null;
  setEditingTransaction: (t: Transaction | null) => void;
  transactionDraft: TransactionDraftPreset | null;
  openTransactionWithPreset: (preset?: TransactionDraftPreset) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  openAdminPanelRequested: boolean;
  openAdminSettingsPanel: () => void;
  isAdminUser: boolean;
  refreshAdminStatus: () => Promise<boolean>;
  isAdminCodeModalOpen: boolean;
  setIsAdminCodeModalOpen: (open: boolean) => void;
  openAdminPanel: () => void;
  isLogoutModalOpen: boolean;
  setIsLogoutModalOpen: (open: boolean) => void;
  hasUnsyncedLocalChanges: boolean;
  signOutAndResetDevice: (options?: { backupFirst?: boolean }) => Promise<{ ok: boolean; error?: string }>;
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
  subscriptionSummary: UserSubscriptionSummary;
  startBusinessTrial: (orgId?: string) => Promise<{ ok: boolean; error?: string }>;
  devActivateProPreview: (tier?: 'personal_pro' | 'business_pro') => void;
  restorePurchases: () => Promise<boolean>;
  scanQuota: ScanQuotaInfo | null;
  setScanQuota: React.Dispatch<React.SetStateAction<ScanQuotaInfo | null>>;
  refreshScanQuota: () => Promise<void>;
  isCloudSyncing: boolean;
  cloudSyncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  cloudSyncError: string | null;
  cloudDiagnosticsError: string | null;
  clearCloudDiagnosticsError: () => void;
  cloudSkippedAttachmentsWarning: number;
  cloudConflict: { cloudUpdatedAtMs: number } | null;
  lastCloudBackupExists: boolean;
  isCloudLoaded: boolean;
  cloudBackupHistory: BackupHistorySummary[];
  refreshCloudBackupHistory: () => Promise<void>;
  restoreFromBackupHistoryEntry: (backupId: string) => Promise<boolean>;
  signInWithGoogleAccount: () => Promise<{ restored: boolean; isProRestored: boolean } | null>;
  signOutGoogleAccount: () => Promise<void>;
  checkUsernameAvailable: (rawUsername: string) => Promise<{
    available: boolean;
    normalized: string;
    errorAr?: string;
    errorEn?: string;
  }>;
  updateUsername: (rawUsername: string) => Promise<{
    ok: boolean;
    username?: string;
    error?: string;
  }>;
  syncToCloudNow: (forceOverwrite?: boolean) => Promise<boolean>;
  restoreFromCloudNow: () => Promise<boolean>;
  emergencyCloudRecovery: () => Promise<{
    ok: boolean;
    recoveredPersonalCount: number;
    recoveredOrgCount: number;
    errorMessage?: string;
  }>;
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
  refreshExchangeRates: (force?: boolean) => Promise<boolean>;

  // Undo & Toast Notification
  undoAction: UndoAction | null;
  setUndoAction: (action: UndoAction | null) => void;
  triggerUndo: () => void;
  toastMessage: ToastMessage | null;
  showToast: (text: string, type?: ToastMessage['type']) => void;
  clearToast: () => void;

  // CRUD Operations
  addTransaction: (data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Transaction;
  importTransactionsBatch: (
    items: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[],
    options?: { newWallets?: Wallet[]; newCategories?: Category[]; skipCloudSync?: boolean }
  ) => Promise<number>;
  importSpreadsheetBatchLocally: (
    items: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[],
    options?: {
      newWallets?: Wallet[];
      newCategories?: Category[];
      workspaceId?: string;
      onProgress?: (processed: number, total: number) => void;
    }
  ) => Promise<{ importedCount: number; createdTransactions: Transaction[]; workspaceId: string }>;
  syncWorkspaceBackupNow: (
    workspaceId?: string,
    extraTransactions?: Transaction[],
    options?: {
      onProgress?: (processed: number, total: number) => void;
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  backgroundImportSync: BackgroundImportSyncState;
  startBackgroundImportCloudSync: (
    workspaceId: string,
    createdTransactions: Transaction[]
  ) => void;
  retryBackgroundImportCloudSync: () => void;
  dismissBackgroundImportCloudSync: () => void;
  updateTransaction: (id: string, data: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  deleteSelectedTransactions: () => void;
  moveSelectedTransactions: (toWalletId: string) => void;
  duplicateTransaction: (id: string) => void;

  addWallet: (data: Omit<Wallet, 'id'>) => Wallet;
  updateWallet: (id: string, data: Partial<Wallet>) => void;
  reorderWallets: (orderedWallets: Wallet[]) => void;
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

  // PWA Direct Install
  canInstallPWA: boolean;
  isPWAInstalled: boolean;
  isIOSDevice: boolean;
  promptPWAInstall: () => Promise<boolean>;

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
  const [settings, setSettings] = useState<AppSettings>(() => {
    const storedTheme = readStoredThemePreference();
    if (!storedTheme) return DEFAULT_SETTINGS;
    return {
      ...DEFAULT_SETTINGS,
      theme: storedTheme.theme,
      ...(storedTheme.updatedAt > 0 ? { themeUpdatedAt: storedTheme.updatedAt } : {}),
    };
  });
  const [user, setUser] = useState<UserAccount | null>(null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [isGuestMode, setIsGuestMode] = useState<boolean>(() => loadGuestModePref());
  const isGuestModeRef = React.useRef<boolean>(isGuestMode);
  isGuestModeRef.current = isGuestMode;
  const [hasUnsyncedLocalChanges, setHasUnsyncedLocalChanges] = useState<boolean>(() =>
    loadUnsyncedDirtyFlag()
  );

  // Global PWA Install State
  const [pwaInstallState, setPwaInstallState] = useState<PWAInstallSnapshot>(() =>
    getPWAInstallSnapshot()
  );
  useEffect(() => {
    initPWAInstallCapture();
    setPwaInstallState(getPWAInstallSnapshot());
    return subscribePWAInstall(() => {
      setPwaInstallState(getPWAInstallSnapshot());
    });
  }, []);
  const promptPWAInstall = useCallback(async () => {
    const outcome = await triggerPWAInstall();
    return outcome === 'accepted';
  }, []);

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

  // Local-first Organization Workspaces + Legacy Migration State
  const [localOrgWorkspaces, setLocalOrgWorkspaces] = useState<Record<string, OrgWorkspaceData>>({});
  const latestLocalOrgWorkspacesRef = React.useRef<Record<string, OrgWorkspaceData>>({});
  const activeWorkspaceRef = React.useRef<string>('personal');
  activeWorkspaceRef.current = activeWorkspace;
  const [legacyLocalOrgs, setLegacyLocalOrgs] = useState<OrgWorkspaceData[]>([]);
  const [isOrgMigrationModalOpen, setIsOrgMigrationModalOpen] = useState(false);
  const [orgMigrationSuccessMessage, setOrgMigrationSuccessMessage] = useState<string | null>(null);
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
  const [cloudDiagnosticsError, setCloudDiagnosticsError] = useState<string | null>(null);
  const clearCloudDiagnosticsError = useCallback(() => setCloudDiagnosticsError(null), []);
  const [cloudSkippedAttachmentsWarning, setCloudSkippedAttachmentsWarning] = useState(0);
  const [cloudConflict, setCloudConflict] = useState<{ cloudUpdatedAtMs: number } | null>(null);
  const [lastCloudBackupExists, setLastCloudBackupExists] = useState(false);
  const [isCloudLoaded, setIsCloudLoaded] = useState(false);
  const [cloudBackupHistory, setCloudBackupHistory] = useState<BackupHistorySummary[]>([]);
  const [backgroundImportSync, setBackgroundImportSync] = useState<BackgroundImportSyncState>({
    status: 'idle',
    workspaceId: null,
    processed: 0,
    total: 0,
    percent: 0,
    error: null,
  });
  const pendingBackgroundImportRef = React.useRef<{
    workspaceId: string;
    createdTransactions: Transaction[];
  } | null>(null);
  const backgroundImportDismissTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preRestoreSnapshotDate, setPreRestoreSnapshotDate] = useState<number | null>(null);
  const skipNextAutoSyncRef = React.useRef(false);
  const hasCompletedInitialCloudSyncRef = React.useRef(false);
  const isCloudLoadedRef = React.useRef(false);
  const workspaceSyncEpochRef = React.useRef(0);
  const syncRequestIdRef = React.useRef<number>(0);
  const activeInteractiveGoogleSignInRef = React.useRef<boolean>(false);
  const inFlightGoogleSignInPromiseRef = React.useRef<
    Promise<{ restored: boolean; isProRestored: boolean } | null> | null
  >(null);
  const pendingLocalTxIdsRef = React.useRef<Set<string>>(new Set());
  const locallyDeletedTxIdsRef = React.useRef<Set<string>>(new Set());
  const isEmergencyRecoveryActiveRef = React.useRef(false);
  const unifiedBackfilledKeysRef = React.useRef<Set<string>>(new Set());

  // Verified server PRO entitlement
  const [verifiedPro, setVerifiedPro] = useState<VerifiedProEntitlement | null>(null);
  const latestVerifiedProRef = React.useRef<VerifiedProEntitlement | null>(null);
  latestVerifiedProRef.current = verifiedPro;
  const [devProTierPreview, setDevProTierPreview] = useState<null | 'personal_pro' | 'business_pro'>(null);
  const [scanQuota, setScanQuota] = useState<ScanQuotaInfo | null>(null);

  // Live Exchange Rates status
  const [ratesLastUpdated, setRatesLastUpdated] = useState<string | null>(null);
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);

  // Nav & Tabs & Modals (initialized from URL hash / sessionStorage so refreshes preserve view)
  const initialRouteRef = React.useRef<RouteState | null>(null);
  if (initialRouteRef.current === null) {
    initialRouteRef.current =
      typeof window !== 'undefined'
        ? resolveInitialRoute(window.location.hash, safeReadSessionNav())
        : { activeNav: 'home', homeTab: 'transactions', activeWalletId: null };
  }
  const [activeNav, setActiveNavState] = useState<AppNavView>(initialRouteRef.current.activeNav);
  const [activeWalletId, setActiveWalletIdState] = useState<string | null>(
    initialRouteRef.current.activeWalletId
  );
  const [homeTab, setHomeTabState] = useState<HomeSubTab>(initialRouteRef.current.homeTab);

  // History API coordination refs
  const currentSyncedRouteRef = React.useRef<RouteState>(initialRouteRef.current);
  const historyTrailRef = React.useRef<RouteState[]>([initialRouteRef.current]);
  const historyDepthRef = React.useRef<number>(0);
  const hasMountedHistoryRef = React.useRef<boolean>(false);
  const isApplyingPopStateRef = React.useRef<boolean>(false);
  const pendingBackSkipsRef = React.useRef<number>(0);
  const pendingHistoryActionsRef = React.useRef<Array<() => void>>([]);
  const modalBackStackRef = React.useRef<Array<{ id: string; onClose: () => void }>>([]);
  const poppedByBrowserRef = React.useRef<Set<string>>(new Set());

  const setActiveNav = useCallback((nav: AppNavView) => {
    setActiveNavState(nav);
    if (nav !== 'wallets') {
      setActiveWalletIdState(null);
    }
  }, []);

  const setActiveWalletId = useCallback((id: string | null) => {
    if (id) {
      setActiveNavState('wallets');
    }
    setActiveWalletIdState(id);
  }, []);

  const setHomeTab = useCallback((tab: HomeSubTab) => {
    setHomeTabState(tab);
  }, []);

  const flushOrRunHistoryAction = useCallback((action: () => void) => {
    if (pendingBackSkipsRef.current > 0) {
      pendingHistoryActionsRef.current.push(action);
      return;
    }
    action();
  }, []);

  const registerModalBackHandler = useCallback(
    (modalId: string, onClose: () => void) => {
      if (typeof window === 'undefined') return;
      const existingIdx = modalBackStackRef.current.findIndex((m) => m.id === modalId);
      if (existingIdx >= 0) {
        modalBackStackRef.current[existingIdx] = { id: modalId, onClose };
        return;
      }
      modalBackStackRef.current.push({ id: modalId, onClose });
      flushOrRunHistoryAction(() => {
        if (!modalBackStackRef.current.some((m) => m.id === modalId)) return;
        const currentState = window.history.state as RaseediHistoryState | null;
        if (currentState?.raseediModalId === modalId) return;
        const nextDepth = historyDepthRef.current + 1;
        historyDepthRef.current = nextDepth;
        const currentRoute = currentSyncedRouteRef.current;
        const nextUrl = buildUrlWithHash(window.location.pathname, window.location.search, currentRoute);
        window.history.pushState(
          {
            raseediNav: currentRoute,
            raseediDepth: nextDepth,
            raseediModalId: modalId,
          } satisfies RaseediHistoryState,
          '',
          nextUrl
        );
      });
    },
    [flushOrRunHistoryAction]
  );

  const unregisterModalBackHandler = useCallback((modalId: string) => {
    const idx = modalBackStackRef.current.findIndex((m) => m.id === modalId);
    if (idx >= 0) {
      modalBackStackRef.current.splice(idx, 1);
    }
    if (poppedByBrowserRef.current.has(modalId)) {
      poppedByBrowserRef.current.delete(modalId);
      return;
    }
    if (typeof window === 'undefined') return;
    const currentState = window.history.state as RaseediHistoryState | null;
    if (currentState?.raseediModalId === modalId) {
      pendingBackSkipsRef.current += 1;
      window.history.back();
    }
  }, []);

  const navigateBackFromWallet = useCallback(() => {
    if (typeof window !== 'undefined' && historyDepthRef.current > 0) {
      const prevRoute = historyTrailRef.current[historyDepthRef.current - 1];
      if (prevRoute && prevRoute.activeNav === 'wallets' && prevRoute.activeWalletId === null) {
        window.history.back();
        return;
      }
    }
    setActiveWalletIdState(null);
  }, []);

  const [isAddModalOpen, setIsAddModalOpenState] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [transactionDraft, setTransactionDraft] = useState<TransactionDraftPreset | null>(null);
  const handleSetIsAddModalOpen = useCallback((open: boolean) => {
    setIsAddModalOpenState(open);
    if (!open) {
      setTransactionDraft(null);
    }
  }, []);
  const openTransactionWithPreset = useCallback((preset?: TransactionDraftPreset) => {
    setEditingTransaction(null);
    setTransactionDraft(preset ?? null);
    setIsAddModalOpenState(true);
  }, []);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [openAdminPanelRequested, setOpenAdminPanelRequested] = useState(false);
  const [isAdminCodeModalOpen, setIsAdminCodeModalOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [firebaseAuthUser, setFirebaseAuthUser] = useState<{
    uid?: string;
    email?: string | null;
    emailVerified?: boolean;
  } | null>(() =>
    auth.currentUser
      ? {
          uid: auth.currentUser.uid,
          email: resolveFirebaseUserEmail(auth.currentUser),
          emailVerified: auth.currentUser.emailVerified,
        }
      : null
  );
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isReportsOpen, setIsReportsOpen] = useState(false);
  const [isCategoriesManagerOpen, setIsCategoriesManagerOpen] = useState(false);
  const [isCurrenciesManagerOpen, setIsCurrenciesManagerOpen] = useState(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [isOrgHubOpen, setIsOrgHubOpen] = useState(false);
  const [orgHubTab, setOrgHubTab] = useState<OrgHubTab>('approvals');
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);

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
  const [toastMessage, setToastMessage] = useState<ToastMessage | null>(null);

  const showToast = useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    setToastMessage({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, text, type });
  }, []);

  const clearToast = useCallback(() => {
    setToastMessage(null);
  }, []);

  const lastPersistErrToastRef = React.useRef<number>(0);
  const handleLocalPersistError = useCallback(
    (err: unknown) => {
      console.warn('Local persistence failed:', err);
      const now = Date.now();
      if (now - lastPersistErrToastRef.current < 6000) return;
      lastPersistErrToastRef.current = now;
      const isAr = (latestPersonalRef.current?.settings?.language || 'ar') === 'ar';
      showToast(
        isAr
          ? 'تعذر حفظ البيانات محلياً على هذا الجهاز. تحقق من مساحة التخزين وأعد المحاولة.'
          : 'Failed to save data locally on this device. Check storage space and try again.',
        'error'
      );
    },
    [showToast]
  );

  // Notifications Read State
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());

  const [isAdminUser, setIsAdminUser] = useState(false);

  const isAdminUserRef = React.useRef<boolean>(isAdminUser);
  isAdminUserRef.current = isAdminUser;
  const adminCheckSeqRef = React.useRef<number>(0);

  const refreshAdminStatus = useCallback(
    async (userOverride?: typeof auth.currentUser): Promise<boolean> => {
      const seq = ++adminCheckSeqRef.current;
      const targetUser = userOverride ?? auth.currentUser;
      const resolvedEmail =
        resolveFirebaseUserEmail(targetUser) ||
        (user?.isLoggedIn && typeof user.email === 'string' ? user.email.trim() : '');
      const isPrimaryAdmin = isAuthorizedPrimaryAdminUser({
        uid: targetUser?.uid || (user?.isLoggedIn ? user.id : null),
        email: resolvedEmail,
        isLoggedIn: Boolean(targetUser?.uid || user?.isLoggedIn),
        providerData: targetUser?.providerData,
      });

      if (!isPrimaryAdmin) {
        if (seq === adminCheckSeqRef.current) {
          setIsAdminUser(false);
        }
        return false;
      }

      // Immediately expose admin UI for the primary system admin regardless of
      // Custom Claims, emailVerified hydration timing, workspace, or /api/admin/* availability on Vercel.
      if (seq === adminCheckSeqRef.current) {
        setIsAdminUser(true);
      }

      if (!targetUser) {
        return true;
      }

      try {
        await Promise.all([
          targetUser.getIdTokenResult().catch(() => null),
          bootstrapAdminStatusOnServer(targetUser).catch(() => null),
        ]);
        if (seq !== adminCheckSeqRef.current) return isAdminUserRef.current;
        setIsAdminUser(true);
        return true;
      } catch {
        if (seq === adminCheckSeqRef.current) {
          setIsAdminUser(true);
        }
        return true;
      }
    },
    [user?.isLoggedIn, user?.id, user?.email]
  );

  useEffect(() => {
    const allowed = canUserAccessAdminPanelUi({
      authUser: auth.currentUser
        ? {
            uid: auth.currentUser.uid,
            email: resolveFirebaseUserEmail(auth.currentUser),
            emailVerified: auth.currentUser.emailVerified,
            providerData: auth.currentUser.providerData,
          }
        : firebaseAuthUser,
      appUser: user,
    });
    if (!allowed) {
      setIsAdminUser(false);
      return;
    }
    setIsAdminUser(true);
    if (auth.currentUser) {
      void refreshAdminStatus(auth.currentUser);
    }
  }, [
    firebaseAuthUser,
    firebaseAuthUser?.uid,
    firebaseAuthUser?.email,
    firebaseAuthUser?.emailVerified,
    user?.isLoggedIn,
    user?.id,
    user?.email,
    refreshAdminStatus,
  ]);

  // Unified entitlement summary (recognizes 'business' + 'business_pro' + Admin lifetime override)
  const subscriptionSummary: UserSubscriptionSummary = useMemo(
    () =>
      computeUserSubscriptionSummary({
        verifiedPro,
        isAdminUser,
        devPreviewTier: import.meta.env.DEV ? devProTierPreview : null,
      }),
    [verifiedPro, isAdminUser, devProTierPreview]
  );

  const isPro = subscriptionSummary.isPro;
  const planTier = subscriptionSummary.planTier;
  const isBusinessPro = subscriptionSummary.isBusinessPro;

  const handleSetIsUpgradeModalOpen = useCallback((open: boolean) => {
    if (open && isAdminUserRef.current) {
      setIsUpgradeModalOpen(false);
      setIsAdminCodeModalOpen(true);
      return;
    }
    setIsUpgradeModalOpen(open);
  }, []);

  const handleSetIsSettingsOpen = useCallback((open: boolean) => {
    if (!open) {
      setOpenAdminPanelRequested(false);
    }
    setIsSettingsOpen(open);
  }, []);

  const openAdminPanel = useCallback(() => {
    const allowed = canUserAccessAdminPanelUi({
      isAdminUser: isAdminUserRef.current,
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
    if (!allowed) return;
    if (!isAdminUserRef.current) {
      setIsAdminUser(true);
    }
    setIsUpgradeModalOpen(false);
    setIsAdminCodeModalOpen(true);
  }, [user]);

  const openAdminSettingsPanel = openAdminPanel;

  // Active workspace projection (Cloud Organization OR Local-first Organization)
  const activeOrgRef = useMemo(
    () => (activeWorkspace !== 'personal' ? orgRefs.find((r) => r.orgId === activeWorkspace) || null : null),
    [activeWorkspace, orgRefs]
  );

  const activeLocalOrgWs = useMemo(() => {
    if (activeWorkspace === 'personal') return null;
    const candidate = localOrgWorkspaces[activeWorkspace] || null;
    return candidate && !isRetainedExtrasOnlyWorkspace(candidate) ? candidate : null;
  }, [activeWorkspace, localOrgWorkspaces]);

  const isCloudActiveOrg = Boolean(user?.isLoggedIn && activeOrgRef);
  const isUsingLocalOrgMode = activeWorkspace !== 'personal' && !isCloudActiveOrg && Boolean(activeLocalOrgWs);
  const isOrgWorkspace = activeWorkspace !== 'personal' && (isCloudActiveOrg || Boolean(activeLocalOrgWs));

  const activeOrganization: Organization | null = useMemo(() => {
    if (!isOrgWorkspace) return null;
    if (isCloudActiveOrg) {
      if (activeCloudOrg) return activeCloudOrg;
      if (activeLocalOrgWs?.organization) return activeLocalOrgWs.organization;
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
    }
    return activeLocalOrgWs?.organization || null;
  }, [isOrgWorkspace, isCloudActiveOrg, activeCloudOrg, activeOrgRef, activeLocalOrgWs]);

  const orgTransactions = useMemo(() => {
    if (isUsingLocalOrgMode && activeLocalOrgWs) {
      return (activeLocalOrgWs.transactions || []).filter((t) =>
        isActiveWorkspaceTransaction(t, activeWorkspace)
      );
    }
    if (extraOrgTransactions.length === 0) return activeCloudTransactions;
    const seen = new Set(activeCloudTransactions.map((t) => t.id));
    return [...activeCloudTransactions, ...extraOrgTransactions.filter((t) => !seen.has(t.id))];
  }, [
    isUsingLocalOrgMode,
    activeLocalOrgWs,
    activeWorkspace,
    activeCloudTransactions,
    extraOrgTransactions,
  ]);

  const orgTrashTransactions = useMemo(() => {
    if (isUsingLocalOrgMode && activeLocalOrgWs) {
      return (activeLocalOrgWs.transactions || []).filter((t) => Boolean(t.deletedAt));
    }
    if (extraOrgTrashTransactions.length === 0) return activeCloudTrashTransactions;
    const seen = new Set(activeCloudTrashTransactions.map((t) => t.id));
    return [...activeCloudTrashTransactions, ...extraOrgTrashTransactions.filter((t) => !seen.has(t.id))];
  }, [isUsingLocalOrgMode, activeLocalOrgWs, activeCloudTrashTransactions, extraOrgTrashTransactions]);

  const activeOrgWalletsList = useMemo(
    () => (isUsingLocalOrgMode ? activeLocalOrgWs?.wallets || [] : activeCloudWallets),
    [isUsingLocalOrgMode, activeLocalOrgWs, activeCloudWallets]
  );

  const isolatedPersonalTransactions = useMemo(
    () => personalTransactions.filter((t) => isActiveWorkspaceTransaction(t, 'personal')),
    [personalTransactions]
  );

  const transactions = isOrgWorkspace ? orgTransactions : isolatedPersonalTransactions;
  const wallets = useMemo(
    () => sortWalletsByOrder(isOrgWorkspace ? activeOrgWalletsList : personalWallets),
    [isOrgWorkspace, activeOrgWalletsList, personalWallets]
  );
  const categories = isOrgWorkspace
    ? isUsingLocalOrgMode
      ? activeLocalOrgWs?.categories || []
      : activeCloudCategories
    : personalCategories;
  const budgets = isOrgWorkspace
    ? isUsingLocalOrgMode
      ? activeLocalOrgWs?.budgets || []
      : activeCloudBudgets
    : personalBudgets;
  const debts = isOrgWorkspace ? [] : personalDebts;
  const goals = isOrgWorkspace ? [] : personalGoals;
  const templates = isOrgWorkspace ? [] : personalTemplates;

  const orgMembers = isOrgWorkspace
    ? isUsingLocalOrgMode
      ? activeLocalOrgWs?.members || []
      : activeCloudMembers
    : [];
  const orgCostCenters = isOrgWorkspace
    ? isUsingLocalOrgMode
      ? activeLocalOrgWs?.costCenters || []
      : activeCloudCostCenters
    : [];
  const orgParties = isOrgWorkspace
    ? isUsingLocalOrgMode
      ? activeLocalOrgWs?.parties || []
      : activeCloudParties
    : [];
  const orgAuditLogs = isOrgWorkspace
    ? isUsingLocalOrgMode
      ? activeLocalOrgWs?.auditLogs || []
      : activeCloudAuditLogs
    : [];

  const organizationsList: Organization[] = useMemo(() => {
    const byId = new Map<string, Organization>();
    for (const refItem of orgRefs) {
      if (activeCloudOrg && activeCloudOrg.id === refItem.orgId) {
        byId.set(refItem.orgId, activeCloudOrg);
      } else {
        byId.set(refItem.orgId, {
          id: refItem.orgId,
          name: refItem.orgName,
          currency: refItem.currency || 'EGP',
          vatRate: 14,
          approvalThreshold: 5000,
          ownerUid: refItem.role === 'owner' && user?.id ? user.id : '',
          createdAt: refItem.joinedAt || Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
    for (const ws of Object.values(localOrgWorkspaces)) {
      if (ws?.organization?.id && !isRetainedExtrasOnlyWorkspace(ws) && !byId.has(ws.organization.id)) {
        byId.set(ws.organization.id, ws.organization);
      }
    }
    return Array.from(byId.values());
  }, [orgRefs, activeCloudOrg, localOrgWorkspaces, user?.id]);

  const activeOrgMember = useMemo(() => {
    if (!isOrgWorkspace) return null;
    if (isUsingLocalOrgMode && activeLocalOrgWs) {
      const uid = user?.id || 'local-owner';
      return (
        activeLocalOrgWs.members.find((m) => m.uid === uid) ||
        activeLocalOrgWs.members[0] ||
        null
      );
    }
    if (!user?.id) return null;
    return activeCloudMembers.find((m) => m.uid === user.id) || null;
  }, [isOrgWorkspace, isUsingLocalOrgMode, activeLocalOrgWs, activeCloudMembers, user?.id]);

  const activeOrgRole: OrganizationRole | null = useMemo(() => {
    if (!isOrgWorkspace) return null;
    if (isUsingLocalOrgMode) return activeOrgMember?.role || 'owner';
    if (activeOrgMember) return activeOrgMember.role;
    if (activeOrgRef) return activeOrgRef.role;
    if (activeCloudOrg && user?.id && activeCloudOrg.ownerUid === user.id) return 'owner';
    return 'viewer';
  }, [isOrgWorkspace, isUsingLocalOrgMode, activeOrgMember, activeOrgRef, activeCloudOrg, user?.id]);

  const activeOrgMemberStatus: 'active' | 'suspended' | 'invited' | null = useMemo(() => {
    if (!isOrgWorkspace) return null;
    if (isUsingLocalOrgMode) return activeOrgMember?.status || 'active';
    return activeOrgMember?.status || activeOrgRef?.status || 'active';
  }, [isOrgWorkspace, isUsingLocalOrgMode, activeOrgMember, activeOrgRef]);

  const activeOrgSubscriptionState: OrgSubscriptionState | null = useMemo(() => {
    if (!isOrgWorkspace || !activeOrganization) return null;
    const sourceOrg = isCloudActiveOrg ? activeCloudOrg || activeOrganization : activeOrganization;
    if (isAdminUser) {
      return computeOrgSubscriptionState({
        planTier: 'business_pro',
        billingCycle: 'lifetime',
        expiresAt: null,
        extraSeats: sourceOrg.extraSeats || 0,
        seatLimit: sourceOrg.seatLimit ?? computeOrgSeatLimit(sourceOrg.extraSeats || 0),
      });
    }
    return computeOrgSubscriptionState({
      planTier: sourceOrg.planTier || 'business_pro',
      billingCycle: sourceOrg.billingCycle || 'trial',
      expiresAt: sourceOrg.expiresAt ?? Date.now() + 14 * DAY_MS,
      extraSeats: sourceOrg.extraSeats || 0,
      seatLimit: sourceOrg.seatLimit ?? computeOrgSeatLimit(sourceOrg.extraSeats || 0),
    });
  }, [isOrgWorkspace, isCloudActiveOrg, activeCloudOrg, activeOrganization, isAdminUser]);

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
    (
      updates?: Partial<AppDatabaseData>,
      options?: { skipDirty?: boolean; immediate?: boolean }
    ) => {
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
      latestPersonalRef.current = nextData;
      if (!options?.skipDirty) {
        saveUnsyncedDirtyFlag(true);
        setHasUnsyncedLocalChanges(true);
      }
      if (options?.immediate) {
        void persistData(nextData).catch(handleLocalPersistError);
      } else {
        persistDataDebounced(nextData, handleLocalPersistError);
      }
    },
    [handleLocalPersistError]
  );

  const clearOrgActionError = useCallback(() => setOrgActionError(null), []);
  const clearOrgMigrationSuccessMessage = useCallback(() => setOrgMigrationSuccessMessage(null), []);

  const syncWorkspaceTxWriteImmediately = useCallback(
    (workspaceId: string, tx: Transaction, isNew = false) => {
      const normalizedWs = normalizeWorkspaceId(workspaceId);
      const taggedTx: Transaction = { ...tx, workspaceId: normalizedWs };
      workspaceSyncEpochRef.current += 1;
      locallyDeletedTxIdsRef.current.delete(taggedTx.id);
      pendingLocalTxIdsRef.current.add(taggedTx.id);

      const uid = auth.currentUser?.uid;
      if (!uid) return;
      void upsertWorkspaceTransactionCloud(uid, normalizedWs, taggedTx, { isNew }).catch((err) => {
        console.error('[RealTimeSync] Failed to write transaction:', err);
        setCloudSyncError(
          formatFirestoreErrorForDisplay(
            err,
            latestPersonalRef.current.settings.language === 'ar'
          )
        );
        setCloudDiagnosticsError(
          formatFirestoreErrorForDisplay(
            err,
            latestPersonalRef.current.settings.language === 'ar'
          )
        );
      });
    },
    []
  );

  const syncWorkspaceTxsBatchImmediately = useCallback(
    (workspaceId: string, txs: Transaction[]) => {
      if (txs.length === 0) return;
      const normalizedWs = normalizeWorkspaceId(workspaceId);
      workspaceSyncEpochRef.current += 1;
      const tagged = txs.map((tx) => {
        locallyDeletedTxIdsRef.current.delete(tx.id);
        pendingLocalTxIdsRef.current.add(tx.id);
        return { ...tx, workspaceId: normalizedWs };
      });

      const uid = auth.currentUser?.uid;
      if (!uid) return;
      void batchUpsertWorkspaceTransactionsCloud(uid, normalizedWs, tagged).catch((err) => {
        console.error('[RealTimeSync] Failed batch transaction write:', err);
        setCloudSyncError(
          formatFirestoreErrorForDisplay(
            err,
            latestPersonalRef.current.settings.language === 'ar'
          )
        );
        setCloudDiagnosticsError(
          formatFirestoreErrorForDisplay(
            err,
            latestPersonalRef.current.settings.language === 'ar'
          )
        );
      });
    },
    []
  );

  const syncWorkspaceTxDeleteImmediately = useCallback(
    (workspaceId: string, txIds: string[]) => {
      if (txIds.length === 0) return;
      const normalizedWs = normalizeWorkspaceId(workspaceId);
      workspaceSyncEpochRef.current += 1;
      for (const id of txIds) {
        pendingLocalTxIdsRef.current.delete(id);
        locallyDeletedTxIdsRef.current.add(id);
      }

      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const promise =
        txIds.length === 1
          ? deleteWorkspaceTransactionCloud(uid, normalizedWs, txIds[0])
          : batchDeleteWorkspaceTransactionsCloud(uid, normalizedWs, txIds);
      void promise
        .then(() => {
          for (const id of txIds) {
            locallyDeletedTxIdsRef.current.delete(id);
          }
        })
        .catch((err) => {
          console.error('[RealTimeSync] Failed to delete transaction:', err);
          setCloudDiagnosticsError(
            formatFirestoreErrorForDisplay(
              err,
              latestPersonalRef.current.settings.language === 'ar'
            )
          );
        });
    },
    []
  );

  const mutateLocalOrgWorkspace = useCallback(
    (orgId: string, updater: (ws: OrgWorkspaceData) => OrgWorkspaceData): OrgWorkspaceData | null => {
      const currentMap = latestLocalOrgWorkspacesRef.current;
      const existing = currentMap[orgId];
      if (!existing) return null;
      const updatedWs = updater(existing);
      const nextMap: Record<string, OrgWorkspaceData> = {
        ...currentMap,
        [orgId]: updatedWs,
      };
      latestLocalOrgWorkspacesRef.current = nextMap;
      setLocalOrgWorkspaces(nextMap);
      void saveOrgWorkspaces(activeWorkspaceRef.current, nextMap);

      // Immediate unified Firestore write for changed/added/deleted transactions in this workspace
      const prevById = new Map((existing.transactions || []).map((t) => [t.id, t]));
      const nextById = new Map((updatedWs.transactions || []).map((t) => [t.id, t]));
      const upsertedTxs: Transaction[] = [];
      const deletedIds: string[] = [];

      for (const tx of updatedWs.transactions || []) {
        const prev = prevById.get(tx.id);
        if (
          !prev ||
          tx.updatedAt !== prev.updatedAt ||
          tx.deletedAt !== prev.deletedAt ||
          tx.approvalStatus !== prev.approvalStatus ||
          tx.walletId !== prev.walletId ||
          tx.categoryId !== prev.categoryId ||
          tx.amount !== prev.amount
        ) {
          upsertedTxs.push({ ...tx, workspaceId: orgId });
        }
      }
      for (const prevId of prevById.keys()) {
        if (!nextById.has(prevId)) {
          deletedIds.push(prevId);
        }
      }
      if (upsertedTxs.length === 1) {
        const single = upsertedTxs[0];
        syncWorkspaceTxWriteImmediately(orgId, single, !prevById.has(single.id));
      } else if (upsertedTxs.length > 1) {
        syncWorkspaceTxsBatchImmediately(orgId, upsertedTxs);
      }
      if (deletedIds.length > 0) {
        syncWorkspaceTxDeleteImmediately(orgId, deletedIds);
      }

      // Silent background cloud metadata backup for local-first orgs ONLY after cloud hydration completes
      const currentUid = auth.currentUser?.uid;
      if (
        canPerformAutomaticCloudWrite({
          isAuthenticated: Boolean(currentUid),
          isCloudLoaded: hasCompletedInitialCloudSyncRef.current && isCloudLoadedRef.current,
          isEmergencyRecoveryActive: isEmergencyRecoveryActiveRef.current,
        }) &&
        currentUid
      ) {
        const snap = latestPersonalRef.current;
        void syncOrganizationMetaToCloud(
          currentUid,
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
          },
          nextMap,
          activeWorkspaceRef.current
        ).then((syncedAtMs) => {
          if (syncedAtMs) {
            setLastCloudBackupExists(true);
            setCloudConflict(null);
            setCloudSyncStatus('synced');
            setCloudSyncError(null);
            skipNextAutoSyncRef.current = true;
            setSettings((prev) => {
              const next = {
                ...prev,
                lastCloudSyncAt: syncedAtMs,
                lastKnownCloudUpdatedAtMs: syncedAtMs,
              };
              persistDataDebounced(
                { ...latestPersonalRef.current, settings: next },
                handleLocalPersistError
              );
              return next;
            });
          }
        });
      }
      return updatedWs;
    },
    [
      syncWorkspaceTxWriteImmediately,
      syncWorkspaceTxsBatchImmediately,
      syncWorkspaceTxDeleteImmediately,
    ]
  );

  const applyVerifiedProState = useCallback(async (entitlement: VerifiedProEntitlement | null) => {
    latestVerifiedProRef.current = entitlement;
    setVerifiedPro(entitlement);
    await saveVerifiedProCache(entitlement);
  }, []);

  const refreshScanQuota = useCallback(async () => {
    const activeEnt = latestVerifiedProRef.current;
    const activeLocalTier: PlanTier =
      activeEnt && isEntitlementActive(activeEnt) ? resolvePlanTierFromProfile(activeEnt) : 'free';
    const localLimit =
      activeLocalTier === 'business_pro' ? 500 : activeLocalTier === 'personal_pro' ? 200 : 5;

    if (!auth.currentUser) {
      if (activeLocalTier !== 'free') {
        setScanQuota((prev) => ({
          month: prev?.month || new Date().toISOString().slice(0, 7),
          used: prev?.used || 0,
          limit: localLimit,
          remaining: Math.max(0, localLimit - (prev?.used || 0)),
          isPro: true,
          planTier: activeLocalTier,
          expiresAt: activeEnt?.expiresAt ?? null,
          proExpiresAt: activeEnt?.proExpiresAt ?? activeEnt?.expiresAt ?? null,
        }));
      } else {
        setScanQuota(null);
      }
      return;
    }
    try {
      const isLocalOrg =
        activeWorkspace !== 'personal' &&
        Boolean(latestLocalOrgWorkspacesRef.current[activeWorkspace]);
      const targetOrgId =
        activeWorkspace !== 'personal' && !isLocalOrg ? activeWorkspace : undefined;
      const q = await fetchScanQuotaFromServer(targetOrgId);
      if (q) {
        if (activeLocalTier !== 'free' && !q.isPro) {
          setScanQuota({
            ...q,
            limit: Math.max(q.limit, localLimit),
            remaining: Math.max(0, Math.max(q.limit, localLimit) - (q.used || 0)),
            isPro: true,
            planTier: activeLocalTier,
            expiresAt: activeEnt?.expiresAt ?? null,
            proExpiresAt: activeEnt?.proExpiresAt ?? activeEnt?.expiresAt ?? null,
          });
        } else {
          setScanQuota(q);
        }
      }
    } catch {
      // Non-fatal
    }
  }, [activeWorkspace]);

  const refreshExchangeRates = useCallback(async (force = true): Promise<boolean> => {
    setIsRefreshingRates(true);
    try {
      const fetchResult = await fetchLiveExchangeRatesDetailed(force);
      const result = fetchResult.data;

      if (fetchResult.ok && result) {
        const formatted = new Date(result.fetchedAtMs).toLocaleDateString(
          latestPersonalRef.current.settings.language === 'ar' ? 'ar-EG' : 'en-US',
          { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        );
        setRatesLastUpdated(formatted);
        setSettings((prev) => {
          const next = {
            ...prev,
            useUpdatedExchangeRates: force ? true : prev.useUpdatedExchangeRates,
            ratesLastUpdated: formatted,
            ratesUpdatedAtMs: result.fetchedAtMs,
          };
          persistDataDebounced(
            { ...latestPersonalRef.current, settings: next },
            handleLocalPersistError
          );
          return next;
        });

        const currentAuthUser = auth.currentUser;
        const activeUser = latestPersonalRef.current.user;
        if (
          currentAuthUser &&
          activeUser?.isLoggedIn &&
          currentAuthUser.uid === activeUser.id &&
          (typeof navigator === 'undefined' || navigator.onLine)
        ) {
          try {
            await syncUserCurrencyRatesToCloud(currentAuthUser.uid, {
              rates: result.rates,
              fetchedAtMs: result.fetchedAtMs,
              ratesLastUpdated: formatted,
              useUpdatedExchangeRates: force ? true : latestPersonalRef.current.settings.useUpdatedExchangeRates,
              customExchangeRates: latestPersonalRef.current.settings.customExchangeRates,
            });
            setCloudSyncError(null);
          } catch (syncErr) {
            console.warn('Currency rates cloud sync warning:', syncErr);
          }
        }
        return true;
      }

      if (result) {
        const cachedFormatted = new Date(result.fetchedAtMs).toLocaleDateString(
          latestPersonalRef.current.settings.language === 'ar' ? 'ar-EG' : 'en-US',
          { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        );
        setRatesLastUpdated(cachedFormatted);
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
    setSettings((prev) => {
      const restoredSettings = mergeSettingsWithDefaults(restoredData.settings);
      const reconciledTheme = reconcileThemeSettings(
        prev,
        restoredSettings,
        readStoredThemePreference()
      );
      if (reconciledTheme.adoptedIncoming) {
        writeStoredThemePreference(reconciledTheme.theme, reconciledTheme.themeUpdatedAt);
        applyThemeToDocument(reconciledTheme.theme);
      }
      return {
        ...restoredSettings,
        theme: reconciledTheme.theme,
        ...(reconciledTheme.themeUpdatedAt > 0
          ? { themeUpdatedAt: reconciledTheme.themeUpdatedAt }
          : {}),
        lastKnownCloudUpdatedAtMs: prev.lastKnownCloudUpdatedAtMs,
      };
    });
    setHasCompletedOnboarding(restoredData.hasCompletedOnboarding);
    await persistData({ ...restoredData, user: latestPersonalRef.current.user });
    return true;
  }, []);

  const applyCloudBackupLocally = useCallback(
    (backup: CloudBackupPayload, currentUser: UserAccount | null) => {
      skipNextAutoSyncRef.current = true;
      const prevSettings = latestPersonalRef.current.settings;
      const prevWalletsById = new Map(
        (latestPersonalRef.current.wallets || []).map((w) => [w.id, w])
      );
      const resolvedOnboarded = Boolean(backup.hasCompletedOnboarding ?? true);
      const baseMergedSettings = mergeSettingsWithDefaults(backup.settings);
      const reconciledTheme = reconcileThemeSettings(
        prevSettings,
        baseMergedSettings,
        readStoredThemePreference()
      );
      if (reconciledTheme.adoptedIncoming) {
        writeStoredThemePreference(reconciledTheme.theme, reconciledTheme.themeUpdatedAt);
        applyThemeToDocument(reconciledTheme.theme);
      }
      // Preserve local device App Lock PIN (PIN hashes are strictly local and stripped from cloud backups)
      const hasLocalAppPin = Boolean(prevSettings.isAppLockEnabled && prevSettings.appPin);
      const mergedSettings: AppSettings = {
        ...baseMergedSettings,
        theme: reconciledTheme.theme,
        ...(reconciledTheme.themeUpdatedAt > 0
          ? { themeUpdatedAt: reconciledTheme.themeUpdatedAt }
          : {}),
        ...(hasLocalAppPin
          ? {
              isAppLockEnabled: prevSettings.isAppLockEnabled,
              appPin: prevSettings.appPin,
              appPinSalt: prevSettings.appPinSalt,
            }
          : {
              isAppLockEnabled: false,
              appPin: undefined,
              appPinSalt: undefined,
            }),
        lastCloudSyncAt: backup.updatedAtMs || Date.now(),
        lastKnownCloudUpdatedAtMs: backup.updatedAtMs || prevSettings.lastKnownCloudUpdatedAtMs || Date.now(),
      };
      // Respect user deletions post-onboarding: never force DEFAULT_* when onboarded
      const rawResolvedWallets = backup.wallets?.length
        ? backup.wallets
        : resolvedOnboarded
        ? []
        : DEFAULT_WALLETS;
      // Preserve local device wallet PIN hashes if present on this device
      const pinPreservedWallets = rawResolvedWallets.map((w) => {
        const localW = prevWalletsById.get(w.id);
        if (localW?.isLocked && localW.pin) {
          return {
            ...w,
            isLocked: localW.isLocked,
            pin: localW.pin,
            pinSalt: localW.pinSalt,
          };
        }
        return {
          ...w,
          isLocked: false,
          pin: undefined,
          pinSalt: undefined,
        };
      });
      const resolvedWallets = sortWalletsByOrder(
        tagWalletsWithWorkspace(pinPreservedWallets, 'personal')
      );
      const resolvedCategories = backup.categories?.length
        ? backup.categories
        : resolvedOnboarded
        ? []
        : DEFAULT_CATEGORIES;
      const resolvedTransactions = reconcileWorkspaceTransactions(
        backup.transactions || [],
        latestPersonalRef.current.transactions,
        {
          activeWorkspaceId: 'personal',
          hasServerSnapshot: true,
          pendingLocalIds: pendingLocalTxIdsRef.current,
          locallyDeletedIds: locallyDeletedTxIdsRef.current,
        }
      );
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
      const preservedLocalOverEmptyCloud =
        (backup.transactions || []).length === 0 && resolvedTransactions.length > 0;
      setCloudConflict(null);
      setCloudSyncStatus(preservedLocalOverEmptyCloud ? 'idle' : 'synced');
      setCloudSyncError(null);
      saveUnsyncedDirtyFlag(preservedLocalOverEmptyCloud);
      setHasUnsyncedLocalChanges(preservedLocalOverEmptyCloud);

      if (backup.orgWorkspaces && typeof backup.orgWorkspaces === 'object' && !Array.isArray(backup.orgWorkspaces)) {
        const validEntries = Object.entries(backup.orgWorkspaces).filter(
          ([, w]) => Boolean(w && w.organization && w.organization.id)
        );
        if (validEntries.length > 0) {
          const mergedMap = {
            ...latestLocalOrgWorkspacesRef.current,
            ...Object.fromEntries(validEntries),
          };
          latestLocalOrgWorkspacesRef.current = mergedMap;
          setLocalOrgWorkspaces(mergedMap);
          void saveOrgWorkspaces(backup.activeWorkspace || activeWorkspaceRef.current || 'personal', mergedMap);

          const unmigratedList = Object.values(mergedMap).filter(
            (w): w is OrgWorkspaceData =>
              Boolean(
                w &&
                  w.organization &&
                  w.organization.id &&
                  !isRetainedExtrasOnlyWorkspace(w) &&
                  !w.organization.localFirstMode &&
                  !w.organization.cloudBackedUpAt
              )
          );
          if (unmigratedList.length > 0) {
            setLegacyLocalOrgs(unmigratedList);
            setIsOrgMigrationModalOpen(true);
          }
        }
      }

      persistDataDebounced(
        {
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
        },
        handleLocalPersistError
      );
    },
    [handleLocalPersistError]
  );

  const devActivateProPreview = useCallback((tier: 'personal_pro' | 'business_pro' = 'business_pro') => {
    if (!import.meta.env.DEV) return;
    setDevProTierPreview(tier);
    setIsUpgradeModalOpen(false);
  }, []);

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
    if (auth.currentUser) {
      try {
        const profile = await fetchUserProfile(auth.currentUser.uid);
        if (profile && isEntitlementActive(profile)) {
          await applyVerifiedProState({
            uid: auth.currentUser.uid,
            isPro: true,
            proActive: true,
            proPlan: profile.proPlan || 'code',
            planTier: profile.planTier,
            billingCycle: profile.billingCycle,
            startedAt: profile.startedAt ?? null,
            expiresAt: profile.proExpiresAt ?? profile.expiresAt,
            proExpiresAt: profile.proExpiresAt ?? profile.expiresAt,
            verifiedAt: Date.now(),
          });
          await refreshScanQuota();
          return true;
        }
        if (profile && !isEntitlementActive(profile)) {
          await applyVerifiedProState({
            uid: auth.currentUser.uid,
            isPro: false,
            proActive: false,
            proPlan: 'free',
            planTier: 'free',
            billingCycle: 'free',
            startedAt: null,
            expiresAt: null,
            proExpiresAt: null,
            verifiedAt: Date.now(),
          });
          await refreshScanQuota();
          return false;
        }
      } catch (err) {
        console.warn('Cloud PRO restore error:', err);
      }
    }
    return isEntitlementActive(verifiedPro);
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

  // Sync HTML dir, lang, and document.title
  useEffect(() => {
    const isRtl = settings.language === 'ar';
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = settings.language;
    document.title = isRtl
      ? 'رَصِيدِي - متتبع المصاريف'
      : 'Raseedi - Expense Tracker';
  }, [settings.language]);

  // Sync .dark class and ONLY listen to prefers-color-scheme when theme === 'system'
  useEffect(() => {
    const activeTheme = normalizeThemePreference(settings.theme) ?? 'light';
    applyThemeToDocument(activeTheme);

    if (
      activeTheme !== 'system' ||
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      applyThemeToDocument('system');
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
    }
    mediaQuery.addListener(handleSystemThemeChange);
    return () => mediaQuery.removeListener(handleSystemThemeChange);
  }, [settings.theme]);

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
              workspaceId: 'personal',
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
        persistDataDebounced(
          {
            ...loadedData,
            transactions: allTx,
            wallets: updatedWallets,
            user: loadedData.user || null,
          },
          handleLocalPersistError
        );
        syncWorkspaceTxsBatchImmediately('personal', newTxList);
      }
    },
    [syncWorkspaceTxsBatchImmediately, handleLocalPersistError]
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
      const resolvedWallets = sortWalletsByOrder(
        data.wallets?.length
          ? data.wallets
          : onboarded
          ? []
          : DEFAULT_WALLETS
      );
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
      const baseLoadedSettings = mergeSettingsWithDefaults(data.settings);
      const storedThemePref = readStoredThemePreference();
      const reconciledStartupTheme = reconcileThemeSettings(
        latestPersonalRef.current.settings,
        baseLoadedSettings,
        storedThemePref
      );
      if (!storedThemePref && reconciledStartupTheme.theme !== DEFAULT_SETTINGS.theme) {
        writeStoredThemePreference(
          reconciledStartupTheme.theme,
          reconciledStartupTheme.themeUpdatedAt
        );
      }
      const resolvedSettings: AppSettings = {
        ...baseLoadedSettings,
        theme: reconciledStartupTheme.theme,
        ...(reconciledStartupTheme.themeUpdatedAt > 0
          ? { themeUpdatedAt: reconciledStartupTheme.themeUpdatedAt }
          : {}),
      };
      applyThemeToDocument(resolvedSettings.theme);
      setPersonalTemplates(data.templates || []);
      setPersonalMoneyCircles(data.moneyCircles || []);
      setSettings(resolvedSettings);
      setUser(data.user || null);
      setHasCompletedOnboarding(onboarded);

      const loadedOrgMap = orgData.workspaces || {};
      latestLocalOrgWorkspacesRef.current = loadedOrgMap;
      setLocalOrgWorkspaces(loadedOrgMap);

      const savedWsPref = loadActiveWorkspacePref() || orgData.activeWorkspace;
      if (savedWsPref && savedWsPref !== 'personal') {
        setActiveWorkspace(savedWsPref);
      }

      const legacyList = Object.values(loadedOrgMap).filter(
        (w): w is OrgWorkspaceData =>
          Boolean(
            w &&
              w.organization &&
              w.organization.id &&
              !isRetainedExtrasOnlyWorkspace(w) &&
              !w.organization.localFirstMode &&
              !w.organization.cloudBackedUpAt
          )
      );
      if (legacyList.length > 0) {
        setLegacyLocalOrgs(legacyList);
        setIsOrgMigrationModalOpen(true);
      }

      if (preSnap) {
        setPreRestoreSnapshotDate(preSnap.updatedAt);
      }

      if (
        cachedPro &&
        isEntitlementActive(cachedPro) &&
        (cachedPro.activatedViaCode || cachedPro.uid === 'local' || !data.user || cachedPro.uid === data.user.id)
      ) {
        latestVerifiedProRef.current = cachedPro;
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

  // Browser History API (popstate + hashchange) listener with full cleanup
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!hasMountedHistoryRef.current) {
      hasMountedHistoryRef.current = true;
      const initialRoute = currentSyncedRouteRef.current;
      const existingState = window.history.state as RaseediHistoryState | null;
      const initialDepth =
        typeof existingState?.raseediDepth === 'number' ? existingState.raseediDepth : 0;
      historyDepthRef.current = initialDepth;
      safeWriteSessionNav(initialRoute);
      window.history.replaceState(
        {
          raseediNav: initialRoute,
          raseediDepth: initialDepth,
        } satisfies RaseediHistoryState,
        '',
        buildUrlWithHash(window.location.pathname, window.location.search, initialRoute)
      );
    }

    const handlePopState = (event: PopStateEvent) => {
      const eventState = event.state as RaseediHistoryState | null;

      if (pendingBackSkipsRef.current > 0) {
        pendingBackSkipsRef.current -= 1;
        if (typeof eventState?.raseediDepth === 'number') {
          historyDepthRef.current = eventState.raseediDepth;
        }
        if (pendingBackSkipsRef.current === 0 && pendingHistoryActionsRef.current.length > 0) {
          const queued = pendingHistoryActionsRef.current.splice(0);
          queued.forEach((fn) => fn());
        }
        return;
      }

      // Close topmost open modal if Back popped its history entry
      const topModal = modalBackStackRef.current[modalBackStackRef.current.length - 1];
      if (topModal && eventState?.raseediModalId !== topModal.id) {
        modalBackStackRef.current.pop();
        poppedByBrowserRef.current.add(topModal.id);
        if (typeof eventState?.raseediDepth === 'number') {
          historyDepthRef.current = eventState.raseediDepth;
        }
        topModal.onClose();
        return;
      }

      const parsedHash = parseHashRoute(window.location.hash);
      const targetRoute = normalizeRouteState(
        eventState?.raseediNav ||
          (parsedHash
            ? {
                ...currentSyncedRouteRef.current,
                ...parsedHash,
                activeWalletId: parsedHash.activeWalletId ?? null,
              }
            : { activeNav: 'home', homeTab: 'transactions', activeWalletId: null })
      );

      if (typeof eventState?.raseediDepth === 'number') {
        historyDepthRef.current = eventState.raseediDepth;
        if (historyTrailRef.current.length > eventState.raseediDepth + 1) {
          historyTrailRef.current = historyTrailRef.current.slice(0, eventState.raseediDepth + 1);
        }
      }

      if (!areRoutesEqual(targetRoute, currentSyncedRouteRef.current)) {
        isApplyingPopStateRef.current = true;
        currentSyncedRouteRef.current = targetRoute;
        safeWriteSessionNav(targetRoute);
        setActiveNavState(targetRoute.activeNav);
        setHomeTabState(targetRoute.homeTab);
        setActiveWalletIdState(targetRoute.activeWalletId);
      }
    };

    const handleHashChange = () => {
      if (pendingBackSkipsRef.current > 0) return;
      const parsedHash = parseHashRoute(window.location.hash);
      if (!parsedHash) return;

      const targetRoute = normalizeRouteState({
        ...currentSyncedRouteRef.current,
        ...parsedHash,
        activeWalletId: parsedHash.activeWalletId ?? null,
      });

      if (!areRoutesEqual(targetRoute, currentSyncedRouteRef.current)) {
        while (modalBackStackRef.current.length > 0) {
          const m = modalBackStackRef.current.pop();
          if (m) {
            poppedByBrowserRef.current.add(m.id);
            m.onClose();
          }
        }
        isApplyingPopStateRef.current = true;
        currentSyncedRouteRef.current = targetRoute;
        safeWriteSessionNav(targetRoute);
        setActiveNavState(targetRoute.activeNav);
        setHomeTabState(targetRoute.homeTab);
        setActiveWalletIdState(targetRoute.activeWalletId);
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  // Push history entries & persist route state whenever active view changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextRoute = normalizeRouteState({ activeNav, homeTab, activeWalletId });

    if (activeNav !== 'wallets' && activeWalletId !== null) {
      setActiveWalletIdState(null);
    }

    if (isApplyingPopStateRef.current) {
      isApplyingPopStateRef.current = false;
      currentSyncedRouteRef.current = nextRoute;
      safeWriteSessionNav(nextRoute);
      return;
    }

    if (areRoutesEqual(nextRoute, currentSyncedRouteRef.current)) {
      return;
    }

    currentSyncedRouteRef.current = nextRoute;
    safeWriteSessionNav(nextRoute);

    flushOrRunHistoryAction(() => {
      const nextDepth = historyDepthRef.current + 1;
      historyDepthRef.current = nextDepth;
      historyTrailRef.current = [...historyTrailRef.current.slice(0, nextDepth), nextRoute];
      const nextUrl = buildUrlWithHash(window.location.pathname, window.location.search, nextRoute);
      window.history.pushState(
        {
          raseediNav: nextRoute,
          raseediDepth: nextDepth,
        } satisfies RaseediHistoryState,
        '',
        nextUrl
      );
    });
  }, [activeNav, homeTab, activeWalletId, flushOrRunHistoryAction]);

  // Refresh or disable live exchange rates when setting toggles
  useEffect(() => {
    if (isLoading) return;
    if (!settings.useUpdatedExchangeRates) {
      setLiveExchangeRatesRuntime(null);
      return;
    }
    void fetchLiveExchangeRatesDetailed(false).then((fetchResult) => {
      const res = fetchResult.data;
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
      // CRITICAL: Check interactive sign-in guard BEFORE incrementing syncRequestIdRef.
      // When signInWithPopup succeeds, Firebase emits onAuthStateChanged immediately while
      // signInWithGoogleAccount is still running; incrementing syncRequestIdRef here used
      // to invalidate Attempt 1 and force a spurious failure on the first login click.
      if (shouldIgnoreAuthStateChangeDuringInteractiveSignIn(activeInteractiveGoogleSignInRef.current)) {
        return;
      }

      const reqId = ++syncRequestIdRef.current;
      if (!firebaseUser) {
        hasCompletedInitialCloudSyncRef.current = false;
        isCloudLoadedRef.current = false;
        setIsCloudLoaded(false);
        setIsAdminUser(false);
        setFirebaseAuthUser(null);
        setLastCloudBackupExists(false);
        setScanQuota(null);
        setOrgRefs([]);
        setOrgRefsLoaded(false);
        const currentWs = activeWorkspaceRef.current;
        if (currentWs !== 'personal' && !latestLocalOrgWorkspacesRef.current[currentWs]) {
          setActiveWorkspace('personal');
          saveActiveWorkspacePref('personal');
        }
        return;
      }

      hasCompletedInitialCloudSyncRef.current = false;
      isCloudLoadedRef.current = false;
      setIsCloudLoaded(false);
      const previousLocalUserId = latestPersonalRef.current.user?.id || null;
      const resolvedEmail = resolveFirebaseUserEmail(firebaseUser);
      const nextUser: UserAccount = {
        id: firebaseUser.uid,
        name: firebaseUser.displayName || resolvedEmail.split('@')[0] || 'Raseedi User',
        email: resolvedEmail,
        avatarUrl: firebaseUser.photoURL || undefined,
        isLoggedIn: true,
      };
      setFirebaseAuthUser({
        uid: firebaseUser.uid,
        email: resolvedEmail,
        emailVerified: firebaseUser.emailVerified,
      });
      setUser(nextUser);
      void refreshAdminStatus(firebaseUser);

      try {
        const isOnline = typeof navigator === 'undefined' || navigator.onLine;
        // 1. Ensure users/{uid} exists cleanly first before reading backup meta or workspace transactions
        const profile = await ensureUserProfile(firebaseUser);
        if (reqId !== syncRequestIdRef.current) return;
        if (profile.username) {
          setUser((prev) =>
            prev && prev.id === firebaseUser.uid
              ? { ...prev, username: profile.username }
              : { ...nextUser, username: profile.username }
          );
        }

        const [cloudMeta, unifiedPersonalTxs] = await Promise.all([
          fetchCloudBackupMeta(firebaseUser.uid, { forceServer: false }).catch((metaErr) => {
            console.warn('[Cloud Startup] fetchCloudBackupMeta warning:', metaErr);
            return null;
          }),
          fetchWorkspaceTransactionsCloud(firebaseUser.uid, 'personal', {
            forceServer: false,
          }).catch(() => []),
        ]);
        if (reqId !== syncRequestIdRef.current) return;
        setCloudDiagnosticsError(null);
        setCloudSyncError(null);

        const active = isEntitlementActive(profile);
        const cachedEntitlement = await loadVerifiedProCache();
        if (reqId !== syncRequestIdRef.current) return;
        const hasValidLocalCode =
          !active &&
          cachedEntitlement &&
          isEntitlementActive(cachedEntitlement) &&
          (cachedEntitlement.activatedViaCode ||
            cachedEntitlement.uid === 'local' ||
            cachedEntitlement.uid === firebaseUser.uid);

        const entitlement: VerifiedProEntitlement = hasValidLocalCode
          ? {
              ...cachedEntitlement,
              uid: firebaseUser.uid,
            }
          : {
              uid: firebaseUser.uid,
              isPro: active,
              proActive: active,
              proPlan: active ? profile.proPlan || 'code' : 'free',
              planTier: resolvePlanTierFromProfile(profile),
              billingCycle: active ? profile.billingCycle || 'lifetime' : 'free',
              startedAt: profile.startedAt ?? null,
              expiresAt: profile.proExpiresAt ?? profile.expiresAt ?? null,
              proExpiresAt: profile.proExpiresAt ?? profile.expiresAt ?? null,
              verifiedAt: Date.now(),
            };
        await applyVerifiedProState(entitlement);
        if (reqId !== syncRequestIdRef.current) return;

        // Hydrate newer cloud-synced currency exchange rates from Firestore users/{uid}
        const cloudRates = profile.currencyRates;
        if (
          cloudRates &&
          cloudRates.rates &&
          typeof cloudRates.rates === 'object' &&
          Object.keys(cloudRates.rates).length > 0
        ) {
          const localCachedRates = getCachedExchangeRatesMeta();
          const cloudFetchedAtMs =
            typeof cloudRates.fetchedAtMs === 'number' && cloudRates.fetchedAtMs > 0
              ? cloudRates.fetchedAtMs
              : 0;
          if (!localCachedRates || cloudFetchedAtMs > localCachedRates.fetchedAtMs) {
            saveLiveExchangeRatesCache({
              rates: cloudRates.rates,
              fetchedAtMs: cloudFetchedAtMs || Date.now(),
              source: 'live',
            });
            const hydratedFormatted =
              cloudRates.ratesLastUpdated ||
              new Date(cloudFetchedAtMs || Date.now()).toLocaleDateString(
                latestPersonalRef.current.settings.language === 'ar' ? 'ar-EG' : 'en-US',
                { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
              );
            setRatesLastUpdated(hydratedFormatted);
          }
        }

        const hasCloudData = Boolean(cloudMeta) || unifiedPersonalTxs.length > 0;
        setLastCloudBackupExists(hasCloudData);
        void fetchCloudBackupHistory(firebaseUser.uid)
          .then((list) => {
            if (reqId === syncRequestIdRef.current) {
              setCloudBackupHistory(list);
            }
          })
          .catch(() => {});
        void refreshScanQuota();

        const snap = latestPersonalRef.current;
        const postAction = resolvePostGoogleSignInAction({
          hasCloudBackup: hasCloudData,
          wasActiveGuest: isGuestModeRef.current,
          hasLocalOnboarding: Boolean(snap.hasCompletedOnboarding),
          localTransactionsCount: snap.transactions.length,
          sameSignedInUser: previousLocalUserId === firebaseUser.uid,
          hasCloudOnboarding: Boolean(profile.hasCompletedOnboarding),
        });

        saveGuestModePref(false);
        setIsGuestMode(false);

        // Cloud-First hydration prioritizing unified workspace path as single source of truth
        const needsCloudFirstHydration =
          postAction === 'restore_cloud_and_enter' ||
          shouldRestoreCloudOnStartup({
            localTransactionsCount: snap.transactions.length,
            hasCloudBackup: hasCloudData,
            cloudUpdatedAtMs:
              cloudMeta?.updatedAtMs || (unifiedPersonalTxs.length > 0 ? Date.now() : 0),
            localLastKnownCloudUpdatedAtMs: snap.settings.lastKnownCloudUpdatedAtMs,
          });

        if (needsCloudFirstHydration) {
          let cloudBackup = await fetchCloudBackup(firebaseUser.uid, { forceServer: false }).catch(
            (err) => {
              console.error('[Cloud Startup] fetchCloudBackup failed:', err);
              setCloudDiagnosticsError(
                formatFirestoreErrorForDisplay(err, snap.settings.language === 'ar')
              );
              return null;
            }
          );
          if (reqId !== syncRequestIdRef.current) return;
          if (
            unifiedPersonalTxs.length === 0 &&
            (!cloudBackup || (cloudBackup.transactions || []).length === 0)
          ) {
            const historyFallback = await fetchLatestCloudBackupFromHistory(firebaseUser.uid, {
              forceServer: false,
            }).catch(() => null);
            if (reqId !== syncRequestIdRef.current) return;
            if (historyFallback && (historyFallback.transactions || []).length > 0) {
              cloudBackup = historyFallback;
            }
          }
          if (reqId !== syncRequestIdRef.current) return;

          const resolvedCloudPersonalTxs =
            unifiedPersonalTxs.length > 0
              ? reconcileWorkspaceTransactions(
                  unifiedPersonalTxs,
                  cloudBackup?.transactions || [],
                  {
                    activeWorkspaceId: 'personal',
                    hasServerSnapshot: true,
                    pendingLocalIds: pendingLocalTxIdsRef.current,
                    locallyDeletedIds: locallyDeletedTxIdsRef.current,
                  }
                )
              : (cloudBackup?.transactions || []).filter((tx) =>
                  isActiveWorkspaceTransaction(tx, 'personal')
                );

          if (cloudBackup) {
            const cloudPayloadWithUnified: CloudBackupPayload = {
              ...cloudBackup,
              transactions: resolvedCloudPersonalTxs,
            };
            const isCloudEmptyWithLocalData =
              resolvedCloudPersonalTxs.length === 0 && snap.transactions.length > 0;
            if (
              snap.transactions.length > 0 &&
              (postAction !== 'restore_cloud_and_enter' || isCloudEmptyWithLocalData)
            ) {
              const merged = mergeCloudAndLocalState({
                localData: snap,
                cloudData: cloudPayloadWithUnified,
                preferCloud: !isCloudEmptyWithLocalData,
              });
              applyCloudBackupLocally(
                {
                  uid: firebaseUser.uid,
                  schemaVersion: cloudBackup.schemaVersion || 2,
                  updatedAtMs: Math.max(cloudBackup.updatedAtMs || 0, Date.now()),
                  ...merged,
                },
                nextUser
              );
              if (isCloudEmptyWithLocalData) {
                saveUnsyncedDirtyFlag(true);
                setHasUnsyncedLocalChanges(true);
              }
            } else {
              applyCloudBackupLocally(cloudPayloadWithUnified, nextUser);
            }
          } else if (resolvedCloudPersonalTxs.length > 0) {
            const hydrated = reconcileWorkspaceTransactions(
              resolvedCloudPersonalTxs,
              snap.transactions,
              {
                activeWorkspaceId: 'personal',
                hasServerSnapshot: true,
                pendingLocalIds: pendingLocalTxIdsRef.current,
                locallyDeletedIds: locallyDeletedTxIdsRef.current,
              }
            );
            skipNextAutoSyncRef.current = true;
            setPersonalTransactions(hydrated);
            setHasCompletedOnboarding(true);
            setCloudConflict(null);
            savePersonalState(
              {
                user: nextUser,
                transactions: hydrated,
                hasCompletedOnboarding: true,
              },
              { skipDirty: true }
            );
          } else {
            savePersonalState({ user: nextUser }, { skipDirty: true });
          }
        } else if (unifiedPersonalTxs.length > 0) {
          const reconciled = reconcileWorkspaceTransactions(
            unifiedPersonalTxs,
            snap.transactions,
            {
              activeWorkspaceId: 'personal',
              hasServerSnapshot: true,
              pendingLocalIds: pendingLocalTxIdsRef.current,
              locallyDeletedIds: locallyDeletedTxIdsRef.current,
            }
          );
          skipNextAutoSyncRef.current = true;
          setPersonalTransactions(reconciled);
          setHasCompletedOnboarding(true);
          setCloudConflict(null);
          savePersonalState(
            { user: nextUser, transactions: reconciled, hasCompletedOnboarding: true },
            { skipDirty: true }
          );
        } else if (postAction === 'start_onboarding') {
          setHasCompletedOnboarding(false);
          setCloudConflict(null);
          savePersonalState(
            { user: nextUser, hasCompletedOnboarding: false },
            { skipDirty: true, immediate: true }
          );
        } else {
          const shouldMarkOnboarded = Boolean(
            snap.hasCompletedOnboarding || profile.hasCompletedOnboarding
          );
          if (shouldMarkOnboarded && !snap.hasCompletedOnboarding) {
            setHasCompletedOnboarding(true);
          }
          setCloudConflict(null);
          savePersonalState(
            { user: nextUser, hasCompletedOnboarding: shouldMarkOnboarded },
            { skipDirty: true }
          );
        }

        if (isOnline && reqId === syncRequestIdRef.current) {
          isCloudLoadedRef.current = true;
          setIsCloudLoaded(true);
        }
      } catch (err) {
        if (reqId !== syncRequestIdRef.current) return;
        console.warn('Cloud auth sync warning:', err);
        const snapNow = latestPersonalRef.current;
        if (
          shouldSurfaceCloudDiagnosticsError({
            isInitialAccountSetup: !hasCompletedInitialCloudSyncRef.current,
            hasCompletedOnboarding: Boolean(snapNow.hasCompletedOnboarding),
          })
        ) {
          setCloudDiagnosticsError(
            formatFirestoreErrorForDisplay(err, snapNow.settings.language === 'ar')
          );
        }
      } finally {
        if (reqId === syncRequestIdRef.current) {
          hasCompletedInitialCloudSyncRef.current = true;
        }
      }
    });

    return () => unsubscribe();
  }, [applyCloudBackupLocally, applyVerifiedProState, refreshAdminStatus, refreshScanQuota, savePersonalState]);

  // Unified Real-Time Sync + Cloud-First Hydration for users/{uid}/workspaces/{workspaceId}/transactions
  // Keeps localStorage/IndexedDB strictly as an offline cache and syncs immediately in both directions.
  useEffect(() => {
    if (!user?.isLoggedIn || !user.id || auth.currentUser?.uid !== user.id) return;
    if (isCloudActiveOrg) return; // Multi-user shared orgs use /organizations/{orgId}/transactions

    const uid = user.id;
    const activeWsId = normalizeWorkspaceId(activeWorkspace);
    const backfillKey = `${uid}::${activeWsId}`;
    const effectSyncReqId = syncRequestIdRef.current;
    let cancelled = false;
    let hasAuthoritativeServer = false;
    let isPromotingLocalToCloud = false;
    let lastPromotedEpoch = -1;
    isCloudLoadedRef.current = false;
    setIsCloudLoaded(false);

    const isStaleSync = () => cancelled || effectSyncReqId !== syncRequestIdRef.current;

    const markCloudReady = () => {
      if (isStaleSync()) return;
      isCloudLoadedRef.current = true;
      setIsCloudLoaded(true);
    };

    const promoteLocalTransactionsToCloudIfNeeded = async (localActive: Transaction[]) => {
      if (
        isStaleSync() ||
        isEmergencyRecoveryActiveRef.current ||
        isPromotingLocalToCloud ||
        localActive.length === 0
      ) {
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const currentEpoch = workspaceSyncEpochRef.current;
      if (lastPromotedEpoch === currentEpoch) return;

      isPromotingLocalToCloud = true;
      lastPromotedEpoch = currentEpoch;
      try {
        await syncWorkspaceTransactionsWithZeroGuard({
          uid,
          workspaceId: activeWsId,
          cloudTransactions: [],
          localTransactions: localActive,
          locallyDeletedIds: locallyDeletedTxIdsRef.current,
        });
        if (isStaleSync()) return;
        const snap = latestPersonalRef.current;
        await saveCloudBackup(
          uid,
          {
            transactions: snap.transactions,
            wallets: snap.wallets,
            categories: snap.categories,
            budgets: snap.budgets,
            debts: snap.debts,
            goals: snap.goals,
            templates: snap.templates,
            moneyCircles: snap.moneyCircles,
            orgWorkspaces: latestLocalOrgWorkspacesRef.current,
            activeWorkspace: activeWorkspaceRef.current || 'personal',
            settings: snap.settings,
            hasCompletedOnboarding: snap.hasCompletedOnboarding,
          },
          { source: 'auto', recordHistory: true, allowEmptyOverwrite: false }
        ).catch(() => null);
        if (!isStaleSync()) {
          setLastCloudBackupExists(true);
          setCloudSyncStatus('synced');
          for (const tx of localActive) {
            pendingLocalTxIdsRef.current.delete(tx.id);
          }
        }
      } catch (promoteErr) {
        lastPromotedEpoch = -1;
        console.warn(`[WorkspaceSync] Auto-promotion to cloud delayed for ${activeWsId}:`, promoteErr);
      } finally {
        isPromotingLocalToCloud = false;
      }
    };

    const applyReconciledToCache = (cloudTxs: Transaction[], fromServer: boolean) => {
      if (isStaleSync()) return;
      if (fromServer) {
        hasAuthoritativeServer = true;
        markCloudReady();
      }

      if (activeWsId === 'personal') {
        const localCurrent = latestPersonalRef.current.transactions;
        const priority = resolveWorkspaceSyncPriority({
          cloudTransactions: cloudTxs,
          localTransactions: localCurrent,
          activeWorkspaceId: 'personal',
          locallyDeletedIds: locallyDeletedTxIdsRef.current,
        });

        // Zero-Data Overwrite Guard: when Cloud has 0 tx but Browser has local tx, prioritize Local -> Cloud upload
        if (fromServer && priority === 'push_local_to_cloud') {
          const activeLocal = localCurrent.filter(
            (tx) =>
              isActiveWorkspaceTransaction(tx, 'personal') &&
              !locallyDeletedTxIdsRef.current.has(tx.id)
          );
          void promoteLocalTransactionsToCloudIfNeeded(activeLocal);
          return;
        }

        const reconciled = reconcileWorkspaceTransactions(cloudTxs, localCurrent, {
          activeWorkspaceId: 'personal',
          hasServerSnapshot: hasAuthoritativeServer,
          pendingLocalIds: pendingLocalTxIdsRef.current,
          locallyDeletedIds: locallyDeletedTxIdsRef.current,
        });

        const sameLength = reconciled.length === localCurrent.length;
        const sameItems =
          sameLength &&
          reconciled.every(
            (tx, i) =>
              localCurrent[i]?.id === tx.id && localCurrent[i]?.updatedAt === tx.updatedAt
          );

        if (!sameItems) {
          skipNextAutoSyncRef.current = true;
          setPersonalTransactions(reconciled);
          persistDataDebounced(
            {
              ...latestPersonalRef.current,
              transactions: reconciled,
            },
            handleLocalPersistError
          );
        }
        return;
      }

      const currentWs = latestLocalOrgWorkspacesRef.current[activeWsId];
      if (!currentWs) return;
      const localAll = currentWs.transactions || [];
      const trashItems = localAll.filter((t) => Boolean(t.deletedAt));
      const activeLocal = localAll.filter((t) => !t.deletedAt);

      const priority = resolveWorkspaceSyncPriority({
        cloudTransactions: cloudTxs,
        localTransactions: activeLocal,
        activeWorkspaceId: activeWsId,
        locallyDeletedIds: locallyDeletedTxIdsRef.current,
      });

      if (fromServer && priority === 'push_local_to_cloud') {
        const activeToPush = activeLocal.filter(
          (tx) => !locallyDeletedTxIdsRef.current.has(tx.id)
        );
        void promoteLocalTransactionsToCloudIfNeeded(activeToPush);
        return;
      }

      const reconciled = reconcileWorkspaceTransactions(cloudTxs, activeLocal, {
        activeWorkspaceId: activeWsId,
        hasServerSnapshot: hasAuthoritativeServer,
        pendingLocalIds: pendingLocalTxIdsRef.current,
        locallyDeletedIds: locallyDeletedTxIdsRef.current,
      });

      const sameLength = reconciled.length === activeLocal.length;
      const sameItems =
        sameLength &&
        reconciled.every(
          (tx, i) =>
            activeLocal[i]?.id === tx.id && activeLocal[i]?.updatedAt === tx.updatedAt
        );

      if (!sameItems) {
        const trashById = new Set(reconciled.map((t) => t.id));
        const combined = [...reconciled, ...trashItems.filter((t) => !trashById.has(t.id))];
        const nextMap: Record<string, OrgWorkspaceData> = {
          ...latestLocalOrgWorkspacesRef.current,
          [activeWsId]: {
            ...currentWs,
            transactions: combined,
          },
        };
        latestLocalOrgWorkspacesRef.current = nextMap;
        setLocalOrgWorkspaces(nextMap);
        void saveOrgWorkspaces(activeWorkspaceRef.current, nextMap);
      }
    };

    const runCloudFirstFetchAndBackfill = async () => {
      if (isStaleSync() || isEmergencyRecoveryActiveRef.current) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;

      const fetchEpoch = workspaceSyncEpochRef.current;
      try {
        // Server-first with graceful local-cache fallback prevents "Failed to get documents from server"
        // errors when Firestore's WebChannel/long-polling transport is still establishing or offline;
        // the live onSnapshot listener below delivers authoritative server snapshots immediately on connect.
        const serverTxs = await fetchWorkspaceTransactionsCloud(uid, activeWsId, {
          forceServer: false,
        });
        if (isStaleSync()) return;
        if (fetchEpoch !== workspaceSyncEpochRef.current) {
          // Newer local mutations occurred while server fetch was in-flight; keep listener authoritative
          markCloudReady();
          return;
        }

        if (serverTxs.length > 0) {
          hasAuthoritativeServer = true;
          setLastCloudBackupExists(true);
          applyReconciledToCache(serverTxs, true);
          return;
        }

        // 1) Check legacy cloud backup chunks / history for this exact workspace once per session key
        let legacyCloudTxs: Transaction[] = [];
        if (!unifiedBackfilledKeysRef.current.has(backfillKey)) {
          unifiedBackfilledKeysRef.current.add(backfillKey);
          const cloudBackup = await fetchCloudBackup(uid, { forceServer: false }).catch(() => null);
          if (isStaleSync()) return;
          if (activeWsId === 'personal') {
            legacyCloudTxs = (cloudBackup?.transactions || []).filter((tx) =>
              isActiveWorkspaceTransaction(tx, 'personal')
            );
            if (legacyCloudTxs.length === 0) {
              const hist = await fetchLatestCloudBackupFromHistory(uid, {
                forceServer: false,
              }).catch(() => null);
              if (isStaleSync()) return;
              legacyCloudTxs = (hist?.transactions || []).filter((tx) =>
                isActiveWorkspaceTransaction(tx, 'personal')
              );
            }
          } else {
            legacyCloudTxs = (cloudBackup?.orgWorkspaces?.[activeWsId]?.transactions || []).filter(
              (tx) => !tx.deletedAt
            );
          }

          if (isStaleSync() || isEmergencyRecoveryActiveRef.current) return;

          if (legacyCloudTxs.length > 0) {
            await batchUpsertWorkspaceTransactionsCloud(uid, activeWsId, legacyCloudTxs);
            if (isStaleSync()) return;
            applyReconciledToCache(legacyCloudTxs, true);
            return;
          }
        }

        // 2) Zero-Data Overwrite Guard: if Cloud unified & legacy backup are both 0 tx,
        // ALWAYS promote existing browser transactions to Firestore instead of wiping them.
        const localSeed =
          activeWsId === 'personal'
            ? latestPersonalRef.current.transactions.filter(
                (tx) =>
                  isActiveWorkspaceTransaction(tx, 'personal') &&
                  !locallyDeletedTxIdsRef.current.has(tx.id)
              )
            : (latestLocalOrgWorkspacesRef.current[activeWsId]?.transactions || []).filter(
                (tx) => !tx.deletedAt && !locallyDeletedTxIdsRef.current.has(tx.id)
              );
        if (localSeed.length > 0 && !isEmergencyRecoveryActiveRef.current && !isStaleSync()) {
          await promoteLocalTransactionsToCloudIfNeeded(localSeed);
        }
        markCloudReady();
      } catch (err) {
        if (isOfflineFirestoreError(err)) {
          console.warn(`[WorkspaceSync] Offline cache mode for ${activeWsId}`);
        } else {
          console.error(`[WorkspaceSync] Cloud-First fetch failed for ${activeWsId}:`, err);
        }
      }
    };

    const unsub = subscribeWorkspaceTransactions(
      uid,
      activeWsId,
      (cloudTxs, meta) => {
        if (isStaleSync()) return;
        if (!meta.fromCache) {
          const cloudIdSet = new Set(cloudTxs.map((t) => t.id));
          const pendingSet = new Set(meta.pendingIds);
          for (const id of Array.from(pendingLocalTxIdsRef.current)) {
            if (cloudIdSet.has(id) && !pendingSet.has(id)) {
              pendingLocalTxIdsRef.current.delete(id);
            }
          }
          if (!meta.hasPendingWrites) {
            for (const id of Array.from(locallyDeletedTxIdsRef.current)) {
              if (!cloudIdSet.has(id)) {
                locallyDeletedTxIdsRef.current.delete(id);
              }
            }
          }
          if (cloudTxs.length > 0) {
            setLastCloudBackupExists(true);
          }
        }
        applyReconciledToCache(cloudTxs, !meta.fromCache);
        setCloudSyncStatus(meta.hasPendingWrites ? 'syncing' : 'synced');
      },
      (err) => {
        if (isStaleSync()) return;
        const formatted = formatFirestoreErrorForDisplay(
          err,
          latestPersonalRef.current.settings.language === 'ar'
        );
        setCloudDiagnosticsError(formatted);
      }
    );

    void runCloudFirstFetchAndBackfill();

    const handleBackOnline = () => {
      void runCloudFirstFetchAndBackfill();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleBackOnline);
    }

    return () => {
      cancelled = true;
      unsub();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleBackOnline);
      }
    };
  }, [user?.isLoggedIn, user?.id, activeWorkspace, isCloudActiveOrg]);

  // Real-time subscription sync from Firestore /users/{uid} (reflects Admin edits/cancellations immediately)
  useEffect(() => {
    if (!user?.isLoggedIn || !user.id || auth.currentUser?.uid !== user.id) return;
    const unsub = subscribeUserProfile(user.id, (profile, fromCache) => {
      if (!profile || fromCache) return;
      const active = isEntitlementActive(profile);
      const nextTier = resolvePlanTierFromProfile(profile);
      const nextExpiry = profile.proExpiresAt ?? profile.expiresAt ?? null;
      const nextCycle = active ? profile.billingCycle || 'lifetime' : 'free';
      const cur = latestVerifiedProRef.current;
      const curActive = Boolean(cur?.isPro || cur?.proActive);

      const changed =
        curActive !== active ||
        (cur?.planTier || 'free') !== nextTier ||
        (cur?.billingCycle || 'free') !== nextCycle ||
        (cur?.proExpiresAt ?? cur?.expiresAt ?? null) !== nextExpiry ||
        (cur?.startedAt ?? null) !== (profile.startedAt ?? null);

      if (changed) {
        void applyVerifiedProState({
          uid: user.id,
          isPro: active,
          proActive: active,
          proPlan: active ? profile.proPlan || 'code' : 'free',
          planTier: nextTier,
          billingCycle: nextCycle,
          startedAt: profile.startedAt ?? null,
          expiresAt: nextExpiry,
          proExpiresAt: nextExpiry,
          verifiedAt: Date.now(),
        });
        void refreshScanQuota();
      }
    });
    return () => unsub();
  }, [user?.isLoggedIn, user?.id, applyVerifiedProState, refreshScanQuota]);

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

  // Validate activeWorkspace against server-managed orgRefs OR local-first orgWorkspaces
  useEffect(() => {
    if (!orgRefsLoaded || activeWorkspace === 'personal') return;
    const match = orgRefs.find((r) => r.orgId === activeWorkspace);
    if (match?.status === 'suspended') {
      setActiveWorkspace('personal');
      saveActiveWorkspacePref('personal');
      setOrgActionError(
        settings.language === 'en'
          ? 'Your membership in this organization is suspended.'
          : 'تم تعليق عضويتك في هذه المؤسسة.'
      );
      return;
    }
    if (!match && !localOrgWorkspaces[activeWorkspace]) {
      setActiveWorkspace('personal');
      saveActiveWorkspacePref('personal');
    }
  }, [orgRefsLoaded, orgRefs, localOrgWorkspaces, activeWorkspace, settings.language]);

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
          isCloudLoadedRef.current = true;
          setIsCloudLoaded(true);
        },
        onAuditLogs: (logs) => setActiveCloudAuditLogs(logs),
        onError: (scope, err) => {
          if (scope === 'transactions' || isFirestoreMissingIndexError(err)) {
            console.error(`Org ${scope} query/index error:`, err);
            setCloudDiagnosticsError(
              formatFirestoreErrorForDisplay(
                err,
                latestPersonalRef.current.settings.language === 'ar'
              )
            );
          } else {
            console.warn(`Org listener error (${scope}):`, err);
          }
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

  const enterGuestMode = useCallback(() => {
    saveGuestModePref(true);
    setIsGuestMode(true);
  }, []);

  const signInWithGoogleAccount = useCallback(async (): Promise<{
    restored: boolean;
    isProRestored: boolean;
  } | null> => {
    if (inFlightGoogleSignInPromiseRef.current) {
      return inFlightGoogleSignInPromiseRef.current;
    }

    const task = (async (): Promise<{ restored: boolean; isProRestored: boolean } | null> => {
      activeInteractiveGoogleSignInRef.current = true;
      const reqId = ++syncRequestIdRef.current;
      setIsCloudSyncing(true);
      setCloudSyncError(null);
      setCloudDiagnosticsError(null);
      const wasActiveGuest = isGuestModeRef.current;
      const previousLocalUserId = latestPersonalRef.current.user?.id || null;
      try {
        const { firebaseUser, profile } = await signInWithGoogle();
        if (reqId !== syncRequestIdRef.current) return null;
        const resolvedEmail = resolveFirebaseUserEmail(firebaseUser);
        const nextUser: UserAccount = {
          id: firebaseUser.uid,
          name: firebaseUser.displayName || resolvedEmail.split('@')[0] || 'Raseedi User',
          email: resolvedEmail,
          username: profile.username,
          avatarUrl: firebaseUser.photoURL || undefined,
          isLoggedIn: true,
        };
        setFirebaseAuthUser({
          uid: firebaseUser.uid,
          email: resolvedEmail,
          emailVerified: firebaseUser.emailVerified,
        });
        setUser(nextUser);
        void refreshAdminStatus(firebaseUser);

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
        }).catch((entErr) => {
          console.warn('[signInWithGoogleAccount] Non-fatal entitlement cache warning:', entErr);
        });
        void refreshScanQuota();

        const [cloudMeta, unifiedPersonalTxs] = await Promise.all([
          fetchCloudBackupMeta(firebaseUser.uid, { forceServer: false }).catch(() => null),
          fetchWorkspaceTransactionsCloud(firebaseUser.uid, 'personal', {
            forceServer: false,
          }).catch(() => []),
        ]);
        const hasCloudData = Boolean(cloudMeta) || unifiedPersonalTxs.length > 0;
        setLastCloudBackupExists(hasCloudData);

        const snap = latestPersonalRef.current;
        const postAction = resolvePostGoogleSignInAction({
          hasCloudBackup: hasCloudData,
          wasActiveGuest,
          hasLocalOnboarding: Boolean(snap.hasCompletedOnboarding),
          localTransactionsCount: snap.transactions.length,
          sameSignedInUser: previousLocalUserId === firebaseUser.uid,
          hasCloudOnboarding: Boolean(profile.hasCompletedOnboarding),
        });

        saveGuestModePref(false);
        setIsGuestMode(false);

        let restored = false;
        if (postAction === 'restore_cloud_and_enter') {
          const cloudBackup = await fetchCloudBackup(firebaseUser.uid, {
            forceServer: false,
          }).catch(() => null);
          const resolvedUnified =
            unifiedPersonalTxs.length > 0
              ? reconcileWorkspaceTransactions(
                  unifiedPersonalTxs,
                  cloudBackup?.transactions || [],
                  { activeWorkspaceId: 'personal', hasServerSnapshot: true }
                )
              : (cloudBackup?.transactions || []).filter((tx) =>
                  isActiveWorkspaceTransaction(tx, 'personal')
                );

          if (cloudBackup) {
            applyCloudBackupLocally(
              { ...cloudBackup, transactions: resolvedUnified },
              nextUser
            );
            restored = true;
          } else if (resolvedUnified.length > 0) {
            skipNextAutoSyncRef.current = true;
            setPersonalTransactions(resolvedUnified);
            setHasCompletedOnboarding(true);
            savePersonalState(
              {
                user: nextUser,
                transactions: resolvedUnified,
                hasCompletedOnboarding: true,
              },
              { skipDirty: true, immediate: true }
            );
            restored = true;
          }
        } else if (postAction === 'start_onboarding') {
          setHasCompletedOnboarding(false);
          setCloudConflict(null);
          savePersonalState(
            { user: nextUser, hasCompletedOnboarding: false },
            { skipDirty: true, immediate: true }
          );
        } else {
          const shouldMarkOnboarded = Boolean(
            snap.hasCompletedOnboarding || profile.hasCompletedOnboarding
          );
          if (shouldMarkOnboarded && !snap.hasCompletedOnboarding) {
            setHasCompletedOnboarding(true);
          }
          setCloudConflict(null);
          savePersonalState(
            { user: nextUser, hasCompletedOnboarding: shouldMarkOnboarded },
            { skipDirty: true, immediate: true }
          );
        }

        hasCompletedInitialCloudSyncRef.current = true;
        isCloudLoadedRef.current = true;
        setIsCloudLoaded(true);
        setCloudSyncError(null);
        setCloudDiagnosticsError(null);

        void fetchCloudBackupHistory(firebaseUser.uid)
          .then((list) => setCloudBackupHistory(list))
          .catch(() => {});

        return { restored, isProRestored: active };
      } catch (err: unknown) {
        console.warn('[signInWithGoogleAccount] Sign-in warning:', err);
        const isAr = latestPersonalRef.current.settings.language !== 'en';
        setCloudSyncError(formatUserFriendlyAuthError(err, isAr));
        return null;
      } finally {
        activeInteractiveGoogleSignInRef.current = false;
        setIsCloudSyncing(false);
      }
    })();

    inFlightGoogleSignInPromiseRef.current = task;
    try {
      return await task;
    } finally {
      if (inFlightGoogleSignInPromiseRef.current === task) {
        inFlightGoogleSignInPromiseRef.current = null;
      }
    }
  }, [applyCloudBackupLocally, applyVerifiedProState, refreshAdminStatus, refreshScanQuota, savePersonalState]);

  const signOutAndResetDevice = useCallback(
    async (options?: { backupFirst?: boolean }): Promise<{ ok: boolean; error?: string }> => {
      setIsCloudSyncing(true);
      setCloudSyncError(null);
      try {
        if (options?.backupFirst && auth.currentUser) {
          const snap = latestPersonalRef.current;
          try {
            await ensureUserProfile(auth.currentUser);
            await saveCloudBackup(
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
                orgWorkspaces: latestLocalOrgWorkspacesRef.current,
                activeWorkspace: activeWorkspaceRef.current || 'personal',
                settings: snap.settings,
                hasCompletedOnboarding: snap.hasCompletedOnboarding,
              },
              { source: 'manual', recordHistory: true }
            );
          } catch (err) {
            const msg =
              err instanceof Error
                ? err.message
                : snap.settings.language === 'en'
                ? 'Final cloud backup failed before sign out.'
                : 'تعذر رفع النسخة الاحتياطية السحابية قبل الخروج.';
            setCloudSyncError(msg);
            return { ok: false, error: msg };
          }
        }

        await signOutGoogle().catch(() => {});
        await clearLocalAppStorageAndDb().catch(() => {});

        latestVerifiedProRef.current = null;
        const cleanWallets = [createCleanDefaultWallet('EGP', 'ar')];

        setPersonalTransactions([]);
        setPersonalWallets(cleanWallets);
        setPersonalCategories(DEFAULT_CATEGORIES);
        setPersonalBudgets([]);
        setPersonalDebts([]);
        setPersonalGoals([]);
        setPersonalTemplates([]);
        setPersonalMoneyCircles([]);

        setOrgRefs([]);
        setOrgRefsLoaded(false);
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

        setLocalOrgWorkspaces({});
        latestLocalOrgWorkspacesRef.current = {};
        setLegacyLocalOrgs([]);
        setIsOrgMigrationModalOpen(false);
        setOrgMigrationSuccessMessage(null);
        setOrgActionError(null);
        setActiveWorkspace('personal');

        const preservedSignOutTheme = readStoredThemePreference();
        setSettings(
          preservedSignOutTheme
            ? {
                ...DEFAULT_SETTINGS,
                theme: preservedSignOutTheme.theme,
                ...(preservedSignOutTheme.updatedAt > 0
                  ? { themeUpdatedAt: preservedSignOutTheme.updatedAt }
                  : {}),
              }
            : DEFAULT_SETTINGS
        );
        setUser(null);
        setFirebaseAuthUser(null);
        setVerifiedPro(null);
        setDevProTierPreview(null);
        setScanQuota(null);
        setPreRestoreSnapshotDate(null);
        setLastCloudBackupExists(false);
        setCloudBackupHistory([]);
        setCloudConflict(null);
        setCloudSyncStatus('idle');
        setCloudSyncError(null);

        saveGuestModePref(false);
        saveUnsyncedDirtyFlag(false);
        setIsGuestMode(false);
        setHasCompletedOnboarding(false);
        setHasUnsyncedLocalChanges(false);

        setActiveNavState('home');
        setHomeTabState('transactions');
        setActiveWalletIdState(null);
        setIsAddModalOpenState(false);
        setTransactionDraft(null);
        setEditingTransaction(null);
        setIsSettingsOpen(false);
        setOpenAdminPanelRequested(false);
        setIsAdminCodeModalOpen(false);
        setIsLogoutModalOpen(false);
        setIsOrgHubOpen(false);
        setIsFilterOpen(false);
        setIsBackupOpen(false);
        setIsReportsOpen(false);
        setIsCategoriesManagerOpen(false);
        setIsCurrenciesManagerOpen(false);
        setIsUpgradeModalOpen(false);
        setIsAppLocked(false);
        setLockedWalletIds([]);
        setSelectedTransactionIds([]);
        setUndoAction(null);

        if (typeof window !== 'undefined') {
          const cleanUrl = `${window.location.pathname}${window.location.search}`;
          window.history.replaceState(
            {
              raseediNav: { activeNav: 'home', homeTab: 'transactions', activeWalletId: null },
              raseediDepth: 0,
            } satisfies RaseediHistoryState,
            '',
            cleanUrl
          );
          historyDepthRef.current = 0;
          historyTrailRef.current = [{ activeNav: 'home', homeTab: 'transactions', activeWalletId: null }];
          currentSyncedRouteRef.current = {
            activeNav: 'home',
            homeTab: 'transactions',
            activeWalletId: null,
          };
          modalBackStackRef.current = [];
        }

        return { ok: true };
      } finally {
        setIsCloudSyncing(false);
      }
    },
    []
  );

  const signOutGoogleAccount = useCallback(async () => {
    await signOutAndResetDevice({ backupFirst: false });
  }, [signOutAndResetDevice]);

  const refreshCloudBackupHistory = useCallback(async () => {
    if (!auth.currentUser) {
      setCloudBackupHistory([]);
      return;
    }
    try {
      const entries = await fetchCloudBackupHistory(auth.currentUser.uid);
      setCloudBackupHistory(entries);
    } catch {
      // Non-fatal
    }
  }, []);

  const syncToCloudNow = useCallback(async (_forceOverwrite = false): Promise<boolean> => {
    if (!auth.currentUser) return false;
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setCloudSyncError(null);
    const snap = latestPersonalRef.current;

    try {
      await ensureUserProfile(auth.currentUser);

      const activeCloudOrgCounts =
        isOrgWorkspace && activeOrganization && !isUsingLocalOrgMode
          ? {
              orgId: activeOrganization.id,
              orgName: activeOrganization.name,
              transactions: activeCloudTransactions.filter((tx) => !tx.deletedAt).length,
              wallets: activeCloudWallets.length,
            }
          : undefined;

      const { syncedAt, updatedAtMs, skippedAttachmentsCount, blockedEmptyOverwrite } =
        await saveCloudBackup(
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
            orgWorkspaces: latestLocalOrgWorkspacesRef.current,
            activeWorkspace: activeWorkspaceRef.current || 'personal',
            settings: snap.settings,
            hasCompletedOnboarding: snap.hasCompletedOnboarding,
          },
          {
            source: 'manual',
            recordHistory: true,
            allowEmptyOverwrite: false,
            activeCloudOrgCounts,
          }
        );

      if (blockedEmptyOverwrite) {
        setCloudSyncStatus('idle');
        return false;
      }

      // Also ensure all personal and user-owned workspace transactions are synced to the unified path
      const uid = auth.currentUser.uid;
      const personalScoped = snap.transactions.filter((tx) =>
        isActiveWorkspaceTransaction(tx, 'personal')
      );
      if (personalScoped.length > 0) {
        await batchUpsertWorkspaceTransactionsCloud(uid, 'personal', personalScoped);
      }
      for (const [wsId, wsData] of Object.entries(latestLocalOrgWorkspacesRef.current)) {
        const wsTxs = (wsData?.transactions || []).filter((tx) => !tx.deletedAt);
        if (wsTxs.length > 0) {
          await batchUpsertWorkspaceTransactionsCloud(uid, wsId, wsTxs);
        }
      }

      setCloudSkippedAttachmentsWarning(skippedAttachmentsCount);
      setLastCloudBackupExists(true);
      setCloudConflict(null);
      setCloudSyncStatus('synced');
      saveUnsyncedDirtyFlag(false);
      setHasUnsyncedLocalChanges(false);
      void refreshCloudBackupHistory();
      skipNextAutoSyncRef.current = true;
      setSettings((prev) => {
        const next = {
          ...prev,
          lastCloudSyncAt: syncedAt,
          lastKnownCloudUpdatedAtMs: updatedAtMs,
          lastBackupAt: syncedAt,
        };
        persistDataDebounced(
          { ...latestPersonalRef.current, settings: next },
          handleLocalPersistError
        );
        return next;
      });
      return true;
    } catch (err: unknown) {
      const isAr = snap.settings.language !== 'en';
      const msg = formatFirestoreErrorForDisplay(err, isAr);
      setCloudSyncStatus('error');
      setCloudSyncError(msg);
      return false;
    } finally {
      setIsCloudSyncing(false);
    }
  }, [
    refreshCloudBackupHistory,
    isOrgWorkspace,
    activeOrganization,
    isUsingLocalOrgMode,
    activeCloudTransactions,
    activeCloudWallets,
  ]);

  const restoreFromCloudNow = useCallback(async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    const reqId = ++syncRequestIdRef.current;
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setCloudSyncError(null);
    try {
      const uid = auth.currentUser.uid;
      await createPreRestoreSnapshot();
      if (reqId !== syncRequestIdRef.current) return false;
      const [profile, cloudBackup, unifiedPersonal] = await Promise.all([
        fetchUserProfile(uid),
        fetchCloudBackup(uid, { forceServer: false }),
        fetchWorkspaceTransactionsCloud(uid, 'personal', { forceServer: false }).catch(() => []),
      ]);
      if (reqId !== syncRequestIdRef.current) return false;

      const active = isEntitlementActive(profile);
      await applyVerifiedProState({
        uid,
        isPro: active,
        proPlan: active ? profile?.proPlan || 'code' : 'free',
        planTier: resolvePlanTierFromProfile(profile),
        billingCycle: active ? profile?.billingCycle || 'lifetime' : 'free',
        expiresAt: profile?.proExpiresAt ?? profile?.expiresAt ?? null,
        proExpiresAt: profile?.proExpiresAt ?? profile?.expiresAt ?? null,
        verifiedAt: Date.now(),
      });
      if (reqId !== syncRequestIdRef.current) return false;
      void refreshScanQuota();

      if (cloudBackup || unifiedPersonal.length > 0) {
        const mergedPersonal =
          unifiedPersonal.length > 0
            ? reconcileWorkspaceTransactions(unifiedPersonal, cloudBackup?.transactions || [], {
                activeWorkspaceId: 'personal',
                hasServerSnapshot: false,
              })
            : (cloudBackup?.transactions || []).filter((tx) =>
                isActiveWorkspaceTransaction(tx, 'personal')
              );

        if (cloudBackup) {
          applyCloudBackupLocally(
            { ...cloudBackup, transactions: mergedPersonal },
            latestPersonalRef.current.user
          );
        } else {
          skipNextAutoSyncRef.current = true;
          setPersonalTransactions(mergedPersonal);
          persistDataDebounced(
            {
              ...latestPersonalRef.current,
              transactions: mergedPersonal,
            },
            handleLocalPersistError
          );
        }
        setLastCloudBackupExists(true);
        return true;
      }
      setCloudSyncStatus('idle');
      return active;
    } catch (err: unknown) {
      if (reqId !== syncRequestIdRef.current) return false;
      const msg = formatFirestoreErrorForDisplay(
        err,
        latestPersonalRef.current.settings.language === 'ar'
      );
      console.error('[restoreFromCloudNow] failed:', err);
      setCloudSyncStatus('error');
      setCloudSyncError(msg);
      setCloudDiagnosticsError(msg);
      return false;
    } finally {
      if (reqId === syncRequestIdRef.current) {
        setIsCloudSyncing(false);
      }
    }
  }, [applyCloudBackupLocally, applyVerifiedProState, createPreRestoreSnapshot, refreshScanQuota]);

  const emergencyCloudRecovery = useCallback(async (): Promise<{
    ok: boolean;
    recoveredPersonalCount: number;
    recoveredOrgCount: number;
    errorMessage?: string;
  }> => {
    const isAr = latestPersonalRef.current.settings.language === 'ar';
    if (!auth.currentUser) {
      const msg = isAr
        ? 'يرجى تسجيل الدخول بحساب جوجل أولاً لاسترجاع بياناتك من السحابة.'
        : 'Please sign in with Google first to recover your data from the cloud.';
      setCloudDiagnosticsError(msg);
      return { ok: false, recoveredPersonalCount: 0, recoveredOrgCount: 0, errorMessage: msg };
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const msg = isAr
        ? 'الجهاز غير متصل بالإنترنت. يرجى الاتصال بالإنترنت وإعادة المحاولة.'
        : 'Device is offline. Connect to the internet and try again.';
      setCloudDiagnosticsError(msg);
      return { ok: false, recoveredPersonalCount: 0, recoveredOrgCount: 0, errorMessage: msg };
    }

    const reqId = ++syncRequestIdRef.current;
    isEmergencyRecoveryActiveRef.current = true;
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setCloudSyncError(null);
    setCloudDiagnosticsError(null);

    try {
      const uid = auth.currentUser.uid;
      const currentWsId = normalizeWorkspaceId(activeWorkspaceRef.current);
      const isSharedCloudOrg =
        currentWsId !== 'personal' &&
        !latestLocalOrgWorkspacesRef.current[currentWsId] &&
        orgRefs.some((r) => r.orgId === currentWsId);

      await createPreRestoreSnapshot().catch(() => {});
      if (reqId !== syncRequestIdRef.current) {
        return { ok: false, recoveredPersonalCount: 0, recoveredOrgCount: 0 };
      }

      pendingLocalTxIdsRef.current.clear();
      locallyDeletedTxIdsRef.current.clear();
      skipNextAutoSyncRef.current = true;

      let recoveredPersonalCount = 0;
      let recoveredOrgCount = 0;

      if (isSharedCloudOrg) {
        // Shared multi-user org workspace: recover strictly from /organizations/{orgId}/transactions
        setActiveCloudTransactions([]);
        setActiveCloudTrashTransactions([]);
        setExtraOrgTransactions([]);
        setExtraOrgTrashTransactions([]);
        const orgRes = await forceFetchOrgTransactionsFromServer(currentWsId);
        if (reqId !== syncRequestIdRef.current) {
          return { ok: false, recoveredPersonalCount: 0, recoveredOrgCount: 0 };
        }
        setActiveCloudTransactions(orgRes.active);
        setActiveCloudTrashTransactions(orgRes.trash);
        setOrgHasMoreTx(false);
        recoveredOrgCount = orgRes.active.length;
      } else {
        // Unified user-scoped workspace recovery ('personal' OR user-owned local org workspace)
        // 1. Clear ONLY the active workspace's local transactions cache before forced server fetch
        if (currentWsId === 'personal') {
          setPersonalTransactions([]);
          if (typeof window !== 'undefined') {
            try {
              const raw = localStorage.getItem('raseedi_data_v1');
              if (raw) {
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                localStorage.setItem(
                  'raseedi_data_v1',
                  JSON.stringify({ ...parsed, transactions: [] })
                );
              }
            } catch {
              // ignore localStorage cache parse failures
            }
          }
        } else {
          const existingLocalOrg = latestLocalOrgWorkspacesRef.current[currentWsId];
          if (existingLocalOrg) {
            const clearedMap: Record<string, OrgWorkspaceData> = {
              ...latestLocalOrgWorkspacesRef.current,
              [currentWsId]: {
                ...existingLocalOrg,
                transactions: [],
              },
            };
            latestLocalOrgWorkspacesRef.current = clearedMap;
            setLocalOrgWorkspaces(clearedMap);
            void saveOrgWorkspaces(activeWorkspaceRef.current, clearedMap);
          }
        }

        // 2. Force server-direct fetch from unified path users/{uid}/workspaces/{wsId}/transactions
        const unifiedServerTxs = await fetchWorkspaceTransactionsCloud(uid, currentWsId, {
          forceServer: true,
        });
        if (reqId !== syncRequestIdRef.current) {
          return { ok: false, recoveredPersonalCount: 0, recoveredOrgCount: 0 };
        }

        // 3. Also check legacy backupChunks / backupHistory for non-migrated transactions strictly matching currentWsId
        let cloudBackup = await fetchCloudBackup(uid, { forceServer: true }).catch((err) => {
          console.warn('[EmergencyRecovery] Legacy backup fetch note:', err);
          return null;
        });
        if (reqId !== syncRequestIdRef.current) {
          return { ok: false, recoveredPersonalCount: 0, recoveredOrgCount: 0 };
        }
        if (!cloudBackup || (cloudBackup.transactions || []).length === 0) {
          const historyFallback = await fetchLatestCloudBackupFromHistory(uid, {
            forceServer: true,
          }).catch(() => null);
          if (reqId !== syncRequestIdRef.current) {
            return { ok: false, recoveredPersonalCount: 0, recoveredOrgCount: 0 };
          }
          if (historyFallback && (historyFallback.transactions || []).length > 0) {
            cloudBackup = cloudBackup
              ? {
                  ...cloudBackup,
                  ...historyFallback,
                  transactions: historyFallback.transactions,
                  wallets:
                    (cloudBackup.wallets || []).length > 0
                      ? cloudBackup.wallets
                      : historyFallback.wallets,
                }
              : historyFallback;
          }
        }

        const legacyWorkspaceTxs =
          currentWsId === 'personal'
            ? (cloudBackup?.transactions || []).filter((tx) =>
                isActiveWorkspaceTransaction(tx, 'personal')
              )
            : (cloudBackup?.orgWorkspaces?.[currentWsId]?.transactions || []).filter(
                (tx) => !tx.deletedAt
              );

        // Merge unified docs (authoritative) + any legacy-only docs strictly within currentWsId
        const unifiedIds = new Set(unifiedServerTxs.map((t) => t.id));
        const missingInUnified = legacyWorkspaceTxs.filter((tx) => tx?.id && !unifiedIds.has(tx.id));
        if (missingInUnified.length > 0) {
          await batchUpsertWorkspaceTransactionsCloud(uid, currentWsId, missingInUnified).catch(
            (err) => console.warn('[EmergencyRecovery] Unified backfill warning:', err)
          );
          if (reqId !== syncRequestIdRef.current) {
            return { ok: false, recoveredPersonalCount: 0, recoveredOrgCount: 0 };
          }
        }

        const recoveredForWorkspace = reconcileWorkspaceTransactions(
          unifiedServerTxs,
          missingInUnified,
          {
            activeWorkspaceId: currentWsId,
            hasServerSnapshot: false,
          }
        );

        if (currentWsId === 'personal') {
          recoveredPersonalCount = recoveredForWorkspace.length;
          if (cloudBackup) {
            applyCloudBackupLocally(
              { ...cloudBackup, transactions: recoveredForWorkspace },
              latestPersonalRef.current.user
            );
          } else {
            setPersonalTransactions(recoveredForWorkspace);
            persistDataDebounced(
              {
                ...latestPersonalRef.current,
                transactions: recoveredForWorkspace,
              },
              handleLocalPersistError
            );
          }
          setLastCloudBackupExists(Boolean(cloudBackup || recoveredForWorkspace.length > 0));
        } else {
          recoveredOrgCount = recoveredForWorkspace.length;
          const targetWs =
            latestLocalOrgWorkspacesRef.current[currentWsId] ||
            cloudBackup?.orgWorkspaces?.[currentWsId];
          if (targetWs) {
            const nextMap: Record<string, OrgWorkspaceData> = {
              ...latestLocalOrgWorkspacesRef.current,
              [currentWsId]: {
                ...targetWs,
                transactions: recoveredForWorkspace,
              },
            };
            latestLocalOrgWorkspacesRef.current = nextMap;
            setLocalOrgWorkspaces(nextMap);
            void saveOrgWorkspaces(activeWorkspaceRef.current, nextMap);
          }
          setLastCloudBackupExists(Boolean(cloudBackup || recoveredForWorkspace.length > 0));
        }
      }

      await fetchCloudBackupHistory(uid, { forceServer: true })
        .then((list) => {
          if (reqId === syncRequestIdRef.current) setCloudBackupHistory(list);
        })
        .catch(() => {});
      if (reqId !== syncRequestIdRef.current) {
        return { ok: false, recoveredPersonalCount: 0, recoveredOrgCount: 0 };
      }

      setCloudSyncStatus('synced');
      return {
        ok: true,
        recoveredPersonalCount,
        recoveredOrgCount,
      };
    } catch (err) {
      if (reqId !== syncRequestIdRef.current) {
        return { ok: false, recoveredPersonalCount: 0, recoveredOrgCount: 0 };
      }
      console.error('[Emergency Cloud Recovery Error]', err);
      const formatted = formatFirestoreErrorForDisplay(err, isAr);
      setCloudSyncStatus('error');
      setCloudSyncError(formatted);
      setCloudDiagnosticsError(formatted);
      return {
        ok: false,
        recoveredPersonalCount: 0,
        recoveredOrgCount: 0,
        errorMessage: formatted,
      };
    } finally {
      if (reqId === syncRequestIdRef.current) {
        isEmergencyRecoveryActiveRef.current = false;
        setIsCloudSyncing(false);
      }
    }
  }, [applyCloudBackupLocally, createPreRestoreSnapshot, orgRefs]);

  const restoreFromBackupHistoryEntry = useCallback(
    async (backupId: string): Promise<boolean> => {
      if (!auth.currentUser || !backupId) return false;
      setIsCloudSyncing(true);
      setCloudSyncStatus('syncing');
      setCloudSyncError(null);
      try {
        await createPreRestoreSnapshot();
        const entryBackup = await fetchCloudBackupFromHistory(auth.currentUser.uid, backupId);
        if (!entryBackup) {
          setCloudSyncStatus('error');
          return false;
        }
        applyCloudBackupLocally(entryBackup, latestPersonalRef.current.user);
        setLastCloudBackupExists(true);
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Cloud history restore failed';
        setCloudSyncStatus('error');
        setCloudSyncError(msg);
        return false;
      } finally {
        setIsCloudSyncing(false);
      }
    },
    [applyCloudBackupLocally, createPreRestoreSnapshot]
  );

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
          try {
            await deleteAccountFromServer();
          } catch (err) {
            if (!shouldFallbackAccountDeleteError(err)) {
              const errorCode = extractAccountDeleteErrorCode(err) || undefined;
              const msg = err instanceof Error ? err.message : 'Account deletion failed';
              setCloudSyncError(msg);
              return { ok: false, errorCode, errorMessage: msg };
            }
            console.warn('Account delete fallback triggered:', err);
          }
          await signOutGoogle().catch(() => {});
        }
        await clearLocalAppStorageAndDb();
        latestVerifiedProRef.current = null;
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
        setLocalOrgWorkspaces({});
        latestLocalOrgWorkspacesRef.current = {};
        setLegacyLocalOrgs([]);
        setIsOrgMigrationModalOpen(false);
        setOrgActionError(null);
        setActiveWorkspace('personal');
        const preservedDeleteTheme = readStoredThemePreference();
        setSettings(
          preservedDeleteTheme
            ? {
                ...DEFAULT_SETTINGS,
                theme: preservedDeleteTheme.theme,
                ...(preservedDeleteTheme.updatedAt > 0
                  ? { themeUpdatedAt: preservedDeleteTheme.updatedAt }
                  : {}),
              }
            : DEFAULT_SETTINGS
        );
        setUser(null);
        setVerifiedPro(null);
        setDevProTierPreview(null);
        setScanQuota(null);
        setPreRestoreSnapshotDate(null);
        setLastCloudBackupExists(false);
        setCloudConflict(null);
        setCloudSyncStatus('idle');
        setCloudSyncError(null);
        setIsGuestMode(false);
        setHasUnsyncedLocalChanges(false);
        setHasCompletedOnboarding(false);
        return { ok: true };
      } catch (err) {
        // Even on unexpected local error, still reset session cleanly
        await signOutGoogle().catch(() => {});
        await clearLocalAppStorageAndDb().catch(() => {});
        setUser(null);
        setVerifiedPro(null);
        setCloudSyncStatus('idle');
        setCloudSyncError(null);
        return { ok: true };
      }
    },
    []
  );

  // Silent Auto Cloud Sync (personal & local-first org state, keeping last 7 auto backups)
  useEffect(() => {
    if (!hasCompletedOnboarding) return;
    if (
      !canPerformAutomaticCloudWrite({
        isAuthenticated: Boolean(user?.isLoggedIn && auth.currentUser),
        isCloudLoaded:
          isCloudLoaded &&
          hasCompletedInitialCloudSyncRef.current &&
          isCloudLoadedRef.current,
        isEmergencyRecoveryActive: isEmergencyRecoveryActiveRef.current,
      })
    ) {
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (skipNextAutoSyncRef.current) {
      skipNextAutoSyncRef.current = false;
      return;
    }

    const timer = window.setTimeout(async () => {
      if (
        !canPerformAutomaticCloudWrite({
          isAuthenticated: Boolean(auth.currentUser),
          isCloudLoaded:
            hasCompletedInitialCloudSyncRef.current && isCloudLoadedRef.current,
          isEmergencyRecoveryActive: isEmergencyRecoveryActiveRef.current,
        }) ||
        !auth.currentUser
      ) {
        return;
      }
      const snap = latestPersonalRef.current;
      if (lastCloudBackupExists && snap.transactions.length === 0) {
        console.warn(
          '[AutoCloudSync] Skipped automatic upload because local transactions are empty while cloud backup exists.'
        );
        return;
      }
      try {
        setCloudSyncStatus('syncing');

        const autoActiveCloudOrgCounts =
          isOrgWorkspace && activeOrganization && !isUsingLocalOrgMode
            ? {
                orgId: activeOrganization.id,
                orgName: activeOrganization.name,
                transactions: activeCloudTransactions.filter((tx) => !tx.deletedAt).length,
                wallets: activeCloudWallets.length,
              }
            : undefined;

        const { syncedAt, updatedAtMs, skippedAttachmentsCount, blockedEmptyOverwrite } =
          await saveCloudBackup(
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
              orgWorkspaces: latestLocalOrgWorkspacesRef.current,
              activeWorkspace: activeWorkspaceRef.current || 'personal',
              settings: snap.settings,
              hasCompletedOnboarding: snap.hasCompletedOnboarding,
            },
            {
              source: 'auto',
              recordHistory: true,
              allowEmptyOverwrite: false,
              activeCloudOrgCounts: autoActiveCloudOrgCounts,
            }
          );

        if (blockedEmptyOverwrite) {
          setCloudSyncStatus('idle');
          return;
        }

        setCloudSkippedAttachmentsWarning(skippedAttachmentsCount);
        setLastCloudBackupExists(true);
        setCloudConflict(null);
        setCloudSyncStatus('synced');
        setCloudSyncError(null);
        saveUnsyncedDirtyFlag(false);
        setHasUnsyncedLocalChanges(false);
        void refreshCloudBackupHistory();
        skipNextAutoSyncRef.current = true;
        setSettings((prev) => {
          const next = {
            ...prev,
            lastCloudSyncAt: syncedAt,
            lastKnownCloudUpdatedAtMs: updatedAtMs,
          };
          persistDataDebounced(
            { ...latestPersonalRef.current, settings: next },
            handleLocalPersistError
          );
          return next;
        });
      } catch (err) {
        const isAr = snap.settings.language !== 'en';
        const msg = formatFirestoreErrorForDisplay(err, isAr);
        setCloudSyncStatus('error');
        setCloudSyncError(msg);
      }
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [
    user?.isLoggedIn,
    hasCompletedOnboarding,
    isCloudLoaded,
    lastCloudBackupExists,
    personalTransactions,
    personalWallets,
    personalCategories,
    personalBudgets,
    personalDebts,
    personalGoals,
    personalTemplates,
    personalMoneyCircles,
    localOrgWorkspaces,
    settings,
    refreshCloudBackupHistory,
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
      userSubscriptionSummary: subscriptionSummary,
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
    subscriptionSummary,
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
          setSettings((prev) => {
            const updatedSettings: AppSettings = {
              ...prev,
              appPin: result.newHash,
              appPinSalt: result.newSalt,
            };
            savePersonalState({ settings: updatedSettings });
            return updatedSettings;
          });
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
              // PIN hashes remain strictly local (never uploaded to organization Firestore docs)
              if (isUsingLocalOrgMode) {
                mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
                  ...ws,
                  wallets: ws.wallets.map((w) => (w.id === walletId ? upgraded : w)),
                }));
              }
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
    [
      wallets,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      mutateLocalOrgWorkspace,
      personalWallets,
      getOrgActor,
      savePersonalState,
    ]
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
      syncRequestIdRef.current += 1;
      setSelectedTransactionIds([]);
      setActiveWalletId(null);
      setOrgActionError(null);
      resetFilters();
      if (workspaceId === 'personal') {
        setActiveWorkspace('personal');
        saveActiveWorkspacePref('personal');
        return;
      }
      if (
        orgRefs.some((r) => r.orgId === workspaceId) ||
        Boolean(latestLocalOrgWorkspacesRef.current[workspaceId])
      ) {
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

  const completeLegacyOrgMigration = useCallback(
    async (
      migratedOrgIds: string[],
      options?: {
        keepLocalWorkspaces?: boolean;
        migratedToCloudIds?: Record<string, string>;
      }
    ): Promise<{
      retainedOrgs: Array<{
        orgId: string;
        orgName: string;
        summary: UnmigratedOrgExtrasSummary;
      }>;
    }> => {
      const idSet = new Set(migratedOrgIds);
      const currentStored = await loadOrgWorkspaces();
      const nextMap: Record<string, OrgWorkspaceData> = {};
      const retainedOrgs: Array<{
        orgId: string;
        orgName: string;
        summary: UnmigratedOrgExtrasSummary;
      }> = [];
      const now = Date.now();

      for (const [k, ws] of Object.entries(currentStored.workspaces || {})) {
        const orgId = ws?.organization?.id || k;
        if (idSet.has(k) || idSet.has(orgId)) {
          if (options?.keepLocalWorkspaces && ws) {
            nextMap[k] = {
              ...ws,
              organization: {
                ...ws.organization,
                localFirstMode: true,
                cloudBackedUpAt: now,
                updatedAt: now,
              },
            };
          } else if (ws) {
            const extrasSummary = getUnmigratedOrgExtrasSummary(ws);
            if (extrasSummary.hasUnmigratedExtras) {
              const targetCloudId =
                options?.migratedToCloudIds?.[orgId] ||
                options?.migratedToCloudIds?.[k] ||
                orgId;
              nextMap[targetCloudId] = retainUnmigratedLocalOrgExtras(ws, targetCloudId, now);
              retainedOrgs.push({
                orgId: targetCloudId,
                orgName: ws.organization?.name || orgId,
                summary: extrasSummary,
              });
            }
          }
        } else if (ws) {
          nextMap[k] = ws;
        }
      }

      latestLocalOrgWorkspacesRef.current = nextMap;
      setLocalOrgWorkspaces(nextMap);
      await saveOrgWorkspaces(activeWorkspaceRef.current || 'personal', nextMap);
      setLegacyLocalOrgs((prev) => {
        const next = prev.filter((item) => !idSet.has(item.organization.id));
        if (next.length === 0) {
          setIsOrgMigrationModalOpen(false);
        }
        return next;
      });
      return { retainedOrgs };
    },
    []
  );

  const queueLegacyOrgsForMigration = useCallback((workspaces: Record<string, OrgWorkspaceData>) => {
    const list = Object.values(workspaces || {}).filter(
      (w): w is OrgWorkspaceData =>
        Boolean(w && w.organization && w.organization.id && !isRetainedExtrasOnlyWorkspace(w))
    );
    if (list.length === 0) return;
    const mergedMap = { ...latestLocalOrgWorkspacesRef.current, ...workspaces };
    latestLocalOrgWorkspacesRef.current = mergedMap;
    setLocalOrgWorkspaces(mergedMap);
    void saveOrgWorkspaces(activeWorkspaceRef.current || 'personal', mergedMap);
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
      const currentUid = auth.currentUser?.uid || user?.id || 'local-owner';
      const actorName =
        user?.name ||
        auth.currentUser?.displayName ||
        auth.currentUser?.email?.split('@')[0] ||
        (settings.language === 'en' ? 'Owner' : 'المالك');
      const actorEmail = user?.email || auth.currentUser?.email || undefined;
      const cleanName = params.name.trim() || (settings.language === 'en' ? 'My Company' : 'شركتي');
      const cleanCurrency = (params.currency || settings.mainCurrency || 'EGP').trim().toUpperCase();
      const cleanIndustry: OrganizationIndustry = params.industry || 'general';
      const cleanVatRate = params.vatRate ?? 14;
      const cleanApprovalThreshold = params.approvalThreshold ?? 2000;
      const cleanTaxNumber = params.taxNumber?.trim() || undefined;

      const isSignedInOnline =
        Boolean(auth.currentUser?.uid) &&
        Boolean(user?.isLoggedIn) &&
        (typeof navigator === 'undefined' || navigator.onLine);

      // 1. When signed in with Google & online: create a genuine Cloud Organization immediately
      //    so Team collaboration (adding members via Email / @username) works from the very first second,
      //    including for 2nd/3rd organizations and static deployments like Vercel.
      if (isSignedInOnline && auth.currentUser) {
        try {
          await ensureUserProfile(auth.currentUser).catch(() => null);
          let createdCloud: {
            orgId: string;
            organization: Organization;
            orgRef: OrgRef;
          } | null = null;

          try {
            const serverRes = await createOrgOnServer({
              name: cleanName,
              currency: cleanCurrency,
              industry: cleanIndustry,
              vatRate: cleanVatRate,
              approvalThreshold: cleanApprovalThreshold,
              taxNumber: cleanTaxNumber,
              loadSampleData: Boolean(params.loadSampleData),
            });
            createdCloud = {
              orgId: serverRes.orgId,
              organization: { ...serverRes.organization, localFirstMode: false },
              orgRef: {
                orgId: serverRes.orgId,
                orgName: serverRes.organization.name || cleanName,
                role: 'owner',
                status: 'active',
                currency: serverRes.organization.currency || cleanCurrency,
                joinedAt: Date.now(),
              },
            };
          } catch {
            // Static hosting (e.g. Vercel) without Express Admin SDK -> direct atomic Firestore creation
            createdCloud = await createCloudOrganizationDirect({
              name: cleanName,
              currency: cleanCurrency,
              industry: cleanIndustry,
              vatRate: cleanVatRate,
              approvalThreshold: cleanApprovalThreshold,
              taxNumber: cleanTaxNumber,
              loadSampleData: Boolean(params.loadSampleData),
            });
          }

          if (createdCloud) {
            const { orgId, organization, orgRef } = createdCloud;
            // Optimistically register Cloud OrgRef so isCloudOrg is true immediately
            setOrgRefs((prev) =>
              prev.some((r) => r.orgId === orgId)
                ? prev.map((r) => (r.orgId === orgId ? orgRef : r))
                : [...prev, orgRef]
            );
            setActiveCloudOrg(organization);

            // Ensure no stale local-only shadow exists for the same ID
            if (latestLocalOrgWorkspacesRef.current[orgId]) {
              const cleanedLocal = { ...latestLocalOrgWorkspacesRef.current };
              delete cleanedLocal[orgId];
              latestLocalOrgWorkspacesRef.current = cleanedLocal;
              setLocalOrgWorkspaces(cleanedLocal);
              await saveOrgWorkspaces(orgId, cleanedLocal);
            }

            setActiveWorkspace(orgId);
            saveActiveWorkspacePref(orgId);
            setHasCompletedOnboarding(true);
            savePersonalState({ hasCompletedOnboarding: true });
            setOrgActionError(null);
            return organization;
          }
        } catch (cloudErr) {
          console.warn(
            '[createOrganization] Direct cloud creation fell back to offline local workspace:',
            cloudErr
          );
        }
      }

      // 2. Offline / Guest fallback: create local-first workspace in IndexedDB
      const localWs = buildLocalOrgWorkspace({
        name: cleanName,
        currency: cleanCurrency,
        industry: cleanIndustry,
        vatRate: cleanVatRate,
        approvalThreshold: cleanApprovalThreshold,
        taxNumber: cleanTaxNumber,
        loadSampleData: Boolean(params.loadSampleData),
        actor: { uid: currentUid, name: actorName, email: actorEmail },
      });

      const orgId = localWs.organization.id;
      const nextMap: Record<string, OrgWorkspaceData> = {
        ...latestLocalOrgWorkspacesRef.current,
        [orgId]: localWs,
      };

      latestLocalOrgWorkspacesRef.current = nextMap;
      setLocalOrgWorkspaces(nextMap);
      await saveOrgWorkspaces(orgId, nextMap);

      setActiveWorkspace(orgId);
      saveActiveWorkspacePref(orgId);
      setHasCompletedOnboarding(true);
      savePersonalState({ hasCompletedOnboarding: true });
      setOrgActionError(null);

      return localWs.organization;
    },
    [user?.isLoggedIn, user?.id, user?.name, user?.email, settings.language, settings.mainCurrency, savePersonalState]
  );

  const upgradeLocalOrgToCloud = useCallback(
    async (
      orgId: string,
      onProgress?: (completed: number, total: number) => void
    ): Promise<{
      ok: boolean;
      orgId?: string;
      error?: string;
      retainedExtrasNotice?: string;
    }> => {
      const isAr = latestPersonalRef.current.settings.language !== 'en';
      if (!auth.currentUser?.uid || !user?.isLoggedIn) {
        return {
          ok: false,
          error: isAr
            ? 'يرجى تسجيل الدخول بحساب Google أولاً لتحويل المؤسسة إلى مؤسسة سحابية.'
            : 'Please sign in with Google first to upgrade this organization to Cloud.',
        };
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return {
          ok: false,
          error: isAr
            ? 'لا يوجد اتصال بالإنترنت. اتصل بالإنترنت ثم حاول مرة أخرى.'
            : 'You are offline. Please reconnect and try again.',
        };
      }

      const localWs = latestLocalOrgWorkspacesRef.current[orgId];
      if (!localWs) {
        return {
          ok: false,
          error: isAr ? 'تعذر العثور على بيانات المؤسسة المحلية.' : 'Local organization data not found.',
        };
      }

      try {
        await auth.currentUser.reload().catch(() => null);
        await auth.currentUser.getIdToken(true).catch(() => null);
        if (auth.currentUser.emailVerified === false) {
          return {
            ok: false,
            error: isAr
              ? 'يرجى تأكيد بريدك الإلكتروني في حساب Google أولاً ثم إعادة المحاولة.'
              : 'Please verify your Google account email address first, then try again.',
          };
        }

        await ensureUserProfile(auth.currentUser).catch(() => null);
        const result = await createCloudOrganizationDirect({
          name: localWs.organization.name,
          currency: localWs.organization.currency || settings.mainCurrency || 'EGP',
          industry: localWs.organization.industry || 'general',
          vatRate: localWs.organization.vatRate ?? 14,
          taxNumber: localWs.organization.taxNumber,
          approvalThreshold: localWs.organization.approvalThreshold ?? 2000,
          preferredOrgId: orgId,
          seedWorkspace: localWs,
          onMigrationProgress: onProgress,
        });

        // Register Cloud OrgRef immediately in state
        setOrgRefs((prev) =>
          prev.some((r) => r.orgId === result.orgId)
            ? prev.map((r) => (r.orgId === result.orgId ? result.orgRef : r))
            : [...prev, result.orgRef]
        );
        setActiveCloudOrg(result.organization);

        // Protect unmigrated local-only collections (debts, goals, templates) safely
        // without creating duplicate workspace entries in the switcher.
        const extrasSummary = getUnmigratedOrgExtrasSummary(localWs);
        const retainedExtrasNotice = extrasSummary.hasUnmigratedExtras
          ? formatUnmigratedOrgExtrasNotice(extrasSummary, isAr)
          : undefined;

        const nextLocalMap = { ...latestLocalOrgWorkspacesRef.current };
        delete nextLocalMap[orgId];
        if (extrasSummary.hasUnmigratedExtras) {
          nextLocalMap[result.orgId] = retainUnmigratedLocalOrgExtras(localWs, result.orgId);
        }
        latestLocalOrgWorkspacesRef.current = nextLocalMap;
        setLocalOrgWorkspaces(nextLocalMap);
        await saveOrgWorkspaces(result.orgId, nextLocalMap);

        if (!extrasSummary.hasUnmigratedExtras || result.orgId !== orgId) {
          void removeOrgWorkspaceFromBackupMeta(auth.currentUser.uid, orgId).catch(() => null);
        }

        setActiveWorkspace(result.orgId);
        saveActiveWorkspacePref(result.orgId);
        setOrgActionError(null);
        showToast(
          retainedExtrasNotice
            ? isAr
              ? `تم تحويل "${result.organization.name}" إلى مؤسسة سحابية بنجاح! ${retainedExtrasNotice}`
              : `"${result.organization.name}" upgraded to Cloud! ${retainedExtrasNotice}`
            : isAr
            ? `تم تحويل "${result.organization.name}" إلى مؤسسة سحابية بنجاح — يمكنك الآن إضافة أعضاء الفريق!`
            : `"${result.organization.name}" upgraded to Cloud Organization — you can now add team members!`,
          retainedExtrasNotice ? 'warning' : 'success'
        );
        return { ok: true, orgId: result.orgId, retainedExtrasNotice };
      } catch (err) {
        const msg = formatFirestoreErrorForDisplay(err, isAr);
        return { ok: false, error: msg };
      }
    },
    [user?.isLoggedIn, settings.mainCurrency, showToast]
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
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
          ...ws,
          organization: {
            ...ws.organization,
            ...updates,
            updatedAt: Date.now(),
          },
          auditLogs: appendLocalOrgAuditLog(
            ws,
            'update',
            'organization',
            ws.organization.id,
            actor,
            'تحديث إعدادات المؤسسة'
          ),
        }));
        return;
      }
      void updateOrgSettingsCloud(
        activeOrganization.id,
        activeOrganization,
        updates,
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Update failed'));
    },
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgManage,
      getOrgActor,
      mutateLocalOrgWorkspace,
    ]
  );

  const lockAccountingPeriod = useCallback(
    (lockedUntilDate: string | undefined) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgManage) return;
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
          ...ws,
          organization: {
            ...ws.organization,
            lockedUntilDate: lockedUntilDate || undefined,
            updatedAt: Date.now(),
          },
          auditLogs: appendLocalOrgAuditLog(
            ws,
            'lock_period',
            'organization',
            ws.organization.id,
            actor,
            lockedUntilDate
              ? `إقفال الفترة المحاسبية حتى ${lockedUntilDate}`
              : 'إلغاء إقفال الفترة المحاسبية'
          ),
        }));
        return;
      }
      void updateOrgSettingsCloud(
        activeOrganization.id,
        activeOrganization,
        { lockedUntilDate: lockedUntilDate || undefined },
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Lock failed'));
    },
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgManage,
      getOrgActor,
      mutateLocalOrgWorkspace,
    ]
  );

  const approveOrgTransaction = useCallback(
    (txId: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return;
      const target = orgTransactions.find((tx) => tx.id === txId);
      if (!target || normalizeApprovalStatus(target.approvalStatus) === 'approved') return;
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        const now = Date.now();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => {
          const existing = (ws.transactions || []).find((tx) => tx.id === txId);
          if (!existing) return ws;
          const walletsReversed = applyOrgTxBalanceToWallets(
            ws.wallets || [],
            existing,
            settings.customExchangeRates,
            -1
          );
          const updatedTx: Transaction = {
            ...existing,
            approvalStatus: 'approved',
            approvedBy: actor.uid,
            approvedAt: now,
            reviewedBy: actor.name,
            reviewedAt: now,
            rejectionReason: undefined,
            updatedAt: now,
          };
          const walletsApplied = applyOrgTxBalanceToWallets(
            walletsReversed,
            updatedTx,
            settings.customExchangeRates,
            1
          );
          return {
            ...ws,
            wallets: walletsApplied,
            transactions: (ws.transactions || []).map((tx) => (tx.id === txId ? updatedTx : tx)),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'approve',
              'transaction',
              txId,
              actor,
              `اعتماد قيد مالي (${updatedTx.amount} ${updatedTx.currency})`
            ),
          };
        });
        return;
      }
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
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgApprove,
      orgTransactions,
      activeCloudWallets,
      settings.customExchangeRates,
      getOrgActor,
      mutateLocalOrgWorkspace,
    ]
  );

  const rejectOrgTransaction = useCallback(
    (txId: string, reason: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return;
      const target = orgTransactions.find((tx) => tx.id === txId);
      if (!target) return;
      const cleanReason = reason.trim() || 'Rejected';
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        const now = Date.now();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => {
          const existing = (ws.transactions || []).find((tx) => tx.id === txId);
          if (!existing) return ws;
          const walletsReversed = applyOrgTxBalanceToWallets(
            ws.wallets || [],
            existing,
            settings.customExchangeRates,
            -1
          );
          const updatedTx: Transaction = {
            ...existing,
            approvalStatus: 'rejected',
            reviewedBy: actor.name,
            reviewedAt: now,
            rejectionReason: cleanReason,
            updatedAt: now,
          };
          return {
            ...ws,
            wallets: walletsReversed,
            transactions: (ws.transactions || []).map((tx) => (tx.id === txId ? updatedTx : tx)),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'reject',
              'transaction',
              txId,
              actor,
              `رفض قيد مالي: ${cleanReason}`
            ),
          };
        });
        return;
      }
      void approveOrRejectOrMarkPaidOrgTxCloud(
        activeOrganization.id,
        target,
        'rejected',
        activeCloudWallets,
        settings.customExchangeRates,
        getOrgActor(),
        cleanReason
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Rejection failed'));
    },
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgApprove,
      orgTransactions,
      activeCloudWallets,
      settings.customExchangeRates,
      getOrgActor,
      mutateLocalOrgWorkspace,
    ]
  );

  const markOrgTransactionPaid = useCallback(
    (txId: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return;
      const target = orgTransactions.find((tx) => tx.id === txId);
      if (!target || normalizeApprovalStatus(target.approvalStatus) === 'paid') return;
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        const now = Date.now();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => {
          const existing = (ws.transactions || []).find((tx) => tx.id === txId);
          if (!existing) return ws;
          const walletsReversed = applyOrgTxBalanceToWallets(
            ws.wallets || [],
            existing,
            settings.customExchangeRates,
            -1
          );
          const updatedTx: Transaction = {
            ...existing,
            approvalStatus: 'paid',
            approvedBy: existing.approvedBy || actor.uid,
            approvedAt: existing.approvedAt || now,
            reviewedBy: actor.name,
            reviewedAt: now,
            updatedAt: now,
          };
          const walletsApplied = applyOrgTxBalanceToWallets(
            walletsReversed,
            updatedTx,
            settings.customExchangeRates,
            1
          );
          return {
            ...ws,
            wallets: walletsApplied,
            transactions: (ws.transactions || []).map((tx) => (tx.id === txId ? updatedTx : tx)),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'approve',
              'transaction',
              txId,
              actor,
              `صرف/تسوية قيد مالي (${updatedTx.amount} ${updatedTx.currency})`
            ),
          };
        });
        return;
      }
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
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgApprove,
      orgTransactions,
      activeCloudWallets,
      settings.customExchangeRates,
      getOrgActor,
      mutateLocalOrgWorkspace,
    ]
  );

  const restoreOrgTransaction = useCallback(
    (txId: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgWrite) return;
      const target = orgTrashTransactions.find((tx) => tx.id === txId);
      if (!target) return;
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        const now = Date.now();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => {
          const existing = (ws.transactions || []).find((tx) => tx.id === txId);
          if (!existing) return ws;
          const restoredTx: Transaction = {
            ...existing,
            deletedAt: null,
            deletedBy: null,
            updatedAt: now,
          };
          const nextWallets = applyOrgTxBalanceToWallets(
            ws.wallets || [],
            restoredTx,
            settings.customExchangeRates,
            1
          );
          return {
            ...ws,
            wallets: nextWallets,
            transactions: (ws.transactions || []).map((tx) => (tx.id === txId ? restoredTx : tx)),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'restore',
              'transaction',
              txId,
              actor,
              `استعادة قيد من سلة المحذوفات`
            ),
          };
        });
        return;
      }
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
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      orgTrashTransactions,
      activeCloudWallets,
      settings.customExchangeRates,
      getOrgActor,
      mutateLocalOrgWorkspace,
    ]
  );

  const recalculateOrgBalances = useCallback(async () => {
    if (!isOrgWorkspace || !activeOrganization || !canOrgManage) return;
    if (isUsingLocalOrgMode) {
      const actor = getOrgActor();
      mutateLocalOrgWorkspace(activeOrganization.id, (ws) =>
        recalculateLocalOrgWallets(ws, settings.customExchangeRates, actor)
      );
      return;
    }
    await recalculateOrgBalancesFromApproved(
      activeOrganization.id,
      activeCloudWallets,
      orgTransactions,
      settings.customExchangeRates,
      getOrgActor()
    );
  }, [
    isOrgWorkspace,
    isUsingLocalOrgMode,
    activeOrganization,
    canOrgManage,
    activeCloudWallets,
    orgTransactions,
    settings.customExchangeRates,
    getOrgActor,
    mutateLocalOrgWorkspace,
  ]);

  const attachOrgReceiptPaths = useCallback(
    async (txId: string, attachmentPaths: string[], fallbackTx?: Transaction) => {
      if (!isOrgWorkspace || !activeOrganization) return;
      if (isUsingLocalOrgMode) {
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
          ...ws,
          transactions: (ws.transactions || []).map((tx) =>
            tx.id === txId ? { ...tx, attachmentPaths, updatedAt: Date.now() } : tx
          ),
        }));
        return;
      }
      const target =
        orgTransactions.find((tx) => tx.id === txId) || fallbackTx;
      if (!target) return;
      await updateOrgTxAttachmentPathsCloud(
        activeOrganization.id,
        target,
        attachmentPaths
      );
    },
    [isOrgWorkspace, isUsingLocalOrgMode, activeOrganization, orgTransactions, mutateLocalOrgWorkspace]
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
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
          ...ws,
          costCenters: [...(ws.costCenters || []), newCC],
          auditLogs: appendLocalOrgAuditLog(
            ws,
            'create',
            'cost_center',
            newCC.id,
            actor,
            `إضافة مركز تكلفة: ${newCC.name}`
          ),
        }));
        return newCC;
      }
      void upsertOrgCostCenterCloud(
        activeOrganization.id,
        newCC,
        activeOrganization.currency,
        true,
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Cost center create failed'));
      return newCC;
    },
    [isOrgWorkspace, isUsingLocalOrgMode, activeOrganization, canOrgApprove, getOrgActor, mutateLocalOrgWorkspace]
  );

  const updateCostCenter = useCallback(
    (id: string, updates: Partial<CostCenter>) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return;
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
          ...ws,
          costCenters: (ws.costCenters || []).map((c) => (c.id === id ? { ...c, ...updates } : c)),
          auditLogs: appendLocalOrgAuditLog(
            ws,
            'update',
            'cost_center',
            id,
            actor,
            'تحديث مركز تكلفة'
          ),
        }));
        return;
      }
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
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgApprove,
      activeCloudCostCenters,
      getOrgActor,
      mutateLocalOrgWorkspace,
    ]
  );

  const deleteCostCenter = useCallback(
    (id: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgManage) return;
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
          ...ws,
          costCenters: (ws.costCenters || []).filter((c) => c.id !== id),
          auditLogs: appendLocalOrgAuditLog(
            ws,
            'delete',
            'cost_center',
            id,
            actor,
            'حذف مركز تكلفة'
          ),
        }));
        return;
      }
      void deleteOrgCostCenterCloud(activeOrganization.id, id, getOrgActor()).catch((err) =>
        setOrgActionError(err instanceof Error ? err.message : 'Cost center delete failed')
      );
    },
    [isOrgWorkspace, isUsingLocalOrgMode, activeOrganization, canOrgManage, getOrgActor, mutateLocalOrgWorkspace]
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
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
          ...ws,
          parties: [...(ws.parties || []), newParty],
          auditLogs: appendLocalOrgAuditLog(
            ws,
            'create',
            'party',
            newParty.id,
            actor,
            `إضافة جهة تعامل: ${newParty.name}`
          ),
        }));
        return newParty;
      }
      void upsertOrgPartyCloud(activeOrganization.id, newParty, true, getOrgActor()).catch((err) =>
        setOrgActionError(err instanceof Error ? err.message : 'Party create failed')
      );
      return newParty;
    },
    [isOrgWorkspace, isUsingLocalOrgMode, activeOrganization, canOrgApprove, getOrgActor, mutateLocalOrgWorkspace]
  );

  const updateBusinessParty = useCallback(
    (id: string, updates: Partial<BusinessParty>) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgApprove) return;
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
          ...ws,
          parties: (ws.parties || []).map((p) => (p.id === id ? { ...p, ...updates } : p)),
          auditLogs: appendLocalOrgAuditLog(
            ws,
            'update',
            'party',
            id,
            actor,
            'تحديث بيانات عميل/مورد'
          ),
        }));
        return;
      }
      const existing = activeCloudParties.find((p) => p.id === id);
      if (!existing) return;
      void upsertOrgPartyCloud(
        activeOrganization.id,
        { ...existing, ...updates },
        false,
        getOrgActor()
      ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Party update failed'));
    },
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgApprove,
      activeCloudParties,
      getOrgActor,
      mutateLocalOrgWorkspace,
    ]
  );

  const deleteBusinessParty = useCallback(
    (id: string) => {
      if (!isOrgWorkspace || !activeOrganization || !canOrgManage) return;
      if (isUsingLocalOrgMode) {
        const actor = getOrgActor();
        mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
          ...ws,
          parties: (ws.parties || []).filter((p) => p.id !== id),
          auditLogs: appendLocalOrgAuditLog(
            ws,
            'delete',
            'party',
            id,
            actor,
            'حذف عميل/مورد'
          ),
        }));
        return;
      }
      void deleteOrgPartyCloud(activeOrganization.id, id, getOrgActor()).catch((err) =>
        setOrgActionError(err instanceof Error ? err.message : 'Party delete failed')
      );
    },
    [isOrgWorkspace, isUsingLocalOrgMode, activeOrganization, canOrgManage, getOrgActor, mutateLocalOrgWorkspace]
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
    if (
      !isOrgWorkspace ||
      !activeOrganization ||
      isUsingLocalOrgMode ||
      !canRoleManageOrg(activeOrgRole)
    ) {
      return [];
    }
    return fetchOrgInvitesFromServer(activeOrganization.id);
  }, [isOrgWorkspace, activeOrganization, isUsingLocalOrgMode, activeOrgRole]);

  const revokeOrgInvite = useCallback(
    async (inviteId: string) => {
      if (!isOrgWorkspace || !activeOrganization || isUsingLocalOrgMode) return;
      await revokeOrgInviteOnServer(activeOrganization.id, inviteId);
    },
    [isOrgWorkspace, activeOrganization, isUsingLocalOrgMode]
  );

  const checkUsernameAvailable = useCallback(
    async (rawUsername: string) => {
      const uid = auth.currentUser?.uid || user?.id;
      return checkUsernameAvailabilityCloud(rawUsername, uid);
    },
    [user?.id]
  );

  const updateUsername = useCallback(
    async (
      rawUsername: string
    ): Promise<{ ok: boolean; username?: string; error?: string }> => {
      const isAr = settings.language !== 'en';
      const firebaseUser = auth.currentUser;
      if (!firebaseUser || !user?.isLoggedIn) {
        return {
          ok: false,
          error: isAr
            ? 'يرجى تسجيل الدخول بحساب جوجل أولاً لاختيار اسم مستخدم.'
            : 'Please sign in with Google first to set a username.',
        };
      }
      try {
        const res = await claimUserUsernameCloud(firebaseUser.uid, rawUsername, {
          email: user.email || firebaseUser.email || '',
          displayName: user.name || firebaseUser.displayName || '',
        });
        setUser((prev) => (prev ? { ...prev, username: res.username } : prev));
        return { ok: true, username: res.username };
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err || '');
        if (raw === 'USERNAME_TAKEN') {
          return {
            ok: false,
            error: isAr
              ? 'اسم المستخدم هذا محجوز بالفعل لحساب آخر. جرب اسماً مختلفاً.'
              : 'This username is already taken. Please try another.',
          };
        }
        return {
          ok: false,
          error:
            raw && !raw.startsWith('{')
              ? raw
              : isAr
              ? 'تعذر حفظ اسم المستخدم حالياً. تحقق من الاتصال وحاول مجدداً.'
              : 'Could not save username right now. Please try again.',
        };
      }
    },
    [settings.language, user]
  );

  const searchUserForOrg = useCallback(
    async (identifier: string): Promise<DirectOrgUserLookupResult | null> => {
      if (!auth.currentUser) {
        throw new Error(
          settings.language === 'en'
            ? 'Please sign in first to search for users.'
            : 'يرجى تسجيل الدخول أولاً للبحث عن المستخدمين.'
        );
      }
      return lookupUserForOrgDirectAdd(identifier);
    },
    [settings.language]
  );

  const addOrgMemberDirectly = useCallback(
    async (params: {
      identifier: string;
      targetUser?: DirectOrgUserLookupResult | null;
      role: Exclude<OrganizationRole, 'owner'>;
      department?: string;
      spendingLimit?: number;
    }): Promise<OrganizationMember> => {
      const isAr = settings.language !== 'en';
      if (!isOrgWorkspace || !activeOrganization) {
        throw new Error(isAr ? 'لا توجد مؤسسة نشطة.' : 'No active organization.');
      }
      if (isUsingLocalOrgMode) {
        throw new Error(
          isAr
            ? 'لإضافة أعضاء من حساباتهم، يرجى ترحيل المؤسسة للسحابة أولاً.'
            : 'Please migrate this organization to Cloud first to add team members.'
        );
      }
      if (!canOrgManage) {
        throw new Error(
          isAr
            ? 'ليس لديك صلاحية إضافة أعضاء في هذه المؤسسة.'
            : 'You do not have permission to add members to this organization.'
        );
      }
      return addOrgMemberDirectlyCloud({
        orgId: activeOrganization.id,
        identifier: params.identifier,
        targetUser: params.targetUser,
        role: params.role,
        department: params.department,
        spendingLimit: params.spendingLimit,
        actor: getOrgActor(),
      });
    },
    [settings.language, isOrgWorkspace, activeOrganization, isUsingLocalOrgMode, canOrgManage, getOrgActor]
  );

  const manageOrgMember = useCallback(
    async (params: {
      targetUid: string;
      action: 'change_role' | 'suspend' | 'reactivate' | 'remove' | 'set_spending_limit';
      role?: Exclude<OrganizationRole, 'owner'>;
      spendingLimit?: number | null;
      department?: string;
    }) => {
      if (!isOrgWorkspace || !activeOrganization || isUsingLocalOrgMode) return;
      await manageOrgMemberDirectlyCloud({
        orgId: activeOrganization.id,
        targetUid: params.targetUid,
        action: params.action,
        role: params.role,
        spendingLimit: params.spendingLimit,
        department: params.department,
        actor: getOrgActor(),
      });
    },
    [isOrgWorkspace, activeOrganization, isUsingLocalOrgMode, getOrgActor]
  );

  const transferOrgOwnership = useCallback(
    async (newOwnerUid: string) => {
      if (!isOrgWorkspace || !activeOrganization || isUsingLocalOrgMode) return;
      await transferOrgOwnershipOnServer(activeOrganization.id, newOwnerUid);
    },
    [isOrgWorkspace, activeOrganization, isUsingLocalOrgMode]
  );

  const deleteOrganization = useCallback(
    async (confirmName: string, targetOrgId?: string) => {
      const orgIdToDelete = (targetOrgId || activeOrganization?.id || '').trim();
      if (!orgIdToDelete || orgIdToDelete === 'personal') return;

      const cloudRef = orgRefs.find((r) => r.orgId === orgIdToDelete) || null;
      const localWs =
        latestLocalOrgWorkspacesRef.current[orgIdToDelete] ||
        Object.values(latestLocalOrgWorkspacesRef.current).find(
          (w) => w?.organization?.id === orgIdToDelete
        ) ||
        null;
      const listMatch = organizationsList.find((o) => o.id === orgIdToDelete) || null;
      const targetOrgName =
        (activeCloudOrg?.id === orgIdToDelete ? activeCloudOrg.name : '') ||
        cloudRef?.orgName ||
        localWs?.organization?.name ||
        listMatch?.name ||
        '';

      const permissions = resolveWorkspaceOrgPermissions({
        org: {
          id: orgIdToDelete,
          ownerUid:
            (activeCloudOrg?.id === orgIdToDelete ? activeCloudOrg.ownerUid : '') ||
            localWs?.organization?.ownerUid ||
            listMatch?.ownerUid ||
            '',
          localFirstMode: localWs?.organization?.localFirstMode,
        },
        orgRefs,
        localOrgWorkspaces: latestLocalOrgWorkspacesRef.current,
        currentUserId: user?.id || auth.currentUser?.uid || null,
        activeWorkspace: activeWorkspaceRef.current,
        activeOrgRole,
      });

      if (!permissions.canDelete) {
        throw new Error(
          settings.language === 'en'
            ? 'Only the organization owner can delete a shared cloud organization.'
            : 'فقط مالك المؤسسة يمكنه حذف المؤسسة السحابية المشتركة.'
        );
      }

      if (targetOrgName.trim() && confirmName.trim() !== targetOrgName.trim()) {
        throw new Error('NAME_MISMATCH');
      }

      const uidForCloud = user?.isLoggedIn
        ? user.id || auth.currentUser?.uid || null
        : auth.currentUser?.uid || null;

      await deleteOrganizationWorkspaceCloud({
        orgId: orgIdToDelete,
        orgName: confirmName.trim() || targetOrgName.trim(),
        uid: uidForCloud,
        hasCloudOrgRef: Boolean(cloudRef),
      });

      const nextWorkspace = resolveFallbackWorkspaceAfterDelete(
        activeWorkspaceRef.current,
        orgIdToDelete
      );
      const nextMap = await deleteLocalOrgWorkspaceStorage(orgIdToDelete, nextWorkspace);
      latestLocalOrgWorkspacesRef.current = nextMap;
      setLocalOrgWorkspaces(nextMap);
      setOrgRefs((prev) => prev.filter((r) => r.orgId !== orgIdToDelete));
      setLegacyLocalOrgs((prev) => prev.filter((w) => w.organization.id !== orgIdToDelete));

      if (nextWorkspace !== activeWorkspaceRef.current) {
        syncRequestIdRef.current += 1;
        setActiveWorkspace('personal');
        saveActiveWorkspacePref('personal');
        setActiveWalletId(null);
        setSelectedTransactionIds([]);
        resetFilters();
        setIsOrgHubOpen(false);
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
      }

      showToast(
        settings.language === 'en'
          ? `Workspace "${targetOrgName || orgIdToDelete}" was permanently deleted.`
          : `تم حذف مساحة العمل "${targetOrgName || orgIdToDelete}" نهائياً.`,
        'info'
      );
    },
    [
      activeOrganization?.id,
      orgRefs,
      organizationsList,
      activeCloudOrg,
      user?.id,
      user?.isLoggedIn,
      activeOrgRole,
      settings.language,
      resetFilters,
      showToast,
    ]
  );

  // ===========================================================================
  // Unified CRUD: Transactions (respecting Personal vs Cloud Organization)
  // ===========================================================================
  const applyDeltasToWallets = useCallback(
    (walletList: Wallet[], tx: Transaction, multiplier: 1 | -1): Wallet[] => {
      const { sourceDelta, destDelta } = getTransactionWalletDeltas(tx);
      if (sourceDelta === 0 && destDelta === 0) return walletList;

      const deltas = new Map<string, number>();
      if (tx.walletId && sourceDelta !== 0) {
        const srcWallet = walletList.find((w) => w.id === tx.walletId);
        if (srcWallet) {
          const deltaInWallet = convertCurrency(
            sourceDelta,
            tx.currency,
            srcWallet.currency,
            settings.customExchangeRates
          );
          deltas.set(
            srcWallet.id,
            roundCurrency((deltas.get(srcWallet.id) || 0) + deltaInWallet * multiplier, srcWallet.currency)
          );
        }
      }
      if (tx.toWalletId && destDelta !== 0) {
        const destWallet = walletList.find((w) => w.id === tx.toWalletId);
        if (destWallet) {
          deltas.set(
            destWallet.id,
            roundCurrency((deltas.get(destWallet.id) || 0) + destDelta * multiplier, destWallet.currency)
          );
        }
      }
      if (deltas.size === 0) return walletList;

      return walletList.map((w) => {
        const delta = deltas.get(w.id);
        if (delta === undefined || delta === 0) return w;
        const nextBalance = roundCurrency(w.balance + delta, w.currency);
        return {
          ...w,
          balance: nextBalance,
          ...(typeof w.balanceMinor === 'number'
            ? { balanceMinor: toMinor(nextBalance, w.currency) }
            : {}),
        };
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
          : {
              workspaceId: 'personal',
              deletedAt: null,
            }),
        id: `tx-${now}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
        updatedAt: now,
      };

      const nextSettings: AppSettings = {
        ...latestPersonalRef.current.settings,
        lastUsedTransactionType: newTx.type,
        ...(latestPersonalRef.current.settings.useLastUsedWallet
          ? { lastUsedWalletId: newTx.walletId }
          : {}),
      };
      setSettings((prev) => ({
        ...prev,
        lastUsedTransactionType: newTx.type,
        ...(prev.useLastUsedWallet ? { lastUsedWalletId: newTx.walletId } : {}),
      }));

      if (isOrgWorkspace && activeOrganization) {
        if (isUsingLocalOrgMode) {
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            wallets: applyOrgTxBalanceToWallets(
              ws.wallets || [],
              newTx,
              settings.customExchangeRates,
              1
            ),
            transactions: [newTx, ...(ws.transactions || [])],
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'create',
              'transaction',
              newTx.id,
              actor,
              `إضافة معاملة (${newTx.amount} ${newTx.currency})`
            ),
          }));
        } else {
          void createOrgTransactionCloud(
            activeOrganization.id,
            newTx,
            activeCloudWallets,
            settings.customExchangeRates,
            actor
          ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Transaction create failed'));
        }
        savePersonalState({ settings: nextSettings });
      } else {
        const updatedWallets = applyDeltasToWallets(personalWallets, newTx, 1);
        const nextTx = [newTx, ...personalTransactions];
        setPersonalTransactions(nextTx);
        setPersonalWallets(updatedWallets);
        savePersonalState({ transactions: nextTx, wallets: updatedWallets, settings: nextSettings });
        syncWorkspaceTxWriteImmediately('personal', newTx, true);
      }

      return newTx;
    },
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
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
      mutateLocalOrgWorkspace,
      applyDeltasToWallets,
      personalWallets,
      personalTransactions,
      savePersonalState,
      syncWorkspaceTxWriteImmediately,
    ]
  );

  const pendingCloudOrgImportMetaRef = React.useRef<{
    newWallets: Wallet[];
    newCategories: Category[];
  } | null>(null);

  const importSpreadsheetBatchLocally = useCallback(
    async (
      items: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[],
      options?: {
        newWallets?: Wallet[];
        newCategories?: Category[];
        workspaceId?: string;
        onProgress?: (processed: number, total: number) => void;
      }
    ): Promise<{ importedCount: number; createdTransactions: Transaction[]; workspaceId: string }> => {
      if (items.length === 0) {
        return {
          importedCount: 0,
          createdTransactions: [],
          workspaceId: normalizeWorkspaceId(options?.workspaceId || activeWorkspaceRef.current),
        };
      }

      const baseNow = Date.now();
      const actor = getOrgActor();
      const targetWsId =
        isOrgWorkspace && activeOrganization
          ? activeOrganization.id
          : normalizeWorkspaceId(options?.workspaceId || 'personal');

      const filteredItems =
        isOrgWorkspace && activeOrganization
          ? items.filter((d) => !isDateInLockedPeriod(d.date, activeOrganization.lockedUntilDate))
          : items;
      if (filteredItems.length === 0) {
        return { importedCount: 0, createdTransactions: [], workspaceId: targetWsId };
      }

      const extraWallets = tagWalletsWithWorkspace(options?.newWallets || [], targetWsId);
      const extraCategories = options?.newCategories || [];
      const total = filteredItems.length;
      const CHUNK_SIZE = 200;

      // Chunk-build new transactions with main-thread yields so large imports never freeze UI
      const newTxs: Transaction[] = new Array(total);
      for (let start = 0; start < total; start += CHUNK_SIZE) {
        const end = Math.min(total, start + CHUNK_SIZE);
        for (let idx = start; idx < end; idx++) {
          const data = filteredItems[idx];
          newTxs[idx] = {
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
              : {
                  workspaceId: targetWsId,
                  deletedAt: null,
                }),
            id: `csv-${baseNow}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            createdAt: baseNow - idx,
            updatedAt: baseNow - idx,
          };
        }
        options?.onProgress?.(Math.round(end * 0.45), total);
        if (end < total) {
          await yieldToMainThread();
        }
      }

      // Single-pass O(N + W) wallet balance accumulator (replaces O(N * W) array cloning)
      const accumulateWalletDeltasChunked = async (
        baseWallets: Wallet[],
        txList: Transaction[],
        orgMode: boolean
      ): Promise<Wallet[]> => {
        const walletById = new Map<string, Wallet>();
        for (const w of baseWallets) walletById.set(w.id, w);
        const totalDeltas = new Map<string, number>();

        for (let start = 0; start < txList.length; start += CHUNK_SIZE) {
          const end = Math.min(txList.length, start + CHUNK_SIZE);
          for (let i = start; i < end; i++) {
            const tx = txList[i];
            if (orgMode && !doesTransactionAffectAccounting(tx)) continue;
            const { sourceDelta, destDelta } = getTransactionWalletDeltas(tx);
            if (sourceDelta === 0 && destDelta === 0) continue;

            if (tx.walletId && sourceDelta !== 0) {
              const srcWallet = walletById.get(tx.walletId);
              if (srcWallet) {
                const deltaInWallet = convertCurrency(
                  sourceDelta,
                  tx.currency,
                  srcWallet.currency,
                  settings.customExchangeRates
                );
                totalDeltas.set(
                  srcWallet.id,
                  (totalDeltas.get(srcWallet.id) || 0) + deltaInWallet
                );
              }
            }
            if (tx.toWalletId && destDelta !== 0) {
              const destWallet = walletById.get(tx.toWalletId);
              if (destWallet) {
                totalDeltas.set(
                  destWallet.id,
                  (totalDeltas.get(destWallet.id) || 0) + destDelta
                );
              }
            }
          }
          options?.onProgress?.(Math.round(total * 0.45 + end * 0.4), total);
          if (end < txList.length) {
            await yieldToMainThread();
          }
        }

        if (totalDeltas.size === 0) return baseWallets;
        return baseWallets.map((w) => {
          const delta = totalDeltas.get(w.id);
          if (delta === undefined || delta === 0) return w;
          const nextBalance = roundCurrency(w.balance + delta, w.currency);
          return {
            ...w,
            balance: nextBalance,
            ...(typeof w.balanceMinor === 'number'
              ? { balanceMinor: toMinor(nextBalance, w.currency) }
              : {}),
          };
        });
      };

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) {
          return { importedCount: 0, createdTransactions: [], workspaceId: targetWsId };
        }
        if (isUsingLocalOrgMode) {
          const currentMap = latestLocalOrgWorkspacesRef.current;
          const existingWs = currentMap[activeOrganization.id];
          if (!existingWs) {
            return { importedCount: 0, createdTransactions: [], workspaceId: targetWsId };
          }

          const existingWalletIds = new Set((existingWs.wallets || []).map((w) => w.id));
          const uniqueNewWallets = extraWallets.filter((w) => !existingWalletIds.has(w.id));
          const combinedWallets = [...(existingWs.wallets || []), ...uniqueNewWallets];
          const nextWallets = await accumulateWalletDeltasChunked(combinedWallets, newTxs, true);

          const existingCatIds = new Set((existingWs.categories || []).map((c) => c.id));
          const uniqueNewCats = extraCategories.filter((c) => !existingCatIds.has(c.id));
          const nextCategories = [...(existingWs.categories || []), ...uniqueNewCats];

          const updatedWs: OrgWorkspaceData = {
            ...existingWs,
            wallets: nextWallets,
            categories: nextCategories,
            transactions: [...newTxs, ...(existingWs.transactions || [])],
            auditLogs: appendLocalOrgAuditLog(
              existingWs,
              'create',
              'transaction',
              activeOrganization.id,
              actor,
              `استيراد دفعة (${newTxs.length} معاملة)`
            ),
          };
          const nextMap: Record<string, OrgWorkspaceData> = {
            ...currentMap,
            [activeOrganization.id]: updatedWs,
          };
          latestLocalOrgWorkspacesRef.current = nextMap;
          setLocalOrgWorkspaces(nextMap);
          await saveOrgWorkspaces(activeWorkspaceRef.current, nextMap);

          workspaceSyncEpochRef.current += 1;
          for (const tx of newTxs) {
            locallyDeletedTxIdsRef.current.delete(tx.id);
            pendingLocalTxIdsRef.current.add(tx.id);
          }
          saveUnsyncedDirtyFlag(true);
          setHasUnsyncedLocalChanges(true);
          options?.onProgress?.(total, total);

          return {
            importedCount: newTxs.length,
            createdTransactions: newTxs,
            workspaceId: activeOrganization.id,
          };
        }

        // Cloud multi-user org: stage metadata, optimistically surface in local UI, and hand off for background cloud commit
        const existingCloudWalletIds = new Set(activeCloudWallets.map((w) => w.id));
        const uniqueNewCloudWallets = extraWallets.filter((w) => !existingCloudWalletIds.has(w.id));
        const combinedCloudWallets = [...activeCloudWallets, ...uniqueNewCloudWallets];
        const optimisticCloudWallets = await accumulateWalletDeltasChunked(
          combinedCloudWallets,
          newTxs,
          true
        );
        pendingCloudOrgImportMetaRef.current = {
          newWallets: uniqueNewCloudWallets,
          newCategories: extraCategories,
        };
        setActiveCloudWallets(optimisticCloudWallets);
        setActiveCloudTransactions((prev) => {
          const seen = new Set(newTxs.map((t) => t.id));
          return [...newTxs, ...prev.filter((t) => !seen.has(t.id))];
        });
        options?.onProgress?.(total, total);
        return {
          importedCount: newTxs.length,
          createdTransactions: newTxs,
          workspaceId: activeOrganization.id,
        };
      }

      // Personal workspace local persistence — single bulk state update + single IndexedDB write
      const currentPersonal = latestPersonalRef.current;
      const existingPersonalWalletIds = new Set(currentPersonal.wallets.map((w) => w.id));
      const uniqueNewPersonalWallets = extraWallets.filter(
        (w) => !existingPersonalWalletIds.has(w.id)
      );
      const combinedPersonalWallets = [...currentPersonal.wallets, ...uniqueNewPersonalWallets];
      const updatedWallets = await accumulateWalletDeltasChunked(
        combinedPersonalWallets,
        newTxs,
        false
      );

      const existingPersonalCatIds = new Set(currentPersonal.categories.map((c) => c.id));
      const uniqueNewPersonalCats = extraCategories.filter((c) => !existingPersonalCatIds.has(c.id));
      const nextCategories =
        uniqueNewPersonalCats.length > 0
          ? [...currentPersonal.categories, ...uniqueNewPersonalCats]
          : currentPersonal.categories;

      const nextTx = [...newTxs, ...currentPersonal.transactions];
      const nextData: AppDatabaseData = {
        ...currentPersonal,
        transactions: nextTx,
        wallets: updatedWallets,
        categories: nextCategories,
        hasCompletedOnboarding: true,
      };
      latestPersonalRef.current = nextData;
      skipNextAutoSyncRef.current = true;

      setPersonalTransactions(nextTx);
      setPersonalWallets(updatedWallets);
      if (uniqueNewPersonalCats.length > 0) {
        setPersonalCategories(nextCategories);
      }
      setHasCompletedOnboarding(true);

      await persistData(nextData);

      workspaceSyncEpochRef.current += 1;
      for (const tx of newTxs) {
        locallyDeletedTxIdsRef.current.delete(tx.id);
        pendingLocalTxIdsRef.current.add(tx.id);
      }
      saveUnsyncedDirtyFlag(true);
      setHasUnsyncedLocalChanges(true);
      options?.onProgress?.(total, total);

      return {
        importedCount: newTxs.length,
        createdTransactions: newTxs,
        workspaceId: 'personal',
      };
    },
    [
      getOrgActor,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      activeOrgRole,
      canOrgWrite,
      activeCloudWallets,
      settings.customExchangeRates,
    ]
  );

  const syncWorkspaceBackupNow = useCallback(
    async (
      workspaceId?: string,
      extraTransactions?: Transaction[],
      options?: {
        onProgress?: (processed: number, total: number) => void;
      }
    ): Promise<{ ok: boolean; error?: string }> => {
      const isAr = latestPersonalRef.current.settings.language !== 'en';
      const uid = auth.currentUser?.uid;
      if (!uid || !latestPersonalRef.current.user?.isLoggedIn) {
        return {
          ok: false,
          error: isAr
            ? 'يرجى تسجيل الدخول بحساب جوجل لحفظ البيانات في السحابة.'
            : 'Please sign in with Google to save data to the cloud.',
        };
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return {
          ok: false,
          error: isAr
            ? 'لا يوجد اتصال بالإنترنت — تم الحفظ محلياً فقط، وتعذر الرفع للسحابة.'
            : 'You are offline — saved locally only; cloud upload failed.',
        };
      }

      const targetWsId = normalizeWorkspaceId(workspaceId || activeWorkspaceRef.current || 'personal');
      const actor = getOrgActor();
      const onProgress = options?.onProgress;
      setIsCloudSyncing(true);
      setCloudSyncStatus('syncing');
      setCloudSyncError(null);

      try {
        await ensureUserProfile(auth.currentUser!);

        // Case 1: Shared Cloud Multi-User Organization
        if (isOrgWorkspace && activeOrganization && !isUsingLocalOrgMode && targetWsId === activeOrganization.id) {
          const stagedMeta = pendingCloudOrgImportMetaRef.current;
          pendingCloudOrgImportMetaRef.current = null;
          const mergedWallets = stagedMeta
            ? [...activeCloudWallets, ...stagedMeta.newWallets]
            : activeCloudWallets;
          if (stagedMeta) {
            for (const w of stagedMeta.newWallets) {
              await upsertOrgWalletCloud(activeOrganization.id, w, true, actor);
            }
            for (const c of stagedMeta.newCategories) {
              await upsertOrgCategoryCloud(activeOrganization.id, c, true, actor);
            }
          }
          if (extraTransactions && extraTransactions.length > 0) {
            await importOrgTransactionsBatchCloud(
              activeOrganization.id,
              extraTransactions,
              mergedWallets,
              settings.customExchangeRates,
              actor,
              onProgress
            );
          }

          // Also refresh backup history snapshot with accurate active cloud org counts
          const snap = latestPersonalRef.current;
          const activeOrgTxCount = Math.max(
            activeCloudTransactions.filter((t) => !t.deletedAt).length,
            extraTransactions?.length || 0
          );
          void saveCloudBackup(
            uid,
            {
              transactions: snap.transactions,
              wallets: snap.wallets,
              categories: snap.categories,
              budgets: snap.budgets,
              debts: snap.debts,
              goals: snap.goals,
              templates: snap.templates,
              moneyCircles: snap.moneyCircles,
              orgWorkspaces: latestLocalOrgWorkspacesRef.current,
              activeWorkspace: activeOrganization.id,
              settings: snap.settings,
              hasCompletedOnboarding: true,
            },
            {
              source: 'auto',
              recordHistory: true,
              allowEmptyOverwrite: false,
              activeCloudOrgCounts: {
                orgId: activeOrganization.id,
                orgName: activeOrganization.name,
                transactions: activeOrgTxCount,
                wallets: mergedWallets.length,
              },
            }
          )
            .then(() => {
              void refreshCloudBackupHistory();
            })
            .catch(() => null);

          setCloudSyncStatus('synced');
          saveUnsyncedDirtyFlag(false);
          setHasUnsyncedLocalChanges(false);
          return { ok: true };
        }

        // Case 2: Local-first / Personal-owned Organization Workspace
        if (targetWsId !== 'personal') {
          const currentMap = latestLocalOrgWorkspacesRef.current;
          const wsData = currentMap[targetWsId];
          const txsToUpload =
            extraTransactions && extraTransactions.length > 0
              ? extraTransactions
              : (wsData?.transactions || []).filter((tx) => !tx.deletedAt);
          const totalUploadCount = Math.max(1, txsToUpload.length);

          if (txsToUpload.length > 0) {
            await batchUpsertWorkspaceTransactionsCloud(uid, targetWsId, txsToUpload, {
              onProgress: (processed, total) => {
                onProgress?.(Math.round(processed * 0.8), total || totalUploadCount);
              },
            });
          }

          const snap = latestPersonalRef.current;
          const backupRes = await saveCloudBackup(
            uid,
            {
              transactions: snap.transactions,
              wallets: snap.wallets,
              categories: snap.categories,
              budgets: snap.budgets,
              debts: snap.debts,
              goals: snap.goals,
              templates: snap.templates,
              moneyCircles: snap.moneyCircles,
              orgWorkspaces: currentMap,
              activeWorkspace: activeWorkspaceRef.current || targetWsId,
              settings: snap.settings,
              hasCompletedOnboarding: true,
            },
            {
              source: 'manual',
              recordHistory: true,
              allowEmptyOverwrite: false,
              onProgress: (processed, total) => {
                const ratio = total > 0 ? processed / total : 1;
                onProgress?.(
                  Math.round(totalUploadCount * (0.8 + ratio * 0.2)),
                  totalUploadCount
                );
              },
            }
          );

          if (backupRes.blockedEmptyOverwrite) {
            throw new Error(
              isAr ? 'تم منع الكتابة الفارغة على السحابة.' : 'Empty cloud overwrite was blocked.'
            );
          }

          for (const tx of txsToUpload) {
            pendingLocalTxIdsRef.current.delete(tx.id);
          }
          onProgress?.(totalUploadCount, totalUploadCount);
          setCloudSkippedAttachmentsWarning(backupRes.skippedAttachmentsCount);
          setLastCloudBackupExists(true);
          setCloudConflict(null);
          setCloudSyncStatus('synced');
          setCloudSyncError(null);
          saveUnsyncedDirtyFlag(false);
          setHasUnsyncedLocalChanges(false);
          void refreshCloudBackupHistory();
          skipNextAutoSyncRef.current = true;
          setSettings((prev) => {
            const next = {
              ...prev,
              lastCloudSyncAt: backupRes.syncedAt,
              lastKnownCloudUpdatedAtMs: backupRes.updatedAtMs,
              lastBackupAt: backupRes.syncedAt,
            };
            persistDataDebounced(
              { ...latestPersonalRef.current, settings: next },
              handleLocalPersistError
            );
            return next;
          });
          return { ok: true };
        }

        // Case 3: Personal Workspace — upload all transactions in 425-op WriteBatches + full chunked backup
        const snap = latestPersonalRef.current;
        const personalScoped = snap.transactions.filter((tx) =>
          isActiveWorkspaceTransaction(tx, 'personal')
        );
        const txsForUnified =
          extraTransactions && extraTransactions.length > 0
            ? extraTransactions
            : personalScoped;
        const totalUploadCount = Math.max(1, txsForUnified.length);

        if (txsForUnified.length > 0) {
          await batchUpsertWorkspaceTransactionsCloud(uid, 'personal', txsForUnified, {
            onProgress: (processed, total) => {
              onProgress?.(Math.round(processed * 0.8), total || totalUploadCount);
            },
          });
        }

        const backupRes = await saveCloudBackup(
          uid,
          {
            transactions: snap.transactions,
            wallets: snap.wallets,
            categories: snap.categories,
            budgets: snap.budgets,
            debts: snap.debts,
            goals: snap.goals,
            templates: snap.templates,
            moneyCircles: snap.moneyCircles,
            orgWorkspaces: latestLocalOrgWorkspacesRef.current,
            activeWorkspace: activeWorkspaceRef.current || 'personal',
            settings: snap.settings,
            hasCompletedOnboarding: true,
          },
          {
            source: 'manual',
            recordHistory: true,
            allowEmptyOverwrite: false,
            onProgress: (processed, total) => {
              const ratio = total > 0 ? processed / total : 1;
              onProgress?.(
                Math.round(totalUploadCount * (0.8 + ratio * 0.2)),
                totalUploadCount
              );
            },
          }
        );

        if (backupRes.blockedEmptyOverwrite) {
          throw new Error(
            isAr ? 'تم منع الكتابة الفارغة على السحابة.' : 'Empty cloud overwrite was blocked.'
          );
        }

        for (const tx of txsForUnified) {
          pendingLocalTxIdsRef.current.delete(tx.id);
        }
        onProgress?.(totalUploadCount, totalUploadCount);
        setCloudSkippedAttachmentsWarning(backupRes.skippedAttachmentsCount);
        setLastCloudBackupExists(true);
        setCloudConflict(null);
        setCloudSyncStatus('synced');
        setCloudSyncError(null);
        saveUnsyncedDirtyFlag(false);
        setHasUnsyncedLocalChanges(false);
        void refreshCloudBackupHistory();
        skipNextAutoSyncRef.current = true;
        setSettings((prev) => {
          const next = {
            ...prev,
            lastCloudSyncAt: backupRes.syncedAt,
            lastKnownCloudUpdatedAtMs: backupRes.updatedAtMs,
            lastBackupAt: backupRes.syncedAt,
          };
          persistDataDebounced(
            { ...latestPersonalRef.current, settings: next },
            handleLocalPersistError
          );
          return next;
        });
        return { ok: true };
      } catch (err) {
        const formatted = formatFirestoreErrorForDisplay(err, isAr);
        setCloudSyncStatus('error');
        setCloudSyncError(formatted);
        setCloudDiagnosticsError(formatted);
        saveUnsyncedDirtyFlag(true);
        setHasUnsyncedLocalChanges(true);
        return { ok: false, error: formatted };
      } finally {
        setIsCloudSyncing(false);
      }
    },
    [
      getOrgActor,
      isOrgWorkspace,
      activeOrganization,
      isUsingLocalOrgMode,
      activeCloudWallets,
      activeCloudTransactions,
      settings.customExchangeRates,
      refreshCloudBackupHistory,
    ]
  );

  const dismissBackgroundImportCloudSync = useCallback(() => {
    if (backgroundImportDismissTimerRef.current) {
      clearTimeout(backgroundImportDismissTimerRef.current);
      backgroundImportDismissTimerRef.current = null;
    }
    setBackgroundImportSync({
      status: 'idle',
      workspaceId: null,
      processed: 0,
      total: 0,
      percent: 0,
      error: null,
    });
  }, []);

  const startBackgroundImportCloudSync = useCallback(
    (workspaceId: string, createdTransactions: Transaction[]) => {
      if (!createdTransactions || createdTransactions.length === 0) return;
      if (backgroundImportDismissTimerRef.current) {
        clearTimeout(backgroundImportDismissTimerRef.current);
        backgroundImportDismissTimerRef.current = null;
      }

      const total = createdTransactions.length;
      pendingBackgroundImportRef.current = { workspaceId, createdTransactions };
      setBackgroundImportSync({
        status: 'syncing',
        workspaceId,
        processed: 0,
        total,
        percent: 2,
        error: null,
      });

      void (async () => {
        const res = await syncWorkspaceBackupNow(workspaceId, createdTransactions, {
          onProgress: (processed, tot) => {
            const safeTotal = Math.max(1, tot || total);
            const safeProcessed = Math.min(safeTotal, Math.max(0, processed));
            const pct = Math.min(99, Math.max(2, Math.round((safeProcessed / safeTotal) * 100)));
            setBackgroundImportSync((prev) =>
              prev.status === 'syncing'
                ? {
                    ...prev,
                    processed: safeProcessed,
                    total: safeTotal,
                    percent: pct,
                  }
                : prev
            );
          },
        });

        if (res.ok) {
          pendingBackgroundImportRef.current = null;
          setBackgroundImportSync({
            status: 'synced',
            workspaceId,
            processed: total,
            total,
            percent: 100,
            error: null,
          });
          backgroundImportDismissTimerRef.current = setTimeout(() => {
            setBackgroundImportSync((prev) =>
              prev.status === 'synced'
                ? {
                    status: 'idle',
                    workspaceId: null,
                    processed: 0,
                    total: 0,
                    percent: 0,
                    error: null,
                  }
                : prev
            );
          }, 6000);
        } else {
          setBackgroundImportSync((prev) => ({
            ...prev,
            status: 'error',
            error: res.error || 'تعذرت المزامنة مع السحابة. بياناتك محفوظة محلياً بأمان.',
          }));
        }
      })();
    },
    [syncWorkspaceBackupNow]
  );

  const retryBackgroundImportCloudSync = useCallback(() => {
    const pending = pendingBackgroundImportRef.current;
    if (!pending) return;
    startBackgroundImportCloudSync(pending.workspaceId, pending.createdTransactions);
  }, [startBackgroundImportCloudSync]);

  const importTransactionsBatch = useCallback(
    async (
      items: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[],
      options?: { newWallets?: Wallet[]; newCategories?: Category[]; skipCloudSync?: boolean }
    ): Promise<number> => {
      const localRes = await importSpreadsheetBatchLocally(items, options);
      if (localRes.importedCount <= 0) return 0;

      if (!options?.skipCloudSync && auth.currentUser?.uid) {
        const syncRes = await syncWorkspaceBackupNow(
          localRes.workspaceId,
          localRes.createdTransactions
        );
        if (!syncRes.ok) {
          throw new Error(syncRes.error || 'Cloud sync failed after import');
        }
      }
      return localRes.importedCount;
    },
    [importSpreadsheetBatchLocally, syncWorkspaceBackupNow]
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

        const mergedTx = buildUpdatedTransaction(
          oldTx,
          {
            ...updates,
            approvalStatus:
              normalizeApprovalStatus(updates.approvalStatus ?? oldTx.approvalStatus) || 'approved',
          },
          isUsingLocalOrgMode ? wallets : activeCloudWallets,
          settings.customExchangeRates
        );
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => {
            const { mergedTx: nextMergedTx, updatedWallets } = computeTransactionUpdate(
              oldTx,
              {
                ...updates,
                approvalStatus:
                  normalizeApprovalStatus(updates.approvalStatus ?? oldTx.approvalStatus) ||
                  'approved',
              },
              ws.wallets || [],
              settings.customExchangeRates
            );
            return {
              ...ws,
              wallets: updatedWallets,
              transactions: (ws.transactions || []).map((tx) =>
                tx.id === id ? nextMergedTx : tx
              ),
              auditLogs: appendLocalOrgAuditLog(
                ws,
                'update',
                'transaction',
                id,
                actor,
                `تعديل معاملة (${nextMergedTx.amount} ${nextMergedTx.currency})`
              ),
            };
          });
          return;
        }
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

      const { mergedTx, updatedWallets } = computeTransactionUpdate(
        oldTx,
        updates,
        personalWallets,
        settings.customExchangeRates
      );
      const taggedMergedTx: Transaction = { ...mergedTx, workspaceId: 'personal' };

      const nextTx = personalTransactions.map((t) => (t.id === id ? taggedMergedTx : t));
      setPersonalTransactions(nextTx);
      setPersonalWallets(updatedWallets);
      savePersonalState({ transactions: nextTx, wallets: updatedWallets });
      syncWorkspaceTxWriteImmediately('personal', taggedMergedTx, false);
    },
    [
      transactions,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      activeOrgRole,
      activeOrgMember,
      settings.language,
      settings.customExchangeRates,
      wallets,
      activeCloudWallets,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalWallets,
      personalTransactions,
      savePersonalState,
      syncWorkspaceTxWriteImmediately,
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
        if (isUsingLocalOrgMode) {
          const now = Date.now();
          mutateLocalOrgWorkspace(orgId, (ws) => {
            const nextWallets = applyOrgTxBalanceToWallets(
              ws.wallets || [],
              oldTx,
              settings.customExchangeRates,
              -1
            );
            return {
              ...ws,
              wallets: nextWallets,
              transactions: (ws.transactions || []).map((tx) =>
                tx.id === id ? { ...tx, deletedAt: now, deletedBy: actor.uid, updatedAt: now } : tx
              ),
              auditLogs: appendLocalOrgAuditLog(
                ws,
                'delete',
                'transaction',
                id,
                actor,
                `نقل معاملة إلى سلة المحذوفات`
              ),
            };
          });
          setUndoAction({
            id: `undo-${Date.now()}`,
            message: t('transactionDeleted'),
            action: () => {
              mutateLocalOrgWorkspace(orgId, (ws) => {
                const target = (ws.transactions || []).find((tx) => tx.id === id);
                if (!target) return ws;
                const restoredTx: Transaction = {
                  ...target,
                  deletedAt: null,
                  deletedBy: null,
                  updatedAt: Date.now(),
                };
                return {
                  ...ws,
                  wallets: applyOrgTxBalanceToWallets(
                    ws.wallets || [],
                    restoredTx,
                    settings.customExchangeRates,
                    1
                  ),
                  transactions: (ws.transactions || []).map((tx) => (tx.id === id ? restoredTx : tx)),
                  auditLogs: appendLocalOrgAuditLog(
                    ws,
                    'restore',
                    'transaction',
                    id,
                    actor,
                    `التراجع عن حذف معاملة`
                  ),
                };
              });
            },
          });
          return;
        }
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
      syncWorkspaceTxDeleteImmediately('personal', [id]);

      setUndoAction({
        id: `undo-${Date.now()}`,
        message: t('transactionDeleted'),
        action: () => {
          setPersonalTransactions(prevTx);
          setPersonalWallets(prevWallets);
          savePersonalState({ transactions: prevTx, wallets: prevWallets });
          syncWorkspaceTxWriteImmediately('personal', { ...oldTx, workspaceId: 'personal' }, true);
        },
      });
    },
    [
      transactions,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      canOrgApprove,
      settings.language,
      settings.customExchangeRates,
      getOrgActor,
      mutateLocalOrgWorkspace,
      activeCloudWallets,
      applyDeltasToWallets,
      personalWallets,
      personalTransactions,
      savePersonalState,
      syncWorkspaceTxDeleteImmediately,
      syncWorkspaceTxWriteImmediately,
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

      if (isUsingLocalOrgMode) {
        const now = Date.now();
        const delIds = new Set(deletable.map((tx) => tx.id));
        mutateLocalOrgWorkspace(orgId, (ws) => {
          let runningWallets = [...(ws.wallets || [])];
          for (const tx of deletable) {
            runningWallets = applyOrgTxBalanceToWallets(
              runningWallets,
              tx,
              settings.customExchangeRates,
              -1
            );
          }
          return {
            ...ws,
            wallets: runningWallets,
            transactions: (ws.transactions || []).map((tx) =>
              delIds.has(tx.id) ? { ...tx, deletedAt: now, deletedBy: actor.uid, updatedAt: now } : tx
            ),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'delete',
              'transaction',
              orgId,
              actor,
              `حذف ${deletable.length} معاملات محددة`
            ),
          };
        });
        return;
      }

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
    const deletedPersonalTxs = personalTransactions.filter((t) => toDeleteSet.has(t.id));
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
    syncWorkspaceTxDeleteImmediately(
      'personal',
      deletedPersonalTxs.map((t) => t.id)
    );

    setUndoAction({
      id: `undo-multi-${Date.now()}`,
      message: t('transactionsDeleted'),
      action: () => {
        setPersonalTransactions(previousTx);
        setPersonalWallets(previousWallets);
        savePersonalState({ transactions: previousTx, wallets: previousWallets });
        syncWorkspaceTxsBatchImmediately('personal', deletedPersonalTxs);
      },
    });
  }, [
    selectedTransactionIds,
    isOrgWorkspace,
    isUsingLocalOrgMode,
    activeOrganization,
    canOrgWrite,
    canOrgApprove,
    activeOrgRole,
    getOrgActor,
    mutateLocalOrgWorkspace,
    orgTransactions,
    activeCloudWallets,
    settings.customExchangeRates,
    applyDeltasToWallets,
    personalWallets,
    personalTransactions,
    savePersonalState,
    syncWorkspaceTxDeleteImmediately,
    syncWorkspaceTxsBatchImmediately,
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

        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          const moveIds = new Set(txsToMove.map((tx) => tx.id));
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => {
            let runningWallets = [...(ws.wallets || [])];
            const destWallet = runningWallets.find((w) => w.id === toWalletId);
            if (!destWallet) return ws;

            const updatedTxs = (ws.transactions || []).map((tx) => {
              if (!moveIds.has(tx.id)) return tx;
              const oldWallet = runningWallets.find((w) => w.id === tx.walletId);
              runningWallets = applyOrgTxBalanceToWallets(
                runningWallets,
                tx,
                settings.customExchangeRates,
                -1
              );
              const currencyDiffers = Boolean(oldWallet && oldWallet.currency !== destWallet.currency);
              const fee = tx.type === 'transfer' && tx.transferFee && tx.transferFee > 0 ? tx.transferFee : 0;
              const convertedAmt = currencyDiffers
                ? convertCurrency(tx.amount, tx.currency, destWallet.currency, settings.customExchangeRates)
                : tx.amount;
              const convertedFee =
                currencyDiffers && fee > 0
                  ? convertCurrency(fee, tx.currency, destWallet.currency, settings.customExchangeRates)
                  : tx.transferFee;

              const nextItem: Transaction = {
                ...tx,
                walletId: toWalletId,
                ...(currencyDiffers
                  ? {
                      amount: convertedAmt,
                      currency: destWallet.currency,
                      ...(fee > 0 ? { transferFee: convertedFee } : {}),
                    }
                  : {}),
                updatedAt: Date.now(),
              };
              runningWallets = applyOrgTxBalanceToWallets(
                runningWallets,
                nextItem,
                settings.customExchangeRates,
                1
              );
              return nextItem;
            });

            return {
              ...ws,
              wallets: runningWallets,
              transactions: updatedTxs,
              auditLogs: appendLocalOrgAuditLog(
                ws,
                'update',
                'transaction',
                toWalletId,
                actor,
                `نقل ${txsToMove.length} معاملة إلى محفظة أخرى`
              ),
            };
          });
          return;
        }

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
      const changedMovedTxs = nextTx.filter((tx, i) => tx !== personalTransactions[i]);
      const revertedMovedTxs = previousTx.filter((tx, i) => nextTx[i] !== tx);
      setPersonalTransactions(nextTx);
      setPersonalWallets(updatedWallets);
      savePersonalState({ transactions: nextTx, wallets: updatedWallets });
      syncWorkspaceTxsBatchImmediately('personal', changedMovedTxs);
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
          syncWorkspaceTxsBatchImmediately('personal', revertedMovedTxs);
        },
      });
    },
    [
      selectedTransactionIds,
      wallets,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      orgTransactions,
      activeCloudWallets,
      settings.customExchangeRates,
      settings.language,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalWallets,
      personalTransactions,
      savePersonalState,
      syncWorkspaceTxsBatchImmediately,
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
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          const updateIds = new Set(txsToUpdate.map((tx) => tx.id));
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            transactions: (ws.transactions || []).map((tx) =>
              updateIds.has(tx.id) ? { ...tx, categoryId: newCategoryId, updatedAt: Date.now() } : tx
            ),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'update',
              'transaction',
              newCategoryId,
              actor,
              `تعديل فئة ${txsToUpdate.length} معاملة`
            ),
          }));
          return;
        }
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
      const changedTxs = nextTx.filter((tx) => toChangeSet.has(tx.id));
      setSelectedTransactionIds([]);
      setPersonalTransactions(nextTx);
      savePersonalState({ transactions: nextTx });
      syncWorkspaceTxsBatchImmediately('personal', changedTxs);
    },
    [
      selectedTransactionIds,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      orgTransactions,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalTransactions,
      savePersonalState,
      syncWorkspaceTxsBatchImmediately,
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
      const targetWsId = isOrgWorkspace && activeOrganization ? activeOrganization.id : 'personal';
      const newWallet: Wallet = {
        ...data,
        workspaceId: targetWsId,
        id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        balance: data.initialBalance,
        initialBalanceMinor: toMinor(data.initialBalance, data.currency),
        balanceMinor: toMinor(data.initialBalance, data.currency),
        isArchived: false,
        order: getNextWalletOrder(wallets),
      };
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return newWallet;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            wallets: [...(ws.wallets || []), newWallet],
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'create',
              'wallet',
              newWallet.id,
              actor,
              `إضافة محفظة/خزينة: ${newWallet.name}`
            ),
          }));
          return newWallet;
        }
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
    [
      wallets,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalWallets,
      savePersonalState,
    ]
  );

  const updateWallet = useCallback(
    (id: string, updates: Partial<Wallet>) => {
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            wallets: (ws.wallets || []).map((w) => (w.id === id ? applyWalletUpdates(w, updates) : w)),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'update',
              'wallet',
              id,
              actor,
              'تحديث بيانات محفظة/خزينة'
            ),
          }));
          return;
        }
        const existing = activeCloudWallets.find((w) => w.id === id);
        if (!existing) return;
        const updatedWallet = applyWalletUpdates(existing, updates);
        setActiveCloudWallets((prev) => prev.map((w) => (w.id === id ? updatedWallet : w)));
        void upsertOrgWalletCloud(
          activeOrganization.id,
          updatedWallet,
          false,
          getOrgActor()
        ).catch((err) => setOrgActionError(err instanceof Error ? err.message : 'Wallet update failed'));
        return;
      }
      const nextWallets = personalWallets.map((w) =>
        w.id === id ? applyWalletUpdates(w, updates) : w
      );
      setPersonalWallets(nextWallets);
      savePersonalState({ wallets: nextWallets });
    },
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      activeCloudWallets,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalWallets,
      savePersonalState,
    ]
  );

  const reorderWallets = useCallback(
    (orderedWallets: Wallet[]) => {
      const normalized = assignSequentialWalletOrder(orderedWallets).map((w) => ({
        ...w,
        updatedAt: Date.now(),
      }));

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            wallets: normalized,
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'update',
              'wallet',
              activeOrganization.id,
              actor,
              'إعادة ترتيب المحافظ والخزائن'
            ),
          }));
          return;
        }

        const prevOrderById = new Map(activeCloudWallets.map((w) => [w.id, w.order]));
        setActiveCloudWallets(normalized);
        normalized.forEach((w) => {
          if (prevOrderById.get(w.id) !== w.order) {
            void upsertOrgWalletCloud(activeOrganization.id, w, false, getOrgActor()).catch((err) =>
              setOrgActionError(err instanceof Error ? err.message : 'Wallet reorder failed')
            );
          }
        });
        return;
      }

      setPersonalWallets(normalized);
      savePersonalState({ wallets: normalized });
    },
    [
      isOrgWorkspace,
      activeOrganization,
      canOrgWrite,
      isUsingLocalOrgMode,
      getOrgActor,
      mutateLocalOrgWorkspace,
      activeCloudWallets,
      savePersonalState,
    ]
  );

  const migrateAndDeleteWallet = useCallback(
    (walletId: string, targetWalletId: string) => {
      const targetWallet = wallets.find((w) => w.id === targetWalletId);
      const sourceWallet = wallets.find((w) => w.id === walletId);
      if (!targetWallet || !sourceWallet || walletId === targetWalletId) return;

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgManage) return;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          const convertedRemaining = convertCurrency(
            sourceWallet.balance,
            sourceWallet.currency,
            targetWallet.currency,
            settings.customExchangeRates
          );
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => {
            const migratedTx = (ws.transactions || []).map((tx) => {
              if (tx.walletId !== walletId && tx.toWalletId !== walletId) return tx;
              return {
                ...tx,
                walletId: tx.walletId === walletId ? targetWalletId : tx.walletId,
                toWalletId: tx.toWalletId === walletId ? targetWalletId : tx.toWalletId,
                updatedAt: Date.now(),
              };
            });
            const migratedBudgets = (ws.budgets || []).map((b) =>
              b.walletId === walletId ? { ...b, walletId: targetWalletId } : b
            );
            const nextWallets = (ws.wallets || [])
              .filter((w) => w.id !== walletId)
              .map((w) => {
                if (w.id !== targetWalletId) return w;
                const nextBal = roundCurrency(w.balance + convertedRemaining, w.currency);
                return {
                  ...w,
                  balance: nextBal,
                  balanceMinor: toMinor(nextBal, w.currency),
                };
              });
            return {
              ...ws,
              wallets: nextWallets,
              transactions: migratedTx,
              budgets: migratedBudgets,
              auditLogs: appendLocalOrgAuditLog(
                ws,
                'delete',
                'wallet',
                walletId,
                actor,
                `ترحيل وحذف محفظة إلى ${targetWallet.name}`
              ),
            };
          });
          return;
        }
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

      const touchedMigratedTx = migratedTx.filter((tx, i) => tx !== personalTransactions[i]);
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
      syncWorkspaceTxsBatchImmediately('personal', touchedMigratedTx);
    },
    [
      wallets,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgManage,
      orgTransactions,
      getOrgActor,
      mutateLocalOrgWorkspace,
      settings.customExchangeRates,
      activeCloudWallets,
      personalTransactions,
      personalBudgets,
      personalTemplates,
      personalGoals,
      personalWallets,
      savePersonalState,
      syncWorkspaceTxsBatchImmediately,
    ]
  );

  const deleteWallet = useCallback(
    (id: string) => {
      if (wallets.length <= 1) {
        showToast(
          settings.language === 'en'
            ? 'Cannot delete this wallet. Your account must have at least one wallet to record transactions. You can edit its details instead.'
            : 'لا يمكن حذف هذه المحفظة. يجب أن يحتوي حسابك على محفظة واحدة على الأقل لتسجيل المعاملات. يمكنك تعديل بياناتها بدلاً من حذفها.',
          'warning'
        );
        return;
      }
      if (getWalletDependencies(id).totalCount > 0) return;
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgManage) return;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            wallets: (ws.wallets || []).filter((w) => w.id !== id),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'delete',
              'wallet',
              id,
              actor,
              'حذف محفظة/خزينة'
            ),
          }));
          return;
        }
        void deleteOrgWalletCloud(activeOrganization.id, id, getOrgActor()).catch((err) =>
          setOrgActionError(err instanceof Error ? err.message : 'Wallet delete failed')
        );
        return;
      }
      const nextWallets = personalWallets.filter((w) => w.id !== id);
      setPersonalWallets(nextWallets);
      savePersonalState({ wallets: nextWallets });
    },
    [
      wallets.length,
      showToast,
      settings.language,
      getWalletDependencies,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgManage,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalWallets,
      savePersonalState,
    ]
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
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            categories: [...(ws.categories || []), newCat],
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'create',
              'category',
              newCat.id,
              actor,
              `إضافة بند: ${newCat.nameAr}`
            ),
          }));
          return newCat;
        }
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
    [
      categories.length,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalCategories,
      savePersonalState,
    ]
  );

  const updateCategory = useCallback(
    (id: string, updates: Partial<Category>) => {
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            categories: (ws.categories || []).map((c) => (c.id === id ? { ...c, ...updates } : c)),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'update',
              'category',
              id,
              actor,
              'تحديث بند مصروفات/إيرادات'
            ),
          }));
          return;
        }
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
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      activeCloudCategories,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalCategories,
      savePersonalState,
    ]
  );

  const migrateAndDeleteCategory = useCallback(
    (categoryId: string, targetCategoryId: string) => {
      if (categoryId === targetCategoryId) return;

      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgManage) return;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            categories: (ws.categories || []).filter((c) => c.id !== categoryId),
            transactions: (ws.transactions || []).map((tx) =>
              tx.categoryId === categoryId ? { ...tx, categoryId: targetCategoryId, updatedAt: Date.now() } : tx
            ),
            budgets: (ws.budgets || []).map((b) =>
              b.categoryId === categoryId ? { ...b, categoryId: targetCategoryId } : b
            ),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'delete',
              'category',
              categoryId,
              actor,
              'ترحيل وحذف بند'
            ),
          }));
          return;
        }
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

      const touchedMigratedCategoryTx: Transaction[] = [];
      const migratedTx = personalTransactions.map((tx) => {
        if (tx.categoryId !== categoryId) return tx;
        const nextItem: Transaction = {
          ...tx,
          categoryId: targetCategoryId,
          workspaceId: 'personal',
          updatedAt: Date.now(),
        };
        touchedMigratedCategoryTx.push(nextItem);
        return nextItem;
      });
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
      if (touchedMigratedCategoryTx.length > 0) {
        syncWorkspaceTxsBatchImmediately('personal', touchedMigratedCategoryTx);
      }
    },
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgManage,
      orgTransactions,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalTransactions,
      personalBudgets,
      personalTemplates,
      personalCategories,
      savePersonalState,
      syncWorkspaceTxsBatchImmediately,
    ]
  );

  const deleteCategory = useCallback(
    (id: string) => {
      if (getCategoryDependencies(id).totalCount > 0) return;
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgManage) return;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            categories: (ws.categories || []).filter((c) => c.id !== id),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'delete',
              'category',
              id,
              actor,
              'حذف بند'
            ),
          }));
          return;
        }
        void deleteOrgCategoryCloud(activeOrganization.id, id, getOrgActor()).catch((err) =>
          setOrgActionError(err instanceof Error ? err.message : 'Category delete failed')
        );
        return;
      }
      const nextCategories = personalCategories.filter((c) => c.id !== id);
      setPersonalCategories(nextCategories);
      savePersonalState({ categories: nextCategories });
    },
    [
      getCategoryDependencies,
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgManage,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalCategories,
      savePersonalState,
    ]
  );

  // ===========================================================================
  // Budgets, Debts, Goals, Templates
  // ===========================================================================
  const addBudget = useCallback(
    (data: Omit<Budget, 'id'>) => {
      const newBudget: Budget = { ...data, id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 5)}` };
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return newBudget;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            budgets: [...(ws.budgets || []), newBudget],
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'create',
              'budget',
              newBudget.id,
              actor,
              'إضافة ميزانية للمؤسسة'
            ),
          }));
          return newBudget;
        }
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
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalBudgets,
      savePersonalState,
    ]
  );

  const updateBudget = useCallback(
    (id: string, updates: Partial<Budget>) => {
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgWrite) return;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            budgets: (ws.budgets || []).map((b) => (b.id === id ? { ...b, ...updates } : b)),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'update',
              'budget',
              id,
              actor,
              'تحديث ميزانية المؤسسة'
            ),
          }));
          return;
        }
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
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgWrite,
      activeCloudBudgets,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalBudgets,
      savePersonalState,
    ]
  );

  const deleteBudget = useCallback(
    (id: string) => {
      if (isOrgWorkspace && activeOrganization) {
        if (!canOrgManage) return;
        if (isUsingLocalOrgMode) {
          const actor = getOrgActor();
          mutateLocalOrgWorkspace(activeOrganization.id, (ws) => ({
            ...ws,
            budgets: (ws.budgets || []).filter((b) => b.id !== id),
            auditLogs: appendLocalOrgAuditLog(
              ws,
              'delete',
              'budget',
              id,
              actor,
              'حذف ميزانية المؤسسة'
            ),
          }));
          return;
        }
        void deleteOrgBudgetCloud(activeOrganization.id, id, getOrgActor()).catch((err) =>
          setOrgActionError(err instanceof Error ? err.message : 'Budget delete failed')
        );
        return;
      }
      const nextBudgets = personalBudgets.filter((b) => b.id !== id);
      setPersonalBudgets(nextBudgets);
      savePersonalState({ budgets: nextBudgets });
    },
    [
      isOrgWorkspace,
      isUsingLocalOrgMode,
      activeOrganization,
      canOrgManage,
      getOrgActor,
      mutateLocalOrgWorkspace,
      personalBudgets,
      savePersonalState,
    ]
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
            workspaceId: 'personal',
            deletedAt: null,
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
          syncWorkspaceTxWriteImmediately('personal', newTx, true);
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
      syncWorkspaceTxWriteImmediately,
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
            workspaceId: 'personal',
            deletedAt: null,
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
          syncWorkspaceTxWriteImmediately('personal', newTx, true);
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
      syncWorkspaceTxWriteImmediately,
    ]
  );

  // Settings & Onboarding
  const updateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      let effectivePartial: Partial<AppSettings> = partial;
      const isThemeUpdate = partial.theme !== undefined;

      if (isThemeUpdate) {
        const nextTheme = normalizeThemePreference(partial.theme) ?? DEFAULT_SETTINGS.theme;
        const prevThemeTs = Number(latestPersonalRef.current.settings.themeUpdatedAt || 0);
        const storedThemeTs = Number(readStoredThemePreference()?.updatedAt || 0);
        const themeTs = Math.max(Date.now(), prevThemeTs + 1, storedThemeTs + 1);
        // Immediately persist theme to dedicated localStorage & apply .dark on <html> before React/cloud sync
        writeStoredThemePreference(nextTheme, themeTs);
        applyThemeToDocument(nextTheme);
        effectivePartial = {
          ...partial,
          theme: nextTheme,
          themeUpdatedAt: themeTs,
        };
      }

      const mergedNext = mergeSettingsWithDefaults({
        ...latestPersonalRef.current.settings,
        ...effectivePartial,
        socialLinks: effectivePartial.socialLinks
          ? {
              ...(latestPersonalRef.current.settings.socialLinks || {}),
              ...effectivePartial.socialLinks,
            }
          : latestPersonalRef.current.settings.socialLinks,
      });
      latestPersonalRef.current = {
        ...latestPersonalRef.current,
        settings: mergedNext,
      };
      setSettings((prev) => {
        const next = mergeSettingsWithDefaults({
          ...prev,
          ...effectivePartial,
          socialLinks: effectivePartial.socialLinks
            ? { ...(prev.socialLinks || {}), ...effectivePartial.socialLinks }
            : prev.socialLinks,
        });
        savePersonalState({ settings: next }, isThemeUpdate ? { immediate: true } : undefined);
        return next;
      });
      if (
        (partial.customExchangeRates !== undefined ||
          partial.useUpdatedExchangeRates !== undefined) &&
        auth.currentUser &&
        latestPersonalRef.current.user?.isLoggedIn &&
        auth.currentUser.uid === latestPersonalRef.current.user.id &&
        (typeof navigator === 'undefined' || navigator.onLine)
      ) {
        void syncUserCurrencyRatesToCloud(auth.currentUser.uid, {
          rates: getLiveExchangeRatesRuntime() || undefined,
          fetchedAtMs: mergedNext.ratesUpdatedAtMs,
          ratesLastUpdated: mergedNext.ratesLastUpdated,
          useUpdatedExchangeRates: mergedNext.useUpdatedExchangeRates,
          customExchangeRates: mergedNext.customExchangeRates,
        }).catch((err) => {
          console.warn('Currency settings cloud sync warning:', err);
        });
      }
    },
    [savePersonalState]
  );

  const completeOnboarding = useCallback(
    (mainCurrency: string, firstWalletName: string, initialBalance: number) => {
      const cleanBalance = Number.isFinite(initialBalance) ? initialBalance : 0;
      const firstWallet: Wallet = {
        id: 'w-primary',
        name:
          firstWalletName.trim() ||
          (settings.language === 'en' ? 'Cash' : 'الخزينة الرئيسية'),
        currency: mainCurrency,
        initialBalance: cleanBalance,
        initialBalanceMinor: toMinor(cleanBalance, mainCurrency),
        balance: cleanBalance,
        balanceMinor: toMinor(cleanBalance, mainCurrency),
        color: '#3A605B',
        icon: 'Wallet',
        isArchived: false,
        order: 1,
      };

      const updatedSettings: AppSettings = {
        ...latestPersonalRef.current.settings,
        mainCurrency,
      };
      setPersonalWallets([firstWallet]);
      setSettings((prev) => ({ ...prev, mainCurrency }));
      setHasCompletedOnboarding(true);
      setActiveWorkspace('personal');
      saveActiveWorkspacePref('personal');
      setCloudDiagnosticsError(null);
      setCloudSyncError(null);

      savePersonalState(
        {
          wallets: [firstWallet],
          settings: updatedSettings,
          hasCompletedOnboarding: true,
        },
        { immediate: true }
      );

      if (
        auth.currentUser &&
        (typeof navigator === 'undefined' || navigator.onLine)
      ) {
        isCloudLoadedRef.current = true;
        hasCompletedInitialCloudSyncRef.current = true;
        setIsCloudLoaded(true);
        void markUserOnboardingCompletedCloud(auth.currentUser.uid);
      }
    },
    [settings, savePersonalState]
  );

  const loadDemoData = useCallback(() => {
    const demo = generateDemoSeedData(settings.mainCurrency);
    if (demo.wallets) setPersonalWallets(demo.wallets);
    if (demo.transactions) setPersonalTransactions(demo.transactions);
    if (demo.templates) setPersonalTemplates(demo.templates);
    if (demo.budgets) setPersonalBudgets(demo.budgets);
    if (demo.debts) setPersonalDebts(demo.debts);
    if (demo.goals) setPersonalGoals(demo.goals);
    saveGuestModePref(true);
    setIsGuestMode(true);
    setHasCompletedOnboarding(true);
    setActiveWorkspace('personal');
    saveActiveWorkspacePref('personal');

    savePersonalState({
      wallets: demo.wallets,
      transactions: demo.transactions,
      templates: demo.templates,
      budgets: demo.budgets,
      debts: demo.debts,
      goals: demo.goals,
      hasCompletedOnboarding: true,
    });
  }, [settings.mainCurrency, savePersonalState]);

  const resetAllData = useCallback(() => {
    const cleanWallets = [createCleanDefaultWallet('EGP', settings.language)];
    const preservedResetTheme = readStoredThemePreference();
    const resetSettings: AppSettings = preservedResetTheme
      ? {
          ...DEFAULT_SETTINGS,
          theme: preservedResetTheme.theme,
          ...(preservedResetTheme.updatedAt > 0
            ? { themeUpdatedAt: preservedResetTheme.updatedAt }
            : {}),
        }
      : DEFAULT_SETTINGS;
    const freshData: AppDatabaseData = {
      transactions: [],
      wallets: cleanWallets,
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      debts: [],
      goals: [],
      templates: [],
      moneyCircles: [],
      settings: resetSettings,
      user: latestPersonalRef.current.user,
      hasCompletedOnboarding: false,
    };

    setPersonalTransactions([]);
    setPersonalWallets(cleanWallets);
    setPersonalCategories(DEFAULT_CATEGORIES);
    setPersonalBudgets([]);
    setPersonalDebts([]);
    setPersonalGoals([]);
    setPersonalTemplates([]);
    setPersonalMoneyCircles([]);
    setActiveWorkspace('personal');
    saveActiveWorkspacePref('personal');
    setSettings(resetSettings);
    setHasCompletedOnboarding(false);

    persistDataDebounced(freshData, handleLocalPersistError);
  }, [settings.language, handleLocalPersistError]);

  const isRTL = settings.language === 'ar';

  const entitlementValue: EntitlementContextValue = useMemo(
    () => ({
      isPro,
      isBusinessPro,
      planTier,
      proEntitlement: verifiedPro,
      subscriptionSummary,
      isAdminUser,
      isAdminCodeModalOpen,
      setIsAdminCodeModalOpen,
      openAdminPanel,
      scanQuota,
      setScanQuota,
      refreshScanQuota,
      isUpgradeModalOpen,
      setIsUpgradeModalOpen: handleSetIsUpgradeModalOpen,
      startBusinessTrial,
      devActivateProPreview,
      restorePurchases,
    }),
    [
      isPro,
      isBusinessPro,
      planTier,
      verifiedPro,
      subscriptionSummary,
      isAdminUser,
      isAdminCodeModalOpen,
      openAdminPanel,
      scanQuota,
      refreshScanQuota,
      isUpgradeModalOpen,
      handleSetIsUpgradeModalOpen,
      startBusinessTrial,
      devActivateProPreview,
      restorePurchases,
    ]
  );

  const orgValue: OrgContextValue = useMemo(
    () => ({
      activeWorkspace,
      orgRefs,
      localOrgWorkspaces,
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
      orgMigrationSuccessMessage,
      clearOrgMigrationSuccessMessage,
      setOrgMigrationSuccessMessage,
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
      searchUserForOrg,
      addOrgMemberDirectly,
      manageOrgMember,
      transferOrgOwnership,
      deleteOrganization,
      isOrgHubOpen,
      setIsOrgHubOpen,
      orgHubTab,
      setOrgHubTab,
      openOrgHub,
      isWorkspaceModalOpen,
      setIsWorkspaceModalOpen,
    }),
    [
      activeWorkspace,
      orgRefs,
      localOrgWorkspaces,
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
      orgMigrationSuccessMessage,
      clearOrgMigrationSuccessMessage,
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
      searchUserForOrg,
      addOrgMemberDirectly,
      manageOrgMember,
      transferOrgOwnership,
      deleteOrganization,
      isOrgHubOpen,
      orgHubTab,
      openOrgHub,
      isWorkspaceModalOpen,
    ]
  );

  const appValue = useMemo<AppContextType>(
    () => ({
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
      isGuestMode,
      enterGuestMode,

      activeWorkspace,
      orgRefs,
      localOrgWorkspaces,
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
      upgradeLocalOrgToCloud,
      joinOrganizationByCode,
      pendingJoinCode,
      clearPendingJoinCode,
      updateOrganizationSettings,
      lockAccountingPeriod,

      legacyLocalOrgs,
      isOrgMigrationModalOpen,
      orgMigrationSuccessMessage,
      clearOrgMigrationSuccessMessage,
      setOrgMigrationSuccessMessage,
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
      searchUserForOrg,
      addOrgMemberDirectly,
      manageOrgMember,
      transferOrgOwnership,
      deleteOrganization,

      isOrgHubOpen,
      setIsOrgHubOpen,
      orgHubTab,
      setOrgHubTab,
      openOrgHub,
      isWorkspaceModalOpen,
      setIsWorkspaceModalOpen,

      activeNav,
      setActiveNav,
      activeWalletId,
      setActiveWalletId,
      homeTab,
      setHomeTab,
      navigateBackFromWallet,
      registerModalBackHandler,
      unregisterModalBackHandler,
      isAddModalOpen,
      setIsAddModalOpen: handleSetIsAddModalOpen,
      editingTransaction,
      setEditingTransaction,
      transactionDraft,
      openTransactionWithPreset,
      isSettingsOpen,
      setIsSettingsOpen: handleSetIsSettingsOpen,
      openAdminPanelRequested,
      openAdminSettingsPanel,
      isAdminUser,
      refreshAdminStatus,
      isAdminCodeModalOpen,
      setIsAdminCodeModalOpen,
      openAdminPanel,
      isLogoutModalOpen,
      setIsLogoutModalOpen,
      hasUnsyncedLocalChanges,
      signOutAndResetDevice,
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
      setIsUpgradeModalOpen: handleSetIsUpgradeModalOpen,

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
      subscriptionSummary,
      startBusinessTrial,
      devActivateProPreview,
      restorePurchases,
      scanQuota,
      setScanQuota,
      refreshScanQuota,
      isCloudSyncing,
      cloudSyncStatus,
      cloudSyncError,
      cloudDiagnosticsError,
      clearCloudDiagnosticsError,
      cloudSkippedAttachmentsWarning,
      cloudConflict,
      lastCloudBackupExists,
      isCloudLoaded,
      cloudBackupHistory,
      refreshCloudBackupHistory,
      restoreFromBackupHistoryEntry,
      signInWithGoogleAccount,
      signOutGoogleAccount,
      checkUsernameAvailable,
      updateUsername,
      syncToCloudNow,
      restoreFromCloudNow,
      emergencyCloudRecovery,
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
      toastMessage,
      showToast,
      clearToast,

      addTransaction,
      importTransactionsBatch,
      importSpreadsheetBatchLocally,
      syncWorkspaceBackupNow,
      backgroundImportSync,
      startBackgroundImportCloudSync,
      retryBackgroundImportCloudSync,
      dismissBackgroundImportCloudSync,
      updateTransaction,
      deleteTransaction,
      deleteSelectedTransactions,
      moveSelectedTransactions,
      duplicateTransaction,

      addWallet,
      updateWallet,
      reorderWallets,
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

      canInstallPWA: pwaInstallState.isInstallable,
      isPWAInstalled: pwaInstallState.isInstalled,
      isIOSDevice: pwaInstallState.isIOS,
      promptPWAInstall,

      t,
      isRTL,
    }),
    [
      isLoading,
      transactions,
      wallets,
      categories,
      budgets,
      debts,
      goals,
      templates,
      personalMoneyCircles,
      settings,
      user,
      hasCompletedOnboarding,
      isGuestMode,
      enterGuestMode,
      activeWorkspace,
      orgRefs,
      localOrgWorkspaces,
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
      upgradeLocalOrgToCloud,
      joinOrganizationByCode,
      pendingJoinCode,
      clearPendingJoinCode,
      updateOrganizationSettings,
      lockAccountingPeriod,
      legacyLocalOrgs,
      isOrgMigrationModalOpen,
      orgMigrationSuccessMessage,
      clearOrgMigrationSuccessMessage,
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
      searchUserForOrg,
      addOrgMemberDirectly,
      manageOrgMember,
      transferOrgOwnership,
      deleteOrganization,
      isOrgHubOpen,
      orgHubTab,
      openOrgHub,
      isWorkspaceModalOpen,
      activeNav,
      activeWalletId,
      homeTab,
      navigateBackFromWallet,
      registerModalBackHandler,
      unregisterModalBackHandler,
      isAddModalOpen,
      handleSetIsAddModalOpen,
      editingTransaction,
      transactionDraft,
      openTransactionWithPreset,
      isSettingsOpen,
      handleSetIsSettingsOpen,
      openAdminPanelRequested,
      openAdminSettingsPanel,
      isAdminUser,
      refreshAdminStatus,
      isAdminCodeModalOpen,
      openAdminPanel,
      isLogoutModalOpen,
      hasUnsyncedLocalChanges,
      signOutAndResetDevice,
      isFilterOpen,
      isBackupOpen,
      isReportsOpen,
      isCategoriesManagerOpen,
      isCurrenciesManagerOpen,
      isUpgradeModalOpen,
      handleSetIsUpgradeModalOpen,
      currencyPickerOpen,
      currencyPickerSelectedCode,
      openCurrencyPicker,
      closeCurrencyPicker,
      onCurrencySelectCallback,
      filters,
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
      verifiedPro,
      subscriptionSummary,
      startBusinessTrial,
      devActivateProPreview,
      restorePurchases,
      scanQuota,
      refreshScanQuota,
      isCloudSyncing,
      cloudSyncStatus,
      cloudSyncError,
      cloudDiagnosticsError,
      clearCloudDiagnosticsError,
      cloudSkippedAttachmentsWarning,
      cloudConflict,
      lastCloudBackupExists,
      isCloudLoaded,
      cloudBackupHistory,
      refreshCloudBackupHistory,
      restoreFromBackupHistoryEntry,
      signInWithGoogleAccount,
      signOutGoogleAccount,
      checkUsernameAvailable,
      updateUsername,
      syncToCloudNow,
      restoreFromCloudNow,
      emergencyCloudRecovery,
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
      triggerUndo,
      toastMessage,
      showToast,
      clearToast,
      addTransaction,
      importTransactionsBatch,
      importSpreadsheetBatchLocally,
      syncWorkspaceBackupNow,
      backgroundImportSync,
      startBackgroundImportCloudSync,
      retryBackgroundImportCloudSync,
      dismissBackgroundImportCloudSync,
      updateTransaction,
      deleteTransaction,
      deleteSelectedTransactions,
      moveSelectedTransactions,
      duplicateTransaction,
      addWallet,
      updateWallet,
      reorderWallets,
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
      pwaInstallState.isInstallable,
      pwaInstallState.isInstalled,
      pwaInstallState.isIOS,
      promptPWAInstall,
      t,
      isRTL,
    ]
  );

  return (
    <EntitlementProvider value={entitlementValue}>
      <OrgProvider value={orgValue}>
        <AppContext.Provider value={appValue}>
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
