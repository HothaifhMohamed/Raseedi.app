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

export function encodeFirestoreValue(value: unknown): FirestoreRestValue {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { nullValue: null };
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => encodeFirestoreValue(item)),
      },
    };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: encodeFirestoreDocumentFields(value as Record<string, unknown>),
      },
    };
  }
  return { stringValue: String(value) };
}

export function encodeFirestoreDocumentFields(
  obj: Record<string, unknown>
): Record<string, FirestoreRestValue> {
  const fields: Record<string, FirestoreRestValue> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    fields[key] = encodeFirestoreValue(val);
  }
  return fields;
}

export async function listFirestoreDocumentsWithToken(params: {
  projectId: string;
  databaseId?: string;
  collectionPath: string;
  idToken: string;
  pageSize?: number;
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  forbidden?: boolean;
  status?: number;
  docs: Array<{ id: string; data: Record<string, unknown> }>;
}> {
  const cleanCollection = params.collectionPath
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/');

  if (!cleanCollection || !params.projectId || !params.idToken) {
    return { ok: false, docs: [] };
  }

  const dbId = params.databaseId?.trim() || '(default)';
  const pageSize = Math.min(300, Math.max(1, params.pageSize || 100));
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    params.projectId
  )}/databases/${encodeURIComponent(dbId)}/documents/${cleanCollection}?pageSize=${pageSize}`;

  const fetcher = params.fetchImpl || fetch;
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.idToken}`,
      },
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, forbidden: true, status: response.status, docs: [] };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, docs: [] };
    }

    const json = (await response.json()) as { documents?: FirestoreRestDocument[] };
    const docs = Array.isArray(json.documents)
      ? json.documents.map((docItem) => {
          const parts = String(docItem.name || '').split('/');
          const id = parts[parts.length - 1] || '';
          return {
            id,
            data: decodeFirestoreDocumentFields(docItem.fields),
          };
        })
      : [];
    return { ok: true, docs };
  } catch {
    return { ok: false, docs: [] };
  }
}

export async function commitFirestoreWriteWithToken(params: {
  projectId: string;
  databaseId?: string;
  documentPath: string;
  idToken: string;
  data: Record<string, unknown>;
  updateMaskFields?: string[];
  serverTimestampFields?: string[];
  currentDocumentExists?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; forbidden?: boolean; status?: number; errorText?: string }> {
  const cleanSegments = params.documentPath
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (cleanSegments.length < 2 || cleanSegments.length % 2 !== 0 || !params.projectId || !params.idToken) {
    return { ok: false, errorText: 'INVALID_DOCUMENT_PATH' };
  }

  const dbId = params.databaseId?.trim() || '(default)';
  const fullName = `projects/${params.projectId}/databases/${dbId}/documents/${cleanSegments.join('/')}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    params.projectId
  )}/databases/${encodeURIComponent(dbId)}/documents:commit`;

  const fields = encodeFirestoreDocumentFields(params.data);
  const updateTransforms = (params.serverTimestampFields || []).map((fieldPath) => ({
    fieldPath,
    setToServerValue: 'REQUEST_TIME',
  }));

  const writeOp: Record<string, unknown> = {
    update: {
      name: fullName,
      fields,
    },
  };
  if (params.updateMaskFields && params.updateMaskFields.length > 0) {
    writeOp.updateMask = { fieldPaths: params.updateMaskFields };
  }
  if (updateTransforms.length > 0) {
    writeOp.updateTransforms = updateTransforms;
  }
  if (typeof params.currentDocumentExists === 'boolean') {
    writeOp.currentDocument = { exists: params.currentDocumentExists };
  }

  const fetcher = params.fetchImpl || fetch;
  try {
    const response = await fetcher(commitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.idToken}`,
      },
      body: JSON.stringify({ writes: [writeOp] }),
    });

    if (response.status === 401 || response.status === 403) {
      const errorText = await response.text().catch(() => '');
      return { ok: false, forbidden: true, status: response.status, errorText };
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return { ok: false, status: response.status, errorText };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    return { ok: false, errorText: err instanceof Error ? err.message : String(err) };
  }
}
