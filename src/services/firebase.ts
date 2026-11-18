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
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Firestore,
  DocumentReference,
  DocumentSnapshot,
  Query,
  QuerySnapshot,
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
  Transaction,
  VerifiedProEntitlement,
} from '../types';
import {
  buildWorkspaceTransactionRecord,
  extractTransactionFromWorkspaceDoc,
  getWorkspaceTransactionDocPath,
  getWorkspaceTransactionsPath,
  normalizeValidFirestoreId,
  normalizeWorkspaceId,
  shouldBlockEmptyCloudOverwrite,
} from './workspaceSync';
import { shouldFallbackAccountDeleteError } from './accountDeletion';
import { resolveSafeCloudBackupWrite } from './backupMerge';
import { sortTransactionsDescending } from './orgTransactionQuery';
import { AdminCouponCycle, AdminCouponTier } from './licenseCodes';
import {
  BackupHistoryRecord,
  BackupHistorySummary,
  buildCompactBackupHistorySnapshotJson,
  getBackupIdsToPrune,
  MAX_AUTO_CLOUD_BACKUPS,
} from './backupHistory';
import {
  buildSafeCloudLastSyncedPatch,
  buildSafeUserCurrencyRatesPatch,
  UserCurrencyRatesSyncInput,
} from './currencySync';

const isPlaceholderConfig =
  !firebaseConfig?.projectId ||
  firebaseConfig.projectId === 'remixed-project-id' ||
  !firebaseConfig?.apiKey;

const app = initializeApp(firebaseConfig);

function createFirestoreInstance(): Firestore {
  const databaseId = firebaseConfig.firestoreDatabaseId || undefined;
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
        experimentalAutoDetectLongPolling: true,
        ignoreUndefinedProperties: true,
      },
      databaseId
    );
  } catch {
    try {
      return initializeFirestore(
        app,
        {
          localCache: memoryLocalCache(),
          experimentalAutoDetectLongPolling: true,
          ignoreUndefinedProperties: true,
        },
        databaseId
      );
    } catch {
      return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
    }
  }
}

