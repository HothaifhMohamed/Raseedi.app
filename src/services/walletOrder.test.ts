import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from '../types/index.js';
import {
  assignSequentialWalletOrder,
  getNextWalletOrder,
  reorderWalletsBySwap,
  sortWalletsByOrder,
} from './walletOrder.js';

function makeWallet(id: string, name: string, order?: number): Wallet {
  return {
    id,
    name,
    currency: 'EGP',
    initialBalance: 0,
    balance: 0,
    color: '#3A605B',
    icon: 'Wallet',
    isArchived: false,
    order,
  };
}

describe('walletOrder helpers', () => {
  it('sorts wallets ascending by order without mutating input array', () => {
    const input = [
      makeWallet('w3', 'Third', 3),
      makeWallet('w1', 'First', 1),
      makeWallet('w0', 'Unordered'),
      makeWallet('w2', 'Second', 2),
    ];
    const snapshot = [...input];

    const sorted = sortWalletsByOrder(input);
    assert.deepEqual(
      sorted.map((w) => w.id),
      ['w0', 'w1', 'w2', 'w3']
    );
    assert.deepEqual(
      input.map((w) => w.id),
      snapshot.map((w) => w.id)
    );
  });

  it('swaps wallets up and down and assigns sequential order indexes', () => {
    const wallets = [
      makeWallet('w1', 'Cash', 5),
      makeWallet('w2', 'Bank', 10),
      makeWallet('w3', 'Savings', 20),
    ];

    const movedUp = reorderWalletsBySwap(wallets, 2, 'up');
    assert.deepEqual(
      movedUp.map((w) => ({ id: w.id, order: w.order })),
      [
        { id: 'w1', order: 0 },
        { id: 'w3', order: 1 },
        { id: 'w2', order: 2 },
      ]
    );

    const movedDown = reorderWalletsBySwap(movedUp, 0, 'down');
    assert.deepEqual(
      movedDown.map((w) => ({ id: w.id, order: w.order })),
      [
        { id: 'w3', order: 0 },
        { id: 'w1', order: 1 },
        { id: 'w2', order: 2 },
      ]
    );
  });

  it('safely handles boundary moves and assigns sequential order cleanly', () => {
    const wallets = [makeWallet('w1', 'Cash', 0), makeWallet('w2', 'Bank', 1)];

    // Moving first up or last down leaves order valid and unchanged
    const topBoundary = reorderWalletsBySwap(wallets, 0, 'up');
    assert.deepEqual(
      topBoundary.map((w) => ({ id: w.id, order: w.order })),
      [
        { id: 'w1', order: 0 },
        { id: 'w2', order: 1 },
      ]
    );

    const bottomBoundary = reorderWalletsBySwap(wallets, 1, 'down');
    assert.deepEqual(
      bottomBoundary.map((w) => ({ id: w.id, order: w.order })),
      [
        { id: 'w1', order: 0 },
        { id: 'w2', order: 1 },
      ]
    );

    const reindexed = assignSequentialWalletOrder([makeWallet('a', 'A', 9), makeWallet('b', 'B', 2)]);
    assert.deepEqual(
      reindexed.map((w) => w.order),
      [0, 1]
    );

    assert.equal(getNextWalletOrder([]), 0);
    assert.equal(getNextWalletOrder([makeWallet('a', 'A', 0), makeWallet('b', 'B', 2)]), 3);
  });
});
