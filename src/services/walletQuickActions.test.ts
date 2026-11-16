import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from '../types/index.js';
import {
  buildWalletActionPreset,
  canToggleWalletArchive,
  canTransferFromWallet,
  findTransferDestinationWallet,
} from './walletQuickActions.js';

function makeWallet(
  id: string,
  name: string,
  currency = 'EGP',
  isArchived = false
): Wallet {
  return {
    id,
    name,
    currency,
    initialBalance: 0,
    balance: 1000,
    color: '#3A605B',
    icon: 'Wallet',
    isArchived,
  };
}

describe('walletQuickActions helpers', () => {
  it('builds deposit and withdraw presets scoped to wallet id and currency', () => {
    const usdWallet = makeWallet('w-usd', 'USD Account', 'USD');
    const egpWallet = makeWallet('w-egp', 'Cash', 'EGP');

    assert.deepEqual(buildWalletActionPreset(usdWallet, 'deposit', [usdWallet, egpWallet]), {
      type: 'income',
      walletId: 'w-usd',
      currency: 'USD',
    });

    assert.deepEqual(buildWalletActionPreset(usdWallet, 'withdraw', [usdWallet, egpWallet]), {
      type: 'expense',
      walletId: 'w-usd',
      currency: 'USD',
    });
  });

  it('builds transfer preset choosing active destination wallet and rejects single-wallet transfer', () => {
    const w1 = makeWallet('w1', 'Primary', 'EGP');
    const w2Archived = makeWallet('w2', 'Old Savings', 'EGP', true);
    const w3Active = makeWallet('w3', 'Bank', 'USD', false);

    assert.equal(canTransferFromWallet(w1, [w1]), false);
    assert.equal(buildWalletActionPreset(w1, 'transfer', [w1]), null);

    assert.equal(canTransferFromWallet(w1, [w1, w2Archived, w3Active]), true);
    assert.equal(findTransferDestinationWallet(w1, [w1, w2Archived, w3Active])?.id, 'w3');

    assert.deepEqual(buildWalletActionPreset(w1, 'transfer', [w1, w2Archived, w3Active]), {
      type: 'transfer',
      walletId: 'w1',
      toWalletId: 'w3',
      currency: 'EGP',
    });

    // Falls back to archived wallet if it is the only other wallet
    assert.equal(findTransferDestinationWallet(w1, [w1, w2Archived])?.id, 'w2');
  });

  it('prevents pausing the last active wallet while always allowing resume', () => {
    const onlyWallet = makeWallet('w1', 'Main', 'EGP', false);
    const secondActive = makeWallet('w2', 'Bank', 'EGP', false);
    const pausedWallet = makeWallet('w3', 'Paused', 'EGP', true);

    const singleResult = canToggleWalletArchive(onlyWallet, [onlyWallet]);
    assert.equal(singleResult.allowed, false);
    assert.equal(singleResult.nextArchived, true);
    assert.ok(singleResult.reasonAr && singleResult.reasonEn);

    const multiResult = canToggleWalletArchive(onlyWallet, [onlyWallet, secondActive]);
    assert.equal(multiResult.allowed, true);
    assert.equal(multiResult.nextArchived, true);

    const resumeResult = canToggleWalletArchive(pausedWallet, [pausedWallet]);
    assert.equal(resumeResult.allowed, true);
    assert.equal(resumeResult.nextArchived, false);
  });
});
