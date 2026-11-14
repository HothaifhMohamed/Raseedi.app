import React, { useState, useMemo } from 'react';
import {
  HandCoins,
  Plus,
  AlertCircle,
  CheckCircle2,
  History,
  Trash2,
  Edit2,
  X,
  User,
  Crown,
  Sparkles,
  Building2,
  Clock,
  Phone,
  Mail,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BusinessParty, Debt, DebtType } from '../../types';
import {
  calculateAgingReport,
  formatLocalDate,
} from '../../services/calculations';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { MoneyText } from '../common/MoneyText';

export const DebtsPage: React.FC = () => {
  const {
    isOrgWorkspace,
    activeOrganization,
    orgParties,
    canOrgWrite,
    addBusinessParty,
    updateBusinessParty,
    deleteBusinessParty,
    debts,
    wallets,
    settings,
    addDebt,
    updateDebt,
    recordDebtPayment,
    deleteDebt,
    openCurrencyPicker,
    isPro,
    setIsUpgradeModalOpen,
    t,
    isRTL,
  } = useApp();

  // Enterprise Vendors/Clients state
  const [partyTab, setPartyTab] = useState<'vendor' | 'client' | 'aging'>('vendor');
  const [partyModalOpen, setPartyModalOpen] = useState(false);
  const [editingParty, setEditingParty] = useState<BusinessParty | null>(null);
  const [partyType, setPartyType] = useState<'vendor' | 'client' | 'both'>('vendor');
  const [partyName, setPartyName] = useState('');
  const [partyBalance, setPartyBalance] = useState('');
  const [partyCurrency, setPartyCurrency] = useState(activeOrganization?.currency || settings.mainCurrency);
  const [partyDueDate, setPartyDueDate] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [partyEmail, setPartyEmail] = useState('');
  const [partyTaxId, setPartyTaxId] = useState('');
  const [partyNotes, setPartyNotes] = useState('');
  const [confirmDeletePartyId, setConfirmDeletePartyId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<DebtType>('owed_to_me');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [paymentModalDebt, setPaymentModalDebt] = useState<Debt | null>(null);
  const [historyModalDebt, setHistoryModalDebt] = useState<Debt | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Add/Edit Form State
  const [personName, setPersonName] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [currency, setCurrency] = useState(settings.mainCurrency);
  const [dueDate, setDueDate] = useState('');
  const [monthlyInstallment, setMonthlyInstallment] = useState('');
  const [notes, setNotes] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentWalletId, setPaymentWalletId] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [logAsWalletTx, setLogAsWalletTx] = useState(true);

  const orgCurrency = activeOrganization?.currency || settings.mainCurrency;
  const agingReport = useMemo(() => {
    return calculateAgingReport(orgParties, orgCurrency, settings.customExchangeRates);
  }, [orgParties, orgCurrency, settings.customExchangeRates]);

  const filteredParties = useMemo(() => {
    if (partyTab === 'aging') return orgParties;
    return orgParties.filter((p) => p.type === partyTab || p.type === 'both');
  }, [orgParties, partyTab]);

  const openPartyModal = (p?: BusinessParty) => {
    if (!canOrgWrite) return;
    if (p) {
      setEditingParty(p);
      setPartyType(p.type);
      setPartyName(p.name);
      setPartyBalance(String(p.balance));
      setPartyCurrency(p.currency);
      setPartyDueDate(p.dueDate || '');
      setPartyPhone(p.phone || '');
      setPartyEmail(p.email || '');
      setPartyTaxId(p.taxId || '');
      setPartyNotes(p.notes || '');
    } else {
      setEditingParty(null);
      setPartyType(partyTab === 'client' ? 'client' : 'vendor');
      setPartyName('');
      setPartyBalance('');
      setPartyCurrency(orgCurrency);
      setPartyDueDate(formatLocalDate(new Date()));
      setPartyPhone('');
      setPartyEmail('');
      setPartyTaxId('');
      setPartyNotes('');
    }
    setPartyModalOpen(true);
  };

  const handleSaveParty = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canOrgWrite) return;
    const bal = parseFloat(partyBalance);
    if (!partyName.trim() || Number.isNaN(bal) || bal < 0) return;
    const payload = {
      type: partyType,
      name: partyName.trim(),
      balance: bal,
      currency: partyCurrency,
      dueDate: partyDueDate || undefined,
      phone: partyPhone.trim() || undefined,
      email: partyEmail.trim() || undefined,
      taxId: partyTaxId.trim() || undefined,
      notes: partyNotes.trim() || undefined,
    };
    if (editingParty) {
      updateBusinessParty(editingParty.id, payload);
    } else {
      addBusinessParty(payload);
    }
    setPartyModalOpen(false);
  };

  const openAddModal = (d?: Debt) => {
    if (!d && !isPro && debts.length >= 2) {
      setIsUpgradeModalOpen(true);
      return;
    }

    if (d) {
      setEditingDebt(d);
      setPersonName(d.personName);
      setTotalAmount(String(d.totalAmount));
      setCurrency(d.currency);
      setDueDate(d.dueDate || '');
      setMonthlyInstallment(d.monthlyInstallment ? String(d.monthlyInstallment) : '');
      setNotes(d.notes || '');
      setContactPhone(d.contactPhone || '');
    } else {
      setEditingDebt(null);
      setPersonName('');
      setTotalAmount('');
      setCurrency(settings.mainCurrency);
      setDueDate('');
      setMonthlyInstallment('');
      setNotes('');
      setContactPhone('');
    }
    setIsAddModalOpen(true);
  };

  const handleSaveDebt = (e: React.FormEvent) => {
    e.preventDefault();
    const tot = parseFloat(totalAmount);
    if (!personName.trim() || isNaN(tot) || tot <= 0) return;

    const payload = {
      type: activeTab,
      personName: personName.trim(),
      totalAmount: tot,
      paidAmount: editingDebt ? editingDebt.paidAmount : 0,
      currency,
      dueDate: dueDate || undefined,
      monthlyInstallment: monthlyInstallment ? parseFloat(monthlyInstallment) : undefined,
      notes: notes.trim(),
      contactPhone: contactPhone.trim(),
    };

    if (editingDebt) {
      updateDebt(editingDebt.id, payload);
    } else {
      addDebt(payload);
    }

    setIsAddModalOpen(false);
  };

  const handleOpenPayment = (d: Debt) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    setPaymentModalDebt(d);
    setPaymentAmount(d.monthlyInstallment ? String(d.monthlyInstallment) : String(d.totalAmount - d.paidAmount));
    setPaymentDate(todayStr);
    setPaymentWalletId(wallets[0]?.id || '');
    setPaymentNotes('');
    setLogAsWalletTx(true);
  };

  const handleRecordPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalDebt) return;
    const amountNum = parseFloat(paymentAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    recordDebtPayment(
      paymentModalDebt.id,
      {
        amount: amountNum,
        date: paymentDate,
        walletId: paymentWalletId || undefined,
        notes: paymentNotes.trim(),
      },
      logAsWalletTx
    );

    setPaymentModalDebt(null);
  };

  const filteredDebts = useMemo(() => {
    return debts.filter((d) => d.type === activeTab);
  }, [debts, activeTab]);

  const { totalDebtsAmount, totalPaidAmount, totalRemainingAmount } = useMemo(() => {
    let tot = 0;
    let paid = 0;
    for (const d of filteredDebts) {
      tot += d.totalAmount;
      paid += d.paidAmount;
    }
    return {
      totalDebtsAmount: tot,
      totalPaidAmount: paid,
      totalRemainingAmount: tot - paid,
    };
  }, [filteredDebts]);

  const todayStr = formatLocalDate(new Date());

  // ============================================================================
  // ENTERPRISE MODE: Vendors (AP), Clients (AR) & Aging Report
  // ============================================================================
  if (isOrgWorkspace) {
    return (
      <div className="flex flex-col flex-1 px-4 py-3 pb-24 space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Header */}
        <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between gap-2">
          <div>
            <h2 className="font-title text-base font-bold text-[var(--color-ink)] flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[var(--color-accent)]" />
              <span>{t('vendorsAndClients')}</span>
            </h2>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              {isRTL
                ? 'إدارة الموردين (AP) والعملاء (AR) وتقرير أعمار الديون'
                : 'Manage Payables (AP), Receivables (AR) & Aging Report'}
            </p>
          </div>

          {canOrgWrite && (
            <button
              type="button"
              onClick={() => openPartyModal()}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 transition-opacity min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>{isRTL ? 'إضافة طرف' : 'Add Party'}</span>
            </button>
          )}
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
            <span className="text-[11px] text-[var(--color-muted)] block">
              {isRTL ? 'مستحقات على الشركة (موردون AP)' : 'Payables Due (AP)'}
            </span>
            <MoneyText
              amount={agingReport.payablesTotal}
              currency={orgCurrency}
              className="text-base font-bold text-[var(--color-expense)] mt-0.5 block"
            />
          </div>
          <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
            <span className="text-[11px] text-[var(--color-muted)] block">
              {isRTL ? 'مستحقات للشركة (عملاء AR)' : 'Receivables Due (AR)'}
            </span>
            <MoneyText
              amount={agingReport.receivablesTotal}
              currency={orgCurrency}
              className="text-base font-bold text-[var(--color-income)] mt-0.5 block"
            />
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
          <button
            type="button"
            onClick={() => setPartyTab('vendor')}
            className={`py-2 rounded-lg text-xs font-semibold transition-colors min-h-[40px] ${
              partyTab === 'vendor'
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {isRTL ? 'الموردون (AP)' : 'Vendors (AP)'}
          </button>
          <button
            type="button"
            onClick={() => setPartyTab('client')}
            className={`py-2 rounded-lg text-xs font-semibold transition-colors min-h-[40px] ${
              partyTab === 'client'
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {isRTL ? 'العملاء (AR)' : 'Clients (AR)'}
          </button>
          <button
            type="button"
            onClick={() => setPartyTab('aging')}
            className={`py-2 rounded-lg text-xs font-semibold transition-colors min-h-[40px] ${
              partyTab === 'aging'
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {isRTL ? 'أعمار الديون' : 'Aging'}
          </button>
        </div>

        {partyTab === 'aging' ? (
          <div className="space-y-3">
            {[
              {
                title: isRTL ? 'تقادم الموردين (AP — التزامات)' : 'Payables Aging (AP)',
                buckets: agingReport.payablesBuckets,
                accentClass: 'text-[var(--color-expense)]',
              },
              {
                title: isRTL ? 'تقادم العملاء (AR — تحصيلات)' : 'Receivables Aging (AR)',
                buckets: agingReport.receivablesBuckets,
                accentClass: 'text-[var(--color-income)]',
              },
            ].map((section) => (
              <div
                key={section.title}
                className="p-3.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-[var(--color-ink)] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                    {section.title}
                  </span>
                  <MoneyText amount={section.buckets.total} currency={orgCurrency} className={section.accentClass} />
                </div>
                <div className="grid grid-cols-4 gap-1.5 text-[11px] num-tabular">
                  {[
                    { label: '0-30d', val: section.buckets.bucket0_30 },
                    { label: '31-60d', val: section.buckets.bucket31_60 },
                    { label: '61-90d', val: section.buckets.bucket61_90 },
                    { label: '90+d', val: section.buckets.bucket90Plus },
                  ].map((b) => (
                    <div
                      key={b.label}
                      className="p-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-center"
                    >
                      <span className="text-[10px] text-[var(--color-muted)] block" dir="ltr">
                        {b.label}
                      </span>
                      <MoneyText amount={b.val} currency={orgCurrency} className="font-bold text-[var(--color-ink)]" />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {agingReport.parties.length === 0 ? (
              <div className="p-6 text-center bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-muted)]">
                {isRTL ? 'لا توجد أرصدة معلقة في تقرير الأعمار.' : 'No outstanding party balances.'}
              </div>
            ) : (
              <div className="space-y-2">
                {agingReport.parties.map((row) => (
                  <div
                    key={row.partyId}
                    className="p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--color-ink)] truncate">{row.name}</div>
                      <div className="text-[10px] text-[var(--color-muted)]">
                        {row.type === 'vendor'
                          ? isRTL
                            ? 'مورد (AP)'
                            : 'Vendor'
                          : isRTL
                          ? 'عميل (AR)'
                          : 'Client'}
                        {row.dueDate && ` • ${row.dueDate}`}
                        {row.daysOverdue > 0 && (
                          <span className="text-[var(--color-expense)] font-semibold ms-1">
                            ({row.daysOverdue} {isRTL ? 'يوم تأخير' : 'd overdue'})
                          </span>
                        )}
                      </div>
                    </div>
                    <MoneyText
                      amount={row.total}
                      currency={orgCurrency}
                      className={`font-bold shrink-0 ${
                        row.type === 'vendor' ? 'text-[var(--color-expense)]' : 'text-[var(--color-income)]'
                      }`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : filteredParties.length === 0 ? (
          <div className="p-8 text-center bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl space-y-2">
            <Building2 className="w-8 h-8 mx-auto text-[var(--color-muted)]" />
            <p className="text-xs text-[var(--color-muted)]">
              {partyTab === 'vendor'
                ? isRTL
                  ? 'لا يوجد موردون مسجلون بعد.'
                  : 'No vendors recorded yet.'
                : isRTL
                ? 'لا يوجد عملاء مسجلون بعد.'
                : 'No clients recorded yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredParties.map((party) => {
              const isOverdue = party.dueDate && party.dueDate < todayStr && party.balance > 0;
              return (
                <div
                  key={party.id}
                  className={`p-3.5 rounded-xl border ${
                    isOverdue
                      ? 'bg-[var(--color-expense)]/10 border-[var(--color-expense)]/30'
                      : 'bg-[var(--color-surface)] border-[var(--color-line)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-xs font-bold text-[var(--color-ink)]">{party.name}</h3>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]">
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
                        {isOverdue && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-expense)]/15 text-[var(--color-expense)] font-bold">
                            {t('overdue')}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--color-muted)] mt-1">
                        {party.dueDate && (
                          <span>
                            {t('dueDate')}: {party.dueDate}
                          </span>
                        )}
                        {party.taxId && (
                          <span dir="ltr">
                            Tax: {party.taxId}
                          </span>
                        )}
                        {party.phone && (
                          <span className="flex items-center gap-0.5" dir="ltr">
                            <Phone className="w-3 h-3" /> {party.phone}
                          </span>
                        )}
                        {party.email && (
                          <span className="flex items-center gap-0.5" dir="ltr">
                            <Mail className="w-3 h-3" /> {party.email}
                          </span>
                        )}
                      </div>
                      {party.notes && (
                        <p className="text-[11px] text-[var(--color-muted)] mt-1 italic">{party.notes}</p>
                      )}
                    </div>

                    <div className="text-end shrink-0">
                      <MoneyText
                        amount={party.balance}
                        currency={party.currency}
                        className={`text-sm font-bold block ${
                          party.type === 'vendor' ? 'text-[var(--color-expense)]' : 'text-[var(--color-income)]'
                        }`}
                      />
                      {canOrgWrite && (
                        <div className="flex items-center justify-end gap-1 mt-1">
                          <button
                            type="button"
                            onClick={() => openPartyModal(party)}
                            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg min-h-[32px] min-w-[32px] flex items-center justify-center"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeletePartyId(party.id)}
                            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-expense)] rounded-lg min-h-[32px] min-w-[32px] flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add/Edit Business Party Modal */}
        {partyModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl max-h-[88vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-4">
                <h3 className="font-title text-sm font-bold">
                  {editingParty
                    ? isRTL
                      ? 'تعديل بيانات المورد/العميل'
                      : 'Edit Business Party'
                    : isRTL
                    ? 'إضافة مورد أو عميل'
                    : 'Add Vendor or Client'}
                </h3>
                <button
                  type="button"
                  onClick={() => setPartyModalOpen(false)}
                  className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveParty} className="space-y-3">
                <div className="grid grid-cols-3 gap-1.5">
                  {(['vendor', 'client', 'both'] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setPartyType(pt)}
                      className={`py-2 rounded-lg text-xs font-semibold border min-h-[38px] ${
                        partyType === pt
                          ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                          : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)]'
                      }`}
                    >
                      {pt === 'vendor'
                        ? isRTL
                          ? 'مورد'
                          : 'Vendor'
                        : pt === 'client'
                        ? isRTL
                          ? 'عميل'
                          : 'Client'
                        : isRTL
                        ? 'كلاهما'
                        : 'Both'}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {isRTL ? 'الاسم التجاري' : 'Party Name'}
                  </label>
                  <input
                    type="text"
                    required
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                      {isRTL ? 'الرصيد المستحق' : 'Outstanding Balance'}
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      value={partyBalance}
                      onChange={(e) => setPartyBalance(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs num-tabular min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                      {isRTL ? 'العملة' : 'Currency'}
                    </label>
                    <button
                      type="button"
                      onClick={() => openCurrencyPicker((c) => setPartyCurrency(c), partyCurrency)}
                      className="w-full py-2 px-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs font-bold text-[var(--color-accent)] min-h-[44px]"
                    >
                      {partyCurrency}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                      {t('dueDate')}
                    </label>
                    <input
                      type="date"
                      value={partyDueDate}
                      onChange={(e) => setPartyDueDate(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                      {t('taxNumber')}
                    </label>
                    <input
                      type="text"
                      value={partyTaxId}
                      onChange={(e) => setPartyTaxId(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="tel"
                    value={partyPhone}
                    onChange={(e) => setPartyPhone(e.target.value)}
                    placeholder={isRTL ? 'رقم الهاتف' : 'Phone'}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[40px]"
                  />
                  <input
                    type="email"
                    value={partyEmail}
                    onChange={(e) => setPartyEmail(e.target.value)}
                    placeholder={isRTL ? 'البريد الإلكتروني' : 'Email'}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[40px]"
                  />
                </div>

                <input
                  type="text"
                  value={partyNotes}
                  onChange={(e) => setPartyNotes(e.target.value)}
                  placeholder={t('notes')}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs min-h-[40px]"
                />

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs min-h-[44px]"
                  >
                    {t('save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPartyModalOpen(false)}
                    className="px-4 py-2.5 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] rounded-xl text-xs min-h-[44px]"
                  >
                    {t('cancel')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <ConfirmationModal
          isOpen={!!confirmDeletePartyId}
          onClose={() => setConfirmDeletePartyId(null)}
          onConfirm={() => {
            if (confirmDeletePartyId) deleteBusinessParty(confirmDeletePartyId);
          }}
          title={t('delete')}
          message={isRTL ? 'هل أنت متأكد من حذف هذا المورد/العميل؟' : 'Delete this vendor/client record?'}
          confirmLabel={t('delete')}
          cancelLabel={t('cancel')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 px-4 py-3 pb-24 space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between">
        <div>
          <h2 className="font-title text-base font-bold text-[var(--color-ink)] flex items-center gap-2">
            <HandCoins className="w-4 h-4 text-[var(--color-accent)]" />
            <span>{t('debtsTitle')}</span>
          </h2>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            {isRTL ? 'سجل ومتابعة المستحقات والديون والأقساط' : 'Track payables, receivables & installments'}
          </p>
        </div>

        <button
          onClick={() => openAddModal()}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 transition-opacity min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          <span>{t('addDebt')}</span>
          {!isPro && debts.length >= 2 && (
            <Crown className="w-3.5 h-3.5 ms-0.5" />
          )}
        </button>
      </div>

      {/* Free limit banner */}
      {!isPro && debts.length >= 2 && (
        <div className="p-2.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>{isRTL ? 'وصلت للحد المجاني (دينين فقط)' : 'Free limit reached (2 debts only)'}</span>
          <button
            onClick={() => setIsUpgradeModalOpen(true)}
            className="text-[var(--color-accent)] font-semibold hover:underline flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            <span>
              {isRTL ? (
                <>
                  ترقية لـ <bdi dir="ltr">PRO</bdi>
                </>
              ) : (
                'Upgrade PRO'
              )}
            </span>
          </button>
        </div>
      )}

      {/* Tabs: "Owed to Me" vs "I Owe" */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
        <button
          onClick={() => setActiveTab('owed_to_me')}
          className={`py-2 rounded-lg text-xs font-semibold transition-colors min-h-[40px] ${
            activeTab === 'owed_to_me'
              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          {t('tabOwedToMe')}
        </button>
        <button
          onClick={() => setActiveTab('i_owe')}
          className={`py-2 rounded-lg text-xs font-semibold transition-colors min-h-[40px] ${
            activeTab === 'i_owe'
              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          {t('tabIOwe')}
        </button>
      </div>

      {/* Summary Card */}
      <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between">
        <div>
          <span className="text-[11px] text-[var(--color-muted)] block mb-0.5">
            {isRTL ? 'إجمالي المتبقي:' : 'Total Remaining:'}
          </span>
          <span
            className={`text-xl font-bold num-tabular tracking-tight ${
              activeTab === 'owed_to_me' ? 'text-[var(--color-income)]' : 'text-[var(--color-expense)]'
            }`}
          >
            <MoneyText
              amount={totalRemainingAmount}
              currency={settings.mainCurrency}
              sign={activeTab === 'owed_to_me' ? '+' : '−'}
            />
          </span>
        </div>

        <div className="text-end text-xs text-[var(--color-muted)] num-tabular">
          <div>
            {isRTL ? 'الإجمالي:' : 'Total:'}{' '}
            <MoneyText
              amount={totalDebtsAmount}
              currency={settings.mainCurrency}
            />
          </div>
          <div className="text-[var(--color-income)]">
            {isRTL ? 'المسدد:' : 'Paid:'}{' '}
            <MoneyText
              amount={totalPaidAmount}
              currency={settings.mainCurrency}
            />
          </div>
        </div>
      </div>

      {/* Debts List */}
      {filteredDebts.length === 0 ? (
        <div className="p-8 my-4 text-center bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex flex-col items-center">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-income)]/10 text-[var(--color-income)] flex items-center justify-center mb-2">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-[var(--color-ink)] mb-1">{t('noDebts')}</h3>
          <p className="text-xs text-[var(--color-muted)] max-w-xs leading-relaxed mb-4">
            {isRTL
              ? 'سجل أي أموال أقرضتها أو استدنتها لمتابعة الدفعات والأقساط بمواعيدها بدقة.'
              : 'Record borrowed or lent money to track installments and due dates accurately.'}
          </p>
          <button
            onClick={() => openAddModal()}
            className="flex items-center gap-1.5 px-4 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>{t('addDebt')}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDebts.map((debt) => {
            const remaining = debt.totalAmount - debt.paidAmount;
            const percentage = debt.totalAmount > 0 ? Math.round((debt.paidAmount / debt.totalAmount) * 100) : 0;
            const isOverdue = debt.dueDate && debt.dueDate < todayStr && !debt.isSettled;
            const isDueSoon =
              debt.dueDate &&
              debt.dueDate >= todayStr &&
              new Date(debt.dueDate).getTime() - Date.now() < 3 * 86400000 &&
              !debt.isSettled;

            return (
              <div
                key={debt.id}
                className={`p-4 rounded-xl border transition-all ${
                  debt.isSettled
                    ? 'bg-[var(--color-surface)]/60 border-[var(--color-line)] opacity-80'
                    : isOverdue
                    ? 'bg-[var(--color-expense)]/10 border-[var(--color-expense)]/30'
                    : 'bg-[var(--color-surface)] border border-[var(--color-line)]'
                }`}
              >
                {/* Top: Person + Due Status + Actions */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-[var(--color-accent)]" />
                      <h3 className="text-xs font-bold text-[var(--color-ink)]">{debt.personName}</h3>
                      {debt.isSettled ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-income)]/15 text-[var(--color-income)] font-semibold">
                          {t('settled')}
                        </span>
                      ) : isOverdue ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-expense)]/15 text-[var(--color-expense)] font-bold flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          <span>{t('overdue')}</span>
                        </span>
                      ) : isDueSoon ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning-text)] font-bold">
                          {t('dueSoon')}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-[var(--color-muted)] mt-0.5">
                      {debt.dueDate && (
                        <span>
                          {isRTL ? 'الاستحقاق:' : 'Due:'} {debt.dueDate}
                        </span>
                      )}
                      {debt.monthlyInstallment && (
                        <>
                          <span>•</span>
                          <span>
                            {isRTL ? 'قسط:' : 'Installment:'}{' '}
                            <MoneyText amount={debt.monthlyInstallment} currency={debt.currency} />
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openAddModal(debt)}
                      className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(debt.id)}
                      className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-expense)] rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1.5 mb-3">
                  <div className="w-full h-2 rounded-full bg-[var(--color-line)]/60 overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-income)] rounded-full transition-all duration-300"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs num-tabular">
                    <span className="text-[var(--color-muted)]">
                      {isRTL ? 'مسدد:' : 'Paid:'} <MoneyText amount={debt.paidAmount} currency={debt.currency} /> ({percentage}%)
                    </span>
                    <span className="font-bold text-[var(--color-ink)]">
                      {isRTL ? 'متبقي:' : 'Remaining:'} <MoneyText amount={remaining} currency={debt.currency} />
                    </span>
                  </div>
                </div>

                {debt.notes && (
                  <p className="text-[11px] text-[var(--color-muted)] mb-3 italic">
                    "{debt.notes}"
                  </p>
                )}

                {/* Buttons: Record Payment & History */}
                <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-line)]">
                  {!debt.isSettled && (
                    <button
                      onClick={() => handleOpenPayment(debt)}
                      className="flex-1 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-lg text-xs hover:opacity-95 transition-opacity min-h-[38px]"
                    >
                      {t('recordPayment')}
                    </button>
                  )}
                  <button
                    onClick={() => setHistoryModalDebt(debt)}
                    className="flex items-center justify-center gap-1 py-2 px-3 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-lg text-xs transition-colors min-h-[38px]"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>
                      {isRTL ? 'سجل الدفعات' : 'Payments'} ({debt.payments.length})
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentModalDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-4">
              <h3 className="font-title text-sm font-bold">
                {t('recordPayment')} - {paymentModalDebt.personName}
              </h3>
              <button
                onClick={() => setPaymentModalDebt(null)}
                className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {t('amount')}
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px] num-tabular"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {t('date')}
                </label>
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {isRTL ? 'المحفظة المستهدفة' : 'Target Wallet'}
                </label>
                <select
                  value={paymentWalletId}
                  onChange={(e) => setPaymentWalletId(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
                <span className="text-xs text-[var(--color-ink)]">{t('logPaymentAsTransaction')}</span>
                <input
                  type="checkbox"
                  checked={logAsWalletTx}
                  onChange={(e) => setLogAsWalletTx(e.target.checked)}
                  className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer min-h-[20px] min-w-[20px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {t('notes')}
                </label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="ملاحظة عن الدفعة (مثال: سداد القسط الثاني)"
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 transition-opacity min-h-[44px]"
              >
                {isRTL ? 'تأكيد السداد وحفظ' : 'Confirm & Save Payment'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {historyModalDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-4">
              <h3 className="font-title text-sm font-bold">
                {t('paymentHistory')} - {historyModalDebt.personName}
              </h3>
              <button
                onClick={() => setHistoryModalDebt(null)}
                className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {historyModalDebt.payments.length === 0 ? (
                <div className="text-center py-8 text-xs text-[var(--color-muted)]">
                  {isRTL ? 'لم يتم تسجيل أي دفعات بعد.' : 'No payments recorded yet.'}
                </div>
              ) : (
                historyModalDebt.payments.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-semibold text-[var(--color-ink)]">{p.date}</div>
                      {p.notes && <div className="text-[10px] text-[var(--color-muted)]">{p.notes}</div>}
                    </div>
                    <div className="num-tabular font-bold text-[var(--color-income)]">
                      <MoneyText amount={p.amount} currency={historyModalDebt.currency} sign="+" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Debt Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-4">
              <h3 className="font-title text-sm font-bold">
                {editingDebt ? (isRTL ? 'تعديل الدين' : 'Edit Debt') : t('addDebt')}
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDebt} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {isRTL ? 'اسم الشخص أو الجهة' : 'Person or Entity'}
                </label>
                <input
                  type="text"
                  required
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  placeholder="مثال: أحمد محمود، بنك الأهلي..."
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {isRTL ? 'إجمالي المبلغ' : 'Total Amount'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] num-tabular min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {isRTL ? 'العملة' : 'Currency'}
                  </label>
                  <button
                    type="button"
                    onClick={() => openCurrencyPicker((code) => setCurrency(code), currency)}
                    className="w-full py-2 px-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs font-bold text-[var(--color-accent)] text-center min-h-[44px]"
                  >
                    {currency}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {isRTL ? 'تاريخ الاستحقاق' : 'Due Date'}
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {isRTL ? 'القسط الشهري' : 'Monthly Installment'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={monthlyInstallment}
                    onChange={(e) => setMonthlyInstallment(e.target.value)}
                    placeholder="اختياري"
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] num-tabular min-h-[44px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {isRTL ? 'ملاحظات' : 'Notes'}
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="وصف الدين أو سبب المعاملة..."
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 transition-opacity min-h-[44px]"
                >
                  {t('save')}
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2.5 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] rounded-xl text-xs min-h-[44px]"
                >
                  {t('cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmationModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) deleteDebt(confirmDeleteId);
        }}
        title={t('delete')}
        message={isRTL ? 'هل أنت متأكد من حذف هذا السجل؟' : 'Are you sure you want to delete this debt?'}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
};
