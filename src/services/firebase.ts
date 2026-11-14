import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { AppDatabaseData } from './db';
import { chunkTransactionsForBackup } from './calculations';
import { BillingCycle, OrgWorkspaceData, PlanTier, ProPlanCode, VerifiedProEntitlement } from '../types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(errInfo.error || 'Firestore operation failed');
}

export interface CloudUserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  isPro: boolean;
  proPlan?: ProPlanCode;
  planTier?: PlanTier;
  billingCycle?: BillingCycle;
  expiresAt?: number | null;
  proExpiresAt?: number | null;
  hasUsedBusinessTrial?: boolean;
  lastSyncedAt?: number;
}

export function isEntitlementActive(
  entitlement: Pick<VerifiedProEntitlement, 'isPro' | 'expiresAt' | 'proExpiresAt'> | CloudUserProfile | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!entitlement || !entitlement.isPro) return false;
  const expiry = entitlement.proExpiresAt ?? entitlement.expiresAt;
  if (typeof expiry === 'number' && expiry > 0) {
    return expiry > nowMs;
  }
  return true;
}

export function resolvePlanTierFromProfile(
  profile: Partial<CloudUserProfile> | Partial<VerifiedProEntitlement> | null | undefined
): PlanTier {
  if (!profile || !isEntitlementActive(profile as VerifiedProEntitlement)) return 'free';
  if (
    profile.planTier === 'business_pro' ||
    profile.proPlan === 'business_monthly' ||
    profile.proPlan === 'business_yearly' ||
    profile.proPlan === 'trial'
  ) {
    return 'business_pro';
  }
  return 'personal_pro';
}

