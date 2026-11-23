import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADSTERRA_BANNER_ERROR_MESSAGE,
  ADSTERRA_BANNER_FILLED_MESSAGE,
  ADSTERRA_BANNER_HEIGHT,
  ADSTERRA_BANNER_IFRAME_ID,
  ADSTERRA_BANNER_KEY,
  ADSTERRA_BANNER_NO_FILL_MESSAGE,
  ADSTERRA_BANNER_SCRIPT_SRC,
  ADSTERRA_BANNER_WIDTH,
  buildAdsterraBannerSrcDoc,
  mountAdsterraBanner320x50,
  resolveAdBannerVisibility,
  teardownAdsterraBanner320x50,
} from './adsterra';
import { shouldShowAds, computeUserSubscriptionSummary } from './subscriptionHelpers';
import { buildCspDirectives } from './serverSecurity';
import {
  getAdConsentChoice,
  hasAdConsent,
  hasAdSenseConsent,
  resetAdConsentChoice,
  saveAdConsentChoice,
} from './adConsent';

interface MockElement {
  tagName: string;
  id: string;
  title: string;
  width: string;
  height: string;
  srcdoc: string;
  contentWindow: object | null;
  attributes: Record<string, string>;
  children: MockElement[];
  parentElement: MockElement | null;
  parentNode: MockElement | null;
  ownerDocument: MockDocument;
  listeners: Record<string, Array<() => void>>;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  appendChild: (child: MockElement) => MockElement;
  removeChild: (child: MockElement) => MockElement;
  addEventListener: (event: string, fn: () => void) => void;
}

interface MockWindow {
  listeners: Record<string, Array<(event: MessageEvent) => void>>;
  addEventListener: (event: string, fn: (event: MessageEvent) => void) => void;
  removeEventListener: (event: string, fn: (event: MessageEvent) => void) => void;
  dispatchMessage: (data: unknown, source?: object | null) => void;
}

interface MockDocument {
  body: MockElement;
  defaultView: MockWindow;
  createElement: (tag: string) => MockElement;
  getElementById: (id: string) => MockElement | null;
  querySelectorAll: (selector: string) => MockElement[];
}

