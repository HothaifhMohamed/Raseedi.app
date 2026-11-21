/**
 * Real-Time Multi-Device Cloud Organization Sync Service (Firestore + Offline Cache)
 * All Personal data stays in IndexedDB; Cloud Organizations stream live from /organizations/{orgId}.
 */
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
  DocumentData,
  Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  deleteOrgOnServer,
  deleteWorkspaceTransactionsCloud,
  removeOrgWorkspaceFromBackupMeta,
  ServerApiError,
} from './firebase';
import {
  AuditLogAction,
  AuditLogEntry,
  BillingCycle,
  Budget,
  BusinessParty,
  Category,
  CostCenter,
  Organization,
  OrganizationIndustry,
  OrganizationMember,
  OrganizationRole,
  OrgRef,
  OrgWorkspaceData,
  PlanTier,
  Transaction,
  Wallet,
} from '../types';
import { convertCurrency, fromMinor, toMinor } from './currency';
import { getEffectiveTransactionAmount } from './calculations';
import { createStarterCostCentersForIndustry, createStarterOrgCategories } from './db';
import { normalizeApprovalStatus } from './entitlements';
import { stripSensitivePinFromWallet } from './security';
import {
  invalidateUserLookupCache,
  userDirectoryLookupCache,
} from './lookupCache';
import {
  filterTransactionsByDateRange,
  isFirestoreMissingIndexError,
  sortTransactionsDescending,
} from './orgTransactionQuery';
import {
  checkOrgSeatAvailability,
  computeEmailLookupHash,
  parseMemberLookupQuery,
} from './usernameService';
import {
  FIRESTORE_BATCH_CONCURRENCY,
  FIRESTORE_FAST_BATCH_SIZE,
  normalizeValidFirestoreId,
  runResilientBatchCommits,
  stripUndefinedDeep,
} from './workspaceSync';
import {
  getUnmigratedOrgExtrasSummary,
  UnmigratedOrgExtrasSummary,
} from './localOrgHelpers';

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

