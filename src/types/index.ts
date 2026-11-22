/**
 * Types for Raseedi (رَصِيدِي) Expense Tracker, Budget Manager & Enterprise Accounting
 */

export type TransactionType = 'expense' | 'income' | 'transfer';
export type PriorityLevel = 'essential' | 'normal' | 'leisure'; // ضروري | عادي | ترفيهي
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type DebtType = 'i_owe' | 'owed_to_me'; // عليّ | لي

export type PlanTier = 'free' | 'personal_pro' | 'business_pro';
export type BillingCycle = 'free' | 'monthly' | 'yearly' | 'lifetime' | 'trial' | 'code';
export type ProPlanCode =
  | 'free'
  | 'monthly'
  | 'yearly'
  | 'lifetime'
  | 'business_monthly'
  | 'business_yearly'
  | 'trial'
  | 'code';

export type WorkspaceMode = 'personal' | 'organization';
export type OrganizationIndustry =
  | 'retail'
  | 'restaurant'
  | 'tech'
  | 'construction'
  | 'medical'
  | 'general';
export type WalletType = 'standard' | 'petty_cash' | 'bank_account';
export type WalletAssetClass = 'spendable' | 'asset';
export type WalletAssetSubtype =
  | 'cash'
  | 'bank'
  | 'ewallet'
  | 'card'
  | 'savings'
  | 'certificate'
  | 'gold'
  | 'investment'
  | 'real_estate'
  | 'vehicle'
  | 'other_asset';
export type MerchantRuleMatchType = 'contains' | 'starts_with' | 'exact';
export type NetWorthTimeframe = '1M' | '3M' | '1Y' | 'ALL';
export type HomeSectionId =
  | 'hero'
  | 'quick_actions'
  | 'get_started'
  | 'net_worth'
  | 'cashflow_metrics'
  | 'insights'
  | 'alerts'
  | 'recent_transactions';

export interface MerchantRule {
  id: string;
  keyword: string;
  matchType?: MerchantRuleMatchType;
  type?: 'expense' | 'income' | 'both';
  categoryId?: string;
  walletId?: string;
  costCenterId?: string;
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type OrganizationRole = 'owner' | 'admin' | 'accountant' | 'employee' | 'viewer';
export type CanonicalApprovalStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'paid';
export type ApprovalStatus = CanonicalApprovalStatus | 'pending_approval';

export interface Currency {
  code: string;
  nameAr: string;
  nameEn: string;
  symbol: string;
  flag: string;
  rateToUSD: number; // For conversions
}

export interface Wallet {
  id: string;
  name: string;
  currency: string; // Currency code, e.g. EGP, USD, SAR
  initialBalance: number;
  initialBalanceMinor?: number;
  balance: number;
  balanceMinor?: number;
  color: string; // Gradient class or hex
  icon: string;
  isArchived: boolean;
  excludeFromTotal?: boolean;
  isLocked?: boolean;
  pin?: string;
  pinSalt?: string;
  order?: number;
  walletType?: WalletType;
  assetClass?: WalletAssetClass;
  assetSubtype?: WalletAssetSubtype;
  custodianMemberUid?: string;
  workspaceId?: string;
  updatedAt?: number;
}

export interface Category {
  id: string;
  nameAr: string;
  nameEn: string;
  icon: string;
  color: string;
  type: 'expense' | 'income' | 'both';
  isDefault?: boolean;
  isHidden?: boolean;
  workspaceId?: string;
  order: number;
}

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number; // e.g., every 2 weeks
  anchorDayOfMonth?: number; // Preserves Jan 31 -> Feb 28 -> Mar 31 anchor without drift
  endDate?: string; // ISO date
  maxOccurrences?: number;
  occurrencesCount: number;
  lastGeneratedDate?: string;
  nextDueDate: string;
}

export interface TransactionVatInfo {
  rate: number;
  amountMinor: number;
  inclusive: boolean;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  amountMinor?: number;
  currency: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  categoryId: string;
  walletId: string;
  toWalletId?: string; // For transfers
  convertedAmount?: number; // Destination amount for transfers
  convertedAmountMinor?: number;
  transferFee?: number; // Optional transfer / withdrawal fee deducted from source wallet
  transferFeeMinor?: number;
  exchangeRate?: number;
  notes?: string;
  attachments?: string[]; // Legacy Base64 data URLs or Storage download URLs
  attachmentPaths?: string[]; // Firebase Storage object paths (orgs/{orgId}/receipts/{txId}/...)
  group?: string; // Custom tag e.g. "رحلة الصيف"
  contact?: string; // Contact person name
  priority: PriorityLevel;
  doesNotAffectBalance: boolean;
  isRecurring?: boolean;
  recurrenceRule?: RecurrenceRule;
  createdAt: number;
  updatedAt: number;