export interface CloudBackupPayload {
  uid: string;
  schemaVersion: number;
  updatedAtMs?: number;
  transactions: AppDatabaseData['transactions'];
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

export interface CloudBackupMeta {
  uid: string;
  schemaVersion: number;
  chunkCount: number;
  totalTransactions: number;
  updatedAtMs: number;
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

export interface ScanQuotaInfo {
  month: string;
  used: number;
  limit: number;
  remaining: number;
  isPro: boolean;
  planTier?: PlanTier;
  expiresAt?: number | null;
  proExpiresAt?: number | null;
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

function getUtf8JsonByteLength(obj: unknown): number {
  const json = JSON.stringify(obj);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  return json.length * 2;
}

function buildSafeSizeChunks<T>(items: T[], maxBytes = 780_000): T[][] {
  const initialChunks = chunkTransactionsForBackup(items, 400);
  const safeChunks: T[][] = [];

  const pushChunkSafely = (slice: T[]) => {
    if (slice.length === 0) return;
    if (getUtf8JsonByteLength(slice) <= maxBytes || slice.length === 1) {
      safeChunks.push(slice);
      return;
    }
    const mid = Math.ceil(slice.length / 2);
    pushChunkSafely(slice.slice(0, mid));
    pushChunkSafely(slice.slice(mid));
  };

  for (const chunk of initialChunks) {
    pushChunkSafely(chunk);
  }
  return safeChunks;
}

/**
 * Ensures user profile exists in Firestore. Never modifies isPro/proPlan/expiresAt (server-only fields).
 */
export async function ensureUserProfile(firebaseUser: User): Promise<CloudUserProfile> {
  const path = `users/${firebaseUser.uid}`;
  const ref = doc(db, 'users', firebaseUser.uid);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const profilePayload: Record<string, unknown> = {
        uid: firebaseUser.uid,
        email: (firebaseUser.email || `${firebaseUser.uid}@firebase.local`).slice(0, 254),
        isPro: false,
        proPlan: 'free',
        planTier: 'free',
        billingCycle: 'free',
        expiresAt: null,
        proExpiresAt: null,
        hasUsedBusinessTrial: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (firebaseUser.displayName) {
        profilePayload.displayName = firebaseUser.displayName.slice(0, 120);
      }
      if (firebaseUser.photoURL) {
        profilePayload.photoURL = firebaseUser.photoURL.slice(0, 512);
      }
      await setDoc(ref, profilePayload);
      return {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || undefined,
        photoURL: firebaseUser.photoURL || undefined,
        isPro: false,
        proPlan: 'free',
        planTier: 'free',
        billingCycle: 'free',
        expiresAt: null,
        proExpiresAt: null,
        hasUsedBusinessTrial: false,
      };
    }

    const existingData = snap.data() as CloudUserProfile;
    const updates: Record<string, unknown> = {
      email: (firebaseUser.email || existingData.email || `${firebaseUser.uid}@firebase.local`).slice(0, 254),
      updatedAt: serverTimestamp(),
    };
    if (firebaseUser.displayName) {
      updates.displayName = firebaseUser.displayName.slice(0, 120);
    }
    if (firebaseUser.photoURL) {
      updates.photoURL = firebaseUser.photoURL.slice(0, 512);
    }

    await updateDoc(ref, updates);
    const active = isEntitlementActive(existingData);
    const resolvedExpiry = existingData.proExpiresAt ?? existingData.expiresAt ?? null;
    return {
      ...existingData,
      isPro: active,
      proPlan: existingData.proPlan || (active ? 'code' : 'free'),
      planTier: resolvePlanTierFromProfile({ ...existingData, isPro: active }),
      billingCycle: existingData.billingCycle || (active ? 'lifetime' : 'free'),
      expiresAt: resolvedExpiry,
      proExpiresAt: resolvedExpiry,
      email: firebaseUser.email || existingData.email || '',
      displayName: firebaseUser.displayName || existingData.displayName,
      photoURL: firebaseUser.photoURL || existingData.photoURL,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchUserProfile(uid: string): Promise<CloudUserProfile | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data() as CloudUserProfile;
    const active = isEntitlementActive(data);
    const resolvedExpiry = data.proExpiresAt ?? data.expiresAt ?? null;
    return {
      ...data,
      isPro: active,
      proPlan: data.proPlan || (active ? 'code' : 'free'),
      planTier: resolvePlanTierFromProfile({ ...data, isPro: active }),
      billingCycle: data.billingCycle || (active ? 'lifetime' : 'free'),
      expiresAt: resolvedExpiry,
      proExpiresAt: resolvedExpiry,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function signInWithGoogle(): Promise<{
  firebaseUser: User;
  profile: CloudUserProfile;
}> {
  const result = await signInWithPopup(auth, googleProvider);
  const firebaseUser = result.user;
  const profile = await ensureUserProfile(firebaseUser);
  return { firebaseUser, profile };
}

export async function signOutGoogle(): Promise<void> {
  await signOut(auth);
}

export async function fetchCloudBackupMeta(
  uid: string
): Promise<{ updatedAtMs: number; chunkCount: number; source: 'chunked' | 'legacy' } | null> {
  try {
    const metaSnap = await getDoc(doc(db, 'users', uid, 'backup', 'meta'));
    if (metaSnap.exists()) {
      const data = metaSnap.data() as Partial<CloudBackupMeta>;
      return {
        updatedAtMs: Number(data.updatedAtMs || 0),
        chunkCount: Number(data.chunkCount || 0),
        source: 'chunked',
      };
    }

    const legacySnap = await getDoc(doc(db, 'users', uid, 'backups', 'latest'));
    if (legacySnap.exists()) {
      const data = legacySnap.data() as { updatedAtMs?: number; updatedAt?: { toMillis?: () => number } };
      const ms =
        typeof data.updatedAtMs === 'number'
          ? data.updatedAtMs
          : typeof data.updatedAt?.toMillis === 'function'
          ? data.updatedAt.toMillis()
          : 1;
      return { updatedAtMs: ms, chunkCount: 0, source: 'legacy' };
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}/backup/meta`);
  }
}

export async function saveCloudBackup(
  uid: string,
  data: Omit<AppDatabaseData, 'user'> & {
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
  }
): Promise<{ syncedAt: number; updatedAtMs: number; skippedAttachmentsCount: number }> {
  const metaPath = `users/${uid}/backup/meta`;
  const metaRef = doc(db, 'users', uid, 'backup', 'meta');
  const userRef = doc(db, 'users', uid);

  let skippedAttachmentsCount = 0;
  const sanitizedTransactions = (data.transactions || []).slice(0, 40000).map((tx) => {
    if (!tx.attachments || tx.attachments.length === 0) return tx;
    const kept = tx.attachments.filter((att) => att.length <= 24_000);
    skippedAttachmentsCount += tx.attachments.length - kept.length;
    return {
      ...tx,
      attachments: kept.length > 0 ? kept : undefined,
    };
  });

  const sanitizedOrgWorkspaces: Record<string, OrgWorkspaceData> = {};
  if (data.orgWorkspaces && typeof data.orgWorkspaces === 'object') {
    for (const [orgId, ws] of Object.entries(data.orgWorkspaces).slice(0, 50)) {
      if (!ws || typeof ws !== 'object' || !ws.organization) continue;
      const sanitizedOrgTx = (ws.transactions || []).slice(0, 5000).map((tx) => {
        if (!tx.attachments || tx.attachments.length === 0) return tx;
        const kept = tx.attachments.filter((att) => att.length <= 24_000);
        skippedAttachmentsCount += tx.attachments.length - kept.length;
        return {
          ...tx,
          attachments: kept.length > 0 ? kept : undefined,
        };
      });
      sanitizedOrgWorkspaces[orgId] = {
        ...ws,
        transactions: sanitizedOrgTx,
        auditLogs: (ws.auditLogs || []).slice(0, 500),
      };
    }
  }
  const resolvedActiveWorkspace =
    data.activeWorkspace && sanitizedOrgWorkspaces[data.activeWorkspace]
      ? data.activeWorkspace
      : 'personal';

  // Measure actual UTF-8 byte lengths so every chunk and meta document stays well under 800KB
  const chunks = buildSafeSizeChunks(sanitizedTransactions, 780_000).slice(0, 99);
  const updatedAtMs = Date.now();

  const metaFields = stripUndefinedDeep({
    uid,
    schemaVersion: 2,
    chunkCount: chunks.length,
    totalTransactions: sanitizedTransactions.length,
    wallets: (data.wallets || []).slice(0, 200),
    categories: (data.categories || []).slice(0, 300),
    budgets: (data.budgets || []).slice(0, 200),
    debts: (data.debts || []).slice(0, 500),
    goals: (data.goals || []).slice(0, 200),
    templates: (data.templates || []).slice(0, 300),
    moneyCircles: (data.moneyCircles || []).slice(0, 200),
    orgWorkspaces: sanitizedOrgWorkspaces,
    activeWorkspace: resolvedActiveWorkspace,
    settings: { ...data.settings, isPro: false },
    hasCompletedOnboarding: Boolean(data.hasCompletedOnboarding),
    updatedAtMs,
  });

  if (getUtf8JsonByteLength(metaFields) > 850_000) {
    throw new Error('BACKUP_META_TOO_LARGE');
  }

  try {
    const [userSnap, existingMetaSnap] = await Promise.all([getDoc(userRef), getDoc(metaRef)]);
    if (!userSnap.exists() && auth.currentUser?.uid === uid) {
      await ensureUserProfile(auth.currentUser);
    }

    const previousChunkCount = existingMetaSnap.exists()
      ? Math.max(0, Number((existingMetaSnap.data() as Partial<CloudBackupMeta>)?.chunkCount || 0))
      : 0;

    let batch = writeBatch(db);
    let ops = 0;
    const flushBatch = async () => {
      if (ops > 0) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    };

    if (!existingMetaSnap.exists()) {
      batch.set(metaRef, {
        ...metaFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(metaRef, {
        schemaVersion: metaFields.schemaVersion,
        chunkCount: metaFields.chunkCount,
        totalTransactions: metaFields.totalTransactions,
        wallets: metaFields.wallets,
        categories: metaFields.categories,
        budgets: metaFields.budgets,
        debts: metaFields.debts,
        goals: metaFields.goals,
        templates: metaFields.templates,
        moneyCircles: metaFields.moneyCircles,
        orgWorkspaces: metaFields.orgWorkspaces,
        activeWorkspace: metaFields.activeWorkspace,
        settings: metaFields.settings,
        hasCompletedOnboarding: metaFields.hasCompletedOnboarding,
        updatedAtMs: metaFields.updatedAtMs,
        updatedAt: serverTimestamp(),
      });
    }
    ops += 1;

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunkRef = doc(db, 'users', uid, 'backupChunks', `chunk_${idx}`);
      batch.set(chunkRef, {
        uid,
        chunkIndex: idx,
        transactions: stripUndefinedDeep(chunks[idx]),
        updatedAt: serverTimestamp(),
      });
      ops += 1;
      if (ops >= 400) {
        await flushBatch();
      }
    }

    for (let idx = chunks.length; idx < previousChunkCount; idx++) {
      const staleRef = doc(db, 'users', uid, 'backupChunks', `chunk_${idx}`);
      batch.delete(staleRef);
      ops += 1;
      if (ops >= 400) {
        await flushBatch();
      }
    }

    await flushBatch();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, metaPath);
  }

  try {
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      await updateDoc(userRef, {
        lastSyncedAt: updatedAtMs,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }

  return { syncedAt: updatedAtMs, updatedAtMs, skippedAttachmentsCount };
}

export async function fetchCloudBackup(uid: string): Promise<CloudBackupPayload | null> {
  const metaPath = `users/${uid}/backup/meta`;
  try {
    const metaSnap = await getDoc(doc(db, 'users', uid, 'backup', 'meta'));
    if (metaSnap.exists()) {
      const meta = metaSnap.data() as CloudBackupMeta;
      const chunkCount = Math.max(0, Number(meta.chunkCount || 0));
      const chunkPromises = Array.from({ length: chunkCount }, (_, idx) =>
        getDoc(doc(db, 'users', uid, 'backupChunks', `chunk_${idx}`))
      );
      const chunkSnaps = await Promise.all(chunkPromises);
      const transactions: AppDatabaseData['transactions'] = [];
      for (const snap of chunkSnaps) {
        if (snap.exists()) {
          const chunkData = snap.data() as { transactions?: AppDatabaseData['transactions'] };
          if (Array.isArray(chunkData.transactions)) {
            transactions.push(...chunkData.transactions);
          }
        }
      }

      return {
        uid: meta.uid,
        schemaVersion: meta.schemaVersion,
        updatedAtMs: Number(meta.updatedAtMs || 0),
        transactions,
        wallets: meta.wallets || [],
        categories: meta.categories || [],
        budgets: meta.budgets || [],
        debts: meta.debts || [],
        goals: meta.goals || [],
        templates: meta.templates || [],
        moneyCircles: meta.moneyCircles || [],
        orgWorkspaces: meta.orgWorkspaces,
        activeWorkspace: meta.activeWorkspace,
        settings: meta.settings,
        hasCompletedOnboarding: Boolean(meta.hasCompletedOnboarding),
      };
    }

    const legacySnap = await getDoc(doc(db, 'users', uid, 'backups', 'latest'));
    if (!legacySnap.exists()) return null;
    return legacySnap.data() as CloudBackupPayload;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, metaPath);
  }
}

export async function syncOrganizationMetaToCloud(orgData: OrgWorkspaceData): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  const org = orgData.organization;
  const orgRef = doc(db, 'organizations', org.id);
  const memberRef = doc(db, 'organizations', org.id, 'members', currentUser.uid);

  try {
    const snap = await getDoc(orgRef);
    const batch = writeBatch(db);
    if (!snap.exists()) {
      batch.set(orgRef, {
        id: org.id,
        name: org.name.slice(0, 120),
        currency: org.currency.slice(0, 8),
        ...(org.industry ? { industry: org.industry } : {}),
        vatRate: org.vatRate,
        ...(org.taxNumber ? { taxNumber: org.taxNumber.slice(0, 64) } : {}),
        approvalThreshold: org.approvalThreshold,
        ...(org.lockedUntilDate ? { lockedUntilDate: org.lockedUntilDate } : {}),
        inviteCode: org.inviteCode,
        ownerUid: currentUser.uid,
        extraSeats: org.extraSeats || 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(memberRef, {
        uid: currentUser.uid,
        email: (currentUser.email || `${currentUser.uid}@firebase.local`).slice(0, 254),
        displayName: (currentUser.displayName || 'Owner').slice(0, 120),
        role: 'owner',
        status: 'active',
        joinedAt: Date.now(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(orgRef, {
        name: org.name.slice(0, 120),
        currency: org.currency.slice(0, 8),
        ...(org.industry ? { industry: org.industry } : {}),
        vatRate: org.vatRate,
        ...(org.taxNumber ? { taxNumber: org.taxNumber.slice(0, 64) } : {}),
        approvalThreshold: org.approvalThreshold,
        ...(org.lockedUntilDate ? { lockedUntilDate: org.lockedUntilDate } : {}),
        inviteCode: org.inviteCode,
        extraSeats: org.extraSeats || 0,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch {
    // Non-fatal offline/local-first org sync
  }
}

export async function redeemProCodeWithServer(code: string): Promise<{
  isPro: boolean;
  proPlan: ProPlanCode;
  planTier: PlanTier;
  billingCycle: BillingCycle;
  expiresAt: number | null;
}> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('AUTH_REQUIRED');
  }
  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/redeem-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ code: code.trim() }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    isPro?: boolean;
    proPlan?: ProPlanCode;
    planTier?: PlanTier;
    billingCycle?: BillingCycle;
    expiresAt?: number | null;
    error?: string;
    message?: string;
  };

  if (!response.ok || !payload.isPro) {
    throw new Error(payload.message || payload.error || 'REDEEM_FAILED');
  }

  return {
    isPro: true,
    proPlan: payload.proPlan || 'code',
    planTier: payload.planTier || 'personal_pro',
    billingCycle: payload.billingCycle || 'lifetime',
    expiresAt: payload.expiresAt ?? null,
  };
}

export async function startBusinessTrialWithServer(): Promise<{
  isPro: boolean;
  proPlan: ProPlanCode;
  planTier: PlanTier;
  billingCycle: BillingCycle;
  expiresAt: number | null;
}> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('AUTH_REQUIRED');
  }
  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/start-business-trial', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    isPro?: boolean;
    proPlan?: ProPlanCode;
    planTier?: PlanTier;
    billingCycle?: BillingCycle;
    expiresAt?: number | null;
    error?: string;
    message?: string;
  };

  if (!response.ok || !payload.isPro) {
    throw new Error(payload.message || payload.error || 'TRIAL_START_FAILED');
  }

  return {
    isPro: true,
    proPlan: payload.proPlan || 'trial',
    planTier: payload.planTier || 'business_pro',
    billingCycle: payload.billingCycle || 'trial',
    expiresAt: payload.expiresAt ?? null,
  };
}

export async function fetchScanQuotaFromServer(): Promise<ScanQuotaInfo | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/scan-quota', {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!response.ok) return null;
  return (await response.json()) as ScanQuotaInfo;
}

export async function deleteAccountFromServer(): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('AUTH_REQUIRED');
  }
  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/delete-account', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(payload.message || payload.error || 'DELETE_ACCOUNT_FAILED');
  }
}

export { onAuthStateChanged };
export type { User as FirebaseUser };