export const db = createFirestoreInstance();
export const storage = getStorage(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

async function isFirestoreRestReachable(): Promise<boolean> {
  if (isPlaceholderConfig || typeof fetch !== 'function') return false;
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseConfig.projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents/test/connection?key=${encodeURIComponent(
    firebaseConfig.apiKey
  )}`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller?.signal,
    });
    // 200 or 401/403 proves the Firestore project + database exist and rules evaluated the request
    return res.status === 200 || res.status === 401 || res.status === 403;
  } catch {
    return false;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function waitForVisibleAndOnline(): Promise<void> {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    await new Promise<void>((resolve) => {
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', onVisible);
          resolve();
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      setTimeout(() => {
        document.removeEventListener('visibilitychange', onVisible);
        resolve();
      }, 4000);
    });
  }
}

async function testConnection(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (isPlaceholderConfig) {
    console.error('Please check your Firebase configuration.');
    return;
  }
  await waitForVisibleAndOnline();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (retryError) {
        if (
          retryError instanceof Error &&
          retryError.message.includes('the client is offline')
        ) {
          const restReachable = await isFirestoreRestReachable();
          if (restReachable) {
            console.warn(
              'Firestore real-time channel delayed; operating with local cache until sync resumes.'
            );
          } else {
            console.error('Please check your Firebase configuration.');
          }
        }
      }
    }
  }
}
void testConnection();

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
  const serialized = JSON.stringify(errInfo);
  console.error('Firestore Error: ', serialized);
  throw new Error(serialized);
}

export interface CloudUserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  isAdmin?: boolean;
  isPro: boolean;
  proActive?: boolean;
  proPlan?: ProPlanCode;
  planTier?: PlanTier;
  billingCycle?: BillingCycle;
  startedAt?: number | null;
  expiresAt?: number | null;
  proExpiresAt?: number | null;
  hasUsedBusinessTrial?: boolean;
  redeemedCouponCode?: string | null;
  lastSyncedAt?: number;
  currencyRates?: {
    base?: string;
    fetchedAtMs?: number;
    ratesLastUpdated?: string;
    rates?: Record<string, number>;
  };
  settings?: {
    useUpdatedExchangeRates?: boolean;
    ratesLastUpdated?: string;
    ratesUpdatedAtMs?: number;
    customExchangeRates?: Record<string, number>;
  };
}

export function isEntitlementActive(
  entitlement: Pick<VerifiedProEntitlement, 'isPro' | 'proActive' | 'expiresAt' | 'proExpiresAt'> | CloudUserProfile | null | undefined,
  nowMs: number = Date.now()
): boolean {
  const activeFlag = Boolean(entitlement?.isPro || entitlement?.proActive);
  if (!entitlement || !activeFlag) return false;
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
  const rawTier = String(profile.planTier || '').trim().toLowerCase();
  if (
    rawTier === 'business_pro' ||
    rawTier === 'business' ||
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
        proActive: false,
        proPlan: 'free',
        planTier: 'free',
        billingCycle: 'free',
        startedAt: null,
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
      await setDoc(ref, profilePayload, { merge: true });
      return {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || undefined,
        photoURL: firebaseUser.photoURL || undefined,
        isPro: false,
        proActive: false,
        proPlan: 'free',
        planTier: 'free',
        billingCycle: 'free',
        startedAt: null,
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

    await setDoc(ref, updates, { merge: true });
    const active = isEntitlementActive(existingData);
    const resolvedExpiry = existingData.proExpiresAt ?? existingData.expiresAt ?? null;
    return {
      ...existingData,
      isPro: active,
      proActive: active,
      proPlan: existingData.proPlan || (active ? 'code' : 'free'),
      planTier: resolvePlanTierFromProfile({ ...existingData, isPro: active }),
      billingCycle: existingData.billingCycle || (active ? 'lifetime' : 'free'),
      startedAt: existingData.startedAt ?? null,
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

function mapCloudUserProfile(docId: string, data: Record<string, unknown>): CloudUserProfile {
  const raw = data as unknown as CloudUserProfile;
  const active = isEntitlementActive(raw);
  const resolvedExpiry = raw.proExpiresAt ?? raw.expiresAt ?? null;
  return {
    ...raw,
    uid: raw.uid || docId,
    email: raw.email || '',
    isPro: active,
    proActive: active,
    proPlan: raw.proPlan || (active ? 'code' : 'free'),
    planTier: resolvePlanTierFromProfile({ ...raw, isPro: active }),
    billingCycle: raw.billingCycle || (active ? 'lifetime' : 'free'),
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : null,
    expiresAt: resolvedExpiry,
    proExpiresAt: resolvedExpiry,
  };
}

export async function fetchUserProfile(uid: string): Promise<CloudUserProfile | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    return mapCloudUserProfile(snap.id, snap.data() as Record<string, unknown>);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeUserProfile(
  uid: string,
  onProfile: (profile: CloudUserProfile | null, fromCache: boolean) => void
): () => void {
  if (!uid) return () => {};
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onProfile(null, snap.metadata.fromCache);
        return;
      }
      onProfile(
        mapCloudUserProfile(snap.id, snap.data() as Record<string, unknown>),
        snap.metadata.fromCache
      );
    },
    (error) => {
      console.warn('User profile snapshot warning:', error);
    }
  );
}

export class ServerApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export async function fetchAdminStatusFromServer(): Promise<{ isAdmin: boolean }> {
  const currentUser = auth.currentUser;
  if (!currentUser) return { isAdmin: false };
  try {
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/status', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (!response.ok) return { isAdmin: false };
    const payload = (await response.json().catch(() => ({}))) as {
      isAdmin?: boolean;
      claimsUpdated?: boolean;
    };
    if (payload.isAdmin && payload.claimsUpdated && auth.currentUser) {
      await auth.currentUser.getIdToken(true).catch(() => undefined);
    }
    return { isAdmin: Boolean(payload.isAdmin) };
  } catch {
    return { isAdmin: false };
  }
}

export async function verifyAdminPasscodeOnServer(
  passcode: string
): Promise<{ adminSessionToken: string; expiresAt: number }> {
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/admin/verify-passcode', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ passcode: passcode.trim() }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    adminSessionToken?: string;
    expiresAt?: number;
    claimsUpdated?: boolean;
    error?: string;
    message?: string;
  };

  if (!response.ok || !payload.adminSessionToken) {
    throw new ServerApiError(
      payload.error || 'VERIFY_PASSCODE_FAILED',
      payload.message || payload.error || 'VERIFY_PASSCODE_FAILED',
      response.status
    );
  }

  if (payload.claimsUpdated && auth.currentUser) {
    await auth.currentUser.getIdToken(true).catch(() => undefined);
  }

  return {
    adminSessionToken: payload.adminSessionToken,
    expiresAt: Number(payload.expiresAt || 0),
  };
}

export async function fetchAllUsersForAdmin(
  adminSessionToken: string
): Promise<CloudUserProfile[]> {
  if (!adminSessionToken) {
    throw new ServerApiError('ADMIN_SESSION_REQUIRED', 'ADMIN_SESSION_REQUIRED', 403);
  }
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/admin/users', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'X-Admin-Session': adminSessionToken,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    users?: CloudUserProfile[];
    error?: string;
    message?: string;
  };

  if (!response.ok || !Array.isArray(payload.users)) {
    throw new ServerApiError(
      payload.error || 'ADMIN_USERS_LIST_FAILED',
      payload.message || payload.error || 'ADMIN_USERS_LIST_FAILED',
      response.status
    );
  }

  return payload.users.map((row) => ({
    ...row,
    proActive: Boolean(row.proActive ?? row.isPro),
    proExpiresAt: row.proExpiresAt ?? row.expiresAt ?? null,
  }));
}

export async function adminUpdateUserSubscription(params: {
  targetUid: string;
  planTier: PlanTier;
  billingCycle: 'free' | 'monthly' | 'yearly' | 'lifetime';
  customDays?: number | null;
  adminSessionToken: string;
}): Promise<CloudUserProfile> {
  if (!params.adminSessionToken) {
    throw new ServerApiError('ADMIN_SESSION_REQUIRED', 'ADMIN_SESSION_REQUIRED', 403);
  }
  const idToken = await getRequiredIdToken();
  const response = await fetch(
    `/api/admin/users/${encodeURIComponent(params.targetUid)}/subscription`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'X-Admin-Session': params.adminSessionToken,
      },
      body: JSON.stringify({
        planTier: params.planTier,
        billingCycle: params.billingCycle,
        ...(params.customDays && params.customDays > 0 ? { customDays: params.customDays } : {}),
      }),
    }
  );

  const payload = (await response.json().catch(() => ({}))) as Partial<CloudUserProfile> & {
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new ServerApiError(
      payload.error || 'ADMIN_UPDATE_SUBSCRIPTION_FAILED',
      payload.message || payload.error || 'ADMIN_UPDATE_SUBSCRIPTION_FAILED',
      response.status
    );
  }

  return {
    uid: payload.uid || params.targetUid,
    email: payload.email || '',
    isPro: Boolean(payload.isPro),
    proActive: Boolean(payload.proActive ?? payload.isPro),
    proPlan: payload.proPlan || 'free',
    planTier: payload.planTier || params.planTier,
    billingCycle: payload.billingCycle || params.billingCycle,
    startedAt: payload.startedAt ?? null,
    expiresAt: payload.expiresAt ?? null,
    proExpiresAt: payload.proExpiresAt ?? payload.expiresAt ?? null,
    redeemedCouponCode: payload.redeemedCouponCode ?? null,
  };
}

export async function adminCancelUserSubscription(
  targetUid: string,
  adminSessionToken: string
): Promise<CloudUserProfile> {
  return adminUpdateUserSubscription({
    targetUid,
    planTier: 'free',
    billingCycle: 'free',
    adminSessionToken,
  });
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

export function isOfflineFirestoreError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: unknown }).code || '').toLowerCase();
  const msg = String((err as { message?: unknown }).message || '').toLowerCase();
  return (
    code === 'unavailable' ||
    msg.includes('client is offline') ||
    msg.includes('offline') ||
    msg.includes('failed to get document because the client is offline')
  );
}

async function getDocServerFirst<T>(
  ref: DocumentReference<T>,
  forceServer = false
): Promise<DocumentSnapshot<T>> {
  try {
    return await getDocFromServer(ref);
  } catch (err) {
    if (forceServer || !isOfflineFirestoreError(err)) {
      throw err;
    }
    return getDoc(ref);
  }
}

async function getDocsServerFirst<T>(
  q: Query<T>,
  forceServer = false
): Promise<QuerySnapshot<T>> {
  try {
    return await getDocsFromServer(q);
  } catch (err) {
    if (forceServer || !isOfflineFirestoreError(err)) {
      throw err;
    }
    return getDocs(q);
  }
}

export async function fetchCloudBackupMeta(
  uid: string,
  options?: { forceServer?: boolean }
): Promise<{
  updatedAtMs: number;
  chunkCount: number;
  source: 'chunked' | 'legacy';
  totalTransactions?: number;
} | null> {
  const forceServer = Boolean(options?.forceServer);
  try {
    const userSnap = await getDocServerFirst(doc(db, 'users', uid), forceServer);
    if (!userSnap.exists()) {
      return null;
    }

    const metaSnap = await getDocServerFirst(doc(db, 'users', uid, 'backup', 'meta'), forceServer);
    if (metaSnap.exists()) {
      const data = metaSnap.data() as Partial<CloudBackupMeta>;
      return {
        updatedAtMs: Number(data.updatedAtMs || 0),
        chunkCount: Number(data.chunkCount || 0),
        totalTransactions: Number(data.totalTransactions || 0),
        source: 'chunked',
      };
    }

    const legacySnap = await getDocServerFirst(doc(db, 'users', uid, 'backups', 'latest'), forceServer);
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
    console.error('[fetchCloudBackupMeta] Firestore error:', error);
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
  },
  options?: {
    source?: 'auto' | 'manual';
    recordHistory?: boolean;
    allowEmptyOverwrite?: boolean;
  }
): Promise<{
  syncedAt: number;
  updatedAtMs: number;
  skippedAttachmentsCount: number;
  blockedEmptyOverwrite?: boolean;
}> {
  const metaPath = `users/${uid}/backup/meta`;
  const metaRef = doc(db, 'users', uid, 'backup', 'meta');
  const userRef = doc(db, 'users', uid);

  let effectiveData: Omit<AppDatabaseData, 'user'> & {
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
  } = data;

  let existingMetaSnap: Awaited<ReturnType<typeof getDoc>> | null = null;
  try {
    const userSnap = await getDocServerFirst(userRef, false);
    if (!userSnap.exists() && auth.currentUser?.uid === uid) {
      await ensureUserProfile(auth.currentUser);
    }
    existingMetaSnap = await getDocServerFirst(metaRef, false);

    const existingMetaData = existingMetaSnap.exists()
      ? (existingMetaSnap.data() as Partial<CloudBackupMeta>)
      : null;
    const cloudTotalTx = Number(existingMetaData?.totalTransactions || 0);
    const localTxCount = (effectiveData.transactions || []).length;

    // Zero-Data Overwrite Protection: check both legacy meta AND unified workspace collections
    // so an empty local cache can NEVER wipe non-empty cloud transactions.
    if (localTxCount === 0 && !options?.allowEmptyOverwrite) {
      const activeWsToCheck = normalizeWorkspaceId(effectiveData.activeWorkspace || 'personal');
      const [hasPersonalUnified, hasActiveUnified] = await Promise.all([
        hasWorkspaceTransactionsInCloud(uid, 'personal').catch(() => false),
        activeWsToCheck !== 'personal'
          ? hasWorkspaceTransactionsInCloud(uid, activeWsToCheck).catch(() => false)
          : Promise.resolve(false),
      ]);
      const hasAnyUnified = hasPersonalUnified || hasActiveUnified;

      if (
        shouldBlockEmptyCloudOverwrite({
          localTransactionsCount: localTxCount,
          cloudBackupTransactionsCount: cloudTotalTx,
          hasUnifiedCloudTransactions: hasAnyUnified,
          allowEmptyOverwrite: Boolean(options?.allowEmptyOverwrite),
        })
      ) {
        const source = options?.source === 'manual' ? 'manual' : 'auto';
        const [existingCloudData, unifiedPersonalTxs] =
          source === 'manual'
            ? await Promise.all([
                fetchCloudBackup(uid).catch(() => null),
                hasPersonalUnified
                  ? fetchWorkspaceTransactionsCloud(uid, 'personal', { forceServer: false }).catch(
                      () => []
                    )
                  : Promise.resolve([]),
              ])
            : [null, []];

        const preservedCloudPayload = existingCloudData
          ? {
              ...existingCloudData,
              transactions:
                unifiedPersonalTxs.length > 0
                  ? unifiedPersonalTxs
                  : existingCloudData.transactions,
            }
          : unifiedPersonalTxs.length > 0
          ? {
              transactions: unifiedPersonalTxs,
              wallets: existingMetaData?.wallets || [],
              categories: existingMetaData?.categories || [],
              budgets: existingMetaData?.budgets || [],
              debts: existingMetaData?.debts || [],
              goals: existingMetaData?.goals || [],
              templates: existingMetaData?.templates || [],
              moneyCircles: existingMetaData?.moneyCircles || [],
              orgWorkspaces: existingMetaData?.orgWorkspaces,
              activeWorkspace: existingMetaData?.activeWorkspace,
              settings: effectiveData.settings,
              hasCompletedOnboarding: true,
            }
          : null;

        const decision = resolveSafeCloudBackupWrite({
          localData: effectiveData,
          existingCloud: {
            totalTransactions: Math.max(cloudTotalTx, unifiedPersonalTxs.length, hasAnyUnified ? 1 : 0),
            data: preservedCloudPayload,
          },
          source,
          allowEmptyOverwrite: Boolean(options?.allowEmptyOverwrite),
        });

        if (decision.action === 'skip_empty_local') {
          console.warn(
            '[saveCloudBackup] Prevented overwriting non-empty cloud/unified data with empty local transactions.'
          );
          const preservedUpdatedAtMs = Number(existingMetaData?.updatedAtMs || 0);
          return {
            syncedAt: preservedUpdatedAtMs,
            updatedAtMs: preservedUpdatedAtMs,
            skippedAttachmentsCount: 0,
            blockedEmptyOverwrite: true,
          };
        }

        effectiveData = decision.mergedData;
      }
    }

    if (
      existingMetaData &&
      (effectiveData.wallets || []).length === 0 &&
      Array.isArray(existingMetaData.wallets) &&
      existingMetaData.wallets.length > 0 &&
      !options?.allowEmptyOverwrite
    ) {
      effectiveData = {
        ...effectiveData,
        wallets: existingMetaData.wallets,
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, metaPath);
  }

  let skippedAttachmentsCount = 0;
  const sanitizedTransactions = (effectiveData.transactions || []).slice(0, 40000).map((tx) => {
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
    effectiveData.orgWorkspaces &&
    typeof effectiveData.orgWorkspaces === 'object' &&
    !Array.isArray(effectiveData.orgWorkspaces)
      ? Object.entries(effectiveData.orgWorkspaces).slice(0, 50)
      : [];
  const hasOrgWorkspaces = rawOrgEntries.length > 0;
  const cleanActiveWorkspace =
    typeof effectiveData.activeWorkspace === 'string' &&
    effectiveData.activeWorkspace.trim().length > 0
      ? effectiveData.activeWorkspace.trim().slice(0, 128)
      : undefined;

  const hasExplicitOrgWorkspacesMap =
    effectiveData.orgWorkspaces !== undefined &&
    effectiveData.orgWorkspaces !== null &&
    typeof effectiveData.orgWorkspaces === 'object' &&
    !Array.isArray(effectiveData.orgWorkspaces);

  let orgWorkspacesToSave = hasOrgWorkspaces
    ? stripUndefinedDeep(Object.fromEntries(rawOrgEntries))
    : hasExplicitOrgWorkspacesMap
    ? {}
    : undefined;

  let metaFields = stripUndefinedDeep({
    uid,
    schemaVersion: 2,
    chunkCount: chunks.length,
    totalTransactions: sanitizedTransactions.length,
    wallets: (effectiveData.wallets || []).slice(0, 200),
    categories: (effectiveData.categories || []).slice(0, 300),
    budgets: (effectiveData.budgets || []).slice(0, 200),
    debts: (effectiveData.debts || []).slice(0, 500),
    goals: (effectiveData.goals || []).slice(0, 200),
    templates: (effectiveData.templates || []).slice(0, 300),
    moneyCircles: (effectiveData.moneyCircles || []).slice(0, 200),
    ...(orgWorkspacesToSave !== undefined ? { orgWorkspaces: orgWorkspacesToSave } : {}),
    ...(cleanActiveWorkspace ? { activeWorkspace: cleanActiveWorkspace } : {}),
    settings: { ...effectiveData.settings, isPro: false },
    hasCompletedOnboarding: Boolean(effectiveData.hasCompletedOnboarding),
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
    const metaExists = Boolean(existingMetaSnap?.exists());
    const previousChunkCount = metaExists
      ? Math.max(
          0,
          Number((existingMetaSnap?.data() as Partial<CloudBackupMeta>)?.chunkCount || 0)
        )
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

    batch.set(
      metaRef,
      {
        ...metaFields,
        ...(!metaExists ? { createdAt: serverTimestamp() } : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    ops += 1;

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunkRef = doc(db, 'users', uid, 'backupChunks', `chunk_${idx}`);
      batch.set(
        chunkRef,
        {
          uid,
          chunkIndex: idx,
          transactions: stripUndefinedDeep(chunks[idx]),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
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
    if (!userSnap.exists() && auth.currentUser?.uid === uid) {
      await ensureUserProfile(auth.currentUser);
    }
    await setDoc(
      userRef,
      {
        ...buildSafeCloudLastSyncedPatch(updatedAtMs),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }

  if (options?.recordHistory !== false) {
    try {
      const source = options?.source === 'manual' ? 'manual' : 'auto';
      const historyId = `${source}_${updatedAtMs}`;
      const { snapshotJson, storedTransactionsCount } = buildCompactBackupHistorySnapshotJson({
        ...effectiveData,
        updatedAtMs,
      });

      const historyRef = doc(db, 'users', uid, 'backupHistory', historyId);
      await setDoc(historyRef, {
        id: historyId,
        uid,
        source,
        createdAtMs: updatedAtMs,
        totalTransactions: (effectiveData.transactions || []).length,
        storedTransactionsCount,
        walletsCount: (effectiveData.wallets || []).length,
        snapshotJson,
        createdAt: serverTimestamp(),
      });

      const histQuery = query(
        collection(db, 'users', uid, 'backupHistory'),
        orderBy('createdAtMs', 'desc'),
        limit(30)
      );
      const histSnap = await getDocs(histQuery);
      const existingEntries = histSnap.docs.map((d) => {
        const docData = d.data() as Partial<BackupHistorySummary>;
        return {
          id: d.id,
          createdAtMs: Number(docData.createdAtMs || 0),
        };
      });
      const idsToPrune = getBackupIdsToPrune(existingEntries, MAX_AUTO_CLOUD_BACKUPS);
      if (idsToPrune.length > 0) {
        const pruneBatch = writeBatch(db);
        for (const staleId of idsToPrune) {
          pruneBatch.delete(doc(db, 'users', uid, 'backupHistory', staleId));
        }
        await pruneBatch.commit();
      }
    } catch (historyErr) {
      console.warn('Cloud backup history snapshot skipped:', historyErr);
    }
  }

  return { syncedAt: updatedAtMs, updatedAtMs, skippedAttachmentsCount };
}

/**
 * Syncs only exchange rates and currency preferences into users/{uid} using setDoc(..., { merge: true })
 * without touching protected subscription/system fields or overwriting the root document.
 */
export async function syncUserCurrencyRatesToCloud(
  uid: string,
  input: UserCurrencyRatesSyncInput
): Promise<void> {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) return;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await ensureUserProfile(auth.currentUser);
    }
    const patch = buildSafeUserCurrencyRatesPatch(input);
    await setDoc(
      userRef,
      {
        ...patch,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function fetchCloudBackupHistory(
  uid: string,
  options?: { forceServer?: boolean }
): Promise<BackupHistorySummary[]> {
  const historyPath = `users/${uid}/backupHistory`;
  const forceServer = Boolean(options?.forceServer);
  try {
    // Query collection without orderBy to avoid index requirements; sort client-side
    const snap = await getDocsServerFirst(
      collection(db, 'users', uid, 'backupHistory'),
      forceServer
    );
    return snap.docs
      .map((d) => {
        const data = d.data() as Partial<BackupHistoryRecord>;
        return {
          id: d.id,
          uid,
          source: (data.source === 'manual' ? 'manual' : 'auto') as 'manual' | 'auto',
          createdAtMs: Number(data.createdAtMs || 0),
          totalTransactions: Number(data.totalTransactions || 0),
          storedTransactionsCount: Number(data.storedTransactionsCount || 0),
          walletsCount: Number(data.walletsCount || 0),
        };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, MAX_AUTO_CLOUD_BACKUPS);
  } catch (error) {
    console.error('[fetchCloudBackupHistory] Firestore error:', error);
    handleFirestoreError(error, OperationType.LIST, historyPath);
  }
}

export async function fetchLatestCloudBackupFromHistory(
  uid: string,
  options?: { forceServer?: boolean }
): Promise<CloudBackupPayload | null> {
  const historyList = await fetchCloudBackupHistory(uid, options).catch(() => []);
  const richest = [...historyList]
    .filter((entry) => entry.totalTransactions > 0 || entry.storedTransactionsCount > 0)
    .sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
  if (!richest) return null;
  return fetchCloudBackupFromHistory(uid, richest.id);
}

export async function fetchCloudBackupFromHistory(
  uid: string,
  backupId: string
): Promise<CloudBackupPayload | null> {
  const path = `users/${uid}/backupHistory/${backupId}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'backupHistory', backupId));
    if (!snap.exists()) return null;
    const data = snap.data() as Partial<BackupHistoryRecord>;
    if (!data.snapshotJson) return null;
    const parsed = JSON.parse(data.snapshotJson) as Partial<CloudBackupPayload>;
    return {
      uid,
      schemaVersion: Number(parsed.schemaVersion || 2),
      updatedAtMs: Number(parsed.updatedAtMs || data.createdAtMs || Date.now()),
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      wallets: Array.isArray(parsed.wallets) ? parsed.wallets : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      budgets: Array.isArray(parsed.budgets) ? parsed.budgets : [],
      debts: Array.isArray(parsed.debts) ? parsed.debts : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      templates: Array.isArray(parsed.templates) ? parsed.templates : [],
      moneyCircles: Array.isArray(parsed.moneyCircles) ? parsed.moneyCircles : [],
      orgWorkspaces: parsed.orgWorkspaces,
      activeWorkspace: parsed.activeWorkspace,
      settings: parsed.settings as AppDatabaseData['settings'],
      hasCompletedOnboarding: Boolean(parsed.hasCompletedOnboarding ?? true),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function syncOrganizationMetaToCloud(
  uid: string,
  personalData: Omit<AppDatabaseData, 'user'>,
  orgWorkspaces: Record<string, OrgWorkspaceData>,
  activeWorkspace?: string
): Promise<number | null> {
  try {
    if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) return null;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
    const res = await saveCloudBackup(
      uid,
      {
        ...personalData,
        orgWorkspaces,
        activeWorkspace: activeWorkspace || 'personal',
      },
      { source: 'auto', recordHistory: true }
    );
    return res.updatedAtMs;
  } catch {
    return null;
  }
}

