/**
 * Pure wealth, net worth, savings rate, cashflow, and wallet balance adjustment helpers.
 * Fully backward-compatible with legacy wallets lacking assetClass / assetSubtype.
 */
import {
  Debt,
  NetWorthTimeframe,
  Transaction,
  Wallet,
  WalletAssetClass,
  WalletAssetSubtype,
} from '../types';
import {
  convertCurrency,
  fromMinor as fromMinorUnits,
  roundCurrency as roundCurrencyAmount,
  toMinor as toMinorUnits,
} from './currency';
import { formatLocalDate } from './calculations';

export interface AssetSubtypeMeta {
  id: WalletAssetSubtype;
  assetClass: WalletAssetClass;
  labelAr: string;
  labelEn: string;
  defaultIcon: string;
}

export const WALLET_ASSET_SUBTYPES: AssetSubtypeMeta[] = [
  // Spendable (Money You Can Spend)
  { id: 'cash', assetClass: 'spendable', labelAr: 'نقدي (كاش)', labelEn: 'Cash', defaultIcon: 'Banknote' },
  { id: 'bank', assetClass: 'spendable', labelAr: 'حساب بنكي', labelEn: 'Bank Account', defaultIcon: 'Landmark' },
  { id: 'ewallet', assetClass: 'spendable', labelAr: 'محفظة إلكترونية', labelEn: 'E-Wallet', defaultIcon: 'Smartphone' },
  { id: 'card', assetClass: 'spendable', labelAr: 'بطاقة خصم / ائتمان', labelEn: 'Debit / Credit Card', defaultIcon: 'CreditCard' },
  // Owned Assets / Savings / Investments (Things You Own)
  { id: 'savings', assetClass: 'asset', labelAr: 'حساب ادخار', labelEn: 'Savings Account', defaultIcon: 'PiggyBank' },
  { id: 'certificate', assetClass: 'asset', labelAr: 'شهادة بنكية / وديعة', labelEn: 'Bank Certificate / CD', defaultIcon: 'Landmark' },
  { id: 'gold', assetClass: 'asset', labelAr: 'ذهب ومشغولات', labelEn: 'Gold & Bullion', defaultIcon: 'Coins' },
  { id: 'investment', assetClass: 'asset', labelAr: 'أسهم / استثمارات', labelEn: 'Investments & Stocks', defaultIcon: 'TrendingUp' },
  { id: 'real_estate', assetClass: 'asset', labelAr: 'عقار / شقة', labelEn: 'Real Estate', defaultIcon: 'Home' },
  { id: 'vehicle', assetClass: 'asset', labelAr: 'سيارة / مركبة', labelEn: 'Vehicle', defaultIcon: 'Car' },
  { id: 'other_asset', assetClass: 'asset', labelAr: 'أصل آخر', labelEn: 'Other Asset', defaultIcon: 'Gem' },
];

const ASSET_SUBTYPE_SET = new Set<WalletAssetSubtype>([
  'savings',
  'certificate',
  'gold',
  'investment',
  'real_estate',
  'vehicle',
  'other_asset',
]);

export function getWalletAssetClass(wallet?: Pick<Wallet, 'assetClass' | 'assetSubtype'> | null): WalletAssetClass {
  if (!wallet) return 'spendable';
  if (wallet.assetClass === 'asset' || wallet.assetClass === 'spendable') {
    return wallet.assetClass;
  }
  if (wallet.assetSubtype && ASSET_SUBTYPE_SET.has(wallet.assetSubtype)) {
    return 'asset';
  }
  return 'spendable';
}

export function getAssetSubtypeMeta(subtype?: WalletAssetSubtype): AssetSubtypeMeta | undefined {
  if (!subtype) return undefined;
  return WALLET_ASSET_SUBTYPES.find((item) => item.id === subtype);
}

