import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MONETAG_META_VERIFICATION,
  MONETAG_SCRIPT_ID,
  MONETAG_SCRIPT_SRC,
  MONETAG_ZONE_ID,
  shouldLoadMonetagZone,
  syncMonetagZoneScript,
  teardownMonetagZoneScript,
  type MinimalDocumentLike,
  type MinimalDomNode,
} from './monetag';
import { computeUserSubscriptionSummary } from './subscriptionHelpers';
import { buildCspDirectives } from './serverSecurity';

interface FakeElement extends MinimalDomNode {
  tagName: string;
  attributes: Record<string, string>;
  children: FakeElement[];
  appendChild(child: FakeElement): FakeElement;
  removeChild(child: FakeElement): FakeElement;
}

function createFakeDom(): {
  doc: MinimalDocumentLike;
  head: FakeElement;
  body: FakeElement;
  metaTag: FakeElement;
} {
  const makeEl = (tagName: string): FakeElement => {
    const el: FakeElement = {
      tagName: tagName.toLowerCase(),
      id: '',
      src: '',
      async: false,
      referrerPolicy: '',
      attributes: {},
      children: [],
      parentNode: null,
      getAttribute(name: string) {
        if (name === 'id' && el.id) return el.id;
        if (name === 'src' && (el.attributes.src || el.src)) {
          return el.attributes.src || el.src || null;
        }
        return name in el.attributes ? el.attributes[name] : null;
      },
      setAttribute(name: string, value: string) {
        el.attributes[name] = value;
        if (name === 'id') el.id = value;
        if (name === 'src') el.src = value;
      },
      appendChild(child: FakeElement) {
        child.parentNode = el;
        el.children.push(child);
        return child;
      },
      removeChild(child: FakeElement) {
        const idx = el.children.indexOf(child);
        if (idx >= 0) el.children.splice(idx, 1);
        child.parentNode = null;
        return child;
      },
      remove() {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      },
    };
    return el;
  };

  const head = makeEl('head');
  const body = makeEl('body');
  const metaTag = makeEl('meta');
  metaTag.setAttribute('name', 'monetag');
  metaTag.setAttribute('content', MONETAG_META_VERIFICATION);
  head.appendChild(metaTag);

  const walk = (root: FakeElement): FakeElement[] => {
    const list: FakeElement[] = [];
    for (const child of root.children) {
      list.push(child, ...walk(child));
    }
    return list;
  };

  const matchesSelector = (el: FakeElement, selector: string): boolean => {
    const parts = selector.split(',').map((s) => s.trim());
    return parts.some((part) => {
      const idMatch = part.match(/^script#(.+)$/);
      if (idMatch) {
        return el.tagName === 'script' && el.id === idMatch[1];
      }
      if (part === 'script[src*="nap5k.com/tag.min.js"]') {
        return el.tagName === 'script' && (el.getAttribute('src') || '').includes('nap5k.com/tag.min.js');
      }
      const scriptZoneMatch = part.match(/^script\[data-zone="(.+)"\]$/);
      if (scriptZoneMatch) {
        return el.tagName === 'script' && el.getAttribute('data-zone') === scriptZoneMatch[1];
      }
      const artifactZoneMatch = part.match(/^\[data-monetag-zone="(.+)"\]$/);
      if (artifactZoneMatch) {
        return el.getAttribute('data-monetag-zone') === artifactZoneMatch[1];
      }
      if (part === 'iframe[src*="nap5k.com"]') {
        return el.tagName === 'iframe' && (el.getAttribute('src') || '').includes('nap5k.com');
      }
      return false;
    });
  };

  const doc: MinimalDocumentLike = {
    head,
    body,
    createElement: (tagName: string) => makeEl(tagName),
    querySelectorAll: (selector: string) => {
      const all = [...walk(head), ...walk(body)];
      return all.filter((el) => matchesSelector(el, selector));
    },
  };

  return { doc, head, body, metaTag };
}

test('shouldLoadMonetagZone allows Free users only and strictly blocks PRO, Business, Admin, Active Org, Ad-Free, offline, no-consent, and unresolved states', () => {
  const freeSummary = computeUserSubscriptionSummary({ verifiedPro: null, isAdminUser: false });
  const proSummary = computeUserSubscriptionSummary({
    verifiedPro: {
      isPro: true,
      planTier: 'personal_pro',
      billingCycle: 'monthly',
      expiresAt: Date.now() + 30 * 86400000,
    },
  });
  const businessSummary = computeUserSubscriptionSummary({
    verifiedPro: {
      isPro: true,
      planTier: 'business_pro',
      billingCycle: 'yearly',
      expiresAt: Date.now() + 365 * 86400000,
    },
  });
  const adminSummary = computeUserSubscriptionSummary({ verifiedPro: null, isAdminUser: true });

  const eligibleFreeBase = {
    subscriptionSummary: freeSummary,
    isProFlag: false,
    creditsAdFreeActive: false,
    activeOrgSubscriptionState: null,
    hasConsent: true,
    isOnline: true,
    isMainShellReady: true,
    isEntitlementResolved: true,
  };

  // Eligible free user -> allowed
  assert.equal(shouldLoadMonetagZone(eligibleFreeBase), true);

  // Paid / Admin / Active Paid Org -> strictly blocked
  assert.equal(shouldLoadMonetagZone({ ...eligibleFreeBase, subscriptionSummary: proSummary }), false);
  assert.equal(shouldLoadMonetagZone({ ...eligibleFreeBase, subscriptionSummary: businessSummary }), false);
  assert.equal(shouldLoadMonetagZone({ ...eligibleFreeBase, subscriptionSummary: adminSummary }), false);
  assert.equal(shouldLoadMonetagZone({ ...eligibleFreeBase, isProFlag: true }), false);
  assert.equal(shouldLoadMonetagZone({ ...eligibleFreeBase, creditsAdFreeActive: true }), false);
  assert.equal(
    shouldLoadMonetagZone({
      ...eligibleFreeBase,
      activeOrgSubscriptionState: { planTier: 'business_pro', status: 'active', isReadOnly: false },
    }),
    false
  );
  assert.equal(
    shouldLoadMonetagZone({
      ...eligibleFreeBase,
      activeOrgSubscriptionState: { planTier: 'business_pro', status: 'trial', isReadOnly: false },
    }),
    false
  );

  // Read-only expired org falls back to user's own Free status
  assert.equal(
    shouldLoadMonetagZone({
      ...eligibleFreeBase,
      activeOrgSubscriptionState: { planTier: 'business_pro', status: 'expired', isReadOnly: true },
    }),
    true
  );

  // No consent, offline, AuthGate/Splash/Lock, or unresolved entitlement -> strictly blocked
  assert.equal(shouldLoadMonetagZone({ ...eligibleFreeBase, hasConsent: false }), false);
  assert.equal(shouldLoadMonetagZone({ ...eligibleFreeBase, isOnline: false }), false);
  assert.equal(shouldLoadMonetagZone({ ...eligibleFreeBase, isMainShellReady: false }), false);
  assert.equal(shouldLoadMonetagZone({ ...eligibleFreeBase, isEntitlementResolved: false }), false);
});

test('syncMonetagZoneScript injects In-Page Push zone 12339417 once, replaces legacy zone 12336201, and tears down cleanly when disabled', () => {
  assert.equal(MONETAG_ZONE_ID, '12339417');
  assert.equal(MONETAG_SCRIPT_SRC, 'https://nap5k.com/tag.min.js');
  assert.equal(MONETAG_SCRIPT_ID, 'raseedi-monetag-zone-12339417');

  const { doc, head, body, metaTag } = createFakeDom();

  // Disabled initially -> does nothing
  assert.equal(syncMonetagZoneScript(false, doc), 'idle');
  assert.equal(body.children.length, 0);

  // If a legacy zone 12336201 script existed, enabling replaces it with 12339417 cleanly
  const legacyScript = doc.createElement('script') as FakeElement;
  legacyScript.setAttribute('id', 'raseedi-monetag-zone-12336201');
  legacyScript.setAttribute('src', 'https://nap5k.com/tag.min.js');
  legacyScript.setAttribute('data-zone', '12336201');
  body.appendChild(legacyScript);

  // Enable for eligible free user -> replaces legacy with single 12339417 script
  assert.equal(syncMonetagZoneScript(true, doc), 'injected');
  assert.equal(body.children.length, 1);
  const injected = body.children[0];
  assert.equal(injected.id, 'raseedi-monetag-zone-12339417');
  assert.equal(injected.getAttribute('src'), 'https://nap5k.com/tag.min.js');
  assert.equal(injected.getAttribute('data-zone'), '12339417');
  assert.equal(injected.getAttribute('data-cfasync'), 'false');
  assert.equal(injected.async, true);

  // Calling again does NOT duplicate
  assert.equal(syncMonetagZoneScript(true, doc), 'already-loaded');
  assert.equal(body.children.length, 1);

  // Simulate an injected Monetag iframe/container artifact
  const iframe = doc.createElement('iframe');
  iframe.setAttribute?.('src', 'https://nap5k.com/frame?zone=12339417');
  body.appendChild(iframe as FakeElement);
  assert.equal(body.children.length, 2);

  // Disable (e.g. user upgrades to PRO or disables ads) -> removes script & artifacts, keeps meta verification
  assert.equal(teardownMonetagZoneScript(doc), 'removed');
  assert.equal(body.children.length, 0);
  assert.equal(head.children.includes(metaTag), true);
  assert.equal(metaTag.getAttribute('content'), MONETAG_META_VERIFICATION);
});

test('CSP in serverSecurity.ts, server.ts, vercel.json, index.html, AdBanner.tsx, and App.tsx allow nap5k.com + uplcm.com and prevent banner stacking', () => {
  const prod = buildCspDirectives({ isProduction: true, allowPreviewFraming: false });
  for (const host of [
    'https://nap5k.com',
    'https://*.nap5k.com',
    'https://uplcm.com',
    'https://*.uplcm.com',
  ]) {
    assert.ok(prod.scriptSrc.includes(host), `scriptSrc must include ${host}`);
    assert.ok(prod.connectSrc.includes(host), `connectSrc must include ${host}`);
    assert.ok(prod.frameSrc.includes(host), `frameSrc must include ${host}`);
  }
  assert.ok(prod.imgSrc.includes('https://nap5k.com'));
  assert.ok(prod.imgSrc.includes('https://uplcm.com'));
  assert.deepEqual(prod.frameAncestors, ["'self'"]);
  // Existing domains remain intact
  assert.ok(prod.scriptSrc.includes('https://pagead2.googlesyndication.com'));
  assert.ok(prod.scriptSrc.includes('https://bauval.org'));
  assert.ok(prod.scriptSrc.includes('https://araplhn.org'));

  const vercelConfig = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8')
  ) as { headers?: Array<{ headers?: Array<{ key: string; value: string }> }> };
  const cspHeader = vercelConfig.headers
    ?.flatMap((rule) => rule.headers || [])
    .find((h) => h.key === 'Content-Security-Policy');
  assert.ok(cspHeader);
  assert.ok(cspHeader.value.includes('https://nap5k.com'));
  assert.ok(cspHeader.value.includes('https://*.nap5k.com'));
  assert.ok(cspHeader.value.includes('https://uplcm.com'));
  assert.ok(cspHeader.value.includes('https://*.uplcm.com'));
  assert.ok(cspHeader.value.includes("frame-ancestors 'self'"));
  assert.ok(cspHeader.value.includes('https://pagead2.googlesyndication.com'));
  assert.ok(cspHeader.value.includes('https://bauval.org'));
  assert.ok(cspHeader.value.includes('https://araplhn.org'));

  const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.ok(serverSrc.includes('buildCspDirectives('));

  // index.html keeps single <meta name="monetag"> verification and does NOT statically hardcode nap5k.com script
  const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const metaMatches =
    indexHtml.match(/<meta\s+name="monetag"\s+content="28dce08c56e1ff333a8ef6b51ff91fe0"\s*\/?>/g) ||
    [];
  assert.equal(metaMatches.length, 1);
  assert.equal(indexHtml.includes('nap5k.com/tag.min.js'), false);

  // AdBanner.tsx disables the legacy embedded 320x50 banner so external ads never stack over the UI
  const adBannerSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/common/AdBanner.tsx'),
    'utf8'
  );
  assert.ok(adBannerSrc.includes('EMBEDDED_BANNER_ENABLED = false'));

  // App.tsx dynamically gates Monetag via shouldLoadMonetagZone + syncMonetagZoneScript
  const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes('shouldLoadMonetagZone'));
  assert.ok(appSrc.includes('syncMonetagZoneScript'));
  assert.ok(appSrc.includes('teardownMonetagZoneScript'));
});
