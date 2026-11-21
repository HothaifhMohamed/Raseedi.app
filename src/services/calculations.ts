/**
 * Pure calculation logic for Raseedi (رَصِيدِي)
 * Fully decoupled for fast unit testing and deterministic results.
 * Includes Safe Math Parser, 3-decimal currency precision, non-drifting recurrence,
 * and Enterprise Accounting / VAT / Cost Center / Aging Report engines.
 */
import {
  Transaction,
  Wallet,
  Debt,
  Budget,
  RecurrenceRule,
  Category,
  CostCenter,
  BusinessParty,
  MoneyCircle,
  ApprovalStatus,
  CanonicalApprovalStatus,
} from '../types';
import {
  convertCurrency,
  getCurrency,
  getCurrencyDecimals,
  roundCurrency,
  fromMinor,
  toMinor,
} from './currency';
import { normalizeArabicPersianNumerals } from './numbers';

export { roundCurrency, fromMinor, toMinor, normalizeArabicPersianNumerals };

export function roundMoney(val: number, currencyCode = 'EGP'): number {
  return roundCurrency(val, currencyCode);
}

/**
 * Convert numbers to Eastern Arabic numerals (١٢٣)
 */
export function toArabicNumerals(numStr: string | number): string {
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(numStr).replace(/[0-9]/g, (w) => arabicDigits[+w]);
}

export function formatDisplayNumber(
  value: number,
  decimals = 1,
  digitFormat: 'arabic' | 'western' = 'western'
): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return digitFormat === 'arabic' ? toArabicNumerals(rounded) : rounded;
}

export function resolveDisplayDecimals(currencyCode: string, configuredDecimals?: number): number {
  const currencyDecimals = getCurrencyDecimals(currencyCode, 2);
  if (configuredDecimals === undefined || configuredDecimals === 2) {
    return currencyDecimals;
  }
  return Math.max(0, Math.min(3, configuredDecimals));
}

/**
 * Format monetary amount with precision, digit format, and currency symbol/code
 */
export function formatCurrencyAmount(
  amount: number,
  currencyCode: string,
  options?: {
    decimalPlaces?: number;
    digitFormat?: 'arabic' | 'western';
    showSign?: boolean;
    useCodeInsteadOfSymbol?: boolean;
    language?: 'ar' | 'en';
  }
): string {
  const decimals = resolveDisplayDecimals(currencyCode, options?.decimalPlaces);
  const isArabicDigits = options?.digitFormat === 'arabic';
  const showSign = options?.showSign ?? false;
  const lang = options?.language ?? 'ar';

  const sign = showSign && amount > 0 ? '+' : '';
  const rounded = amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const currency = getCurrency(currencyCode);
  const symbol = options?.useCodeInsteadOfSymbol
    ? currency.code
    : lang === 'ar'
    ? currency.symbol
    : currency.code;

  const formattedNum = isArabicDigits ? toArabicNumerals(rounded) : rounded;

  return lang === 'ar' ? `${sign}${formattedNum} ${symbol}` : `${symbol} ${sign}${formattedNum}`;
}

/**
 * Safe recursive-descent mathematical parser for built-in calculator keypad.
 * Completely eliminates eval / new Function.
 * Supports: +, -, *, /, (, ), decimals, unary +/-.
 */
type CalcToken =
  | { type: 'num'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'paren'; value: '(' | ')' };

function tokenizeMathExpression(expr: string): CalcToken[] | null {
  const tokens: CalcToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let numStr = '';
      let dotCount = 0;
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        if (expr[i] === '.') dotCount++;
        if (dotCount > 1) return null;
        numStr += expr[i];
        i++;
      }
      if (numStr === '.') return null;
      const val = Number(numStr);
      if (!Number.isFinite(val)) return null;
      tokens.push({ type: 'num', value: val });
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
      continue;
    }
    return null;
  }
  return tokens;
}

