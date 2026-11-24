import type {
  Organization,
  OrganizationRole,
  OrgRef,
  OrgWorkspaceData,
} from '../types';

export interface WorkspaceOrgPermissionSummary {
  role: OrganizationRole | null;
  isCloudOrg: boolean;
  isLocalOnly: boolean;
  isOrphan: boolean;
  canDelete: boolean;
}

/**
 * Resolves the current user's effective role and deletion eligibility for any
 * organization card shown in the Workspace Switcher or Organization Hub.
 *
 * Deletion is allowed when:
 * - The user is the organization owner (`role === 'owner'`), OR
 * - The workspace exists only locally (`!hasCloudOrgRef`), OR
 * - The entry is orphaned / lacks a clear role in the membership list (`!role`).
 */
export function resolveWorkspaceOrgPermissions(params: {
  org: Pick<Organization, 'id' | 'ownerUid' | 'localFirstMode'>;
  orgRefs: OrgRef[];
  localOrgWorkspaces: Record<string, OrgWorkspaceData>;
  currentUserId?: string | null;
  activeWorkspace?: string | null;
  activeOrgRole?: OrganizationRole | null;
}): WorkspaceOrgPermissionSummary {
  const {
    org,
    orgRefs,
    localOrgWorkspaces,
    currentUserId,
    activeWorkspace,
    activeOrgRole,
  } = params;

  const orgRef = orgRefs.find((r) => r.orgId === org.id) || null;
  const localWs =
    localOrgWorkspaces[org.id] ||
    Object.values(localOrgWorkspaces).find((w) => w?.organization?.id === org.id) ||
    null;

  const isCloudOrg = Boolean(orgRef);
  const isLocalOnly = !orgRef && Boolean(localWs);

  let resolvedRole: OrganizationRole | null = null;
  if (orgRef?.role) {
    resolvedRole = orgRef.role;
  } else if (activeWorkspace === org.id && activeOrgRole) {
    resolvedRole = activeOrgRole;
  } else if (localWs) {
    const member = (localWs.members || []).find(
      (m) => (currentUserId && m.uid === currentUserId) || m.uid === 'local-owner'
    );
    if (member?.role) {
      resolvedRole = member.role;
    } else if (
      currentUserId &&
      (localWs.organization?.ownerUid === currentUserId ||
        localWs.organization?.ownerId === currentUserId)
    ) {
      resolvedRole = 'owner';
    }
  } else if (currentUserId && org.ownerUid && org.ownerUid === currentUserId) {
    resolvedRole = 'owner';
  }

  const isOrphan = !resolvedRole || (!orgRef && !localWs);
  const canDelete = resolvedRole === 'owner' || isLocalOnly || !resolvedRole;

  return {
    role: resolvedRole,
    isCloudOrg,
    isLocalOnly,
    isOrphan,
    canDelete,
  };
}

/**
 * Removes any workspace entry matching `orgId` (by map key OR `organization.id`)
 * cleanly without mutating the source object.
 */
export function removeOrgFromWorkspacesMap(
  workspaces: Record<string, OrgWorkspaceData> | undefined | null,
  orgId: string
): Record<string, OrgWorkspaceData> {
  const target = (orgId || '').trim();
  const next: Record<string, OrgWorkspaceData> = {};
  if (!workspaces || typeof workspaces !== 'object') return next;

  for (const [key, ws] of Object.entries(workspaces)) {
    if (!ws) continue;
    if (target && (key === target || ws.organization?.id === target)) {
      continue;
    }
    next[key] = ws;
  }
  return next;
}

/**
 * Returns `'personal'` if the deleted organization was the active workspace,
 * otherwise preserves the current active workspace ID.
 */
export function resolveFallbackWorkspaceAfterDelete(
  activeWorkspaceId: string | null | undefined,
  deletedOrgId: string
): string {
  const active = (activeWorkspaceId || 'personal').trim() || 'personal';
  const deleted = (deletedOrgId || '').trim();
  if (deleted && active === deleted) {
    return 'personal';
  }
  return active;
}

export function formatWorkspaceDeleteConfirmMessage(
  orgName: string,
  isRTL: boolean
): string {
  const safeName = (orgName || '').trim() || (isRTL ? 'هذه المؤسسة' : 'this workspace');
  if (isRTL) {
    return `هل أنت متأكد من حذف مساحة العمل "${safeName}" نهائياً؟ سيتم مسح كافة المحافظ والمعاملات المرتبطة بها ولا يمكن التراجع عن هذا الإجراء.`;
  }
  return `Are you sure you want to permanently delete the workspace "${safeName}"? All associated wallets and transactions will be erased and this action cannot be undone.`;
}

export const DELETED_ORG_IDS_STORAGE_KEY = 'raseedi_deleted_org_ids_v1';
const MAX_STORED_DELETED_ORG_IDS = 100;

export interface DeletedOrgStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function getDefaultDeletedOrgStorage(): DeletedOrgStorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage contexts
  }
  return null;
}

