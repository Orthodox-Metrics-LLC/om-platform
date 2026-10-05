import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Typed client for OM's Assets Library API (`/api/assets`, prod:
 * server/src/routes/om-assets.js). Ported from prod's
 * features/assets-library/api/omAssetsApi.ts; only the transport changed
 * (omApiFetch instead of the legacy axios instance). Response shapes are unchanged.
 */

export type AssetSortField =
  | 'name' | 'name_desc' | 'scope' | 'scope_desc' | 'size' | 'size_desc'
  | 'created' | 'created_desc' | 'updated' | 'updated_desc'
  | 'category' | 'category_desc';

export const ASSET_SORT_OPTIONS: { id: AssetSortField; label: string }[] = [
  { id: 'created_desc', label: 'Newest first' },
  { id: 'created', label: 'Oldest first' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'name_desc', label: 'Name Z–A' },
  { id: 'size_desc', label: 'Largest first' },
  { id: 'size', label: 'Smallest first' },
  { id: 'scope', label: 'Scope A–Z' },
  { id: 'scope_desc', label: 'Scope Z–A' },
  { id: 'updated_desc', label: 'Updated newest' },
  { id: 'updated', label: 'Updated oldest' },
  { id: 'category', label: 'Type A–Z' },
  { id: 'category_desc', label: 'Type Z–A' },
];

type ReqOpts = { params?: object; headers?: Record<string, string>; responseType?: 'blob'; signal?: AbortSignal };

function withParams(url: string, params?: object) {
  if (!params) return url;
  const sp = new URLSearchParams();
  Object.entries(params as Record<string, unknown>).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    sp.set(k, String(v));
  });
  const qs = sp.toString();
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

