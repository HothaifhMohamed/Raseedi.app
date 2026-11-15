import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  reauthenticateWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  Firestore,
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  AppDatabaseData,
  enqueuePendingAttachmentUpload,
  loadPendingAttachmentUploads,
  PendingAttachmentUpload,
  removePendingAttachmentUpload,
} from './db';
import { chunkTransactionsForBackup } from './calculations';
import {
  BillingCycle,
  Organization,
  OrganizationIndustry,
  OrganizationInvite,
  OrganizationRole,
  OrgWorkspaceData,
  PlanTier,
  ProPlanCode,
  VerifiedProEntitlement,
} from '../types';

const app = initializeApp(firebaseConfig);

function createFirestoreInstance(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createFirestoreInstance();
export const storage = getStorage(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Optional Firebase App Check initialization (when configured in environment)
const appCheckSiteKey =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_FIREBASE_APPCHECK_SITE_KEY?.trim();
if (appCheckSiteKey && typeof window !== 'undefined') {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('App Check initialization skipped:', err);
  }
}

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

export async function reauthenticateWithGoogle(): Promise<User> {
  if (!auth.currentUser) {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  }
  const result = await reauthenticateWithPopup(auth.currentUser, googleProvider);
  return result.user;
}

export async function signOutGoogle(): Promise<void> {
  await signOut(auth);
}

export async function fetchCloudBackupMeta(
  uid: string
): Promise<{ updatedAtMs: number; chunkCount: number; source: 'chunked' | 'legacy' } | null> {
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (!userSnap.exists()) {
      return null;
    }

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

function compactOrgWorkspacesForMeta(
  orgWorkspaces: Record<string, OrgWorkspaceData>
): Record<string, OrgWorkspaceData> {
  const entries = Object.entries(orgWorkspaces).slice(0, 50);
  const out: Record<string, OrgWorkspaceData> = {};
  for (const [id, ws] of entries) {
    if (!ws || !ws.organization) continue;
    out[id] = {
      ...ws,
      transactions: (ws.transactions || []).slice(0, 200),
      auditLogs: (ws.auditLogs || []).slice(0, 50),
    };
  }
  return out;
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

  // Measure actual UTF-8 byte lengths so every chunk and meta document stays well under 800KB.
  const chunks = buildSafeSizeChunks(sanitizedTransactions, 780_000).slice(0, 99);
  const updatedAtMs = Date.now();

  const rawOrgEntries =
    data.orgWorkspaces &&
    typeof data.orgWorkspaces === 'object' &&
    !Array.isArray(data.orgWorkspaces)
      ? Object.entries(data.orgWorkspaces).slice(0, 50)
      : [];
  const hasOrgWorkspaces = rawOrgEntries.length > 0;
  const cleanActiveWorkspace =
    typeof data.activeWorkspace === 'string' && data.activeWorkspace.trim().length > 0
      ? data.activeWorkspace.trim().slice(0, 128)
      : undefined;

  let orgWorkspacesToSave = hasOrgWorkspaces
    ? stripUndefinedDeep(Object.fromEntries(rawOrgEntries))
    : undefined;

  let metaFields = stripUndefinedDeep({
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
    ...(orgWorkspacesToSave ? { orgWorkspaces: orgWorkspacesToSave } : {}),
    ...(cleanActiveWorkspace ? { activeWorkspace: cleanActiveWorkspace } : {}),
    settings: { ...data.settings, isPro: false },
    hasCompletedOnboarding: Boolean(data.hasCompletedOnboarding),
    updatedAtMs,
  });

  if (getUtf8JsonByteLength(metaFields) > 850_000 && orgWorkspacesToSave) {
    orgWorkspacesToSave = stripUndefinedDeep(compactOrgWorkspacesForMeta(orgWorkspacesToSave));
    metaFields = stripUndefinedDeep({
      ...metaFields,
      orgWorkspaces: orgWorkspacesToSave,
    });
  }

  if (getUtf8JsonByteLength(metaFields) > 850_000) {
    throw new Error('BACKUP_META_TOO_LARGE');
  }

  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists() && auth.currentUser?.uid === uid) {
      await ensureUserProfile(auth.currentUser);
    }
    const existingMetaSnap = await getDoc(metaRef);

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
        ...(metaFields.orgWorkspaces !== undefined
          ? { orgWorkspaces: metaFields.orgWorkspaces }
          : {}),
        ...(metaFields.activeWorkspace !== undefined
          ? { activeWorkspace: metaFields.activeWorkspace }
          : {}),
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

export async function syncOrganizationMetaToCloud(
  uid: string,
  personalData: Omit<AppDatabaseData, 'user'>,
  orgWorkspaces: Record<string, OrgWorkspaceData>,
  activeWorkspace?: string
): Promise<boolean> {
  try {
    if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    await saveCloudBackup(uid, {
      ...personalData,
      orgWorkspaces,
      activeWorkspace: activeWorkspace || 'personal',
    });
    return true;
  } catch {
    return false;
  }
}

export async function fetchCloudBackup(uid: string): Promise<CloudBackupPayload | null> {
  const metaPath = `users/${uid}/backup/meta`;
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (!userSnap.exists()) {
      return null;
    }

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

async function getRequiredIdToken(): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('AUTH_REQUIRED');
  }
  return currentUser.getIdToken();
}

export async function redeemProCodeWithServer(
  code: string,
  orgId?: string
): Promise<{
  isPro: boolean;
  proPlan: ProPlanCode;
  planTier: PlanTier;
  billingCycle: BillingCycle;
  expiresAt: number | null;
}> {
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/redeem-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ code: code.trim(), ...(orgId ? { orgId } : {}) }),
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

