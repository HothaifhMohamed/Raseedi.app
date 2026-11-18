/**
 * IndexedDB & Local Storage Persistence Service for Raseedi (رَصِيدِي)
 * IndexedDB is the primary source of truth (avoids 5MB localStorage quota failures with attachments).
 * LocalStorage acts only as a lightweight settings & fallback metadata cache.
 */
import {
  Transaction,
  Wallet,
  Category,
  Budget,
  Debt,
  SavingsGoal,
  Template,
  AppSettings,
  UserAccount,
  VerifiedProEntitlement,
  OrgWorkspaceData,
  MoneyCircle,
  OrganizationIndustry,
  CostCenter,
} from '../types';
import { SUPPORT_CONFIG } from '../constants/support';

const DB_NAME = 'raseedi_expense_tracker_db';
const DB_VERSION = 1;
const SETTINGS_LS_KEY = 'raseedi_settings_v1';
const LEGACY_LS_KEY = 'raseedi_data_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  firstDayOfMonth: 1,
  firstDayOfWeek: 6, // Saturday in Middle East
  defaultFilter: 'all',
  decimalPlaces: 2,
  digitFormat: 'western', // default 123 with toggle to ١٢٣
  excludeDebtsFromBalance: false,
  showCurrentBalance: true,
  useUpdatedExchangeRates: true,
  useRateAtTransactionTime: false,
  showPrioritiesInStatsOnly: false,
  useLastUsedWallet: true,
  showCalculatorKeypad: false,
  showAllData: true,
  collapsibleSections: true,
  showBudgetIndicator: true,
  theme: 'light',
  language: 'ar',
  isPro: false,
  isAppLockEnabled: false,
  notificationsEnabled: true,
  debtRemindersEnabled: true,
  budgetAlertsEnabled: true,
  mainCurrency: 'EGP',
  customExchangeRates: {},
  socialLinks: {
    facebookUrl: SUPPORT_CONFIG.defaultFacebookUrl,
    instagramUrl: SUPPORT_CONFIG.defaultInstagramUrl,
  },
};

export function mergeSettingsWithDefaults(
  rawSettings?: Partial<AppSettings> | null
): AppSettings {
  const mergedSocial = {
    facebookUrl:
      rawSettings?.socialLinks?.facebookUrl?.trim() || SUPPORT_CONFIG.defaultFacebookUrl,
    instagramUrl:
      rawSettings?.socialLinks?.instagramUrl?.trim() || SUPPORT_CONFIG.defaultInstagramUrl,
  };
  return {
    ...DEFAULT_SETTINGS,
    ...(rawSettings || {}),
    socialLinks: mergedSocial,
    isPro: false,
  };
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-restaurants', nameAr: 'مطاعم', nameEn: 'Restaurants', icon: 'Utensils', color: '#B5523B', type: 'expense', order: 1 },
  { id: 'cat-cafes', nameAr: 'كافيهات ومشروبات', nameEn: 'Cafes', icon: 'Coffee', color: '#C99A2E', type: 'expense', order: 2 },
  { id: 'cat-groceries', nameAr: 'سوبرماركت وتموين', nameEn: 'Groceries', icon: 'ShoppingCart', color: '#5E7F3A', type: 'expense', order: 3 },
  { id: 'cat-transport', nameAr: 'مواصلات وأجرة', nameEn: 'Transport', icon: 'Car', color: '#1E6F73', type: 'expense', order: 4 },
  { id: 'cat-fuel', nameAr: 'بنزين ووقود', nameEn: 'Fuel', icon: 'Fuel', color: '#9E6F38', type: 'expense', order: 5 },
  { id: 'cat-bills', nameAr: 'فواتير واشتراكات', nameEn: 'Bills & Utilities', icon: 'Receipt', color: '#545E75', type: 'expense', order: 6 },
  { id: 'cat-rent', nameAr: 'إيجار وسكن', nameEn: 'Rent & Housing', icon: 'Home', color: '#6A5243', type: 'expense', order: 7 },
  { id: 'cat-shopping', nameAr: 'تسوق وملابس', nameEn: 'Shopping', icon: 'ShoppingBag', color: '#8F4A63', type: 'expense', order: 8 },
  { id: 'cat-health', nameAr: 'صحة وأطباء', nameEn: 'Health & Doctors', icon: 'HeartPulse', color: '#A03838', type: 'expense', order: 9 },
  { id: 'cat-pharmacy', nameAr: 'صيدلية وأدوية', nameEn: 'Pharmacy', icon: 'Pill', color: '#3A706A', type: 'expense', order: 10 },
  { id: 'cat-education', nameAr: 'تعليم ودورات', nameEn: 'Education', icon: 'GraduationCap', color: '#415B76', type: 'expense', order: 11 },
  { id: 'cat-entertainment', nameAr: 'ترفيه ونزهات', nameEn: 'Entertainment', icon: 'Tv', color: '#7E4C76', type: 'expense', order: 12 },
  { id: 'cat-travel', nameAr: 'سفر وسياحة', nameEn: 'Travel', icon: 'Plane', color: '#386377', type: 'expense', order: 13 },
  { id: 'cat-gifts', nameAr: 'هدايا ومناسبات', nameEn: 'Gifts', icon: 'Gift', color: '#994553', type: 'expense', order: 14 },
  { id: 'cat-charity', nameAr: 'صدقة وتبرعات', nameEn: 'Charity', icon: 'HandHeart', color: '#496A42', type: 'expense', order: 15 },
  { id: 'cat-salary', nameAr: 'راتب شهري', nameEn: 'Salary', icon: 'Briefcase', color: '#5E7F3A', type: 'income', order: 16 },
  { id: 'cat-freelance', nameAr: 'عمل حر وأعمال خاصة', nameEn: 'Freelance', icon: 'Laptop', color: '#1E6F73', type: 'income', order: 17 },
  { id: 'cat-withdraw', nameAr: 'سحب رصيد / مكافأة', nameEn: 'Withdraw Balance', icon: 'ArrowDownToLine', color: '#5B4F73', type: 'income', order: 18 },
  { id: 'cat-other', nameAr: 'أخرى ومتنوعة', nameEn: 'Other', icon: 'Layers', color: '#7A7468', type: 'both', order: 19 },
];