function createMockDom() {
  const mockWin: MockWindow = {
    listeners: {},
    addEventListener(event, fn) {
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      this.listeners[event] = (this.listeners[event] || []).filter((cb) => cb !== fn);
    },
    dispatchMessage(data, source = null) {
      for (const fn of [...(this.listeners.message || [])]) {
        fn({ data, source } as MessageEvent);
      }
    },
  };

  const makeEl = (tag: string, doc: MockDocument): MockElement => {
    const el: MockElement = {
      tagName: tag.toUpperCase(),
      id: '',
      title: '',
      width: '',
      height: '',
      srcdoc: '',
      contentWindow: tag.toLowerCase() === 'iframe' ? {} : null,
      attributes: {},
      children: [],
      parentElement: null,
      parentNode: null,
      ownerDocument: doc,
      listeners: {},
      setAttribute(k: string, v: string) {
        this.attributes[k] = v;
      },
      getAttribute(k: string) {
        return k in this.attributes ? this.attributes[k] : null;
      },
      appendChild(child: MockElement) {
        if (child.parentNode) {
          child.parentNode.removeChild(child);
        }
        child.parentElement = this;
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      removeChild(child: MockElement) {
        this.children = this.children.filter((c) => c !== child);
        if (child.parentNode === this) {
          child.parentNode = null;
          child.parentElement = null;
        }
        return child;
      },
      addEventListener(event: string, fn: () => void) {
        this.listeners[event] = this.listeners[event] || [];
        this.listeners[event].push(fn);
      },
    };
    return el;
  };

  const doc = {} as MockDocument;
  doc.defaultView = mockWin;
  doc.body = makeEl('body', doc);
  doc.createElement = (tag: string) => makeEl(tag, doc);

  const collectAll = (node: MockElement, acc: MockElement[] = []): MockElement[] => {
    acc.push(node);
    for (const child of node.children) {
      collectAll(child, acc);
    }
    return acc;
  };

  doc.getElementById = (id: string) => {
    return collectAll(doc.body).find((n) => n.id === id) || null;
  };

  doc.querySelectorAll = (selector: string) => {
    const match = selector.match(/^iframe#(.+)$/);
    if (!match) return [];
    const targetId = match[1];
    return collectAll(doc.body).filter((n) => n.tagName === 'IFRAME' && n.id === targetId);
  };

  return doc;
}

test('Adsterra 320x50 banner constants and srcdoc match the exact requested snippet and prevent white-flash in Light & Dark Mode', () => {
  assert.equal(ADSTERRA_BANNER_KEY, '0891c1d3ea3d6bed258a7ebd3c28256b');
  assert.equal(
    ADSTERRA_BANNER_SCRIPT_SRC,
    'https://bauval.org/22/0891c1d3ea3d6bed258a7ebd3c28256b'
  );
  assert.equal(ADSTERRA_BANNER_WIDTH, 320);
  assert.equal(ADSTERRA_BANNER_HEIGHT, 50);

  const srcDocLight = buildAdsterraBannerSrcDoc({ theme: 'light' });
  assert.ok(srcDocLight.includes("'key' : '0891c1d3ea3d6bed258a7ebd3c28256b'"));
  assert.ok(srcDocLight.includes("'format' : 'iframe'"));
  assert.ok(srcDocLight.includes("'height' : 50"));
  assert.ok(srcDocLight.includes("'width' : 320"));
  assert.ok(srcDocLight.includes("'params' : {}"));
  assert.ok(
    srcDocLight.includes('<script src="https://bauval.org/22/0891c1d3ea3d6bed258a7ebd3c28256b"></script>')
  );
  assert.ok(srcDocLight.includes(ADSTERRA_BANNER_ERROR_MESSAGE));
  assert.ok(srcDocLight.includes(ADSTERRA_BANNER_FILLED_MESSAGE));
  assert.ok(srcDocLight.includes(ADSTERRA_BANNER_NO_FILL_MESSAGE));
  assert.ok(srcDocLight.includes('background:transparent!important'));
  assert.ok(srcDocLight.includes('color-scheme:light'));

  const srcDocDark = buildAdsterraBannerSrcDoc({ theme: 'dark' });
  assert.ok(srcDocDark.includes('<meta name="color-scheme" content="dark" />'));
  assert.ok(srcDocDark.includes('color-scheme:dark'));
});

test('mountAdsterraBanner320x50 mounts a single 320x50 iframe without duplication across tab switches and cleans up on teardown', () => {
  const doc = createMockDom();
  const hostA = doc.createElement('div');
  const hostB = doc.createElement('div');
  doc.body.appendChild(hostA);
  doc.body.appendChild(hostB);

  // First mount in Tab A (dark theme)
  const unmountA = mountAdsterraBanner320x50(hostA as unknown as HTMLElement, {
    doc: doc as unknown as Document,
    title: 'إعلان',
    theme: 'dark',
  });

  const iframesAfterFirst = doc.querySelectorAll(`iframe#${ADSTERRA_BANNER_IFRAME_ID}`);
  assert.equal(iframesAfterFirst.length, 1);
  assert.equal(hostA.children.length, 1);
  assert.equal(iframesAfterFirst[0].width, '320');
  assert.equal(iframesAfterFirst[0].height, '50');
  assert.equal(iframesAfterFirst[0].title, 'إعلان');
  assert.equal(iframesAfterFirst[0].getAttribute('data-ad-key'), ADSTERRA_BANNER_KEY);
  assert.equal(iframesAfterFirst[0].getAttribute('data-ad-theme'), 'dark');
  assert.equal(iframesAfterFirst[0].getAttribute('allowtransparency'), 'true');
  assert.ok((iframesAfterFirst[0].getAttribute('style') || '').includes('color-scheme:dark'));
  const sandboxAttr = iframesAfterFirst[0].getAttribute('sandbox') || '';
  assert.ok(sandboxAttr.includes('allow-scripts'));
  assert.equal(sandboxAttr.includes('allow-same-origin'), false);
  assert.ok(
    iframesAfterFirst[0].srcdoc.includes('https://bauval.org/22/0891c1d3ea3d6bed258a7ebd3c28256b')
  );

  // Mounting in Tab B before Tab A unmounts must still keep strictly 1 iframe in DOM
  const unmountB = mountAdsterraBanner320x50(hostB as unknown as HTMLElement, {
    doc: doc as unknown as Document,
  });
  const iframesAfterSecond = doc.querySelectorAll(`iframe#${ADSTERRA_BANNER_IFRAME_ID}`);
  assert.equal(iframesAfterSecond.length, 1);
  assert.equal(hostA.children.length, 0);
  assert.equal(hostB.children.length, 1);

  // Calling stale unmountA must NOT remove Tab B's active iframe
  unmountA();
  assert.equal(hostB.children.length, 1);

  // Teardown on PRO upgrade or consent denial removes iframe completely
  teardownAdsterraBanner320x50(doc as unknown as Document);
  assert.equal(doc.querySelectorAll(`iframe#${ADSTERRA_BANNER_IFRAME_ID}`).length, 0);
  assert.equal(doc.getElementById(ADSTERRA_BANNER_IFRAME_ID), null);

  // Subsequent unmountB is a safe no-op
  unmountB();
  assert.equal(doc.querySelectorAll(`iframe#${ADSTERRA_BANNER_IFRAME_ID}`).length, 0);
});

test('mountAdsterraBanner320x50 handles filled, no-fill, error, and timeout without leaving blank white boxes', async () => {
  // 1) Filled message triggers onFilled and cancels no-fill fallback
  const doc1 = createMockDom();
  const host1 = doc1.createElement('div');
  doc1.body.appendChild(host1);
  let filledCount = 0;
  let noFillCount = 0;
  let errorCount = 0;

  const unmount1 = mountAdsterraBanner320x50(host1 as unknown as HTMLElement, {
    doc: doc1 as unknown as Document,
    timeoutMs: 40,
    onFilled: () => {
      filledCount += 1;
    },
    onNoFill: () => {
      noFillCount += 1;
    },
    onError: () => {
      errorCount += 1;
    },
  });

  const iframe1 = doc1.getElementById(ADSTERRA_BANNER_IFRAME_ID)!;
  doc1.defaultView.dispatchMessage({ type: ADSTERRA_BANNER_FILLED_MESSAGE }, iframe1.contentWindow);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(filledCount, 1);
  assert.equal(noFillCount, 0);
  assert.equal(errorCount, 0);
  unmount1();

  // 2) No creative loaded before timeout -> triggers onNoFill so banner collapses cleanly
  const doc2 = createMockDom();
  const host2 = doc2.createElement('div');
  doc2.body.appendChild(host2);
  let timedOutNoFill = 0;

  const unmount2 = mountAdsterraBanner320x50(host2 as unknown as HTMLElement, {
    doc: doc2 as unknown as Document,
    timeoutMs: 25,
    onNoFill: () => {
      timedOutNoFill += 1;
    },
  });

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(timedOutNoFill, 1);
  unmount2();

  // 3) Explicit no-fill message settles immediately
  const doc3 = createMockDom();
  const host3 = doc3.createElement('div');
  doc3.body.appendChild(host3);
  let immediateNoFill = 0;
  const unmount3 = mountAdsterraBanner320x50(host3 as unknown as HTMLElement, {
    doc: doc3 as unknown as Document,
    timeoutMs: 5000,
    onNoFill: () => {
      immediateNoFill += 1;
    },
  });
  const iframe3 = doc3.getElementById(ADSTERRA_BANNER_IFRAME_ID)!;
  doc3.defaultView.dispatchMessage({ type: ADSTERRA_BANNER_NO_FILL_MESSAGE }, iframe3.contentWindow);
  assert.equal(immediateNoFill, 1);
  unmount3();
});

test('resolveAdBannerVisibility never displays a visible blank box during loading, No-Fill, error, offline, or paid plans', () => {
  assert.equal(
    resolveAdBannerVisibility({ showAds: true, hasConsent: true, isOnline: true, loadState: 'loading' }),
    'loading-hidden'
  );
  assert.equal(
    resolveAdBannerVisibility({ showAds: true, hasConsent: true, isOnline: true, loadState: 'filled' }),
    'visible'
  );
  assert.equal(
    resolveAdBannerVisibility({ showAds: true, hasConsent: true, isOnline: true, loadState: 'no-fill' }),
    'hidden'
  );
  assert.equal(
    resolveAdBannerVisibility({ showAds: true, hasConsent: true, isOnline: true, loadState: 'error' }),
    'hidden'
  );
  assert.equal(
    resolveAdBannerVisibility({ showAds: true, hasConsent: true, isOnline: false, loadState: 'filled' }),
    'hidden'
  );
  assert.equal(
    resolveAdBannerVisibility({ showAds: false, hasConsent: true, isOnline: true, loadState: 'filled' }),
    'hidden'
  );
});

test('shouldShowAds strictly hides ads for PRO, Business, Admin, and active paid/trial organization entitlements', () => {
  const freeSummary = computeUserSubscriptionSummary({ verifiedPro: null });
  const personalProSummary = computeUserSubscriptionSummary({
    verifiedPro: {
      uid: 'u-pro',
      isPro: true,
      proActive: true,
      planTier: 'personal_pro',
      proPlan: 'monthly',
      billingCycle: 'monthly',
      expiresAt: Date.now() + 30 * 86400000,
    },
  });
  const businessSummary = computeUserSubscriptionSummary({
    verifiedPro: {
      uid: 'u-biz',
      isPro: true,
      proActive: true,
      planTier: 'business_pro',
      proPlan: 'business_yearly',
      billingCycle: 'yearly',
      expiresAt: Date.now() + 365 * 86400000,
    },
  });
  const adminSummary = computeUserSubscriptionSummary({ verifiedPro: null, isAdminUser: true });

  assert.equal(shouldShowAds(freeSummary), true);
  assert.equal(shouldShowAds(personalProSummary), false);
  assert.equal(shouldShowAds(businessSummary), false);
  assert.equal(shouldShowAds(adminSummary), false);
  assert.equal(shouldShowAds(freeSummary, { isProFlag: true }), false);

  assert.equal(
    shouldShowAds(freeSummary, {
      activeOrgSubscriptionState: { planTier: 'business_pro', status: 'active', isReadOnly: false },
    }),
    false
  );
  assert.equal(
    shouldShowAds(freeSummary, {
      activeOrgSubscriptionState: { planTier: 'business_pro', status: 'trial', isReadOnly: false },
    }),
    false
  );

  assert.equal(
    shouldShowAds(freeSummary, {
      activeOrgSubscriptionState: { planTier: 'business_pro', status: 'read_only', isReadOnly: true },
    }),
    true
  );
  assert.equal(
    shouldShowAds(freeSummary, {
      activeOrgSubscriptionState: { planTier: 'free', status: 'active', isReadOnly: false },
    }),
    true
  );
});

test('CSP directives in serverSecurity.ts and vercel.json allow Adsterra https://bauval.org without weakening clickjacking or ws: hardening', () => {
  const prod = buildCspDirectives({ isProduction: true, allowPreviewFraming: false });
  assert.equal(prod.scriptSrc.includes('https://bauval.org'), true);
  assert.equal(prod.connectSrc.includes('https://bauval.org'), true);
  assert.equal(prod.imgSrc.includes('https://bauval.org'), true);
  assert.equal(prod.frameSrc.includes('https://bauval.org'), true);
  assert.deepEqual(prod.frameAncestors, ["'self'"]);
  assert.equal(prod.connectSrc.includes('ws:'), false);

  const vercelJsonPath = path.resolve(process.cwd(), 'vercel.json');
  const vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8')) as {
    headers?: Array<{ headers?: Array<{ key: string; value: string }> }>;
  };
  const cspHeader = vercelConfig.headers
    ?.flatMap((rule) => rule.headers || [])
    .find((h) => h.key === 'Content-Security-Policy');

  assert.ok(cspHeader, 'vercel.json must define Content-Security-Policy header');
  assert.ok(cspHeader.value.includes("frame-ancestors 'self'"));
  assert.ok(cspHeader.value.includes('script-src') && cspHeader.value.includes('https://bauval.org'));
  assert.ok(cspHeader.value.includes('connect-src') && cspHeader.value.includes('https://bauval.org'));
  assert.ok(cspHeader.value.includes('img-src') && cspHeader.value.includes('https://bauval.org'));
  assert.ok(cspHeader.value.includes('frame-src') && cspHeader.value.includes('https://bauval.org'));
  assert.equal(cspHeader.value.includes(' ws:'), false);
});

test('Free-tier ad consent stays enabled without manual opt-out buttons in Settings or Privacy Policy while preserving PRO upgrade CTAs', () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };

  // Fresh install / empty storage -> granted
  assert.equal(getAdConsentChoice(mockStorage), 'granted');
  assert.equal(hasAdConsent(mockStorage), true);
  assert.equal(hasAdSenseConsent(mockStorage), true);

  // Even if legacy 'denied' was stored previously, free-tier ads resolve as granted
  store.set('raseedi_ad_consent_v1', 'denied');
  assert.equal(getAdConsentChoice(mockStorage), 'granted');
  assert.equal(hasAdConsent(mockStorage), true);

  // saveAdConsentChoice and resetAdConsentChoice keep free-tier consent granted
  saveAdConsentChoice('denied', { storage: mockStorage, dispatchEvent: false });
  assert.equal(getAdConsentChoice(mockStorage), 'granted');
  resetAdConsentChoice({ storage: mockStorage, dispatchEvent: false });
  assert.equal(getAdConsentChoice(mockStorage), 'granted');

  // Verify SettingsModal & SupportAndLegalModal have NO manual disable-ads button/toggle
  // and keep the PRO upgrade CTA intact
  const settingsSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/more/SettingsModal.tsx'),
    'utf8'
  );
  const legalSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/more/SupportAndLegalModal.tsx'),
    'utf8'
  );

  assert.equal(settingsSrc.includes('settings-ad-consent-toggle'), false);
  assert.equal(settingsSrc.includes('إيقاف إعلانات النسخة المجانية'), false);
  assert.equal(settingsSrc.includes('Disable Free-Tier Ads'), false);
  assert.ok(settingsSrc.includes('settings-ads-upgrade-btn'));

  assert.equal(legalSrc.includes('إيقاف إعلانات النسخة المجانية'), false);
  assert.equal(legalSrc.includes('Disable Free-Tier Ads'), false);
  assert.equal(legalSrc.includes('saveAdConsentChoice'), false);
  assert.ok(legalSrc.includes('legal-ads-upgrade-btn'));
});

