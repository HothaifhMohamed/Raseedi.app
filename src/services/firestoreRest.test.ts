import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeFirestoreDocumentFields,
  decodeFirestoreValue,
  fetchFirestoreDocumentWithToken,
  isFirestorePermissionDeniedError,
} from './firestoreRest';

test('isFirestorePermissionDeniedError detects gRPC code 7 and permission messages', () => {
  assert.equal(isFirestorePermissionDeniedError({ code: 7, message: '7 PERMISSION_DENIED' }), true);
  assert.equal(
    isFirestorePermissionDeniedError(new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.')),
    true
  );
  assert.equal(
    isFirestorePermissionDeniedError(new Error('Could not load the default credentials.')),
    true
  );
  assert.equal(isFirestorePermissionDeniedError(new Error('Network timeout')), false);
  assert.equal(isFirestorePermissionDeniedError(null), false);
});

test('decodeFirestoreDocumentFields converts Firestore REST JSON into plain JS object', () => {
  const decoded = decodeFirestoreDocumentFields({
    uid: { stringValue: 'user-123' },
    isPro: { booleanValue: true },
    expiresAt: { integerValue: '1900000000000' },
    vatRate: { doubleValue: 14.5 },
    proExpiresAt: { nullValue: null },
    tags: {
      arrayValue: {
        values: [{ stringValue: 'business' }, { integerValue: '2' }],
      },
    },
    nested: {
      mapValue: {
        fields: {
          planTier: { stringValue: 'business_pro' },
        },
      },
    },
  });

  assert.deepEqual(decoded, {
    uid: 'user-123',
    isPro: true,
    expiresAt: 1900000000000,
    vatRate: 14.5,
    proExpiresAt: null,
    tags: ['business', 2],
    nested: { planTier: 'business_pro' },
  });
  assert.equal(decodeFirestoreValue(undefined), undefined);
});

test('fetchFirestoreDocumentWithToken handles 200, 403, and 404 cleanly', async () => {
  const okFetch = (async () =>
    new Response(
      JSON.stringify({
        fields: {
          uid: { stringValue: 'u1' },
          isPro: { booleanValue: false },
          planTier: { stringValue: 'free' },
        },
      }),
      { status: 200 }
    )) as unknown as typeof fetch;

  const okResult = await fetchFirestoreDocumentWithToken({
    projectId: 'proj-1',
    databaseId: 'db-1',
    documentPath: 'users/u1',
    idToken: 'tok-123',
    fetchImpl: okFetch,
  });
  assert.equal(okResult.exists, true);
  assert.equal(okResult.data?.uid, 'u1');
  assert.equal(okResult.data?.isPro, false);

  const deniedFetch = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
  const deniedResult = await fetchFirestoreDocumentWithToken({
    projectId: 'proj-1',
    documentPath: 'users/u1/scanQuotas/2026-11',
    idToken: 'tok-123',
    fetchImpl: deniedFetch,
  });
  assert.equal(deniedResult.exists, false);
  assert.equal(deniedResult.forbidden, true);

  const missingFetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
  const missingResult = await fetchFirestoreDocumentWithToken({
    projectId: 'proj-1',
    documentPath: 'users/missing',
    idToken: 'tok-123',
    fetchImpl: missingFetch,
  });
  assert.equal(missingResult.exists, false);
  assert.equal(missingResult.forbidden, undefined);
});
