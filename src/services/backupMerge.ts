import { OrgWorkspaceData, Transaction } from '../types';
import { AppDatabaseData } from './db';
import { mergeTransactionsById } from './orgTransactionQuery';
import {
  filterDeletedOrgWorkspaces,
  loadDeletedOrgIds,
  resolveSafeActiveWorkspace,
} from './workspaceCleanup';

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
 * with an empty array, and merges existing cloud records safely when needed while
 * strictly stripping any deleted organizations so they can never be resurrected.
 */
export function resolveSafeCloudBackupWrite(params: {
  localData: CloudBackupWriteCandidate;
  existingCloud: ExistingCloudSnapshotSummary | null;
  source?: 'auto' | 'manual';
  allowEmptyOverwrite?: boolean;
  deletedOrgIds?: Iterable<string>;
}): SafeCloudBackupDecision {
  const {
    localData,
    existingCloud,
    source = 'auto',
    allowEmptyOverwrite = false,
    deletedOrgIds,
  } = params;
  const effectiveDeletedIds =
    deletedOrgIds !== undefined ? Array.from(deletedOrgIds) : loadDeletedOrgIds();
  const sanitizedLocalOrgs =
    localData.orgWorkspaces !== undefined
      ? filterDeletedOrgWorkspaces(localData.orgWorkspaces, effectiveDeletedIds)
      : undefined;
  const sanitizedLocalActive = localData.activeWorkspace
    ? resolveSafeActiveWorkspace(localData.activeWorkspace, effectiveDeletedIds)
    : undefined;
  const cleanLocalData: CloudBackupWriteCandidate = {
    ...localData,
    ...(sanitizedLocalOrgs !== undefined ? { orgWorkspaces: sanitizedLocalOrgs } : {}),
    ...(sanitizedLocalActive !== undefined ? { activeWorkspace: sanitizedLocalActive } : {}),
  };

  const localTxCount = (cleanLocalData.transactions || []).length;
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
      const mergedOrgs = filterDeletedOrgWorkspaces(
        {
          ...(cloud.orgWorkspaces || {}),
          ...(cleanLocalData.orgWorkspaces || {}),
        },
        effectiveDeletedIds
      );
      return {
        action: 'write',
        preservedFromCloud: true,
        mergedData: {
          ...cleanLocalData,
          transactions: mergeTransactionsById(cleanLocalData.transactions || [], cloud.transactions),
          wallets:
            (cleanLocalData.wallets || []).length > 0
              ? mergeById(cleanLocalData.wallets || [], cloud.wallets || [])
              : cloud.wallets || [],
          categories:
            (cleanLocalData.categories || []).length > 0
              ? mergeById(cleanLocalData.categories || [], cloud.categories || [])
              : cloud.categories || [],
          budgets: mergeById(cleanLocalData.budgets || [], cloud.budgets || []),
          debts: mergeById(cleanLocalData.debts || [], cloud.debts || []),
          goals: mergeById(cleanLocalData.goals || [], cloud.goals || []),
          templates: mergeById(cleanLocalData.templates || [], cloud.templates || []),
          moneyCircles: mergeById(cleanLocalData.moneyCircles || [], cloud.moneyCircles || []),
          orgWorkspaces: mergedOrgs,
          activeWorkspace: resolveSafeActiveWorkspace(
            cleanLocalData.activeWorkspace || cloud.activeWorkspace,
            effectiveDeletedIds
          ),
        },
      };
    }

    return { action: 'skip_empty_local', reason: 'EMPTY_LOCAL_OVERWRITE_BLOCKED' };
  }

  return {
    action: 'write',
    preservedFromCloud: false,
    mergedData: cleanLocalData,
  };
}

export const MAX_CLOUD_BACKUP_TRANSACTIONS = 40_000;
export const MAX_CLOUD_BACKUP_CHUNKS = 99;

export interface PreparedCloudBackupChunks<T> {
  chunks: T[][];
  storedTxCount: number;
}

/**
 * Validates cloud backup transaction count and chunk count against Firestore limits.
 * Throws `BACKUP_TOO_LARGE` instead of silently truncating transactions or chunks.
 */
export function prepareCloudBackupChunks<T>(
  transactions: readonly T[],
  buildChunks: (items: T[]) => T[][],
  limits?: {
    maxTransactions?: number;
    maxChunks?: number;
  }
): PreparedCloudBackupChunks<T> {
  const maxTransactions = limits?.maxTransactions ?? MAX_CLOUD_BACKUP_TRANSACTIONS;
  const maxChunks = limits?.maxChunks ?? MAX_CLOUD_BACKUP_CHUNKS;

  if (transactions.length > maxTransactions) {
    throw new Error('BACKUP_TOO_LARGE');
  }

  const chunks = buildChunks(Array.from(transactions));
  if (chunks.length > maxChunks) {
    throw new Error('BACKUP_TOO_LARGE');
  }

  const storedTxCount = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (storedTxCount !== transactions.length) {
    throw new Error('BACKUP_TOO_LARGE');
  }

  return { chunks, storedTxCount };
}

