/**
 * Exclusive System Admin Identity Constants & Helpers
 * Subscriptions are activated directly by the verified system admin in Firestore.
 */
export const PRIMARY_SYSTEM_ADMIN_EMAIL = 'hapaypal2003@gmail.com';

export function isPrimarySystemAdminEmail(email?: string | null): boolean {
  if (typeof email !== 'string') return false;
  return email.trim().toLowerCase() === PRIMARY_SYSTEM_ADMIN_EMAIL;
}
