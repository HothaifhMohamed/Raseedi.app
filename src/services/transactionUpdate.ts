import { Transaction, Wallet } from '../types';
import {
  doesTransactionAffectAccounting,
  getEffectiveTransactionAmount,
  getTransactionWalletDeltas,
} from './calculations';
import { convertCurrency, roundCurrency, toMinor } from './currency';

export interface TransactionUpdateComputation {
  mergedTx: Transaction;
  oldAmount: number;
  newAmount: number;
  /**
   * Signed difference in transaction currency: newAmount - oldAmount
   */
  amountDiff: number;
  /**
   * Net balance delta per walletId (already converted into each wallet's currency)
   */
  walletDeltasInWalletCurrency: Map<string, number>;
  updatedWallets: Wallet[];
}

/**
 * Merges partial updates onto an existing transaction while keeping `amountMinor`,
 * transfer fields, and currency-bound `exchangeRate` consistent.
 */
export function buildUpdatedTransaction(
  oldTx: Transaction,
  updates: Partial<Transaction>,
  wallets: Wallet[],
  customRates?: Record<string, number>,
  nowMs: number = Date.now()
): Transaction {
  const nextType = updates.type ?? oldTx.type;
  const nextCurrency = updates.currency ?? oldTx.currency;
  const nextAmount =
    updates.amount !== undefined
      ? updates.amount
      : getEffectiveTransactionAmount(oldTx);

  const currencyChanged = Boolean(updates.currency && updates.currency !== oldTx.currency);

  const hasExplicitNewMinor =
    updates.amountMinor !== undefined &&
    !(updates.amount !== undefined && updates.amountMinor === oldTx.amountMinor);

  const shouldSyncMinor =
    hasExplicitNewMinor ||
    oldTx.amountMinor !== undefined ||
    updates.amountMinor !== undefined;

  const nextAmountMinor = hasExplicitNewMinor
    ? updates.amountMinor
    : shouldSyncMinor
    ? toMinor(nextAmount, nextCurrency)
    : undefined;

  const nextWalletId = updates.walletId ?? oldTx.walletId;
  const nextToWalletId =
    nextType === 'transfer' ? updates.toWalletId ?? oldTx.toWalletId : undefined;

  let nextConvertedAmount =
    nextType === 'transfer'
      ? updates.convertedAmount ?? oldTx.convertedAmount
      : undefined;

  if (
    nextType === 'transfer' &&
    nextToWalletId &&
    updates.convertedAmount === undefined &&
    (updates.amount !== undefined ||
      currencyChanged ||
      updates.toWalletId !== undefined ||
      updates.type !== undefined)
  ) {
    const destWallet = wallets.find((w) => w.id === nextToWalletId);
    nextConvertedAmount = destWallet
      ? convertCurrency(nextAmount, nextCurrency, destWallet.currency, customRates)
      : nextAmount;
  }

  return {
    ...oldTx,
    ...updates,
    type: nextType,
    amount: nextAmount,
    currency: nextCurrency,
    walletId: nextWalletId,
    toWalletId: nextToWalletId,
    convertedAmount: nextConvertedAmount,
    transferFee:
      nextType === 'transfer'
        ? updates.transferFee !== undefined
          ? updates.transferFee
          : oldTx.transferFee
        : undefined,
    exchangeRate:
      currencyChanged && updates.exchangeRate === undefined
        ? undefined
        : updates.exchangeRate ?? oldTx.exchangeRate,
    ...(nextAmountMinor !== undefined ? { amountMinor: nextAmountMinor } : {}),
    updatedAt: nowMs,
  };
}

/**
 * Computes exact accounting wallet deltas for editing an existing transaction:
 * - Same wallet, same type (`expense` | `income`), same currency, both affecting accounting:
 *   uses explicit `diff = newAmount - oldAmount` (`-diff` for expense, `+diff` for income).
 * - Wallet change (`oldTx.walletId !== newTx.walletId`), type change, currency change,
 *   transfer edits, or accounting-flag change:
 *   reverses the full old impact from the old wallet(s) and applies the full new impact
 *   to the new wallet(s).
 */
