import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Sacramental records data layer — all on OM's existing APIs:
 *   /api/{baptism|marriage|funeral}-records      CRUD, status, history (audit), dropdown options
 *   /api/lookup/clergy                           canonical clergy list
 *   /api/parish-records/search/*                 governed parish search, exports, saved searches, duplicates
 *   /api/certificates/*                          Certificate Studio (templates, preview, render, history)
 *   /api/churches/:id/charts/summary             analytics
 */

export type RecordType = 'baptism' | 'marriage' | 'funeral';
export const RECORD_TYPES: { value: RecordType; label: string; plural: string; icon: string; color: 'primary' | 'secondary' | 'warning' }[] = [
  { value: 'baptism', label: 'Baptism', plural: 'Baptisms', icon: 'custom:cross-bold', color: 'primary' },
  { value: 'marriage', label: 'Marriage', plural: 'Marriages', icon: 'solar:heart-bold', color: 'secondary' },
  { value: 'funeral', label: 'Funeral', plural: 'Funerals', icon: 'solar:calendar-date-bold', color: 'warning' },
];
/** Register workflow statuses accepted by PATCH /:id/status (legacy rows may also carry 'active'). */
export const RECORD_STATUSES = ['Recorded', 'Verified', 'Awaiting Clergy'] as const;

/** Raw row from the *_records tables (subset we render). */
export type RawRecord = Record<string, any> & { id: number; church_id?: number; clergy?: string | null; status?: string | null; notes?: string | null; created_at?: string; updated_at?: string };

/** Normalized record for lists/cards; `raw` keeps the table row for the form. */
export type OmRecord = {
  id: number;
  type: RecordType;
  title: string;          // "First Last" / "Bride & Groom"
  subtitle: string;       // parents / witnesses / burial place
  eventDate: string | null;      // baptism reception / marriage / burial
  secondaryDate: string | null;  // birth / — / death
  clergy: string;
  place: string;
  status: string;
  raw: RawRecord;
};

export const EVENT_DATE_FIELD: Record<RecordType, string> = { baptism: 'reception_date', marriage: 'mdate', funeral: 'burial_date' };

export function normalizeRecord(type: RecordType, r: RawRecord): OmRecord {
  if (type === 'baptism') {
    return { id: r.id, type, title: [r.first_name, r.last_name].filter(Boolean).join(' ') || '—', subtitle: r.parents || '', eventDate: r.reception_date || null, secondaryDate: r.birth_date || null, clergy: r.clergy || '—', place: r.birthplace || '—', status: r.status || 'active', raw: r };
  }
  if (type === 'marriage') {
    const bride = [r.fname_bride, r.lname_bride].filter(Boolean).join(' ');
    const groom = [r.fname_groom, r.lname_groom].filter(Boolean).join(' ');
    return { id: r.id, type, title: [groom, bride].filter(Boolean).join(' & ') || '—', subtitle: r.witness || '', eventDate: r.mdate || null, secondaryDate: null, clergy: r.clergy || '—', place: r.mlicense ? `License ${r.mlicense}` : '—', status: r.status || 'active', raw: r };
  }
  return { id: r.id, type, title: [r.name, r.lastname].filter(Boolean).join(' ') || '—', subtitle: r.age ? `Age ${r.age}` : '', eventDate: r.burial_date || null, secondaryDate: r.deceased_date || null, clergy: r.clergy || '—', place: r.burial_location || '—', status: r.status || 'active', raw: r };
}

export type RecordHistoryEntry = { id: number; type: 'create' | 'update' | 'merge' | 'delete' | 'restore' | string; description: string; timestamp: string; actor: string | null; source: string | null; changedFields: string[] };

