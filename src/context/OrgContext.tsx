import React, { createContext, useContext } from 'react';
import type {
  AuditLogEntry,
  BusinessParty,
  CostCenter,
  Organization,
  OrganizationIndustry,
  OrganizationInvite,
  OrganizationMember,
  OrganizationRole,
  OrgRef,
  OrgWorkspaceData,
  Transaction,
} from '../types';
import type { OrgSubscriptionState } from '../services/entitlements';

export type OrgHubTab = 'approvals' | 'cost_centers' | 'parties' | 'team' | 'reports';

export interface OrgContextValue {
  activeWorkspace: string;
  orgRefs: OrgRef[];
  isOrgWorkspace: boolean;
  isOrgLoading: boolean;
  orgSyncPendingWrites: boolean;
  orgActionError: string | null;
  clearOrgActionError: () => void;
  orgTrashTransactions: Transaction[];
  orgHasMoreTx: boolean;
  loadMoreOrgTransactions: () => Promise<void>;
  organizationsList: Organization[];
  activeOrganization: Organization | null;
  activeOrgSubscriptionState: OrgSubscriptionState | null;
  isOrgReadOnly: boolean;
  activeOrgMemberStatus: 'active' | 'suspended' | 'invited' | null;
  orgMembers: OrganizationMember[];
  orgCostCenters: CostCenter[];
  orgParties: BusinessParty[];
  orgAuditLogs: AuditLogEntry[];
  activeOrgRole: OrganizationRole | null;
  canOrgWrite: boolean;
  canOrgApprove: boolean;
  canOrgManage: boolean;
  pendingApprovalsCount: number;
  switchWorkspace: (workspaceId: string) => void;
  createOrganization: (params: {
    name: string;
    currency: string;
    industry?: OrganizationIndustry;
    vatRate?: number;
    taxNumber?: string;
    approvalThreshold?: number;
    loadSampleData?: boolean;
  }) => Promise<Organization>;
  joinOrganizationByCode: (
    inviteCode: string
  ) => Promise<{ ok: boolean; orgId?: string; orgName?: string; error?: string }>;
  pendingJoinCode: string | null;
  clearPendingJoinCode: () => void;
  updateOrganizationSettings: (updates: Partial<Organization>) => void;
  lockAccountingPeriod: (lockedUntilDate: string | undefined) => void;

  legacyLocalOrgs: OrgWorkspaceData[];
  isOrgMigrationModalOpen: boolean;
  openOrgMigrationModal: () => void;
  dismissLegacyOrgMigration: () => void;
  completeLegacyOrgMigration: (migratedOrgIds: string[]) => Promise<void>;
  queueLegacyOrgsForMigration: (workspaces: Record<string, OrgWorkspaceData>) => void;

  approveOrgTransaction: (txId: string) => void;
  rejectOrgTransaction: (txId: string, reason: string) => void;
  markOrgTransactionPaid: (txId: string) => void;
  restoreOrgTransaction: (txId: string) => void;
  recalculateOrgBalances: () => Promise<void>;
  attachOrgReceiptPaths: (
    txId: string,
    attachmentPaths: string[],
    fallbackTx?: Transaction
  ) => Promise<void>;
  addCostCenter: (data: Omit<CostCenter, 'id' | 'orgId' | 'createdAt'>) => CostCenter | null;
  updateCostCenter: (id: string, updates: Partial<CostCenter>) => void;
  deleteCostCenter: (id: string) => void;
  addBusinessParty: (data: Omit<BusinessParty, 'id' | 'orgId' | 'createdAt'>) => BusinessParty | null;
  updateBusinessParty: (id: string, updates: Partial<BusinessParty>) => void;
  deleteBusinessParty: (id: string) => void;

  createOrgInvite: (
    role: Exclude<OrganizationRole, 'owner'>,
    expiresInDays?: number,
    maxUses?: number
  ) => Promise<{ invite: OrganizationInvite; code: string }>;
  listOrgInvites: () => Promise<OrganizationInvite[]>;
  revokeOrgInvite: (inviteId: string) => Promise<void>;
  manageOrgMember: (params: {
    targetUid: string;
    action: 'change_role' | 'suspend' | 'reactivate' | 'remove' | 'set_spending_limit';
    role?: Exclude<OrganizationRole, 'owner'>;
    spendingLimit?: number | null;
    department?: string;
  }) => Promise<void>;
  transferOrgOwnership: (newOwnerUid: string) => Promise<void>;
  deleteOrganization: (confirmName: string) => Promise<void>;

  isOrgHubOpen: boolean;
  setIsOrgHubOpen: (open: boolean) => void;
  orgHubTab: OrgHubTab;
  setOrgHubTab: (tab: OrgHubTab) => void;
  openOrgHub: (tab?: OrgHubTab) => void;
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined);

export const OrgProvider: React.FC<{
  value: OrgContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error('useOrg must be used within OrgProvider');
  }
  return ctx;
}
