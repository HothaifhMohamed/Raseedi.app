import React, { useEffect, useMemo, useState } from 'react';
import {
  Lock,
  ShieldCheck,
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
  Settings,
  Building2,
  Calendar,
  Clock,
  Plus,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PRIMARY_SYSTEM_ADMIN_EMAIL } from '../../services/licenseCodes';
import {
  adminCancelOrganizationSubscription,
  adminCancelUserSubscription,
  adminUpdateOrganizationSubscription,
  adminUpdateUserSubscription,
  auth,
  changeAdminPinOnServer,
  CloudAdminOrganizationSummary,
  CloudUserProfile,
  fetchAdminStatusFromServer,
  fetchAllOrganizationsForAdmin,
  fetchAllUsersForAdmin,
  resetAdminPinAfterGoogleReauth,
  resolveFirebaseUserEmail,
  ServerApiError,
  setupAdminPinOnServer,
  verifyAdminPasscodeOnServer,
} from '../../services/firebase';
import {
  canUserAccessAdminPanelUi,
  clearVerifiedAdminSession,
  isAdminSessionExpired,
  loadVerifiedAdminSession,
  normalizeAdminSessionExpiry,
  parseAdminExpiryDateInput,
  saveVerifiedAdminSession,
} from '../../services/adminAuth';
import { SUBSCRIPTION_DAY_MS } from '../../services/subscriptionHelpers';
import type { PlanTier } from '../../types';

type AdminTab = 'users' | 'orgs' | 'security';
type AdminEditCycle = 'monthly' | 'yearly' | 'lifetime' | 'free';
type DurationInputMode = 'days' | 'date';

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