test('Google AdSense requirements: single script in index.html head, pub-7802456607447662 in ads.txt, official CSP domains, and subscriber suppression', () => {
  const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const headMatch = indexHtml.match(/<head>([\s\S]*?)<\/head>/i);
  assert.ok(headMatch, 'index.html must contain <head>');
  const adSenseMatches =
    headMatch[1].match(
      /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-7802456607447662/g
    ) || [];
  assert.equal(
    adSenseMatches.length,
    1,
    'AdSense script for ca-pub-7802456607447662 must appear strictly once inside <head>'
  );

  const adsTxt = fs.readFileSync(path.resolve(process.cwd(), 'public/ads.txt'), 'utf8');
  const adsLines = adsTxt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const targetLine = 'google.com, pub-7802456607447662, DIRECT, f08c47fec0942fa0';
  assert.equal(
    adsLines.filter((line) => line === targetLine).length,
    1,
    'public/ads.txt must include pub-7802456607447662 exactly once'
  );
  assert.equal(
    new Set(adsLines).size,
    adsLines.length,
    'public/ads.txt must not contain duplicate entries'
  );

  // Verify official AdSense CSP domains in serverSecurity.ts
  const prod = buildCspDirectives({ isProduction: true, allowPreviewFraming: false });
  assert.ok(prod.scriptSrc.includes('https://pagead2.googlesyndication.com'));
  assert.ok(prod.scriptSrc.includes('https://googleads.g.doubleclick.net'));
  assert.ok(prod.scriptSrc.includes('https://www.googletagservices.com'));
  assert.ok(prod.scriptSrc.includes('https://adservice.google.com'));
  assert.ok(prod.connectSrc.includes('https://pagead2.googlesyndication.com'));
  assert.ok(prod.connectSrc.includes('https://googleads.g.doubleclick.net'));
  assert.ok(prod.connectSrc.includes('https://www.googletagservices.com'));
  assert.ok(prod.connectSrc.includes('https://adservice.google.com'));
  assert.ok(prod.frameSrc.includes('https://tpc.googlesyndication.com'));
  assert.ok(prod.frameSrc.includes('https://googleads.g.doubleclick.net'));
  assert.deepEqual(prod.frameAncestors, ["'self'"]);

  // Verify vercel.json CSP matches all official AdSense domains + Adsterra + frame-ancestors 'self'
  const vercelConfig = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8')
  ) as { headers?: Array<{ headers?: Array<{ key: string; value: string }> }> };
  const cspHeader = vercelConfig.headers
    ?.flatMap((rule) => rule.headers || [])
    .find((h) => h.key === 'Content-Security-Policy');
  assert.ok(cspHeader);
  for (const domain of [
    'https://pagead2.googlesyndication.com',
    'https://googleads.g.doubleclick.net',
    'https://tpc.googlesyndication.com',
    'https://www.googletagservices.com',
    'https://adservice.google.com',
    'https://bauval.org',
    'https://araplhn.org',
  ]) {
    assert.ok(cspHeader.value.includes(domain), `vercel.json CSP must allow ${domain}`);
  }
  assert.ok(cspHeader.value.includes("frame-ancestors 'self'"));

  // Verify App.tsx suppresses AdSense for PRO/Business/Admin/Org/Ad-Free subscribers via shouldShowAds
  const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes('shouldShowAds(subscriptionSummary'));
  assert.ok(appSrc.includes('pauseAdRequests = 1'));
});

test('AuthGateScreen exposes visitor overview, features, FAQ, and direct pre-login Privacy/Terms & Support links', () => {
  const authGateSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/auth/AuthGateScreen.tsx'),
    'utf8'
  );
  assert.ok(authGateSrc.includes('auth-gate-overview-section'));
  assert.ok(authGateSrc.includes('auth-gate-faq-section'));
  assert.ok(authGateSrc.includes('auth-gate-legal-btn'));
  assert.ok(authGateSrc.includes('auth-gate-support-btn'));
  assert.ok(authGateSrc.includes('SupportAndLegalModal'));
  assert.ok(authGateSrc.includes('سياسة الخصوصية وشروط الاستخدام'));
  assert.ok(authGateSrc.includes('الدعم والتواصل'));
});