// ---- parish search types (ported from prod shared/api/parishSearch.api.ts) ----
export interface ParishSearchAst {
  version: 1;
  scope: { churchId: number; recordTypes: RecordType[] };
  filters: { operator: 'and' | 'or'; conditions: any[] };
  operation?: { type: 'records' | 'duplicate_detection' | 'record_activity' | 'data_quality'; mode?: string; matchLevel?: 'strict' | 'standard' | 'loose'; fields?: string[]; minimumGroupSize?: number; ocrTolerance?: number; source?: 'ocr' | null };
  activity?: { eventTypes: string[]; relativeWindow: { amount?: number; unit?: string; preset?: string } } | null;
  rules?: Array<{ rule: string } | string>;
  workflowIntent?: string | null;
  textSearch?: string | null;
  relationships?: Array<{ type: string; value?: string }>;
  select?: string[];
  groupBy?: string[];
  aggregates?: Array<{ fn: string; field?: string }>;
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  limit?: number;
  offset?: number;
  mode?: string;
  export?: { format: string } | null;
}
export type InterpretationChip = { id: string; label: string; value: string; field: string; editable?: boolean };
export type Clarification = { id: string; message: string; options: Array<{ id: string; label: string }>; default?: string };
export type SearchResultRow = {
  recordType: RecordType; primaryName: string; canonicalEventDate: string | null; canonicalEventDateDisplay?: string | null; clergy: string | null; location: string | null; status: string | null;
  sourceRecordId: number | string; churchId: number; matchLabel?: string | null; matchConfidence?: number | null; openPath: string;
  activityType?: string | null; activityAt?: string | null; activityAtDisplay?: string | null; performedBy?: number | string | null; deletedAt?: string | null;
  issue?: string | null; field?: string | null; storedValue?: string | null; displayValue?: string | null; explanation?: string | null;
};
export type DuplicateGroup = {
  duplicateGroupId: string; signature: string; recordType: RecordType | 'cross_record'; classification: string; confidence: number; matchedFields: string[]; differingFields: string[]; recordCount: number;
  sourceRecordIds: Array<number | string>; preset: string; groupingFields: string[]; reviewStatus: 'unreviewed' | 'confirmed_duplicate' | 'not_a_duplicate' | 'needs_investigation' | 'resolved_externally'; reviewNotes?: string | null; recommendedSurvivorId?: number | null;
  records: Array<SearchResultRow & { values?: Record<string, unknown>; deletedAt?: string | null }>;
};
export type SavedSearch = { id: number; churchId: number; ownerUserId: number; name: string; description?: string | null; queryAst: ParishSearchAst; queryVersion: number; visibility: 'private' | 'parish' | 'parish_admin'; pinned: boolean; runCount: number; lastRunAt?: string | null; lastResultCount?: number | null; createdAt?: string; updatedAt?: string };
export type SearchExecution = { executionId: string; mode: string; rows: SearchResultRow[]; groups?: DuplicateGroup[]; totalAffectedRecords?: number; total: number; limit?: number; offset?: number; durationMs: number; ast: ParishSearchAst; unsupported?: { code?: string; message?: string } | null; workflowIntent?: string | null };

// ---- certificate studio types ----
export type CertificateTemplate = { id: number; church_id: number | null; certificate_type: RecordType; name: string; description: string | null; status: string; is_default: 0 | 1; canvas_size: string; orientation: string; current_version_id: number | null; updated_at: string };
export type CertificateHistory = { id: number; certificate_type: RecordType; record_id: number; template_id: number; template_name?: string; generated_pdf_path: string; generated_by: number | null; created_at: string };

export type ChartsSummary = {
  sacramentsByYear: { year: number; baptism: number; marriage: number; funeral: number }[];
  monthlyTrends: { month: string; baptism: number; marriage: number; funeral: number }[];
  byPriest: { name: string; count: number }[];
  baptismAge: { range: string; count: number }[];
  typeDistribution: { name: string; value: number }[];
  seasonalPatterns: { month: string; baptism: number; marriage: number; funeral: number }[];
};

// ---- transport ----
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  return json as T;
}
const jsonInit = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const q = (p: Record<string, unknown>) => {
  const sp = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') sp.set(k, String(v)); });
  const s = sp.toString();
  return s ? `?${s}` : '';
};
const base = (type: RecordType) => `/api/${type}-records`;

