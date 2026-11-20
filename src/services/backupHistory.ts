import type { OrgWorkspaceData, Transaction } from '../types';
import type { AppDatabaseData } from './db';
import {
  stripSensitivePinFromSettings,
  stripSensitivePinsFromWallets,
} from './security';

export const MAX_AUTO_CLOUD_BACKUPS = 7;

export interface BackupHistorySummary {
  id: string;
  uid: string;
  source: 'auto' | 'manual';
  createdAtMs: number;
  totalTransactions: number;
  storedTransactionsCount: number;
  walletsCount: number;
}

export interface BackupHistoryRecord extends BackupHistorySummary {
  snapshotJson: string;
}

/**
 * Given existing backup history entries, returns the document IDs that exceed `maxKeep`
 * (keeping only the newest `maxKeep` backups ordered by createdAtMs DESC, id DESC).
 */
export function getBackupIdsToPrune(
  entries: Array<{ id: string; createdAtMs: number }>,
  maxKeep: number = MAX_AUTO_CLOUD_BACKUPS
): string[] {
  const safeMax = Math.max(0, Math.floor(maxKeep));
  if (entries.length <= safeMax) return [];

  const sorted = [...entries].sort((a, b) => {
    const diff = Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
    if (diff !== 0) return diff;
    return b.id.localeCompare(a.id);
  });

  return sorted.slice(safeMax).map((entry) => entry.id);
}

export interface BackupHistoryExtraCounts {
  extraTransactions?: number;
  extraWallets?: number;
}

export interface ComputedBackupHistoryCounts {
  totalTransactions: number;
  walletsCount: number;
  personalTransactionsCount: number;
  orgTransactionsCount: number;
  personalWalletsCount: number;
  orgWalletsCount: number;
}

function isActiveTx(tx: Pick<Transaction, 'deletedAt'> | null | undefined): boolean {
  if (!tx) return false;
  return !(typeof tx.deletedAt === 'number' && tx.deletedAt > 0);
}

/**
 * Accurately computes total active transactions and wallets across the personal
 * workspace, all local/cached organization workspaces, and any optional active
 * cloud organization counts.
 */
export function computeBackupHistoryCounts(
  data: {
    transactions?: Transaction[];
    wallets?: Array<{ id?: string }>;
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
  },
  extra?: BackupHistoryExtraCounts
): ComputedBackupHistoryCounts {
  const personalTransactionsCount = (data.transactions || []).filter(isActiveTx).length;
  const personalWalletsCount = (data.wallets || []).length;

  let orgTransactionsCount = 0;
  let orgWalletsCount = 0;

  if (data.orgWorkspaces && typeof data.orgWorkspaces === 'object') {
    for (const ws of Object.values(data.orgWorkspaces)) {
      if (!ws || typeof ws !== 'object') continue;
      orgTransactionsCount += (ws.transactions || []).filter(isActiveTx).length;
      orgWalletsCount += (ws.wallets || []).length;
    }
  }

  const extraTx = Math.max(0, Math.floor(Number(extra?.extraTransactions || 0)));
  const extraWallets = Math.max(0, Math.floor(Number(extra?.extraWallets || 0)));

  return {
    totalTransactions: personalTransactionsCount + orgTransactionsCount + extraTx,
    walletsCount: personalWalletsCount + orgWalletsCount + extraWallets,
    personalTransactionsCount,
    orgTransactionsCount: orgTransactionsCount + extraTx,
    personalWalletsCount,
    orgWalletsCount: orgWalletsCount + extraWallets,
  };
}

/**
 * Reconciles legacy backup history summaries whose top-level counts only tracked
 * the personal workspace (showing 0 transactions when data lived in orgWorkspaces).
 */
export function reconcileBackupHistorySummary(
  entry: BackupHistorySummary,
  snapshotJson?: string
): BackupHistorySummary {
  const baseTotal = Math.max(0, Number(entry.totalTransactions || 0));
  const baseStored = Math.max(0, Number(entry.storedTransactionsCount || 0));
  const baseWallets = Math.max(0, Number(entry.walletsCount || 0));

  if (!snapshotJson || typeof snapshotJson !== 'string') {
    return {
      ...entry,
      totalTransactions: Math.max(baseTotal, baseStored),
      storedTransactionsCount: baseStored,
      walletsCount: baseWallets,
    };
  }

  // Only inspect snapshotJson if counts look suspiciously low or missing org data
  const shouldInspect =
    baseTotal === 0 || baseStored === 0 || snapshotJson.includes('"orgWorkspaces"');
  if (!shouldInspect) {
    return {
      ...entry,
      totalTransactions: Math.max(baseTotal, baseStored),
      storedTransactionsCount: baseStored,
      walletsCount: baseWallets,
    };
  }

  try {
    const parsed = JSON.parse(snapshotJson) as {
      transactions?: Transaction[];
      wallets?: Array<{ id?: string }>;
      orgWorkspaces?: Record<string, OrgWorkspaceData>;
      activeCloudOrgCounts?: { transactions?: number; wallets?: number };
    };
    const computed = computeBackupHistoryCounts(parsed, {
      extraTransactions: parsed?.activeCloudOrgCounts?.transactions,
      extraWallets: parsed?.activeCloudOrgCounts?.wallets,
    });
    const reconciledStored = Math.max(
      baseStored,
      computed.personalTransactionsCount +
        Math.max(
          0,
          computed.orgTransactionsCount -
            Math.max(0, Number(parsed?.activeCloudOrgCounts?.transactions || 0))
        )
    );
    const reconciledTotal = Math.max(baseTotal, reconciledStored, computed.totalTransactions);
    const reconciledWallets = Math.max(baseWallets, computed.walletsCount);

    return {
      ...entry,
      totalTransactions: reconciledTotal,
      storedTransactionsCount: reconciledStored,
      walletsCount: reconciledWallets,
    };
  } catch {
    return {
      ...entry,
      totalTransactions: Math.max(baseTotal, baseStored),
      storedTransactionsCount: baseStored,
      walletsCount: baseWallets,
    };
  }
}

