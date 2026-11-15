import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAccountDeleteErrorCode,
  shouldFallbackAccountDeleteError,
} from './accountDeletion';

describe('accountDeletion local-first fallback policy', () => {
  it('falls back to local wipe + signOut on server unavailable or network errors', () => {
    const errUnavailable = Object.assign(new Error('DELETE_ACCOUNT_FAILED'), {
      code: 'DELETE_ACCOUNT_FAILED',
    });
    assert.equal(shouldFallbackAccountDeleteError(errUnavailable), true);

    const errAdmin = Object.assign(new Error('CLOUD_ADMIN_UNAVAILABLE'), {
      code: 'CLOUD_ADMIN_UNAVAILABLE',
    });
    assert.equal(shouldFallbackAccountDeleteError(errAdmin), true);

    const errReauth = Object.assign(new Error('RECENT_AUTH_REQUIRED'), {
      code: 'RECENT_AUTH_REQUIRED',
    });
    assert.equal(shouldFallbackAccountDeleteError(errReauth), true);

    assert.equal(shouldFallbackAccountDeleteError(new TypeError('Failed to fetch')), true);
  });

  it('aborts only for genuine server-side multi-member ownership transfer conflicts', () => {
    const errOwnership = Object.assign(new Error('Transfer ownership first'), {
      code: 'ORG_OWNERSHIP_TRANSFER_REQUIRED',
    });
    assert.equal(extractAccountDeleteErrorCode(errOwnership), 'ORG_OWNERSHIP_TRANSFER_REQUIRED');
    assert.equal(shouldFallbackAccountDeleteError(errOwnership), false);
  });
});
