/**
 * Pure Google Authentication flow helpers:
 * - Prevents onAuthStateChanged race conditions during interactive sign-in
 * - Classifies Firebase Auth & Firestore errors into accurate user-facing messages
 * - Recovers cleanly from post-popup transient token/profile sync blips and popup races
 */

import type { CloudUserProfile } from './firebase';

export type GoogleAuthErrorKind =
  | 'popup_closed'
  | 'popup_blocked'
  | 'popup_cancelled'
  | 'network'
  | 'unauthorized_domain'
  | 'too_many_requests'
  | 'account_conflict'
  | 'permission_denied'
  | 'transient'
  | 'unknown';

export interface AuthUserLike {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  getIdToken?: (forceRefresh?: boolean) => Promise<string>;
}

/**
 * While an interactive `signInWithGoogleAccount()` flow is in flight, `onAuthStateChanged`
 * fires as soon as `signInWithPopup` resolves (and may also fire an initial `null` event).
 * Ignoring `onAuthStateChanged` BEFORE mutating `syncRequestIdRef` prevents the first-attempt
 * race condition that previously invalidated `signInWithGoogleAccount()` mid-flight.
 */
export function shouldIgnoreAuthStateChangeDuringInteractiveSignIn(
  activeInteractiveGoogleSignIn: boolean
): boolean {
  return Boolean(activeInteractiveGoogleSignIn);
}

function extractErrorCodeAndMessage(err: unknown): { code: string; message: string; combined: string } {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '').trim().toLowerCase()
      : '';
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message || '')
      : String(err || '');
  return {
    code,
    message,
    combined: `${code} ${message}`.toLowerCase(),
  };
}

export function classifyGoogleAuthError(err: unknown): GoogleAuthErrorKind {
  const { code, combined } = extractErrorCodeAndMessage(err);

  if (code === 'auth/popup-closed-by-user' || combined.includes('popup-closed-by-user')) {
    return 'popup_closed';
  }
  if (code === 'auth/popup-blocked' || combined.includes('popup-blocked')) {
    return 'popup_blocked';
  }
  if (
    code === 'auth/cancelled-popup-request' ||
    combined.includes('cancelled-popup-request')
  ) {
    return 'popup_cancelled';
  }
  if (
    code === 'auth/network-request-failed' ||
    combined.includes('network-request-failed') ||
    combined.includes('failed to fetch') ||
    combined.includes('client is offline') ||
    combined.includes('offline') ||
    code === 'unavailable'
  ) {
    return 'network';
  }
  if (
    code === 'auth/unauthorized-domain' ||
    combined.includes('unauthorized-domain')
  ) {
    return 'unauthorized_domain';
  }
  if (
    code === 'auth/too-many-requests' ||
    combined.includes('too-many-requests')
  ) {
    return 'too_many_requests';
  }
  if (
    code === 'auth/account-exists-with-different-credential' ||
    combined.includes('account-exists-with-different-credential')
  ) {
    return 'account_conflict';
  }
  if (
    code === 'permission-denied' ||
    combined.includes('permission-denied') ||
    combined.includes('permission_denied') ||
    combined.includes('missing or insufficient permissions')
  ) {
    return 'permission_denied';
  }
  if (
    code === 'auth/internal-error' ||
    code === 'deadline-exceeded' ||
    code === 'aborted' ||
    combined.includes('internal-error') ||
    combined.includes('deadline-exceeded')
  ) {
    return 'transient';
  }
  return 'unknown';
}

export function isTransientProfileSyncError(err: unknown): boolean {
  const kind = classifyGoogleAuthError(err);
  return kind === 'network' || kind === 'permission_denied' || kind === 'transient';
}

export function shouldAttemptCurrentUserRecovery(err: unknown): boolean {
  const kind = classifyGoogleAuthError(err);
  // Popup blocked / unauthorized domain / account conflict never produce a signed-in user
  return (
    kind === 'popup_cancelled' ||
    kind === 'popup_closed' ||
    kind === 'transient' ||
    kind === 'network' ||
    kind === 'unknown'
  );
}