export function createCleanDefaultWallet(
  currency = 'EGP',
  language: 'ar' | 'en' = 'ar'
): Wallet {
  return {
    id: 'w-main-treasury',
    name: language === 'en' ? 'Cash' : 'الخزينة الرئيسية',
    currency: currency || 'EGP',
    initialBalance: 0,
    initialBalanceMinor: 0,
    balance: 0,
    balanceMinor: 0,
    color: '#3A605B',
    icon: 'Wallet',
    isArchived: false,
    order: 1,
  };
}

export const DEFAULT_WALLETS: Wallet[] = [createCleanDefaultWallet('EGP', 'ar')];

export interface AppDatabaseData {
  transactions: Transaction[];
  wallets: Wallet[];
  categories: Category[];
  budgets: Budget[];
  debts: Debt[];
  goals: SavingsGoal[];
  templates: Template[];
  moneyCircles?: MoneyCircle[];
  settings: AppSettings;
  user: UserAccount | null;
  hasCompletedOnboarding: boolean;
}

let memoryCache: AppDatabaseData | null = null;

export async function openDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return null;

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('app_data')) {
          db.createObjectStore('app_data', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function normalizeLoadedState(raw: Partial<AppDatabaseData>): AppDatabaseData {
  const hasCompletedOnboarding = Boolean(raw.hasCompletedOnboarding);
  const rawWallets = Array.isArray(raw.wallets) ? raw.wallets : [];
  const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];

  // Only populate default starter wallets/categories if onboarding has NOT completed yet.
  // If user intentionally deleted all wallets/categories post-onboarding, never silently resurrect defaults!
  const wallets = !hasCompletedOnboarding && rawWallets.length === 0 ? DEFAULT_WALLETS : rawWallets;
  const categories =
    !hasCompletedOnboarding && rawCategories.length === 0 ? DEFAULT_CATEGORIES : rawCategories;

  return {
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    wallets,
    categories,
    budgets: Array.isArray(raw.budgets) ? raw.budgets : [],
    debts: Array.isArray(raw.debts) ? raw.debts : [],
    goals: Array.isArray(raw.goals) ? raw.goals : [],
    templates: Array.isArray(raw.templates) ? raw.templates : [],
    moneyCircles: Array.isArray(raw.moneyCircles) ? raw.moneyCircles : [],
    settings: mergeSettingsWithDefaults(raw.settings),
    user: raw.user || null,
    hasCompletedOnboarding,
  };
}

/**
 * Primary loader: reads IndexedDB FIRST, then migrates legacy localStorage if IndexedDB is empty.
 */
export async function loadInitialData(): Promise<AppDatabaseData> {
  if (memoryCache) return memoryCache;

  const db = await openDB();
  if (db) {
    try {
      const stored = await new Promise<AppDatabaseData | null>((resolve) => {
        const tx = db.transaction('app_data', 'readonly');
        const store = tx.objectStore('app_data');
        const req = store.get('root_state');
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => resolve(null);
      });

      if (stored) {
        const sanitized = normalizeLoadedState(stored);
        memoryCache = sanitized;
        return sanitized;
      }
    } catch (err) {
      console.warn('IndexedDB read error, checking localStorage fallback', err);
    }
  }

  // Fallback / migration from legacy localStorage if IndexedDB had no record
  try {
    const rawLocal = localStorage.getItem(LEGACY_LS_KEY);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal) as Partial<AppDatabaseData>;
      const sanitized = normalizeLoadedState(parsed);
      memoryCache = sanitized;
      // Migrate into IndexedDB asynchronously
      void persistData(sanitized);
      return sanitized;
    }
  } catch (err) {
    console.warn('LocalStorage fallback load error', err);
  }

  const initial: AppDatabaseData = {
    transactions: [],
    wallets: DEFAULT_WALLETS,
    categories: DEFAULT_CATEGORIES,
    budgets: [],
    debts: [],
    goals: [],
    templates: [],
    moneyCircles: [],
    settings: DEFAULT_SETTINGS,
    user: null,
    hasCompletedOnboarding: false,
  };

  memoryCache = initial;
  return initial;
}

