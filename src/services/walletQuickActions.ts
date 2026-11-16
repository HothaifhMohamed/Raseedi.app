import { TransactionType, Wallet } from '../types';

export interface TransactionDraftPreset {
  type?: TransactionType;
  walletId?: string;
  toWalletId?: string;
  currency?: string;
}

export type WalletQuickTransactionAction = 'deposit' | 'withdraw' | 'transfer';

/**
 * Picks the best destination wallet when initiating a quick transfer from `sourceWallet`.
 * Prefers the first active (non-archived) wallet other than `sourceWallet.id`,
 * falling back to any other wallet if all other wallets are archived.
 */
export function findTransferDestinationWallet(
  sourceWallet: Wallet,
  allWallets: Wallet[]
): Wallet | null {
  const others = allWallets.filter((w) => w.id !== sourceWallet.id);
  if (others.length === 0) return null;
  return others.find((w) => !w.isArchived) || others[0];
}

export function canTransferFromWallet(sourceWallet: Wallet, allWallets: Wallet[]): boolean {
  return allWallets.some((w) => w.id !== sourceWallet.id);
}

/**
 * Builds a transaction modal preset for deposit, withdraw, or transfer actions
 * initiated from a wallet's quick actions menu.
 * Returns `null` when `action === 'transfer'` and no other wallet exists.
 */
export function buildWalletActionPreset(
  wallet: Wallet,
  action: WalletQuickTransactionAction,
  allWallets: Wallet[]
): TransactionDraftPreset | null {
  if (action === 'deposit') {
    return {
      type: 'income',
      walletId: wallet.id,
      currency: wallet.currency,
    };
  }

  if (action === 'withdraw') {
    return {
      type: 'expense',
      walletId: wallet.id,
      currency: wallet.currency,
    };
  }

  const targetWallet = findTransferDestinationWallet(wallet, allWallets);
  if (!targetWallet) {
    return null;
  }

  return {
    type: 'transfer',
    walletId: wallet.id,
    toWalletId: targetWallet.id,
    currency: wallet.currency,
  };
}

/**
 * Validates whether a wallet can be paused/archived or resumed.
 * Resuming an archived wallet is always allowed; pausing requires at least
 * one other active (non-archived) wallet to remain.
 */
export function canToggleWalletArchive(
  wallet: Wallet,
  allWallets: Wallet[]
): { allowed: boolean; nextArchived: boolean; reasonAr?: string; reasonEn?: string } {
  if (wallet.isArchived) {
    return { allowed: true, nextArchived: false };
  }

  const activeCount = allWallets.filter((w) => !w.isArchived).length;
  if (activeCount <= 1) {
    return {
      allowed: false,
      nextArchived: true,
      reasonAr: 'يجب أن تبقى محفظة واحدة نشطة على الأقل في حسابك.',
      reasonEn: 'At least one active wallet must remain in your account.',
    };
  }

  return { allowed: true, nextArchived: true };
}
