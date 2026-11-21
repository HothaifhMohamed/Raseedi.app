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
  runTransaction,
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
  stripSensitivePinFromSettings,
  stripSensitivePinsFromWallets,
} from './security';
import {
  AppDatabaseData,
  enqueuePendingAttachmentUpload,
  loadPendingAttachmentUploads,
  PendingAttachmentUpload,
  removePendingAttachmentUpload,
} from './db';
import { chunkTransactionsForBackup } from './calculations';
import { invalidateUserLookupCache } from './lookupCache';
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
  FIRESTORE_BATCH_CONCURRENCY,
  FIRESTORE_FAST_BATCH_SIZE,
  FIRESTORE_IMPORT_BATCH_SIZE,
  getWorkspaceTransactionDocPath,
  getWorkspaceTransactionsPath,
  isActiveWorkspaceTransaction,
  isFirestoreServerFetchOfflineError,
  normalizeValidFirestoreId,
  normalizeWorkspaceId,
  reconcileWorkspaceTransactions,
  resolveWorkspaceSyncPriority,
  runResilientBatchCommits,
  shouldBlockEmptyCloudOverwrite,
  WorkspaceSyncPriority,
} from './workspaceSync';
import {
  computeEmailLookupHash,
  normalizeUsername,
  validateUsernameFormat,
} from './usernameService';
import { shouldFallbackAccountDeleteError } from './accountDeletion';
import {
  MAX_CLOUD_BACKUP_TRANSACTIONS,
  prepareCloudBackupChunks,
  resolveSafeCloudBackupWrite,
} from './backupMerge';
import { sortTransactionsDescending } from './orgTransactionQuery';
import {
  isPrimarySystemAdminEmail,
  PRIMARY_SYSTEM_ADMIN_EMAIL,
} from './licenseCodes';
import {
  ADMIN_PANEL_SESSION_TTL_MS,
  buildDirectAdminOrgSubscriptionPatch,
  buildDirectAdminSubscriptionPatch,
  clearVerifiedAdminSession,
  DIRECT_ADMIN_SESSION_PREFIX,
  hashAdminPinBrowser,
  isAdminSessionExpired,
  isApiEndpointUnavailableResponse,
  isAuthorizedPrimaryAdminUser,
  isDirectAdminSessionToken,
  isValidAdminPinLength,
  isVerifiedPrimaryAdminForSensitiveAction,
  loadVerifiedAdminSession,
  normalizeAdminSessionExpiry,
  saveVerifiedAdminSession,
  verifyAdminPinBrowser,
} from './adminAuth';
import { computeOrgSubscriptionState } from './entitlements';
import {
  BackupHistoryRecord,
  BackupHistorySummary,
  buildCompactBackupHistorySnapshotJson,
  computeBackupHistoryCounts,
  getBackupIdsToPrune,
  MAX_AUTO_CLOUD_BACKUPS,
  reconcileBackupHistorySummary,
} from './backupHistory';
import {
  buildSafeCloudLastSyncedPatch,
  buildSafeUserCurrencyRatesPatch,
  UserCurrencyRatesSyncInput,
} from './currencySync';
import {
  buildInitialUserProfilePayload,
  buildSafeUserProfileUpdatePatch,
  isPermissionDeniedFirestoreError,
} from './userProfileSync';
import {
  buildFallbackCloudUserProfile,
  executeGoogleSignInWithRecovery,
} from './googleAuthFlow';

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
  username?: string;
  photoURL?: string;
  hasCompletedOnboarding?: boolean;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stripUndefinedDeep<T>(value: T): T {
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

const inFlightEnsureUserProfiles = new Map<string, Promise<CloudUserProfile>>();

function mapExistingUserDocToProfile(
  firebaseUser: User,
  existingData: CloudUserProfile,
  resolvedEmail: string
): CloudUserProfile {
  const active = isEntitlementActive(existingData);
  const resolvedExpiry = existingData.proExpiresAt ?? existingData.expiresAt ?? null;
  return {
    ...existingData,
    uid: existingData.uid || firebaseUser.uid,
    isPro: active,
    proActive: active,
    proPlan: existingData.proPlan || (active ? 'code' : 'free'),
    planTier: resolvePlanTierFromProfile({ ...existingData, isPro: active }),
    billingCycle: existingData.billingCycle || (active ? 'lifetime' : 'free'),
    startedAt: existingData.startedAt ?? null,
    expiresAt: resolvedExpiry,
    proExpiresAt: resolvedExpiry,
    hasCompletedOnboarding: Boolean(existingData.hasCompletedOnboarding),
    email: resolvedEmail || existingData.email || '',
    displayName: firebaseUser.displayName || existingData.displayName,
    username: existingData.username,
    photoURL: firebaseUser.photoURL || existingData.photoURL,
  };
}

async function runEnsureUserProfile(firebaseUser: User): Promise<CloudUserProfile> {
  const path = `users/${firebaseUser.uid}`;
  const ref = doc(db, 'users', firebaseUser.uid);
  const resolvedEmail = resolveFirebaseUserEmail(firebaseUser) || firebaseUser.email || '';

  const applySafeProfileUpdate = async (
    existingData: CloudUserProfile
  ): Promise<CloudUserProfile> => {
    const { patch, hasChanges } = buildSafeUserProfileUpdatePatch({
      uid: firebaseUser.uid,
      email: resolvedEmail,
      displayName: firebaseUser.displayName,
      photoURL: firebaseUser.photoURL,
      existing: existingData,
    });
    if (hasChanges) {
      try {
        await setDoc(
          ref,
          {
            ...patch,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (updateErr) {
        if (isPermissionDeniedFirestoreError(updateErr)) {
          // Retry once after ensuring auth ID token is settled in Firestore client
          await firebaseUser.getIdToken(false).catch(() => {});
          await new Promise((r) => setTimeout(r, 200));
          await setDoc(
            ref,
            {
              ...patch,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          throw updateErr;
        }
      }
    }
    return mapExistingUserDocToProfile(firebaseUser, existingData, resolvedEmail);
  };

  try {
    const snap = await getDocServerFirst(ref, false);
    if (!snap.exists()) {
      const profilePayload = buildInitialUserProfilePayload({
        uid: firebaseUser.uid,
        email: resolvedEmail,
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
      });
      try {
        await setDoc(ref, {
          ...profilePayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (createErr) {
        if (!isPermissionDeniedFirestoreError(createErr)) {
          throw createErr;
        }
        // Handle concurrent create race or slightly delayed Auth token propagation cleanly:
        await firebaseUser.getIdToken(false).catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
        const refreshedSnap = await getDocServerFirst(ref, true).catch(() => getDoc(ref));
        if (refreshedSnap.exists()) {
          return await applySafeProfileUpdate(refreshedSnap.data() as CloudUserProfile);
        }
        // Document still does not exist -> retry initial create once
        await setDoc(ref, {
          ...profilePayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      return {
        uid: firebaseUser.uid,
        email: resolvedEmail,
        displayName: firebaseUser.displayName || undefined,
        photoURL: firebaseUser.photoURL || undefined,
        hasCompletedOnboarding: false,
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

    return await applySafeProfileUpdate(snap.data() as CloudUserProfile);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Ensures user profile exists in Firestore. Deduplicates concurrent calls per UID and
 * never modifies protected subscription fields (isPro/proPlan/expiresAt) or createdAt on update.
 */
export async function ensureUserProfile(firebaseUser: User): Promise<CloudUserProfile> {
  const existingPromise = inFlightEnsureUserProfiles.get(firebaseUser.uid);
  if (existingPromise) {
    return existingPromise;
  }
  const task = runEnsureUserProfile(firebaseUser)
    .then((profile) => {
      // Non-blocking, non-fatal sync of the PII-safe exact-email lookup index so
      // organization owners can add this user directly by email or @username.
      void syncUserDirectoryIndexes(firebaseUser.uid, {
        email: profile.email,
        displayName: profile.displayName || firebaseUser.displayName || '',
        username: profile.username,
      }).catch(() => {});
      return profile;
    })
    .finally(() => {
      if (inFlightEnsureUserProfiles.get(firebaseUser.uid) === task) {
        inFlightEnsureUserProfiles.delete(firebaseUser.uid);
      }
    });
  inFlightEnsureUserProfiles.set(firebaseUser.uid, task);
  return task;
}

/**
 * Keeps the exact-email SHA-256 lookup index (`userEmailIndex/{emailHash}`) in sync
 * for the currently signed-in user. Fails silently if offline or unverified.
 */
export async function syncUserDirectoryIndexes(
  uid: string,
  info: { email?: string; displayName?: string; username?: string }
): Promise<void> {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) return;
  const email = String(info.email || resolveFirebaseUserEmail(auth.currentUser) || '')
    .trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

  try {
    const emailHash = await computeEmailLookupHash(email);
    const cleanName = String(info.displayName || auth.currentUser.displayName || email.split('@')[0])
      .trim()
      .slice(0, 120);
    const cleanUsername = info.username ? normalizeUsername(info.username) : undefined;
    const payload: Record<string, unknown> = {
      emailHash,
      uid,
      email: email.slice(0, 254),
      displayName: cleanName || 'مستخدم',
      updatedAt: serverTimestamp(),
    };
    if (cleanUsername && /^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
      payload.username = cleanUsername;
    }
    await setDoc(doc(db, 'userEmailIndex', emailHash), payload, { merge: true });
  } catch (err) {
    console.warn('[syncUserDirectoryIndexes] Non-fatal index sync warning:', err);
  }
}

export async function checkUsernameAvailabilityCloud(
  rawUsername: string,
  currentUid?: string
): Promise<{
  available: boolean;
  normalized: string;
  errorAr?: string;
  errorEn?: string;
}> {
  const check = validateUsernameFormat(rawUsername);
  if (!check.valid) {
    return {
      available: false,
      normalized: check.normalized,
      errorAr: check.errorAr,
      errorEn: check.errorEn,
    };
  }
  const snap = await getDocServerFirst(doc(db, 'usernames', check.normalized), true).catch(() =>
    getDoc(doc(db, 'usernames', check.normalized))
  );
  if (!snap.exists()) {
    return { available: true, normalized: check.normalized };
  }
  const ownerUid = String((snap.data() as { uid?: string })?.uid || '');
  if (currentUid && ownerUid === currentUid) {
    return { available: true, normalized: check.normalized };
  }
  return {
    available: false,
    normalized: check.normalized,
    errorAr: `اسم المستخدم @${check.normalized} مستخدم بالفعل من حساب آخر.`,
    errorEn: `Username @${check.normalized} is already taken.`,
  };
}

/**
 * Atomically claims/updates a unique `@username` for the signed-in user across:
 * 1) `usernames/{newUsername}` (enforces global uniqueness via Firestore Transaction)
 * 2) Deletes `usernames/{oldUsername}` if user had a previous handle
 * 3) Updates `users/{uid}.username`
 * 4) Updates `userEmailIndex/{emailHash}.username`
 */
export async function claimUserUsernameCloud(
  uid: string,
  rawUsername: string,
  profileInfo?: { email?: string; displayName?: string }
): Promise<{ username: string }> {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('AUTH_REQUIRED');
  }
  const check = validateUsernameFormat(rawUsername);
  if (!check.valid) {
    throw new Error(check.errorAr || 'INVALID_USERNAME');
  }
  const newUsername = check.normalized;
  const resolvedEmail = String(
    profileInfo?.email || resolveFirebaseUserEmail(auth.currentUser) || auth.currentUser.email || ''
  )
    .trim()
    .toLowerCase();
  const displayName = String(
    profileInfo?.displayName || auth.currentUser.displayName || resolvedEmail.split('@')[0] || 'مستخدم'
  )
    .trim()
    .slice(0, 120);

  let emailHash: string | null = null;
  if (resolvedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail)) {
    emailHash = await computeEmailLookupHash(resolvedEmail).catch(() => null);
  }

  await ensureUserProfile(auth.currentUser);

  const userRef = doc(db, 'users', uid);
  const newHandleRef = doc(db, 'usernames', newUsername);

  await runTransaction(db, async (tx) => {
    const [userSnap, newHandleSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(newHandleRef),
    ]);

    if (newHandleSnap.exists()) {
      const existingOwnerUid = String((newHandleSnap.data() as { uid?: string })?.uid || '');
      if (existingOwnerUid && existingOwnerUid !== uid) {
        throw new Error('USERNAME_TAKEN');
      }
    }

    const oldUsernameRaw = userSnap.exists()
      ? String((userSnap.data() as { username?: string })?.username || '')
      : '';
    const oldUsername = normalizeUsername(oldUsernameRaw);

    if (oldUsername && oldUsername !== newUsername && /^[a-z0-9_]{3,30}$/.test(oldUsername)) {
      const oldHandleRef = doc(db, 'usernames', oldUsername);
      const oldHandleSnap = await tx.get(oldHandleRef);
      if (oldHandleSnap.exists() && String((oldHandleSnap.data() as { uid?: string })?.uid || '') === uid) {
        tx.delete(oldHandleRef);
      }
    }

    tx.set(newHandleRef, {
      username: newUsername,
      uid,
      email: resolvedEmail.slice(0, 254),
      displayName: displayName || 'مستخدم',
      updatedAt: serverTimestamp(),
    });

    tx.set(
      userRef,
      {
        username: newUsername,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (emailHash) {
      tx.set(
        doc(db, 'userEmailIndex', emailHash),
        {
          emailHash,
          uid,
          email: resolvedEmail.slice(0, 254),
          displayName: displayName || 'مستخدم',
          username: newUsername,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  invalidateUserLookupCache();
  return { username: newUsername };
}

/**
 * Safely marks onboarding as completed on users/{uid} without touching protected fields.
 */
export async function markUserOnboardingCompletedCloud(uid: string): Promise<void> {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) return;
  const userRef = doc(db, 'users', uid);
  try {
    await ensureUserProfile(auth.currentUser);
    await setDoc(
      userRef,
      {
        hasCompletedOnboarding: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[markUserOnboardingCompletedCloud] Non-fatal onboarding flag sync warning:', err);
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

export interface ServerAdminStatus {
  isAdmin: boolean;
  pinConfigured: boolean;
  pinSource: 'firestore' | 'env' | 'unset';
  pinUpdatedAtMs: number | null;
  claimsUpdated?: boolean;
  customClaimSynced?: boolean;
}

export function resolveFirebaseUserEmail(firebaseUser?: User | null): string {
  if (!firebaseUser) return '';
  const candidates: string[] = [];
  if (typeof firebaseUser.email === 'string' && firebaseUser.email.trim()) {
    candidates.push(firebaseUser.email.trim());
  }
  if (Array.isArray(firebaseUser.providerData)) {
    for (const provider of firebaseUser.providerData) {
      if (typeof provider?.email === 'string' && provider.email.trim()) {
        candidates.push(provider.email.trim());
      }
    }
  }
  const primaryAdminMatch = candidates.find((email) => isPrimarySystemAdminEmail(email));
  return primaryAdminMatch || candidates[0] || '';
}

class AdminApiUnavailableError extends Error {
  constructor() {
    super('ADMIN_API_UNAVAILABLE');
  }
}

const DIRECT_ADMIN_SESSION_TTL_MS = ADMIN_PANEL_SESSION_TTL_MS;

function assertDirectPrimaryAdminUser(userOverride?: User | null): {
  user: User;
  email: string;
} {
  const targetUser = userOverride ?? auth.currentUser;
  const email = resolveFirebaseUserEmail(targetUser).trim().toLowerCase();
  if (
    !targetUser ||
    !isVerifiedPrimaryAdminForSensitiveAction({
      uid: targetUser.uid,
      email,
      emailVerified: targetUser.emailVerified,
      providerData: targetUser.providerData,
    })
  ) {
    throw new ServerApiError(
      'FORBIDDEN',
      'فقط مالك النظام المخول بحساب موثّق يمكنه تنفيذ هذا الإجراء.',
      403
    );
  }
  return { user: targetUser, email };
}

function createDirectAdminSessionToken(uid: string): {
  adminSessionToken: string;
  expiresAt: number;
} {
  const expiresAt = Date.now() + DIRECT_ADMIN_SESSION_TTL_MS;
  const randomPart =
    typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues
      ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return {
    adminSessionToken: `${DIRECT_ADMIN_SESSION_PREFIX}${uid}:${expiresAt}:${randomPart}`,
    expiresAt,
  };
}

function hasActiveLocalAdminSession(token: string, expectedUid: string): boolean {
  const cleanToken = typeof token === 'string' ? token.trim() : '';
  if (!cleanToken || !expectedUid) return false;

  // 1. Direct-Firestore token format: direct-firestore:<uid>:<expiresAt>:<random>
  if (isDirectAdminSessionToken(cleanToken)) {
    const rest = cleanToken.slice(DIRECT_ADMIN_SESSION_PREFIX.length);
    const parts = rest.split(':');
    const tokenUid = parts[0] || '';
    const expiresAt = Number(parts[1] || 0);
    return tokenUid === expectedUid && !isAdminSessionExpired(expiresAt);
  }

  // 2. Stored verified session from current browser tab (works seamlessly across server restarts/instances)
  const stored = loadVerifiedAdminSession(expectedUid);
  if (stored && stored.token === cleanToken && !isAdminSessionExpired(stored.expiresAt)) {
    return true;
  }

  // 3. Server-signed token format: <uid>.<expiresAt>.<hmacHex>
  const serverParts = cleanToken.split('.');
  if (serverParts.length === 3) {
    const [tokenUid, expStr] = serverParts;
    const exp = Number(expStr);
    if (tokenUid === expectedUid && !isAdminSessionExpired(exp)) {
      return true;
    }
  }

  return false;
}

function assertValidDirectAdminSession(token: string, expectedUid: string): void {
  if (!hasActiveLocalAdminSession(token, expectedUid)) {
    clearVerifiedAdminSession();
    throw new ServerApiError(
      'ADMIN_SESSION_EXPIRED',
      'انتهت جلسة الإدارة. يرجى إدخال الرمز السري مجدداً.',
      403
    );
  }
}

function shouldFallbackAdminApiErrorToDirect(
  err: unknown,
  token: string,
  expectedUid?: string | null
): boolean {
  if (err instanceof AdminApiUnavailableError) {
    return true;
  }
  if (
    err instanceof ServerApiError &&
    expectedUid &&
    hasActiveLocalAdminSession(token, expectedUid) &&
    (err.code === 'ADMIN_SESSION_REQUIRED' ||
      err.code === 'CLOUD_ADMIN_UNAVAILABLE' ||
      err.status >= 500)
  ) {
    return true;
  }
  return false;
}

async function readAdminPinDocDirect(): Promise<{
  pinHash: string | null;
  updatedAtMs: number | null;
}> {
  const primaryRef = doc(db, 'adminConfig', 'security');
  try {
    const snap = await getDocFromServer(primaryRef).catch(() => getDoc(primaryRef));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      const pinHash = typeof data.pinHash === 'string' && data.pinHash.trim() ? data.pinHash.trim() : null;
      const updatedAtMs =
        typeof data.updatedAtMs === 'number' && Number.isFinite(data.updatedAtMs)
          ? data.updatedAtMs
          : null;
      if (pinHash) {
        return { pinHash, updatedAtMs };
      }
    }
  } catch (err) {
    console.warn('Direct adminConfig/security read warning:', err);
  }

  // Legacy read-only fallback path (adminSecurity/panelConfig)
  try {
    const legacyRef = doc(db, 'adminSecurity', 'panelConfig');
    const legacySnap = await getDocFromServer(legacyRef).catch(() => getDoc(legacyRef));
    if (legacySnap.exists()) {
      const data = legacySnap.data() as Record<string, unknown>;
      const pinHash = typeof data.pinHash === 'string' && data.pinHash.trim() ? data.pinHash.trim() : null;
      const updatedAtMs =
        typeof data.updatedAtMs === 'number' && Number.isFinite(data.updatedAtMs)
          ? data.updatedAtMs
          : null;
      if (pinHash) {
        return { pinHash, updatedAtMs };
      }
    }
  } catch {
    // Ignore legacy fallback errors
  }

  return { pinHash: null, updatedAtMs: null };
}

async function writeAdminPinDocDirect(params: {
  uid: string;
  email: string;
  pinHash: string;
  isFirstCreate: boolean;
}): Promise<number> {
  const updatedAtMs = Date.now();
  const ref = doc(db, 'adminConfig', 'security');
  const payload: Record<string, unknown> = {
    pinHash: params.pinHash,
    updatedByUid: params.uid,
    updatedByEmail: params.email.trim().toLowerCase() || PRIMARY_SYSTEM_ADMIN_EMAIL,
    updatedAtMs,
    updatedAt: serverTimestamp(),
  };
  if (params.isFirstCreate) {
    payload.createdAt = serverTimestamp();
  }
  await setDoc(ref, payload, { merge: !params.isFirstCreate });
  return updatedAtMs;
}

async function fetchAdminApiJson<T>(
  url: string,
  init: RequestInit
): Promise<{ response: Response; payload: T }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new AdminApiUnavailableError();
  }
  const contentType = response.headers.get('content-type');
  if (isApiEndpointUnavailableResponse(response.status, contentType)) {
    throw new AdminApiUnavailableError();
  }
  const payload = (await response.json().catch(() => ({}))) as T;
  return { response, payload };
}

async function requestAdminStatusEndpoint(
  endpoint: '/api/admin/bootstrap' | '/api/admin/status',
  method: 'POST' | 'GET',
  idToken: string
): Promise<{ ok: boolean; unavailable: boolean; payload: Record<string, unknown> }> {
  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    if (isApiEndpointUnavailableResponse(response.status, response.headers.get('content-type'))) {
      return { ok: false, unavailable: true, payload: {} };
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, unavailable: false, payload };
  } catch {
    return { ok: false, unavailable: true, payload: {} };
  }
}

export async function bootstrapAdminStatusOnServer(
  userOverride?: User | null
): Promise<ServerAdminStatus> {
  const targetUser = userOverride ?? auth.currentUser;
  if (!targetUser) {
    return { isAdmin: false, pinConfigured: false, pinSource: 'unset', pinUpdatedAtMs: null };
  }

  const resolvedEmail = resolveFirebaseUserEmail(targetUser);
  const isVerifiedPrimaryAdmin = isAuthorizedPrimaryAdminUser({
    uid: targetUser.uid,
    email: resolvedEmail,
    emailVerified: targetUser.emailVerified,
  });

  try {
    const idToken = await targetUser.getIdToken();
    let result = await requestAdminStatusEndpoint('/api/admin/bootstrap', 'POST', idToken);
    if (!result.ok) {
      result = await requestAdminStatusEndpoint('/api/admin/status', 'GET', idToken);
    }

    if (result.ok) {
      const payload = result.payload as {
        isAdmin?: boolean;
        pinConfigured?: boolean;
        pinSource?: 'firestore' | 'env' | 'unset';
        pinUpdatedAtMs?: number | null;
        claimsUpdated?: boolean;
        customClaimSynced?: boolean;
      };

      const isAdmin = Boolean(payload.isAdmin);
      if (isAdmin) {
        await targetUser.getIdToken(true).catch(() => undefined);
      }

      return {
        isAdmin,
        pinConfigured: Boolean(payload.pinConfigured),
        pinSource:
          payload.pinSource === 'firestore' || payload.pinSource === 'env'
            ? payload.pinSource
            : 'unset',
        pinUpdatedAtMs:
          typeof payload.pinUpdatedAtMs === 'number' && Number.isFinite(payload.pinUpdatedAtMs)
            ? payload.pinUpdatedAtMs
            : null,
        claimsUpdated: Boolean(payload.claimsUpdated),
        customClaimSynced: Boolean(payload.customClaimSynced),
      };
    }

    // Static hosting fallback (e.g. Vercel where /api/admin/* is not deployed):
    // Strictly limited to the verified exclusive primary admin via Firestore Security Rules `isAdmin()`.
    if (isVerifiedPrimaryAdmin && result.unavailable) {
      const pinDoc = await readAdminPinDocDirect();
      return {
        isAdmin: true,
        pinConfigured: Boolean(pinDoc.pinHash),
        pinSource: pinDoc.pinHash ? 'firestore' : 'unset',
        pinUpdatedAtMs: pinDoc.updatedAtMs,
        claimsUpdated: false,
        customClaimSynced: false,
      };
    }

    return {
      isAdmin: isVerifiedPrimaryAdmin,
      pinConfigured: false,
      pinSource: 'unset',
      pinUpdatedAtMs: null,
    };
  } catch {
    if (isVerifiedPrimaryAdmin) {
      const pinDoc = await readAdminPinDocDirect().catch(() => ({
        pinHash: null,
        updatedAtMs: null,
      }));
      return {
        isAdmin: true,
        pinConfigured: Boolean(pinDoc.pinHash),
        pinSource: pinDoc.pinHash ? 'firestore' : 'unset',
        pinUpdatedAtMs: pinDoc.updatedAtMs,
      };
    }
    return { isAdmin: false, pinConfigured: false, pinSource: 'unset', pinUpdatedAtMs: null };
  }
}

export async function fetchAdminStatusFromServer(
  userOverride?: User | null
): Promise<ServerAdminStatus> {
  return bootstrapAdminStatusOnServer(userOverride);
}

export async function setupAdminPinOnServer(
  newPin: string
): Promise<{
  adminSessionToken: string;
  expiresAt: number;
  pinUpdatedAtMs: number | null;
}> {
  const cleanPin = newPin.trim();
  if (!isValidAdminPinLength(cleanPin)) {
    throw new ServerApiError(
      'INVALID_PIN_LENGTH',
      'يجب أن يتكون الرمز السري من 4 إلى 32 حرفاً أو رقماً.',
      400
    );
  }

  const idToken = await getRequiredIdToken();
  try {
    const { response, payload } = await fetchAdminApiJson<{
      adminSessionToken?: string;
      expiresAt?: number;
      pinUpdatedAtMs?: number | null;
      claimsUpdated?: boolean;
      error?: string;
      message?: string;
    }>('/api/admin/pin/setup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ newPin: cleanPin }),
    });

    if (!response.ok || !payload.adminSessionToken) {
      throw new ServerApiError(
        payload.error || 'PIN_SETUP_FAILED',
        payload.message || payload.error || 'PIN_SETUP_FAILED',
        response.status
      );
    }

    if (payload.claimsUpdated && auth.currentUser) {
      await auth.currentUser.getIdToken(true).catch(() => undefined);
    }

    const expiresAt = normalizeAdminSessionExpiry(payload.expiresAt);
    const pinUpdatedAtMs =
      typeof payload.pinUpdatedAtMs === 'number' ? payload.pinUpdatedAtMs : Date.now();
    if (auth.currentUser?.uid) {
      saveVerifiedAdminSession({
        uid: auth.currentUser.uid,
        token: payload.adminSessionToken,
        expiresAt,
        pinSource: 'firestore',
        pinUpdatedAtMs,
      });
    }

    return {
      adminSessionToken: payload.adminSessionToken,
      expiresAt,
      pinUpdatedAtMs,
    };
  } catch (err) {
    if (!(err instanceof AdminApiUnavailableError)) {
      throw err;
    }
    const { user, email } = assertDirectPrimaryAdminUser();
    const existing = await readAdminPinDocDirect();
    if (existing.pinHash) {
      throw new ServerApiError(
        'PIN_ALREADY_CONFIGURED',
        'تم تعيين الرمز السري مسبقاً. يرجى إدخاله لفتح لوحة الإدارة.',
        409
      );
    }
    const pinHash = await hashAdminPinBrowser(cleanPin);
    const pinUpdatedAtMs = await writeAdminPinDocDirect({
      uid: user.uid,
      email,
      pinHash,
      isFirstCreate: true,
    });
    const session = createDirectAdminSessionToken(user.uid);
    saveVerifiedAdminSession({
      uid: user.uid,
      token: session.adminSessionToken,
      expiresAt: session.expiresAt,
      pinSource: 'firestore',
      pinUpdatedAtMs,
    });
    return {
      adminSessionToken: session.adminSessionToken,
      expiresAt: session.expiresAt,
      pinUpdatedAtMs,
    };
  }
}

export async function verifyAdminPasscodeOnServer(
  passcode: string
): Promise<{
  adminSessionToken: string;
  expiresAt: number;
  pinSource: 'firestore' | 'env' | 'unset';
  pinUpdatedAtMs: number | null;
}> {
  const cleanPin = passcode.trim();
  const idToken = await getRequiredIdToken();
  try {
    const { response, payload } = await fetchAdminApiJson<{
      adminSessionToken?: string;
      expiresAt?: number;
      pinSource?: 'firestore' | 'env' | 'unset';
      pinUpdatedAtMs?: number | null;
      claimsUpdated?: boolean;
      error?: string;
      message?: string;
    }>('/api/admin/verify-passcode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ passcode: cleanPin }),
    });

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

    const expiresAt = normalizeAdminSessionExpiry(payload.expiresAt);
    const pinSource: 'firestore' | 'env' | 'unset' =
      payload.pinSource === 'firestore' || payload.pinSource === 'env'
        ? payload.pinSource
        : 'unset';
    const pinUpdatedAtMs =
      typeof payload.pinUpdatedAtMs === 'number' ? payload.pinUpdatedAtMs : null;

    if (auth.currentUser?.uid) {
      saveVerifiedAdminSession({
        uid: auth.currentUser.uid,
        token: payload.adminSessionToken,
        expiresAt,
        pinSource,
        pinUpdatedAtMs,
      });
    }

    return {
      adminSessionToken: payload.adminSessionToken,
      expiresAt,
      pinSource,
      pinUpdatedAtMs,
    };
  } catch (err) {
    if (
      !(err instanceof AdminApiUnavailableError) &&
      !(err instanceof ServerApiError && err.status >= 500)
    ) {
      throw err;
    }
    const { user } = assertDirectPrimaryAdminUser();
    const pinDoc = await readAdminPinDocDirect();
    if (!pinDoc.pinHash) {
      throw new ServerApiError(
        'ADMIN_PIN_NOT_SET',
        'لم يتم تعيين الرمز السري بعد. قم بتعيين رمزك السري الجديد الآن.',
        409
      );
    }
    const verified = await verifyAdminPinBrowser(cleanPin, pinDoc.pinHash);
    if (verified === 'server_scrypt_only') {
      throw new ServerApiError(
        'ADMIN_PIN_NEEDS_REAUTH_RESET',
        'تم تشفير الرمز السري سابقاً بصيغة الخادم (scrypt). أكد هويتك عبر Google لتحديث الرمز السري بصيغة متوافقة مع Vercel والخادم معاً.',
        409
      );
    }
    if (verified !== 'match') {
      throw new ServerApiError(
        'INVALID_ADMIN_PASSCODE',
        'الرمز السري للوحة الإدارة غير صحيح.',
        403
      );
    }
    const session = createDirectAdminSessionToken(user.uid);
    saveVerifiedAdminSession({
      uid: user.uid,
      token: session.adminSessionToken,
      expiresAt: session.expiresAt,
      pinSource: 'firestore',
      pinUpdatedAtMs: pinDoc.updatedAtMs,
    });
    return {
      adminSessionToken: session.adminSessionToken,
      expiresAt: session.expiresAt,
      pinSource: 'firestore',
      pinUpdatedAtMs: pinDoc.updatedAtMs,
    };
  }
}

export async function resetAdminPinAfterGoogleReauth(
  newPin: string
): Promise<{
  adminSessionToken: string;
  expiresAt: number;
  pinUpdatedAtMs: number;
}> {
  const cleanPin = newPin.trim();
  if (!isValidAdminPinLength(cleanPin)) {
    throw new ServerApiError(
      'INVALID_PIN_LENGTH',
      'يجب أن يتكون الرمز السري من 4 إلى 32 حرفاً أو رقماً.',
      400
    );
  }

  const reauthedUser = await reauthenticateWithGoogle();
  const { user, email } = assertDirectPrimaryAdminUser(reauthedUser);
  const existing = await readAdminPinDocDirect();
  const pinHash = await hashAdminPinBrowser(cleanPin);
  const pinUpdatedAtMs = await writeAdminPinDocDirect({
    uid: user.uid,
    email,
    pinHash,
    isFirstCreate: !existing.pinHash,
  });
  const session = createDirectAdminSessionToken(user.uid);
  saveVerifiedAdminSession({
    uid: user.uid,
    token: session.adminSessionToken,
    expiresAt: session.expiresAt,
    pinSource: 'firestore',
    pinUpdatedAtMs,
  });
  return {
    adminSessionToken: session.adminSessionToken,
    expiresAt: session.expiresAt,
    pinUpdatedAtMs,
  };
}

export async function changeAdminPinOnServer(params: {
  currentPin: string;
  newPin: string;
  adminSessionToken: string;
}): Promise<{
  adminSessionToken: string;
  expiresAt: number;
  updatedAtMs: number;
}> {
  if (!params.adminSessionToken) {
    throw new ServerApiError('ADMIN_SESSION_REQUIRED', 'ADMIN_SESSION_REQUIRED', 403);
  }
  const cleanCurrent = params.currentPin.trim();
  const cleanNext = params.newPin.trim();
  if (!isValidAdminPinLength(cleanNext)) {
    throw new ServerApiError(
      'INVALID_PIN_LENGTH',
      'يجب أن يتكون الرمز السري من 4 إلى 32 حرفاً أو رقماً.',
      400
    );
  }

  const runDirectChange = async () => {
    const { user, email } = assertDirectPrimaryAdminUser();
    assertValidDirectAdminSession(params.adminSessionToken, user.uid);
    const pinDoc = await readAdminPinDocDirect();
    if (!pinDoc.pinHash) {
      throw new ServerApiError('ADMIN_PIN_NOT_SET', 'الرمز السري غير مضبوط بعد.', 409);
    }
    const verified = await verifyAdminPinBrowser(cleanCurrent, pinDoc.pinHash);
    if (verified !== 'match') {
      throw new ServerApiError(
        'INVALID_CURRENT_PIN',
        'الرمز السري الحالي غير صحيح.',
        403
      );
    }
    const pinHash = await hashAdminPinBrowser(cleanNext);
    const updatedAtMs = await writeAdminPinDocDirect({
      uid: user.uid,
      email,
      pinHash,
      isFirstCreate: false,
    });
    const session = createDirectAdminSessionToken(user.uid);
    saveVerifiedAdminSession({
      uid: user.uid,
      token: session.adminSessionToken,
      expiresAt: session.expiresAt,
      pinSource: 'firestore',
      pinUpdatedAtMs: updatedAtMs,
    });
    return {
      adminSessionToken: session.adminSessionToken,
      expiresAt: session.expiresAt,
      updatedAtMs,
    };
  };

  if (isDirectAdminSessionToken(params.adminSessionToken)) {
    return runDirectChange();
  }

  const idToken = await getRequiredIdToken();
  try {
    const { response, payload } = await fetchAdminApiJson<{
      adminSessionToken?: string;
      expiresAt?: number;
      updatedAtMs?: number;
      error?: string;
      message?: string;
    }>('/api/admin/pin/change', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'X-Admin-Session': params.adminSessionToken,
      },
      body: JSON.stringify({
        currentPin: cleanCurrent,
        newPin: cleanNext,
      }),
    });

    if (!response.ok || !payload.adminSessionToken) {
      throw new ServerApiError(
        payload.error || 'PIN_CHANGE_FAILED',
        payload.message || payload.error || 'PIN_CHANGE_FAILED',
        response.status
      );
    }

    const expiresAt = normalizeAdminSessionExpiry(payload.expiresAt);
    const updatedAtMs = Number(payload.updatedAtMs || Date.now());
    if (auth.currentUser?.uid) {
      saveVerifiedAdminSession({
        uid: auth.currentUser.uid,
        token: payload.adminSessionToken,
        expiresAt,
        pinSource: 'firestore',
        pinUpdatedAtMs: updatedAtMs,
      });
    }

    return {
      adminSessionToken: payload.adminSessionToken,
      expiresAt,
      updatedAtMs,
    };
  } catch (err) {
    if (!shouldFallbackAdminApiErrorToDirect(err, params.adminSessionToken, auth.currentUser?.uid)) {
      throw err;
    }
    return runDirectChange();
  }
}

export async function fetchAllUsersForAdmin(
  adminSessionToken: string
): Promise<CloudUserProfile[]> {
  if (!adminSessionToken) {
    throw new ServerApiError('ADMIN_SESSION_REQUIRED', 'ADMIN_SESSION_REQUIRED', 403);
  }

  const runDirectFetchUsers = async (): Promise<CloudUserProfile[]> => {
    const { user } = assertDirectPrimaryAdminUser();
    assertValidDirectAdminSession(adminSessionToken, user.uid);
    const q = query(collection(db, 'users'), limit(200));
    const snap = await getDocsFromServer(q).catch(() => getDocs(q));
    const rows = snap.docs.map((d) =>
      mapCloudUserProfile(d.id, d.data() as Record<string, unknown>)
    );
    return rows.sort((a, b) => {
      const aScore = (a.isPro ? 2 : 0) + (a.lastSyncedAt ? 1 : 0);
      const bScore = (b.isPro ? 2 : 0) + (b.lastSyncedAt ? 1 : 0);
      if (bScore !== aScore) return bScore - aScore;
      return (b.lastSyncedAt || 0) - (a.lastSyncedAt || 0);
    });
  };

  if (isDirectAdminSessionToken(adminSessionToken)) {
    return runDirectFetchUsers();
  }

  const idToken = await getRequiredIdToken();
  try {
    const { response, payload } = await fetchAdminApiJson<{
      users?: CloudUserProfile[];
      error?: string;
      message?: string;
    }>('/api/admin/users', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'X-Admin-Session': adminSessionToken,
      },
    });

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
  } catch (err) {
    if (!shouldFallbackAdminApiErrorToDirect(err, adminSessionToken, auth.currentUser?.uid)) {
      throw err;
    }
    return runDirectFetchUsers();
  }
}

export async function adminUpdateUserSubscription(params: {
  targetUid: string;
  planTier: PlanTier;
  billingCycle: 'free' | 'monthly' | 'yearly' | 'lifetime';
  customDays?: number | null;
  customExpiresAt?: number | null;
  extendDays?: number | null;
  existingExpiresAt?: number | null;
  adminSessionToken: string;
}): Promise<CloudUserProfile> {
  if (!params.adminSessionToken) {
    throw new ServerApiError('ADMIN_SESSION_REQUIRED', 'ADMIN_SESSION_REQUIRED', 403);
  }

  const runDirectUpdate = async (): Promise<CloudUserProfile> => {
    const { user } = assertDirectPrimaryAdminUser();
    assertValidDirectAdminSession(params.adminSessionToken, user.uid);
    const targetRef = doc(db, 'users', params.targetUid);
    const snap = await getDocFromServer(targetRef).catch(() => getDoc(targetRef));
    if (!snap.exists()) {
      throw new ServerApiError('USER_NOT_FOUND', 'تعذر العثور على حساب المستخدم.', 404);
    }
    const existingData = snap.data() as Record<string, unknown>;
    const existingExpiresAt =
      typeof params.existingExpiresAt === 'number' && Number.isFinite(params.existingExpiresAt)
        ? params.existingExpiresAt
        : typeof existingData.expiresAt === 'number' && Number.isFinite(existingData.expiresAt)
        ? existingData.expiresAt
        : typeof existingData.proExpiresAt === 'number' && Number.isFinite(existingData.proExpiresAt)
        ? existingData.proExpiresAt
        : null;
    const patch = buildDirectAdminSubscriptionPatch({
      planTier: params.planTier,
      billingCycle: params.billingCycle,
      customDays: params.customDays,
      customExpiresAt: params.customExpiresAt,
      extendDays: params.extendDays,
      existingExpiresAt,
    });
    await updateDoc(targetRef, {
      ...patch,
      updatedAt: serverTimestamp(),
    });
    return mapCloudUserProfile(params.targetUid, {
      ...existingData,
      ...patch,
    });
  };

  if (isDirectAdminSessionToken(params.adminSessionToken)) {
    return runDirectUpdate();
  }

  const idToken = await getRequiredIdToken();
  try {
    const { response, payload } = await fetchAdminApiJson<
      Partial<CloudUserProfile> & { error?: string; message?: string }
    >(`/api/admin/users/${encodeURIComponent(params.targetUid)}/subscription`, {
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
        ...(params.customExpiresAt && params.customExpiresAt > 0
          ? { customExpiresAt: params.customExpiresAt }
          : {}),
        ...(params.extendDays && params.extendDays > 0 ? { extendDays: params.extendDays } : {}),
        ...(typeof params.existingExpiresAt === 'number' && Number.isFinite(params.existingExpiresAt)
          ? { existingExpiresAt: params.existingExpiresAt }
          : {}),
      }),
    });

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
  } catch (err) {
    if (!shouldFallbackAdminApiErrorToDirect(err, params.adminSessionToken, auth.currentUser?.uid)) {
      throw err;
    }
    return runDirectUpdate();
  }
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

export interface CloudAdminOrganizationSummary {
  id: string;
  name: string;
  ownerId: string;
  currency: string;
  planTier: PlanTier;
  billingCycle: BillingCycle;
  plan: 'trial' | 'business_monthly' | 'business_yearly';
  expiresAt: number | null;
  subscriptionEndsAt: number | null;
  trialEndsAt: number | null;
  seatLimit: number;
  aiScansLimit: number;
  status: 'trial' | 'active' | 'expiring_soon' | 'grace' | 'read_only';
  isReadOnly: boolean;
  daysRemaining: number | null;
  updatedAtMs: number;
}

function mapCloudAdminOrganizationSummary(
  id: string,
  data: Record<string, unknown>
): CloudAdminOrganizationSummary {
  const toMs = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
      return (v as { toMillis: () => number }).toMillis();
    }
    return null;
  };
  const planTierRaw =
    data.planTier === 'free' || data.planTier === 'personal_pro' || data.planTier === 'business_pro'
      ? data.planTier
      : 'business_pro';
  const planRaw: 'trial' | 'business_monthly' | 'business_yearly' =
    data.plan === 'trial' || data.plan === 'business_monthly' || data.plan === 'business_yearly'
      ? data.plan
      : 'business_monthly';
  const billingCycleRaw: BillingCycle =
    data.billingCycle === 'free' ||
    data.billingCycle === 'monthly' ||
    data.billingCycle === 'yearly' ||
    data.billingCycle === 'lifetime' ||
    data.billingCycle === 'trial' ||
    data.billingCycle === 'code'
      ? data.billingCycle
      : planRaw === 'business_yearly'
      ? 'yearly'
      : planRaw === 'trial'
      ? 'trial'
      : 'monthly';

  const expiresAt = toMs(data.expiresAt);
  const subscriptionEndsAt = toMs(data.subscriptionEndsAt);
  const trialEndsAt = toMs(data.trialEndsAt);
  const seatLimit =
    typeof data.seatLimit === 'number' && Number.isFinite(data.seatLimit) && data.seatLimit > 0
      ? data.seatLimit
      : 5;
  const aiScansLimit =
    typeof data.aiScansLimit === 'number' && Number.isFinite(data.aiScansLimit)
      ? data.aiScansLimit
      : planTierRaw === 'free'
      ? 5
      : 250;

  const state = computeOrgSubscriptionState({
    planTier: planTierRaw,
    plan: planRaw,
    billingCycle: billingCycleRaw,
    expiresAt,
    subscriptionEndsAt: subscriptionEndsAt ?? undefined,
    trialEndsAt: trialEndsAt ?? undefined,
    seatLimit,
    extraSeats: typeof data.extraSeats === 'number' ? data.extraSeats : 0,
  });

  const updatedAtMs = toMs(data.updatedAt) ?? toMs(data.createdAt) ?? 0;

  return {
    id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : id,
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : '',
    currency: typeof data.currency === 'string' && data.currency ? data.currency : 'EGP',
    planTier: state.planTier,
    billingCycle: state.billingCycle,
    plan: planRaw,
    expiresAt: state.expiresAt,
    subscriptionEndsAt: subscriptionEndsAt ?? state.expiresAt,
    trialEndsAt,
    seatLimit: state.seatLimit,
    aiScansLimit,
    status: state.status,
    isReadOnly: state.isReadOnly,
    daysRemaining: state.daysRemaining,
    updatedAtMs,
  };
}

export async function fetchAllOrganizationsForAdmin(
  adminSessionToken: string
): Promise<CloudAdminOrganizationSummary[]> {
  if (!adminSessionToken) {
    throw new ServerApiError('ADMIN_SESSION_REQUIRED', 'ADMIN_SESSION_REQUIRED', 403);
  }

  const runDirectFetchOrgs = async (): Promise<CloudAdminOrganizationSummary[]> => {
    const { user } = assertDirectPrimaryAdminUser();
    assertValidDirectAdminSession(adminSessionToken, user.uid);
    const q = query(collection(db, 'organizations'), limit(200));
    const snap = await getDocsFromServer(q).catch(() => getDocs(q));
    const rows = snap.docs.map((d) =>
      mapCloudAdminOrganizationSummary(d.id, d.data() as Record<string, unknown>)
    );
    return rows.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  };

  if (isDirectAdminSessionToken(adminSessionToken)) {
    return runDirectFetchOrgs();
  }

  const idToken = await getRequiredIdToken();
  try {
    const { response, payload } = await fetchAdminApiJson<{
      organizations?: CloudAdminOrganizationSummary[];
      error?: string;
      message?: string;
    }>('/api/admin/organizations', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'X-Admin-Session': adminSessionToken,
      },
    });

    if (!response.ok || !Array.isArray(payload.organizations)) {
      throw new ServerApiError(
        payload.error || 'ADMIN_ORGS_LIST_FAILED',
        payload.message || payload.error || 'ADMIN_ORGS_LIST_FAILED',
        response.status
      );
    }

    return payload.organizations.map((row) =>
      mapCloudAdminOrganizationSummary(row.id, row as unknown as Record<string, unknown>)
    );
  } catch (err) {
    if (!shouldFallbackAdminApiErrorToDirect(err, adminSessionToken, auth.currentUser?.uid)) {
      throw err;
    }
    return runDirectFetchOrgs();
  }
}

export async function adminUpdateOrganizationSubscription(params: {
  orgId: string;
  planTier: PlanTier;
  billingCycle: 'free' | 'monthly' | 'yearly' | 'lifetime';
  customDays?: number | null;
  customExpiresAt?: number | null;
  extendDays?: number | null;
  existingExpiresAt?: number | null;
  adminSessionToken: string;
}): Promise<CloudAdminOrganizationSummary> {
  if (!params.adminSessionToken) {
    throw new ServerApiError('ADMIN_SESSION_REQUIRED', 'ADMIN_SESSION_REQUIRED', 403);
  }

  const runDirectOrgUpdate = async (): Promise<CloudAdminOrganizationSummary> => {
    const { user } = assertDirectPrimaryAdminUser();
    assertValidDirectAdminSession(params.adminSessionToken, user.uid);
    const orgRef = doc(db, 'organizations', params.orgId);
    const snap = await getDocFromServer(orgRef).catch(() => getDoc(orgRef));
    if (!snap.exists()) {
      throw new ServerApiError('ORG_NOT_FOUND', 'تعذر العثور على المؤسسة.', 404);
    }
    const existingData = snap.data() as Record<string, unknown>;
    const existingExpiresAt =
      typeof params.existingExpiresAt === 'number' && Number.isFinite(params.existingExpiresAt)
        ? params.existingExpiresAt
        : typeof existingData.expiresAt === 'number' && Number.isFinite(existingData.expiresAt)
        ? existingData.expiresAt
        : typeof existingData.subscriptionEndsAt === 'number' &&
          Number.isFinite(existingData.subscriptionEndsAt)
        ? existingData.subscriptionEndsAt
        : null;
    const patch = buildDirectAdminOrgSubscriptionPatch({
      planTier: params.planTier,
      billingCycle: params.billingCycle,
      customDays: params.customDays,
      customExpiresAt: params.customExpiresAt,
      extendDays: params.extendDays,
      existingExpiresAt,
    });
    const nowMs = Date.now();
    await updateDoc(orgRef, {
      ...patch,
      updatedAt: nowMs,
    });
    return mapCloudAdminOrganizationSummary(params.orgId, {
      ...existingData,
      ...patch,
      updatedAt: nowMs,
    });
  };

  if (isDirectAdminSessionToken(params.adminSessionToken)) {
    return runDirectOrgUpdate();
  }

  const idToken = await getRequiredIdToken();
  try {
    const { response, payload } = await fetchAdminApiJson<
      Partial<CloudAdminOrganizationSummary> & { error?: string; message?: string }
    >(`/api/admin/organizations/${encodeURIComponent(params.orgId)}/subscription`, {
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
        ...(params.customExpiresAt && params.customExpiresAt > 0
          ? { customExpiresAt: params.customExpiresAt }
          : {}),
        ...(params.extendDays && params.extendDays > 0 ? { extendDays: params.extendDays } : {}),
        ...(typeof params.existingExpiresAt === 'number' && Number.isFinite(params.existingExpiresAt)
          ? { existingExpiresAt: params.existingExpiresAt }
          : {}),
      }),
    });

    if (!response.ok) {
      throw new ServerApiError(
        payload.error || 'ADMIN_ORG_SUBSCRIPTION_FAILED',
        payload.message || payload.error || 'ADMIN_ORG_SUBSCRIPTION_FAILED',
        response.status
      );
    }

    return mapCloudAdminOrganizationSummary(
      payload.id || params.orgId,
      payload as unknown as Record<string, unknown>
    );
  } catch (err) {
    if (!shouldFallbackAdminApiErrorToDirect(err, params.adminSessionToken, auth.currentUser?.uid)) {
      throw err;
    }
    return runDirectOrgUpdate();
  }
}

export async function adminCancelOrganizationSubscription(
  orgId: string,
  adminSessionToken: string
): Promise<CloudAdminOrganizationSummary> {
  return adminUpdateOrganizationSubscription({
    orgId,
    planTier: 'free',
    billingCycle: 'free',
    adminSessionToken,
  });
}

export async function signInWithGoogle(): Promise<{
  firebaseUser: User;
  profile: CloudUserProfile;
  profileSyncDeferred?: boolean;
}> {
  const { firebaseUser, profile, profileSyncDeferred } = await executeGoogleSignInWithRecovery<
    User,
    CloudUserProfile
  >({
    signInWithPopup: async () => {
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    },
    getCurrentUser: () => auth.currentUser,
    waitAuthStateReady: async () => {
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
      }
    },
    ensureUserProfile: (u) => ensureUserProfile(u),
    buildFallbackProfile: (u) =>
      buildFallbackCloudUserProfile({
        uid: u.uid,
        email: resolveFirebaseUserEmail(u) || u.email || '',
        displayName: u.displayName,
        photoURL: u.photoURL,
      }),
    scheduleDeferredProfileSync: (u) => {
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          if (auth.currentUser?.uid === u.uid) {
            void ensureUserProfile(u).catch(() => {});
          }
        }, 2500);
      }
    },
  });
  return { firebaseUser, profile, profileSyncDeferred };
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
  clearVerifiedAdminSession();
  await signOut(auth);
}

export function isOfflineFirestoreError(err: unknown): boolean {
  return isFirestoreServerFetchOfflineError(err);
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
    onProgress?: (processed: number, total: number) => void;
    activeCloudOrgCounts?: {
      orgId?: string;
      orgName?: string;
      transactions: number;
      wallets: number;
    };
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

    // Zero-Data Overwrite Protection: check both legacy meta AND unified personal collection
    // so an empty local personal cache can NEVER wipe non-empty personal cloud transactions.
    if (localTxCount === 0 && !options?.allowEmptyOverwrite) {
      const hasPersonalUnified = await hasWorkspaceTransactionsInCloud(uid, 'personal').catch(
        () => false
      );
      const localOrgTxCount = Object.values(effectiveData.orgWorkspaces || {}).reduce(
        (sum, ws) => sum + (ws?.transactions || []).filter((tx) => !tx?.deletedAt).length,
        0
      );

      // Only treat personal localTxCount === 0 as blocking when we're not specifically syncing non-empty org data
      // over an empty personal account that also has zero personal cloud transactions.
      const shouldGuardPersonal =
        shouldBlockEmptyCloudOverwrite({
          localTransactionsCount: localTxCount,
          cloudBackupTransactionsCount: cloudTotalTx,
          hasUnifiedCloudTransactions: hasPersonalUnified,
          allowEmptyOverwrite: Boolean(options?.allowEmptyOverwrite),
        }) ||
        (localOrgTxCount === 0 &&
          shouldBlockEmptyCloudOverwrite({
            localTransactionsCount: localTxCount,
            cloudBackupTransactionsCount: cloudTotalTx,
            hasUnifiedCloudTransactions: hasPersonalUnified,
          }));

      if (shouldGuardPersonal) {
        const source = options?.source === 'manual' ? 'manual' : 'auto';
        const [existingCloudData, unifiedPersonalTxs] =
          source === 'manual' || localOrgTxCount > 0
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
            totalTransactions: Math.max(cloudTotalTx, unifiedPersonalTxs.length, hasPersonalUnified ? 1 : 0),
            data: preservedCloudPayload,
          },
          source: localOrgTxCount > 0 ? 'manual' : source,
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

  const rawTransactions = effectiveData.transactions || [];
  if (rawTransactions.length > MAX_CLOUD_BACKUP_TRANSACTIONS) {
    throw new Error('BACKUP_TOO_LARGE');
  }

  let skippedAttachmentsCount = 0;
  const sanitizedTransactions = rawTransactions.map((tx) => {
    if (!tx.attachments || tx.attachments.length === 0) return tx;
    const kept = tx.attachments.filter((att) => att.length <= 24_000);
    skippedAttachmentsCount += tx.attachments.length - kept.length;
    return {
      ...tx,
      attachments: kept.length > 0 ? kept : undefined,
    };
  });

  // Measure actual UTF-8 byte lengths so every chunk and meta document stays well under 800KB.
  // Never silently truncate chunks; throw BACKUP_TOO_LARGE if limits are exceeded.
  const { chunks, storedTxCount } = prepareCloudBackupChunks(
    sanitizedTransactions,
    (items) => buildSafeSizeChunks(items, 780_000)
  );
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
    ? stripUndefinedDeep(
        Object.fromEntries(
          rawOrgEntries.map(([orgKey, ws]) => [
            orgKey,
            {
              ...ws,
              wallets: stripSensitivePinsFromWallets(ws.wallets || []),
            },
          ])
        )
      )
    : hasExplicitOrgWorkspacesMap
    ? {}
    : undefined;

  const cloudSafeSettings = stripSensitivePinFromSettings({
    ...effectiveData.settings,
    isPro: false,
  });
  const cloudSafeWallets = stripSensitivePinsFromWallets(
    (effectiveData.wallets || []).slice(0, 200)
  );

  let metaFields = stripUndefinedDeep({
    uid,
    schemaVersion: 2,
    chunkCount: chunks.length,
    totalTransactions: storedTxCount,
    wallets: cloudSafeWallets,
    categories: (effectiveData.categories || []).slice(0, 300),
    budgets: (effectiveData.budgets || []).slice(0, 200),
    debts: (effectiveData.debts || []).slice(0, 500),
    goals: (effectiveData.goals || []).slice(0, 200),
    templates: (effectiveData.templates || []).slice(0, 300),
    moneyCircles: (effectiveData.moneyCircles || []).slice(0, 200),
    ...(orgWorkspacesToSave !== undefined ? { orgWorkspaces: orgWorkspacesToSave } : {}),
    ...(cleanActiveWorkspace ? { activeWorkspace: cleanActiveWorkspace } : {}),
    settings: cloudSafeSettings,
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

    const totalChunkTxs = storedTxCount;

    // Write transaction chunks concurrently with bounded parallelism & automatic retry
    if (chunks.length > 0) {
      const chunkEntries = chunks.map((txs, idx) => ({
        idx,
        txs: stripUndefinedDeep(txs),
      }));
      let committedTxs = 0;

      await runResilientBatchCommits({
        items: chunkEntries,
        batchSize: 2, // 2 chunks per batch stays safely under 1.8 MB/batch
        concurrency: FIRESTORE_BATCH_CONCURRENCY,
        maxRetries: 3,
        commitChunk: async (group) => {
          const chunkBatch = writeBatch(db);
          let groupTxCount = 0;
          for (const item of group) {
            const chunkRef = doc(db, 'users', uid, 'backupChunks', `chunk_${item.idx}`);
            chunkBatch.set(
              chunkRef,
              {
                uid,
                chunkIndex: item.idx,
                transactions: item.txs,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
            groupTxCount += item.txs.length;
          }
          await chunkBatch.commit();
          committedTxs = Math.min(totalChunkTxs, committedTxs + groupTxCount);
          if (options?.onProgress && totalChunkTxs > 0) {
            options.onProgress(committedTxs, totalChunkTxs);
          }
        },
      });
    }

    // Commit backup metadata and prune any stale chunks after chunks are durably written
    const metaBatch = writeBatch(db);
    const metaWritePayload = {
      ...metaFields,
      ...(!metaExists ? { createdAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    };
    metaBatch.set(metaRef, metaWritePayload, { merge: true });

    for (let idx = chunks.length; idx < previousChunkCount; idx++) {
      const staleRef = doc(db, 'users', uid, 'backupChunks', `chunk_${idx}`);
      metaBatch.delete(staleRef);
    }

    await metaBatch.commit();
    if (options?.onProgress && totalChunkTxs > 0) {
      options.onProgress(totalChunkTxs, totalChunkTxs);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, metaPath);
  }

  try {
    if (auth.currentUser?.uid === uid) {
      await ensureUserProfile(auth.currentUser);
    }
    await setDoc(
      userRef,
      {
        ...buildSafeCloudLastSyncedPatch(updatedAtMs),
        ...(effectiveData.hasCompletedOnboarding ? { hasCompletedOnboarding: true } : {}),
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
      const historyCounts = computeBackupHistoryCounts(effectiveData, {
        extraOrgId: options?.activeCloudOrgCounts?.orgId,
        extraOrgName: options?.activeCloudOrgCounts?.orgName,
        extraTransactions: options?.activeCloudOrgCounts?.transactions,
        extraWallets: options?.activeCloudOrgCounts?.wallets,
      });
      const { snapshotJson, storedTransactionsCount } = buildCompactBackupHistorySnapshotJson({
        ...effectiveData,
        updatedAtMs,
        ...(options?.activeCloudOrgCounts?.orgName &&
        effectiveData.activeWorkspace === options.activeCloudOrgCounts.orgId
          ? { activeWorkspaceName: options.activeCloudOrgCounts.orgName }
          : {}),
        ...(options?.activeCloudOrgCounts
          ? { activeCloudOrgCounts: options.activeCloudOrgCounts }
          : {}),
      });

      const historyRef = doc(db, 'users', uid, 'backupHistory', historyId);
      await setDoc(historyRef, {
        id: historyId,
        uid,
        source,
        createdAtMs: updatedAtMs,
        totalTransactions: historyCounts.totalTransactions,
        storedTransactionsCount,
        walletsCount: historyCounts.walletsCount,
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
    await ensureUserProfile(auth.currentUser);
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
        const rawSummary: BackupHistorySummary = {
          id: d.id,
          uid,
          source: (data.source === 'manual' ? 'manual' : 'auto') as 'manual' | 'auto',
          createdAtMs: Number(data.createdAtMs || 0),
          totalTransactions: Number(data.totalTransactions || 0),
          storedTransactionsCount: Number(data.storedTransactionsCount || 0),
          walletsCount: Number(data.walletsCount || 0),
        };
        return reconcileBackupHistorySummary(
          rawSummary,
          typeof data.snapshotJson === 'string' ? data.snapshotJson : undefined
        );
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
    if (isOfflineFirestoreError(error)) {
      console.warn('[fetchCloudBackup] Offline/server-unreachable notice:', error);
      throw error;
    }
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
  txs: Transaction[],
  options?: {
    batchSize?: number;
    concurrency?: number;
    onProgress?: (processed: number, total: number) => void;
  }
): Promise<number> {
  if (txs.length === 0) return 0;
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('AUTH_REQUIRED_FOR_CLOUD_SYNC');
  }
  const safeWs = normalizeWorkspaceId(workspaceId);
  const colPath = getWorkspaceTransactionsPath(uid, safeWs);
  const batchLimit = Math.max(
    1,
    Math.min(450, Math.floor(options?.batchSize ?? FIRESTORE_FAST_BATCH_SIZE))
  );
  const validTxs = txs.filter((tx): tx is Transaction => Boolean(tx && tx.id));
  const total = validTxs.length;
  if (total === 0) return 0;

  try {
    const result = await runResilientBatchCommits({
      items: validTxs,
      batchSize: batchLimit,
      concurrency: options?.concurrency ?? FIRESTORE_BATCH_CONCURRENCY,
      maxRetries: 3,
      onProgress: options?.onProgress,
      commitChunk: async (chunk) => {
        const batch = writeBatch(db);
        for (const tx of chunk) {
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
        }
        await batch.commit();
      },
    });
    return result.committed;
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
    if (isOfflineFirestoreError(error)) {
      if (!forceServer) {
        return [];
      }
      console.warn(`[fetchWorkspaceTransactionsCloud] (${colPath}) server unreachable:`, error);
      throw error;
    }
    console.error(`[fetchWorkspaceTransactionsCloud] (${colPath}) error:`, error);
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

/**
 * Bidirectional Zero-Data Overwrite Guard coordinator:
 * Never permits an empty cloud result (0 transactions) to wipe local transactions.
 * When Cloud has 0 transactions while Browser has local transactions, prioritizes
 * uploading Local -> Cloud immediately.
 */
export async function syncWorkspaceTransactionsWithZeroGuard(params: {
  uid: string;
  workspaceId: string;
  cloudTransactions: Transaction[];
  localTransactions: Transaction[];
  locallyDeletedIds?: Iterable<string>;
  allowEmptyOverwrite?: boolean;
}): Promise<{
  priority: WorkspaceSyncPriority;
  transactions: Transaction[];
  pushedCount: number;
}> {
  const safeWs = normalizeWorkspaceId(params.workspaceId);
  const deletedSet = new Set(params.locallyDeletedIds || []);
  const priority = resolveWorkspaceSyncPriority({
    cloudTransactions: params.cloudTransactions,
    localTransactions: params.localTransactions,
    activeWorkspaceId: safeWs,
    locallyDeletedIds: deletedSet,
    allowEmptyOverwrite: params.allowEmptyOverwrite,
  });

  if (priority === 'push_local_to_cloud') {
    const activeLocal = params.localTransactions.filter(
      (tx) => isActiveWorkspaceTransaction(tx, safeWs) && !deletedSet.has(tx.id)
    );
    let pushedCount = 0;
    if (
      activeLocal.length > 0 &&
      params.uid &&
      auth.currentUser?.uid === params.uid &&
      (typeof navigator === 'undefined' || navigator.onLine)
    ) {
      pushedCount = await batchUpsertWorkspaceTransactionsCloud(params.uid, safeWs, activeLocal);
    }
    return {
      priority,
      transactions: sortTransactionsDescending(activeLocal),
      pushedCount,
    };
  }

  const reconciled = reconcileWorkspaceTransactions(
    params.cloudTransactions,
    params.localTransactions,
    {
      activeWorkspaceId: safeWs,
      hasServerSnapshot: true,
      locallyDeletedIds: deletedSet,
      allowEmptyOverwrite: params.allowEmptyOverwrite,
    }
  );
  return {
    priority,
    transactions: reconciled,
    pushedCount: 0,
  };
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