  // Enterprise / Organization optional fields
  workspaceId?: string;
  approvalStatus?: ApprovalStatus;
  submittedBy?: string;
  submittedByName?: string;
  approvedBy?: string;
  approvedAt?: number;
  reviewedBy?: string;
  reviewedAt?: number;
  rejectionReason?: string;
  costCenterId?: string;
  partyId?: string;
  taxAmount?: number;
  taxRate?: number;
  isTaxInclusive?: boolean;
  vat?: TransactionVatInfo;
  invoiceNumber?: string;
  voucherNumber?: string;
  isReimbursement?: boolean;
  deletedAt?: number | null;
  deletedBy?: string | null;
}

export interface Template {
  id: string;
  name: string;
  type: TransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  walletId: string;
  toWalletId?: string;
  transferFee?: number;
  notes?: string;
  priority: PriorityLevel;
  group?: string;
  contact?: string;
  doesNotAffectBalance: boolean;
}

export interface Budget {
  id: string;
  name: string;
  amount: number;
  amountMinor?: number;
  month: string; // YYYY-MM
  categoryId?: string; // If null, applies to overall
  walletId?: string; // If null, applies to all wallets
  rollover: boolean; // Carry over surplus/deficit
  rolloverAmount?: number;
}

export interface DebtPayment {
  id: string;
  amount: number;
  date: string;
  walletId?: string;
  notes?: string;
}

export interface Debt {
  id: string;
  type: DebtType;
  personName: string;
  totalAmount: number;
  paidAmount: number;
  currency: string;
  dueDate?: string;
  monthlyInstallment?: number;
  notes?: string;
  contactPhone?: string;
  payments: DebtPayment[];
  isSettled: boolean;
  createdAt: number;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  currency: string;
  deadline?: string;
  icon: string;
  color: string;
  walletId?: string;
  isCompleted: boolean;
  createdAt: number;
}

export interface MoneyCircle {
  id: string;
  name: string;
  monthlyShare: number;
  currency: string;
  totalMonths: number;
  myTurnMonth: number; // 1-based month index when user receives the payout
  paidMonths: string[]; // Array of month numbers ("1", "2", ...) or YYYY-MM keys paid
  hasReceivedPayout: boolean;
  walletId?: string;
  notes?: string;
  createdAt: number;
}