export async function startBusinessTrialWithServer(orgId?: string): Promise<{
  isPro: boolean;
  proPlan: ProPlanCode;
  planTier: PlanTier;
  billingCycle: BillingCycle;
  expiresAt: number | null;
}> {
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/start-business-trial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(orgId ? { orgId } : {}),
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

let cachedCloudAdminReady: { value: boolean; checkedAt: number } | null = null;

export async function isCloudAdminReady(forceRefresh = false): Promise<boolean> {
  const now = Date.now();
  if (!forceRefresh && cachedCloudAdminReady && now - cachedCloudAdminReady.checkedAt < 60_000) {
    return cachedCloudAdminReady.value;
  }
  try {
    const response = await fetch('/api/health', { method: 'GET' });
    if (!response.ok) {
      cachedCloudAdminReady = { value: false, checkedAt: now };
      return false;
    }
    const payload = (await response.json().catch(() => ({}))) as { cloudAdminReady?: boolean };
    const ready = payload.cloudAdminReady === true;
    cachedCloudAdminReady = { value: ready, checkedAt: now };
    return ready;
  } catch {
    cachedCloudAdminReady = { value: false, checkedAt: now };
    return false;
  }
}

export async function fetchScanQuotaFromServer(orgId?: string): Promise<ScanQuotaInfo | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  try {
    const idToken = await currentUser.getIdToken();
    const url = orgId ? `/api/scan-quota?orgId=${encodeURIComponent(orgId)}` : '/api/scan-quota';
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (response.ok) {
      return (await response.json()) as ScanQuotaInfo;
    }
  } catch {
    // Fall back to direct user profile entitlement check (e.g. static Vercel hosting)
  }

  try {
    const profile = await fetchUserProfile(currentUser.uid);
    const tier = resolvePlanTierFromProfile(profile);
    const limit = tier === 'business_pro' ? 500 : tier === 'personal_pro' ? 200 : 5;
    return {
      month: new Date().toISOString().slice(0, 7),
      used: 0,
      limit,
      remaining: limit,
      isPro: tier !== 'free',
      planTier: tier,
      expiresAt: profile?.expiresAt ?? null,
      proExpiresAt: profile?.proExpiresAt ?? profile?.expiresAt ?? null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cloud Organization Admin API Clients
// ---------------------------------------------------------------------------
export async function createOrgOnServer(params: {
  name: string;
  currency: string;
  industry: OrganizationIndustry;
  vatRate: number;
  approvalThreshold: number;
  taxNumber?: string;
  loadSampleData?: boolean;
  skipStarterSeed?: boolean;
  preferredOrgId?: string;
}): Promise<{ ok: true; orgId: string; organization: Organization }> {
  const adminReady = await isCloudAdminReady();
  if (!adminReady) {
    throw new Error('CLOUD_ADMIN_UNAVAILABLE');
  }
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/org/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    orgId?: string;
    organization?: Organization;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.ok || !payload.orgId || !payload.organization) {
    throw new Error(payload.message || payload.error || 'ORG_CREATE_FAILED');
  }
  return { ok: true, orgId: payload.orgId, organization: payload.organization };
}

export async function createOrgInviteOnServer(
  orgId: string,
  role: Exclude<OrganizationRole, 'owner'>,
  expiresInDays = 7,
  maxUses = 5
): Promise<{ invite: OrganizationInvite; code: string }> {
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/org/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ orgId, role, expiresInDays, maxUses }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    invite?: OrganizationInvite;
    code?: string;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.ok || !payload.invite || !payload.code) {
    throw new Error(payload.message || payload.error || 'INVITE_CREATE_FAILED');
  }
  return { invite: payload.invite, code: payload.code };
}

