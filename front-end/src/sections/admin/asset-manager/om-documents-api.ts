import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Typed client for OM's Documents API (`/api/documents`, prod:
 * server/src/routes/documents.js — admin only). Mirrors what the legacy
 * AdminDocumentsManagerPage used.
 */

export type OmDocumentLifecycle = 'inbox' | 'working' | 'review' | 'approved' | 'published' | 'archived' | 'quarantined';
export type OmDocumentSource = 'HUMAN' | 'OMDEV' | 'WORKSHOP' | 'OPS' | 'SYSTEM';
export type OmDocumentFilingState = 'none' | 'filing_requested' | 'approval_pending' | 'approved_waiting_to_file' | 'rejected' | 'filed' | 'failed';

export interface OmDocument {
  id: string;
  documentId: string;
  title: string;
  description: string | null;
  source: OmDocumentSource;
  producer: string;
  lifecycle: OmDocumentLifecycle;
  relativePath: string | null;
  primaryFile: string | null;
  horizon: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  parentDocumentId: string | null;
  relatedDispatchId: string | null;
  workPacketId: string | null;
  viewedAt: string | null;
  downloadedAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  quarantineReason: string | null;
  legacy: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  filingState: OmDocumentFilingState;
  filingReceipt: string | null;
  proposedCategory: string | null;
  proposedTargetDocsPath: string | null;
  filedDocsPath: string | null;
  filedAt: string | null;
  createdBy: { id: number | null; email: string | null; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface OmDocumentAudit {
  id: number | string;
  action: string;
  actor_name?: string | null;
  actor_email?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
}

export const DOCUMENT_LIFECYCLES: { value: OmDocumentLifecycle | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'working', label: 'Working' },
  { value: 'review', label: 'Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
  { value: 'quarantined', label: 'Quarantined' },
];

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  return json as T;
}
const jsonInit = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const q = (params: Record<string, unknown>) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') sp.set(k, String(v)); });
  const s = sp.toString();
  return s ? `?${s}` : '';
};
const D = '/api/documents';

export const omDocumentsApi = {
  list: (p: { lifecycle?: OmDocumentLifecycle | 'all'; source?: string; q?: string; limit?: number; offset?: number }) =>
    call<{ items: OmDocument[]; counts: Partial<Record<OmDocumentLifecycle, number>>; total?: number }>(`${D}${q(p)}`),
  get: (id: string) => call<{ document: OmDocument; audit: OmDocumentAudit[] }>(`${D}/${id}`),
  horizons: () => call<{ horizons: string[] }>(`${D}/meta/horizons`).then((r) => r.horizons),
  filingCategories: () => call<{ categories: { id: string; label: string; target?: string }[] }>(`${D}/meta/filing-categories`).then((r) => r.categories),
  waitingToFile: () => call<{ items: OmDocument[] }>(`${D}/filing/waiting-to-file`).then((r) => r.items),

  upload: async (form: FormData) => call<{ document: OmDocument }>(D, { method: 'POST', body: form }).then((r) => r.document),
  paste: (body: { title: string; content: string; description?: string; horizon?: string; source?: string }) =>
    call<{ document: OmDocument }>(`${D}/paste`, jsonInit('POST', body)).then((r) => r.document),
  update: (id: string, body: Partial<Pick<OmDocument, 'title' | 'description' | 'horizon' | 'source'>>) =>
    call<{ document: OmDocument }>(`${D}/${id}`, jsonInit('PATCH', body)).then((r) => r.document),
  move: (id: string, body: { lifecycle?: OmDocumentLifecycle; horizon?: string; producer?: string }) =>
    call<{ document: OmDocument }>(`${D}/${id}/move`, jsonInit('POST', body)).then((r) => r.document),
  archive: (id: string) => call<{ document: OmDocument }>(`${D}/${id}/archive`, jsonInit('POST', {})),
  quarantine: (id: string, reason: string) => call<{ document: OmDocument }>(`${D}/${id}/quarantine`, jsonInit('POST', { reason })),
  fileContent: async (id: string) => {
    const res = await omApiFetch(`${D}/${id}/file`);
    if (!res.ok) throw new Error(`Could not read file (${res.status})`);
    return res.text();
  },
  saveFileContent: (id: string, content: string) => call(`${D}/${id}/file`, jsonInit('PUT', { content })),
  downloadUrl: (id: string) => `${D}/${id}/download`,
  addAttachments: (id: string, form: FormData) => call<{ added: unknown[] }>(`${D}/${id}/attachments`, { method: 'POST', body: form }),
  dispatch: (id: string, body: Record<string, unknown>) => call(`${D}/${id}/dispatch`, jsonInit('POST', body)),
  reconcile: () => call<{ report: unknown }>(`${D}/reconcile`, jsonInit('POST', { includeAllLifecycles: true })).then((r) => r.report),

  filingApprove: (receipt: string) => call(`${D}/filing/${receipt}/approve`, jsonInit('POST', {})),
  filingReject: (receipt: string, reason?: string) => call(`${D}/filing/${receipt}/reject`, jsonInit('POST', { reason })),
  filingFile: (receipt: string) => call(`${D}/filing/${receipt}/file`, jsonInit('POST', {})),
};
