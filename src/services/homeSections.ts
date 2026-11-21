/**
 * Pure per-workspace Home Dashboard section ordering and Get Started checklist helpers.
 * Persists synchronously to localStorage alongside AppSettings so refresh restores
 * the exact section layout with zero jump or flicker.
 */
import { Budget, HomeSectionId, SavingsGoal, Transaction, Wallet } from '../types';

export const HOME_SECTION_ORDER_LS_PREFIX = 'raseedi_home_sections_v1_';
export const DISMISSED_GET_STARTED_LS_KEY = 'raseedi_dismissed_get_started_v1';

export const DEFAULT_PERSONAL_HOME_SECTIONS: HomeSectionId[] = [
  'hero',
  'quick_actions',
  'get_started',
  'net_worth',
  'cashflow_metrics',
  'insights',
  'alerts',
  'recent_transactions',
];

export const DEFAULT_ORG_HOME_SECTIONS: HomeSectionId[] = [
  'hero',
  'quick_actions',
  'cashflow_metrics',
  'insights',
  'alerts',
  'recent_transactions',
];

export interface HomeSectionMeta {
  id: HomeSectionId;
  labelAr: string;
  labelEn: string;
  descriptionAr: string;
  descriptionEn: string;
  personalOnly?: boolean;
}

export const HOME_SECTION_METADATA: Record<HomeSectionId, HomeSectionMeta> = {
  hero: {
    id: 'hero',
    labelAr: 'ملخص الرصيد والتدفق',
    labelEn: 'Balance & Cashflow Hero',
    descriptionAr: 'الرصيد المتاح وصافي التدفق الشهري',
    descriptionEn: 'Available balance and monthly cashflow',
  },
  quick_actions: {
    id: 'quick_actions',
    labelAr: 'الإجراءات السريعة',
    labelEn: 'Quick Actions',
    descriptionAr: 'اختصارات فورية لإضافة عملية أو محفظة أو ميزانية',
    descriptionEn: 'Fast shortcuts to add transactions, wallets, or budgets',
  },
  get_started: {
    id: 'get_started',
    labelAr: 'بطاقات البدء السريع',
    labelEn: 'Get Started Cards',
    descriptionAr: 'خطوات تأسيس حسابك المالي (قابلة للإخفاء)',
    descriptionEn: 'Dismissible setup tasks for your workspace',
    personalOnly: true,
  },
  net_worth: {
    id: 'net_worth',
    labelAr: 'صافي الثروة والأصول',
    labelEn: 'Net Worth & Assets',
    descriptionAr: 'الأصول والسيولة مقابل الديون مع تطور الثروة',
    descriptionEn: 'Assets and spendable cash vs debt with trend chart',
    personalOnly: true,
  },
  cashflow_metrics: {
    id: 'cashflow_metrics',
    labelAr: 'صافي التدفق ومعدل الادخار',
    labelEn: 'Net Cashflow & Savings Rate',
    descriptionAr: 'مؤشر التدفق النقدي ونسبة الادخار للفترة الحالية',
    descriptionEn: 'Period net cashflow and savings percentage',
  },
  insights: {
    id: 'insights',
    labelAr: 'حد الصرف اليومي والإحصائيات',
    labelEn: 'Daily Safe-to-Spend & Stats',
    descriptionAr: 'الحد اليومي الآمن واختصار الإحصائيات والقوالب',
    descriptionEn: 'Daily safe limit, statistics, and quick templates',
  },
  alerts: {
    id: 'alerts',
    labelAr: 'التنبيهات الذكية',
    labelEn: 'Smart Alerts',
    descriptionAr: 'تنبيهات الميزانيات والديون والموافقات',
    descriptionEn: 'Budget warnings, debt reminders, and approvals',
  },
  recent_transactions: {
    id: 'recent_transactions',
    labelAr: 'أحدث المعاملات',
    labelEn: 'Recent Transactions',
    descriptionAr: 'آخر الحركات المالية المسجلة',
    descriptionEn: 'Latest recorded financial activity',
  },
};

export function getDefaultHomeSectionOrder(isOrgWorkspace: boolean): HomeSectionId[] {
  return isOrgWorkspace ? [...DEFAULT_ORG_HOME_SECTIONS] : [...DEFAULT_PERSONAL_HOME_SECTIONS];
}

