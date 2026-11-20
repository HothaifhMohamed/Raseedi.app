import type { OrgWorkspaceData, Transaction } from '../types';
import type { AppDatabaseData } from './db';
import {
  stripSensitivePinFromSettings,
  stripSensitivePinsFromWallets,
} from './security';

export const MAX_AUTO_CLOUD_BACKUPS = 7;

export interface WorkspaceBackupCount {
  workspaceId: string;
  workspaceName: string;
  type: 'personal' | 'organization';
  transactionsCount: number;
  walletsCount: number;
  /** True only for legacy pre-fix snapshots where org transactions in snapshotJson were capped at 150 without uncapped metadata */
  isTruncatedEstimate?: boolean;
}

export interface ActiveCloudOrgBackupCounts {
  orgId?: string;
  orgName?: string;
  transactions: number;
  wallets: number;
}

export interface BackupHistorySummary {
  id: string;
  uid: string;
  source: 'auto' | 'manual';
  createdAtMs: number;
  totalTransactions: number;
  storedTransactionsCount: number;
  walletsCount: number;
  activeWorkspaceId?: string;
  activeWorkspaceName?: string;
  workspaceCounts?: Record<string, WorkspaceBackupCount>;
}

export interface BackupHistoryRecord extends BackupHistorySummary {
  snapshotJson: string;
}

export interface ResolvedBackupHistoryDisplay {
  transactionsCount: number;
  walletsCount: number;
  scopeLabel: string;
  matchesActiveWorkspace: boolean;
  isTruncatedEstimate: boolean;
  isAllWorkspacesFallback: boolean;
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
  extraOrgId?: string;
  extraOrgName?: string;
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
  workspaceCounts: Record<string, WorkspaceBackupCount>;
}

function isActiveTx(tx: Pick<Transaction, 'deletedAt'> | null | undefined): boolean {
  if (!tx) return false;
  return !(typeof tx.deletedAt === 'number' && tx.deletedAt > 0);
}

/**
 * Builds true (uncapped) per-workspace active transaction & wallet counts across
 * personal workspace, all local/cached orgWorkspaces, and optional active Cloud Org.
 */
export function buildWorkspaceBackupCounts(
  data: {
    transactions?: Transaction[];
    wallets?: Array<{ id?: string }>;
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
  },
  extra?: BackupHistoryExtraCounts
): Record<string, WorkspaceBackupCount> {
  const counts: Record<string, WorkspaceBackupCount> = {};

  const personalTxCount = (data.transactions || []).filter(isActiveTx).length;
  const personalWalletCount = (data.wallets || []).length;
  counts.personal = {
    workspaceId: 'personal',
    workspaceName: 'الحساب الشخصي',
    type: 'personal',
    transactionsCount: personalTxCount,
    walletsCount: personalWalletCount,
  };

  if (data.orgWorkspaces && typeof data.orgWorkspaces === 'object') {
    for (const [orgId, ws] of Object.entries(data.orgWorkspaces)) {
      if (!ws || typeof ws !== 'object') continue;
      const wsId = ws.organization?.id || orgId;
      counts[wsId] = {
        workspaceId: wsId,
        workspaceName: ws.organization?.name || wsId,
        type: 'organization',
        transactionsCount: (ws.transactions || []).filter(isActiveTx).length,
        walletsCount: (ws.wallets || []).length,
      };
    }
  }

  const extraTx = Math.max(0, Math.floor(Number(extra?.extraTransactions || 0)));
  const extraWallets = Math.max(0, Math.floor(Number(extra?.extraWallets || 0)));
  const hasExtraOrg = Boolean(extra?.extraOrgId) || extraTx > 0 || extraWallets > 0;

  if (hasExtraOrg) {
    const cloudOrgId =
      extra?.extraOrgId ||
      (data.activeWorkspace && data.activeWorkspace !== 'personal'
        ? data.activeWorkspace
        : '__active_cloud_org__');
    const existing = counts[cloudOrgId];
    counts[cloudOrgId] = {
      workspaceId: cloudOrgId,
      workspaceName: extra?.extraOrgName || existing?.workspaceName || cloudOrgId,
      type: 'organization',
      transactionsCount: Math.max(existing?.transactionsCount || 0, extraTx),
      walletsCount: Math.max(existing?.walletsCount || 0, extraWallets),
    };
  }

  return counts;
}

