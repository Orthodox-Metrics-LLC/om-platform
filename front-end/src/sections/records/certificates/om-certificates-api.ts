import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Certificate Studio client on `/api/om/certificates` (prod: server/src/routes/om/certificates.js).
 * Template ids are composite: "g:<id>" = Orthodox Metrics (global, orthodoxmetrics_db),
 * "c:<id>" = parish template (om_church_##).
 */

export type CertificateType = 'baptism' | 'marriage' | 'reception';
export const CERTIFICATE_TYPES: { value: CertificateType; label: string; color: 'primary' | 'secondary' | 'info' }[] = [
  { value: 'baptism', label: 'Baptism', color: 'primary' },
  { value: 'marriage', label: 'Marriage', color: 'secondary' },
  { value: 'reception', label: 'Reception', color: 'info' },
];
export type TemplateScope = 'global' | 'church';
export type TemplateStatus = 'draft' | 'active' | 'archived';
export type CanvasSize = 'letter' | 'a4' | 'custom';
export type Orientation = 'portrait' | 'landscape';
export type LayerType = 'text' | 'bound_field' | 'image' | 'background' | 'shape' | 'border';

export type LayerStyle = {
  text?: string;
  font_family?: string;
  font_size?: number;
  color?: string;
  alignment?: 'left' | 'center' | 'right';
  line_height?: number;
  text_transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  allow_wrap?: boolean;
  fill?: string;
  border_width?: number;
  fit?: 'contain' | 'cover' | 'stretch';
};
export type CertificateLayer = {
  id: string;
  type: LayerType;
  name: string;
  x: number; y: number; width: number; height: number;
  rotation: number; opacity: number; z_index: number;
  locked: boolean; visible: boolean;
  style?: LayerStyle;
  asset_id?: number | null;
  asset_url?: string | null;
  binding?: { key: string; required?: boolean; fallback?: string } | null;
};
export type LayoutJson = { version: number; margins: { top: number; right: number; bottom: number; left: number }; bleed: number; showGuides: boolean; layers: CertificateLayer[] };

export type CertificateTemplate = {
  id: string; numericId: number; scope: TemplateScope; church_id: number | null;
  certificate_type: CertificateType; name: string; description: string | null; status: TemplateStatus; is_default: boolean;
  canvas_size: CanvasSize; orientation: Orientation; custom_width: number | null; custom_height: number | null;
  current_version_id: number | null; version_number: number | null; source_global_template_id: number | null;
  created_at: string; updated_at: string; published_at: string | null;
  layout_json?: LayoutJson | null;
  page?: { width: number; height: number };
  thumbnail_asset_id?: number | null;
  layer_count?: number;
};
export type Binding = { key: string; label: string; group: string };
export type StudioMeta = {
  certificateTypes: CertificateType[];
  fonts: { value: string; css: string; weight: string; style: string }[];
  pageSizes: Record<string, { width: number; height: number }>;
  bindings: Binding[];
  sample: Record<string, Record<string, string>>;
  canDesignGlobal: boolean; canDesignParish: boolean; canGenerate: boolean; churchId: number | null;
};
export type HistoryEntry = { id: number; certificate_type: CertificateType; record_id: number; template_name: string; file_id: number | null; file_name: string | null; person: string | null; generated_at: string; generated_by: string | null; download_url: string };
export type StudioRecord = Record<string, any> & { id: number };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json as T;
}
const jsonInit = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const q = (p: Record<string, unknown>) => { const sp = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') sp.set(k, String(v)); }); const s = sp.toString(); return s ? `?${s}` : ''; };
const C = '/api/om/certificates';

export const omCertificatesApi = {
  meta: (churchId?: number | null) => call<StudioMeta>(`${C}/meta${q({ church_id: churchId })}`),
  templates: (p: { churchId?: number | null; type?: CertificateType | null; includeArchived?: boolean } = {}) =>
    call<{ churchId: number | null; canDesignGlobal: boolean; canDesignParish: boolean; templates: CertificateTemplate[] }>(`${C}/templates${q({ church_id: p.churchId, type: p.type, include_archived: p.includeArchived ? 1 : undefined })}`),
  template: (id: string, churchId?: number | null) => call<{ template: CertificateTemplate & { layout_json: LayoutJson; page: { width: number; height: number } }; canEdit: boolean }>(`${C}/templates/${id}${q({ church_id: churchId })}`),
  create: (body: { scope: TemplateScope; church_id?: number | null; certificate_type: CertificateType; name: string; description?: string; canvas_size?: CanvasSize; orientation?: Orientation; custom_width?: number | null; custom_height?: number | null; layout_json?: LayoutJson }) =>
    call<{ template: CertificateTemplate }>(`${C}/templates`, jsonInit('POST', body)).then((r) => r.template),
  update: (id: string, body: Partial<Pick<CertificateTemplate, 'name' | 'description' | 'canvas_size' | 'orientation' | 'custom_width' | 'custom_height' | 'certificate_type'>> & { layout_json?: LayoutJson; church_id?: number | null }) =>
    call<{ template: CertificateTemplate }>(`${C}/templates/${id}`, jsonInit('PUT', body)).then((r) => r.template),
  publish: (id: string, body: { church_id?: number | null; make_default?: boolean } = {}) => call<{ template: CertificateTemplate }>(`${C}/templates/${id}/publish`, jsonInit('POST', body)).then((r) => r.template),
  archive: (id: string, churchId?: number | null) => call(`${C}/templates/${id}/archive`, jsonInit('POST', { church_id: churchId })),
  setDefault: (id: string, churchId?: number | null) => call(`${C}/templates/${id}/default`, jsonInit('POST', { church_id: churchId })),
  duplicate: (id: string, body: { church_id?: number | null; scope?: TemplateScope; name?: string } = {}) => call<{ template: CertificateTemplate }>(`${C}/templates/${id}/duplicate`, jsonInit('POST', body)).then((r) => r.template),
  remove: (id: string, churchId?: number | null) => call(`${C}/templates/${id}${q({ church_id: churchId })}`, { method: 'DELETE' }),
  records: (type: CertificateType, churchId: number | null | undefined, search?: string, recordId?: number) => call<{ records: StudioRecord[] }>(`${C}/records/${type}${q({ church_id: churchId, search, record_id: recordId })}`).then((r) => r.records),
  preview: (body: { template_id: string; church_id?: number | null; record_id?: number | null; use_sample_data?: boolean; layout_json?: LayoutJson }) =>
    call<{ pdf_base64: string }>(`${C}/preview`, jsonInit('POST', body)).then((r) => r.pdf_base64),
  generate: (body: { template_id: string; church_id?: number | null; record_id: number; allow_draft?: boolean }) =>
    call<{ history_id: number; file: { id: number; name: string; folder_id: number; download_url: string }; template: { id: string; name: string } }>(`${C}/generate`, jsonInit('POST', body)),
  history: (p: { churchId?: number | null; type?: CertificateType | null; page?: number; limit?: number }) =>
    call<{ total: number; page: number; limit: number; history: HistoryEntry[] }>(`${C}/history${q({ church_id: p.churchId, type: p.type, page: p.page, limit: p.limit })}`),
};

/** base64 PDF → object URL usable in an <iframe>. */
export function pdfObjectUrl(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}