export function buildFallbackCloudUserProfile(
  user: Pick<AuthUserLike, 'uid' | 'email' | 'displayName' | 'photoURL'>
): CloudUserProfile {
  const email = typeof user.email === 'string' ? user.email.trim() : '';
  return {
    uid: user.uid,
    email,
    displayName: user.displayName || undefined,
    photoURL: user.photoURL || undefined,
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

export function formatDetailedGoogleAuthError(err: unknown, isRTL: boolean): string {
  const { message } = extractErrorCodeAndMessage(err);
  const kind = classifyGoogleAuthError(err);

  switch (kind) {
    case 'popup_closed':
      return isRTL
        ? 'تم إغلاق نافذة تسجيل الدخول بحساب جوجل قبل إتمام العملية. يمكنك المحاولة مرة أخرى.'
        : 'Google sign-in window was closed before finishing. Please try again.';
    case 'popup_blocked':
      return isRTL
        ? 'منع المتصفح فتح نافذة تسجيل الدخول بحساب جوجل. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.'
        : 'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.';
    case 'popup_cancelled':
      return isRTL
        ? 'تم إلغاء طلب تسجيل الدخول السابق بحساب جوجل. اضغط مرة أخرى للمتابعة.'
        : 'Previous Google sign-in request was cancelled. Please click again to continue.';
    case 'network':
      return isRTL
        ? 'تعذر الاتصال بالإنترنت أثناء تسجيل الدخول. تحقق من الشبكة وحاول مرة أخرى.'
        : 'Network connection error during sign-in. Check your connection and try again.';
    case 'unauthorized_domain':
      return isRTL
        ? 'نطاق هذا الموقع غير مُفعّل حالياً لتسجيل الدخول بحساب جوجل في إعدادات Firebase.'
        : 'This domain is not authorized for Google sign-in in Firebase settings.';
    case 'too_many_requests':
      return isRTL
        ? 'تم إرسال عدة محاولات متتالية لتسجيل الدخول. انتظر لحظة ثم حاول مرة أخرى.'
        : 'Too many sign-in attempts. Please wait a moment and try again.';
    case 'account_conflict':
      return isRTL
        ? 'هذا البريد مسجل بالفعل بطريقة دخول مختلفة. جرّب الحساب المرتبط أو تواصل مع الدعم.'
        : 'An account already exists with this email using a different sign-in method.';
    case 'permission_denied':
      return isRTL
        ? 'جاري إكمال تهيئة حسابك السحابي. يرجى المحاولة مرة أخرى خلال لحظة.'
        : 'Finalizing your cloud account setup. Please try again in a moment.';
    default:
      break;
  }

  // Avoid leaking raw serialized FirestoreErrorInfo JSON payloads to end users
  if (message.trim().startsWith('{') && message.includes('"operationType"')) {
    return isRTL
      ? 'حدث تعذر مؤقت أثناء الاتصال بالسحابة. يرجى المحاولة مرة أخرى.'
      : 'A temporary cloud connection issue occurred. Please try again.';
  }

  return isRTL
    ? 'تعذر إتمام تسجيل الدخول بحساب جوجل. حاول مرة أخرى أو جرب الدخول كزائر.'
    : 'Could not complete Google sign-in. Please try again or continue as Guest.';
}

export interface GoogleSignInRecoveryDeps<TUser extends AuthUserLike, TProfile> {
  signInWithPopup: () => Promise<TUser>;
  getCurrentUser: () => TUser | null;
  waitAuthStateReady?: () => Promise<void>;
  ensureUserProfile: (user: TUser) => Promise<TProfile>;
  buildFallbackProfile: (user: TUser) => TProfile;
  scheduleDeferredProfileSync?: (user: TUser) => void;
  delay?: (ms: number) => Promise<void>;
}

export interface GoogleSignInRecoveryResult<TUser extends AuthUserLike, TProfile> {
  firebaseUser: TUser;
  profile: TProfile;
  profileSyncDeferred: boolean;
  recoveredFromCurrentUser: boolean;
}

const defaultDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executes Google popup sign-in with:
 * 1) Recovery if Firebase Auth actually completed sign-in (`auth.currentUser`) despite a popup race error
 * 2) Auth ID token warm-up before the first Firestore read/write
 * 3) One bounded retry on transient `ensureUserProfile` errors
 * 4) Graceful fallback profile + background retry if Firestore is transiently unreachable after OAuth succeeds
 */
export async function executeGoogleSignInWithRecovery<
  TUser extends AuthUserLike,
  TProfile
>(
  deps: GoogleSignInRecoveryDeps<TUser, TProfile>
): Promise<GoogleSignInRecoveryResult<TUser, TProfile>> {
  const delay = deps.delay ?? defaultDelay;
  let firebaseUser: TUser | null = null;
  let recoveredFromCurrentUser = false;

  try {
    firebaseUser = await deps.signInWithPopup();
  } catch (popupErr) {
    if (shouldAttemptCurrentUserRecovery(popupErr)) {
      if (deps.waitAuthStateReady) {
        await deps.waitAuthStateReady().catch(() => {});
      }
      let candidate = deps.getCurrentUser();
      if (!candidate) {
        await delay(150);
        candidate = deps.getCurrentUser();
      }
      if (candidate) {
        firebaseUser = candidate;
        recoveredFromCurrentUser = true;
      } else {
        throw popupErr;
      }
    } else {
      throw popupErr;
    }
  }

  // Ensure the newly minted ID token is settled before Firestore executes initial reads/writes
  if (typeof firebaseUser.getIdToken === 'function') {
    await firebaseUser.getIdToken(false).catch(() => {});
  }

  let profile: TProfile;
  let profileSyncDeferred = false;

  try {
    profile = await deps.ensureUserProfile(firebaseUser);
  } catch (firstProfileErr) {
    // Retry once on transient token/network/permission propagation blips
    if (isTransientProfileSyncError(firstProfileErr)) {
      await delay(300);
      if (typeof firebaseUser.getIdToken === 'function') {
        await firebaseUser.getIdToken(false).catch(() => {});
      }
      try {
        profile = await deps.ensureUserProfile(firebaseUser);
      } catch {
        // Google OAuth already succeeded; never trap the authenticated user on AuthGateScreen
        profile = deps.buildFallbackProfile(firebaseUser);
        profileSyncDeferred = true;
        deps.scheduleDeferredProfileSync?.(firebaseUser);
      }
    } else {
      // Even on unexpected profile error, Google Auth already succeeded; degrade gracefully
      profile = deps.buildFallbackProfile(firebaseUser);
      profileSyncDeferred = true;
      deps.scheduleDeferredProfileSync?.(firebaseUser);
    }
  }

  return {
    firebaseUser,
    profile,
    profileSyncDeferred,
    recoveredFromCurrentUser,
  };
}
