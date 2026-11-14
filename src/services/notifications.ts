/**
 * Real Notification Builder & Browser Notification API Dispatcher
 */
import { AppNotificationItem, AppSettings, Budget, Debt, Transaction } from '../types';
import { getActiveBudgetAlerts, getUpcomingDebtReminders } from './calculations';

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
    const todayKey = new Date().toISOString().slice(0, 10);
    const dedupeKey = tag ? `raseedi_notif_sent:${todayKey}:${tag}` : null;
    if (dedupeKey && typeof window.sessionStorage !== 'undefined') {
      if (window.sessionStorage.getItem(dedupeKey)) return false;
      window.sessionStorage.setItem(dedupeKey, '1');
    }

    new Notification(title, {
      body,
      tag: tag || 'raseedi-alert',
      icon: '/pwa-192x192.png',
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
  now?: Date;
}): AppNotificationItem[] {
  const { budgets, transactions, debts, settings, pendingApprovalsCount = 0, now = new Date() } = params;
  const items: AppNotificationItem[] = [];

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
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
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
