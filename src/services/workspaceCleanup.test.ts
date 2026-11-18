import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWorkspaceDeleteConfirmMessage,
  removeOrgFromWorkspacesMap,
  resolveFallbackWorkspaceAfterDelete,
  resolveWorkspaceOrgPermissions,
} from './workspaceCleanup';
import type { Organization, OrgRef, OrgWorkspaceData } from '../types';

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
