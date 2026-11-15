import { Wallet } from '../types';

/**
 * Sorts wallets ascending by `order` (defaulting missing `order` to 0)
 * without mutating the input array.
 */
export function sortWalletsByOrder(wallets: Wallet[]): Wallet[] {
  return [...wallets].sort((a, b) => (a.order || 0) - (b.order || 0));
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
 * Swaps the wallet at `index` up (with `index - 1`) or down (with `index + 1`)
 * and re-assigns sequential `order` values across all wallets.
 */
export function reorderWalletsBySwap(
  wallets: Wallet[],
  index: number,
  direction: 'up' | 'down'
): Wallet[] {
  const ordered = sortWalletsByOrder(wallets);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;

  if (
    index < 0 ||
    index >= ordered.length ||
    targetIndex < 0 ||
    targetIndex >= ordered.length
  ) {
    return assignSequentialWalletOrder(ordered);
  }

  const swapped = [...ordered];
  const current = swapped[index];
  swapped[index] = swapped[targetIndex];
  swapped[targetIndex] = current;

  return assignSequentialWalletOrder(swapped);
}

/**
 * Returns the next ascending `order` index for a newly created wallet.
 */
export function getNextWalletOrder(wallets: Wallet[]): number {
  if (wallets.length === 0) return 0;
  return Math.max(...wallets.map((w) => w.order ?? 0)) + 1;
}
