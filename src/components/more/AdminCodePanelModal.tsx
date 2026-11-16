import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  Lock,
  ShieldCheck,
  Sparkles,
  Copy,
  Check,
  X,
  RefreshCw,
  Users,
  Search,
  Edit3,
  Ban,
  Crown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  AdminCouponCycle,
  AdminCouponTier,
  generateAdminLicenseCode,
  verifyAdminPassword,
} from '../../services/licenseCodes';
import {
  adminCancelUserSubscription,
  adminUpdateUserSubscription,
  CloudUserProfile,
  createCouponInFirestore,
  fetchAdminCouponsFromFirestore,
  fetchAllUsersForAdmin,
  FirestoreCouponRecord,
} from '../../services/firebase';
import { SUBSCRIPTION_DAY_MS } from '../../services/subscriptionHelpers';
import type { PlanTier } from '../../types';

type AdminTab = 'users' | 'coupons';
type AdminEditCycle = 'monthly' | 'yearly' | 'lifetime' | 'free';

function parseReadableError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : '';
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed?.error) return parsed.error;
  } catch {
    // Plain error text
  }
  return raw;
}

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
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  // Users & Subscriptions Management State
  const [usersList, setUsersList] = useState<CloudUserProfile[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersActionMsg, setUsersActionMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Inline Editor State
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editTier, setEditTier] = useState<PlanTier>('personal_pro');
  const [editCycle, setEditCycle] = useState<AdminEditCycle>('yearly');
  const [editCustomDays, setEditCustomDays] = useState<string>('');
  const [isSavingUserUid, setIsSavingUserUid] = useState<string | null>(null);

  // Coupon Generator State
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

  // Reset passcode gate & transient editor state every time modal closes
  useEffect(() => {
    if (!isAdminCodeModalOpen) {
      setIsUnlocked(false);
      setPasscodeInput('');
      setPasscodeError(null);
      setAdminCodeError(null);
      setAdminCodeSyncStatus('idle');
      setCopiedAdminCode(false);
      setEditingUid(null);
      setUsersError(null);
      setUsersActionMsg(null);
      setSearchQuery('');
    }
  }, [isAdminCodeModalOpen]);

  const loadAdminUsers = async () => {
    setIsLoadingUsers(true);
    setUsersError(null);
    try {
      const rows = await fetchAllUsersForAdmin(200);
      setUsersList(rows);
    } catch (err) {
      setUsersError(
        parseReadableError(
          err,
          isRTL ? 'تعذر تحميل قائمة الحسابات من Firestore.' : 'Failed to load accounts from Firestore.'
        )
      );
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const loadAdminCoupons = async () => {
    setIsLoadingCoupons(true);
    try {
      const records = await fetchAdminCouponsFromFirestore(25);
      setRecentCoupons(records);
    } finally {
      setIsLoadingCoupons(false);
    }
  };

  useEffect(() => {
    if (!isAdminCodeModalOpen || !isAuthorizedAdmin || !isUnlocked) return;
    void loadAdminUsers();
    void loadAdminCoupons();
  }, [isAdminCodeModalOpen, isAuthorizedAdmin, isUnlocked]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return usersList;
    return usersList.filter(
      (u) =>
        (u.email || '').toLowerCase().includes(q) ||
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.uid || '').toLowerCase().includes(q)
    );
  }, [usersList, searchQuery]);

  const stats = useMemo(() => {
    const total = usersList.length;
    const paid = usersList.filter((u) => u.isPro).length;
    const business = usersList.filter((u) => u.isPro && u.planTier === 'business_pro').length;
    return { total, paid, business, free: total - paid };
  }, [usersList]);

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

  const openInlineEditor = (u: CloudUserProfile) => {
    setEditingUid(u.uid);
    setUsersActionMsg(null);
    if (!u.isPro || u.planTier === 'free') {
      setEditTier('personal_pro');
      setEditCycle('yearly');
    } else {
      setEditTier(u.planTier === 'business_pro' ? 'business_pro' : 'personal_pro');
      setEditCycle(
        u.billingCycle === 'monthly' || u.billingCycle === 'yearly' || u.billingCycle === 'lifetime'
          ? u.billingCycle
          : 'lifetime'
      );
    }
    setEditCustomDays('');
  };

  const handleSaveUserSubscription = async (targetUid: string) => {
    setIsSavingUserUid(targetUid);
    setUsersActionMsg(null);
    try {
      const parsedDays = editCustomDays.trim() ? Number(editCustomDays.trim()) : null;
      const customDays =
        parsedDays !== null && Number.isFinite(parsedDays) && parsedDays > 0
          ? Math.round(parsedDays)
          : null;

      const updated = await adminUpdateUserSubscription({
        targetUid,
        planTier: editTier,
        billingCycle: editTier === 'free' ? 'free' : editCycle,
        customDays,
      });

      setUsersList((prev) =>
        prev.map((row) => (row.uid === targetUid ? { ...row, ...updated } : row))
      );
      setEditingUid(null);
      setUsersActionMsg({
        type: 'ok',
        text: isRTL
          ? 'تم تحديث اشتراك الحساب بنجاح في السحابة.'
          : 'User subscription updated successfully.',
      });
    } catch (err) {
      setUsersActionMsg({
        type: 'err',
        text: parseReadableError(
          err,
          isRTL ? 'تعذر تعديل اشتراك الحساب.' : 'Could not update subscription.'
        ),
      });
    } finally {
      setIsSavingUserUid(null);
    }
  };

  const handleCancelUserSubscription = async (targetUid: string) => {
    setIsSavingUserUid(targetUid);
    setUsersActionMsg(null);
    try {
      const updated = await adminCancelUserSubscription(targetUid);
      setUsersList((prev) =>
        prev.map((row) => (row.uid === targetUid ? { ...row, ...updated } : row))
      );
      if (editingUid === targetUid) setEditingUid(null);
      setUsersActionMsg({
        type: 'ok',
        text: isRTL
          ? 'تم إلغاء الاشتراك وإعادة الحساب للخطة المجانية.'
          : 'Subscription cancelled and reverted to Free.',
      });
    } catch (err) {
      setUsersActionMsg({
        type: 'err',
        text: parseReadableError(
          err,
          isRTL ? 'تعذر إلغاء الاشتراك.' : 'Could not cancel subscription.'
        ),
      });
    } finally {
      setIsSavingUserUid(null);
    }
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
        const updatedList = await fetchAdminCouponsFromFirestore(25);
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
      setAdminCodeError(
        parseReadableError(
          err,
          isRTL ? 'تعذر حفظ الكود في Firestore.' : 'Could not save coupon in Firestore.'
        )
      );
    }
  };

  const formatExpiry = (u: CloudUserProfile) => {
    if (!u.isPro || u.planTier === 'free') return isRTL ? 'مجاني' : 'Free';
    if (u.billingCycle === 'lifetime' || !u.expiresAt) {
      return isRTL ? 'مدى الحياة (دائم)' : 'Lifetime';
    }
    const daysLeft = Math.max(0, Math.ceil((u.expiresAt - Date.now()) / SUBSCRIPTION_DAY_MS));
    const dateStr = new Date(u.expiresAt).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    return isRTL ? `${dateStr} (${daysLeft} يوم)` : `${dateStr} (${daysLeft}d)`;
  };

  const formatTierBadge = (u: CloudUserProfile) => {
    if (!u.isPro || u.planTier === 'free') {
      return {
        label: isRTL ? 'مجاني' : 'Free',
        cls: 'bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-muted)]',
      };
    }
    if (u.planTier === 'business_pro') {
      return {
        label: isRTL ? 'أعمال Business' : 'Business PRO',
        cls: 'bg-amber-500/15 border border-amber-500/35 text-amber-700 dark:text-amber-300',
      };
    }
    return {
      label: isRTL ? 'أفراد PRO' : 'Personal PRO',
      cls: 'bg-[var(--color-income)]/15 border border-[var(--color-income)]/35 text-[var(--color-income)]',
    };
  };

  const formatCycleLabel = (cycle?: string) => {
    switch (cycle) {
      case 'monthly':
        return isRTL ? 'شهري' : 'Monthly';
      case 'yearly':
        return isRTL ? 'سنوي' : 'Yearly';
      case 'lifetime':
        return isRTL ? 'مدى الحياة' : 'Lifetime';
      case 'trial':
        return isRTL ? 'تجريبي' : 'Trial';
      default:
        return isRTL ? 'مجاني' : 'Free';
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/65 p-4"
      data-testid="admin-code-panel-modal"
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl text-[var(--color-ink)] shadow-2xl overflow-hidden animate-in fade-in duration-150"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--color-line)] bg-[var(--color-bg)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] flex items-center justify-center shrink-0">
              <Crown className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-title text-sm sm:text-base font-bold text-[var(--color-ink)] truncate">
                {isRTL ? 'لوحة إدارة الحسابات والاشتراكات' : 'Admin Accounts & Subscriptions'}
              </h2>
              <p className="text-[11px] text-[var(--color-muted)] truncate" dir="ltr">
                {user?.email}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsAdminCodeModalOpen(false)}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="w-9 h-9 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {!isUnlocked ? (
            <form onSubmit={handleUnlockSubmit} className="space-y-4 max-w-sm mx-auto py-3" data-testid="admin-passcode-gate">
              <div className="p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-center space-y-2">
                <div className="w-11 h-11 rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)] flex items-center justify-center mx-auto">
                  <Lock className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-[var(--color-ink)]">
                  {isRTL ? 'أدخل رمز المرور الإداري للمتابعة' : 'Enter Admin Passcode'}
                </h3>
                <p className="text-xs text-[var(--color-muted)]">
                  {isRTL
                    ? 'لأغراض الأمان، يرجى إدخال كلمة مرور لوحة إدارة الحسابات والاشتراكات.'
                    : 'Security gate required to manage accounts and license coupons.'}
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
            <div className="space-y-4">
              {/* Admin Navigation Tabs */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                <button
                  type="button"
                  data-testid="admin-tab-users"
                  onClick={() => setActiveTab('users')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors min-h-[40px] ${
                    activeTab === 'users'
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-sm'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span>{isRTL ? 'الحسابات والاشتراكات' : 'Accounts & Plans'}</span>
                </button>
                <button
                  type="button"
                  data-testid="admin-tab-coupons"
                  onClick={() => setActiveTab('coupons')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors min-h-[40px] ${
                    activeTab === 'coupons'
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-sm'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5 shrink-0" />
                  <span>{isRTL ? 'أكواد التفعيل' : 'License Coupons'}</span>
                </button>
              </div>

              {/* TAB 1: REGISTERED USERS & DIRECT SUBSCRIPTION MANAGEMENT */}
              {activeTab === 'users' && (
                <div className="space-y-3" data-testid="admin-users-panel">
                  {/* Stats Summary */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                      <div className="text-[10px] text-[var(--color-muted)]">
                        {isRTL ? 'إجمالي الحسابات' : 'Total Accounts'}
                      </div>
                      <div className="text-sm font-bold text-[var(--color-ink)] num-tabular">
                        {stats.total}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                      <div className="text-[10px] text-[var(--color-muted)]">
                        {isRTL ? 'مشتركون نشطون' : 'Active Paid'}
                      </div>
                      <div className="text-sm font-bold text-[var(--color-income)] num-tabular">
                        {stats.paid}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                      <div className="text-[10px] text-[var(--color-muted)]">
                        {isRTL ? 'أعمال Business' : 'Business PRO'}
                      </div>
                      <div className="text-sm font-bold text-amber-600 dark:text-amber-400 num-tabular">
                        {stats.business}
                      </div>
                    </div>
                  </div>

                  {/* Search & Refresh */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-[var(--color-muted)] absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        data-testid="admin-users-search-input"
                        placeholder={
                          isRTL ? 'ابحث بالبريد الإلكتروني أو الاسم...' : 'Search by email or name...'
                        }
                        className="w-full ps-8 pe-3 py-2 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[40px]"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isLoadingUsers}
                      onClick={() => void loadAdminUsers()}
                      data-testid="admin-refresh-users-btn"
                      className="px-3 py-2 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-xs font-semibold text-[var(--color-accent)] hover:border-[var(--color-accent)] flex items-center gap-1.5 min-h-[40px] shrink-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingUsers ? 'animate-spin' : ''}`} />
                      <span>{isRTL ? 'تحديث' : 'Refresh'}</span>
                    </button>
                  </div>

                  {usersActionMsg && (
                    <div
                      data-testid="admin-users-feedback"
                      className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                        usersActionMsg.type === 'ok'
                          ? 'bg-[var(--color-income)]/12 border-[var(--color-income)]/35 text-[var(--color-income)]'
                          : 'bg-[var(--color-expense)]/12 border-[var(--color-expense)]/35 text-[var(--color-expense)]'
                      }`}
                    >
                      {usersActionMsg.type === 'ok' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{usersActionMsg.text}</span>
                    </div>
                  )}

                  {usersError && (
                    <div className="p-3 rounded-xl bg-[var(--color-expense)]/12 border border-[var(--color-expense)]/30 text-xs text-[var(--color-expense)] space-y-2">
                      <p className="font-semibold">{usersError}</p>
                      <button
                        type="button"
                        onClick={() => void loadAdminUsers()}
                        className="px-3 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] text-[11px] font-bold"
                      >
                        {isRTL ? 'إعادة المحاولة' : 'Retry'}
                      </button>
                    </div>
                  )}

                  {isLoadingUsers && usersList.length === 0 ? (
                    <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-[var(--color-muted)]">
                      <Loader2 className="w-5 h-5 animate-spin text-[var(--color-accent)]" />
                      <span>{isRTL ? 'جاري تحميل قائمة الحسابات...' : 'Loading accounts...'}</span>
                    </div>
                  ) : filteredUsers.length === 0 ? (
                    <div className="p-6 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-center text-xs text-[var(--color-muted)]">
                      {isRTL
                        ? 'لا توجد حسابات مطابقة للبحث حالياً.'
                        : 'No matching accounts found.'}
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[48vh] overflow-y-auto pe-1">
                      {filteredUsers.map((account) => {
                        const badge = formatTierBadge(account);
                        const isEditing = editingUid === account.uid;
                        const isBusy = isSavingUserUid === account.uid;
                        const isSelfAdmin =
                          account.email?.trim().toLowerCase() === 'hapaypal2003@gmail.com';

                        return (
                          <div
                            key={account.uid}
                            data-testid={`admin-user-row-${account.uid}`}
                            className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2.5"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-bold text-[var(--color-ink)] truncate">
                                    {account.displayName || account.email?.split('@')[0] || account.uid}
                                  </span>
                                  {isSelfAdmin && (
                                    <span className="px-1.5 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] text-[10px] font-bold">
                                      {isRTL ? 'المدير' : 'Admin'}
                                    </span>
                                  )}
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${badge.cls}`}>
                                    {badge.label}
                                  </span>
                                  {account.isPro && (
                                    <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] text-[10px] font-semibold text-[var(--color-muted)]">
                                      {formatCycleLabel(account.billingCycle)}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-[var(--color-muted)] truncate mt-0.5" dir="ltr">
                                  {account.email || account.uid}
                                </div>
                                <div className="text-[10px] text-[var(--color-muted)] mt-1">
                                  {isRTL ? 'الانتهاء: ' : 'Expires: '}
                                  <span className="font-semibold text-[var(--color-ink)]">
                                    {formatExpiry(account)}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  data-testid={`admin-edit-user-${account.uid}`}
                                  onClick={() =>
                                    isEditing ? setEditingUid(null) : openInlineEditor(account)
                                  }
                                  className="px-2.5 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[11px] font-semibold text-[var(--color-ink)] flex items-center gap-1 min-h-[34px]"
                                >
                                  <Edit3 className="w-3 h-3 text-[var(--color-accent)]" />
                                  <span>{isEditing ? (isRTL ? 'إغلاق' : 'Close') : isRTL ? 'تعديل' : 'Edit'}</span>
                                </button>
                                {account.isPro && !isSelfAdmin && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    data-testid={`admin-cancel-user-${account.uid}`}
                                    onClick={() => void handleCancelUserSubscription(account.uid)}
                                    className="px-2.5 py-1.5 rounded-lg bg-[var(--color-expense)]/12 border border-[var(--color-expense)]/30 text-[11px] font-semibold text-[var(--color-expense)] hover:bg-[var(--color-expense)]/20 flex items-center gap-1 min-h-[34px] disabled:opacity-50"
                                  >
                                    {isBusy ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Ban className="w-3 h-3" />
                                    )}
                                    <span>{isRTL ? 'إلغاء الاشتراك' : 'Cancel'}</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {isEditing && (
                              <div
                                data-testid={`admin-edit-form-${account.uid}`}
                                className="p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-accent)]/35 space-y-2.5"
                              >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] font-semibold text-[var(--color-muted)] mb-1">
                                      {isRTL ? 'نوع الباقة' : 'Plan Tier'}
                                    </label>
                                    <select
                                      value={editTier}
                                      onChange={(e) => {
                                        const nextTier = e.target.value as PlanTier;
                                        setEditTier(nextTier);
                                        if (nextTier === 'free') {
                                          setEditCycle('free');
                                        } else if (editCycle === 'free') {
                                          setEditCycle('yearly');
                                        }
                                      }}
                                      className="w-full px-2.5 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] min-h-[38px]"
                                    >
                                      <option value="free">{isRTL ? 'مجاني (Free)' : 'Free'}</option>
                                      <option value="personal_pro">{isRTL ? 'أفراد Personal PRO' : 'Personal PRO'}</option>
                                      <option value="business_pro">{isRTL ? 'أعمال Business PRO' : 'Business PRO'}</option>
                                    </select>
                                  </div>

                                  {editTier !== 'free' && (
                                    <div>
                                      <label className="block text-[10px] font-semibold text-[var(--color-muted)] mb-1">
                                        {isRTL ? 'دورة الفوترة / المدة' : 'Billing Cycle'}
                                      </label>
                                      <select
                                        value={editCycle}
                                        onChange={(e) => setEditCycle(e.target.value as AdminEditCycle)}
                                        className="w-full px-2.5 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] min-h-[38px]"
                                      >
                                        <option value="monthly">{isRTL ? 'شهري (30 يوم)' : 'Monthly (30d)'}</option>
                                        <option value="yearly">{isRTL ? 'سنوي (365 يوم)' : 'Yearly (365d)'}</option>
                                        <option value="lifetime">{isRTL ? 'مدى الحياة (دائم)' : 'Lifetime'}</option>
                                      </select>
                                    </div>
                                  )}
                                </div>

                                {editTier !== 'free' && editCycle !== 'lifetime' && (
                                  <div>
                                    <label className="block text-[10px] font-semibold text-[var(--color-muted)] mb-1">
                                      {isRTL
                                        ? 'أيام مخصصة (اختياري — اتركه فارغاً للافتراضي)'
                                        : 'Custom Days (optional — blank for default)'}
                                    </label>
                                    <input
                                      type="number"
                                      min={1}
                                      max={3650}
                                      dir="ltr"
                                      value={editCustomDays}
                                      onChange={(e) => setEditCustomDays(e.target.value)}
                                      placeholder={editCycle === 'monthly' ? '30' : '365'}
                                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] min-h-[36px]"
                                    />
                                  </div>
                                )}

                                <div className="flex items-center justify-end gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => setEditingUid(null)}
                                    className="px-3 py-1.5 rounded-lg border border-[var(--color-line)] text-xs font-semibold text-[var(--color-muted)] min-h-[36px]"
                                  >
                                    {isRTL ? 'إلغاء' : 'Cancel'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    data-testid={`admin-save-user-${account.uid}`}
                                    onClick={() => void handleSaveUserSubscription(account.uid)}
                                    className="px-3.5 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center gap-1.5 min-h-[36px] disabled:opacity-60"
                                  >
                                    {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    <span>{isRTL ? 'حفظ الاشتراك' : 'Save Plan'}</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: COUPON GENERATOR */}
              {activeTab === 'coupons' && (
                <div className="space-y-4" data-testid="admin-coupon-panel">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-income)]">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>{isRTL ? 'توليد أكواد التفعيل (coupons)' : 'License Coupon Generator'}</span>
                    </span>
                    <button
                      type="button"
                      disabled={isLoadingCoupons}
                      onClick={() => void loadAdminCoupons()}
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
          )}
        </div>
      </div>
    </div>
  );
};
