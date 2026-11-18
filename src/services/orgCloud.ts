/**
 * Real-Time Multi-Device Cloud Organization Sync Service (Firestore + Offline Cache)
 * All Personal data stays in IndexedDB; Cloud Organizations stream live from /organizations/{orgId}.
 */
import {
  collection,
  doc,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  serverTimestamp,
  writeBatch,
  DocumentData,
  Timestamp,
} from 'firebase/firestore';
import {
  db,
  deleteOrgOnServer,
  deleteWorkspaceTransactionsCloud,
  removeOrgWorkspaceFromBackupMeta,
  ServerApiError,
} from './firebase';
import {
  AuditLogAction,
  AuditLogEntry,
  Budget,
  BusinessParty,
  Category,
  CostCenter,
  Organization,
  OrganizationMember,
  OrganizationRole,
  OrgRef,
  OrgWorkspaceData,
  Transaction,
  Wallet,
} from '../types';
import { convertCurrency, fromMinor, toMinor } from './currency';
import { getEffectiveTransactionAmount } from './calculations';
import { normalizeApprovalStatus } from './entitlements';
import {
  filterTransactionsByDateRange,
  isFirestoreMissingIndexError,
  sortTransactionsDescending,
} from './orgTransactionQuery';

export interface OrgActorInfo {
  uid: string;
  name: string;
}

export interface ActiveOrgCallbacks {
  onOrganization: (org: Organization | null) => void;
  onMembers: (members: OrganizationMember[]) => void;
  onWallets: (wallets: Wallet[]) => void;
  onCategories: (categories: Category[]) => void;
  onBudgets: (budgets: Budget[]) => void;
  onCostCenters: (costCenters: CostCenter[]) => void;
  onParties: (parties: BusinessParty[]) => void;
  onTransactions: (
    activeTransactions: Transaction[],
    trashTransactions: Transaction[],
    meta: { hasMore: boolean; lastCursor: QueryDocumentSnapshot<DocumentData> | null; hasPendingWrites: boolean }
  ) => void;
  onAuditLogs: (logs: AuditLogEntry[]) => void;
  onError?: (scope: string, error: Error) => void;
}

function stripUndefinedDeep<T>(value: T): T {
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

function toTimestampMs(val: unknown, fallback = Date.now()): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as Timestamp).toMillis === 'function') {
    return (val as Timestamp).toMillis();
  }
  return fallback;
}

