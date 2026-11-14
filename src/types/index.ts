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
export type OrganizationRole = 'owner' | 'admin' | 'accountant' | 'employee' | 'viewer';
export type ApprovalStatus = 'approved' | 'pending_approval' | 'rejected';

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
  balance: number;
  color: string; // Gradient class or hex
  icon: string;
  isArchived: boolean;
  isLocked?: boolean;
  pin?: string;
  pinSalt?: string;
  order: number;
  walletType?: WalletType;
  custodianMemberUid?: string;
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

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  categoryId: string;
  walletId: string;
  toWalletId?: string; // For transfers
  convertedAmount?: number; // Destination amount for transfers
  transferFee?: number; // Optional transfer / withdrawal fee deducted from source wallet
  exchangeRate?: number;
  notes?: string;
  attachments?: string[]; // Base64 data URLs
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
  reviewedBy?: string;
  reviewedAt?: number;
  rejectionReason?: string;
  costCenterId?: string;
  partyId?: string;
  taxAmount?: number;
  taxRate?: number;
  isTaxInclusive?: boolean;
  invoiceNumber?: string;
  voucherNumber?: string;
  isReimbursement?: boolean;
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
  inviteCode: string;
  ownerUid: string;
  ownerId?: string;
  plan?: 'trial' | 'business_monthly' | 'business_yearly';
  trialEndsAt?: number;
  subscriptionEndsAt?: number;
  maxSeats?: number;
  aiScansUsed?: number;
  aiScansLimit?: number;
  extraSeats?: number;
  createdAt: number;
  updatedAt: number;
}

export interface OrganizationMember {
  uid: string;
  email: string;
  displayName: string;
  role: OrganizationRole;
  department?: string;
  spendingLimit?: number;
  status: 'active' | 'invited' | 'suspended';
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
  dueDate?: string; // YYYY-MM-DD
  notes?: string;
  createdAt: number;
}

export type AuditLogAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'lock_period'
  | 'role_change';

export interface AuditLogEntry {
  id: string;
  orgId: string;
  action: AuditLogAction;
  entityType: 'transaction' | 'wallet' | 'budget' | 'cost_center' | 'party' | 'member' | 'organization' | 'category';
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
}

export interface AppNotificationItem {
  id: string;
  type: 'budget_warning' | 'budget_exceeded' | 'debt_due' | 'debt_overdue' | 'daily_reminder' | 'pending_approval';
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  severity: 'info' | 'warning' | 'danger';
  timestamp: number;
  read: boolean;
  actionTarget?: string;
}

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
  theme: 'dark' | 'light';
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
}

export interface VerifiedProEntitlement {
  uid: string;
  isPro: boolean;
  proPlan: ProPlanCode;
  planTier?: PlanTier;
  billingCycle?: BillingCycle;
  expiresAt?: number | null;
  proExpiresAt?: number | null;
  verifiedAt: number;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  isLoggedIn: boolean;
}
