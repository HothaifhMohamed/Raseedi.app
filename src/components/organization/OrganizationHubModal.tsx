import React, { useMemo, useState } from 'react';
import {
  Building2,
  ClipboardCheck,
  FolderKanban,
  HandCoins,
  Users,
  FileSpreadsheet,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  Edit2,
  Trash2,
  Copy,
  Check,
  Wallet as WalletIcon,
  Shield,
  Printer,
  Download,
  Lock,
  Unlock,
  FileText,
  Percent,
  TrendingUp,
  ShieldCheck,
  Briefcase,
  Receipt,
} from 'lucide-react';
import { useApp, OrgHubTab } from '../../context/AppContext';
import {
  calculateAgingReport,
  calculateCostCenterReport,
  calculateEnterprisePnL,
  formatCurrencyAmount,
  formatLocalDate,
} from '../../services/calculations';
import { MoneyText } from '../common/MoneyText';
import {
  BusinessParty,
  CostCenter,
  OrganizationRole,
  Transaction,
} from '../../types';

const ROLES: Array<{ id: OrganizationRole; labelAr: string; labelEn: string }> = [
  { id: 'owner', labelAr: 'المالك (Owner)', labelEn: 'Owner' },
  { id: 'admin', labelAr: 'مدير (Admin)', labelEn: 'Admin' },
  { id: 'accountant', labelAr: 'محاسب (Accountant)', labelEn: 'Accountant' },
  { id: 'employee', labelAr: 'موظف (Employee)', labelEn: 'Employee' },
  { id: 'viewer', labelAr: 'مشاهد فقط (Viewer)', labelEn: 'Viewer' },
];

type ReportSubTab = 'pnl_vat' | 'voucher' | 'settings_lock' | 'audit';

