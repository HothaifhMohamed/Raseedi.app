import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADSTERRA_BANNER_ERROR_MESSAGE,
  ADSTERRA_BANNER_HEIGHT,
  ADSTERRA_BANNER_IFRAME_ID,
  ADSTERRA_BANNER_KEY,
  ADSTERRA_BANNER_SCRIPT_SRC,
  ADSTERRA_BANNER_WIDTH,
  buildAdsterraBannerSrcDoc,
  mountAdsterraBanner320x50,
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

interface MockDocument {
  body: MockElement;
  defaultView: null;
  createElement: (tag: string) => MockElement;
  getElementById: (id: string) => MockElement | null;
  querySelectorAll: (selector: string) => MockElement[];
}

function createMockDom() {
  const makeEl = (tag: string, doc: MockDocument): MockElement => {
    const el: MockElement = {
      tagName: tag.toUpperCase(),
      id: '',
      title: '',
      width: '',
      height: '',
      srcdoc: '',
      contentWindow: null,
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
  doc.defaultView = null;
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

test('Adsterra 320x50 banner constants and srcdoc match the exact requested snippet', () => {
  assert.equal(ADSTERRA_BANNER_KEY, '0891c1d3ea3d6bed258a7ebd3c28256b');
  assert.equal(
    ADSTERRA_BANNER_SCRIPT_SRC,
    'https://bauval.org/22/0891c1d3ea3d6bed258a7ebd3c28256b'
  );
  assert.equal(ADSTERRA_BANNER_WIDTH, 320);
  assert.equal(ADSTERRA_BANNER_HEIGHT, 50);

  const srcDoc = buildAdsterraBannerSrcDoc();
  assert.ok(srcDoc.includes("'key' : '0891c1d3ea3d6bed258a7ebd3c28256b'"));
  assert.ok(srcDoc.includes("'format' : 'iframe'"));
  assert.ok(srcDoc.includes("'height' : 50"));
  assert.ok(srcDoc.includes("'width' : 320"));
  assert.ok(srcDoc.includes("'params' : {}"));
  assert.ok(
    srcDoc.includes('<script src="https://bauval.org/22/0891c1d3ea3d6bed258a7ebd3c28256b"></script>')
  );
  assert.ok(srcDoc.includes(ADSTERRA_BANNER_ERROR_MESSAGE));
});

test('mountAdsterraBanner320x50 mounts a single 320x50 iframe without duplication across tab switches and cleans up on teardown', () => {
  const doc = createMockDom();
  const hostA = doc.createElement('div');
  const hostB = doc.createElement('div');
  doc.body.appendChild(hostA);
  doc.body.appendChild(hostB);

  // First mount in Tab A
  const unmountA = mountAdsterraBanner320x50(hostA as unknown as HTMLElement, {
    doc: doc as unknown as Document,
    title: 'إعلان',
  });

  const iframesAfterFirst = doc.querySelectorAll(`iframe#${ADSTERRA_BANNER_IFRAME_ID}`);
  assert.equal(iframesAfterFirst.length, 1);
  assert.equal(hostA.children.length, 1);
  assert.equal(iframesAfterFirst[0].width, '320');
  assert.equal(iframesAfterFirst[0].height, '50');
  assert.equal(iframesAfterFirst[0].title, 'إعلان');
  assert.equal(iframesAfterFirst[0].getAttribute('data-ad-key'), ADSTERRA_BANNER_KEY);
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

test('Ad consent defaults to enabled (granted) without a blocking popup while honoring explicit opt-out and one-tap re-enable', () => {
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

  // Fresh install / empty storage -> default granted
  assert.equal(getAdConsentChoice(mockStorage), 'granted');
  assert.equal(hasAdConsent(mockStorage), true);
  assert.equal(hasAdSenseConsent(mockStorage), true);

  // Explicit opt-out from Settings -> denied & invokes teardown callback
  let tornDown = false;
  saveAdConsentChoice('denied', {
    storage: mockStorage,
    dispatchEvent: false,
    onDenied: () => {
      tornDown = true;
    },
  });
  assert.equal(tornDown, true);
  assert.equal(getAdConsentChoice(mockStorage), 'denied');
  assert.equal(hasAdConsent(mockStorage), false);

  // One-tap re-enable restores granted
  saveAdConsentChoice('granted', { storage: mockStorage, dispatchEvent: false });
  assert.equal(getAdConsentChoice(mockStorage), 'granted');
  assert.equal(hasAdConsent(mockStorage), true);

  // Reset removes key and keeps default-enabled behavior
  saveAdConsentChoice('denied', { storage: mockStorage, dispatchEvent: false });
  resetAdConsentChoice({ storage: mockStorage, dispatchEvent: false });
  assert.equal(getAdConsentChoice(mockStorage), 'granted');
});

