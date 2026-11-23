import type { PlanTier } from '../types';
import {
  shouldShowAds,
  type ShouldShowAdsOptions,
  type UserSubscriptionSummary,
} from './subscriptionHelpers';

export const MONETAG_ZONE_ID = '12336201';
export const MONETAG_SCRIPT_SRC = 'https://nap5k.com/tag.min.js';
export const MONETAG_SCRIPT_ID = `raseedi-monetag-zone-${MONETAG_ZONE_ID}`;
export const MONETAG_META_VERIFICATION = '28dce08c56e1ff333a8ef6b51ff91fe0';

export interface ResolveMonetagEligibilityParams {
  subscriptionSummary: Pick<
    UserSubscriptionSummary,
    'isPro' | 'isAdminOverride'
  > & {
    isBusinessPro?: boolean;
    planTier?: PlanTier;
  };
  isProFlag?: boolean;
  creditsAdFreeActive?: boolean;
  activeOrgSubscriptionState?: ShouldShowAdsOptions['activeOrgSubscriptionState'];
  hasConsent: boolean;
  isOnline: boolean;
  /** True only after onboarding/auth/PIN-lock are cleared so tags never appear on Splash/AuthGate/Lock. */
  isMainShellReady: boolean;
  /** True once cloud/subscription entitlement finished resolving for signed-in users. */
  isEntitlementResolved?: boolean;
}

/**
 * Strictly gates Monetag zone `12336201` (`https://nap5k.com/tag.min.js`) to
 * eligible Free-tier sessions only.
 *
 * Returns `false` for:
 * - PRO, Business PRO, Admin, and active paid/trial Organization subscribers
 * - Free users with an active 24h Credits Ad-Free or 24h PRO Pass
 * - Users who declined/disabled ads (`hasConsent === false`)
 * - Offline sessions (`isOnline === false`)
 * - Unauthenticated / AuthGate / Splash / Onboarding / PIN-Lock states
 * - Signed-in sessions whose entitlement is still loading
 */
export function shouldLoadMonetagZone(
  params: ResolveMonetagEligibilityParams
): boolean {
  if (
    !params.isMainShellReady ||
    params.isEntitlementResolved === false ||
    !params.hasConsent ||
    !params.isOnline
  ) {
    return false;
  }

  return shouldShowAds(params.subscriptionSummary, {
    isProFlag: params.isProFlag,
    creditsAdFreeActive: params.creditsAdFreeActive,
    activeOrgSubscriptionState: params.activeOrgSubscriptionState,
  });
}

export type MonetagSyncOutcome = 'injected' | 'already-loaded' | 'removed' | 'idle';

export interface MinimalDomNode {
  parentNode: { removeChild(child: MinimalDomNode): unknown } | null;
  remove?: () => void;
  id?: string;
  src?: string;
  async?: boolean;
  referrerPolicy?: string;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
}

export interface MinimalDocumentLike {
  body?: { appendChild(child: MinimalDomNode): unknown } | null;
  head?: { appendChild(child: MinimalDomNode): unknown } | null;
  documentElement?: { appendChild(child: MinimalDomNode): unknown } | null;
  createElement(tagName: string): MinimalDomNode;
  querySelectorAll(selector: string): ArrayLike<MinimalDomNode>;
}

const MONETAG_SCRIPT_SELECTOR = `script#${MONETAG_SCRIPT_ID}, script[src*="nap5k.com/tag.min.js"], script[data-zone="${MONETAG_ZONE_ID}"]`;
const MONETAG_ARTIFACT_SELECTOR = `[data-monetag-zone="${MONETAG_ZONE_ID}"], iframe[src*="nap5k.com"]`;

function removeDomNode(node: MinimalDomNode): void {
  if (typeof node.remove === 'function') {
    node.remove();
  } else if (node.parentNode) {
    node.parentNode.removeChild(node);
  }
}

/**
 * Idempotently injects or tears down the Monetag zone `12336201` script.
 * - Guarantees at most ONE `<script data-zone="12336201" src="https://nap5k.com/tag.min.js">`
 *   in the document (never duplicates across tab switches or re-renders).
 * - Immediately removes the script and any Monetag iframe/zone container whenever
 *   `enabled` transitions to `false` (PRO/Business/Admin/Org/Ad-Free/Logout/Offline),
 *   without touching the `<meta name="monetag">` verification tag.
 */
export function syncMonetagZoneScript(
  enabled: boolean,
  doc: MinimalDocumentLike | null = typeof document !== 'undefined' ? document : null
): MonetagSyncOutcome {
  if (!doc) return 'idle';

  const existingScripts = Array.from(doc.querySelectorAll(MONETAG_SCRIPT_SELECTOR));

  if (!enabled) {
    const existingArtifacts = Array.from(doc.querySelectorAll(MONETAG_ARTIFACT_SELECTOR));
    if (existingScripts.length === 0 && existingArtifacts.length === 0) {
      return 'idle';
    }
    existingScripts.forEach(removeDomNode);
    existingArtifacts.forEach(removeDomNode);
    return 'removed';
  }

  // Deduplicate if multiple matching scripts somehow exist
  if (existingScripts.length > 0) {
    const [primary, ...duplicates] = existingScripts;
    duplicates.forEach(removeDomNode);
    const primaryZone = primary.getAttribute?.('data-zone');
    const primarySrc = primary.getAttribute?.('src') || primary.src || '';
    if (primaryZone === MONETAG_ZONE_ID && primarySrc.includes('nap5k.com/tag.min.js')) {
      return 'already-loaded';
    }
    removeDomNode(primary);
  }

  const mountTarget = doc.body || doc.head || doc.documentElement;
  if (!mountTarget) return 'idle';

  const script = doc.createElement('script');
  script.id = MONETAG_SCRIPT_ID;
  script.src = MONETAG_SCRIPT_SRC;
  script.async = true;
  script.referrerPolicy = 'no-referrer-when-downgrade';
  script.setAttribute?.('src', MONETAG_SCRIPT_SRC);
  script.setAttribute?.('data-zone', MONETAG_ZONE_ID);
  script.setAttribute?.('data-cfasync', 'false');
  script.setAttribute?.('data-ad-network', 'monetag');

  mountTarget.appendChild(script);
  return 'injected';
}

export function teardownMonetagZoneScript(
  doc: MinimalDocumentLike | null = typeof document !== 'undefined' ? document : null
): MonetagSyncOutcome {
  return syncMonetagZoneScript(false, doc);
}
