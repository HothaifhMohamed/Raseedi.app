import { Wallet } from '../types';

function getSafeOrderValue(order: unknown): number {
  return typeof order === 'number' && Number.isFinite(order) ? order : 0;
}

/**
 * Sorts wallets ascending by `order` (defaulting missing/non-finite `order` to 0)
 * with deterministic tie-breaking by original array position, without mutating input.
 */
export function sortWalletsByOrder(wallets: Wallet[]): Wallet[] {
  return wallets
    .map((wallet, idx) => ({ wallet, idx }))
    .sort((a, b) => {
      const diff = getSafeOrderValue(a.wallet.order) - getSafeOrderValue(b.wallet.order);
      return diff !== 0 ? diff : a.idx - b.idx;
    })
    .map((entry) => entry.wallet);
}

/**
 * Re-indexes `order` sequentially (0, 1, 2, ...) matching the given array sequence.
 */
export function assignSequentialWalletOrder(wallets: Wallet[]): Wallet[] {
  return wallets.map((w, index) => ({
    ...w,
    order: index,
  }));
}

/**
 * Swaps the wallet ID at `index` up (`index - 1`) or down (`index + 1`).
 * Returns the original array reference if the move is out of bounds.
 */
export function moveWalletIdInOrder(
  orderIds: string[],
  index: number,
  direction: 'up' | 'down'
): string[] {
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (
    index < 0 ||
    index >= orderIds.length ||
    targetIndex < 0 ||
    targetIndex >= orderIds.length
  ) {
    return orderIds;
  }

  const next = [...orderIds];
  const current = next[index];
  next[index] = next[targetIndex];
  next[targetIndex] = current;
  return next;
}

/**
 * Moves a specific wallet ID up or down based on its LATEST index in `orderIds`.
 * Eliminates stale-index bugs when rapid taps fire before React commits a re-render.
 */
export function moveWalletById(
  orderIds: string[],
  walletId: string,
  direction: 'up' | 'down'
): string[] {
  const currentIndex = orderIds.indexOf(walletId);
  if (currentIndex === -1) return orderIds;
  return moveWalletIdInOrder(orderIds, currentIndex, direction);
}

/**
 * Moves a wallet ID from `fromIndex` to `toIndex` without re-sorting.
 * Returns the original array reference if indices are equal or out of bounds.
 */
export function moveWalletIdByIndex(
  orderIds: string[],
  fromIndex: number,
  toIndex: number
): string[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= orderIds.length ||
    toIndex < 0 ||
    toIndex >= orderIds.length
  ) {
    return orderIds;
  }

  const next = [...orderIds];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Reconciles a live draft ID sequence against the latest wallet objects:
 * - Preserves the exact user-chosen order for all still-existing wallets (NEVER re-sorts them).
 * - Drops IDs of deleted wallets and removes duplicates.
 * - Appends any newly created wallets (sorted by their own order) at the end.
 */
export function reconcileDraftOrderIds(
  draftOrderIds: string[],
  latestWallets: Wallet[]
): string[] {
  const latestById = new Set(latestWallets.map((w) => w.id));
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const id of draftOrderIds) {
    if (latestById.has(id) && !seen.has(id)) {
      seen.add(id);
      kept.push(id);
    }
  }

  if (kept.length < latestWallets.length) {
    const missing = sortWalletsByOrder(latestWallets.filter((w) => !seen.has(w.id)));
    for (const wallet of missing) {
      kept.push(wallet.id);
    }
  }

  return kept;
}

/**
 * Projects the latest `wallets` into the exact sequence specified by `orderIds`,
 * assigning sequential `order` values (and optional `updatedAt`) while preserving
 * the freshest balance/metadata fields from `wallets`.
 */
export function applyWalletOrderIds(
  wallets: Wallet[],
  orderIds: string[],
  updatedAt?: number
): Wallet[] {
  const reconciledIds = reconcileDraftOrderIds(orderIds, wallets);
  const byId = new Map(wallets.map((w) => [w.id, w]));

  const ordered: Wallet[] = [];
  for (let index = 0; index < reconciledIds.length; index += 1) {
    const wallet = byId.get(reconciledIds[index]);
    if (!wallet) continue;
    ordered.push(
      updatedAt !== undefined
        ? { ...wallet, order: index, updatedAt }
        : { ...wallet, order: index }
    );
  }
  return ordered;
}

/**
 * Returns true if the given wallet list already matches the target ID sequence.
 */
export function areWalletOrderIdsEqual(wallets: Wallet[], orderIds: string[]): boolean {
  if (wallets.length !== orderIds.length) return false;
  for (let i = 0; i < wallets.length; i += 1) {
    if (wallets[i].id !== orderIds[i]) return false;
  }
  return true;
}

/**
 * Swaps the wallet at `index` up (with `index - 1`) or down (with `index + 1`)
 * and re-assigns sequential `order` values across all wallets.
 */
export function reorderWalletsBySwap(
  wallets: Wallet[],
  index: number,
  direction: 'up' | 'down'
): Wallet[] {
  const ordered = sortWalletsByOrder(wallets);
  const nextIds = moveWalletIdInOrder(
    ordered.map((w) => w.id),
    index,
    direction
  );
  return applyWalletOrderIds(ordered, nextIds);
}

/**
 * Returns the next ascending `order` index for a newly created wallet.
 */
export function getNextWalletOrder(wallets: Wallet[]): number {
  if (wallets.length === 0) return 0;
  return Math.max(...wallets.map((w) => getSafeOrderValue(w.order))) + 1;
}
