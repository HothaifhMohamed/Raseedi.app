/**
 * Pure Merchant / Keyword Auto-Categorization Rules engine.
 * Works seamlessly across both Arabic and English merchant names/notes,
 * for manual entry (TransactionModal) and CSV/Excel import (csvImport.ts).
 */
import { MerchantRule, MerchantRuleMatchType, TransactionType } from '../types';
import { normalizeArabicText } from './dialectParser';

export const MAX_MERCHANT_RULES_PER_WORKSPACE = 100;

export function normalizeRuleKeyword(text: string): string {
  return normalizeArabicText(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MerchantRuleMatchResult {
  rule: MerchantRule;
  categoryId?: string;
  walletId?: string;
  costCenterId?: string;
}

/**
 * Matches a transaction description / merchant / notes text against enabled rules.
 * Specificity precedence: exact > starts_with > contains, then longest normalized keyword.
 */
export function matchMerchantRule(
  rawText: string,
  rules: MerchantRule[] | undefined | null,
  txType?: TransactionType
): MerchantRuleMatchResult | null {
  if (!rawText || !rules || rules.length === 0) return null;
  if (txType === 'transfer') return null;

  const normalizedText = normalizeRuleKeyword(rawText);
  if (!normalizedText) return null;

  let bestRule: MerchantRule | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    if (!rule || !rule.isEnabled) continue;
    const ruleType = rule.type || 'both';
    if (txType && ruleType !== 'both' && ruleType !== txType) continue;

    const normKeyword = normalizeRuleKeyword(rule.keyword);
    if (!normKeyword) continue;

    const matchType: MerchantRuleMatchType = rule.matchType || 'contains';
    let matched = false;
    let typePriority = 0;

    if (matchType === 'exact') {
      matched = normalizedText === normKeyword;
      typePriority = 3000;
    } else if (matchType === 'starts_with') {
      matched = normalizedText.startsWith(normKeyword);
      typePriority = 2000;
    } else {
      matched = normalizedText.includes(normKeyword);
      typePriority = 1000;
    }

    if (!matched) continue;

    const score = typePriority + normKeyword.length;
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  if (!bestRule) return null;

  return {
    rule: bestRule,
    categoryId: bestRule.categoryId || undefined,
    walletId: bestRule.walletId || undefined,
    costCenterId: bestRule.costCenterId || undefined,
  };
}

export function sanitizeMerchantRules(raw: unknown): MerchantRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: MerchantRule[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<MerchantRule>;
    const keyword = String(obj.keyword || '').trim().slice(0, 80);
    if (!keyword) continue;
    const id = String(obj.id || '').trim() || `mr-${Date.now()}-${result.length}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const matchType: MerchantRuleMatchType =
      obj.matchType === 'exact' || obj.matchType === 'starts_with' || obj.matchType === 'contains'
        ? obj.matchType
        : 'contains';
    const type: 'expense' | 'income' | 'both' =
      obj.type === 'expense' || obj.type === 'income' || obj.type === 'both'
        ? obj.type
        : 'both';

    result.push({
      id,
      keyword,
      matchType,
      type,
      ...(obj.categoryId ? { categoryId: String(obj.categoryId).trim() } : {}),
      ...(obj.walletId ? { walletId: String(obj.walletId).trim() } : {}),
      ...(obj.costCenterId ? { costCenterId: String(obj.costCenterId).trim() } : {}),
      isEnabled: obj.isEnabled !== false,
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
    });

    if (result.length >= MAX_MERCHANT_RULES_PER_WORKSPACE) break;
  }

  return result;
}
