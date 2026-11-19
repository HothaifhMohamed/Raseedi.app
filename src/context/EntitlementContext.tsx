import React, { createContext, useContext } from 'react';
import type { PlanTier, VerifiedProEntitlement } from '../types';
import type { ScanQuotaInfo } from '../services/firebase';
import type { UserSubscriptionSummary } from '../services/subscriptionHelpers';

export interface EntitlementContextValue {
  isPro: boolean;
  isBusinessPro: boolean;
  planTier: PlanTier;
  proEntitlement: VerifiedProEntitlement | null;
  subscriptionSummary: UserSubscriptionSummary;
  isAdminUser: boolean;
  isAdminCodeModalOpen: boolean;
  setIsAdminCodeModalOpen: (open: boolean) => void;
  openAdminPanel: () => void;
  scanQuota: ScanQuotaInfo | null;
  setScanQuota: React.Dispatch<React.SetStateAction<ScanQuotaInfo | null>>;
  refreshScanQuota: () => Promise<void>;
  isUpgradeModalOpen: boolean;
  setIsUpgradeModalOpen: (open: boolean) => void;
  startBusinessTrial: (orgId?: string) => Promise<{ ok: boolean; error?: string }>;
  devActivateProPreview: (tier?: 'personal_pro' | 'business_pro') => void;
  restorePurchases: () => Promise<boolean>;
}

const EntitlementContext = createContext<EntitlementContextValue | undefined>(undefined);

export const EntitlementProvider: React.FC<{
  value: EntitlementContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>
);

export function useEntitlement(): EntitlementContextValue {
  const ctx = useContext(EntitlementContext);
  if (!ctx) {
    throw new Error('useEntitlement must be used within EntitlementProvider');
  }
  return ctx;
}