export async function fetchOrgInvitesFromServer(orgId: string): Promise<OrganizationInvite[]> {
  const idToken = await getRequiredIdToken();
  const response = await fetch(`/api/org/invites?orgId=${encodeURIComponent(orgId)}`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    invites?: OrganizationInvite[];
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message || payload.error || 'INVITES_LIST_FAILED');
  }
  return Array.isArray(payload.invites) ? payload.invites : [];
}

export async function revokeOrgInviteOnServer(orgId: string, inviteId: string): Promise<void> {
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/org/invite/revoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ orgId, inviteId }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || payload.error || 'INVITE_REVOKE_FAILED');
  }
}

export async function joinOrgByInviteCode(code: string): Promise<{
  orgId: string;
  orgName: string;
  role: OrganizationRole;
  alreadyMember?: boolean;
}> {
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/org/join', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ code: code.trim() }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    orgId?: string;
    orgName?: string;
    role?: OrganizationRole;
    alreadyMember?: boolean;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.ok || !payload.orgId) {
    throw new Error(payload.message || payload.error || 'ORG_JOIN_FAILED');
  }
  return {
    orgId: payload.orgId,
    orgName: payload.orgName || '',
    role: payload.role || 'employee',
    alreadyMember: payload.alreadyMember,
  };
}

export async function manageOrgMemberOnServer(params: {
  orgId: string;
  targetUid: string;
  action: 'change_role' | 'suspend' | 'reactivate' | 'remove' | 'set_spending_limit';
  role?: Exclude<OrganizationRole, 'owner'>;
  spendingLimit?: number | null;
  department?: string;
}): Promise<void> {
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/org/member', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || payload.error || 'MEMBER_UPDATE_FAILED');
  }
}

export async function transferOrgOwnershipOnServer(
  orgId: string,
  newOwnerUid: string
): Promise<void> {
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/org/transfer-ownership', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ orgId, newOwnerUid }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || payload.error || 'TRANSFER_OWNERSHIP_FAILED');
  }
}

export async function deleteOrgOnServer(orgId: string, confirmName: string): Promise<void> {
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/org/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ orgId, confirmName }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || payload.error || 'ORG_DELETE_FAILED');
  }
}

export async function deleteAccountFromServer(): Promise<void> {
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/delete-account', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    const err = new Error(payload.message || payload.error || 'DELETE_ACCOUNT_FAILED') as Error & {
      code?: string;
    };
    err.code = payload.error;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Firebase Storage Org Receipt Attachments & Offline Upload Queue
