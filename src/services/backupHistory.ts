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

function getUtf8Length(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return str.length * 2;
}

/**
 * Builds a compact JSON snapshot for cloud backup history that stays safely under
 * Firestore's 1 MiB document size limit (default 750 KB cap).
 */
export function buildCompactBackupHistorySnapshotJson(
  data: Omit<AppDatabaseData, 'user'> & {
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
    updatedAtMs?: number;
  },
  maxBytes: number = 750_000
): { snapshotJson: string; storedTransactionsCount: number; truncated: boolean } {
  const strippedTx = (data.transactions || []).map((tx: Transaction) => {
    if (!tx.attachments?.length && !tx.attachmentPaths?.length) return tx;
    const { attachments: _a, ...rest } = tx;
    return rest;
  });

  const sortedTx = [...strippedTx].sort((a, b) => {
    const dateDiff = (b.date || '').localeCompare(a.date || '');
    if (dateDiff !== 0) return dateDiff;
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });

  const compactOrgs = data.orgWorkspaces
    ? Object.fromEntries(
        Object.entries(data.orgWorkspaces)
          .slice(0, 25)
          .map(([id, ws]) => [
            id,
            {
              ...ws,
              wallets: stripSensitivePinsFromWallets(ws.wallets || []),
              transactions: (ws.transactions || []).slice(0, 150).map((t) => {
                if (!t.attachments?.length) return t;
                const { attachments: _att, ...rest } = t;
                return rest;
              }),
              auditLogs: (ws.auditLogs || []).slice(0, 30),
            },
          ])
      )
    : undefined;

  const cloudSafeWallets = stripSensitivePinsFromWallets((data.wallets || []).slice(0, 200));
  const cloudSafeSettings = stripSensitivePinFromSettings({
    ...data.settings,
    isPro: false,
  });

  const makePayload = (txSlice: typeof sortedTx) =>
    JSON.stringify({
      schemaVersion: 2,
      updatedAtMs: data.updatedAtMs || Date.now(),
      transactions: txSlice,
      wallets: cloudSafeWallets,
      categories: (data.categories || []).slice(0, 300),
      budgets: (data.budgets || []).slice(0, 200),
      debts: (data.debts || []).slice(0, 500),
      goals: (data.goals || []).slice(0, 200),
      templates: (data.templates || []).slice(0, 300),
      moneyCircles: (data.moneyCircles || []).slice(0, 200),
      ...(compactOrgs ? { orgWorkspaces: compactOrgs } : {}),
      ...(data.activeWorkspace ? { activeWorkspace: data.activeWorkspace } : {}),
      settings: cloudSafeSettings,
      hasCompletedOnboarding: Boolean(data.hasCompletedOnboarding),
    });

  const fullJson = makePayload(sortedTx);
  if (getUtf8Length(fullJson) <= maxBytes) {
    return {
      snapshotJson: fullJson,
      storedTransactionsCount: sortedTx.length,
      truncated: false,
    };
  }

  // Binary search the maximum number of newest transactions that fit within maxBytes
  let lo = 0;
  let hi = sortedTx.length;
  let bestCount = 0;
  let bestJson = makePayload([]);

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = makePayload(sortedTx.slice(0, mid));
    if (getUtf8Length(candidate) <= maxBytes) {
      bestCount = mid;
      bestJson = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return {
    snapshotJson: bestJson,
    storedTransactionsCount: bestCount,
    truncated: bestCount < sortedTx.length,
  };
}
