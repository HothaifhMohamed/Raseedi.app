/**
 * Real Notification Builder & Browser Notification API Dispatcher
 */
import { AppNotificationItem, AppSettings, Budget, Debt, Transaction } from '../types';
import { formatLocalDate, getActiveBudgetAlerts, getUpcomingDebtReminders } from './calculations';
import type { OrgSubscriptionState } from './entitlements';
import type { UserSubscriptionSummary } from './subscriptionHelpers';

export function isWebNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestBrowserNotificationPermission(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (!isWebNotificationSupported()) return 'unsupported';
  try {
    if (Notification.permission === 'granted') return 'granted';
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return 'denied';
  }
}

export function dispatchBrowserNotification(title: string, body: string, tag?: string): boolean {
  if (!isWebNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }
  try {
    const todayKey = formatLocalDate(new Date());
    const dedupeKey = tag ? `raseedi_notif_sent:${todayKey}:${tag}` : null;
    if (dedupeKey && typeof window.sessionStorage !== 'undefined') {
      if (window.sessionStorage.getItem(dedupeKey)) return false;
      window.sessionStorage.setItem(dedupeKey, '1');
    }

    new Notification(title, {
      body,
      tag: tag || 'raseedi-alert',
      icon: '/app-icon.png',
    });
    return true;
  } catch {
    return false;
  }
}