function normalizeDeletedIdsSet(ids?: Iterable<string> | null): Set<string> {
  const out = new Set<string>();
  if (!ids) return out;
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const clean = raw.trim();
    if (clean && clean !== 'personal') {
      out.add(clean);
    }
  }
  return out;
}

export function loadDeletedOrgIds(
  storage: DeletedOrgStorageLike | null = getDefaultDeletedOrgStorage()
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(DELETED_ORG_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(normalizeDeletedIdsSet(parsed));
  } catch {
    return [];
  }
}

export function recordDeletedOrgId(
  orgId: string,
  storage: DeletedOrgStorageLike | null = getDefaultDeletedOrgStorage()
): string[] {
  const clean = (orgId || '').trim();
  const existing = loadDeletedOrgIds(storage);
  if (!clean || clean === 'personal') return existing;
  const deduped = existing.filter((id) => id !== clean);
  deduped.push(clean);
  const bounded = deduped.slice(-MAX_STORED_DELETED_ORG_IDS);
  try {
    storage?.setItem(DELETED_ORG_IDS_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Ignore storage quota errors
  }
  return bounded;
}

export function clearDeletedOrgId(
  orgId: string,
  storage: DeletedOrgStorageLike | null = getDefaultDeletedOrgStorage()
): string[] {
  const clean = (orgId || '').trim();
  const existing = loadDeletedOrgIds(storage);
  if (!clean) return existing;
  const next = existing.filter((id) => id !== clean);
  try {
    if (next.length === 0 && storage?.removeItem) {
      storage.removeItem(DELETED_ORG_IDS_STORAGE_KEY);
    } else {
      storage?.setItem(DELETED_ORG_IDS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage errors
  }
  return next;
}

/**
 * Removes all tombstoned organization IDs from an `orgWorkspaces` map
 * (matching either the map key OR nested `organization.id`).
 */
export function filterDeletedOrgWorkspaces(
  workspaces: Record<string, OrgWorkspaceData> | undefined | null,
  deletedIds?: Iterable<string> | null
): Record<string, OrgWorkspaceData> {
  const next: Record<string, OrgWorkspaceData> = {};
  if (!workspaces || typeof workspaces !== 'object') return next;
  const deletedSet = normalizeDeletedIdsSet(deletedIds);

  for (const [key, ws] of Object.entries(workspaces)) {
    if (!ws) continue;
    const nestedId = (ws.organization?.id || '').trim();
    if (deletedSet.has(key) || (nestedId && deletedSet.has(nestedId))) {
      continue;
    }
    next[key] = ws;
  }
  return next;
}

/**
 * Removes all tombstoned organization IDs from a user's `orgRefs` list.
 */
export function filterDeletedOrgRefs(
  orgRefs: OrgRef[] | undefined | null,
  deletedIds?: Iterable<string> | null
): OrgRef[] {
  if (!Array.isArray(orgRefs)) return [];
  const deletedSet = normalizeDeletedIdsSet(deletedIds);
  if (deletedSet.size === 0) return orgRefs;
  return orgRefs.filter((r) => Boolean(r?.orgId && !deletedSet.has(r.orgId.trim())));
}

/**
 * Ensures an active workspace ID never points to a deleted organization.
 */
export function resolveSafeActiveWorkspace(
  activeWorkspaceId: string | null | undefined,
  deletedIds?: Iterable<string> | null
): string {
  const active = (activeWorkspaceId || 'personal').trim() || 'personal';
  if (active === 'personal') return 'personal';
  const deletedSet = normalizeDeletedIdsSet(deletedIds);
  return deletedSet.has(active) ? 'personal' : active;
}

/**
 * Returns `true` ONLY when `/api/org/delete` explicitly confirmed `ORG_NOT_FOUND`
 * from our backend (never on a generic static-host HTTP 404 where the endpoint is absent).
 */
export function isServerConfirmedOrgMissingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code || '') : '';
  return code === 'ORG_NOT_FOUND';
}

/**
 * Returns `true` when `/api/org/delete` is unreachable or unavailable (static hosting 404,
 * 501/503/0, `CLOUD_ADMIN_UNAVAILABLE`, or network `TypeError`), so client-side direct
 * Firestore atomic deletion MUST execute.
 * Returns `false` for authoritative rejections like `403 FORBIDDEN` or `400 CONFIRM_NAME_MISMATCH`.
 */
export function shouldFallbackDirectOrgDelete(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code || '') : '';
  const status = 'status' in err ? Number((err as { status?: unknown }).status) : NaN;
  if (code === 'CLOUD_ADMIN_UNAVAILABLE') return true;
  if (status === 501 || status === 503 || status === 0) return true;
  // Static deployment (e.g. Vercel without Express backend) returns HTTP 404 with non-ORG_NOT_FOUND code
  if (status === 404 && code !== 'ORG_NOT_FOUND') return true;
  return false;
}

