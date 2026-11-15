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
  parseCsvText,
  autoDetectCsvMapping,
  mapCsvRowsToTransactions,
  CsvColumnMapping,
} from '../../services/csvImport';
import { formatLocalDate } from '../../services/calculations';

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
    signOutGoogleAccount,
    syncToCloudNow,
    restoreFromCloudNow,
    updateSettings,
    importTransactionsBatch,
    t,
    isRTL,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'json' | 'csv'>('json');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // JSON encryption / decryption state
  const [useEncryption, setUseEncryption] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [showBackupPassword, setShowBackupPassword] = useState(false);
  const [pendingEncryptedPayload, setPendingEncryptedPayload] = useState<string | null>(null);
  const [decryptPassword, setDecryptPassword] = useState('');
  const [isProcessingJson, setIsProcessingJson] = useState(false);

  // CSV Import Wizard state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping>({
    dateIndex: -1,
    amountIndex: -1,
    typeIndex: -1,
    categoryIndex: -1,
    notesIndex: -1,
  });
  const [targetWalletId, setTargetWalletId] = useState(wallets[0]?.id || '');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const [restoringHistoryId, setRestoringHistoryId] = useState<string | null>(null);

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
      transactions: parsed.transactions || [],
      wallets: parsed.wallets || [],
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

  // Import full JSON (detects encrypted payload automatically)
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

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

  // CSV Import Handlers
  const handleCsvFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (event) => {
      const raw = (event.target?.result as string) || '';
      const parsed = parseCsvText(raw);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setMessage({
          text: isRTL ? 'ملف CSV فارغ أو غير صالح.' : 'CSV file is empty or invalid.',
          error: true,
        });
        return;
      }

      setCsvFileName(file.name);
      setCsvHeaders(parsed.headers);
      setCsvRows(parsed.rows);
      setCsvMapping(autoDetectCsvMapping(parsed.headers));
      if (!targetWalletId && wallets[0]) {
        setTargetWalletId(wallets[0].id);
      }
      setMessage(null);
    };
    reader.readAsText(file);
  };

  const csvPreviewResult = useMemo(() => {
    if (csvRows.length === 0) return { previewRows: [], validCount: 0, duplicateCount: 0 };
    return mapCsvRowsToTransactions({
      rows: csvRows,
      mapping: csvMapping,
      categories,
      existingTransactions: transactions,
    });
  }, [csvRows, csvMapping, categories, transactions]);

  const rowsReadyToImport = useMemo(() => {
    return csvPreviewResult.previewRows.filter(
      (r) => r.isValid && (!skipDuplicates || !r.isDuplicate)
    );
  }, [csvPreviewResult.previewRows, skipDuplicates]);

  const handleConfirmCsvImport = () => {
    const wallet = wallets.find((w) => w.id === targetWalletId) || wallets[0];
    if (!wallet || rowsReadyToImport.length === 0) return;

    const batch = rowsReadyToImport.map((r) => ({
      type: r.type,
      amount: r.amount,
      currency: wallet.currency,
      date: r.date,
      time: '12:00',
      categoryId: r.categoryId,
      walletId: wallet.id,
      notes: r.notes,
      priority: 'normal' as const,
      doesNotAffectBalance: false,
    }));

    const imported = importTransactionsBatch(batch);
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvFileName('');
    setMessage({
      text: isRTL
        ? `تم استيراد ${imported} معاملة بنجاح!`
        : `Successfully imported ${imported} transactions!`,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md max-h-[90vh] flex flex-col rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl space-y-4 overflow-hidden"
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

        {/* Mode Switcher: JSON vs CSV */}
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
                استيراد <bdi dir="ltr">CSV</bdi>
              </>
            ) : (
              'CSV Import Wizard'
            )}
          </button>
        </div>

        {/* Status Message */}
        {message && (
          <div
            className={`p-3 rounded-lg text-xs flex items-center gap-2 shrink-0 ${
              message.error
                ? 'bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/20 text-[var(--color-expense)]'
                : 'bg-[var(--color-income)]/10 border border-[var(--color-income)]/20 text-[var(--color-income)]'
            }`}
          >
            {message.error ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span>{message.text}</span>
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
                        onClick={() => void signOutGoogleAccount()}
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
            /* CSV Import Wizard */
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => csvFileInputRef.current?.click()}
                className="w-full p-3.5 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] border border-dashed border-[var(--color-line)] rounded-xl flex items-center justify-between text-xs transition-colors min-h-[52px]"
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                  <div className="text-start">
                    <div className="font-bold text-[var(--color-ink)]">
                      {csvFileName ||
                        (isRTL ? (
                          <>
                            اختر ملف <bdi dir="ltr">CSV</bdi> للاستيراد
                          </>
                        ) : (
                          'Choose CSV file to import'
                        ))}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {csvRows.length > 0
                        ? isRTL
                          ? `${csvRows.length} صف جاهز للمعاينة`
                          : `${csvRows.length} rows ready for preview`
                        : isRTL ? (
                          <>
                            يدعم كشوف الحسابات وتقارير <bdi dir="ltr">Excel</bdi>
                          </>
                        ) : (
                          'Supports bank exports & Excel CSV'
                        )}
                    </div>
                  </div>
                </div>
                <span className="text-[var(--color-accent)] font-semibold">
                  {isRTL ? 'تصفح' : 'Browse'}
                </span>
              </button>
              <input
                ref={csvFileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleCsvFileSelected}
              />

              {csvHeaders.length > 0 && (
                <div className="space-y-3">
                  {/* Target Wallet */}
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                      {isRTL ? 'المحفظة المستهدفة' : 'Target Wallet'}
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

                  {/* Column Mapping Selectors */}
                  <div className="p-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl space-y-2">
                    <div className="text-xs font-bold text-[var(--color-ink)] mb-1">
                      {isRTL ? 'ربط الأعمدة' : 'Column Mapping'}
                    </div>
                    {(
                      [
                        { key: 'dateIndex', label: isRTL ? 'التاريخ *' : 'Date *' },
                        { key: 'amountIndex', label: isRTL ? 'المبلغ *' : 'Amount *' },
                        { key: 'typeIndex', label: isRTL ? 'النوع (اختياري)' : 'Type (Optional)' },
                        { key: 'categoryIndex', label: isRTL ? 'التصنيف (اختياري)' : 'Category (Optional)' },
                        { key: 'notesIndex', label: isRTL ? 'الملاحظات (اختياري)' : 'Notes (Optional)' },
                      ] as Array<{ key: keyof CsvColumnMapping; label: string }>
                    ).map((field) => (
                      <div key={field.key} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-[var(--color-muted)] shrink-0">{field.label}</span>
                        <select
                          value={csvMapping[field.key]}
                          onChange={(e) =>
                            setCsvMapping((prev) => ({
                              ...prev,
                              [field.key]: parseInt(e.target.value, 10),
                            }))
                          }
                          className="w-40 px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)]"
                        >
                          <option value={-1}>{isRTL ? '— غير محدد —' : '— Unmapped —'}</option>
                          {csvHeaders.map((h, idx) => (
                            <option key={idx} value={idx}>
                              {h || `Col ${idx + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  {/* Duplicate Detection Toggle & Stats */}
                  <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs">
                    <div>
                      <div className="font-semibold text-[var(--color-ink)]">
                        {isRTL ? 'تخطي المعاملات المكررة تلقائياً' : 'Skip duplicate rows'}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)] mt-0.5">
                        {isRTL
                          ? `صالحة: ${csvPreviewResult.validCount} • مكررة: ${csvPreviewResult.duplicateCount}`
                          : `Valid: ${csvPreviewResult.validCount} • Duplicates: ${csvPreviewResult.duplicateCount}`}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                      className="w-4 h-4 accent-[var(--color-accent)] rounded cursor-pointer"
                    />
                  </div>

                  {/* Preview Table (first 6 rows) */}
                  <div className="border border-[var(--color-line)] rounded-xl overflow-hidden bg-[var(--color-bg)]">
                    <div className="px-3 py-2 border-b border-[var(--color-line)] text-[11px] font-bold text-[var(--color-muted)]">
                      {isRTL ? 'معاينة أول الصفوف' : 'Preview'}
                    </div>
                    <div className="divide-y divide-[var(--color-line)] max-h-40 overflow-y-auto text-[11px]">
                      {csvPreviewResult.previewRows.slice(0, 6).map((row) => (
                        <div key={row.rowIndex} className="px-3 py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-[var(--color-ink)] truncate">
                              {row.categoryLabel} {row.notes ? `• ${row.notes}` : ''}
                            </div>
                            <div className="text-[10px] text-[var(--color-muted)]">{row.date}</div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {row.isDuplicate && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--color-warning)]/15 text-[var(--color-warning-text)] text-[10px] font-semibold">
                                {isRTL ? 'مكرر' : 'Dup'}
                              </span>
                            )}
                            {!row.isValid ? (
                              <span className="text-[var(--color-expense)] font-semibold">
                                {isRTL ? 'غير صالح' : 'Invalid'}
                              </span>
                            ) : (
                              <span
                                className={`font-bold num-tabular ${
                                  row.type === 'income'
                                    ? 'text-[var(--color-income)]'
                                    : 'text-[var(--color-expense)]'
                                }`}
                              >
                                {row.type === 'income' ? '+' : '−'}
                                {row.amount}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Confirm Import Button */}
                  <button
                    type="button"
                    disabled={rowsReadyToImport.length === 0}
                    onClick={handleConfirmCsvImport}
                    className="w-full py-2.5 bg-[var(--color-accent)] disabled:opacity-40 text-[var(--color-on-accent)] font-semibold rounded-xl text-xs min-h-[44px]"
                  >
                    {isRTL
                      ? `استيراد ${rowsReadyToImport.length} معاملة`
                      : `Import ${rowsReadyToImport.length} transactions`}
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