export async function fetchCloudBackup(
  uid: string,
  options?: { forceServer?: boolean }
): Promise<CloudBackupPayload | null> {
  const metaPath = `users/${uid}/backup/meta`;
  const forceServer = Boolean(options?.forceServer);
  try {
    const userSnap = await getDocServerFirst(doc(db, 'users', uid), forceServer);
    if (!userSnap.exists()) {
      return null;
    }

    const metaSnap = await getDocServerFirst(doc(db, 'users', uid, 'backup', 'meta'), forceServer);
    if (metaSnap.exists()) {
      const meta = metaSnap.data() as CloudBackupMeta;
      // Fetch all backupChunks without orderBy so all stored chunks are recovered reliably from server
      const allChunksSnap = await getDocsServerFirst(
        collection(db, 'users', uid, 'backupChunks'),
        forceServer
      );
      const sortedChunkDocs = [...allChunksSnap.docs].sort((a, b) => {
        const idxA = Number((a.data() as { chunkIndex?: number })?.chunkIndex ?? 0);
        const idxB = Number((b.data() as { chunkIndex?: number })?.chunkIndex ?? 0);
        return idxA - idxB;
      });
      const transactions: AppDatabaseData['transactions'] = [];
      for (const snap of sortedChunkDocs) {
        const chunkData = snap.data() as { transactions?: AppDatabaseData['transactions'] };
        if (Array.isArray(chunkData.transactions)) {
          transactions.push(...chunkData.transactions);
        }
      }

      const sortedTransactions = sortTransactionsDescending(transactions);

      return {
        uid: meta.uid,
        schemaVersion: meta.schemaVersion,
        updatedAtMs: Number(meta.updatedAtMs || 0),
        transactions: sortedTransactions,
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

    const legacySnap = await getDocServerFirst(doc(db, 'users', uid, 'backups', 'latest'), forceServer);
    if (!legacySnap.exists()) return null;
    const legacy = legacySnap.data() as CloudBackupPayload;
    return {
      ...legacy,
      transactions: sortTransactionsDescending(legacy.transactions || []),
    };
  } catch (error) {
    console.error('[fetchCloudBackup] Firestore error:', error);
    handleFirestoreError(error, OperationType.GET, metaPath);
  }
}

// =============================================================================
// Unified Workspace Transactions Path:
// users/{uid}/workspaces/{workspaceId}/transactions/{txId}
// =============================================================================

export async function upsertWorkspaceTransactionCloud(
  uid: string,
  workspaceId: string,
  tx: Transaction,
  options?: { isNew?: boolean }
): Promise<void> {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) return;
  const safeWs = normalizeWorkspaceId(workspaceId);
  const { record } = buildWorkspaceTransactionRecord(uid, safeWs, tx);
  const docPath = getWorkspaceTransactionDocPath(uid, safeWs, record.id);
  const ref = doc(db, 'users', uid, 'workspaces', safeWs, 'transactions', record.id);

  try {
    await setDoc(
      ref,
      {
        ...record,
        ...(options?.isNew ? { createdAt: serverTimestamp() } : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

export async function batchUpsertWorkspaceTransactionsCloud(
  uid: string,
  workspaceId: string,
  txs: Transaction[]
): Promise<number> {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid || txs.length === 0) return 0;
  const safeWs = normalizeWorkspaceId(workspaceId);
  const colPath = getWorkspaceTransactionsPath(uid, safeWs);

  try {
    let batch = writeBatch(db);
    let ops = 0;
    let written = 0;

    for (const tx of txs) {
      if (!tx || !tx.id) continue;
      const { record } = buildWorkspaceTransactionRecord(uid, safeWs, tx);
      const ref = doc(db, 'users', uid, 'workspaces', safeWs, 'transactions', record.id);
      batch.set(
        ref,
        {
          ...record,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      ops += 1;
      written += 1;
      if (ops >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    }

    if (ops > 0) {
      await batch.commit();
    }
    return written;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, colPath);
  }
}

export async function deleteWorkspaceTransactionCloud(
  uid: string,
  workspaceId: string,
  txId: string
): Promise<void> {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid || !txId) return;
  const safeWs = normalizeWorkspaceId(workspaceId);
  const safeId = normalizeValidFirestoreId(txId, 'tx');
  const docPath = getWorkspaceTransactionDocPath(uid, safeWs, safeId);
  const ref = doc(db, 'users', uid, 'workspaces', safeWs, 'transactions', safeId);

  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export async function batchDeleteWorkspaceTransactionsCloud(
  uid: string,
  workspaceId: string,
  txIds: string[]
): Promise<void> {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid || txIds.length === 0) return;
  const safeWs = normalizeWorkspaceId(workspaceId);
  const colPath = getWorkspaceTransactionsPath(uid, safeWs);

  try {
    let batch = writeBatch(db);
    let ops = 0;

    for (const rawId of txIds) {
      if (!rawId) continue;
      const safeId = normalizeValidFirestoreId(rawId, 'tx');
      batch.delete(doc(db, 'users', uid, 'workspaces', safeWs, 'transactions', safeId));
      ops += 1;
      if (ops >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    }

    if (ops > 0) {
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, colPath);
  }
}

export async function fetchWorkspaceTransactionsCloud(
  uid: string,
  workspaceId: string,
  options?: { forceServer?: boolean }
): Promise<Transaction[]> {
  const safeWs = normalizeWorkspaceId(workspaceId);
  const colPath = getWorkspaceTransactionsPath(uid, safeWs);
  const forceServer = Boolean(options?.forceServer);

  try {
    // Un-ordered collection read + client-side descending sort prevents index errors
    const snap = await getDocsServerFirst(
      collection(db, 'users', uid, 'workspaces', safeWs, 'transactions'),
      forceServer
    );
    const items: Transaction[] = [];
    for (const d of snap.docs) {
      const tx = extractTransactionFromWorkspaceDoc(d.data() as Record<string, unknown>, safeWs);
      if (tx) items.push(tx);
    }
    return sortTransactionsDescending(items);
  } catch (error) {
    console.error(`[fetchWorkspaceTransactionsCloud] (${colPath}) error:`, error);
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

export async function hasWorkspaceTransactionsInCloud(
  uid: string,
  workspaceId = 'personal'
): Promise<boolean> {
  if (!uid) return false;
  const safeWs = normalizeWorkspaceId(workspaceId);
  const colPath = getWorkspaceTransactionsPath(uid, safeWs);
  try {
    const snap = await getDocsServerFirst(
      query(collection(db, 'users', uid, 'workspaces', safeWs, 'transactions'), limit(1)),
      false
    );
    return snap.docs.some((d) => {
      const tx = extractTransactionFromWorkspaceDoc(d.data() as Record<string, unknown>, safeWs);
      return Boolean(tx);
    });
  } catch (error) {
    console.warn(`[hasWorkspaceTransactionsInCloud] (${colPath}) check warning:`, error);
    return false;
  }
}

export function subscribeWorkspaceTransactions(
  uid: string,
  workspaceId: string,
  onData: (
    transactions: Transaction[],
    meta: { fromCache: boolean; hasPendingWrites: boolean; pendingIds: string[] }
  ) => void,
  onError?: (error: Error) => void
): () => void {
  const safeWs = normalizeWorkspaceId(workspaceId);
  const colPath = getWorkspaceTransactionsPath(uid, safeWs);
  const colRef = collection(db, 'users', uid, 'workspaces', safeWs, 'transactions');

  return onSnapshot(
    colRef,
    { includeMetadataChanges: true },
    (snap) => {
      const items: Transaction[] = [];
      const pendingIds: string[] = [];
      for (const d of snap.docs) {
        if (d.metadata.hasPendingWrites) {
          pendingIds.push(d.id);
        }
        const tx = extractTransactionFromWorkspaceDoc(d.data() as Record<string, unknown>, safeWs);
        if (tx) items.push(tx);
      }
      onData(sortTransactionsDescending(items), {
        fromCache: snap.metadata.fromCache,
        hasPendingWrites: snap.metadata.hasPendingWrites,
        pendingIds,
      });
    },
    (error) => {
      console.error(`[subscribeWorkspaceTransactions] (${colPath}) error:`, error);
      const errObj =
        error instanceof Error ? error : new Error(String(error || 'Workspace sync failed'));
      onError?.(errObj);
    }
  );
}

export async function deleteWorkspaceTransactionsCloud(
  uid: string,
  workspaceId: string
): Promise<void> {
  const safeUid = (uid || '').trim();
  const safeWs = normalizeWorkspaceId(workspaceId);
  if (!safeUid || !safeWs || safeWs === 'personal') return;
  if (!auth.currentUser || auth.currentUser.uid !== safeUid) return;

  try {
    const colRef = collection(db, 'users', safeUid, 'workspaces', safeWs, 'transactions');
    const snap = await getDocs(colRef);
    if (snap.empty) return;
    for (let i = 0; i < snap.docs.length; i += 350) {
      const batch = writeBatch(db);
      for (const d of snap.docs.slice(i, i + 350)) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }
  } catch (error) {
    console.warn(`[deleteWorkspaceTransactionsCloud] (${safeWs}) warning:`, error);
  }
}

export async function removeOrgWorkspaceFromBackupMeta(
  uid: string,
  orgId: string
): Promise<void> {
  const safeUid = (uid || '').trim();
  const cleanOrgId = (orgId || '').trim();
  if (!safeUid || !cleanOrgId) return;
  if (!auth.currentUser || auth.currentUser.uid !== safeUid) return;

  try {
    const metaRef = doc(db, 'users', safeUid, 'backup', 'meta');
    const metaSnap = await getDoc(metaRef);
    if (!metaSnap.exists()) return;
    const raw = metaSnap.data() as Record<string, unknown>;
    const existingOrgs =
      raw.orgWorkspaces &&
      typeof raw.orgWorkspaces === 'object' &&
      !Array.isArray(raw.orgWorkspaces)
        ? (raw.orgWorkspaces as Record<string, OrgWorkspaceData>)
        : null;

    let changed = false;
    const nextOrgs: Record<string, OrgWorkspaceData> = {};
    if (existingOrgs) {
      for (const [k, ws] of Object.entries(existingOrgs)) {
        if (k === cleanOrgId || ws?.organization?.id === cleanOrgId) {
          changed = true;
          continue;
        }
        nextOrgs[k] = ws;
      }
    }

    const activeWasDeleted = raw.activeWorkspace === cleanOrgId;
    if (!changed && !activeWasDeleted) return;

    await setDoc(
      metaRef,
      {
        ...(changed ? { orgWorkspaces: stripUndefinedDeep(nextOrgs) } : {}),
        ...(activeWasDeleted ? { activeWorkspace: 'personal' } : {}),
        updatedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.warn(`[removeOrgWorkspaceFromBackupMeta] (${cleanOrgId}) warning:`, error);
  }
}

async function getRequiredIdToken(): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('AUTH_REQUIRED');
  }
  return currentUser.getIdToken();
}

export async function previewProCodeWithServer(
  code: string,
  orgId?: string
): Promise<{
  valid: boolean;
  tier?: AdminCouponTier;
  planTier?: PlanTier;
  proPlan?: ProPlanCode;
  billingCycle?: AdminCouponCycle;
  expiresAt?: number | null;
}> {
  const currentUser = auth.currentUser;
  if (!currentUser) return { valid: false };
  try {
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/redeem-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        code: code.trim(),
        preview: true,
        ...(orgId ? { orgId } : {}),
      }),
    });

    if (!response.ok) return { valid: false };
    const payload = (await response.json().catch(() => ({}))) as {
      valid?: boolean;
      preview?: boolean;
      tier?: AdminCouponTier;
      planTier?: PlanTier;
      proPlan?: ProPlanCode;
      billingCycle?: AdminCouponCycle;
      expiresAt?: number | null;
    };

    if (!payload.valid && !payload.preview) return { valid: false };
    return {
      valid: true,
      tier: payload.tier === 'business' ? 'business' : 'pro',
      planTier: payload.planTier,
      proPlan: payload.proPlan,
      billingCycle: payload.billingCycle,
      expiresAt: payload.expiresAt ?? null,
    };
  } catch {
    return { valid: false };
  }
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
  isCumulativeRenewal?: boolean;
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
    isCumulativeRenewal?: boolean;
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
    isCumulativeRenewal: Boolean(payload.isCumulativeRenewal),
  };
}

export interface ServerLicenseCodeRecord {
  codeHash: string;
  codePreview: string;
  tier: AdminCouponTier;
  planTier: PlanTier;
  cycle: AdminCouponCycle;
  status: 'unused' | 'used';
  used: boolean;
  usedBy: string | null;
  usedOrgId: string | null;
  usedAt: number | null;
  createdByUid: string;
  createdByEmail: string;
  createdAtMs: number;
}

export async function fetchLicenseCodesFromServer(
  adminSessionToken: string
): Promise<ServerLicenseCodeRecord[]> {
  if (!adminSessionToken) {
    throw new ServerApiError('ADMIN_SESSION_REQUIRED', 'ADMIN_SESSION_REQUIRED', 403);
  }
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/admin/license-codes', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'X-Admin-Session': adminSessionToken,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    codes?: ServerLicenseCodeRecord[];
    error?: string;
    message?: string;
  };

  if (!response.ok || !Array.isArray(payload.codes)) {
    throw new ServerApiError(
      payload.error || 'LIST_LICENSE_CODES_FAILED',
      payload.message || payload.error || 'LIST_LICENSE_CODES_FAILED',
      response.status
    );
  }

  return payload.codes;
}

export async function createLicenseCodeOnServer(params: {
  adminSessionToken: string;
  tier: AdminCouponTier;
  cycle: AdminCouponCycle;
  targetEmail?: string;
}): Promise<{ code: string; record: ServerLicenseCodeRecord }> {
  if (!params.adminSessionToken) {
    throw new ServerApiError('ADMIN_SESSION_REQUIRED', 'ADMIN_SESSION_REQUIRED', 403);
  }
  const idToken = await getRequiredIdToken();
  const response = await fetch('/api/admin/license-codes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      'X-Admin-Session': params.adminSessionToken,
    },
    body: JSON.stringify({
      tier: params.tier,
      cycle: params.cycle,
      ...(params.targetEmail?.trim() ? { targetEmail: params.targetEmail.trim().toLowerCase() } : {}),
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    code?: string;
    record?: ServerLicenseCodeRecord;
    error?: string;
    message?: string;
  };

  if (!response.ok || !payload.code || !payload.record) {
    throw new ServerApiError(
      payload.error || 'CREATE_LICENSE_CODE_FAILED',
      payload.message || payload.error || 'CREATE_LICENSE_CODE_FAILED',
      response.status
    );
  }

  return {
    code: payload.code,
    record: payload.record,
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
    throw new ServerApiError(
      payload.error || 'ORG_DELETE_FAILED',
      payload.message || payload.error || 'ORG_DELETE_FAILED',
      response.status
    );
  }
}

async function cleanupUserCloudDataBestEffort(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const metaRef = doc(db, 'users', uid, 'backup', 'meta');
    let chunkCount = 0;
    try {
      const metaSnap = await getDoc(metaRef);
      if (metaSnap.exists()) {
        chunkCount = Math.max(0, Math.min(100, Number(metaSnap.data()?.chunkCount || 0)));
      }
    } catch {
      // Ignore read errors (offline or missing permissions)
    }

    const deleteTasks: Promise<unknown>[] = [];
    for (let i = 0; i < chunkCount; i++) {
      deleteTasks.push(
        deleteDoc(doc(db, 'users', uid, 'backupChunks', `chunk_${i}`)).catch(() => {})
      );
    }
    deleteTasks.push(deleteDoc(metaRef).catch(() => {}));
    deleteTasks.push(deleteDoc(doc(db, 'users', uid, 'backups', 'latest')).catch(() => {}));
    await Promise.all(deleteTasks);

    await deleteDoc(doc(db, 'users', uid)).catch(() => {});
  } catch {
    // Best-effort cleanup only; never block local deletion + signOut
  }
}

export async function deleteAccountFromServer(): Promise<{ mode: 'server' | 'local_fallback' }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { mode: 'local_fallback' };
  }

  const uid = currentUser.uid;
  const adminReady = await isCloudAdminReady();

  if (adminReady) {
    try {
      const idToken = await getRequiredIdToken();
      const response = await fetch('/api/delete-account', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (response.ok) {
        return { mode: 'server' };
      }

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      const serverErr = new Error(
        payload.message || payload.error || 'DELETE_ACCOUNT_FAILED'
      ) as Error & { code?: string };
      serverErr.code = payload.error;

      if (!shouldFallbackAccountDeleteError(serverErr)) {
        throw serverErr;
      }
    } catch (err) {
      if (!shouldFallbackAccountDeleteError(err)) {
        throw err;
      }
      console.warn('Server account delete unavailable, falling back to local wipe + signOut:', err);
    }
  }

  // Smart Local-first / Offline-first fallback:
  // Best-effort client Firestore cleanup + clean Firebase signOut(auth)
  await cleanupUserCloudDataBestEffort(uid);
  await signOutGoogle().catch(() => {});
  return { mode: 'local_fallback' };
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
