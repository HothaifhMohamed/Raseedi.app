import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Plus,
  EyeOff,
  Lock,
  Trash2,
  Check,
  X,
  Crown,
  Sparkles,
  AlertTriangle,
  ArrowUpDown,
  Archive,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Wallet, WalletAssetClass, WalletAssetSubtype, WalletType } from '../../types';
import { IconRenderer } from '../common/IconRenderer';
import { AdBanner } from '../common/AdBanner';
import {
  formatCurrencyAmount,
  calculateTotalBalance,
  formatLocalDate,
  roundCurrency,
} from '../../services/calculations';
import {
  calculateBalanceAdjustment,
  calculateWealthBreakdown,
  getWalletAssetClass,
  WALLET_ASSET_SUBTYPES,
} from '../../services/wealthAnalytics';
import {
  applyWalletOrderIds,
  areWalletOrderIdsEqual,
  moveWalletById,
  moveWalletIdByIndex,
  reconcileDraftOrderIds,
  sortWalletsByOrder,
} from '../../services/walletOrder';
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
import { useScrollRestoration } from '../../hooks/useScrollRestoration';
import { WALLETS_SCROLL_STORAGE_KEY } from '../../services/scrollRestoration';
import { HairlineEmptyState } from '../common/HairlineVisuals';
import { shouldShowPersonalUpgradeUi } from '../../services/subscriptionHelpers';
import { WalletQuickActionsSheet } from './WalletQuickActionsSheet';
import { WalletCard } from './WalletCard';
import { AdjustBalanceModal } from './AdjustBalanceModal';

const SOLID_MUTED_PALETTE = [
  { id: 'emerald', label: 'بترولي زمردي', hex: '#0E5E58' },
  { id: 'teal', label: 'أخضر غابات', hex: '#1B4D3E' },
  { id: 'navy', label: 'كحلي ليلي', hex: '#1E3A4C' },
  { id: 'bronze', label: 'ذهبي برونزي', hex: '#7A5B2B' },
  { id: 'plum', label: 'خمري هادئ', hex: '#5D3746' },
  { id: 'charcoal', label: 'رمادي فحمي', hex: '#2F3B36' },
];

const WALLET_ICONS = ['Wallet', 'CreditCard', 'Landmark', 'Banknote', 'Coins', 'Vault'];

