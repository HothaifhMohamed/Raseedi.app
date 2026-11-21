import { AppSettings, ThemePreference, Transaction, TransactionType, Wallet } from '../types';
import { fromMinor, toMinor } from './currency';
import { sortTransactionsDescending } from './orgTransactionQuery';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const ALLOWED_TX_TYPES = new Set<TransactionType>(['expense', 'income', 'transfer']);
const MAX_INLINE_ATTACHMENT_CHARS = 24_000;

/**
 * Optimal Firestore WriteBatch size for bulk imports (within 400–450 ops,
 * safely under Firestore's 500-operation hard batch limit).
 */
export const FIRESTORE_IMPORT_BATCH_SIZE = 425;

export function chunkArray<T>(items: readonly T[], chunkSize = FIRESTORE_IMPORT_BATCH_SIZE): T[][] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const safeSize = Math.max(1, Math.min(450, Math.floor(chunkSize) || FIRESTORE_IMPORT_BATCH_SIZE));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

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

export type ForceCloudSyncUnavailableReason = 'guest' | 'offline' | 'syncing' | null;

export interface ForceCloudSyncAvailability {
  canExecute: boolean;
  reason: ForceCloudSyncUnavailableReason;
}

export function getForceCloudSyncAvailability(params: {
  isLoggedIn: boolean;
  isOnline: boolean;
  isCloudSyncing: boolean;
}): ForceCloudSyncAvailability {
  if (!params.isLoggedIn) {
    return { canExecute: false, reason: 'guest' };
  }
  if (!params.isOnline) {
    return { canExecute: false, reason: 'offline' };
  }
  if (params.isCloudSyncing) {
    return { canExecute: false, reason: 'syncing' };
  }
  return { canExecute: true, reason: null };
}

export type WorkspaceSyncPriority =
  | 'noop'
  | 'pull_cloud_to_local'
  | 'push_local_to_cloud'
  | 'merge';

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

/**
 * Bidirectional Zero-Data Overwrite Guard:
 * Never allow an empty array (0 transactions) fetched from Cloud to wipe
 * non-empty local transactions in the browser unless allowEmptyOverwrite is explicitly true.
 */
export function shouldBlockEmptyLocalOverwriteFromCloud(params: {
  cloudTransactionsCount: number;
  localActiveTransactionsCount: number;
  allowEmptyOverwrite?: boolean;
}): boolean {
  if (params.allowEmptyOverwrite) return false;
  return params.cloudTransactionsCount === 0 && params.localActiveTransactionsCount > 0;
}

/**
 * Resolves sync direction between Cloud and Browser for a given workspace.
 * If Cloud has 0 active transactions while Local has > 0, ALWAYS prioritizes uploading Local -> Cloud.
 */