export function parseWalletDoc(docData: Record<string, unknown>): Wallet | null {
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

function sanitizeOrgDateForCloud(rawDate: unknown): string {
  const s = typeof rawDate === 'string' ? rawDate.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (s.length > 0) return s.slice(0, 16);
  return new Date().toISOString().slice(0, 10);
}

export function buildOrgTxPayloadForCloud(orgId: string, tx: Transaction): Record<string, unknown> {
  const safeId = normalizeValidFirestoreId(tx.id, 'tx');
  const currency = (tx.currency || 'EGP').trim().toUpperCase().slice(0, 8) || 'EGP';
  const rawAmount = Number(tx.amount);
  const safeAmount = Number.isFinite(rawAmount) ? Math.min(1_000_000_000, Math.abs(rawAmount)) : 0;
  const amountMinor = Math.max(0, Math.round(toMinor(safeAmount, currency)));
  const safeDate = sanitizeOrgDateForCloud(tx.date);
  const canonicalStatus = normalizeApprovalStatus(tx.approvalStatus) || 'approved';
  const safeSubmittedBy = typeof tx.submittedBy === 'string' ? tx.submittedBy.trim().slice(0, 128) : '';
  const safeApprovedBy =
    typeof tx.approvedBy === 'string' && tx.approvedBy.trim().length > 0
      ? tx.approvedBy.trim().slice(0, 128)
      : null;
  const safeDeletedAt =
    typeof tx.deletedAt === 'number' && Number.isFinite(tx.deletedAt) && tx.deletedAt > 0
      ? tx.deletedAt
      : null;

  // Strip oversized inline base64 attachments so org ledger docs always fit Firestore limits
  const { attachments: _inlineAttachments, ...txWithoutInlineAttachments } = tx;
  const cleanTx: Transaction = stripUndefinedDeep({
    ...txWithoutInlineAttachments,
    id: safeId,
    amount: safeAmount,
    currency,
    date: safeDate,
    amountMinor,
    submittedBy: safeSubmittedBy || undefined,
    approvedBy: safeApprovedBy ?? undefined,
    approvalStatus: canonicalStatus,
    deletedAt: safeDeletedAt,
    updatedAt: Date.now(),
  });
  return {
    id: safeId,
    orgId,
    date: safeDate,
    amountMinor,
    submittedBy: safeSubmittedBy,
    approvedBy: safeApprovedBy,
    approvalStatus: canonicalStatus,
    deletedAt: safeDeletedAt,
    payload: cleanTx,
    updatedAt: serverTimestamp(),
  };
}

function buildOrgWalletPayloadForCloud(orgId: string, wallet: Wallet): Record<string, unknown> {
  const safeId = normalizeValidFirestoreId(wallet.id, 'w');
  const currency = (wallet.currency || 'EGP').trim().toUpperCase().slice(0, 8) || 'EGP';
  const rawBalance = Number.isFinite(Number(wallet.balance)) ? Number(wallet.balance) : 0;
  const rawInitial = Number.isFinite(Number(wallet.initialBalance)) ? Number(wallet.initialBalance) : 0;
  const balanceMinor = Math.round(
    typeof wallet.balanceMinor === 'number' && Number.isFinite(wallet.balanceMinor)
      ? wallet.balanceMinor
      : toMinor(rawBalance, currency)
  );
  const initialBalanceMinor = Math.round(
    typeof wallet.initialBalanceMinor === 'number' && Number.isFinite(wallet.initialBalanceMinor)
      ? wallet.initialBalanceMinor
      : toMinor(rawInitial, currency)
  );
  const cleanWallet: Wallet = stripUndefinedDeep(
    stripSensitivePinFromWallet({
      ...wallet,
      id: safeId,
      currency,
      balanceMinor,
      initialBalanceMinor,
      balance: fromMinor(balanceMinor, currency),
    })
  );
  return {
    id: safeId,
    orgId,
    balanceMinor,
    payload: cleanWallet,
    updatedAt: serverTimestamp(),
  };
}

function buildOrgCategoryPayloadForCloud(orgId: string, cat: Category): Record<string, unknown> {
  const safeId = normalizeValidFirestoreId(cat.id, 'cat');
  const cleanCat = stripUndefinedDeep({ ...cat, id: safeId });
  return {
    id: safeId,
    orgId,
    payload: cleanCat,
    updatedAt: serverTimestamp(),
  };
}

function buildOrgBudgetPayloadForCloud(orgId: string, budget: Budget, orgCurrency: string): Record<string, unknown> {
  const safeId = normalizeValidFirestoreId(budget.id, 'bgt');
  const budgetCurrencyRaw =
    typeof (budget as { currency?: unknown }).currency === 'string'
      ? String((budget as { currency?: string }).currency)
      : '';
  const currency = (budgetCurrencyRaw || orgCurrency || 'EGP').trim().toUpperCase().slice(0, 8) || 'EGP';
  const rawAmount = Number(budget.amount);
  const safeAmount = Number.isFinite(rawAmount) ? Math.min(1_000_000_000, Math.abs(rawAmount)) : 0;
  const amountMinor = Math.max(0, Math.round(toMinor(safeAmount, currency)));
  const cleanBudget = stripUndefinedDeep({
    ...budget,
    id: safeId,
    amount: safeAmount,
    amountMinor,
  });
  return {
    id: safeId,
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
              username: typeof m.username === 'string' && m.username.trim() ? m.username.trim() : undefined,
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
  for (const [walletId, rawDeltaMinor] of deltas.entries()) {
    const deltaMinor = Math.round(rawDeltaMinor);
    if (deltaMinor === 0) continue;
    const w = wallets.find((item) => item.id === walletId);
    if (!w) continue;
    batch.update(doc(db, 'organizations', orgId, 'wallets', walletId), {
      balanceMinor: increment(deltaMinor),
      'payload.balanceMinor': increment(deltaMinor),
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
  const txDocId = String(txDoc.id);
  batch.set(doc(db, 'organizations', orgId, 'transactions', txDocId), txDoc);

  const deltas = computeWalletBalanceDeltas(tx, wallets, customRates, 1);
  applyWalletDeltasToBatch(batch, orgId, wallets, deltas);

  const audit = makeAuditDocPayload(
    orgId,
    'create',
    'transaction',
    txDocId,
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

  for (const [walletId, rawDeltaMinor] of totalDeltas.entries()) {
    const deltaMinor = Math.round(rawDeltaMinor);
    if (deltaMinor === 0) continue;
    const w = wallets.find((item) => item.id === walletId);
    if (!w) continue;
    ops.push((batch) => {
      batch.update(doc(db, 'organizations', orgId, 'wallets', walletId), {
        balanceMinor: increment(deltaMinor),
        'payload.balanceMinor': increment(deltaMinor),
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
  actor: OrgActorInfo,
  onProgress?: (processed: number, total: number) => void
): Promise<void> {
  if (newTransactions.length === 0) return;
  const total = newTransactions.length;
  const totalDeltas = new Map<string, number>();

  for (const tx of newTransactions) {
    const deltas = computeWalletBalanceDeltas(tx, wallets, customRates, 1);
    for (const [k, v] of deltas.entries()) {
      totalDeltas.set(k, (totalDeltas.get(k) || 0) + v);
    }
  }

  let committedBatchCount = 0;

  try {
    await runResilientBatchCommits({
      items: newTransactions,
      batchSize: FIRESTORE_FAST_BATCH_SIZE,
      concurrency: FIRESTORE_BATCH_CONCURRENCY,
      maxRetries: 3,
      onProgress,
      commitChunk: async (slice, batchIndex) => {
        const batch = writeBatch(db);
        let firstDocId = '';
        for (const tx of slice) {
          const cloudDoc = buildOrgTxPayloadForCloud(orgId, {
            ...tx,
            submittedBy: tx.submittedBy || actor.uid,
            submittedByName: tx.submittedByName || actor.name,
          });
          const cloudDocId = String(cloudDoc.id);
          if (!firstDocId) firstDocId = cloudDocId;
          batch.set(doc(db, 'organizations', orgId, 'transactions', cloudDocId), cloudDoc);
        }
        if (batchIndex === 0 && slice.length > 0) {
          const audit = makeAuditDocPayload(
            orgId,
            'create',
            'transaction',
            firstDocId || normalizeValidFirestoreId(slice[0].id, 'tx'),
            actor,
            `استيراد دفعة معاملات (${total})`
          );
          batch.set(doc(db, 'organizations', orgId, 'auditLogs', audit.id), audit.data);
        }
        await batch.commit();
        committedBatchCount += 1;
      },
    });

    if (totalDeltas.size > 0) {
      const walletBatch = writeBatch(db);
      applyWalletDeltasToBatch(walletBatch, orgId, wallets, totalDeltas);
      await walletBatch.commit();
    }
  } catch (err) {
    // If one or more transaction batches already landed in Firestore before failure,
    // heal wallet balances directly from authoritative approved transactions.
    if (committedBatchCount > 0) {
      try {
        const [serverTxResult, walletsSnap] = await Promise.all([
          forceFetchOrgTransactionsFromServer(orgId).catch(async () => {
            const snap = await getDocs(collection(db, 'organizations', orgId, 'transactions'));
            const active: Transaction[] = [];
            const trash: Transaction[] = [];
            for (const d of snap.docs) {
              const parsed = parseTransactionDoc(d.data() as Record<string, unknown>);
              if (!parsed) continue;
              if (parsed.deletedAt) trash.push(parsed);
              else active.push(parsed);
            }
            return { active, trash };
          }),
          getDocsFromServer(collection(db, 'organizations', orgId, 'wallets')).catch(() =>
            getDocs(collection(db, 'organizations', orgId, 'wallets'))
          ),
        ]);
        const latestWallets = walletsSnap.docs
          .map((d) => parseWalletDoc(d.data() as Record<string, unknown>))
          .filter((w): w is Wallet => w !== null);
        await recalculateOrgBalancesFromApproved(
          orgId,
          latestWallets.length > 0 ? latestWallets : wallets,
          serverTxResult.active,
          customRates,
          actor
        );
      } catch (recalcErr) {
        console.warn(
          '[importOrgTransactionsBatchCloud] Balance recalculation after partial batch failure failed:',
          recalcErr
        );
      }
    }
    throw err;
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
    const updatedWallet: Wallet = stripUndefinedDeep(
      stripSensitivePinFromWallet({
        ...w,
        balanceMinor: nextMinor,
        balance: fromMinor(nextMinor, w.currency),
      })
    );
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
): Promise<UnmigratedOrgExtrasSummary> {
  const orgCurrency = (legacyWorkspace.organization.currency || 'EGP').trim().toUpperCase().slice(0, 8) || 'EGP';
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  const walletIdMap = new Map<string, string>();
  const categoryIdMap = new Map<string, string>();
  const costCenterIdMap = new Map<string, string>();
  const partyIdMap = new Map<string, string>();

  for (const w of legacyWorkspace.wallets || []) {
    const safeId = normalizeValidFirestoreId(w.id, 'w');
    walletIdMap.set(w.id, safeId);
    const cloudDoc = buildOrgWalletPayloadForCloud(cloudOrgId, { ...w, id: safeId, workspaceId: cloudOrgId });
    ops.push((batch) => batch.set(doc(db, 'organizations', cloudOrgId, 'wallets', safeId), cloudDoc));
  }
  for (const c of legacyWorkspace.categories || []) {
    const safeId = normalizeValidFirestoreId(c.id, 'cat');
    categoryIdMap.set(c.id, safeId);
    const cloudDoc = buildOrgCategoryPayloadForCloud(cloudOrgId, { ...c, id: safeId });
    ops.push((batch) => batch.set(doc(db, 'organizations', cloudOrgId, 'categories', safeId), cloudDoc));
  }
  for (const cc of legacyWorkspace.costCenters || []) {
    const safeId = normalizeValidFirestoreId(cc.id, 'cc');
    costCenterIdMap.set(cc.id, safeId);
    const safeBudget = Number.isFinite(Number(cc.budgetAllocated))
      ? Math.max(0, Math.min(1_000_000_000, Number(cc.budgetAllocated)))
      : 0;
    const budgetAllocatedMinor = Math.max(0, Math.round(toMinor(safeBudget, orgCurrency)));
    const safeType =
      cc.type === 'department' || cc.type === 'project' || cc.type === 'branch'
        ? cc.type
        : 'department';
    const safeCode = (cc.code || 'CC').trim().slice(0, 32) || 'CC';
    const safeNameAr = (cc.nameAr || cc.name || safeCode || 'مركز تكلفة').trim().slice(0, 120) || 'مركز تكلفة';
    const safeNameEn = (cc.nameEn || cc.name || cc.nameAr || 'Cost Center').trim().slice(0, 120) || 'Cost Center';
    ops.push((batch) =>
      batch.set(
        doc(db, 'organizations', cloudOrgId, 'costCenters', safeId),
        stripUndefinedDeep({
          id: safeId,
          orgId: cloudOrgId,
          code: safeCode,
          name: (cc.name || safeNameAr).trim().slice(0, 120) || safeNameAr,
          nameAr: safeNameAr,
          nameEn: safeNameEn,
          type: safeType,
          budgetAllocated: safeBudget,
          budgetAllocatedMinor,
          isActive: Boolean(cc.isActive ?? true),
          createdAt: typeof cc.createdAt === 'number' && cc.createdAt >= 0 ? cc.createdAt : Date.now(),
          updatedAt: serverTimestamp(),
        })
      )
    );
  }
  for (const p of legacyWorkspace.parties || []) {
    const safeId = normalizeValidFirestoreId(p.id, 'party');
    partyIdMap.set(p.id, safeId);
    const safeCurrency = (p.currency || orgCurrency).trim().toUpperCase().slice(0, 8) || orgCurrency;
    const safeBalance = Number.isFinite(Number(p.balance))
      ? Math.max(-1_000_000_000, Math.min(1_000_000_000, Number(p.balance)))
      : 0;
    const balanceMinor = Math.round(toMinor(safeBalance, safeCurrency));
    const safePartyType =
      p.type === 'vendor' || p.type === 'client' || p.type === 'both' ? p.type : 'vendor';
    const safeName = (p.name || 'طرف تجاري').trim().slice(0, 120) || 'طرف تجاري';
    const safeCreditLimit =
      typeof p.creditLimit === 'number' && Number.isFinite(p.creditLimit)
        ? Math.max(0, Math.min(1_000_000_000, p.creditLimit))
        : undefined;
    ops.push((batch) =>
      batch.set(
        doc(db, 'organizations', cloudOrgId, 'parties', safeId),
        stripUndefinedDeep({
          id: safeId,
          orgId: cloudOrgId,
          type: safePartyType,
          name: safeName,
          currency: safeCurrency,
          balance: safeBalance,
          balanceMinor,
          ...(p.phone ? { phone: String(p.phone).trim().slice(0, 40) } : {}),
          ...(p.email ? { email: String(p.email).trim().slice(0, 254) } : {}),
          ...(p.taxId ? { taxId: String(p.taxId).trim().slice(0, 64) } : {}),
          ...(safeCreditLimit !== undefined ? { creditLimit: safeCreditLimit } : {}),
          ...(p.dueDate ? { dueDate: String(p.dueDate).trim().slice(0, 16) } : {}),
          ...(p.notes ? { notes: String(p.notes).trim().slice(0, 400) } : {}),
          createdAt: typeof p.createdAt === 'number' && p.createdAt >= 0 ? p.createdAt : Date.now(),
          updatedAt: serverTimestamp(),
        })
      )
    );
  }
  for (const b of legacyWorkspace.budgets || []) {
    const safeId = normalizeValidFirestoreId(b.id, 'bgt');
    const remappedCategoryId = b.categoryId ? categoryIdMap.get(b.categoryId) || b.categoryId : b.categoryId;
    const cloudDoc = buildOrgBudgetPayloadForCloud(
      cloudOrgId,
      { ...b, id: safeId, categoryId: remappedCategoryId },
      orgCurrency
    );
    ops.push((batch) => batch.set(doc(db, 'organizations', cloudOrgId, 'budgets', safeId), cloudDoc));
  }
  for (const tx of legacyWorkspace.transactions || []) {
    const safeId = normalizeValidFirestoreId(tx.id, 'tx');
    const normalizedTx: Transaction = {
      ...tx,
      id: safeId,
      workspaceId: cloudOrgId,
      walletId: walletIdMap.get(tx.walletId) || tx.walletId,
      ...(tx.toWalletId ? { toWalletId: walletIdMap.get(tx.toWalletId) || tx.toWalletId } : {}),
      categoryId: categoryIdMap.get(tx.categoryId) || tx.categoryId,
      ...(tx.costCenterId ? { costCenterId: costCenterIdMap.get(tx.costCenterId) || tx.costCenterId } : {}),
      ...(tx.partyId ? { partyId: partyIdMap.get(tx.partyId) || tx.partyId } : {}),
      submittedBy:
        !tx.submittedBy || tx.submittedBy === 'local-owner' || tx.submittedBy === 'local-member'
          ? actor.uid
          : tx.submittedBy,
      approvalStatus: normalizeApprovalStatus(tx.approvalStatus) || 'approved',
    };
    const cloudDoc = buildOrgTxPayloadForCloud(cloudOrgId, normalizedTx);
    ops.push((batch) => batch.set(doc(db, 'organizations', cloudOrgId, 'transactions', safeId), cloudDoc));
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

  const total = ops.length;
  onProgress?.(0, total);
  await runResilientBatchCommits({
    items: ops,
    batchSize: FIRESTORE_FAST_BATCH_SIZE,
    concurrency: FIRESTORE_BATCH_CONCURRENCY,
    maxRetries: 3,
    onProgress,
    commitChunk: async (slice) => {
      const batch = writeBatch(db);
      for (const fn of slice) fn(batch);
      await batch.commit();
    },
  });

  return getUnmigratedOrgExtrasSummary(legacyWorkspace);
}

export interface CreateCloudOrgDirectInput {
  name: string;
  currency: string;
  industry?: OrganizationIndustry;
  vatRate?: number;
  taxNumber?: string;
  approvalThreshold?: number;
  loadSampleData?: boolean;
  preferredOrgId?: string;
  seedWorkspace?: OrgWorkspaceData | null;
  onMigrationProgress?: (completed: number, total: number) => void;
}

export interface CreateCloudOrgDirectResult {
  orgId: string;
  organization: Organization;
  orgRef: OrgRef;
}

function readTimestampOrNumberMs(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as Timestamp).toMillis === 'function') {
    const ms = (val as Timestamp).toMillis();
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  return null;
}

/**
 * Creates a full Cloud Organization directly in Firestore via an atomic transaction
 * (`organizations/{orgId}`, `organizations/{orgId}/members/{uid}`, `users/{uid}/orgRefs/{orgId}`),
 * inheriting the verified user's exact Business PRO or Free entitlement without requiring
 * a custom Express/Firebase Admin backend (works identically on Vercel & AI Studio).
 */
export async function createCloudOrganizationDirect(
  input: CreateCloudOrgDirectInput
): Promise<CreateCloudOrgDirectResult> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('AUTH_REQUIRED_FOR_CLOUD_ORG');
  }

  const uid = currentUser.uid;
  const now = Date.now();
  const cleanName = (input.name || '').trim().slice(0, 120) || 'مؤسستي';
  const cleanCurrency = (input.currency || 'EGP').trim().toUpperCase().slice(0, 8) || 'EGP';
  const cleanIndustry: OrganizationIndustry =
    input.industry && ['retail', 'restaurant', 'tech', 'construction', 'medical', 'general'].includes(input.industry)
      ? input.industry
      : 'general';
  const cleanVatRate = Number.isFinite(Number(input.vatRate))
    ? Math.max(0, Math.min(100, Number(input.vatRate)))
    : 14;
  const cleanApprovalThreshold = Number.isFinite(Number(input.approvalThreshold))
    ? Math.max(0, Math.min(1_000_000_000, Number(input.approvalThreshold)))
    : 2000;
  const cleanTaxNumber =
    typeof input.taxNumber === 'string' && input.taxNumber.trim().length > 0
      ? input.taxNumber.trim().slice(0, 64)
      : null;

  // Read authoritative user profile from Firestore server first so entitlement strictly matches firestore.rules
  const userSnap = await getDocFromServer(doc(db, 'users', uid)).catch(() => getDoc(doc(db, 'users', uid)));
  const uData = (userSnap.exists() ? userSnap.data() : {}) as Record<string, unknown>;
  const uPlanTier = String(uData.planTier || 'free');
  const uProPlan = String(uData.proPlan || 'free');
  const uIsPro = uData.isPro === true || uData.proActive === true;
  const uHasBusinessTier =
    uPlanTier === 'business_pro' ||
    uPlanTier === 'business' ||
    uProPlan === 'business_monthly' ||
    uProPlan === 'business_yearly' ||
    uProPlan === 'trial';
  const uExp =
    readTimestampOrNumberMs(uData.proExpiresAt) ??
    readTimestampOrNumberMs(uData.expiresAt);
  // Keep a small 60s safety margin so client/server clock skew never fails request.time <= uExp + 7d
  const uNotExpired = uExp === null || now + 60_000 <= uExp + 7 * 86_400_000;

  let planTier: PlanTier = 'free';
  let billingCycle: BillingCycle = 'free';
  let expiresAt: number | null = null;

  if (uIsPro && uHasBusinessTier && uNotExpired) {
    planTier = 'business_pro';
    const rawCycle = String(uData.billingCycle || '');
    if (['monthly', 'yearly', 'lifetime', 'trial', 'code'].includes(rawCycle)) {
      billingCycle = rawCycle as BillingCycle;
    } else if (uProPlan === 'business_yearly') {
      billingCycle = 'yearly';
    } else if (uProPlan === 'trial') {
      billingCycle = 'trial';
    } else if (uProPlan === 'lifetime') {
      billingCycle = 'lifetime';
    } else {
      billingCycle = 'monthly';
    }
    expiresAt = uExp;
  }

  const rawUsername = typeof uData.username === 'string' ? uData.username.trim().toLowerCase() : '';
  const validUsername = /^[a-z0-9_]{3,30}$/.test(rawUsername) ? rawUsername : undefined;
  const cleanEmail = (
    (currentUser.email || '').trim() ||
    String(uData.email || '').trim() ||
    `${uid}@firebase.local`
  )
    .toLowerCase()
    .slice(0, 254);
  const cleanDisplayName = (
    (currentUser.displayName || '').trim() ||
    String(uData.displayName || '').trim() ||
    cleanEmail.split('@')[0]?.trim() ||
    'المالك'
  ).slice(0, 120);

  // Avoid spurious permission-denied reads on non-existent organizations/{id}:
  // Check the owner's own users/{uid}/orgRefs/{preferredOrgId} first.
  const normalizedPreferred = input.preferredOrgId?.trim()
    ? normalizeValidFirestoreId(input.preferredOrgId.trim(), 'org')
    : '';
  let orgId = `org-${now}-${Math.random().toString(36).slice(2, 8)}`;

  if (normalizedPreferred) {
    try {
      const existingRefSnap = await getDoc(doc(db, 'users', uid, 'orgRefs', normalizedPreferred));
      if (existingRefSnap.exists()) {
        const existingOrgSnap = await getDoc(doc(db, 'organizations', normalizedPreferred));
        if (existingOrgSnap.exists()) {
          const existingData = existingOrgSnap.data() as Record<string, unknown>;
          if (existingData.ownerUid === uid) {
            const orgRef: OrgRef = {
              orgId: normalizedPreferred,
              orgName: String(existingData.name || cleanName),
              role: 'owner',
              status: 'active',
              currency: String(existingData.currency || cleanCurrency),
              joinedAt: now,
            };
            const organization: Organization = {
              id: normalizedPreferred,
              name: orgRef.orgName,
              currency: orgRef.currency,
              mainCurrency: orgRef.currency,
              industry: (existingData.industry as OrganizationIndustry) || cleanIndustry,
              vatRate: Number(existingData.vatRate ?? cleanVatRate),
              ...(existingData.taxNumber ? { taxNumber: String(existingData.taxNumber) } : {}),
              approvalThreshold: Number(existingData.approvalThreshold ?? cleanApprovalThreshold),
              ownerUid: uid,
              ownerId: uid,
              planTier: (existingData.planTier as PlanTier) || planTier,
              billingCycle: (existingData.billingCycle as BillingCycle) || billingCycle,
              expiresAt: readTimestampOrNumberMs(existingData.expiresAt),
              seatLimit: Number(existingData.seatLimit ?? 5),
              extraSeats: Number(existingData.extraSeats ?? 0),
              localFirstMode: false,
              createdAt: now,
              updatedAt: now,
            };
            return { orgId: normalizedPreferred, organization, orgRef };
          }
        }
      }
    } catch {
      // Ignore lookup failures and proceed with a clean collision-free orgId
    }
  }

  const monthKey = new Date(now).toISOString().slice(0, 7);
  const orgDocRef = doc(db, 'organizations', orgId);
  const memberDocRef = doc(db, 'organizations', orgId, 'members', uid);
  const userOrgRefDoc = doc(db, 'users', uid, 'orgRefs', orgId);

  const orgPayload = stripUndefinedDeep({
    id: orgId,
    name: cleanName,
    currency: cleanCurrency,
    industry: cleanIndustry,
    vatRate: cleanVatRate,
    ...(cleanTaxNumber ? { taxNumber: cleanTaxNumber } : {}),
    approvalThreshold: cleanApprovalThreshold,
    ownerUid: uid,
    planTier,
    billingCycle,
    expiresAt,
    seatLimit: 5,
    extraSeats: 0,
    aiScansUsed: 0,
    aiScansMonth: monthKey,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const ownerMemberPayload = stripUndefinedDeep({
    uid,
    email: cleanEmail,
    displayName: cleanDisplayName,
    ...(validUsername ? { username: validUsername } : {}),
    role: 'owner' as const,
    status: 'active' as const,
    joinedAt: now,
    updatedAt: serverTimestamp(),
  });

  const orgRefPayload: OrgRef = {
    orgId,
    orgName: cleanName,
    role: 'owner',
    status: 'active',
    currency: cleanCurrency,
    joinedAt: now,
  };

  const bootstrapBatch = writeBatch(db);
  bootstrapBatch.set(orgDocRef, orgPayload);
  bootstrapBatch.set(memberDocRef, ownerMemberPayload);
  bootstrapBatch.set(userOrgRefDoc, orgRefPayload);
  try {
    await bootstrapBatch.commit();
  } catch (err) {
    console.warn('[createCloudOrganizationDirect] bootstrapBatch.commit failed:', {
      orgId,
      uid,
      planTier,
      billingCycle,
      hasExpiresAt: expiresAt !== null,
      error: err,
    });
    throw err;
  }

  const actor: OrgActorInfo = { uid, name: cleanDisplayName };

  // Seed subcollections (either migrating an existing local workspace or seeding clean starter data)
  if (input.seedWorkspace) {
    try {
      await migrateLegacyOrgToCloud(orgId, input.seedWorkspace, actor, input.onMigrationProgress);
    } catch (err) {
      console.warn('[createCloudOrganizationDirect] migrateLegacyOrgToCloud failed:', {
        orgId,
        uid,
        error: err,
      });
      throw err;
    }
  } else {
    const starterWorkspace: OrgWorkspaceData = {
      organization: {
        id: orgId,
        name: cleanName,
        currency: cleanCurrency,
        mainCurrency: cleanCurrency,
        industry: cleanIndustry,
        vatRate: cleanVatRate,
        ...(cleanTaxNumber ? { taxNumber: cleanTaxNumber } : {}),
        approvalThreshold: cleanApprovalThreshold,
        ownerUid: uid,
        ownerId: uid,
        planTier,
        billingCycle,
        expiresAt,
        seatLimit: 5,
        extraSeats: 0,
        localFirstMode: false,
        createdAt: now,
        updatedAt: now,
      },
      members: [],
      costCenters: createStarterCostCentersForIndustry(
        orgId,
        cleanIndustry,
        Boolean(input.loadSampleData),
        now
      ),
      parties: [],
      wallets: [
        {
          id: `org-w-cash-${now}`,
          name: 'الخزينة الرئيسية',
          currency: cleanCurrency,
          initialBalance: 0,
          initialBalanceMinor: 0,
          balance: 0,
          balanceMinor: 0,
          color: '#3A605B',
          icon: 'Wallet',
          isArchived: false,
          order: 1,
          walletType: 'standard',
          workspaceId: orgId,
        },
      ],
      categories: createStarterOrgCategories(cleanIndustry),
      transactions: [],
      budgets: [],
      debts: [],
      goals: [],
      templates: [],
      auditLogs: [],
    };
    await migrateLegacyOrgToCloud(orgId, starterWorkspace, actor, input.onMigrationProgress);
  }

  const organization: Organization = {
    id: orgId,
    name: cleanName,
    currency: cleanCurrency,
    mainCurrency: cleanCurrency,
    industry: cleanIndustry,
    vatRate: cleanVatRate,
    ...(cleanTaxNumber ? { taxNumber: cleanTaxNumber } : {}),
    approvalThreshold: cleanApprovalThreshold,
    ownerUid: uid,
    ownerId: uid,
    planTier,
    billingCycle,
    expiresAt,
    seatLimit: 5,
    maxSeats: 5,
    extraSeats: 0,
    aiScansUsed: 0,
    aiScansMonth: monthKey,
    localFirstMode: false,
    createdAt: now,
    updatedAt: now,
  };

  return {
    orgId,
    organization,
    orgRef: orgRefPayload,
  };
}

/**
 * Deletes an organization cleanly from Cloud Firestore:
 * - For shared/cloud orgs (`hasCloudOrgRef`), tries `/api/org/delete` first, and if server admin
 *   is unavailable (e.g., static Vercel deployment), performs atomic owner deletion directly in Firestore.
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
    let deletedViaServer = false;
    try {
      await deleteOrgOnServer(cleanOrgId, params.orgName);
      deletedViaServer = true;
    } catch (err) {
      const isAlreadyMissing =
        err instanceof ServerApiError &&
        (err.status === 404 || err.code === 'ORG_NOT_FOUND');
      const isServerUnavailable =
        err instanceof ServerApiError &&
        (err.code === 'CLOUD_ADMIN_UNAVAILABLE' || err.status === 501 || err.status === 503 || err.status === 0);
      if (isAlreadyMissing) {
        deletedViaServer = true;
      } else if (!isServerUnavailable) {
        throw err;
      }
    }

    if (!deletedViaServer && params.uid && auth.currentUser?.uid === params.uid) {
      const uid = params.uid;
      await runTransaction(db, async (tx) => {
        const orgDocRef = doc(db, 'organizations', cleanOrgId);
        const ownerMemberRef = doc(db, 'organizations', cleanOrgId, 'members', uid);
        const ownerOrgRef = doc(db, 'users', uid, 'orgRefs', cleanOrgId);
        const [orgSnap, memberSnap, userRefSnap] = await Promise.all([
          tx.get(orgDocRef),
          tx.get(ownerMemberRef),
          tx.get(ownerOrgRef),
        ]);
        if (orgSnap.exists()) {
          tx.delete(orgDocRef);
        }
        if (memberSnap.exists()) {
          tx.delete(ownerMemberRef);
        }
        if (userRefSnap.exists()) {
          tx.delete(ownerOrgRef);
        }
      });
    }
  }

  if (params.uid) {
    await Promise.all([
      deleteWorkspaceTransactionsCloud(params.uid, cleanOrgId),
      removeOrgWorkspaceFromBackupMeta(params.uid, cleanOrgId),
    ]);
  }
}

export interface DirectOrgUserLookupResult {
  uid: string;
  email: string;
  displayName: string;
  username?: string;
}

export { invalidateUserLookupCache };

/**
 * Looks up a registered Raseedi user directly via Firestore using either their
 * exact `@username` (`usernames/{username}`) or exact email address (`userEmailIndex/{emailHash}`).
 * Uses a bounded 2-minute in-memory TTL cache to avoid repeated reads for the same query.
 * Never queries `users` directly and never performs collection listing.
 */
export async function lookupUserForOrgDirectAdd(
  identifier: string
): Promise<DirectOrgUserLookupResult | null> {
  const parsed = parseMemberLookupQuery(identifier);
  if (parsed.kind === 'invalid') {
    throw new Error(parsed.errorAr);
  }

  const cacheKey = `${parsed.kind}:${parsed.normalized}`;
  const cached = userDirectoryLookupCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (parsed.kind === 'username') {
    const snap = await getDoc(doc(db, 'usernames', parsed.normalized));
    if (!snap.exists()) {
      userDirectoryLookupCache.set(cacheKey, null, 20_000);
      return null;
    }
    const data = snap.data() as Record<string, unknown>;
    const uid = String(data.uid || '').trim();
    if (!uid) {
      userDirectoryLookupCache.set(cacheKey, null, 20_000);
      return null;
    }
    const result: DirectOrgUserLookupResult = {
      uid,
      email: String(data.email || '').trim().toLowerCase(),
      displayName: String(data.displayName || data.username || data.email || 'مستخدم').trim(),
      username: String(data.username || parsed.normalized).trim().toLowerCase(),
    };
    userDirectoryLookupCache.set(cacheKey, result);
    return result;
  }

  const emailHash = await computeEmailLookupHash(parsed.normalized);
  const snap = await getDoc(doc(db, 'userEmailIndex', emailHash));
  if (!snap.exists()) {
    userDirectoryLookupCache.set(cacheKey, null, 20_000);
    return null;
  }
  const data = snap.data() as Record<string, unknown>;
  const uid = String(data.uid || '').trim();
  if (!uid) {
    userDirectoryLookupCache.set(cacheKey, null, 20_000);
    return null;
  }
  const result: DirectOrgUserLookupResult = {
    uid,
    email: String(data.email || parsed.normalized).trim().toLowerCase(),
    displayName: String(data.displayName || data.email || 'مستخدم').trim(),
    username:
      typeof data.username === 'string' && data.username.trim()
        ? data.username.trim().toLowerCase()
        : undefined,
  };
  userDirectoryLookupCache.set(cacheKey, result);
  return result;
}

/**
 * Directly adds a registered user to a Cloud Organization via an atomic Firestore Transaction
 * (zero dependency on server `/api/org/invites`).
 * Writes:
 *  - `organizations/{orgId}/members/{targetUid}`
 *  - `users/{targetUid}/orgRefs/{orgId}`
 *  - `organizations/{orgId}/auditLogs/{logId}`
 */
export async function addOrgMemberDirectlyCloud(params: {
  orgId: string;
  identifier: string;
  targetUser?: DirectOrgUserLookupResult | null;
  role: Exclude<OrganizationRole, 'owner'>;
  department?: string;
  spendingLimit?: number;
  actor: OrgActorInfo;
}): Promise<OrganizationMember> {
  const { orgId, identifier, role, department, spendingLimit, actor } = params;
  const cleanOrgId = String(orgId || '').trim();
  if (!cleanOrgId) throw new Error('ORG_ID_REQUIRED');

  const resolvedUser = params.targetUser || (await lookupUserForOrgDirectAdd(identifier));
  if (!resolvedUser || !resolvedUser.uid) {
    throw new Error('USER_NOT_FOUND');
  }

  // Fetch current members snapshot first to enforce seat limit reliably
  const membersSnap = await getDocs(collection(db, 'organizations', cleanOrgId, 'members'));
  const currentMembers = membersSnap.docs.map((d) => {
    const m = d.data() as Record<string, unknown>;
    return {
      uid: String(m.uid || d.id),
      status: ((m.status as OrganizationMember['status']) || 'active') as OrganizationMember['status'],
    };
  });

  const now = Date.now();
  const orgRef = doc(db, 'organizations', cleanOrgId);
  const memberRef = doc(db, 'organizations', cleanOrgId, 'members', resolvedUser.uid);
  const userOrgRef = doc(db, 'users', resolvedUser.uid, 'orgRefs', cleanOrgId);

  let createdMember: OrganizationMember | null = null;

  await runTransaction(db, async (tx) => {
    const [orgSnap, existingMemberSnap] = await Promise.all([
      tx.get(orgRef),
      tx.get(memberRef),
    ]);

    if (!orgSnap.exists()) {
      throw new Error('ORG_NOT_FOUND');
    }

    const orgData = orgSnap.data() as Record<string, unknown>;
    const orgName = String(orgData.name || 'المؤسسة').slice(0, 120);
    const orgCurrency = String(orgData.currency || 'EGP').slice(0, 8);
    const seatLimit = typeof orgData.seatLimit === 'number' ? orgData.seatLimit : 5;
    const extraSeats = typeof orgData.extraSeats === 'number' ? orgData.extraSeats : 0;

    if (existingMemberSnap.exists()) {
      throw new Error('ALREADY_MEMBER');
    }

    const seatCheck = checkOrgSeatAvailability(
      currentMembers,
      seatLimit,
      extraSeats,
      resolvedUser.uid
    );
    if (!seatCheck.canAdd) {
      throw new Error(seatCheck.reason || 'SEAT_LIMIT_REACHED');
    }

    const cleanDept = department?.trim() ? department.trim().slice(0, 80) : undefined;
    const cleanLimit =
      typeof spendingLimit === 'number' && Number.isFinite(spendingLimit) && spendingLimit > 0
        ? spendingLimit
        : undefined;
    const cleanLimitMinor =
      cleanLimit !== undefined ? toMinor(cleanLimit, orgCurrency) : undefined;

    const memberPayload = stripUndefinedDeep({
      uid: resolvedUser.uid,
      email: (resolvedUser.email || `${resolvedUser.uid}@firebase.local`).slice(0, 254),
      displayName: (resolvedUser.displayName || resolvedUser.email || 'عضو').slice(0, 120),
      ...(resolvedUser.username ? { username: resolvedUser.username.slice(0, 30) } : {}),
      role,
      ...(cleanDept ? { department: cleanDept } : {}),
      ...(cleanLimit !== undefined ? { spendingLimit: cleanLimit } : {}),
      ...(cleanLimitMinor !== undefined ? { spendingLimitMinor: cleanLimitMinor } : {}),
      status: 'active' as const,
      joinedAt: now,
      updatedAt: serverTimestamp(),
    });

    const orgRefPayload = {
      orgId: cleanOrgId,
      orgName,
      role,
      status: 'active' as const,
      currency: orgCurrency,
      joinedAt: now,
    };

    const audit = makeAuditDocPayload(
      cleanOrgId,
      'member_join',
      'member',
      resolvedUser.uid,
      actor,
      `إضافة عضو مباشر: ${resolvedUser.displayName} (${resolvedUser.username ? `@${resolvedUser.username}` : resolvedUser.email}) بصلاحية ${role}`
    );

    tx.set(memberRef, memberPayload);
    tx.set(userOrgRef, orgRefPayload);
    tx.set(doc(db, 'organizations', cleanOrgId, 'auditLogs', audit.id), audit.data);

    createdMember = {
      uid: resolvedUser.uid,
      email: resolvedUser.email,
      displayName: resolvedUser.displayName,
      username: resolvedUser.username,
      role,
      department: cleanDept,
      spendingLimit: cleanLimit,
      spendingLimitMinor: cleanLimitMinor,
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    };
  });

  if (!createdMember) {
    throw new Error('MEMBER_ADD_FAILED');
  }
  return createdMember;
}

/**
 * Directly manages an organization member (change role, suspend, reactivate, spending limit, remove)
 * via an atomic Firestore Transaction syncing both `organizations/{orgId}/members/{targetUid}`
 * and `users/{targetUid}/orgRefs/{orgId}` (works reliably without a custom Express server).
 */
export async function manageOrgMemberDirectlyCloud(params: {
  orgId: string;
  targetUid: string;
  action: 'change_role' | 'suspend' | 'reactivate' | 'set_spending_limit' | 'remove';
  role?: Exclude<OrganizationRole, 'owner'>;
  spendingLimit?: number | null;
  department?: string | null;
  actor: OrgActorInfo;
}): Promise<void> {
  const { orgId, targetUid, action, role, spendingLimit, department, actor } = params;
  const cleanOrgId = String(orgId || '').trim();
  const cleanTargetUid = String(targetUid || '').trim();
  if (!cleanOrgId || !cleanTargetUid) throw new Error('INVALID_MEMBER_MANAGE_ARGS');

  const orgRef = doc(db, 'organizations', cleanOrgId);
  const memberRef = doc(db, 'organizations', cleanOrgId, 'members', cleanTargetUid);
  const userOrgRef = doc(db, 'users', cleanTargetUid, 'orgRefs', cleanOrgId);

  await runTransaction(db, async (tx) => {
    const [orgSnap, memberSnap, userOrgSnap] = await Promise.all([
      tx.get(orgRef),
      tx.get(memberRef),
      tx.get(userOrgRef),
    ]);

    if (!orgSnap.exists()) throw new Error('ORG_NOT_FOUND');
    if (!memberSnap.exists()) throw new Error('MEMBER_NOT_FOUND');

    const orgData = orgSnap.data() as Record<string, unknown>;
    const orgCurrency = String(orgData.currency || 'EGP').slice(0, 8);
    const memberData = memberSnap.data() as Record<string, unknown>;
    const currentRole = String(memberData.role || 'employee') as OrganizationRole;
    const memberLabel = String(memberData.displayName || memberData.email || cleanTargetUid);

    if (currentRole === 'owner') {
      throw new Error('CANNOT_MODIFY_OWNER');
    }

    if (action === 'remove') {
      if (cleanTargetUid === actor.uid) {
        throw new Error('CANNOT_REMOVE_SELF');
      }
      tx.delete(memberRef);
      if (userOrgSnap.exists()) {
        tx.delete(userOrgRef);
      }
      const audit = makeAuditDocPayload(
        cleanOrgId,
        'member_remove',
        'member',
        cleanTargetUid,
        actor,
        `إزالة العضو: ${memberLabel}`
      );
      tx.set(doc(db, 'organizations', cleanOrgId, 'auditLogs', audit.id), audit.data);
      return;
    }

    const memberUpdates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    const orgRefUpdates: Record<string, unknown> = {};
    let auditAction: AuditLogAction = 'update';
    let auditSummary = `تحديث بيانات العضو: ${memberLabel}`;

    if (action === 'change_role' && role) {
      memberUpdates.role = role;
      orgRefUpdates.role = role;
      auditAction = 'role_change';
      auditSummary = `تغيير صلاحية ${memberLabel} إلى ${role}`;
    } else if (action === 'suspend') {
      memberUpdates.status = 'suspended';
      orgRefUpdates.status = 'suspended';
      auditSummary = `تعليق حساب العضو: ${memberLabel}`;
    } else if (action === 'reactivate') {
      memberUpdates.status = 'active';
      orgRefUpdates.status = 'active';
      auditSummary = `إعادة تفعيل العضو: ${memberLabel}`;
    } else if (action === 'set_spending_limit') {
      if (typeof spendingLimit === 'number' && Number.isFinite(spendingLimit) && spendingLimit > 0) {
        memberUpdates.spendingLimit = spendingLimit;
        memberUpdates.spendingLimitMinor = toMinor(spendingLimit, orgCurrency);
      } else {
        memberUpdates.spendingLimit = null;
        memberUpdates.spendingLimitMinor = null;
      }
      if (department !== undefined) {
        memberUpdates.department = department ? department.trim().slice(0, 80) : null;
      }
      auditSummary = `تحديث حد الصرف للعضو: ${memberLabel}`;
    }

    tx.update(memberRef, memberUpdates);
    if (userOrgSnap.exists() && Object.keys(orgRefUpdates).length > 0) {
      tx.update(userOrgRef, orgRefUpdates);
    }
    const audit = makeAuditDocPayload(
      cleanOrgId,
      auditAction,
      'member',
      cleanTargetUid,
      actor,
      auditSummary
    );
    tx.set(doc(db, 'organizations', cleanOrgId, 'auditLogs', audit.id), audit.data);
  });
}