/**
 * Persist primary data into IndexedDB (awaiting transaction completion) and store only lightweight cache in localStorage.
 */
export async function persistData(data: AppDatabaseData): Promise<void> {
  const sanitizedData: AppDatabaseData = {
    ...data,
    settings: mergeSettingsWithDefaults(data.settings),
  };
  memoryCache = sanitizedData;

  const db = await openDB();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction('app_data', 'readwrite');
        const store = tx.objectStore('app_data');
        store.put({ key: 'root_state', data: sanitizedData, updatedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          console.warn('IndexedDB transaction failed');
          resolve();
        };
        tx.onabort = () => resolve();
      } catch (err) {
        console.warn('IndexedDB save error', err);
        resolve();
      }
    });
  }

  // Lightweight localStorage cache (settings + attachment-stripped fallback so 5MB limit never breaks)
  try {
    localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(sanitizedData.settings));
    const lightweightData: AppDatabaseData = {
      ...sanitizedData,
      transactions: sanitizedData.transactions.map((t) =>
        t.attachments?.length ? { ...t, attachments: undefined } : t
      ),
    };
    localStorage.setItem(LEGACY_LS_KEY, JSON.stringify(lightweightData));
  } catch (err) {
    console.warn('LocalStorage cache save skipped (quota)', err);
  }
}

export async function savePreRestoreSnapshot(data: AppDatabaseData): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('app_data', 'readwrite');
      tx.objectStore('app_data').put({
        key: 'pre_restore_snapshot',
        data: { ...data, settings: { ...data.settings, isPro: false } },
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadPreRestoreSnapshot(): Promise<{ data: AppDatabaseData; updatedAt: number } | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('app_data', 'readonly');
      const req = tx.objectStore('app_data').get('pre_restore_snapshot');
      req.onsuccess = () => {
        if (req.result?.data) {
          resolve({
            data: normalizeLoadedState(req.result.data),
            updatedAt: Number(req.result.updatedAt || Date.now()),
          });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const UNSAFE_BACKUP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function hasUnsafePrototypeKey(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== 'object' || depth > 25) return false;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (hasUnsafePrototypeKey(node[i], depth + 1)) return true;
    }
    return false;
  }
  const ownKeys = Object.getOwnPropertyNames(node);
  for (const key of ownKeys) {
    if (UNSAFE_BACKUP_KEYS.has(key)) return true;
    const val = (node as Record<string, unknown>)[key];
    if (val && typeof val === 'object' && hasUnsafePrototypeKey(val, depth + 1)) {
      return true;
    }
  }
  return false;
}

export function validateBackupSchema(raw: unknown): {
  valid: boolean;
  reason?: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: 'ROOT_NOT_OBJECT' };
  }
  if (hasUnsafePrototypeKey(raw)) {
    return { valid: false, reason: 'UNSAFE_PROTOTYPE_KEY' };
  }
  const obj = raw as Record<string, unknown>;
  const hasArrayField =
    Array.isArray(obj.transactions) ||
    Array.isArray(obj.wallets) ||
    Array.isArray(obj.categories);
  if (!hasArrayField) {
    return { valid: false, reason: 'MISSING_CORE_ARRAYS' };
  }
  if (obj.transactions !== undefined && !Array.isArray(obj.transactions)) {
    return { valid: false, reason: 'INVALID_TRANSACTIONS_FIELD' };
  }
  if (obj.wallets !== undefined && !Array.isArray(obj.wallets)) {
    return { valid: false, reason: 'INVALID_WALLETS_FIELD' };
  }
  if (obj.categories !== undefined && !Array.isArray(obj.categories)) {
    return { valid: false, reason: 'INVALID_CATEGORIES_FIELD' };
  }
  if (Array.isArray(obj.transactions)) {
    for (const tx of obj.transactions) {
      if (
        !tx ||
        typeof tx !== 'object' ||
        Array.isArray(tx) ||
        typeof (tx as Transaction).id !== 'string' ||
        typeof (tx as Transaction).amount !== 'number' ||
        !Number.isFinite((tx as Transaction).amount)
      ) {
        return { valid: false, reason: 'INVALID_TRANSACTION_ITEM' };
      }
    }
  }
  if (Array.isArray(obj.wallets)) {
    for (const w of obj.wallets) {
      if (
        !w ||
        typeof w !== 'object' ||
        Array.isArray(w) ||
        typeof (w as Wallet).id !== 'string' ||
        typeof (w as Wallet).name !== 'string' ||
        ((w as Wallet).balance !== undefined &&
          (typeof (w as Wallet).balance !== 'number' || !Number.isFinite((w as Wallet).balance)))
      ) {
        return { valid: false, reason: 'INVALID_WALLET_ITEM' };
      }
    }
  }
  if (obj.moneyCircles !== undefined && !Array.isArray(obj.moneyCircles)) {
    return { valid: false, reason: 'INVALID_MONEY_CIRCLES_FIELD' };
  }
  if (
    obj.orgWorkspaces !== undefined &&
    (!obj.orgWorkspaces || typeof obj.orgWorkspaces !== 'object' || Array.isArray(obj.orgWorkspaces))
  ) {
    return { valid: false, reason: 'INVALID_ORG_WORKSPACES_FIELD' };
  }
  if (obj.orgWorkspaces && typeof obj.orgWorkspaces === 'object') {
    for (const [orgKey, ws] of Object.entries(obj.orgWorkspaces as Record<string, unknown>)) {
      if (
        !ws ||
        typeof ws !== 'object' ||
        !(ws as OrgWorkspaceData).organization ||
        typeof (ws as OrgWorkspaceData).organization.id !== 'string' ||
        (ws as OrgWorkspaceData).organization.id !== orgKey
      ) {
        return { valid: false, reason: 'INVALID_ORG_WORKSPACE_ITEM' };
      }
    }
  }
  if (obj.activeWorkspace !== undefined && typeof obj.activeWorkspace !== 'string') {
    return { valid: false, reason: 'INVALID_ACTIVE_WORKSPACE_FIELD' };
  }
  return { valid: true };
}

