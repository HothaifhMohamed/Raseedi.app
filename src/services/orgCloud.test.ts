import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrgTxPayloadForCloud,
  parseWalletDoc,
  resolveImportedOrgTxSubmittedBy,
} from './orgCloud';
import { Transaction } from '../types';

test('parseWalletDoc derives balance strictly from balanceMinor even if payload.balance is stale', () => {
  const parsed = parseWalletDoc({
    id: 'w-main',
    balanceMinor: 125_075, // 1,250.75 EGP after atomic increment()
    payload: {
      id: 'w-main',
      name: 'الخزينة الرئيسية',
      currency: 'EGP',
      initialBalance: 1000,
      balance: 1000, // Stale snapshot balance that must NOT override balanceMinor
      balanceMinor: 100_000,
      color: '#0D5C53',
      icon: 'Wallet',
      isArchived: false,
      order: 0,
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.id, 'w-main');
  assert.equal(parsed.balanceMinor, 125_075);
  assert.equal(parsed.balance, 1250.75);

  // Also test 3-decimal currency (e.g. KWD)
  const kwdParsed = parseWalletDoc({
    id: 'w-kwd',
    balanceMinor: 50_250, // 50.250 KWD
    payload: {
      id: 'w-kwd',
      name: 'KWD Treasury',
      currency: 'KWD',
      initialBalance: 0,
      balance: 9999, // Stale
      color: '#0D5C53',
      icon: 'Wallet',
      isArchived: false,
      order: 1,
    },
  });

  assert.ok(kwdParsed);
  assert.equal(kwdParsed.balanceMinor, 50_250);
  assert.equal(kwdParsed.balance, 50.25);
});

test('buildOrgTxPayloadForCloud produces a valid normalized doc id matching both top-level id and payload.id', () => {
  const rawTx: Transaction = {
    id: '  bad/id with spaces!  ',
    type: 'expense',
    amount: 420.5,
    currency: 'egp',
    date: '2026-11-21',
    time: '14:00',
    categoryId: 'cat-ops',
    walletId: 'w-main',
    priority: 'normal',
    doesNotAffectBalance: false,
    approvalStatus: 'approved',
    attachments: ['data:image/png;base64,AAAA'],
    createdAt: 1000,
    updatedAt: 1000,
  };

  const cloudDoc = buildOrgTxPayloadForCloud('org-123', rawTx);
  const topId = String(cloudDoc.id);
  const payload = cloudDoc.payload as Transaction;

  assert.ok(topId.length > 0 && topId.length <= 128);
  assert.doesNotMatch(topId, /[\/\s!]/);
  assert.equal(payload.id, topId);
  assert.equal(cloudDoc.orgId, 'org-123');
  assert.equal(cloudDoc.amountMinor, 42050);
  assert.equal(payload.currency, 'EGP');
  assert.equal('attachments' in payload, false);
});

test('resolveImportedOrgTxSubmittedBy forces actor.uid for roles below accountant and preserves original for accountant+', () => {
  const actor = { uid: 'uid-emp-1', name: 'Ahmed Employee' };
  const foreignRow = { submittedBy: 'uid-someone-else', submittedByName: 'Other User' };

  // Below accountant (employee, viewer, null, undefined) -> MUST force actor.uid
  assert.deepEqual(resolveImportedOrgTxSubmittedBy(foreignRow, actor, 'employee'), {
    submittedBy: 'uid-emp-1',
    submittedByName: 'Ahmed Employee',
  });
  assert.deepEqual(resolveImportedOrgTxSubmittedBy(foreignRow, actor, 'viewer'), {
    submittedBy: 'uid-emp-1',
    submittedByName: 'Ahmed Employee',
  });
  assert.deepEqual(resolveImportedOrgTxSubmittedBy(foreignRow, actor, null), {
    submittedBy: 'uid-emp-1',
    submittedByName: 'Ahmed Employee',
  });

  // Accountant, admin, owner -> preserves foreign row submittedBy (or defaults to actor if missing)
  assert.deepEqual(resolveImportedOrgTxSubmittedBy(foreignRow, actor, 'accountant'), {
    submittedBy: 'uid-someone-else',
    submittedByName: 'Other User',
  });
  assert.deepEqual(resolveImportedOrgTxSubmittedBy(foreignRow, actor, 'admin'), {
    submittedBy: 'uid-someone-else',
    submittedByName: 'Other User',
  });
  assert.deepEqual(resolveImportedOrgTxSubmittedBy({}, actor, 'owner'), {
    submittedBy: 'uid-emp-1',
    submittedByName: 'Ahmed Employee',
  });
});