export const WalletsPage: React.FC = () => {
  const {
    wallets,
    debts,
    categories,
    settings,
    isOrgWorkspace,
    orgMembers,
    addWallet,
    updateWallet,
    addTransaction,
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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { handleScroll, saveScrollNow } = useScrollRestoration(
    containerRef,
    WALLETS_SCROLL_STORAGE_KEY,
    { restoreOnMount: true }
  );

  const [hiddenBalances, setHiddenBalances] = useState<Record<string, boolean>>({});
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [draftOrderIds, setDraftOrderIds] = useState<string[] | null>(null);
  const [pendingCommittedOrderIds, setPendingCommittedOrderIds] = useState<string[] | null>(null);
  const [draggingWalletId, setDraggingWalletId] = useState<string | null>(null);
  const draftOrderIdsRef = useRef<string[] | null>(null);
  const latestWalletsRef = useRef<Wallet[]>(wallets);
  latestWalletsRef.current = wallets;
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  const [quickActionWalletId, setQuickActionWalletId] = useState<string | null>(null);
  const [adjustBalanceWallet, setAdjustBalanceWallet] = useState<Wallet | null>(null);
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
  useModalBackHandler(adjustBalanceWallet !== null, () => setAdjustBalanceWallet(null), 'wallet-adjust-balance');
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
  const [assetClass, setAssetClass] = useState<WalletAssetClass>('spendable');
  const [assetSubtype, setAssetSubtype] = useState<WalletAssetSubtype>('cash');
  const [custodianMemberUid, setCustodianMemberUid] = useState('');
  const [excludeFromTotal, setExcludeFromTotal] = useState(false);

  const externalSortedWallets = useMemo(() => sortWalletsByOrder(wallets), [wallets]);

  // Keep live draft completely isolated from external `wallets` array reference changes
  // during reorder mode, and hold committed order briefly until external state confirms it.
  const displayedWallets = useMemo(() => {
    if (isReorderMode && draftOrderIds !== null) {
      return applyWalletOrderIds(wallets, draftOrderIds);
    }
    if (pendingCommittedOrderIds !== null) {
      return applyWalletOrderIds(wallets, pendingCommittedOrderIds);
    }
    return externalSortedWallets;
  }, [isReorderMode, draftOrderIds, pendingCommittedOrderIds, wallets, externalSortedWallets]);

  useEffect(() => {
    if (wallets.length <= 1 && isReorderMode) {
      activeDragCleanupRef.current?.();
      activeDragCleanupRef.current = null;
      draftOrderIdsRef.current = null;
      setDraftOrderIds(null);
      setDraggingWalletId(null);
      setIsReorderMode(false);
    }
  }, [wallets.length, isReorderMode]);

  useEffect(() => {
    if (isReorderMode || pendingCommittedOrderIds === null) return;
    if (areWalletOrderIdsEqual(externalSortedWallets, pendingCommittedOrderIds)) {
      setPendingCommittedOrderIds(null);
      return;
    }
    const fallbackTimer = window.setTimeout(() => {
      setPendingCommittedOrderIds(null);
    }, 4_000);
    return () => window.clearTimeout(fallbackTimer);
  }, [isReorderMode, pendingCommittedOrderIds, externalSortedWallets]);

  useEffect(() => {
    return () => {
      activeDragCleanupRef.current?.();
      activeDragCleanupRef.current = null;
    };
  }, []);

  const handleStartReorder = useCallback(() => {
    const initialIds = (pendingCommittedOrderIds
      ? applyWalletOrderIds(latestWalletsRef.current, pendingCommittedOrderIds)
      : sortWalletsByOrder(latestWalletsRef.current)
    ).map((w) => w.id);
    if (initialIds.length <= 1) return;
    draftOrderIdsRef.current = initialIds;
    setDraftOrderIds(initialIds);
    setPendingCommittedOrderIds(null);
    setDraggingWalletId(null);
    setIsReorderMode(true);
  }, [pendingCommittedOrderIds]);

  const handleCancelReorder = useCallback(() => {
    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = null;
    draftOrderIdsRef.current = null;
    setDraftOrderIds(null);
    setDraggingWalletId(null);
    setIsReorderMode(false);
  }, []);

  const handleCommitReorder = useCallback(() => {
    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = null;
    const finalDraftIds = draftOrderIdsRef.current;
    const finalOrdered = finalDraftIds
      ? applyWalletOrderIds(latestWalletsRef.current, finalDraftIds)
      : sortWalletsByOrder(latestWalletsRef.current);
    const committedIds = finalOrdered.map((w) => w.id);

    setPendingCommittedOrderIds(committedIds);
    draftOrderIdsRef.current = null;
    setDraftOrderIds(null);
    setDraggingWalletId(null);
    setIsReorderMode(false);

    if (finalOrdered.length > 1) {
      reorderWallets(finalOrdered);
    }
  }, [reorderWallets]);

  const handleMoveWallet = useCallback((walletId: string, direction: 'up' | 'down') => {
    setDraftOrderIds((prev) => {
      const base =
        prev ??
        draftOrderIdsRef.current ??
        sortWalletsByOrder(latestWalletsRef.current).map((w) => w.id);
      const reconciled = reconcileDraftOrderIds(base, latestWalletsRef.current);
      const next = moveWalletById(reconciled, walletId, direction);
      draftOrderIdsRef.current = next;
      return next;
    });
  }, []);

  const handleDragHandlePointerDown = useCallback(
    (activeWalletId: string, e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (!activeWalletId) return;

      e.preventDefault();
      e.stopPropagation();
      activeDragCleanupRef.current?.();

      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragEngaged = false;
      let lastSwappedTargetId: string | null = null;
      let lastSwapAt = 0;

      try {
        e.currentTarget.setPointerCapture(pointerId);
      } catch {
        // Ignore if pointer capture is unsupported in synthetic test events
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragEngaged) {
          if (Math.hypot(dx, dy) < 6) return;
          dragEngaged = true;
          setDraggingWalletId(activeWalletId);
        }

        // Smooth edge auto-scroll if dragging near top/bottom of scroll container
        const scroller = containerRef.current;
        if (scroller) {
          const scrollerRect = scroller.getBoundingClientRect();
          const edgeThreshold = 64;
          if (moveEvent.clientY < scrollerRect.top + edgeThreshold) {
            scroller.scrollTop -= 10;
          } else if (moveEvent.clientY > scrollerRect.bottom - edgeThreshold) {
            scroller.scrollTop += 10;
          }
        }

        const listEl = listRef.current;
        if (!listEl) return;

        const cards = listEl.querySelectorAll<HTMLElement>('[data-wallet-id]');
        let hoveredWalletId: string | null = null;
        for (let i = 0; i < cards.length; i += 1) {
          const card = cards[i];
          const rect = card.getBoundingClientRect();
          if (
            moveEvent.clientX >= rect.left &&
            moveEvent.clientX <= rect.right &&
            moveEvent.clientY >= rect.top &&
            moveEvent.clientY <= rect.bottom
          ) {
            hoveredWalletId = card.dataset.walletId || null;
            break;
          }
        }

        if (!hoveredWalletId || hoveredWalletId === activeWalletId) return;
        const now = Date.now();
        if (hoveredWalletId === lastSwappedTargetId && now - lastSwapAt < 140) {
          return;
        }

        setDraftOrderIds((prev) => {
          const base =
            prev ??
            draftOrderIdsRef.current ??
            sortWalletsByOrder(latestWalletsRef.current).map((w) => w.id);
          const reconciled = reconcileDraftOrderIds(base, latestWalletsRef.current);
          const fromIdx = reconciled.indexOf(activeWalletId);
          const toIdx = reconciled.indexOf(hoveredWalletId as string);
          if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
          const next = moveWalletIdByIndex(reconciled, fromIdx, toIdx);
          draftOrderIdsRef.current = next;
          lastSwappedTargetId = hoveredWalletId;
          lastSwapAt = now;
          return next;
        });
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerEnd);
        window.removeEventListener('pointercancel', handlePointerEnd);
        setDraggingWalletId(null);
        activeDragCleanupRef.current = null;
      };

      const handlePointerEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        cleanup();
      };

      activeDragCleanupRef.current = cleanup;
      window.addEventListener('pointermove', handlePointerMove, { passive: true });
      window.addEventListener('pointerup', handlePointerEnd);
      window.addEventListener('pointercancel', handlePointerEnd);
    },
    []
  );

  // Total balance across all wallets + Spendable vs Owned Assets breakdown
  const totalBalance = useMemo(() => {
    return calculateTotalBalance(displayedWallets, settings.mainCurrency, settings.customExchangeRates, {
      excludeDebts: settings.excludeDebtsFromBalance,
      debts,
    });
  }, [
    displayedWallets,
    settings.mainCurrency,
    settings.customExchangeRates,
    settings.ratesUpdatedAtMs,
    settings.excludeDebtsFromBalance,
    debts,
  ]);

  const wealthBreakdown = useMemo(
    () =>
      calculateWealthBreakdown({
        wallets: displayedWallets,
        debts,
        mainCurrency: settings.mainCurrency,
        customRates: settings.customExchangeRates,
      }),
    [displayedWallets, debts, settings.mainCurrency, settings.customExchangeRates]
  );

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
    setAssetClass('spendable');
    setAssetSubtype('cash');
    setCustodianMemberUid('');
    setExcludeFromTotal(false);
    setIsEditModalOpen(true);
  };

  const handleOpenEdit = (w: Wallet, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const resolvedClass = getWalletAssetClass(w);
    setEditingWallet(w);
    setWalletName(w.name);
    setWalletCurrency(w.currency);
    setInitialBalance(String(w.initialBalance));
    setWalletColor(w.color?.startsWith('#') ? w.color : SOLID_MUTED_PALETTE[0].hex);
    setWalletIcon(
      !w.icon ? 'Wallet' : w.icon === 'PiggyBank' || w.icon === 'Safe' ? 'Vault' : w.icon
    );
    setWalletType(w.walletType || 'standard');
    setAssetClass(resolvedClass);
    setAssetSubtype(w.assetSubtype || (resolvedClass === 'asset' ? 'savings' : 'cash'));
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
        assetClass,
        assetSubtype,
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
        assetClass,
        assetSubtype,
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

  const handleConfirmBalanceAdjustment = async (params: {
    wallet: Wallet;
    targetBalance: number;
    mode: 'transaction' | 'opening_balance';
    note: string;
  }) => {
    const plan = calculateBalanceAdjustment(
      params.wallet.balance,
      params.targetBalance,
      params.wallet.currency
    );
    if (!plan.transactionType || plan.absAmount <= 0) return;

    if (params.mode === 'opening_balance') {
      const nextInitial = roundCurrency(
        params.wallet.initialBalance + plan.delta,
        params.wallet.currency
      );
      updateWallet(params.wallet.id, { initialBalance: nextInitial });
      showToast(
        isRTL
          ? `تم تحديث رصيد "${params.wallet.name}" بنجاح`
          : `Updated balance for "${params.wallet.name}"`,
        'success'
      );
      return;
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fallbackCat =
      categories.find((c) => c.id === 'cat-other') ||
      categories.find((c) => c.type === plan.transactionType || c.type === 'both') ||
      categories[0];

    addTransaction({
      type: plan.transactionType,
      amount: plan.absAmount,
      currency: params.wallet.currency,
      date: formatLocalDate(now),
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      categoryId: fallbackCat?.id || 'cat-other',
      walletId: params.wallet.id,
      notes:
        params.note ||
        (isRTL ? `تسوية رصيد: ${params.wallet.name}` : `Balance adjustment: ${params.wallet.name}`),
      priority: 'normal',
      doesNotAffectBalance: false,
    });

    showToast(
      isRTL
        ? `تم تسجيل قيد تسوية لرصيد "${params.wallet.name}"`
        : `Recorded balance adjustment for "${params.wallet.name}"`,
      'success'
    );
  };

  // Tap wallet card logic: save scroll position, check if locked first, else open quick actions menu
  const handleCardClick = useCallback(
    (w: Wallet) => {
      saveScrollNow();
      if (w.isLocked && w.pin && lockedWalletIds.includes(w.id)) {
        setPinModalTargetWallet(w);
      } else {
        setQuickActionWalletId(w.id);
      }
    },
    [lockedWalletIds, saveScrollNow]
  );

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

  const handleToggleLock = (w: Wallet) => {
    if (w.isLocked) {
      updateWallet(w.id, { isLocked: false, pin: undefined, pinSalt: undefined });
      showToast(
        isRTL ? `تم إلغاء قفل محفظة "${w.name}"` : `Lock removed from "${w.name}"`,
        'success'
      );
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
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-testid="wallets-page-scroll-container"
      className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-3 pb-24 space-y-4"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Total Balance Header Card */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] shadow-xs space-y-3 transition-all duration-300">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-[var(--color-muted)] block mb-1">
              {t('totalWalletsBalance')}
            </span>
            <div
              data-testid="wallets-total-balance"
              className="text-2xl sm:text-3xl font-bold text-[var(--color-ink)] num-tabular tracking-tight"
            >
              {formatCurrencyAmount(totalBalance, settings.mainCurrency, {
                decimalPlaces: settings.decimalPlaces,
                digitFormat: settings.digitFormat,
                language: settings.language,
              })}
            </div>
            {wallets.some((w) => !w.isArchived && w.excludeFromTotal) && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--color-muted)]">
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
            data-testid="add-wallet-btn"
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold rounded-2xl text-xs hover:opacity-95 active:scale-95 transition-all duration-300 min-h-[44px] shrink-0 shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>{t('addWallet')}</span>
            {shouldShowPersonalUpgradeUi(subscriptionSummary) && wallets.length >= 3 && (
              <Crown className="w-3.5 h-3.5 ms-0.5 text-[var(--color-gold)] dark:text-[var(--color-on-accent)]" />
            )}
          </button>
        </div>

        {/* Spendable vs Owned Assets Split Summary (Personal or whenever Owned Assets exist) */}
        {(!isOrgWorkspace || wealthBreakdown.ownedAssetsCount > 0) && (
          <div
            data-testid="wallets-wealth-split"
            className="pt-3 border-t border-[var(--color-line)] grid grid-cols-2 gap-2.5 text-xs"
          >
            <div className="rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]/80 px-3 py-2">
              <span className="block text-[11px] font-semibold text-[var(--color-muted)]">
                {isRTL ? 'متاح للصرف (سيولة)' : 'Spendable Cash'}
              </span>
              <span className="mt-0.5 block text-sm font-extrabold text-[var(--color-ink)] num-tabular">
                {formatCurrencyAmount(wealthBreakdown.spendableTotal, settings.mainCurrency, {
                  decimalPlaces: settings.decimalPlaces,
                  digitFormat: settings.digitFormat,
                  language: settings.language,
                })}
              </span>
            </div>
            <div className="rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)]/80 px-3 py-2">
              <span className="block text-[11px] font-semibold text-[var(--color-gold-text)]">
                {isRTL ? 'أصول ومدخرات وممتلكات' : 'Owned Assets'}
              </span>
              <span className="mt-0.5 block text-sm font-extrabold text-[var(--color-ink)] num-tabular">
                {formatCurrencyAmount(wealthBreakdown.ownedAssetsTotal, settings.mainCurrency, {
                  decimalPlaces: settings.decimalPlaces,
                  digitFormat: settings.digitFormat,
                  language: settings.language,
                })}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Free limit hint if at 3 wallets and eligible for Personal upgrade */}
      {shouldShowPersonalUpgradeUi(subscriptionSummary) && wallets.length >= 3 && (
        <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>{isRTL ? 'وصلت للحد الأقصى المجاني (3 محافظ)' : 'Free limit reached (3 wallets)'}</span>
          <button
            onClick={() => setIsUpgradeModalOpen(true)}
            className="text-[var(--color-accent)] font-semibold hover:underline flex items-center gap-1 min-h-[36px]"
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
              ? 'اسحب المقبض أو استخدم الأسهم ثم اضغط تم الترتيب'
              : 'Drag handle or tap arrows, then tap Done'
            : `${isRTL ? 'المحافظ' : 'Wallets'} (${displayedWallets.length})`}
        </span>

        {displayedWallets.length > 1 && (
          <div className="flex items-center gap-1.5 shrink-0">
            {isReorderMode && (
              <button
                type="button"
                onClick={handleCancelReorder}
                data-testid="cancel-reorder-wallets"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold border bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-line)] hover:text-[var(--color-ink)] transition-colors duration-200 min-h-[40px]"
              >
                <X className="w-3.5 h-3.5" />
                <span>{isRTL ? 'إلغاء' : 'Cancel'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={isReorderMode ? handleCommitReorder : handleStartReorder}
              aria-pressed={isReorderMode}
              data-testid="toggle-reorder-wallets"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all duration-300 min-h-[40px] ${
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
          </div>
        )}
      </div>

      {/* Wallets Cards List (Clean Credit Card Style) */}
      {displayedWallets.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl">
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
                className="flex items-center gap-1.5 px-4 py-2.5 bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium rounded-xl text-xs hover:opacity-95 min-h-[44px]"
              >
                <Plus className="w-4 h-4" />
                <span>{t('addWallet')}</span>
              </button>
            }
          />
        </div>
      ) : (
      <div
        ref={listRef}
        className="grid grid-cols-1 md:grid-cols-2 gap-3.5"
        data-testid="wallets-card-list"
      >
        {displayedWallets.map((w, index) => {
          const isHidden = Boolean(hiddenBalances[w.id]);
          const isLocked = Boolean(w.isLocked && lockedWalletIds.includes(w.id));
          const custodianName =
            isOrgWorkspace && w.walletType === 'petty_cash' && w.custodianMemberUid
              ? orgMembers.find((m) => m.uid === w.custodianMemberUid)?.displayName || ''
              : undefined;

          return (
            <WalletCard
              key={w.id}
              wallet={w}
              index={index}
              totalCount={displayedWallets.length}
              isReorderMode={isReorderMode}
              isDragging={draggingWalletId === w.id}
              isLocked={isLocked}
              isHidden={isHidden}
              mainCurrency={settings.mainCurrency}
              customExchangeRates={settings.customExchangeRates}
              isOrgWorkspace={isOrgWorkspace}
              custodianName={custodianName}
              isRTL={isRTL}
              onSelect={handleCardClick}
              onMove={handleMoveWallet}
              onDragHandlePointerDown={handleDragHandlePointerDown}
            />
          );
        })}
      </div>
      )}

      {/* Free-tier calm bottom banner */}
      <AdBanner variant="banner" />

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

              {/* Spendable vs Owned Asset Classification */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[var(--color-ink)]">
                  {isRTL ? 'تصنيف الحساب / الأصل' : 'Account / Asset Category'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="wallet-class-spendable"
                    onClick={() => {
                      setAssetClass('spendable');
                      if (!WALLET_ASSET_SUBTYPES.some((s) => s.id === assetSubtype && s.assetClass === 'spendable')) {
                        setAssetSubtype('cash');
                      }
                    }}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                      assetClass === 'spendable'
                        ? 'bg-[var(--color-accent)]/12 border-[var(--color-accent)] text-[var(--color-accent)]'
                        : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    {isRTL ? 'متاح للصرف (سيولة)' : 'Spendable Money'}
                  </button>
                  <button
                    type="button"
                    data-testid="wallet-class-asset"
                    onClick={() => {
                      setAssetClass('asset');
                      if (!WALLET_ASSET_SUBTYPES.some((s) => s.id === assetSubtype && s.assetClass === 'asset')) {
                        setAssetSubtype('gold');
                      }
                    }}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                      assetClass === 'asset'
                        ? 'bg-[var(--color-gold-soft)] border-[var(--color-gold)] text-[var(--color-gold-text)]'
                        : 'bg-[var(--color-bg)] border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    {isRTL ? 'أصول ومدخرات وممتلكات' : 'Owned Assets'}
                  </button>
                </div>
                <select
                  data-testid="wallet-subtype-select"
                  value={assetSubtype}
                  onChange={(e) => {
                    const nextSub = e.target.value as WalletAssetSubtype;
                    setAssetSubtype(nextSub);
                    const meta = WALLET_ASSET_SUBTYPES.find((s) => s.id === nextSub);
                    if (meta && WALLET_ICONS.includes(meta.defaultIcon)) {
                      setWalletIcon(meta.defaultIcon);
                    }
                  }}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl text-xs font-semibold text-[var(--color-ink)] min-h-[44px]"
                >
                  {WALLET_ASSET_SUBTYPES.filter((s) => s.assetClass === assetClass).map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {isRTL ? sub.labelAr : sub.labelEn}
                    </option>
                  ))}
                </select>
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
        onAdjustBalance={(w) => {
          setQuickActionWalletId(null);
          setAdjustBalanceWallet(w);
        }}
        onViewTransactions={(w) => {
          saveScrollNow();
          setQuickActionWalletId(null);
          setActiveWalletId(w.id);
        }}
        onEdit={(w) => {
          setQuickActionWalletId(null);
          handleOpenEdit(w);
        }}
        onAddWallet={() => {
          setQuickActionWalletId(null);
          handleOpenAdd();
        }}
        onToggleHideBalance={(w) => {
          toggleHideWalletBalance(w.id);
        }}
        onToggleLock={(w) => {
          setQuickActionWalletId(null);
          handleToggleLock(w);
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

      {/* Adjust Balance Modal */}
      <AdjustBalanceModal
        wallet={adjustBalanceWallet}
        isRTL={isRTL}
        decimalPlaces={settings.decimalPlaces}
        digitFormat={settings.digitFormat}
        language={settings.language}
        onClose={() => setAdjustBalanceWallet(null)}
        onConfirmAdjustment={handleConfirmBalanceAdjustment}
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
