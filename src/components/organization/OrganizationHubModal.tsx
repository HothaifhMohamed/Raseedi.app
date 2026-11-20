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
  Loader2,
  AlertTriangle,
  UserMinus,
  UserCheck,
  UserPlus,
  Search,
  AtSign,
  ArrowRightLeft,
  Crown,
  BadgeCheck,
  RotateCcw,
  RefreshCw,
  Paperclip,
} from 'lucide-react';
import { useApp, OrgHubTab } from '../../context/AppContext';
import { BrandLogo } from '../common/BrandLogo';
import {
  calculateAgingReport,
  calculateCostCenterReport,
  calculateEnterprisePnL,
  formatCurrencyAmount,
  formatLocalDate,
  roundCurrency,
} from '../../services/calculations';
import { normalizeApprovalStatus } from '../../services/entitlements';
import { normalizeArabicPersianNumerals, parseLocalizedNumber } from '../../services/numbers';
import { resolveOrgAttachmentUrl } from '../../services/firebase';
import { escapeCsvCell } from '../../services/csvImport';
import { indexById, paginateList } from '../../services/lookupCache';
import {
  formatWorkspaceDeleteConfirmMessage,
  resolveWorkspaceOrgPermissions,
} from '../../services/workspaceCleanup';
import {
  checkOrgSeatAvailability,
  formatUsernameHandle,
  parseMemberLookupQuery,
} from '../../services/usernameService';
import { MoneyText } from '../common/MoneyText';
import {
  AuditLogAction,
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
    activeWorkspace,
    orgRefs,
    localOrgWorkspaces,
    activeOrganization,
    orgMembers,
    orgCostCenters,
    orgParties,
    orgAuditLogs,
    transactions,
    wallets,
    categories,
    activeOrgRole,
    canOrgWrite,
    canOrgApprove,
    canOrgManage,
    isOrgReadOnly,
    activeOrgSubscriptionState,
    orgActionError,
    clearOrgActionError,
    orgTrashTransactions,
    pendingApprovalsCount,
    approveOrgTransaction,
    rejectOrgTransaction,
    markOrgTransactionPaid,
    restoreOrgTransaction,
    recalculateOrgBalances,
    addCostCenter,
    updateCostCenter,
    deleteCostCenter,
    addBusinessParty,
    updateBusinessParty,
    deleteBusinessParty,
    searchUserForOrg,
    addOrgMemberDirectly,
    manageOrgMember,
    transferOrgOwnership,
    deleteOrganization,
    addWallet,
    updateWallet,
    addTransaction,
    updateOrganizationSettings,
    lockAccountingPeriod,
    upgradeLocalOrgToCloud,
    setIsUpgradeModalOpen,
    user,
    settings,
    t,
    isRTL,
  } = useApp();

  // Tab 1: Approvals & Trash state
  const [approvalFilter, setApprovalFilter] = useState<'pending' | 'rejected' | 'approved' | 'trash'>('pending');
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const [loadingAttachmentId, setLoadingAttachmentId] = useState<string | null>(null);

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

  // Tab 4: Cloud Team, Direct Member Add (@username / Email) & Petty Cash Custody state
  const [directMemberQuery, setDirectMemberQuery] = useState('');
  const [directMemberRole, setDirectMemberRole] =
    useState<Exclude<OrganizationRole, 'owner'>>('employee');
  const [directMemberDept, setDirectMemberDept] = useState('');
  const [directMemberLimit, setDirectMemberLimit] = useState('');
  const [isSearchingMember, setIsSearchingMember] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [lookedUpUser, setLookedUpUser] = useState<{
    uid: string;
    email: string;
    displayName: string;
    username?: string;
  } | null>(null);
  const [memberActionBusyUid, setMemberActionBusyUid] = useState<string | null>(null);
  const [editingMemberLimit, setEditingMemberLimit] = useState<{
    uid: string;
    limit: string;
    department: string;
  } | null>(null);
  const [confirmRemoveUid, setConfirmRemoveUid] = useState<string | null>(null);
  const [transferTargetUid, setTransferTargetUid] = useState('');
  const [confirmTransferOpen, setConfirmTransferOpen] = useState(false);
  const [isTransferringOwner, setIsTransferringOwner] = useState(false);
  const [deleteOrgConfirmName, setDeleteOrgConfirmName] = useState('');
  const [confirmQuickDeleteOpen, setConfirmQuickDeleteOpen] = useState(false);
  const [quickDeleteError, setQuickDeleteError] = useState<string | null>(null);
  const [isDeletingOrg, setIsDeletingOrg] = useState(false);
  const [isUpgradingOrgToCloud, setIsUpgradingOrgToCloud] = useState(false);
  const [upgradeOrgProgress, setUpgradeOrgProgress] = useState<{ done: number; total: number } | null>(null);
  const [teamFeedback, setTeamFeedback] = useState<{ text: string; error?: boolean } | null>(null);

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
  const [auditActorFilter, setAuditActorFilter] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState<AuditLogAction | ''>('');
  const [auditStartDate, setAuditStartDate] = useState('');
  const [auditEndDate, setAuditEndDate] = useState('');
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
  const [confirmRecalc, setConfirmRecalc] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);
  const [visibleApprovalsCount, setVisibleApprovalsCount] = useState(30);
  const [visibleAuditCount, setVisibleAuditCount] = useState(30);
  const [visibleVoucherCount, setVisibleVoucherCount] = useState(100);

  // Keep org inputs and transient modal/form states clean when switching org
  React.useEffect(() => {
    if (!activeOrganization) return;
    setOrgVatInput(String(activeOrganization.vatRate ?? 14));
    setOrgTaxNumInput(activeOrganization.taxNumber || '');
    setOrgThresholdInput(String(activeOrganization.approvalThreshold ?? 1000));
    setOrgLockDateInput(activeOrganization.lockedUntilDate || '');
    setDirectMemberQuery('');
    setDirectMemberDept('');
    setDirectMemberLimit('');
    setLookedUpUser(null);
    setTeamFeedback(null);
    setConfirmQuickDeleteOpen(false);
    setQuickDeleteError(null);
    setDeleteOrgConfirmName('');
    setConfirmRemoveUid(null);
    setEditingMemberLimit(null);
    setConfirmTransferOpen(false);
    setTransferTargetUid('');
    setRejectTargetId(null);
    setRejectReason('');
    setSettleParty(null);
    setCcFormOpen(false);
    setPartyFormOpen(false);
    setPettyFormOpen(false);
    setConfirmRecalc(false);
    setRecalcMessage(null);
    setSettingsSavedBanner(false);
    setVisibleApprovalsCount(30);
    setVisibleAuditCount(30);
    setVisibleVoucherCount(100);
  }, [activeOrganization?.id]);

  React.useEffect(() => {
    setVisibleApprovalsCount(30);
  }, [approvalFilter]);

  React.useEffect(() => {
    setVisibleAuditCount(30);
  }, [auditFilter, auditActorFilter, auditActionFilter, auditStartDate, auditEndDate]);

  const currency = activeOrganization?.currency || settings.mainCurrency;

  const activeOrgPermissions = useMemo(() => {
    if (!activeOrganization) {
      return {
        role: null,
        isCloudOrg: false,
        isLocalOnly: false,
        isOrphan: false,
        canDelete: false,
      };
    }
    return resolveWorkspaceOrgPermissions({
      org: activeOrganization,
      orgRefs,
      localOrgWorkspaces,
      currentUserId: user?.id,
      activeWorkspace,
      activeOrgRole,
    });
  }, [activeOrganization, orgRefs, localOrgWorkspaces, user?.id, activeWorkspace, activeOrgRole]);

  const categoriesById = useMemo(() => indexById(categories), [categories]);
  const walletsById = useMemo(() => indexById(wallets), [wallets]);
  const costCentersById = useMemo(() => indexById(orgCostCenters), [orgCostCenters]);
  const partiesById = useMemo(() => indexById(orgParties), [orgParties]);

  const approvalItems = useMemo(() => {
    if (approvalFilter === 'trash') return orgTrashTransactions;
    return transactions.filter((tx) => {
      const s = normalizeApprovalStatus(tx.approvalStatus);
      if (approvalFilter === 'pending') return s === 'pending';
      if (approvalFilter === 'rejected') return s === 'rejected';
      return s === 'approved' || s === 'paid';
    });
  }, [transactions, orgTrashTransactions, approvalFilter]);

  const paginatedApprovals = useMemo(
    () => paginateList(approvalItems, visibleApprovalsCount),
    [approvalItems, visibleApprovalsCount]
  );

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

  const paginatedVoucherTransactions = useMemo(() => {
    const slice = paginateList(transactions, visibleVoucherCount);
    if (
      selectedVoucherTx &&
      !slice.visibleItems.some((tx) => tx.id === selectedVoucherTx.id)
    ) {
      return {
        ...slice,
        visibleItems: [selectedVoucherTx, ...slice.visibleItems],
      };
    }
    return slice;
  }, [transactions, visibleVoucherCount, selectedVoucherTx]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditFilter.trim().toLowerCase();
    const startMs = auditStartDate ? new Date(`${auditStartDate}T00:00:00`).getTime() : null;
    const endMs = auditEndDate ? new Date(`${auditEndDate}T23:59:59.999`).getTime() : null;
    return orgAuditLogs.filter((e) => {
      if (auditActorFilter && e.actorUid !== auditActorFilter) return false;
      if (auditActionFilter && e.action !== auditActionFilter) return false;
      if (startMs && e.timestamp < startMs) return false;
      if (endMs && e.timestamp > endMs) return false;
      if (
        q &&
        !e.summary.toLowerCase().includes(q) &&
        !e.actorName.toLowerCase().includes(q) &&
        !e.action.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [orgAuditLogs, auditFilter, auditActorFilter, auditActionFilter, auditStartDate, auditEndDate]);

  const paginatedAuditLogs = useMemo(
    () => paginateList(filteredAuditLogs, visibleAuditCount),
    [filteredAuditLogs, visibleAuditCount]
  );

  const handleOpenTxAttachment = async (tx: Transaction) => {
    const firstPath = tx.attachmentPaths?.[0];
    const firstRaw = tx.attachments?.[0];
    if (!firstPath && !firstRaw) return;
    if (firstRaw) {
      setAttachmentPreviewUrl(firstRaw);
      return;
    }
    if (firstPath) {
      setLoadingAttachmentId(tx.id);
      try {
        const url = await resolveOrgAttachmentUrl(firstPath);
        if (url) {
          setAttachmentPreviewUrl(url);
        } else {
          setTeamFeedback({
            text: isRTL ? 'المرفق بانتظار الرفع عند عودة الاتصال بالإنترنت.' : 'Attachment upload pending reconnection.',
          });
        }
      } catch {
        setTeamFeedback({
          text: isRTL ? 'تعذر فتح المرفق من التخزين السحابي.' : 'Failed to open cloud attachment.',
          error: true,
        });
      } finally {
        setLoadingAttachmentId(null);
      }
    }
  };

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
    const csv = '\uFEFF' + rows.map((r) => r.map((v) => escapeCsvCell(v)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `raseedi-org-${activeOrganization.id}-${formatLocalDate()}.csv`;
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
      budgetAllocated: Math.max(0, parseLocalizedNumber(ccBudget) || 0),
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
      balance: Math.max(0, parseLocalizedNumber(partyBalance) || 0),
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
    if (!settleParty || isOrgReadOnly) return;
    const amt = parseLocalizedNumber(settleAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;

    const remaining = Math.max(
      0,
      roundCurrency(settleParty.balance - amt, settleParty.currency || currency)
    );
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

  // Cloud Team: Direct Member Lookup & Addition via Firestore (No Invite Server Required)
  const seatStatus = checkOrgSeatAvailability(
    orgMembers,
    activeOrgSubscriptionState?.seatLimit ?? activeOrganization.seatLimit ?? 5,
    activeOrganization.extraSeats ?? 0
  );

  const formatDirectAddError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err || '');
    if (raw.includes('USER_NOT_FOUND')) {
      return isRTL
        ? 'لم يتم العثور على حساب مسجل بهذا البريد الإلكتروني أو اسم المستخدم. تأكد أن المستخدم قد سجّل الدخول في رَصِيدِي أولاً.'
        : 'No registered Raseedi account was found with that email or @username. Ask the user to sign in first.';
    }
    if (raw.includes('ALREADY_MEMBER')) {
      return isRTL
        ? 'هذا الحساب عضو بالفعل في هذه المؤسسة.'
        : 'This account is already a member of this organization.';
    }
    if (raw.includes('SEAT_LIMIT_REACHED')) {
      return isRTL
        ? 'تم استنفاد جميع مقاعد المؤسسة المتاحة. قم بترقية الباقة لإضافة أعضاء جدد.'
        : 'All organization seats are used. Upgrade your plan to add more members.';
    }
    if (raw.includes('LOCAL_ORG_UNSUPPORTED')) {
      return isRTL
        ? 'إضافة الأعضاء متاحة للمؤسسات السحابية فقط. قم بتسجيل الدخول وإنشاء مؤسسة سحابية.'
        : 'Direct team membership requires a Cloud Organization.';
    }
    if (raw.includes('ORG_READ_ONLY')) {
      return isRTL
        ? 'المؤسسة في وضع القراءة فقط حالياً. قم بتجديد الاشتراك لتفعيل إضافة الأعضاء.'
        : 'Organization is currently read-only. Renew subscription to add members.';
    }
    if (raw.includes('INVALID_QUERY')) {
      return isRTL
        ? 'أدخل بريداً إلكترونياً صحيحاً أو اسم مستخدم يبدأ بـ @ (مثل @ahmed_acc).'
        : 'Enter a valid email address or @username (e.g. @ahmed_acc).';
    }
    if (raw.includes('permission-denied') || raw.includes('PERMISSION_DENIED')) {
      return isRTL
        ? 'ليست لديك صلاحية تنفيذ هذا الإجراء أو الحساب غير مفعّل.'
        : 'Permission denied. Ensure you are an active Owner/Admin with a verified account.';
    }
    return raw || (isRTL ? 'تعذر إضافة العضو حالياً.' : 'Failed to add member.');
  };

  const handleLookupDirectMember = async () => {
    const parsed = parseMemberLookupQuery(directMemberQuery);
    if (parsed.kind === 'invalid') {
      setLookedUpUser(null);
      setTeamFeedback({
        text: isRTL ? parsed.errorAr || '' : parsed.errorEn || '',
        error: true,
      });
      return;
    }
    setIsSearchingMember(true);
    setTeamFeedback(null);
    setLookedUpUser(null);
    try {
      const found = await searchUserForOrg(directMemberQuery);
      if (!found) {
        setTeamFeedback({
          text: formatDirectAddError(new Error('USER_NOT_FOUND')),
          error: true,
        });
        return;
      }
      const existing = orgMembers.find((m) => m.uid === found.uid);
      if (existing) {
        setTeamFeedback({
          text: formatDirectAddError(new Error('ALREADY_MEMBER')),
          error: true,
        });
        return;
      }
      setLookedUpUser(found);
    } catch (err) {
      setTeamFeedback({
        text: formatDirectAddError(err),
        error: true,
      });
    } finally {
      setIsSearchingMember(false);
    }
  };

  const handleDirectAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOrgReadOnly || !canOrgManage || isAddingMember) return;
    if (activeOrgPermissions.isLocalOnly) {
      setTeamFeedback({
        text: formatDirectAddError(new Error('LOCAL_ORG_UNSUPPORTED')),
        error: true,
      });
      return;
    }
    if (!seatStatus.canAdd) {
      setTeamFeedback({
        text: formatDirectAddError(new Error('SEAT_LIMIT_REACHED')),
        error: true,
      });
      return;
    }

    const parsed = parseMemberLookupQuery(directMemberQuery);
    if (parsed.kind === 'invalid') {
      setTeamFeedback({
        text: isRTL ? parsed.errorAr || '' : parsed.errorEn || '',
        error: true,
      });
      return;
    }

    setIsAddingMember(true);
    setTeamFeedback(null);
    try {
      const parsedLimit = directMemberLimit.trim()
        ? parseLocalizedNumber(directMemberLimit)
        : undefined;
      const added = await addOrgMemberDirectly({
        identifier: directMemberQuery,
        targetUser: lookedUpUser,
        role: directMemberRole,
        department: directMemberDept.trim() || undefined,
        spendingLimit:
          typeof parsedLimit === 'number' && !Number.isNaN(parsedLimit) && parsedLimit >= 0
            ? parsedLimit
            : undefined,
      });
      setDirectMemberQuery('');
      setDirectMemberDept('');
      setDirectMemberLimit('');
      setLookedUpUser(null);
      setTeamFeedback({
        text: isRTL
          ? `تمت إضافة ${added.displayName}${added.username ? ` (${formatUsernameHandle(added.username)})` : ''} إلى فريق المؤسسة بنجاح!`
          : `${added.displayName}${added.username ? ` (${formatUsernameHandle(added.username)})` : ''} was added to the organization team!`,
      });
    } catch (err) {
      setTeamFeedback({
        text: formatDirectAddError(err),
        error: true,
      });
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleMemberManage = async (
    targetUid: string,
    action: 'change_role' | 'suspend' | 'reactivate' | 'remove' | 'set_spending_limit',
    extra?: {
      role?: Exclude<OrganizationRole, 'owner'>;
      spendingLimit?: number | null;
      department?: string;
    }
  ) => {
    setMemberActionBusyUid(targetUid);
    setTeamFeedback(null);
    try {
      await manageOrgMember({ targetUid, action, ...extra });
      if (action === 'set_spending_limit') setEditingMemberLimit(null);
      if (action === 'remove') setConfirmRemoveUid(null);
    } catch (err: any) {
      setTeamFeedback({
        text: err?.message || (isRTL ? 'تعذر تحديث بيانات العضو.' : 'Failed to update member.'),
        error: true,
      });
    } finally {
      setMemberActionBusyUid(null);
    }
  };

  const handleTransferOwnership = async () => {
    if (!transferTargetUid) return;
    setIsTransferringOwner(true);
    setTeamFeedback(null);
    try {
      await transferOrgOwnership(transferTargetUid);
      setConfirmTransferOpen(false);
      setTransferTargetUid('');
      setTeamFeedback({
        text: isRTL ? 'تم نقل ملكية المؤسسة بنجاح.' : 'Organization ownership transferred.',
      });
    } catch (err: any) {
      setTeamFeedback({
        text: err?.message || (isRTL ? 'تعذر نقل الملكية.' : 'Failed to transfer ownership.'),
        error: true,
      });
    } finally {
      setIsTransferringOwner(false);
    }
  };

  const handleDeleteOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrganization || deleteOrgConfirmName.trim() !== activeOrganization.name.trim()) {
      setTeamFeedback({
        text: isRTL ? 'اكتب اسم المؤسسة بدقة للتأكيد.' : 'Type exact organization name to confirm.',
        error: true,
      });
      return;
    }
    setIsDeletingOrg(true);
    setTeamFeedback(null);
    try {
      await deleteOrganization(deleteOrgConfirmName.trim(), activeOrganization.id);
      setDeleteOrgConfirmName('');
      setIsOrgHubOpen(false);
    } catch (err: any) {
      setTeamFeedback({
        text: err?.message || (isRTL ? 'تعذر حذف المؤسسة.' : 'Failed to delete organization.'),
        error: true,
      });
    } finally {
      setIsDeletingOrg(false);
    }
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
    const amount = Math.max(0, parseLocalizedNumber(pettyInitialBalance) || 0);

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
    if (isOrgReadOnly || !canOrgManage) return;
    const parsedVat = parseLocalizedNumber(orgVatInput);
    const parsedThreshold = parseLocalizedNumber(orgThresholdInput);
    updateOrganizationSettings({
      vatRate: Math.max(0, Math.min(50, Number.isNaN(parsedVat) ? 0 : parsedVat)),
      taxNumber: orgTaxNumInput.trim() || undefined,
      approvalThreshold: Math.max(0, Number.isNaN(parsedThreshold) ? 0 : parsedThreshold),
    });
    lockAccountingPeriod(orgLockDateInput.trim() || undefined);
    setSettingsSavedBanner(true);
    setTimeout(() => setSettingsSavedBanner(false), 2500);
  };

  const handleRecalculateBalances = async () => {
    if (isOrgReadOnly || !canOrgManage) return;
    setIsRecalculating(true);
    setRecalcMessage(null);
    try {
      await recalculateOrgBalances();
      setConfirmRecalc(false);
      setRecalcMessage(
        isRTL
          ? 'تمت إعادة احتساب أرصدة جميع المحافظ من المعاملات المعتمدة بنجاح.'
          : 'All wallet balances were recalculated from approved ledger entries.'
      );
    } catch (err) {
      setRecalcMessage(
        err instanceof Error
          ? err.message
          : isRTL
          ? 'تعذر إعادة احتساب الأرصدة.'
          : 'Failed to recalculate balances.'
      );
    } finally {
      setIsRecalculating(false);
    }
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

          <div className="flex items-center gap-2 shrink-0">
            {activeOrgPermissions.canDelete && (
              <button
                type="button"
                data-testid="org-hub-quick-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setQuickDeleteError(null);
                  setConfirmQuickDeleteOpen(true);
                }}
                aria-label={
                  isRTL
                    ? `حذف مساحة العمل ${activeOrganization.name}`
                    : `Delete workspace ${activeOrganization.name}`
                }
                title={isRTL ? 'حذف مساحة العمل' : 'Delete workspace'}
                className="w-11 h-11 rounded-xl border border-rose-500/25 text-rose-500/80 hover:text-rose-600 hover:bg-rose-500/10 flex items-center justify-center transition-colors shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsOrgHubOpen(false)}
              aria-label={t('close')}
              className="w-11 h-11 rounded-xl border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
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
          {orgActionError && (
            <div className="p-3 rounded-xl bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 text-xs text-[var(--color-expense)] flex items-center justify-between gap-2 no-print">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-semibold">{orgActionError}</span>
              </div>
              <button
                type="button"
                onClick={clearOrgActionError}
                className="p-1 rounded hover:bg-[var(--color-expense)]/15 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {isOrgReadOnly && (
            <div className="p-3 rounded-xl bg-amber-500/12 border border-amber-500/35 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2 no-print">
              <span className="font-semibold">{t('orgReadOnlyBanner')}</span>
              <button
                type="button"
                onClick={() => {
                  setIsOrgHubOpen(false);
                  setIsUpgradeModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-bold shrink-0"
              >
                {isRTL ? 'ترقية الباقة' : 'Upgrade'}
              </button>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 1: APPROVALS QUEUE                                         */}
          {/* ============================================================== */}
          {orgHubTab === 'approvals' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {(
                  [
                    { id: 'pending', label: t('pendingApprovalBadge') },
                    { id: 'approved', label: t('approvedBadge') },
                    { id: 'rejected', label: t('rejectedBadge') },
                    {
                      id: 'trash',
                      label: `${t('trashBin')}${orgTrashTransactions.length > 0 ? ` (${orgTrashTransactions.length})` : ''}`,
                    },
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
                    {approvalFilter === 'trash'
                      ? isRTL
                        ? 'سلة المحذوفات فارغة.'
                        : 'Trash bin is empty.'
                      : approvalFilter === 'pending'
                      ? isRTL
                        ? 'لا توجد مصروفات أو عُهد معلقة بانتظار الاعتماد.'
                        : 'No pending approvals right now.'
                      : isRTL
                      ? 'لا توجد معاملات في هذه الحالة.'
                      : 'No transactions in this state.'}
                  </p>
                </div>
              ) : (
                paginatedApprovals.visibleItems.map((tx) => {
                  const cat = categoriesById.get(tx.categoryId);
                  const cc = tx.costCenterId ? costCentersById.get(tx.costCenterId) : undefined;
                  const wallet = walletsById.get(tx.walletId);
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
                        {approvalFilter === 'trash' ? (
                          canOrgWrite &&
                          !isOrgReadOnly && (
                            <button
                              type="button"
                              onClick={() => restoreOrgTransaction(tx.id)}
                              className="py-2 px-3 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-1.5 min-h-[44px]"
                            >
                              <RotateCcw className="w-4 h-4" />
                              <span>{t('restoreItem')}</span>
                            </button>
                          )
                        ) : (
                          <>
                            {normalizeApprovalStatus(tx.approvalStatus) === 'pending' &&
                              canOrgApprove &&
                              !isOrgReadOnly && (
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
                            {normalizeApprovalStatus(tx.approvalStatus) === 'approved' &&
                              canOrgApprove &&
                              !isOrgReadOnly && (
                                <button
                                  type="button"
                                  onClick={() => markOrgTransactionPaid(tx.id)}
                                  className="py-2 px-3 rounded-lg bg-[var(--color-accent)]/12 border border-[var(--color-accent)]/35 text-[var(--color-accent)] text-xs font-bold flex items-center justify-center gap-1.5 min-h-[44px]"
                                >
                                  <BadgeCheck className="w-4 h-4" />
                                  <span>{t('markAsPaid')}</span>
                                </button>
                              )}
                            {normalizeApprovalStatus(tx.approvalStatus) === 'paid' && (
                              <span className="px-2.5 py-1.5 rounded-lg bg-[var(--color-income)]/15 text-[var(--color-income)] text-[11px] font-bold flex items-center gap-1">
                                <BadgeCheck className="w-3.5 h-3.5" />
                                <span>{t('paidBadge')}</span>
                              </span>
                            )}
                            {((tx.attachmentPaths && tx.attachmentPaths.length > 0) ||
                              (tx.attachments && tx.attachments.length > 0)) && (
                              <button
                                type="button"
                                disabled={loadingAttachmentId === tx.id}
                                onClick={() => void handleOpenTxAttachment(tx)}
                                className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-xs font-semibold text-[var(--color-ink)] flex items-center gap-1.5 min-h-[44px]"
                              >
                                <Paperclip className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                                <span>
                                  {loadingAttachmentId === tx.id
                                    ? '...'
                                    : isRTL
                                    ? 'معاينة الإيصال'
                                    : 'Receipt'}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenVoucherForTx(tx.id)}
                              className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-xs font-semibold text-[var(--color-ink)] flex items-center gap-1.5 min-h-[44px]"
                            >
                              <FileText className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                              <span>{t('officialVoucher')}</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {paginatedApprovals.hasMore && (
                <button
                  type="button"
                  onClick={() => setVisibleApprovalsCount((prev) => prev + 40)}
                  className="w-full py-2.5 px-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-xs font-semibold text-[var(--color-accent)] transition-colors min-h-[42px]"
                >
                  {isRTL
                    ? `عرض المزيد من المعاملات (${paginatedApprovals.remainingCount} متبقي)`
                    : `Show more approvals (${paginatedApprovals.remainingCount} remaining)`}
                </button>
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
                {canOrgApprove && !isOrgReadOnly && (
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
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={ccBudget}
                      onChange={(e) => setCcBudget(normalizeArabicPersianNumerals(e.target.value))}
                      placeholder={isRTL ? 'الموازنة المرصودة' : 'Allocated Budget'}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px] num-tabular"
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

                        {canOrgManage && !isOrgReadOnly && (
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
                {canOrgApprove && !isOrgReadOnly && (
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
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={partyBalance}
                      onChange={(e) => setPartyBalance(normalizeArabicPersianNumerals(e.target.value))}
                      placeholder={isRTL ? 'الرصيد المفتوح' : 'Open Balance'}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px] num-tabular"
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
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      required
                      value={settleAmount}
                      onChange={(e) => setSettleAmount(normalizeArabicPersianNumerals(e.target.value))}
                      placeholder={isRTL ? 'المبلغ المدفوع / المحصّل' : 'Settlement Amount'}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px] num-tabular"
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
                        {canOrgApprove && !isOrgReadOnly && party.balance > 0 && (
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
                        {canOrgApprove && !isOrgReadOnly && (
                          <button
                            type="button"
                            onClick={() => openEditParty(party)}
                            className="p-2 text-[var(--color-muted)] hover:text-[var(--color-accent)] rounded-lg min-h-[38px]"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canOrgManage && !isOrgReadOnly && (
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
          {/* TAB 4: TEAM, CLOUD INVITES, RBAC & PETTY CASH CUSTODY          */}
          {/* ============================================================== */}
          {orgHubTab === 'team' && (
            <div className="space-y-4">
              {teamFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    teamFeedback.error
                      ? 'bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 text-[var(--color-expense)]'
                      : 'bg-[var(--color-income)]/10 border border-[var(--color-income)]/30 text-[var(--color-income)]'
                  }`}
                >
                  <span>{teamFeedback.text}</span>
                </div>
              )}

              {/* Subscription & Seat Usage Header Card */}
              <div className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between gap-3 flex-wrap">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                    <Crown className="w-4 h-4 text-[var(--color-accent)]" />
                    <span>
                      {isRTL ? 'المقاعد وخطة المؤسسة' : 'Seats & Organization Plan'}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {isRTL
                      ? `المستخدم: ${orgMembers.filter((m) => m.status !== 'suspended').length} من أصل ${activeOrgSubscriptionState?.seatLimit ?? activeOrganization.seatLimit ?? 5} مقاعد`
                      : `${orgMembers.filter((m) => m.status !== 'suspended').length} of ${activeOrgSubscriptionState?.seatLimit ?? activeOrganization.seatLimit ?? 5} seats used`}
                    {activeOrgSubscriptionState &&
                      ` • ${activeOrgSubscriptionState.status === 'trial' ? (isRTL ? 'فترة تجريبية' : 'Trial') : activeOrgSubscriptionState.status === 'active' ? (isRTL ? 'نشط' : 'Active') : activeOrgSubscriptionState.status === 'grace' ? (isRTL ? 'فترة سماح' : 'Grace') : isRTL ? 'قراءة فقط' : 'Read-Only'} (${activeOrgSubscriptionState.daysRemaining}d)`}
                  </div>
                </div>
                {canOrgManage && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOrgHubOpen(false);
                      setIsUpgradeModalOpen(true);
                    }}
                    className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[38px]"
                  >
                    {isRTL ? 'إدارة الاشتراك' : 'Manage Plan'}
                  </button>
                )}
              </div>

              {/* Direct Member Addition via Email or @username (Owner / Admin) */}
              {canOrgManage && (
                <div
                  data-testid="direct-add-member-panel"
                  className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                      <UserPlus className="w-4 h-4 text-[var(--color-accent)]" />
                      <span>
                        {isRTL
                          ? 'إضافة عضو مباشر بالبريد الإلكتروني أو اسم المستخدم (@username)'
                          : 'Add Team Member Directly by Email or @username'}
                      </span>
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold num-tabular ${
                        seatStatus.canAdd
                          ? 'bg-[var(--color-income)]/12 text-[var(--color-income)]'
                          : 'bg-[var(--color-expense)]/12 text-[var(--color-expense)]'
                      }`}
                    >
                      {isRTL
                        ? `${seatStatus.activeCount} / ${seatStatus.effectiveSeatLimit} مقعد`
                        : `${seatStatus.activeCount} / ${seatStatus.effectiveSeatLimit} seats`}
                    </span>
                  </div>

                  {activeOrgPermissions.isLocalOnly ? (
                    <div className="p-3 rounded-lg bg-[var(--color-warning)]/12 border border-[var(--color-warning)]/30 space-y-2.5">
                      <p className="text-[11px] text-[var(--color-warning-text)] leading-relaxed">
                        {user?.isLoggedIn
                          ? isRTL
                            ? 'هذه المؤسسة محفوظة محلياً على الجهاز فقط. يمكنك تحويلها الآن إلى مؤسسة سحابية (Cloud Organization) بنقرة واحدة مع نقل جميع المحافظ والتصنيفات والمعاملات تلقائياً لتفعيل إضافة أعضاء الفريق عبر البريد الإلكتروني أو @username.'
                            : 'This organization is currently saved locally only. Upgrade it to a Cloud Organization in one click (migrating all wallets, categories, and transactions) to enable adding team members by Email or @username.'
                          : isRTL
                          ? 'هذه المؤسسة محلية على الجهاز فقط. لتفعيل إضافة أعضاء الفريق عبر البريد أو @username، سجّل الدخول بحساب Google أولاً ثم قم بتحويل المؤسسة إلى مؤسسة سحابية.'
                          : 'This is a local-only organization. Sign in with Google first to upgrade to a Cloud Organization and add team members directly.'}
                      </p>
                      {user?.isLoggedIn && activeOrganization && (
                        <button
                          type="button"
                          data-testid="upgrade-local-org-to-cloud-btn"
                          disabled={isUpgradingOrgToCloud}
                          onClick={async () => {
                            setIsUpgradingOrgToCloud(true);
                            setUpgradeOrgProgress(null);
                            setTeamFeedback(null);
                            try {
                              const res = await upgradeLocalOrgToCloud(
                                activeOrganization.id,
                                (done, total) => setUpgradeOrgProgress({ done, total })
                              );
                              if (!res.ok) {
                                setTeamFeedback({
                                  text:
                                    res.error ||
                                    (isRTL
                                      ? 'تعذر تحويل المؤسسة إلى مؤسسة سحابية. تأكد من اتصالك بالإنترنت وحاول مجدداً.'
                                      : 'Failed to upgrade organization to Cloud. Check your connection and try again.'),
                                  error: true,
                                });
                              } else {
                                setTeamFeedback({
                                  text: isRTL
                                    ? 'تم تحويل المؤسسة إلى مؤسسة سحابية بنجاح! يمكنك الآن إضافة أعضاء الفريق مباشرة.'
                                    : 'Organization upgraded to Cloud successfully! You can now add team members directly.',
                                });
                              }
                            } finally {
                              setIsUpgradingOrgToCloud(false);
                              setUpgradeOrgProgress(null);
                            }
                          }}
                          className="w-full py-2.5 px-3 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-2 min-h-[42px] disabled:opacity-60"
                        >
                          {isUpgradingOrgToCloud ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>
                                {upgradeOrgProgress && upgradeOrgProgress.total > 0
                                  ? isRTL
                                    ? `جاري التحويل للسحابة (${upgradeOrgProgress.done} / ${upgradeOrgProgress.total})...`
                                    : `Upgrading to Cloud (${upgradeOrgProgress.done} / ${upgradeOrgProgress.total})...`
                                  : isRTL
                                  ? 'جاري تحويل المؤسسة إلى مؤسسة سحابية...'
                                  : 'Upgrading to Cloud Organization...'}
                              </span>
                            </>
                          ) : (
                            <>
                              <Shield className="w-4 h-4" />
                              <span>
                                {isRTL
                                  ? 'تحويل إلى مؤسسة سحابية وتفعيل إضافة الأعضاء'
                                  : 'Upgrade to Cloud Organization & Enable Team'}
                              </span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  ) : (
                    <form onSubmit={handleDirectAddMember} className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1 min-w-0">
                          <AtSign className="w-3.5 h-3.5 text-[var(--color-muted)] absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                          <input
                            type="text"
                            dir="ltr"
                            data-testid="direct-member-identifier-input"
                            disabled={isOrgReadOnly || isAddingMember || !seatStatus.canAdd}
                            value={directMemberQuery}
                            onChange={(e) => {
                              setDirectMemberQuery(e.target.value);
                              setLookedUpUser(null);
                              setTeamFeedback(null);
                            }}
                            placeholder={
                              isRTL
                                ? 'example@gmail.com أو @username'
                                : 'example@gmail.com or @username'
                            }
                            className="w-full ps-8 pe-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[42px] disabled:opacity-50"
                          />
                        </div>
                        <button
                          type="button"
                          data-testid="direct-member-search-btn"
                          disabled={
                            isOrgReadOnly ||
                            isSearchingMember ||
                            isAddingMember ||
                            !directMemberQuery.trim()
                          }
                          onClick={() => void handleLookupDirectMember()}
                          className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[var(--color-ink)] text-xs font-semibold flex items-center gap-1.5 min-h-[42px] shrink-0 disabled:opacity-45"
                        >
                          {isSearchingMember ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Search className="w-4 h-4 text-[var(--color-accent)]" />
                          )}
                          <span>{isRTL ? 'بحث' : 'Lookup'}</span>
                        </button>
                      </div>

                      {lookedUpUser && (
                        <div
                          data-testid="direct-member-preview-card"
                          className="p-2.5 rounded-xl bg-[var(--color-income)]/10 border border-[var(--color-income)]/30 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5 flex-wrap">
                              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-income)] shrink-0" />
                              <span className="truncate">{lookedUpUser.displayName}</span>
                              {lookedUpUser.username && (
                                <span
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-accent)]"
                                  dir="ltr"
                                >
                                  {formatUsernameHandle(lookedUpUser.username)}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--color-muted)] truncate" dir="ltr">
                              {lookedUpUser.email}
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-[var(--color-income)] shrink-0">
                            {isRTL ? 'حساب موثّق' : 'Found'}
                          </span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <select
                          data-testid="direct-member-role-select"
                          disabled={isOrgReadOnly || isAddingMember || !seatStatus.canAdd}
                          value={directMemberRole}
                          onChange={(e) =>
                            setDirectMemberRole(
                              e.target.value as Exclude<OrganizationRole, 'owner'>
                            )
                          }
                          aria-label={isRTL ? 'صلاحية العضو' : 'Member role'}
                          className="px-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[42px]"
                        >
                          {ROLES.filter((r) => r.id !== 'owner').map((r) => (
                            <option key={r.id} value={r.id}>
                              {isRTL ? r.labelAr : r.labelEn}
                            </option>
                          ))}
                        </select>

                        <input
                          type="text"
                          disabled={isOrgReadOnly || isAddingMember || !seatStatus.canAdd}
                          value={directMemberDept}
                          onChange={(e) => setDirectMemberDept(e.target.value)}
                          placeholder={isRTL ? 'القسم (اختياري)' : 'Department (opt.)'}
                          className="px-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[42px]"
                        />

                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          disabled={isOrgReadOnly || isAddingMember || !seatStatus.canAdd}
                          value={directMemberLimit}
                          onChange={(e) =>
                            setDirectMemberLimit(normalizeArabicPersianNumerals(e.target.value))
                          }
                          placeholder={
                            isRTL ? `سقف الصرف (${currency})` : `Spend limit (${currency})`
                          }
                          className="px-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[42px] num-tabular"
                        />

                        <button
                          type="submit"
                          data-testid="direct-member-submit-btn"
                          disabled={
                            isOrgReadOnly ||
                            isAddingMember ||
                            !seatStatus.canAdd ||
                            !directMemberQuery.trim()
                          }
                          className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-1.5 min-h-[42px] disabled:opacity-45"
                        >
                          {isAddingMember ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <UserPlus className="w-4 h-4" />
                          )}
                          <span>{isRTL ? 'إضافة للمؤسسة' : 'Add Member'}</span>
                        </button>
                      </div>

                      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">
                        {isRTL
                          ? 'تتم الإضافة مباشرة عبر السحابة وتظهر المؤسسة تلقائياً في حساب العضو فور دخوله التطبيق دون الحاجة لأكواد دعوة.'
                          : 'Members are linked instantly via Cloud Firestore and see this organization automatically in their workspace switcher.'}
                      </p>
                    </form>
                  )}
                </div>
              )}

              {/* Team Members Section */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-[var(--color-ink)]">
                    {isRTL ? `أعضاء الفريق والصلاحيات (${orgMembers.length})` : `Team & Roles (${orgMembers.length})`}
                  </h3>
                </div>

                <div className="space-y-2">
                  {orgMembers.map((member) => {
                    const isSelf = member.uid === user?.id;
                    const isBusy = memberActionBusyUid === member.uid;
                    const isSuspended = member.status === 'suspended';
                    return (
                      <div
                        key={member.uid}
                        className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Shield className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                              <span className="text-xs font-bold text-[var(--color-ink)] truncate">
                                {member.displayName}
                              </span>
                              {member.username && (
                                <span
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-accent)]"
                                  dir="ltr"
                                >
                                  {formatUsernameHandle(member.username)}
                                </span>
                              )}
                              {isSelf && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/12 text-[var(--color-accent)] font-bold">
                                  {isRTL ? 'أنت' : 'You'}
                                </span>
                              )}
                              {isSuspended && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-expense)]/15 text-[var(--color-expense)] font-bold">
                                  {isRTL ? 'موقوف' : 'Suspended'}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--color-muted)] truncate" dir="ltr">
                              {member.email}
                            </div>
                            {(member.department || typeof member.spendingLimit === 'number') && (
                              <div className="text-[10px] text-[var(--color-muted)] mt-0.5">
                                {member.department ? `${member.department} ` : ''}
                                {typeof member.spendingLimit === 'number'
                                  ? `• ${isRTL ? 'سقف الصرف:' : 'Limit:'} ${member.spendingLimit} ${currency}`
                                  : ''}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                            {canOrgManage && member.role !== 'owner' && !isOrgReadOnly ? (
                              <>
                                <select
                                  disabled={isBusy}
                                  value={member.role}
                                  onChange={(e) =>
                                    void handleMemberManage(member.uid, 'change_role', {
                                      role: e.target.value as Exclude<OrganizationRole, 'owner'>,
                                    })
                                  }
                                  className="px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-[11px] font-semibold min-h-[38px] disabled:opacity-50"
                                >
                                  {ROLES.filter((r) => r.id !== 'owner').map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {isRTL ? r.labelAr : r.labelEn}
                                    </option>
                                  ))}
                                </select>

                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    setEditingMemberLimit(
                                      editingMemberLimit?.uid === member.uid
                                        ? null
                                        : {
                                            uid: member.uid,
                                            limit:
                                              typeof member.spendingLimit === 'number'
                                                ? String(member.spendingLimit)
                                                : '',
                                            department: member.department || '',
                                          }
                                    )
                                  }
                                  title={isRTL ? 'تعديل القسم وسقف الصرف' : 'Edit dept & limit'}
                                  className="p-2 text-[var(--color-muted)] hover:text-[var(--color-accent)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] min-h-[38px]"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleMemberManage(
                                      member.uid,
                                      isSuspended ? 'reactivate' : 'suspend'
                                    )
                                  }
                                  title={isSuspended ? (isRTL ? 'إعادة تفعيل' : 'Reactivate') : isRTL ? 'إيقاف مؤقت' : 'Suspend'}
                                  className="p-2 text-[var(--color-muted)] hover:text-amber-600 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] min-h-[38px]"
                                >
                                  {isSuspended ? (
                                    <UserCheck className="w-3.5 h-3.5 text-[var(--color-income)]" />
                                  ) : (
                                    <UserMinus className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                {confirmRemoveUid === member.uid ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => void handleMemberManage(member.uid, 'remove')}
                                      className="px-2 py-1.5 rounded-lg bg-[var(--color-expense)] text-white text-[10px] font-bold min-h-[36px]"
                                    >
                                      {isRTL ? 'تأكيد الطرد' : 'Confirm'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmRemoveUid(null)}
                                      className="px-2 py-1.5 rounded-lg border border-[var(--color-line)] text-[10px] min-h-[36px]"
                                    >
                                      {t('cancel')}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => setConfirmRemoveUid(member.uid)}
                                    aria-label={isRTL ? 'إزالة العضو' : 'Remove member'}
                                    className="p-2 text-[var(--color-muted)] hover:text-[var(--color-expense)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] min-h-[38px]"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg bg-[var(--color-accent)]/12 text-[var(--color-accent)] text-[11px] font-bold">
                                {roleLabel(member.role)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Inline Dept & Spending Limit Editor */}
                        {editingMemberLimit?.uid === member.uid && (
                          <div className="pt-2 border-t border-[var(--color-line)] grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              value={editingMemberLimit.department}
                              onChange={(e) =>
                                setEditingMemberLimit({ ...editingMemberLimit, department: e.target.value })
                              }
                              placeholder={isRTL ? 'القسم' : 'Department'}
                              className="px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[38px]"
                            />
                            <input
                              type="text"
                              inputMode="decimal"
                              dir="ltr"
                              value={editingMemberLimit.limit}
                              onChange={(e) =>
                                setEditingMemberLimit({
                                  ...editingMemberLimit,
                                  limit: normalizeArabicPersianNumerals(e.target.value),
                                })
                              }
                              placeholder={isRTL ? 'سقف الصرف (فارغ = بلا سقف)' : 'Spending limit'}
                              className="px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[38px] num-tabular"
                            />
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  const parsedLim = editingMemberLimit.limit.trim()
                                    ? parseLocalizedNumber(editingMemberLimit.limit)
                                    : null;
                                  void handleMemberManage(member.uid, 'set_spending_limit', {
                                    spendingLimit:
                                      parsedLim !== null && !Number.isNaN(parsedLim) ? parsedLim : null,
                                    department: editingMemberLimit.department.trim(),
                                  });
                                }}
                                className="flex-1 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[38px]"
                              >
                                {t('save')}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingMemberLimit(null)}
                                className="px-2.5 py-1.5 rounded-lg border border-[var(--color-line)] text-xs min-h-[38px]"
                              >
                                {t('cancel')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                  {canOrgManage && !isOrgReadOnly && (
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
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        required
                        value={pettyInitialBalance}
                        onChange={(e) =>
                          setPettyInitialBalance(normalizeArabicPersianNumerals(e.target.value))
                        }
                        placeholder={isRTL ? 'مبلغ العهدة الافتتاحي' : 'Custody Amount'}
                        className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[44px] num-tabular"
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

              {/* Owner / Local Danger Zone: Ownership Transfer & Organization Deletion */}
              {(activeOrgRole === 'owner' || activeOrgPermissions.canDelete) && (
                <div className="pt-3 border-t border-[var(--color-expense)]/30 space-y-3">
                  <h3 className="text-xs font-bold text-[var(--color-expense)] flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{isRTL ? 'منطقة المالك الحساسة' : 'Owner Danger Zone'}</span>
                  </h3>

                  {/* Transfer Ownership (Cloud Owner Only) */}
                  {activeOrgRole === 'owner' && !activeOrgPermissions.isLocalOnly && (
                  <div className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2.5">
                    <div className="text-xs font-bold text-[var(--color-ink)] flex items-center gap-1.5">
                      <ArrowRightLeft className="w-4 h-4 text-[var(--color-accent)]" />
                      <span>{t('transferOwnership')}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={transferTargetUid}
                        onChange={(e) => {
                          setTransferTargetUid(e.target.value);
                          setConfirmTransferOpen(false);
                        }}
                        className="flex-1 min-w-[180px] px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs min-h-[40px]"
                      >
                        <option value="">
                          {isRTL ? 'اختر العضو المستلم للملكية...' : 'Select new owner...'}
                        </option>
                        {orgMembers
                          .filter((m) => m.role !== 'owner' && m.status !== 'suspended')
                          .map((m) => (
                            <option key={m.uid} value={m.uid}>
                              {m.displayName} ({m.email})
                            </option>
                          ))}
                      </select>
                      {!confirmTransferOpen ? (
                        <button
                          type="button"
                          disabled={!transferTargetUid || isTransferringOwner}
                          onClick={() => setConfirmTransferOpen(true)}
                          className="px-3 py-2 rounded-lg border border-[var(--color-accent)]/40 text-[var(--color-accent)] text-xs font-bold min-h-[40px] disabled:opacity-40"
                        >
                          {t('transferOwnership')}
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isTransferringOwner}
                            onClick={() => void handleTransferOwnership()}
                            className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[40px]"
                          >
                            {isTransferringOwner ? '...' : isRTL ? 'تأكيد النقل' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmTransferOpen(false)}
                            className="px-2.5 py-2 rounded-lg border border-[var(--color-line)] text-xs min-h-[40px]"
                          >
                            {t('cancel')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Delete Organization */}
                  <form
                    onSubmit={handleDeleteOrganization}
                    className="p-3.5 rounded-xl bg-[var(--color-expense)]/8 border border-[var(--color-expense)]/30 space-y-2.5"
                  >
                    <div className="text-xs font-bold text-[var(--color-expense)]">
                      {t('deleteOrganization')}
                    </div>
                    <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                      {isRTL
                        ? `سيتم حذف المؤسسة وكافة معاملاتها وأعضائها ومرفقاتها نهائياً. للتأكيد، اكتب اسم المؤسسة: "${activeOrganization.name}"`
                        : `Permanently deletes this organization, all ledger records, members, and attachments. Type "${activeOrganization.name}" to confirm:`}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="text"
                        value={deleteOrgConfirmName}
                        onChange={(e) => setDeleteOrgConfirmName(e.target.value)}
                        placeholder={activeOrganization.name}
                        className="flex-1 min-w-[180px] px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-expense)]/40 rounded-lg text-xs min-h-[40px]"
                      />
                      <button
                        type="submit"
                        disabled={
                          isDeletingOrg ||
                          deleteOrgConfirmName.trim() !== activeOrganization.name.trim()
                        }
                        className="px-4 py-2 rounded-lg bg-[var(--color-expense)] text-white text-xs font-bold min-h-[40px] disabled:opacity-40"
                      >
                        {isDeletingOrg ? '...' : t('deleteOrganization')}
                      </button>
                    </div>
                  </form>
                </div>
              )}
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
                      {paginatedVoucherTransactions.visibleItems.map((tx) => (
                        <option key={tx.id} value={tx.id}>
                          {tx.voucherNumber || tx.id.slice(0, 8)} — {tx.date} — {tx.amount} {tx.currency}{' '}
                          {tx.notes ? `(${tx.notes.slice(0, 24)})` : ''}
                        </option>
                      ))}
                    </select>
                    {paginatedVoucherTransactions.hasMore && (
                      <button
                        type="button"
                        onClick={() => setVisibleVoucherCount((prev) => prev + 100)}
                        className="px-3 py-2 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[11px] font-semibold text-[var(--color-accent)] min-h-[44px]"
                      >
                        {isRTL
                          ? `+100 (${paginatedVoucherTransactions.remainingCount})`
                          : `+100 (${paginatedVoucherTransactions.remainingCount})`}
                      </button>
                    )}
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
                        <div className="flex items-center gap-3 min-w-0">
                          <BrandLogo
                            className="w-10 h-10 rounded-xl object-cover shadow-sm shrink-0"
                            title={t('appName')}
                            lazy={true}
                          />
                          <div className="min-w-0">
                            <div className="font-title leading-snug text-lg font-bold text-[#1E6F73]">
                              {activeOrganization.name}
                            </div>
                            {activeOrganization.taxNumber && (
                              <div className="text-[11px] text-[#5C574D]">
                                {t('taxNumber')}: <bdi dir="ltr">{activeOrganization.taxNumber}</bdi>
                              </div>
                            )}
                          </div>
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
                            {walletsById.get(selectedVoucherTx.walletId)?.name || '—'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-1.5 border-b border-dashed border-[#D4CBB8]">
                          <span className="text-[#6B655A]">{isRTL ? 'البند / التصنيف:' : 'Category:'}</span>
                          <span className="font-semibold">
                            {(() => {
                              const c = categoriesById.get(selectedVoucherTx.categoryId);
                              return c ? (isRTL ? c.nameAr : c.nameEn) : '—';
                            })()}
                          </span>
                        </div>
                        {selectedVoucherTx.costCenterId && (
                          <div className="flex items-center justify-between py-1.5 border-b border-dashed border-[#D4CBB8]">
                            <span className="text-[#6B655A]">{t('costCenters')}:</span>
                            <span className="font-semibold">
                              {(() => {
                                const cc = costCentersById.get(selectedVoucherTx.costCenterId);
                                return cc ? `[${cc.code}] ${isRTL ? cc.nameAr : cc.nameEn}` : '—';
                              })()}
                            </span>
                          </div>
                        )}
                        {selectedVoucherTx.partyId && (
                          <div className="flex items-center justify-between py-1.5 border-b border-dashed border-[#D4CBB8]">
                            <span className="text-[#6B655A]">{isRTL ? 'الجهة (مورد/عميل):' : 'Partner:'}</span>
                            <span className="font-semibold">
                              {partiesById.get(selectedVoucherTx.partyId)?.name || '—'}
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
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        disabled={!canOrgManage}
                        value={orgVatInput}
                        onChange={(e) => setOrgVatInput(normalizeArabicPersianNumerals(e.target.value))}
                        className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg min-h-[44px] num-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                        {isRTL ? 'سقف الاعتماد التلقائي للمصروفات' : 'Approval Threshold'} ({currency})
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        disabled={!canOrgManage}
                        value={orgThresholdInput}
                        onChange={(e) => setOrgThresholdInput(normalizeArabicPersianNumerals(e.target.value))}
                        className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg min-h-[44px] num-tabular"
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

                  {canOrgManage && !isOrgReadOnly && (
                    <button
                      type="submit"
                      data-testid="save-org-policy-btn"
                      className="w-full py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px]"
                    >
                      {isRTL ? 'حفظ سياسة الضريبة وإقفال الفترة' : 'Save Tax Policy & Period Lock'}
                    </button>
                  )}

                  {canOrgManage && !isOrgReadOnly && (
                    <div className="pt-3 mt-3 border-t border-[var(--color-line)] space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <div className="text-xs font-bold text-[var(--color-ink)]">
                            {t('recalculateBalances')}
                          </div>
                          <div className="text-[11px] text-[var(--color-muted)]">
                            {isRTL
                              ? 'يعيد حساب رصيد كل محفظة بناءً على الرصيد الافتتاحي والمعاملات المعتمدة فقط.'
                              : 'Recomputes every wallet balance from initial balance + approved/paid transactions.'}
                          </div>
                        </div>
                        {!confirmRecalc ? (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmRecalc(true);
                              setRecalcMessage(null);
                            }}
                            className="px-3 py-2 rounded-xl border border-[var(--color-accent)]/40 text-[var(--color-accent)] text-xs font-bold flex items-center gap-1.5 min-h-[40px]"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{t('recalculateBalances')}</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isRecalculating}
                              onClick={() => void handleRecalculateBalances()}
                              className="px-3 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center gap-1.5 min-h-[40px] disabled:opacity-50"
                            >
                              {isRecalculating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              <span>{isRTL ? 'تأكيد إعادة الاحتساب' : 'Confirm Recalculate'}</span>
                            </button>
                            <button
                              type="button"
                              disabled={isRecalculating}
                              onClick={() => setConfirmRecalc(false)}
                              className="px-2.5 py-2 rounded-xl border border-[var(--color-line)] text-xs min-h-[40px]"
                            >
                              {t('cancel')}
                            </button>
                          </div>
                        )}
                      </div>
                      {recalcMessage && (
                        <div className="text-[11px] font-semibold text-[var(--color-income)]">
                          {recalcMessage}
                        </div>
                      )}
                    </div>
                  )}
                </form>
              )}

              {/* 5D: Immutable Audit Log */}
              {reportSubTab === 'audit' && (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={auditFilter}
                      onChange={(e) => setAuditFilter(e.target.value)}
                      placeholder={isRTL ? 'بحث في سجل التدقيق...' : 'Search audit log...'}
                      className="px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[40px]"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={auditActorFilter}
                        onChange={(e) => setAuditActorFilter(e.target.value)}
                        aria-label={isRTL ? 'تصفية حسب العضو' : 'Filter by member'}
                        className="px-2.5 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[40px]"
                      >
                        <option value="">{isRTL ? 'كل الأعضاء' : 'All members'}</option>
                        {orgMembers.map((m) => (
                          <option key={m.uid} value={m.uid}>
                            {m.displayName}
                          </option>
                        ))}
                      </select>
                      <select
                        value={auditActionFilter}
                        onChange={(e) => setAuditActionFilter(e.target.value as AuditLogAction | '')}
                        aria-label={isRTL ? 'تصفية حسب الإجراء' : 'Filter by action'}
                        className="px-2.5 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[40px]"
                      >
                        <option value="">{isRTL ? 'كل الإجراءات' : 'All actions'}</option>
                        <option value="create">{isRTL ? 'إنشاء (create)' : 'create'}</option>
                        <option value="update">{isRTL ? 'تعديل (update)' : 'update'}</option>
                        <option value="delete">{isRTL ? 'حذف (delete)' : 'delete'}</option>
                        <option value="restore">{isRTL ? 'استعادة (restore)' : 'restore'}</option>
                        <option value="approve">{isRTL ? 'اعتماد (approve)' : 'approve'}</option>
                        <option value="reject">{isRTL ? 'رفض (reject)' : 'reject'}</option>
                        <option value="lock_period">{isRTL ? 'إقفال فترة (lock_period)' : 'lock_period'}</option>
                        <option value="recalculate">{isRTL ? 'احتساب أرصدة (recalculate)' : 'recalculate'}</option>
                        <option value="role_change">{isRTL ? 'تغيير دور (role_change)' : 'role_change'}</option>
                        <option value="invite_create">{isRTL ? 'دعوة (invite_create)' : 'invite_create'}</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={auditStartDate}
                      onChange={(e) => setAuditStartDate(e.target.value)}
                      aria-label={isRTL ? 'من تاريخ' : 'From date'}
                      className="px-2.5 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[38px]"
                    />
                    <input
                      type="date"
                      value={auditEndDate}
                      onChange={(e) => setAuditEndDate(e.target.value)}
                      aria-label={isRTL ? 'إلى تاريخ' : 'To date'}
                      className="px-2.5 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[38px]"
                    />
                  </div>
                  {filteredAuditLogs.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[var(--color-muted)] bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
                      {isRTL ? 'لا توجد قيود تدقيق مطابقة.' : 'No matching audit log entries.'}
                    </div>
                  ) : (
                    <>
                      {paginatedAuditLogs.visibleItems.map((entry) => (
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
                      ))}
                      {paginatedAuditLogs.hasMore && (
                        <button
                          type="button"
                          onClick={() => setVisibleAuditCount((prev) => prev + 40)}
                          className="w-full py-2.5 px-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-xs font-semibold text-[var(--color-accent)] transition-colors min-h-[42px]"
                        >
                          {isRTL
                            ? `عرض المزيد من سجل التدقيق (${paginatedAuditLogs.remainingCount} متبقي)`
                            : `Load more audit logs (${paginatedAuditLogs.remainingCount} remaining)`}
                        </button>
                      )}
                    </>
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

      {/* Storage / Receipt Attachment Lightbox */}
      {attachmentPreviewUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4"
          onClick={() => setAttachmentPreviewUrl(null)}
        >
          <button
            type="button"
            onClick={() => setAttachmentPreviewUrl(null)}
            aria-label={t('close')}
            className="absolute top-4 end-4 w-11 h-11 rounded-full bg-white/15 text-white hover:bg-white/25 flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={attachmentPreviewUrl}
            alt="receipt preview"
            loading="lazy"
            decoding="async"
            className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Quick Delete Workspace Confirmation Modal */}
      {confirmQuickDeleteOpen && activeOrganization && (
        <div
          data-testid="org-hub-delete-confirm-backdrop"
          onClick={() => {
            if (!isDeletingOrg) setConfirmQuickDeleteOpen(false);
          }}
          dir={isRTL ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div
            data-testid="org-hub-delete-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="org-hub-delete-confirm-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[var(--color-surface)] border border-[var(--color-expense)]/40 rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h3
                  id="org-hub-delete-confirm-title"
                  className="font-title text-sm font-bold text-[var(--color-ink)]"
                >
                  {isRTL ? 'تأكيد حذف مساحة العمل' : 'Confirm Workspace Deletion'}
                </h3>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {formatWorkspaceDeleteConfirmMessage(activeOrganization.name, isRTL)}
                </p>
              </div>
            </div>

            {quickDeleteError && (
              <div className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-300 font-medium">
                {quickDeleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                data-testid="org-hub-delete-cancel-btn"
                disabled={isDeletingOrg}
                onClick={() => {
                  setConfirmQuickDeleteOpen(false);
                  setQuickDeleteError(null);
                }}
                className="px-4 py-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] text-xs font-semibold text-[var(--color-ink)] min-h-[40px] disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                data-testid="org-hub-delete-confirm-btn"
                disabled={isDeletingOrg}
                onClick={async () => {
                  setIsDeletingOrg(true);
                  setQuickDeleteError(null);
                  try {
                    await deleteOrganization(activeOrganization.name, activeOrganization.id);
                    setDeleteOrgConfirmName('');
                    setConfirmQuickDeleteOpen(false);
                    setIsOrgHubOpen(false);
                  } catch (err: any) {
                    setQuickDeleteError(
                      err?.message ||
                        (isRTL ? 'تعذر حذف المؤسسة حالياً.' : 'Failed to delete organization.')
                    );
                  } finally {
                    setIsDeletingOrg(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold min-h-[40px] flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeletingOrg && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isRTL ? 'حذف نهائياً' : 'Delete Permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
