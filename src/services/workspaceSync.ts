import { Transaction, TransactionType, Wallet } from '../types';
import { fromMinor, toMinor } from './currency';
import { sortTransactionsDescending } from './orgTransactionQuery';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const ALLOWED_TX_TYPES = new Set<TransactionType>(['expense', 'income', 'transfer']);
const MAX_INLINE_ATTACHMENT_CHARS = 24_000;

export function normalizeWorkspaceId(workspaceId?: string | null): string {
  const trimmed = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (!trimmed) return 'personal';
  if (VALID_ID_REGEX.test(trimmed)) {
    return trimmed.slice(0, 128);
  }
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return sanitized || 'personal';
}

export function normalizeValidFirestoreId(rawId: string | undefined | null, fallbackPrefix = 'tx'): string {
  const trimmed = typeof rawId === 'string' ? rawId.trim() : '';
  if (trimmed && VALID_ID_REGEX.test(trimmed)) {
    return trimmed.slice(0, 128);
  }
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  if (sanitized && VALID_ID_REGEX.test(sanitized)) {
    return sanitized;
  }
  return `${fallbackPrefix}-${Date.now()}`;
}

export function getWorkspaceTransactionsPath(uid: string, workspaceId?: string | null): string {
  const safeUid = normalizeValidFirestoreId(uid, 'user');
  const safeWs = normalizeWorkspaceId(workspaceId);
  return `users/${safeUid}/workspaces/${safeWs}/transactions`;
}

export function getWorkspaceTransactionDocPath(
  uid: string,
  workspaceId: string | null | undefined,
  txId: string
): string {
  return `${getWorkspaceTransactionsPath(uid, workspaceId)}/${normalizeValidFirestoreId(txId, 'tx')}`;
}

export function isTransactionInWorkspace(
  tx: Pick<Transaction, 'workspaceId'> | null | undefined,
  activeWorkspaceId?: string | null
): boolean {
  if (!tx) return false;
  const targetWs = normalizeWorkspaceId(activeWorkspaceId);
  const txWs = tx.workspaceId ? normalizeWorkspaceId(tx.workspaceId) : 'personal';
  return txWs === targetWs;
}

export function isActiveWorkspaceTransaction(
  tx: Transaction | null | undefined,
  activeWorkspaceId?: string | null
): tx is Transaction {
  if (!tx || !tx.id) return false;
  if (typeof tx.deletedAt === 'number' && tx.deletedAt > 0) return false;
  return isTransactionInWorkspace(tx, activeWorkspaceId);
}

export function canPerformAutomaticCloudWrite(params: {
  isAuthenticated: boolean;
  isCloudLoaded: boolean;
  isEmergencyRecoveryActive?: boolean;
}): boolean {
  return Boolean(
    params.isAuthenticated && params.isCloudLoaded && !params.isEmergencyRecoveryActive
  );
}

export function shouldBlockEmptyCloudOverwrite(params: {
  localTransactionsCount: number;
  cloudBackupTransactionsCount?: number;
  unifiedCloudTransactionsCount?: number;
  hasUnifiedCloudTransactions?: boolean;
  allowEmptyOverwrite?: boolean;
}): boolean {
  if (params.allowEmptyOverwrite) return false;
  if (params.localTransactionsCount > 0) return false;
  const hasCloudData =
    Number(params.cloudBackupTransactionsCount || 0) > 0 ||
    Number(params.unifiedCloudTransactionsCount || 0) > 0 ||
    Boolean(params.hasUnifiedCloudTransactions);
  return hasCloudData;
}

export function tagTransactionsWithWorkspace<T extends Partial<Transaction>>(
  txs: T[],
  workspaceId?: string | null
): (T & { workspaceId: string })[] {
  const safeWs = normalizeWorkspaceId(workspaceId);
  return txs.map((tx) => ({
    ...tx,
    workspaceId: safeWs,
  }));
}

export function tagWalletsWithWorkspace(
  wallets: Wallet[],
  workspaceId?: string | null
): Wallet[] {
  const safeWs = normalizeWorkspaceId(workspaceId);
  return wallets.map((w) => ({
    ...w,
    workspaceId: safeWs,
  }));
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function sanitizeAttachments(attachments?: string[]): {
  kept?: string[];
  skippedCount: number;
} {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { kept: undefined, skippedCount: 0 };
  }
  const kept = attachments.filter(
    (att) => typeof att === 'string' && att.length <= MAX_INLINE_ATTACHMENT_CHARS
  );
  return {
    kept: kept.length > 0 ? kept : undefined,
    skippedCount: attachments.length - kept.length,
  };
}

