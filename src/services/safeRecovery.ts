import { AppDatabaseData } from './db';
import { OrgWorkspaceData, Transaction } from '../types';
import {
  isFirestoreMissingIndexError,
  mergeTransactionsById,
  sortTransactionsDescending,
} from './orgTransactionQuery';
import {
  mergeSettingsPreservingTheme,
  readStoredThemePreference,
} from './workspaceSync';
import {
  filterDeletedOrgWorkspaces,
  loadDeletedOrgIds,
  resolveSafeActiveWorkspace,
} from './workspaceCleanup';

export interface CloudStartupCheckInput {
  localTransactionsCount: number;
  hasCloudBackup: boolean;
  cloudUpdatedAtMs: number;
  localLastKnownCloudUpdatedAtMs?: number;
}

/**
 * Cloud-First startup decision:
 * Restores/merges from Cloud Firestore whenever a cloud backup exists AND either:
 * - local transactions are empty (e.g. fresh cache / cleared localStorage), OR
 * - cloud snapshot is strictly newer than the last known synced timestamp on this device.
 */
export function shouldRestoreCloudOnStartup(input: CloudStartupCheckInput): boolean {
  if (!input.hasCloudBackup) return false;
  if (input.localTransactionsCount === 0) return true;
  const localSyncedAt = Number(input.localLastKnownCloudUpdatedAtMs || 0);
  return input.cloudUpdatedAtMs > localSyncedAt;
}

