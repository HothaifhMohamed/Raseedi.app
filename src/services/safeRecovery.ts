import { AppDatabaseData } from './db';
import { OrgWorkspaceData, Transaction } from '../types';
import {
  isFirestoreMissingIndexError,
  mergeTransactionsById,
  sortTransactionsDescending,
} from './orgTransactionQuery';

export interface CloudStartupCheckInput {
  localTransactionsCount: number;
  hasCloudBackup: boolean;
  cloudUpdatedAtMs: number;
  localLastKnownCloudUpdatedAtMs?: number;
}

/**
 * Cloud-First startup decision:
 * Restores/merges from Cloud Firestore whenever a cloud backup exists AND either:
 * - local transactions are empty (e.g. fresh cache / cleared localStorage), OR
 * - cloud snapshot is strictly newer than the last known synced timestamp on this device.
 */
export function shouldRestoreCloudOnStartup(input: CloudStartupCheckInput): boolean {
  if (!input.hasCloudBackup) return false;
  if (input.localTransactionsCount === 0) return true;
  const localSyncedAt = Number(input.localLastKnownCloudUpdatedAtMs || 0);
  return input.cloudUpdatedAtMs > localSyncedAt;
}

function mergeArrayById<T extends { id: string; updatedAt?: number }>(
  primary: T[],
  secondary: T[]
): T[] {
  const byId = new Map<string, T>();
  for (const item of secondary) {
    if (item && item.id) byId.set(item.id, item);
  }
  for (const item of primary) {
    if (!item || !item.id) continue;
    const prev = byId.get(item.id);
    if (!prev || Number(item.updatedAt || 0) >= Number(prev.updatedAt || 0)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

export interface MergeCloudAndLocalInput {
  localData: Omit<AppDatabaseData, 'user'> & {
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
  };
  cloudData: Partial<Omit<AppDatabaseData, 'user'>> & {
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
  };
  preferCloud?: boolean;
}

export function mergeCloudAndLocalState(params: MergeCloudAndLocalInput): Omit<AppDatabaseData, 'user'> & {
  orgWorkspaces?: Record<string, OrgWorkspaceData>;
  activeWorkspace?: string;
} {
  const { localData, cloudData, preferCloud = true } = params;
  const cloudTxs = Array.isArray(cloudData.transactions) ? cloudData.transactions : [];
  const localTxs = Array.isArray(localData.transactions) ? localData.transactions : [];

  const mergedTransactions: Transaction[] = preferCloud
    ? mergeTransactionsById(cloudTxs, localTxs)
    : mergeTransactionsById(localTxs, cloudTxs);

  const cloudWallets = Array.isArray(cloudData.wallets) ? cloudData.wallets : [];
  const localWallets = Array.isArray(localData.wallets) ? localData.wallets : [];
  const mergedWallets = preferCloud
    ? mergeArrayById(cloudWallets, localWallets)
    : mergeArrayById(localWallets, cloudWallets);

  const cloudCategories = Array.isArray(cloudData.categories) ? cloudData.categories : [];
  const localCategories = Array.isArray(localData.categories) ? localData.categories : [];
  const mergedCategories = preferCloud
    ? mergeArrayById(cloudCategories, localCategories)
    : mergeArrayById(localCategories, cloudCategories);

  return {
    transactions: sortTransactionsDescending(mergedTransactions),
    wallets: mergedWallets,
    categories: mergedCategories,
    budgets: mergeArrayById(cloudData.budgets || [], localData.budgets || []),
    debts: mergeArrayById(cloudData.debts || [], localData.debts || []),
    goals: mergeArrayById(cloudData.goals || [], localData.goals || []),
    templates: mergeArrayById(cloudData.templates || [], localData.templates || []),
    moneyCircles: mergeArrayById(cloudData.moneyCircles || [], localData.moneyCircles || []),
    orgWorkspaces: {
      ...(localData.orgWorkspaces || {}),
      ...(cloudData.orgWorkspaces || {}),
    },
    activeWorkspace: cloudData.activeWorkspace || localData.activeWorkspace,
    settings: preferCloud
      ? { ...localData.settings, ...(cloudData.settings || {}) }
      : { ...(cloudData.settings || {}), ...localData.settings },
    hasCompletedOnboarding: Boolean(
      cloudData.hasCompletedOnboarding ?? localData.hasCompletedOnboarding ?? true
    ),
  };
}

export function formatFirestoreErrorForDisplay(err: unknown, isRTL: boolean): string {
  if (!err) {
    return isRTL ? 'حدث خطأ غير معروف أثناء الاتصال بقاعدة البيانات.' : 'Unknown database error.';
  }
  const obj =
    typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null;
  const code = obj?.code ? String(obj.code) : '';
  const rawMessage = err instanceof Error ? err.message : String(obj?.message || err);

  if (isFirestoreMissingIndexError(err)) {
    return isRTL
      ? `خطأ فهرس Firestore (${code || 'failed-precondition'}): ${rawMessage}`
      : `Firestore Index Error (${code || 'failed-precondition'}): ${rawMessage}`;
  }
  if (code === 'permission-denied') {
    return isRTL
      ? `صلاحيات الوصول مرفوضة (${code}): ${rawMessage}`
      : `Firestore permission denied (${code}): ${rawMessage}`;
  }
  if (code === 'unavailable' || rawMessage.toLowerCase().includes('offline')) {
    return isRTL
      ? `السحابة غير متاحة حالياً أو الجهاز غير متصل (${code || 'unavailable'}): ${rawMessage}`
      : `Cloud Firestore unavailable/offline (${code || 'unavailable'}): ${rawMessage}`;
  }
  return code ? `[${code}] ${rawMessage}` : rawMessage;
}
