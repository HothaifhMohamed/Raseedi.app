import { Transaction } from '../types';

export function isFirestoreMissingIndexError(err: unknown): boolean {
  if (!err) return false;
  const record =
    typeof err === 'object' ? (err as { code?: unknown; message?: unknown; details?: unknown }) : null;
  const code = record?.code ? String(record.code).toLowerCase() : '';
  const msg =
    typeof err === 'string'
      ? err.toLowerCase()
      : `${String(record?.message || '')} ${String(record?.details || '')}`.toLowerCase();

  if (code === 'failed-precondition' || code === '9') {
    return msg.includes('index') || msg.includes('precondition');
  }
  return (
    msg.includes('requires an index') ||
    msg.includes('failed-precondition') ||
    msg.includes('missing index') ||
    (msg.includes('index') && msg.includes('console.firebase.google.com'))
  );
}

export function sortTransactionsDescending(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => {
    const dateA = a.date || '';
    const dateB = b.date || '';
    if (dateA !== dateB) return dateB.localeCompare(dateA);

    const timeA = a.time || '';
    const timeB = b.time || '';
    if (timeA !== timeB) return timeB.localeCompare(timeA);

    const createdA = Number(a.createdAt || a.updatedAt || 0);
    const createdB = Number(b.createdAt || b.updatedAt || 0);
    return createdB - createdA;
  });
}

export function mergeTransactionsById(
  primary: Transaction[],
  secondary: Transaction[]
): Transaction[] {
  const byId = new Map<string, Transaction>();
  for (const tx of secondary) {
    if (tx && tx.id) byId.set(tx.id, tx);
  }
  for (const tx of primary) {
    if (!tx || !tx.id) continue;
    const existing = byId.get(tx.id);
    if (!existing || Number(tx.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
      byId.set(tx.id, tx);
    }
  }
  return sortTransactionsDescending(Array.from(byId.values()));
}

export function filterTransactionsByDateRange(
  txs: Transaction[],
  startDate: string,
  endDate: string
): Transaction[] {
  return sortTransactionsDescending(
    txs.filter((tx) => {
      if (tx.deletedAt) return false;
      if (startDate && (tx.date || '') < startDate) return false;
      if (endDate && (tx.date || '') > endDate) return false;
      return true;
    })
  );
}
