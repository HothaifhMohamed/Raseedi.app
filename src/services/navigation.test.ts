import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  areRoutesEqual,
  buildHashRoute,
  buildUrlWithHash,
  DEFAULT_ROUTE_STATE,
  normalizeRouteState,
  parseHashRoute,
  parseStoredRoute,
  resolveInitialRoute,
  serializeRouteForStorage,
} from './navigation.js';

describe('navigation routing helpers', () => {
  it('builds canonical hash routes for tabs, home subtabs, and wallet details', () => {
    assert.equal(buildHashRoute({ activeNav: 'home', homeTab: 'transactions', activeWalletId: null }), '#/home');
    assert.equal(buildHashRoute({ activeNav: 'home', homeTab: 'statistics', activeWalletId: null }), '#/home/statistics');
    assert.equal(buildHashRoute({ activeNav: 'home', homeTab: 'templates', activeWalletId: null }), '#/home/templates');
    assert.equal(buildHashRoute({ activeNav: 'budget', homeTab: 'statistics', activeWalletId: null }), '#/budget');
    assert.equal(buildHashRoute({ activeNav: 'wallets', homeTab: 'transactions', activeWalletId: null }), '#/wallets');
    assert.equal(
      buildHashRoute({ activeNav: 'wallets', homeTab: 'transactions', activeWalletId: 'wallet-123' }),
      '#/wallet/wallet-123'
    );
    assert.equal(
      buildHashRoute({ activeNav: 'wallets', homeTab: 'transactions', activeWalletId: 'محفظة ١' }),
      '#/wallet/%D9%85%D8%AD%D9%81%D8%B8%D8%A9%20%D9%A1'
    );
    assert.equal(buildHashRoute({ activeNav: 'more', homeTab: 'transactions', activeWalletId: null }), '#/more');
  });

  it('parses valid hash routes and returns null for unknown/empty hashes', () => {
    assert.deepEqual(parseHashRoute('#/home'), {
      activeNav: 'home',
      homeTab: 'transactions',
      activeWalletId: null,
    });
    assert.deepEqual(parseHashRoute('#/home/statistics/'), {
      activeNav: 'home',
      homeTab: 'statistics',
      activeWalletId: null,
    });
    assert.deepEqual(parseHashRoute('#/home/templates'), {
      activeNav: 'home',
      homeTab: 'templates',
      activeWalletId: null,
    });
    assert.deepEqual(parseHashRoute('#/budget'), {
      activeNav: 'budget',
      activeWalletId: null,
    });
    assert.deepEqual(parseHashRoute('#/wallets'), {
      activeNav: 'wallets',
      activeWalletId: null,
    });
    assert.deepEqual(parseHashRoute('#/wallet/%D9%85%D8%AD%D9%81%D8%B8%D8%A9%20%D9%A1'), {
      activeNav: 'wallets',
      activeWalletId: 'محفظة ١',
    });
    assert.deepEqual(parseHashRoute('#/wallet'), {
      activeNav: 'wallets',
      activeWalletId: null,
    });
    assert.deepEqual(parseHashRoute('#/more'), {
      activeNav: 'more',
      activeWalletId: null,
    });
    assert.equal(parseHashRoute(''), null);
    assert.equal(parseHashRoute('#/'), null);
    assert.equal(parseHashRoute('#/unknown-route'), null);
  });

  it('normalizes routes by clearing activeWalletId outside wallets tab', () => {
    assert.deepEqual(
      normalizeRouteState({ activeNav: 'home', homeTab: 'transactions', activeWalletId: 'w-1' }),
      { activeNav: 'home', homeTab: 'transactions', activeWalletId: null }
    );
    assert.deepEqual(
      normalizeRouteState({ activeNav: 'wallets', homeTab: 'transactions', activeWalletId: '  ' }),
      { activeNav: 'wallets', homeTab: 'transactions', activeWalletId: null }
    );
  });

  it('resolves initial route preferring explicit URL hash over sessionStorage fallback', () => {
    const storedWallets = serializeRouteForStorage({
      activeNav: 'wallets',
      homeTab: 'statistics',
      activeWalletId: 'w-99',
    });

    // Explicit URL hash wins, while keeping stored homeTab for non-home views
    assert.deepEqual(resolveInitialRoute('#/budget', storedWallets), {
      activeNav: 'budget',
      homeTab: 'statistics',
      activeWalletId: null,
    });

    // Explicit wallet hash restores wallet detail directly
    assert.deepEqual(resolveInitialRoute('#/wallet/w-42', null), {
      activeNav: 'wallets',
      homeTab: 'transactions',
      activeWalletId: 'w-42',
    });

    // Empty or invalid hash falls back to sessionStorage
    assert.deepEqual(resolveInitialRoute('', storedWallets), {
      activeNav: 'wallets',
      homeTab: 'statistics',
      activeWalletId: 'w-99',
    });
    assert.deepEqual(resolveInitialRoute('#/broken', storedWallets), {
      activeNav: 'wallets',
      homeTab: 'statistics',
      activeWalletId: 'w-99',
    });

    // Missing both defaults cleanly to home
    assert.deepEqual(resolveInitialRoute('', null), DEFAULT_ROUTE_STATE);
    assert.equal(parseStoredRoute('not-json'), null);
  });

  it('preserves query parameters when building history URLs and compares routes accurately', () => {
    const url = buildUrlWithHash('/index.html', '?join=INV123&autostart=1', {
      activeNav: 'wallets',
      homeTab: 'transactions',
      activeWalletId: 'w-7',
    });
    assert.equal(url, '/index.html?join=INV123&autostart=1#/wallet/w-7');

    assert.equal(
      areRoutesEqual(
        { activeNav: 'budget', homeTab: 'transactions', activeWalletId: null },
        { activeNav: 'budget', homeTab: 'statistics', activeWalletId: null }
      ),
      true
    );
    assert.equal(
      areRoutesEqual(
        { activeNav: 'wallets', homeTab: 'transactions', activeWalletId: null },
        { activeNav: 'wallets', homeTab: 'transactions', activeWalletId: 'w-1' }
      ),
      false
    );
  });
});
