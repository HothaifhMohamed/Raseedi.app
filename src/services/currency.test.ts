import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertCurrency,
  fetchLiveExchangeRatesDetailed,
  getCachedExchangeRatesMeta,
  getEffectiveCurrencyRate,
  getLiveExchangeRatesRuntime,
  LIVE_RATES_STORAGE_KEY,
  parseExchangeRateApiPayload,
  parseFawazCurrencyApiPayload,
  parseFrankfurterApiPayload,
  roundCurrency,
  saveLiveExchangeRatesCache,
  setLiveExchangeRatesRuntime,
} from './currency';

function installMockLocalStorage() {
  const store = new Map<string, string>();
  const mockWindow = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
  };
  (globalThis as unknown as { window?: typeof mockWindow }).window = mockWindow;
  return store;
}

test('parses primary ExchangeRate-API payload accurately for supported currencies', () => {
  const parsed = parseExchangeRateApiPayload({
    result: 'success',
    time_last_update_utc: 'Tue, 17 Nov 2026 00:00:00 +0000',
    rates: {
      USD: 1,
      EGP: 49.85,
      SAR: 3.75,
      AED: 3.6725,
      KWD: 0.307,
      QAR: 3.64,
      BHD: 0.376,
      OMR: 0.3845,
      JOD: 0.709,
      EUR: 0.91,
      GBP: 0.76,
      FAKECRYPTO: 999,
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.rates.EGP, 49.85);
  assert.equal(parsed.rates.SAR, 3.75);
  assert.equal(parsed.rates.KWD, 0.307);
  assert.equal(parsed.rates.FAKECRYPTO, undefined);
  assert.equal(parsed.apiLastUpdateUtc, 'Tue, 17 Nov 2026 00:00:00 +0000');
});

test('parses fawazahmed0 Currency-API lowercase payload and normalizes currency codes', () => {
  const parsed = parseFawazCurrencyApiPayload({
    date: '2026-11-17',
    usd: {
      usd: 1,
      egp: 49.9,
      sar: 3.75,
      aed: 3.6725,
      kwd: 0.308,
      qar: 3.64,
      bhd: 0.376,
      omr: 0.3845,
      jod: 0.709,
      eur: 0.915,
      gbp: 0.765,
      btc: 0.000011,
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.rates.EGP, 49.9);
  assert.equal(parsed.rates.KWD, 0.308);
  assert.equal(parsed.rates.BTC, undefined);
  assert.equal(parsed.apiLastUpdateUtc, '2026-11-17');
});

test('parses Frankfurter ECB payload while preserving non-ECB MENA currencies from base cache', () => {
  const parsed = parseFrankfurterApiPayload(
    {
      base: 'USD',
      date: '2026-11-17',
      rates: {
        EUR: 0.91,
        GBP: 0.758,
        JPY: 159.3,
        CAD: 1.429,
        TRY: 34.9,
      },
    },
    { EGP: 49.7, SAR: 3.75, AED: 3.6725 }
  );

  assert.ok(parsed);
  assert.equal(parsed.rates.EUR, 0.91);
  assert.equal(parsed.rates.EGP, 49.7);
  assert.equal(parsed.rates.SAR, 3.75);
  assert.equal(parsed.rates.USD, 1);
});

test('fetchLiveExchangeRatesDetailed falls back cleanly to secondary global API when primary fails', async () => {
  installMockLocalStorage();
  setLiveExchangeRatesRuntime(null);

  const calls: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('open.er-api.com')) {
      return new Response('Service Unavailable', { status: 503 });
    }
    return new Response(
      JSON.stringify({
        date: '2026-11-17',
        usd: {
          usd: 1,
          egp: 50.1,
          sar: 3.75,
          aed: 3.6725,
          kwd: 0.307,
          qar: 3.64,
          bhd: 0.376,
          omr: 0.3845,
          jod: 0.709,
          eur: 0.92,
          gbp: 0.77,
        },
      }),
      { status: 200 }
    );
  };

  const result = await fetchLiveExchangeRatesDetailed(true, {
    fetchFn: mockFetch,
    isOnline: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'updated');
  assert.equal(result.provider, 'currency-api');
  assert.equal(calls.length, 2);
  assert.equal(getEffectiveCurrencyRate('EGP'), 50.1);
  assert.equal(getCachedExchangeRatesMeta()?.rates.EGP, 50.1);
});

test('fetchLiveExchangeRatesDetailed reports fallback_cached without crashing when offline or all APIs fail', async () => {
  const store = installMockLocalStorage();
  saveLiveExchangeRatesCache({
    rates: { USD: 1, EGP: 49.6, SAR: 3.75 },
    fetchedAtMs: 1700000000000,
    provider: 'exchangerate-api',
    source: 'live',
  });
  setLiveExchangeRatesRuntime(null);

  const failingFetch: typeof fetch = async () => {
    throw new Error('Network unreachable');
  };

  const result = await fetchLiveExchangeRatesDetailed(true, {
    fetchFn: failingFetch,
    isOnline: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'fallback_cached');
  assert.ok(result.data);
  assert.equal(result.data.rates.EGP, 49.6);
  assert.equal(getLiveExchangeRatesRuntime()?.EGP, 49.6);
  assert.ok(store.has(LIVE_RATES_STORAGE_KEY));
});

test('currency normalization, invalid custom rate guard, and symmetric negative roundCurrency', () => {
  setLiveExchangeRatesRuntime(null);

  // Lowercase & padded currency codes normalize seamlessly
  assert.equal(convertCurrency(100, ' egp ', 'EGP'), 100);
  assert.equal(convertCurrency(10, 'usd', 'egp', { USD: 1, EGP: 50 }), 500);

  // Non-positive or NaN custom rates fall back safely instead of producing NaN/Infinity
  const safeRate = getEffectiveCurrencyRate('EGP', { EGP: 0 });
  assert.ok(Number.isFinite(safeRate) && safeRate > 0);
  const safeConverted = convertCurrency(100, 'USD', 'EGP', { USD: -2, EGP: Number.NaN });
  assert.ok(Number.isFinite(safeConverted) && safeConverted > 0);

  // Symmetric rounding for negative amounts
  assert.equal(roundCurrency(1.005, 2), 1.01);
  assert.equal(roundCurrency(-1.005, 2), -1.01);
  assert.equal(roundCurrency(-0.0001, 2), 0);
});

