import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetryableFirestoreWriteError,
  runResilientBatchCommits,
} from './workspaceSync';

test('isRetryableFirestoreWriteError retries transient errors and stops on permanent errors', () => {
  assert.equal(isRetryableFirestoreWriteError({ code: 'unavailable', message: 'Backend down' }), true);
  assert.equal(isRetryableFirestoreWriteError({ code: 'deadline-exceeded', message: 'Timeout' }), true);
  assert.equal(isRetryableFirestoreWriteError(new Error('Failed to fetch network')), true);

  assert.equal(isRetryableFirestoreWriteError({ code: 'permission-denied', message: 'Denied' }), false);
  assert.equal(isRetryableFirestoreWriteError({ code: 'invalid-argument', message: 'Bad doc' }), false);
  assert.equal(isRetryableFirestoreWriteError({ code: 'unauthenticated', message: 'No auth' }), false);
});

test('runResilientBatchCommits runs bounded parallel batches, retries transient errors, and reports monotonic progress', async () => {
  const items = Array.from({ length: 1050 }, (_, i) => i + 1);
  let inFlight = 0;
  let maxInFlight = 0;
  let failedOnceOnBatch1 = false;
  const committedIds = new Set<number>();
  const progressEvents: Array<[number, number]> = [];
  const sleepCalls: number[] = [];

  const result = await runResilientBatchCommits({
    items,
    batchSize: 350,
    concurrency: 3,
    maxRetries: 2,
    baseDelayMs: 50,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    onProgress: (processed, total) => {
      progressEvents.push([processed, total]);
    },
    commitChunk: async (chunk, batchIndex) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      try {
        if (batchIndex === 1 && !failedOnceOnBatch1) {
          failedOnceOnBatch1 = true;
          throw { code: 'unavailable', message: 'Transient Firestore blip' };
        }
        for (const id of chunk) committedIds.add(id);
      } finally {
        inFlight -= 1;
      }
    },
  });

  assert.equal(result.total, 1050);
  assert.equal(result.committed, 1050);
  assert.equal(result.batches, 3);
  assert.equal(result.retries, 1);
  assert.equal(committedIds.size, 1050);
  assert.equal(maxInFlight, 3, 'Should utilize concurrency=3 across 3 batches');
  assert.deepEqual(sleepCalls, [50]);
  assert.equal(progressEvents[progressEvents.length - 1][0], 1050);
  assert.equal(progressEvents[progressEvents.length - 1][1], 1050);
  for (let i = 1; i < progressEvents.length; i++) {
    assert.ok(progressEvents[i][0] >= progressEvents[i - 1][0]);
  }
});

test('runResilientBatchCommits aborts immediately on non-retryable permission-denied error', async () => {
  const items = Array.from({ length: 400 }, (_, i) => i);
  let attempts = 0;

  await assert.rejects(
    () =>
      runResilientBatchCommits({
        items,
        batchSize: 200,
        concurrency: 1,
        maxRetries: 3,
        sleep: async () => {},
        commitChunk: async () => {
          attempts += 1;
          throw { code: 'permission-denied', message: 'Missing or insufficient permissions' };
        },
      }),
    (err: unknown) => (err as { code?: string })?.code === 'permission-denied'
  );

  assert.equal(attempts, 1, 'Should not retry permanent permission errors');
});
