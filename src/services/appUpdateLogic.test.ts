import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNoCacheUrl,
  isNewerBuildAvailable,
  parseVersionManifest,
  shouldAttemptAutoReload,
} from './appUpdateLogic.js';

describe('appUpdateLogic version & auto-reload helpers', () => {
  it('parses valid version.json manifests and rejects malformed payloads', () => {
    const valid = parseVersionManifest({
      version: '1.0.0',
      buildId: '1.0.0-m9x12ab',
      builtAt: '2026-11-16T16:50:00.000Z',
    });
    assert.deepEqual(valid, {
      version: '1.0.0',
      buildId: '1.0.0-m9x12ab',
      builtAt: '2026-11-16T16:50:00.000Z',
    });

    assert.equal(parseVersionManifest(null), null);
    assert.equal(parseVersionManifest({ version: '1.0.0' }), null);
    assert.equal(parseVersionManifest({ buildId: '   ' }), null);
  });

  it('detects newer remote builds only when both current and remote buildIds are valid and different', () => {
    const remote = { version: '1.0.0', buildId: 'build-new', builtAt: '' };
    assert.equal(isNewerBuildAvailable('build-old', remote), true);
    assert.equal(isNewerBuildAvailable('build-new', remote), false);
    assert.equal(isNewerBuildAvailable('', remote), false);
    assert.equal(isNewerBuildAvailable('build-old', null), false);
  });

  it('prevents duplicate or rapid infinite auto-reload loops via shouldAttemptAutoReload', () => {
    const now = 100_000;
    assert.equal(
      shouldAttemptAutoReload({
        targetKey: 'build-v2',
        lastReloadedKey: null,
        nowMs: now,
        lastReloadTimestampMs: null,
      }),
      true
    );

    // Same targetKey already reloaded in this session -> block
    assert.equal(
      shouldAttemptAutoReload({
        targetKey: 'build-v2',
        lastReloadedKey: 'build-v2',
        nowMs: now + 60_000,
        lastReloadTimestampMs: now,
      }),
      false
    );

    // Different targetKey but within 15s cooldown -> block
    assert.equal(
      shouldAttemptAutoReload({
        targetKey: 'build-v3',
        lastReloadedKey: 'build-v2',
        nowMs: now + 5_000,
        lastReloadTimestampMs: now,
      }),
      false
    );

    // Different targetKey after cooldown -> allow
    assert.equal(
      shouldAttemptAutoReload({
        targetKey: 'build-v3',
        lastReloadedKey: 'build-v2',
        nowMs: now + 20_000,
        lastReloadTimestampMs: now,
      }),
      true
    );
  });

  it('builds cache-busted URLs cleanly', () => {
    assert.equal(buildNoCacheUrl('/version.json', 12345), '/version.json?t=12345');
    assert.equal(buildNoCacheUrl('/version.json?v=1', 12345), '/version.json?v=1&t=12345');
  });
});
