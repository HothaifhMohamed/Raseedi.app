import React, { createContext, useContext } from 'react';
import type { PlanTier, VerifiedProEntitlement } from '../types';
import type { ScanQuotaInfo } from '../services/firebase';

export interface EntitlementContextValue {
  isPro: boolean;
  isBusinessPro: boolean;
  planTier: PlanTier;
  proEntitlement: VerifiedProEntitlement | null;
  scanQuota: ScanQuotaInfo | null;
  setScanQuota: React.Dispatch<React.SetStateAction<ScanQuotaInfo | null>>;
  refreshScanQuota: () => Promise<void>;
  isUpgradeModalOpen: boolean;
  setIsUpgradeModalOpen: (open: boolean) => void;
  redeemProCode: (code: string, orgId?: string) => Promise<{ ok: boolean; error?: string }>;
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