export interface WealthBreakdown {
  spendableTotal: number;
  ownedAssetsTotal: number;
  totalAssets: number;
  totalDebtIowe: number;
  totalOwedToMe: number;
  netWorth: number;
  spendableCount: number;
  ownedAssetsCount: number;
}

/**
 * Computes Spendable liquidity, Owned Assets, Total Assets, Debt (I Owe), and Net Worth.
 * - Active (non-archived) wallets are classified into Spendable vs Owned Assets.
 * - Wallets marked `excludeFromTotal` are excluded from Spendable liquid balance,
 *   unless they are explicitly `asset` class (where they still count toward Owned Assets & Net Worth
 *   unless archived) — wait: to respect explicit user exclusion cleanly, we respect `excludeFromTotal`
 *   on spendable wallets (matching existing calculateTotalBalance behavior) while including all non-archived
 *   owned assets in `ownedAssetsTotal` unless `excludeFromTotal` is explicitly checked.
 */
export function calculateWealthBreakdown(params: {
  wallets: Wallet[];
  debts: Debt[];
  mainCurrency: string;
  customRates?: Record<string, number>;
}): WealthBreakdown {
  const { wallets, debts, mainCurrency, customRates } = params;

  let spendableMinor = 0;
  let ownedAssetsMinor = 0;
  let spendableCount = 0;
  let ownedAssetsCount = 0;

  for (const w of wallets) {
    if (w.isArchived) continue;
    const cls = getWalletAssetClass(w);
    if (cls === 'asset') {
      ownedAssetsCount += 1;
    } else {
      spendableCount += 1;
    }
    if (w.excludeFromTotal) continue;

    const converted = convertCurrency(w.balance, w.currency, mainCurrency, customRates);
    const minor = toMinorUnits(converted, mainCurrency);
    if (cls === 'asset') {
      ownedAssetsMinor += minor;
    } else {
      spendableMinor += minor;
    }
  }

  let debtIoweMinor = 0;
  let owedToMeMinor = 0;
  for (const d of debts) {
    if (d.isSettled) continue;
    const remaining = Math.max(0, d.totalAmount - d.paidAmount);
    if (remaining <= 0) continue;
    const converted = convertCurrency(remaining, d.currency, mainCurrency, customRates);
    const minor = toMinorUnits(converted, mainCurrency);
    if (d.type === 'i_owe') {
      debtIoweMinor += minor;
    } else if (d.type === 'owed_to_me') {
      owedToMeMinor += minor;
    }
  }

  const totalAssetsMinor = spendableMinor + ownedAssetsMinor;
  const netWorthMinor = totalAssetsMinor - debtIoweMinor;

  return {
    spendableTotal: fromMinorUnits(spendableMinor, mainCurrency),
    ownedAssetsTotal: fromMinorUnits(ownedAssetsMinor, mainCurrency),
    totalAssets: fromMinorUnits(totalAssetsMinor, mainCurrency),
    totalDebtIowe: fromMinorUnits(debtIoweMinor, mainCurrency),
    totalOwedToMe: fromMinorUnits(owedToMeMinor, mainCurrency),
    netWorth: fromMinorUnits(netWorthMinor, mainCurrency),
    spendableCount,
    ownedAssetsCount,
  };
}

export interface SavingsAndCashflowMetrics {
  income: number;
  expense: number;
  netCashflow: number;
  cashflowStatus: 'positive' | 'negative' | 'neutral';
  savingsAmount: number;
  /** Percentage of income saved/remaining; null if no income recorded in period. */
  savingsRatePct: number | null;
}