export function resolveHomeSectionOrder(
  savedOrder: HomeSectionId[] | undefined | null,
  isOrgWorkspace: boolean
): HomeSectionId[] {
  const defaults = getDefaultHomeSectionOrder(isOrgWorkspace);
  const allowed = new Set<HomeSectionId>(defaults);
  const result: HomeSectionId[] = [];
  const seen = new Set<HomeSectionId>();

  if (Array.isArray(savedOrder)) {
    for (const id of savedOrder) {
      if (allowed.has(id) && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }

  for (const id of defaults) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result;
}

export function moveHomeSection(
  order: HomeSectionId[],
  sectionId: HomeSectionId,
  direction: 'up' | 'down'
): HomeSectionId[] {
  const idx = order.indexOf(sectionId);
  if (idx === -1) return order;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= order.length) return order;
  const next = [...order];
  const [moved] = next.splice(idx, 1);
  next.splice(targetIdx, 0, moved);
  return next;
}

export function loadHomeSectionOrderSync(
  workspaceKey: string,
  settingsOrder?: HomeSectionId[],
  isOrgWorkspace = false
): HomeSectionId[] {
  const safeKey = (workspaceKey || 'personal').trim() || 'personal';
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(`${HOME_SECTION_ORDER_LS_PREFIX}${safeKey}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return resolveHomeSectionOrder(parsed as HomeSectionId[], isOrgWorkspace);
        }
      }
    } catch {
      // ignore localStorage read errors
    }
  }
  return resolveHomeSectionOrder(settingsOrder, isOrgWorkspace);
}

export function saveHomeSectionOrderSync(workspaceKey: string, order: HomeSectionId[]): void {
  const safeKey = (workspaceKey || 'personal').trim() || 'personal';
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${HOME_SECTION_ORDER_LS_PREFIX}${safeKey}`, JSON.stringify(order));
  } catch {
    // ignore quota errors
  }
}

export function loadDismissedGetStartedSync(settingsIds?: string[]): string[] {
  const merged = new Set<string>(Array.isArray(settingsIds) ? settingsIds : []);
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(DISMISSED_GET_STARTED_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === 'string' && id.trim()) merged.add(id.trim());
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return Array.from(merged);
}

export function saveDismissedGetStartedSync(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISMISSED_GET_STARTED_LS_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export type GetStartedTaskId =
  | 'add_wallet_or_asset'
  | 'record_first_income'
  | 'set_monthly_budget'
  | 'add_savings_goal';

export interface GetStartedCardItem {
  id: GetStartedTaskId;
  titleAr: string;
  titleEn: string;
  subtitleAr: string;
  subtitleEn: string;
  ctaAr: string;
  ctaEn: string;
}

export function evaluateGetStartedCards(params: {
  wallets: Wallet[];
  transactions: Transaction[];
  budgets: Budget[];
  goals: SavingsGoal[];
  dismissedIds: string[];
}): GetStartedCardItem[] {
  const { wallets, transactions, budgets, goals, dismissedIds } = params;
  const dismissed = new Set(dismissedIds || []);
  const cards: GetStartedCardItem[] = [];

  const activeWallets = wallets.filter((w) => !w.isArchived);
  const hasRealWalletSetup =
    activeWallets.length > 1 ||
    activeWallets.some((w) => w.balance !== 0 || w.initialBalance !== 0 || w.assetClass === 'asset');

  if (!hasRealWalletSetup && !dismissed.has('add_wallet_or_asset')) {
    cards.push({
      id: 'add_wallet_or_asset',
      titleAr: 'أضف محافظك وأصولك',
      titleEn: 'Add Wallets & Assets',
      subtitleAr: 'فرّق بين السيولة المتاحة للصرف والمدخرات أو الذهب والشهادات.',
      subtitleEn: 'Separate spendable cash from savings, gold, or investments.',
      ctaAr: 'إضافة محفظة / أصل',
      ctaEn: 'Add Wallet / Asset',
    });
  }

  const hasIncome = transactions.some((t) => !t.deletedAt && t.type === 'income');
  if (!hasIncome && !dismissed.has('record_first_income')) {
    cards.push({
      id: 'record_first_income',
      titleAr: 'سجّل دخلك الشهري',
      titleEn: 'Record Your Income',
      subtitleAr: 'لحساب معدل الادخار وصافي التدفق النقدي بدقة.',
      subtitleEn: 'Unlock accurate savings rate and net cashflow tracking.',
      ctaAr: 'تسجيل دخل',
      ctaEn: 'Add Income',
    });
  }

  if (budgets.length === 0 && !dismissed.has('set_monthly_budget')) {
    cards.push({
      id: 'set_monthly_budget',
      titleAr: 'حدّد ميزانيتك الشهرية',
      titleEn: 'Set a Monthly Budget',
      subtitleAr: 'تابع حد الصرف اليومي وتلقَّ تنبيهات قبل تجاوز الميزانية.',
      subtitleEn: 'Track your daily safe limit and get alerts before overspending.',
      ctaAr: 'إعداد ميزانية',
      ctaEn: 'Create Budget',
    });
  }

  if (goals.length === 0 && cards.length < 3 && !dismissed.has('add_savings_goal')) {
    cards.push({
      id: 'add_savings_goal',
      titleAr: 'أنشئ هدف ادخار',
      titleEn: 'Create a Savings Goal',
      subtitleAr: 'خصّص هدفاً للطوارئ أو السفر وتابع تقدّمك خطوة بخطوة.',
      subtitleEn: 'Set an emergency or milestone goal and track progress.',
      ctaAr: 'إضافة هدف',
      ctaEn: 'Add Goal',
    });
  }

  return cards;
}