export function evaluateCalculatorExpression(rawExpr: string): { result: number; error: boolean } {
  if (!rawExpr || !rawExpr.trim()) return { result: 0, error: false };

  // Normalize Arabic/Persian digits and decimal separators first, then visual operators
  const normalizedInput = normalizeArabicPersianNumerals(rawExpr)
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/,/g, '.')
    .replace(/\s+/g, '');

  // If caller injected unexpected characters (letters, semicolons, quotes, brackets), fail safely
  if (/[^0-9+\-*/().]/.test(normalizedInput)) {
    return { result: 0, error: true };
  }

  if (!normalizedInput) return { result: 0, error: false };

  // Balanced parentheses check
  let balance = 0;
  for (const ch of normalizedInput) {
    if (ch === '(') balance++;
    if (ch === ')') balance--;
    if (balance < 0) return { result: 0, error: true };
  }
  if (balance !== 0) return { result: 0, error: true };

  // Strip trailing operator(s) or dot for smooth live preview while typing e.g. "50 + "
  const cleaned = normalizedInput.replace(/[+\-*/.]+$/, '');
  if (!cleaned) return { result: 0, error: false };

  const tokens = tokenizeMathExpression(cleaned);
  if (!tokens || tokens.length === 0) return { result: 0, error: true };

  let pos = 0;
  const peek = (): CalcToken | undefined => tokens[pos];
  const consume = (): CalcToken => tokens[pos++];

  const parseExpression = (): number => {
    let left = parseTerm();
    while (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = (consume() as { type: 'op'; value: '+' | '-' }).value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number => {
    let left = parseFactor();
    while (peek()?.type === 'op' && (peek()!.value === '*' || peek()!.value === '/')) {
      const op = (consume() as { type: 'op'; value: '*' | '/' }).value;
      const right = parseFactor();
      if (op === '/') {
        if (right === 0) throw new Error('DIV_BY_ZERO');
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  };

  const parseFactor = (): number => {
    const tok = peek();
    if (!tok) throw new Error('UNEXPECTED_END');
    if (tok.type === 'op' && (tok.value === '+' || tok.value === '-')) {
      consume();
      const inner = parseFactor();
      return tok.value === '-' ? -inner : inner;
    }
    if (tok.type === 'paren' && tok.value === '(') {
      consume();
      const inner = parseExpression();
      const closing = peek();
      if (!closing || closing.type !== 'paren' || closing.value !== ')') {
        throw new Error('MISSING_PAREN');
      }
      consume();
      return inner;
    }
    if (tok.type === 'num') {
      consume();
      return tok.value;
    }
    throw new Error('UNEXPECTED_TOKEN');
  };

  try {
    const val = parseExpression();
    if (pos !== tokens.length || !Number.isFinite(val)) {
      return { result: 0, error: true };
    }
    return { result: roundCurrency(val, 3), error: false };
  } catch {
    return { result: 0, error: true };
  }
}

/**
 * Normalizes legacy 'pending_approval' into canonical 'pending'.
 */
export function normalizeApprovalStatus(status?: ApprovalStatus): CanonicalApprovalStatus {
  if (!status) return 'approved';
  if (status === 'pending_approval') return 'pending';
  return status;
}

/**
 * Resolves effective decimal transaction amount, preferring integer amountMinor when present.
 */
export function getEffectiveTransactionAmount(
  tx: Pick<Transaction, 'amount' | 'amountMinor' | 'currency'>
): number {
  if (typeof tx.amountMinor === 'number' && Number.isFinite(tx.amountMinor) && tx.currency) {
    return fromMinor(tx.amountMinor, tx.currency);
  }
  return tx.amount;
}

/**
 * Critical Accounting Invariant:
 * Soft-deleted transactions (`deletedAt != null`) and transactions marked
 * `doesNotAffectBalance`, `draft`, `pending` / `pending_approval`, or `rejected`
 * MUST NEVER affect treasury balances, P&L, VAT totals, or budgets.
 * Only `approved` (default) and `paid` transactions post to accounting.
 */
export function doesTransactionAffectAccounting(
  tx: Pick<Transaction, 'doesNotAffectBalance' | 'approvalStatus' | 'deletedAt'>
): boolean {
  if (tx.deletedAt) return false;
  if (tx.doesNotAffectBalance) return false;
  const normalized = normalizeApprovalStatus(tx.approvalStatus);
  if (normalized === 'draft' || normalized === 'pending' || normalized === 'rejected') {
    return false;
  }
  return true;
}

/**
 * Calculate total balance across wallets converted to main currency
 */
export function calculateTotalBalance(
  wallets: Wallet[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  options?: {
    excludeDebts?: boolean;
    debts?: Debt[];
  }
): number {
  let total = 0;

  for (const wallet of wallets) {
    if (wallet.isArchived || wallet.excludeFromTotal) continue;
    const inMain = convertCurrency(wallet.balance, wallet.currency, mainCurrency, customRates);
    total += inMain;
  }

  // If debts are included in balance calculation
  if (!options?.excludeDebts && options?.debts) {
    for (const debt of options.debts) {
      if (debt.isSettled) continue;
      const remaining = debt.totalAmount - debt.paidAmount;
      const inMain = convertCurrency(remaining, debt.currency, mainCurrency, customRates);
      if (debt.type === 'owed_to_me') {
        total += inMain;
      } else {
        total -= inMain;
      }
    }
  }

  return roundCurrency(total, mainCurrency);
}

/**
 * Filter transactions by a date range
 */
export function getTransactionsInDateRange(
  transactions: Transaction[],
  startDate: string,
  endDate: string
): Transaction[] {
  return transactions.filter((t) => t.date >= startDate && t.date <= endDate);
}

/**
 * Calculate Income, Expense, and Net for a collection of transactions converted to main currency
 */
export function calculateIncomeExpenseNet(
  transactions: Transaction[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  useTransactionRate = false
): { income: number; expense: number; net: number } {
  let income = 0;
  let expense = 0;

  for (const t of transactions) {
    if (!doesTransactionAffectAccounting(t)) continue;

    const rateOverride =
      useTransactionRate && t.exchangeRate ? { [t.currency]: t.exchangeRate } : customRates;
    const effectiveAmount = getEffectiveTransactionAmount(t);
    const amountInMain = convertCurrency(effectiveAmount, t.currency, mainCurrency, rateOverride);

    if (t.type === 'income') {
      income += amountInMain;
    } else if (t.type === 'expense') {
      expense += amountInMain;
    }
  }

  income = roundCurrency(income, mainCurrency);
  expense = roundCurrency(expense, mainCurrency);
  const net = roundCurrency(income - expense, mainCurrency);

  return { income, expense, net };
}

/**
 * Group transactions by date string YYYY-MM-DD
 */
export interface DayGroup {
  date: string; // YYYY-MM-DD
  subtotal: number; // in main currency (income - expense)
  incomeTotal: number;
  expenseTotal: number;
  transactions: Transaction[];
}

export function groupTransactionsByDay(
  transactions: Transaction[],
  mainCurrency: string,
  customRates?: Record<string, number>
): DayGroup[] {
  const groupsMap = new Map<string, Transaction[]>();

  for (const t of transactions) {
    const list = groupsMap.get(t.date) || [];
    list.push(t);
    groupsMap.set(t.date, list);
  }

  const sortedDates = Array.from(groupsMap.keys()).sort((a, b) => b.localeCompare(a));

  return sortedDates.map((date) => {
    const list = groupsMap.get(date)!;
    list.sort((a, b) => b.time.localeCompare(a.time) || b.createdAt - a.createdAt);

    let incomeTotal = 0;
    let expenseTotal = 0;

    for (const t of list) {
      if (!doesTransactionAffectAccounting(t) || t.type === 'transfer') continue;
      const converted = convertCurrency(
        getEffectiveTransactionAmount(t),
        t.currency,
        mainCurrency,
        customRates
      );
      if (t.type === 'income') incomeTotal += converted;
      if (t.type === 'expense') expenseTotal += converted;
    }

    incomeTotal = roundCurrency(incomeTotal, mainCurrency);
    expenseTotal = roundCurrency(expenseTotal, mainCurrency);
    const subtotal = roundCurrency(incomeTotal - expenseTotal, mainCurrency);

    return {
      date,
      subtotal,
      incomeTotal,
      expenseTotal,
      transactions: list,
    };
  });
}

/**
 * Format a Date object into local YYYY-MM-DD (avoids UTC shifts from toISOString)
 */
export function formatLocalDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Pure calculation for source and destination wallet balance deltas of a transaction.
 * Respects approvalStatus (draft / pending / pending_approval / rejected / deleted return 0 delta).
 */
export function getTransactionWalletDeltas(
  tx: Pick<
    Transaction,
    | 'type'
    | 'amount'
    | 'amountMinor'
    | 'transferFee'
    | 'convertedAmount'
    | 'toWalletId'
    | 'doesNotAffectBalance'
    | 'approvalStatus'
    | 'deletedAt'
  > & { currency?: string }
): { sourceDelta: number; destDelta: number } {
  if (!doesTransactionAffectAccounting(tx)) {
    return { sourceDelta: 0, destDelta: 0 };
  }
  const effectiveAmount = getEffectiveTransactionAmount({
    amount: tx.amount,
    amountMinor: tx.amountMinor,
    currency: tx.currency || '',
  });
  if (tx.type === 'expense') {
    return { sourceDelta: -effectiveAmount, destDelta: 0 };
  }
  if (tx.type === 'income') {
    return { sourceDelta: effectiveAmount, destDelta: 0 };
  }
  if (tx.type === 'transfer' && tx.toWalletId) {
    const fee = tx.transferFee && tx.transferFee > 0 ? tx.transferFee : 0;
    const netDest = tx.convertedAmount ?? effectiveAmount;
    return { sourceDelta: -(effectiveAmount + fee), destDelta: netDest };
  }
  return { sourceDelta: 0, destDelta: 0 };
}

/**
 * Parse a YYYY-MM-DD string in the local timezone (avoids UTC midnight shift)
 */
export function parseLocalDate(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    return new Date(year, month, day);
  }
  const fallback = new Date(dateStr);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

/**
 * Diff whole calendar days between two YYYY-MM-DD local dates (end - start)
 */
function diffCalendarDays(startDateStr: string, endDateStr: string): number {
  const s = parseLocalDate(startDateStr);
  const e = parseLocalDate(endDateStr);
  const utcS = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const utcE = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
  return Math.round((utcE - utcS) / 86400000);
}

/**
 * Get previous YYYY-MM string given a YYYY-MM string
 */
export function getPreviousMonthStr(monthStr: string): string {
  const [yStr, mStr] = monthStr.split('-');
  const year = parseInt(yStr, 10);
  const monthIdx = parseInt(mStr, 10) - 1;
  const prev = new Date(year, monthIdx - 1, 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
}

/**
 * Resolve which fiscal YYYY-MM cycle a given Date belongs to based on firstDayOfMonth
 */
export function getActiveFiscalMonthStr(now: Date = new Date(), firstDayOfMonth = 1): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const normalizedStart = Math.min(31, Math.max(1, Math.floor(firstDayOfMonth || 1)));
  if (normalizedStart <= 1) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  }

  const daysInCurrentCalMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const actualStartDay = Math.min(normalizedStart, daysInCurrentCalMonth);

  if (now.getDate() < actualStartDay) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/**
 * Compute exact local startDate, endDate, and totalDays for a fiscal month cycle
 */
export function getCustomMonthDateRange(
  monthStr: string,
  firstDayOfMonth = 1
): { startDate: string; endDate: string; totalDays: number } {
  const match = /^(\d{4})-(\d{2})$/.exec((monthStr || '').trim());
  const now = new Date();
  const year = match ? parseInt(match[1], 10) : now.getFullYear();
  const monthIdx = match ? parseInt(match[2], 10) - 1 : now.getMonth();
  const normalizedStart = Math.min(31, Math.max(1, Math.floor(firstDayOfMonth || 1)));

  if (normalizedStart <= 1) {
    const start = new Date(year, monthIdx, 1);
    const end = new Date(year, monthIdx + 1, 0);
    const startDate = formatLocalDate(start);
    const endDate = formatLocalDate(end);
    return {
      startDate,
      endDate,
      totalDays: end.getDate(),
    };
  }

  const daysInStartMonth = new Date(year, monthIdx + 1, 0).getDate();
  const actualStartDay = Math.min(normalizedStart, daysInStartMonth);
  const start = new Date(year, monthIdx, actualStartDay);

  const daysInNextMonth = new Date(year, monthIdx + 2, 0).getDate();
  const nextStartDay = Math.min(normalizedStart, daysInNextMonth);
  const nextCycleStart = new Date(year, monthIdx + 1, nextStartDay);
  const end = new Date(
    nextCycleStart.getFullYear(),
    nextCycleStart.getMonth(),
    nextCycleStart.getDate() - 1
  );

  const startDate = formatLocalDate(start);
  const endDate = formatLocalDate(end);
  const totalDays = diffCalendarDays(startDate, endDate) + 1;

  return { startDate, endDate, totalDays };
}

/**
 * Calculate budget spent, remaining, and percentage with fiscal month range & dynamic rollover
 */
export function calculateBudgetProgress(
  budget: Budget,
  transactions: Transaction[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  options?: {
    firstDayOfMonth?: number;
    allBudgets?: Budget[];
    _visitedMonths?: Set<string>;
  }
): {
  spent: number;
  remaining: number;
  percentage: number;
  isWarning: boolean;
  isExceeded: boolean;
  effectiveRolloverAmount: number;
} {
  const firstDay = options?.firstDayOfMonth ?? 1;
  const { startDate, endDate } = getCustomMonthDateRange(budget.month, firstDay);

  const monthTransactions = transactions.filter((t) => {
    if (t.type !== 'expense' || !doesTransactionAffectAccounting(t)) return false;
    const matchesMonth = t.date >= startDate && t.date <= endDate;
    const matchesCategory = !budget.categoryId || t.categoryId === budget.categoryId;
    const matchesWallet = !budget.walletId || t.walletId === budget.walletId;
    return matchesMonth && matchesCategory && matchesWallet;
  });

  let spent = 0;
  for (const t of monthTransactions) {
    spent += convertCurrency(
      getEffectiveTransactionAmount(t),
      t.currency,
      mainCurrency,
      customRates
    );
  }
  spent = roundCurrency(spent, mainCurrency);

  let effectiveRolloverAmount = 0;
  if (budget.rollover) {
    const visited = options?._visitedMonths ?? new Set<string>();
    const prevMonthStr = getPreviousMonthStr(budget.month);
    const visitKey = `${prevMonthStr}|${budget.categoryId || ''}|${budget.walletId || ''}`;

    const prevBudget =
      !visited.has(visitKey) && options?.allBudgets
        ? options.allBudgets.find(
            (b) =>
              b.id !== budget.id &&
              b.month === prevMonthStr &&
              (b.categoryId || '') === (budget.categoryId || '') &&
              (b.walletId || '') === (budget.walletId || '')
          )
        : undefined;

    if (prevBudget) {
      const nextVisited = new Set(visited);
      nextVisited.add(visitKey);
      const prevProgress = calculateBudgetProgress(prevBudget, transactions, mainCurrency, customRates, {
        firstDayOfMonth: firstDay,
        allBudgets: options?.allBudgets,
        _visitedMonths: nextVisited,
      });
      effectiveRolloverAmount = prevProgress.remaining;
    } else {
      effectiveRolloverAmount = budget.rolloverAmount || 0;
    }
  }

  const totalAllowed = roundCurrency(budget.amount + effectiveRolloverAmount, mainCurrency);
  const remaining = roundCurrency(totalAllowed - spent, mainCurrency);
  const percentage = totalAllowed > 0 ? Math.round((spent / totalAllowed) * 100) : spent > 0 ? 100 : 0;

  return {
    spent,
    remaining,
    percentage,
    isWarning: percentage >= 80 && percentage < 100,
    isExceeded: percentage >= 100,
    effectiveRolloverAmount,
  };
}

/**
 * Advance recurring rule to next due date in local timezone WITHOUT month-end drift.
 * Uses rule.anchorDayOfMonth (falling back to current day) and clamps to the last day of target month.
 */
export function calculateNextDueDate(rule: RecurrenceRule, fromDateStr: string): string {
  const date = parseLocalDate(fromDateStr);
  const interval = Math.max(1, rule.interval || 1);
  const anchorDay = rule.anchorDayOfMonth ?? date.getDate();

  switch (rule.frequency) {
    case 'daily':
      date.setDate(date.getDate() + interval);
      return formatLocalDate(date);
    case 'weekly':
      date.setDate(date.getDate() + 7 * interval);
      return formatLocalDate(date);
    case 'monthly': {
      const totalMonths = date.getFullYear() * 12 + date.getMonth() + interval;
      const targetYear = Math.floor(totalMonths / 12);
      const targetMonth = totalMonths % 12;
      const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
      const targetDay = Math.min(anchorDay, lastDayOfTargetMonth);
      return formatLocalDate(new Date(targetYear, targetMonth, targetDay));
    }
    case 'yearly': {
      const targetYear = date.getFullYear() + interval;
      const targetMonth = date.getMonth();
      const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
      const targetDay = Math.min(anchorDay, lastDayOfTargetMonth);
      return formatLocalDate(new Date(targetYear, targetMonth, targetDay));
    }
    case 'custom':
    default:
      date.setDate(date.getDate() + interval);
      return formatLocalDate(date);
  }
}

// =============================================================================
// Safe-to-Spend, Weekly Insight, Month-End Forecast & Performance Generator
// =============================================================================

export interface SafeToSpendResult {
  hasBudget: boolean;
  budgetId?: string;
  budgetName?: string;
  remaining: number;
  daysLeftInMonth: number;
  dailySafeAmount: number;
  isNegative: boolean;
}

export function calculateSafeToSpend(
  budgets: Budget[],
  transactions: Transaction[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  now: Date = new Date(),
  firstDayOfMonth = 1
): SafeToSpendResult {
  const currentMonthStr = getActiveFiscalMonthStr(now, firstDayOfMonth);
  const { endDate } = getCustomMonthDateRange(currentMonthStr, firstDayOfMonth);
  const todayStr = formatLocalDate(now);
  const daysLeftInMonth = Math.max(1, diffCalendarDays(todayStr, endDate) + 1);

  const overallBudget =
    budgets.find((b) => b.month === currentMonthStr && !b.categoryId && !b.walletId) ||
    budgets.find((b) => b.month === currentMonthStr && !b.categoryId);

  if (!overallBudget) {
    return {
      hasBudget: false,
      remaining: 0,
      daysLeftInMonth,
      dailySafeAmount: 0,
      isNegative: false,
    };
  }

  const progress = calculateBudgetProgress(overallBudget, transactions, mainCurrency, customRates, {
    firstDayOfMonth,
    allBudgets: budgets,
  });
  const dailySafeAmount = roundCurrency(progress.remaining / daysLeftInMonth, mainCurrency);

  return {
    hasBudget: true,
    budgetId: overallBudget.id,
    budgetName: overallBudget.name,
    remaining: progress.remaining,
    daysLeftInMonth,
    dailySafeAmount,
    isNegative: dailySafeAmount < 0,
  };
}

export interface WeeklyInsightResult {
  hasData: boolean;
  thisWeekTotal: number;
  lastWeekTotal: number;
  totalDiffPct: number;
  topCategoryId?: string;
  topCategoryNameAr?: string;
  topCategoryNameEn?: string;
  topCategoryThisWeek: number;
  topCategoryLastWeek: number;
  topCategoryDiffPct: number;
}

export function calculateWeeklyInsight(
  transactions: Transaction[],
  categories: Category[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  now: Date = new Date()
): WeeklyInsightResult {
  const pad = (n: number) => String(n).padStart(2, '0');
  const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const endThisWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThisWeek = new Date(endThisWeek);
  startThisWeek.setDate(endThisWeek.getDate() - 6);

  const endLastWeek = new Date(startThisWeek);
  endLastWeek.setDate(startThisWeek.getDate() - 1);
  const startLastWeek = new Date(endLastWeek);
  startLastWeek.setDate(endLastWeek.getDate() - 6);

  const sThis = toDateStr(startThisWeek);
  const eThis = toDateStr(endThisWeek);
  const sLast = toDateStr(startLastWeek);
  const eLast = toDateStr(endLastWeek);

  let thisWeekTotal = 0;
  let lastWeekTotal = 0;
  const thisByCat = new Map<string, number>();
  const lastByCat = new Map<string, number>();

  for (const tx of transactions) {
    if (!doesTransactionAffectAccounting(tx) || tx.type !== 'expense') continue;
    if (tx.date >= sThis && tx.date <= eThis) {
      const val = convertCurrency(
        getEffectiveTransactionAmount(tx),
        tx.currency,
        mainCurrency,
        customRates
      );
      thisWeekTotal += val;
      thisByCat.set(tx.categoryId, (thisByCat.get(tx.categoryId) || 0) + val);
    } else if (tx.date >= sLast && tx.date <= eLast) {
      const val = convertCurrency(
        getEffectiveTransactionAmount(tx),
        tx.currency,
        mainCurrency,
        customRates
      );
      lastWeekTotal += val;
      lastByCat.set(tx.categoryId, (lastByCat.get(tx.categoryId) || 0) + val);
    }
  }

  thisWeekTotal = roundCurrency(thisWeekTotal, mainCurrency);
  lastWeekTotal = roundCurrency(lastWeekTotal, mainCurrency);

  if (thisWeekTotal === 0 && lastWeekTotal === 0) {
    return {
      hasData: false,
      thisWeekTotal: 0,
      lastWeekTotal: 0,
      totalDiffPct: 0,
      topCategoryThisWeek: 0,
      topCategoryLastWeek: 0,
      topCategoryDiffPct: 0,
    };
  }

  let topCategoryId: string | undefined;
  let maxVal = -1;
  const sourceMap = thisByCat.size > 0 ? thisByCat : lastByCat;
  for (const [catId, val] of sourceMap.entries()) {
    if (val > maxVal) {
      maxVal = val;
      topCategoryId = catId;
    }
  }

  const topCat = categories.find((c) => c.id === topCategoryId);
  const topCategoryThisWeek = roundCurrency(thisByCat.get(topCategoryId || '') || 0, mainCurrency);
  const topCategoryLastWeek = roundCurrency(lastByCat.get(topCategoryId || '') || 0, mainCurrency);

  const totalDiffPct =
    lastWeekTotal > 0
      ? Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100)
      : thisWeekTotal > 0
      ? 100
      : 0;

  const topCategoryDiffPct =
    topCategoryLastWeek > 0
      ? Math.round(((topCategoryThisWeek - topCategoryLastWeek) / topCategoryLastWeek) * 100)
      : topCategoryThisWeek > 0
      ? 100
      : 0;

  return {
    hasData: true,
    thisWeekTotal,
    lastWeekTotal,
    totalDiffPct,
    topCategoryId,
    topCategoryNameAr: topCat?.nameAr,
    topCategoryNameEn: topCat?.nameEn,
    topCategoryThisWeek,
    topCategoryLastWeek,
    topCategoryDiffPct,
  };
}

export interface MonthEndForecastResult {
  spentSoFar: number;
  dailyAverage: number;
  projectedTotal: number;
  daysElapsed: number;
  totalDaysInMonth: number;
  daysRemaining: number;
}

export function calculateMonthEndForecast(
  transactions: Transaction[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  now: Date = new Date(),
  firstDayOfMonth = 1
): MonthEndForecastResult {
  const activeMonthStr = getActiveFiscalMonthStr(now, firstDayOfMonth);
  const { startDate, totalDays: totalDaysInMonth } = getCustomMonthDateRange(
    activeMonthStr,
    firstDayOfMonth
  );
  const todayStr = formatLocalDate(now);
  const daysElapsed = Math.max(1, diffCalendarDays(startDate, todayStr) + 1);
  const daysRemaining = Math.max(0, totalDaysInMonth - daysElapsed);

  let spentSoFar = 0;
  for (const tx of transactions) {
    if (!doesTransactionAffectAccounting(tx) || tx.type !== 'expense') continue;
    if (tx.date >= startDate && tx.date <= todayStr) {
      spentSoFar += convertCurrency(
        getEffectiveTransactionAmount(tx),
        tx.currency,
        mainCurrency,
        customRates
      );
    }
  }

  spentSoFar = roundCurrency(spentSoFar, mainCurrency);
  const dailyAverage = roundCurrency(spentSoFar / daysElapsed, mainCurrency);
  const projectedTotal = roundCurrency(dailyAverage * totalDaysInMonth, mainCurrency);

  return {
    spentSoFar,
    dailyAverage,
    projectedTotal,
    daysElapsed,
    totalDaysInMonth,
    daysRemaining,
  };
}

export function generateSyntheticTransactions(count: number, now: Date = new Date()): Transaction[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const catIds = ['cat-restaurants', 'cat-cafes', 'cat-groceries', 'cat-transport', 'cat-fuel', 'cat-bills'];
  const walletIds = ['w-cash', 'w-bank'];
  const list: Transaction[] = new Array(count);

  const baseTime = now.getTime();
  for (let i = 0; i < count; i++) {
    const daysOffset = i % 120;
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysOffset);
    const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const hour = 8 + (i % 14);
    const min = (i * 7) % 60;
    const isIncome = i % 25 === 0;

    list[i] = {
      id: `perf-tx-${i}`,
      type: isIncome ? 'income' : 'expense',
      amount: isIncome ? 5000 + (i % 500) : 25 + ((i * 13) % 450),
      currency: 'EGP',
      date: dateStr,
      time: `${pad(hour)}:${pad(min)}`,
      categoryId: isIncome ? 'cat-salary' : catIds[i % catIds.length],
      walletId: walletIds[i % walletIds.length],
      notes: `معاملة تجريبية #${i}`,
      priority: i % 3 === 0 ? 'essential' : 'normal',
      doesNotAffectBalance: false,
      createdAt: baseTime - i * 1000,
      updatedAt: baseTime - i * 1000,
    };
  }

  return list;
}

// =============================================================================
// Monthly Summary, Budget Alerts (80% & 100%), Debt Reminders & Backup Chunking
// =============================================================================

export interface MonthlySummaryCategoryItem {
  categoryId: string;
  nameAr: string;
  nameEn: string;
  color: string;
  amount: number;
  sharePct: number;
}

export interface MonthlySummaryResult {
  hasData: boolean;
  currentMonthStr: string;
  previousMonthStr: string;
  thisMonthIncome: number;
  thisMonthExpense: number;
  prevMonthExpense: number;
  expenseDiffPct: number;
  topCategories: MonthlySummaryCategoryItem[];
}

export function calculateMonthlySummary(
  transactions: Transaction[],
  categories: Category[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  now: Date = new Date(),
  firstDayOfMonth = 1
): MonthlySummaryResult {
  const currentMonthStr = getActiveFiscalMonthStr(now, firstDayOfMonth);
  const previousMonthStr = getPreviousMonthStr(currentMonthStr);
  const curRange = getCustomMonthDateRange(currentMonthStr, firstDayOfMonth);
  const prevRange = getCustomMonthDateRange(previousMonthStr, firstDayOfMonth);

  let thisMonthIncome = 0;
  let thisMonthExpense = 0;
  let prevMonthExpense = 0;
  const byCat = new Map<string, number>();

  for (const tx of transactions) {
    if (!doesTransactionAffectAccounting(tx) || tx.type === 'transfer') continue;
    const inMain = convertCurrency(
      getEffectiveTransactionAmount(tx),
      tx.currency,
      mainCurrency,
      customRates
    );

    if (tx.date >= curRange.startDate && tx.date <= curRange.endDate) {
      if (tx.type === 'income') {
        thisMonthIncome += inMain;
      } else if (tx.type === 'expense') {
        thisMonthExpense += inMain;
        byCat.set(tx.categoryId, (byCat.get(tx.categoryId) || 0) + inMain);
      }
    } else if (
      tx.type === 'expense' &&
      tx.date >= prevRange.startDate &&
      tx.date <= prevRange.endDate
    ) {
      prevMonthExpense += inMain;
    }
  }

  thisMonthIncome = roundCurrency(thisMonthIncome, mainCurrency);
  thisMonthExpense = roundCurrency(thisMonthExpense, mainCurrency);
  prevMonthExpense = roundCurrency(prevMonthExpense, mainCurrency);

  if (thisMonthIncome === 0 && thisMonthExpense === 0 && prevMonthExpense === 0) {
    return {
      hasData: false,
      currentMonthStr,
      previousMonthStr,
      thisMonthIncome: 0,
      thisMonthExpense: 0,
      prevMonthExpense: 0,
      expenseDiffPct: 0,
      topCategories: [],
    };
  }

  const expenseDiffPct =
    prevMonthExpense > 0
      ? Math.round(((thisMonthExpense - prevMonthExpense) / prevMonthExpense) * 100)
      : thisMonthExpense > 0
      ? 100
      : 0;

  const topCategories: MonthlySummaryCategoryItem[] = Array.from(byCat.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([categoryId, amount]) => {
      const cat = categories.find((c) => c.id === categoryId);
      const rounded = roundCurrency(amount, mainCurrency);
      const sharePct = thisMonthExpense > 0 ? Math.round((rounded / thisMonthExpense) * 100) : 0;
      return {
        categoryId,
        nameAr: cat?.nameAr || 'أخرى',
        nameEn: cat?.nameEn || 'Other',
        color: cat?.color || '#7A7468',
        amount: rounded,
        sharePct,
      };
    });

  return {
    hasData: true,
    currentMonthStr,
    previousMonthStr,
    thisMonthIncome,
    thisMonthExpense,
    prevMonthExpense,
    expenseDiffPct,
    topCategories,
  };
}

export interface ActiveBudgetAlert {
  budgetId: string;
  budgetName: string;
  categoryId?: string;
  percentage: number;
  spent: number;
  remaining: number;
  level: 'warning' | 'exceeded';
}

export function getActiveBudgetAlerts(
  budgets: Budget[],
  transactions: Transaction[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  now: Date = new Date(),
  firstDayOfMonth = 1
): ActiveBudgetAlert[] {
  const currentMonth = getActiveFiscalMonthStr(now, firstDayOfMonth);
  const alerts: ActiveBudgetAlert[] = [];

  for (const b of budgets) {
    if (b.month !== currentMonth) continue;
    const progress = calculateBudgetProgress(b, transactions, mainCurrency, customRates, {
      firstDayOfMonth,
      allBudgets: budgets,
    });
    if (progress.isExceeded || progress.isWarning) {
      alerts.push({
        budgetId: b.id,
        budgetName: b.name,
        categoryId: b.categoryId,
        percentage: progress.percentage,
        spent: progress.spent,
        remaining: progress.remaining,
        level: progress.isExceeded ? 'exceeded' : 'warning',
      });
    }
  }

  return alerts.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'exceeded' ? -1 : 1;
    return b.percentage - a.percentage;
  });
}

export interface DebtReminderItem {
  debtId: string;
  personName: string;
  type: Debt['type'];
  remainingAmount: number;
  currency: string;
  dueDate: string;
  daysUntilDue: number;
  isOverdue: boolean;
}

export function getUpcomingDebtReminders(
  debts: Debt[],
  now: Date = new Date()
): DebtReminderItem[] {
  const todayStr = formatLocalDate(now);
  const reminders: DebtReminderItem[] = [];

  for (const debt of debts) {
    if (debt.isSettled || !debt.dueDate) continue;
    const remainingAmount = roundCurrency(debt.totalAmount - debt.paidAmount, debt.currency);
    if (remainingAmount <= 0) continue;

    const daysUntilDue = diffCalendarDays(todayStr, debt.dueDate);
    if (daysUntilDue <= 3) {
      reminders.push({
        debtId: debt.id,
        personName: debt.personName,
        type: debt.type,
        remainingAmount,
        currency: debt.currency,
        dueDate: debt.dueDate,
        daysUntilDue,
        isOverdue: daysUntilDue < 0,
      });
    }
  }

  return reminders.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

export function chunkTransactionsForBackup<T>(items: T[], chunkSize = 400): T[][] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const size = Math.max(1, Math.min(500, Math.floor(chunkSize)));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// =============================================================================
// Enterprise Accounting, VAT Engine, Cost Centers, Period Lock & Aging Report
// =============================================================================

export function isDateInLockedPeriod(dateStr: string, lockedUntilDate?: string): boolean {
  if (!lockedUntilDate || !dateStr) return false;
  return dateStr <= lockedUntilDate;
}

export function calculateVatBreakdown(
  amount: number,
  vatRate: number,
  isTaxInclusive: boolean,
  currencyCode = 'EGP'
): { netAmount: number; taxAmount: number; grossAmount: number } {
  const cleanAmount = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const rate = Math.max(0, Number.isFinite(vatRate) ? vatRate : 0);
  if (rate <= 0 || cleanAmount <= 0) {
    return {
      netAmount: roundCurrency(cleanAmount, currencyCode),
      taxAmount: 0,
      grossAmount: roundCurrency(cleanAmount, currencyCode),
    };
  }

  if (isTaxInclusive) {
    const netAmount = roundCurrency(cleanAmount / (1 + rate / 100), currencyCode);
    const taxAmount = roundCurrency(cleanAmount - netAmount, currencyCode);
    return {
      netAmount,
      taxAmount,
      grossAmount: roundCurrency(cleanAmount, currencyCode),
    };
  }

  const taxAmount = roundCurrency((cleanAmount * rate) / 100, currencyCode);
  const grossAmount = roundCurrency(cleanAmount + taxAmount, currencyCode);
  return {
    netAmount: roundCurrency(cleanAmount, currencyCode),
    taxAmount,
    grossAmount,
  };
}

/**
 * Integer minor-unit VAT calculator (zero floating-point rounding drift).
 */
export function calculateVatBreakdownMinor(
  amountMinor: number,
  vatRate: number,
  isTaxInclusive: boolean
): { netMinor: number; taxMinor: number; grossMinor: number } {
  const cleanMinor = Math.max(0, Math.round(Number.isFinite(amountMinor) ? amountMinor : 0));
  const rate = Math.max(0, Number.isFinite(vatRate) ? vatRate : 0);
  if (rate <= 0 || cleanMinor <= 0) {
    return { netMinor: cleanMinor, taxMinor: 0, grossMinor: cleanMinor };
  }
  if (isTaxInclusive) {
    const netMinor = Math.round((cleanMinor * 100) / (100 + rate));
    const taxMinor = cleanMinor - netMinor;
    return { netMinor, taxMinor, grossMinor: cleanMinor };
  }
  const taxMinor = Math.round((cleanMinor * rate) / 100);
  return { netMinor: cleanMinor, taxMinor, grossMinor: cleanMinor + taxMinor };
}

export interface EnterprisePnLResult {
  grossRevenue: number;
  netRevenueExTax: number;
  totalExpensesGross: number;
  netExpensesExTax: number;
  operatingProfit: number;
  outputVat: number;
  inputVat: number;
  netVatPayable: number;
  expenseByCategory: Array<{ categoryId: string; nameAr: string; nameEn: string; amount: number; pct: number }>;
  revenueByCategory: Array<{ categoryId: string; nameAr: string; nameEn: string; amount: number; pct: number }>;
}

export function calculateEnterprisePnL(
  transactions: Transaction[],
  categories: Category[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  startDate?: string,
  endDate?: string
): EnterprisePnLResult {
  let grossRevenue = 0;
  let netRevenueExTax = 0;
  let totalExpensesGross = 0;
  let netExpensesExTax = 0;
  let outputVat = 0;
  let inputVat = 0;

  const expCatMap = new Map<string, number>();
  const revCatMap = new Map<string, number>();

  for (const tx of transactions) {
    if (!doesTransactionAffectAccounting(tx) || tx.type === 'transfer') continue;
    if (startDate && tx.date < startDate) continue;
    if (endDate && tx.date > endDate) continue;

    const effectiveAmount = getEffectiveTransactionAmount(tx);
    const grossInMain = convertCurrency(effectiveAmount, tx.currency, mainCurrency, customRates);
    const effectiveTax =
      tx.vat && typeof tx.vat.amountMinor === 'number'
        ? fromMinor(tx.vat.amountMinor, tx.currency)
        : tx.taxAmount || 0;
    const taxInMain = effectiveTax
      ? convertCurrency(effectiveTax, tx.currency, mainCurrency, customRates)
      : 0;
    const netInMain = Math.max(0, grossInMain - taxInMain);

    if (tx.type === 'income') {
      grossRevenue += grossInMain;
      netRevenueExTax += netInMain;
      outputVat += taxInMain;
      revCatMap.set(tx.categoryId, (revCatMap.get(tx.categoryId) || 0) + netInMain);
    } else if (tx.type === 'expense') {
      totalExpensesGross += grossInMain;
      netExpensesExTax += netInMain;
      inputVat += taxInMain;
      expCatMap.set(tx.categoryId, (expCatMap.get(tx.categoryId) || 0) + netInMain);
    }
  }

  grossRevenue = roundCurrency(grossRevenue, mainCurrency);
  netRevenueExTax = roundCurrency(netRevenueExTax, mainCurrency);
  totalExpensesGross = roundCurrency(totalExpensesGross, mainCurrency);
  netExpensesExTax = roundCurrency(netExpensesExTax, mainCurrency);
  outputVat = roundCurrency(outputVat, mainCurrency);
  inputVat = roundCurrency(inputVat, mainCurrency);

  const operatingProfit = roundCurrency(netRevenueExTax - netExpensesExTax, mainCurrency);
  const netVatPayable = roundCurrency(outputVat - inputVat, mainCurrency);

  const mapRows = (m: Map<string, number>, total: number) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([categoryId, val]) => {
        const cat = categories.find((c) => c.id === categoryId);
        const amount = roundCurrency(val, mainCurrency);
        return {
          categoryId,
          nameAr: cat?.nameAr || 'أخرى',
          nameEn: cat?.nameEn || 'Other',
          amount,
          pct: total > 0 ? Math.round((amount / total) * 100) : 0,
        };
      });

  return {
    grossRevenue,
    netRevenueExTax,
    totalExpensesGross,
    netExpensesExTax,
    operatingProfit,
    outputVat,
    inputVat,
    netVatPayable,
    expenseByCategory: mapRows(expCatMap, netExpensesExTax),
    revenueByCategory: mapRows(revCatMap, netRevenueExTax),
  };
}

export interface CostCenterSummary {
  costCenterId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  budgetAllocated: number;
  spent: number;
  revenue: number;
  remaining: number;
  utilizationPct: number;
  txCount: number;
}

export function calculateCostCenterReport(
  costCenters: CostCenter[],
  transactions: Transaction[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  startDate?: string,
  endDate?: string
): CostCenterSummary[] {
  return costCenters.map((cc) => {
    let spent = 0;
    let revenue = 0;
    let txCount = 0;

    for (const tx of transactions) {
      if (tx.costCenterId !== cc.id || !doesTransactionAffectAccounting(tx)) continue;
      if (startDate && tx.date < startDate) continue;
      if (endDate && tx.date > endDate) continue;

      const val = convertCurrency(getEffectiveTransactionAmount(tx), tx.currency, mainCurrency, customRates);
      if (tx.type === 'expense') {
        spent += val;
        txCount++;
      } else if (tx.type === 'income') {
        revenue += val;
        txCount++;
      }
    }

    spent = roundCurrency(spent, mainCurrency);
    revenue = roundCurrency(revenue, mainCurrency);
    const allocated = roundCurrency(cc.budgetAllocated, mainCurrency);
    const remaining = roundCurrency(allocated - spent, mainCurrency);
    const utilizationPct = allocated > 0 ? Math.round((spent / allocated) * 100) : spent > 0 ? 100 : 0;

    return {
      costCenterId: cc.id,
      code: cc.code,
      nameAr: cc.nameAr,
      nameEn: cc.nameEn,
      budgetAllocated: allocated,
      spent,
      revenue,
      remaining,
      utilizationPct,
      txCount,
    };
  });
}

export interface AgingBuckets {
  bucket0_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90Plus: number;
  total: number;
}

export interface PartyAgingRow extends AgingBuckets {
  partyId: string;
  name: string;
  type: BusinessParty['type'];
  currency: string;
  dueDate?: string;
  daysOverdue: number;
}

export interface AgingReportResult {
  payablesTotal: number;
  receivablesTotal: number;
  payablesBuckets: AgingBuckets;
  receivablesBuckets: AgingBuckets;
  parties: PartyAgingRow[];
}

export function calculateAgingReport(
  parties: BusinessParty[],
  mainCurrency: string,
  customRates?: Record<string, number>,
  referenceDateStr: string = formatLocalDate()
): AgingReportResult {
  const emptyBuckets = (): AgingBuckets => ({
    bucket0_30: 0,
    bucket31_60: 0,
    bucket61_90: 0,
    bucket90Plus: 0,
    total: 0,
  });

  const payablesBuckets = emptyBuckets();
  const receivablesBuckets = emptyBuckets();
  const rows: PartyAgingRow[] = [];

  for (const party of parties) {
    const balanceMain = roundCurrency(
      convertCurrency(Math.abs(party.balance), party.currency, mainCurrency, customRates),
      mainCurrency
    );
    if (balanceMain <= 0) continue;

    const daysOverdue = party.dueDate
      ? Math.max(0, diffCalendarDays(party.dueDate, referenceDateStr))
      : 0;

    const row: PartyAgingRow = {
      partyId: party.id,
      name: party.name,
      type: party.type,
      currency: party.currency,
      dueDate: party.dueDate,
      daysOverdue,
      bucket0_30: 0,
      bucket31_60: 0,
      bucket61_90: 0,
      bucket90Plus: 0,
      total: balanceMain,
    };

    const target = party.type === 'vendor' ? payablesBuckets : receivablesBuckets;
    if (daysOverdue <= 30) {
      row.bucket0_30 = balanceMain;
      target.bucket0_30 = roundCurrency(target.bucket0_30 + balanceMain, mainCurrency);
    } else if (daysOverdue <= 60) {
      row.bucket31_60 = balanceMain;
      target.bucket31_60 = roundCurrency(target.bucket31_60 + balanceMain, mainCurrency);
    } else if (daysOverdue <= 90) {
      row.bucket61_90 = balanceMain;
      target.bucket61_90 = roundCurrency(target.bucket61_90 + balanceMain, mainCurrency);
    } else {
      row.bucket90Plus = balanceMain;
      target.bucket90Plus = roundCurrency(target.bucket90Plus + balanceMain, mainCurrency);
    }
    target.total = roundCurrency(target.total + balanceMain, mainCurrency);

    rows.push(row);
  }

  return {
    payablesTotal: payablesBuckets.total,
    receivablesTotal: receivablesBuckets.total,
    payablesBuckets,
    receivablesBuckets,
    parties: rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.total - a.total),
  };
}

export interface MoneyCircleSummary {
  totalPoolAmount: number;
  paidCount: number;
  remainingMonths: number;
  totalPaid: number;
  totalRemaining: number;
  progressPct: number;
  isCompleted: boolean;
  nextUnpaidMonthNumber: number | null;
}

/**
 * Pure summary calculation for Personal Money Circles (الجمعيات المالية)
 */
export function calculateMoneyCircleSummary(circle: MoneyCircle): MoneyCircleSummary {
  const totalMonths = Math.max(1, Math.floor(circle.totalMonths || 1));
  const monthlyShare = Math.max(0, Number(circle.monthlyShare || 0));
  const uniquePaid = Array.from(new Set(circle.paidMonths || [])).filter(Boolean);
  const paidCount = Math.min(totalMonths, uniquePaid.length);
  const remainingMonths = Math.max(0, totalMonths - paidCount);
  const totalPoolAmount = roundCurrency(monthlyShare * totalMonths, circle.currency);
  const totalPaid = roundCurrency(monthlyShare * paidCount, circle.currency);
  const totalRemaining = roundCurrency(monthlyShare * remainingMonths, circle.currency);
  const progressPct = Math.min(100, Math.round((paidCount / totalMonths) * 100));
  const isCompleted = paidCount >= totalMonths && circle.hasReceivedPayout;

  const paidSet = new Set(uniquePaid);
  let nextUnpaidMonthNumber: number | null = null;
  for (let m = 1; m <= totalMonths; m++) {
    if (!paidSet.has(String(m))) {
      nextUnpaidMonthNumber = m;
      break;
    }
  }

  return {
    totalPoolAmount,
    paidCount,
    remainingMonths,
    totalPaid,
    totalRemaining,
    progressPct,
    isCompleted,
    nextUnpaidMonthNumber,
  };
}

/**
 * Generates sequential organization payment/receipt voucher numbers:
 * RV-0001 (Receipt Voucher / سند قبض), PV-0001 (Payment Voucher / سند صرف), TV-0001 (Transfer)
 */
export function generateNextVoucherNumber(
  transactions: Pick<Transaction, 'type' | 'voucherNumber'>[],
  type: Transaction['type']
): string {
  const prefix = type === 'income' ? 'RV' : type === 'expense' ? 'PV' : 'TV';
  let maxNum = 0;
  for (const tx of transactions) {
    if (!tx.voucherNumber) continue;
    const match = tx.voucherNumber.trim().toUpperCase().match(/^(RV|PV|TV)-(\d+)$/);
    if (match && match[1] === prefix) {
      const parsed = parseInt(match[2], 10);
      if (Number.isFinite(parsed) && parsed > maxNum) {
        maxNum = parsed;
      }
    }
  }
  return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
}

/**
 * Applies partial updates to a Wallet and deterministically adjusts `balance`,
 * `initialBalanceMinor`, and `balanceMinor` whenever `initialBalance` changes
 * (unless `balance` is explicitly overridden in `updates`).
 */
export function applyWalletUpdates(wallet: Wallet, updates: Partial<Wallet>): Wallet {
  const merged: Wallet = {
    ...wallet,
    ...updates,
  };
  const targetCurrency = merged.currency || wallet.currency || 'EGP';
  const nextInitial = roundCurrency(
    Number.isFinite(Number(merged.initialBalance)) ? Number(merged.initialBalance) : 0,
    targetCurrency
  );

  let nextBalance: number;
  if (updates.balance !== undefined && Number.isFinite(Number(updates.balance))) {
    nextBalance = roundCurrency(Number(updates.balance), targetCurrency);
  } else if (
    updates.initialBalance !== undefined &&
    Number.isFinite(Number(updates.initialBalance))
  ) {
    const prevInitial = Number.isFinite(Number(wallet.initialBalance))
      ? Number(wallet.initialBalance)
      : 0;
    const prevBalance = Number.isFinite(Number(wallet.balance)) ? Number(wallet.balance) : 0;
    const delta = nextInitial - prevInitial;
    nextBalance = roundCurrency(prevBalance + delta, targetCurrency);
  } else {
    nextBalance = roundCurrency(
      Number.isFinite(Number(merged.balance)) ? Number(merged.balance) : 0,
      targetCurrency
    );
  }

  return {
    ...merged,
    currency: targetCurrency,
    initialBalance: nextInitial,
    balance: nextBalance,
    initialBalanceMinor: toMinor(nextInitial, targetCurrency),
    balanceMinor: toMinor(nextBalance, targetCurrency),
  };
}


