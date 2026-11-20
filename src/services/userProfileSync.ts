/**
 * Pure helpers for safe, rules-compliant Firestore `users/{uid}` profile creation,
 * owner-scoped updates, transient error classification, and user-facing error formatting.
 */

import { formatDetailedGoogleAuthError } from './googleAuthFlow';

export interface InitialUserProfileInput {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  username?: string | null;
  photoURL?: string | null;
  hasCompletedOnboarding?: boolean;
}

export interface SafeUserProfileUpdateInput {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  username?: string | null;
  photoURL?: string | null;
  hasCompletedOnboarding?: boolean;
  existing?: {
    uid?: string;
    email?: string;
    displayName?: string;
    username?: string;
    photoURL?: string;
    hasCompletedOnboarding?: boolean;
  } | null;
}

export const OWNER_UPDATABLE_PROFILE_FIELDS = new Set([
  'uid',
  'email',
  'displayName',
  'username',
  'photoURL',
  'hasCompletedOnboarding',
  'currencyRates',
  'settings',
  'lastSyncedAt',
  'updatedAt',
]);

export const PRIVILEGED_PROFILE_FIELDS = new Set([
  'isPro',
  'proActive',
  'proPlan',
  'planTier',
  'billingCycle',
  'startedAt',
  'expiresAt',
  'proExpiresAt',
  'hasUsedBusinessTrial',
  'redeemedCouponCode',
  'activationCodeHash',
  'isAdmin',
  'createdAt',
]);

function normalizeProfileEmail(uid: string, email?: string | null): string {
  const cleaned = typeof email === 'string' ? email.trim() : '';
  const fallback = cleaned || `${uid}@firebase.local`;
  return fallback.slice(0, 254);
}

function sanitizeOptionalString(value: string | null | undefined, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

/**
 * Builds the initial free-tier user profile payload for `allow create` on `users/{uid}`.
 * Strictly adheres to `isValidUserProfileCreate` in `firestore.rules`.
 * Note: `createdAt` and `updatedAt` are attached as `serverTimestamp()` by the Firestore layer.
 */
export function buildInitialUserProfilePayload(
  input: InitialUserProfileInput
): Record<string, unknown> {
  const safeUid = String(input.uid || '').trim().slice(0, 128);
  const payload: Record<string, unknown> = {
    uid: safeUid,
    email: normalizeProfileEmail(safeUid, input.email),
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

  const displayName = sanitizeOptionalString(input.displayName, 120);
  if (displayName) {
    payload.displayName = displayName;
  }

  const username = sanitizeOptionalString(input.username, 30)?.toLowerCase();
  if (username && /^[a-z0-9_]{3,30}$/.test(username)) {
    payload.username = username;
  }

  const photoURL = sanitizeOptionalString(input.photoURL, 512);
  if (photoURL) {
    payload.photoURL = photoURL;
  }

  if (typeof input.hasCompletedOnboarding === 'boolean') {
    payload.hasCompletedOnboarding = input.hasCompletedOnboarding;
  }

  return payload;
}

/**
 * Builds a strictly owner-safe update patch for an existing `users/{uid}` document.
 * NEVER includes `createdAt` or any privileged subscription/admin field.
 * Returns `hasChanges: false` when nothing actually changed so callers can skip redundant writes.
 */
export function buildSafeUserProfileUpdatePatch(input: SafeUserProfileUpdateInput): {
  patch: Record<string, unknown>;
  hasChanges: boolean;
} {
  const safeUid = String(input.uid || '').trim().slice(0, 128);
  const existing = input.existing || null;
  const patch: Record<string, unknown> = {};

  if (!existing || existing.uid !== safeUid) {
    patch.uid = safeUid;
  }

  const nextEmail = normalizeProfileEmail(safeUid, input.email || existing?.email);
  if (!existing || existing.email !== nextEmail) {
    patch.email = nextEmail;
  }

  const nextDisplayName = sanitizeOptionalString(input.displayName, 120);
  if (nextDisplayName && nextDisplayName !== existing?.displayName) {
    patch.displayName = nextDisplayName;
  }

  const nextUsername = sanitizeOptionalString(input.username, 30)?.toLowerCase();
  if (
    nextUsername &&
    /^[a-z0-9_]{3,30}$/.test(nextUsername) &&
    nextUsername !== existing?.username
  ) {
    patch.username = nextUsername;
  }

  const nextPhotoURL = sanitizeOptionalString(input.photoURL, 512);
  if (nextPhotoURL && nextPhotoURL !== existing?.photoURL) {
    patch.photoURL = nextPhotoURL;
  }

  if (
    typeof input.hasCompletedOnboarding === 'boolean' &&
    existing?.hasCompletedOnboarding !== input.hasCompletedOnboarding
  ) {
    patch.hasCompletedOnboarding = input.hasCompletedOnboarding;
  }

  return {
    patch,
    hasChanges: Object.keys(patch).length > 0,
  };
}

/**
 * Detects Firestore permission-denied errors across native FirebaseError instances
 * and wrapped JSON strings produced by `handleFirestoreError`.
 */
export function isPermissionDeniedFirestoreError(err: unknown): boolean {
  if (!err) return false;
  const code =
    typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '').toLowerCase()
      : '';
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message || '')
      : String(err);
  const normalized = `${code} ${message}`.toLowerCase();
  return (
    normalized.includes('permission-denied') ||
    normalized.includes('permission_denied') ||
    normalized.includes('missing or insufficient permissions')
  );
}

/**
 * Determines whether a cloud startup/sync error should be surfaced as a visible
 * diagnostics banner to the user. Suppresses transient startup/onboarding initialization
 * errors for normal users while preserving explicit recovery errors and post-onboarding alerts.
 */
export function shouldSurfaceCloudDiagnosticsError(params: {
  isInitialAccountSetup: boolean;
  hasCompletedOnboarding: boolean;
  recoveredByRetry?: boolean;
  isExplicitRecoveryAction?: boolean;
}): boolean {
  if (params.recoveredByRetry) return false;
  if (params.isExplicitRecoveryAction) return true;
  if (params.isInitialAccountSetup || !params.hasCompletedOnboarding) {
    return false;
  }
  return true;
}

/**
 * Converts raw Firebase / wrapped JSON errors into clean, user-friendly Arabic/English copy.
 */
export function formatUserFriendlyAuthError(err: unknown, isRTL: boolean): string {
  return formatDetailedGoogleAuthError(err, isRTL);
}