function formatDateForInput(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const [setupConfirmPin, setSetupConfirmPin] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [isVerifyingPasscode, setIsVerifyingPasscode] = useState(false);
  const [isCheckingPinStatus, setIsCheckingPinStatus] = useState(false);
  const [pinConfigured, setPinConfigured] = useState<boolean>(true);
  const [pinSource, setPinSource] = useState<'firestore' | 'env' | 'unset'>('unset');
  const [pinUpdatedAtMs, setPinUpdatedAtMs] = useState<number | null>(null);
  const [adminSessionToken, setAdminSessionToken] = useState<string | null>(null);
  const [adminSessionExpiresAt, setAdminSessionExpiresAt] = useState<number | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  // Change PIN State (Security Tab)
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmNewPinInput, setConfirmNewPinInput] = useState('');
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [pinChangeFeedback, setPinChangeFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Users & Subscriptions Management State
  const [usersList, setUsersList] = useState<CloudUserProfile[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersActionMsg, setUsersActionMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Inline User Editor State
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editTier, setEditTier] = useState<PlanTier>('personal_pro');
  const [editCycle, setEditCycle] = useState<AdminEditCycle>('yearly');
  const [editDurationMode, setEditDurationMode] = useState<DurationInputMode>('days');
  const [editCustomDays, setEditCustomDays] = useState<string>('');
  const [editExpiryDate, setEditExpiryDate] = useState<string>('');
  const [isSavingUserUid, setIsSavingUserUid] = useState<string | null>(null);

  // Organizations & Subscriptions Management State
  const [orgsList, setOrgsList] = useState<CloudAdminOrganizationSummary[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [orgsActionMsg, setOrgsActionMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [orgSearchQuery, setOrgSearchQuery] = useState('');

  // Inline Org Editor State
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [editOrgTier, setEditOrgTier] = useState<PlanTier>('business_pro');
  const [editOrgCycle, setEditOrgCycle] = useState<AdminEditCycle>('yearly');
  const [editOrgDurationMode, setEditOrgDurationMode] = useState<DurationInputMode>('days');
  const [editOrgCustomDays, setEditOrgCustomDays] = useState<string>('');
  const [editOrgExpiryDate, setEditOrgExpiryDate] = useState<string>('');
  const [isSavingOrgId, setIsSavingOrgId] = useState<string | null>(null);

  const [needsReauthPinUpgrade, setNeedsReauthPinUpgrade] = useState(false);
  const [reauthNewPin, setReauthNewPin] = useState('');
  const [reauthConfirmPin, setReauthConfirmPin] = useState('');
  const [isReauthingPin, setIsReauthingPin] = useState(false);

  const isAuthorizedAdmin = canUserAccessAdminPanelUi({
    isAdminUser,
    authUser: auth.currentUser
      ? {
          uid: auth.currentUser.uid,
          email: resolveFirebaseUserEmail(auth.currentUser),
          emailVerified: auth.currentUser.emailVerified,
          providerData: auth.currentUser.providerData,
        }
      : null,
    appUser: user,
  });

  const currentAdminUid = auth.currentUser?.uid || (user?.isLoggedIn ? user.id : '') || '';

  // Clear admin session immediately if the user signs out or switches away from primary admin
  useEffect(() => {
    if (!isAuthorizedAdmin || !currentAdminUid) {
      clearVerifiedAdminSession();
      setIsUnlocked(false);
      setAdminSessionToken(null);
      setAdminSessionExpiresAt(null);
    }
  }, [isAuthorizedAdmin, currentAdminUid]);

  // Restore active verified session when modal opens; reset only transient form/error state on close
  useEffect(() => {
    if (!isAdminCodeModalOpen) {
      setPasscodeInput('');
      setSetupConfirmPin('');
      setPasscodeError(null);
      setIsVerifyingPasscode(false);
      setIsCheckingPinStatus(false);
      setNeedsReauthPinUpgrade(false);
      setReauthNewPin('');
      setReauthConfirmPin('');
      setIsReauthingPin(false);
      setCurrentPinInput('');
      setNewPinInput('');
      setConfirmNewPinInput('');
      setIsChangingPin(false);
      setPinChangeFeedback(null);
      setEditingUid(null);
      setUsersError(null);
      setUsersActionMsg(null);
      setSearchQuery('');
      setEditingOrgId(null);
      setOrgsError(null);
      setOrgsActionMsg(null);
      setOrgSearchQuery('');
      return;
    }

    if (!isAuthorizedAdmin) return;

    const existingSession = loadVerifiedAdminSession(currentAdminUid);
    if (existingSession) {
      setAdminSessionToken(existingSession.token);
      setAdminSessionExpiresAt(existingSession.expiresAt);
      setPinConfigured(true);
      setPinSource(existingSession.pinSource);
      setPinUpdatedAtMs(existingSession.pinUpdatedAtMs);
      setIsUnlocked(true);
      setIsCheckingPinStatus(false);
      return;
    }

    setIsUnlocked(false);
    setAdminSessionToken(null);
    setAdminSessionExpiresAt(null);

    let active = true;
    setIsCheckingPinStatus(true);
    fetchAdminStatusFromServer()
      .then((status) => {
        if (!active) return;
        setPinConfigured(status.pinConfigured);
        setPinSource(status.pinSource);
        setPinUpdatedAtMs(status.pinUpdatedAtMs);
      })
      .catch(() => {
        // Keep default state on network error
      })
      .finally(() => {
        if (active) setIsCheckingPinStatus(false);
      });

    return () => {
      active = false;
    };
  }, [isAdminCodeModalOpen, isAuthorizedAdmin, currentAdminUid]);

  const handleLockAdminPanel = () => {
    clearVerifiedAdminSession();
    setIsUnlocked(false);
    setAdminSessionToken(null);
    setAdminSessionExpiresAt(null);
    setPasscodeInput('');
    setPasscodeError(null);
  };

  const handleSessionExpiry = (err: unknown): boolean => {
    const isGenuineExpiry =
      (err instanceof ServerApiError && err.code === 'ADMIN_SESSION_EXPIRED') ||
      (err instanceof ServerApiError &&
        err.code === 'ADMIN_SESSION_REQUIRED' &&
        isAdminSessionExpired(adminSessionExpiresAt));

    if (isGenuineExpiry) {
      clearVerifiedAdminSession();
      setIsUnlocked(false);
      setAdminSessionToken(null);
      setAdminSessionExpiresAt(null);
      setPasscodeError(
        isRTL
          ? 'انتهت جلسة الإدارة، يرجى إعادة إدخال رمز المرور.'
          : 'Admin session expired. Please re-enter passcode.'
      );
      return true;
    }
    return false;
  };

  const loadAdminUsers = async (tokenOverride?: string) => {
    const token = tokenOverride || adminSessionToken;
    if (!token) return;
    setIsLoadingUsers(true);
    setUsersError(null);
    try {
      const rows = await fetchAllUsersForAdmin(token);
      setUsersList(rows);
    } catch (err) {
      if (handleSessionExpiry(err)) return;
      setUsersError(
        parseReadableError(
          err,
          isRTL ? 'تعذر تحميل قائمة الحسابات من الخادم.' : 'Failed to load accounts from server.'
        )
      );
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const loadAdminOrganizations = async (tokenOverride?: string) => {
    const token = tokenOverride || adminSessionToken;
    if (!token) return;
    setIsLoadingOrgs(true);
    setOrgsError(null);
    try {
      const rows = await fetchAllOrganizationsForAdmin(token);
      setOrgsList(rows);
    } catch (err) {
      if (handleSessionExpiry(err)) return;
      setOrgsError(
        parseReadableError(
          err,
          isRTL
            ? 'تعذر تحميل قائمة المؤسسات من الخادم.'
            : 'Failed to load organizations from server.'
        )
      );
    } finally {
      setIsLoadingOrgs(false);
    }
  };

  useEffect(() => {
    if (!isAdminCodeModalOpen || !isAuthorizedAdmin || !isUnlocked || !adminSessionToken) return;
    void loadAdminUsers(adminSessionToken);
    void loadAdminOrganizations(adminSessionToken);
  }, [isAdminCodeModalOpen, isAuthorizedAdmin, isUnlocked, adminSessionToken]);

  const userEmailByUid = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of usersList) {
      if (u.uid && u.email) {
        map.set(u.uid, u.email);
      }
    }
    return map;
  }, [usersList]);

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

  const filteredOrgs = useMemo(() => {
    const q = orgSearchQuery.trim().toLowerCase();
    if (!q) return orgsList;
    return orgsList.filter((o) => {
      const ownerEmail = userEmailByUid.get(o.ownerId) || '';
      return (
        (o.name || '').toLowerCase().includes(q) ||
        (o.id || '').toLowerCase().includes(q) ||
        (o.ownerId || '').toLowerCase().includes(q) ||
        ownerEmail.toLowerCase().includes(q)
      );
    });
  }, [orgsList, orgSearchQuery, userEmailByUid]);

  const stats = useMemo(() => {
    const total = usersList.length;
    const paid = usersList.filter((u) => u.isPro).length;
    const business = usersList.filter((u) => u.isPro && u.planTier === 'business_pro').length;
    return { total, paid, business, free: total - paid };
  }, [usersList]);

  const orgStats = useMemo(() => {
    const total = orgsList.length;
    const activeBusiness = orgsList.filter(
      (o) => o.planTier === 'business_pro' && !o.isReadOnly
    ).length;
    const inactive = total - activeBusiness;
    return { total, activeBusiness, inactive };
  }, [orgsList]);

  if (!isAdminCodeModalOpen || !isAuthorizedAdmin) return null;

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = passcodeInput.trim();
    if (!cleanPin || isVerifyingPasscode) return;

    if (!pinConfigured) {
      if (cleanPin.length < 4 || cleanPin.length > 32) {
        setPasscodeError(
          isRTL
            ? 'يجب أن يتكون الرمز السري من 4 إلى 32 حرفاً أو رقماً.'
            : 'Admin PIN must be between 4 and 32 characters.'
        );
        return;
      }
      if (cleanPin !== setupConfirmPin.trim()) {
        setPasscodeError(
          isRTL ? 'تأكيد الرمز السري غير متطابق.' : 'PIN confirmation does not match.'
        );
        return;
      }

      setIsVerifyingPasscode(true);
      setPasscodeError(null);
      try {
        const res = await setupAdminPinOnServer(cleanPin);
        const normalizedExp = normalizeAdminSessionExpiry(res.expiresAt);
        if (currentAdminUid) {
          saveVerifiedAdminSession({
            uid: currentAdminUid,
            token: res.adminSessionToken,
            expiresAt: normalizedExp,
            pinSource: 'firestore',
            pinUpdatedAtMs: res.pinUpdatedAtMs,
          });
        }
        setAdminSessionToken(res.adminSessionToken);
        setAdminSessionExpiresAt(normalizedExp);
        setPinConfigured(true);
        setPinSource('firestore');
        setPinUpdatedAtMs(res.pinUpdatedAtMs);
        setPasscodeInput('');
        setSetupConfirmPin('');
        setIsUnlocked(true);
      } catch (err) {
        if (err instanceof ServerApiError && err.code === 'PIN_ALREADY_CONFIGURED') {
          setPinConfigured(true);
          setPasscodeError(
            isRTL
              ? 'الرمز السري مضبوط مسبقاً. يرجى إدخاله لفتح لوحة الإدارة.'
              : 'Admin PIN is already configured. Please enter it to unlock.'
          );
        } else {
          setPasscodeError(
            parseReadableError(
              err,
              isRTL ? 'تعذر حفظ الرمز السري حالياً.' : 'Failed to configure admin PIN.'
            )
          );
        }
      } finally {
        setIsVerifyingPasscode(false);
      }
      return;
    }

    setIsVerifyingPasscode(true);
    setPasscodeError(null);
    try {
      const res = await verifyAdminPasscodeOnServer(cleanPin);
      const normalizedExp = normalizeAdminSessionExpiry(res.expiresAt);
      if (currentAdminUid) {
        saveVerifiedAdminSession({
          uid: currentAdminUid,
          token: res.adminSessionToken,
          expiresAt: normalizedExp,
          pinSource: res.pinSource,
          pinUpdatedAtMs: res.pinUpdatedAtMs,
        });
      }
      setAdminSessionToken(res.adminSessionToken);
      setAdminSessionExpiresAt(normalizedExp);
      setPinSource(res.pinSource);
      setPinUpdatedAtMs(res.pinUpdatedAtMs);
      setPasscodeInput('');
      setIsUnlocked(true);
    } catch (err) {
      if (
        err instanceof ServerApiError &&
        (err.code === 'ADMIN_PIN_NOT_SET' || err.code === 'ADMIN_PASSCODE_NOT_CONFIGURED')
      ) {
        setPinConfigured(false);
        setPinSource('unset');
        setPasscodeError(
          isRTL
            ? 'لم يتم تعيين رمز سري بعد — قم بتعيين رمزك السري الجديد الآن.'
            : 'No Admin PIN configured yet — please create your new PIN now.'
        );
      } else if (err instanceof ServerApiError && err.code === 'ADMIN_PIN_NEEDS_REAUTH_RESET') {
        setNeedsReauthPinUpgrade(true);
        setPasscodeError(
          isRTL
            ? 'تم حفظ الرمز السري سابقاً بصيغة الخادم فقط (scrypt). أكد هويتك عبر Google لتعيين رمز متوافق مع Vercel والخادم معاً.'
            : 'Your previous PIN used a server-only hash format. Re-verify with Google below to set a cross-compatible PIN.'
        );
      } else {
        setPasscodeError(
          parseReadableError(
            err,
            isRTL ? 'الرمز السري للوحة الإدارة غير صحيح.' : 'Incorrect admin passcode.'
          )
        );
      }
    } finally {
      setIsVerifyingPasscode(false);
    }
  };

  const handleGoogleReauthPinReset = async () => {
    const cleanPin = reauthNewPin.trim();
    if (cleanPin.length < 4 || cleanPin.length > 32) {
      setPasscodeError(
        isRTL
          ? 'يجب أن يتكون الرمز السري الجديد من 4 إلى 32 حرفاً أو رقماً.'
          : 'New Admin PIN must be between 4 and 32 characters.'
      );
      return;
    }
    if (cleanPin !== reauthConfirmPin.trim()) {
      setPasscodeError(
        isRTL ? 'تأكيد الرمز السري غير متطابق.' : 'PIN confirmation does not match.'
      );
      return;
    }
    setIsReauthingPin(true);
    setPasscodeError(null);
    try {
      const res = await resetAdminPinAfterGoogleReauth(cleanPin);
      const normalizedExp = normalizeAdminSessionExpiry(res.expiresAt);
      if (currentAdminUid) {
        saveVerifiedAdminSession({
          uid: currentAdminUid,
          token: res.adminSessionToken,
          expiresAt: normalizedExp,
          pinSource: 'firestore',
          pinUpdatedAtMs: res.pinUpdatedAtMs,
        });
      }
      setAdminSessionToken(res.adminSessionToken);
      setAdminSessionExpiresAt(normalizedExp);
      setPinConfigured(true);
      setPinSource('firestore');
      setPinUpdatedAtMs(res.pinUpdatedAtMs);
      setNeedsReauthPinUpgrade(false);
      setReauthNewPin('');
      setReauthConfirmPin('');
      setPasscodeInput('');
      setIsUnlocked(true);
    } catch (err) {
      setPasscodeError(
        parseReadableError(
          err,
          isRTL
            ? 'تعذر تأكيد الهوية عبر Google وتحديث الرمز السري.'
            : 'Could not re-authenticate with Google and update Admin PIN.'
        )
      );
    } finally {
      setIsReauthingPin(false);
    }
  };

  const handleChangeAdminPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminSessionToken || isChangingPin) return;
    const cleanCurrent = currentPinInput.trim();
    const cleanNext = newPinInput.trim();
    const cleanConfirm = confirmNewPinInput.trim();

    if (!cleanCurrent) {
      setPinChangeFeedback({
        type: 'err',
        text: isRTL ? 'يرجى إدخال الرمز السري الحالي.' : 'Please enter your current PIN.',
      });
      return;
    }
    if (cleanNext.length < 4 || cleanNext.length > 32) {
      setPinChangeFeedback({
        type: 'err',
        text: isRTL
          ? 'يجب أن يتكون الرمز السري الجديد من 4 إلى 32 حرفاً أو رقماً.'
          : 'New PIN must be 4 to 32 characters.',
      });
      return;
    }
    if (cleanNext !== cleanConfirm) {
      setPinChangeFeedback({
        type: 'err',
        text: isRTL ? 'الرمز السري الجديد وتأكيده غير متطابقين.' : 'New PIN and confirmation do not match.',
      });
      return;
    }
    if (cleanNext === cleanCurrent) {
      setPinChangeFeedback({
        type: 'err',
        text: isRTL ? 'يجب أن يختلف الرمز الجديد عن الرمز الحالي.' : 'New PIN must differ from the current PIN.',
      });
      return;
    }

    setIsChangingPin(true);
    setPinChangeFeedback(null);
    try {
      const updated = await changeAdminPinOnServer({
        currentPin: cleanCurrent,
        newPin: cleanNext,
        adminSessionToken,
      });
      const normalizedExp = normalizeAdminSessionExpiry(updated.expiresAt);
      if (currentAdminUid) {
        saveVerifiedAdminSession({
          uid: currentAdminUid,
          token: updated.adminSessionToken,
          expiresAt: normalizedExp,
          pinSource: 'firestore',
          pinUpdatedAtMs: updated.updatedAtMs,
        });
      }
      setAdminSessionToken(updated.adminSessionToken);
      setAdminSessionExpiresAt(normalizedExp);
      setPinSource('firestore');
      setPinConfigured(true);
      setPinUpdatedAtMs(updated.updatedAtMs);
      setCurrentPinInput('');
      setNewPinInput('');
      setConfirmNewPinInput('');
      setPinChangeFeedback({
        type: 'ok',
        text: isRTL
          ? 'تم تحديث الرمز السري وحفظه مشفراً في السحابة بنجاح.'
          : 'Admin PIN updated and securely stored in the cloud.',
      });
    } catch (err) {
      if (handleSessionExpiry(err)) return;
      setPinChangeFeedback({
        type: 'err',
        text: parseReadableError(
          err,
          isRTL ? 'تعذر تغيير الرمز السري. تحقق من الرمز الحالي.' : 'Failed to update admin PIN.'
        ),
      });
    } finally {
      setIsChangingPin(false);
    }
  };

  // --- User Subscription Direct Management ---
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
    setEditDurationMode('days');
    setEditCustomDays('');
    setEditExpiryDate(formatDateForInput(u.expiresAt));
  };

  const handleSaveUserSubscription = async (account: CloudUserProfile) => {
    if (!adminSessionToken) return;
    setIsSavingUserUid(account.uid);
    setUsersActionMsg(null);
    try {
      let customDays: number | null = null;
      let customExpiresAt: number | null = null;

      if (editTier !== 'free' && editCycle !== 'lifetime') {
        if (editDurationMode === 'date' && editExpiryDate.trim()) {
          const parsedDateMs = parseAdminExpiryDateInput(editExpiryDate.trim());
          if (!parsedDateMs || parsedDateMs <= Date.now()) {
            setUsersActionMsg({
              type: 'err',
              text: isRTL
                ? 'يرجى اختيار تاريخ انتهاء مستقبلي صحيح.'
                : 'Please pick a valid future expiry date.',
            });
            setIsSavingUserUid(null);
            return;
          }
          customExpiresAt = parsedDateMs;
        } else if (editDurationMode === 'days' && editCustomDays.trim()) {
          const parsedDays = Number(editCustomDays.trim());
          if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
            setUsersActionMsg({
              type: 'err',
              text: isRTL ? 'يرجى إدخال عدد أيام صحيح.' : 'Please enter a valid number of days.',
            });
            setIsSavingUserUid(null);
            return;
          }
          customDays = Math.round(parsedDays);
        }
      }

      const updated = await adminUpdateUserSubscription({
        targetUid: account.uid,
        planTier: editTier,
        billingCycle: editTier === 'free' ? 'free' : editCycle,
        customDays,
        customExpiresAt,
        adminSessionToken,
      });

      setUsersList((prev) =>
        prev.map((row) => (row.uid === account.uid ? { ...row, ...updated } : row))
      );
      setEditingUid(null);
      setUsersActionMsg({
        type: 'ok',
        text: isRTL
          ? 'تم تحديث وتفعيل اشتراك الحساب مباشرة في Firestore بنجاح.'
          : 'Account subscription updated and synced to Firestore.',
      });
    } catch (err) {
      if (handleSessionExpiry(err)) return;
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

  const handleQuickExtendUser = async (account: CloudUserProfile, extendDays: number) => {
    if (!adminSessionToken) return;
    setIsSavingUserUid(account.uid);
    setUsersActionMsg(null);
    try {
      const targetTier: PlanTier =
        account.planTier === 'business_pro' ? 'business_pro' : 'personal_pro';
      const targetCycle: 'monthly' | 'yearly' =
        extendDays >= 365 || account.billingCycle === 'yearly' ? 'yearly' : 'monthly';
      const updated = await adminUpdateUserSubscription({
        targetUid: account.uid,
        planTier: targetTier,
        billingCycle: targetCycle,
        extendDays,
        existingExpiresAt: account.expiresAt ?? null,
        adminSessionToken,
      });
      setUsersList((prev) =>
        prev.map((row) => (row.uid === account.uid ? { ...row, ...updated } : row))
      );
      setUsersActionMsg({
        type: 'ok',
        text: isRTL
          ? `تم تمديد اشتراك الحساب (+${extendDays} يوم) ومزامنته فوراً في السحابة.`
          : `Extended subscription by +${extendDays} days and synced to Firestore.`,
      });
    } catch (err) {
      if (handleSessionExpiry(err)) return;
      setUsersActionMsg({
        type: 'err',
        text: parseReadableError(
          err,
          isRTL ? 'تعذر تمديد الاشتراك.' : 'Could not extend subscription.'
        ),
      });
    } finally {
      setIsSavingUserUid(null);
    }
  };

  const handleCancelUserSubscription = async (targetUid: string) => {
    if (!adminSessionToken) return;
    setIsSavingUserUid(targetUid);
    setUsersActionMsg(null);
    try {
      const updated = await adminCancelUserSubscription(targetUid, adminSessionToken);
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
      if (handleSessionExpiry(err)) return;
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

  // --- Organization Subscription Direct Management ---
  const openInlineOrgEditor = (org: CloudAdminOrganizationSummary) => {
    setEditingOrgId(org.id);
    setOrgsActionMsg(null);
    if (org.planTier === 'free') {
      setEditOrgTier('business_pro');
      setEditOrgCycle('yearly');
    } else {
      setEditOrgTier('business_pro');
      setEditOrgCycle(
        org.billingCycle === 'monthly' ||
          org.billingCycle === 'yearly' ||
          org.billingCycle === 'lifetime'
          ? org.billingCycle
          : 'yearly'
      );
    }
    setEditOrgDurationMode('days');
    setEditOrgCustomDays('');
    setEditOrgExpiryDate(formatDateForInput(org.expiresAt));
  };

  const handleSaveOrgSubscription = async (org: CloudAdminOrganizationSummary) => {
    if (!adminSessionToken) return;
    setIsSavingOrgId(org.id);
    setOrgsActionMsg(null);
    try {
      let customDays: number | null = null;
      let customExpiresAt: number | null = null;

      if (editOrgTier !== 'free' && editOrgCycle !== 'lifetime') {
        if (editOrgDurationMode === 'date' && editOrgExpiryDate.trim()) {
          const parsedDateMs = parseAdminExpiryDateInput(editOrgExpiryDate.trim());
          if (!parsedDateMs || parsedDateMs <= Date.now()) {
            setOrgsActionMsg({
              type: 'err',
              text: isRTL
                ? 'يرجى اختيار تاريخ انتهاء مستقبلي صحيح للمؤسسة.'
                : 'Please pick a valid future expiry date for the organization.',
            });
            setIsSavingOrgId(null);
            return;
          }
          customExpiresAt = parsedDateMs;
        } else if (editOrgDurationMode === 'days' && editOrgCustomDays.trim()) {
          const parsedDays = Number(editOrgCustomDays.trim());
          if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
            setOrgsActionMsg({
              type: 'err',
              text: isRTL ? 'يرجى إدخال عدد أيام صحيح.' : 'Please enter a valid number of days.',
            });
            setIsSavingOrgId(null);
            return;
          }
          customDays = Math.round(parsedDays);
        }
      }

      const updated = await adminUpdateOrganizationSubscription({
        orgId: org.id,
        planTier: editOrgTier,
        billingCycle: editOrgTier === 'free' ? 'free' : editOrgCycle,
        customDays,
        customExpiresAt,
        adminSessionToken,
      });

      setOrgsList((prev) => prev.map((row) => (row.id === org.id ? { ...row, ...updated } : row)));
      setEditingOrgId(null);
      setOrgsActionMsg({
        type: 'ok',
        text: isRTL
          ? 'تم تحديث اشتراك المؤسسة ومزامنته فوراً في Firestore.'
          : 'Organization subscription updated and synced to Firestore.',
      });
    } catch (err) {
      if (handleSessionExpiry(err)) return;
      setOrgsActionMsg({
        type: 'err',
        text: parseReadableError(
          err,
          isRTL ? 'تعذر تعديل اشتراك المؤسسة.' : 'Could not update organization subscription.'
        ),
      });
    } finally {
      setIsSavingOrgId(null);
    }
  };

  const handleQuickExtendOrg = async (org: CloudAdminOrganizationSummary, extendDays: number) => {
    if (!adminSessionToken) return;
    setIsSavingOrgId(org.id);
    setOrgsActionMsg(null);
    try {
      const targetCycle: 'monthly' | 'yearly' =
        extendDays >= 365 || org.billingCycle === 'yearly' ? 'yearly' : 'monthly';
      const updated = await adminUpdateOrganizationSubscription({
        orgId: org.id,
        planTier: 'business_pro',
        billingCycle: targetCycle,
        extendDays,
        existingExpiresAt: org.expiresAt ?? null,
        adminSessionToken,
      });
      setOrgsList((prev) => prev.map((row) => (row.id === org.id ? { ...row, ...updated } : row)));
      setOrgsActionMsg({
        type: 'ok',
        text: isRTL
          ? `تم تمديد اشتراك المؤسسة (+${extendDays} يوم) بنجاح في السحابة.`
          : `Extended organization subscription by +${extendDays} days.`,
      });
    } catch (err) {
      if (handleSessionExpiry(err)) return;
      setOrgsActionMsg({
        type: 'err',
        text: parseReadableError(
          err,
          isRTL ? 'تعذر تمديد اشتراك المؤسسة.' : 'Could not extend organization subscription.'
        ),
      });
    } finally {
      setIsSavingOrgId(null);
    }
  };

  const handleCancelOrgSubscription = async (orgId: string) => {
    if (!adminSessionToken) return;
    setIsSavingOrgId(orgId);
    setOrgsActionMsg(null);
    try {
      const updated = await adminCancelOrganizationSubscription(orgId, adminSessionToken);
      setOrgsList((prev) => prev.map((row) => (row.id === orgId ? { ...row, ...updated } : row)));
      if (editingOrgId === orgId) setEditingOrgId(null);
      setOrgsActionMsg({
        type: 'ok',
        text: isRTL
          ? 'تم إلغاء اشتراك المؤسسة وتحويلها للخطة المجانية.'
          : 'Organization subscription cancelled and reverted to Free.',
      });
    } catch (err) {
      if (handleSessionExpiry(err)) return;
      setOrgsActionMsg({
        type: 'err',
        text: parseReadableError(
          err,
          isRTL ? 'تعذر إلغاء اشتراك المؤسسة.' : 'Could not cancel organization subscription.'
        ),
      });
    } finally {
      setIsSavingOrgId(null);
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

  const formatOrgExpiry = (org: CloudAdminOrganizationSummary) => {
    if (org.planTier === 'free') return isRTL ? 'مجاني' : 'Free';
    if (org.billingCycle === 'lifetime' || !org.expiresAt) {
      return isRTL ? 'مدى الحياة (دائم)' : 'Lifetime';
    }
    const daysLeft = Math.max(0, Math.ceil((org.expiresAt - Date.now()) / SUBSCRIPTION_DAY_MS));
    const dateStr = new Date(org.expiresAt).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    return org.isReadOnly
      ? isRTL
        ? `منتهي (${dateStr})`
        : `Expired (${dateStr})`
      : isRTL
      ? `${dateStr} (${daysLeft} يوم)`
      : `${dateStr} (${daysLeft}d)`;
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

  const formatOrgStatusBadge = (org: CloudAdminOrganizationSummary) => {
    if (org.planTier === 'free') {
      return {
        label: isRTL ? 'مجاني' : 'Free',
        cls: 'bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-muted)]',
      };
    }
    if (org.isReadOnly) {
      return {
        label: isRTL ? 'منتهي (قراءة فقط)' : 'Expired (Read-Only)',
        cls: 'bg-[var(--color-expense)]/12 border border-[var(--color-expense)]/35 text-[var(--color-expense)]',
      };
    }
    if (org.status === 'trial') {
      return {
        label: isRTL ? 'تجربة Business' : 'Business Trial',
        cls: 'bg-sky-500/15 border border-sky-500/35 text-sky-700 dark:text-sky-300',
      };
    }
    return {
      label: isRTL ? 'أعمال Business PRO' : 'Business PRO',
      cls: 'bg-amber-500/15 border border-amber-500/35 text-amber-700 dark:text-amber-300',
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
                {isRTL ? 'لوحة إدارة الاشتراكات المباشرة' : 'Direct Subscription Admin Panel'}
              </h2>
              <p className="text-[11px] text-[var(--color-muted)] truncate" dir="ltr">
                {user?.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isUnlocked && (
              <button
                type="button"
                onClick={handleLockAdminPanel}
                data-testid="admin-lock-session-btn"
                title={isRTL ? 'قفل لوحة الإدارة' : 'Lock Admin Panel'}
                className="px-2.5 h-9 rounded-lg border border-[var(--color-line)] flex items-center gap-1 text-[11px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)] min-h-[36px]"
              >
                <Lock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isRTL ? 'قفل' : 'Lock'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsAdminCodeModalOpen(false)}
              aria-label={isRTL ? 'إغلاق' : 'Close'}
              className="w-9 h-9 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] min-h-[36px] min-w-[36px]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {!isUnlocked ? (
            <form
              onSubmit={handleUnlockSubmit}
              className="space-y-4 max-w-sm mx-auto py-3"
              data-testid="admin-passcode-gate"
            >
              <div className="p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-center space-y-2">
                <div className="w-11 h-11 rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)] flex items-center justify-center mx-auto">
                  <Lock className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-[var(--color-ink)]">
                  {isCheckingPinStatus
                    ? isRTL
                      ? 'جاري التحقق من حالة الأمان...'
                      : 'Checking security status...'
                    : !pinConfigured
                    ? isRTL
                      ? 'تعيين الرمز السري للوحة الإدارة لأول مرة'
                      : 'Set Up Admin Panel PIN'
                    : isRTL
                    ? 'أدخل الرمز السري الإداري للمتابعة'
                    : 'Enter Admin Passcode'}
                </h3>
                <p className="text-xs text-[var(--color-muted)]">
                  {!pinConfigured
                    ? isRTL
                      ? 'اختر رمزاً سرياً خاصاً بلوحة الإدارة (4-32 حرفاً/رقماً). يتم تشفيره وحفظه بسرية تامة.'
                      : 'Create a confidential Admin PIN (4-32 chars). It is cryptographically hashed.'
                    : isRTL
                    ? 'بوابة تحقق حصرية لمالك النظام لتفعيل وإدارة اشتراكات الحسابات والمؤسسات مباشرة.'
                    : 'Exclusive system admin gate to activate and manage account & organization subscriptions directly.'}
                </p>
              </div>

              <div>
                <label
                  htmlFor="admin-passcode-field"
                  className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5"
                >
                  {!pinConfigured
                    ? isRTL
                      ? 'الرمز السري الجديد'
                      : 'New Admin PIN'
                    : isRTL
                    ? 'الرمز السري'
                    : 'Passcode'}
                </label>
                <input
                  id="admin-passcode-field"
                  type="password"
                  autoFocus
                  required
                  minLength={4}
                  maxLength={32}
                  dir="ltr"
                  value={passcodeInput}
                  onChange={(e) => {
                    setPasscodeInput(e.target.value);
                    setPasscodeError(null);
                  }}
                  placeholder="••••••"
                  data-testid="admin-passcode-input"
                  className="w-full px-3 py-2.5 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-sm font-mono text-center tracking-widest text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                />
              </div>

              {!pinConfigured && (
                <div>
                  <label
                    htmlFor="admin-setup-confirm-pin"
                    className="block text-xs font-semibold text-[var(--color-muted)] mb-1.5"
                  >
                    {isRTL ? 'تأكيد الرمز السري' : 'Confirm Admin PIN'}
                  </label>
                  <input
                    id="admin-setup-confirm-pin"
                    type="password"
                    required
                    minLength={4}
                    maxLength={32}
                    dir="ltr"
                    value={setupConfirmPin}
                    onChange={(e) => {
                      setSetupConfirmPin(e.target.value);
                      setPasscodeError(null);
                    }}
                    placeholder="••••••"
                    data-testid="admin-setup-confirm-pin-input"
                    className="w-full px-3 py-2.5 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-sm font-mono text-center tracking-widest text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                  />
                </div>
              )}

              {passcodeError && (
                <p
                  data-testid="admin-passcode-error"
                  className="text-xs text-[var(--color-expense)] font-medium"
                >
                  {passcodeError}
                </p>
              )}

              <button
                type="submit"
                disabled={
                  isCheckingPinStatus ||
                  isVerifyingPasscode ||
                  !passcodeInput.trim() ||
                  (!pinConfigured && !setupConfirmPin.trim())
                }
                data-testid="admin-passcode-submit"
                className="w-full py-2.5 px-4 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px] hover:opacity-95 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {(isVerifyingPasscode || isCheckingPinStatus) && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                <span>
                  {!pinConfigured
                    ? isRTL
                      ? 'حفظ الرمز السري وفتح لوحة الإدارة'
                      : 'Save PIN & Unlock Panel'
                    : isRTL
                    ? 'فتح لوحة الإدارة'
                    : 'Unlock Admin Panel'}
                </span>
              </button>

              {needsReauthPinUpgrade && (
                <div
                  data-testid="admin-reauth-pin-upgrade"
                  className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/40 space-y-2.5"
                >
                  <p className="text-[11px] font-semibold text-[var(--color-ink)]">
                    {isRTL
                      ? 'تحديث الرمز السري بعد تأكيد هوية Google'
                      : 'Upgrade Admin PIN via Google Re-verification'}
                  </p>
                  <input
                    type="password"
                    dir="ltr"
                    minLength={4}
                    maxLength={32}
                    value={reauthNewPin}
                    onChange={(e) => setReauthNewPin(e.target.value)}
                    placeholder={isRTL ? 'الرمز السري الجديد (4-32)' : 'New PIN (4-32 chars)'}
                    className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs font-mono text-center text-[var(--color-ink)] min-h-[40px]"
                  />
                  <input
                    type="password"
                    dir="ltr"
                    minLength={4}
                    maxLength={32}
                    value={reauthConfirmPin}
                    onChange={(e) => setReauthConfirmPin(e.target.value)}
                    placeholder={isRTL ? 'تأكيد الرمز السري الجديد' : 'Confirm new PIN'}
                    className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs font-mono text-center text-[var(--color-ink)] min-h-[40px]"
                  />
                  <button
                    type="button"
                    disabled={isReauthingPin || !reauthNewPin.trim() || !reauthConfirmPin.trim()}
                    onClick={() => void handleGoogleReauthPinReset()}
                    className="w-full py-2.5 px-3 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[42px] disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {isReauthingPin && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>
                      {isRTL
                        ? 'تأكيد هوية Google وتحديث الرمز السري'
                        : 'Verify Google Identity & Update PIN'}
                    </span>
                  </button>
                </div>
              )}
            </form>
          ) : (
            <div className="space-y-4">
              {/* Admin Navigation Tabs (Accounts | Organizations | Security) */}
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                <button
                  type="button"
                  data-testid="admin-tab-users"
                  onClick={() => setActiveTab('users')}
                  className={`py-2 px-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition-colors min-h-[40px] ${
                    activeTab === 'users'
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-sm'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{isRTL ? 'الحسابات' : 'Accounts'}</span>
                </button>
                <button
                  type="button"
                  data-testid="admin-tab-orgs"
                  onClick={() => setActiveTab('orgs')}
                  className={`py-2 px-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition-colors min-h-[40px] ${
                    activeTab === 'orgs'
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-sm'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{isRTL ? 'المؤسسات' : 'Organizations'}</span>
                </button>
                <button
                  type="button"
                  data-testid="admin-tab-security"
                  onClick={() => {
                    setActiveTab('security');
                    setPinChangeFeedback(null);
                  }}
                  className={`py-2 px-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition-colors min-h-[40px] ${
                    activeTab === 'security'
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-sm'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <Settings className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{isRTL ? 'الأمان والرمز' : 'Security'}</span>
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
                          isRTL
                            ? 'ابحث بالبريد الإلكتروني أو الاسم أو المعرّف...'
                            : 'Search by email, name, or UID...'
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
                        const isSelfAdmin = Boolean(account.isAdmin || account.uid === user?.id);
                        const canQuickExtend =
                          account.isPro && account.billingCycle !== 'lifetime' && !isSelfAdmin;

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

                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                {canQuickExtend && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      data-testid={`admin-extend-30d-${account.uid}`}
                                      onClick={() => void handleQuickExtendUser(account, 30)}
                                      className="px-2 py-1.5 rounded-lg bg-[var(--color-income)]/12 border border-[var(--color-income)]/30 text-[10px] font-bold text-[var(--color-income)] hover:bg-[var(--color-income)]/20 flex items-center gap-0.5 min-h-[34px] disabled:opacity-50"
                                      title={isRTL ? 'تمديد 30 يوماً' : 'Extend 30 days'}
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>{isRTL ? '30 يوم' : '30d'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      data-testid={`admin-extend-365d-${account.uid}`}
                                      onClick={() => void handleQuickExtendUser(account, 365)}
                                      className="px-2 py-1.5 rounded-lg bg-[var(--color-income)]/12 border border-[var(--color-income)]/30 text-[10px] font-bold text-[var(--color-income)] hover:bg-[var(--color-income)]/20 flex items-center gap-0.5 min-h-[34px] disabled:opacity-50"
                                      title={isRTL ? 'تمديد سنة كاملة' : 'Extend 1 year'}
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>{isRTL ? 'سنة' : '1y'}</span>
                                    </button>
                                  </>
                                )}
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
                                  <span>
                                    {isEditing
                                      ? isRTL
                                        ? 'إغلاق'
                                        : 'Close'
                                      : account.isPro
                                      ? isRTL
                                        ? 'تعديل'
                                        : 'Edit'
                                      : isRTL
                                      ? 'تفعيل'
                                      : 'Activate'}
                                  </span>
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
                                    <span>{isRTL ? 'إلغاء' : 'Cancel'}</span>
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
                                      <option value="personal_pro">
                                        {isRTL ? 'أفراد Personal PRO' : 'Personal PRO'}
                                      </option>
                                      <option value="business_pro">
                                        {isRTL ? 'أعمال Business PRO' : 'Business PRO'}
                                      </option>
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
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setEditDurationMode('days')}
                                        className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border flex items-center justify-center gap-1 min-h-[34px] ${
                                          editDurationMode === 'days'
                                            ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)] text-[var(--color-accent)]'
                                            : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)]'
                                        }`}
                                      >
                                        <Clock className="w-3 h-3" />
                                        <span>{isRTL ? 'مدة بالأيام' : 'Custom Days'}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditDurationMode('date')}
                                        className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border flex items-center justify-center gap-1 min-h-[34px] ${
                                          editDurationMode === 'date'
                                            ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)] text-[var(--color-accent)]'
                                            : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)]'
                                        }`}
                                      >
                                        <Calendar className="w-3 h-3" />
                                        <span>{isRTL ? 'تاريخ انتهاء محدد' : 'Expiry Date'}</span>
                                      </button>
                                    </div>

                                    {editDurationMode === 'days' ? (
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
                                          data-testid={`admin-custom-days-${account.uid}`}
                                          className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] min-h-[36px]"
                                        />
                                      </div>
                                    ) : (
                                      <div>
                                        <label className="block text-[10px] font-semibold text-[var(--color-muted)] mb-1">
                                          {isRTL
                                            ? 'اختر تاريخ انتهاء الاشتراك'
                                            : 'Pick exact subscription expiry date'}
                                        </label>
                                        <input
                                          type="date"
                                          dir="ltr"
                                          value={editExpiryDate}
                                          onChange={(e) => setEditExpiryDate(e.target.value)}
                                          data-testid={`admin-expiry-date-${account.uid}`}
                                          className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] min-h-[36px]"
                                        />
                                      </div>
                                    )}
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
                                    onClick={() => void handleSaveUserSubscription(account)}
                                    className="px-3.5 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center gap-1.5 min-h-[36px] disabled:opacity-60"
                                  >
                                    {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    <span>{isRTL ? 'حفظ وتفعيل الاشتراك' : 'Save & Sync Plan'}</span>
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

              {/* TAB 2: ORGANIZATIONS & DIRECT BUSINESS SUBSCRIPTION MANAGEMENT */}
              {activeTab === 'orgs' && (
                <div className="space-y-3" data-testid="admin-orgs-panel">
                  {/* Org Stats Summary */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                      <div className="text-[10px] text-[var(--color-muted)]">
                        {isRTL ? 'إجمالي المؤسسات' : 'Total Orgs'}
                      </div>
                      <div className="text-sm font-bold text-[var(--color-ink)] num-tabular">
                        {orgStats.total}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                      <div className="text-[10px] text-[var(--color-muted)]">
                        {isRTL ? 'نشطة Business' : 'Active Business'}
                      </div>
                      <div className="text-sm font-bold text-amber-600 dark:text-amber-400 num-tabular">
                        {orgStats.activeBusiness}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                      <div className="text-[10px] text-[var(--color-muted)]">
                        {isRTL ? 'منتهية / مجانية' : 'Expired / Free'}
                      </div>
                      <div className="text-sm font-bold text-[var(--color-muted)] num-tabular">
                        {orgStats.inactive}
                      </div>
                    </div>
                  </div>

                  {/* Org Search & Refresh */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-[var(--color-muted)] absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                      <input
                        type="text"
                        value={orgSearchQuery}
                        onChange={(e) => setOrgSearchQuery(e.target.value)}
                        data-testid="admin-orgs-search-input"
                        placeholder={
                          isRTL
                            ? 'ابحث باسم المؤسسة أو بريد المالك أو المعرّف...'
                            : 'Search by org name, owner email, or ID...'
                        }
                        className="w-full ps-8 pe-3 py-2 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[40px]"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isLoadingOrgs}
                      onClick={() => void loadAdminOrganizations()}
                      data-testid="admin-refresh-orgs-btn"
                      className="px-3 py-2 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-xs font-semibold text-[var(--color-accent)] hover:border-[var(--color-accent)] flex items-center gap-1.5 min-h-[40px] shrink-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingOrgs ? 'animate-spin' : ''}`} />
                      <span>{isRTL ? 'تحديث' : 'Refresh'}</span>
                    </button>
                  </div>

                  {orgsActionMsg && (
                    <div
                      data-testid="admin-orgs-feedback"
                      className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                        orgsActionMsg.type === 'ok'
                          ? 'bg-[var(--color-income)]/12 border-[var(--color-income)]/35 text-[var(--color-income)]'
                          : 'bg-[var(--color-expense)]/12 border-[var(--color-expense)]/35 text-[var(--color-expense)]'
                      }`}
                    >
                      {orgsActionMsg.type === 'ok' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{orgsActionMsg.text}</span>
                    </div>
                  )}

                  {orgsError && (
                    <div className="p-3 rounded-xl bg-[var(--color-expense)]/12 border border-[var(--color-expense)]/30 text-xs text-[var(--color-expense)] space-y-2">
                      <p className="font-semibold">{orgsError}</p>
                      <button
                        type="button"
                        onClick={() => void loadAdminOrganizations()}
                        className="px-3 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] text-[11px] font-bold"
                      >
                        {isRTL ? 'إعادة المحاولة' : 'Retry'}
                      </button>
                    </div>
                  )}

                  {isLoadingOrgs && orgsList.length === 0 ? (
                    <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-[var(--color-muted)]">
                      <Loader2 className="w-5 h-5 animate-spin text-[var(--color-accent)]" />
                      <span>{isRTL ? 'جاري تحميل قائمة المؤسسات...' : 'Loading organizations...'}</span>
                    </div>
                  ) : filteredOrgs.length === 0 ? (
                    <div className="p-6 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] text-center text-xs text-[var(--color-muted)]">
                      {isRTL
                        ? 'لا توجد مؤسسات مطابقة للبحث حالياً.'
                        : 'No matching organizations found.'}
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[48vh] overflow-y-auto pe-1">
                      {filteredOrgs.map((org) => {
                        const badge = formatOrgStatusBadge(org);
                        const isEditing = editingOrgId === org.id;
                        const isBusy = isSavingOrgId === org.id;
                        const ownerEmail = userEmailByUid.get(org.ownerId);
                        const canQuickExtend =
                          org.planTier !== 'free' && org.billingCycle !== 'lifetime';

                        return (
                          <div
                            key={org.id}
                            data-testid={`admin-org-row-${org.id}`}
                            className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2.5"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-bold text-[var(--color-ink)] truncate">
                                    {org.name}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${badge.cls}`}>
                                    {badge.label}
                                  </span>
                                  {org.planTier !== 'free' && (
                                    <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-line)] text-[10px] font-semibold text-[var(--color-muted)]">
                                      {formatCycleLabel(org.billingCycle)}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-[var(--color-muted)] truncate mt-0.5" dir="ltr">
                                  {ownerEmail || org.ownerId} • {org.currency} • {org.seatLimit}{' '}
                                  {isRTL ? 'مقاعد' : 'seats'}
                                </div>
                                <div className="text-[10px] text-[var(--color-muted)] mt-1">
                                  {isRTL ? 'الانتهاء: ' : 'Expires: '}
                                  <span className="font-semibold text-[var(--color-ink)]">
                                    {formatOrgExpiry(org)}
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                {canQuickExtend && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      data-testid={`admin-org-extend-30d-${org.id}`}
                                      onClick={() => void handleQuickExtendOrg(org, 30)}
                                      className="px-2 py-1.5 rounded-lg bg-[var(--color-income)]/12 border border-[var(--color-income)]/30 text-[10px] font-bold text-[var(--color-income)] hover:bg-[var(--color-income)]/20 flex items-center gap-0.5 min-h-[34px] disabled:opacity-50"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>{isRTL ? '30 يوم' : '30d'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      data-testid={`admin-org-extend-365d-${org.id}`}
                                      onClick={() => void handleQuickExtendOrg(org, 365)}
                                      className="px-2 py-1.5 rounded-lg bg-[var(--color-income)]/12 border border-[var(--color-income)]/30 text-[10px] font-bold text-[var(--color-income)] hover:bg-[var(--color-income)]/20 flex items-center gap-0.5 min-h-[34px] disabled:opacity-50"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>{isRTL ? 'سنة' : '1y'}</span>
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  data-testid={`admin-edit-org-${org.id}`}
                                  onClick={() =>
                                    isEditing ? setEditingOrgId(null) : openInlineOrgEditor(org)
                                  }
                                  className="px-2.5 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] text-[11px] font-semibold text-[var(--color-ink)] flex items-center gap-1 min-h-[34px]"
                                >
                                  <Edit3 className="w-3 h-3 text-[var(--color-accent)]" />
                                  <span>
                                    {isEditing ? (isRTL ? 'إغلاق' : 'Close') : isRTL ? 'تعديل' : 'Edit'}
                                  </span>
                                </button>
                                {org.planTier !== 'free' && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    data-testid={`admin-cancel-org-${org.id}`}
                                    onClick={() => void handleCancelOrgSubscription(org.id)}
                                    className="px-2.5 py-1.5 rounded-lg bg-[var(--color-expense)]/12 border border-[var(--color-expense)]/30 text-[11px] font-semibold text-[var(--color-expense)] hover:bg-[var(--color-expense)]/20 flex items-center gap-1 min-h-[34px] disabled:opacity-50"
                                  >
                                    {isBusy ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Ban className="w-3 h-3" />
                                    )}
                                    <span>{isRTL ? 'إلغاء' : 'Cancel'}</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {isEditing && (
                              <div
                                data-testid={`admin-edit-org-form-${org.id}`}
                                className="p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-accent)]/35 space-y-2.5"
                              >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] font-semibold text-[var(--color-muted)] mb-1">
                                      {isRTL ? 'باقة المؤسسة' : 'Organization Plan'}
                                    </label>
                                    <select
                                      value={editOrgTier}
                                      onChange={(e) => {
                                        const nextTier = e.target.value as PlanTier;
                                        setEditOrgTier(nextTier);
                                        if (nextTier === 'free') {
                                          setEditOrgCycle('free');
                                        } else if (editOrgCycle === 'free') {
                                          setEditOrgCycle('yearly');
                                        }
                                      }}
                                      className="w-full px-2.5 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] min-h-[38px]"
                                    >
                                      <option value="free">{isRTL ? 'مجاني / معطّل' : 'Free / Disabled'}</option>
                                      <option value="business_pro">
                                        {isRTL ? 'أعمال Business PRO' : 'Business PRO'}
                                      </option>
                                    </select>
                                  </div>

                                  {editOrgTier !== 'free' && (
                                    <div>
                                      <label className="block text-[10px] font-semibold text-[var(--color-muted)] mb-1">
                                        {isRTL ? 'دورة الفوترة / المدة' : 'Billing Cycle'}
                                      </label>
                                      <select
                                        value={editOrgCycle}
                                        onChange={(e) => setEditOrgCycle(e.target.value as AdminEditCycle)}
                                        className="w-full px-2.5 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] min-h-[38px]"
                                      >
                                        <option value="monthly">{isRTL ? 'شهري (30 يوم)' : 'Monthly (30d)'}</option>
                                        <option value="yearly">{isRTL ? 'سنوي (365 يوم)' : 'Yearly (365d)'}</option>
                                        <option value="lifetime">{isRTL ? 'مدى الحياة (دائم)' : 'Lifetime'}</option>
                                      </select>
                                    </div>
                                  )}
                                </div>

                                {editOrgTier !== 'free' && editOrgCycle !== 'lifetime' && (
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setEditOrgDurationMode('days')}
                                        className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border flex items-center justify-center gap-1 min-h-[34px] ${
                                          editOrgDurationMode === 'days'
                                            ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)] text-[var(--color-accent)]'
                                            : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)]'
                                        }`}
                                      >
                                        <Clock className="w-3 h-3" />
                                        <span>{isRTL ? 'مدة بالأيام' : 'Custom Days'}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditOrgDurationMode('date')}
                                        className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border flex items-center justify-center gap-1 min-h-[34px] ${
                                          editOrgDurationMode === 'date'
                                            ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)] text-[var(--color-accent)]'
                                            : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)]'
                                        }`}
                                      >
                                        <Calendar className="w-3 h-3" />
                                        <span>{isRTL ? 'تاريخ انتهاء محدد' : 'Expiry Date'}</span>
                                      </button>
                                    </div>

                                    {editOrgDurationMode === 'days' ? (
                                      <input
                                        type="number"
                                        min={1}
                                        max={3650}
                                        dir="ltr"
                                        value={editOrgCustomDays}
                                        onChange={(e) => setEditOrgCustomDays(e.target.value)}
                                        placeholder={editOrgCycle === 'monthly' ? '30' : '365'}
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] min-h-[36px]"
                                      />
                                    ) : (
                                      <input
                                        type="date"
                                        dir="ltr"
                                        value={editOrgExpiryDate}
                                        onChange={(e) => setEditOrgExpiryDate(e.target.value)}
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-xs text-[var(--color-ink)] min-h-[36px]"
                                      />
                                    )}
                                  </div>
                                )}

                                <div className="flex items-center justify-end gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => setEditingOrgId(null)}
                                    className="px-3 py-1.5 rounded-lg border border-[var(--color-line)] text-xs font-semibold text-[var(--color-muted)] min-h-[36px]"
                                  >
                                    {isRTL ? 'إلغاء' : 'Cancel'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    data-testid={`admin-save-org-${org.id}`}
                                    onClick={() => void handleSaveOrgSubscription(org)}
                                    className="px-3.5 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center gap-1.5 min-h-[36px] disabled:opacity-60"
                                  >
                                    {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    <span>{isRTL ? 'حفظ اشتراك المؤسسة' : 'Save Org Plan'}</span>
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

              {/* TAB 3: EXCLUSIVE SYSTEM ADMIN SECURITY & PIN ROTATION */}
              {activeTab === 'security' && (
                <div className="space-y-4" data-testid="admin-security-panel">
                  <div className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-ink)]">
                        <ShieldCheck className="w-4 h-4 text-[var(--color-income)] shrink-0" />
                        <span>{isRTL ? 'مالك النظام الحصري' : 'Exclusive System Admin'}</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[var(--color-income)]/15 border border-[var(--color-income)]/35 text-[10px] font-bold text-[var(--color-income)]">
                        {isRTL ? 'تشفير مشفّر' : 'Hashed PIN'}
                      </span>
                    </div>
                    <p className="text-xs font-mono text-[var(--color-ink)]" dir="ltr">
                      {PRIMARY_SYSTEM_ADMIN_EMAIL}
                    </p>
                    <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                      {isRTL
                        ? 'الوصول للوحة التحكم وتفعيل أو تعديل اشتراكات الحسابات والمؤسسات محصور بهذا البريد الإلكتروني الموثّق عبر Firebase Auth فقط. يُحفظ الرمز السري مشفراً بملح عشوائي داخل مستند محمي (adminConfig/security) ولا يُخزن أبداً كنص صريح.'
                        : 'Admin panel access and direct subscription management for accounts & organizations are strictly locked to this verified account via Firebase Auth. Your PIN is stored exclusively as a salted cryptographic hash in adminConfig/security.'}
                    </p>
                    {pinUpdatedAtMs && (
                      <p className="text-[10px] text-[var(--color-muted)]">
                        {isRTL ? 'آخر تحديث للرمز السري: ' : 'Last PIN update: '}
                        <span className="font-semibold text-[var(--color-ink)]">
                          {new Date(pinUpdatedAtMs).toLocaleString(isRTL ? 'ar-EG' : 'en-US')}
                        </span>
                      </p>
                    )}
                    {pinSource === 'env' && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                        {isRTL
                          ? 'تستخدم حالياً رمز البيئة الافتراضي — يمكنك تغييره أدناه لحفظ رمز خاص بك مشفراً في السحابة.'
                          : 'Currently using server environment bootstrap passcode — change it below to store a cloud hashed PIN.'}
                      </p>
                    )}
                  </div>

                  <form
                    onSubmit={handleChangeAdminPin}
                    className="p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-3"
                    data-testid="admin-change-pin-form"
                  >
                    <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-ink)]">
                      <Lock className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                      <span>{isRTL ? 'تغيير الرمز السري للوحة الإدارة' : 'Change Admin Panel PIN'}</span>
                    </div>

                    <div>
                      <label
                        htmlFor="admin-current-pin"
                        className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1"
                      >
                        {isRTL ? 'الرمز السري الحالي' : 'Current PIN'}
                      </label>
                      <input
                        id="admin-current-pin"
                        type="password"
                        required
                        dir="ltr"
                        value={currentPinInput}
                        onChange={(e) => {
                          setCurrentPinInput(e.target.value);
                          setPinChangeFeedback(null);
                        }}
                        placeholder="••••••"
                        data-testid="admin-current-pin-input"
                        className="w-full px-3 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-mono tracking-widest text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[42px]"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label
                          htmlFor="admin-new-pin"
                          className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1"
                        >
                          {isRTL ? 'الرمز السري الجديد (4-32)' : 'New PIN (4-32 chars)'}
                        </label>
                        <input
                          id="admin-new-pin"
                          type="password"
                          required
                          minLength={4}
                          maxLength={32}
                          dir="ltr"
                          value={newPinInput}
                          onChange={(e) => {
                            setNewPinInput(e.target.value);
                            setPinChangeFeedback(null);
                          }}
                          placeholder="••••••"
                          data-testid="admin-new-pin-input"
                          className="w-full px-3 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-mono tracking-widest text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[42px]"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="admin-confirm-new-pin"
                          className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1"
                        >
                          {isRTL ? 'تأكيد الرمز الجديد' : 'Confirm New PIN'}
                        </label>
                        <input
                          id="admin-confirm-new-pin"
                          type="password"
                          required
                          minLength={4}
                          maxLength={32}
                          dir="ltr"
                          value={confirmNewPinInput}
                          onChange={(e) => {
                            setConfirmNewPinInput(e.target.value);
                            setPinChangeFeedback(null);
                          }}
                          placeholder="••••••"
                          data-testid="admin-confirm-new-pin-input"
                          className="w-full px-3 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xs font-mono tracking-widest text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[42px]"
                        />
                      </div>
                    </div>

                    {pinChangeFeedback && (
                      <div
                        data-testid="admin-pin-change-feedback"
                        className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                          pinChangeFeedback.type === 'ok'
                            ? 'bg-[var(--color-income)]/12 border-[var(--color-income)]/35 text-[var(--color-income)]'
                            : 'bg-[var(--color-expense)]/12 border-[var(--color-expense)]/35 text-[var(--color-expense)]'
                        }`}
                      >
                        {pinChangeFeedback.type === 'ok' ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                        )}
                        <span>{pinChangeFeedback.text}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={
                        isChangingPin ||
                        !currentPinInput.trim() ||
                        !newPinInput.trim() ||
                        !confirmNewPinInput.trim()
                      }
                      data-testid="admin-change-pin-submit"
                      className="w-full py-2.5 px-4 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold min-h-[44px] hover:opacity-95 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {isChangingPin && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>{isRTL ? 'تحديث وحفظ الرمز السري المشفر' : 'Update Encrypted Admin PIN'}</span>
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
