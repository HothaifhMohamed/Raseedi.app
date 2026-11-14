import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArabicPersianNumerals,
  normalizeMixedNumericText,
  parseLocalizedNumber,
  sanitizeDecimalInput,
} from './numbers';
import { evaluateCalculatorExpression } from './calculations';
import { parseDialectQuickEntry } from './dialectParser';
import { DEFAULT_CATEGORIES } from './db';
import {
  convertCurrency,
  getCurrency,
  getEffectiveCurrencyRate,
  setLiveExchangeRatesRuntime,
} from './currency';

test('normalizeArabicPersianNumerals converts Arabic-Indic, Persian digits, and separators', () => {
  assert.equal(normalizeArabicPersianNumerals('٣٣'), '33');
  assert.equal(normalizeArabicPersianNumerals('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(normalizeArabicPersianNumerals('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(normalizeArabicPersianNumerals('٣٣،٥'), '33.5');
  assert.equal(normalizeArabicPersianNumerals('۱۲۳٫۴۵'), '123.45');
  assert.equal(normalizeArabicPersianNumerals('١٬٥٠٠٫٧٥'), '1500.75');
});

test('normalizeMixedNumericText preserves prose commas while normalizing numeric decimals', () => {
  assert.equal(normalizeMixedNumericText('قهوة ٣٣'), 'قهوة 33');
  assert.equal(normalizeMixedNumericText('قهوة ٣٣،٥'), 'قهوة 33.5');
  assert.equal(normalizeMixedNumericText('غدا، قهوة ٥٠'), 'غدا، قهوة 50');
  assert.equal(normalizeMixedNumericText('بنزين ۲۰۰'), 'بنزين 200');
});

test('parseLocalizedNumber and sanitizeDecimalInput handle Arabic, Persian, and English numbers', () => {
  assert.equal(parseLocalizedNumber('٣٣'), 33);
  assert.equal(parseLocalizedNumber('٣٣،٥'), 33.5);
  assert.equal(parseLocalizedNumber('۱۲۳٫۴۵'), 123.45);
  assert.equal(parseLocalizedNumber('1,500.25'), 1500.25);
  assert.ok(Number.isNaN(parseLocalizedNumber('')));
  assert.ok(Number.isNaN(parseLocalizedNumber('.')));

  assert.equal(sanitizeDecimalInput('٣٣،٥٠abc'), '33.50');
  assert.equal(sanitizeDecimalInput('-٤٢٫٥', { allowNegative: true }), '-42.5');
});

test('evaluateCalculatorExpression evaluates Arabic and Persian numeral expressions', () => {
  const single = evaluateCalculatorExpression('٣٣');
  assert.equal(single.error, false);
  assert.equal(single.result, 33);

  const sum = evaluateCalculatorExpression('٣٣،٥ + ١٦٫٥');
  assert.equal(sum.error, false);
  assert.equal(sum.result, 50);

  const mult = evaluateCalculatorExpression('۲۵ × ۲');
  assert.equal(mult.error, false);
  assert.equal(mult.result, 50);
});

test('parseDialectQuickEntry parses Arabic and Persian digits cleanly', () => {
  const coffee = parseDialectQuickEntry('قهوة ٣٣،٥', DEFAULT_CATEGORIES);
  assert.ok(coffee);
  assert.equal(coffee.amount, 33.5);
  assert.equal(coffee.type, 'expense');

  const gas = parseDialectQuickEntry('بنزين ۲۰۰', DEFAULT_CATEGORIES);
  assert.ok(gas);
  assert.equal(gas.amount, 200);
  assert.equal(gas.type, 'expense');
});

test('currency rates prioritize custom manual overrides > live rates > updated static baseline', () => {
  try {
    setLiveExchangeRatesRuntime(null);
    assert.equal(getCurrency('EGP').rateToUSD, 49.35);
    assert.equal(getEffectiveCurrencyRate('SAR'), 3.75);
    assert.equal(getEffectiveCurrencyRate('EUR'), 0.93);

    setLiveExchangeRatesRuntime({ EGP: 50.1, EUR: 0.92 });
    assert.equal(getEffectiveCurrencyRate('EGP'), 50.1);
    assert.equal(getEffectiveCurrencyRate('EGP', { EGP: 51.0 }), 51.0);

    const converted = convertCurrency(100, 'USD', 'EGP', { EGP: 51.0 });
    assert.equal(converted, 5100);
  } finally {
    setLiveExchangeRatesRuntime(null);
  }
});