function mergeArrayById<T extends { id: string; updatedAt?: number }>(
  primary: T[],
  secondary: T[]
): T[] {
  const byId = new Map<string, T>();
  for (const item of secondary) {
    if (item && item.id) byId.set(item.id, item);
  }
  for (const item of primary) {
    if (!item || !item.id) continue;
    const prev = byId.get(item.id);
    if (!prev || Number(item.updatedAt || 0) >= Number(prev.updatedAt || 0)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

export interface MergeCloudAndLocalInput {
  localData: Omit<AppDatabaseData, 'user'> & {
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
  };
  cloudData: Partial<Omit<AppDatabaseData, 'user'>> & {
    orgWorkspaces?: Record<string, OrgWorkspaceData>;
    activeWorkspace?: string;
  };
  preferCloud?: boolean;
  deletedOrgIds?: Iterable<string>;
}

export function mergeCloudAndLocalState(params: MergeCloudAndLocalInput): Omit<AppDatabaseData, 'user'> & {
  orgWorkspaces?: Record<string, OrgWorkspaceData>;
  activeWorkspace?: string;
} {
  const { localData, cloudData, preferCloud = true, deletedOrgIds } = params;
  const effectiveDeletedIds =
    deletedOrgIds !== undefined ? Array.from(deletedOrgIds) : loadDeletedOrgIds();
  const cloudTxs = Array.isArray(cloudData.transactions) ? cloudData.transactions : [];
  const localTxs = Array.isArray(localData.transactions) ? localData.transactions : [];

  const mergedTransactions: Transaction[] = preferCloud
    ? mergeTransactionsById(cloudTxs, localTxs)
    : mergeTransactionsById(localTxs, cloudTxs);

  const cloudWallets = Array.isArray(cloudData.wallets) ? cloudData.wallets : [];
  const localWallets = Array.isArray(localData.wallets) ? localData.wallets : [];
  const mergedWallets = preferCloud
    ? mergeArrayById(cloudWallets, localWallets)
    : mergeArrayById(localWallets, cloudWallets);

  const cloudCategories = Array.isArray(cloudData.categories) ? cloudData.categories : [];
  const localCategories = Array.isArray(localData.categories) ? localData.categories : [];
  const mergedCategories = preferCloud
    ? mergeArrayById(cloudCategories, localCategories)
    : mergeArrayById(localCategories, cloudCategories);

  const mergedOrgWorkspaces = filterDeletedOrgWorkspaces(
    {
      ...(localData.orgWorkspaces || {}),
      ...(cloudData.orgWorkspaces || {}),
    },
    effectiveDeletedIds
  );

  return {
    transactions: sortTransactionsDescending(mergedTransactions),
    wallets: mergedWallets,
    categories: mergedCategories,
    budgets: mergeArrayById(cloudData.budgets || [], localData.budgets || []),
    debts: mergeArrayById(cloudData.debts || [], localData.debts || []),
    goals: mergeArrayById(cloudData.goals || [], localData.goals || []),
    templates: mergeArrayById(cloudData.templates || [], localData.templates || []),
    moneyCircles: mergeArrayById(cloudData.moneyCircles || [], localData.moneyCircles || []),
    orgWorkspaces: mergedOrgWorkspaces,
    activeWorkspace: resolveSafeActiveWorkspace(
      cloudData.activeWorkspace || localData.activeWorkspace,
      effectiveDeletedIds
    ),
    settings: mergeSettingsPreservingTheme(
      localData.settings,
      cloudData.settings,
      preferCloud,
      readStoredThemePreference()
    ).settings,
    hasCompletedOnboarding: Boolean(
      cloudData.hasCompletedOnboarding ?? localData.hasCompletedOnboarding ?? true
    ),
  };
}

export function formatFirestoreErrorForDisplay(err: unknown, isRTL: boolean): string {
  if (!err) {
    return isRTL ? 'حدث خطأ غير معروف أثناء الاتصال بقاعدة البيانات.' : 'Unknown database error.';
  }
  const obj =
    typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null;
  const code = obj?.code ? String(obj.code) : '';
  const rawMessage = err instanceof Error ? err.message : String(obj?.message || err);

  if (rawMessage.includes('BALANCE_RECALC_FAILED')) {
    return isRTL
      ? 'تم حفظ بعض المعاملات لكن تعذّر تحديث أو إعادة احتساب أرصدة المحافظ تلقائياً (BALANCE_RECALC_FAILED). يُرجى فتح «مركز المؤسسة ← التقارير ← إعادة احتساب الأرصدة» لضمان دقة أرصدة المحافظ.'
      : 'Some transactions were saved, but automatic wallet balance update/recalculation failed (BALANCE_RECALC_FAILED). Please open Organization Hub → Reports → Recalculate Balances to restore accurate balances.';
  }
  if (rawMessage.includes('ONLY_OWNER_CAN_MANAGE_ADMIN')) {
    return isRTL
      ? 'لا يمكن للمدير تعديل أو إزالة مدير آخر. هذه الصلاحية محصورة بمالك المؤسسة فقط.'
      : 'Admins cannot modify or remove another admin. Only the organization owner can manage admin members.';
  }
  if (rawMessage.includes('OWNER_CANNOT_LEAVE_ORG')) {
    return isRTL
      ? 'لا يمكن لمالك المؤسسة المغادرة مباشرة. يرجى نقل الملكية لعضو آخر أو حذف المؤسسة.'
      : 'The organization owner cannot leave directly. Please transfer ownership first or delete the organization.';
  }
  if (rawMessage.includes('BACKUP_TOO_LARGE')) {
    return isRTL
      ? 'حجم النسخة السحابية يتجاوز الحد الأقصى المسموح به (حتى 40,000 معاملة / 99 حزمة). لم يتم حفظ النسخة لمنع فقدان أي معاملات — يُنصح بتصدير نسخة JSON محلية أو أرشفة المعاملات القديمة.'
      : 'Cloud backup exceeds the maximum allowed size (up to 40,000 transactions / 99 chunks). The backup was cancelled to prevent silent data loss — please export a local JSON backup or archive older transactions.';
  }
  if (rawMessage.includes('BACKUP_META_TOO_LARGE')) {
    return isRTL
      ? 'حجم بيانات النسخة الاحتياطية يتجاوز الحد الأقصى المسموح به في السحابة. يُنصح بتصدير نسخة JSON محلية.'
      : 'Cloud backup metadata exceeds the maximum allowed document size. Please export a local JSON backup.';
  }
  if (isFirestoreMissingIndexError(err)) {
    return isRTL
      ? `خطأ فهرس Firestore (${code || 'failed-precondition'}): ${rawMessage}`
      : `Firestore Index Error (${code || 'failed-precondition'}): ${rawMessage}`;
  }
  if (code === 'permission-denied') {
    console.warn('[firestore] permission-denied:', rawMessage, err);
    return isRTL
      ? 'ليس لديك صلاحية تنفيذ هذه العملية حالياً. تأكد من تسجيل الدخول بحساب Google المفعّل وتحديث الصفحة ثم حاول مرة أخرى.'
      : 'Permission denied for this action. Please ensure you are signed in with a verified Google account, refresh the page, and try again.';
  }
  if (code === 'unavailable' || rawMessage.toLowerCase().includes('offline')) {
    return isRTL
      ? `السحابة غير متاحة حالياً أو الجهاز غير متصل (${code || 'unavailable'}): ${rawMessage}`
      : `Cloud Firestore unavailable/offline (${code || 'unavailable'}): ${rawMessage}`;
  }
  return code ? `[${code}] ${rawMessage}` : rawMessage;
}