function makeAuditDocPayload(
  orgId: string,
  action: AuditLogAction,
  entityType: AuditLogEntry['entityType'],
  entityId: string,
  actor: OrgActorInfo,
  summary: string,
  before?: unknown,
  after?: unknown
): { id: string; data: Record<string, unknown> } {
  const now = Date.now();
  const id = `log-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const payload: Record<string, unknown> = {
    id,
    orgId,
    action,
    entityType,
    entityId: entityId.slice(0, 128),
    actorUid: actor.uid,
    actorName: (actor.name || 'Team Member').trim().slice(0, 120) || 'Member',
    summary: (summary || action).trim().slice(0, 300) || action,
    timestamp: now,
    createdAt: serverTimestamp(),
  };
  if (before !== undefined) {
    payload.before = stripUndefinedDeep(before);
  }
  if (after !== undefined) {
    payload.after = stripUndefinedDeep(after);
  }
  return { id, data: payload };
}

function parseTransactionDoc(docData: Record<string, unknown>): Transaction | null {
  const rawPayload = docData.payload as Partial<Transaction> | undefined;
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const id = String(docData.id || rawPayload.id || '');
  if (!id) return null;
  const currency = String(rawPayload.currency || 'EGP');
  const amountMinor =
    typeof docData.amountMinor === 'number'
      ? docData.amountMinor
      : typeof rawPayload.amountMinor === 'number'
      ? rawPayload.amountMinor
      : toMinor(Number(rawPayload.amount || 0), currency);
  const amount =
    typeof rawPayload.amount === 'number' && Number.isFinite(rawPayload.amount)
      ? rawPayload.amount
      : fromMinor(amountMinor, currency);

  return {
    ...(rawPayload as Transaction),
    id,
    amount,
    amountMinor,
    date: String(docData.date || rawPayload.date || ''),
    submittedBy: (docData.submittedBy as string | undefined) ?? rawPayload.submittedBy,
    approvedBy: (docData.approvedBy as string | null | undefined) ?? rawPayload.approvedBy,
    approvalStatus: normalizeApprovalStatus(
      (docData.approvalStatus as Transaction['approvalStatus'] | undefined) ?? rawPayload.approvalStatus
    ),
    deletedAt: (docData.deletedAt as number | null | undefined) ?? rawPayload.deletedAt ?? null,
    updatedAt: toTimestampMs(docData.updatedAt, rawPayload.updatedAt || Date.now()),
  };
}

function parseWalletDoc(docData: Record<string, unknown>): Wallet | null {
  const rawPayload = docData.payload as Partial<Wallet> | undefined;
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const id = String(docData.id || rawPayload.id || '');
  if (!id) return null;
  const currency = String(rawPayload.currency || 'EGP');
  const balanceMinor =
    typeof docData.balanceMinor === 'number'
      ? docData.balanceMinor
      : typeof rawPayload.balanceMinor === 'number'
      ? rawPayload.balanceMinor
      : toMinor(Number(rawPayload.balance || 0), currency);
  return {
    ...(rawPayload as Wallet),
    id,
    balanceMinor,
    balance: fromMinor(balanceMinor, currency),
  };
}

function parseCategoryDoc(docData: Record<string, unknown>): Category | null {
  const rawPayload = docData.payload as Partial<Category> | undefined;
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const id = String(docData.id || rawPayload.id || '');
  if (!id) return null;
  return {
    ...(rawPayload as Category),
    id,
  };
}

function parseBudgetDoc(docData: Record<string, unknown>): Budget | null {
  const rawPayload = docData.payload as Partial<Budget> | undefined;
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const id = String(docData.id || rawPayload.id || '');
  if (!id) return null;
  return {
    ...(rawPayload as Budget),
    id,
    amount: Number(rawPayload.amount || 0),
    amountMinor:
      typeof docData.amountMinor === 'number'
        ? docData.amountMinor
        : rawPayload.amountMinor,
  };
}

function buildOrgTxPayloadForCloud(orgId: string, tx: Transaction): Record<string, unknown> {
  const currency = tx.currency || 'EGP';
  const amountMinor = toMinor(tx.amount, currency);
  const canonicalStatus = normalizeApprovalStatus(tx.approvalStatus) || 'approved';
  const cleanTx: Transaction = stripUndefinedDeep({
    ...tx,
    amountMinor,
    approvalStatus: canonicalStatus,
    deletedAt: tx.deletedAt ?? null,
    updatedAt: Date.now(),
  });
  return {
    id: tx.id,
    orgId,
    date: tx.date,
    amountMinor,
    submittedBy: tx.submittedBy || '',
    approvedBy: tx.approvedBy ?? null,
    approvalStatus: canonicalStatus,
    deletedAt: tx.deletedAt ?? null,
    payload: cleanTx,
    updatedAt: serverTimestamp(),
  };
}

function buildOrgWalletPayloadForCloud(orgId: string, wallet: Wallet): Record<string, unknown> {
  const balanceMinor =
    typeof wallet.balanceMinor === 'number'
      ? wallet.balanceMinor
      : toMinor(wallet.balance, wallet.currency);
  const initialBalanceMinor =
    typeof wallet.initialBalanceMinor === 'number'
      ? wallet.initialBalanceMinor
      : toMinor(wallet.initialBalance, wallet.currency);
  const cleanWallet: Wallet = stripUndefinedDeep({
    ...wallet,
    balanceMinor,
    initialBalanceMinor,
    balance: fromMinor(balanceMinor, wallet.currency),
  });
  return {
    id: wallet.id,
    orgId,
    balanceMinor,
    payload: cleanWallet,
    updatedAt: serverTimestamp(),
  };
}

function buildOrgCategoryPayloadForCloud(orgId: string, cat: Category): Record<string, unknown> {
  const cleanCat = stripUndefinedDeep({ ...cat });
  return {
    id: cat.id,
    orgId,
    payload: cleanCat,
    updatedAt: serverTimestamp(),
  };
}

function buildOrgBudgetPayloadForCloud(orgId: string, budget: Budget, orgCurrency: string): Record<string, unknown> {
  const amountMinor =
    typeof budget.amountMinor === 'number'
      ? budget.amountMinor
      : toMinor(budget.amount, orgCurrency);
  const cleanBudget = stripUndefinedDeep({
    ...budget,
    amountMinor,
  });
  return {
    id: budget.id,
    orgId,
    amountMinor,
    payload: cleanBudget,
    updatedAt: serverTimestamp(),
  };
}

/**
 * Subscribe to the signed-in user's server-maintained organization memberships (/users/{uid}/orgRefs)
 */
export function subscribeUserOrgRefs(
  uid: string,
  onChange: (refs: OrgRef[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'users', uid, 'orgRefs'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as OrgRef)
        .filter((r) => Boolean(r && r.orgId))
        .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      onChange(list);
    },
    (err) => {
      console.warn('orgRefs snapshot error:', err);
      onError?.(err as Error);
    }
  );
}

/**
 * Subscribe cleanly to ONLY the active organization and its subcollections.
 * Enforces RBAC on auditLogs (never attaches an auditLogs listener for employee/viewer roles).
 */
export function subscribeActiveOrganization(
  orgId: string,
  userRole: OrganizationRole,
  callbacks: ActiveOrgCallbacks,
  txPageSize = 200
): () => void {
  const unsubs: Array<() => void> = [];

  // 1. Organization document
  unsubs.push(
    onSnapshot(
      doc(db, 'organizations', orgId),
      (snap) => {
        if (!snap.exists()) {
          callbacks.onOrganization(null);
          return;
        }
        const d = snap.data() as Record<string, unknown>;
        const org: Organization = {
          id: String(d.id || snap.id),
          name: String(d.name || ''),
          currency: String(d.currency || 'EGP'),
          mainCurrency: String(d.currency || 'EGP'),
          industry: d.industry as Organization['industry'],
          vatRate: Number(d.vatRate ?? 14),
          taxNumber: typeof d.taxNumber === 'string' ? d.taxNumber : undefined,
          approvalThreshold: Number(d.approvalThreshold ?? 5000),
          lockedUntilDate: typeof d.lockedUntilDate === 'string' ? d.lockedUntilDate : undefined,
          ownerUid: String(d.ownerUid || ''),
          planTier: (d.planTier as Organization['planTier']) || 'business_pro',
          billingCycle: (d.billingCycle as Organization['billingCycle']) || 'trial',
          expiresAt: typeof d.expiresAt === 'number' ? d.expiresAt : null,
          seatLimit: typeof d.seatLimit === 'number' ? d.seatLimit : undefined,
          extraSeats: Number(d.extraSeats || 0),
          aiScansUsed: typeof d.aiScansUsed === 'number' ? d.aiScansUsed : 0,
          aiScansMonth: typeof d.aiScansMonth === 'string' ? d.aiScansMonth : undefined,
          createdAt: toTimestampMs(d.createdAt),
          updatedAt: toTimestampMs(d.updatedAt),
        };
        callbacks.onOrganization(org);
      },
      (err) => callbacks.onError?.('organization', err as Error)
    )
  );

  // 2. Members
  unsubs.push(
    onSnapshot(
      collection(db, 'organizations', orgId, 'members'),
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const m = d.data() as Record<string, unknown>;
            return {
              uid: String(m.uid || d.id),
              email: String(m.email || ''),
              displayName: String(m.displayName || m.email || 'Member'),
              role: (m.role as OrganizationRole) || 'employee',
              department: typeof m.department === 'string' ? m.department : undefined,
              spendingLimit:
                typeof m.spendingLimit === 'number' ? m.spendingLimit : undefined,
              spendingLimitMinor:
                typeof m.spendingLimitMinor === 'number' ? m.spendingLimitMinor : undefined,
              status: (m.status as OrganizationMember['status']) || 'active',
              joinedAt: Number(m.joinedAt || 0),
              updatedAt: toTimestampMs(m.updatedAt, Number(m.joinedAt || 0)),
            } as OrganizationMember;
          })
          .sort((a, b) => a.joinedAt - b.joinedAt);
        callbacks.onMembers(list);
      },
      (err) => callbacks.onError?.('members', err as Error)
    )
  );

  // 3. Wallets
  unsubs.push(
    onSnapshot(
      collection(db, 'organizations', orgId, 'wallets'),
      (snap) => {
        const list = snap.docs
          .map((d) => parseWalletDoc(d.data() as Record<string, unknown>))
          .filter((w): w is Wallet => w !== null)
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        callbacks.onWallets(list);
      },
      (err) => callbacks.onError?.('wallets', err as Error)
    )
  );

  // 4. Categories
  unsubs.push(
    onSnapshot(
      collection(db, 'organizations', orgId, 'categories'),
      (snap) => {
        const list = snap.docs
          .map((d) => parseCategoryDoc(d.data() as Record<string, unknown>))
          .filter((c): c is Category => c !== null)
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        callbacks.onCategories(list);
      },
      (err) => callbacks.onError?.('categories', err as Error)
    )
  );

  // 5. Budgets
  unsubs.push(
    onSnapshot(
      collection(db, 'organizations', orgId, 'budgets'),
      (snap) => {
        const list = snap.docs
          .map((d) => parseBudgetDoc(d.data() as Record<string, unknown>))
          .filter((b): b is Budget => b !== null);
        callbacks.onBudgets(list);
      },
      (err) => callbacks.onError?.('budgets', err as Error)
    )
  );

  // 6. Cost Centers
  unsubs.push(
    onSnapshot(
      collection(db, 'organizations', orgId, 'costCenters'),
      (snap) => {
        const list = snap.docs.map((d) => {
          const c = d.data() as Record<string, unknown>;
          return {
            id: String(c.id || d.id),
            orgId: String(c.orgId || orgId),
            code: String(c.code || ''),
            name: typeof c.name === 'string' ? c.name : String(c.nameAr || ''),
            nameAr: String(c.nameAr || c.name || ''),
            nameEn: String(c.nameEn || c.nameAr || ''),
            type: (c.type as CostCenter['type']) || 'department',
            budgetAllocated: Number(c.budgetAllocated || 0),
            budgetAllocatedMinor:
              typeof c.budgetAllocatedMinor === 'number' ? c.budgetAllocatedMinor : undefined,
            isActive: Boolean(c.isActive ?? true),
            createdAt: Number(c.createdAt || 0),
          } as CostCenter;
        });
        callbacks.onCostCenters(list);
      },
      (err) => callbacks.onError?.('costCenters', err as Error)
    )
  );

  // 7. Parties
  unsubs.push(
    onSnapshot(
      collection(db, 'organizations', orgId, 'parties'),
      (snap) => {
        const list = snap.docs.map((d) => {
          const p = d.data() as Record<string, unknown>;
          return {
            id: String(p.id || d.id),
            orgId: String(p.orgId || orgId),
            type: (p.type as BusinessParty['type']) || 'vendor',
            name: String(p.name || ''),
            phone: typeof p.phone === 'string' ? p.phone : undefined,
            email: typeof p.email === 'string' ? p.email : undefined,
            taxId: typeof p.taxId === 'string' ? p.taxId : undefined,
            creditLimit: typeof p.creditLimit === 'number' ? p.creditLimit : undefined,
            currency: String(p.currency || 'EGP'),
            balance: Number(p.balance || 0),
            balanceMinor: typeof p.balanceMinor === 'number' ? p.balanceMinor : undefined,
            dueDate: typeof p.dueDate === 'string' ? p.dueDate : undefined,
            notes: typeof p.notes === 'string' ? p.notes : undefined,
            createdAt: Number(p.createdAt || 0),
          } as BusinessParty;
        });
        callbacks.onParties(list);
      },
      (err) => callbacks.onError?.('parties', err as Error)
    )
  );

  // 8. Transactions — fetch all workspace transactions without hidden limit/orderBy truncation
  //    (Firestore orderBy('date') silently excludes docs missing top-level `date`, and missing index fails queries)
  try {
    const txCollectionRef = collection(db, 'organizations', orgId, 'transactions');
    unsubs.push(
      onSnapshot(
        txCollectionRef,
        { includeMetadataChanges: true },
        (snap) => {
          const active: Transaction[] = [];
          const trash: Transaction[] = [];
          for (const d of snap.docs) {
            const parsed = parseTransactionDoc(d.data() as Record<string, unknown>);
            if (!parsed) continue;
            if (parsed.deletedAt) {
              trash.push(parsed);
            } else {
              active.push(parsed);
            }
          }
          const sortedActive = sortTransactionsDescending(active);
          const sortedTrash = sortTransactionsDescending(trash);
          const lastCursor = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
          callbacks.onTransactions(sortedActive, sortedTrash, {
            hasMore: false,
            lastCursor,
            hasPendingWrites: snap.metadata.hasPendingWrites,
          });
        },
        (err) => {
          if (isFirestoreMissingIndexError(err)) {
            console.error(
              '[Firestore Missing Index Error] Organizations transactions query requires an index:',
              err
            );
          } else {
            console.error('[Firestore Transactions Query Error] Failed to fetch transactions:', err);
          }
          callbacks.onError?.('transactions', err as Error);
        }
      )
    );
  } catch (err) {
    if (isFirestoreMissingIndexError(err)) {
      console.error(
        '[Firestore Missing Index Error] Organizations transactions query setup failed:',
        err
      );
    } else {
      console.error('[Firestore Transactions Query Error] Query setup exception:', err);
    }
    callbacks.onError?.('transactions', err as Error);
  }

  // 9. Audit logs — ONLY for owner/admin/accountant (firestore.rules rejects employee/viewer)
  if (userRole === 'owner' || userRole === 'admin' || userRole === 'accountant') {
    const auditQuery = query(
      collection(db, 'organizations', orgId, 'auditLogs'),
      orderBy('timestamp', 'desc'),
      limit(100)
    );
    unsubs.push(
      onSnapshot(
        auditQuery,
        (snap) => {
          const logs = snap.docs.map((d) => {
            const a = d.data() as Record<string, unknown>;
            return {
              id: String(a.id || d.id),
              orgId: String(a.orgId || orgId),
              action: a.action as AuditLogAction,
              entityType: a.entityType as AuditLogEntry['entityType'],
              entityId: String(a.entityId || ''),
              actorUid: String(a.actorUid || ''),
              actorName: String(a.actorName || ''),
              summary: String(a.summary || ''),
              before: a.before,
              after: a.after,
              timestamp: Number(a.timestamp || 0),
            } as AuditLogEntry;
          });
          callbacks.onAuditLogs(logs);
        },
        (err) => callbacks.onError?.('auditLogs', err as Error)
      )
    );
  } else {
    callbacks.onAuditLogs([]);
  }

  return () => {
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch {
        // ignore cleanup errors
      }
    }
  };
}

export async function forceFetchOrgTransactionsFromServer(orgId: string): Promise<{
  active: Transaction[];
  trash: Transaction[];
}> {
  try {
    // Force direct Cloud Firestore fetch (ignoring local cache, no orderBy/limit)
    const snap = await getDocsFromServer(collection(db, 'organizations', orgId, 'transactions'));
    const active: Transaction[] = [];
    const trash: Transaction[] = [];
    for (const d of snap.docs) {
      const parsed = parseTransactionDoc(d.data() as Record<string, unknown>);
      if (!parsed) continue;
      if (parsed.deletedAt) trash.push(parsed);
      else active.push(parsed);
    }
    return {
      active: sortTransactionsDescending(active),
      trash: sortTransactionsDescending(trash),
    };
  } catch (err) {
    console.error('[Force Cloud Fetch Error] forceFetchOrgTransactionsFromServer failed:', err);
    throw err;
  }
}

export async function loadMoreOrgTransactions(
  orgId: string,
  _cursor: QueryDocumentSnapshot<DocumentData>,
  _pageSize = 200
): Promise<{
  active: Transaction[];
  trash: Transaction[];
  hasMore: boolean;
  lastCursor: QueryDocumentSnapshot<DocumentData> | null;
}> {
  try {
    // Query without orderBy/limit to guarantee zero missing-index failures or omitted records
    let snap;
    try {
      snap = await getDocsFromServer(collection(db, 'organizations', orgId, 'transactions'));
    } catch {
      snap = await getDocs(collection(db, 'organizations', orgId, 'transactions'));
    }
    const active: Transaction[] = [];
    const trash: Transaction[] = [];
    for (const d of snap.docs) {
      const parsed = parseTransactionDoc(d.data() as Record<string, unknown>);
      if (!parsed) continue;
      if (parsed.deletedAt) trash.push(parsed);
      else active.push(parsed);
    }
    return {
      active: sortTransactionsDescending(active),
      trash: sortTransactionsDescending(trash),
      hasMore: false,
      lastCursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
    };
  } catch (err) {
    console.error('[Firestore Query Error] loadMoreOrgTransactions failed:', err);
    throw err;
  }
}

export async function fetchOrgTransactionsInRange(
  orgId: string,
  startDate: string,
  endDate: string
): Promise<Transaction[]> {
  try {
    // Fetch un-ordered collection from server (offline fallback to cache) and filter/sort client-side
    let snap;
    try {
      snap = await getDocsFromServer(collection(db, 'organizations', orgId, 'transactions'));
    } catch {
      snap = await getDocs(collection(db, 'organizations', orgId, 'transactions'));
    }
    const allActive: Transaction[] = [];
    for (const d of snap.docs) {
      const parsed = parseTransactionDoc(d.data() as Record<string, unknown>);
      if (parsed && !parsed.deletedAt) allActive.push(parsed);
    }
    return filterTransactionsByDateRange(allActive, startDate, endDate);
  } catch (err) {
    console.error('[Firestore Query Error] fetchOrgTransactionsInRange failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Atomic WriteBatch Helpers (Strict alignment with firestore.rules)
// ---------------------------------------------------------------------------
function computeWalletBalanceDeltas(
  tx: Transaction,
  wallets: Wallet[],
  customRates: Record<string, number>,
  direction: 1 | -1
): Map<string, number> {
  const deltas = new Map<string, number>();
  const status = normalizeApprovalStatus(tx.approvalStatus);
  const countsTowardBalance =
    !tx.doesNotAffectBalance &&
    !tx.deletedAt &&
    (!status || status === 'approved' || status === 'paid');
  if (!countsTowardBalance) return deltas;

  const effectiveAmount = getEffectiveTransactionAmount(tx);
  const sourceWallet = wallets.find((w) => w.id === tx.walletId);
  if (sourceWallet) {
    const converted = convertCurrency(
      effectiveAmount,
      tx.currency,
      sourceWallet.currency,
      customRates
    );
    const feeConverted =
      tx.type === 'transfer' && tx.transferFee
        ? convertCurrency(tx.transferFee, tx.currency, sourceWallet.currency, customRates)
        : 0;
    const rawDelta =
      tx.type === 'income'
        ? converted
        : tx.type === 'expense'
        ? -converted
        : -(converted + feeConverted);
    const deltaMinor = toMinor(rawDelta, sourceWallet.currency) * direction;
    deltas.set(sourceWallet.id, (deltas.get(sourceWallet.id) || 0) + deltaMinor);
  }

  if (tx.type === 'transfer' && tx.toWalletId) {
    const destWallet = wallets.find((w) => w.id === tx.toWalletId);
    if (destWallet) {
      const convertedDest =
        tx.convertedAmount !== undefined
          ? tx.convertedAmount
          : convertCurrency(effectiveAmount, tx.currency, destWallet.currency, customRates);
      const destDeltaMinor = toMinor(convertedDest, destWallet.currency) * direction;
      deltas.set(destWallet.id, (deltas.get(destWallet.id) || 0) + destDeltaMinor);
    }
  }

  return deltas;
}

function applyWalletDeltasToBatch(
  batch: ReturnType<typeof writeBatch>,
  orgId: string,
  wallets: Wallet[],
  deltas: Map<string, number>
): void {
  for (const [walletId, deltaMinor] of deltas.entries()) {
    if (deltaMinor === 0) continue;
    const w = wallets.find((item) => item.id === walletId);
    if (!w) continue;
    const currentMinor =
      typeof w.balanceMinor === 'number' ? w.balanceMinor : toMinor(w.balance, w.currency);
    const nextMinor = currentMinor + deltaMinor;
    const nextWallet: Wallet = stripUndefinedDeep({
      ...w,
      balanceMinor: nextMinor,
      balance: fromMinor(nextMinor, w.currency),
    });
    batch.update(doc(db, 'organizations', orgId, 'wallets', walletId), {
      balanceMinor: nextMinor,
      payload: nextWallet,
      updatedAt: serverTimestamp(),
    });
  }
}

export async function createOrgTransactionCloud(
  orgId: string,
  tx: Transaction,
  wallets: Wallet[],
  customRates: Record<string, number>,
  actor: OrgActorInfo,
  auditSummary?: string
): Promise<void> {
  const batch = writeBatch(db);
  const txDoc = buildOrgTxPayloadForCloud(orgId, {
    ...tx,
    submittedBy: tx.submittedBy || actor.uid,
    submittedByName: tx.submittedByName || actor.name,
  });
  batch.set(doc(db, 'organizations', orgId, 'transactions', tx.id), txDoc);

  const deltas = computeWalletBalanceDeltas(tx, wallets, customRates, 1);
  applyWalletDeltasToBatch(batch, orgId, wallets, deltas);

  const audit = makeAuditDocPayload(
    orgId,
    'create',
    'transaction',
    tx.id,
    actor,
    auditSummary || `إضافة معاملة (${tx.type}): ${tx.amount} ${tx.currency}`,
    undefined,
    { amount: tx.amount, currency: tx.currency, approvalStatus: tx.approvalStatus }
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);

  await batch.commit();
}

export async function updateOrgTransactionCloud(
  orgId: string,
  oldTx: Transaction,
  newTx: Transaction,
  wallets: Wallet[],
  customRates: Record<string, number>,
  actor: OrgActorInfo,
  auditSummary?: string
): Promise<void> {
  const batch = writeBatch(db);
  const cloudDoc = buildOrgTxPayloadForCloud(orgId, newTx);

  // Only update allowed keys on transactions/{txId}
  batch.update(doc(db, 'organizations', orgId, 'transactions', newTx.id), {
    date: cloudDoc.date,
    amountMinor: cloudDoc.amountMinor,
    approvedBy: cloudDoc.approvedBy,
    approvalStatus: cloudDoc.approvalStatus,
    deletedAt: cloudDoc.deletedAt,
    payload: cloudDoc.payload,
    updatedAt: serverTimestamp(),
  });

  // Reverse old balance effect, apply new balance effect
  const combined = computeWalletBalanceDeltas(oldTx, wallets, customRates, -1);
  const nextDeltas = computeWalletBalanceDeltas(newTx, wallets, customRates, 1);
  for (const [wId, d] of nextDeltas.entries()) {
    combined.set(wId, (combined.get(wId) || 0) + d);
  }
  applyWalletDeltasToBatch(batch, orgId, wallets, combined);

  const audit = makeAuditDocPayload(
    orgId,
    'update',
    'transaction',
    newTx.id,
    actor,
    auditSummary || `تعديل معاملة: ${newTx.amount} ${newTx.currency}`,
    { amount: oldTx.amount, date: oldTx.date, approvalStatus: oldTx.approvalStatus },
    { amount: newTx.amount, date: newTx.date, approvalStatus: newTx.approvalStatus }
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);

  await batch.commit();
}

export async function approveOrRejectOrMarkPaidOrgTxCloud(
  orgId: string,
  oldTx: Transaction,
  nextStatus: 'approved' | 'rejected' | 'paid',
  wallets: Wallet[],
  customRates: Record<string, number>,
  actor: OrgActorInfo,
  rejectionReason?: string
): Promise<void> {
  const nextTx: Transaction = {
    ...oldTx,
    approvalStatus: nextStatus,
    approvedBy: actor.uid,
    reviewedBy: actor.name,
    reviewedAt: Date.now(),
    rejectionReason: nextStatus === 'rejected' ? rejectionReason : undefined,
    updatedAt: Date.now(),
  };

  const batch = writeBatch(db);
  const cloudDoc = buildOrgTxPayloadForCloud(orgId, nextTx);
  batch.update(doc(db, 'organizations', orgId, 'transactions', oldTx.id), {
    date: cloudDoc.date,
    amountMinor: cloudDoc.amountMinor,
    approvedBy: actor.uid,
    approvalStatus: nextStatus,
    deletedAt: cloudDoc.deletedAt,
    payload: cloudDoc.payload,
    updatedAt: serverTimestamp(),
  });

  const combined = computeWalletBalanceDeltas(oldTx, wallets, customRates, -1);
  const nextDeltas = computeWalletBalanceDeltas(nextTx, wallets, customRates, 1);
  for (const [wId, d] of nextDeltas.entries()) {
    combined.set(wId, (combined.get(wId) || 0) + d);
  }
  applyWalletDeltasToBatch(batch, orgId, wallets, combined);

  const auditAction: AuditLogAction =
    nextStatus === 'rejected' ? 'reject' : 'approve';
  const summary =
    nextStatus === 'approved'
      ? `اعتماد معاملة بمبلغ ${oldTx.amount} ${oldTx.currency}`
      : nextStatus === 'paid'
      ? `تأكيد صرف / سداد معاملة بمبلغ ${oldTx.amount} ${oldTx.currency}`
      : `رفض معاملة بمبلغ ${oldTx.amount} ${oldTx.currency}${rejectionReason ? `: ${rejectionReason}` : ''}`;

  const audit = makeAuditDocPayload(orgId, auditAction, 'transaction', oldTx.id, actor, summary);
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);

  await batch.commit();
}

export async function softDeleteOrgTransactionCloud(
  orgId: string,
  oldTx: Transaction,
  wallets: Wallet[],
  customRates: Record<string, number>,
  actor: OrgActorInfo
): Promise<void> {
  const deletedAt = Date.now();
  const deletedTx: Transaction = {
    ...oldTx,
    deletedAt,
    updatedAt: deletedAt,
  };
  const cloudDoc = buildOrgTxPayloadForCloud(orgId, deletedTx);

  const batch = writeBatch(db);
  batch.update(doc(db, 'organizations', orgId, 'transactions', oldTx.id), {
    deletedAt,
    payload: cloudDoc.payload,
    updatedAt: serverTimestamp(),
  });

  const reverseDeltas = computeWalletBalanceDeltas(oldTx, wallets, customRates, -1);
  applyWalletDeltasToBatch(batch, orgId, wallets, reverseDeltas);

  const audit = makeAuditDocPayload(
    orgId,
    'delete',
    'transaction',
    oldTx.id,
    actor,
    `نقل معاملة إلى سلة المحذوفات: ${oldTx.amount} ${oldTx.currency}`
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);

  await batch.commit();
}

export async function restoreOrgTransactionCloud(
  orgId: string,
  trashedTx: Transaction,
  wallets: Wallet[],
  customRates: Record<string, number>,
  actor: OrgActorInfo
): Promise<void> {
  const restoredTx: Transaction = {
    ...trashedTx,
    deletedAt: null,
    updatedAt: Date.now(),
  };
  const cloudDoc = buildOrgTxPayloadForCloud(orgId, restoredTx);

  const batch = writeBatch(db);
  batch.update(doc(db, 'organizations', orgId, 'transactions', trashedTx.id), {
    deletedAt: null,
    payload: cloudDoc.payload,
    updatedAt: serverTimestamp(),
  });

  const applyDeltas = computeWalletBalanceDeltas(restoredTx, wallets, customRates, 1);
  applyWalletDeltasToBatch(batch, orgId, wallets, applyDeltas);

  const audit = makeAuditDocPayload(
    orgId,
    'restore',
    'transaction',
    trashedTx.id,
    actor,
    `استعادة معاملة من سلة المحذوفات: ${trashedTx.amount} ${trashedTx.currency}`
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);

  await batch.commit();
}

export async function updateOrgTxAttachmentPathsCloud(
  orgId: string,
  tx: Transaction,
  attachmentPaths: string[]
): Promise<void> {
  const nextTx: Transaction = {
    ...tx,
    attachmentPaths,
    updatedAt: Date.now(),
  };
  const cloudDoc = buildOrgTxPayloadForCloud(orgId, nextTx);
  const batch = writeBatch(db);
  batch.update(doc(db, 'organizations', orgId, 'transactions', tx.id), {
    payload: cloudDoc.payload,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

async function commitChunkedOperations(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  maxOpsPerBatch = 380
): Promise<void> {
  if (ops.length === 0) return;
  const chunkSize = Math.max(1, Math.min(450, maxOpsPerBatch));
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = writeBatch(db);
    const slice = ops.slice(i, i + chunkSize);
    for (const op of slice) {
      op(batch);
    }
    await batch.commit();
  }
}

export async function moveOrgTransactionsCloud(
  orgId: string,
  txsToMove: Transaction[],
  fromWalletId: string,
  toWalletId: string,
  wallets: Wallet[],
  customRates: Record<string, number>,
  actor: OrgActorInfo
): Promise<void> {
  if (txsToMove.length === 0) return;

  const totalDeltas = new Map<string, number>();
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  for (const oldTx of txsToMove) {
    const newTx: Transaction = {
      ...oldTx,
      walletId: oldTx.walletId === fromWalletId ? toWalletId : oldTx.walletId,
      toWalletId: oldTx.toWalletId === fromWalletId ? toWalletId : oldTx.toWalletId,
      updatedAt: Date.now(),
    };
    const cloudDoc = buildOrgTxPayloadForCloud(orgId, newTx);
    ops.push((batch) => {
      batch.update(doc(db, 'organizations', orgId, 'transactions', oldTx.id), {
        payload: cloudDoc.payload,
        updatedAt: serverTimestamp(),
      });
    });
    const rev = computeWalletBalanceDeltas(oldTx, wallets, customRates, -1);
    const add = computeWalletBalanceDeltas(newTx, wallets, customRates, 1);
    for (const [k, v] of rev.entries()) totalDeltas.set(k, (totalDeltas.get(k) || 0) + v);
    for (const [k, v] of add.entries()) totalDeltas.set(k, (totalDeltas.get(k) || 0) + v);
  }

  for (const [walletId, deltaMinor] of totalDeltas.entries()) {
    if (deltaMinor === 0) continue;
    const w = wallets.find((item) => item.id === walletId);
    if (!w) continue;
    const currentMinor =
      typeof w.balanceMinor === 'number' ? w.balanceMinor : toMinor(w.balance, w.currency);
    const nextMinor = currentMinor + deltaMinor;
    const nextWallet: Wallet = stripUndefinedDeep({
      ...w,
      balanceMinor: nextMinor,
      balance: fromMinor(nextMinor, w.currency),
    });
    ops.push((batch) => {
      batch.update(doc(db, 'organizations', orgId, 'wallets', walletId), {
        balanceMinor: nextMinor,
        payload: nextWallet,
        updatedAt: serverTimestamp(),
      });
    });
  }

  const audit = makeAuditDocPayload(
    orgId,
    'update',
    'wallet',
    fromWalletId,
    actor,
    `نقل ${txsToMove.length} معاملة من المحفظة ${fromWalletId} إلى ${toWalletId}`
  );
  ops.push((batch) => {
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  });
  await commitChunkedOperations(ops, 380);
}

export async function batchUpdateOrgTransactionsCategoryCloud(
  orgId: string,
  txsToMove: Transaction[],
  targetCategoryId: string,
  actor: OrgActorInfo
): Promise<void> {
  if (txsToMove.length === 0) return;
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  for (const tx of txsToMove) {
    const nextTx: Transaction = { ...tx, categoryId: targetCategoryId, updatedAt: Date.now() };
    const cloudDoc = buildOrgTxPayloadForCloud(orgId, nextTx);
    ops.push((batch) => {
      batch.update(doc(db, 'organizations', orgId, 'transactions', tx.id), {
        payload: cloudDoc.payload,
        updatedAt: serverTimestamp(),
      });
    });
  }
  const audit = makeAuditDocPayload(
    orgId,
    'update',
    'category',
    targetCategoryId,
    actor,
    `ترحيل تصنيف ${txsToMove.length} معاملة`
  );
  ops.push((batch) => {
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  });
  await commitChunkedOperations(ops, 380);
}

export async function importOrgTransactionsBatchCloud(
  orgId: string,
  newTransactions: Transaction[],
  wallets: Wallet[],
  customRates: Record<string, number>,
  actor: OrgActorInfo
): Promise<void> {
  if (newTransactions.length === 0) return;
  const CHUNK_SIZE = 320;
  const totalDeltas = new Map<string, number>();

  for (let i = 0; i < newTransactions.length; i += CHUNK_SIZE) {
    const slice = newTransactions.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const tx of slice) {
      const cloudDoc = buildOrgTxPayloadForCloud(orgId, {
        ...tx,
        submittedBy: tx.submittedBy || actor.uid,
        submittedByName: tx.submittedByName || actor.name,
      });
      batch.set(doc(db, 'organizations', orgId, 'transactions', tx.id), cloudDoc);
      const deltas = computeWalletBalanceDeltas(tx, wallets, customRates, 1);
      for (const [k, v] of deltas.entries()) totalDeltas.set(k, (totalDeltas.get(k) || 0) + v);
    }
    if (i === 0) {
      const audit = makeAuditDocPayload(
        orgId,
        'create',
        'transaction',
        slice[0].id,
        actor,
        `استيراد دفعة معاملات (${newTransactions.length})`
      );
      batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
    }
    await batch.commit();
  }

  if (totalDeltas.size > 0) {
    const walletBatch = writeBatch(db);
    applyWalletDeltasToBatch(walletBatch, orgId, wallets, totalDeltas);
    await walletBatch.commit();
  }
}

export async function recalculateOrgBalancesFromApproved(
  orgId: string,
  wallets: Wallet[],
  transactions: Transaction[],
  customRates: Record<string, number>,
  actor: OrgActorInfo
): Promise<void> {
  const walletMinorTotals = new Map<string, number>();
  for (const w of wallets) {
    const initMinor =
      typeof w.initialBalanceMinor === 'number'
        ? w.initialBalanceMinor
        : toMinor(w.initialBalance, w.currency);
    walletMinorTotals.set(w.id, initMinor);
  }

  for (const tx of transactions) {
    const deltas = computeWalletBalanceDeltas(tx, wallets, customRates, 1);
    for (const [wId, d] of deltas.entries()) {
      walletMinorTotals.set(wId, (walletMinorTotals.get(wId) || 0) + d);
    }
  }

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  for (const w of wallets) {
    const nextMinor = walletMinorTotals.get(w.id) ?? 0;
    const updatedWallet: Wallet = stripUndefinedDeep({
      ...w,
      balanceMinor: nextMinor,
      balance: fromMinor(nextMinor, w.currency),
    });
    ops.push((batch) => {
      batch.update(doc(db, 'organizations', orgId, 'wallets', w.id), {
        balanceMinor: nextMinor,
        payload: updatedWallet,
        updatedAt: serverTimestamp(),
      });
    });
  }

  const audit = makeAuditDocPayload(
    orgId,
    'recalculate',
    'organization',
    orgId,
    actor,
    'إعادة احتساب أرصدة جميع المحافظ من المعاملات المعتمدة'
  );
  ops.push((batch) => {
    batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  });
  await commitChunkedOperations(ops, 380);
}

// ---------------------------------------------------------------------------
// Wallets, Categories, Budgets, Cost Centers, Parties, Settings CRUD
// ---------------------------------------------------------------------------
export async function upsertOrgWalletCloud(
  orgId: string,
  wallet: Wallet,
  isNew: boolean,
  actor: OrgActorInfo
): Promise<void> {
  const batch = writeBatch(db);
  const cloudDoc = buildOrgWalletPayloadForCloud(orgId, wallet);
  const ref = doc(db, 'organizations', orgId, 'wallets', wallet.id);
  if (isNew) {
    batch.set(ref, cloudDoc);
  } else {
    batch.update(ref, {
      balanceMinor: cloudDoc.balanceMinor,
      payload: cloudDoc.payload,
      updatedAt: serverTimestamp(),
    });
  }
  const audit = makeAuditDocPayload(
    orgId,
    isNew ? 'create' : 'update',
    'wallet',
    wallet.id,
    actor,
    isNew ? `إنشاء خزينة/عهدة: ${wallet.name}` : `تحديث خزينة/عهدة: ${wallet.name}`
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

export async function deleteOrgWalletCloud(
  orgId: string,
  walletId: string,
  actor: OrgActorInfo,
  txsToMigrate?: Transaction[],
  migrateToWalletId?: string,
  wallets?: Wallet[],
  customRates?: Record<string, number>
): Promise<void> {
  if (txsToMigrate && txsToMigrate.length > 0 && migrateToWalletId && wallets && customRates) {
    await moveOrgTransactionsCloud(orgId, txsToMigrate, walletId, migrateToWalletId, wallets, customRates, actor);
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, 'organizations', orgId, 'wallets', walletId));
  const audit = makeAuditDocPayload(
    orgId,
    'delete',
    'wallet',
    walletId,
    actor,
    `حذف الخزينة / المحفظة (${walletId})`
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

export async function upsertOrgCategoryCloud(
  orgId: string,
  category: Category,
  isNew: boolean,
  actor: OrgActorInfo
): Promise<void> {
  const batch = writeBatch(db);
  const cloudDoc = buildOrgCategoryPayloadForCloud(orgId, category);
  const ref = doc(db, 'organizations', orgId, 'categories', category.id);
  if (isNew) {
    batch.set(ref, cloudDoc);
  } else {
    batch.update(ref, {
      payload: cloudDoc.payload,
      updatedAt: serverTimestamp(),
    });
  }
  const audit = makeAuditDocPayload(
    orgId,
    isNew ? 'create' : 'update',
    'category',
    category.id,
    actor,
    isNew ? `إنشاء تصنيف: ${category.nameAr}` : `تحديث تصنيف: ${category.nameAr}`
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

export async function deleteOrgCategoryCloud(
  orgId: string,
  categoryId: string,
  actor: OrgActorInfo,
  txsToMigrate?: Transaction[],
  migrateToCategoryId?: string
): Promise<void> {
  if (txsToMigrate && txsToMigrate.length > 0 && migrateToCategoryId) {
    await batchUpdateOrgTransactionsCategoryCloud(orgId, txsToMigrate, migrateToCategoryId, actor);
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, 'organizations', orgId, 'categories', categoryId));
  const audit = makeAuditDocPayload(
    orgId,
    'delete',
    'category',
    categoryId,
    actor,
    `حذف تصنيف (${categoryId})`
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

export async function upsertOrgBudgetCloud(
  orgId: string,
  budget: Budget,
  orgCurrency: string,
  isNew: boolean,
  actor: OrgActorInfo
): Promise<void> {
  const batch = writeBatch(db);
  const cloudDoc = buildOrgBudgetPayloadForCloud(orgId, budget, orgCurrency);
  const ref = doc(db, 'organizations', orgId, 'budgets', budget.id);
  if (isNew) {
    batch.set(ref, cloudDoc);
  } else {
    batch.update(ref, {
      amountMinor: cloudDoc.amountMinor,
      payload: cloudDoc.payload,
      updatedAt: serverTimestamp(),
    });
  }
  const audit = makeAuditDocPayload(
    orgId,
    isNew ? 'create' : 'update',
    'budget',
    budget.id,
    actor,
    isNew ? `إنشاء ميزانية: ${budget.name}` : `تحديث ميزانية: ${budget.name}`
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

export async function deleteOrgBudgetCloud(
  orgId: string,
  budgetId: string,
  actor: OrgActorInfo
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'organizations', orgId, 'budgets', budgetId));
  const audit = makeAuditDocPayload(orgId, 'delete', 'budget', budgetId, actor, `حذف ميزانية (${budgetId})`);
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

export async function upsertOrgCostCenterCloud(
  orgId: string,
  cc: CostCenter,
  orgCurrency: string,
  isNew: boolean,
  actor: OrgActorInfo
): Promise<void> {
  const batch = writeBatch(db);
  const ref = doc(db, 'organizations', orgId, 'costCenters', cc.id);
  const budgetAllocatedMinor = toMinor(cc.budgetAllocated, orgCurrency);
  if (isNew) {
    batch.set(
      ref,
      stripUndefinedDeep({
        id: cc.id,
        orgId,
        code: cc.code.slice(0, 32),
        name: (cc.name || cc.nameAr).slice(0, 120),
        nameAr: cc.nameAr.slice(0, 120),
        nameEn: (cc.nameEn || cc.nameAr).slice(0, 120),
        type: cc.type || 'department',
        budgetAllocated: cc.budgetAllocated,
        budgetAllocatedMinor,
        isActive: Boolean(cc.isActive),
        createdAt: cc.createdAt || Date.now(),
        updatedAt: serverTimestamp(),
      })
    );
  } else {
    batch.update(
      ref,
      stripUndefinedDeep({
        code: cc.code.slice(0, 32),
        name: (cc.name || cc.nameAr).slice(0, 120),
        nameAr: cc.nameAr.slice(0, 120),
        nameEn: (cc.nameEn || cc.nameAr).slice(0, 120),
        type: cc.type || 'department',
        budgetAllocated: cc.budgetAllocated,
        budgetAllocatedMinor,
        isActive: Boolean(cc.isActive),
        updatedAt: serverTimestamp(),
      })
    );
  }
  const audit = makeAuditDocPayload(
    orgId,
    isNew ? 'create' : 'update',
    'cost_center',
    cc.id,
    actor,
    isNew ? `إضافة مركز تكلفة: ${cc.nameAr}` : `تحديث مركز تكلفة: ${cc.nameAr}`
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

export async function deleteOrgCostCenterCloud(
  orgId: string,
  ccId: string,
  actor: OrgActorInfo
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'organizations', orgId, 'costCenters', ccId));
  const audit = makeAuditDocPayload(orgId, 'delete', 'cost_center', ccId, actor, `حذف مركز تكلفة (${ccId})`);
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

export async function upsertOrgPartyCloud(
  orgId: string,
  party: BusinessParty,
  isNew: boolean,
  actor: OrgActorInfo
): Promise<void> {
  const batch = writeBatch(db);
  const ref = doc(db, 'organizations', orgId, 'parties', party.id);
  const balanceMinor = toMinor(party.balance, party.currency);
  const sharedFields: Record<string, unknown> = {
    type: party.type,
    name: party.name.slice(0, 120),
    currency: party.currency.slice(0, 8),
    balance: party.balance,
    balanceMinor,
    updatedAt: serverTimestamp(),
  };
  if (party.phone) sharedFields.phone = party.phone.slice(0, 40);
  if (party.email) sharedFields.email = party.email.slice(0, 254);
  if (party.taxId) sharedFields.taxId = party.taxId.slice(0, 64);
  if (typeof party.creditLimit === 'number') sharedFields.creditLimit = party.creditLimit;
  if (party.dueDate) sharedFields.dueDate = party.dueDate.slice(0, 16);
  if (party.notes) sharedFields.notes = party.notes.slice(0, 400);

  if (isNew) {
    batch.set(ref, {
      id: party.id,
      orgId,
      createdAt: party.createdAt || Date.now(),
      ...sharedFields,
    });
  } else {
    batch.update(ref, sharedFields);
  }
  const audit = makeAuditDocPayload(
    orgId,
    isNew ? 'create' : 'update',
    'party',
    party.id,
    actor,
    isNew ? `إضافة طرف تعامل (${party.type}): ${party.name}` : `تحديث طرف تعامل: ${party.name}`
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

export async function deleteOrgPartyCloud(
  orgId: string,
  partyId: string,
  actor: OrgActorInfo
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'organizations', orgId, 'parties', partyId));
  const audit = makeAuditDocPayload(orgId, 'delete', 'party', partyId, actor, `حذف طرف تعامل (${partyId})`);
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

export async function updateOrgSettingsCloud(
  orgId: string,
  currentOrg: Organization,
  updates: Partial<
    Pick<Organization, 'name' | 'currency' | 'industry' | 'vatRate' | 'taxNumber' | 'approvalThreshold' | 'lockedUntilDate'>
  >,
  actor: OrgActorInfo,
  summary?: string
): Promise<void> {
  const batch = writeBatch(db);
  const payload: Record<string, unknown> = {
    name: (updates.name ?? currentOrg.name).slice(0, 120),
    currency: (updates.currency ?? currentOrg.currency).slice(0, 8),
    vatRate: updates.vatRate ?? currentOrg.vatRate,
    approvalThreshold: updates.approvalThreshold ?? currentOrg.approvalThreshold,
    updatedAt: serverTimestamp(),
  };
  const nextIndustry = updates.industry ?? currentOrg.industry;
  if (nextIndustry) payload.industry = nextIndustry;

  if ('taxNumber' in updates) {
    payload.taxNumber = updates.taxNumber ? updates.taxNumber.slice(0, 64) : null;
  }
  if ('lockedUntilDate' in updates) {
    payload.lockedUntilDate = updates.lockedUntilDate ? updates.lockedUntilDate.slice(0, 16) : null;
  }

  batch.update(doc(db, 'organizations', orgId), payload);

  const action: AuditLogAction = 'lockedUntilDate' in updates ? 'lock_period' : 'update';
  const audit = makeAuditDocPayload(
    orgId,
    action,
    'organization',
    orgId,
    actor,
    summary ||
      (action === 'lock_period'
        ? updates.lockedUntilDate
          ? `إقفال الفترة المحاسبية حتى ${updates.lockedUntilDate}`
          : 'فك إقفال الفترة المحاسبية'
        : 'تحديث إعدادات وضريبة المؤسسة')
  );
  batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
  await batch.commit();
}

/**
 * Migrates an entire legacy IndexedDB/JSON OrgWorkspaceData into Firestore subcollections
 * in <= 400-operation WriteBatches after the org document has been created via /api/org/create.
 */
export async function migrateLegacyOrgToCloud(
  cloudOrgId: string,
  legacyWorkspace: OrgWorkspaceData,
  actor: OrgActorInfo,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  const orgCurrency = legacyWorkspace.organization.currency || 'EGP';
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  for (const w of legacyWorkspace.wallets || []) {
    const cloudDoc = buildOrgWalletPayloadForCloud(cloudOrgId, w);
    ops.push((batch) => batch.set(doc(db, 'organizations', cloudOrgId, 'wallets', w.id), cloudDoc));
  }
  for (const c of legacyWorkspace.categories || []) {
    const cloudDoc = buildOrgCategoryPayloadForCloud(cloudOrgId, c);
    ops.push((batch) => batch.set(doc(db, 'organizations', cloudOrgId, 'categories', c.id), cloudDoc));
  }
  for (const cc of legacyWorkspace.costCenters || []) {
    const budgetAllocatedMinor = toMinor(cc.budgetAllocated || 0, orgCurrency);
    ops.push((batch) =>
      batch.set(
        doc(db, 'organizations', cloudOrgId, 'costCenters', cc.id),
        stripUndefinedDeep({
          id: cc.id,
          orgId: cloudOrgId,
          code: (cc.code || 'CC').slice(0, 32),
          name: (cc.name || cc.nameAr || cc.code).slice(0, 120),
          nameAr: (cc.nameAr || cc.name || 'مركز تكلفة').slice(0, 120),
          nameEn: (cc.nameEn || cc.nameAr || 'Cost Center').slice(0, 120),
          type: cc.type || 'department',
          budgetAllocated: Number(cc.budgetAllocated || 0),
          budgetAllocatedMinor,
          isActive: Boolean(cc.isActive ?? true),
          createdAt: cc.createdAt || Date.now(),
          updatedAt: serverTimestamp(),
        })
      )
    );
  }
  for (const p of legacyWorkspace.parties || []) {
    const balanceMinor = toMinor(p.balance || 0, p.currency || orgCurrency);
    ops.push((batch) =>
      batch.set(
        doc(db, 'organizations', cloudOrgId, 'parties', p.id),
        stripUndefinedDeep({
          id: p.id,
          orgId: cloudOrgId,
          type: p.type,
          name: p.name.slice(0, 120),
          currency: (p.currency || orgCurrency).slice(0, 8),
          balance: Number(p.balance || 0),
          balanceMinor,
          ...(p.phone ? { phone: p.phone.slice(0, 40) } : {}),
          ...(p.email ? { email: p.email.slice(0, 254) } : {}),
          ...(p.taxId ? { taxId: p.taxId.slice(0, 64) } : {}),
          ...(typeof p.creditLimit === 'number' ? { creditLimit: p.creditLimit } : {}),
          ...(p.dueDate ? { dueDate: p.dueDate.slice(0, 16) } : {}),
          ...(p.notes ? { notes: p.notes.slice(0, 400) } : {}),
          createdAt: p.createdAt || Date.now(),
          updatedAt: serverTimestamp(),
        })
      )
    );
  }
  for (const b of legacyWorkspace.budgets || []) {
    const cloudDoc = buildOrgBudgetPayloadForCloud(cloudOrgId, b, orgCurrency);
    ops.push((batch) => batch.set(doc(db, 'organizations', cloudOrgId, 'budgets', b.id), cloudDoc));
  }
  for (const tx of legacyWorkspace.transactions || []) {
    const normalizedTx: Transaction = {
      ...tx,
      submittedBy:
        !tx.submittedBy || tx.submittedBy === 'local-owner' || tx.submittedBy === 'local-member'
          ? actor.uid
          : tx.submittedBy,
      approvalStatus: normalizeApprovalStatus(tx.approvalStatus) || 'approved',
    };
    const cloudDoc = buildOrgTxPayloadForCloud(cloudOrgId, normalizedTx);
    ops.push((batch) => batch.set(doc(db, 'organizations', cloudOrgId, 'transactions', tx.id), cloudDoc));
  }

  const audit = makeAuditDocPayload(
    cloudOrgId,
    'create',
    'organization',
    cloudOrgId,
    actor,
    `ترحيل بيانات المؤسسة المحلية إلى السحابة (${legacyWorkspace.transactions?.length || 0} معاملة)`
  );
  ops.push((batch) => batch.set(doc(db, 'organizations', cloudOrgId, 'auditLogs', audit.id), audit.data));

  const BATCH_LIMIT = 380;
  const total = ops.length;
  onProgress?.(0, total);
  for (let i = 0; i < total; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    const slice = ops.slice(i, i + BATCH_LIMIT);
    for (const fn of slice) fn(batch);
    await batch.commit();
    onProgress?.(Math.min(i + slice.length, total), total);
  }
}

/**
 * Deletes an organization cleanly from Cloud Firestore:
 * - For shared/cloud orgs (`hasCloudOrgRef`), invokes the verified `/api/org/delete` endpoint
 *   (treating 404 ORG_NOT_FOUND as already deleted on server).
 * - Cleans up user-scoped workspace transactions (`users/{uid}/workspaces/{orgId}/transactions`)
 *   and removes stale `orgWorkspaces` entries from `users/{uid}/backup/meta`.
 */
export async function deleteOrganizationWorkspaceCloud(params: {
  orgId: string;
  orgName: string;
  uid?: string | null;
  hasCloudOrgRef: boolean;
}): Promise<void> {
  const cleanOrgId = (params.orgId || '').trim();
  if (!cleanOrgId) return;

  if (params.hasCloudOrgRef) {
    try {
      await deleteOrgOnServer(cleanOrgId, params.orgName);
    } catch (err) {
      const isAlreadyMissing =
        err instanceof ServerApiError &&
        (err.status === 404 || err.code === 'ORG_NOT_FOUND');
      if (!isAlreadyMissing) {
        throw err;
      }
    }
  }

  if (params.uid) {
    await Promise.all([
      deleteWorkspaceTransactionsCloud(params.uid, cleanOrgId),
      removeOrgWorkspaceFromBackupMeta(params.uid, cleanOrgId),
    ]);
  }
}
