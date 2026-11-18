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
