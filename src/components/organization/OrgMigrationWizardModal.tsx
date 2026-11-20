import React, { useEffect, useState } from 'react';
import {
  Building2,
  CloudUpload,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  LogIn,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  auth,
  createOrgOnServer,
  saveCloudBackup,
} from '../../services/firebase';
import {
  createCloudOrganizationDirect,
  migrateLegacyOrgToCloud,
} from '../../services/orgCloud';
import { loadOrgWorkspaces } from '../../services/db';
import { formatLocalDate } from '../../services/calculations';
import { OrgWorkspaceData } from '../../types';

export const OrgMigrationWizardModal: React.FC = () => {
  const {
    legacyLocalOrgs,
    isOrgMigrationModalOpen,
    dismissLegacyOrgMigration,
    completeLegacyOrgMigration,
    setOrgMigrationSuccessMessage,
    transactions,
    wallets,
    categories,
    budgets,
    debts,
    goals,
    templates,
    moneyCircles,
    settings,
    hasCompletedOnboarding,
    user,
    signInWithGoogleAccount,
    switchWorkspace,
    t,
    isRTL,
  } = useApp();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [progress, setProgress] = useState<{ currentOrgName: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  useEffect(() => {
    setSelectedIds(legacyLocalOrgs.map((ws) => ws.organization.id));
    setError(null);
    setDoneCount(null);
  }, [legacyLocalOrgs]);

  if (!isOrgMigrationModalOpen || legacyLocalOrgs.length === 0) return null;

  const downloadSafetyJson = () => {
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        source: 'raseedi_legacy_local_orgs',
        organizations: legacyLocalOrgs,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `raseedi-legacy-orgs-safety-${formatLocalDate()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // ignore download errors
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setError(null);
    try {
      await signInWithGoogleAccount();
    } catch {
      setError(
        isRTL ? 'تعذر تسجيل الدخول بحساب جوجل.' : 'Google sign-in failed.'
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleMigrate = async () => {
    if (!user?.isLoggedIn) {
      setError(t('signInRequiredForCloudOrg'));
      return;
    }
    const targets = legacyLocalOrgs.filter((ws) => selectedIds.includes(ws.organization.id));
    if (targets.length === 0) {
      setError(isRTL ? 'اختر مؤسسة واحدة على الأقل للترحيل.' : 'Select at least one organization.');
      return;
    }

    setError(null);
    setIsMigrating(true);
    downloadSafetyJson();

    const serverMigratedIds: string[] = [];
    const fallbackTargets: OrgWorkspaceData[] = [];
    let lastCreatedOrgId = '';
    try {
      for (const ws of targets) {
        const org = ws.organization;
        setProgress({
          currentOrgName: org.name,
          done: 0,
          total:
            (ws.wallets?.length || 0) +
            (ws.categories?.length || 0) +
            (ws.costCenters?.length || 0) +
            (ws.parties?.length || 0) +
            (ws.budgets?.length || 0) +
            (ws.transactions?.length || 0) +
            1,
        });

        try {
          const created = await createOrgOnServer({
            name: org.name,
            currency: org.currency || org.mainCurrency || 'EGP',
            industry: org.industry || 'general',
            vatRate: Number.isFinite(org.vatRate) ? org.vatRate : 14,
            approvalThreshold: Number.isFinite(org.approvalThreshold) ? org.approvalThreshold : 5000,
            taxNumber: org.taxNumber,
            skipStarterSeed: true,
          });

          await migrateLegacyOrgToCloud(
            created.orgId,
            ws,
            { uid: user.id, name: user.name || user.email || 'Owner' },
            (done, total) => {
              setProgress({ currentOrgName: org.name, done, total });
            }
          );

          serverMigratedIds.push(org.id);
          lastCreatedOrgId = created.orgId;
        } catch {
          // Server endpoint unavailable (e.g. static Vercel hosting) -> try direct atomic Firestore Cloud Org creation
          try {
            const directCreated = await createCloudOrganizationDirect({
              name: org.name,
              currency: org.currency || org.mainCurrency || 'EGP',
              industry: org.industry || 'general',
              vatRate: Number.isFinite(org.vatRate) ? org.vatRate : 14,
              approvalThreshold: Number.isFinite(org.approvalThreshold) ? org.approvalThreshold : 5000,
              taxNumber: org.taxNumber,
              preferredOrgId: org.id,
              seedWorkspace: ws,
              onMigrationProgress: (done, total) => {
                setProgress({ currentOrgName: org.name, done, total });
              },
            });
            serverMigratedIds.push(org.id);
            lastCreatedOrgId = directCreated.orgId;
          } catch {
            // Final offline-safe fallback to user Cloud Backup
            fallbackTargets.push(ws);
          }
        }
      }

      if (fallbackTargets.length > 0) {
        const stored = await loadOrgWorkspaces();
        const now = Date.now();
        const mergedOrgMap: Record<string, OrgWorkspaceData> = {
          ...(stored.workspaces || {}),
        };
        for (const ws of fallbackTargets) {
          const id = ws.organization.id;
          mergedOrgMap[id] = {
            ...ws,
            organization: {
              ...ws.organization,
              localFirstMode: true,
              cloudBackedUpAt: now,
              updatedAt: now,
            },
          };
          lastCreatedOrgId = id;
        }

        const uid = auth.currentUser?.uid || user.id;
        await saveCloudBackup(uid, {
          transactions,
          wallets,
          categories,
          budgets,
          debts,
          goals,
          templates,
          moneyCircles,
          orgWorkspaces: mergedOrgMap,
          activeWorkspace: lastCreatedOrgId || 'personal',
          settings,
          hasCompletedOnboarding,
        });

        await completeLegacyOrgMigration(
          fallbackTargets.map((w) => w.organization.id),
          { keepLocalWorkspaces: true }
        );
      }

      if (serverMigratedIds.length > 0) {
        await completeLegacyOrgMigration(serverMigratedIds);
      }

      const totalMigrated = serverMigratedIds.length + fallbackTargets.length;
      setDoneCount(totalMigrated);
      setOrgMigrationSuccessMessage(
        isRTL
          ? 'تم حفظ وترحيل بيانات المؤسسة في نسختك السحابية بنجاح!'
          : 'Organization data saved to your Cloud Backup successfully!'
      );
      if (lastCreatedOrgId) {
        switchWorkspace(lastCreatedOrgId);
      }
      dismissLegacyOrgMigration();
    } catch (err) {
      if (serverMigratedIds.length > 0) {
        await completeLegacyOrgMigration(serverMigratedIds);
      }
      setError(
        err instanceof Error
          ? err.message
          : isRTL
          ? 'حدث خطأ أثناء ترحيل البيانات السحابي. تم حفظ نسخة أمان JSON على جهازك.'
          : 'Migration error occurred. A safety JSON backup was downloaded to your device.'
      );
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent)] flex items-center justify-center shrink-0">
              <CloudUpload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-title text-sm sm:text-base font-bold text-[var(--color-ink)]">
                {t('migrateLocalOrgsTitle')}
              </h2>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mt-0.5">
                {t('migrateLocalOrgsDesc')}
              </p>
            </div>
          </div>
          {!isMigrating && (
            <button
              type="button"
              onClick={dismissLegacyOrgMigration}
              aria-label={t('close')}
              className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Auth Check */}
        {!user?.isLoggedIn && (
          <div className="p-3.5 rounded-xl bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 space-y-2.5">
            <div className="flex items-start gap-2 text-xs text-[var(--color-ink)]">
              <ShieldCheck className="w-4 h-4 text-[var(--color-warning-text)] shrink-0 mt-0.5" />
              <span>{t('signInRequiredForCloudOrg')}</span>
            </div>
            <button
              type="button"
              disabled={isSigningIn}
              onClick={handleSignIn}
              className="w-full py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-2 min-h-[44px]"
            >
              <LogIn className="w-4 h-4" />
              <span>
                {isSigningIn
                  ? isRTL
                    ? 'جاري تسجيل الدخول...'
                    : 'Signing in...'
                  : isRTL
                  ? 'تسجيل الدخول بحساب جوجل'
                  : 'Sign in with Google'}
              </span>
            </button>
          </div>
        )}

        {/* Legacy Orgs List */}
        <div className="space-y-2">
          {legacyLocalOrgs.map((ws) => {
            const checked = selectedIds.includes(ws.organization.id);
            return (
              <label
                key={ws.organization.id}
                className={`p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                  checked
                    ? 'bg-[var(--color-accent)]/8 border-[var(--color-accent)]/50'
                    : 'bg-[var(--color-bg)] border-[var(--color-line)]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    disabled={isMigrating}
                    checked={checked}
                    onChange={() => toggleSelect(ws.organization.id)}
                    className="w-4 h-4 accent-[var(--color-accent)] rounded shrink-0"
                  />
                  <Building2 className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[var(--color-ink)] truncate">
                      {ws.organization.name}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {ws.organization.currency} • {ws.transactions?.length || 0}{' '}
                      {isRTL ? 'معاملة' : 'tx'} • {ws.wallets?.length || 0}{' '}
                      {isRTL ? 'محفظة' : 'wallets'} • {ws.parties?.length || 0}{' '}
                      {isRTL ? 'مورد/عميل' : 'parties'}
                    </div>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Progress Bar */}
        {isMigrating && progress && (
          <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--color-ink)] truncate">
                {isRTL ? `جاري ترحيل: ${progress.currentOrgName}` : `Migrating: ${progress.currentOrgName}`}
              </span>
              <span className="font-mono text-[11px] text-[var(--color-accent)]">
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[var(--color-surface)] overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-200"
                style={{
                  width: `${
                    progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 15
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {doneCount !== null && (
          <div className="p-3 rounded-xl bg-[var(--color-income)]/12 border border-[var(--color-income)]/30 flex items-center gap-2 text-xs text-[var(--color-income)] font-semibold">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              {isRTL
                ? `تم ترحيل ${doneCount} مؤسسة إلى السحابة بنجاح!`
                : `Migrated ${doneCount} organization(s) to Cloud!`}
            </span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-[var(--color-expense)]/12 border border-[var(--color-expense)]/30 flex items-start gap-2 text-xs text-[var(--color-expense)]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-2 pt-1">
          <button
            type="button"
            disabled={isMigrating || !user?.isLoggedIn || selectedIds.length === 0}
            onClick={handleMigrate}
            className="w-full py-2.5 rounded-xl bg-[var(--color-accent)] disabled:opacity-45 text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-2 min-h-[44px]"
          >
            <CloudUpload className="w-4 h-4" />
            <span>
              {isMigrating
                ? isRTL
                  ? 'جاري الرفع والمزامنة...'
                  : 'Migrating to Cloud...'
                : isRTL
                ? 'تحميل نسخة أمان + بدء الترحيل السحابي'
                : 'Download Safety Backup + Migrate to Cloud'}
            </span>
          </button>

          {!isMigrating && (
            <button
              type="button"
              onClick={() => {
                downloadSafetyJson();
                dismissLegacyOrgMigration();
              }}
              className="w-full py-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)] flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <Download className="w-4 h-4" />
              <span>
                {isRTL ? 'تصدير JSON فقط وإخفاء الآن' : 'Export JSON Only & Dismiss'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
