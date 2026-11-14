/**
 * Generate N random Raseedi PRO activation codes and SHA-256 hashes.
 *
 * Usage:
 *   npx tsx scripts/generate-codes.ts --count 10 --plan lifetime
 *   npx tsx scripts/generate-codes.ts --count 10 --plan yearly --seed
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

type AllowedPlan =
  | 'monthly'
  | 'yearly'
  | 'lifetime'
  | 'business_monthly'
  | 'business_yearly'
  | 'code';

function parseArgs(argv: string[]) {
  let count = 10;
  let plan: AllowedPlan = 'lifetime';
  let seed = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--count' && argv[i + 1]) {
      const parsed = parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 500) {
        count = parsed;
      }
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
        plan = val;
      }
      i++;
    } else if (arg === '--seed') {
      seed = true;
    }
  }

  return { count, plan, seed };
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
  const { count, plan, seed } = parseArgs(process.argv.slice(2));
  const generated: Array<{ code: string; hash: string; plan: string }> = [];
  const seen = new Set<string>();

  while (generated.length < count) {
    const code = generateActivationCode();
    if (seen.has(code)) continue;
    seen.add(code);
    generated.push({
      code,
      hash: hashActivationCode(code),
      plan,
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