export function resolveWorkspaceSyncPriority(params: {
  cloudTransactions: Transaction[];
  localTransactions: Transaction[];
  activeWorkspaceId?: string | null;
  locallyDeletedIds?: Iterable<string>;
  allowEmptyOverwrite?: boolean;
}): WorkspaceSyncPriority {
  const activeWs = normalizeWorkspaceId(params.activeWorkspaceId);
  const deletedIds = new Set(params.locallyDeletedIds || []);

  const cloudActiveCount = params.cloudTransactions.filter(
    (tx) => isActiveWorkspaceTransaction(tx, activeWs) && !deletedIds.has(tx.id)
  ).length;
  const localActiveCount = params.localTransactions.filter(
    (tx) => isActiveWorkspaceTransaction(tx, activeWs) && !deletedIds.has(tx.id)
  ).length;

  if (cloudActiveCount === 0 && localActiveCount === 0) return 'noop';
  if (
    shouldBlockEmptyLocalOverwriteFromCloud({
      cloudTransactionsCount: cloudActiveCount,
      localActiveTransactionsCount: localActiveCount,
      allowEmptyOverwrite: params.allowEmptyOverwrite,
    })
  ) {
    return 'push_local_to_cloud';
  }
  if (localActiveCount === 0 && cloudActiveCount > 0) {
    return 'pull_cloud_to_local';
  }
  return 'merge';
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
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
    allowEmptyOverwrite?: boolean;
  }
): Transaction[] {
  const activeWs = normalizeWorkspaceId(options.activeWorkspaceId);
  const hasServerSnapshot = Boolean(options.hasServerSnapshot);
  const allowEmptyOverwrite = Boolean(options.allowEmptyOverwrite);
  const pendingIds = new Set(options.pendingLocalIds || []);
  const deletedIds = new Set(options.locallyDeletedIds || []);

  const byId = new Map<string, Transaction>();

  for (const tx of cloudTxs) {
    if (!isActiveWorkspaceTransaction(tx, activeWs)) continue;
    if (deletedIds.has(tx.id)) continue;
    byId.set(tx.id, { ...tx, workspaceId: activeWs });
  }

  // Zero-Data Overwrite Guard:
  // If Cloud returned 0 active transactions for this workspace, NEVER let an empty cloud array
  // overwrite non-empty local transactions (e.g. right after Refresh or offline Excel import).
  const cloudIsEmptyForWorkspace = byId.size === 0;

  for (const localTx of localCacheTxs) {
    if (!isActiveWorkspaceTransaction(localTx, activeWs)) continue;
    if (deletedIds.has(localTx.id)) continue;

    // Cloud-First rule: once the non-empty server snapshot is authoritative, only retain local-only
    // transactions that are currently pending upload (created/modified while offline).
    // When Cloud is empty (0 tx), ALWAYS preserve local active transactions unless allowEmptyOverwrite is true.
    const existingCloud = byId.get(localTx.id);
    if (!existingCloud) {
      if (
        !hasServerSnapshot ||
        pendingIds.has(localTx.id) ||
        (cloudIsEmptyForWorkspace && !allowEmptyOverwrite)
      ) {
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

/**
 * Detects Firestore offline / transient server-unreachable errors, including
 * `getDocsFromServer` / `getDocFromServer` failures when the Firestore transport
 * is connecting or offline ("Failed to get documents from server...").
 */
export function isFirestoreServerFetchOfflineError(err: unknown): boolean {
  if (!err) return false;
  const code =
    typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '').toLowerCase()
      : '';
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message || '')
      : String(err);
  const lower = msg.toLowerCase();
  return (
    code === 'unavailable' ||
    lower.includes('client is offline') ||
    lower.includes('offline') ||
    lower.includes('failed to get documents from server') ||
    lower.includes('failed to get document from server') ||
    lower.includes('failed to get document because the client is offline') ||
    lower.includes('could not reach cloud firestore backend')
  );
}

export const FIRESTORE_FAST_BATCH_SIZE = 350;
export const FIRESTORE_BATCH_CONCURRENCY = 3;

export function isRetryableFirestoreWriteError(err: unknown): boolean {
  if (!err) return false;
  const code =
    typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '').toLowerCase()
      : '';
  if (
    code === 'permission-denied' ||
    code === 'invalid-argument' ||
    code === 'unauthenticated' ||
    code === 'failed-precondition' ||
    code === 'not-found'
  ) {
    return false;
  }
  if (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'aborted' ||
    code === 'resource-exhausted' ||
    code === 'internal' ||
    code === 'unknown'
  ) {
    return true;
  }
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message || '')
      : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes('unavailable') ||
    lower.includes('deadline') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('aborted') ||
    lower.includes('resource-exhausted') ||
    lower.includes('quota') ||
    lower.includes('offline')
  );
}