export const omRecordsApi = {
  list: (type: RecordType, p: { churchId: number; page?: number; limit?: number; search?: string; sortField?: string; sortDirection?: 'asc' | 'desc' }) =>
    call<{ records: RawRecord[]; totalRecords: number; currentPage: number; totalPages: number }>(`${base(type)}${q({ church_id: p.churchId, page: p.page ?? 1, limit: p.limit ?? 25, search: p.search, sortField: p.sortField, sortDirection: p.sortDirection })}`)
      .then((r) => ({ ...r, records: r.records.map((row) => normalizeRecord(type, row)) })),
  get: (type: RecordType, id: number, churchId: number) =>
    call<Record<string, any>>(`${base(type)}/${id}${q({ church_id: churchId })}`).then((r) => normalizeRecord(type, (r.record ?? r.data ?? r) as RawRecord)),
  create: (type: RecordType, body: Record<string, unknown>) => call<{ id?: number; record?: RawRecord; data?: RawRecord }>(base(type), jsonInit('POST', body)),
  update: (type: RecordType, id: number, body: Record<string, unknown>) => call(`${base(type)}/${id}`, jsonInit('PUT', body)),
  remove: (type: RecordType, id: number, churchId: number, reason?: string) => call(`${base(type)}/${id}${q({ church_id: churchId, reason })}`, { method: 'DELETE' }),
  setStatus: (type: RecordType, id: number, churchId: number, status: string) => call(`${base(type)}/${id}/status`, jsonInit('PATCH', { status, church_id: churchId })),
  history: (type: RecordType, id: number, churchId: number) => call<{ history: RecordHistoryEntry[] }>(`${base(type)}/${id}/history${q({ church_id: churchId })}`).then((r) => r.history ?? []),
  dropdownOptions: (type: RecordType, column: string, churchId: number) => call<{ values: string[] }>(`${base(type)}/dropdown-options/${column}${q({ church_id: churchId, table: `${type}_records` })}`).then((r) => r.values ?? []),
  clergy: (churchId: number) => call<{ items: { value: string; label: string; role?: string | null }[] }>(`/api/lookup/clergy${q({ church_id: churchId })}`).then((r) => r.items ?? []),
  charts: (churchId: number) => call<{ data: ChartsSummary }>(`/api/churches/${churchId}/charts/summary`).then((r) => r.data),
};