export interface Organization {
  id: string;
  name: string;
  currency: string;
  mainCurrency?: string;
  industry?: OrganizationIndustry;
  vatRate: number; // Default e.g. 14 or 15
  taxNumber?: string;
  approvalThreshold: number; // Expenses above threshold require approval
  lockedUntilDate?: string; // YYYY-MM-DD accounting lock
  inviteCode?: string; // Deprecated plaintext code kept optional only for legacy backup compatibility
  ownerUid: string;
  ownerId?: string;
  planTier?: PlanTier;
  billingCycle?: BillingCycle;
  expiresAt?: number | null;
  plan?: 'trial' | 'business_monthly' | 'business_yearly';
  trialEndsAt?: number;
  subscriptionEndsAt?: number;
  seatLimit?: number;
  maxSeats?: number;
  aiScansUsed?: number;
  aiScansMonth?: string;
  aiScansLimit?: number;
  extraSeats?: number;
  localFirstMode?: boolean;
  cloudBackedUpAt?: number;
  migratedToCloudOrgId?: string;
  retainedLocalExtrasOnly?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface OrganizationMember {
  uid: string;
  email: string;
  displayName: string;
  username?: string;
  role: OrganizationRole;
  department?: string;
  spendingLimit?: number;
  spendingLimitMinor?: number;
  status: 'active' | 'invited' | 'suspended';
  joinedAt: number;
  updatedAt?: number;
}

export interface OrganizationInvite {
  id: string;
  orgId: string;
  role: Exclude<OrganizationRole, 'owner'>;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  usedCount: number;
  status: 'active' | 'revoked' | 'exhausted';
}

export interface OrgRef {
  orgId: string;
  orgName: string;
  role: OrganizationRole;
  status: 'active' | 'suspended';
  currency: string;
  joinedAt: number;
}

export interface CostCenter {
  id: string;
  orgId: string;
  code: string;
  name?: string;
  nameAr: string;
  nameEn: string;
  type?: 'department' | 'project' | 'branch';
  budgetAllocated: number;
  budgetAllocatedMinor?: number;
  isActive: boolean;
  createdAt: number;
}

export interface BusinessParty {
  id: string;
  orgId: string;
  type: 'vendor' | 'client' | 'both';
  name: string;
  phone?: string;
  email?: string;
  taxId?: string;
  creditLimit?: number;
  currency: string;
  balance: number; // Positive = open balance (Payable if vendor, Receivable if client)
  balanceMinor?: number;
  dueDate?: string; // YYYY-MM-DD
  notes?: string;
  createdAt: number;
}

export type AuditLogAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'approve'
  | 'reject'
  | 'lock_period'
  | 'role_change'
  | 'invite_create'
  | 'invite_revoke'
  | 'member_join'
  | 'member_remove'
  | 'transfer_ownership'
  | 'recalculate';

export interface AuditLogEntry {
  id: string;
  orgId: string;
  action: AuditLogAction;
  entityType: 'transaction' | 'wallet' | 'budget' | 'cost_center' | 'party' | 'member' | 'organization' | 'category' | 'invite';
  entityId: string;
  actorUid: string;
  actorName: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  timestamp: number;
}

export interface OrgWorkspaceData {
  organization: Organization;
  members: OrganizationMember[];
  costCenters: CostCenter[];
  parties: BusinessParty[];
  wallets: Wallet[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  debts: Debt[];
  goals: SavingsGoal[];
  templates: Template[];
  auditLogs: AuditLogEntry[];
  merchantRules?: MerchantRule[];
}

export interface AppNotificationItem {
  id: string;
  type:
    | 'budget_warning'
    | 'budget_exceeded'
    | 'debt_due'
    | 'debt_overdue'
    | 'daily_reminder'
    | 'pending_approval'
    | 'org_subscription_expiring'
    | 'org_subscription_grace'
    | 'org_subscription_readonly'
    | 'user_subscription_expiring';
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  severity: 'info' | 'warning' | 'danger';
  timestamp: number;
  read: boolean;
  actionTarget?: string;
}

export type ThemePreference = 'dark' | 'light' | 'system';

export interface AppSettings {
  firstDayOfMonth: number; // 1 to 31
  firstDayOfWeek: number; // 0 = Sunday, 1 = Monday, 6 = Saturday
  defaultFilter: 'all' | 'expense' | 'income';
  decimalPlaces: number; // 0, 1, 2, 3
  digitFormat: 'arabic' | 'western'; // '١٢٣' vs '123'
  excludeDebtsFromBalance: boolean;
  showCurrentBalance: boolean;
  useUpdatedExchangeRates: boolean;
  useRateAtTransactionTime: boolean;
  showPrioritiesInStatsOnly: boolean;
  useLastUsedWallet: boolean;
  showCalculatorKeypad: boolean;
  showAllData: boolean;
  collapsibleSections: boolean;
  showBudgetIndicator: boolean;
  theme: ThemePreference;
  themeUpdatedAt?: number;
  language: 'ar' | 'en';
  isPro: boolean;
  appPin?: string;
  appPinSalt?: string;
  isAppLockEnabled: boolean;
  lastUsedWalletId?: string;
  lastUsedTransactionType?: TransactionType;
  notificationsEnabled: boolean;
  debtRemindersEnabled?: boolean;
  budgetAlertsEnabled?: boolean;
  mainCurrency: string; // e.g. 'EGP'
  customExchangeRates: Record<string, number>; // currency code -> rate to USD
  ratesLastUpdated?: string;
  ratesUpdatedAtMs?: number;
  lastBackupAt?: number;
  lastCloudSyncAt?: number;
  lastKnownCloudUpdatedAtMs?: number;
  backupReminderDismissedAt?: number;
  socialLinks?: {
    facebookUrl?: string;
    instagramUrl?: string;
  };
  homeSectionOrders?: Record<string, HomeSectionId[]>;
  dismissedGetStartedIds?: string[];
  merchantRulesByWorkspace?: Record<string, MerchantRule[]>;
  raseediCredits?: import('../services/raseediCredits').RaseediCreditsState;
}

export interface VerifiedProEntitlement {
  uid: string;
  isPro: boolean;
  proActive?: boolean;
  proPlan: ProPlanCode;
  planTier?: PlanTier;
  billingCycle?: BillingCycle;
  startedAt?: number | null;
  expiresAt?: number | null;
  proExpiresAt?: number | null;
  verifiedAt: number;
  activatedViaCode?: boolean;
  codePreview?: string;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  username?: string;
  avatarUrl?: string;
  isLoggedIn: boolean;
}
