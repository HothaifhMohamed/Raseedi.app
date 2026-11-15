/**
 * Pure policy helpers for local-first / offline-first account deletion fallback.
 */

export function extractAccountDeleteErrorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) {
      return code.trim();
    }
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }
  return '';
}

/**
 * Only genuine multi-member server ownership conflicts abort account deletion.
 * Any server/network/unavailable/permission/reauth error falls back smoothly to
 * local IndexedDB wipe + best-effort Firestore cleanup + Firebase signOut(auth).
 */
export function shouldFallbackAccountDeleteError(err: unknown): boolean {
  const code = extractAccountDeleteErrorCode(err);
  if (code === 'ORG_OWNERSHIP_TRANSFER_REQUIRED') {
    return false;
  }
  return true;
}
