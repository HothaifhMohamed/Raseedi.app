import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkOrgSeatAvailability,
  computeEmailLookupHash,
  formatUsernameHandle,
  normalizeUsername,
  parseMemberLookupQuery,
  validateUsernameFormat,
} from './usernameService';

test('normalizeUsername trims, strips leading @, and lowercases', () => {
  assert.equal(normalizeUsername('  @@Ahmed_Ali99  '), 'ahmed_ali99');
  assert.equal(formatUsernameHandle('Ahmed_Ali99'), '@ahmed_ali99');
  assert.equal(formatUsernameHandle(''), '');
});

test('validateUsernameFormat enforces charset, length, and reserved names', () => {
  assert.equal(validateUsernameFormat('ali_finance').valid, true);
  assert.equal(validateUsernameFormat('@mohamed_2026').normalized, 'mohamed_2026');
  assert.equal(validateUsernameFormat('ab').valid, false);
  assert.equal(validateUsernameFormat('a'.repeat(31)).valid, false);
  assert.equal(validateUsernameFormat('bad-name').valid, false);
  assert.equal(validateUsernameFormat('bad name').valid, false);
  assert.equal(validateUsernameFormat('admin').valid, false);
  assert.equal(validateUsernameFormat('raseedi').valid, false);
});

test('parseMemberLookupQuery distinguishes emails and @usernames accurately', () => {
  const emailRes = parseMemberLookupQuery('  User.Name+1@Company.COM ');
  assert.deepEqual(emailRes, { kind: 'email', normalized: 'user.name+1@company.com' });

  const handleRes = parseMemberLookupQuery('  @Sara_CFO ');
  assert.deepEqual(handleRes, { kind: 'username', normalized: 'sara_cfo' });

  const bareHandle = parseMemberLookupQuery('sara_cfo');
  assert.deepEqual(bareHandle, { kind: 'username', normalized: 'sara_cfo' });

  const badEmail = parseMemberLookupQuery('broken@email');
  assert.equal(badEmail.kind, 'invalid');

  const empty = parseMemberLookupQuery('   ');
  assert.equal(empty.kind, 'invalid');
});

test('computeEmailLookupHash produces deterministic 64-char SHA-256 hex digest', async () => {
  const h1 = await computeEmailLookupHash('TestUser@Example.COM');
  const h2 = await computeEmailLookupHash('  testuser@example.com  ');
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.match(h1, /^[a-f0-9]{64}$/);

  await assert.rejects(() => computeEmailLookupHash('not-an-email'));
});

test('checkOrgSeatAvailability enforces seatLimit + extraSeats and prevents duplicate members', () => {
  const members = [
    { uid: 'u1', status: 'active' as const },
    { uid: 'u2', status: 'active' as const },
    { uid: 'u3', status: 'suspended' as const },
  ];

  // Suspended member does not consume an active seat
  const ok = checkOrgSeatAvailability(members, 3, 0, 'u4');
  assert.equal(ok.canAdd, true);
  assert.equal(ok.activeCount, 2);
  assert.equal(ok.remainingSeats, 1);

  // Duplicate member blocked even if seats remain
  const dup = checkOrgSeatAvailability(members, 5, 0, 'u2');
  assert.equal(dup.canAdd, false);
  assert.equal(dup.reason, 'ALREADY_MEMBER');

  // Seat limit reached
  const full = checkOrgSeatAvailability(members, 2, 0, 'u4');
  assert.equal(full.canAdd, false);
  assert.equal(full.reason, 'SEAT_LIMIT_REACHED');

  // Extra seats expand capacity
  const expanded = checkOrgSeatAvailability(members, 2, 1, 'u4');
  assert.equal(expanded.canAdd, true);
  assert.equal(expanded.effectiveSeatLimit, 3);
});