async function request<T>(method: string, url: string, body?: unknown, opts?: ReqOpts): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await omApiFetch(`/api${withParams(url, opts?.params)}`, {
    method,
    headers: { ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(opts?.headers ?? {}) },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    signal: opts?.signal,
  });
  if (opts?.responseType === 'blob') {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return (await res.blob()) as unknown as T;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false || json?.ok === false) {
    throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

/** axios-like facade so the ported call sites stay identical. */
const apiClient = {
  get: <T,>(url: string, opts?: ReqOpts) => request<T>('GET', url, undefined, opts),
  post: <T,>(url: string, body?: unknown, opts?: ReqOpts) => request<T>('POST', url, body, opts),
  put: <T,>(url: string, body?: unknown, opts?: ReqOpts) => request<T>('PUT', url, body, opts),
  delete: <T,>(url: string, opts?: ReqOpts) => request<T>('DELETE', url, undefined, opts),
};

export type OmAssetScope = 'public' | 'church' | 'site' | 'internal';
export type OmAssetVisibility = 'public' | 'authenticated' | 'internal_only';
export type OmAssetSourceType =
  | 'upload' | 'import' | 'legacy' | 'generated' | 'screenshot' | 'promote_copy' | 'quarantine';
export type OmAssetOwnerSystem =
  | 'om' | 'omai' | 'omstudio' | 'omworkshop' | 'ombrain' | 'certificate_studio' | 'public_website';

export interface OmAssetCollection {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  scope: OmAssetScope;
  visibility: OmAssetVisibility;
  category?: string | null;
  folder?: string | null;
  source_type: OmAssetSourceType;
  owner_system: OmAssetOwnerSystem;
  asset_count?: number;
  metadata_json?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface OmAsset {
  id: number;
  name: string;
  title?: string | null;
  description?: string | null;
  alt_text?: string | null;
  caption?: string | null;
  credit?: string | null;
  slug?: string | null;
  scope: OmAssetScope;
  visibility?: OmAssetVisibility;
  collection_id?: number | null;
  collection_name?: string | null;
  church_id: number | null;
  church_name?: string | null;
  church_label?: string | null;
  category: string;
  primary_tag?: string | null;
  secondary_tag?: string | null;
  folder?: string | null;
  source_type?: OmAssetSourceType;
  owner_system?: OmAssetOwnerSystem;
  file_path: string | null;
  storage_path?: string | null;
  file_type: string | null;
  mime_type?: string | null;
  width: number | null;
  height: number | null;
  file_size?: number | null;
  sha256?: string | null;
  checksum_sha256?: string | null;
  directory?: string | null;
  tags?: string[];
  metadata_json: Record<string, unknown> | null;
  licensing_note: string | null;
  product_tags: string[] | null;
  status: string;
  url: string | null;
  public_url?: string | null;
  internal_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface OmAssetDuplicateGroup {
  type: 'exact';
  sha256: string;
  assets: OmAsset[];
}

export interface OmAssetSimilarGroup {
  type: 'similar';
  key: string;
  category: string;
  width: number;
  height: number;
  assets: OmAsset[];
}

/** A file whose name starts with a type or tag it is not currently filed as. */
export interface OmAssetCategorySuggestion {
  id: number;
  name: string;
  category: string;
  primary_tag?: string | null;
  secondary_tag?: string | null;
  suggested_category: string;
  suggested_primary_tag?: string | null;
  suggested_secondary_tag?: string | null;
}

export interface OmAssetClassification {
  category: string;
  primary_tag?: string | null;
  secondary_tag?: string | null;
}

export interface ImageTransformPayload {
  rotate?: number;
  width?: number;
  height?: number;
  crop?: { left: number; top: number; width: number; height: number };
}

const BASE = '/assets';

export interface OmAssetListParams {
  scope?: OmAssetScope;
  visibility?: OmAssetVisibility;
  collection_id?: number;
  source_type?: OmAssetSourceType;
  owner_system?: OmAssetOwnerSystem;
  category?: string;
  primary_tag?: string;
  secondary_tag?: string;
  church_id?: number;
  search?: string;
  directory?: string;
  folder?: string;
  tag?: string;
  sort?: AssetSortField;
  file_type?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  page?: number;
  page_size?: number;
  paginate?: 'cursor';
  cursor?: string | null;
  smart_search?: boolean;
}

export interface OmAssetPage {
  assets: OmAsset[];
  total: number;
  page: number;
  page_size: number;
  scope_counts: Partial<Record<OmAssetScope, number>>;
  folder_counts: Record<string, number>;
}

/**
 * Cursor (keyset) page response for incremental grid loading. `nextCursor` is
 * opaque (base64url of the last row's sort value + id). `total`/`scopeCounts`/
 * `folderCounts` are only present on the first page (no input cursor).
 */
export interface OmAssetCursorPage {
  items: OmAsset[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
  scopeCounts?: Partial<Record<OmAssetScope, number>>;
  folderCounts?: Record<string, number>;
  pageSize: number;
}

export async function fetchOmAssets(params?: Omit<OmAssetListParams, 'page' | 'page_size'>) {
  const res = await apiClient.get<{ assets: OmAsset[] }>(BASE, { params });
  return res?.assets ?? [];
}

/** Paginated listing with server-computed total + per-scope / per-folder counts. */
export async function fetchOmAssetsPage(params?: OmAssetListParams): Promise<OmAssetPage> {
  const res = await apiClient.get<OmAssetPage>(BASE, { params });
  return {
    assets: res?.assets ?? [],
    total: res?.total ?? (res?.assets?.length ?? 0),
    page: res?.page ?? 1,
    page_size: res?.page_size ?? (res?.assets?.length ?? 0),
    scope_counts: res?.scope_counts ?? {},
    folder_counts: res?.folder_counts ?? {},
  };
}

/**
 * Cursor (keyset) page for incremental grid loading. Pass `cursor: null` (or
 * omit) for the first page; the response's `nextCursor` feeds the next call.
 * An optional AbortSignal lets callers cancel/ignore stale requests when the
 * query options change mid-flight.
 */
export async function fetchOmAssetsCursorPage(
  params: Omit<OmAssetListParams, 'page' | 'page_size' | 'paginate'> & { limit: number; cursor?: string | null },
  signal?: AbortSignal,
): Promise<OmAssetCursorPage> {
  const res = await apiClient.get<{
    assets?: OmAsset[];
    items?: OmAsset[];
    next_cursor?: string | null;
    has_more?: boolean;
    total?: number;
    scope_counts?: Partial<Record<OmAssetScope, number>>;
    folder_counts?: Record<string, number>;
    page_size?: number;
  }>(BASE, { params: { ...params, paginate: 'cursor' }, signal });
  const items = res?.items ?? res?.assets ?? [];
  return {
    items,
    nextCursor: res?.next_cursor ?? null,
    hasMore: res?.has_more ?? false,
    total: res?.total,
    scopeCounts: res?.scope_counts,
    folderCounts: res?.folder_counts,
    pageSize: res?.page_size ?? params.limit,
  };
}

export async function fetchOmAsset(id: number) {
  const res = await apiClient.get<{ asset: OmAsset }>(`${BASE}/${id}`);
  return res.asset;
}

export function omAssetFileUrl(id: number) {
  return `/api${BASE}/${id}/file`;
}

/**
 * Absolute, directly-servable URL for an asset. Uses the ID-based file route so
 * it stays correct regardless of on-disk folder placement, and prefixes the
 * current origin so it can be pasted anywhere.
 */
export function omAssetDirectUrl(asset: Pick<OmAsset, 'id' | 'public_url'>) {
  const relative = asset.public_url || omAssetFileUrl(asset.id);
  if (/^https?:\/\//i.test(relative)) return relative;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${relative}`;
}

export async function uploadOmAsset(
  formData: FormData,
  onProgress?: (percent: number) => void,
) {
  // XHR so large videos report progress; auth via the session cookie + bearer like omApiFetch.
  const asset = await new Promise<OmAsset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${BASE}`);
    xhr.withCredentials = true;
    const token = sessionStorage.getItem('om_access_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (evt) => { if (onProgress && evt.lengthComputable) onProgress(Math.round((evt.loaded * 100) / evt.total)); };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && json.asset) resolve(json.asset);
        else reject(new Error(json.message || json.error || `Upload failed (${xhr.status})`));
      } catch { reject(new Error(`Upload failed (${xhr.status})`)); }
    };
    xhr.send(formData);
  });
  return asset;
}

/* ─── ZIP image import ─── */

export type ZipNamingStrategy = 'smart' | 'sequential' | 'preserve';
export type ZipImportEntry = {
  index?: number;
  entry_name?: string;
  original_name: string;
  stored_filename?: string;
  title?: string;
  alt_text?: string;
  size?: number;
  media_type?: 'image' | 'video';
  status: 'ready' | 'skipped' | 'imported' | 'duplicate' | 'failed';
  reason?: string;
  error?: string;
  asset_id?: number;
  duplicate_asset_id?: number;
};
export type ZipImportAnalysis = {
  id: number;
  import_token: string;
  archive_filename: string;
  archive_slug: string;
  scope: OmAssetScope;
  church_id: number | null;
  category: string;
  folder: string;
  naming_strategy: ZipNamingStrategy;
  tags: string[];
  total_bytes: number;
  manifest: ZipImportEntry[];
};
export type ZipImportResult = {
  id: number;
  import_token: string;
  status: 'completed' | 'partial' | 'failed';
  imported_count: number;
  skipped_count: number;
  failed_count: number;
  report: ZipImportEntry[];
};

const ZIP_CHUNK_BYTES = 64 * 1024 * 1024;
const ZIP_CHUNK_THRESHOLD_BYTES = 450 * 1024 * 1024;

function postZipForm<T>(url: string, formData: FormData, onProgress?: (percent: number) => void) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    const token = sessionStorage.getItem('om_access_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => { if (onProgress && event.lengthComputable) onProgress(Math.round((event.loaded * 100) / event.total)); };
    xhr.onerror = () => reject(new Error('ZIP upload failed'));
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(json as T);
        else reject(new Error(json.message || json.error || `ZIP request failed (${xhr.status})`));
      } catch { reject(new Error(`ZIP request failed (${xhr.status})`)); }
    };
    xhr.send(formData);
  });
}

async function analyzeChunkedZipImport(file: File, options: FormData, onProgress?: (percent: number) => void) {
  const totalChunks = Math.ceil(file.size / ZIP_CHUNK_BYTES);
  const started = await apiClient.post<{ upload: { upload_id: string } }>(`${BASE}/zip-import/chunks/start`, {
    filename: file.name,
    total_bytes: file.size,
    total_chunks: totalChunks,
  });
  const uploadId = started.upload.upload_id;
  let uploadedBytes = 0;

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * ZIP_CHUNK_BYTES;
    const chunk = file.slice(start, Math.min(file.size, start + ZIP_CHUNK_BYTES));
    const form = new FormData();
    form.append('chunk_index', String(index));
    form.append('chunk', chunk, `${file.name}.part-${index}`);
    await postZipForm(`/api${BASE}/zip-import/chunks/${uploadId}`, form, (percent) => {
      if (!onProgress) return;
      const loaded = Math.round((chunk.size * percent) / 100);
      onProgress(Math.round(((uploadedBytes + loaded) * 100) / file.size));
    });
    uploadedBytes += chunk.size;
  }

  const result = await apiClient.post<{ import: ZipImportAnalysis }>(`${BASE}/zip-import/chunks/${uploadId}/complete`, {
    scope: options.get('scope'),
    church_id: options.get('church_id'),
    category: options.get('category'),
    folder: options.get('folder'),
    naming_strategy: options.get('naming_strategy'),
  });
  onProgress?.(100);
  return result.import;
}

export async function analyzeZipImport(formData: FormData, onProgress?: (percent: number) => void) {
  const archive = formData.get('archive');
  if (archive instanceof File && archive.size > ZIP_CHUNK_THRESHOLD_BYTES) {
    return analyzeChunkedZipImport(archive, formData, onProgress);
  }

  const result = await postZipForm<{ import: ZipImportAnalysis }>(`/api${BASE}/zip-import/analyze`, formData, onProgress);
  if (!result.import) throw new Error('ZIP analysis failed');
  return result.import;
}

export async function commitZipImport(token: string, payload: {
  scope?: OmAssetScope;
  church_id?: number | null;
  category?: string;
  folder?: string;
  collection_id?: number | null;
  tags?: string[];
  skip_duplicates?: boolean;
  entries?: Partial<ZipImportEntry>[];
}): Promise<ZipImportResult> {
  const res = await apiClient.post<{ import: ZipImportResult }>(`${BASE}/zip-import/${token}/commit`, payload);
  return res.import;
}

export async function cancelZipImport(token: string): Promise<boolean> {
  const res = await apiClient.delete<{ cancelled: boolean }>(`${BASE}/zip-import/${token}`);
  return !!res.cancelled;
}

export async function listZipImports(): Promise<any[]> {
  const res = await apiClient.get<{ imports: any[] }>(`${BASE}/zip-imports`);
  return res.imports || [];
}

/* ─── Smart Upload Assist ─── */

export interface AnalyzeUploadFileInput {
  original_filename: string;
  mime?: string;
  size?: number;
  width?: number | null;
  height?: number | null;
  title?: string;
  detected_text?: string;
  detected_labels?: string[];
}

export interface SmartUploadSuggestion {
  original_filename: string;
  stored_filename: string;
  display_name: string;
  title: string;
  category: string;
  primary_tag?: string | null;
  secondary_tag?: string | null;
  category_label: string;
  category_confidence: number;
  classification_source: 'manual' | 'smart' | 'edited' | 'content' | 'filename' | 'context' | 'fallback' | 'heuristic';
  collection_name?: string | null;
  collection_id?: number | null;
  folder: string;
  tags: string[];
  alt_text: string;
  caption: string;
  description: string;
  source_type: string;
  owner_system: string;
  theme?: string | null;
  explanation: string;
  warnings: string[];
  is_image: boolean;
}

export interface AnalyzeUploadResponse {
  destination: {
    scope: OmAssetScope;
    visibility: OmAssetVisibility;
    church_id: number | null;
    permitted: boolean;
    error: string | null;
  };
  vision_enabled: boolean;
  suggestions: SmartUploadSuggestion[];
}

export async function analyzeUploadAssets(payload: {
  scope?: OmAssetScope | '';
  church_id?: number | null;
  category?: string;
  collection_id?: number | null;
  folder?: string;
  files: AnalyzeUploadFileInput[];
}): Promise<AnalyzeUploadResponse> {
  const res = await apiClient.post<AnalyzeUploadResponse>(`${BASE}/analyze-upload`, payload);
  return {
    destination: res?.destination ?? {
      scope: (payload.scope || 'public') as OmAssetScope,
      visibility: 'public',
      church_id: payload.church_id ?? null,
      permitted: true,
      error: null,
    },
    vision_enabled: res?.vision_enabled ?? false,
    suggestions: res?.suggestions ?? [],
  };
}

export async function updateOmAsset(
  id: number,
  payload: Partial<Pick<OmAsset,
    'name' | 'title' | 'description' | 'alt_text' | 'caption' | 'credit' |
    'category' | 'primary_tag' | 'secondary_tag' | 'licensing_note' | 'status' | 'tags' | 'directory' | 'folder' |
    'visibility' | 'collection_id' | 'source_type' | 'owner_system' | 'scope'
  >>,
) {
  const res = await apiClient.put<{ asset: OmAsset }>(`${BASE}/${id}`, payload);
  return res.asset;
}

export async function deleteOmAsset(id: number) {
  await apiClient.delete(`${BASE}/${id}`);
}

/** @deprecated use deleteOmAsset */
export const archiveOmAsset = deleteOmAsset;

export async function bulkDeleteOmAssets(ids: number[]) {
  const res = await apiClient.post<{ success: boolean; archived: number }>(`${BASE}/bulk-archive`, { ids });
  return res;
}

/** @deprecated use bulkDeleteOmAssets */
export const bulkArchiveOmAssets = bulkDeleteOmAssets;

/** Hard delete — removes the file + row permanently. Cannot be undone (unlike deleteOmAsset, which archives). */
export async function purgeOmAsset(id: number) {
  await apiClient.delete(`${BASE}/${id}/purge`);
}

export async function bulkPurgeOmAssets(ids: number[]) {
  const res = await apiClient.post<{ success: boolean; purged: number }>(`${BASE}/bulk-purge`, { ids });
  return res;
}

export async function bulkChangeOmAssetScope(ids: number[], scope: OmAssetScope, church_id?: number | null) {
  const res = await apiClient.post<{ success: boolean; assets: OmAsset[] }>(`${BASE}/bulk-scope`, {
    ids,
    scope,
    church_id,
  });
  return res.assets;
}

export async function copyOmAsset(
  id: number,
  payload: { target_scope: OmAssetScope; visibility?: OmAssetVisibility; church_id?: number; collection_id?: number; promote?: boolean },
) {
  const res = await apiClient.post<{ asset: OmAsset }>(`${BASE}/${id}/copy`, payload);
  return res.asset;
}

export async function fetchOmAssetDirectories(params?: { scope?: OmAssetScope; church_id?: number }) {
  const res = await apiClient.get<{ directories: string[] }>(`${BASE}/directories`, { params });
  return res?.directories ?? [];
}

export async function createOmAssetDirectory(scope: OmAssetScope, path: string, church_id?: number | null) {
  const res = await apiClient.post<{ success: boolean; directory: string }>(`${BASE}/directories`, {
    scope,
    path,
    church_id,
  });
  return res.directory;
}

export async function bulkMoveOmAssets(ids: number[], directory: string) {
  const res = await apiClient.post<{ success: boolean; assets: OmAsset[] }>(`${BASE}/bulk-move`, {
    ids,
    directory,
  });
  return res.assets;
}

export async function bulkSetOmAssetTags(ids: number[], tags: string[], mode: 'set' | 'add' | 'remove' = 'add') {
  const res = await apiClient.post<{ success: boolean; assets: OmAsset[] }>(`${BASE}/bulk-tags`, {
    ids,
    tags,
    mode,
  });
  return res.assets;
}

export async function bulkChangeOmAssetCategory(ids: number[], classification: OmAssetClassification) {
  const res = await apiClient.post<{ success: boolean; assets: OmAsset[] }>(`${BASE}/bulk-category`, {
    ids,
    ...classification,
  });
  return res.assets;
}

export async function fetchOmAssetCategorySuggestions() {
  const res = await apiClient.get<{ suggestions: OmAssetCategorySuggestion[] }>(`${BASE}/category-suggestions`);
  return res?.suggestions ?? [];
}

export async function fetchOmAssetTags(params?: { scope?: OmAssetScope; church_id?: number }) {
  const res = await apiClient.get<{ tags: string[] }>(`${BASE}/tags`, { params });
  return res?.tags ?? [];
}

export async function bulkDeleteOmAssetDuplicates() {
  const res = await apiClient.post<{
    success: boolean;
    archived: number;
    groups: number;
    removed_ids: number[];
  }>(`${BASE}/bulk-delete-duplicates`);
  return res;
}

export async function fetchOmAssetDuplicates() {
  const res = await apiClient.get<{ groups: OmAssetDuplicateGroup[] }>(`${BASE}/duplicates`);
  return res?.groups ?? [];
}

export async function fetchOmAssetSimilarGroups() {
  const res = await apiClient.get<{ groups: OmAssetSimilarGroup[] }>(`${BASE}/similar-groups`);
  return res?.groups ?? [];
}

export async function transformOmAssetImage(id: number, payload: ImageTransformPayload) {
  const res = await apiClient.post<{ asset: OmAsset }>(`${BASE}/${id}/transform`, payload);
  return res.asset;
}

export interface SplitOmAssetPayload {
  rows: number;
  cols: number;
  delete_source?: boolean;
}

export async function splitOmAsset(id: number, payload: SplitOmAssetPayload) {
  const res = await apiClient.post<{ success: boolean; assets: OmAsset[]; deleted_source: boolean }>(
    `${BASE}/${id}/split`,
    payload,
  );
  return res;
}

/* ─── Collections ─── */

export async function fetchOmAssetCollections(params?: {
  scope?: OmAssetScope;
  visibility?: OmAssetVisibility;
  search?: string;
}) {
  const res = await apiClient.get<{ collections: OmAssetCollection[] }>(`${BASE}/collections`, { params });
  return res?.collections ?? [];
}

export async function fetchOmAssetCollection(id: number) {
  const res = await apiClient.get<{ collection: OmAssetCollection; assets: OmAsset[] }>(`${BASE}/collections/${id}`);
  return res;
}

export async function createOmAssetCollection(payload: Partial<OmAssetCollection> & { name: string }) {
  const res = await apiClient.post<{ collection: OmAssetCollection }>(`${BASE}/collections`, payload);
  return res.collection;
}

export async function updateOmAssetCollection(id: number, payload: Partial<OmAssetCollection>) {
  const res = await apiClient.put<{ collection: OmAssetCollection }>(`${BASE}/collections/${id}`, payload);
  return res.collection;
}

export async function deleteOmAssetCollection(id: number) {
  await apiClient.delete(`${BASE}/collections/${id}`);
}

export async function assignOmAssetsToCollection(collectionId: number, ids: number[]) {
  const res = await apiClient.post<{ success: boolean; assigned: number }>(
    `${BASE}/collections/${collectionId}/assign`,
    { ids },
  );
  return res;
}

export async function removeOmAssetsFromCollection(collectionId: number, ids: number[]) {
  const res = await apiClient.post<{ success: boolean; removed: number }>(
    `${BASE}/collections/${collectionId}/remove`,
    { ids },
  );
  return res;
}

/* ─── Workshop handoff ─── */

export type WorkshopDestinationType = 'inbox' | 'workspace';

export interface WorkshopDestination {
  siteId: string;
  displayName: string;
  classification?: string | null;
  baseUrl?: string | null;
  activeRevision?: {
    id: string;
    branchName?: string;
    workspaceStatus?: string;
    previewUrl?: string | null;
  } | null;
}

export async function fetchWorkshopDestinations() {
  const res = await apiClient.get<{ success?: boolean; ok?: boolean; items: WorkshopDestination[] }>(
    `${BASE}/workshop/destinations`,
  );
  return res?.items ?? [];
}

export async function sendAssetsToWorkshop(payload: {
  assetIds: number[];
  destinationType: WorkshopDestinationType;
  siteId?: string;
  revisionId?: string;
}) {
  const res = await apiClient.post<{
    success?: boolean;
    ok?: boolean;
    imported?: unknown[];
    failed?: unknown[];
    transfers?: unknown[];
    error?: string;
    message?: string;
  }>(`${BASE}/workshop/send`, payload);
  return res;
}

// ----------------------------------------------------------------------
// Cloud Files — real-time browse of the \\192.168.1.79\screenshots SMB share.
// Not backed by om_assets; always reflects exactly what's on the share right
// now, independent of the scheduled screenshots_share import.

export type CloudFileEntry = {
  name: string;
  type: 'file' | 'directory';
  size: number | null;
  modified_at: string;
  path: string;
  file_url: string | null;
  thumb_url: string | null;
};

export async function fetchCloudFilesScreenshots(path = '') {
  return apiClient.get<{ path: string; entries: CloudFileEntry[]; share: string }>(
    `${BASE}/cloud-files/screenshots`,
    { params: { path } }
  );
}

/** Permanently removes a file from the live share — no recovery, this is real personal data. */
export async function deleteCloudFileScreenshot(filePath: string) {
  await apiClient.delete(`${BASE}/cloud-files/screenshots/file`, { params: { path: filePath } });
}

// ----------------------------------------------------------------------
// Website files — live browse/replace of front-end/public.
// Writes the public source and the dist copy the site is serving.

export type WebsiteFileEntry = {
  name: string;
  type: 'file' | 'directory';
  size: number | null;
  modified_at: string;
  path: string;
  public_url: string | null;
  file_url: string | null;
  thumb_url: string | null;
};

export async function fetchWebsiteFiles(filePath = '') {
  return apiClient.get<{ path: string; root: string; entries: WebsiteFileEntry[] }>(
    `${BASE}/website-files/list`,
    { params: { path: filePath } }
  );
}

export async function replaceWebsiteFile(filePath: string, file: File) {
  const body = new FormData();
  body.append('path', filePath);
  body.append('file', file);
  return apiClient.post<{ success: boolean; mirrored: boolean; converted?: boolean; entry: WebsiteFileEntry }>(
    `${BASE}/website-files/replace`,
    body
  );
}

export async function uploadWebsiteFile(directoryPath: string, file: File) {
  const body = new FormData();
  body.append('path', directoryPath);
  body.append('file', file);
  return apiClient.post<{ success: boolean; mirrored: boolean; entry: WebsiteFileEntry }>(
    `${BASE}/website-files/upload`,
    body
  );
}

// ----------------------------------------------------------------------
// Handoff notes — Cursor updates and super-admin replies.

export type HandoffNoteSummary = {
  path: string;
  name: string;
  folder: string;
  size: number;
  modified_at: string;
  latest: boolean;
  has_reply: boolean;
  attachment_count: number;
};

export type HandoffAttachment = {
  id: string;
  name: string;
  size: number;
  modified_at: string | null;
  kind: 'image' | 'video' | 'file';
};

export type HandoffNote = {
  path: string;
  name: string;
  folder: string;
  modified_at: string | null;
  content: string;
  reply: string;
  attachments: HandoffAttachment[];
};

export function handoffAttachmentUrl(notePath: string, id: string) {
  const params = new URLSearchParams({ note: notePath, id });
  return `/api/assets/handoff-notes/attachment?${params.toString()}`;
}

export async function fetchHandoffNotes() {
  return apiClient.get<{ items: HandoffNoteSummary[]; inbox: { path: string; modified_at: string; size: number } | null }>(
    `${BASE}/handoff-notes/list`
  );
}

export async function fetchHandoffNote(filePath: string) {
  return apiClient.get<HandoffNote>(`${BASE}/handoff-notes/file`, { params: { path: filePath } });
}

export async function sendHandoffNote(filePath: string, message: string) {
  return apiClient.post<{ success: boolean; note: HandoffNote }>(`${BASE}/handoff-notes/note`, {
    path: filePath,
    message,
  });
}

export async function sendHandoffAttachments(filePath: string, message: string, files: File[]) {
  const body = new FormData();
  body.append('path', filePath);
  body.append('message', message);
  files.forEach((file) => body.append('files', file));
  return apiClient.post<{ success: boolean; note: HandoffNote }>(`${BASE}/handoff-notes/attach`, body);
}
