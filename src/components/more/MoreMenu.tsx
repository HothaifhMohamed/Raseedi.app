import React, { useState } from 'react';
import {
  FileText,
  Save,
  Layers,
  Tag,
  User,
  Repeat,
  Coins,
  Settings as SettingsIcon,
  HandCoins,
  Target,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Crown,
  X,
  ShieldCheck,
  Headphones,
  Mail,
  MessageCircle,
  ExternalLink,
  ClipboardCheck,
  FolderKanban,
  Users,
  FileSpreadsheet,
  Building2,
  CircleDollarSign,
  UploadCloud,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ReportsModal } from './ReportsModal';
import { BackupModal } from './BackupModal';
import { CategoriesManagerModal } from './CategoriesManagerModal';
import { SettingsModal } from './SettingsModal';
import { DebtsPage } from '../debts/DebtsPage';
import { GoalsPage } from '../goals/GoalsPage';
import { AdBanner } from '../common/AdBanner';
import { SupportAndLegalModal } from './SupportAndLegalModal';
import { MoneyCirclesModal } from './MoneyCirclesModal';
import { SUPPORT_CONFIG } from '../../constants/support';

export const MoreMenu: React.FC = () => {
  const {
    isOrgWorkspace,
    activeOrganization,
    orgCostCenters,
    orgParties,
    orgMembers,
    activeOrgSubscriptionState,
    legacyLocalOrgs,
    openOrgMigrationModal,
    pendingApprovalsCount,
    openOrgHub,
    transactions,
    categories,
    debts,
    goals,
    moneyCircles,
    settings,
    openCurrencyPicker,
    updateSettings,
    isPro,
    setIsUpgradeModalOpen,
    t,
    isRTL,
  } = useApp();

  const [reportsOpen, setReportsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moneyCirclesOpen, setMoneyCirclesOpen] = useState(false);
  const [supportLegalTab, setSupportLegalTab] = useState<'support' | 'legal' | null>(null);
  const [activeSubModal, setActiveSubModal] = useState<string | null>(null);

  // Computed Groups list with totals
  const groupsList = React.useMemo(() => {
    const map = new Map<string, { count: number; totalExpense: number; totalIncome: number }>();
    transactions.forEach((tx) => {
      if (tx.group?.trim()) {
        const g = tx.group.trim();
        const cur = map.get(g) || { count: 0, totalExpense: 0, totalIncome: 0 };
        cur.count++;
        if (tx.type === 'expense') cur.totalExpense += tx.amount;
        if (tx.type === 'income') cur.totalIncome += tx.amount;
        map.set(g, cur);
      }
    });
    return Array.from(map.entries()).map(([name, data]) => ({ name, ...data }));
  }, [transactions]);

  // Computed Contacts list with counts
  const contactsList = React.useMemo(() => {
    const map = new Map<string, { count: number; totalExpense: number }>();
    transactions.forEach((tx) => {
      if (tx.contact?.trim()) {
        const c = tx.contact.trim();
        const cur = map.get(c) || { count: 0, totalExpense: 0 };
        cur.count++;
        if (tx.type === 'expense') cur.totalExpense += tx.amount;
        map.set(c, cur);
      }
    });
    return Array.from(map.entries()).map(([name, data]) => ({ name, ...data }));
  }, [transactions]);

  // Recurring rules
  const recurringRules = React.useMemo(() => {
    return transactions.filter((tx) => tx.isRecurring && tx.recurrenceRule);
  }, [transactions]);

  const ArrowIcon = isRTL ? ChevronLeft : ChevronRight;

  return (
    <div className="flex flex-col flex-1 px-4 py-3 pb-24 space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* 1. PRO UPGRADE / STATUS HERO CARD (Bare accent icon, no tinted square) */}
      <div
        onClick={() => setIsUpgradeModalOpen(true)}
        className="cursor-pointer p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] shadow-sm hover:border-[var(--color-accent)] transition-all flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          {isPro ? (
            <Crown className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
          ) : (
            <Sparkles className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="font-title text-sm font-bold text-[var(--color-ink)]">
                {isPro ? (
                  isRTL ? (
                    <>
                      رصيدي <bdi dir="ltr">PRO</bdi> مفعّل
                    </>
                  ) : (
                    'Raseedi PRO Active'
                  )
                ) : isRTL ? (
                  <>
                    الترقية إلى رصيدي <bdi dir="ltr">PRO</bdi>
                  </>
                ) : (
                  'Upgrade to Raseedi PRO'
                )}
              </h2>
              {!isPro && (
                <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                  {isRTL ? 'مميز' : 'PRO'}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              {isPro ? (
                isRTL ? (
                  'جميع الميزات الاحترافية مفتوحة بالكامل بدون حدود'
                ) : (
                  'All professional features unlocked without limits'
                )
              ) : isRTL ? (
                <>
                  محافظ غير محدودة، تقارير <bdi dir="ltr">PDF</bdi>، ميزانيات مخصصة، وبدون إعلانات
                </>
              ) : (
                'Unlimited wallets, PDF reports, category budgets, ad-free'
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-medium hover:opacity-95 transition-opacity min-h-[38px]"
        >
          {isPro ? (isRTL ? 'إدارة' : 'Manage') : isRTL ? 'ترقية' : 'Upgrade'}
        </button>
      </div>

      {/* LEGACY LOCAL ORGS MIGRATION BANNER */}
      {legacyLocalOrgs.length > 0 && (
        <button
          type="button"
          onClick={openOrgMigrationModal}
          className="w-full p-3.5 rounded-xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/35 hover:border-[var(--color-accent)] flex items-center justify-between gap-3 text-start transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <UploadCloud className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-[var(--color-ink)] truncate">
                {t('migrateLocalOrgsTitle')}
              </div>
              <div className="text-[11px] text-[var(--color-muted)] truncate">
                {isRTL
                  ? `${legacyLocalOrgs.length} مؤسسة محلية جاهزة للترحيل إلى السحابة`
                  : `${legacyLocalOrgs.length} local organization(s) ready to migrate`}
              </div>
            </div>
          </div>
          <ArrowIcon className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
        </button>
      )}

      {/* ENTERPRISE SECTION (Active Organization Workspace) */}
      {isOrgWorkspace && activeOrganization && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-semibold text-[var(--color-accent)] uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>{isRTL ? `إدارة الشركة — ${activeOrganization.name}` : `Enterprise — ${activeOrganization.name}`}</span>
            </h3>
            <button
              type="button"
              data-testid="more-open-org-hub-btn"
              onClick={() => openOrgHub('approvals')}
              className="text-[11px] font-bold text-[var(--color-accent)] hover:underline min-h-[32px] px-1"
            >
              {isRTL ? 'فتح المركز الشامل' : 'Open Full Hub'}
            </button>
          </div>
          <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden divide-y divide-[var(--color-line)]">
            {/* Approvals Queue */}
            <button
              type="button"
              onClick={() => openOrgHub('approvals')}
              className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
            >
              <div className="flex items-center gap-3">
                <ClipboardCheck className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                <div>
                  <div className="font-semibold text-[var(--color-ink)] flex items-center gap-2">
                    <span>{t('approvalsQueue')}</span>
                    {pendingApprovalsCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-[var(--color-warning)]/20 text-[var(--color-warning-text)] text-[10px] font-bold num-tabular">
                        {pendingApprovalsCount}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {isRTL ? 'مراجعة واعتماد مصاريف وعهد الموظفين' : 'Review & approve team expenses'}
                  </div>
                </div>
              </div>
              <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
            </button>

            {/* Cost Centers */}
            <button
              type="button"
              onClick={() => openOrgHub('cost_centers')}
              className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
            >
              <div className="flex items-center gap-3">
                <FolderKanban className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
                <div>
                  <div className="font-semibold text-[var(--color-ink)]">{t('costCenters')}</div>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {isRTL ? `${orgCostCenters.length} مركز تكلفة ومشروع` : `${orgCostCenters.length} active cost centers`}
                  </div>
                </div>
              </div>
              <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
            </button>

            {/* Vendors, Clients & Aging */}
            <button
              type="button"
              onClick={() => openOrgHub('parties')}
              className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
            >
              <div className="flex items-center gap-3">
                <HandCoins className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
                <div>
                  <div className="font-semibold text-[var(--color-ink)]">{t('vendorsAndClients')}</div>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {isRTL ? `${orgParties.length} مورد وعميل • أعمار الديون` : `${orgParties.length} vendors & clients • Aging`}
                  </div>
                </div>
              </div>
              <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
            </button>

            {/* Team, RBAC & Petty Cash */}
            <button
              type="button"
              onClick={() => openOrgHub('team')}
              className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
            >
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
                <div>
                  <div className="font-semibold text-[var(--color-ink)]">{t('teamAndRoles')}</div>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {isRTL
                      ? `${orgMembers.length} / ${activeOrgSubscriptionState?.seatLimit ?? activeOrganization.seatLimit ?? 5} مقاعد • عُهد وصلاحيات`
                      : `${orgMembers.length} / ${activeOrgSubscriptionState?.seatLimit ?? activeOrganization.seatLimit ?? 5} seats • Roles & petty cash`}
                  </div>
                </div>
              </div>
              <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
            </button>

            {/* Enterprise Reports, Vouchers & Audit Log */}
            <button
              type="button"
              onClick={() => openOrgHub('reports')}
              className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
            >
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
                <div>
                  <div className="font-semibold text-[var(--color-ink)]">{t('enterpriseReports')}</div>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {isRTL ? 'الأرباح والخسائر، الضريبة، السندات المطبوعة، والتدقيق' : 'P&L, VAT, printable vouchers & audit log'}
                  </div>
                </div>
              </div>
              <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
            </button>
          </div>
        </div>
      )}

      {/* SECTION 1: MONEY (المال والمعاملات) */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-[var(--color-muted)] px-1 uppercase tracking-wider">
          {isRTL ? 'المال والمعاملات' : 'Money & Accounts'}
        </h3>
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden divide-y divide-[var(--color-line)]">
          {/* Currencies & Rates */}
          <button
            onClick={() =>
              openCurrencyPicker((code) => updateSettings({ mainCurrency: code }), settings.mainCurrency)
            }
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <Coins className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">{t('currenciesRates')}</div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL ? (
                    <>
                      150+ عملة وأسعار حية (الرئيسية: <bdi dir="ltr">{settings.mainCurrency}</bdi>)
                    </>
                  ) : (
                    `150+ currencies & live rates (${settings.mainCurrency})`
                  )}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>

          {/* Debts & Installments / Vendors & Clients */}
          <button
            onClick={() => (isOrgWorkspace ? openOrgHub('parties') : setActiveSubModal('debts'))}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <HandCoins className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">
                  {isOrgWorkspace ? t('vendorsAndClients') : t('debtsTitle')}
                </div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isOrgWorkspace
                    ? isRTL
                      ? `الموردون والعملاء وأعمار الديون (${orgParties.length})`
                      : `Vendors, clients & aging (${orgParties.length})`
                    : isRTL
                    ? `سجل المستحقات والديون والأقساط (${debts.length})`
                    : `Debts & installments record (${debts.length})`}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>

          {/* Categories Manager */}
          <button
            onClick={() => setCategoriesOpen(true)}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <Layers className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">{t('categoriesManager')}</div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL ? `${categories.length} تصنيف متاح مخصص` : `${categories.length} custom categories`}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>
        </div>
      </div>

      {/* SECTION 2: PLANNING (التخطيط المالي) */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-[var(--color-muted)] px-1 uppercase tracking-wider">
          {isRTL ? 'التخطيط المالي' : 'Financial Planning'}
        </h3>
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden divide-y divide-[var(--color-line)]">
          {/* Savings Goals */}
          <button
            onClick={() => setActiveSubModal('goals')}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <Target className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">{t('goalsTitle')}</div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL ? `أهداف الادخار وصناديق الطوارئ (${goals.length})` : `Savings goals & emergency funds (${goals.length})`}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>

          {/* Personal Money Circles (الجمعيات المالية) */}
          {!isOrgWorkspace && (
            <button
              type="button"
              data-testid="more-money-circles-btn"
              onClick={() => setMoneyCirclesOpen(true)}
              className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
            >
              <div className="flex items-center gap-3">
                <CircleDollarSign className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                <div>
                  <div className="font-semibold text-[var(--color-ink)]">{t('moneyCircles')}</div>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {isRTL
                      ? `الجمعيات المالية للأفراد ومواعيد القبض (${moneyCircles.length})`
                      : `Rotating savings circles & payout turns (${moneyCircles.length})`}
                  </div>
                </div>
              </div>
              <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
            </button>
          )}

          {/* Recurring Rules */}
          <button
            onClick={() => setActiveSubModal('recurring')}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <Repeat className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">{t('recurringRulesManager')}</div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL ? `المعاملات الدورية المجدولة تلقائياً (${recurringRules.length})` : `Scheduled recurring rules (${recurringRules.length})`}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>

          {/* Groups & Tags */}
          <button
            onClick={() => setActiveSubModal('groups')}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <Tag className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">{t('groupsManager')}</div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL ? `المجموعات والأوسمة والمناسبات (${groupsList.length})` : `Groups & tags (${groupsList.length})`}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>

          {/* Contacts */}
          <button
            onClick={() => setActiveSubModal('contacts')}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">{t('contactsManager')}</div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL ? `جهات الاتصال والمدفوع لهم (${contactsList.length})` : `Contacts & payees (${contactsList.length})`}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>
        </div>
      </div>

      {/* SECTION 3: DATA (البيانات والتقارير) */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-[var(--color-muted)] px-1 uppercase tracking-wider">
          {isRTL ? 'البيانات والتقارير' : 'Data & Reports'}
        </h3>
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden divide-y divide-[var(--color-line)]">
          {/* Reports */}
          <button
            onClick={() => setReportsOpen(true)}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">{t('reports')}</div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL ? (
                    <>
                      تقارير أسبوعية وشهرية وتصدير <bdi dir="ltr">PDF</bdi> / <bdi dir="ltr">CSV</bdi>
                    </>
                  ) : (
                    'Weekly & monthly reports, export PDF / CSV'
                  )}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>

          {/* Backup & Restore */}
          <button
            onClick={() => setBackupOpen(true)}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <Save className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">{t('backupAndRestore')}</div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL ? (
                    <>
                      مزامنة <bdi dir="ltr">Google</bdi> السحابية + <bdi dir="ltr">JSON</bdi> و <bdi dir="ltr">CSV</bdi>
                    </>
                  ) : (
                    'Google Cloud Sync + JSON / CSV backup'
                  )}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>
        </div>
      </div>

      {/* SECTION 4: SETTINGS (الإعدادات والتطبيق) */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-[var(--color-muted)] px-1 uppercase tracking-wider">
          {isRTL ? 'الإعدادات والتطبيق' : 'Settings & Preferences'}
        </h3>
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl overflow-hidden divide-y divide-[var(--color-line)]">
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <SettingsIcon className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">{t('settings')}</div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL ? 'اللغة والمظهر والعملات والرمز السري والخيارات' : 'Language, theme, PIN, and general options'}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>

          {/* Support & Contact */}
          <button
            type="button"
            onClick={() => setSupportLegalTab('support')}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <Headphones className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">
                  {isRTL ? 'الدعم الفني والتواصل' : 'Support & Contact'}
                </div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL
                    ? 'البريد الإلكتروني، واتساب، وصفحات التواصل الاجتماعي'
                    : 'Email, WhatsApp, Facebook & Instagram channels'}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>

          {/* Privacy Policy & Terms */}
          <button
            type="button"
            onClick={() => setSupportLegalTab('legal')}
            className="w-full p-3.5 flex items-center justify-between text-xs hover:bg-[var(--color-bg)] transition-colors text-start min-h-[44px]"
          >
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-[var(--color-muted)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-ink)]">
                  {isRTL ? (
                    <>
                      سياسة الخصوصية والشروط{' '}
                      <bdi dir="ltr">(Privacy Policy &amp; Terms)</bdi>
                    </>
                  ) : (
                    'Privacy Policy & Terms'
                  )}
                </div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {isRTL
                    ? 'ملفات الارتباط، حفظ البيانات محلياً، وشروط الاستخدام'
                    : 'Cookies, offline-first data privacy & terms of use'}
                </div>
              </div>
            </div>
            <ArrowIcon className="w-4 h-4 text-[var(--color-muted)]" />
          </button>
        </div>
      </div>

      {/* Direct Support Card */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--color-muted)]">
          <span>{isRTL ? 'تواصل سريع مع فريق رَصِيدِي' : 'Quick Contact & Support'}</span>
          <button
            type="button"
            onClick={() => setSupportLegalTab('support')}
            className="text-[var(--color-accent)] hover:underline"
          >
            {isRTL ? 'تخصيص الروابط' : 'Edit Links'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a
            href={`mailto:${SUPPORT_CONFIG.email}`}
            className="px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] flex items-center gap-2 text-xs text-[var(--color-ink)] transition-colors min-h-[44px]"
          >
            <Mail className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
            <span className="truncate font-medium">
              {isRTL ? 'تواصل معنا عبر البريد' : 'Email Support'}
            </span>
          </a>
          <a
            href={SUPPORT_CONFIG.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] flex items-center gap-2 text-xs text-[var(--color-ink)] transition-colors min-h-[44px]"
          >
            <MessageCircle className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
            <span className="truncate font-medium">
              {isRTL ? 'واتساب مباشر' : 'WhatsApp'}
            </span>
          </a>
        </div>
      </div>

      {/* SECTION 5: FOLLOW US ON SOCIAL MEDIA (تابعنا على مواقع التواصل) */}
      <div className="space-y-1.5" data-testid="follow-us-section">
        <h3 className="text-xs font-semibold text-[var(--color-muted)] px-1 uppercase tracking-wider">
          {t('followUs')}
        </h3>
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <a
              href={settings.socialLinks?.facebookUrl?.trim() || SUPPORT_CONFIG.defaultFacebookUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="social-link-facebook"
              className="group px-3 py-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[#1877F2]/60 flex items-center justify-between gap-2.5 text-xs text-[var(--color-ink)] transition-colors min-h-[50px]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  aria-hidden="true"
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[#1877F2]/12 text-[#1877F2]"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                    <path d="M13.5 22v-8h2.7l.4-3h-3.1V9.1c0-.9.3-1.5 1.6-1.5h1.7V4.9c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1V11H7.7v3h2.7v8h3.1z" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--color-ink)] truncate">
                    {t('facebookPage')}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted)] truncate">
                    {isRTL ? 'الصفحة الرسمية على فيسبوك' : 'Official Facebook Page'}
                  </div>
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-[var(--color-muted)] group-hover:text-[#1877F2] shrink-0 transition-colors" />
            </a>

            <a
              href={settings.socialLinks?.instagramUrl?.trim() || SUPPORT_CONFIG.defaultInstagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="social-link-instagram"
              className="group px-3 py-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[#E1306C]/60 flex items-center justify-between gap-2.5 text-xs text-[var(--color-ink)] transition-colors min-h-[50px]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  aria-hidden="true"
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[#E1306C]/12 text-[#E1306C]"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--color-ink)] truncate">
                    {t('instagramPage')}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted)] truncate">
                    <bdi dir="ltr">@raseedi.app</bdi>
                  </div>
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-[var(--color-muted)] group-hover:text-[#E1306C] shrink-0 transition-colors" />
            </a>
          </div>
        </div>
      </div>

      {/* Free-tier unobtrusive bottom banner */}
      <AdBanner variant="banner" />

      {/* Quick Footer Link for AdSense Reviewers & Users */}
      <div className="pt-1 pb-2 text-center">
        <button
          type="button"
          onClick={() => setSupportLegalTab('legal')}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)] underline underline-offset-4 transition-colors min-h-[44px]"
        >
          {isRTL ? (
            <>
              سياسة الخصوصية وشروط الاستخدام{' '}
              <bdi dir="ltr">(Privacy Policy &amp; Terms)</bdi>
            </>
          ) : (
            'Privacy Policy & Terms of Use'
          )}
        </button>
      </div>

      {/* Modals */}
      <ReportsModal isOpen={reportsOpen} onClose={() => setReportsOpen(false)} />
      <BackupModal isOpen={backupOpen} onClose={() => setBackupOpen(false)} />
      <CategoriesManagerModal isOpen={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MoneyCirclesModal isOpen={moneyCirclesOpen} onClose={() => setMoneyCirclesOpen(false)} />
      <SupportAndLegalModal
        isOpen={supportLegalTab !== null}
        initialTab={supportLegalTab || 'support'}
        onClose={() => setSupportLegalTab(null)}
      />

      {/* Debts Sub-Modal */}
      {activeSubModal === 'debts' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)] text-[var(--color-ink)] overflow-y-auto">
          <div className="sticky top-0 z-30 p-3 bg-[var(--color-surface)] border-b border-[var(--color-line)] flex items-center justify-between">
            <span className="font-title text-sm font-bold">
              {isOrgWorkspace
                ? t('vendorsAndClients')
                : isRTL
                ? 'الديون والأقساط'
                : 'Debts & Installments'}
            </span>
            <button
              onClick={() => setActiveSubModal(null)}
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg border border-[var(--color-line)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 max-w-lg mx-auto w-full">
            <DebtsPage />
          </div>
        </div>
      )}

      {/* Goals Sub-Modal */}
      {activeSubModal === 'goals' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)] text-[var(--color-ink)] overflow-y-auto">
          <div className="sticky top-0 z-30 p-3 bg-[var(--color-surface)] border-b border-[var(--color-line)] flex items-center justify-between">
            <span className="font-title text-sm font-bold">{isRTL ? 'أهداف الادخار' : 'Savings Goals'}</span>
            <button
              onClick={() => setActiveSubModal(null)}
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg border border-[var(--color-line)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 max-w-lg mx-auto w-full">
            <GoalsPage />
          </div>
        </div>
      )}

      {/* Groups Sub-Modal */}
      {activeSubModal === 'groups' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-3">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Tag className="w-4 h-4 text-[var(--color-warning-text)]" />
                <span>{t('groupsManager')}</span>
              </h3>
              <button onClick={() => setActiveSubModal(null)} className="p-1 text-[var(--color-muted)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {groupsList.length === 0 ? (
                <div className="text-center py-8 text-xs text-[var(--color-muted)]">
                  {isRTL
                    ? 'لا توجد مجموعات أو وسوم مسجلة بعد. أضف وسماً أثناء تسجيل أي معاملة (مثل #سفر، #زفاف).'
                    : 'No groups or tags recorded yet. Add tags like #trip when recording transactions.'}
                </div>
              ) : (
                groupsList.map((g) => (
                  <div
                    key={g.name}
                    className="p-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-[var(--color-ink)]">#{g.name}</span>
                      <span className="text-[10px] text-[var(--color-muted)] block">
                        {g.count} {isRTL ? 'معاملة مسجلة' : 'transactions'}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-[var(--color-expense)] num-tabular">
                      −{g.totalExpense} {settings.mainCurrency}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contacts Sub-Modal */}
      {activeSubModal === 'contacts' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-3">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <User className="w-4 h-4 text-[var(--color-accent)]" />
                <span>{t('contactsManager')}</span>
              </h3>
              <button onClick={() => setActiveSubModal(null)} className="p-1 text-[var(--color-muted)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {contactsList.length === 0 ? (
                <div className="text-center py-8 text-xs text-[var(--color-muted)]">
                  {isRTL ? 'لا توجد جهات اتصال مسجلة بعد.' : 'No contacts recorded yet.'}
                </div>
              ) : (
                contactsList.map((c) => (
                  <div
                    key={c.name}
                    className="p-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-[var(--color-ink)]">{c.name}</span>
                      <span className="text-[10px] text-[var(--color-muted)] block">
                        {c.count} {isRTL ? 'معاملة مرتبطة' : 'transactions linked'}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-[var(--color-ink)] num-tabular">
                      {c.totalExpense} {settings.mainCurrency}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recurring Rules Sub-Modal */}
      {activeSubModal === 'recurring' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-3">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Repeat className="w-4 h-4 text-[var(--color-accent)]" />
                <span>{t('recurringRulesManager')}</span>
              </h3>
              <button onClick={() => setActiveSubModal(null)} className="p-1 text-[var(--color-muted)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {recurringRules.length === 0 ? (
                <div className="text-center py-8 text-xs text-[var(--color-muted)]">
                  {isRTL ? 'لا توجد معاملات متكررة نشطة حالياً.' : 'No active recurring rules.'}
                </div>
              ) : (
                recurringRules.map((tx) => (
                  <div
                    key={tx.id}
                    className="p-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-bold text-[var(--color-ink)]">
                      <span>{tx.notes || (isRTL ? 'معاملة دورية' : 'Recurring rule')}</span>
                      <span className="font-mono text-[var(--color-income)] num-tabular">
                        {tx.amount} {tx.currency}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--color-muted)]">
                      {isRTL ? 'تتكرر:' : 'Repeats:'} {tx.recurrenceRule?.frequency} • {isRTL ? 'الموعد القادم:' : 'Next due:'} {tx.recurrenceRule?.nextDueDate}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
