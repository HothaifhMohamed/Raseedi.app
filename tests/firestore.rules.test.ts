/**
 * Firestore Security Rules Emulator Test Suite
 * Run via: npm run test:rules (requires Java runtime + firebase emulators:exec)
 */
import test, { after, before, beforeEach, describe } from 'node:test';
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
      isPro: false,
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

  // Outsider cannot read another user's profile
  await assertFails(getDoc(doc(outsiderDb, 'users', OWNER_UID)));

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
  await assertSucceeds(
    setDoc(doc(superAdminDb, 'licenseCodes', validCodeHash), {
      codeHash: validCodeHash,
      codePreview: 'RSD-BIZ-****-EFGH',
      plan: 'code',
      tier: 'business',
      planTier: 'business_pro',
      cycle: 'lifetime',
      status: 'unused',
      used: false,
      usedBy: null,
      usedOrgId: null,
      usedAt: null,
      createdByUid: 'admin_uid_1',
      createdByEmail: 'hapaypal2003@gmail.com',
      createdAtMs: Date.now(),
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
});