export interface ResilientBatchCommitOptions<T> {
  items: readonly T[];
  batchSize?: number;
  concurrency?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  commitChunk: (chunk: T[], batchIndex: number, totalBatches: number) => Promise<void>;
  onProgress?: (processed: number, total: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface ResilientBatchCommitResult {
  total: number;
  committed: number;
  batches: number;
  retries: number;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Executes Firestore WriteBatch commits across chunked items using bounded
 * parallelism (default 3 concurrent batches of 350 items) and automatic
 * exponential backoff retries for transient network/Firestore errors.
 */
export async function runResilientBatchCommits<T>(
  options: ResilientBatchCommitOptions<T>
): Promise<ResilientBatchCommitResult> {
  const {
    items,
    batchSize = FIRESTORE_FAST_BATCH_SIZE,
    concurrency = FIRESTORE_BATCH_CONCURRENCY,
    maxRetries = 3,
    baseDelayMs = 400,
    commitChunk,
    onProgress,
    sleep = defaultSleep,
  } = options;

  const total = items.length;
  if (total === 0) {
    return { total: 0, committed: 0, batches: 0, retries: 0 };
  }

  const chunks = chunkArray(items, batchSize);
  const totalBatches = chunks.length;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, totalBatches));
  const safeMaxRetries = Math.max(0, Math.floor(maxRetries));

  let nextBatchIndex = 0;
  let committed = 0;
  let retries = 0;
  let firstError: unknown = null;

  const worker = async () => {
    while (true) {
      if (firstError !== null) return;
      const currentIndex = nextBatchIndex++;
      if (currentIndex >= totalBatches) return;

      const chunk = chunks[currentIndex];
      let attempt = 0;

      while (true) {
        try {
          await commitChunk(chunk, currentIndex, totalBatches);
          committed = Math.min(total, committed + chunk.length);
          onProgress?.(committed, total);
          break;
        } catch (err) {
          if (attempt < safeMaxRetries && isRetryableFirestoreWriteError(err)) {
            attempt += 1;
            retries += 1;
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            await sleep(delay);
            continue;
          }
          if (firstError === null) {
            firstError = err;
          }
          return;
        }
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstError !== null) {
    throw firstError;
  }

  return {
    total,
    committed,
    batches: totalBatches,
    retries,
  };
}

// ---------------------------------------------------------------------------
// Theme Persistence, System Resolution & Timestamp-Aware Sync Reconciliation
// ---------------------------------------------------------------------------

export const THEME_PREF_STORAGE_KEY = 'raseedi_theme_pref_v1';
const LEGACY_SETTINGS_STORAGE_KEY = 'raseedi_settings_v1';

export interface StoredThemePreference {
  theme: ThemePreference;
  updatedAt: number;
}

export function normalizeThemePreference(raw: unknown): ThemePreference | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  if (clean === 'dark' || clean === 'light' || clean === 'system') {
    return clean;
  }
  return null;
}

function normalizeTimestampMs(raw: unknown): number {
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

export function parseStoredThemePreference(
  raw: string | null | undefined
): StoredThemePreference | null {
  if (!raw || typeof raw !== 'string') return null;
  const direct = normalizeThemePreference(raw);
  if (direct) {
    return { theme: direct, updatedAt: 0 };
  }
  try {
    const parsed = JSON.parse(raw) as { theme?: unknown; updatedAt?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const theme = normalizeThemePreference(parsed.theme);
    if (!theme) return null;
    return {
      theme,
      updatedAt: normalizeTimestampMs(parsed.updatedAt),
    };
  } catch {
    return null;
  }
}

export function readStoredThemePreference(
  storage?: (Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>) | null
): StoredThemePreference | null {
  const store =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : null;
  if (!store) return null;

  const writableStore: Pick<Storage, 'setItem'> | null =
    typeof store.setItem === 'function' ? (store as Pick<Storage, 'setItem'>) : null;

  const pinIfLegacy = (pref: StoredThemePreference, forceWrite = false): StoredThemePreference => {
    if (pref.updatedAt === 0) {
      return writeStoredThemePreference(pref.theme, Date.now(), writableStore);
    }
    if (forceWrite && writableStore) {
      return writeStoredThemePreference(pref.theme, pref.updatedAt, writableStore);
    }
    return pref;
  };

  try {
    const dedicatedRaw = store.getItem(THEME_PREF_STORAGE_KEY);
    const dedicated = parseStoredThemePreference(dedicatedRaw);
    if (dedicated) {
      return pinIfLegacy(dedicated);
    }

    // Seamless migration fallback for existing users who saved theme in raseedi_settings_v1
    const legacyRaw = store.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (legacyRaw) {
      const parsedLegacy = JSON.parse(legacyRaw) as {
        theme?: unknown;
        themeUpdatedAt?: unknown;
      } | null;
      const legacyTheme = normalizeThemePreference(parsedLegacy?.theme);
      if (legacyTheme) {
        const legacyPref: StoredThemePreference = {
          theme: legacyTheme,
          updatedAt: normalizeTimestampMs(parsedLegacy?.themeUpdatedAt),
        };
        return pinIfLegacy(legacyPref, true);
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

export function writeStoredThemePreference(
  theme: ThemePreference,
  updatedAt?: number,
  storage?: Pick<Storage, 'setItem'> | null
): StoredThemePreference {
  const normalizedTheme = normalizeThemePreference(theme) ?? 'light';
  const ts =
    updatedAt !== undefined ? normalizeTimestampMs(updatedAt) : Date.now();
  const record: StoredThemePreference = {
    theme: normalizedTheme,
    updatedAt: ts,
  };
  const store =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : null;
  if (store) {
    try {
      store.setItem(THEME_PREF_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Ignore storage quota/private-mode errors
    }
  }
  return record;
}

export function resolveEffectiveDarkMode(
  theme: ThemePreference,
  systemPrefersDark: boolean
): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return Boolean(systemPrefersDark);
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/**
 * Applies the .dark class and color-scheme immediately on document.documentElement.
 * Only inspects prefers-color-scheme when theme === 'system'.
 */
export function applyThemeToDocument(theme: ThemePreference): boolean {
  const safeTheme = normalizeThemePreference(theme) ?? 'light';
  const isDark =
    safeTheme === 'system'
      ? resolveEffectiveDarkMode('system', getSystemPrefersDark())
      : resolveEffectiveDarkMode(safeTheme, false);

  if (typeof document !== 'undefined' && document.documentElement) {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    root.style.colorScheme = isDark ? 'dark' : 'light';
    root.dataset.theme = safeTheme;

    const themeMeta = document.querySelector('meta#raseedi-theme-color');
    if (themeMeta) {
      themeMeta.setAttribute('content', isDark ? '#081615' : '#F5EFE3');
    }
  }

  return isDark;
}

export interface ReconciledThemeResult {
  theme: ThemePreference;
  themeUpdatedAt: number;
  adoptedIncoming: boolean;
}

/**
 * Timestamp-aware theme conflict resolution between local state / dedicated localStorage
 * and incoming cloud / backup / snapshot settings.
 *
 * Guarantees:
 * - An explicit local user preference is NEVER overwritten by an older or un-timestamped
 *   cloud/backup snapshot.
 * - A strictly newer cloud change from another device (`incomingUpdatedAt > localUpdatedAt`)
 *   is cleanly adopted.
 * - On a brand-new device with no explicit local preference yet, a cloud theme is adopted.
 */
export function reconcileThemeSettings(
  localSettings: Partial<Pick<AppSettings, 'theme' | 'themeUpdatedAt'>> | null | undefined,
  incomingSettings: Partial<Pick<AppSettings, 'theme' | 'themeUpdatedAt'>> | null | undefined,
  storedLocalPref?: StoredThemePreference | null
): ReconciledThemeResult {
  const localStateTheme = normalizeThemePreference(localSettings?.theme);
  const localStateTs = normalizeTimestampMs(localSettings?.themeUpdatedAt);

  const storedTheme = normalizeThemePreference(storedLocalPref?.theme);
  const storedTs = normalizeTimestampMs(storedLocalPref?.updatedAt);

  // Pick the most authoritative local choice between dedicated localStorage and in-memory state
  let effectiveLocalTheme: ThemePreference | null = null;
  let effectiveLocalTs = 0;
  let hasExplicitLocalChoice = false;

  if (storedTheme && (!localStateTheme || storedTs >= localStateTs)) {
    effectiveLocalTheme = storedTheme;
    effectiveLocalTs = storedTs;
    hasExplicitLocalChoice = true;
  } else if (localStateTheme) {
    effectiveLocalTheme = localStateTheme;
    effectiveLocalTs = localStateTs;
    hasExplicitLocalChoice = localStateTs > 0 || Boolean(storedTheme);
  }

  const incomingTheme = normalizeThemePreference(incomingSettings?.theme);
  const incomingTs = normalizeTimestampMs(incomingSettings?.themeUpdatedAt);

  if (!incomingTheme) {
    return {
      theme: effectiveLocalTheme ?? 'light',
      themeUpdatedAt: effectiveLocalTs,
      adoptedIncoming: false,
    };
  }

  if (!effectiveLocalTheme) {
    return {
      theme: incomingTheme,
      themeUpdatedAt: incomingTs,
      adoptedIncoming: true,
    };
  }

  if (incomingTheme === effectiveLocalTheme) {
    return {
      theme: effectiveLocalTheme,
      themeUpdatedAt: Math.max(effectiveLocalTs, incomingTs),
      adoptedIncoming: false,
    };
  }

  if (hasExplicitLocalChoice) {
    // Only adopt incoming cloud theme if it is strictly newer than the local preference
    if (incomingTs > effectiveLocalTs) {
      return {
        theme: incomingTheme,
        themeUpdatedAt: incomingTs,
        adoptedIncoming: true,
      };
    }
    return {
      theme: effectiveLocalTheme,
      themeUpdatedAt: effectiveLocalTs,
      adoptedIncoming: false,
    };
  }

  // Fresh device with no explicit local preference yet: adopt incoming cloud theme
  return {
    theme: incomingTheme,
    themeUpdatedAt: incomingTs,
    adoptedIncoming: true,
  };
}

/**
 * Merges local and incoming AppSettings while always resolving `theme` and `themeUpdatedAt`
 * through `reconcileThemeSettings` so cloud/backup merges never clobber a newer local theme.
 */
export function mergeSettingsPreservingTheme(
  localSettings: AppSettings,
  incomingSettings?: Partial<AppSettings> | null,
  preferIncoming = false,
  storedLocalPref?: StoredThemePreference | null
): { settings: AppSettings; adoptedIncomingTheme: boolean } {
  const baseMerged: AppSettings = preferIncoming
    ? { ...localSettings, ...(incomingSettings || {}) }
    : { ...(incomingSettings || {}), ...localSettings };

  const reconciled = reconcileThemeSettings(localSettings, incomingSettings, storedLocalPref);

  return {
    settings: {
      ...baseMerged,
      theme: reconciled.theme,
      ...(reconciled.themeUpdatedAt > 0
        ? { themeUpdatedAt: reconciled.themeUpdatedAt }
        : baseMerged.themeUpdatedAt
        ? { themeUpdatedAt: baseMerged.themeUpdatedAt }
        : {}),
    },
    adoptedIncomingTheme: reconciled.adoptedIncoming,
  };
}



