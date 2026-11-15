export interface FirestoreRestValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string | number;
  doubleValue?: number | string;
  timestampValue?: string;
  stringValue?: string;
  bytesValue?: string;
  referenceValue?: string;
  geoPointValue?: { latitude?: number; longitude?: number };
  arrayValue?: { values?: FirestoreRestValue[] };
  mapValue?: { fields?: Record<string, FirestoreRestValue> };
}

export interface FirestoreRestDocument {
  name?: string;
  fields?: Record<string, FirestoreRestValue>;
  createTime?: string;
  updateTime?: string;
}

export function isFirestorePermissionDeniedError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const record = err as { code?: unknown; message?: unknown; details?: unknown };
    if (
      record.code === 7 ||
      record.code === '7' ||
      record.code === 'permission-denied' ||
      record.code === 'PERMISSION_DENIED'
    ) {
      return true;
    }
    const msg = `${String(record.message || '')} ${String(record.details || '')}`;
    if (
      /PERMISSION_DENIED|Missing or insufficient permissions|Could not load the default credentials/i.test(
        msg
      )
    ) {
      return true;
    }
  }
  if (typeof err === 'string') {
    return /PERMISSION_DENIED|Missing or insufficient permissions|Could not load the default credentials/i.test(
      err
    );
  }
  return false;
}

export function decodeFirestoreValue(val: FirestoreRestValue | undefined): unknown {
  if (!val || typeof val !== 'object') return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) {
    const n = Number(val.integerValue);
    return Number.isFinite(n) ? n : 0;
  }
  if ('doubleValue' in val) {
    const n = Number(val.doubleValue);
    return Number.isFinite(n) ? n : 0;
  }
  if ('stringValue' in val) return String(val.stringValue ?? '');
  if ('timestampValue' in val) return String(val.timestampValue ?? '');
  if ('referenceValue' in val) return String(val.referenceValue ?? '');
  if ('bytesValue' in val) return String(val.bytesValue ?? '');
  if ('geoPointValue' in val) return val.geoPointValue;
  if ('arrayValue' in val) {
    const values = val.arrayValue?.values;
    return Array.isArray(values) ? values.map((item) => decodeFirestoreValue(item)) : [];
  }
  if ('mapValue' in val) {
    return decodeFirestoreDocumentFields(val.mapValue?.fields);
  }
  return undefined;
}

export function decodeFirestoreDocumentFields(
  fields?: Record<string, FirestoreRestValue>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [key, value] of Object.entries(fields)) {
    const decoded = decodeFirestoreValue(value);
    if (decoded !== undefined) {
      out[key] = decoded;
    }
  }
  return out;
}

export async function fetchFirestoreDocumentWithToken(params: {
  projectId: string;
  databaseId?: string;
  documentPath: string;
  idToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ exists: boolean; data?: Record<string, unknown>; forbidden?: boolean }> {
  const cleanPath = params.documentPath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  if (!cleanPath || !params.projectId || !params.idToken) {
    return { exists: false };
  }

  const dbId = params.databaseId?.trim() || '(default)';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    params.projectId
  )}/databases/${encodeURIComponent(dbId)}/documents/${cleanPath}`;

  const fetcher = params.fetchImpl || fetch;
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.idToken}`,
      },
    });

    if (response.status === 404) {
      return { exists: false };
    }
    if (response.status === 401 || response.status === 403) {
      return { exists: false, forbidden: true };
    }
    if (!response.ok) {
      return { exists: false };
    }

    const json = (await response.json()) as FirestoreRestDocument;
    return {
      exists: true,
      data: decodeFirestoreDocumentFields(json.fields),
    };
  } catch {
    return { exists: false };
  }
}