export interface WorkspaceTransactionFirestoreFields {
  id: string;
  uid: string;
  workspaceId: string;
  date: string;
  time: string;
  type: TransactionType;
  amount: number;
  amountMinor: number;
  currency: string;
  walletId: string;
  toWalletId?: string | null;
  categoryId: string;
  createdAtMs: number;
  updatedAtMs: number;
  deletedAt: number | null;
  payload: Transaction;
}

export function buildWorkspaceTransactionRecord(
  uid: string,
  workspaceId: string | null | undefined,
  tx: Transaction
): { record: WorkspaceTransactionFirestoreFields; skippedAttachmentsCount: number } {
  const safeUid = normalizeValidFirestoreId(uid, 'user');
  const safeWs = normalizeWorkspaceId(workspaceId);
  const safeId = normalizeValidFirestoreId(tx.id, 'tx');
  const safeType: TransactionType = ALLOWED_TX_TYPES.has(tx.type) ? tx.type : 'expense';
  const safeCurrency = (String(tx.currency || 'EGP').trim() || 'EGP').slice(0, 8);
  const rawAmount = Number(tx.amount);
  const safeAmount = Number.isFinite(rawAmount) ? Math.min(1_000_000_000, Math.max(0, rawAmount)) : 0;
  const safeAmountMinor = Math.max(
    0,
    Math.round(
      typeof tx.amountMinor === 'number' && Number.isFinite(tx.amountMinor)
        ? tx.amountMinor
        : toMinor(safeAmount, safeCurrency)
    )
  );
  const safeDate = (String(tx.date || new Date().toISOString().slice(0, 10)).trim() || '1970-01-01').slice(
    0,
    16
  );
  const safeTime = String(tx.time || '00:00').trim().slice(0, 16);
  const safeWalletId = (String(tx.walletId || 'w-primary').trim() || 'w-primary').slice(0, 128);
  const safeToWalletId =
    typeof tx.toWalletId === 'string' && tx.toWalletId.trim().length > 0
      ? tx.toWalletId.trim().slice(0, 128)
      : null;
  const safeCategoryId = String(tx.categoryId ?? '').trim().slice(0, 128);
  const now = Date.now();
  const createdAtMs =
    typeof tx.createdAt === 'number' && Number.isFinite(tx.createdAt) && tx.createdAt >= 0
      ? tx.createdAt
      : now;
  const updatedAtMs =
    typeof tx.updatedAt === 'number' && Number.isFinite(tx.updatedAt) && tx.updatedAt >= 0
      ? tx.updatedAt
      : now;
  const deletedAt =
    typeof tx.deletedAt === 'number' && Number.isFinite(tx.deletedAt) && tx.deletedAt > 0
      ? tx.deletedAt
      : null;

  const { kept: safeAttachments, skippedCount } = sanitizeAttachments(tx.attachments);

  const normalizedPayload: Transaction = stripUndefinedDeep({
    ...tx,
    id: safeId,
    type: safeType,
    amount: safeAmount,
    amountMinor: safeAmountMinor,
    currency: safeCurrency,
    date: safeDate,
    time: safeTime,
    walletId: safeWalletId,
    ...(safeToWalletId ? { toWalletId: safeToWalletId } : { toWalletId: undefined }),
    categoryId: safeCategoryId,
    workspaceId: safeWs,
    createdAt: createdAtMs,
    updatedAt: updatedAtMs,
    deletedAt,
    ...(safeAttachments ? { attachments: safeAttachments } : { attachments: undefined }),
  });

  return {
    record: stripUndefinedDeep({
      id: safeId,
      uid: safeUid,
      workspaceId: safeWs,
      date: safeDate,
      time: safeTime,
      type: safeType,
      amount: safeAmount,
      amountMinor: safeAmountMinor,
      currency: safeCurrency,
      walletId: safeWalletId,
      ...(safeToWalletId ? { toWalletId: safeToWalletId } : {}),
      categoryId: safeCategoryId,
      createdAtMs,
      updatedAtMs,
      deletedAt,
      payload: normalizedPayload,
    }),
    skippedAttachmentsCount: skippedCount,
  };
}

function toEpochMs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