/**
 * Accurately computes total active transactions and wallets across the personal
 * workspace, all local/cached organization workspaces, and any optional active
 * cloud organization counts without double-counting duplicate org IDs.
 */
export function computeBackupHistoryCounts(
  data: {
    transactions?: Transaction[];
    wallets?: Array<{ id?: string }>;
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
  },
  extra?: BackupHistoryExtraCounts
): ComputedBackupHistoryCounts {
  const workspaceCounts = buildWorkspaceBackupCounts(data, extra);
  const personal = workspaceCounts.personal;
  let orgTransactionsCount = 0;
  let orgWalletsCount = 0;

  for (const [wsId, wsCount] of Object.entries(workspaceCounts)) {
    if (wsId === 'personal') continue;
    orgTransactionsCount += wsCount.transactionsCount;
    orgWalletsCount += wsCount.walletsCount;
  }

  return {
    totalTransactions: personal.transactionsCount + orgTransactionsCount,
    walletsCount: personal.walletsCount + orgWalletsCount,
    personalTransactionsCount: personal.transactionsCount,
    orgTransactionsCount,
    personalWalletsCount: personal.walletsCount,
    orgWalletsCount,
    workspaceCounts,
  };
}

/**
 * Reconciles backup history summaries with their snapshotJson so every entry
 * carries accurate per-workspace counts (`workspaceCounts`, `activeWorkspaceId`,
 * `activeWorkspaceName`), including legacy snapshots whose top-level counts were
 * zero or capped at 150 per org.
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

  try {
    const parsed = JSON.parse(snapshotJson) as {
      transactions?: Transaction[];
      wallets?: Array<{ id?: string }>;
      orgWorkspaces?: Record<string, OrgWorkspaceData>;
      activeWorkspace?: string;
      activeWorkspaceName?: string;
      activeCloudOrgCounts?: ActiveCloudOrgBackupCounts;
      workspaceCounts?: Record<string, WorkspaceBackupCount>;
    };

    const parsedActiveWsId =
      typeof parsed?.activeWorkspace === 'string' && parsed.activeWorkspace.trim()
        ? parsed.activeWorkspace.trim()
        : entry.activeWorkspaceId;

    const parsedActiveWsName =
      typeof parsed?.activeWorkspaceName === 'string' && parsed.activeWorkspaceName.trim()
        ? parsed.activeWorkspaceName.trim()
        : entry.activeWorkspaceName;

    // Prefer exact uncapped workspaceCounts embedded at backup creation time
    let workspaceCounts: Record<string, WorkspaceBackupCount> = {};
    if (parsed?.workspaceCounts && typeof parsed.workspaceCounts === 'object') {
      for (const [wsId, item] of Object.entries(parsed.workspaceCounts)) {
        if (!item || typeof item !== 'object') continue;
        workspaceCounts[wsId] = {
          workspaceId: item.workspaceId || wsId,
          workspaceName:
            item.workspaceName || (wsId === 'personal' ? 'الحساب الشخصي' : wsId),
          type: item.type === 'organization' ? 'organization' : 'personal',
          transactionsCount: Math.max(0, Math.floor(Number(item.transactionsCount || 0))),
          walletsCount: Math.max(0, Math.floor(Number(item.walletsCount || 0))),
          ...(item.isTruncatedEstimate ? { isTruncatedEstimate: true } : {}),
        };
      }
    } else {
      // Reconstruct from legacy snapshotJson payloads
      const reconstructed = buildWorkspaceBackupCounts(
        {
          transactions: parsed?.transactions,
          wallets: parsed?.wallets,
          orgWorkspaces: parsed?.orgWorkspaces,
          activeWorkspace: parsedActiveWsId,
        },
        parsed?.activeCloudOrgCounts
          ? {
              extraOrgId: parsed.activeCloudOrgCounts.orgId,
              extraOrgName: parsed.activeCloudOrgCounts.orgName,
              extraTransactions: parsed.activeCloudOrgCounts.transactions,
              extraWallets: parsed.activeCloudOrgCounts.wallets,
            }
          : undefined
      );

      // Legacy snapshots capped orgWorkspaces[id].transactions at 150 items without storing uncapped counts
      for (const [wsId, wsCount] of Object.entries(reconstructed)) {
        const isLegacyOrgCapped =
          wsId !== 'personal' &&
          !parsed?.activeCloudOrgCounts &&
          wsCount.transactionsCount === 150;
        workspaceCounts[wsId] = isLegacyOrgCapped
          ? { ...wsCount, isTruncatedEstimate: true }
          : wsCount;
      }
    }

    const totalFromMap = Object.values(workspaceCounts).reduce(
      (sum, ws) => sum + ws.transactionsCount,
      0
    );
    const walletsFromMap = Object.values(workspaceCounts).reduce(
      (sum, ws) => sum + ws.walletsCount,
      0
    );

    const storedOrgTx = parsed?.orgWorkspaces
      ? Object.values(parsed.orgWorkspaces).reduce(
          (sum, ws) => sum + (ws?.transactions || []).filter(isActiveTx).length,
          0
        )
      : 0;
    const storedPersonalTx = (parsed?.transactions || []).filter(isActiveTx).length;
    const reconciledStored = Math.max(baseStored, storedPersonalTx + storedOrgTx);
    const reconciledTotal = Math.max(baseTotal, reconciledStored, totalFromMap);
    const reconciledWallets = Math.max(baseWallets, walletsFromMap);

    return {
      ...entry,
      totalTransactions: reconciledTotal,
      storedTransactionsCount: reconciledStored,
      walletsCount: reconciledWallets,
      ...(parsedActiveWsId ? { activeWorkspaceId: parsedActiveWsId } : {}),
      ...(parsedActiveWsName ? { activeWorkspaceName: parsedActiveWsName } : {}),
      ...(Object.keys(workspaceCounts).length > 0 ? { workspaceCounts } : {}),
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

/**
 * Resolves the exact transaction/wallet counts and scope badge to show for a
 * backup history entry given the user's currently active workspace (`personal` or `orgId`).
 * Prevents mixing counts from other workspaces or displaying a misleading 150-tx cap.
 */