export function computeTransactionUpdate(
  oldTx: Transaction,
  updates: Partial<Transaction>,
  wallets: Wallet[],
  customRates?: Record<string, number>,
  nowMs: number = Date.now()
): TransactionUpdateComputation {
  const mergedTx = buildUpdatedTransaction(oldTx, updates, wallets, customRates, nowMs);

  const oldAmount = getEffectiveTransactionAmount(oldTx);
  const newAmount = getEffectiveTransactionAmount(mergedTx);
  const amountDiff = newAmount - oldAmount;

  const walletDeltasInWalletCurrency = new Map<string, number>();
  const addWalletDelta = (walletId: string | undefined, deltaInWalletCurrency: number) => {
    if (!walletId || deltaInWalletCurrency === 0) return;
    walletDeltasInWalletCurrency.set(
      walletId,
      (walletDeltasInWalletCurrency.get(walletId) || 0) + deltaInWalletCurrency
    );
  };

  const oldAffects = doesTransactionAffectAccounting(oldTx);
  const newAffects = doesTransactionAffectAccounting(mergedTx);

  const isSimpleSameWalletAmountEdit =
    oldAffects &&
    newAffects &&
    oldTx.walletId === mergedTx.walletId &&
    oldTx.type === mergedTx.type &&
    oldTx.currency === mergedTx.currency &&
    (oldTx.type === 'expense' || oldTx.type === 'income');

  if (isSimpleSameWalletAmountEdit) {
    // Expense: +diff means more spent -> deduct diff (-diff); -diff means less spent -> refund |diff| (-diff)
    // Income: +diff means more earned -> add diff (+diff); -diff means less earned -> deduct |diff| (+diff)
    const txDelta = mergedTx.type === 'expense' ? -amountDiff : amountDiff;
    if (txDelta !== 0) {
      const targetWallet = wallets.find((w) => w.id === mergedTx.walletId);
      if (targetWallet) {
        const deltaInWallet = convertCurrency(
          txDelta,
          mergedTx.currency,
          targetWallet.currency,
          customRates
        );
        addWalletDelta(targetWallet.id, deltaInWallet);
      }
    }
  } else {
    // General path: reverse old transaction impact on old wallet(s), apply new impact on new wallet(s)
    const { sourceDelta: oldSrcDelta, destDelta: oldDestDelta } =
      getTransactionWalletDeltas(oldTx);
    if (oldSrcDelta !== 0) {
      const oldWallet = wallets.find((w) => w.id === oldTx.walletId);
      if (oldWallet) {
        const reverseInOldWallet = convertCurrency(
          -oldSrcDelta,
          oldTx.currency,
          oldWallet.currency,
          customRates
        );
        addWalletDelta(oldWallet.id, reverseInOldWallet);
      }
    }
    if (oldTx.toWalletId && oldDestDelta !== 0) {
      addWalletDelta(oldTx.toWalletId, -oldDestDelta);
    }

    const { sourceDelta: newSrcDelta, destDelta: newDestDelta } =
      getTransactionWalletDeltas(mergedTx);
    if (newSrcDelta !== 0) {
      const newWallet = wallets.find((w) => w.id === mergedTx.walletId);
      if (newWallet) {
        const applyInNewWallet = convertCurrency(
          newSrcDelta,
          mergedTx.currency,
          newWallet.currency,
          customRates
        );
        addWalletDelta(newWallet.id, applyInNewWallet);
      }
    }
    if (mergedTx.toWalletId && newDestDelta !== 0) {
      addWalletDelta(mergedTx.toWalletId, newDestDelta);
    }
  }

  const updatedWallets = wallets.map((w) => {
    const delta = walletDeltasInWalletCurrency.get(w.id);
    if (!delta) return w;
    const nextBalance = roundCurrency(w.balance + delta, w.currency);
    return {
      ...w,
      balance: nextBalance,
      ...(typeof w.balanceMinor === 'number'
        ? { balanceMinor: toMinor(nextBalance, w.currency) }
        : {}),
    };
  });

  return {
    mergedTx,
    oldAmount,
    newAmount,
    amountDiff,
    walletDeltasInWalletCurrency,
    updatedWallets,
  };
}
