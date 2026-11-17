import { Transaction } from '../types';

export interface MonthlyCashflowProgress {
  income: number;
  expense: number;
  net: number;
  incomeSharePct: number;
  expenseSharePct: number;
  expenseToIncomeRatioPct: number;
  status: 'empty' | 'healthy' | 'balanced' | 'overspent';
}

/**
 * Computes visual progress metrics comparing current month income vs. expenses.
 */
export function computeMonthlyCashflowProgress(
  incomeRaw: number,
  expenseRaw: number
): MonthlyCashflowProgress {
  const income = Number.isFinite(incomeRaw) && incomeRaw > 0 ? incomeRaw : 0;
  const expense = Number.isFinite(expenseRaw) && expenseRaw > 0 ? expenseRaw : 0;
  const net = income - expense;
  const totalVolume = income + expense;

  if (totalVolume <= 0) {
    return {
      income: 0,
      expense: 0,
      net: 0,
      incomeSharePct: 50,
      expenseSharePct: 0,
      expenseToIncomeRatioPct: 0,
      status: 'empty',
    };
  }

  const incomeSharePct = Math.round((income / totalVolume) * 100);
  const expenseSharePct = 100 - incomeSharePct;
  const expenseToIncomeRatioPct =
    income > 0 ? Math.min(999, Math.round((expense / income) * 100)) : 100;

  let status: MonthlyCashflowProgress['status'] = 'healthy';
  if (expense > income) {
    status = 'overspent';
  } else if (income > 0 && expense > income * 0.7) {
    status = 'balanced';
  }

  return {
    income,
    expense,
    net,
    incomeSharePct,
    expenseSharePct,
    expenseToIncomeRatioPct,
    status,
  };
}

/**
 * Returns the most recent transactions sorted descending by date, time, and createdAt.
 */
export function getRecentTransactions(
  transactions: Transaction[],
  limit = 6
): Transaction[] {
  if (!Array.isArray(transactions) || transactions.length === 0 || limit <= 0) {
    return [];
  }

  return [...transactions]
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      const timeA = a.time || '00:00';
      const timeB = b.time || '00:00';
      if (timeA !== timeB) return timeB.localeCompare(timeA);
      return (b.createdAt || 0) - (a.createdAt || 0);
    })
    .slice(0, limit);
}
