import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AUTO_CLOUD_BACKUP_DEBOUNCE_MS,
  canScheduleAutoCloudBackup,
  createAutoCloudBackupScheduler,
  isCloudAutoBackupSessionEligible,
  type AutoCloudBackupEligibility,
  type AutoCloudBackupReason,
  type AutoCloudBackupScheduleStatus,
} from './autoCloudBackup';

function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { fireAt: number; fn: () => void }>();

  const setTimeoutFn = (fn: () => void, ms: number) => {
    const id = nextId++;
    timers.set(id, { fireAt: now + ms, fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  const clearTimeoutFn = (id: ReturnType<typeof setTimeout>) => {
    timers.delete(id as unknown as number);
  };

  const advance = async (ms: number) => {
    now += ms;
    const due = Array.from(timers.entries())
      .filter(([, entry]) => entry.fireAt <= now)
      .sort((a, b) => a[1].fireAt - b[1].fireAt);

    for (const [id, entry] of due) {
      if (!timers.has(id)) continue;
      timers.delete(id);
      entry.fn();
      await Promise.resolve();
    }
  };

  return { setTimeoutFn, clearTimeoutFn, advance, getPendingCount: () => timers.size };
}

test('AUTO_CLOUD_BACKUP_DEBOUNCE_MS is within the 2-3 second batching window and eligibility guards work strictly', () => {
  assert.ok(
    AUTO_CLOUD_BACKUP_DEBOUNCE_MS >= 2000 && AUTO_CLOUD_BACKUP_DEBOUNCE_MS <= 3000,
    `Expected debounce between 2000ms and 3000ms, got ${AUTO_CLOUD_BACKUP_DEBOUNCE_MS}`
  );

  const valid: AutoCloudBackupEligibility = {
    hasCompletedOnboarding: true,
    isAuthenticated: true,
    isCloudLoaded: true,
    isEmergencyRecoveryActive: false,
    isOnline: true,
  };

  assert.equal(canScheduleAutoCloudBackup(valid), true);
  assert.equal(canScheduleAutoCloudBackup({ ...valid, isOnline: false }), false);
  assert.equal(canScheduleAutoCloudBackup({ ...valid, isAuthenticated: false }), false);
  assert.equal(canScheduleAutoCloudBackup({ ...valid, isCloudLoaded: false }), false);
  assert.equal(canScheduleAutoCloudBackup({ ...valid, hasCompletedOnboarding: false }), false);
  assert.equal(canScheduleAutoCloudBackup({ ...valid, isEmergencyRecoveryActive: true }), false);

  assert.equal(isCloudAutoBackupSessionEligible(valid), true);
  assert.equal(
    isCloudAutoBackupSessionEligible({ ...valid, isEmergencyRecoveryActive: true }),
    false
  );
});

test('Coalesces rapid transaction add/edit/delete mutations into a single non-blocking cloud backup after debounce', async () => {
  const clock = createFakeClock();
  const runs: AutoCloudBackupReason[] = [];
  const statuses: AutoCloudBackupScheduleStatus[] = [];

  const eligibility: AutoCloudBackupEligibility = {
    hasCompletedOnboarding: true,
    isAuthenticated: true,
    isCloudLoaded: true,
    isEmergencyRecoveryActive: false,
    isOnline: true,
  };

  const scheduler = createAutoCloudBackupScheduler({
    debounceMs: AUTO_CLOUD_BACKUP_DEBOUNCE_MS,
    getEligibility: () => eligibility,
    runBackup: async (reason) => {
      runs.push(reason);
    },
    onStatusChange: (status) => {
      statuses.push(status);
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });

  // Rapid burst: add -> update -> delete within 1.5s
  assert.equal(scheduler.schedule('transaction_add'), true);
  await clock.advance(600);
  assert.equal(scheduler.schedule('transaction_update'), true);
  await clock.advance(600);
  assert.equal(scheduler.schedule('transaction_delete'), true);

  // Should NOT have run yet before debounce finishes
  assert.equal(runs.length, 0);
  assert.equal(scheduler.getState().isPending, true);

  // Advance just under debounce from last mutation
  await clock.advance(AUTO_CLOUD_BACKUP_DEBOUNCE_MS - 100);
  assert.equal(runs.length, 0);

  // Advance past debounce -> runs strictly ONCE with latest reason
  await clock.advance(100);
  assert.deepEqual(runs, ['transaction_delete']);
  assert.equal(scheduler.getState().isPending, false);
  assert.equal(scheduler.getState().isRunning, false);
  assert.ok(statuses.includes('scheduled'));
  assert.ok(statuses.includes('syncing'));
  assert.ok(statuses.includes('synced'));
});

test('Queues transaction mutations made while offline and automatically flushes when connectivity returns', async () => {
  const clock = createFakeClock();
  const runs: AutoCloudBackupReason[] = [];
  const statuses: AutoCloudBackupScheduleStatus[] = [];

  const eligibility: AutoCloudBackupEligibility = {
    hasCompletedOnboarding: true,
    isAuthenticated: true,
    isCloudLoaded: true,
    isEmergencyRecoveryActive: false,
    isOnline: false,
  };

  const scheduler = createAutoCloudBackupScheduler({
    debounceMs: AUTO_CLOUD_BACKUP_DEBOUNCE_MS,
    getEligibility: () => eligibility,
    runBackup: async (reason) => {
      runs.push(reason);
    },
    onStatusChange: (status) => {
      statuses.push(status);
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });

  // Mutation while offline must not start upload, but records offline pending flag
  assert.equal(scheduler.schedule('transaction_add'), false);
  assert.equal(scheduler.getState().pendingWhileOffline, true);
  assert.equal(runs.length, 0);
  assert.equal(statuses[statuses.length - 1], 'offline_pending');

  // Reconnect online -> handleOnline schedules automatic backup
  eligibility.isOnline = true;
  assert.equal(scheduler.handleOnline(), true);
  assert.equal(scheduler.getState().pendingWhileOffline, false);
  assert.equal(scheduler.getState().isPending, true);

  await clock.advance(AUTO_CLOUD_BACKUP_DEBOUNCE_MS);
  assert.deepEqual(runs, ['online_reconnect']);
});

test('Prevents overlapping concurrent cloud uploads and schedules one clean follow-up when a transaction arrives mid-sync', async () => {
  const clock = createFakeClock();
  const runs: AutoCloudBackupReason[] = [];
  let resolveFirstRun: (() => void) | null = null;

  const eligibility: AutoCloudBackupEligibility = {
    hasCompletedOnboarding: true,
    isAuthenticated: true,
    isCloudLoaded: true,
    isEmergencyRecoveryActive: false,
    isOnline: true,
  };

  const scheduler = createAutoCloudBackupScheduler({
    debounceMs: AUTO_CLOUD_BACKUP_DEBOUNCE_MS,
    getEligibility: () => eligibility,
    runBackup: async (reason) => {
      runs.push(reason);
      if (runs.length === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstRun = resolve;
        });
      }
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });

  scheduler.schedule('transaction_add');
  await clock.advance(AUTO_CLOUD_BACKUP_DEBOUNCE_MS);
  assert.equal(runs.length, 1);
  assert.equal(scheduler.getState().isRunning, true);

  // New transaction added while upload #1 is still in flight
  assert.equal(scheduler.schedule('transaction_update'), true);
  assert.equal(runs.length, 1, 'Must not overlap concurrent backup writes');

  // Finish upload #1 -> schedules exactly one debounced follow-up
  resolveFirstRun?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scheduler.getState().isRunning, false);
  assert.equal(scheduler.getState().isPending, true);

  await clock.advance(AUTO_CLOUD_BACKUP_DEBOUNCE_MS);
  assert.deepEqual(runs, ['transaction_add', 'transaction_update']);
});

test('Cancel prevents stale scheduled backups (e.g., on sign-out or manual sync)', async () => {
  const clock = createFakeClock();
  let runCount = 0;

  const scheduler = createAutoCloudBackupScheduler({
    debounceMs: AUTO_CLOUD_BACKUP_DEBOUNCE_MS,
    getEligibility: () => ({
      hasCompletedOnboarding: true,
      isAuthenticated: true,
      isCloudLoaded: true,
      isEmergencyRecoveryActive: false,
      isOnline: true,
    }),
    runBackup: async () => {
      runCount += 1;
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });

  scheduler.schedule('transaction_add');
  assert.equal(clock.getPendingCount(), 1);
  scheduler.cancel();
  assert.equal(clock.getPendingCount(), 0);

  await clock.advance(AUTO_CLOUD_BACKUP_DEBOUNCE_MS * 2);
  assert.equal(runCount, 0);
});

test('AppContext wires scheduleTransactionAutoBackup for add/update/delete and updates both lastCloudSyncAt and lastBackupAt', () => {
  const appContextSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/context/AppContext.tsx'),
    'utf8'
  );
  assert.ok(appContextSrc.includes("scheduleTransactionAutoBackup('transaction_add')"));
  assert.ok(appContextSrc.includes("scheduleTransactionAutoBackup('transaction_update')"));
  assert.ok(appContextSrc.includes("scheduleTransactionAutoBackup('transaction_delete')"));
  assert.ok(appContextSrc.includes('lastCloudSyncAt: syncedAt'));
  assert.ok(appContextSrc.includes('lastBackupAt: syncedAt'));
});