export async function saveVerifiedProCache(cache: VerifiedProEntitlement | null): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('app_data', 'readwrite');
      const store = tx.objectStore('app_data');
      if (!cache) {
        store.delete('pro_entitlement');
      } else {
        store.put({ key: 'pro_entitlement', data: cache, updatedAt: Date.now() });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadVerifiedProCache(): Promise<VerifiedProEntitlement | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('app_data', 'readonly');
      const store = tx.objectStore('app_data');
      const req = store.get('pro_entitlement');
      req.onsuccess = () => resolve((req.result?.data as VerifiedProEntitlement) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export interface PendingAttachmentUpload {
  id: string;
  orgId: string;
  txId: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  createdAt: number;
}

export async function loadPendingAttachmentUploads(): Promise<PendingAttachmentUpload[]> {
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('app_data', 'readonly');
      const req = tx.objectStore('app_data').get('pending_attachment_uploads_v1');
      req.onsuccess = () => {
        const list = req.result?.data;
        resolve(Array.isArray(list) ? list : []);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function savePendingAttachmentUploads(items: PendingAttachmentUpload[]): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('app_data', 'readwrite');
      tx.objectStore('app_data').put({
        key: 'pending_attachment_uploads_v1',
        data: items,
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function enqueuePendingAttachmentUpload(item: PendingAttachmentUpload): Promise<void> {
  const existing = await loadPendingAttachmentUploads();
  const filtered = existing.filter((x) => x.id !== item.id);
  filtered.push(item);
  await savePendingAttachmentUploads(filtered);
}

export async function removePendingAttachmentUpload(id: string): Promise<void> {
  const existing = await loadPendingAttachmentUploads();
  await savePendingAttachmentUploads(existing.filter((x) => x.id !== id));
}

export function loadActiveWorkspacePref(): string {
  try {
    return localStorage.getItem('raseedi_active_workspace_v1') || 'personal';
  } catch {
    return 'personal';
  }
}

export function saveActiveWorkspacePref(workspaceId: string): void {
  try {
    localStorage.setItem('raseedi_active_workspace_v1', workspaceId || 'personal');
  } catch {
    // ignore
  }
}

export async function loadOrgWorkspaces(): Promise<{
  activeWorkspace: string;
  workspaces: Record<string, OrgWorkspaceData>;
}> {
  const db = await openDB();
  if (!db) return { activeWorkspace: 'personal', workspaces: {} };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('app_data', 'readonly');
      const store = tx.objectStore('app_data');
      const req = store.get('org_workspaces_v1');
      req.onsuccess = () => {
        const res = req.result?.data as
          | { activeWorkspace?: string; workspaces?: Record<string, OrgWorkspaceData> }
          | undefined;
        resolve({
          activeWorkspace: res?.activeWorkspace || 'personal',
          workspaces: res?.workspaces || {},
        });
      };
      req.onerror = () => resolve({ activeWorkspace: 'personal', workspaces: {} });
    } catch {
      resolve({ activeWorkspace: 'personal', workspaces: {} });
    }
  });
}

export async function saveOrgWorkspaces(
  activeWorkspace: string,
  workspaces: Record<string, OrgWorkspaceData>
): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('app_data', 'readwrite');
      tx.objectStore('app_data').put({
        key: 'org_workspaces_v1',
        data: { activeWorkspace, workspaces },
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

const GUEST_MODE_LS_KEY = 'raseedi_guest_mode_v1';
const DIRTY_SYNC_LS_KEY = 'raseedi_unsynced_dirty_v1';

export function loadGuestModePref(): boolean {
  try {
    return localStorage.getItem(GUEST_MODE_LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveGuestModePref(isGuest: boolean): void {
  try {
    if (isGuest) {
      localStorage.setItem(GUEST_MODE_LS_KEY, '1');
    } else {
      localStorage.removeItem(GUEST_MODE_LS_KEY);
    }
  } catch {
    // Ignore storage failures
  }
}

export function loadUnsyncedDirtyFlag(): boolean {
  try {
    return localStorage.getItem(DIRTY_SYNC_LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveUnsyncedDirtyFlag(dirty: boolean): void {
  try {
    if (dirty) {
      localStorage.setItem(DIRTY_SYNC_LS_KEY, '1');
    } else {
      localStorage.removeItem(DIRTY_SYNC_LS_KEY);
    }
  } catch {
    // Ignore storage failures
  }
}

export async function clearLocalAppStorageAndDb(): Promise<void> {
  memoryCache = null;
  try {
    localStorage.removeItem(LEGACY_LS_KEY);
    localStorage.removeItem(SETTINGS_LS_KEY);
    localStorage.removeItem(GUEST_MODE_LS_KEY);
    localStorage.removeItem(DIRTY_SYNC_LS_KEY);
    localStorage.removeItem('raseedi_live_rates_v1');
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('raseedi_pin_lockout_v1:') || k.startsWith('raseedi_'))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore
  }

  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const sessionKeys: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith('raseedi_')) {
          sessionKeys.push(k);
        }
      }
      sessionKeys.forEach((k) => window.sessionStorage.removeItem(k));
    }
  } catch {
    // Ignore
  }

  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('app_data', 'readwrite');
      tx.objectStore('app_data').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function createStarterOrgCategories(
  industry: OrganizationIndustry = 'general'
): Category[] {
  const baseCommon: Category[] = [
    { id: 'org-cat-payroll', nameAr: 'رواتب ومستحقات موظفين', nameEn: 'Payroll & Salaries', icon: 'Briefcase', color: '#3E4E63', type: 'expense', order: 5 },
    { id: 'org-cat-ops', nameAr: 'مصروفات تشغيلية وإدارية', nameEn: 'Operating & Admin Expenses', icon: 'Receipt', color: '#545E75', type: 'expense', order: 6 },
    { id: 'org-cat-rent', nameAr: 'إيجار المقر والمرافق', nameEn: 'Office Rent & Utilities', icon: 'Home', color: '#6A5243', type: 'expense', order: 7 },
    { id: 'org-cat-marketing', nameAr: 'تسويق وإعلانات', nameEn: 'Marketing & Ads', icon: 'Tv', color: '#7E4C76', type: 'expense', order: 8 },
    { id: 'org-cat-travel', nameAr: 'بدلات سفر وعهد موظفين', nameEn: 'Travel & Reimbursements', icon: 'Car', color: '#9E6F38', type: 'expense', order: 9 },
    { id: 'org-cat-other', nameAr: 'بنود أخرى', nameEn: 'Other', icon: 'Layers', color: '#7A7468', type: 'both', order: 10 },
  ];

  switch (industry) {
    case 'retail':
      return [
        { id: 'org-cat-sales', nameAr: 'مبيعات المتجر ونقاط البيع', nameEn: 'POS & Store Sales', icon: 'ShoppingBag', color: '#5E7F3A', type: 'income', order: 1 },
        { id: 'org-cat-services', nameAr: 'مبيعات المتجر الإلكتروني', nameEn: 'Online Store Revenue', icon: 'Laptop', color: '#1E6F73', type: 'income', order: 2 },
        { id: 'org-cat-suppliers', nameAr: 'مشتريات البضاعة والمخزون', nameEn: 'Inventory & Stock Purchases', icon: 'ShoppingCart', color: '#B5523B', type: 'expense', order: 3 },
        { id: 'org-cat-shipping', nameAr: 'الشحن والتوصيل والتغليف', nameEn: 'Shipping & Packaging', icon: 'Car', color: '#9E6F38', type: 'expense', order: 4 },
        ...baseCommon,
      ];
    case 'restaurant':
      return [
        { id: 'org-cat-sales', nameAr: 'مبيعات الصالة والتيك أواي', nameEn: 'Dine-in & Takeaway Sales', icon: 'Utensils', color: '#5E7F3A', type: 'income', order: 1 },
        { id: 'org-cat-services', nameAr: 'طلبات تطبيقات التوصيل', nameEn: 'Delivery App Revenue', icon: 'Coffee', color: '#1E6F73', type: 'income', order: 2 },
        { id: 'org-cat-suppliers', nameAr: 'مشتريات خامات ومواد غذائية', nameEn: 'Food & Ingredients Supply', icon: 'ShoppingCart', color: '#B5523B', type: 'expense', order: 3 },
        { id: 'org-cat-kitchen', nameAr: 'صيانة مطبخ وغاز وكهرباء', nameEn: 'Kitchen Utilities & Maintenance', icon: 'Fuel', color: '#9E6F38', type: 'expense', order: 4 },
        ...baseCommon,
      ];
    case 'tech':
      return [
        { id: 'org-cat-sales', nameAr: 'اشتراكات برمجية وعقود تطوير', nameEn: 'SaaS & Development Contracts', icon: 'Laptop', color: '#5E7F3A', type: 'income', order: 1 },
        { id: 'org-cat-services', nameAr: 'استشارات ودعم فني', nameEn: 'Technical Consulting', icon: 'Briefcase', color: '#1E6F73', type: 'income', order: 2 },
        { id: 'org-cat-suppliers', nameAr: 'خوادم سحابية وتراخيص برمجية', nameEn: 'Cloud Servers & Software Licenses', icon: 'Receipt', color: '#B5523B', type: 'expense', order: 3 },
        { id: 'org-cat-equipment', nameAr: 'أجهزة ومعدات تقنية', nameEn: 'Hardware & IT Equipment', icon: 'Laptop', color: '#3E4E63', type: 'expense', order: 4 },
        ...baseCommon,
      ];
    case 'construction':
      return [
        { id: 'org-cat-sales', nameAr: 'مستخلصات مشاريع ومقاولات', nameEn: 'Project Progress Billings', icon: 'Home', color: '#5E7F3A', type: 'income', order: 1 },
        { id: 'org-cat-services', nameAr: 'استشارات وإشراف هندسي', nameEn: 'Engineering Supervision', icon: 'Briefcase', color: '#1E6F73', type: 'income', order: 2 },
        { id: 'org-cat-suppliers', nameAr: 'مواد بناء وتشطيبات', nameEn: 'Building Materials & Supplies', icon: 'ShoppingCart', color: '#B5523B', type: 'expense', order: 3 },
        { id: 'org-cat-subcontractors', nameAr: 'مقاولي الباطن والمعدات', nameEn: 'Subcontractors & Equipment', icon: 'Car', color: '#9E6F38', type: 'expense', order: 4 },
        ...baseCommon,
      ];
    case 'medical':
      return [
        { id: 'org-cat-sales', nameAr: 'كشوفات وخدمات طبية', nameEn: 'Medical Consultations & Visits', icon: 'HeartPulse', color: '#5E7F3A', type: 'income', order: 1 },
        { id: 'org-cat-services', nameAr: 'تعاقدات التأمين والتحاليل', nameEn: 'Insurance & Lab Contracts', icon: 'Pill', color: '#1E6F73', type: 'income', order: 2 },
        { id: 'org-cat-suppliers', nameAr: 'مستلزمات طبية وأدوية', nameEn: 'Medical Supplies & Pharma', icon: 'Pill', color: '#B5523B', type: 'expense', order: 3 },
        { id: 'org-cat-lab', nameAr: 'صيانة أجهزة وتعقيم', nameEn: 'Equipment Calibration & Sterilization', icon: 'HeartPulse', color: '#A03838', type: 'expense', order: 4 },
        ...baseCommon,
      ];
    default:
      return [
        { id: 'org-cat-sales', nameAr: 'مبيعات وإيرادات تشغيلية', nameEn: 'Operating Revenue', icon: 'Briefcase', color: '#5E7F3A', type: 'income', order: 1 },
        { id: 'org-cat-services', nameAr: 'استشارات وخدمات عملاء', nameEn: 'Client Services', icon: 'Laptop', color: '#1E6F73', type: 'income', order: 2 },
        { id: 'org-cat-suppliers', nameAr: 'مشتريات وموردين', nameEn: 'Suppliers & Inventory', icon: 'ShoppingCart', color: '#B5523B', type: 'expense', order: 3 },
        ...baseCommon,
      ];
  }
}

export function createStarterCostCentersForIndustry(
  orgId: string,
  industry: OrganizationIndustry = 'general',
  loadSampleData = false,
  now = Date.now()
): CostCenter[] {
  const presets: Record<
    OrganizationIndustry,
    Array<{ id: string; code: string; nameAr: string; nameEn: string; type: 'department' | 'project' | 'branch'; sample: number; base: number }>
  > = {
    retail: [
      { id: 'br-main', code: 'BR-01', nameAr: 'الفرع الرئيسي', nameEn: 'Main Store Branch', type: 'branch', sample: 90000, base: 50000 },
      { id: 'dept-ecom', code: 'ECO-02', nameAr: 'المتجر الإلكتروني والشحن', nameEn: 'E-Commerce & Shipping', type: 'department', sample: 45000, base: 25000 },
    ],
    restaurant: [
      { id: 'br-branch1', code: 'KIT-01', nameAr: 'المطبخ والتشغيل', nameEn: 'Kitchen & Operations', type: 'department', sample: 85000, base: 45000 },
      { id: 'br-hall', code: 'BR-02', nameAr: 'فرع الصالة والتوصيل', nameEn: 'Dining Hall & Delivery Branch', type: 'branch', sample: 40000, base: 25000 },
    ],
    tech: [
      { id: 'prj-core', code: 'PRJ-01', nameAr: 'تطوير المنتج الأساسي', nameEn: 'Core Product Engineering', type: 'project', sample: 120000, base: 60000 },
      { id: 'dept-growth', code: 'MKT-02', nameAr: 'النمو والمبيعات السحابية', nameEn: 'Growth & Cloud Sales', type: 'department', sample: 45000, base: 25000 },
    ],
    construction: [
      { id: 'prj-site1', code: 'SITE-01', nameAr: 'مشروع المرحلة الأولى', nameEn: 'Phase 1 Construction Site', type: 'project', sample: 250000, base: 100000 },
      { id: 'dept-hq', code: 'OPS-02', nameAr: 'الإدارة الهندسية والمشتريات', nameEn: 'Engineering & Procurement', type: 'department', sample: 60000, base: 30000 },
    ],
    medical: [
      { id: 'dept-clinic', code: 'CLN-01', nameAr: 'العيادات والاستقبال', nameEn: 'Clinics & Reception', type: 'department', sample: 95000, base: 50000 },
      { id: 'br-lab', code: 'LAB-02', nameAr: 'وحدة المعمل والمستلزمات', nameEn: 'Lab & Medical Supplies', type: 'branch', sample: 55000, base: 30000 },
    ],
    general: [
      { id: 'ops', code: 'OPS-01', nameAr: 'التشغيل والإدارة', nameEn: 'Operations & Admin', type: 'department', sample: 80000, base: 50000 },
      { id: 'mkt', code: 'MKT-02', nameAr: 'التسويق والمبيعات', nameEn: 'Marketing & Sales', type: 'department', sample: 45000, base: 25000 },
    ],
  };

  return (presets[industry] || presets.general).map((item) => ({
    id: `cc-${item.id}-${now}`,
    orgId,
    code: item.code,
    name: item.nameAr,
    nameAr: item.nameAr,
    nameEn: item.nameEn,
    type: item.type,
    budgetAllocated: loadSampleData ? item.sample : item.base,
    isActive: true,
    createdAt: now,
  }));
}

export function generateDemoSeedData(mainCurrency = 'EGP'): Partial<AppDatabaseData> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

  const daysAgo = (d: number) => {
    const dt = new Date(now);
    dt.setDate(now.getDate() - d);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  };

  const currentMonthStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

  const transactions: Transaction[] = [
    {
      id: 'tx-1',
      type: 'income',
      amount: 25000,
      currency: mainCurrency,
      date: daysAgo(5),
      time: '09:00',
      categoryId: 'cat-salary',
      walletId: 'w-bank',
      notes: 'راتب الشهر مع البدلات',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: Date.now() - 500000,
      updatedAt: Date.now() - 500000,
    },
    {
      id: 'tx-2',
      type: 'expense',
      amount: 1450,
      currency: mainCurrency,
      date: todayStr,
      time: '14:30',
      categoryId: 'cat-groceries',
      walletId: 'w-bank',
      notes: 'مشتريات السوبرماركت الأسبوعية',
      priority: 'essential',
      group: 'البيت',
      doesNotAffectBalance: false,
      createdAt: Date.now() - 40000,
      updatedAt: Date.now() - 40000,
    },
    {
      id: 'tx-3',
      type: 'expense',
      amount: 120,
      currency: mainCurrency,
      date: todayStr,
      time: '11:15',
      categoryId: 'cat-cafes',
      walletId: 'w-cash',
      notes: 'قهوة وفطور مع الأصدقاء',
      priority: 'leisure',
      contact: 'أحمد محمود',
      doesNotAffectBalance: false,
      createdAt: Date.now() - 50000,
      updatedAt: Date.now() - 50000,
    },
    {
      id: 'tx-4',
      type: 'expense',
      amount: 450,
      currency: mainCurrency,
      date: yesterdayStr,
      time: '19:40',
      categoryId: 'cat-restaurants',
      walletId: 'w-bank',
      notes: 'عشاء مطعم مشاوي',
      priority: 'normal',
      group: 'عطلة الأسبوع',
      doesNotAffectBalance: false,
      createdAt: Date.now() - 90000,
      updatedAt: Date.now() - 90000,
    },
    {
      id: 'tx-5',
      type: 'expense',
      amount: 380,
      currency: mainCurrency,
      date: yesterdayStr,
      time: '08:20',
      categoryId: 'cat-fuel',
      walletId: 'w-bank',
      notes: 'تفويلة بنزين السيارة',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: Date.now() - 100000,
      updatedAt: Date.now() - 100000,
    },
    {
      id: 'tx-6',
      type: 'transfer',
      amount: 1500,
      currency: mainCurrency,
      convertedAmount: 1500,
      date: daysAgo(2),
      time: '16:00',
      categoryId: 'cat-withdraw',
      walletId: 'w-bank',
      toWalletId: 'w-cash',
      notes: 'سحب كاش من الصراف الآلي',
      priority: 'normal',
      doesNotAffectBalance: false,
      createdAt: Date.now() - 150000,
      updatedAt: Date.now() - 150000,
    },
    {
      id: 'tx-7',
      type: 'expense',
      amount: 720,
      currency: mainCurrency,
      date: daysAgo(3),
      time: '15:10',
      categoryId: 'cat-bills',
      walletId: 'w-bank',
      notes: 'فاتورة الكهرباء والإنترنت المنزلي',
      priority: 'essential',
      doesNotAffectBalance: false,
      createdAt: Date.now() - 250000,
      updatedAt: Date.now() - 250000,
    },
    {
      id: 'tx-8',
      type: 'income',
      amount: 4200,
      currency: mainCurrency,
      date: daysAgo(4),
      time: '18:00',
      categoryId: 'cat-freelance',
      walletId: 'w-bank',
      notes: 'أتعاب تصميم هوية رقمية لمشروع عميل',
      priority: 'normal',
      contact: 'مؤسسة النور',
      doesNotAffectBalance: false,
      createdAt: Date.now() - 350000,
      updatedAt: Date.now() - 350000,
    },
  ];

  const templates: Template[] = [
    {
      id: 'tmpl-1',
      name: 'قهوة الصباح اليومية',
      type: 'expense',
      amount: 60,
      currency: mainCurrency,
      categoryId: 'cat-cafes',
      walletId: 'w-cash',
      notes: 'قهوة اسبريسو الصباح',
      priority: 'leisure',
      doesNotAffectBalance: false,
    },
    {
      id: 'tmpl-2',
      name: 'مترو / مواصلات العمل',
      type: 'expense',
      amount: 35,
      currency: mainCurrency,
      categoryId: 'cat-transport',
      walletId: 'w-cash',
      notes: 'تذكرة مواصلات يومية',
      priority: 'essential',
      doesNotAffectBalance: false,
    },
    {
      id: 'tmpl-3',
      name: 'سحب كاش 1000',
      type: 'transfer',
      amount: 1000,
      currency: mainCurrency,
      categoryId: 'cat-withdraw',
      walletId: 'w-bank',
      toWalletId: 'w-cash',
      notes: 'سحب نقدي من الصراف',
      priority: 'normal',
      doesNotAffectBalance: false,
    },
  ];

  const budgets: Budget[] = [
    {
      id: 'b-overall',
      name: 'الميزانية العامة للمصروفات',
      amount: 12000,
      month: currentMonthStr,
      rollover: true,
      rolloverAmount: 500,
    },
    {
      id: 'b-groceries',
      name: 'ميزانية السوبرماركت والتموين',
      amount: 4000,
      month: currentMonthStr,
      categoryId: 'cat-groceries',
      rollover: false,
    },
    {
      id: 'b-dining',
      name: 'ميزانية المطاعم والكافيهات',
      amount: 2000,
      month: currentMonthStr,
      categoryId: 'cat-restaurants',
      rollover: false,
    },
  ];

  const debts: Debt[] = [
    {
      id: 'debt-1',
      type: 'owed_to_me',
      personName: 'محمد سالم',
      totalAmount: 3000,
      paidAmount: 1000,
      currency: mainCurrency,
      dueDate: daysAgo(-10),
      monthlyInstallment: 500,
      notes: 'سلفة مؤقتة لأجل إصلاح سيارته',
      payments: [{ id: 'p-1', amount: 1000, date: daysAgo(10), notes: 'سدد الدفعة الأولى' }],
      isSettled: false,
      createdAt: Date.now() - 1000000,
    },
    {
      id: 'debt-2',
      type: 'i_owe',
      personName: 'شركة الإلكترونيات',
      totalAmount: 5400,
      paidAmount: 3600,
      currency: mainCurrency,
      dueDate: daysAgo(-5),
      monthlyInstallment: 900,
      notes: 'قسط جهاز حاسوب محمول (متبقي قسطين)',
      payments: [
        { id: 'p-2', amount: 1800, date: daysAgo(60) },
        { id: 'p-3', amount: 1800, date: daysAgo(30) },
      ],
      isSettled: false,
      createdAt: Date.now() - 2000000,
    },
  ];

  const goals: SavingsGoal[] = [
    {
      id: 'goal-1',
      name: 'صندوق الطوارئ (3 شهور)',
      targetAmount: 50000,
      currentAmount: 32000,
      currency: mainCurrency,
      deadline: '2027-06-30',
      icon: 'ShieldCheck',
      color: '#1E6F73',
      walletId: 'w-savings',
      isCompleted: false,
      createdAt: Date.now() - 3000000,
    },
    {
      id: 'goal-2',
      name: 'تحديث هاتف العمل',
      targetAmount: 18000,
      currentAmount: 12500,
      currency: mainCurrency,
      deadline: '2027-03-31',
      icon: 'Smartphone',
      color: '#5E7F3A',
      walletId: 'w-bank',
      isCompleted: false,
      createdAt: Date.now() - 1500000,
    },
  ];

  const wallets: Wallet[] = [
    {
      id: 'w-cash',
      name: 'المحفظة النقدية (كاش)',
      currency: mainCurrency,
      initialBalance: 2500,
      balance: 2500,
      color: '#3A605B',
      icon: 'Wallet',
      isArchived: false,
      order: 1,
    },
    {
      id: 'w-bank',
      name: 'الحساب البنكي (جاري)',
      currency: mainCurrency,
      initialBalance: 28500,
      balance: 28500,
      color: '#3E4E63',
      icon: 'CreditCard',
      isArchived: false,
      order: 2,
    },
    {
      id: 'w-savings',
      name: 'خزينة التوفير',
      currency: 'USD',
      initialBalance: 1200,
      balance: 1200,
      color: '#6A5243',
      icon: 'Vault',
      isArchived: false,
      order: 3,
    },
  ];

  return {
    wallets,
    transactions,
    templates,
    budgets,
    debts,
    goals,
    hasCompletedOnboarding: true,
  };
}
