import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Camera,
  Repeat,
  Tag,
  User,
  AlertCircle,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Calculator as CalcIcon,
  Sparkles,
  Zap,
  ScanLine,
  Loader2,
  Plus,
  Users,
  ZoomIn,
  CheckCircle2,
  Crown,
  Building2,
  Lock,
  Percent,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TransactionType, PriorityLevel, RecurrenceFrequency, Transaction } from '../types';
import { CalculatorKeypad } from './CalculatorKeypad';
import { CurrencyPickerModal } from './common/CurrencyPickerModal';
import { IconRenderer } from './common/IconRenderer';
import { HairlineFigure } from './common/HairlineVisuals';
import { convertCurrency, toMinor } from '../services/currency';
import {
  calculateVatBreakdown,
  evaluateCalculatorExpression,
  formatLocalDate,
  isDateInLockedPeriod,
  parseLocalDate,
  roundCurrency,
} from '../services/calculations';
import { resolveOrgAttachmentUrl, uploadOrgReceiptAttachment } from '../services/firebase';
import { parseDialectQuickEntry } from '../services/dialectParser';
import {
  normalizeArabicPersianNumerals,
  normalizeMixedNumericText,
  parseLocalizedNumber,
} from '../services/numbers';
import { prepareReceiptImageDataUrl, ReceiptScanError, scanReceiptWithAI } from '../services/receiptScanner';
import { matchMerchantRule, sanitizeMerchantRules } from '../services/merchantRules';

import { TransactionDraftPreset } from '../services/walletQuickActions';

