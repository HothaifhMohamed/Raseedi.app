import React, { useState, useMemo } from 'react';
import {
  Plus,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Edit2,
  Trash2,
  Check,
  Crown,
  Sparkles,
  Archive,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  MoreHorizontal,
  PauseCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Wallet, WalletType } from '../../types';
import { IconRenderer } from '../common/IconRenderer';
import { formatCurrencyAmount, calculateTotalBalance } from '../../services/calculations';
import { reorderWalletsBySwap, sortWalletsByOrder } from '../../services/walletOrder';
import {
  buildWalletActionPreset,
  canToggleWalletArchive,
} from '../../services/walletQuickActions';
import { normalizeArabicPersianNumerals, parseLocalizedNumber } from '../../services/numbers';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { PinLockModal } from '../common/PinLockModal';
import { hashPin } from '../../services/security';
import { MoneyText } from '../common/MoneyText';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { HairlineEmptyState } from '../common/HairlineVisuals';
import { shouldShowPersonalUpgradeUi } from '../../services/subscriptionHelpers';
import { WalletQuickActionsSheet } from './WalletQuickActionsSheet';

const SOLID_MUTED_PALETTE = [
  { id: 'teal', label: 'تركواز ترابي', hex: '#3A605B' },
  { id: 'slate', label: 'رمادي حجري', hex: '#3E4E63' },
  { id: 'warm-brown', label: 'بني دافئ', hex: '#6A5243' },
  { id: 'olive', label: 'زيتوني هادئ', hex: '#4A5B52' },
  { id: 'plum', label: 'برقوقي خافت', hex: '#634A54' },
  { id: 'charcoal', label: 'فحمي ناعم', hex: '#4E555C' },
];

const WALLET_ICONS = ['Wallet', 'CreditCard', 'Landmark', 'Banknote', 'Coins', 'Vault'];