export function buildAppNotifications(params: {
  budgets: Budget[];
  transactions: Transaction[];
  debts: Debt[];
  settings: AppSettings;
  pendingApprovalsCount?: number;
  isOrgWorkspace?: boolean;
  orgName?: string;
  orgSubscriptionState?: OrgSubscriptionState | null;
  userSubscriptionSummary?: UserSubscriptionSummary | null;
  now?: Date;
}): AppNotificationItem[] {
  const {
    budgets,
    transactions,
    debts,
    settings,
    pendingApprovalsCount = 0,
    isOrgWorkspace = false,
    orgName = '',
    orgSubscriptionState = null,
    userSubscriptionSummary = null,
    now = new Date(),
  } = params;
  const items: AppNotificationItem[] = [];

  // 0a. Personal/User Subscription 7-day Expiry Warning
  if (
    userSubscriptionSummary &&
    userSubscriptionSummary.isExpiringSoon &&
    userSubscriptionSummary.daysRemaining !== null &&
    !userSubscriptionSummary.isAdminOverride
  ) {
    const daysLeft = userSubscriptionSummary.daysRemaining;
    const tierLabelAr =
      userSubscriptionSummary.planTier === 'business_pro'
        ? 'Business PRO للأعمال'
        : 'Personal PRO للأفراد';
    const tierLabelEn =
      userSubscriptionSummary.planTier === 'business_pro' ? 'Business PRO' : 'Personal PRO';
    items.push({
      id: `notif-user-sub-expiring-${daysLeft}`,
      type: 'user_subscription_expiring',
      titleAr: daysLeft <= 1 ? 'ينتهي اشتراكك خلال يوم' : 'قرب انتهاء اشتراكك',
      titleEn: daysLeft <= 1 ? 'Subscription Ends Soon' : 'Subscription Expiring Soon',
      messageAr: `متبقي ${daysLeft} ${daysLeft === 1 ? 'يوم' : daysLeft <= 10 ? 'أيام' : 'يوماً'} على انتهاء باقة ${tierLabelAr}. يمكنك تجديد الاشتراك أو تغيير الباقة الآن.`,
      messageEn: `${daysLeft} day(s) left on your ${tierLabelEn} subscription. Renew or change plan anytime.`,
      severity: daysLeft <= 3 ? 'danger' : 'warning',
      timestamp: now.getTime(),
      read: false,
      actionTarget: 'upgrade',
    });
  }

  // 0. Organization Subscription Lifecycle Alerts (only paid/trial orgs within <= 7d or grace/expired, never free)
  const isPaidOrTrialOrg =
    orgSubscriptionState &&
    orgSubscriptionState.planTier !== 'free' &&
    orgSubscriptionState.billingCycle !== 'free';
  if (
    isOrgWorkspace &&
    isPaidOrTrialOrg &&
    orgSubscriptionState.expiryNotificationStage !== 'none' &&
    (orgSubscriptionState.expiryNotificationStage === 'grace' ||
      orgSubscriptionState.expiryNotificationStage === 'expired' ||
      (orgSubscriptionState.daysRemaining !== null && orgSubscriptionState.daysRemaining <= 7))
  ) {
    const stage = orgSubscriptionState.expiryNotificationStage;
    const label = orgName ? `"${orgName}"` : '';
    if (stage === 'expired') {
      items.push({
        id: `notif-org-sub-expired`,
        type: 'org_subscription_readonly',
        titleAr: 'المؤسسة في وضع القراءة فقط',
        titleEn: 'Organization in Read-Only Mode',
        messageAr: `انتهت فترة باقة الأعمال للمؤسسة ${label}. يمكنك التصدير والطباعة فقط — جدّد باقة Business PRO لاستئناف الإضافة والاعتمادات.`,
        messageEn: `Business subscription ended for ${label || 'this organization'}. Export & print remain available; renew Business PRO to resume writes.`,
        severity: 'danger',
        timestamp: now.getTime(),
        read: false,
        actionTarget: 'upgrade',
      });
    } else if (stage === 'grace') {
      const graceLeft = orgSubscriptionState.graceDaysRemaining ?? 0;
      items.push({
        id: `notif-org-sub-grace-${graceLeft}`,
        type: 'org_subscription_grace',
        titleAr: 'فترة سماح باقة المؤسسة',
        titleEn: 'Organization Grace Period',
        messageAr: `انتهت باقة المؤسسة ${label} وتبقّى ${graceLeft} يوم في فترة السماح قبل التحول لوضع القراءة فقط.`,
        messageEn: `Subscription expired for ${label || 'this organization'}. ${graceLeft} grace day(s) remaining before Read-Only mode.`,
        severity: 'danger',
        timestamp: now.getTime(),
        read: false,
        actionTarget: 'upgrade',
      });
    } else {
      const daysLeft = orgSubscriptionState.daysRemaining ?? 0;
      items.push({
        id: `notif-org-sub-expiring-${stage}`,
        type: 'org_subscription_expiring',
        titleAr:
          stage === '0d'
            ? 'تنتهي باقة المؤسسة اليوم'
            : 'قرب انتهاء اشتراك المؤسسة',
        titleEn:
          stage === '0d'
            ? 'Organization Subscription Ends Today'
            : 'Organization Subscription Expiring Soon',
        messageAr:
          stage === '0d'
            ? `تنتهي باقة Business PRO للمؤسسة ${label} خلال أقل من 24 ساعة.`
            : `يتبقّى ${daysLeft} يوم على انتهاء باقة Business PRO للمؤسسة ${label}.`,
        messageEn:
          stage === '0d'
            ? `Business PRO for ${label || 'this organization'} expires within 24 hours.`
            : `${daysLeft} day(s) left on Business PRO for ${label || 'this organization'}.`,
        severity: stage === '0d' || stage === '3d' ? 'danger' : 'warning',
        timestamp: now.getTime(),
        read: false,
        actionTarget: 'upgrade',
      });
    }
  }

  // 1. Pending org approvals
  if (pendingApprovalsCount > 0) {
    items.push({
      id: `notif-approvals-${pendingApprovalsCount}`,
      type: 'pending_approval',
      titleAr: 'معاملات بانتظار الاعتماد',
      titleEn: 'Pending Approvals',
      messageAr: `يوجد ${pendingApprovalsCount} معاملة / طلب استرداد بانتظار المراجعة والاعتماد.`,
      messageEn: `${pendingApprovalsCount} expense or reimbursement request(s) awaiting review.`,
      severity: 'warning',
      timestamp: now.getTime(),
      read: false,
      actionTarget: 'approvals',
    });
  }

  // 2. Budget alerts (80% warning & 100% exceeded)
  if (settings.budgetAlertsEnabled !== false) {
    const budgetAlerts = getActiveBudgetAlerts(
      budgets,
      transactions,
      settings.mainCurrency,
      settings.customExchangeRates,
      now,
      settings.firstDayOfMonth
    );

    for (const alert of budgetAlerts) {
      items.push({
        id: `notif-budget-${alert.budgetId}-${alert.level}`,
        type: alert.level === 'exceeded' ? 'budget_exceeded' : 'budget_warning',
        titleAr: alert.level === 'exceeded' ? 'تجاوز الميزانية' : 'تنبيه اقتراب حد الميزانية',
        titleEn: alert.level === 'exceeded' ? 'Budget Exceeded' : 'Budget Warning',
        messageAr:
          alert.level === 'exceeded'
            ? `تجاوزت ميزانية "${alert.budgetName}" بنسبة ${alert.percentage}%.`
            : `وصلت ميزانية "${alert.budgetName}" إلى ${alert.percentage}% من الحد المسموح.`,
        messageEn:
          alert.level === 'exceeded'
            ? `Budget "${alert.budgetName}" reached ${alert.percentage}% of its limit.`
            : `Budget "${alert.budgetName}" is at ${alert.percentage}% usage.`,
        severity: alert.level === 'exceeded' ? 'danger' : 'warning',
        timestamp: now.getTime(),
        read: false,
        actionTarget: 'budget',
      });
    }
  }

  // 3. Upcoming / Overdue debt reminders
  if (settings.debtRemindersEnabled !== false) {
    const debtReminders = getUpcomingDebtReminders(debts, now);
    for (const d of debtReminders) {
      items.push({
        id: `notif-debt-${d.debtId}`,
        type: d.isOverdue ? 'debt_overdue' : 'debt_due',
        titleAr: d.isOverdue ? 'دين مستحق متأخر' : 'موعد استحقاق دين قريب',
        titleEn: d.isOverdue ? 'Overdue Debt' : 'Upcoming Debt Due',
        messageAr: d.isOverdue
          ? `${d.personName}: متأخر بـ ${Math.abs(d.daysUntilDue)} يوم (${d.remainingAmount} ${d.currency}).`
          : `${d.personName}: يستحق خلال ${d.daysUntilDue} يوم (${d.remainingAmount} ${d.currency}).`,
        messageEn: d.isOverdue
          ? `${d.personName}: Overdue by ${Math.abs(d.daysUntilDue)} day(s) (${d.remainingAmount} ${d.currency}).`
          : `${d.personName}: Due in ${d.daysUntilDue} day(s) (${d.remainingAmount} ${d.currency}).`,
        severity: d.isOverdue ? 'danger' : 'warning',
        timestamp: now.getTime(),
        read: false,
        actionTarget: 'debts',
      });
    }
  }

  // 4. Daily reminder if enabled and no transactions logged today
  if (settings.notificationsEnabled) {
    const todayStr = formatLocalDate(now);
    const hasTodayTx = transactions.some((t) => t.date === todayStr);
    if (!hasTodayTx) {
      items.push({
        id: `notif-daily-${todayStr}`,
        type: 'daily_reminder',
        titleAr: 'تذكير يومي بتسجيل المصاريف',
        titleEn: 'Daily Expense Reminder',
        messageAr: 'لم تسجل أي معاملات اليوم بعد — حافظ على دقة ميزانيتك.',
        messageEn: 'No transactions logged today yet — keep your ledger up to date.',
        severity: 'info',
        timestamp: now.getTime(),
        read: false,
        actionTarget: 'add',
      });
    }
  }

  return items;
}
