import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  clearDeletedOrgId,
  DELETED_ORG_IDS_STORAGE_KEY,
  DeletedOrgStorageLike,
  filterDeletedOrgRefs,
  filterDeletedOrgWorkspaces,
  formatWorkspaceDeleteConfirmMessage,
  isServerConfirmedOrgMissingError,
  loadDeletedOrgIds,
  recordDeletedOrgId,
  removeOrgFromWorkspacesMap,
  resolveFallbackWorkspaceAfterDelete,
  resolveSafeActiveWorkspace,
  resolveWorkspaceOrgPermissions,
  shouldFallbackDirectOrgDelete,
} from './workspaceCleanup';
import { resolveSafeCloudBackupWrite, type CloudBackupWriteCandidate } from './backupMerge';
import { mergeCloudAndLocalState } from './safeRecovery';
import { DEFAULT_SETTINGS, shouldPreserveLocalStorageKeyOnLogout } from './db';
import type { Organization, OrgRef, OrgWorkspaceData } from '../types';

function createMemoryStorage(): DeletedOrgStorageLike {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    name: 'أكاديمية طيبه',
    currency: 'EGP',
    vatRate: 14,
    approvalThreshold: 5000,
    ownerUid: 'user-1',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeWorkspace(org: Organization, role: 'owner' | 'admin' | 'employee' = 'owner', uid = 'user-1'): OrgWorkspaceData {
  return {
    organization: org,
    members: uid
      ? [
          {
            uid,
            email: `${uid}@example.com`,
            displayName: uid,
            role,
            status: 'active',
            joinedAt: 1000,
          },
        ]
      : [],
    costCenters: [],
    parties: [],
    wallets: [],
    categories: [],
    transactions: [],
    budgets: [],
    debts: [],
    goals: [],
    templates: [],
    auditLogs: [],
  };
}

function makeBackupCandidate(
  overrides: Partial<CloudBackupWriteCandidate> = {}
): CloudBackupWriteCandidate {
  return {
    transactions: [],
    wallets: [],
    categories: [],
    budgets: [],
    debts: [],
    goals: [],
    templates: [],
    moneyCircles: [],
    settings: { ...DEFAULT_SETTINGS },
    hasCompletedOnboarding: true,
    activeWorkspace: 'personal',
    orgWorkspaces: {},
    ...overrides,
  };
}

describe('workspaceCleanup helpers', () => {
  it('allows deletion for owner, local-only, and orphan workspaces while blocking non-owner cloud members', () => {
    const ownerOrg = makeOrg({ id: 'org-owner', ownerUid: 'user-1' });
    const ownerRefs: OrgRef[] = [
      {
        orgId: 'org-owner',
        orgName: 'أكاديمية طيبه',
        role: 'owner',
        status: 'active',
        currency: 'EGP',
        joinedAt: 1000,
      },
    ];
    const ownerPerm = resolveWorkspaceOrgPermissions({
      org: ownerOrg,
      orgRefs: ownerRefs,
      localOrgWorkspaces: {},
      currentUserId: 'user-1',
    });
    assert.equal(ownerPerm.role, 'owner');
    assert.equal(ownerPerm.canDelete, true);

    // Local-only duplicate org without cloud orgRef and even without explicit user match
    const orphanLocalOrg = makeOrg({ id: 'org-local-dup', ownerUid: '' });
    const orphanLocalWs = makeWorkspace(orphanLocalOrg, 'owner', '');
    orphanLocalWs.members = [];
    const orphanLocalPerm = resolveWorkspaceOrgPermissions({
      org: orphanLocalOrg,
      orgRefs: ownerRefs,
      localOrgWorkspaces: { 'org-local-dup': orphanLocalWs },
      currentUserId: 'user-1',
    });
    assert.equal(orphanLocalPerm.role, null);
    assert.equal(orphanLocalPerm.isLocalOnly, true);
    assert.equal(orphanLocalPerm.isOrphan, true);
    assert.equal(orphanLocalPerm.canDelete, true);

    // Non-owner cloud org member cannot delete the shared organization
    const sharedOrg = makeOrg({ id: 'org-shared', ownerUid: 'another-owner' });
    const sharedRefs: OrgRef[] = [
      {
        orgId: 'org-shared',
        orgName: 'Shared Co',
        role: 'employee',
        status: 'active',
        currency: 'EGP',
        joinedAt: 1000,
      },
    ];
    const memberPerm = resolveWorkspaceOrgPermissions({
      org: sharedOrg,
      orgRefs: sharedRefs,
      localOrgWorkspaces: {},
      currentUserId: 'user-1',
    });
    assert.equal(memberPerm.role, 'employee');
    assert.equal(memberPerm.isCloudOrg, true);
    assert.equal(memberPerm.canDelete, false);
  });

  it('removes deleted organization entries cleanly by key or nested organization.id', () => {
    const orgA = makeOrg({ id: 'org-a', name: 'A' });
    const orgB = makeOrg({ id: 'org-b', name: 'B' });
    const map: Record<string, OrgWorkspaceData> = {
      'org-a': makeWorkspace(orgA),
      'alias-key-b': makeWorkspace(orgB),
    };

    const afterA = removeOrgFromWorkspacesMap(map, 'org-a');
    assert.deepEqual(Object.keys(afterA), ['alias-key-b']);

    const afterB = removeOrgFromWorkspacesMap(afterA, 'org-b');
    assert.deepEqual(Object.keys(afterB), []);
  });

  it('switches active workspace back to personal when active org is deleted and keeps other active orgs', () => {
    assert.equal(resolveFallbackWorkspaceAfterDelete('org-dup', 'org-dup'), 'personal');
    assert.equal(resolveFallbackWorkspaceAfterDelete('org-keep', 'org-dup'), 'org-keep');
    assert.equal(resolveFallbackWorkspaceAfterDelete('personal', 'org-dup'), 'personal');
  });

  it('formats clear Arabic and English delete confirmation messages with org name', () => {
    const ar = formatWorkspaceDeleteConfirmMessage('أكاديمية طيبه', true);
    assert.ok(ar.includes('أكاديمية طيبه'));
    assert.ok(ar.includes('هل أنت متأكد من حذف مساحة العمل'));
    assert.ok(ar.includes('سيتم مسح كافة المحافظ والمعاملات المرتبطة بها'));

    const en = formatWorkspaceDeleteConfirmMessage('Taiba Academy', false);
    assert.ok(en.includes('Taiba Academy'));
  });
});

describe('deleted organization permanent persistence & non-resurrection across reload/sync', () => {
  it('persists deleted org tombstones across reload and strips deleted org from workspaces, refs, and activeWorkspace', () => {
    const storage = createMemoryStorage();
    const orgDeleted = makeOrg({ id: 'org-deleted', name: 'مؤسسة محذوفة' });
    const orgActive = makeOrg({ id: 'org-keep', name: 'مؤسسة باقية' });

    // Record permanent deletion
    recordDeletedOrgId('org-deleted', storage);

    // Simulate reload: read tombstones back from storage
    const reloadedTombstones = loadDeletedOrgIds(storage);
    assert.equal(reloadedTombstones.includes('org-deleted'), true);
    assert.equal(reloadedTombstones.includes('org-keep'), false);

    // Stale workspaces map (including aliased key) cannot resurrect deleted org
    const filteredWorkspaces = filterDeletedOrgWorkspaces(
      {
        'org-deleted': makeWorkspace(orgDeleted),
        'legacy-alias': makeWorkspace(orgDeleted),
        'org-keep': makeWorkspace(orgActive),
      },
      reloadedTombstones
    );
    assert.deepEqual(Object.keys(filteredWorkspaces), ['org-keep']);

    // Stale orgRefs cache / snapshot cannot resurrect deleted org
    const staleRefs: OrgRef[] = [
      {
        orgId: 'org-deleted',
        orgName: 'مؤسسة محذوفة',
        role: 'owner',
        status: 'active',
        currency: 'EGP',
        joinedAt: 1000,
      },
      {
        orgId: 'org-keep',
        orgName: 'مؤسسة باقية',
        role: 'owner',
        status: 'active',
        currency: 'EGP',
        joinedAt: 1000,
      },
    ];
    const filteredRefs = filterDeletedOrgRefs(staleRefs, reloadedTombstones);
    assert.deepEqual(
      filteredRefs.map((r) => r.orgId),
      ['org-keep']
    );

    // Active workspace pointing to deleted org falls back to personal
    assert.equal(resolveSafeActiveWorkspace('org-deleted', reloadedTombstones), 'personal');
    assert.equal(resolveSafeActiveWorkspace('org-keep', reloadedTombstones), 'org-keep');
    assert.equal(resolveSafeActiveWorkspace('personal', reloadedTombstones), 'personal');

    // Explicit clear allows future re-join/re-creation if ever needed
    clearDeletedOrgId('org-deleted', storage);
    assert.equal(loadDeletedOrgIds(storage).includes('org-deleted'), false);
  });

  it('prevents mergeCloudAndLocalState and resolveSafeCloudBackupWrite from resurrecting a deleted org after reload or sync', () => {
    const orgDeleted = makeOrg({ id: 'org-deleted', name: 'شركة محذوفة' });
    const orgKeep = makeOrg({ id: 'org-keep', name: 'شركة حالية' });
    const deletedSet = new Set(['org-deleted']);

    // Stale cloud backup still contains the deleted organization and had it as activeWorkspace
    const staleCloud = makeBackupCandidate({
      activeWorkspace: 'org-deleted',
      orgWorkspaces: {
        'org-deleted': makeWorkspace(orgDeleted),
        'org-keep': makeWorkspace(orgKeep),
      },
    });

    // Local state after deletion only has org-keep and activeWorkspace = 'personal'
    const localAfterDelete = makeBackupCandidate({
      activeWorkspace: 'personal',
      orgWorkspaces: {
        'org-keep': makeWorkspace(orgKeep),
      },
    });

    // 1. Startup / recovery merge MUST NOT resurrect org-deleted and MUST keep personal fallback
    const mergedRecovery = mergeCloudAndLocalState({
      localData: localAfterDelete,
      cloudData: staleCloud,
      deletedOrgIds: deletedSet,
    });
    assert.equal(mergedRecovery.orgWorkspaces?.['org-deleted'], undefined);
    assert.ok(mergedRecovery.orgWorkspaces?.['org-keep']);
    assert.equal(mergedRecovery.activeWorkspace, 'personal');

    // 2. Cloud backup write merge MUST NOT re-inject org-deleted from existing cloud backup
    const writeDecision = resolveSafeCloudBackupWrite({
      localData: localAfterDelete,
      existingCloud: { totalTransactions: 0, data: staleCloud },
      source: 'manual',
      deletedOrgIds: deletedSet,
    });
    assert.equal(writeDecision.action, 'write');
    if (writeDecision.action === 'write') {
      assert.equal(writeDecision.mergedData.orgWorkspaces?.['org-deleted'], undefined);
      assert.ok(writeDecision.mergedData.orgWorkspaces?.['org-keep']);
      assert.equal(writeDecision.mergedData.activeWorkspace, 'personal');
    }

    // 3. Even if stale local payload still referenced org-deleted as activeWorkspace, it falls back to personal
    const staleLocalRef = makeBackupCandidate({
      activeWorkspace: 'org-deleted',
      orgWorkspaces: {
        'org-deleted': makeWorkspace(orgDeleted),
      },
    });
    const sanitizedWrite = resolveSafeCloudBackupWrite({
      localData: staleLocalRef,
      existingCloud: { totalTransactions: 0, data: staleCloud },
      source: 'manual',
      deletedOrgIds: deletedSet,
    });
    assert.equal(sanitizedWrite.action, 'write');
    if (sanitizedWrite.action === 'write') {
      assert.deepEqual(Object.keys(sanitizedWrite.mergedData.orgWorkspaces || {}), []);
      assert.equal(sanitizedWrite.mergedData.activeWorkspace, 'personal');
    }
  });

  it('distinguishes static-hosting HTTP 404 (fallback to direct Firestore delete) from explicit ORG_NOT_FOUND and real rejections', () => {
    // Static Vercel/CDN deployment returning HTML 404 -> code is ORG_DELETE_FAILED, status 404
    const staticHost404 = { code: 'ORG_DELETE_FAILED', status: 404 };
    assert.equal(isServerConfirmedOrgMissingError(staticHost404), false);
    assert.equal(shouldFallbackDirectOrgDelete(staticHost404), true);

    // Server unavailable / admin SDK unavailable / network errors -> fallback to direct Firestore delete
    assert.equal(shouldFallbackDirectOrgDelete({ code: 'CLOUD_ADMIN_UNAVAILABLE', status: 503 }), true);
    assert.equal(shouldFallbackDirectOrgDelete({ code: 'HTTP_501', status: 501 }), true);
    assert.equal(shouldFallbackDirectOrgDelete({ code: 'NETWORK_ERROR', status: 0 }), true);
    assert.equal(shouldFallbackDirectOrgDelete(new TypeError('Failed to fetch')), true);

    // Explicit server confirmation that org is already missing -> NOT a fallback error, confirmed missing
    const confirmedMissing = { code: 'ORG_NOT_FOUND', status: 404 };
    assert.equal(isServerConfirmedOrgMissingError(confirmedMissing), true);
    assert.equal(shouldFallbackDirectOrgDelete(confirmedMissing), false);

    // Real authorization / confirmation failures MUST NOT fall back and bypass server checks
    assert.equal(shouldFallbackDirectOrgDelete({ code: 'FORBIDDEN', status: 403 }), false);
    assert.equal(shouldFallbackDirectOrgDelete({ code: 'CONFIRM_NAME_MISMATCH', status: 400 }), false);
    assert.equal(isServerConfirmedOrgMissingError({ code: 'FORBIDDEN', status: 403 }), false);
  });

  it('preserves deleted-org tombstones key across logout so stale backups cannot resurrect deleted orgs on re-login', () => {
    assert.equal(shouldPreserveLocalStorageKeyOnLogout(DELETED_ORG_IDS_STORAGE_KEY), true);
  });

  it('enforces regression guards across firebase.ts, orgCloud.ts, and AppContext.tsx', () => {
    const firebaseSrc = fs.readFileSync(path.resolve('src/services/firebase.ts'), 'utf8');
    const orgCloudSrc = fs.readFileSync(path.resolve('src/services/orgCloud.ts'), 'utf8');
    const appContextSrc = fs.readFileSync(path.resolve('src/context/AppContext.tsx'), 'utf8');

    // removeOrgWorkspaceFromBackupMeta must use updateDoc (not setDoc merge:true which keeps deleted map keys)
    const removeFnStart = firebaseSrc.indexOf('export async function removeOrgWorkspaceFromBackupMeta');
    const removeFnSlice = firebaseSrc.slice(removeFnStart, removeFnStart + 2500);
    assert.ok(removeFnSlice.includes('updateDoc(metaRef'));
    assert.equal(removeFnSlice.includes('setDoc(\n      metaRef'), false);

    // saveCloudBackup must use metaBatch.update when metaExists so removed orgWorkspaces keys are deleted in Firestore
    assert.ok(firebaseSrc.includes('metaBatch.update(metaRef'));

    // orgCloud must distinguish confirmed ORG_NOT_FOUND vs static-host 404 fallback and clean orphan orgRefs
    assert.ok(orgCloudSrc.includes('isServerConfirmedOrgMissingError(err)'));
    assert.ok(orgCloudSrc.includes('shouldFallbackDirectOrgDelete(err)'));
    assert.ok(orgCloudSrc.includes('await deleteDoc(ownerOrgRef)'));

    // AppContext deleteOrganization must record tombstone, update cached orgRefs, clear snapshot, and sync activeWorkspaceRef
    const deleteOrgStart = appContextSrc.indexOf('const deleteOrganization = useCallback(');
    const deleteOrgSlice = appContextSrc.slice(deleteOrgStart, deleteOrgStart + 4200);
    assert.ok(deleteOrgSlice.includes('recordDeletedOrgId(orgIdToDelete)'));
    assert.ok(deleteOrgSlice.includes('saveCachedOrgRefs(filtered)'));
    assert.ok(deleteOrgSlice.includes('saveCachedActiveOrgSnapshot(null)'));
    assert.ok(deleteOrgSlice.includes('activeWorkspaceRef.current = nextWorkspace'));
  });
});

