import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ORG_HOME_SECTIONS,
  DEFAULT_PERSONAL_HOME_SECTIONS,
  evaluateGetStartedCards,
  moveHomeSection,
  resolveHomeSectionOrder,
} from './homeSections';
import { Wallet } from '../types';

test('resolveHomeSectionOrder preserves valid saved order, filters disallowed sections, and appends missing ones', () => {
  const personalOrder = resolveHomeSectionOrder(
    ['net_worth', 'hero', 'hero', 'invalid_section' as never],
    false
  );
  assert.equal(personalOrder[0], 'net_worth');
  assert.equal(personalOrder[1], 'hero');
  assert.equal(personalOrder.length, DEFAULT_PERSONAL_HOME_SECTIONS.length);

  // Org workspace strips personal-only sections like net_worth & get_started
  const orgOrder = resolveHomeSectionOrder(['net_worth', 'cashflow_metrics', 'hero'], true);
  assert.equal(orgOrder[0], 'cashflow_metrics');
  assert.equal(orgOrder[1], 'hero');
  assert.ok(!orgOrder.includes('net_worth'));
  assert.ok(!orgOrder.includes('get_started'));
  assert.equal(orgOrder.length, DEFAULT_ORG_HOME_SECTIONS.length);
});

test('moveHomeSection reorders deterministically and respects boundaries', () => {
  const start = [...DEFAULT_PERSONAL_HOME_SECTIONS];
  const movedUp = moveHomeSection(start, 'quick_actions', 'up');
  assert.equal(movedUp[0], 'quick_actions');
  assert.equal(movedUp[1], 'hero');

  // Boundary check: moving first item up is a no-op
  const unchanged = moveHomeSection(movedUp, 'quick_actions', 'up');
  assert.deepEqual(unchanged, movedUp);
});

test('evaluateGetStartedCards hides completed and dismissed tasks', () => {
  const emptyWallet: Wallet = {
    id: 'w-main',
    name: 'Cash',
    currency: 'EGP',
    initialBalance: 0,
    balance: 0,
    color: '#1E6F73',
    icon: 'Wallet',
    isArchived: false,
  };

  const initialCards = evaluateGetStartedCards({
    wallets: [emptyWallet],
    transactions: [],
    budgets: [],
    goals: [],
    dismissedIds: [],
  });
  assert.equal(initialCards.length, 3);
  assert.deepEqual(
    initialCards.map((c) => c.id),
    ['add_wallet_or_asset', 'record_first_income', 'set_monthly_budget']
  );

  const afterDismiss = evaluateGetStartedCards({
    wallets: [emptyWallet],
    transactions: [],
    budgets: [],
    goals: [],
    dismissedIds: ['add_wallet_or_asset', 'record_first_income'],
  });
  assert.deepEqual(
    afterDismiss.map((c) => c.id),
    ['set_monthly_budget', 'add_savings_goal']
  );
});