export function resolveBackupHistoryDisplayForWorkspace(
  entry: BackupHistorySummary,
  activeWorkspaceId: string,
  options?: { isRTL?: boolean; activeWorkspaceName?: string }
): ResolvedBackupHistoryDisplay {
  const isRTL = options?.isRTL ?? true;
  const targetWsId = (activeWorkspaceId || 'personal').trim() || 'personal';
  const personalLabel = isRTL ? 'الحساب الشخصي' : 'Personal';
  const map = entry.workspaceCounts;

  // 1. Direct match for the currently active workspace
  if (map && map[targetWsId]) {
    const matched = map[targetWsId];
    return {
      transactionsCount: matched.transactionsCount,
      walletsCount: matched.walletsCount,
      scopeLabel:
        targetWsId === 'personal'
          ? personalLabel
          : options?.activeWorkspaceName ||
            matched.workspaceName ||
            (isRTL ? 'المؤسسة الحالية' : 'Current Org'),
      matchesActiveWorkspace: true,
      isTruncatedEstimate: Boolean(matched.isTruncatedEstimate),
      isAllWorkspacesFallback: false,
    };
  }

  // 2. Active workspace is an organization not present in this snapshot (e.g. older backup or personal-only backup)
  if (map && targetWsId !== 'personal') {
    const snapshotActiveId = entry.activeWorkspaceId;
    if (snapshotActiveId && map[snapshotActiveId]) {
      const snapWs = map[snapshotActiveId];
      return {
        transactionsCount: snapWs.transactionsCount,
        walletsCount: snapWs.walletsCount,
        scopeLabel:
          snapshotActiveId === 'personal'
            ? personalLabel
            : entry.activeWorkspaceName || snapWs.workspaceName,
        matchesActiveWorkspace: false,
        isTruncatedEstimate: Boolean(snapWs.isTruncatedEstimate),
        isAllWorkspacesFallback: false,
      };
    }

    const orgKeys = Object.keys(map).filter((k) => k !== 'personal');
    if (orgKeys.length === 0 && map.personal) {
      return {
        transactionsCount: map.personal.transactionsCount,
        walletsCount: map.personal.walletsCount,
        scopeLabel: personalLabel,
        matchesActiveWorkspace: false,
        isTruncatedEstimate: false,
        isAllWorkspacesFallback: false,
      };
    }

    // Legacy snapshot covering multiple workspaces without this org
    const anyTruncated = Object.values(map).some((ws) => ws.isTruncatedEstimate);
    return {
      transactionsCount: Math.max(
        Number(entry.totalTransactions || 0),
        Number(entry.storedTransactionsCount || 0)
      ),
      walletsCount: Math.max(0, Number(entry.walletsCount || 0)),
      scopeLabel: isRTL ? 'كل المساحات (نسخة سابقة)' : 'All Workspaces (older)',
      matchesActiveWorkspace: false,
      isTruncatedEstimate: anyTruncated,
      isAllWorkspacesFallback: true,
    };
  }

  // 3. Fallback when summary has no workspaceCounts breakdown
  const fallbackTx = Math.max(
    Number(entry.totalTransactions || 0),
    Number(entry.storedTransactionsCount || 0)
  );
  const fallbackWallets = Math.max(0, Number(entry.walletsCount || 0));
  const matchesPersonal = targetWsId === 'personal';

  return {
    transactionsCount: fallbackTx,
    walletsCount: fallbackWallets,
    scopeLabel: matchesPersonal
      ? personalLabel
      : isRTL
      ? 'كل المساحات'
      : 'All Workspaces',
    matchesActiveWorkspace: matchesPersonal,
    isTruncatedEstimate: false,
    isAllWorkspacesFallback: !matchesPersonal,
  };
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
 * Uses O(N) pre-serialized transaction sizing so large imports (3,500+ tx) complete in milliseconds,
 * while embedding true uncapped `workspaceCounts` for every workspace.
 */
export function buildCompactBackupHistorySnapshotJson(
  data: Omit<AppDatabaseData, 'user'> & {
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
    activeWorkspaceName?: string;
    updatedAtMs?: number;
    activeCloudOrgCounts?: ActiveCloudOrgBackupCounts;
  },
  maxBytes: number = 750_000
): {
  snapshotJson: string;
  storedTransactionsCount: number;
  truncated: boolean;
  workspaceCounts: Record<string, WorkspaceBackupCount>;
} {
  // Compute TRUE uncapped per-workspace counts BEFORE any snapshot truncation
  const workspaceCounts = buildWorkspaceBackupCounts(
    {
      transactions: data.transactions,
      wallets: data.wallets,
      orgWorkspaces: data.orgWorkspaces,
      activeWorkspace: data.activeWorkspace,
    },
    data.activeCloudOrgCounts
      ? {
          extraOrgId: data.activeCloudOrgCounts.orgId,
          extraOrgName: data.activeCloudOrgCounts.orgName,
          extraTransactions: data.activeCloudOrgCounts.transactions,
          extraWallets: data.activeCloudOrgCounts.wallets,
        }
      : undefined
  );

  const resolvedActiveWorkspaceName =
    data.activeWorkspaceName ||
    (data.activeWorkspace && workspaceCounts[data.activeWorkspace]?.workspaceName) ||
    (data.activeWorkspace === 'personal' ? 'الحساب الشخصي' : undefined);

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
    ...(resolvedActiveWorkspaceName ? { activeWorkspaceName: resolvedActiveWorkspaceName } : {}),
    ...(data.activeCloudOrgCounts ? { activeCloudOrgCounts: data.activeCloudOrgCounts } : {}),
    workspaceCounts,
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
    workspaceCounts,
  };
}
