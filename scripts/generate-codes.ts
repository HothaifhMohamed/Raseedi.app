/**
 * Generate N random Raseedi PRO activation codes and SHA-256 hashes.
 *
 * Usage:
 *   npx tsx scripts/generate-codes.ts --tier personal --cycle lifetime --count 10
 *   npx tsx scripts/generate-codes.ts --tier business --cycle yearly --seats 10 --count 5 --seed
 *   npx tsx scripts/generate-codes.ts --count 10 --plan business_yearly --seed
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { PRICING_CONFIG } from '../src/config/pricing';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

type AllowedTier = 'personal' | 'business';
type AllowedCycle = 'monthly' | 'yearly' | 'lifetime';
type AllowedPlan =
  | 'monthly'
  | 'yearly'
  | 'lifetime'
  | 'business_monthly'
  | 'business_yearly'
  | 'code';

interface ParsedCliOptions {
  count: number;
  plan: AllowedPlan;
  tier: AllowedTier;
  cycle: AllowedCycle;
  seats: number;
  extraSeats: number;
  seed: boolean;
}

function parseArgs(argv: string[]): ParsedCliOptions {
  let count = 10;
  let explicitPlan: AllowedPlan | null = null;
  let explicitTier: AllowedTier | null = null;
  let explicitCycle: AllowedCycle | null = null;
  let explicitSeats: number | null = null;
  let seed = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--count' && argv[i + 1]) {
      const parsed = parseInt(argv[i + 1], 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 500) {
        throw new Error('--count must be an integer between 1 and 500');
      }
      count = parsed;
      i++;
    } else if (arg === '--tier' && argv[i + 1]) {
      const val = argv[i + 1].toLowerCase();
      if (val !== 'personal' && val !== 'business') {
        throw new Error('--tier must be "personal" or "business"');
      }
      explicitTier = val;
      i++;
    } else if (arg === '--cycle' && argv[i + 1]) {
      const val = argv[i + 1].toLowerCase();
      if (val !== 'monthly' && val !== 'yearly' && val !== 'lifetime') {
        throw new Error('--cycle must be "monthly", "yearly", or "lifetime"');
      }
      explicitCycle = val;
      i++;
    } else if (arg === '--seats' && argv[i + 1]) {
      const parsed = parseInt(argv[i + 1], 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 500) {
        throw new Error('--seats must be an integer between 1 and 500');
      }
      explicitSeats = parsed;
      i++;
    } else if (arg === '--plan' && argv[i + 1]) {
      const val = argv[i + 1];
      if (
        val === 'monthly' ||
        val === 'yearly' ||
        val === 'lifetime' ||
        val === 'business_monthly' ||
        val === 'business_yearly' ||
        val === 'code'
      ) {
        explicitPlan = val;
      } else {
        throw new Error(`Unsupported --plan "${val}"`);
      }
      i++;
    } else if (arg === '--seed') {
      seed = true;
    }
  }

  let tier: AllowedTier;
  let cycle: AllowedCycle;
  let plan: AllowedPlan;

  if (explicitPlan && !explicitTier && !explicitCycle) {
    plan = explicitPlan;
    if (explicitPlan === 'business_monthly') {
      tier = 'business';
      cycle = 'monthly';
    } else if (explicitPlan === 'business_yearly') {
      tier = 'business';
      cycle = 'yearly';
    } else {
      tier = 'personal';
      cycle = explicitPlan === 'monthly' ? 'monthly' : explicitPlan === 'yearly' ? 'yearly' : 'lifetime';
    }
  } else {
    tier = explicitTier ?? 'personal';
    cycle = explicitCycle ?? (tier === 'business' ? 'yearly' : 'lifetime');
    if (tier === 'business' && cycle === 'lifetime') {
      throw new Error('Business PRO only supports --cycle monthly or --cycle yearly.');
    }
    plan =
      tier === 'business'
        ? cycle === 'yearly'
          ? 'business_yearly'
          : 'business_monthly'
        : cycle;
  }

  const minSeats = tier === 'business' ? PRICING_CONFIG.businessPro.includedSeats : 1;
  const seats = explicitSeats ?? minSeats;
  if (tier === 'business' && seats < PRICING_CONFIG.businessPro.includedSeats) {
    throw new Error(
      `Business PRO includes ${PRICING_CONFIG.businessPro.includedSeats} seats; --seats must be >= ${PRICING_CONFIG.businessPro.includedSeats}.`
    );
  }
  const extraSeats = tier === 'business' ? Math.max(0, seats - PRICING_CONFIG.businessPro.includedSeats) : 0;

  return { count, plan, tier, cycle, seats, extraSeats, seed };
}

function randomGroup(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function generateActivationCode(): string {
  return `RASEEDI-${randomGroup(4)}-${randomGroup(4)}-${randomGroup(4)}`;
}

export function hashActivationCode(rawCode: string): string {
  const normalized = rawCode.trim().toUpperCase();
  return crypto
    .createHash('sha256')
    .update(`raseedi-license:${normalized}`)
    .digest('hex');
}

async function main() {
  const { count, plan, tier, cycle, seats, extraSeats, seed } = parseArgs(process.argv.slice(2));
  const generated: Array<{
    code: string;
    hash: string;
    plan: AllowedPlan;
    tier: AllowedTier;
    cycle: AllowedCycle;
    seats: number;
    extraSeats: number;
  }> = [];
  const seen = new Set<string>();

  while (generated.length < count) {
    const code = generateActivationCode();
    if (seen.has(code)) continue;
    seen.add(code);
    generated.push({
      code,
      hash: hashActivationCode(code),
      plan,
      tier,
      cycle,
      seats,
      extraSeats,
    });
  }

  if (seed) {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      projectId: string;
      firestoreDatabaseId?: string;
    };

    if (getApps().length === 0) {
      const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
      if (saJson) {
        initializeApp({ credential: cert(JSON.parse(saJson)), projectId: config.projectId });
      } else {
        initializeApp({ projectId: config.projectId });
      }
    }

    const db = config.firestoreDatabaseId
      ? getFirestore(getApps()[0], config.firestoreDatabaseId)
      : getFirestore(getApps()[0]);

    const batch = db.batch();
    for (const item of generated) {
      const ref = db.collection('activationCodes').doc(item.hash);
      batch.set(ref, {
        plan: item.plan,
        tier: item.tier,
        cycle: item.cycle,
        seats: item.seats,
        extraSeats: item.extraSeats,
        usedBy: null,
        usedAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    console.error(`Seeded ${generated.length} activation code hashes into Firestore collection "activationCodes".`);
  }

  console.log(JSON.stringify(generated, null, 2));
}

main().catch((err) => {
  console.error('Failed to generate activation codes:', err);
  process.exit(1);
});