// ---------------------------------------------------------------------------
const MAX_ORG_ATTACHMENT_BYTES = 2 * 1024 * 1024;

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('FILE_READ_FAILED'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

async function compressImageDataUrl(rawUrl: string): Promise<string> {
  if (typeof document === 'undefined') return rawUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(rawUrl);
    img.onload = () => {
      const maxDim = 1280;
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else if (height >= width && height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = rawUrl;
  });
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const parts = dataUrl.split(',');
  const header = parts[0] || '';
  const body = parts[1] || '';
  const mimeMatch = header.match(/data:([^;]+);base64/i);
  const mimeType = mimeMatch?.[1] || 'image/jpeg';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { blob: new Blob([bytes], { type: mimeType }), mimeType };
}

function sanitizeAttachmentFileName(name: string, mimeType: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'receipt';
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
  if (mimeType === 'application/pdf') return `${base}.pdf`;
  if (mimeType === 'image/png') return `${base}.png`;
  if (mimeType === 'image/webp') return `${base}.webp`;
  return `${base}.jpg`;
}

export async function uploadOrgReceiptAttachment(
  orgId: string,
  txId: string,
  fileOrDataUrl: File | string,
  providedName?: string,
  providedMimeType?: string
): Promise<{ path: string; pendingOffline: boolean; queueId?: string }> {
  let finalDataUrl = '';
  let mimeType = providedMimeType || 'image/jpeg';
  let rawName = providedName || 'receipt';

  if (typeof fileOrDataUrl === 'string') {
    finalDataUrl = fileOrDataUrl;
    if (fileOrDataUrl.startsWith('data:image/')) {
      finalDataUrl = await compressImageDataUrl(fileOrDataUrl);
      mimeType = 'image/jpeg';
    }
  } else {
    rawName = fileOrDataUrl.name || rawName;
    mimeType = fileOrDataUrl.type || mimeType;
    const rawUrl = await fileToDataUrl(fileOrDataUrl);
    if (mimeType.startsWith('image/')) {
      finalDataUrl = await compressImageDataUrl(rawUrl);
      mimeType = 'image/jpeg';
    } else {
      finalDataUrl = rawUrl;
    }
  }

  const { blob, mimeType: resolvedMime } = dataUrlToBlob(finalDataUrl);
  mimeType = resolvedMime;
  if (blob.size > MAX_ORG_ATTACHMENT_BYTES) {
    throw new Error('ATTACHMENT_TOO_LARGE');
  }

  const safeName = sanitizeAttachmentFileName(rawName, mimeType);
  const objectPath = `orgs/${orgId}/receipts/${txId}/${Date.now()}_${safeName}`;

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (!isOffline) {
    try {
      const ref = storageRef(storage, objectPath);
      await uploadBytes(ref, blob, { contentType: mimeType });
      return { path: objectPath, pendingOffline: false };
    } catch (err) {
      console.warn('Attachment upload failed, queueing for retry:', err);
    }
  }

  const queueItem: PendingAttachmentUpload = {
    id: `attq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    orgId,
    txId,
    fileName: safeName,
    mimeType,
    dataUrl: finalDataUrl,
    createdAt: Date.now(),
  };
  await enqueuePendingAttachmentUpload(queueItem);
  return { path: `pending://${queueItem.id}/${safeName}`, pendingOffline: true, queueId: queueItem.id };
}

export async function flushPendingOrgUploads(
  onUploaded?: (item: PendingAttachmentUpload, uploadedPath: string) => Promise<void> | void
): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  if (!auth.currentUser) return 0;
  const pending = await loadPendingAttachmentUploads();
  if (pending.length === 0) return 0;

  let uploadedCount = 0;
  for (const item of pending) {
    try {
      const { blob, mimeType } = dataUrlToBlob(item.dataUrl);
      const objectPath = `orgs/${item.orgId}/receipts/${item.txId}/${Date.now()}_${item.fileName}`;
      await uploadBytes(storageRef(storage, objectPath), blob, { contentType: mimeType });
      await removePendingAttachmentUpload(item.id);
      if (onUploaded) {
        await onUploaded(item, objectPath);
      }
      uploadedCount++;
    } catch {
      // Stop early if network failed again
      break;
    }
  }
  return uploadedCount;
}

export async function resolveOrgAttachmentUrl(path: string): Promise<string> {
  if (!path) return '';
  if (path.startsWith('data:') || path.startsWith('https://') || path.startsWith('http://')) {
    return path;
  }
  if (path.startsWith('pending://')) {
    return '';
  }
  return getDownloadURL(storageRef(storage, path));
}

export { onAuthStateChanged };
export type { User as FirebaseUser };
