import { canPerformAutomaticCloudWrite } from './workspaceSync';

export const AUTO_CLOUD_BACKUP_DEBOUNCE_MS = 2500;

export type AutoCloudBackupReason =
  | 'transaction_add'
  | 'transaction_update'
  | 'transaction_delete'
  | 'state_change'
  | 'online_reconnect';

export type AutoCloudBackupScheduleStatus =
  | 'idle'
  | 'scheduled'
  | 'syncing'
  | 'synced'
  | 'offline_pending'
  | 'error';

export interface AutoCloudBackupEligibility {
  hasCompletedOnboarding: boolean;
  isAuthenticated: boolean;
  isCloudLoaded: boolean;
  isEmergencyRecoveryActive: boolean;
  isOnline: boolean;
}

/**
 * Pure guard deciding whether an automatic cloud backup may be scheduled now.
 * Requires onboarding completion, authenticated cloud session, initial cloud
 * hydration, no emergency recovery mode, and active network connectivity.
 */
export function canScheduleAutoCloudBackup(
  eligibility: AutoCloudBackupEligibility
): boolean {
  if (!eligibility.hasCompletedOnboarding) return false;
  if (!eligibility.isOnline) return false;
  return canPerformAutomaticCloudWrite({
    isAuthenticated: eligibility.isAuthenticated,
    isCloudLoaded: eligibility.isCloudLoaded,
    isEmergencyRecoveryActive: eligibility.isEmergencyRecoveryActive,
  });
}

/**
 * Checks whether the session itself is eligible for automatic cloud writes
 * independent of transient offline state (used to queue offline edits for
 * automatic upload once connectivity returns).
 */
export function isCloudAutoBackupSessionEligible(
  eligibility: Omit<AutoCloudBackupEligibility, 'isOnline'>
): boolean {
  if (!eligibility.hasCompletedOnboarding) return false;
  return canPerformAutomaticCloudWrite({
    isAuthenticated: eligibility.isAuthenticated,
    isCloudLoaded: eligibility.isCloudLoaded,
    isEmergencyRecoveryActive: eligibility.isEmergencyRecoveryActive,
  });
}

export interface AutoCloudBackupSchedulerOptions {
  debounceMs?: number;
  getEligibility: () => AutoCloudBackupEligibility;
  runBackup: (reason: AutoCloudBackupReason) => Promise<void>;
  onStatusChange?: (
    status: AutoCloudBackupScheduleStatus,
    reason: AutoCloudBackupReason | null
  ) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
}

export interface AutoCloudBackupSchedulerState {
  isPending: boolean;
  isRunning: boolean;
  pendingWhileOffline: boolean;
  lastReason: AutoCloudBackupReason | null;
}

export interface AutoCloudBackupScheduler {
  schedule: (reason: AutoCloudBackupReason) => boolean;
  handleOnline: () => boolean;
  cancel: () => void;
  getState: () => AutoCloudBackupSchedulerState;
}

/**
 * Pure, framework-agnostic debounced cloud backup scheduler.
 * - Coalesces rapid transaction adds/edits/deletes within `debounceMs` (~2.5s)
 *   into a single non-blocking cloud backup write.
 * - Prevents overlapping concurrent uploads by queueing one clean follow-up
 *   run if a mutation happens while an upload is already in flight.
 * - Remembers mutations made while offline and flushes them automatically via
 *   `handleOnline()` as soon as network connectivity is restored.
 */
export function createAutoCloudBackupScheduler(
  options: AutoCloudBackupSchedulerOptions
): AutoCloudBackupScheduler {
  const debounceMs =
    typeof options.debounceMs === 'number' && options.debounceMs >= 0
      ? options.debounceMs
      : AUTO_CLOUD_BACKUP_DEBOUNCE_MS;
  const setTimer = options.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeoutFn || ((id) => clearTimeout(id));

  let timerId: ReturnType<typeof setTimeout> | null = null;
  let isRunning = false;
  let rerunAfterCurrent = false;
  let pendingWhileOffline = false;
  let lastReason: AutoCloudBackupReason | null = null;
  let generation = 0;

  const notify = (
    status: AutoCloudBackupScheduleStatus,
    reason: AutoCloudBackupReason | null
  ) => {
    options.onStatusChange?.(status, reason);
  };

  const clearPendingTimer = () => {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
  };

  const executeRun = async (runGeneration: number, reason: AutoCloudBackupReason) => {
    if (runGeneration !== generation) return;

    const eligibility = options.getEligibility();
    if (!isCloudAutoBackupSessionEligible(eligibility)) {
      notify('idle', null);
      return;
    }
    if (!eligibility.isOnline) {
      pendingWhileOffline = true;
      notify('offline_pending', reason);
      return;
    }

    isRunning = true;
    notify('syncing', reason);

    try {
      await options.runBackup(reason);
      if (runGeneration === generation) {
        notify('synced', reason);
      }
    } catch {
      if (runGeneration === generation) {
        notify('error', reason);
      }
    } finally {
      isRunning = false;
      if (runGeneration === generation && rerunAfterCurrent) {
        const nextReason = lastReason || reason;
        rerunAfterCurrent = false;
        schedule(nextReason);
      }
    }
  };

  const schedule = (reason: AutoCloudBackupReason): boolean => {
    const eligibility = options.getEligibility();
    if (!isCloudAutoBackupSessionEligible(eligibility)) {
      return false;
    }

    lastReason = reason;

    if (!eligibility.isOnline) {
      clearPendingTimer();
      pendingWhileOffline = true;
      notify('offline_pending', reason);
      return false;
    }

    pendingWhileOffline = false;

    if (isRunning) {
      rerunAfterCurrent = true;
      notify('scheduled', reason);
      return true;
    }

    clearPendingTimer();
    const scheduledGeneration = generation;
    notify('scheduled', reason);

    timerId = setTimer(() => {
      timerId = null;
      void executeRun(scheduledGeneration, reason);
    }, debounceMs);

    return true;
  };

  const handleOnline = (): boolean => {
    if (!pendingWhileOffline) return false;
    const eligibility = options.getEligibility();
    if (!canScheduleAutoCloudBackup(eligibility)) return false;
    pendingWhileOffline = false;
    return schedule('online_reconnect');
  };

  const cancel = () => {
    generation += 1;
    clearPendingTimer();
    rerunAfterCurrent = false;
    pendingWhileOffline = false;
    lastReason = null;
    notify('idle', null);
  };

  const getState = (): AutoCloudBackupSchedulerState => ({
    isPending: timerId !== null || rerunAfterCurrent,
    isRunning,
    pendingWhileOffline,
    lastReason,
  });

  return {
    schedule,
    handleOnline,
    cancel,
    getState,
  };
}
