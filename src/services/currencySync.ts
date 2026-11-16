export interface UserCurrencyRatesSyncInput {
  rates?: Record<string, number> | null;
  fetchedAtMs?: number;
  ratesLastUpdated?: string;
  useUpdatedExchangeRates?: boolean;
  customExchangeRates?: Record<string, number>;
}

export interface SafeUserCurrencyRatesPatch {
  currencyRates?: {
    base: 'USD';
    fetchedAtMs: number;
    ratesLastUpdated?: string;
    rates: Record<string, number>;
  };
  settings: {
    useUpdatedExchangeRates: boolean;
    ratesLastUpdated?: string;
    ratesUpdatedAtMs?: number;
    customExchangeRates?: Record<string, number>;
  };
}

export const PROTECTED_USER_PROFILE_FIELDS = new Set([
  'uid',
  'email',
  'isPro',
  'proActive',
  'proPlan',
  'planTier',
  'billingCycle',
  'startedAt',
  'expiresAt',
  'proExpiresAt',
  'hasUsedBusinessTrial',
  'redeemedCouponCode',
  'activationCodeHash',
  'createdAt',
]);

export function sanitizeCurrencyRatesMap(
  rawRates: Record<string, unknown> | null | undefined,
  maxEntries = 220
): Record<string, number> {
  if (!rawRates || typeof rawRates !== 'object' || Array.isArray(rawRates)) {
    return {};
  }
  const clean: Record<string, number> = {};
  let count = 0;
  for (const [rawCode, rawVal] of Object.entries(rawRates)) {
    if (count >= maxEntries) break;
    const code = String(rawCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(code)) continue;
    const num = Number(rawVal);
    if (!Number.isFinite(num) || num <= 0) continue;
    clean[code] = num;
    count++;
  }
  return clean;
}

/**
 * Builds a strictly scoped merge patch for users/{uid} containing ONLY currencyRates and
 * non-privileged currency settings. Never includes subscription or identity fields.
 */
export function buildSafeUserCurrencyRatesPatch(
  input: UserCurrencyRatesSyncInput
): SafeUserCurrencyRatesPatch {
  const cleanRates = sanitizeCurrencyRatesMap(input.rates);
  const cleanCustomRates = sanitizeCurrencyRatesMap(input.customExchangeRates, 100);
  const cleanFetchedAtMs =
    typeof input.fetchedAtMs === 'number' && Number.isFinite(input.fetchedAtMs) && input.fetchedAtMs > 0
      ? Math.trunc(input.fetchedAtMs)
      : Date.now();
  const cleanUpdatedLabel =
    typeof input.ratesLastUpdated === 'string' && input.ratesLastUpdated.trim().length > 0
      ? input.ratesLastUpdated.trim().slice(0, 80)
      : undefined;

  const settingsPatch: SafeUserCurrencyRatesPatch['settings'] = {
    useUpdatedExchangeRates: input.useUpdatedExchangeRates !== false,
    ...(cleanUpdatedLabel ? { ratesLastUpdated: cleanUpdatedLabel } : {}),
    ...(cleanFetchedAtMs > 0 ? { ratesUpdatedAtMs: cleanFetchedAtMs } : {}),
    ...(Object.keys(cleanCustomRates).length > 0 ? { customExchangeRates: cleanCustomRates } : {}),
  };

  const patch: SafeUserCurrencyRatesPatch = {
    settings: settingsPatch,
  };

  if (Object.keys(cleanRates).length > 0) {
    patch.currencyRates = {
      base: 'USD',
      fetchedAtMs: cleanFetchedAtMs,
      ...(cleanUpdatedLabel ? { ratesLastUpdated: cleanUpdatedLabel } : {}),
      rates: cleanRates,
    };
  }

  return patch;
}

/**
 * Builds a minimal merge patch recording only lastSyncedAt without touching protected fields.
 */
export function buildSafeCloudLastSyncedPatch(updatedAtMs: number): { lastSyncedAt: number } {
  const cleanMs =
    typeof updatedAtMs === 'number' && Number.isFinite(updatedAtMs) && updatedAtMs > 0
      ? Math.trunc(updatedAtMs)
      : Date.now();
  return { lastSyncedAt: cleanMs };
}