const QUICK_CAT_COLORS = ['#1E6F73', '#B5523B', '#5E7F3A', '#C99A2E', '#6A5243', '#545E75'];
const QUICK_CAT_ICONS = ['ShoppingBag', 'Utensils', 'Coffee', 'Car', 'Receipt', 'HeartPulse', 'Sparkles', 'Layers'];

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  editTransaction?: Transaction | null;
  presetDraft?: TransactionDraftPreset | null;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  editTransaction,
  presetDraft,
}) => {
  const {
    wallets,
    categories,
    settings,
    user,
    scanQuota,
    setScanQuota,
    signInWithGoogleAccount,
    addTransaction,
    updateTransaction,
    addTemplate,
    addCategory,
    addDebt,
    transactions,
    isPro,
    setIsUpgradeModalOpen,
    isOrgWorkspace,
    activeOrganization,
    activeOrgRole,
    isOrgReadOnly,
    canOrgWrite,
    attachOrgReceiptPaths,
    orgMembers,
    orgCostCenters,
    orgParties,
    activeWorkspace,
    t,
    isRTL,
  } = useApp();

  const workspaceRuleKey =
    isOrgWorkspace && activeOrganization
      ? activeOrganization.id
      : activeWorkspace || 'personal';
  const activeMerchantRules = useMemo(
    () => sanitizeMerchantRules(settings.merchantRulesByWorkspace?.[workspaceRuleKey]),
    [settings.merchantRulesByWorkspace, workspaceRuleKey]
  );
  const manualTypeOverrideRef = useRef(false);
  const manualCategoryOverrideRef = useRef(false);
  const manualWalletOverrideRef = useRef(false);
  const manualCostCenterOverrideRef = useRef(false);
  const [matchedRuleKeyword, setMatchedRuleKeyword] = useState<string | null>(null);

  // Form State
  const [type, setType] = useState<TransactionType>('expense');
  const [amountExpr, setAmountExpr] = useState('');
  const [currency, setCurrency] = useState(settings.mainCurrency);
  const [categoryId, setCategoryId] = useState('');
  const [walletId, setWalletId] = useState('');
  const [toWalletId, setToWalletId] = useState('');
  const [transferFeeInput, setTransferFeeInput] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState<PriorityLevel>('normal');
  const [doesNotAffectBalance, setDoesNotAffectBalance] = useState(false);
  const [group, setGroup] = useState('');
  const [contact, setContact] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const [resolvedPathUrls, setResolvedPathUrls] = useState<Record<string, string>>({});
  const [saveAsTmpl, setSaveAsTmpl] = useState(false);
  const [templateName, setTemplateName] = useState('');

  // Recurrence
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('monthly');
  const [interval, setInterval] = useState(1);
  const [endDate, setEndDate] = useState('');
  const [maxOccurrences, setMaxOccurrences] = useState<number | undefined>(undefined);

  // Quick Entry (Dialect parser), AI Receipt Scanner & UI helpers
  const [quickText, setQuickText] = useState('');
  const [showKeypad, setShowKeypad] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [currencyModalOpen, setCurrencyModalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [scanSuccessMsg, setScanSuccessMsg] = useState('');
  const [isScanningReceipt, setIsScanningReceipt] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Inline Quick Category Creator
  const [showNewCatForm, setShowNewCatForm] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('ShoppingBag');
  const [newCatColor, setNewCatColor] = useState('#1E6F73');

  // Split Bill / Debt Link
  const [enableSplitBill, setEnableSplitBill] = useState(false);
  const [splitFriendName, setSplitFriendName] = useState('');
  const [splitMode, setSplitMode] = useState<'half' | 'amount' | 'percent'>('half');
  const [splitValueInput, setSplitValueInput] = useState('');

  const [receiptAuthPrompt, setReceiptAuthPrompt] = useState(false);

  // Enterprise Accounting Fields
  const [costCenterId, setCostCenterId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [voucherNumber, setVoucherNumber] = useState('');
  const [isReimbursement, setIsReimbursement] = useState(false);
  const [enableVat, setEnableVat] = useState(false);
  const [vatRateInput, setVatRateInput] = useState(
    String(activeOrganization?.vatRate ?? 14)
  );
  const [isTaxInclusive, setIsTaxInclusive] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  // Filter categories by type
  const filteredCategories = useMemo(() => {
    return categories.filter((c) => {
      if (c.isHidden) return false;
      if (type === 'transfer') return true;
      return c.type === type || c.type === 'both';
    });
  }, [categories, type]);

  // Last 5 unique category+amount quick-add combos
  const quickAddCombos = useMemo(() => {
    const seen = new Set<string>();
    const combos: Array<{
      key: string;
      type: TransactionType;
      categoryId: string;
      amount: number;
      currency: string;
      walletId: string;
      categoryName: string;
      categoryColor: string;
    }> = [];

    for (const tx of transactions) {
      if (tx.type === 'transfer') continue;
      const key = `${tx.type}|${tx.categoryId}|${tx.amount}|${tx.currency}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const cat = categories.find((c) => c.id === tx.categoryId);
      combos.push({
        key,
        type: tx.type,
        categoryId: tx.categoryId,
        amount: tx.amount,
        currency: tx.currency,
        walletId: tx.walletId,
        categoryName: isRTL ? cat?.nameAr || 'عام' : cat?.nameEn || 'General',
        categoryColor: cat?.color || 'var(--color-accent)',
      });
      if (combos.length >= 5) break;
    }
    return combos;
  }, [transactions, categories, isRTL]);

  // Live Dialect Quick-Entry parse
  const parsedQuickEntry = useMemo(() => {
    if (!quickText.trim()) return null;
    return parseDialectQuickEntry(quickText, categories);
  }, [quickText, categories]);

  const parsedCategory = useMemo(() => {
    if (!parsedQuickEntry) return null;
    return categories.find((c) => c.id === parsedQuickEntry.categoryId) || null;
  }, [parsedQuickEntry, categories]);

  // Past contacts and groups for autocomplete
  const pastContacts = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.contact?.trim()) set.add(tx.contact.trim());
    });
    return Array.from(set);
  }, [transactions]);

  const pastGroups = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.group?.trim()) set.add(tx.group.trim());
    });
    return Array.from(set);
  }, [transactions]);

  // Initialize or reset form ONLY when modal opens or editTransaction changes
  useEffect(() => {
    if (!isOpen) return;
    if (editTransaction) {
      setType(editTransaction.type);
      setAmountExpr(String(editTransaction.amount));
      setCurrency(editTransaction.currency);
      setCategoryId(editTransaction.categoryId);
      setWalletId(editTransaction.walletId);
      setToWalletId(editTransaction.toWalletId || '');
      setTransferFeeInput(
        editTransaction.transferFee && editTransaction.transferFee > 0
          ? String(editTransaction.transferFee)
          : ''
      );
      setNotes(editTransaction.notes || '');
      setDate(editTransaction.date);
      setTime(editTransaction.time);
      setPriority(editTransaction.priority);
      setDoesNotAffectBalance(editTransaction.doesNotAffectBalance);
      setGroup(editTransaction.group || '');
      setContact(editTransaction.contact || '');
      setAttachments(editTransaction.attachments || []);
      setAttachmentPaths(editTransaction.attachmentPaths || []);
      setIsRecurring(!!editTransaction.isRecurring);
      if (editTransaction.recurrenceRule) {
        setFrequency(editTransaction.recurrenceRule.frequency);
        setInterval(editTransaction.recurrenceRule.interval);
        setEndDate(editTransaction.recurrenceRule.endDate || '');
        setMaxOccurrences(editTransaction.recurrenceRule.maxOccurrences);
      }
      setQuickText('');
      setSaveAsTmpl(false);
      setShowKeypad(false);
      setShowMoreDetails(
        Boolean(editTransaction.attachments?.length || editTransaction.attachmentPaths?.length)
      );
      setCostCenterId(editTransaction.costCenterId || '');
      setPartyId(editTransaction.partyId || '');
      setInvoiceNumber(editTransaction.invoiceNumber || '');
      setVoucherNumber(editTransaction.voucherNumber || '');
      setIsReimbursement(!!editTransaction.isReimbursement);
      setEnableVat(typeof editTransaction.taxAmount === 'number' && editTransaction.taxAmount > 0);
      setVatRateInput(String(editTransaction.taxRate ?? activeOrganization?.vatRate ?? 14));
      setIsTaxInclusive(editTransaction.isTaxInclusive !== false);
    } else {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const todayStr = formatLocalDate(now);
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

      const initialType: TransactionType =
        presetDraft?.type || settings.lastUsedTransactionType || 'expense';
      const presetWallet = presetDraft?.walletId
        ? wallets.find((w) => w.id === presetDraft.walletId)
        : null;
      const defaultWallet =
        presetWallet ||
        (settings.useLastUsedWallet && settings.lastUsedWalletId
          ? wallets.find((w) => w.id === settings.lastUsedWalletId)
          : null) ||
        wallets[0];

      const presetToWallet =
        presetDraft?.toWalletId && presetDraft.toWalletId !== defaultWallet?.id
          ? wallets.find((w) => w.id === presetDraft.toWalletId)
          : null;
      const fallbackToWallet =
        wallets.find((w) => !w.isArchived && w.id !== defaultWallet?.id) ||
        wallets.find((w) => w.id !== defaultWallet?.id);

      setType(initialType);
      setAmountExpr('');
      setCurrency(presetDraft?.currency || defaultWallet?.currency || settings.mainCurrency);
      setWalletId(defaultWallet?.id || '');
      setToWalletId((presetToWallet || fallbackToWallet)?.id || '');
      setTransferFeeInput('');

      const defaultCat = categories.find((c) => {
        if (c.isHidden) return false;
        if (initialType === 'transfer') return true;
        return c.type === initialType || c.type === 'both';
      });
      setCategoryId(defaultCat?.id || categories[0]?.id || '');
      setNotes('');
      setDate(todayStr);
      setTime(timeStr);
      setPriority('normal');
      setDoesNotAffectBalance(false);
      setGroup('');
      setContact('');
      setAttachments([]);
      setAttachmentPaths([]);
      setIsRecurring(false);
      setQuickText('');
      setSaveAsTmpl(false);
      setShowKeypad(false);
      setShowMoreDetails(false);
      setCostCenterId('');
      setPartyId('');
      setInvoiceNumber('');
      setIsReimbursement(false);
      setEnableVat(false);
      setVatRateInput(String(activeOrganization?.vatRate ?? 14));
      setIsTaxInclusive(true);
    }
    setErrorMsg('');
    setScanSuccessMsg('');
    setIsScanningReceipt(false);
    setLightboxImage(null);
    setShowNewCatForm(false);
    setNewCatName('');
    setEnableSplitBill(false);
    setSplitFriendName('');
    setSplitMode('half');
    setSplitValueInput('');
    setReceiptAuthPrompt(false);
    manualTypeOverrideRef.current = Boolean(presetDraft?.type);
    manualCategoryOverrideRef.current = false;
    manualWalletOverrideRef.current = false;
    manualCostCenterOverrideRef.current = false;
    setMatchedRuleKeyword(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editTransaction, presetDraft]);

  // Resolve Firebase Storage download URLs for existing org attachment paths
  useEffect(() => {
    if (!isOpen || attachmentPaths.length === 0) {
      setResolvedPathUrls({});
      return;
    }
    let cancelled = false;
    Promise.all(
      attachmentPaths.map(async (p) => {
        try {
          const url = await resolveOrgAttachmentUrl(p);
          return [p, url] as const;
        } catch {
          return [p, ''] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [k, v] of entries) {
        if (v) map[k] = v;
      }
      setResolvedPathUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, attachmentPaths]);

  const handleWalletChange = (wId: string) => {
    manualWalletOverrideRef.current = true;
    setWalletId(wId);
    const selected = wallets.find((w) => w.id === wId);
    if (selected) {
      setCurrency(selected.currency);
    }
    if (toWalletId === wId) {
      const nextTo =
        wallets.find((w) => !w.isArchived && w.id !== wId) ||
        wallets.find((w) => w.id !== wId);
      setToWalletId(nextTo?.id || '');
    }
  };

  const applyMerchantRulesForText = (text: string, overrideType?: TransactionType) => {
    const activeType = overrideType ?? type;
    if (editTransaction || activeType === 'transfer' || activeMerchantRules.length === 0) {
      setMatchedRuleKeyword(null);
      return;
    }
    let match = matchMerchantRule(text, activeMerchantRules, activeType);
    let switchedType = false;
    if (!match && !manualTypeOverrideRef.current && !overrideType) {
      const anyTypeMatch = matchMerchantRule(text, activeMerchantRules);
      if (
        anyTypeMatch &&
        (anyTypeMatch.rule.type === 'expense' || anyTypeMatch.rule.type === 'income')
      ) {
        match = anyTypeMatch;
        setType(anyTypeMatch.rule.type);
        switchedType = true;
      }
    }
    if (!match) {
      setMatchedRuleKeyword(null);
      return;
    }
    let appliedAny = switchedType;
    if (
      match.categoryId &&
      !manualCategoryOverrideRef.current &&
      categories.some((c) => c.id === match.categoryId && !c.isHidden)
    ) {
      setCategoryId(match.categoryId);
      appliedAny = true;
    }
    if (
      match.walletId &&
      !manualWalletOverrideRef.current &&
      wallets.some((w) => w.id === match.walletId && !w.isArchived)
    ) {
      const targetW = wallets.find((w) => w.id === match.walletId);
      if (targetW) {
        setWalletId(targetW.id);
        setCurrency(targetW.currency);
        appliedAny = true;
      }
    }
    if (
      isOrgWorkspace &&
      match.costCenterId &&
      !manualCostCenterOverrideRef.current &&
      orgCostCenters.some((cc) => cc.id === match.costCenterId && cc.isActive)
    ) {
      setCostCenterId(match.costCenterId);
      appliedAny = true;
    }
    setMatchedRuleKeyword(appliedAny ? match.rule.keyword : null);
  };

  const applyQuickCombo = (combo: (typeof quickAddCombos)[number]) => {
    setType(combo.type);
    setCategoryId(combo.categoryId);
    setAmountExpr(String(combo.amount));
    setCurrency(combo.currency);
    const matchingWallet = wallets.find((w) => w.id === combo.walletId);
    if (matchingWallet) {
      setWalletId(matchingWallet.id);
    }
    setErrorMsg('');
  };

  const applyParsedQuickEntry = (autoSave = false) => {
    if (!parsedQuickEntry) return;
    setType(parsedQuickEntry.type);
    setAmountExpr(String(parsedQuickEntry.amount));
    setCategoryId(parsedQuickEntry.categoryId);
    if (parsedQuickEntry.notes) {
      setNotes(parsedQuickEntry.notes);
    }
    setQuickText('');
    setErrorMsg('');

    if (autoSave) {
      if (isOrgWorkspace && (isOrgReadOnly || !canOrgWrite)) {
        setErrorMsg(
          isOrgReadOnly
            ? t('orgReadOnlyBanner')
            : isRTL
            ? 'صلاحيتك الحالية لا تسمح بإضافة معاملات.'
            : 'Your role cannot add transactions.'
        );
        return;
      }
      const targetWalletId = walletId || wallets[0]?.id;
      if (!targetWalletId) return;
      try {
        addTransaction({
          type: parsedQuickEntry.type,
          amount: parsedQuickEntry.amount,
          currency,
          date,
          time,
          categoryId: parsedQuickEntry.categoryId,
          walletId: targetWalletId,
          notes: parsedQuickEntry.notes,
          priority: 'normal',
          doesNotAffectBalance: false,
        });
        onClose();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to save transaction');
      }
    }
  };

  const destinationAmount = useMemo(() => {
    if (type !== 'transfer' || !walletId || !toWalletId) return 0;
    const fromW = wallets.find((w) => w.id === walletId);
    const toW = wallets.find((w) => w.id === toWalletId);
    if (!fromW || !toW) return 0;

    const evaluated = evaluateCalculatorExpression(amountExpr).result;
    return convertCurrency(evaluated, fromW.currency, toW.currency, settings.customExchangeRates);
  }, [type, walletId, toWalletId, amountExpr, wallets, settings.customExchangeRates]);

  const evaluatedAmount = useMemo(() => {
    return evaluateCalculatorExpression(amountExpr).result;
  }, [amountExpr]);

  const parsedVatRate = Math.max(0, parseLocalizedNumber(vatRateInput) || 0);
  const vatPreview = useMemo(() => {
    if (!isOrgWorkspace || !enableVat || type === 'transfer' || evaluatedAmount <= 0) {
      return null;
    }
    return calculateVatBreakdown(evaluatedAmount, parsedVatRate, isTaxInclusive, currency);
  }, [isOrgWorkspace, enableVat, type, evaluatedAmount, parsedVatRate, isTaxInclusive, currency]);

  const isLockedDate = useMemo(() => {
    if (!isOrgWorkspace || !activeOrganization?.lockedUntilDate || !date) return false;
    return isDateInLockedPeriod(date, activeOrganization.lockedUntilDate);
  }, [isOrgWorkspace, activeOrganization?.lockedUntilDate, date]);

  const currentOrgMember = useMemo(() => {
    if (!isOrgWorkspace || !user?.id) return null;
    return orgMembers.find((m) => m.uid === user.id) || null;
  }, [isOrgWorkspace, user?.id, orgMembers]);

  const orgCompliancePreview = useMemo(() => {
    if (!isOrgWorkspace || !activeOrganization) return null;
    const rawAmount = vatPreview ? vatPreview.grossAmount : evaluatedAmount;
    const convertedAmt =
      rawAmount > 0
        ? convertCurrency(
            rawAmount,
            currency,
            activeOrganization.currency,
            settings.customExchangeRates
          )
        : 0;
    const limit = currentOrgMember?.spendingLimit;
    const exceedsSpendingLimit =
      activeOrgRole === 'employee' &&
      typeof limit === 'number' &&
      limit > 0 &&
      convertedAmt > limit;
    const willRequireApproval =
      type !== 'transfer' &&
      (activeOrgRole === 'employee' ||
        isReimbursement ||
        (type === 'expense' &&
          activeOrganization.approvalThreshold > 0 &&
          convertedAmt > activeOrganization.approvalThreshold));

    return {
      convertedAmt,
      limit,
      exceedsSpendingLimit,
      willRequireApproval,
    };
  }, [
    isOrgWorkspace,
    activeOrganization,
    vatPreview,
    evaluatedAmount,
    currency,
    settings.customExchangeRates,
    currentOrgMember,
    activeOrgRole,
    type,
    isReimbursement,
  ]);

  const parsedTransferFee = useMemo(() => {
    if (type !== 'transfer') return 0;
    const raw = parseLocalizedNumber(transferFeeInput);
    if (isNaN(raw) || raw <= 0) return 0;
    return roundCurrency(raw, currency);
  }, [type, transferFeeInput, currency]);

  const computedSplitDebtAmount = useMemo(() => {
    if (!enableSplitBill || type !== 'expense') return 0;
    const total = evaluatedAmount > 0 ? evaluatedAmount : 0;
    if (splitMode === 'half') {
      return roundCurrency(total / 2, currency);
    }
    const rawVal = parseLocalizedNumber(splitValueInput);
    if (isNaN(rawVal) || rawVal <= 0) return 0;
    if (splitMode === 'percent') {
      const pct = Math.min(100, Math.max(0, rawVal));
      return roundCurrency((total * pct) / 100, currency);
    }
    return roundCurrency(rawVal, currency);
  }, [enableSplitBill, type, evaluatedAmount, splitMode, splitValueInput, currency]);

  const handleReceiptScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg('');
    setScanSuccessMsg('');
    setIsScanningReceipt(true);

    try {
      const { dataUrl, mimeType } = await prepareReceiptImageDataUrl(file);
      const scanned = await scanReceiptWithAI(
        dataUrl,
        mimeType,
        categories,
        isRTL,
        isOrgWorkspace ? activeOrganization?.id : undefined
      );

      setType('expense');
      if (scanned.amount > 0) {
        setAmountExpr(String(scanned.amount));
      }
      if (scanned.date) {
        setDate(scanned.date);
      }
      if (scanned.categoryId) {
        setCategoryId(scanned.categoryId);
      }
      const merchantText = scanned.merchant?.trim() || '';
      const notesText = scanned.notes?.trim() || '';
      const combinedNotes =
        merchantText && notesText
          ? notesText.toLowerCase().includes(merchantText.toLowerCase())
            ? notesText
            : `${merchantText} - ${notesText}`
          : merchantText || notesText;
      if (combinedNotes) {
        setNotes(combinedNotes);
      }
      if (scanned.quota) {
        setScanQuota(scanned.quota);
      }
      setAttachments((prev) => [...prev, dataUrl]);
      setReceiptAuthPrompt(false);
      setScanSuccessMsg(
        isRTL
          ? 'تم تحليل الفاتورة بالذكاء الاصطناعي — راجع التفاصيل ثم احفظ'
          : 'Receipt scanned with AI — review fields & save'
      );
    } catch (err) {
      if (err instanceof ReceiptScanError) {
        if (err.quota) {
          setScanQuota(err.quota);
        }
        if (err.code === 'AUTH_REQUIRED') {
          setReceiptAuthPrompt(true);
        } else if (err.code === 'QUOTA_EXCEEDED') {
          setIsUpgradeModalOpen(true);
        }
      }
      const msg =
        err instanceof Error && err.message
          ? err.message
          : isRTL
          ? 'تعذر تحليل الفاتورة.'
          : 'Failed to scan receipt.';
      setErrorMsg(msg);
    } finally {
      setIsScanningReceipt(false);
    }
  };

  const handleCreateQuickCategory = () => {
    const cleanName = newCatName.trim();
    if (!cleanName) return;

    const created = addCategory({
      nameAr: cleanName,
      nameEn: cleanName,
      icon: newCatIcon,
      color: newCatColor,
      type: type === 'income' ? 'income' : 'expense',
      order: categories.length + 1,
    });
    setCategoryId(created.id);
    setNewCatName('');
    setShowNewCatForm(false);
    setErrorMsg('');
    requestAnimationFrame(() => {
      document.getElementById(`cat-pill-${created.id}`)?.scrollIntoView({ block: 'nearest' });
    });
  };

  const maxFreeAttachments = 1;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingFreeSlots = isPro
      ? files.length
      : Math.max(0, maxFreeAttachments - attachments.length);
    if (remainingFreeSlots === 0) {
      e.target.value = '';
      setIsUpgradeModalOpen(true);
      return;
    }

    Array.from(files)
      .slice(0, remainingFreeSlots)
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = event.target?.result as string;
          if (result) {
            const img = new Image();
            img.src = result;
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const maxDimension = 800;
              let width = img.width;
              let height = img.height;
              if (width > height) {
                if (width > maxDimension) {
                  height = Math.round((height * maxDimension) / width);
                  width = maxDimension;
                }
              } else {
                if (height > maxDimension) {
                  width = Math.round((width * maxDimension) / height);
                  height = maxDimension;
                }
              }
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx?.drawImage(img, 0, 0, width, height);
              const compressed = canvas.toDataURL('image/jpeg', 0.7);
              setAttachments((prev) =>
                isPro ? [...prev, compressed] : [...prev, compressed].slice(0, maxFreeAttachments)
              );
            };
          }
        };
        reader.readAsDataURL(file);
      });
    e.target.value = '';
  };

  const handlePickContact = async () => {
    try {
      if ('contacts' in navigator && 'ContactsManager' in window) {
        // @ts-ignore
        const contacts = await navigator.contacts.select(['name'], { multiple: false });
        if (contacts && contacts.length > 0 && contacts[0].name && contacts[0].name[0]) {
          setContact(contacts[0].name[0]);
        }
      } else {
        const el = document.getElementById('contact-input');
        el?.focus();
      }
    } catch {
      // Ignored
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isOrgWorkspace && (isOrgReadOnly || !canOrgWrite)) {
      setErrorMsg(
        isOrgReadOnly
          ? t('orgReadOnlyBanner')
          : isRTL
          ? 'صلاحيتك الحالية لا تسمح بإضافة أو تعديل المعاملات.'
          : 'Your role cannot create or edit transactions.'
      );
      return;
    }

    const evaluated = evaluateCalculatorExpression(amountExpr);

    if (evaluated.error || evaluated.result <= 0) {
      setErrorMsg(t('validationAmountRequired'));
      return;
    }
    if (!walletId) {
      setErrorMsg(t('validationWalletRequired'));
      return;
    }
    if (type !== 'transfer' && !categoryId) {
      setErrorMsg(t('validationCategoryRequired'));
      return;
    }
    if (type === 'transfer' && (!toWalletId || walletId === toWalletId)) {
      setErrorMsg(t('validationTransferWalletsDifferent'));
      return;
    }
    if (enableSplitBill && type === 'expense') {
      if (!splitFriendName.trim()) {
        setErrorMsg(
          isRTL ? 'أدخل اسم الصديق لتسجيل حصته كدين' : "Enter friend's name to record their split share"
        );
        return;
      }
      if (computedSplitDebtAmount <= 0 || computedSplitDebtAmount > evaluated.result) {
        setErrorMsg(
          isRTL
            ? 'أدخل قيمة أو نسبة صالحة لحصة الدين (أكبر من 0 ولا تتجاوز إجمالي الفاتورة)'
            : 'Enter a valid split share amount or percentage within the total bill'
        );
        return;
      }
    }

    if (isLockedDate) {
      setErrorMsg(
        isRTL
          ? `الفترة المحاسبية مقفلة حتى ${activeOrganization?.lockedUntilDate}. اختر تاريخاً أحدث.`
          : `Accounting period is locked through ${activeOrganization?.lockedUntilDate}. Choose a newer date.`
      );
      return;
    }

    if (orgCompliancePreview?.exceedsSpendingLimit) {
      setErrorMsg(
        isRTL
          ? `المبلغ يتجاوز سقف الصرف المحدد لك (${orgCompliancePreview.limit} ${activeOrganization?.currency}).`
          : `Amount exceeds your assigned spending limit (${orgCompliancePreview.limit} ${activeOrganization?.currency}).`
      );
      return;
    }

    const finalAmount = vatPreview ? vatPreview.grossAmount : evaluated.result;
    const orgId = isOrgWorkspace ? activeOrganization?.id : undefined;
    const newDataUrls = orgId ? attachments.filter((src) => src.startsWith('data:')) : [];
    const safeAttachmentsForPayload = orgId
      ? attachments.filter((src) => !src.startsWith('data:'))
      : attachments;

    const payload: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
      type,
      amount: finalAmount,
      currency,
      date,
      time,
      categoryId: type === 'transfer' ? 'cat-withdraw' : categoryId,
      walletId,
      toWalletId: type === 'transfer' ? toWalletId : undefined,
      convertedAmount: type === 'transfer' ? destinationAmount : undefined,
      transferFee: type === 'transfer' && parsedTransferFee > 0 ? parsedTransferFee : undefined,
      notes: notes.trim(),
      priority,
      doesNotAffectBalance,
      group: group.trim() || undefined,
      contact: contact.trim() || undefined,
      attachments: safeAttachmentsForPayload,
      ...(orgId && attachmentPaths.length > 0 ? { attachmentPaths } : {}),
      isRecurring,
      recurrenceRule: isRecurring
        ? {
            frequency,
            interval: Number(interval) || 1,
            endDate: endDate || undefined,
            maxOccurrences: maxOccurrences ? Number(maxOccurrences) : undefined,
            occurrencesCount: 0,
            nextDueDate: date,
            anchorDayOfMonth: parseLocalDate(date).getDate(),
          }
        : undefined,
      ...(isOrgWorkspace
        ? {
            workspaceId: activeOrganization?.id,
            costCenterId: costCenterId || undefined,
            partyId: partyId || undefined,
            invoiceNumber: invoiceNumber.trim() || undefined,
            voucherNumber: voucherNumber.trim() || undefined,
            isReimbursement,
            taxAmount: vatPreview ? vatPreview.taxAmount : undefined,
            taxRate: vatPreview ? parsedVatRate : undefined,
            isTaxInclusive: vatPreview ? isTaxInclusive : undefined,
            vat: vatPreview
              ? {
                  rate: parsedVatRate,
                  amountMinor: toMinor(vatPreview.taxAmount, currency),
                  inclusive: isTaxInclusive,
                }
              : undefined,
          }
        : {}),
    };

    let targetTx: Transaction | null = null;
    try {
      if (editTransaction) {
        updateTransaction(editTransaction.id, payload);
        targetTx = { ...editTransaction, ...payload, updatedAt: Date.now() };
      } else {
        targetTx = addTransaction(payload);

        if (saveAsTmpl) {
          addTemplate({
            name: templateName.trim() || notes.trim() || (type === 'expense' ? 'قالب مصروف' : 'قالب دخل'),
            type,
            amount: evaluated.result,
            currency,
            categoryId: type === 'transfer' ? 'cat-withdraw' : categoryId,
            walletId,
            toWalletId: type === 'transfer' ? toWalletId : undefined,
            transferFee: type === 'transfer' && parsedTransferFee > 0 ? parsedTransferFee : undefined,
            notes: notes.trim(),
            priority,
            doesNotAffectBalance,
            group: group.trim() || undefined,
            contact: contact.trim() || undefined,
          });
        }
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isRTL
          ? 'تعذر حفظ المعاملة.'
          : 'Failed to save transaction.'
      );
      return;
    }

    if (orgId && targetTx && newDataUrls.length > 0) {
      const savedTxSnapshot = targetTx;
      const basePaths = [...attachmentPaths];
      void Promise.all(
        newDataUrls.map((dataUrl, i) =>
          uploadOrgReceiptAttachment(orgId, savedTxSnapshot.id, dataUrl, `receipt_${i + 1}.jpg`, 'image/jpeg')
        )
      )
        .then((results) => {
          const uploadedPaths = results.map((r) => r.path).filter(Boolean);
          if (uploadedPaths.length > 0) {
            return attachOrgReceiptPaths(savedTxSnapshot.id, [...basePaths, ...uploadedPaths], savedTxSnapshot);
          }
        })
        .catch((err) => {
          console.warn('Org receipt storage upload deferred/failed:', err);
        });
    }

    if (enableSplitBill && type === 'expense' && splitFriendName.trim() && computedSplitDebtAmount > 0) {
      const baseNote = notes.trim() || (isRTL ? 'فاتورة مشتركة' : 'Shared bill');
      addDebt({
        type: 'owed_to_me',
        personName: splitFriendName.trim(),
        totalAmount: computedSplitDebtAmount,
        paidAmount: 0,
        currency,
        notes: isRTL
          ? `حصة من فاتورة: ${baseNote} (${date})`
          : `Split bill share: ${baseNote} (${date})`,
      });
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div
        className="w-full sm:max-w-md max-h-[90vh] flex flex-col rounded-t-xl sm:rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] shadow-xl overflow-hidden animate-in fade-in duration-150"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-line)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <HairlineFigure
              figure="stack"
              surface="surface"
              tone="accent"
              intensity={0.78}
              stroke={1.15}
              label={editTransaction ? 'Edit Transaction' : 'Add Transaction'}
              className="w-10 shrink-0"
            />
            <h2 className="font-title text-base font-bold text-[var(--color-ink)] truncate">
              {editTransaction ? (isRTL ? 'تعديل المعاملة' : 'Edit Transaction') : (isRTL ? 'إضافة معاملة جديدة' : 'Add Transaction')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors min-h-[36px] min-w-[36px] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {isOrgWorkspace && isOrgReadOnly && (
            <div className="p-2.5 rounded-lg bg-amber-500/12 border border-amber-500/35 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between gap-2">
              <span className="font-semibold">{t('orgReadOnlyBanner')}</span>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  setIsUpgradeModalOpen(true);
                }}
                className="px-2.5 py-1 rounded bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[10px] font-bold shrink-0"
              >
                {isRTL ? 'ترقية' : 'Upgrade'}
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 text-[var(--color-expense)] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {scanSuccessMsg && (
            <div className="p-2.5 rounded-lg bg-[var(--color-income)]/10 border border-[var(--color-income)]/30 text-[var(--color-income)] text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{scanSuccessMsg}</span>
            </div>
          )}

          {/* Dialect Quick Entry + AI Receipt Scan + Recent 5 Quick-Add Chips */}
          {!editTransaction && (
            <div className="space-y-2.5">
              {/* Dialect Quick Entry Input + PRO AI Receipt Scan Button */}
              <div className="space-y-2">
                <div className="relative">
                  <Sparkles className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-accent)]" />
                  <input
                    type="text"
                    value={quickText}
                    onChange={(e) => setQuickText(normalizeMixedNumericText(e.target.value))}
                    placeholder={
                      isRTL
                        ? 'إدخال سريع: غدا 50 • بنزين ٢٠٠ • راتب 8000'
                        : 'Quick entry: lunch 50 • gas 200 • salary 8000'
                    }
                    className="w-full py-2 ps-8 pe-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!user?.isLoggedIn) {
                      setReceiptAuthPrompt(true);
                      setErrorMsg(
                        isRTL
                          ? 'سجّل الدخول بحساب جوجل لاستخدام مسح الفواتير (3 محاولات مجانية شهرياً).'
                          : 'Sign in with Google to use AI receipt scanning (3 free scans/month).'
                      );
                      return;
                    }
                    if (!isPro && scanQuota && scanQuota.remaining <= 0) {
                      setIsUpgradeModalOpen(true);
                      return;
                    }
                    receiptInputRef.current?.click();
                  }}
                  disabled={isScanningReceipt}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[var(--color-accent)] text-xs font-semibold flex items-center justify-between gap-2 transition-colors min-h-[44px] disabled:opacity-60"
                >
                  <span className="flex items-center gap-2">
                    {isScanningReceipt ? (
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    ) : (
                      <ScanLine className="w-4 h-4 shrink-0" />
                    )}
                    <span>
                      {isScanningReceipt
                        ? isRTL
                          ? 'جاري تحليل الفاتورة بالذكاء الاصطناعي...'
                          : 'Scanning receipt with AI...'
                        : isRTL
                        ? 'مسح فاتورة بالذكاء الاصطناعي ✨'
                        : 'Scan Receipt with AI ✨'}
                    </span>
                  </span>
                  {!isPro && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-accent)]/12 text-[var(--color-accent)] text-[10px] font-bold shrink-0">
                      {scanQuota && scanQuota.remaining <= 0 ? (
                        <>
                          <Crown className="w-3 h-3" />
                          <bdi dir="ltr">PRO</bdi>
                        </>
                      ) : (
                        <bdi dir="ltr">
                          {scanQuota ? `${scanQuota.remaining}/${scanQuota.limit}` : '3/mo'}
                        </bdi>
                      )}
                    </span>
                  )}
                </button>
                {receiptAuthPrompt && !user?.isLoggedIn && (
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await signInWithGoogleAccount();
                      if (res) {
                        setReceiptAuthPrompt(false);
                        setErrorMsg('');
                      }
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold min-h-[40px]"
                  >
                    {isRTL ? 'تسجيل الدخول بحساب جوجل للمتابعة' : 'Sign in with Google to Continue'}
                  </button>
                )}
                <input
                  ref={receiptInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleReceiptScan}
                />

                {/* Live Preview Chip */}
                {parsedQuickEntry && (
                  <div className="p-2 rounded-xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: parsedCategory?.color || 'var(--color-accent)' }}
                      />
                      <span className="font-bold text-[var(--color-ink)] truncate">
                        {isRTL ? parsedCategory?.nameAr : parsedCategory?.nameEn}
                      </span>
                      <span className="font-bold text-[var(--color-accent)] num-tabular shrink-0">
                        {parsedQuickEntry.amount} {currency}
                      </span>
                      <span className="text-[10px] text-[var(--color-muted)] shrink-0">
                        ({parsedQuickEntry.type === 'income' ? t('typeIncome') : t('typeExpense')})
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => applyParsedQuickEntry(false)}
                        className="px-2 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] text-[11px] font-semibold min-h-[30px]"
                      >
                        {isRTL ? 'تطبيق' : 'Fill'}
                      </button>
                      <button
                        type="button"
                        onClick={() => applyParsedQuickEntry(true)}
                        className="px-2.5 py-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-semibold min-h-[30px]"
                      >
                        {isRTL ? 'حفظ' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Last 5 Category + Amount Combos */}
              {quickAddCombos.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  <span className="text-[10px] text-[var(--color-muted)] flex items-center gap-0.5 shrink-0">
                    <Zap className="w-3 h-3 text-[var(--color-accent)]" />
                    <span>{isRTL ? 'سريع:' : 'Recent:'}</span>
                  </span>
                  {quickAddCombos.map((combo) => (
                    <button
                      key={combo.key}
                      type="button"
                      onClick={() => applyQuickCombo(combo)}
                      className="px-2.5 py-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[11px] flex items-center gap-1.5 shrink-0 transition-colors min-h-[32px]"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: combo.categoryColor }}
                      />
                      <span className="font-medium text-[var(--color-ink)]">{combo.categoryName}</span>
                      <span className="font-bold text-[var(--color-accent)] num-tabular">
                        {combo.amount}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Type Selector (Flat segmented tabs) */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
            <button
              type="button"
              onClick={() => {
                manualTypeOverrideRef.current = true;
                manualCategoryOverrideRef.current = false;
                setType('expense');
                const defaultCat = categories.find((c) => c.type === 'expense' || c.type === 'both');
                if (defaultCat) setCategoryId(defaultCat.id);
                if (notes.trim()) applyMerchantRulesForText(notes, 'expense');
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors min-h-[40px] ${
                type === 'expense'
                  ? 'bg-[var(--color-expense)] text-white shadow-xs'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {t('typeExpense')}
            </button>
            <button
              type="button"
              onClick={() => {
                manualTypeOverrideRef.current = true;
                manualCategoryOverrideRef.current = false;
                setType('income');
                const defaultCat = categories.find((c) => c.type === 'income' || c.type === 'both');
                if (defaultCat) setCategoryId(defaultCat.id);
                if (notes.trim()) applyMerchantRulesForText(notes, 'income');
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors min-h-[40px] ${
                type === 'income'
                  ? 'bg-[var(--color-income)] text-white shadow-xs'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {t('typeIncome')}
            </button>
            <button
              type="button"
              onClick={() => {
                manualTypeOverrideRef.current = true;
                setType('transfer');
                setMatchedRuleKeyword(null);
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors min-h-[40px] ${
                type === 'transfer'
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {t('typeTransfer')}
            </button>
          </div>

          {/* 1. AMOUNT (Shown first, with small calculator button) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-[var(--color-ink)]">
                {t('amount')}
              </label>
              <button
                type="button"
                onClick={() => setShowKeypad(!showKeypad)}
                className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors min-h-[36px] ${
                  showKeypad
                    ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                    : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
                title={isRTL ? 'لوحة الآلة الحاسبة' : 'Calculator Keypad'}
              >
                <CalcIcon className="w-3.5 h-3.5" />
                <span className="text-[11px]">{showKeypad ? (isRTL ? 'إخفاء' : 'Hide') : (isRTL ? 'حاسبة' : 'Calc')}</span>
              </button>
            </div>

            {showKeypad ? (
              <CalculatorKeypad
                expression={amountExpr}
                onChange={setAmountExpr}
                currencyCode={currency}
                onOpenCurrencyPicker={() => setCurrencyModalOpen(true)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountExpr}
                  onChange={(e) => setAmountExpr(normalizeArabicPersianNumerals(e.target.value))}
                  placeholder="0.00"
                  className="flex-1 px-3.5 py-2.5 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-lg font-bold text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] num-tabular min-h-[48px]"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setCurrencyModalOpen(true)}
                  className="px-3.5 py-2.5 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-accent)] font-bold rounded-xl text-xs hover:border-[var(--color-muted)] min-h-[48px] min-w-[56px]"
                >
                  {currency}
                </button>
              </div>
            )}
          </div>

          {/* 2. CATEGORY & WALLET (Shown right after amount) */}
          {type === 'transfer' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {t('fromWallet')}
                </label>
                <select
                  value={walletId}
                  onChange={(e) => handleWalletChange(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {t('toWallet')}
                </label>
                <select
                  value={toWalletId}
                  onChange={(e) => setToWalletId(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                >
                  {wallets
                    .filter((w) => w.id !== walletId)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.currency})
                      </option>
                    ))}
                </select>
              </div>

              {/* Optional Transfer / ATM Fee */}
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {isRTL ? `رسوم التحويل / السحب (${currency})` : `Transfer / ATM Fee (${currency})`}
                  <span className="text-[11px] font-normal text-[var(--color-muted)] ms-1">
                    {isRTL ? '(اختياري)' : '(optional)'}
                  </span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={transferFeeInput}
                  onChange={(e) => setTransferFeeInput(normalizeArabicPersianNumerals(e.target.value))}
                  placeholder="0.00"
                  dir="ltr"
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] num-tabular min-h-[44px]"
                />
              </div>

              {(destinationAmount > 0 || parsedTransferFee > 0) && (
                <div className="col-span-2 text-xs text-[var(--color-muted)] bg-[var(--color-bg)] p-2.5 rounded-xl border border-[var(--color-line)] space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span>{isRTL ? 'المخصوم من المحفظة المرسلة:' : 'Deducted from source wallet:'}</span>
                    <span className="font-bold text-[var(--color-expense)] num-tabular">
                      {roundCurrency(evaluatedAmount + parsedTransferFee, currency)} {currency}
                    </span>
                  </div>
                  {destinationAmount > 0 && (
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--color-line)]/60">
                      <span>{isRTL ? 'المبلغ الصافي للمحفظة المستلمة:' : 'Net received by destination:'}</span>
                      <span className="font-bold text-[var(--color-accent)] num-tabular">
                        {destinationAmount} {wallets.find((w) => w.id === toWalletId)?.currency}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Wallet Selector */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {isRTL ? 'المحفظة' : 'Wallet'}
                </label>
                <select
                  value={walletId}
                  onChange={(e) => handleWalletChange(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                >
                  {wallets.map((w) => {
                    const custodian =
                      w.walletType === 'petty_cash' && w.custodianMemberUid
                        ? orgMembers.find((m) => m.uid === w.custodianMemberUid)?.displayName
                        : undefined;
                    return (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.currency})
                        {custodian
                          ? ` — ${isRTL ? 'عُهدة' : 'Custody'}: ${custodian}`
                          : w.walletType === 'petty_cash'
                          ? ` — ${isRTL ? 'نثرية/عُهدة' : 'Petty Cash'}`
                          : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Visual Category Icon Pills Grid + Quick New Category */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[var(--color-ink)]">
                    {t('category')}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowNewCatForm((v) => !v)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[var(--color-accent)] hover:underline min-h-[32px] px-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'تصنيف جديد' : 'New Category'}</span>
                  </button>
                </div>

                {showNewCatForm && (
                  <div className="mb-2.5 p-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/40 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        placeholder={isRTL ? 'اسم التصنيف الجديد...' : 'New category name...'}
                        className="flex-1 px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[38px]"
                      />
                      <button
                        type="button"
                        onClick={handleCreateQuickCategory}
                        disabled={!newCatName.trim()}
                        className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold min-h-[38px] disabled:opacity-50"
                      >
                        {isRTL ? 'إضافة' : 'Add'}
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1">
                        {QUICK_CAT_ICONS.map((ic) => (
                          <button
                            key={ic}
                            type="button"
                            onClick={() => setNewCatIcon(ic)}
                            className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                              newCatIcon === ic
                                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                                : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)]'
                            }`}
                          >
                            <IconRenderer name={ic} className="w-3.5 h-3.5" />
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        {QUICK_CAT_COLORS.map((col) => (
                          <button
                            key={col}
                            type="button"
                            onClick={() => setNewCatColor(col)}
                            className={`w-5 h-5 rounded-full border-2 transition-transform ${
                              newCatColor === col ? 'border-[var(--color-ink)] scale-110' : 'border-transparent'
                            }`}
                            style={{ backgroundColor: col }}
                            aria-label={col}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto p-0.5">
                  {filteredCategories.map((c) => {
                    const isSelected = categoryId === c.id;
                    return (
                      <button
                        key={c.id}
                        id={`cat-pill-${c.id}`}
                        type="button"
                        onClick={() => {
                          manualCategoryOverrideRef.current = true;
                          setCategoryId(c.id);
                          setErrorMsg('');
                        }}
                        className={`px-2 py-2 rounded-xl border text-[11px] font-medium flex items-center gap-1.5 transition-colors min-h-[44px] min-w-0 text-start ${
                          isSelected
                            ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] font-semibold'
                            : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-ink)] hover:border-[var(--color-muted)]'
                        }`}
                      >
                        <span
                          className="shrink-0 flex items-center justify-center"
                          style={{ color: isSelected ? 'var(--color-on-accent)' : c.color }}
                        >
                          <IconRenderer name={c.icon || 'Layers'} className="w-4 h-4" />
                        </span>
                        <span className="truncate">{isRTL ? c.nameAr : c.nameEn}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Date, Time & Notes */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                {t('date')}
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full py-2 px-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                {t('time')}
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full py-2 px-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
              {t('notes')}
            </label>
            <input
              type="text"
              data-testid="tx-notes-input"
              value={notes}
              onChange={(e) => {
                const nextVal = e.target.value;
                setNotes(nextVal);
                applyMerchantRulesForText(nextVal);
              }}
              placeholder={isRTL ? 'وصف المعاملة أو اسم التاجر...' : 'Note or merchant name...'}
              className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
            />
            {matchedRuleKeyword && (
              <div
                data-testid="tx-merchant-rule-applied"
                className="mt-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--color-accent)]"
              >
                <span className="inline-flex items-center gap-1 truncate">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {isRTL
                      ? `تم تطبيق قاعدة التصنيف التلقائي «${matchedRuleKeyword}» (يمكنك التعديل يدوياً)`
                      : `Auto-categorized via rule "${matchedRuleKeyword}" (manual override allowed)`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setMatchedRuleKeyword(null)}
                  className="text-[var(--color-muted)] hover:text-[var(--color-ink)] shrink-0"
                >
                  {isRTL ? 'إخفاء' : 'Hide'}
                </button>
              </div>
            )}
          </div>

          {/* Enterprise Accounting Controls (Organization Workspace only) */}
          {isOrgWorkspace && type !== 'transfer' && (
            <div className="p-3 bg-[var(--color-bg)] border border-[var(--color-accent)]/30 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-ink)]">
                  <Building2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                  <span>{isRTL ? 'الضبط المحاسبي للمؤسسة' : 'Enterprise Accounting'}</span>
                </div>
                {isLockedDate && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--color-expense)]">
                    <Lock className="w-3 h-3" />
                    <span>{isRTL ? 'تاريخ مقفل' : 'Locked Date'}</span>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1">
                    {t('costCenters')}
                  </label>
                  <select
                    value={costCenterId}
                    onChange={(e) => setCostCenterId(e.target.value)}
                    className="w-full px-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[40px]"
                  >
                    <option value="">{isRTL ? 'بدون مركز' : 'None'}</option>
                    {orgCostCenters.map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {isRTL ? cc.nameAr : cc.nameEn}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1">
                    {isRTL ? 'المورد / العميل' : 'Vendor / Client'}
                  </label>
                  <select
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                    className="w-full px-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[40px]"
                  >
                    <option value="">{isRTL ? 'بدون طرف' : 'None'}</option>
                    {orgParties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.type === 'vendor' ? (isRTL ? 'مورد' : 'Vendor') : p.type === 'client' ? (isRTL ? 'عميل' : 'Client') : isRTL ? 'مورد/عميل' : 'Both'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1">
                    {t('invoiceNumber')}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="INV-2026-001"
                    className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[40px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1">
                    {t('voucherNumber')}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={voucherNumber}
                    onChange={(e) => setVoucherNumber(e.target.value)}
                    placeholder={isRTL ? 'تلقائي (PV/RV)' : 'Auto (PV/RV)'}
                    className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[40px]"
                  />
                </div>
              </div>

              <label className="w-full px-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg flex items-center justify-between text-xs cursor-pointer min-h-[40px]">
                <span className="text-[11px] font-medium text-[var(--color-ink)]">
                  {isRTL ? 'عُهدة / استرداد مصروف موظف (تتطلب اعتماد)' : 'Employee Reimbursement / Custody Claim'}
                </span>
                <input
                  type="checkbox"
                  checked={isReimbursement}
                  onChange={(e) => setIsReimbursement(e.target.checked)}
                  className="w-4 h-4 accent-[var(--color-accent)]"
                />
              </label>

              {/* VAT Breakdown Section */}
              <div className="p-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)] cursor-pointer">
                    <Percent className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                    <span>{isRTL ? 'تطبيق ضريبة القيمة المضافة' : 'Apply VAT'}</span>
                  </label>
                  <input
                    type="checkbox"
                    checked={enableVat}
                    onChange={(e) => setEnableVat(e.target.checked)}
                    className="w-4 h-4 accent-[var(--color-accent)]"
                  />
                </div>

                {enableVat && (
                  <div className="space-y-2 pt-1.5 border-t border-[var(--color-line)]">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={vatRateInput}
                        onChange={(e) => setVatRateInput(normalizeArabicPersianNumerals(e.target.value))}
                        className="w-20 px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs font-bold text-center min-h-[34px]"
                      />
                      <span className="text-xs text-[var(--color-muted)]">%</span>
                      <div className="flex-1 grid grid-cols-2 gap-1 bg-[var(--color-bg)] p-0.5 rounded-lg border border-[var(--color-line)]">
                        <button
                          type="button"
                          onClick={() => setIsTaxInclusive(true)}
                          className={`py-1 rounded text-[10px] font-semibold ${
                            isTaxInclusive
                              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                              : 'text-[var(--color-muted)]'
                          }`}
                        >
                          {t('vatInclusive')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsTaxInclusive(false)}
                          className={`py-1 rounded text-[10px] font-semibold ${
                            !isTaxInclusive
                              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                              : 'text-[var(--color-muted)]'
                          }`}
                        >
                          {t('vatExclusive')}
                        </button>
                      </div>
                    </div>

                    {vatPreview && (
                      <div className="grid grid-cols-3 gap-1.5 text-center text-[10px] bg-[var(--color-bg)] p-2 rounded-lg">
                        <div>
                          <div className="text-[var(--color-muted)]">{isRTL ? 'الصافي' : 'Net'}</div>
                          <div className="font-bold text-[var(--color-ink)] num-tabular">{vatPreview.netAmount}</div>
                        </div>
                        <div>
                          <div className="text-[var(--color-muted)]">{isRTL ? 'الضريبة' : 'VAT'}</div>
                          <div className="font-bold text-[var(--color-accent)] num-tabular">{vatPreview.taxAmount}</div>
                        </div>
                        <div>
                          <div className="text-[var(--color-muted)]">{isRTL ? 'الإجمالي' : 'Gross'}</div>
                          <div className="font-bold text-[var(--color-ink)] num-tabular">{vatPreview.grossAmount}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {orgCompliancePreview?.exceedsSpendingLimit && (
                  <div className="p-2 rounded-lg bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/30 text-[11px] text-[var(--color-expense)] font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {isRTL
                        ? `يتجاوز سقف الصرف الخاص بك (${orgCompliancePreview.limit} ${activeOrganization?.currency})`
                        : `Exceeds your spending limit (${orgCompliancePreview.limit} ${activeOrganization?.currency})`}
                    </span>
                  </div>
                )}

                {orgCompliancePreview &&
                  !orgCompliancePreview.exceedsSpendingLimit &&
                  orgCompliancePreview.willRequireApproval && (
                    <div className="p-2 rounded-lg bg-[var(--color-warning)]/12 border border-[var(--color-warning)]/30 text-[11px] text-[var(--color-warning-text)] font-medium">
                      {isRTL
                        ? 'سيتم إرسال هذه المعاملة إلى قائمة الاعتمادات للمراجعة قبل الخصم من الخزينة.'
                        : 'This transaction will be queued for approval before affecting treasury balances.'}
                    </div>
                  )}
              </div>
            </div>
          )}

          {/* 3. "More options" accordion */}
          <div className="border border-[var(--color-line)] rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowMoreDetails(!showMoreDetails)}
              className="w-full py-2.5 px-3.5 bg-[var(--color-bg)] flex items-center justify-between text-xs text-[var(--color-ink)] font-semibold transition-colors min-h-[44px]"
            >
              <span className="flex items-center gap-1.5">
                <span>{isRTL ? 'خيارات إضافية' : 'More Options'}</span>
                <span className="text-[10px] text-[var(--color-muted)] font-normal">
                  ({attachments.length + attachmentPaths.length > 0
                    ? isRTL
                      ? `${attachments.length + attachmentPaths.length} مرفق • `
                      : `${attachments.length + attachmentPaths.length} photo(s) • `
                    : ''}
                  {isRTL ? 'مرفقات، تقسيم، تكرار، وسم...' : 'attachments, split, repeat...'})
                </span>
              </span>
              {showMoreDetails ? <ChevronUp className="w-4 h-4 text-[var(--color-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" />}
            </button>

            {showMoreDetails && (
              <div className="p-3.5 space-y-3.5 bg-[var(--color-surface)] border-t border-[var(--color-line)]">
                {/* Priority */}
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {t('filterPriority')}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setPriority('essential')}
                      className={`py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[38px] ${
                        priority === 'essential'
                          ? 'bg-[var(--color-expense)] text-white'
                          : 'bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]'
                      }`}
                    >
                      {t('priorityEssential')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPriority('normal')}
                      className={`py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[38px] ${
                        priority === 'normal'
                          ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                          : 'bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]'
                      }`}
                    >
                      {t('priorityNormal')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPriority('leisure')}
                      className={`py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[38px] ${
                        priority === 'leisure'
                          ? 'bg-[var(--color-warning)] text-[#1C1A17]'
                          : 'bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)]'
                      }`}
                    >
                      {t('priorityLeisure')}
                    </button>
                  </div>
                </div>

                {/* Group / Tag */}
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {t('group')}
                  </label>
                  <div className="relative">
                    <Tag className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-muted)]" />
                    <input
                      type="text"
                      value={group}
                      onChange={(e) => setGroup(e.target.value)}
                      placeholder={t('groupPlaceholder')}
                      className="w-full py-2 ps-8 pe-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                      list="groups-list"
                    />
                    <datalist id="groups-list">
                      {pastGroups.map((g) => (
                        <option key={g} value={g} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {/* Contact */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-[var(--color-ink)]">{t('contact')}</label>
                    <button
                      type="button"
                      onClick={handlePickContact}
                      className="text-[11px] text-[var(--color-accent)] hover:underline"
                    >
                      {t('pickContact')}
                    </button>
                  </div>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-muted)]" />
                    <input
                      id="contact-input"
                      type="text"
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      placeholder={t('contactPlaceholder')}
                      className="w-full py-2 ps-8 pe-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                      list="contacts-list"
                    />
                    <datalist id="contacts-list">
                      {pastContacts.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {/* Attachments (Thumbnails + Delete + Click-to-Zoom Lightbox) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[var(--color-ink)]">
                      {t('attachments')}
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        if (!isPro && attachments.length >= maxFreeAttachments) {
                          setIsUpgradeModalOpen(true);
                          return;
                        }
                        fileInputRef.current?.click();
                      }}
                      className="flex items-center gap-1 text-[11px] font-semibold text-[var(--color-accent)] hover:underline min-h-[32px] px-1"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>{t('addPhoto')}</span>
                      {!isPro && attachments.length >= maxFreeAttachments && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--color-accent)]/12 text-[var(--color-accent)] text-[9px] font-bold">
                          <Crown className="w-2.5 h-2.5" />
                          <bdi dir="ltr">PRO</bdi>
                        </span>
                      )}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple={isPro}
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </div>

                  {(attachments.length > 0 || attachmentPaths.length > 0) && (
                    <div className="flex items-center gap-2 overflow-x-auto py-1">
                      {attachmentPaths.map((storagePath, idx) => {
                        const resolved = resolvedPathUrls[storagePath];
                        const isPendingOffline = storagePath.startsWith('pending://');
                        return (
                          <div
                            key={`path-${idx}`}
                            className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-[var(--color-line)] bg-[var(--color-bg)] flex items-center justify-center"
                          >
                            {resolved ? (
                              <button
                                type="button"
                                onClick={() => setLightboxImage(resolved)}
                                className="w-full h-full block relative group cursor-zoom-in"
                                aria-label={isRTL ? 'تكبير الصورة المرفقة' : 'Zoom attachment'}
                              >
                                <img
                                  src={resolved}
                                  alt={`cloud-attachment-${idx + 1}`}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover"
                                />
                                <span className="absolute bottom-1 start-1 p-0.5 rounded bg-black/60 text-white opacity-80">
                                  <ZoomIn className="w-2.5 h-2.5" />
                                </span>
                              </button>
                            ) : (
                              <span className="text-[9px] text-[var(--color-muted)] text-center px-1">
                                {isPendingOffline
                                  ? isRTL
                                    ? 'بانتظار الرفع'
                                    : 'Pending'
                                  : isRTL
                                  ? 'مرفق سحابي'
                                  : 'Cloud'}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAttachmentPaths((prev) => prev.filter((_, i) => i !== idx));
                              }}
                              aria-label={isRTL ? 'حذف المرفق' : 'Delete attachment'}
                              className="absolute top-1 end-1 w-5 h-5 bg-black/75 text-white rounded-full flex items-center justify-center hover:bg-[var(--color-expense)] transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                      {attachments.map((imgSrc, idx) => (
                        <div
                          key={`local-${idx}`}
                          className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-[var(--color-line)] bg-[var(--color-bg)]"
                        >
                          <button
                            type="button"
                            onClick={() => setLightboxImage(imgSrc)}
                            className="w-full h-full block relative group cursor-zoom-in"
                            aria-label={isRTL ? 'تكبير الصورة المرفقة' : 'Zoom attachment'}
                          >
                            <img
                              src={imgSrc}
                              alt={`attachment-${idx + 1}`}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute bottom-1 start-1 p-0.5 rounded bg-black/60 text-white opacity-80">
                              <ZoomIn className="w-2.5 h-2.5" />
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAttachments((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            aria-label={isRTL ? 'حذف المرفق' : 'Delete attachment'}
                            className="absolute top-1 end-1 w-5 h-5 bg-black/75 text-white rounded-full flex items-center justify-center hover:bg-[var(--color-expense)] transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Split Bill / Record Friend's Share as Debt Owed to Me (Expenses only) */}
                {type === 'expense' && (
                  <div className="p-3 bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)] space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Users className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                        <span className="text-xs font-semibold text-[var(--color-ink)]">
                          {isRTL
                            ? 'تقسيم الفاتورة مع شخص (تسجيل كدين لي)'
                            : 'Split bill with someone (record as debt owed to me)'}
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={enableSplitBill}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setEnableSplitBill(checked);
                          if (checked && !splitFriendName && contact.trim()) {
                            setSplitFriendName(contact.trim());
                          }
                        }}
                        className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer min-h-[20px] min-w-[20px]"
                      />
                    </div>

                    {enableSplitBill && (
                      <div className="space-y-2.5 pt-2 border-t border-[var(--color-line)]">
                        <div>
                          <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                            {isRTL ? 'اسم الصديق / المشارك' : 'Friend Name'}
                          </label>
                          <input
                            type="text"
                            value={splitFriendName}
                            onChange={(e) => setSplitFriendName(e.target.value)}
                            placeholder={isRTL ? 'مثال: أحمد، سارة...' : 'e.g. Alex, Omar...'}
                            list="contacts-list"
                            className="w-full px-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[40px]"
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-1">
                          {[
                            { id: 'half', label: isRTL ? 'النصف (50%)' : 'Half (50%)' },
                            { id: 'amount', label: isRTL ? 'مبلغ محدد' : 'Fixed Amount' },
                            { id: 'percent', label: isRTL ? 'نسبة %' : 'Percent %' },
                          ].map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setSplitMode(opt.id as 'half' | 'amount' | 'percent')}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-colors min-h-[36px] ${
                                splitMode === opt.id
                                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                                  : 'bg-[var(--color-surface)] border-[var(--color-line)] text-[var(--color-muted)]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>

                        {splitMode !== 'half' && (
                          <div>
                            <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                              {splitMode === 'percent'
                                ? isRTL
                                  ? 'نسبة حصة الصديق (%)'
                                  : 'Friend share (%)'
                                : isRTL
                                ? `قيمة حصة الصديق (${currency})`
                                : `Friend share (${currency})`}
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={splitValueInput}
                              onChange={(e) => setSplitValueInput(normalizeArabicPersianNumerals(e.target.value))}
                              placeholder={splitMode === 'percent' ? '30' : '100'}
                              className="w-full px-2.5 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] num-tabular min-h-[40px]"
                              dir="ltr"
                            />
                          </div>
                        )}

                        <div className="p-2 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-[11px] flex items-center justify-between gap-2">
                          <span className="text-[var(--color-ink)]">
                            {isRTL ? 'سيُسجَّل دين «مستحقات لي»:' : 'Debt "Owed to Me":'}
                          </span>
                          <span className="font-bold text-[var(--color-accent)] num-tabular">
                            {computedSplitDebtAmount} {currency}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Repeat Transaction */}
                <div className="p-3 bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)] space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Repeat className="w-4 h-4 text-[var(--color-accent)]" />
                      <span className="text-xs font-semibold text-[var(--color-ink)]">
                        {t('repeatTransaction')}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={isRecurring}
                      onChange={(e) => setIsRecurring(e.target.checked)}
                      className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer min-h-[20px] min-w-[20px]"
                    />
                  </div>

                  {isRecurring && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--color-line)]">
                      <div>
                        <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                          {t('frequency')}
                        </label>
                        <select
                          value={frequency}
                          onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                          className="w-full px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)]"
                        >
                          <option value="daily">{t('daily')}</option>
                          <option value="weekly">{t('weekly')}</option>
                          <option value="monthly">{t('monthly')}</option>
                          <option value="yearly">{t('yearly')}</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] text-[var(--color-muted)] mb-1">
                          {isRTL ? 'كل كم فترة؟' : 'Every X intervals'}
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={interval}
                          onChange={(e) => {
                            const norm = normalizeArabicPersianNumerals(e.target.value).replace(/\D/g, '');
                            setInterval(Math.max(1, parseInt(norm, 10) || 1));
                          }}
                          className="w-full px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] num-tabular"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Does not affect balance toggle */}
                <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)]">
                  <span className="text-xs text-[var(--color-ink)]">{t('doesNotAffectBalance')}</span>
                  <input
                    type="checkbox"
                    checked={doesNotAffectBalance}
                    onChange={(e) => setDoesNotAffectBalance(e.target.checked)}
                    className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer min-h-[20px] min-w-[20px]"
                  />
                </div>

                {/* Save as Template Toggle (only for new transactions) */}
                {!editTransaction && (
                  <div className="p-3 bg-[var(--color-bg)] rounded-xl border border-[var(--color-line)] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Bookmark className="w-4 h-4 text-[var(--color-warning-text)]" />
                        <span className="text-xs text-[var(--color-ink)]">{t('saveAsTemplate')}</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={saveAsTmpl}
                        onChange={(e) => setSaveAsTmpl(e.target.checked)}
                        className="w-4 h-4 accent-[var(--color-warning)] rounded cursor-pointer min-h-[20px] min-w-[20px]"
                      />
                    </div>

                    {saveAsTmpl && (
                      <input
                        type="text"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        placeholder={isRTL ? 'اسم القالب (مثال: قهوة العمل)' : 'Template name...'}
                        className="w-full px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Action Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isLockedDate || (isOrgWorkspace && (isOrgReadOnly || !canOrgWrite))}
              className="w-full py-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium text-sm hover:opacity-95 transition-opacity shadow-sm min-h-[44px] disabled:opacity-50"
            >
              {isOrgWorkspace && isOrgReadOnly
                ? isRTL
                  ? 'وضع القراءة فقط'
                  : 'Read-Only Mode'
                : isLockedDate
                ? isRTL
                  ? 'الفترة المحاسبية مقفلة'
                  : 'Period Locked'
                : editTransaction
                ? isRTL
                  ? 'حفظ التعديلات'
                  : 'Save Changes'
                : isRTL
                ? 'إضافة المعاملة'
                : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>

      {/* Currency Picker Modal */}
      <CurrencyPickerModal
        isOpen={currencyModalOpen}
        onClose={() => setCurrencyModalOpen(false)}
        selectedCode={currency}
        onSelect={(code) => setCurrency(code)}
      />

      {/* Lightbox Zoom Modal for Attachments */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            aria-label={t('close')}
            className="absolute top-4 end-4 w-11 h-11 rounded-full bg-white/15 text-white hover:bg-white/25 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxImage}
            alt="attachment preview"
            loading="lazy"
            decoding="async"
            className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

    </div>
  );
};
