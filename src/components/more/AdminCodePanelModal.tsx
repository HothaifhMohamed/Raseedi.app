import React, { useEffect, useState } from 'react';
import {
  KeyRound,
  Lock,
  ShieldCheck,
  Sparkles,
  Copy,
  Check,
  X,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  AdminCouponCycle,
  AdminCouponTier,
  generateAdminLicenseCode,
  verifyAdminPassword,
} from '../../services/licenseCodes';
import {
  createCouponInFirestore,
  fetchAdminCouponsFromFirestore,
  FirestoreCouponRecord,
} from '../../services/firebase';

export const AdminCodePanelModal: React.FC = () => {
  const {
    isAdminCodeModalOpen,
    setIsAdminCodeModalOpen,
    isAdminUser,
    user,
    isRTL,
  } = useApp();

  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [adminCouponTier, setAdminCouponTier] = useState<AdminCouponTier>('business');
  const [adminCouponCycle, setAdminCouponCycle] = useState<AdminCouponCycle>('yearly');
  const [generatedAdminCode, setGeneratedAdminCode] = useState<string | null>(null);
  const [adminCodeSyncStatus, setAdminCodeSyncStatus] = useState<
    'idle' | 'syncing' | 'cloud_synced' | 'error'
  >('idle');
  const [adminCodeError, setAdminCodeError] = useState<string | null>(null);
  const [recentCoupons, setRecentCoupons] = useState<FirestoreCouponRecord[]>([]);
  const [isLoadingCoupons, setIsLoadingCoupons] = useState(false);
  const [copiedAdminCode, setCopiedAdminCode] = useState(false);

  const isAuthorizedAdmin =
    isAdminUser && user?.email?.trim().toLowerCase() === 'hapaypal2003@gmail.com';

  // Reset passcode gate every time modal closes or re-opens
  useEffect(() => {
    if (!isAdminCodeModalOpen) {
      setIsUnlocked(false);
      setPasscodeInput('');
      setPasscodeError(null);
      setAdminCodeError(null);
      setAdminCodeSyncStatus('idle');
      setCopiedAdminCode(false);
    }
  }, [isAdminCodeModalOpen]);

  useEffect(() => {
    if (!isAdminCodeModalOpen || !isAuthorizedAdmin || !isUnlocked) return;
    let active = true;
    setIsLoadingCoupons(true);
    void fetchAdminCouponsFromFirestore(20)
      .then((records) => {
        if (active) setRecentCoupons(records);
      })
      .finally(() => {
        if (active) setIsLoadingCoupons(false);
      });
    return () => {
      active = false;
    };
  }, [isAdminCodeModalOpen, isAuthorizedAdmin, isUnlocked]);

  if (!isAdminCodeModalOpen || !isAuthorizedAdmin) return null;

  const handleUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyAdminPassword(passcodeInput)) {
      setPasscodeError(null);
      setPasscodeInput('');
      setIsUnlocked(true);
      return;
    }
    setPasscodeError(
      isRTL ? 'كلمة مرور الإدارة غير صحيحة.' : 'Incorrect admin passcode.'
    );
  };

  const handleGenerateAndSave = async () => {
    const code = generateAdminLicenseCode({
      tier: adminCouponTier,
      cycle: adminCouponCycle,
    });
    setGeneratedAdminCode(code);
    setCopiedAdminCode(false);
    setAdminCodeSyncStatus('syncing');
    setAdminCodeError(null);

    try {
      const res = await createCouponInFirestore({
        code,
        tier: adminCouponTier,
        cycle: adminCouponCycle,
        planTier: adminCouponTier === 'business' ? 'business_pro' : 'personal_pro',
      });
      if (res.saved) {
        setAdminCodeSyncStatus('cloud_synced');
        const updatedList = await fetchAdminCouponsFromFirestore(20);
        setRecentCoupons(updatedList);
      } else {
        setAdminCodeSyncStatus('error');
        setAdminCodeError(
          isRTL
            ? 'تعذر حفظ الكود في قاعدة البيانات. تحقق من تسجيل الدخول بحساب المدير.'
            : 'Failed to save coupon to Firestore.'
        );
      }
    } catch (err) {
      setAdminCodeSyncStatus('error');
      let msg = err instanceof Error ? err.message : '';
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        if (parsed?.error) msg = parsed.error;
      } catch {
        // Ignore JSON parse failure
      }
      setAdminCodeError(
        msg ||
          (isRTL
            ? 'تعذر حفظ الكود في Firestore.'
            : 'Could not save coupon in Firestore.')
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/65 p-4"
      data-testid="admin-code-panel-modal"
    >
      <div
        className="w-full max-w-md max-h-[90vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl text-[var(--color-ink)] shadow-2xl overflow-hidden animate-in fade-in duration-150"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--color-line)] bg-[var(--color-bg)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] flex items-center justify-center shrink-0">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-title text-sm sm:text-base font-bold text-[var(--color-ink)]">
                {isRTL ? 'لوحة الإدارة وتوليد الأكواد' : 'Admin Code Panel'}
              </h2>
              <p className="text-[11px] text-[var(--color-muted)]" dir="ltr">
                {user?.email}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsAdminCodeModalOpen(false)}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {!isUnlocked ? (
            <form onSubmit={handleUnlockSubmit} className="space-y-4" data-testid="admin-passcode-gate">
              <div className="p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-center space-y-2">
                <div className="w-11 h-11 rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)] flex items-center justify-center mx-auto">
                  <Lock className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-[var(--color-ink)]">
                  {isRTL ? 'أدخل رمز المرور الإداري للمتابعة' : 'Enter Admin Passcode'}
                </h3>
                <p className="text-xs text-[var(--color-muted)]">
                  {isRTL
                    ? 'لأغراض الأمان، يرجى إدخال كلمة مرور لوحة توليد أكواد التفعيل.'
                    : 'Security gate required before generating or viewing Firestore coupons.'}
                </p>
              </div>

              <div>
                <label
                  htmlFor="admin-passcode-field"
                  className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5"
                >
                  {isRTL ? 'كلمة المرور' : 'Passcode'}
                </label>
                <input
                  id="admin-passcode-field"
                  type="password"
                  autoFocus
                  required
                  dir="ltr"
                  value={passcodeInput}
                  onChange={(e) => {
                    setPasscodeInput(e.target.value);
                    setPasscodeError(null);
                  }}
                  placeholder="••••"
                  data-testid="admin-passcode-input"
                  className="w-full px-3 py-2.5 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-sm font-mono text-center tracking-widest text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                />
                {passcodeError && (
                  <p
                    data-testid="admin-passcode-error"
                    className="text-xs text-[var(--color-expense)] font-medium mt-1.5"
                  >
                    {passcodeError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                data-testid="admin-passcode-submit"
                className="w-full py-2.5 px-4 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px] hover:opacity-95 transition-opacity"
              >
                {isRTL ? 'فتح لوحة الإدارة' : 'Unlock Admin Panel'}
              </button>
            </form>
          ) : (
            <div className="space-y-4" data-testid="admin-coupon-panel">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-income)]">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>{isRTL ? 'توليد أكواد التفعيل (coupons)' : 'License Coupon Generator'}</span>
                </span>
                <button
                  type="button"
                  disabled={isLoadingCoupons}
                  onClick={() => {
                    setIsLoadingCoupons(true);
                    void fetchAdminCouponsFromFirestore(20)
                      .then((records) => setRecentCoupons(records))
                      .finally(() => setIsLoadingCoupons(false));
                  }}
                  className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingCoupons ? 'animate-spin' : ''}`} />
                  <span>{isRTL ? 'تحديث السجل' : 'Refresh'}</span>
                </button>
              </div>

              {/* Tier Selection */}
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-[var(--color-muted)]">
                  {isRTL ? 'نوع الباقة' : 'Plan Tier'}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdminCouponTier('pro')}
                    data-testid="admin-tier-pro"
                    className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition-colors min-h-[42px] ${
                      adminCouponTier === 'pro'
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                        : 'bg-[var(--color-bg)] text-[var(--color-ink)] border-[var(--color-line)]'
                    }`}
                  >
                    {isRTL ? 'أفراد PRO' : 'Personal PRO'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminCouponTier('business')}
                    data-testid="admin-tier-business"
                    className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition-colors min-h-[42px] ${
                      adminCouponTier === 'business'
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                        : 'bg-[var(--color-bg)] text-[var(--color-ink)] border-[var(--color-line)]'
                    }`}
                  >
                    {isRTL ? 'أعمال Business' : 'Business PRO'}
                  </button>
                </div>
              </div>

              {/* Cycle Selection */}
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-[var(--color-muted)]">
                  {isRTL ? 'مدة التفعيل' : 'Activation Duration'}
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'monthly', ar: 'شهر', en: '1 Month' },
                      { id: 'yearly', ar: 'سنة', en: '1 Year' },
                      { id: 'lifetime', ar: 'مدى الحياة', en: 'Lifetime' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setAdminCouponCycle(opt.id)}
                      data-testid={`admin-cycle-${opt.id}`}
                      className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-colors min-h-[40px] ${
                        adminCouponCycle === opt.id
                          ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                          : 'bg-[var(--color-bg)] text-[var(--color-ink)] border-[var(--color-line)]'
                      }`}
                    >
                      {isRTL ? opt.ar : opt.en}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={adminCodeSyncStatus === 'syncing'}
                onClick={() => void handleGenerateAndSave()}
                data-testid="admin-generate-code-btn"
                className="w-full py-2.5 px-4 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-bold rounded-xl text-xs flex items-center justify-center gap-2 hover:opacity-95 transition-opacity min-h-[44px] disabled:opacity-60"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {adminCodeSyncStatus === 'syncing'
                    ? isRTL
                      ? 'جاري التوليد والحفظ في Firestore...'
                      : 'Generating & Saving...'
                    : isRTL
                    ? 'توليد وحفظ كود تفعيل جديد'
                    : 'Generate & Save Coupon'}
                </span>
              </button>

              {adminCodeError && (
                <p className="text-xs text-[var(--color-expense)] font-medium">
                  {adminCodeError}
                </p>
              )}

              {generatedAdminCode && (
                <div className="p-3 bg-[var(--color-bg)] border border-[var(--color-accent)]/40 rounded-xl space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <code
                      dir="ltr"
                      data-testid="admin-generated-code"
                      className="text-xs font-mono font-bold text-[var(--color-ink)] select-all break-all"
                    >
                      {generatedAdminCode}
                    </code>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard?.writeText(generatedAdminCode);
                        } catch {
                          // Ignore clipboard errors
                        }
                        setCopiedAdminCode(true);
                        window.setTimeout(() => setCopiedAdminCode(false), 2500);
                      }}
                      data-testid="admin-copy-code-btn"
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] flex items-center gap-1 shrink-0 min-h-[34px]"
                    >
                      {copiedAdminCode ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[var(--color-income)]" />
                          <span>{isRTL ? 'تم النسخ' : 'Copied'}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                          <span>{isRTL ? 'نسخ' : 'Copy'}</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--color-muted)]">
                    {adminCodeSyncStatus === 'cloud_synced'
                      ? isRTL
                        ? 'تم حفظ الكود في مجموعة coupons بحالة: غير مستخدم.'
                        : 'Saved to Firestore coupons collection (Status: Unused).'
                      : isRTL
                      ? 'الكود جاهز للنسخ والمشاركة.'
                      : 'Code ready to copy.'}
                  </p>
                </div>
              )}

              {recentCoupons.length > 0 && (
                <div className="pt-2 border-t border-[var(--color-line)] space-y-2">
                  <div className="text-xs font-semibold text-[var(--color-muted)]">
                    {isRTL ? 'الأكواد المحفوظة في coupons' : 'Saved Coupons in Firestore'}
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {recentCoupons.map((rec) => (
                      <div
                        key={rec.code}
                        className="px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between gap-2 text-[11px]"
                      >
                        <div className="min-w-0">
                          <code className="block font-mono font-bold text-[var(--color-ink)] truncate" dir="ltr">
                            {rec.code}
                          </code>
                          <span className="text-[10px] text-[var(--color-muted)]">
                            {rec.tier === 'business' ? 'Business' : 'PRO'} •{' '}
                            {rec.cycle === 'monthly'
                              ? isRTL
                                ? 'شهر'
                                : 'Month'
                              : rec.cycle === 'yearly'
                              ? isRTL
                                ? 'سنة'
                                : 'Year'
                              : isRTL
                              ? 'مدى الحياة'
                              : 'Lifetime'}
                          </span>
                        </div>
                        <span
                          className={`shrink-0 font-semibold ${
                            rec.used ? 'text-[var(--color-muted)]' : 'text-[var(--color-income)]'
                          }`}
                        >
                          {rec.used
                            ? isRTL
                              ? 'مُستخدم'
                              : 'Used'
                            : isRTL
                            ? 'غير مستخدم'
                            : 'Unused'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
