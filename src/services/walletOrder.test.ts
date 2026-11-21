import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from '../types/index.js';
import {
  applyWalletOrderIds,
  areWalletOrderIdsEqual,
  assignSequentialWalletOrder,
  getNextWalletOrder,
  moveWalletById,
  moveWalletIdByIndex,
  moveWalletIdInOrder,
  reconcileDraftOrderIds,
  reorderWalletsBySwap,
  sortWalletsByOrder,
} from './walletOrder.js';

function makeWallet(id: string, name: string, order?: number, balance = 0): Wallet {
  return {
    id,
    name,
    currency: 'EGP',
    initialBalance: balance,
    balance,
    color: '#3A605B',
    icon: 'Wallet',
    isArchived: false,
    order,
  };
}

describe('walletOrder helpers', () => {
  it('sorts wallets ascending by order without mutating input array and preserves ties deterministically', () => {
    const input = [
      makeWallet('w3', 'Third', 3),
      makeWallet('w1', 'First', 1),
      makeWallet('w0a', 'Unordered A'),
      makeWallet('w0b', 'Unordered B', Number.NaN),
      makeWallet('w2', 'Second', 2),
    ];
    const snapshot = [...input];

    const sorted = sortWalletsByOrder(input);
    assert.deepEqual(
      sorted.map((w) => w.id),
      ['w0a', 'w0b', 'w1', 'w2', 'w3']
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

  it('handles rapid sequential moves by walletId without stale-index reverts', () => {
    const initial = ['w1', 'w2', 'w3', 'w4'];
    // Simulate rapid double-tap on w4 up arrow before React re-renders
    const step1 = moveWalletById(initial, 'w4', 'up');
    const step2 = moveWalletById(step1, 'w4', 'up');
    const step3 = moveWalletById(step2, 'w4', 'up');
    const step4 = moveWalletById(step3, 'w4', 'up'); // boundary no-op

    assert.deepEqual(step1, ['w1', 'w2', 'w4', 'w3']);
    assert.deepEqual(step2, ['w1', 'w4', 'w2', 'w3']);
    assert.deepEqual(step3, ['w4', 'w1', 'w2', 'w3']);
    assert.equal(step4, step3);

    assert.equal(moveWalletIdInOrder(initial, 0, 'up'), initial);
    assert.equal(moveWalletIdInOrder(initial, 3, 'down'), initial);
  });

  it('moves wallet IDs by arbitrary index for pointer/touch drag-and-drop', () => {
    const initial = ['w1', 'w2', 'w3', 'w4'];
    const movedTopToBottom = moveWalletIdByIndex(initial, 0, 3);
    assert.deepEqual(movedTopToBottom, ['w2', 'w3', 'w4', 'w1']);

    const movedBottomToMiddle = moveWalletIdByIndex(movedTopToBottom, 3, 1);
    assert.deepEqual(movedBottomToMiddle, ['w2', 'w1', 'w3', 'w4']);

    assert.equal(moveWalletIdByIndex(initial, 1, 1), initial);
    assert.equal(moveWalletIdByIndex(initial, -1, 2), initial);
  });

  it('keeps live draft order locked even when external wallets array reference changes or re-orders', () => {
    const draftIds = ['w3', 'w1', 'w2'];

    // External Firestore/context update arrives with original order numbers and updated balance
    const incomingExternalWallets = [
      makeWallet('w1', 'Cash', 0, 1500),
      makeWallet('w2', 'Bank', 1, 2500),
      makeWallet('w3', 'Savings', 2, 5000),
    ];

    const projected = applyWalletOrderIds(incomingExternalWallets, draftIds, 123456);
    assert.deepEqual(
      projected.map((w) => ({ id: w.id, order: w.order, balance: w.balance, updatedAt: w.updatedAt })),
      [
        { id: 'w3', order: 0, balance: 5000, updatedAt: 123456 },
        { id: 'w1', order: 1, balance: 1500, updatedAt: 123456 },
        { id: 'w2', order: 2, balance: 2500, updatedAt: 123456 },
      ]
    );
  });

  it('reconciles added and removed wallets without disturbing existing draft order', () => {
    const draftIds = ['w3', 'w1', 'w_deleted', 'w2', 'w1'];
    const latestWallets = [
      makeWallet('w1', 'Cash', 0),
      makeWallet('w2', 'Bank', 1),
      makeWallet('w3', 'Savings', 2),
      makeWallet('w4', 'New Wallet', 3),
    ];

    const reconciled = reconcileDraftOrderIds(draftIds, latestWallets);
    assert.deepEqual(reconciled, ['w3', 'w1', 'w2', 'w4']);

    const ordered = applyWalletOrderIds(latestWallets, draftIds);
    assert.equal(areWalletOrderIdsEqual(ordered, ['w3', 'w1', 'w2', 'w4']), true);
    assert.equal(areWalletOrderIdsEqual(ordered, ['w1', 'w2', 'w3', 'w4']), false);
  });

  it('safely handles boundary moves and assigns sequential order cleanly', () => {
    const wallets = [makeWallet('w1', 'Cash', 0), makeWallet('w2', 'Bank', 1)];

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
    assert.equal(getNextWalletOrder([makeWallet('a', 'A', Number.NaN)]), 1);
  });
});