const utf8Encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function getUtf8Length(str: string): number {
  if (utf8Encoder) {
    return utf8Encoder.encode(str).length;
  }
  return str.length * 2;
}

/**
 * Builds a compact JSON snapshot for cloud backup history that stays safely under
 * Firestore's 1 MiB document size limit (default 750 KB cap).
 * Uses O(N) pre-serialized transaction sizing so large imports (3,500+ tx) complete in milliseconds.
 */
export function buildCompactBackupHistorySnapshotJson(
  data: Omit<AppDatabaseData, 'user'> & {
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
    updatedAtMs?: number;
    activeCloudOrgCounts?: { transactions: number; wallets: number };
  },
  maxBytes: number = 750_000
): { snapshotJson: string; storedTransactionsCount: number; truncated: boolean } {
  const strippedTx = (data.transactions || []).filter(isActiveTx).map((tx: Transaction) => {
    if (!tx.attachments?.length && !tx.attachmentPaths?.length) return tx;
    const { attachments: _a, ...rest } = tx;
    return rest;
  });

  const sortedTx = [...strippedTx].sort((a, b) => {
    const dateDiff = (b.date || '').localeCompare(a.date || '');
    if (dateDiff !== 0) return dateDiff;
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });

  let storedOrgTxCount = 0;
  const compactOrgs = data.orgWorkspaces
    ? Object.fromEntries(
        Object.entries(data.orgWorkspaces)
          .slice(0, 25)
          .map(([id, ws]) => {
            const activeOrgTxs = (ws.transactions || []).filter(isActiveTx);
            const sortedOrgTxs = [...activeOrgTxs]
              .sort((a, b) => {
                const dateDiff = (b.date || '').localeCompare(a.date || '');
                if (dateDiff !== 0) return dateDiff;
                return Number(b.createdAt || 0) - Number(a.createdAt || 0);
              })
              .slice(0, 150)
              .map((t) => {
                if (!t.attachments?.length) return t;
                const { attachments: _att, ...rest } = t;
                return rest;
              });
            storedOrgTxCount += sortedOrgTxs.length;
            return [
              id,
              {
                ...ws,
                wallets: stripSensitivePinsFromWallets(ws.wallets || []),
                transactions: sortedOrgTxs,
                auditLogs: (ws.auditLogs || []).slice(0, 30),
              },
            ];
          })
      )
    : undefined;

  const cloudSafeWallets = stripSensitivePinsFromWallets((data.wallets || []).slice(0, 200));
  const cloudSafeSettings = stripSensitivePinFromSettings({
    ...data.settings,
    isPro: false,
  });

  const TX_PLACEHOLDER = '__RASEEDI_TX_PLACEHOLDER__';
  const baseObj = {
    schemaVersion: 2,
    updatedAtMs: data.updatedAtMs || Date.now(),
    transactions: TX_PLACEHOLDER,
    wallets: cloudSafeWallets,
    categories: (data.categories || []).slice(0, 300),
    budgets: (data.budgets || []).slice(0, 200),
    debts: (data.debts || []).slice(0, 500),
    goals: (data.goals || []).slice(0, 200),
    templates: (data.templates || []).slice(0, 300),
    moneyCircles: (data.moneyCircles || []).slice(0, 200),
    ...(compactOrgs ? { orgWorkspaces: compactOrgs } : {}),
    ...(data.activeWorkspace ? { activeWorkspace: data.activeWorkspace } : {}),
    ...(data.activeCloudOrgCounts ? { activeCloudOrgCounts: data.activeCloudOrgCounts } : {}),
    settings: cloudSafeSettings,
    hasCompletedOnboarding: Boolean(data.hasCompletedOnboarding),
  };

  const skeletonJson = JSON.stringify(baseObj);
  const placeholderQuoted = `"${TX_PLACEHOLDER}"`;
  const placeholderIdx = skeletonJson.indexOf(placeholderQuoted);
  const prefix = skeletonJson.slice(0, placeholderIdx) + '[';
  const suffix = ']' + skeletonJson.slice(placeholderIdx + placeholderQuoted.length);

  const overheadBytes = getUtf8Length(prefix) + getUtf8Length(suffix);
  const availableBytes = Math.max(0, maxBytes - overheadBytes);

  const keptSerialized: string[] = [];
  let usedBytes = 0;

  for (let i = 0; i < sortedTx.length; i++) {
    const serialized = JSON.stringify(sortedTx[i]);
    const itemBytes = getUtf8Length(serialized) + (i > 0 ? 1 : 0); // +1 for comma
    if (usedBytes + itemBytes > availableBytes) {
      break;
    }
    keptSerialized.push(serialized);
    usedBytes += itemBytes;
  }

  const snapshotJson = prefix + keptSerialized.join(',') + suffix;
  const totalOrgRawTx = data.orgWorkspaces
    ? Object.values(data.orgWorkspaces).reduce(
        (sum, ws) => sum + (ws?.transactions || []).filter(isActiveTx).length,
        0
      )
    : 0;

  return {
    snapshotJson,
    storedTransactionsCount: keptSerialized.length + storedOrgTxCount,
    truncated: keptSerialized.length < sortedTx.length || storedOrgTxCount < totalOrgRawTx,
  };
}

