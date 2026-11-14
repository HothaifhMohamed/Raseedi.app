# رَصِيدِي | Raseedi — Personal & Enterprise Financial Management

**Raseedi (رَصِيدِي)** is a bilingual (Arabic RTL & English LTR), production-grade personal finance and multi-user Enterprise accounting PWA built with **React 19, TypeScript, Tailwind CSS, Express, Firebase Auth/Firestore/Storage, and Gemini AI**.

---

## Architecture Overview

1. **Personal Workspace (Offline-First / IndexedDB)**
   - Runs 100% offline using IndexedDB (`src/services/db.ts`) with optional Google Cloud Backup (`users/{uid}/backup/meta` + chunked transactions).
   - Includes wallets, multi-currency conversion (including 3-decimal currencies `KWD`, `BHD`, `OMR`, `JOD`, `TND`, `LYD`, `IQD`), budgets with custom fiscal start dates & rollover, debts, savings goals, recurring templates, Egyptian Arabic quick-entry parser, and **Money Circles (الجمعيات المالية)**.

2. **Enterprise / Organization Workspace (Real-Time Multi-Device Team Collaboration)**
   - Dedicated Cloud Firestore hierarchy (`/organizations/{orgId}` + `members`, `costCenters`, `parties`, `transactions`, `wallets`, `categories`, `budgets`, `auditLogs`).
   - **5-Tier RBAC** (`owner`, `admin`, `accountant`, `employee`, `viewer`) enforced in UI, Express Admin SDK endpoints (`/api/org/*`), and `firestore.rules`.
   - **Maker-Checker Approvals**: `draft` → `pending` → `approved` / `rejected` → `paid` + soft-delete Trash & Restore. Unapproved/rejected/soft-deleted items never mutate wallet balances, budgets, or P&L.
   - **VAT & Minor-Unit Engine**: Integer minor-unit precision (`toMinor`/`fromMinor`), inclusive & exclusive VAT calculations, Vendor/Client AP & AR Aging (`0-30`, `31-60`, `61-90`, `90+`), Accounting Period Lock, and immutable Audit Log.
   - **Firebase Storage Receipts**: Offline upload queue (`orgs/{orgId}/receipts/{txId}/{fileName}`) with 2MB compression and `storage.rules` enforcement.

3. **Subscriptions & Pricing (`src/config/pricing.ts`)**
   - **Free**: 3 wallets, 1 budget, 3 AI receipt scans/month.
   - **Personal PRO**: $2.99/mo (99 EGP) · $24.99/yr (799 EGP) · $59.99 Lifetime (1,999 EGP) · 200 AI scans/month.
   - **Business PRO**: $5.99/mo (199 EGP) · $49.99/yr (1,599 EGP) · 5 team seats included (+ $1 / 35 EGP per extra seat/month) · 250 AI scans/month · 14-day free trial · 7-day post-expiry grace period before Read-Only mode.

---

## Environment Setup

Copy `.env.example` and configure required runtime secrets:

| Variable | Required | Description |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Yes (for AI receipt scan) | Server-side Gemini API key used exclusively by `POST /api/scan-receipt`. |
| `APP_URL` | Optional | Public origin URL of the deployed server. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Production Node/External host | Service account JSON string when not running with Application Default Credentials. |
| `PAYMENT_WEBHOOK_SECRET` | Optional | HMAC-SHA256 secret for `/api/billing/webhook` & `/api/webhooks/payment`. |
| `VITE_ADSENSE_CLIENT_ID` | Optional | When unset, AdSense banners & `dist/ads.txt` are completely omitted. |
| `VITE_ADSENSE_SLOT_ID` | Optional | Default AdSense slot ID. |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | Optional | ReCaptcha v3 site key for Firebase App Check. |

---

## Scripts & CLI Tools

```bash
# Development server (Express + Vite middleware on port 3000)
npm run dev

# Type-check TypeScript
npm run lint

# Run pure calculation, currency, VAT, RBAC & lifecycle unit tests
npm test

# Run Firestore Security Rules Emulator suite (requires Java & Firebase CLI)
npm run test:rules

# Lint Firestore security rules
npx eslint firestore.rules

# Production build (Vite client + esbuild server.js bundle)
npm run build
npm start

# Generate & optionally seed PRO / Business license activation codes (hashes only in Firestore)
npx tsx scripts/generate-codes.ts --tier personal --cycle lifetime --count 10
npx tsx scripts/generate-codes.ts --tier business --cycle yearly --seats 10 --count 5 --seed
```

---

## Pre-Release Verification Checklist

- [ ] `npm run lint` passes with zero TypeScript errors.
- [ ] `npm test` passes all unit & accounting invariant tests.
- [ ] `npx eslint firestore.rules` passes security rules lint cleanly.
- [ ] `npm run test:rules` passes on a machine with Java + Firebase Emulator installed.
- [ ] `firestore.rules` deployed cleanly to target Firebase database (`ai-studio-1004f7e6-37de-49ad-89bd-ff8628597eea`).
- [ ] `npm run build` completes cleanly (and omits `dist/ads.txt` when `VITE_ADSENSE_CLIENT_ID` is unset).
- [ ] Browser smoke verification passes on desktop & mobile in both Arabic (`RTL`) and English (`LTR`) with zero console errors.