export function calculateSavingsAndCashflow(
  income: number,
  expense: number,
  currency = 'EGP'
): SavingsAndCashflowMetrics {
  const incMinor = toMinorUnits(Math.max(0, Number.isFinite(income) ? income : 0), currency);
  const expMinor = toMinorUnits(Math.max(0, Number.isFinite(expense) ? expense : 0), currency);
  const netMinor = incMinor - expMinor;
  const safeIncome = fromMinorUnits(incMinor, currency);
  const safeExpense = fromMinorUnits(expMinor, currency);
  const netCashflow = fromMinorUnits(netMinor, currency);

  const cashflowStatus: 'positive' | 'negative' | 'neutral' =
    netMinor > 0 ? 'positive' : netMinor < 0 ? 'negative' : 'neutral';

  let savingsRatePct: number | null = null;
  if (incMinor > 0) {
    const rawPct = (netMinor / incMinor) * 100;
    // Clamp extremes only to keep display readable, preserve negative rate when overspending
    const clamped = Math.max(-999, Math.min(100, rawPct));
    savingsRatePct = Math.round(clamped * 10) / 10;
  }

  return {
    income: safeIncome,
    expense: safeExpense,
    netCashflow,
    cashflowStatus,
    savingsAmount: netCashflow,
    savingsRatePct,
  };
}

export interface NetWorthPoint {
  date: string; // YYYY-MM-DD
  label: string;
  value: number;
}

export interface NetWorthSeriesResult {
  timeframe: NetWorthTimeframe;
  points: NetWorthPoint[];
  startValue: number;
  endValue: number;
  delta: number;
  deltaPct: number | null;
}

/**
 * Reconstructs historical Net Worth trajectory backwards from currentNetWorth
 * using active transactions that affect balance. Deterministic and O(T + B).
 */
