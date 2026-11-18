import { OrgWorkspaceData, Transaction } from '../types';
import { AppDatabaseData } from './db';
import { mergeTransactionsById } from './orgTransactionQuery';

export interface CloudBackupWriteCandidate {
  transactions: Transaction[];
  wallets: AppDatabaseData['wallets'];
  categories: AppDatabaseData['categories'];
  budgets: AppDatabaseData['budgets'];
  debts: AppDatabaseData['debts'];
  goals: AppDatabaseData['goals'];
  templates: AppDatabaseData['templates'];
  moneyCircles?: AppDatabaseData['moneyCircles'];
  orgWorkspaces?: Record<string, OrgWorkspaceData>;
  activeWorkspace?: string;
  settings: AppDatabaseData['settings'];
  hasCompletedOnboarding: boolean;
}

export interface ExistingCloudSnapshotSummary {
  totalTransactions: number;
  data?: Partial<CloudBackupWriteCandidate> | null;
}

export type SafeCloudBackupDecision =
  | { action: 'skip_empty_local'; reason: 'EMPTY_LOCAL_OVERWRITE_BLOCKED' }
  | { action: 'write'; mergedData: CloudBackupWriteCandidate; preservedFromCloud: boolean };

function mergeById<T extends { id: string; updatedAt?: number }>(localList: T[], cloudList: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of cloudList) {
    if (item && item.id) byId.set(item.id, item);
  }
  for (const item of localList) {
    if (!item || !item.id) continue;
    const prev = byId.get(item.id);
    if (!prev || Number(item.updatedAt || 0) >= Number(prev.updatedAt || 0)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

/**
 * Prevents auto-sync or stale/empty localStorage from overwriting non-empty cloud data
 * with an empty array, and merges existing cloud records safely when needed.
 */
export function resolveSafeCloudBackupWrite(params: {
  localData: CloudBackupWriteCandidate;
  existingCloud: ExistingCloudSnapshotSummary | null;
  source?: 'auto' | 'manual';
  allowEmptyOverwrite?: boolean;
}): SafeCloudBackupDecision {
  const { localData, existingCloud, source = 'auto', allowEmptyOverwrite = false } = params;
  const localTxCount = (localData.transactions || []).length;
  const cloudTotalTx = Number(
    existingCloud?.totalTransactions ?? existingCloud?.data?.transactions?.length ?? 0
  );

  // Critical safety guard: never overwrite non-empty cloud backup with an empty local array
  if (!allowEmptyOverwrite && localTxCount === 0 && cloudTotalTx > 0) {
    if (source === 'auto') {
      return { action: 'skip_empty_local', reason: 'EMPTY_LOCAL_OVERWRITE_BLOCKED' };
    }

    const cloud = existingCloud?.data;
    if (cloud && Array.isArray(cloud.transactions) && cloud.transactions.length > 0) {
      return {
        action: 'write',
        preservedFromCloud: true,
        mergedData: {
          ...localData,
          transactions: mergeTransactionsById(localData.transactions || [], cloud.transactions),
          wallets:
            (localData.wallets || []).length > 0
              ? mergeById(localData.wallets || [], cloud.wallets || [])
              : cloud.wallets || [],
          categories:
            (localData.categories || []).length > 0
              ? mergeById(localData.categories || [], cloud.categories || [])
              : cloud.categories || [],
          budgets: mergeById(localData.budgets || [], cloud.budgets || []),
          debts: mergeById(localData.debts || [], cloud.debts || []),
          goals: mergeById(localData.goals || [], cloud.goals || []),
          templates: mergeById(localData.templates || [], cloud.templates || []),
          moneyCircles: mergeById(localData.moneyCircles || [], cloud.moneyCircles || []),
          orgWorkspaces: {
            ...(cloud.orgWorkspaces || {}),
            ...(localData.orgWorkspaces || {}),
          },
          activeWorkspace: localData.activeWorkspace || cloud.activeWorkspace,
        },
      };
    }

    return { action: 'skip_empty_local', reason: 'EMPTY_LOCAL_OVERWRITE_BLOCKED' };
  }

  return {
    action: 'write',
    preservedFromCloud: false,
    mergedData: localData,
  };
}
