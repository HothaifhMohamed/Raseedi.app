import {
  AuditLogAction,
  AuditLogEntry,
  Organization,
  OrganizationIndustry,
  OrganizationMember,
  OrgWorkspaceData,
  Transaction,
  Wallet,
} from '../types';
import { convertCurrency, fromMinor, roundCurrency, toMinor } from './currency';
import { getEffectiveTransactionAmount } from './calculations';
import { createStarterCostCentersForIndustry, createStarterOrgCategories } from './db';
import { DAY_MS, computeOrgSeatLimit, normalizeApprovalStatus } from './entitlements';

export interface LocalOrgActor {
  uid: string;
  name: string;
  email?: string;
}

export function buildLocalOrgWorkspace(params: {
  name: string;
  currency: string;
  industry?: OrganizationIndustry;
  vatRate?: number;
  taxNumber?: string;
  approvalThreshold?: number;
  loadSampleData?: boolean;
  actor: LocalOrgActor;
  now?: number;
  preferredOrgId?: string;
}): OrgWorkspaceData {
  const now = params.now ?? Date.now();
  const orgId =
    params.preferredOrgId?.trim() ||
    `org-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const cleanCurrency = (params.currency || 'EGP').trim().toUpperCase() || 'EGP';
  const cleanIndustry: OrganizationIndustry = params.industry || 'general';
  const cleanName = params.name.trim() || 'مؤسستي';
  const loadSample = Boolean(params.loadSampleData);

  const organization: Organization = {
    id: orgId,
    name: cleanName,
    currency: cleanCurrency,
    mainCurrency: cleanCurrency,
    industry: cleanIndustry,
    vatRate: Number.isFinite(Number(params.vatRate)) ? Number(params.vatRate) : 14,
    approvalThreshold: Number.isFinite(Number(params.approvalThreshold))
      ? Number(params.approvalThreshold)
      : 2000,
    ...(params.taxNumber?.trim() ? { taxNumber: params.taxNumber.trim() } : {}),
    ownerUid: params.actor.uid,
    ownerId: params.actor.uid,
    planTier: 'business_pro',
    billingCycle: 'trial',
    plan: 'trial',
    expiresAt: now + 14 * DAY_MS,
    trialEndsAt: now + 14 * DAY_MS,
    seatLimit: computeOrgSeatLimit(0),
    maxSeats: computeOrgSeatLimit(0),
    extraSeats: 0,
    aiScansUsed: 0,
    aiScansLimit: 100,
    localFirstMode: true,
    createdAt: now,
    updatedAt: now,
  };

  const wallets: Wallet[] = [
    {
      id: `org-w-cash-${now}`,
      name: 'الخزينة الرئيسية',
      currency: cleanCurrency,
      initialBalance: 0,
      initialBalanceMinor: 0,
      balance: 0,
      balanceMinor: 0,
      color: '#3A605B',
      icon: 'Wallet',
      isArchived: false,
      order: 1,
      walletType: 'standard',
    },
  ];

  const categories = createStarterOrgCategories(cleanIndustry);
  const costCenters = createStarterCostCentersForIndustry(orgId, cleanIndustry, loadSample, now);

  const ownerMember: OrganizationMember = {
    uid: params.actor.uid,
    email: params.actor.email || `${params.actor.uid}@local.raseedi`,
    displayName: params.actor.name || 'Owner',
    role: 'owner',
    status: 'active',
    joinedAt: now,
    updatedAt: now,
  };

  const initialAuditLog: AuditLogEntry = {
    id: `log-${now}-${Math.random().toString(36).slice(2, 6)}`,
    orgId,
    action: 'create',
    entityType: 'organization',
    entityId: orgId,
    actorUid: params.actor.uid,
    actorName: params.actor.name || 'Owner',
    summary: `تأسيس مساحة عمل المؤسسة: ${cleanName}`,
    timestamp: now,
  };

  return {
    organization,
    members: [ownerMember],
    costCenters,
    parties: [],
    wallets,
    categories,
    transactions: [],
    budgets: [],
    debts: [],
    goals: [],
    templates: [],
    auditLogs: [initialAuditLog],
  };
}

export function appendLocalOrgAuditLog(
  ws: OrgWorkspaceData,
  action: AuditLogAction,
  entityType: AuditLogEntry['entityType'],
  entityId: string,
  actor: LocalOrgActor,
  summary: string,
  before?: unknown,
  after?: unknown
): AuditLogEntry[] {
  const now = Date.now();
  const entry: AuditLogEntry = {
    id: `log-${now}-${Math.random().toString(36).slice(2, 7)}`,
    orgId: ws.organization.id,
    action,
    entityType,
    entityId,
    actorUid: actor.uid,
    actorName: actor.name || 'Member',
    summary,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    timestamp: now,
  };
  return [entry, ...(ws.auditLogs || [])].slice(0, 200);
}

export function doesOrgTxCountTowardBalance(tx: Transaction): boolean {
  if (tx.doesNotAffectBalance || tx.deletedAt) return false;
  const status = normalizeApprovalStatus(tx.approvalStatus);
  return !status || status === 'approved' || status === 'paid';
}

export function applyOrgTxBalanceToWallets(
  wallets: Wallet[],
  tx: Transaction,
  customRates: Record<string, number>,
  direction: 1 | -1
): Wallet[] {
  if (!doesOrgTxCountTowardBalance(tx)) return wallets;

  const effectiveAmount = getEffectiveTransactionAmount(tx);
  return wallets.map((w) => {
    let delta = 0;

    if (w.id === tx.walletId) {
      const converted = convertCurrency(effectiveAmount, tx.currency, w.currency, customRates);
      const feeConverted =
        tx.type === 'transfer' && tx.transferFee
          ? convertCurrency(tx.transferFee, tx.currency, w.currency, customRates)
          : 0;
      const rawDelta =
        tx.type === 'income'
          ? converted
          : tx.type === 'expense'
          ? -converted
          : -(converted + feeConverted);
      delta += rawDelta * direction;
    }

    if (tx.type === 'transfer' && tx.toWalletId && w.id === tx.toWalletId) {
      const destAmt =
        tx.convertedAmount !== undefined
          ? tx.convertedAmount
          : convertCurrency(effectiveAmount, tx.currency, w.currency, customRates);
      delta += destAmt * direction;
    }

    if (delta === 0) return w;
    const nextBalance = roundCurrency(w.balance + delta, w.currency);
    return {
      ...w,
      balance: nextBalance,
      balanceMinor: toMinor(nextBalance, w.currency),
    };
  });
}

export function recalculateLocalOrgWallets(
  ws: OrgWorkspaceData,
  customRates: Record<string, number>,
  actor: LocalOrgActor
): OrgWorkspaceData {
  let wallets: Wallet[] = (ws.wallets || []).map((w) => {
    const initial = Number(w.initialBalance || 0);
    return {
      ...w,
      balance: roundCurrency(initial, w.currency),
      balanceMinor: toMinor(initial, w.currency),
    };
  });

  for (const tx of ws.transactions || []) {
    wallets = applyOrgTxBalanceToWallets(wallets, tx, customRates, 1);
  }

  wallets = wallets.map((w) => {
    const minor = toMinor(w.balance, w.currency);
    return {
      ...w,
      balance: fromMinor(minor, w.currency),
      balanceMinor: minor,
    };
  });

  return {
    ...ws,
    wallets,
    auditLogs: appendLocalOrgAuditLog(
      ws,
      'recalculate',
      'organization',
      ws.organization.id,
      actor,
      'إعادة احتساب أرصدة الخزائن والمحافظ من المعاملات المعتمدة'
    ),
  };
}

export interface UnmigratedOrgExtrasSummary {
  debtsCount: number;
  goalsCount: number;
  templatesCount: number;
  totalCount: number;
  hasUnmigratedExtras: boolean;
}

export function getUnmigratedOrgExtrasSummary(
  ws: OrgWorkspaceData | null | undefined
): UnmigratedOrgExtrasSummary {
  const debtsCount = Array.isArray(ws?.debts) ? ws.debts.length : 0;
  const goalsCount = Array.isArray(ws?.goals) ? ws.goals.length : 0;
  const templatesCount = Array.isArray(ws?.templates) ? ws.templates.length : 0;
  const totalCount = debtsCount + goalsCount + templatesCount;
  return {
    debtsCount,
    goalsCount,
    templatesCount,
    totalCount,
    hasUnmigratedExtras: totalCount > 0,
  };
}

export function isRetainedExtrasOnlyWorkspace(
  ws: OrgWorkspaceData | null | undefined
): boolean {
  return Boolean(ws?.organization?.retainedLocalExtrasOnly);
}

/**
 * Retains only unmigrated local-only collections (`debts`, `goals`, `templates`)
 * under the migrated Cloud Org ID so zero user records are lost while avoiding
 * duplicate organizations or stale local financial data in workspace switchers.
 */
export function retainUnmigratedLocalOrgExtras(
  ws: OrgWorkspaceData,
  cloudOrgId?: string,
  now = Date.now()
): OrgWorkspaceData {
  const targetId = (cloudOrgId || '').trim() || ws.organization.id;
  return {
    organization: {
      ...ws.organization,
      id: targetId,
      localFirstMode: false,
      cloudBackedUpAt: now,
      migratedToCloudOrgId: targetId,
      retainedLocalExtrasOnly: true,
      updatedAt: now,
    },
    members: [],
    costCenters: [],
    parties: [],
    wallets: [],
    categories: [],
    transactions: [],
    budgets: [],
    debts: Array.isArray(ws.debts) ? ws.debts : [],
    goals: Array.isArray(ws.goals) ? ws.goals : [],
    templates: Array.isArray(ws.templates) ? ws.templates : [],
    auditLogs: [],
  };
}

export function formatUnmigratedOrgExtrasNotice(
  summary: UnmigratedOrgExtrasSummary,
  isRTL: boolean
): string {
  if (!summary.hasUnmigratedExtras) return '';
  const parts: string[] = [];
  if (summary.debtsCount > 0) {
    parts.push(isRTL ? `${summary.debtsCount} دين` : `${summary.debtsCount} debt(s)`);
  }
  if (summary.goalsCount > 0) {
    parts.push(isRTL ? `${summary.goalsCount} هدف` : `${summary.goalsCount} goal(s)`);
  }
  if (summary.templatesCount > 0) {
    parts.push(isRTL ? `${summary.templatesCount} قالب` : `${summary.templatesCount} template(s)`);
  }
  const joined = parts.join(isRTL ? ' و ' : ', ');
  return isRTL
    ? `تم الاحتفاظ محلياً بأمان بـ (${joined}) لعدم نقلها إلى سحابة المؤسسة.`
    : `Safely retained (${joined}) locally on this device since Cloud Orgs do not sync these items yet.`;
}

