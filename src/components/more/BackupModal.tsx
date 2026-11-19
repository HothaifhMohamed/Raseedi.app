import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Save,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  X,
  Share2,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Cloud,
  RefreshCw,
  LogOut,
  Crown,
  RotateCcw,
  History,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  mergeSettingsWithDefaults,
  persistData,
  validateBackupSchema,
} from '../../services/db';
import {
  encryptBackupJson,
  decryptBackupJson,
  isEncryptedBackupPayload,
} from '../../services/security';
import {
  parseImportFileBuffer,
  autoDetectCsvMapping,
  mapCsvRowsToTransactions,
  commitImportedTransactionsWithCloudSync,
  CsvColumnMapping,
} from '../../services/csvImport';
import { formatLocalDate } from '../../services/calculations';
import {
  tagTransactionsWithWorkspace,
  tagWalletsWithWorkspace,
} from '../../services/workspaceSync';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({ isOpen, onClose }) => {
  const {
    transactions,
    wallets,
    categories,
    budgets,
    debts,
    goals,
    templates,
    moneyCircles,
    queueLegacyOrgsForMigration,
    activeWorkspace,
    settings,
    user,
    isPro,
    isCloudSyncing,
    cloudSyncStatus,
    cloudSyncError,
    cloudSkippedAttachmentsWarning,
    lastCloudBackupExists,
    cloudBackupHistory,
    refreshCloudBackupHistory,
    restoreFromBackupHistoryEntry,
    preRestoreSnapshotDate,
    createPreRestoreSnapshot,
    revertPreRestoreSnapshot,
    signInWithGoogleAccount,
    setIsLogoutModalOpen,
    syncToCloudNow,
    restoreFromCloudNow,
    updateSettings,
    importSpreadsheetBatchLocally,
    syncWorkspaceBackupNow,
    t,
    isRTL,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'json' | 'csv'>('json');
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
    localOnly?: boolean;
    retryWorkspaceId?: string;
  } | null>(null);

  // JSON encryption / decryption state
  const [useEncryption, setUseEncryption] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [showBackupPassword, setShowBackupPassword] = useState(false);
  const [pendingEncryptedPayload, setPendingEncryptedPayload] = useState<string | null>(null);
  const [decryptPassword, setDecryptPassword] = useState('');
  const [isProcessingJson, setIsProcessingJson] = useState(false);

  // Excel / CSV Import Wizard state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvRecords, setCsvRecords] = useState<Record<string, string>[]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [importSheetNames, setImportSheetNames] = useState<string[]>([]);
  const [importActiveSheet, setImportActiveSheet] = useState<string>('');
  const [previewMode, setPreviewMode] = useState<'mapped' | 'raw'>('mapped');
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping>({
    dateIndex: -1,
    amountIndex: -1,
    typeIndex: -1,
    categoryIndex: -1,
    notesIndex: -1,
    walletIndex: -1,
    toWalletIndex: -1,
  });
  const [targetWalletId, setTargetWalletId] = useState(wallets[0]?.id || '');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const [restoringHistoryId, setRestoringHistoryId] = useState<string | null>(null);
  const importFileBytesRef = useRef<{ bytes: Uint8Array; fileName: string; mimeType: string } | null>(
    null
  );

  useEffect(() => {
    if (!isOpen || activeTab !== 'json' || !user?.isLoggedIn) return;
    let active = true;
    setIsRefreshingHistory(true);
    void refreshCloudBackupHistory().finally(() => {
      if (active) setIsRefreshingHistory(false);
    });
    return () => {
      active = false;
    };
  }, [isOpen, activeTab, user?.isLoggedIn, refreshCloudBackupHistory]);

  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  const buildBackupJsonString = async (): Promise<{ content: string; isEncrypted: boolean }> => {
    const data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      transactions,
      wallets,
      categories,
      budgets,
      debts,
      goals,
      templates,
      moneyCircles,
      settings,
      hasCompletedOnboarding: true,
    };

    const plainJson = JSON.stringify(data, null, 2);
    if (useEncryption && backupPassword.trim()) {
      const encrypted = await encryptBackupJson(plainJson, backupPassword.trim());
      return { content: encrypted, isEncrypted: true };
    }
    return { content: plainJson, isEncrypted: false };
  };

  // Export full JSON (optionally AES-GCM encrypted)
  const handleExportJSON = async () => {
    if (useEncryption && !backupPassword.trim()) {
      setMessage({
        text: isRTL ? 'أدخل كلمة مرور لتشفير النسخة الاحتياطية.' : 'Enter a password to encrypt your backup.',
        error: true,
      });
      return;
    }

    setIsProcessingJson(true);
    try {
      const { content, isEncrypted } = await buildBackupJsonString();
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStamp = formatLocalDate(new Date());
      link.download = isEncrypted
        ? `raseedi-backup-encrypted-${dateStamp}.json`
        : `raseedi-backup-${dateStamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      updateSettings({ lastBackupAt: Date.now() });
      setMessage({
        text: isEncrypted
          ? isRTL
            ? 'تم تصدير النسخة المشفرة (AES-GCM) بنجاح!'
            : 'Encrypted AES-GCM backup exported!'
          : isRTL
          ? 'تم تصدير النسخة الاحتياطية JSON بنجاح!'
          : 'Backup JSON exported successfully!',
      });
    } catch {
      setMessage({
        text: isRTL ? 'حدث خطأ أثناء تصدير النسخة الاحتياطية.' : 'Error exporting backup.',
        error: true,
      });
    } finally {
      setIsProcessingJson(false);
    }
  };

  // Share JSON backup via Web Share API
  const handleShareJSON = async () => {
    if (useEncryption && !backupPassword.trim()) {
      setMessage({
        text: isRTL ? 'أدخل كلمة مرور لتشفير النسخة قبل المشاركة.' : 'Enter a password before sharing encrypted backup.',
        error: true,
      });
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.share) {
      setMessage({
        text: isRTL
          ? 'المشاركة المباشرة غير مدعومة في هذا المتصفح — استخدم زر التصدير بدلاً منها.'
          : 'Web Share is not supported in this browser — use Export instead.',
        error: true,
      });
      return;
    }

    setIsProcessingJson(true);
    try {
      const { content, isEncrypted } = await buildBackupJsonString();
      const dateStamp = formatLocalDate(new Date());
      const fileName = isEncrypted
        ? `raseedi-backup-encrypted-${dateStamp}.json`
        : `raseedi-backup-${dateStamp}.json`;
      const file = new File([content], fileName, { type: 'application/json' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: isRTL ? 'نسخة رَصِيدِي الاحتياطية' : 'Raseedi Backup',
          files: [file],
        });
      } else {
        await navigator.share({
          title: isRTL ? 'نسخة رَصِيدِي الاحتياطية' : 'Raseedi Backup',
          text: content,
        });
      }

      updateSettings({ lastBackupAt: Date.now() });
      setMessage({
        text: isRTL ? 'تمت مشاركة النسخة الاحتياطية بنجاح!' : 'Backup shared successfully!',
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessage({
          text: isRTL ? 'تعذرت مشاركة الملف، يمكنك استخدام زر التصدير.' : 'Share failed, please use Export.',
          error: true,
        });
      }
    } finally {
      setIsProcessingJson(false);
    }
  };

  const restoreFromPlainJsonText = async (plainText: string) => {
    const parsed = JSON.parse(plainText);
    const validation = validateBackupSchema(parsed);
    if (!validation.valid) {
      throw new Error(
        validation.reason || (isRTL ? 'الملف غير مطابق لصيغة رَصِيدِي' : 'Invalid Raseedi backup file')
      );
    }

    await createPreRestoreSnapshot();

    await persistData({
      transactions: tagTransactionsWithWorkspace(parsed.transactions || [], 'personal'),
      wallets: tagWalletsWithWorkspace(parsed.wallets || [], 'personal'),
      categories: parsed.categories || categories,
      budgets: parsed.budgets || [],
      debts: parsed.debts || [],
      goals: parsed.goals || [],
      templates: parsed.templates || [],
      moneyCircles: parsed.moneyCircles || [],
      settings: mergeSettingsWithDefaults(parsed.settings || settings),
      user: user || null,
      hasCompletedOnboarding: true,
    });

    let hasQueuedLegacyOrgs = false;
    if (
      parsed.orgWorkspaces &&
      typeof parsed.orgWorkspaces === 'object' &&
      !Array.isArray(parsed.orgWorkspaces) &&
      Object.keys(parsed.orgWorkspaces).length > 0
    ) {
      queueLegacyOrgsForMigration(parsed.orgWorkspaces);
      hasQueuedLegacyOrgs = true;
    }

    setPendingEncryptedPayload(null);
    setDecryptPassword('');
    setMessage({
      text: hasQueuedLegacyOrgs
        ? isRTL
          ? 'تمت استعادة البيانات الشخصية وتجهيز المؤسسات للترحيل السحابي! سيتم تحديث الصفحة...'
          : 'Personal data restored & legacy organizations queued for Cloud migration! Refreshing...'
        : isRTL
        ? 'تمت استعادة البيانات الشخصية بنجاح! سيتم تحديث الصفحة...'
        : 'Personal data restored successfully! Refreshing...',
    });
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024; // 25MB safety cap

  // Import full JSON (detects encrypted payload automatically)
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setMessage({
        text: isRTL
          ? 'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت). يرجى اختيار ملف أصغر.'
          : 'File size exceeds the 25MB maximum limit. Please select a smaller file.',
        error: true,
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        if (isEncryptedBackupPayload(text)) {
          setPendingEncryptedPayload(text);
          setDecryptPassword('');
          setMessage({
            text: isRTL
              ? 'هذا الملف مشفر بكلمة مرور. أدخل كلمة المرور أدناه لفك التشفير.'
              : 'This backup is password-encrypted. Enter your password below to unlock.',
          });
          return;
        }
        await restoreFromPlainJsonText(text);
      } catch (err: any) {
        setMessage({
          text: `${isRTL ? 'فشل استيراد الملف:' : 'Import failed:'} ${err.message || 'invalid file'}`,
          error: true,
        });
      }
    };
    reader.readAsText(file);
  };

  const handleDecryptAndRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingEncryptedPayload || !decryptPassword.trim()) return;

    setIsProcessingJson(true);
    try {
      const decrypted = await decryptBackupJson(pendingEncryptedPayload, decryptPassword.trim());
      await restoreFromPlainJsonText(decrypted);
    } catch {
      setMessage({
        text: isRTL ? 'كلمة المرور غير صحيحة أو الملف تالف.' : 'Incorrect password or corrupted file.',
        error: true,
      });
    } finally {
      setIsProcessingJson(false);
    }
  };

  const resetImportPreviewState = () => {
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvRecords([]);
    setCsvFileName('');
    setImportSheetNames([]);
    setImportActiveSheet('');
    importFileBytesRef.current = null;
  };

  // Excel (.xlsx / .xls) & CSV Import Handlers
  const applyParsedImportData = (
    bytes: Uint8Array,
    fileName: string,
    mimeType: string,
    sheetName?: string
  ) => {
    const result = parseImportFileBuffer({
      bytes,
      fileName,
      mimeType,
      sheetName,
    });

    if (!result.ok) {
      resetImportPreviewState();
      setMessage({
        text: isRTL ? result.errorAr : result.errorEn,
        error: true,
      });
      return;
    }

    importFileBytesRef.current = { bytes, fileName, mimeType };
    setCsvFileName(fileName);
    setCsvHeaders(result.data.headers);
    setCsvRows(result.data.rows);
    setCsvRecords(result.data.records);
    setImportSheetNames(result.data.sheetNames || []);
    setImportActiveSheet(result.data.activeSheet || '');
    setCsvMapping({ ...autoDetectCsvMapping(result.data.headers), typeIndex: -1 });
    if (!targetWalletId && wallets[0]) {
      setTargetWalletId(wallets[0].id);
    }
    setMessage(null);
  };

  const handleCsvFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      resetImportPreviewState();
      setMessage({
        text: isRTL
          ? 'حجم ملف Excel/CSV يتجاوز الحد الأقصى المسموح به (25 ميجابايت). يرجى تقسيم الملف والمحاولة مجدداً.'
          : 'Excel/CSV file size exceeds the 25MB maximum limit. Please split the file and try again.',
        error: true,
      });
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      applyParsedImportData(bytes, file.name, file.type);
    } catch {
      resetImportPreviewState();
      setMessage({
        text: isRTL
          ? 'تعذرت قراءة الملف المختار. تأكد من أن الملف بصيغة Excel أو CSV صالحة.'
          : 'Failed to read the selected file. Ensure it is a valid Excel or CSV file.',
        error: true,
      });
    }
  };

  const handleImportSheetChange = (nextSheet: string) => {
    const cached = importFileBytesRef.current;
    if (!cached) return;
    applyParsedImportData(cached.bytes, cached.fileName, cached.mimeType, nextSheet);
  };

  const importDefaultCurrency = settings.mainCurrency || wallets[0]?.currency || 'EGP';

  const csvPreviewResult = useMemo(() => {
    if (csvRows.length === 0) {
      return {
        previewRows: [],
        validCount: 0,
        invalidCount: 0,
        duplicateCount: 0,
        autoCreatedWallets: [],
        autoCreatedCategories: [],
      };
    }
    return mapCsvRowsToTransactions({
      rows: csvRows,
      mapping: { ...csvMapping, typeIndex: -1 },
      categories,
      existingTransactions: transactions,
      wallets,
      defaultCurrency: importDefaultCurrency,
      workspaceId: activeWorkspace,
    });
  }, [csvRows, csvMapping, categories, transactions, wallets, importDefaultCurrency, activeWorkspace]);

  const rowsReadyToImport = useMemo(() => {
    return csvPreviewResult.previewRows.filter(
      (r) => r.isValid && (!skipDuplicates || !r.isDuplicate)
    );
  }, [csvPreviewResult.previewRows, skipDuplicates]);

  const readyWalletsToCreate = useMemo(() => {
    const neededIds = new Set<string>();
    for (const r of rowsReadyToImport) {
      if (r.isNewWallet && r.walletId) neededIds.add(r.walletId);
      if (r.isNewToWallet && r.toWalletId) neededIds.add(r.toWalletId);
    }
    return csvPreviewResult.autoCreatedWallets.filter((w) => neededIds.has(w.id));
  }, [rowsReadyToImport, csvPreviewResult.autoCreatedWallets]);

  const readyCategoriesToCreate = useMemo(() => {
    const neededIds = new Set<string>();
    for (const r of rowsReadyToImport) {
      if (r.isNewCategory && r.categoryId) neededIds.add(r.categoryId);
    }
    return csvPreviewResult.autoCreatedCategories.filter((c) => neededIds.has(c.id));
  }, [rowsReadyToImport, csvPreviewResult.autoCreatedCategories]);

  const handleConfirmCsvImport = async () => {
    if (rowsReadyToImport.length === 0 || isImportingCsv) return;

    const skippedInvalid = csvPreviewResult.invalidCount;
    const skippedDup = skipDuplicates ? csvPreviewResult.duplicateCount : 0;
    const createdWalletsCount = readyWalletsToCreate.length;
    const createdCatsCount = readyCategoriesToCreate.length;

    setIsImportingCsv(true);
    setMessage(null);
    try {
      const result = await commitImportedTransactionsWithCloudSync({
        rows: rowsReadyToImport,
        existingWallets: wallets,
        newWallets: readyWalletsToCreate,
        newCategories: readyCategoriesToCreate,
        fallbackWalletId: targetWalletId,
        defaultCurrency: importDefaultCurrency,
        workspaceId: activeWorkspace,
        persistImportLocally: async ({ transactions: txs, newWallets, newCategories }) => {
          const localRes = await importSpreadsheetBatchLocally(txs, {
            newWallets,
            newCategories,
          });
          return {
            importedCount: localRes.importedCount,
            createdTransactions: localRes.createdTransactions,
          };
        },
        syncToCloud: user?.isLoggedIn
          ? async ({ workspaceId: wsId, createdTransactions }) =>
              syncWorkspaceBackupNow(wsId, createdTransactions)
          : undefined,
      });

      if (result.importedCount <= 0) {
        setMessage({
          text: isRTL
            ? 'لم يتم استيراد أي معاملات جديدة (تحقق من الصلاحيات أو الفترة المحاسبية).'
            : 'No transactions were imported (check permissions or locked accounting period).',
          error: true,
        });
        return;
      }

      const extraPartsAr: string[] = [];
      const extraPartsEn: string[] = [];
      if (createdWalletsCount > 0) {
        extraPartsAr.push(`إنشاء ${createdWalletsCount} محفظة تلقائياً`);
        extraPartsEn.push(`${createdWalletsCount} wallet(s) created`);
      }
      if (createdCatsCount > 0) {
        extraPartsAr.push(`إنشاء ${createdCatsCount} تصنيف تلقائياً`);
        extraPartsEn.push(`${createdCatsCount} category(ies) created`);
      }
      if (skippedInvalid > 0 || skippedDup > 0) {
        extraPartsAr.push(`تخطي ${skippedInvalid} غير صالح و ${skippedDup} مكرر`);
        extraPartsEn.push(`skipped ${skippedInvalid} invalid, ${skippedDup} duplicate`);
      }
      const extrasAr = extraPartsAr.length > 0 ? ` (${extraPartsAr.join(' • ')})` : '';
      const extrasEn = extraPartsEn.length > 0 ? ` (${extraPartsEn.join(' • ')})` : '';

      // Clear preview table once persisted locally so duplicate clicks can't re-insert the same file
      resetImportPreviewState();

      if (result.cloudSynced) {
        setMessage({
          text: isRTL
            ? `تم استيراد ورفع ${result.importedCount} معاملة إلى السحابة بنجاح!${extrasAr}`
            : `Successfully imported and synced ${result.importedCount} transactions to Cloud!${extrasEn}`,
        });
        return;
      }

      if (user?.isLoggedIn) {
        setMessage({
          text: isRTL
            ? `تم حفظ ${result.importedCount} معاملة محلياً على هذا الجهاز فقط، لكن تعذر الرفع إلى السحابة (${
                result.error || 'خطأ في الاتصال'
              }).${extrasAr}`
            : `Saved ${result.importedCount} transactions locally ONLY, but Cloud upload failed (${
                result.error || 'connection error'
              }).${extrasEn}`,
          error: true,
          localOnly: true,
          retryWorkspaceId: result.workspaceId,
        });
        return;
      }

      // Guest mode: strictly report local-only save (never falsely claim Cloud backup)
      setMessage({
        text: isRTL
          ? `تم حفظ ${result.importedCount} معاملة محلياً على المتصفح فقط (غير مرفوعة للسحابة لعدم تسجيل الدخول).${extrasAr}`
          : `Saved ${result.importedCount} transactions locally only (not backed up to Cloud — sign in with Google to sync).${extrasEn}`,
        localOnly: true,
      });
    } catch (err) {
      const errDetail = err instanceof Error ? err.message : '';
      setMessage({
        text: isRTL
          ? `تعذر إتمام استيراد المعاملات${errDetail ? `: ${errDetail}` : '. يرجى المحاولة مرة أخرى.'}`
          : `Failed to complete spreadsheet import${errDetail ? `: ${errDetail}` : '. Please try again.'}`,
        error: true,
      });
    } finally {
      setIsImportingCsv(false);
    }
  };

  const handleRetryImportCloudSync = async () => {
    if (!message?.retryWorkspaceId || isCloudSyncing) return;
    const res = await syncWorkspaceBackupNow(message.retryWorkspaceId);
    if (res.ok) {
      setMessage({
        text: isRTL
          ? 'تم رفع جميع المعاملات المستوردة إلى السحابة وتأكيد الحفظ بنجاح!'
          : 'All imported transactions have now been synced to Cloud successfully!',
      });
    } else {
      setMessage((prev) =>
        prev
          ? {
              ...prev,
              text: isRTL
                ? `ما زال الرفع السحابي متعذراً (${res.error || 'تحقق من الإنترنت'}). المعاملات محفوظة محلياً ولن تُحذف.`
                : `Cloud upload still failed (${res.error || 'check internet'}). Local transactions remain safe.`,
            }
          : null
      );
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl space-y-4 overflow-hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] shrink-0">
          <div className="flex items-center gap-2">
            <Save className="w-5 h-5 text-[var(--color-accent)]" />
            <h3 className="text-sm font-bold text-[var(--color-ink)]">{t('backupAndRestore')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher: JSON vs Excel/CSV */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('json');
              setMessage(null);
            }}
            className={`py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] ${
              activeTab === 'json'
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {isRTL ? (
              <>
                نسخ واستعادة <bdi dir="ltr">JSON</bdi>
              </>
            ) : (
              'JSON Backup & Restore'
            )}
          </button>
          <button
            type="button"
            data-testid="tab-import-spreadsheet"
            onClick={() => {
              setActiveTab('csv');
              setMessage(null);
            }}
            className={`py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] ${
              activeTab === 'csv'
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {isRTL ? (
              <>
                استيراد <bdi dir="ltr">Excel / CSV</bdi>
              </>
            ) : (
              'Import Excel / CSV'
            )}
          </button>
        </div>

        {/* Status Message */}
        {message && (
          <div
            data-testid="backup-status-message"
            data-status={message.error ? 'error' : message.localOnly ? 'local-only' : 'success'}
            className={`p-3 rounded-lg text-xs flex flex-col gap-2 shrink-0 ${
              message.error
                ? 'bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/20 text-[var(--color-expense)]'
                : message.localOnly
                ? 'bg-[var(--color-warning)]/12 border border-[var(--color-warning)]/30 text-[var(--color-warning-text)]'
                : 'bg-[var(--color-income)]/10 border border-[var(--color-income)]/20 text-[var(--color-income)]'
            }`}
          >
            <div className="flex items-start gap-2">
              {message.error || message.localOnly ? (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{message.text}</span>
            </div>
            {message.retryWorkspaceId && (
              <button
                type="button"
                data-testid="retry-cloud-sync-import"
                disabled={isCloudSyncing}
                onClick={handleRetryImportCloudSync}
                className="self-start px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCloudSyncing ? 'animate-spin' : ''}`} />
                <span>
                  {isCloudSyncing
                    ? isRTL
                      ? 'جاري الرفع...'
                      : 'Uploading...'
                    : isRTL
                    ? 'إعادة المحاولة لرفع السحابة الآن'
                    : 'Retry Cloud Upload Now'}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto space-y-3">
          {activeTab === 'json' ? (
            <>
              <div className="p-2.5 rounded-xl bg-[var(--color-accent)]/8 border border-[var(--color-accent)]/25 text-[11px] text-[var(--color-ink)] leading-relaxed">
                {isRTL
                  ? 'يشمل النسخ الاحتياطي السحابي وملف JSON بيانات الحساب الشخصي والجمعيات المالية. مساحات عمل الشركات تتزامن لحظياً عبر السحابة.'
                  : 'JSON and Google Cloud Backup cover your Personal Workspace & Money Circles. Enterprise organizations sync in real time via Cloud Teams.'}
              </div>

              {/* Google Cloud Sync & PRO Account Binding */}
              <div className="p-3.5 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Cloud className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                    <span className="text-xs font-bold text-[var(--color-ink)] truncate">
                      {isRTL ? (
                        <>
                          النسخ الاحتياطي السحابي (<bdi dir="ltr">Google Cloud Sync</bdi>)
                        </>
                      ) : (
                        'Google Cloud Sync & Restore'
                      )}
                    </span>
                  </div>
                  {isPro && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] text-[10px] font-bold shrink-0">
                      <Crown className="w-3 h-3" />
                      <span>PRO</span>
                    </span>
                  )}
                </div>

                {user?.isLoggedIn ? (
                  <div className="space-y-2.5">
                    <div className="p-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {user.avatarUrl ? (
                          <img
                            src={user.avatarUrl}
                            alt={user.name}
                            className="w-8 h-8 rounded-full border border-[var(--color-line)] shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] flex items-center justify-center text-xs font-bold shrink-0">
                            {(user.name || 'R').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[var(--color-ink)] truncate">
                            {user.name}
                          </div>
                          <div className="text-[11px] text-[var(--color-muted)] truncate" dir="ltr">
                            {user.email}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          setIsLogoutModalOpen(true);
                        }}
                        disabled={isCloudSyncing}
                        aria-label={isRTL ? 'تسجيل الخروج' : 'Sign Out'}
                        className="p-2 rounded-lg border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-expense)] transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center shrink-0"
                      >
                        <LogOut className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-[var(--color-muted)]">
                        {settings.lastCloudSyncAt
                          ? isRTL
                            ? `آخر مزامنة سحابية: ${new Date(settings.lastCloudSyncAt).toLocaleString('ar-EG')}`
                            : `Last cloud sync: ${new Date(settings.lastCloudSyncAt).toLocaleString('en-US')}`
                          : isRTL
                          ? 'جاهز للمزامنة السحابية'
                          : 'Ready for cloud sync'}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                          cloudSyncStatus === 'error'
                            ? 'bg-[var(--color-expense)]/15 text-[var(--color-expense)]'
                            : cloudSyncStatus === 'syncing'
                            ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning-text)]'
                            : cloudSyncStatus === 'synced'
                            ? 'bg-[var(--color-income)]/15 text-[var(--color-income)]'
                            : 'bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-muted)]'
                        }`}
                      >
                        {cloudSyncStatus === 'syncing'
                          ? isRTL
                            ? 'جاري المزامنة'
                            : 'Syncing'
                          : cloudSyncStatus === 'error'
                          ? isRTL
                            ? 'خطأ في المزامنة'
                            : 'Sync error'
                          : cloudSyncStatus === 'synced'
                          ? isRTL
                            ? 'تمت المزامنة'
                            : 'Synced'
                          : isRTL
                          ? 'متصل'
                          : 'Connected'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={isCloudSyncing}
                        onClick={async () => {
                          const ok = await syncToCloudNow();
                          setMessage(
                            ok
                              ? {
                                  text: isRTL
                                    ? 'تم حفظ نسختك السحابية واشتراكك بنجاح!'
                                    : 'Cloud backup & PRO status synced!',
                                }
                              : {
                                  text:
                                    cloudSyncError ||
                                    (isRTL
                                      ? 'تعذرت المزامنة السحابية. تحقق من اتصالك بالإنترنت.'
                                      : 'Cloud sync failed. Check your connection.'),
                                  error: true,
                                }
                          );
                        }}
                        className="py-2 px-3 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold flex items-center justify-center gap-1.5 min-h-[40px] disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isCloudSyncing ? 'animate-spin' : ''}`} />
                        <span>{isRTL ? 'رفع للسحابة الآن' : 'Sync Now'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isCloudSyncing || !lastCloudBackupExists}
                        onClick={async () => {
                          const ok = await restoreFromCloudNow();
                          setMessage(
                            ok
                              ? {
                                  text: isRTL
                                    ? 'تمت استعادة البيانات واشتراك PRO من السحابة بنجاح!'
                                    : 'Data & PRO status restored from cloud!',
                                }
                              : {
                                  text: isRTL
                                    ? 'لا توجد نسخة سحابية محفوظة لهذا الحساب بعد.'
                                    : 'No cloud backup found for this account yet.',
                                  error: true,
                                }
                          );
                        }}
                        className="py-2 px-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[var(--color-ink)] text-xs font-semibold flex items-center justify-center gap-1.5 min-h-[40px] disabled:opacity-45"
                      >
                        <Download className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                        <span>{isRTL ? 'استعادة من السحابة' : 'Restore Cloud'}</span>
                      </button>
                    </div>

                    {/* Last 7 Automatic Cloud Backups */}
                    <div className="pt-2 border-t border-[var(--color-line)] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-ink)]">
                          <History className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                          <span>
                            {isRTL ? 'آخر 7 نسخ سحابية تلقائية' : 'Last 7 Cloud Backups'}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={isRefreshingHistory || isCloudSyncing}
                          onClick={async () => {
                            setIsRefreshingHistory(true);
                            try {
                              await refreshCloudBackupHistory();
                            } finally {
                              setIsRefreshingHistory(false);
                            }
                          }}
                          className="text-[10px] font-semibold text-[var(--color-accent)] hover:underline disabled:opacity-50"
                        >
                          {isRefreshingHistory
                            ? isRTL
                              ? 'جاري التحديث...'
                              : 'Refreshing...'
                            : isRTL
                            ? 'تحديث'
                            : 'Refresh'}
                        </button>
                      </div>

                      {cloudBackupHistory.length === 0 ? (
                        <p className="text-[10px] text-[var(--color-muted)]">
                          {isRefreshingHistory
                            ? isRTL
                              ? 'جاري تحميل سجل النسخ...'
                              : 'Loading backup history...'
                            : isRTL
                            ? 'سيتم الاحتفاظ تلقائياً بآخر 7 نسخ سحابية عند المزامنة.'
                            : 'The last 7 automatic cloud snapshots will appear here after sync.'}
                        </p>
                      ) : (
                        <div className="space-y-1.5 max-h-44 overflow-y-auto pe-0.5">
                          {cloudBackupHistory.slice(0, 7).map((entry, idx) => (
                            <div
                              key={entry.id}
                              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)]"
                            >
                              <div className="min-w-0">
                                <div className="text-[11px] font-semibold text-[var(--color-ink)] truncate">
                                  {new Date(entry.createdAtMs).toLocaleString(
                                    isRTL ? 'ar-EG' : 'en-US',
                                    { dateStyle: 'short', timeStyle: 'short' }
                                  )}
                                  {idx === 0 && (
                                    <span className="ms-1.5 text-[9px] font-bold text-[var(--color-accent)]">
                                      {isRTL ? '(الأحدث)' : '(Latest)'}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-[var(--color-muted)]">
                                  {isRTL
                                    ? `${entry.storedTransactionsCount} معاملة • ${entry.walletsCount} محفظة`
                                    : `${entry.storedTransactionsCount} tx • ${entry.walletsCount} wallets`}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={isCloudSyncing || restoringHistoryId !== null}
                                onClick={async () => {
                                  setRestoringHistoryId(entry.id);
                                  try {
                                    const ok = await restoreFromBackupHistoryEntry(entry.id);
                                    setMessage(
                                      ok
                                        ? {
                                            text: isRTL
                                              ? 'تمت استعادة النسخة السحابية المختارة بنجاح!'
                                              : 'Selected cloud backup restored!',
                                          }
                                        : {
                                            text: isRTL
                                              ? 'تعذرت استعادة هذه النسخة.'
                                              : 'Failed to restore selected backup.',
                                            error: true,
                                          }
                                    );
                                  } finally {
                                    setRestoringHistoryId(null);
                                  }
                                }}
                                className="px-2.5 py-1 rounded-md bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 text-[var(--color-accent)] text-[10px] font-bold shrink-0 min-h-[28px] disabled:opacity-50"
                              >
                                {restoringHistoryId === entry.id
                                  ? isRTL
                                    ? 'جاري...'
                                    : '...'
                                  : isRTL
                                  ? 'استعادة'
                                  : 'Restore'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                      {isRTL
                        ? 'اربط بريدك على Google لحفظ معاملاتك، محافظك، واشتراك PRO سحابياً واسترجاعها تلقائياً عند تغيير الهاتف.'
                        : 'Connect your Google account to back up transactions, wallets, and PRO entitlement automatically across devices.'}
                    </p>
                    <button
                      type="button"
                      disabled={isCloudSyncing}
                      onClick={async () => {
                        const res = await signInWithGoogleAccount();
                        if (res) {
                          setMessage({
                            text: res.restored
                              ? isRTL
                                ? 'تم ربط الحساب واستعادة بياناتك واشتراكك من السحابة!'
                                : 'Account linked & cloud data restored!'
                              : isRTL
                              ? 'تم ربط حساب جوجل بنجاح! يمكنك الآن المزامنة السحابية.'
                              : 'Google account linked for cloud sync!',
                          });
                        } else {
                          setMessage({
                            text: isRTL
                              ? 'لم يكتمل تسجيل الدخول بحساب جوجل.'
                              : 'Google sign-in was cancelled or failed.',
                            error: true,
                          });
                        }
                      }}
                      className="w-full py-2.5 px-3 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] disabled:opacity-50"
                    >
                      <Cloud className="w-4 h-4 shrink-0" />
                      <span>
                        {isCloudSyncing
                          ? isRTL
                            ? 'جاري الربط...'
                            : 'Connecting...'
                          : isRTL
                          ? 'ربط حساب جوجل والمزامنة السحابية'
                          : 'Connect Google Account & Sync'}
                      </span>
                    </button>
                  </div>
                )}

                {cloudSyncError && (
                  <p className="text-[11px] text-[var(--color-expense)]">{cloudSyncError}</p>
                )}

                {cloudSkippedAttachmentsWarning > 0 && (
                  <div className="p-2.5 rounded-lg bg-[var(--color-warning)]/12 border border-[var(--color-warning)]/30 text-[11px] text-[var(--color-warning-text)] flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      {isRTL
                        ? `تنبيه: تم استثناء ${cloudSkippedAttachmentsWarning} صورة فاتورة كبيرة من المزامنة السحابية لتجاوز الحد الأقصى لحجم الحزمة، بينما تبقى محفوظة محلياً.`
                        : `Note: ${cloudSkippedAttachmentsWarning} large receipt image(s) were omitted from cloud sync due to size limits, but remain saved locally.`}
                    </span>
                  </div>
                )}
              </div>

              {/* Pre-Restore Snapshot Undo Safety */}
              {preRestoreSnapshotDate && (
                <div className="p-3 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 rounded-xl flex items-center justify-between gap-2">
                  <div className="text-[11px] min-w-0">
                    <div className="font-bold text-[var(--color-ink)]">
                      {isRTL ? 'نقطة استرجاع قبل آخر استعادة' : 'Pre-Restore Safety Snapshot'}
                    </div>
                    <div className="text-[var(--color-muted)] truncate">
                      {new Date(preRestoreSnapshotDate).toLocaleString(isRTL ? 'ar-EG' : 'en-US')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await revertPreRestoreSnapshot();
                      setMessage(
                        ok
                          ? {
                              text: isRTL
                                ? 'تم التراجع عن آخر استعادة واسترجاع حالتك السابقة!'
                                : 'Reverted to pre-restore snapshot!',
                            }
                          : {
                              text: isRTL ? 'تعذر الرجوع للنسخة السابقة.' : 'Could not revert snapshot.',
                              error: true,
                            }
                      );
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-bold flex items-center gap-1 shrink-0 min-h-[36px]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'تراجع' : 'Undo Restore'}</span>
                  </button>
                </div>
              )}

              {/* Optional AES-GCM Password Protection */}
              <div className="p-3.5 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {useEncryption ? (
                      <Lock className="w-4 h-4 text-[var(--color-accent)]" />
                    ) : (
                      <Unlock className="w-4 h-4 text-[var(--color-muted)]" />
                    )}
                    <span className="text-xs font-bold text-[var(--color-ink)]">
                      {isRTL ? (
                        <>
                          تشفير النسخة بكلمة مرور (<bdi dir="ltr">AES-GCM</bdi>)
                        </>
                      ) : (
                        'Password-encrypt export (AES-GCM)'
                      )}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={useEncryption}
                    onChange={(e) => setUseEncryption(e.target.checked)}
                    className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
                  />
                </div>

                {useEncryption && (
                  <div className="relative pt-1">
                    <input
                      type={showBackupPassword ? 'text' : 'password'}
                      value={backupPassword}
                      onChange={(e) => setBackupPassword(e.target.value)}
                      placeholder={isRTL ? 'أدخل كلمة مرور التشفير...' : 'Enter encryption password...'}
                      className="w-full py-2 ps-3 pe-10 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[40px]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBackupPassword(!showBackupPassword)}
                      className="absolute top-1/2 -translate-y-1/2 end-2 p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    >
                      {showBackupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                )}
              </div>

              {/* JSON Export + Share */}
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  disabled={isProcessingJson}
                  onClick={handleExportJSON}
                  className="w-full p-3.5 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between text-xs transition-colors min-h-[52px]"
                >
                  <div className="flex items-center gap-3">
                    <Download className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                    <div className="text-start">
                      <div className="font-bold text-[var(--color-ink)]">{t('exportJSON')}</div>
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {isRTL ? (
                          <>
                            حفظ نسخة محلية بصيغة <bdi dir="ltr">JSON</bdi>
                          </>
                        ) : (
                          'Save local JSON backup file'
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="text-[var(--color-accent)] font-semibold">
                    {isRTL ? 'تصدير' : 'Export'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isProcessingJson}
                  onClick={handleShareJSON}
                  className="w-full p-3.5 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between text-xs transition-colors min-h-[52px]"
                >
                  <div className="flex items-center gap-3">
                    <Share2 className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                    <div className="text-start">
                      <div className="font-bold text-[var(--color-ink)]">
                        {isRTL ? 'مشاركة النسخة الاحتياطية' : 'Share Backup File'}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {isRTL
                          ? 'إرسال الملف عبر تطبيقات المشاركة'
                          : 'Send backup via device Share sheet'}
                      </div>
                    </div>
                  </div>
                  <span className="text-[var(--color-accent)] font-semibold">
                    {isRTL ? 'مشاركة' : 'Share'}
                  </span>
                </button>

                {/* JSON Import */}
                <button
                  type="button"
                  onClick={() => jsonFileInputRef.current?.click()}
                  className="w-full p-3.5 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between text-xs transition-colors min-h-[52px]"
                >
                  <div className="flex items-center gap-3">
                    <Upload className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                    <div className="text-start">
                      <div className="font-bold text-[var(--color-ink)]">{t('importJSON')}</div>
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {isRTL
                          ? 'استرجاع ملف عادي أو مشفر بكلمة مرور'
                          : 'Restore plain or encrypted JSON backup'}
                      </div>
                    </div>
                  </div>
                  <span className="text-[var(--color-accent)] font-semibold">
                    {isRTL ? 'استيراد' : 'Import'}
                  </span>
                </button>
                <input
                  ref={jsonFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleImportJSON}
                />
              </div>

              {/* Password Prompt for Encrypted Backup Import */}
              {pendingEncryptedPayload && (
                <form
                  onSubmit={handleDecryptAndRestore}
                  className="p-3.5 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 rounded-xl space-y-2.5"
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-accent)]">
                    <KeyRound className="w-4 h-4" />
                    <span>
                      {isRTL ? 'فك تشفير النسخة الاحتياطية' : 'Decrypt Encrypted Backup'}
                    </span>
                  </div>
                  <input
                    type="password"
                    required
                    value={decryptPassword}
                    onChange={(e) => setDecryptPassword(e.target.value)}
                    placeholder={isRTL ? 'كلمة المرور المستخدمة عند التصدير...' : 'Password used during export...'}
                    className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[40px]"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={isProcessingJson || !decryptPassword.trim()}
                      className="flex-1 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold rounded-lg text-xs min-h-[40px]"
                    >
                      {isRTL ? 'فك التشفير والاستعادة' : 'Decrypt & Restore'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingEncryptedPayload(null);
                        setDecryptPassword('');
                      }}
                      className="px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-muted)] rounded-lg text-xs min-h-[40px]"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            /* Excel / CSV Import Wizard */
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => csvFileInputRef.current?.click()}
                className="w-full p-3.5 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-dashed border-[var(--color-line)] rounded-xl flex items-center justify-between text-xs transition-colors min-h-[52px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileSpreadsheet className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                  <div className="text-start min-w-0">
                    <div className="font-bold text-[var(--color-ink)] truncate">
                      {csvFileName ||
                        (isRTL ? (
                          <>
                            اختر ملف <bdi dir="ltr">Excel (.xlsx / .xls)</bdi> أو{' '}
                            <bdi dir="ltr">CSV</bdi>
                          </>
                        ) : (
                          'Choose Excel (.xlsx / .xls) or CSV file'
                        ))}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {csvRows.length > 0
                        ? isRTL
                          ? `${csvRows.length} صف جاهز للمعاينة`
                          : `${csvRows.length} rows ready for preview`
                        : isRTL ? (
                          <>
                            يدعم ملفات <bdi dir="ltr">Excel</bdi> وكشوف الحسابات{' '}
                            <bdi dir="ltr">CSV</bdi>
                          </>
                        ) : (
                          'Supports Excel workbooks & bank CSV exports'
                        )}
                    </div>
                  </div>
                </div>
                <span className="text-[var(--color-accent)] font-semibold shrink-0">
                  {isRTL ? 'تصفح' : 'Browse'}
                </span>
              </button>
              <input
                ref={csvFileInputRef}
                data-testid="spreadsheet-file-input"
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="hidden"
                onChange={handleCsvFileSelected}
              />

              {csvHeaders.length > 0 && (
                <div className="space-y-3">
                  {/* Worksheet selector for multi-sheet Excel files */}
                  {importSheetNames.length > 1 && (
                    <div>
                      <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                        {isRTL ? 'ورقة العمل (Sheet)' : 'Worksheet'}
                      </label>
                      <select
                        value={importActiveSheet}
                        onChange={(e) => handleImportSheetChange(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[40px]"
                      >
                        {importSheetNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Optional Fallback Wallet (used only for rows without a wallet name) */}
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                      {isRTL
                        ? 'المحفظة الافتراضية (للصفوف بدون عمود محفظة فقط)'
                        : 'Fallback Wallet (for rows with empty Wallet)'}
                    </label>
                    <select
                      value={targetWalletId}
                      onChange={(e) => setTargetWalletId(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] min-h-[40px]"
                    >
                      {wallets.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} ({w.currency})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Smart Parsing Rules Notice */}
                  <div className="p-2.5 rounded-xl bg-[var(--color-accent)]/8 border border-[var(--color-accent)]/25 text-[11px] text-[var(--color-ink)] leading-relaxed">
                    {isRTL
                      ? 'استيراد ذكي تلقائي: المبلغ الموجب يُسجل كـ «دخل»، والسالب كـ «مصروف»، ووجود «إلى المحفظة» يُسجل كـ «تحويل». تُنشأ المحافظ والتصنيفات غير الموجودة تلقائياً.'
                      : 'Smart import: Positive amounts = Income, negative = Expense, populated "To Wallet" = Transfer. Missing wallets (starting at 0) & categories are created automatically.'}
                  </div>

                  {/* Column Mapping Selectors */}
                  <div className="p-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold text-[var(--color-ink)]">
                        {isRTL ? 'ربط الأعمدة (تلقائي)' : 'Column Mapping (Auto-detected)'}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setCsvMapping({ ...autoDetectCsvMapping(csvHeaders), typeIndex: -1 })
                        }
                        className="text-[10px] font-semibold text-[var(--color-accent)] hover:underline"
                      >
                        {isRTL ? 'إعادة التعرف التلقائي' : 'Auto-detect'}
                      </button>
                    </div>
                    {(
                      [
                        { key: 'dateIndex', label: isRTL ? 'التاريخ *' : 'Date *' },
                        { key: 'amountIndex', label: isRTL ? 'المبلغ / التكلفة *' : 'Amount / Cost *' },
                        { key: 'walletIndex', label: isRTL ? 'المحفظة (توجيه وإنشاء تلقائي)' : 'Wallet (Auto-route/create)' },
                        { key: 'toWalletIndex', label: isRTL ? 'إلى المحفظة (تحويل)' : 'To Wallet (Transfer)' },
                        { key: 'categoryIndex', label: isRTL ? 'القسم / التصنيف' : 'Category / Section' },
                        { key: 'notesIndex', label: isRTL ? 'الملاحظات (اختياري)' : 'Notes (Optional)' },
                      ] as Array<{ key: keyof CsvColumnMapping; label: string }>
                    ).map((field) => (
                      <div key={field.key} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-[var(--color-muted)] shrink-0">{field.label}</span>
                        <select
                          data-testid={`map-select-${field.key}`}
                          value={csvMapping[field.key] ?? -1}
                          onChange={(e) =>
                            setCsvMapping((prev) => ({
                              ...prev,
                              [field.key]: parseInt(e.target.value, 10),
                            }))
                          }
                          className="w-44 px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)]"
                        >
                          <option value={-1}>{isRTL ? '— غير محدد —' : '— Unmapped —'}</option>
                          {csvHeaders.map((h, idx) => (
                            <option key={idx} value={idx}>
                              {h || (isRTL ? `عمود ${idx + 1}` : `Col ${idx + 1}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  {/* Auto-Creation Summary (Wallets & Categories) */}
                  {(readyWalletsToCreate.length > 0 || readyCategoriesToCreate.length > 0) && (
                    <div
                      data-testid="auto-create-summary"
                      className="p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-accent)]/35 space-y-1.5 text-[11px]"
                    >
                      {readyWalletsToCreate.length > 0 && (
                        <div>
                          <span className="font-bold text-[var(--color-accent)]">
                            {isRTL
                              ? `محافظ جديدة ستُنشأ تلقائياً برصيد 0 (${readyWalletsToCreate.length}): `
                              : `New wallets to auto-create at 0 (${readyWalletsToCreate.length}): `}
                          </span>
                          <span className="text-[var(--color-ink)]">
                            {readyWalletsToCreate.map((w) => w.name).join('، ')}
                          </span>
                        </div>
                      )}
                      {readyCategoriesToCreate.length > 0 && (
                        <div>
                          <span className="font-bold text-[var(--color-accent)]">
                            {isRTL
                              ? `تصنيفات جديدة ستُنشأ تلقائياً (${readyCategoriesToCreate.length}): `
                              : `New categories to auto-create (${readyCategoriesToCreate.length}): `}
                          </span>
                          <span className="text-[var(--color-ink)]">
                            {readyCategoriesToCreate.map((c) => c.nameAr).join('، ')}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Duplicate Detection Toggle & Stats */}
                  <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs">
                    <div>
                      <div className="font-semibold text-[var(--color-ink)]">
                        {isRTL ? 'تخطي المعاملات المكررة تلقائياً' : 'Skip duplicate rows'}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)] mt-0.5 flex flex-wrap gap-x-2">
                        <span className="text-[var(--color-income)] font-semibold">
                          {isRTL
                            ? `صالح: ${csvPreviewResult.validCount}`
                            : `Valid: ${csvPreviewResult.validCount}`}
                        </span>
                        {csvPreviewResult.invalidCount > 0 && (
                          <span className="text-[var(--color-expense)] font-semibold">
                            {isRTL
                              ? `غير صالح (يُتخطى): ${csvPreviewResult.invalidCount}`
                              : `Invalid (skipped): ${csvPreviewResult.invalidCount}`}
                          </span>
                        )}
                        <span>
                          {isRTL
                            ? `مكرر: ${csvPreviewResult.duplicateCount}`
                            : `Duplicates: ${csvPreviewResult.duplicateCount}`}
                        </span>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                      className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
                    />
                  </div>

                  {/* Formatted Preview Table (first 6 rows) */}
                  <div className="border border-[var(--color-line)] rounded-xl overflow-hidden bg-[var(--color-bg)]">
                    <div className="px-3 py-2 border-b border-[var(--color-line)] flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-[var(--color-ink)]">
                        {isRTL ? 'معاينة أول الصفوف' : 'Preview First Rows'}
                      </span>
                      <div className="flex items-center gap-1 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md p-0.5 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setPreviewMode('mapped')}
                          className={`px-2 py-0.5 rounded font-semibold ${
                            previewMode === 'mapped'
                              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                              : 'text-[var(--color-muted)]'
                          }`}
                        >
                          {isRTL ? 'بعد الربط' : 'Mapped'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewMode('raw')}
                          className={`px-2 py-0.5 rounded font-semibold ${
                            previewMode === 'raw'
                              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                              : 'text-[var(--color-muted)]'
                          }`}
                        >
                          {isRTL ? 'أعمدة الملف' : 'Raw Sheet'}
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto max-h-48">
                      {previewMode === 'mapped' ? (
                        <table
                          data-testid="import-preview-table"
                          className="w-full text-[11px] text-start border-collapse"
                        >
                          <thead className="bg-[var(--color-surface)] border-b border-[var(--color-line)] text-[10px] text-[var(--color-muted)] sticky top-0">
                            <tr>
                              <th className="px-2.5 py-1.5 font-semibold text-start">#</th>
                              <th className="px-2.5 py-1.5 font-semibold text-start">
                                {isRTL ? 'التاريخ' : 'Date'}
                              </th>
                              <th className="px-2.5 py-1.5 font-semibold text-start">
                                {isRTL ? 'المبلغ' : 'Amount'}
                              </th>
                              <th className="px-2.5 py-1.5 font-semibold text-start">
                                {isRTL ? 'القسم' : 'Category'}
                              </th>
                              {((csvMapping.walletIndex ?? -1) >= 0 ||
                                (csvMapping.toWalletIndex ?? -1) >= 0) && (
                                <th className="px-2.5 py-1.5 font-semibold text-start">
                                  {isRTL ? 'المحفظة' : 'Wallet'}
                                </th>
                              )}
                              <th className="px-2.5 py-1.5 font-semibold text-start">
                                {isRTL ? 'الملاحظات' : 'Notes'}
                              </th>
                              <th className="px-2.5 py-1.5 font-semibold text-start">
                                {isRTL ? 'الحالة' : 'Status'}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-line)]">
                            {csvPreviewResult.previewRows.slice(0, 6).map((row) => (
                              <tr
                                key={row.rowIndex}
                                className={
                                  !row.isValid
                                    ? 'bg-[var(--color-expense)]/5'
                                    : row.isDuplicate
                                    ? 'bg-[var(--color-warning)]/5'
                                    : ''
                                }
                              >
                                <td className="px-2.5 py-1.5 text-[var(--color-muted)] num-tabular">
                                  {row.rowIndex}
                                </td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap num-tabular">
                                  {row.date || '—'}
                                </td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap font-bold num-tabular">
                                  {row.isValid ? (
                                    <span
                                      className={
                                        row.type === 'income'
                                          ? 'text-[var(--color-income)]'
                                          : row.type === 'transfer'
                                          ? 'text-[var(--color-accent)]'
                                          : 'text-[var(--color-expense)]'
                                      }
                                    >
                                      {row.type === 'income'
                                        ? '+'
                                        : row.type === 'transfer'
                                        ? '⇄ '
                                        : '−'}
                                      {row.amount}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="px-2.5 py-1.5 max-w-[120px] truncate">
                                  <span>{row.categoryLabel}</span>
                                  {row.isNewCategory && (
                                    <span className="ms-1 text-[9px] font-bold text-[var(--color-accent)]">
                                      {isRTL ? '(جديد)' : '(new)'}
                                    </span>
                                  )}
                                </td>
                                {((csvMapping.walletIndex ?? -1) >= 0 ||
                                  (csvMapping.toWalletIndex ?? -1) >= 0) && (
                                  <td className="px-2.5 py-1.5 max-w-[150px] truncate text-[var(--color-muted)]">
                                    <span>{row.walletName || '—'}</span>
                                    {row.isNewWallet && (
                                      <span className="ms-1 text-[9px] font-bold text-[var(--color-accent)]">
                                        {isRTL ? '(جديدة)' : '(new)'}
                                      </span>
                                    )}
                                    {row.type === 'transfer' && row.toWalletName && (
                                      <span className="text-[var(--color-accent)] font-semibold">
                                        {' → '}
                                        {row.toWalletName}
                                        {row.isNewToWallet
                                          ? isRTL
                                            ? ' (جديدة)'
                                            : ' (new)'
                                          : ''}
                                      </span>
                                    )}
                                  </td>
                                )}
                                <td className="px-2.5 py-1.5 max-w-[120px] truncate text-[var(--color-muted)]">
                                  {row.notes || '—'}
                                </td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap">
                                  {!row.isValid ? (
                                    <span className="px-1.5 py-0.5 rounded bg-[var(--color-expense)]/15 text-[var(--color-expense)] text-[10px] font-semibold">
                                      {isRTL
                                        ? row.errorReasonAr || 'غير صالح'
                                        : row.errorReason || 'Invalid'}
                                    </span>
                                  ) : row.isDuplicate ? (
                                    <span className="px-1.5 py-0.5 rounded bg-[var(--color-warning)]/15 text-[var(--color-warning-text)] text-[10px] font-semibold">
                                      {isRTL ? 'مكرر' : 'Duplicate'}
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded bg-[var(--color-income)]/15 text-[var(--color-income)] text-[10px] font-semibold">
                                      {isRTL ? 'صالح' : 'Valid'}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <table className="w-full text-[11px] text-start border-collapse">
                          <thead className="bg-[var(--color-surface)] border-b border-[var(--color-line)] text-[10px] text-[var(--color-muted)] sticky top-0">
                            <tr>
                              {csvHeaders.map((h, i) => (
                                <th key={i} className="px-2.5 py-1.5 font-semibold text-start whitespace-nowrap">
                                  {h || (isRTL ? `عمود ${i + 1}` : `Col ${i + 1}`)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-line)]">
                            {csvRecords.slice(0, 6).map((rec, rIdx) => {
                              const keys = Object.keys(rec);
                              return (
                                <tr key={rIdx}>
                                  {keys.map((k) => (
                                    <td
                                      key={k}
                                      className="px-2.5 py-1.5 max-w-[140px] truncate whitespace-nowrap"
                                    >
                                      {rec[k] || '—'}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  {/* Confirm Import Button */}
                  <button
                    type="button"
                    data-testid="confirm-spreadsheet-import"
                    disabled={rowsReadyToImport.length === 0 || isImportingCsv}
                    onClick={handleConfirmCsvImport}
                    className="w-full py-2.5 bg-[var(--color-accent)] disabled:opacity-40 text-[var(--color-on-accent)] font-semibold rounded-xl text-xs min-h-[44px] flex items-center justify-center gap-2"
                  >
                    {isImportingCsv && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>
                      {isImportingCsv
                        ? isRTL
                          ? 'جاري الحفظ والمزامنة السحابية...'
                          : 'Saving & syncing to cloud...'
                        : isRTL
                        ? `استيراد ${rowsReadyToImport.length} معاملة صالحة`
                        : `Import ${rowsReadyToImport.length} valid transactions`}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)] font-semibold rounded-lg text-xs min-h-[44px] shrink-0"
        >
          {t('close')}
        </button>
      </div>
    </div>
  );
};