export const OrganizationHubModal: React.FC = () => {
  const {
    isOrgHubOpen,
    setIsOrgHubOpen,
    orgHubTab,
    setOrgHubTab,
    activeOrganization,
    orgMembers,
    orgCostCenters,
    orgParties,
    orgAuditLogs,
    transactions,
    wallets,
    categories,
    activeOrgRole,
    canOrgApprove,
    canOrgManage,
    pendingApprovalsCount,
    approveOrgTransaction,
    rejectOrgTransaction,
    addCostCenter,
    updateCostCenter,
    deleteCostCenter,
    addBusinessParty,
    updateBusinessParty,
    deleteBusinessParty,
    addOrUpdateOrgMember,
    removeOrgMember,
    addWallet,
    updateWallet,
    addTransaction,
    updateOrganizationSettings,
    lockAccountingPeriod,
    settings,
    t,
    isRTL,
  } = useApp();

  // Tab 1: Approvals state
  const [approvalFilter, setApprovalFilter] = useState<'pending' | 'rejected' | 'approved'>('pending');
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Tab 2: Cost Centers state
  const [ccFormOpen, setCcFormOpen] = useState(false);
  const [editingCC, setEditingCC] = useState<CostCenter | null>(null);
  const [ccCode, setCcCode] = useState('');
  const [ccType, setCcType] = useState<'department' | 'project' | 'branch'>('department');
  const [ccNameAr, setCcNameAr] = useState('');
  const [ccNameEn, setCcNameEn] = useState('');
  const [ccBudget, setCcBudget] = useState('');

  // Tab 3: Business Parties & Aging state
  const [partyFormOpen, setPartyFormOpen] = useState(false);
  const [editingParty, setEditingParty] = useState<BusinessParty | null>(null);
  const [partyType, setPartyType] = useState<BusinessParty['type']>('vendor');
  const [partyName, setPartyName] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [partyTaxId, setPartyTaxId] = useState('');
  const [partyBalance, setPartyBalance] = useState('');
  const [partyDueDate, setPartyDueDate] = useState('');
  const [partyNotes, setPartyNotes] = useState('');
  const [settleParty, setSettleParty] = useState<BusinessParty | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleWalletId, setSettleWalletId] = useState('');

  // Tab 4: Team & Petty Cash Custody state
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [memberFormOpen, setMemberFormOpen] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<OrganizationRole>('employee');
  const [memberDept, setMemberDept] = useState('');
  const [memberLimit, setMemberLimit] = useState('');
  const [pettyFormOpen, setPettyFormOpen] = useState(false);
  const [pettyName, setPettyName] = useState('');
  const [pettyCustodianUid, setPettyCustodianUid] = useState('');
  const [pettyInitialBalance, setPettyInitialBalance] = useState('');

  // Tab 5: Reports, Voucher, Period Lock & Audit state
  const [reportSubTab, setReportSubTab] = useState<ReportSubTab>('pnl_vat');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedVoucherTxId, setSelectedVoucherTxId] = useState<string>('');
  const [auditFilter, setAuditFilter] = useState('');
  const [orgVatInput, setOrgVatInput] = useState(
    activeOrganization ? String(activeOrganization.vatRate) : '14'
  );
  const [orgTaxNumInput, setOrgTaxNumInput] = useState(activeOrganization?.taxNumber || '');
  const [orgThresholdInput, setOrgThresholdInput] = useState(
    activeOrganization ? String(activeOrganization.approvalThreshold) : '1000'
  );
  const [orgLockDateInput, setOrgLockDateInput] = useState(
    activeOrganization?.lockedUntilDate || ''
  );
  const [settingsSavedBanner, setSettingsSavedBanner] = useState(false);

  // Keep org inputs in sync when switching org
  React.useEffect(() => {
    if (!activeOrganization) return;
    setOrgVatInput(String(activeOrganization.vatRate ?? 14));
    setOrgTaxNumInput(activeOrganization.taxNumber || '');
    setOrgThresholdInput(String(activeOrganization.approvalThreshold ?? 1000));
    setOrgLockDateInput(activeOrganization.lockedUntilDate || '');
  }, [activeOrganization?.id]);

  const currency = activeOrganization?.currency || settings.mainCurrency;

  const approvalItems = useMemo(() => {
    return transactions.filter((tx) => {
      if (approvalFilter === 'pending') return tx.approvalStatus === 'pending_approval';
      if (approvalFilter === 'rejected') return tx.approvalStatus === 'rejected';
      return tx.approvalStatus === 'approved';
    });
  }, [transactions, approvalFilter]);

  const costCenterSummaries = useMemo(() => {
    return calculateCostCenterReport(
      orgCostCenters,
      transactions,
      currency,
      settings.customExchangeRates,
      startDate || undefined,
      endDate || undefined
    );
  }, [orgCostCenters, transactions, currency, settings.customExchangeRates, startDate, endDate]);

  const aging = useMemo(() => {
    return calculateAgingReport(orgParties, currency, settings.customExchangeRates);
  }, [orgParties, currency, settings.customExchangeRates]);

  const pnl = useMemo(() => {
    return calculateEnterprisePnL(
      transactions,
      categories,
      currency,
      settings.customExchangeRates,
      startDate || undefined,
      endDate || undefined
    );
  }, [transactions, categories, currency, settings.customExchangeRates, startDate, endDate]);

  const pettyCashWallets = useMemo(
    () => wallets.filter((w) => w.walletType === 'petty_cash' && !w.isArchived),
    [wallets]
  );

  const selectedVoucherTx: Transaction | undefined = useMemo(() => {
    if (selectedVoucherTxId) {
      const found = transactions.find((tx) => tx.id === selectedVoucherTxId);
      if (found) return found;
    }
    return transactions[0];
  }, [transactions, selectedVoucherTxId]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditFilter.trim().toLowerCase();
    if (!q) return orgAuditLogs.slice(0, 80);
    return orgAuditLogs
      .filter(
        (e) =>
          e.summary.toLowerCase().includes(q) ||
          e.actorName.toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [orgAuditLogs, auditFilter]);

  if (!isOrgHubOpen || !activeOrganization) return null;

  const roleLabel = (role: OrganizationRole) => {
    const map: Record<OrganizationRole, string> = {
      owner: t('roleOwner'),
      admin: t('roleAdmin'),
      accountant: t('roleAccountant'),
      employee: t('roleEmployee'),
      viewer: t('roleViewer'),
    };
    return map[role];
  };

  const ccTypeLabel = (type?: CostCenter['type']) => {
    if (type === 'project') return t('ccProject');
    if (type === 'branch') return t('ccBranch');
    return t('ccDepartment');
  };

  const handleOpenVoucherForTx = (txId: string) => {
    setSelectedVoucherTxId(txId);
    setOrgHubTab('reports');
    setReportSubTab('voucher');
  };

  const handlePrintVoucher = () => {
    document.body.classList.add('printing-voucher');
    setTimeout(() => {
      window.print();
      document.body.classList.remove('printing-voucher');
    }, 60);
  };

  const handleExportCsv = () => {
    const rows: string[][] = [
      ['Organization', activeOrganization.name],
      ['Tax Number', activeOrganization.taxNumber || '-'],
      ['Currency', currency],
      ['Gross Revenue', String(pnl.grossRevenue)],
      ['Net Revenue (Ex VAT)', String(pnl.netRevenueExTax)],
      ['Total Expenses (Gross)', String(pnl.totalExpensesGross)],
      ['Net Expenses (Ex VAT)', String(pnl.netExpensesExTax)],
      ['Operating Profit', String(pnl.operatingProfit)],
      ['Output VAT', String(pnl.outputVat)],
      ['Input VAT', String(pnl.inputVat)],
      ['Net VAT Payable', String(pnl.netVatPayable)],
      ['Receivables (AR)', String(aging.receivablesTotal)],
      ['Payables (AP)', String(aging.payablesTotal)],
    ];
    const csv = '\uFEFF' + rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `raseedi-org-${activeOrganization.inviteCode}-${formatLocalDate()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Cost Center Handlers
  const openNewCC = () => {
    setEditingCC(null);
    setCcCode(`CC-${String(orgCostCenters.length + 1).padStart(2, '0')}`);
    setCcType('department');
    setCcNameAr('');
    setCcNameEn('');
    setCcBudget('25000');
    setCcFormOpen(true);
  };

  const openEditCC = (cc: CostCenter) => {
    setEditingCC(cc);
    setCcCode(cc.code);
    setCcType(cc.type || 'department');
    setCcNameAr(cc.nameAr);
    setCcNameEn(cc.nameEn);
    setCcBudget(String(cc.budgetAllocated));
    setCcFormOpen(true);
  };

  const handleSaveCC = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ccNameAr.trim()) return;
    const payload = {
      code: ccCode.trim() || `CC-${orgCostCenters.length + 1}`,
      type: ccType,
      name: ccNameAr.trim(),
      nameAr: ccNameAr.trim(),
      nameEn: ccNameEn.trim() || ccNameAr.trim(),
      budgetAllocated: Number(ccBudget) || 0,
      isActive: true,
    };
    if (editingCC) {
      updateCostCenter(editingCC.id, payload);
    } else {
      addCostCenter(payload);
    }
    setCcFormOpen(false);
  };

  // Business Party Handlers
  const openNewParty = () => {
    setEditingParty(null);
    setPartyType('vendor');
    setPartyName('');
    setPartyPhone('');
    setPartyTaxId('');
    setPartyBalance('');
    setPartyDueDate(formatLocalDate());
    setPartyNotes('');
    setPartyFormOpen(true);
  };

  const openEditParty = (party: BusinessParty) => {
    setEditingParty(party);
    setPartyType(party.type);
    setPartyName(party.name);
    setPartyPhone(party.phone || '');
    setPartyTaxId(party.taxId || '');
    setPartyBalance(String(party.balance));
    setPartyDueDate(party.dueDate || '');
    setPartyNotes(party.notes || '');
    setPartyFormOpen(true);
  };

  const handleSaveParty = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim()) return;
    const payload = {
      type: partyType,
      name: partyName.trim(),
      phone: partyPhone.trim() || undefined,
      taxId: partyTaxId.trim() || undefined,
      currency,
      balance: Math.max(0, Number(partyBalance) || 0),
      dueDate: partyDueDate || undefined,
      notes: partyNotes.trim() || undefined,
    };
    if (editingParty) {
      updateBusinessParty(editingParty.id, payload);
    } else {
      addBusinessParty(payload);
    }
    setPartyFormOpen(false);
  };

  const handleConfirmPartySettlement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleParty) return;
    const amt = Number(settleAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;

    const remaining = Math.max(0, Number((settleParty.balance - amt).toFixed(2)));
    updateBusinessParty(settleParty.id, { balance: remaining });

    if (settleWalletId) {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const isVendorPayment = settleParty.type === 'vendor';
      const fallbackCat =
        categories.find((c) => c.type === (isVendorPayment ? 'expense' : 'income'))?.id ||
        categories[0]?.id ||
        'org-cat-suppliers';
      try {
        addTransaction({
          type: isVendorPayment ? 'expense' : 'income',
          amount: amt,
          currency: settleParty.currency || currency,
          date: formatLocalDate(now),
          time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
          categoryId: fallbackCat,
          walletId: settleWalletId,
          partyId: settleParty.id,
          notes: isRTL
            ? `${isVendorPayment ? 'سداد مستحقات مورد' : 'تحصيل دفعة من عميل'}: ${settleParty.name}`
            : `${isVendorPayment ? 'Vendor payment' : 'Client collection'}: ${settleParty.name}`,
          priority: 'essential',
          doesNotAffectBalance: false,
          approvalStatus: 'approved',
        });
      } catch {
        // Locked period guard handled silently on settlement ledger update
      }
    }

    setSettleParty(null);
    setSettleAmount('');
    setSettleWalletId('');
  };

  // Team & Petty Cash Handlers
  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberName.trim() || !memberEmail.trim()) return;
    addOrUpdateOrgMember({
      uid: `member-${Date.now()}`,
      email: memberEmail.trim().toLowerCase(),
      displayName: memberName.trim(),
      role: memberRole,
      department: memberDept.trim() || undefined,
      spendingLimit: memberLimit ? Number(memberLimit) : undefined,
      status: 'active',
    });
    setMemberName('');
    setMemberEmail('');
    setMemberDept('');
    setMemberLimit('');
    setMemberFormOpen(false);
  };

  const handleIssuePettyCash = (e: React.FormEvent) => {
    e.preventDefault();
    const custodian = orgMembers.find((m) => m.uid === pettyCustodianUid);
    const defaultName = custodian
      ? isRTL
        ? `عهدة ${custodian.displayName}`
        : `${custodian.displayName} Petty Cash`
      : isRTL
      ? 'عهدة موظف'
      : 'Employee Petty Cash';
    const amount = Number(pettyInitialBalance) || 0;

    addWallet({
      name: pettyName.trim() || defaultName,
      currency,
      initialBalance: amount,
      balance: amount,
      color: '#C99A2E',
      icon: 'Wallet',
      isArchived: false,
      order: wallets.length + 1,
      walletType: 'petty_cash',
      custodianMemberUid: pettyCustodianUid || undefined,
    });

    setPettyName('');
    setPettyCustodianUid('');
    setPettyInitialBalance('');
    setPettyFormOpen(false);
  };

  // Org Settings & Lock Handler
  const handleSaveOrgSettings = (e: React.FormEvent) => {
    e.preventDefault();
    updateOrganizationSettings({
      vatRate: Math.max(0, Math.min(50, Number(orgVatInput) || 0)),
      taxNumber: orgTaxNumInput.trim() || undefined,
      approvalThreshold: Math.max(0, Number(orgThresholdInput) || 0),
    });
    lockAccountingPeriod(orgLockDateInput.trim() || undefined);
    setSettingsSavedBanner(true);
    setTimeout(() => setSettingsSavedBanner(false), 2500);
  };

  const tabs: Array<{ id: OrgHubTab; icon: typeof ClipboardCheck; label: string; badge?: number }> = [
    {
      id: 'approvals',
      icon: ClipboardCheck,
      label: isRTL ? 'الاعتمادات' : 'Approvals',
      badge: pendingApprovalsCount,
    },
    {
      id: 'cost_centers',
      icon: FolderKanban,
      label: isRTL ? 'مراكز التكلفة' : 'Cost Centers',
    },
    {
      id: 'parties',
      icon: HandCoins,
      label: isRTL ? 'الموردون والعملاء' : 'Partners',
    },
    {
      id: 'team',
      icon: Users,
      label: isRTL ? 'الفريق والعُهد' : 'Team & Custody',
    },
    {
      id: 'reports',
      icon: FileSpreadsheet,
      label: isRTL ? 'التقارير والسندات' : 'Reports & Vouchers',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-2 sm:p-4">
      <div
        data-testid="org-hub-modal"
        className="w-full max-w-3xl max-h-[92vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl shadow-2xl overflow-hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-[var(--color-line)] bg-[var(--color-bg)] flex items-center justify-between gap-3 shrink-0 no-print">
          <div className="flex items-center gap-2.5 min-w-0">
            <Building2 className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-title leading-snug text-base font-bold text-[var(--color-ink)] truncate">
                  {t('orgHubTitle')} — {activeOrganization.name}
                </h2>
                {activeOrgRole && (
                  <span className="px-2 py-0.5 rounded-md bg-[var(--color-accent)]/15 text-[var(--color-accent)] text-[10px] font-bold">
                    {roleLabel(activeOrgRole)}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--color-muted)] flex items-center gap-2 flex-wrap">
                <span>
                  {isRTL ? 'العملة:' : 'Currency:'} <bdi dir="ltr">{currency}</bdi>
                </span>
                <span>•</span>
                <span>
                  {t('vatRate')}: <bdi dir="ltr">{activeOrganization.vatRate}%</bdi>
                </span>
                {activeOrganization.lockedUntilDate && (
                  <>
                    <span>•</span>
                    <span className="text-[var(--color-warning-text)] inline-flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      {isRTL
                        ? `مغلق حتى ${activeOrganization.lockedUntilDate}`
                        : `Locked through ${activeOrganization.lockedUntilDate}`}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsOrgHubOpen(false)}
            aria-label={t('close')}
            className="w-11 h-11 rounded-xl border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top 5 Navigation Tabs */}
        <div className="px-3 py-2.5 border-b border-[var(--color-line)] bg-[var(--color-surface)] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 no-print">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = orgHubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`org-hub-tab-${tab.id}`}
                onClick={() => setOrgHubTab(tab.id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 min-h-[44px] border transition-colors ${
                  active
                    ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] shadow-xs'
                    : 'bg-[var(--color-bg)] text-[var(--color-muted)] border-[var(--color-line)] hover:text-[var(--color-ink)]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
                {typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold num-tabular ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-[var(--color-warning)]/25 text-[var(--color-warning-text)]'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ============================================================== */}
          {/* TAB 1: APPROVALS QUEUE                                         */}
          {/* ============================================================== */}
          {orgHubTab === 'approvals' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'pending', label: t('pendingApprovalBadge') },
                    { id: 'approved', label: t('approvedBadge') },
                    { id: 'rejected', label: t('rejectedBadge') },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setApprovalFilter(item.id)}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold min-h-[44px] border transition-colors ${
                      approvalFilter === item.id
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                        : 'bg-[var(--color-bg)] text-[var(--color-muted)] border-[var(--color-line)]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {approvalItems.length === 0 ? (
                <div className="py-12 text-center text-xs text-[var(--color-muted)] space-y-2 bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
                  <Clock className="w-8 h-8 mx-auto text-[var(--color-muted)]/60" />
                  <p>
                    {approvalFilter === 'pending'
                      ? isRTL
                        ? 'لا توجد مصروفات أو عُهد معلقة بانتظار الاعتماد.'
                        : 'No pending approvals right now.'
                      : isRTL
                      ? 'لا توجد معاملات في هذه الحالة.'
                      : 'No transactions in this state.'}
                  </p>
                </div>
              ) : (
                approvalItems.map((tx) => {
                  const cat = categories.find((c) => c.id === tx.categoryId);
                  const cc = tx.costCenterId
                    ? orgCostCenters.find((c) => c.id === tx.costCenterId)
                    : null;
                  const wallet = wallets.find((w) => w.id === tx.walletId);
                  return (
                    <div
                      key={tx.id}
                      className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-[var(--color-ink)]">
                              {isRTL ? cat?.nameAr || 'عام' : cat?.nameEn || 'General'}
                            </span>
                            {tx.voucherNumber && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-accent)]">
                                <bdi dir="ltr">{tx.voucherNumber}</bdi>
                              </span>
                            )}
                            {tx.isReimbursement && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)]/12 text-[var(--color-accent)] font-semibold">
                                {isRTL ? 'استرداد موظف' : 'Reimbursement'}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[var(--color-muted)] mt-1 flex items-center gap-2 flex-wrap">
                            <span>{tx.date}</span>
                            {wallet && (
                              <>
                                <span>•</span>
                                <span>{wallet.name}</span>
                              </>
                            )}
                            {tx.submittedByName && (
                              <>
                                <span>•</span>
                                <span>
                                  {isRTL ? 'بواسطة:' : 'By:'} {tx.submittedByName}
                                </span>
                              </>
                            )}
                            {tx.invoiceNumber && (
                              <>
                                <span>•</span>
                                <span className="font-mono" dir="ltr">
                                  #{tx.invoiceNumber}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="text-end shrink-0">
                          <MoneyText
                            amount={tx.amount}
                            currency={tx.currency}
                            type={tx.type}
                            colorByType={true}
                            className="text-sm font-bold block"
                          />
                          {typeof tx.taxAmount === 'number' && tx.taxAmount > 0 && (
                            <span className="text-[10px] text-[var(--color-muted)]">
                              {isRTL ? 'ضريبة:' : 'VAT:'} {tx.taxAmount}
                            </span>
                          )}
                        </div>
                      </div>

                      {(tx.notes || cc) && (
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-muted)] pt-1.5 border-t border-[var(--color-line)]/60">
                          <span className="truncate flex items-center gap-1">
                            <Receipt className="w-3 h-3 shrink-0" />
                            <span>{tx.notes || (isRTL ? 'بدون وصف' : 'No notes')}</span>
                          </span>
                          {cc && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] shrink-0">
                              <Briefcase className="w-3 h-3 text-[var(--color-accent)]" />
                              <span>{isRTL ? cc.nameAr : cc.nameEn}</span>
                            </span>
                          )}
                        </div>
                      )}

                      {tx.approvalStatus === 'rejected' && tx.rejectionReason && (
                        <div className="p-2 rounded-lg bg-[var(--color-expense)]/10 text-[var(--color-expense)] text-[11px]">
                          {isRTL ? 'سبب الرفض:' : 'Reason:'} {tx.rejectionReason}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        {tx.approvalStatus === 'pending_approval' && canOrgApprove && (
                          <>
                            <button
                              type="button"
                              onClick={() => approveOrgTransaction(tx.id)}
                              className="flex-1 py-2 px-3 rounded-lg bg-[var(--color-income)] text-white text-xs font-bold flex items-center justify-center gap-1.5 min-h-[44px]"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              <span>{isRTL ? 'اعتماد' : 'Approve'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectTargetId(tx.id);
                                setRejectReason('');
                              }}
                              className="flex-1 py-2 px-3 rounded-lg bg-[var(--color-expense)]/12 border border-[var(--color-expense)]/30 text-[var(--color-expense)] text-xs font-bold flex items-center justify-center gap-1.5 min-h-[44px]"
                            >
                              <XCircle className="w-4 h-4" />
                              <span>{isRTL ? 'رفض' : 'Reject'}</span>
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenVoucherForTx(tx.id)}
                          className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-xs font-semibold text-[var(--color-ink)] flex items-center gap-1.5 min-h-[44px]"
                        >
                          <FileText className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                          <span>{t('officialVoucher')}</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: COST CENTERS & PROJECTS                                 */}
          {/* ============================================================== */}
          {orgHubTab === 'cost_centers' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--color-muted)]">
                  {isRTL
                    ? 'متابعة الموازنات والمنصرف والإيرادات لكل قسم أو مشروع أو فرع.'
                    : 'Track budgets, spend, and revenue by department, project, or branch.'}
                </p>
                {canOrgApprove && (
                  <button
                    type="button"
                    data-testid="org-hub-new-cc-btn"
                    onClick={openNewCC}
                    className="px-3 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center gap-1.5 shrink-0 min-h-[44px]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{isRTL ? 'إضافة مركز' : 'Add Center'}</span>
                  </button>
                )}
              </div>

              {ccFormOpen && (
                <form
                  onSubmit={handleSaveCC}
                  className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/40 space-y-2.5"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      dir="ltr"
                      value={ccCode}
                      onChange={(e) => setCcCode(e.target.value)}
                      placeholder="CC-01"
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs font-mono min-h-[44px]"
                    />
                    <select
                      value={ccType}
                      onChange={(e) => setCcType(e.target.value as 'department' | 'project' | 'branch')}
                      aria-label={t('costCenterType')}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    >
                      <option value="department">{t('ccDepartment')}</option>
                      <option value="project">{t('ccProject')}</option>
                      <option value="branch">{t('ccBranch')}</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={ccBudget}
                      onChange={(e) => setCcBudget(e.target.value)}
                      placeholder={isRTL ? 'الموازنة المرصودة' : 'Allocated Budget'}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={ccNameAr}
                      onChange={(e) => setCcNameAr(e.target.value)}
                      placeholder={isRTL ? 'الاسم بالعربية' : 'Arabic Name'}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    />
                    <input
                      type="text"
                      value={ccNameEn}
                      onChange={(e) => setCcNameEn(e.target.value)}
                      placeholder={isRTL ? 'الاسم بالإنجليزية' : 'English Name'}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCcFormOpen(false)}
                      className="px-4 py-2 rounded-lg border border-[var(--color-line)] text-xs text-[var(--color-muted)] min-h-[44px]"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px]"
                    >
                      {t('save')}
                    </button>
                  </div>
                </form>
              )}

              {costCenterSummaries.length === 0 ? (
                <div className="py-10 text-center text-xs text-[var(--color-muted)] bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
                  {isRTL ? 'لا توجد مراكز تكلفة مسجلة بعد.' : 'No cost centers added yet.'}
                </div>
              ) : (
                costCenterSummaries.map((item) => {
                  const cc = orgCostCenters.find((c) => c.id === item.costCenterId)!;
                  const isOver = item.spent > item.budgetAllocated && item.budgetAllocated > 0;
                  return (
                    <div
                      key={item.costCenterId}
                      className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-accent)]">
                              <bdi dir="ltr">{item.code}</bdi>
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)]/12 text-[var(--color-accent)] font-semibold">
                              {ccTypeLabel(cc?.type)}
                            </span>
                            <span className="text-xs font-bold text-[var(--color-ink)]">
                              {isRTL ? item.nameAr : item.nameEn}
                            </span>
                          </div>
                          <div className="text-[10px] text-[var(--color-muted)] mt-1 flex items-center gap-2 flex-wrap">
                            <span>
                              {item.txCount} {isRTL ? 'معاملة' : 'tx'}
                            </span>
                            {item.revenue > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-[var(--color-income)] font-semibold">
                                  {isRTL ? 'إيراد:' : 'Rev:'}{' '}
                                  <MoneyText amount={item.revenue} currency={currency} />
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {canOrgManage && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditCC(cc)}
                              aria-label={isRTL ? 'تعديل' : 'Edit'}
                              className="p-2 text-[var(--color-muted)] hover:text-[var(--color-accent)] rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCostCenter(cc.id)}
                              aria-label={isRTL ? 'حذف' : 'Delete'}
                              className="p-2 text-[var(--color-muted)] hover:text-[var(--color-expense)] rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="w-full h-2 rounded-full bg-[var(--color-line)]/60 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isOver ? 'bg-[var(--color-expense)]' : 'bg-[var(--color-accent)]'
                            }`}
                            style={{ width: `${Math.min(100, item.utilizationPct)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] num-tabular">
                          <span className="text-[var(--color-muted)]">
                            {isRTL ? 'المنفق:' : 'Spent:'}{' '}
                            <MoneyText
                              amount={item.spent}
                              currency={currency}
                              className="font-bold text-[var(--color-ink)]"
                            />{' '}
                            ({item.utilizationPct}%)
                          </span>
                          <span className="text-[var(--color-muted)]">
                            {isRTL ? 'المتبقي:' : 'Remaining:'}{' '}
                            <MoneyText
                              amount={item.remaining}
                              currency={currency}
                              className={
                                isOver
                                  ? 'font-bold text-[var(--color-expense)]'
                                  : 'font-semibold text-[var(--color-ink)]'
                              }
                            />
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: VENDORS, CLIENTS & AGING (0-30 / 31-60 / 61-90 / 90+)   */}
          {/* ============================================================== */}
          {orgHubTab === 'parties' && (
            <div className="space-y-4">
              {/* Payables vs Receivables + Aging Buckets */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {isRTL ? 'مستحقات التحصيل (العملاء AR)' : 'Receivables (Clients AR)'}
                  </div>
                  <MoneyText
                    amount={aging.receivablesTotal}
                    currency={currency}
                    type="income"
                    colorByType={true}
                    className="text-base font-bold mt-1 block"
                  />
                </div>
                <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {isRTL ? 'مستحقات السداد (الموردون AP)' : 'Payables (Vendors AP)'}
                  </div>
                  <MoneyText
                    amount={aging.payablesTotal}
                    currency={currency}
                    type="expense"
                    colorByType={true}
                    className="text-base font-bold mt-1 block"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                <div className="text-[11px] font-semibold text-[var(--color-muted)] mb-2">
                  {isRTL ? 'تقرير أعمار الديون (Aging Report)' : 'Aging Schedule (Days Overdue)'}
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-xs num-tabular">
                  <div className="p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)]">
                    <div className="text-[10px] text-[var(--color-muted)]" dir="ltr">0–30d</div>
                    <div className="font-bold mt-0.5">
                      {formatCurrencyAmount(
                        aging.receivablesBuckets.bucket0_30 + aging.payablesBuckets.bucket0_30,
                        currency,
                        {
                          decimalPlaces: settings.decimalPlaces,
                          digitFormat: settings.digitFormat,
                          language: settings.language,
                        }
                      )}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)]">
                    <div className="text-[10px] text-[var(--color-muted)]" dir="ltr">31–60d</div>
                    <div className="font-bold mt-0.5">
                      {formatCurrencyAmount(
                        aging.receivablesBuckets.bucket31_60 + aging.payablesBuckets.bucket31_60,
                        currency,
                        {
                          decimalPlaces: settings.decimalPlaces,
                          digitFormat: settings.digitFormat,
                          language: settings.language,
                        }
                      )}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)]">
                    <div className="text-[10px] text-[var(--color-warning-text)]" dir="ltr">61–90d</div>
                    <div className="font-bold text-[var(--color-warning-text)] mt-0.5">
                      {formatCurrencyAmount(
                        aging.receivablesBuckets.bucket61_90 + aging.payablesBuckets.bucket61_90,
                        currency,
                        {
                          decimalPlaces: settings.decimalPlaces,
                          digitFormat: settings.digitFormat,
                          language: settings.language,
                        }
                      )}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-expense)]/40">
                    <div className="text-[10px] text-[var(--color-expense)]" dir="ltr">90+d</div>
                    <div className="font-bold text-[var(--color-expense)] mt-0.5">
                      {formatCurrencyAmount(
                        aging.receivablesBuckets.bucket90Plus + aging.payablesBuckets.bucket90Plus,
                        currency,
                        {
                          decimalPlaces: settings.decimalPlaces,
                          digitFormat: settings.digitFormat,
                          language: settings.language,
                        }
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-[var(--color-ink)]">
                  {isRTL ? `سجل الموردين والعملاء (${orgParties.length})` : `Vendors & Clients (${orgParties.length})`}
                </h3>
                {canOrgApprove && (
                  <button
                    type="button"
                    data-testid="org-hub-new-party-btn"
                    onClick={openNewParty}
                    className="px-3 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center gap-1.5 min-h-[44px]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{isRTL ? 'إضافة مورد / عميل' : 'Add Partner'}</span>
                  </button>
                )}
              </div>

              {partyFormOpen && (
                <form
                  onSubmit={handleSaveParty}
                  className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/40 space-y-2.5"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={partyType}
                      onChange={(e) => setPartyType(e.target.value as BusinessParty['type'])}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    >
                      <option value="vendor">{isRTL ? 'مورد (Vendor)' : 'Vendor'}</option>
                      <option value="client">{isRTL ? 'عميل (Client)' : 'Client'}</option>
                      <option value="both">{isRTL ? 'مورد وعميل' : 'Both'}</option>
                    </select>
                    <input
                      type="text"
                      required
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                      placeholder={isRTL ? 'اسم الشركة أو المورد' : 'Company / Partner Name'}
                      className="sm:col-span-2 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={partyBalance}
                      onChange={(e) => setPartyBalance(e.target.value)}
                      placeholder={isRTL ? 'الرصيد المفتوح' : 'Open Balance'}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    />
                    <input
                      type="date"
                      value={partyDueDate}
                      onChange={(e) => setPartyDueDate(e.target.value)}
                      className="px-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    />
                    <input
                      type="text"
                      dir="ltr"
                      value={partyPhone}
                      onChange={(e) => setPartyPhone(e.target.value)}
                      placeholder={isRTL ? 'الهاتف' : 'Phone'}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    />
                    <input
                      type="text"
                      dir="ltr"
                      value={partyTaxId}
                      onChange={(e) => setPartyTaxId(e.target.value)}
                      placeholder={isRTL ? 'الرقم الضريبي' : 'Tax ID'}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    />
                  </div>
                  <input
                    type="text"
                    value={partyNotes}
                    onChange={(e) => setPartyNotes(e.target.value)}
                    placeholder={isRTL ? 'ملاحظات التعاقد أو السداد' : 'Payment terms / notes'}
                    className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPartyFormOpen(false)}
                      className="px-4 py-2 rounded-lg border border-[var(--color-line)] text-xs text-[var(--color-muted)] min-h-[44px]"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px]"
                    >
                      {t('save')}
                    </button>
                  </div>
                </form>
              )}

              {settleParty && (
                <form
                  onSubmit={handleConfirmPartySettlement}
                  className="p-3.5 rounded-xl bg-[var(--color-accent)]/8 border border-[var(--color-accent)]/40 space-y-2.5"
                >
                  <div className="text-xs font-bold text-[var(--color-ink)]">
                    {settleParty.type === 'vendor'
                      ? isRTL
                        ? `تسجيل سداد للمورد: ${settleParty.name}`
                        : `Record Vendor Payment: ${settleParty.name}`
                      : isRTL
                      ? `تسجيل تحصيل من العميل: ${settleParty.name}`
                      : `Record Client Collection: ${settleParty.name}`}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="number"
                      required
                      min="0.01"
                      step="any"
                      value={settleAmount}
                      onChange={(e) => setSettleAmount(e.target.value)}
                      placeholder={isRTL ? 'المبلغ المدفوع / المحصّل' : 'Settlement Amount'}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    />
                    <select
                      value={settleWalletId}
                      onChange={(e) => setSettleWalletId(e.target.value)}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                    >
                      <option value="">
                        {isRTL ? 'تحديث الرصيد فقط (بدون قيد خزينة)' : 'Ledger only (no wallet tx)'}
                      </option>
                      {wallets
                        .filter((w) => !w.isArchived)
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({w.currency})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSettleParty(null)}
                      className="px-4 py-2 rounded-lg border border-[var(--color-line)] text-xs text-[var(--color-muted)] min-h-[44px]"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px]"
                    >
                      {isRTL ? 'تأكيد التسوية' : 'Confirm Settlement'}
                    </button>
                  </div>
                </form>
              )}

              {orgParties.length === 0 ? (
                <div className="py-10 text-center text-xs text-[var(--color-muted)] bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
                  {isRTL ? 'لا يوجد موردون أو عملاء مسجلون بعد.' : 'No vendors or clients added yet.'}
                </div>
              ) : (
                orgParties.map((party) => {
                  const agingRow = aging.parties.find((p) => p.partyId === party.id);
                  return (
                    <div
                      key={party.id}
                      className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between gap-2 flex-wrap"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                              party.type === 'vendor'
                                ? 'bg-[var(--color-expense)]/12 text-[var(--color-expense)]'
                                : 'bg-[var(--color-income)]/12 text-[var(--color-income)]'
                            }`}
                          >
                            {party.type === 'vendor'
                              ? isRTL
                                ? 'مورد'
                                : 'Vendor'
                              : party.type === 'client'
                              ? isRTL
                                ? 'عميل'
                                : 'Client'
                              : isRTL
                              ? 'مورد وعميل'
                              : 'Both'}
                          </span>
                          <span className="text-xs font-bold text-[var(--color-ink)]">
                            {party.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--color-muted)] mt-1 flex items-center gap-2 flex-wrap">
                          {party.dueDate && (
                            <span>
                              {isRTL ? 'الاستحقاق:' : 'Due:'} {party.dueDate}
                            </span>
                          )}
                          {agingRow && agingRow.daysOverdue > 0 && (
                            <span className="text-[var(--color-expense)] font-semibold">
                              • {isRTL ? `متأخر ${agingRow.daysOverdue} يوم` : `${agingRow.daysOverdue}d overdue`}
                            </span>
                          )}
                          {party.taxId && (
                            <span>
                              • {isRTL ? 'ضريبي:' : 'Tax:'} <bdi dir="ltr">{party.taxId}</bdi>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <MoneyText
                          amount={party.balance}
                          currency={party.currency || currency}
                          type={party.type === 'vendor' ? 'expense' : 'income'}
                          colorByType={true}
                          className="text-sm font-bold"
                        />
                        {canOrgApprove && party.balance > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSettleParty(party);
                              setSettleAmount(String(party.balance));
                              setSettleWalletId(wallets[0]?.id || '');
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[11px] font-semibold text-[var(--color-accent)] min-h-[38px]"
                          >
                            {party.type === 'vendor'
                              ? isRTL
                                ? 'سداد'
                                : 'Pay'
                              : isRTL
                              ? 'تحصيل'
                              : 'Collect'}
                          </button>
                        )}
                        {canOrgApprove && (
                          <button
                            type="button"
                            onClick={() => openEditParty(party)}
                            className="p-2 text-[var(--color-muted)] hover:text-[var(--color-accent)] rounded-lg min-h-[38px]"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canOrgManage && (
                          <button
                            type="button"
                            onClick={() => deleteBusinessParty(party.id)}
                            className="p-2 text-[var(--color-muted)] hover:text-[var(--color-expense)] rounded-lg min-h-[38px]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: TEAM, RBAC & EMPLOYEE PETTY CASH CUSTODY                */}
          {/* ============================================================== */}
          {orgHubTab === 'team' && (
            <div className="space-y-4">
              {/* Invite Code Card */}
              <div className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] text-[var(--color-muted)]">{t('inviteCode')}</div>
                  <div className="text-sm font-mono font-bold text-[var(--color-accent)]" dir="ltr">
                    {activeOrganization.inviteCode}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(activeOrganization.inviteCode);
                    setCopiedInvite(true);
                    setTimeout(() => setCopiedInvite(false), 2000);
                  }}
                  className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-semibold flex items-center gap-1.5 min-h-[44px]"
                >
                  {copiedInvite ? (
                    <Check className="w-4 h-4 text-[var(--color-income)]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  <span>{copiedInvite ? (isRTL ? 'تم النسخ' : 'Copied') : isRTL ? 'نسخ' : 'Copy'}</span>
                </button>
              </div>

              {/* Team Members Section */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-[var(--color-ink)]">
                    {isRTL ? `أعضاء الفريق والصلاحيات (${orgMembers.length})` : `Team & Roles (${orgMembers.length})`}
                  </h3>
                  {canOrgManage && (
                    <button
                      type="button"
                      data-testid="org-hub-add-member-btn"
                      onClick={() => setMemberFormOpen((v) => !v)}
                      className="px-3 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center gap-1.5 min-h-[44px]"
                    >
                      <Plus className="w-4 h-4" />
                      <span>{isRTL ? 'إضافة موظف / عضو' : 'Add Member'}</span>
                    </button>
                  )}
                </div>

                {memberFormOpen && canOrgManage && (
                  <form
                    onSubmit={handleAddMember}
                    className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/40 space-y-2.5"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        value={memberName}
                        onChange={(e) => setMemberName(e.target.value)}
                        placeholder={isRTL ? 'الاسم الكامل' : 'Full Name'}
                        className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                      />
                      <input
                        type="email"
                        required
                        dir="ltr"
                        value={memberEmail}
                        onChange={(e) => setMemberEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <select
                        value={memberRole}
                        onChange={(e) => setMemberRole(e.target.value as OrganizationRole)}
                        className="px-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                      >
                        {ROLES.filter((r) => r.id !== 'owner').map((r) => (
                          <option key={r.id} value={r.id}>
                            {isRTL ? r.labelAr : r.labelEn}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={memberDept}
                        onChange={(e) => setMemberDept(e.target.value)}
                        placeholder={isRTL ? 'القسم' : 'Department'}
                        className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                      />
                      <input
                        type="number"
                        min="0"
                        value={memberLimit}
                        onChange={(e) => setMemberLimit(e.target.value)}
                        placeholder={isRTL ? 'سقف الصرف' : 'Spending Limit'}
                        className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMemberFormOpen(false)}
                        className="px-4 py-2 rounded-lg border border-[var(--color-line)] text-xs text-[var(--color-muted)] min-h-[44px]"
                      >
                        {t('cancel')}
                      </button>
                      <button
                        type="submit"
                        className="flex-1 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px]"
                      >
                        {t('save')}
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-2">
                  {orgMembers.map((member) => (
                    <div
                      key={member.uid}
                      className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between gap-2 flex-wrap"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                          <span className="text-xs font-bold text-[var(--color-ink)] truncate">
                            {member.displayName}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--color-muted)] truncate" dir="ltr">
                          {member.email}
                        </div>
                        {(member.department || member.spendingLimit) && (
                          <div className="text-[10px] text-[var(--color-muted)] mt-0.5">
                            {member.department ? `${member.department} ` : ''}
                            {member.spendingLimit
                              ? `• ${isRTL ? 'سقف الصرف:' : 'Limit:'} ${member.spendingLimit} ${currency}`
                              : ''}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {canOrgManage && member.role !== 'owner' ? (
                          <>
                            <select
                              value={member.role}
                              onChange={(e) =>
                                addOrUpdateOrgMember({
                                  ...member,
                                  role: e.target.value as OrganizationRole,
                                })
                              }
                              className="px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-[11px] font-semibold min-h-[38px]"
                            >
                              {ROLES.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {isRTL ? r.labelAr : r.labelEn}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeOrgMember(member.uid)}
                              aria-label={isRTL ? 'إزالة العضو' : 'Remove member'}
                              className="p-2 text-[var(--color-muted)] hover:text-[var(--color-expense)] rounded-lg min-h-[38px]"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg bg-[var(--color-accent)]/12 text-[var(--color-accent)] text-[11px] font-bold">
                            {roleLabel(member.role)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Employee Petty Cash Custody Section */}
              <div className="pt-3 border-t border-[var(--color-line)] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                      <WalletIcon className="w-4 h-4 text-[var(--color-warning-text)]" />
                      <span>{t('pettyCashCustody')}</span>
                    </h3>
                    <p className="text-[11px] text-[var(--color-muted)]">
                      {isRTL
                        ? 'إصدار وتعيين محافظ العهدة النقدية لكل موظف ومتابعة رصيدها.'
                        : 'Issue and assign petty cash custody wallets to employees.'}
                    </p>
                  </div>
                  {canOrgManage && (
                    <button
                      type="button"
                      data-testid="org-hub-issue-petty-btn"
                      onClick={() => setPettyFormOpen((v) => !v)}
                      className="px-3 py-2 rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/40 text-[var(--color-accent)] text-xs font-bold flex items-center gap-1.5 shrink-0 min-h-[44px]"
                    >
                      <Plus className="w-4 h-4" />
                      <span>{isRTL ? 'إصدار عهدة' : 'Issue Petty Cash'}</span>
                    </button>
                  )}
                </div>

                {pettyFormOpen && canOrgManage && (
                  <form
                    onSubmit={handleIssuePettyCash}
                    className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/40 space-y-2.5"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={pettyName}
                        onChange={(e) => setPettyName(e.target.value)}
                        placeholder={isRTL ? 'اسم العهدة (اختياري)' : 'Wallet Name (optional)'}
                        className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                      />
                      <select
                        value={pettyCustodianUid}
                        onChange={(e) => setPettyCustodianUid(e.target.value)}
                        className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                      >
                        <option value="">{t('assignCustodian')}</option>
                        {orgMembers.map((m) => (
                          <option key={m.uid} value={m.uid}>
                            {m.displayName} ({roleLabel(m.role)})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={pettyInitialBalance}
                        onChange={(e) => setPettyInitialBalance(e.target.value)}
                        placeholder={isRTL ? 'مبلغ العهدة الافتتاحي' : 'Custody Amount'}
                        className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPettyFormOpen(false)}
                        className="px-4 py-2 rounded-lg border border-[var(--color-line)] text-xs text-[var(--color-muted)] min-h-[44px]"
                      >
                        {t('cancel')}
                      </button>
                      <button
                        type="submit"
                        className="flex-1 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px]"
                      >
                        {isRTL ? 'تأكيد إصدار العهدة' : 'Confirm Issue Custody'}
                      </button>
                    </div>
                  </form>
                )}

                {pettyCashWallets.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[var(--color-muted)] bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
                    {isRTL ? 'لا توجد محافظ عُهد موظفين حالياً.' : 'No petty cash custody wallets yet.'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pettyCashWallets.map((pw) => {
                      const custodian = orgMembers.find((m) => m.uid === pw.custodianMemberUid);
                      return (
                        <div
                          key={pw.id}
                          className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between gap-2 flex-wrap"
                        >
                          <div>
                            <div className="text-xs font-bold text-[var(--color-ink)]">{pw.name}</div>
                            <div className="text-[11px] text-[var(--color-muted)]">
                              {isRTL ? 'الموظف المسؤول:' : 'Custodian:'}{' '}
                              <span className="font-semibold text-[var(--color-ink)]">
                                {custodian
                                  ? custodian.displayName
                                  : isRTL
                                  ? 'غير معين بعد'
                                  : 'Unassigned'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <MoneyText
                              amount={pw.balance}
                              currency={pw.currency}
                              className="text-sm font-bold text-[var(--color-accent)]"
                            />
                            {canOrgManage && (
                              <select
                                value={pw.custodianMemberUid || ''}
                                onChange={(e) =>
                                  updateWallet(pw.id, {
                                    custodianMemberUid: e.target.value || undefined,
                                  })
                                }
                                aria-label={t('assignCustodian')}
                                className="px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-[11px] min-h-[38px]"
                              >
                                <option value="">{t('assignCustodian')}</option>
                                {orgMembers.map((m) => (
                                  <option key={m.uid} value={m.uid}>
                                    {m.displayName}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 5: REPORTS, VAT, PRINTABLE VOUCHER, LOCK & AUDIT LOG       */}
          {/* ============================================================== */}
          {orgHubTab === 'reports' && (
            <div className="space-y-4">
              {/* Report Sub-tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar no-print">
                {(
                  [
                    { id: 'pnl_vat', icon: TrendingUp, label: isRTL ? 'الأرباح والضريبة P&L/VAT' : 'P&L & VAT' },
                    { id: 'voucher', icon: Printer, label: t('officialVoucher') },
                    { id: 'settings_lock', icon: Lock, label: isRTL ? 'إقفال الفترة والضريبة' : 'Period Lock & Tax' },
                    { id: 'audit', icon: ShieldCheck, label: t('auditLog') },
                  ] as const
                ).map((sub) => {
                  const Icon = sub.icon;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      data-testid={`org-hub-report-${sub.id}`}
                      onClick={() => setReportSubTab(sub.id)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 min-h-[40px] border transition-colors ${
                        reportSubTab === sub.id
                          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-[var(--color-accent)]'
                          : 'bg-[var(--color-bg)] text-[var(--color-muted)] border-[var(--color-line)]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{sub.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* 5A: P&L + VAT */}
              {reportSubTab === 'pnl_vat' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="grid grid-cols-2 gap-2 flex-1 min-w-[220px]">
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="px-2.5 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs min-h-[40px]"
                      />
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="px-2.5 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs min-h-[40px]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      className="px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs font-semibold flex items-center gap-1.5 min-h-[40px]"
                    >
                      <Download className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                      <span>{isRTL ? 'تصدير CSV' : 'Export CSV'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {isRTL ? 'صافي الإيرادات (قبل الضريبة)' : 'Net Revenue (Ex-VAT)'}
                      </div>
                      <MoneyText
                        amount={pnl.netRevenueExTax}
                        currency={currency}
                        type="income"
                        colorByType={true}
                        className="text-base font-bold mt-1 block"
                      />
                    </div>
                    <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {isRTL ? 'صافي المصروفات (قبل الضريبة)' : 'Net Expenses (Ex-VAT)'}
                      </div>
                      <MoneyText
                        amount={pnl.netExpensesExTax}
                        currency={currency}
                        type="expense"
                        colorByType={true}
                        className="text-base font-bold mt-1 block"
                      />
                    </div>
                    <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/40">
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {isRTL ? 'صافي الربح التشغيلي' : 'Operating Profit'}
                      </div>
                      <MoneyText
                        amount={pnl.operatingProfit}
                        currency={currency}
                        type={pnl.operatingProfit >= 0 ? 'income' : 'expense'}
                        colorByType={true}
                        showSign={true}
                        className="text-base font-bold mt-1 block"
                      />
                    </div>
                  </div>

                  {/* VAT Return Box */}
                  <div className="p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2.5 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-[var(--color-ink)]">
                      <Percent className="w-4 h-4 text-[var(--color-accent)]" />
                      <span>{isRTL ? 'ملخص الإقرار الضريبي (VAT Return)' : 'VAT Return Summary'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--color-muted)]">
                        {isRTL ? 'ضريبة المخرجات (المبيعات):' : 'Output VAT (Sales):'}
                      </span>
                      <MoneyText amount={pnl.outputVat} currency={currency} className="font-bold" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--color-muted)]">
                        {isRTL ? 'ضريبة المدخلات (المشتريات):' : 'Input VAT (Purchases):'}
                      </span>
                      <MoneyText
                        amount={pnl.inputVat}
                        currency={currency}
                        className="font-bold text-[var(--color-income)]"
                      />
                    </div>
                    <div className="pt-2 border-t border-[var(--color-line)] flex items-center justify-between text-sm">
                      <span className="font-bold text-[var(--color-ink)]">
                        {isRTL ? 'صافي الضريبة المستحقة للتوريد:' : 'Net VAT Payable:'}
                      </span>
                      <MoneyText
                        amount={pnl.netVatPayable}
                        currency={currency}
                        className="font-bold text-[var(--color-accent)]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 5B: Official Printable Payment / Receipt Voucher (سند صرف / سند قبض) */}
              {reportSubTab === 'voucher' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap no-print">
                    <select
                      value={selectedVoucherTx?.id || ''}
                      onChange={(e) => setSelectedVoucherTxId(e.target.value)}
                      className="flex-1 min-w-[200px] px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[44px]"
                    >
                      {transactions.length === 0 && (
                        <option value="">{isRTL ? 'لا توجد معاملات' : 'No transactions'}</option>
                      )}
                      {transactions.map((tx) => (
                        <option key={tx.id} value={tx.id}>
                          {tx.voucherNumber || tx.id.slice(0, 8)} — {tx.date} — {tx.amount} {tx.currency}{' '}
                          {tx.notes ? `(${tx.notes.slice(0, 24)})` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      data-testid="print-official-voucher-btn"
                      disabled={!selectedVoucherTx}
                      onClick={handlePrintVoucher}
                      className="px-4 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"
                    >
                      <Printer className="w-4 h-4" />
                      <span>{t('printVoucher')}</span>
                    </button>
                  </div>

                  {selectedVoucherTx ? (
                    <div
                      data-testid="official-voucher-preview"
                      className="voucher-print-sheet p-5 rounded-xl bg-white text-[#1F1E1A] border-2 border-[#D4CBB8] space-y-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between border-b-2 border-[#1E6F73]/30 pb-3 gap-3">
                        <div>
                          <div className="font-title leading-snug text-lg font-bold text-[#1E6F73]">
                            {activeOrganization.name}
                          </div>
                          {activeOrganization.taxNumber && (
                            <div className="text-[11px] text-[#5C574D]">
                              {t('taxNumber')}: <bdi dir="ltr">{activeOrganization.taxNumber}</bdi>
                            </div>
                          )}
                        </div>
                        <div className="text-end">
                          <div className="text-sm font-bold px-3 py-1 rounded bg-[#1E6F73]/10 text-[#1E6F73] inline-block">
                            {selectedVoucherTx.type === 'income'
                              ? t('receiptVoucher')
                              : selectedVoucherTx.type === 'expense'
                              ? t('paymentVoucher')
                              : isRTL
                              ? 'سند تحويل خزينة'
                              : 'Treasury Transfer Voucher'}
                          </div>
                          <div className="text-xs font-mono font-bold mt-1" dir="ltr">
                            {selectedVoucherTx.voucherNumber || 'VOUCHER'}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-[#F8F5EE] p-3 rounded-lg border border-[#E4DBC8]">
                        <div>
                          <div className="text-[10px] text-[#6B655A]">{isRTL ? 'التاريخ' : 'Date'}</div>
                          <div className="font-bold num-tabular" dir="ltr">
                            {selectedVoucherTx.date} {selectedVoucherTx.time}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#6B655A]">{isRTL ? 'المبلغ الإجمالي' : 'Amount'}</div>
                          <div className="font-bold num-tabular text-[#1E6F73]">
                            {formatCurrencyAmount(selectedVoucherTx.amount, selectedVoucherTx.currency, {
                              decimalPlaces: settings.decimalPlaces,
                              digitFormat: settings.digitFormat,
                              language: settings.language,
                            })}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#6B655A]">{isRTL ? 'الضريبة VAT' : 'VAT Amount'}</div>
                          <div className="font-bold num-tabular">
                            {selectedVoucherTx.taxAmount
                              ? `${selectedVoucherTx.taxAmount} ${selectedVoucherTx.currency}`
                              : '0'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#6B655A]">{isRTL ? 'رقم الفاتورة' : 'Invoice #'}</div>
                          <div className="font-mono font-bold" dir="ltr">
                            {selectedVoucherTx.invoiceNumber || '—'}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between py-1.5 border-b border-dashed border-[#D4CBB8]">
                          <span className="text-[#6B655A]">{isRTL ? 'الحساب / الخزينة:' : 'Account / Wallet:'}</span>
                          <span className="font-semibold">
                            {wallets.find((w) => w.id === selectedVoucherTx.walletId)?.name || '—'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-1.5 border-b border-dashed border-[#D4CBB8]">
                          <span className="text-[#6B655A]">{isRTL ? 'البند / التصنيف:' : 'Category:'}</span>
                          <span className="font-semibold">
                            {(() => {
                              const c = categories.find((x) => x.id === selectedVoucherTx.categoryId);
                              return c ? (isRTL ? c.nameAr : c.nameEn) : '—';
                            })()}
                          </span>
                        </div>
                        {selectedVoucherTx.costCenterId && (
                          <div className="flex items-center justify-between py-1.5 border-b border-dashed border-[#D4CBB8]">
                            <span className="text-[#6B655A]">{t('costCenters')}:</span>
                            <span className="font-semibold">
                              {(() => {
                                const cc = orgCostCenters.find((x) => x.id === selectedVoucherTx.costCenterId);
                                return cc ? `[${cc.code}] ${isRTL ? cc.nameAr : cc.nameEn}` : '—';
                              })()}
                            </span>
                          </div>
                        )}
                        {selectedVoucherTx.partyId && (
                          <div className="flex items-center justify-between py-1.5 border-b border-dashed border-[#D4CBB8]">
                            <span className="text-[#6B655A]">{isRTL ? 'الجهة (مورد/عميل):' : 'Partner:'}</span>
                            <span className="font-semibold">
                              {orgParties.find((p) => p.id === selectedVoucherTx.partyId)?.name || '—'}
                            </span>
                          </div>
                        )}
                        <div className="py-1.5">
                          <span className="text-[#6B655A] block mb-1">{isRTL ? 'البيان والوصف:' : 'Description:'}</span>
                          <p className="font-medium bg-[#F8F5EE] p-2.5 rounded border border-[#E4DBC8]">
                            {selectedVoucherTx.notes || (isRTL ? 'معاملة مالية معتمدة' : 'Recorded financial voucher')}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 pt-6 text-center text-[11px] text-[#5C574D]">
                        <div>
                          <div className="border-t border-[#99907F] pt-1.5">
                            {isRTL ? 'مُعِد السند' : 'Prepared By'}
                          </div>
                          <div className="text-[10px] mt-0.5">{selectedVoucherTx.submittedByName || '—'}</div>
                        </div>
                        <div>
                          <div className="border-t border-[#99907F] pt-1.5">
                            {isRTL ? 'المراجع / المحاسب' : 'Accountant / Approver'}
                          </div>
                          <div className="text-[10px] mt-0.5">{selectedVoucherTx.reviewedBy || '—'}</div>
                        </div>
                        <div>
                          <div className="border-t border-[#99907F] pt-1.5">
                            {isRTL ? 'توقيع المستلم' : 'Recipient Signature'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-xs text-[var(--color-muted)] bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
                      {isRTL ? 'أضف معاملة واحدة على الأقل لمعاينة السند وطباعته.' : 'Add at least one transaction to preview a voucher.'}
                    </div>
                  )}
                </div>
              )}

              {/* 5C: Period Lock & VAT / Approval Policy */}
              {reportSubTab === 'settings_lock' && (
                <form
                  onSubmit={handleSaveOrgSettings}
                  className="p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                      {activeOrganization.lockedUntilDate ? (
                        <Lock className="w-4 h-4 text-[var(--color-warning-text)]" />
                      ) : (
                        <Unlock className="w-4 h-4 text-[var(--color-accent)]" />
                      )}
                      <span>{t('periodLock')} &amp; {t('vatTax')}</span>
                    </h3>
                    {settingsSavedBanner && (
                      <span className="text-[11px] font-bold text-[var(--color-income)]">
                        {isRTL ? 'تم الحفظ بنجاح ✓' : 'Saved ✓'}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                        {t('taxNumber')}
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        disabled={!canOrgManage}
                        value={orgTaxNumInput}
                        onChange={(e) => setOrgTaxNumInput(e.target.value)}
                        placeholder="300-400-500"
                        className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                        {t('vatRate')} (%)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        step="0.5"
                        disabled={!canOrgManage}
                        value={orgVatInput}
                        onChange={(e) => setOrgVatInput(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                        {isRTL ? 'سقف الاعتماد التلقائي للمصروفات' : 'Approval Threshold'} ({currency})
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        disabled={!canOrgManage}
                        value={orgThresholdInput}
                        onChange={(e) => setOrgThresholdInput(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                        {isRTL ? 'تاريخ إقفال الفترة المحاسبية (يمنع التعديل قبله)' : 'Lock Transactions On/Before'}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          disabled={!canOrgManage}
                          value={orgLockDateInput}
                          onChange={(e) => setOrgLockDateInput(e.target.value)}
                          className="flex-1 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg min-h-[44px]"
                        />
                        {canOrgManage && orgLockDateInput && (
                          <button
                            type="button"
                            onClick={() => setOrgLockDateInput('')}
                            className="px-2.5 py-2 rounded-lg border border-[var(--color-line)] text-[11px] text-[var(--color-muted)] min-h-[44px]"
                          >
                            {isRTL ? 'فك' : 'Clear'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {canOrgManage && (
                    <button
                      type="submit"
                      data-testid="save-org-policy-btn"
                      className="w-full py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px]"
                    >
                      {isRTL ? 'حفظ سياسة الضريبة وإقفال الفترة' : 'Save Tax Policy & Period Lock'}
                    </button>
                  )}
                </form>
              )}

              {/* 5D: Immutable Audit Log */}
              {reportSubTab === 'audit' && (
                <div className="space-y-2.5">
                  <input
                    type="text"
                    value={auditFilter}
                    onChange={(e) => setAuditFilter(e.target.value)}
                    placeholder={isRTL ? 'بحث في سجل التدقيق...' : 'Search audit log...'}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[44px]"
                  />
                  {filteredAuditLogs.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[var(--color-muted)] bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
                      {isRTL ? 'لا توجد قيود تدقيق مطابقة.' : 'No matching audit log entries.'}
                    </div>
                  ) : (
                    filteredAuditLogs.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[var(--color-ink)]">{entry.summary}</span>
                          <span className="px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] font-mono text-[10px] text-[var(--color-accent)] shrink-0">
                            {entry.action}
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--color-muted)] flex items-center justify-between">
                          <span>{entry.actorName}</span>
                          <span dir="ltr">{new Date(entry.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reject Reason Dialog */}
      {rejectTargetId && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              rejectOrgTransaction(
                rejectTargetId,
                rejectReason.trim() || (isRTL ? 'لم تستوفِ الشروط المحاسبية' : 'Policy violation')
              );
              setRejectTargetId(null);
              setRejectReason('');
            }}
            className="w-full max-w-sm bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl p-5 space-y-3 shadow-xl"
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            <h3 className="font-title leading-snug text-sm font-bold text-[var(--color-ink)]">
              {isRTL ? 'تأكيد رفض المعاملة' : 'Confirm Transaction Rejection'}
            </h3>
            <input
              type="text"
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={isRTL ? 'سبب الرفض للموظف...' : 'Rejection reason...'}
              className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px]"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRejectTargetId(null)}
                className="px-4 py-2 rounded-lg border border-[var(--color-line)] text-xs text-[var(--color-muted)] min-h-[44px]"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-lg bg-[var(--color-expense)] text-white text-xs font-bold min-h-[44px]"
              >
                {isRTL ? 'تأكيد الرفض' : 'Confirm Reject'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
