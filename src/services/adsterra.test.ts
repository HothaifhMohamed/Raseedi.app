import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADSTERRA_NATIVE_CONTAINER_ID,
  ADSTERRA_NATIVE_SCRIPT_ID,
  ADSTERRA_NATIVE_SCRIPT_SRC,
  mountAdsterraNativeBanner,
  teardownAdsterraNativeBanner,
} from './adsterra';
import { shouldShowAds, computeUserSubscriptionSummary } from './subscriptionHelpers';
import { buildCspDirectives } from './serverSecurity';

interface MockElement {
  tagName: string;
  id: string;
  src: string;
  async: boolean;
  innerHTML: string;
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
  head: MockElement;
  body: MockElement;
  all: MockElement[];
  createElement: (tag: string) => MockElement;
  getElementById: (id: string) => MockElement | null;
  querySelector: (selector: string) => MockElement | null;
}

function createMockDom() {
  const all: MockElement[] = [];

  const makeEl = (tag: string, doc: MockDocument): MockElement => {
    const el: MockElement = {
      tagName: tag.toUpperCase(),
      id: '',
      src: '',
      async: false,
      innerHTML: '',
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
        if (!all.includes(child)) all.push(child);
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
  doc.all = all;
  doc.head = makeEl('head', doc);
  doc.body = makeEl('body', doc);
  doc.createElement = (tag: string) => makeEl(tag, doc);
  doc.getElementById = (id: string) => {
    const visit = (node: MockElement): MockElement | null => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const hit = visit(child);
        if (hit) return hit;
      }
      return null;
    };
    return visit(doc.head) || visit(doc.body);
  };
  doc.querySelector = (selector: string) => {
    const srcMatch = selector.match(/^script\[src="(.+)"\]$/);
    if (!srcMatch) return null;
    const expectedSrc = srcMatch[1];
    return (
      doc.head.children.find((c) => c.tagName === 'SCRIPT' && c.src === expectedSrc) ||
      doc.body.children.find((c) => c.tagName === 'SCRIPT' && c.src === expectedSrc) ||
      null
    );
  };

  return doc;
}

test('Adsterra constants match the exact requested Native Banner script URL and container ID', () => {
  assert.equal(
    ADSTERRA_NATIVE_SCRIPT_SRC,
    'https://bauval.org/21/bad6a35cb4587aaf45121214f6b6581c'
  );
  assert.equal(ADSTERRA_NATIVE_CONTAINER_ID, 'container-bad6a35cb4587aaf45121214f6b6581c');
});

test('mountAdsterraNativeBanner injects script strictly once across re-mounts/tab switches and cleans up on teardown', () => {
  const doc = createMockDom();
  const hostA = doc.createElement('div');
  const hostB = doc.createElement('div');
  doc.body.appendChild(hostA);
  doc.body.appendChild(hostB);

  // First mount in Tab A
  const unmountA = mountAdsterraNativeBanner(hostA as unknown as HTMLElement, {
    doc: doc as unknown as Document,
  });

  const scriptsAfterFirst = doc.head.children.filter((c) => c.tagName === 'SCRIPT');
  assert.equal(scriptsAfterFirst.length, 1);
  assert.equal(scriptsAfterFirst[0].id, ADSTERRA_NATIVE_SCRIPT_ID);
  assert.equal(scriptsAfterFirst[0].src, ADSTERRA_NATIVE_SCRIPT_SRC);
  assert.equal(scriptsAfterFirst[0].async, true);
  assert.equal(scriptsAfterFirst[0].getAttribute('async'), 'async');
  assert.equal(scriptsAfterFirst[0].getAttribute('data-cfasync'), 'false');
  assert.equal(hostA.children.length, 1);
  assert.equal(hostA.children[0].id, ADSTERRA_NATIVE_CONTAINER_ID);

  // Simulate switching from Tab A to Tab B
  unmountA();
  assert.equal(hostA.children.length, 0);

  const unmountB = mountAdsterraNativeBanner(hostB as unknown as HTMLElement, {
    doc: doc as unknown as Document,
  });

  // Script MUST NOT be duplicated on tab switch
  const scriptsAfterSecond = doc.head.children.filter((c) => c.tagName === 'SCRIPT');
  assert.equal(scriptsAfterSecond.length, 1);
  assert.equal(hostB.children.length, 1);
  assert.equal(hostB.children[0].id, ADSTERRA_NATIVE_CONTAINER_ID);

  // Teardown on PRO upgrade or consent denial removes script & container completely
  unmountB();
  teardownAdsterraNativeBanner(doc as unknown as Document);
  assert.equal(doc.head.children.filter((c) => c.tagName === 'SCRIPT').length, 0);
  assert.equal(doc.getElementById(ADSTERRA_NATIVE_CONTAINER_ID), null);
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

  // Pure free user -> allowed (subject to consent in UI)
  assert.equal(shouldShowAds(freeSummary), true);

  // Paid personal PRO / Business PRO / Admin -> strictly hidden
  assert.equal(shouldShowAds(personalProSummary), false);
  assert.equal(shouldShowAds(businessSummary), false);
  assert.equal(shouldShowAds(adminSummary), false);

  // Explicit isProFlag -> strictly hidden even if summary is stale
  assert.equal(shouldShowAds(freeSummary, { isProFlag: true }), false);

  // Active paid/trial organization subscription -> strictly hidden
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

  // Expired read-only org or free org -> falls back to personal free status
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
