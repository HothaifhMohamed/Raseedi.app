/**
 * Firestore Security Rules Emulator Test Suite
 * Run via: npm run test:rules (requires Java runtime + firebase emulators:exec)
 */
import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { stripUndefinedDeep } from '../src/services/workspaceSync';

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'raseedi-rules-test';
const ORG_ID = 'org-test-001';
const OWNER_UID = 'user_owner';
const ADMIN_UID = 'user_admin';
const ACCOUNTANT_UID = 'user_accountant';
const EMPLOYEE_UID = 'user_employee';
const VIEWER_UID = 'user_viewer';
const OUTSIDER_UID = 'user_outsider';

function authContext(uid: string, emailVerified = true) {
  return testEnv.authenticatedContext(uid, {
    email: `${uid}@raseedi.test`,
    email_verified: emailVerified,
  });
}

async function seedOrgBase(options?: { expiresAt?: number; lockedUntilDate?: string }) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'organizations', ORG_ID), {
      id: ORG_ID,
      name: 'شركة رصيدي للاختبار',
      currency: 'EGP',
      industry: 'tech',
      vatRate: 14,
      approvalThreshold: 5000,
      ownerUid: OWNER_UID,
      planTier: 'business_pro',
      billingCycle: 'monthly',
      expiresAt: options?.expiresAt ?? Date.now() + 30 * 86400000,
      lockedUntilDate: options?.lockedUntilDate ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const roles: Array<[string, string, number | null]> = [
      [OWNER_UID, 'owner', null],
      [ADMIN_UID, 'admin', null],
      [ACCOUNTANT_UID, 'accountant', null],
      [EMPLOYEE_UID, 'employee', 500],
      [VIEWER_UID, 'viewer', null],
    ];
    for (const [uid, role, spendingLimit] of roles) {
      await setDoc(doc(db, 'organizations', ORG_ID, 'members', uid), {
        uid,
        orgId: ORG_ID,
        name: uid,
        email: `${uid}@raseedi.test`,
        role,
        status: 'active',
        spendingLimit,
        spendingLimitMinor: spendingLimit ? spendingLimit * 100 : null,
        joinedAt: Date.now(),
      });
    }
  });
}

const HAS_FIRESTORE_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST?.trim());
const SKIP_EMULATOR_REASON = HAS_FIRESTORE_EMULATOR
  ? false
  : 'FIRESTORE_EMULATOR_HOST is not set (run via npm run test:rules with Java + Firebase Emulator)';

