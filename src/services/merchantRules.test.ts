import test from 'node:test';
import assert from 'node:assert/strict';
import { matchMerchantRule, sanitizeMerchantRules } from './merchantRules';
import { MerchantRule } from '../types';

const sampleRules: MerchantRule[] = [
  {
    id: 'r1',
    keyword: 'أوبر',
    matchType: 'contains',
    type: 'expense',
    categoryId: 'cat-transport',
    walletId: 'w-card',
    costCenterId: 'cc-ops',
    isEnabled: true,
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: 'r2',
    keyword: 'أوبر إيتس',
    matchType: 'contains',
    type: 'expense',
    categoryId: 'cat-restaurants',
    isEnabled: true,
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: 'r3',
    keyword: 'disabled',
    matchType: 'contains',
    type: 'both',
    categoryId: 'cat-other',
    isEnabled: false,
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: 'r4',
    keyword: 'amazon',
    matchType: 'exact',
    type: 'expense',
    categoryId: 'cat-shopping',
    isEnabled: true,
    createdAt: 1000,
    updatedAt: 1000,
  },
];

test('matchMerchantRule normalizes Arabic variants and picks most specific rule', () => {
  const res1 = matchMerchantRule('مشوار اوبر للمطار', sampleRules, 'expense');
  assert.equal(res1?.rule.id, 'r1');
  assert.equal(res1?.categoryId, 'cat-transport');
  assert.equal(res1?.walletId, 'w-card');
  assert.equal(res1?.costCenterId, 'cc-ops');

  // Longer keyword "أوبر إيتس" beats shorter "أوبر"
  const res2 = matchMerchantRule('طلب غداء من اوبر ايتس', sampleRules, 'expense');
  assert.equal(res2?.rule.id, 'r2');
  assert.equal(res2?.categoryId, 'cat-restaurants');
});

test('matchMerchantRule respects disabled state, transaction type, and exact matchType', () => {
  assert.equal(matchMerchantRule('disabled merchant', sampleRules, 'expense'), null);
  assert.equal(matchMerchantRule('أوبر', sampleRules, 'income'), null);
  assert.equal(matchMerchantRule('أوبر', sampleRules, 'transfer'), null);

  assert.equal(matchMerchantRule('Amazon', sampleRules, 'expense')?.categoryId, 'cat-shopping');
  assert.equal(matchMerchantRule('Amazon Prime', sampleRules, 'expense'), null);
});

test('sanitizeMerchantRules filters invalid entries and deduplicates IDs safely', () => {
  const cleaned = sanitizeMerchantRules([
    { id: 'a', keyword: '  Carrefour  ', categoryId: 'cat-groceries', isEnabled: true },
    { id: 'a', keyword: 'Duplicate ID' },
    { id: 'b', keyword: '   ' },
    null,
  ]);

  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].id, 'a');
  assert.equal(cleaned[0].keyword, 'Carrefour');
  assert.equal(cleaned[0].matchType, 'contains');
  assert.equal(cleaned[0].type, 'both');
});
