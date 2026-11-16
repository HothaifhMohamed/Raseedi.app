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