describe('Firestore Security Rules Static Contract (users/{userId} & Admin Isolation)', () => {
  const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

  test('users/{userId} create/update rules allow safe onboarding & profile writes while protecting sensitive fields', () => {
    const createFnMatch = rulesSource.match(/function isValidUserProfileCreate[\s\S]*?\n    \}/);
    const updateFnMatch = rulesSource.match(/function isValidUserProfileUpdate[\s\S]*?\n    \}/);
    const usersMatch = rulesSource.match(/match \/users\/\{userId\} \{[\s\S]*?allow delete:/);

    assert.ok(createFnMatch, 'isValidUserProfileCreate must exist');
    assert.ok(updateFnMatch, 'isValidUserProfileUpdate must exist');
    assert.ok(usersMatch, 'match /users/{userId} must exist');

    const createFn = createFnMatch[0];
    const updateFn = updateFnMatch[0];
    const usersBlock = usersMatch[0];

    // New authenticated owner can create free profile with optional onboarding/profile fields
    assert.ok(createFn.includes("'hasCompletedOnboarding'"), 'create allowlist includes hasCompletedOnboarding');
    assert.ok(createFn.includes("data.isPro == false"), 'create enforces isPro == false');
    assert.ok(createFn.includes("data.uid == request.auth.uid"), 'create enforces uid == request.auth.uid');
    assert.ok(!createFn.includes("'isAdmin'"), 'create never allows isAdmin');
    assert.ok(!createFn.includes("'activationCodeHash'"), 'create never allows activationCodeHash');

    // Authenticated owner can update profile + onboarding + currencyRates + settings + lastSyncedAt
    assert.ok(updateFn.includes("'hasCompletedOnboarding'"), 'update validator supports hasCompletedOnboarding');
    assert.ok(usersBlock.includes("'hasCompletedOnboarding'"), 'owner update affectedKeys allows hasCompletedOnboarding');
    assert.ok(usersBlock.includes("'currencyRates'"), 'owner update affectedKeys allows currencyRates');
    assert.ok(usersBlock.includes("'settings'"), 'owner update affectedKeys allows settings');
    assert.ok(usersBlock.includes("'lastSyncedAt'"), 'owner update affectedKeys allows lastSyncedAt');

    // Sensitive subscription fields and createdAt remain strictly protected on owner update
    assert.ok(
      usersBlock.includes("incoming().get('isPro', false) == existing().get('isPro', false)"),
      'owner cannot promote isPro'
    );
    assert.ok(
      usersBlock.includes("incoming().get('planTier', 'free') == existing().get('planTier', 'free')"),
      'owner cannot change planTier'
    );
    assert.ok(
      usersBlock.includes("incoming().get('createdAt', null) == existing().get('createdAt', null)"),
      'createdAt remains immutable on update'
    );
    assert.ok(usersBlock.includes('isAdmin()'), 'admin branch preserved for subscription management');
  });

  test('isAdmin remains locked exclusively to verified hapaypal2003@gmail.com and legacy code collections remain closed', () => {
    const adminFnMatch = rulesSource.match(/function isAdmin\(\) \{[\s\S]*?\n    \}/);
    assert.ok(adminFnMatch, 'isAdmin helper must exist');
    assert.ok(adminFnMatch[0].includes('isVerifiedUser()'), 'isAdmin requires verified email');
    assert.ok(
      adminFnMatch[0].includes("== 'hapaypal2003@gmail.com'"),
      'isAdmin locked to primary admin email'
    );
    assert.ok(
      /match \/licenseCodes\/\{codeHash\}\s*\{\s*allow read, write: if false;\s*\}/.test(rulesSource),
      'licenseCodes collection stays strictly server-only'
    );
  });

  test('usernames and userEmailIndex enforce exact get-only lookup (allow list: false) and owner writes', () => {
    const usernamesMatch = rulesSource.match(/match \/usernames\/\{username\} \{[\s\S]*?\n    \}/);
    const emailIndexMatch = rulesSource.match(/match \/userEmailIndex\/\{emailHash\} \{[\s\S]*?\n    \}/);

    assert.ok(usernamesMatch, 'match /usernames/{username} must exist');
    assert.ok(emailIndexMatch, 'match /userEmailIndex/{emailHash} must exist');

    const usernamesBlock = usernamesMatch[0];
    const emailIndexBlock = emailIndexMatch[0];

    // Never allow collection enumeration/scraping
    assert.ok(usernamesBlock.includes('allow list: if false;'), 'usernames blocks list queries');
    assert.ok(emailIndexBlock.includes('allow list: if false;'), 'userEmailIndex blocks list queries');

    // Exact get requires signed in user + format check
    assert.ok(usernamesBlock.includes('allow get: if isSignedIn() && isValidUsername(username);'));
    assert.ok(emailIndexBlock.includes('allow get: if isSignedIn() && isValidEmailHash(emailHash);'));

    // Writes enforce ownership and token email binding on userEmailIndex
    assert.ok(usernamesBlock.includes('isValidUsernameRecord(incoming(), username)'));
    assert.ok(usernamesBlock.includes('existing().uid == request.auth.uid'));
    assert.ok(emailIndexBlock.includes('isValidUserEmailIndexRecord(incoming(), emailHash)'));
    assert.ok(
      emailIndexBlock.includes('incoming().email.trim().lower() == request.auth.token.email.trim().lower()'),
      'userEmailIndex binds email strictly to authenticated token email'
    );
  });

  test('users/{userId}.username requires atomic ownership verification via usernames/{handle}', () => {
    const usersMatch = rulesSource.match(/match \/users\/\{userId\} \{[\s\S]*?allow delete:/);
    assert.ok(usersMatch, 'match /users/{userId} must exist');
    const usersBlock = usersMatch[0];
    assert.ok(usersBlock.includes("'username'"), 'owner update allowlist includes username');
    assert.ok(
      usersBlock.includes('getAfter(/databases/$(database)/documents/usernames/$(incoming().username)).data.uid == userId'),
      'setting users/{uid}.username enforces atomic usernames/{handle} ownership'
    );
  });

  test('direct organization member add/manage enforces RBAC, non-owner protection, and atomic orgRefs sync', () => {
    const orgRefsMatch = rulesSource.match(/match \/orgRefs\/\{orgId\} \{[\s\S]*?\n      \}/);
    const membersMatch = rulesSource.match(/match \/members\/\{memberUid\} \{[\s\S]*?\n      \}/);

    assert.ok(orgRefsMatch, 'match /orgRefs/{orgId} must exist');
    assert.ok(membersMatch, 'match /members/{memberUid} must exist');

    const orgRefsBlock = orgRefsMatch[0];
    const membersBlock = membersMatch[0];

    // orgRefs list stays strictly owner-only while get allows owner or org admin/owner for tx.get
    assert.ok(orgRefsBlock.includes('allow list: if isValidId(userId) && isOwner(userId);'));
    assert.ok(orgRefsBlock.includes('(isOwner(userId) || isOrgOwnerOrAdmin(orgId))'));

    // Atomic cross-collection invariants
    assert.ok(
      orgRefsBlock.includes('existsAfter(/databases/$(database)/documents/organizations/$(orgId)/members/$(userId))'),
      'orgRefs create requires atomic member creation'
    );
    assert.ok(
      membersBlock.includes('existsAfter(/databases/$(database)/documents/users/$(memberUid)/orgRefs/$(orgId))'),
      'members create requires atomic orgRef creation'
    );
    assert.ok(
      membersBlock.includes("existing().role != 'owner'"),
      'owner role cannot be modified or deleted by direct member rules'
    );
    assert.ok(
      membersBlock.includes('memberUid != request.auth.uid'),
      'org admins cannot delete themselves via admin-remove member delete branch'
    );
    assert.ok(
      membersBlock.includes('isVerifiedUser()') && membersBlock.includes('isOrgOwnerOrAdmin(orgId)') && membersBlock.includes('isOrgWritable(orgId)'),
      'direct member mutations require verified org owner/admin on writable org'
    );

    // Non-owner self-leave atomic batch invariant in both members and orgRefs
    assert.ok(
      membersBlock.includes("memberUid == request.auth.uid") &&
        membersBlock.includes("existing().role != 'owner'") &&
        membersBlock.includes("!existsAfter(/databases/$(database)/documents/users/$(memberUid)/orgRefs/$(orgId))"),
      'non-owner member can self-leave atomically by deleting member + orgRef together'
    );
    assert.ok(
      orgRefsBlock.includes("userId == request.auth.uid") &&
        orgRefsBlock.includes("existing().role != 'owner'") &&
        orgRefsBlock.includes("!existsAfter(/databases/$(database)/documents/organizations/$(orgId)/members/$(userId))"),
      'non-owner orgRef self-delete requires atomic member deletion'
    );

    // Admin cannot modify or delete another admin unless caller is org owner
    const adminProtectionExpr =
      "(existing().role != 'admin' || orgDoc(orgId).data.ownerUid == request.auth.uid)";
    assert.ok(
      membersBlock.includes(adminProtectionExpr),
      'members update/delete rules prevent admin from modifying/deleting another admin'
    );
    assert.ok(
      orgRefsBlock.includes(adminProtectionExpr),
      'orgRefs update/delete rules prevent admin from modifying/deleting another admin'
    );

    // backupHistory list limit accommodates 100 entries for separating manual and auto backups
    assert.ok(
      rulesSource.includes('request.query.limit <= 100'),
      'backupHistory list rule allows limit up to 100'
    );
  });

  test('cloud organization atomic creation & local-to-cloud upgrade allow verified owner bootstrap without calling get() on missing docs', () => {
    const orgMatch = rulesSource.match(/match \/organizations\/\{orgId\} \{[\s\S]*?match \/members\/\{memberUid\}/);
    const membersMatch = rulesSource.match(/match \/members\/\{memberUid\} \{[\s\S]*?\n      \}/);
    const orgRefsMatch = rulesSource.match(/match \/orgRefs\/\{orgId\} \{[\s\S]*?\n      \}/);
    const entitlementMatch = rulesSource.match(/function isValidOrgEntitlementOnCreate[\s\S]*?\n    \}/);
    const ownerAdminFnMatch = rulesSource.match(/function isOrgOwnerOrAdmin[\s\S]*?\n    \}/);

    assert.ok(orgMatch, 'match /organizations/{orgId} must exist');
    assert.ok(membersMatch, 'match /members/{memberUid} must exist');
    assert.ok(orgRefsMatch, 'match /orgRefs/{orgId} must exist');
    assert.ok(entitlementMatch, 'isValidOrgEntitlementOnCreate must exist');
    assert.ok(ownerAdminFnMatch, 'isOrgOwnerOrAdmin must exist');

    const orgBlock = orgMatch[0];
    const membersBlock = membersMatch[0];
    const orgRefsBlock = orgRefsMatch[0];

    // Org create enforces verified user, valid schema, entitlement verification, and atomic member + orgRef creation
    assert.ok(orgBlock.includes('isValidOrgCreate(incoming(), orgId)'));
    assert.ok(orgBlock.includes('isValidOrgEntitlementOnCreate(incoming())'));
    assert.ok(orgBlock.includes('existsAfter(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid))'));
    assert.ok(orgBlock.includes('existsAfter(/databases/$(database)/documents/users/$(request.auth.uid)/orgRefs/$(orgId))'));

    // Owner bootstrap branch MUST precede isOrgOwnerOrAdmin(orgId) and guard getAfter with existsAfter
    const memberOwnerIdx = membersBlock.indexOf('isValidOrgOwnerMemberCreate(incoming(), memberUid)');
    const memberAdminIdx = membersBlock.indexOf('isValidOrgMemberCreate(incoming(), memberUid)');
    assert.ok(memberOwnerIdx > 0 && memberAdminIdx > memberOwnerIdx, 'owner bootstrap branch must precede admin member create branch in members');
    assert.ok(
      membersBlock.includes('existsAfter(/databases/$(database)/documents/organizations/$(orgId))'),
      'members owner bootstrap guards getAfter with existsAfter'
    );

    const refOwnerIdx = orgRefsBlock.indexOf('isValidOrgOwnerRefCreate(incoming(), orgId)');
    const refAdminIdx = orgRefsBlock.indexOf('isValidOrgRefCreate(incoming(), orgId)');
    assert.ok(refOwnerIdx > 0 && refAdminIdx > refOwnerIdx, 'owner bootstrap branch must precede admin orgRef create branch in orgRefs');
    assert.ok(
      orgRefsBlock.includes('existsAfter(/databases/$(database)/documents/organizations/$(orgId))'),
      'orgRefs owner bootstrap guards getAfter with existsAfter'
    );

    // RBAC & entitlement helpers guard get() with exists()
    assert.ok(ownerAdminFnMatch[0].includes('exists(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid))'));
    assert.ok(entitlementMatch[0].includes('exists(/databases/$(database)/documents/users/$(request.auth.uid))'));

    // Payload builder regression guard: stripUndefinedDeep MUST preserve serverTimestamp() FieldValue sentinels
    const st = serverTimestamp();
    const cleanedOrg = stripUndefinedDeep({
      id: 'org-check-1',
      taxNumber: undefined,
      createdAt: st,
      updatedAt: st,
    });
    assert.strictEqual(cleanedOrg.createdAt, st, 'stripUndefinedDeep must preserve createdAt FieldValue sentinel');
    assert.strictEqual(cleanedOrg.updatedAt, st, 'stripUndefinedDeep must preserve updatedAt FieldValue sentinel');
    assert.equal('taxNumber' in cleanedOrg, false, 'stripUndefinedDeep must drop undefined optional keys');
  });
});

