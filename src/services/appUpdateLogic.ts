export interface VersionManifest {
  version: string;
  buildId: string;
  builtAt: string;
}

export interface AutoReloadCheckParams {
  targetKey: string;
  lastReloadedKey: string | null;
  nowMs: number;
  lastReloadTimestampMs: number | null;
  minIntervalMs?: number;
}

export function parseVersionManifest(data: unknown): VersionManifest | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const version = typeof record.version === 'string' ? record.version.trim() : '';
  const buildId = typeof record.buildId === 'string' ? record.buildId.trim() : '';
  const builtAt = typeof record.builtAt === 'string' ? record.builtAt.trim() : '';
  if (!buildId) return null;
  return {
    version: version || '1.0.0',
    buildId,
    builtAt,
  };
}

export function isNewerBuildAvailable(
  currentBuildId: string,
  remote: VersionManifest | null
): boolean {
  const current = currentBuildId.trim();
  const remoteId = remote?.buildId?.trim() || '';
  if (!current || !remoteId) return false;
  return current !== remoteId;
}

export function shouldAttemptAutoReload(params: AutoReloadCheckParams): boolean {
  const target = params.targetKey.trim();
  if (!target) return false;
  if (params.lastReloadedKey && params.lastReloadedKey === target) {
    return false;
  }
  const minInterval = params.minIntervalMs ?? 15_000;
  if (
    typeof params.lastReloadTimestampMs === 'number' &&
    Number.isFinite(params.lastReloadTimestampMs) &&
    params.nowMs - params.lastReloadTimestampMs < minInterval
  ) {
    return false;
  }
  return true;
}

export function buildNoCacheUrl(path: string, nowMs: number = Date.now()): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}t=${nowMs}`;
}

export interface ChunkRecoveryParams {
  nowMs: number;
  lastAttemptMs: number | null;
  isOnline: boolean;
  cooldownMs?: number;
}

const CHUNK_ERROR_PATTERNS = [
  'chunkloaderror',
  'loading chunk',
  'failed to fetch dynamically imported module',
  'importing a module script failed',
  'error loading dynamically imported module',
  'unable to preload css',
  'dynamically imported module',
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  let text = '';
  if (typeof error === 'string') {
    text = error;
  } else if (error instanceof Error) {
    text = `${error.name || ''} ${error.message || ''}`;
  } else if (typeof error === 'object') {
    const rec = error as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name : '';
    const message = typeof rec.message === 'string' ? rec.message : '';
    text = `${name} ${message}`;
  }
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return CHUNK_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function shouldAttemptChunkRecoveryReload(params: ChunkRecoveryParams): boolean {
  if (!params.isOnline) return false;
  const cooldown = params.cooldownMs ?? 20_000;
  if (
    typeof params.lastAttemptMs === 'number' &&
    Number.isFinite(params.lastAttemptMs) &&
    params.nowMs - params.lastAttemptMs < cooldown
  ) {
    return false;
  }
  return true;
}