export const WalletsPage: React.FC = () => {
  const {
    wallets,
    debts,
    settings,
    isOrgWorkspace,
    orgMembers,
    addWallet,
    updateWallet,
    reorderWallets,
    getWalletDependencies,
    deleteWallet,
    migrateAndDeleteWallet,
    openCurrencyPicker,
    lockedWalletIds,
    unlockWallet,
    setActiveWalletId,
    openTransactionWithPreset,
    showToast,
    isPro,
    subscriptionSummary,
    setIsUpgradeModalOpen,
    t,
    isRTL,
  } = useApp();

  const [hiddenBalances, setHiddenBalances] = useState<Record<string, boolean>>({});
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [quickActionWalletId, setQuickActionWalletId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingWallet, setEditingWallet] = useState<Wallet | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dependencyWalletId, setDependencyWalletId] = useState<string | null>(null);
  const [migrationTargetWalletId, setMigrationTargetWalletId] = useState<string>('');

  // Lock Pin Verification Modal
  const [pinModalTargetWallet, setPinModalTargetWallet] = useState<Wallet | null>(null);
  const [settingPinForWallet, setSettingPinForWallet] = useState<Wallet | null>(null);
  const [newWalletPin, setNewWalletPin] = useState('');

  const quickActionWallet = useMemo(
    () => wallets.find((w) => w.id === quickActionWalletId) || null,
    [wallets, quickActionWalletId]
  );

  useModalBackHandler(quickActionWallet !== null, () => setQuickActionWalletId(null), 'wallet-quick-actions');
  useModalBackHandler(isEditModalOpen, () => setIsEditModalOpen(false), 'wallet-edit');
  useModalBackHandler(pinModalTargetWallet !== null, () => setPinModalTargetWallet(null), 'wallet-pin-verify');
  useModalBackHandler(settingPinForWallet !== null, () => setSettingPinForWallet(null), 'wallet-pin-set');
  useModalBackHandler(confirmDeleteId !== null, () => setConfirmDeleteId(null), 'wallet-confirm-delete');
  useModalBackHandler(dependencyWalletId !== null, () => setDependencyWalletId(null), 'wallet-dependencies');

  // Form State for Add / Edit Wallet
  const [walletName, setWalletName] = useState('');
  const [walletCurrency, setWalletCurrency] = useState(settings.mainCurrency);
  const [initialBalance, setInitialBalance] = useState('0');
  const [walletColor, setWalletColor] = useState(SOLID_MUTED_PALETTE[0].hex);
  const [walletIcon, setWalletIcon] = useState('Wallet');
  const [walletType, setWalletType] = useState<WalletType>('standard');
  const [custodianMemberUid, setCustodianMemberUid] = useState('');
  const [excludeFromTotal, setExcludeFromTotal] = useState(false);

  const sortedWallets = useMemo(() => sortWalletsByOrder(wallets), [wallets]);

  React.useEffect(() => {
    if (sortedWallets.length <= 1 && isReorderMode) {
      setIsReorderMode(false);
    }
  }, [sortedWallets.length, isReorderMode]);

  const handleMoveWallet = (index: number, direction: 'up' | 'down') => {
    const nextOrdered = reorderWalletsBySwap(sortedWallets, index, direction);
    reorderWallets(nextOrdered);
  };

  // Total balance across all wallets
  const totalBalance = useMemo(() => {
    return calculateTotalBalance(sortedWallets, settings.mainCurrency, settings.customExchangeRates, {
      excludeDebts: settings.excludeDebtsFromBalance,
      debts,
    });
  }, [sortedWallets, settings.mainCurrency, settings.customExchangeRates, settings.excludeDebtsFromBalance, debts]);

  const toggleHideWalletBalance = (wId: string) => {
    setHiddenBalances((prev) => ({ ...prev, [wId]: !prev[wId] }));
  };

  const handleOpenAdd = () => {
    if (!isPro && wallets.length >= 3) {
      setIsUpgradeModalOpen(true);
      return;
    }
    const nextDistinctColor =
      SOLID_MUTED_PALETTE.find((p) => !wallets.some((w) => w.color === p.hex))?.hex ||
      SOLID_MUTED_PALETTE[wallets.length % SOLID_MUTED_PALETTE.length].hex;

    setEditingWallet(null);
    setWalletName('');
    setWalletCurrency(settings.mainCurrency);
    setInitialBalance('0');
    setWalletColor(nextDistinctColor);
    setWalletIcon('Wallet');
    setWalletType(isOrgWorkspace ? 'bank_account' : 'standard');
    setCustodianMemberUid('');
    setExcludeFromTotal(false);
    setIsEditModalOpen(true);
  };

  const handleOpenEdit = (w: Wallet, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingWallet(w);
    setWalletName(w.name);
    setWalletCurrency(w.currency);
    setInitialBalance(String(w.initialBalance));
    setWalletColor(w.color?.startsWith('#') ? w.color : SOLID_MUTED_PALETTE[0].hex);
    setWalletIcon(
      !w.icon ? 'Wallet' : w.icon === 'PiggyBank' || w.icon === 'Safe' ? 'Vault' : w.icon
    );
    setWalletType(w.walletType || 'standard');
    setCustodianMemberUid(w.custodianMemberUid || '');
    setExcludeFromTotal(Boolean(w.excludeFromTotal));
    setIsEditModalOpen(true);
  };

  const handleSaveWallet = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletName.trim()) return;

    const parsed = parseLocalizedNumber(initialBalance);
    const initBal = Number.isNaN(parsed) ? 0 : parsed;

    if (editingWallet) {
      updateWallet(editingWallet.id, {
        name: walletName.trim(),
        currency: walletCurrency,
        initialBalance: initBal,
        color: walletColor,
        icon: walletIcon,
        excludeFromTotal,
        ...(isOrgWorkspace
          ? {
              walletType,
              custodianMemberUid:
                walletType === 'petty_cash' && custodianMemberUid ? custodianMemberUid : undefined,
            }
          : {}),
      });
    } else {
      addWallet({
        name: walletName.trim(),
        currency: walletCurrency,
        initialBalance: initBal,
        balance: initBal,
        color: walletColor,
        icon: walletIcon,
        isArchived: false,
        excludeFromTotal,
        order: wallets.length + 1,
        ...(isOrgWorkspace
          ? {
              walletType,
              custodianMemberUid:
                walletType === 'petty_cash' && custodianMemberUid ? custodianMemberUid : undefined,
            }
          : {}),
      });
    }

    setIsEditModalOpen(false);
  };

  // Tap wallet card logic: check if locked first, else open quick actions menu
  const handleCardClick = (w: Wallet) => {
    if (w.isLocked && w.pin && lockedWalletIds.includes(w.id)) {
      setPinModalTargetWallet(w);
    } else {
      setQuickActionWalletId(w.id);
    }
  };

  const handleRequestDeleteWallet = (w: Wallet) => {
    if (wallets.length <= 1) {
      deleteWallet(w.id);
      return;
    }
    const deps = getWalletDependencies(w.id);
    setIsEditModalOpen(false);
    setQuickActionWalletId(null);
    if (deps.totalCount > 0) {
      const firstOther = wallets.find((other) => other.id !== w.id);
      setMigrationTargetWalletId(firstOther?.id || '');
      setDependencyWalletId(w.id);
    } else {
      setConfirmDeleteId(w.id);
    }
  };

  const handleToggleLock = (w: Wallet, e: React.MouseEvent) => {
    e.stopPropagation();
    if (w.isLocked) {
      updateWallet(w.id, { isLocked: false, pin: undefined, pinSalt: undefined });
    } else {
      if (!isPro) {
        setIsUpgradeModalOpen(true);
        return;
      }
      setSettingPinForWallet(w);
      setNewWalletPin('');
    }
  };

  return (
    <div className="flex flex-col flex-1 px-4 py-3 pb-24 space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Total Balance at Top */}
      <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between">
        <div>
          <span className="text-xs text-[var(--color-muted)] block mb-1">
            {t('totalWalletsBalance')}
          </span>
          <div className="text-2xl font-bold text-[var(--color-ink)] num-tabular tracking-tight">
            {formatCurrencyAmount(totalBalance, settings.mainCurrency, {
              decimalPlaces: settings.decimalPlaces,
              digitFormat: settings.digitFormat,
              language: settings.language,
            })}
          </div>
          {wallets.some((w) => !w.isArchived && w.excludeFromTotal) && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--color-muted)]">
              <EyeOff className="w-3 h-3 shrink-0" />
              <span>
                {(() => {
                  const excludedCount = wallets.filter((w) => !w.isArchived && w.excludeFromTotal).length;
                  return isRTL
                    ? `يستثني ${excludedCount} ${excludedCount === 1 ? 'محفظة' : 'محافظ'} من الإجمالي`
                    : `Excludes ${excludedCount} ${excludedCount === 1 ? 'wallet' : 'wallets'} from total`;
                })()}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 transition-opacity min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          <span>{t('addWallet')}</span>
          {shouldShowPersonalUpgradeUi(subscriptionSummary) && wallets.length >= 3 && (
            <Crown className="w-3.5 h-3.5 ms-0.5" />
          )}
        </button>
      </div>

      {/* Free limit hint if at 3 wallets and eligible for Personal upgrade */}
      {shouldShowPersonalUpgradeUi(subscriptionSummary) && wallets.length >= 3 && (
        <div className="p-2.5 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>{isRTL ? 'وصلت للحد الأقصى المجاني (3 محافظ)' : 'Free limit reached (3 wallets)'}</span>
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
                'Upgrade to PRO'
              )}
            </span>
          </button>
        </div>
      )}

      {/* Wallets List Header & Reorder Toggle */}
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-xs font-semibold text-[var(--color-muted)]">
          {isReorderMode
            ? isRTL
              ? 'استخدم الأسهم لإعادة ترتيب المحافظ'
              : 'Tap arrows to reorder wallets'
            : `${isRTL ? 'المحافظ' : 'Wallets'} (${sortedWallets.length})`}
        </span>

        {sortedWallets.length > 1 && (
          <button
            type="button"
            onClick={() => setIsReorderMode((prev) => !prev)}
            aria-pressed={isReorderMode}
            data-testid="toggle-reorder-wallets"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors min-h-[38px] ${
              isReorderMode
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)] shadow-xs'
                : 'bg-[var(--color-surface)] text-[var(--color-ink)] border-[var(--color-line)] hover:border-[var(--color-accent)]/50'
            }`}
          >
            {isReorderMode ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>{isRTL ? 'تم الترتيب' : 'Done'}</span>
              </>
            ) : (
              <>
                <ArrowUpDown className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>{isRTL ? 'تعديل الترتيب' : 'Reorder'}</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Wallets Cards List */}
      {sortedWallets.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl">
          <HairlineEmptyState
            figure="vault"
            surface="surface"
            title={isRTL ? 'لا توجد محافظ نشطة بعد' : 'No active wallets yet'}
            description={
              isRTL
                ? 'أضف محفظتك الأولى للبدء في تتبع رصيدك ومعاملاتك.'
                : 'Create your first wallet to start tracking balances and transactions.'
            }
            action={
              <button
                onClick={handleOpenAdd}
                className="flex items-center gap-1.5 px-4 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 min-h-[44px]"
              >
                <Plus className="w-4 h-4" />
                <span>{t('addWallet')}</span>
              </button>
            }
          />
        </div>
      ) : (
      <div className="space-y-3" data-testid="wallets-card-list">
        {sortedWallets.map((w, index) => {
          const isHidden = hiddenBalances[w.id];
          const isLocked = w.isLocked && lockedWalletIds.includes(w.id);
          const cardColor = w.color?.startsWith('#') ? w.color : '#3A605B';

          return (
            <div
              key={w.id}
              data-wallet-id={w.id}
              onClick={() => {
                if (!isReorderMode) handleCardClick(w);
              }}
              className={`relative rounded-xl p-4.5 border border-black/10 transition-opacity text-white select-none min-h-[100px] ${
                isReorderMode
                  ? 'cursor-default ring-1 ring-[var(--color-accent)]/40'
                  : 'cursor-pointer hover:opacity-95'
              } ${w.isArchived ? 'opacity-80' : ''}`}
              style={{ backgroundColor: cardColor }}
            >
              <div>
                {/* Top Row: Lucide Icon + Name + Action Icons */}
                <div className="flex items-center justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-black/20 flex items-center justify-center shrink-0">
                      <IconRenderer name={w.icon || 'Wallet'} className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold tracking-tight leading-tight flex items-center gap-1.5 flex-wrap">
                        <span>{w.name}</span>
                        {w.isArchived && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-black/25 text-white/95 font-medium">
                            <PauseCircle className="w-3 h-3 shrink-0" />
                            <span>{isRTL ? 'متوقفة مؤقتاً' : 'Paused'}</span>
                          </span>
                        )}
                        {w.excludeFromTotal && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-white/15 border border-white/20 text-white/95 font-medium backdrop-blur-[2px]">
                            <EyeOff className="w-3 h-3 shrink-0" />
                            <span>{isRTL ? 'مستثناة من الإجمالي' : 'Excluded from total'}</span>
                          </span>
                        )}
                        {isOrgWorkspace && w.walletType === 'petty_cash' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/25 text-white/95 font-semibold">
                            {w.custodianMemberUid
                              ? `${isRTL ? 'عُهدة' : 'Custody'}: ${
                                  orgMembers.find((m) => m.uid === w.custodianMemberUid)?.displayName || ''
                                }`
                              : isRTL
                              ? 'عُهدة نثرية'
                              : 'Petty Cash'}
                          </span>
                        )}
                      </h3>
                      <span className="text-[11px] text-white/75 font-mono">{w.currency}</span>
                    </div>
                  </div>

                  {isReorderMode ? (
                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[11px] font-mono font-bold px-2 py-1 rounded-lg bg-black/25 text-white/95 num-tabular">
                        #{index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleMoveWallet(index, 'up')}
                        disabled={index === 0}
                        aria-label={isRTL ? `نقل ${w.name} لأعلى` : `Move ${w.name} up`}
                        className={`p-2 rounded-lg bg-black/30 min-h-[40px] min-w-[40px] flex items-center justify-center transition ${
                          index === 0
                            ? 'opacity-35 cursor-not-allowed'
                            : 'hover:bg-black/45 active:scale-95 text-white'
                        }`}
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveWallet(index, 'down')}
                        disabled={index === sortedWallets.length - 1}
                        aria-label={isRTL ? `نقل ${w.name} لأسفل` : `Move ${w.name} down`}
                        className={`p-2 rounded-lg bg-black/30 min-h-[40px] min-w-[40px] flex items-center justify-center transition ${
                          index === sortedWallets.length - 1
                            ? 'opacity-35 cursor-not-allowed'
                            : 'hover:bg-black/45 active:scale-95 text-white'
                        }`}
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {/* Hide Balance Eye */}
                      <button
                        type="button"
                        onClick={() => toggleHideWalletBalance(w.id)}
                        className="p-1.5 text-white/80 hover:text-white rounded-lg bg-black/20 min-h-[36px] min-w-[36px] flex items-center justify-center"
                        aria-label="Toggle wallet balance"
                      >
                        {isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>

                      {/* Lock / Unlock Icon */}
                      <button
                        type="button"
                        onClick={(e) => handleToggleLock(w, e)}
                        className={`p-1.5 rounded-lg transition min-h-[36px] min-w-[36px] flex items-center justify-center ${
                          w.isLocked ? 'bg-[var(--color-warning)] text-[#1C1A17]' : 'bg-black/20 text-white/80 hover:text-white'
                        }`}
                        title={w.isLocked ? (isRTL ? 'المحفظة محمية' : 'Wallet locked') : (isRTL ? 'قفل المحفظة برمز' : 'Set PIN lock')}
                      >
                        {w.isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                      </button>

                      {/* Edit Wallet */}
                      <button
                        type="button"
                        onClick={(e) => handleOpenEdit(w, e)}
                        className="p-1.5 text-white/80 hover:text-white rounded-lg bg-black/20 min-h-[36px] min-w-[36px] flex items-center justify-center"
                        aria-label="Edit wallet"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Bottom Row: Balance & Currency */}
                <div className="flex items-end justify-between pt-2 border-t border-white/15">
                  <div>
                    <span className="text-[11px] text-white/75 block mb-0.5">
                      {isRTL ? 'الرصيد المتاح' : 'Available Balance'}
                    </span>
                    <div className="text-xl font-bold tracking-tight">
                      {isLocked ? (
                        <span>
                          {isRTL ? (
                            <>
                              محمية برمز <bdi dir="ltr">PIN</bdi>
                            </>
                          ) : (
                            'PIN Protected'
                          )}
                        </span>
                      ) : isHidden ? (
                        <span>••••••••</span>
                      ) : (
                        <MoneyText
                          amount={w.balance}
                          currency={w.currency}
                          className="text-xl font-bold text-white tracking-tight"
                        />
                      )}
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1 text-[11px] text-white/90 font-medium px-2 py-0.5 rounded bg-black/20">
                    <MoreHorizontal className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'إجراءات سريعة' : 'Quick actions'}</span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Add / Edit Wallet Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)] mb-4">
              <h3 className="font-title text-sm font-bold">
                {editingWallet ? t('editWallet') : t('addWallet')}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="w-8 h-8 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveWallet} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                  {t('walletName')}
                </label>
                <input
                  type="text"
                  required
                  value={walletName}
                  onChange={(e) => setWalletName(e.target.value)}
                  placeholder="مثال: حساب بنك مصر، محفظة كاش..."
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {t('walletCurrency')}
                  </label>
                  <button
                    type="button"
                    onClick={() => openCurrencyPicker((code) => setWalletCurrency(code), walletCurrency)}
                    className="w-full py-2 px-3 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs font-bold text-[var(--color-accent)] text-center min-h-[44px]"
                  >
                    {walletCurrency}
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                    {t('initialBalance')}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(normalizeArabicPersianNumerals(e.target.value))}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[44px] num-tabular"
                  />
                </div>
              </div>

              {isOrgWorkspace && (
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                      {t('walletTypeLabel')}
                    </label>
                    <select
                      value={walletType}
                      onChange={(e) => setWalletType(e.target.value as WalletType)}
                      className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                    >
                      <option value="bank_account">{t('walletTypeBank')}</option>
                      <option value="petty_cash">{t('walletTypePettyCash')}</option>
                      <option value="standard">{t('walletTypeStandard')}</option>
                    </select>
                  </div>

                  {walletType === 'petty_cash' && orgMembers.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1">
                        {t('assignCustodian')}
                      </label>
                      <select
                        value={custodianMemberUid}
                        onChange={(e) => setCustodianMemberUid(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[44px]"
                      >
                        <option value="">{isRTL ? 'خزينة عامة بدون موظف محدد' : 'General Petty Cash'}</option>
                        {orgMembers.map((m) => (
                          <option key={m.uid} value={m.uid}>
                            {m.displayName} ({m.role})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Solid Muted Color Selection */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1.5">
                  {t('walletColor')}
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {SOLID_MUTED_PALETTE.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setWalletColor(p.hex)}
                      className={`h-8 rounded-lg border flex items-center justify-center transition-all ${
                        walletColor === p.hex
                          ? 'border-[var(--color-ink)] ring-2 ring-[var(--color-accent)] scale-105'
                          : 'border-transparent'
                      }`}
                      style={{ backgroundColor: p.hex }}
                      title={p.label}
                    >
                      {walletColor === p.hex && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Icon Selection */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-ink)] mb-1.5">
                  {t('walletIcon')}
                </label>
                <div className="flex items-center gap-2 overflow-x-auto py-1">
                  {WALLET_ICONS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => setWalletIcon(ic)}
                      className={`w-9 h-9 rounded-xl flex items-center justify-center border transition min-h-[36px] min-w-[36px] ${
                        walletIcon === ic
                          ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]'
                          : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                      }`}
                    >
                      <IconRenderer name={ic} className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Exclude from Total Balance Toggle */}
              <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]">
                <label className="flex items-start justify-between gap-3 cursor-pointer">
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-[var(--color-ink)]">
                      {isRTL ? 'استبعاد من الرصيد الإجمالي' : 'Exclude from Total Balance'}
                    </span>
                    <span className="block text-[11px] text-[var(--color-muted)] mt-1 leading-relaxed">
                      {isRTL
                        ? 'لن يتم احتساب رصيد هذه المحفظة ضمن إجمالي رصيدك العام (مفيد لحسابات التوفير والأمانات).'
                        : "This wallet's balance will not be included in your overall total balance (useful for savings or trusts)."}
                    </span>
                  </div>
                  <div className="relative inline-flex items-center shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={excludeFromTotal}
                      onChange={(e) => setExcludeFromTotal(e.target.checked)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer peer z-10"
                      aria-label={isRTL ? 'استبعاد من الرصيد الإجمالي' : 'Exclude from Total Balance'}
                    />
                    <div
                      className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${
                        excludeFromTotal ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line)]'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                          excludeFromTotal
                            ? isRTL
                              ? '-translate-x-4'
                              : 'translate-x-4'
                            : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </div>
                </label>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 transition-opacity min-h-[44px]"
                >
                  {editingWallet ? t('submitSaveTransaction') : t('save')}
                </button>

                {editingWallet && (
                  <button
                    type="button"
                    onClick={() => handleRequestDeleteWallet(editingWallet)}
                    className="p-2.5 bg-[var(--color-expense)]/10 text-[var(--color-expense)] border border-[var(--color-expense)]/20 rounded-xl min-h-[44px] min-w-[44px] flex items-center justify-center"
                    title={t('deleteWallet')}
                    aria-label={t('deleteWallet')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set Wallet PIN Modal */}
      {settingPinForWallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 text-[var(--color-ink)] shadow-xl text-center">
            <Lock className="w-8 h-8 text-[var(--color-accent)] mx-auto mb-2" />
            <h3 className="text-sm font-bold mb-1">
              {isRTL ? (
                <>
                  تعيين رمز <bdi dir="ltr">PIN</bdi> لحماية المحفظة
                </>
              ) : (
                'Set PIN for Wallet'
              )}
            </h3>
            <p className="text-xs text-[var(--color-muted)] mb-2">
              {isRTL
                ? `أدخل 4 أرقام لقفل محفظة "${settingPinForWallet.name}"`
                : `Enter 4 digits to lock "${settingPinForWallet.name}"`}
            </p>
            <p className="text-[10px] text-[var(--color-muted)] mb-4 leading-relaxed">
              {isRTL
                ? 'قفل محلي للواجهة فقط لمنع التصفح العابر ولا يشفر بيانات التخزين.'
                : 'Local UI privacy lock only; does not encrypt device storage.'}
            </p>
            <input
              type="password"
              maxLength={4}
              value={newWalletPin}
              onChange={(e) => setNewWalletPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-32 mx-auto py-2 px-3 text-center tracking-widest text-lg font-mono bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl mb-4 focus:outline-none focus:border-[var(--color-accent)] min-h-[44px]"
            />
            <div className="flex items-center gap-2">
              <button
                disabled={newWalletPin.length !== 4}
                onClick={async () => {
                  const { hash, salt } = await hashPin(newWalletPin);
                  updateWallet(settingPinForWallet.id, { isLocked: true, pin: hash, pinSalt: salt });
                  setSettingPinForWallet(null);
                }}
                className="flex-1 py-2 bg-[var(--color-accent)] disabled:opacity-40 text-[var(--color-on-accent)] font-medium rounded-xl text-xs min-h-[44px]"
              >
                {isRTL ? 'حفظ القفل' : 'Save PIN'}
              </button>
              <button
                onClick={() => setSettingPinForWallet(null)}
                className="flex-1 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] font-medium rounded-xl text-xs min-h-[44px]"
              >
                {isRTL ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pin Unlock Modal when clicking locked wallet */}
      <PinLockModal
        isOpen={!!pinModalTargetWallet}
        lockoutKey={pinModalTargetWallet ? `wallet-${pinModalTargetWallet.id}` : 'wallet'}
        onCancel={() => setPinModalTargetWallet(null)}
        onVerify={
          pinModalTargetWallet
            ? (enteredPin) => unlockWallet(pinModalTargetWallet.id, enteredPin)
            : undefined
        }
        title={isRTL ? `فتح محفظة ${pinModalTargetWallet?.name || ''}` : `Unlock ${pinModalTargetWallet?.name || ''}`}
        onSuccess={() => {
          if (pinModalTargetWallet) {
            setQuickActionWalletId(pinModalTargetWallet.id);
            setPinModalTargetWallet(null);
          }
        }}
      />

      {/* Wallet Quick Actions Bottom Sheet */}
      <WalletQuickActionsSheet
        wallet={quickActionWallet}
        allWallets={wallets}
        isBalanceHidden={quickActionWallet ? Boolean(hiddenBalances[quickActionWallet.id]) : false}
        isRTL={isRTL}
        onClose={() => setQuickActionWalletId(null)}
        onDeposit={(w) => {
          const preset = buildWalletActionPreset(w, 'deposit', wallets);
          setQuickActionWalletId(null);
          if (preset) openTransactionWithPreset(preset);
        }}
        onWithdraw={(w) => {
          const preset = buildWalletActionPreset(w, 'withdraw', wallets);
          setQuickActionWalletId(null);
          if (preset) openTransactionWithPreset(preset);
        }}
        onTransfer={(w) => {
          const preset = buildWalletActionPreset(w, 'transfer', wallets);
          if (!preset) {
            showToast(
              isRTL
                ? 'أضف محفظة أخرى أولاً لإجراء تحويل بين المحافظ.'
                : 'Add another wallet first to transfer.',
              'warning'
            );
            return;
          }
          setQuickActionWalletId(null);
          openTransactionWithPreset(preset);
        }}
        onViewTransactions={(w) => {
          setQuickActionWalletId(null);
          setActiveWalletId(w.id);
        }}
        onEdit={(w) => {
          setQuickActionWalletId(null);
          handleOpenEdit(w);
        }}
        onToggleArchive={(w) => {
          const check = canToggleWalletArchive(w, wallets);
          if (!check.allowed) {
            showToast(isRTL ? check.reasonAr || '' : check.reasonEn || '', 'warning');
            return;
          }
          updateWallet(w.id, { isArchived: check.nextArchived });
          showToast(
            check.nextArchived
              ? isRTL
                ? `تم إيقاف محفظة "${w.name}" مؤقتاً واستبعادها من الإجمالي`
                : `Paused "${w.name}" and excluded from total`
              : isRTL
              ? `تمت إعادة تفعيل محفظة "${w.name}"`
              : `Resumed "${w.name}"`,
            'success'
          );
          setQuickActionWalletId(null);
        }}
        onDelete={handleRequestDeleteWallet}
      />

      {/* Delete Wallet Confirmation (No Dependencies) */}
      <ConfirmationModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) deleteWallet(confirmDeleteId);
        }}
        title={t('deleteWallet')}
        message={isRTL ? 'هل أنت متأكد من حذف هذه المحفظة؟' : 'Are you sure you want to delete this wallet?'}
        confirmLabel={isRTL ? 'حذف المحفظة' : 'Delete'}
        cancelLabel={isRTL ? 'إلغاء' : 'Cancel'}
      />

      {/* Safe Dependency Resolution Modal (Archive or Migrate & Delete) */}
      {dependencyWalletId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] p-5 space-y-4 shadow-xl"
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-[var(--color-warning-text)] shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-[var(--color-ink)]">
                  {isRTL ? 'المحفظة مرتبطة بسجلات مالية' : 'Wallet Has Linked Records'}
                </h3>
                <p className="text-xs text-[var(--color-muted)] mt-1 leading-relaxed">
                  {(() => {
                    const deps = getWalletDependencies(dependencyWalletId);
                    return isRTL
                      ? `تحتوي هذه المحفظة على ${deps.transactionsCount} معاملة و${deps.budgetsCount} ميزانية و${deps.templatesCount} قالب. اختر الأرشفة أو ترحيل السجلات لمحفظة أخرى قبل الحذف.`
                      : `This wallet has ${deps.transactionsCount} transaction(s), ${deps.budgetsCount} budget(s), and ${deps.templatesCount} template(s). Archive it or migrate records first.`;
                  })()}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1">
                {isRTL ? 'ترحيل السجلات إلى المحفظة:' : 'Migrate linked records to:'}
              </label>
              <select
                value={migrationTargetWalletId}
                onChange={(e) => setMigrationTargetWalletId(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs text-[var(--color-ink)] min-h-[42px]"
              >
                {wallets
                  .filter((w) => w.id !== dependencyWalletId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.currency})
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  updateWallet(dependencyWalletId, { isArchived: true });
                  setDependencyWalletId(null);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-bold flex items-center justify-center gap-1.5 min-h-[42px]"
              >
                <Archive className="w-4 h-4" />
                <span>{isRTL ? 'أرشفة المحفظة (آمن)' : 'Archive Wallet (Safe)'}</span>
              </button>

              <button
                type="button"
                disabled={!migrationTargetWalletId}
                onClick={() => {
                  migrateAndDeleteWallet(dependencyWalletId, migrationTargetWalletId);
                  setDependencyWalletId(null);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-[var(--color-expense)]/12 border border-[var(--color-expense)]/30 text-[var(--color-expense)] text-xs font-bold min-h-[42px] disabled:opacity-40"
              >
                {isRTL ? 'ترحيل السجلات وحذف المحفظة' : 'Migrate Records & Delete'}
              </button>

              <button
                type="button"
                onClick={() => setDependencyWalletId(null)}
                className="w-full py-2 rounded-xl text-xs text-[var(--color-muted)] min-h-[38px]"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