export function buildNetWorthSeries(params: {
  timeframe: NetWorthTimeframe;
  currentNetWorth: number;
  transactions: Transaction[];
  mainCurrency: string;
  customRates?: Record<string, number>;
  now?: Date;
  language?: 'ar' | 'en';
}): NetWorthSeriesResult {
  const {
    timeframe,
    currentNetWorth,
    transactions,
    mainCurrency,
    customRates,
    now = new Date(),
    language = 'ar',
  } = params;

  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDateStr = formatLocalDate(endDate);

  // Filter active transactions that affect balance and have valid YYYY-MM-DD date <= today
  const effectiveTxs = transactions.filter(
    (t) =>
      !t.deletedAt &&
      !t.doesNotAffectBalance &&
      t.approvalStatus !== 'rejected' &&
      (t.type === 'income' || t.type === 'expense') &&
      typeof t.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
      t.date <= endDateStr
  );

  // Determine start date & bucket count based on timeframe
  let startDate = new Date(endDate);
  let bucketCount = 12;

  if (timeframe === '1M') {
    startDate.setDate(startDate.getDate() - 30);
    bucketCount = 10;
  } else if (timeframe === '3M') {
    startDate.setDate(startDate.getDate() - 90);
    bucketCount = 12;
  } else if (timeframe === '1Y') {
    startDate.setFullYear(startDate.getFullYear() - 1);
    bucketCount = 12;
  } else {
    // ALL
    let earliestStr = endDateStr;
    for (const tx of effectiveTxs) {
      if (tx.date < earliestStr) earliestStr = tx.date;
    }
    const [ey, em, ed] = earliestStr.split('-').map(Number);
    if (ey && em && ed) {
      const earliestDate = new Date(ey, em - 1, ed);
      const diffDays = Math.round((endDate.getTime() - earliestDate.getTime()) / 86_400_000);
      if (diffDays < 30) {
        startDate.setDate(startDate.getDate() - 30);
      } else {
        startDate = earliestDate;
      }
    } else {
      startDate.setDate(startDate.getDate() - 90);
    }
    bucketCount = 12;
  }

  // Build evenly spaced sample dates from startDate .. endDate inclusive
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const spanMs = Math.max(86_400_000, endMs - startMs);

  const sampleDates: Date[] = [];
  for (let i = 0; i <= bucketCount; i++) {
    const t = i === bucketCount ? endMs : startMs + (spanMs * i) / bucketCount;
    const d = new Date(t);
    sampleDates.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  const sampleDateStrings = sampleDates.map((d) => formatLocalDate(d));

  // Pre-group net cashflow (income - expense) per YYYY-MM-DD in minor units
  const dailyNetMinor = new Map<string, number>();
  for (const tx of effectiveTxs) {
    const converted = convertCurrency(tx.amount, tx.currency, mainCurrency, customRates);
    const minor = toMinorUnits(converted, mainCurrency);
    const signed = tx.type === 'income' ? minor : -minor;
    dailyNetMinor.set(tx.date, (dailyNetMinor.get(tx.date) || 0) + signed);
  }

  // Sort daily deltas descending so we can walk backwards from endDate
  const sortedDatesDesc = Array.from(dailyNetMinor.entries()).sort((a, b) =>
    b[0].localeCompare(a[0])
  );

  const currentMinor = toMinorUnits(currentNetWorth, mainCurrency);
  const points: NetWorthPoint[] = new Array(sampleDateStrings.length);

  // For sample index k (from last down to 0):
  // NetWorth(sampleDate[k]) = currentNetWorth - sum(netFlow for all tx with date > sampleDate[k])
  let cumulativeAfterMinor = 0;
  let txDateCursor = 0;

  const locale = language === 'en' ? 'en-US' : 'ar-EG';

  for (let k = sampleDateStrings.length - 1; k >= 0; k--) {
    const cutoffStr = sampleDateStrings[k];
    while (txDateCursor < sortedDatesDesc.length && sortedDatesDesc[txDateCursor][0] > cutoffStr) {
      cumulativeAfterMinor += sortedDatesDesc[txDateCursor][1];
      txDateCursor++;
    }
    const valMinor = currentMinor - cumulativeAfterMinor;
    const sampleDate = sampleDates[k];
    const label =
      timeframe === '1M' || timeframe === '3M'
        ? sampleDate.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
        : sampleDate.toLocaleDateString(locale, { month: 'short', year: '2-digit' });

    points[k] = {
      date: cutoffStr,
      label,
      value: fromMinorUnits(valMinor, mainCurrency),
    };
  }

  const startValue = points[0]?.value ?? currentNetWorth;
  const endValue = points[points.length - 1]?.value ?? currentNetWorth;
  const delta = roundCurrencyAmount(endValue - startValue, mainCurrency);
  const deltaPct =
    Math.abs(startValue) > 0.0001
      ? Math.round(((delta / Math.abs(startValue)) * 100) * 10) / 10
      : null;

  return {
    timeframe,
    points,
    startValue,
    endValue,
    delta,
    deltaPct,
  };
}

export interface BalanceAdjustmentPlan {
  currentBalance: number;
  targetBalance: number;
  delta: number;
  absAmount: number;
  transactionType: 'income' | 'expense' | null;
}

export function calculateBalanceAdjustment(
  currentBalance: number,
  targetBalance: number,
  currency = 'EGP'
): BalanceAdjustmentPlan {
  const currMinor = toMinorUnits(Number.isFinite(currentBalance) ? currentBalance : 0, currency);
  const targetMinor = toMinorUnits(Number.isFinite(targetBalance) ? targetBalance : 0, currency);
  const diffMinor = targetMinor - currMinor;

  const delta = fromMinorUnits(diffMinor, currency);
  const absAmount = fromMinorUnits(Math.abs(diffMinor), currency);

  return {
    currentBalance: fromMinorUnits(currMinor, currency),
    targetBalance: fromMinorUnits(targetMinor, currency),
    delta,
    absAmount,
    transactionType: diffMinor > 0 ? 'income' : diffMinor < 0 ? 'expense' : null,
  };
}

export function getTimeframeStartDate(timeframe: NetWorthTimeframe, now = new Date()): Date | null {
  if (timeframe === 'ALL') return null;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (timeframe === '1M') {
    d.setDate(d.getDate() - 30);
    return d;
  }
  if (timeframe === '3M') {
    d.setDate(d.getDate() - 90);
    return d;
  }
  if (timeframe === '1Y') {
    d.setFullYear(d.getFullYear() - 1);
    return d;
  }
  return null;
}