export function extractTransactionFromWorkspaceDoc(
  docData: Record<string, unknown> | null | undefined,
  activeWorkspaceId?: string | null
): Transaction | null {
  if (!docData || typeof docData !== 'object') return null;

  const deletedAt = docData.deletedAt;
  if (typeof deletedAt === 'number' && deletedAt > 0) {
    return null;
  }

  const targetWs = normalizeWorkspaceId(activeWorkspaceId);
  const rawPayload = (docData.payload && typeof docData.payload === 'object'
    ? docData.payload
    : docData) as Partial<Transaction>;

  const docWsRaw =
    typeof docData.workspaceId === 'string'
      ? docData.workspaceId
      : typeof rawPayload.workspaceId === 'string'
      ? rawPayload.workspaceId
      : 'personal';
  if (normalizeWorkspaceId(docWsRaw) !== targetWs) {
    return null;
  }

  if (typeof rawPayload.deletedAt === 'number' && rawPayload.deletedAt > 0) {
    return null;
  }

  const id = String(docData.id || rawPayload.id || '').trim();
  if (!id) return null;

  const currency = String(docData.currency || rawPayload.currency || 'EGP');
  const amountMinor =
    typeof docData.amountMinor === 'number' && Number.isFinite(docData.amountMinor)
      ? docData.amountMinor
      : typeof rawPayload.amountMinor === 'number' && Number.isFinite(rawPayload.amountMinor)
      ? rawPayload.amountMinor
      : toMinor(Number(docData.amount ?? rawPayload.amount ?? 0), currency);

  const amount =
    typeof rawPayload.amount === 'number' && Number.isFinite(rawPayload.amount)
      ? rawPayload.amount
      : typeof docData.amount === 'number' && Number.isFinite(docData.amount)
      ? docData.amount
      : fromMinor(amountMinor, currency);

  const createdAt = toEpochMs(
    docData.createdAtMs ?? rawPayload.createdAt ?? docData.createdAt,
    Date.now()
  );
  const updatedAt = toEpochMs(
    docData.updatedAtMs ?? docData.updatedAt ?? rawPayload.updatedAt,
    createdAt
  );

  return {
    ...(rawPayload as Transaction),
    id,
    type: ALLOWED_TX_TYPES.has((docData.type || rawPayload.type) as TransactionType)
      ? ((docData.type || rawPayload.type) as TransactionType)
      : 'expense',
    amount,
    amountMinor,
    currency,
    date: String(docData.date || rawPayload.date || ''),
    time: String(docData.time ?? rawPayload.time ?? '00:00'),
    walletId: String(docData.walletId || rawPayload.walletId || ''),
    categoryId: String(docData.categoryId ?? rawPayload.categoryId ?? ''),
    workspaceId: targetWs,
    createdAt,
    updatedAt,
    deletedAt: null,
  };
}

export function reconcileWorkspaceTransactions(
  cloudTxs: Transaction[],
  localCacheTxs: Transaction[],
  options: {
    activeWorkspaceId?: string | null;
    hasServerSnapshot?: boolean;
    pendingLocalIds?: Iterable<string>;
    locallyDeletedIds?: Iterable<string>;
  }
): Transaction[] {
  const activeWs = normalizeWorkspaceId(options.activeWorkspaceId);
  const hasServerSnapshot = Boolean(options.hasServerSnapshot);
  const pendingIds = new Set(options.pendingLocalIds || []);
  const deletedIds = new Set(options.locallyDeletedIds || []);

  const byId = new Map<string, Transaction>();

  for (const tx of cloudTxs) {
    if (!isActiveWorkspaceTransaction(tx, activeWs)) continue;
    if (deletedIds.has(tx.id)) continue;
    byId.set(tx.id, { ...tx, workspaceId: activeWs });
  }

  for (const localTx of localCacheTxs) {
    if (!isActiveWorkspaceTransaction(localTx, activeWs)) continue;
    if (deletedIds.has(localTx.id)) continue;

    // Cloud-First rule: once the server snapshot is authoritative, only retain local-only
    // transactions that are currently pending upload (created/modified while offline).
    const existingCloud = byId.get(localTx.id);
    if (!existingCloud) {
      if (!hasServerSnapshot || pendingIds.has(localTx.id)) {
        byId.set(localTx.id, { ...localTx, workspaceId: activeWs });
      }
    } else if (
      pendingIds.has(localTx.id) &&
      Number(localTx.updatedAt || 0) > Number(existingCloud.updatedAt || 0)
    ) {
      byId.set(localTx.id, { ...localTx, workspaceId: activeWs });
    }
  }

  return sortTransactionsDescending(Array.from(byId.values()));
}