const S = '/api/parish-records/search';
export const parishSearchApi = {
  parse: (body: { query: string; churchId: number; clarificationAnswers?: Record<string, string> }) =>
    call<{ data: { ast: ParishSearchAst | null; interpretation: InterpretationChip[]; clarifications: Clarification[]; confidence: number; exportIntent: { format: string } | null; rawQuery: string; churchId: number } }>(`${S}/parse`, jsonInit('POST', body)).then((r) => r.data),
  execute: (ast: ParishSearchAst) => call<{ data: SearchExecution }>(`${S}/execute`, jsonInit('POST', { ast })).then((r) => r.data),
  count: (ast: ParishSearchAst) => call<{ data: { total: number } }>(`${S}/count`, jsonInit('POST', { ast })).then((r) => r.data.total),
  export: async (body: { ast: ParishSearchAst; format: 'xlsx' | 'csv' | 'xml' | 'pdf'; includeQuerySummary?: boolean }) => {
    const res = await omApiFetch(`${S}/export`, jsonInit('POST', body));
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message || `Export failed (${res.status})`); }
    if (ct.includes('application/json')) {
      const j = await res.json();
      if (j.async) return { async: true as const, jobId: j.jobId as number, message: j.message as string };
      throw new Error(j.message || 'Export failed');
    }
    const blob = await res.blob();
    const m = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '');
    const filename = m?.[1] || `parish-records.${body.format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    return { async: false as const, count: Number(res.headers.get('x-parish-export-count') || 0), filename };
  },
  exportJob: (jobId: number) => call<{ data: { id: number; status: string; recordCount?: number; errorMessage?: string; downloadUrl?: string } }>(`${S}/exports/${jobId}`).then((r) => r.data),
  listSaved: (churchId: number) => call<{ data: SavedSearch[] }>(`${S}/saved-searches${q({ churchId })}`).then((r) => r.data),
  createSaved: (body: { churchId: number; name: string; description?: string; queryAst: ParishSearchAst; visibility?: SavedSearch['visibility']; pinned?: boolean }) => call<{ data: SavedSearch }>(`${S}/saved-searches`, jsonInit('POST', body)).then((r) => r.data),
  updateSaved: (id: number, patch: Partial<SavedSearch> & { churchId: number }) => call<{ data: SavedSearch }>(`${S}/saved-searches/${id}`, jsonInit('PATCH', patch)).then((r) => r.data),
  deleteSaved: (id: number, churchId: number) => call(`${S}/saved-searches/${id}${q({ churchId })}`, { method: 'DELETE' }),
  runSaved: (id: number, churchId: number) => call<{ data: { rows: SearchResultRow[]; total: number; ast: ParishSearchAst; mode: string; name: string } }>(`${S}/saved-searches/${id}/run`, jsonInit('POST', { churchId, limit: 200 })).then((r) => r.data),
  reviewDuplicate: (signature: string, body: Record<string, unknown>) => call(`${S}/duplicate-reviews/${signature}`, jsonInit('PUT', body)),
  previewRemoval: (signature: string, body: { churchId: number; recordType: string; survivorId: number; removeIds: number[] }) => call<{ data: any }>(`${S}/duplicate-groups/${signature}/preview-removal`, jsonInit('POST', body)).then((r) => r.data),
  resolveDuplicates: (signature: string, body: { churchId: number; recordType: string; keepRecordId: number; removeRecordIds: number[]; reviewNotes?: string; reason: 'confirmed_duplicate' }) => call<{ data: { keepRecordId: number; removedRecordIds: number[]; message: string } }>(`${S}/duplicate-groups/${signature}/resolve`, jsonInit('POST', body)).then((r) => r.data),
  notDuplicates: (signature: string, body: { churchId: number; recordType: string; recordIds: Array<number | string>; classification: string; reviewNotes?: string }) => call(`${S}/duplicate-groups/${signature}/not-duplicates`, jsonInit('POST', body)),
  restore: (body: { churchId: number; recordType: string; recordIds: number[]; reason?: string }) => call(`${S}/records/restore`, jsonInit('POST', body)),
};

/** Minimal AST for "all records of a type in this church" (list export, bulk actions). */
export function recordsAst(churchId: number, types: RecordType[], extra?: Partial<ParishSearchAst>): ParishSearchAst {
  return { version: 1, scope: { churchId, recordTypes: types }, operation: { type: 'records' }, filters: { operator: 'and', conditions: [] }, textSearch: null, sort: [{ field: 'canonical_event_date', direction: 'desc' }], limit: 5000, offset: 0, ...extra };
}

const CS = '/api/certificates';
export const certificateApi = {
  templates: (type: RecordType) => call<{ templates: CertificateTemplate[] }>(`${CS}/templates${q({ type, certificate_type: type })}`).then((r) => (r.templates ?? []).filter((t) => t.certificate_type === type)),
  records: (type: RecordType, churchId: number, search?: string, recordId?: number) => call<{ records: RawRecord[] }>(`${CS}/records/${type}${q({ churchId, search, limit: 25, record_id: recordId })}`).then((r) => r.records ?? []),
  preview: (body: { template_id: number; certificate_type: RecordType; record_id?: number; use_sample_data?: boolean; church_id: number }) => call<{ preview?: { pdf_base64: string }; pdf_base64?: string }>(`${CS}/preview`, jsonInit('POST', body)).then((r) => ({ pdf_base64: r.preview?.pdf_base64 ?? r.pdf_base64 ?? '' })),
  render: (body: { template_id: number; certificate_type: RecordType; record_id: number; force?: boolean; church_id: number }) => call<{ job_id: number; history_id: number; status: string; download_url: string }>(`${CS}/render`, jsonInit('POST', body)),
  history: (type?: RecordType, limit = 50) => call<{ history: CertificateHistory[] }>(`${CS}/history${q({ certificate_type: type, limit })}`).then((r) => r.history ?? []),
  downloadUrl: (historyId: number) => `${CS}/history/${historyId}/download`,
};