describe('Firestore Security Rules', { skip: SKIP_EMULATOR_REASON }, () => {
  before(async () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules },
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  test('Users collection enforces ownership and blocks client writes to server-only subscription fields', async () => {
  const ownerDb = authContext(OWNER_UID).firestore();
  const outsiderDb = authContext(OUTSIDER_UID).firestore();

  await assertSucceeds(
    setDoc(doc(ownerDb, 'users', OWNER_UID), {
      uid: OWNER_UID,
      email: 'owner@raseedi.test',
      displayName: 'Owner Name',
      photoURL: 'https://lh3.googleusercontent.com/photo.jpg',
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Owner can complete onboarding and update normal profile/settings fields via merge without touching protected fields
  await assertSucceeds(
    setDoc(
      doc(ownerDb, 'users', OWNER_UID),
      {
        hasCompletedOnboarding: true,
        displayName: 'Owner Updated',
        lastSyncedAt: Date.now(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )
  );

  // Outsider cannot read another user's profile
  await assertFails(getDoc(doc(outsiderDb, 'users', OWNER_UID)));

  // Owner cannot overwrite createdAt on an existing profile
  await assertFails(
    setDoc(
      doc(ownerDb, 'users', OWNER_UID),
      {
        email: 'owner@raseedi.test',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )
  );

  // User cannot self-promote isPro
  await assertFails(
    updateDoc(doc(ownerDb, 'users', OWNER_UID), {
      isPro: true,
      proPlan: 'lifetime',
      updatedAt: serverTimestamp(),
    })
  );

  // Server-only collections are strictly blocked from client SDKs
  await assertFails(getDoc(doc(ownerDb, 'activationCodes', 'hash-1')));
  await assertFails(setDoc(doc(ownerDb, 'proLicenses', 'lic-1'), { isPro: true }));
});

test('Organization RBAC: outsider blocked, viewer read-only, employee limited by spendingLimit & approval', async () => {
  await seedOrgBase({ lockedUntilDate: '2026-05-01' });

  const outsiderDb = authContext(OUTSIDER_UID).firestore();
  const viewerDb = authContext(VIEWER_UID).firestore();
  const employeeDb = authContext(EMPLOYEE_UID).firestore();
  const accountantDb = authContext(ACCOUNTANT_UID).firestore();
  const ownerDb = authContext(OWNER_UID).firestore();

  // Outsider cannot read org
  await assertFails(getDoc(doc(outsiderDb, 'organizations', ORG_ID)));

  // Viewer can read org but cannot create transactions
  await assertSucceeds(getDoc(doc(viewerDb, 'organizations', ORG_ID)));
  await assertFails(
    setDoc(doc(viewerDb, 'organizations', ORG_ID, 'transactions', 'tx-v1'), {
      id: 'tx-v1',
      orgId: ORG_ID,
      date: '2026-06-01',
      amountMinor: 1000,
      submittedBy: VIEWER_UID,
      approvalStatus: 'pending',
      payload: { amount: 10 },
      updatedAt: serverTimestamp(),
    })
  );

  // Employee can create pending tx within spendingLimit (500)
  await assertSucceeds(
    setDoc(doc(employeeDb, 'organizations', ORG_ID, 'transactions', 'tx-e1'), {
      id: 'tx-e1',
      orgId: ORG_ID,
      date: '2026-06-01',
      amountMinor: 25000,
      submittedBy: EMPLOYEE_UID,
      approvalStatus: 'pending',
      payload: { amount: 250, date: '2026-06-01' },
      updatedAt: serverTimestamp(),
    })
  );

  // Employee cannot exceed spendingLimit (600 > 500) or self-approve
  await assertFails(
    setDoc(doc(employeeDb, 'organizations', ORG_ID, 'transactions', 'tx-e2'), {
      id: 'tx-e2',
      orgId: ORG_ID,
      date: '2026-06-01',
      amountMinor: 60000,
      submittedBy: EMPLOYEE_UID,
      approvalStatus: 'pending',
      payload: { amount: 600, date: '2026-06-01' },
      updatedAt: serverTimestamp(),
    })
  );

  // Employee cannot bypass spendingLimit by sending low amountMinor with high payload.amount (or vice versa)
  await assertFails(
    setDoc(doc(employeeDb, 'organizations', ORG_ID, 'transactions', 'tx-e-bypass-1'), {
      id: 'tx-e-bypass-1',
      orgId: ORG_ID,
      date: '2026-06-01',
      amountMinor: 1000,
      submittedBy: EMPLOYEE_UID,
      approvalStatus: 'pending',
      payload: { amount: 5000, date: '2026-06-01' },
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    setDoc(doc(employeeDb, 'organizations', ORG_ID, 'transactions', 'tx-e-bypass-2'), {
      id: 'tx-e-bypass-2',
      orgId: ORG_ID,
      date: '2026-06-01',
      amountMinor: 500000,
      submittedBy: EMPLOYEE_UID,
      approvalStatus: 'pending',
      payload: { amount: 10, date: '2026-06-01' },
      updatedAt: serverTimestamp(),
    })
  );

  // Period lock blocks backdated writes inside lockedUntilDate (2026-04-15 <= 2026-05-01)
  await assertFails(
    setDoc(doc(accountantDb, 'organizations', ORG_ID, 'transactions', 'tx-locked'), {
      id: 'tx-locked',
      orgId: ORG_ID,
      date: '2026-04-15',
      amountMinor: 1000,
      submittedBy: ACCOUNTANT_UID,
      approvalStatus: 'approved',
      payload: { amount: 10, date: '2026-04-15' },
      updatedAt: serverTimestamp(),
    })
  );

  // Accountant can approve pending transaction
  await assertSucceeds(
    updateDoc(doc(accountantDb, 'organizations', ORG_ID, 'transactions', 'tx-e1'), {
      approvalStatus: 'approved',
      approvedBy: ACCOUNTANT_UID,
      updatedAt: serverTimestamp(),
    })
  );

  // Employee cannot edit already approved transaction
  await assertFails(
    updateDoc(doc(employeeDb, 'organizations', ORG_ID, 'transactions', 'tx-e1'), {
      amountMinor: 1000,
      updatedAt: serverTimestamp(),
    })
  );

  // Audit logs are append-only (no updates or deletes)
  await assertSucceeds(
    setDoc(doc(ownerDb, 'organizations', ORG_ID, 'auditLogs', 'log-1'), {
      id: 'log-1',
      orgId: ORG_ID,
      action: 'approve',
      entityType: 'transaction',
      entityId: 'tx-e1',
      actorUid: OWNER_UID,
      actorName: 'Owner',
      summary: 'Approved tx-e1',
      timestamp: Date.now(),
      createdAt: serverTimestamp(),
    })
  );
  await assertFails(deleteDoc(doc(ownerDb, 'organizations', ORG_ID, 'auditLogs', 'log-1')));
});

test('Expired Business subscription past 7-day grace puts org in read-only mode', async () => {
  await seedOrgBase({ expiresAt: Date.now() - 9 * 86400000 });
  const accountantDb = authContext(ACCOUNTANT_UID).firestore();

  await assertSucceeds(getDoc(doc(accountantDb, 'organizations', ORG_ID)));
  await assertFails(
    setDoc(doc(accountantDb, 'organizations', ORG_ID, 'transactions', 'tx-ro'), {
      id: 'tx-ro',
      orgId: ORG_ID,
      date: '2026-06-01',
      amountMinor: 1000,
      submittedBy: ACCOUNTANT_UID,
      approvalStatus: 'approved',
      payload: { amount: 10 },
      updatedAt: serverTimestamp(),
    })
  );
});

test('Server-only collections and isAdmin lock exclusively to verified hapaypal2003@gmail.com', async () => {
  const superAdminDb = testEnv
    .authenticatedContext('admin_uid_1', {
      email: '  Hapaypal2003@gmail.com  ',
      email_verified: true,
      admin: true,
    })
    .firestore();
  const otherAdminClaimDb = testEnv
    .authenticatedContext('other_admin_uid', {
      email: 'other-admin@raseedi.test',
      email_verified: true,
      admin: true,
    })
    .firestore();
  const spoofedAdminDb = testEnv
    .authenticatedContext('spoof_admin_uid', {
      email: 'hapaypal2003@gmail.com',
      email_verified: false,
      admin: true,
    })
    .firestore();
  const userDb = authContext(OWNER_UID).firestore();

  const code = 'RSD-BIZ-BYTEST01-ABCDEFGH';
  const validCodeHash = 'a'.repeat(64);
  const validPinHash = `scrypt$${'0'.repeat(32)}$${'1'.repeat(128)}`;

  // Normal users and other accounts (even with admin:true) are blocked from adminConfig, adminSecurity, licenseCodes, coupons, adminIssuedCodes, activationCodes, joinRateLimits
  await assertFails(getDocs(collection(userDb, 'coupons')));
  await assertFails(getDocs(collection(superAdminDb, 'coupons')));
  await assertFails(getDoc(doc(userDb, 'licenseCodes', validCodeHash)));
  await assertFails(getDocs(collection(otherAdminClaimDb, 'licenseCodes')));
  await assertFails(getDoc(doc(otherAdminClaimDb, 'adminConfig', 'security')));
  await assertFails(getDoc(doc(otherAdminClaimDb, 'adminSecurity', 'panelConfig')));
  await assertFails(
    setDoc(doc(otherAdminClaimDb, 'adminConfig', 'security'), {
      pinHash: validPinHash,
      updatedByUid: 'other_admin_uid',
      updatedByEmail: 'other-admin@raseedi.test',
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(getDoc(doc(userDb, 'adminIssuedCodes', 'hash_1')));
  await assertFails(getDoc(doc(userDb, 'joinRateLimits', OWNER_UID)));

  // Malformed licenseCodes / adminConfig writes and legacy adminSecurity writes fail even for primary admin
  await assertFails(setDoc(doc(superAdminDb, 'licenseCodes', 'hash_1'), { codeHash: 'hash_1' }));
  await assertFails(
    setDoc(doc(superAdminDb, 'adminConfig', 'security'), {
      pinHash: 'plaintext-pin',
      updatedByUid: 'admin_uid_1',
      updatedByEmail: 'hapaypal2003@gmail.com',
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    setDoc(doc(superAdminDb, 'adminSecurity', 'panelConfig'), {
      pinHash: validPinHash,
      updatedByUid: 'admin_uid_1',
      updatedByEmail: 'hapaypal2003@gmail.com',
      updatedAtMs: Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Exclusive primary admin can persist scrypt-hashed PIN config at adminConfig/security and read legacy fallback
  await assertSucceeds(
    setDoc(doc(superAdminDb, 'adminConfig', 'security'), {
      pinHash: validPinHash,
      updatedByUid: 'admin_uid_1',
      updatedByEmail: '  Hapaypal2003@gmail.com ',
      updatedAtMs: Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(getDoc(doc(superAdminDb, 'adminConfig', 'security')));
  await assertSucceeds(getDoc(doc(superAdminDb, 'adminSecurity', 'panelConfig')));
  // Legacy licenseCodes collection is permanently closed to all clients (including admin)
  await assertFails(
    setDoc(doc(superAdminDb, 'licenseCodes', validCodeHash), {
      codeHash: validCodeHash,
      createdAt: serverTimestamp(),
    })
  );
  await assertFails(deleteDoc(doc(superAdminDb, 'licenseCodes', validCodeHash)));

  // User creates initial free profile
  await assertSucceeds(
    setDoc(doc(userDb, 'users', OWNER_UID), {
      uid: OWNER_UID,
      email: `${OWNER_UID}@raseedi.test`,
      isPro: false,
      proActive: false,
      proPlan: 'free',
      planTier: 'free',
      billingCycle: 'free',
      expiresAt: null,
      proExpiresAt: null,
      hasUsedBusinessTrial: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // User cannot self-promote via redeemedCouponCode from client SDK
  await assertFails(
    updateDoc(doc(userDb, 'users', OWNER_UID), {
      isPro: true,
      proActive: true,
      planTier: 'business_pro',
      proPlan: 'business_yearly',
      billingCycle: 'yearly',
      redeemedCouponCode: code,
      updatedAt: serverTimestamp(),
    })
  );

  // Unverified admin token or non-primary admin claim cannot read/update another user's profile
  await assertFails(getDoc(doc(spoofedAdminDb, 'users', OWNER_UID)));
  await assertFails(getDoc(doc(otherAdminClaimDb, 'users', OWNER_UID)));
  await assertFails(
    updateDoc(doc(otherAdminClaimDb, 'users', OWNER_UID), {
      isPro: true,
      proActive: true,
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    updateDoc(doc(spoofedAdminDb, 'users', OWNER_UID), {
      isPro: true,
      proActive: true,
      updatedAt: serverTimestamp(),
    })
  );

  // Verified exclusive primary admin (hapaypal2003@gmail.com) can manage user subscription fields
  await assertSucceeds(
    updateDoc(doc(superAdminDb, 'users', OWNER_UID), {
      isPro: true,
      proActive: true,
      planTier: 'business_pro',
      proPlan: 'business_yearly',
      billingCycle: 'yearly',
      expiresAt: Date.now() + 365 * 86400000,
      proExpiresAt: Date.now() + 365 * 86400000,
      updatedAt: serverTimestamp(),
    })
  );
});

test('Personal cloud backup, chunks, and history allow owner access and block outsiders', async () => {
  const ownerDb = authContext(OWNER_UID, false).firestore();
  const outsiderDb = authContext(OUTSIDER_UID).firestore();

  // Seed legacy/server-created user doc missing createdAt and proActive
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', OWNER_UID), {
      uid: OWNER_UID,
      isPro: true,
      proPlan: 'yearly',
      planTier: 'personal_pro',
      billingCycle: 'yearly',
      expiresAt: Date.now() + 86400000,
      proExpiresAt: Date.now() + 86400000,
      updatedAt: serverTimestamp(),
    });
  });

  // Owner (even unverified email) can update email/lastSyncedAt without touching subscription fields
  await assertSucceeds(
    updateDoc(doc(ownerDb, 'users', OWNER_UID), {
      email: `${OWNER_UID}@raseedi.test`,
      lastSyncedAt: Date.now(),
      updatedAt: serverTimestamp(),
    })
  );

  // Owner can write and update backup/meta + backupChunks/chunk_0
  await assertSucceeds(
    setDoc(doc(ownerDb, 'users', OWNER_UID, 'backup', 'meta'), {
      uid: OWNER_UID,
      schemaVersion: 2,
      chunkCount: 1,
      totalTransactions: 1,
      wallets: [{ id: 'w1', name: 'الخزينة الرئيسية', balance: 0 }],
      categories: [{ id: 'c1', name: 'طعام' }],
      budgets: [],
      debts: [],
      goals: [],
      templates: [],
      moneyCircles: [],
      settings: { currency: 'EGP', isPro: false },
      hasCompletedOnboarding: true,
      updatedAtMs: Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  await assertSucceeds(
    updateDoc(doc(ownerDb, 'users', OWNER_UID, 'backup', 'meta'), {
      totalTransactions: 2,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    })
  );

  await assertSucceeds(
    setDoc(doc(ownerDb, 'users', OWNER_UID, 'backupChunks', 'chunk_0'), {
      uid: OWNER_UID,
      chunkIndex: 0,
      transactions: [{ id: 'tx1', amount: 50 }],
      updatedAt: serverTimestamp(),
    })
  );

  // Owner can create and list backupHistory
  await assertSucceeds(
    setDoc(doc(ownerDb, 'users', OWNER_UID, 'backupHistory', 'auto_1000'), {
      id: 'auto_1000',
      uid: OWNER_UID,
      source: 'auto',
      createdAtMs: 1000,
      totalTransactions: 1,
      storedTransactionsCount: 1,
      walletsCount: 1,
      snapshotJson: '{"schemaVersion":2}',
      createdAt: serverTimestamp(),
    })
  );
  await assertSucceeds(getDocs(collection(ownerDb, 'users', OWNER_UID, 'backupHistory')));

  // Outsider cannot read or write owner's backup docs
  await assertFails(getDoc(doc(outsiderDb, 'users', OWNER_UID, 'backup', 'meta')));
  await assertFails(getDoc(doc(outsiderDb, 'users', OWNER_UID, 'backupChunks', 'chunk_0')));
  await assertFails(getDocs(collection(outsiderDb, 'users', OWNER_UID, 'backupHistory')));
  });

  test('Direct Cloud Organization creation & local-to-cloud upgrade allow verified owner bootstrap and block privilege escalation', async () => {
    const ownerDb = authContext(OWNER_UID, true).firestore();
    const unverifiedDb = authContext(OWNER_UID, false).firestore();
    const proExpiresAt = Date.now() + 90 * 86400000;

    // Seed verified user with Business PRO entitlement
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER_UID), {
        uid: OWNER_UID,
        email: `${OWNER_UID}@raseedi.test`,
        isPro: true,
        proActive: true,
        planTier: 'business_pro',
        proPlan: 'business_yearly',
        billingCycle: 'yearly',
        expiresAt: proExpiresAt,
        proExpiresAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    const newOrgId = 'org-direct-upgrade-01';
    const buildBootstrapBatch = (
      dbRef: ReturnType<ReturnType<typeof authContext>['firestore']>,
      orgId: string,
      overrides?: {
        uid?: string;
        email?: string;
        planTier?: string;
        billingCycle?: string;
        expiresAt?: number | null;
        ownerUid?: string;
      }
    ) => {
      const targetUid = overrides?.uid ?? OWNER_UID;
      const targetEmail = overrides?.email ?? `${targetUid}@raseedi.test`;
      const batch = writeBatch(dbRef);
      batch.set(
        doc(dbRef, 'organizations', orgId),
        stripUndefinedDeep({
          id: orgId,
          name: 'مؤسسة السحابة المباشرة',
          currency: 'EGP',
          industry: 'general',
          vatRate: 14,
          taxNumber: undefined,
          approvalThreshold: 2000,
          ownerUid: overrides?.ownerUid ?? targetUid,
          planTier: overrides?.planTier ?? 'business_pro',
          billingCycle: overrides?.billingCycle ?? 'yearly',
          expiresAt: overrides?.expiresAt !== undefined ? overrides.expiresAt : proExpiresAt,
          seatLimit: 5,
          extraSeats: 0,
          aiScansUsed: 0,
          aiScansMonth: '2026-11',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      batch.set(
        doc(dbRef, 'organizations', orgId, 'members', targetUid),
        stripUndefinedDeep({
          uid: targetUid,
          email: targetEmail,
          displayName: 'Owner Name',
          username: undefined,
          role: 'owner',
          status: 'active',
          joinedAt: Date.now(),
          updatedAt: serverTimestamp(),
        })
      );
      batch.set(doc(dbRef, 'users', targetUid, 'orgRefs', orgId), {
        orgId,
        orgName: 'مؤسسة السحابة المباشرة',
        role: 'owner',
        status: 'active',
        currency: 'EGP',
        joinedAt: Date.now(),
      });
      return batch;
    };

    // Valid atomic bootstrap succeeds for verified Business PRO user (with stripUndefinedDeep + serverTimestamp)
    await assertSucceeds(buildBootstrapBatch(ownerDb, newOrgId).commit());

    // Valid atomic bootstrap ALSO succeeds for verified Free Google user (e.g., zoomacc672@gmail.com)
    const freeVerifiedDb = testEnv
      .authenticatedContext('user_free_google', {
        email: 'zoomacc672@gmail.com',
        email_verified: true,
      })
      .firestore();
    const freeOrgId = 'org-free-upgrade-01';
    await assertSucceeds(
      buildBootstrapBatch(freeVerifiedDb, freeOrgId, {
        uid: 'user_free_google',
        email: 'zoomacc672@gmail.com',
        planTier: 'free',
        billingCycle: 'free',
        expiresAt: null,
      }).commit()
    );

    // Immediately after bootstrap, owner can migrate wallets, costCenters, parties, transactions, & auditLogs
    await assertSucceeds(
      setDoc(doc(freeVerifiedDb, 'organizations', freeOrgId, 'wallets', 'org-w-1'), {
        id: 'org-w-1',
        orgId: freeOrgId,
        balanceMinor: 50000,
        payload: { id: 'org-w-1', name: 'الخزينة الرئيسية', currency: 'EGP', balance: 500 },
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      setDoc(
        doc(freeVerifiedDb, 'organizations', freeOrgId, 'costCenters', 'cc-ops-1'),
        stripUndefinedDeep({
          id: 'cc-ops-1',
          orgId: freeOrgId,
          code: 'OPS-01',
          name: 'التشغيل والإدارة',
          nameAr: 'التشغيل والإدارة',
          nameEn: 'Operations & Admin',
          type: 'department',
          budgetAllocated: 50000,
          budgetAllocatedMinor: 5000000,
          isActive: true,
          createdAt: Date.now(),
          updatedAt: serverTimestamp(),
        })
      )
    );
    await assertSucceeds(
      setDoc(
        doc(freeVerifiedDb, 'organizations', freeOrgId, 'transactions', 'org-tx-1'),
        {
          id: 'org-tx-1',
          orgId: freeOrgId,
          date: '2026-11-20',
          amountMinor: 12500,
          submittedBy: 'user_free_google',
          approvedBy: null,
          approvalStatus: 'approved',
          deletedAt: null,
          payload: { id: 'org-tx-1', amount: 125, currency: 'EGP', date: '2026-11-20' },
          updatedAt: serverTimestamp(),
        }
      )
    );
    await assertSucceeds(
      setDoc(doc(freeVerifiedDb, 'organizations', freeOrgId, 'auditLogs', 'log-upgrade-1'), {
        id: 'log-upgrade-1',
        orgId: freeOrgId,
        action: 'create',
        entityType: 'organization',
        entityId: freeOrgId,
        actorUid: 'user_free_google',
        actorName: 'Owner Name',
        summary: 'ترحيل بيانات المؤسسة المحلية إلى السحابة',
        timestamp: Date.now(),
        createdAt: serverTimestamp(),
      })
    );

    // Extending expiresAt beyond user's entitlement MUST fail
    await assertFails(
      buildBootstrapBatch(ownerDb, 'org-cheat-exp', {
        expiresAt: proExpiresAt + 365 * 86400000,
      }).commit()
    );

    // Unverified account cannot create a Cloud Organization
    await assertFails(
      buildBootstrapBatch(unverifiedDb, 'org-unverified-01', {
        planTier: 'free',
        billingCycle: 'free',
        expiresAt: null,
      }).commit()
    );

    // Free outsider cannot escalate to business_pro when creating an org
    const freeOutsiderDb = authContext(OUTSIDER_UID, true).firestore();
    await assertFails(
      buildBootstrapBatch(freeOutsiderDb, 'org-free-cheat', {
        uid: OUTSIDER_UID,
        planTier: 'business_pro',
        billingCycle: 'yearly',
        expiresAt: proExpiresAt,
      }).commit()
    );
  });

  test('Member self-leave atomic batch and admin-vs-admin protection are enforced strictly', async () => {
    const ADMIN2_UID = 'user_admin_2';
    await seedOrgBase();

    // Seed second admin + orgRefs for all members
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'organizations', ORG_ID, 'members', ADMIN2_UID), {
        uid: ADMIN2_UID,
        email: `${ADMIN2_UID}@raseedi.test`,
        displayName: 'Second Admin',
        role: 'admin',
        status: 'active',
        joinedAt: Date.now(),
        updatedAt: serverTimestamp(),
      });

      const allRoles: Array<[string, string]> = [
        [OWNER_UID, 'owner'],
        [ADMIN_UID, 'admin'],
        [ADMIN2_UID, 'admin'],
        [ACCOUNTANT_UID, 'accountant'],
        [EMPLOYEE_UID, 'employee'],
        [VIEWER_UID, 'viewer'],
      ];
      for (const [uid, role] of allRoles) {
        await setDoc(doc(db, 'users', uid, 'orgRefs', ORG_ID), {
          orgId: ORG_ID,
          orgName: 'شركة رصيدي للاختبار',
          role,
          status: 'active',
          currency: 'EGP',
          joinedAt: Date.now(),
        });
      }
    });

    const ownerDb = authContext(OWNER_UID, true).firestore();
    const adminDb = authContext(ADMIN_UID, true).firestore();
    const employeeDb = authContext(EMPLOYEE_UID, true).firestore();
    const viewerDb = authContext(VIEWER_UID, true).firestore();

    // 1. Admin CANNOT modify or delete another admin (members or orgRefs)
    await assertFails(
      updateDoc(doc(adminDb, 'organizations', ORG_ID, 'members', ADMIN2_UID), {
        role: 'employee',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(adminDb, 'users', ADMIN2_UID, 'orgRefs', ORG_ID), {
        role: 'employee',
      })
    );
    const adminDeleteAdminBatch = writeBatch(adminDb);
    adminDeleteAdminBatch.delete(doc(adminDb, 'organizations', ORG_ID, 'members', ADMIN2_UID));
    adminDeleteAdminBatch.delete(doc(adminDb, 'users', ADMIN2_UID, 'orgRefs', ORG_ID));
    await assertFails(adminDeleteAdminBatch.commit());

    // 2. Owner CAN modify and remove another admin
    await assertSucceeds(
      updateDoc(doc(ownerDb, 'organizations', ORG_ID, 'members', ADMIN2_UID), {
        status: 'suspended',
        updatedAt: serverTimestamp(),
      })
    );
    const ownerDeleteAdminBatch = writeBatch(ownerDb);
    ownerDeleteAdminBatch.delete(doc(ownerDb, 'organizations', ORG_ID, 'members', ADMIN2_UID));
    ownerDeleteAdminBatch.delete(doc(ownerDb, 'users', ADMIN2_UID, 'orgRefs', ORG_ID));
    await assertSucceeds(ownerDeleteAdminBatch.commit());

    // 3. Non-owner member CANNOT orphan-delete only members/{uid} without deleting orgRefs/{orgId}
    await assertFails(deleteDoc(doc(employeeDb, 'organizations', ORG_ID, 'members', EMPLOYEE_UID)));
    await assertFails(deleteDoc(doc(employeeDb, 'users', EMPLOYEE_UID, 'orgRefs', ORG_ID)));

    // 4. Non-owner members (employee & viewer) CAN leave via atomic batch deleting both docs
    const employeeLeaveBatch = writeBatch(employeeDb);
    employeeLeaveBatch.delete(doc(employeeDb, 'organizations', ORG_ID, 'members', EMPLOYEE_UID));
    employeeLeaveBatch.delete(doc(employeeDb, 'users', EMPLOYEE_UID, 'orgRefs', ORG_ID));
    await assertSucceeds(employeeLeaveBatch.commit());

    const viewerLeaveBatch = writeBatch(viewerDb);
    viewerLeaveBatch.delete(doc(viewerDb, 'organizations', ORG_ID, 'members', VIEWER_UID));
    viewerLeaveBatch.delete(doc(viewerDb, 'users', VIEWER_UID, 'orgRefs', ORG_ID));
    await assertSucceeds(viewerLeaveBatch.commit());

    // 5. Owner CANNOT self-leave while organization document still exists
    const ownerSelfLeaveBatch = writeBatch(ownerDb);
    ownerSelfLeaveBatch.delete(doc(ownerDb, 'organizations', ORG_ID, 'members', OWNER_UID));
    ownerSelfLeaveBatch.delete(doc(ownerDb, 'users', OWNER_UID, 'orgRefs', ORG_ID));
    await assertFails(ownerSelfLeaveBatch.commit());
  });
});



