import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSafeCloudLastSyncedPatch,
  buildSafeUserCurrencyRatesPatch,
  PROTECTED_USER_PROFILE_FIELDS,
  sanitizeCurrencyRatesMap,
} from './currencySync';

test('sanitizeCurrencyRatesMap keeps valid uppercase positive currency rates and drops invalid values', () => {
  const cleaned = sanitizeCurrencyRatesMap({
    egp: 49.5,
    USD: 1,
    BAD: -5,
    ZERO: 0,
    NAN: Number.NaN,
    'bad code!': 10,
    sar: 3.75,
  });

  assert.deepEqual(cleaned, {
    EGP: 49.5,
    USD: 1,
    SAR: 3.75,
  });
});

test('buildSafeUserCurrencyRatesPatch scopes writes to currencyRates & settings and never includes protected fields', () => {
  const patch = buildSafeUserCurrencyRatesPatch({
    rates: { USD: 1, EGP: 49.4, SAR: 3.75 },
    fetchedAtMs: 1763280000123,
    ratesLastUpdated: '١٦ نوفمبر ٢٠٢٦',
    useUpdatedExchangeRates: true,
    customExchangeRates: { EGP: 50.2 },
  });

  assert.equal(patch.currencyRates?.base, 'USD');
  assert.equal(patch.currencyRates?.fetchedAtMs, 1763280000123);
  assert.deepEqual(patch.currencyRates?.rates, { USD: 1, EGP: 49.4, SAR: 3.75 });
  assert.deepEqual(patch.settings, {
    useUpdatedExchangeRates: true,
    ratesLastUpdated: '١٦ نوفمبر ٢٠٢٦',
    ratesUpdatedAtMs: 1763280000123,
    customExchangeRates: { EGP: 50.2 },
  });

  for (const key of Object.keys(patch)) {
    assert.equal(
      PROTECTED_USER_PROFILE_FIELDS.has(key),
      false,
      `Protected field "${key}" must never be in user currency patch`
    );
  }
  for (const key of Object.keys(patch.settings)) {
    assert.equal(
      PROTECTED_USER_PROFILE_FIELDS.has(key),
      false,
      `Protected field "${key}" must never be inside settings patch`
    );
  }
});

test('buildSafeUserCurrencyRatesPatch omits currencyRates when no valid live rates are passed', () => {
  const patch = buildSafeUserCurrencyRatesPatch({
    rates: null,
    useUpdatedExchangeRates: false,
    fetchedAtMs: 1763280000000,
  });

  assert.equal(patch.currencyRates, undefined);
  assert.equal(patch.settings.useUpdatedExchangeRates, false);
});

test('buildSafeCloudLastSyncedPatch emits only lastSyncedAt integer', () => {
  const patch = buildSafeCloudLastSyncedPatch(1763280000999.7);
  assert.deepEqual(patch, { lastSyncedAt: 1763280000999 });
  assert.equal(Object.keys(patch).length, 1);
});
