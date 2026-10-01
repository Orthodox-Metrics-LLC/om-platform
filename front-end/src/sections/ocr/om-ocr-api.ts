import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

const BASE = (churchId: number | string) => `/api/church/${churchId}/ocr`;
const PLATFORM_BASE = '/api/ocr';

export type OmOcrRecordType = 'baptism' | 'marriage' | 'funeral' | 'custom';

export type OmOcrJobStatus =
  | 'pending'
  | 'processing'
  | 'complete'
  | 'completed'
  | 'error'
  | 'cancelled'
  | string;

export type OmOcrReviewStatus =
  | 'uploaded'
  | 'ready_for_review'
  | 'in_review'
  | 'finalized'
  | 'seeded'
  | string;

export interface OmOcrJob {
  id: string;
  church_id: string;
  original_filename: string;
  filename: string;
  status: OmOcrJobStatus;
  review_status: OmOcrReviewStatus;
  record_type: OmOcrRecordType | string | null;
  language: string;
  confidence_score: number;
  created_at: string;
  updated_at?: string;
  has_ocr_text: boolean;
  records_count: number | null;
  confirmed_count: number | null;
  error_message: string | null;
  ocr_text_preview?: string | null;
  batch_id?: string | null;
  batch_name?: string | null;
}

export interface OmOcrJobDetail extends OmOcrJob {
  ocr_text: string | null;
  ocr_result: Record<string, unknown> | null;
  error_regions: string | null;
  pages?: OmOcrPage[];
  mapping: Record<string, unknown> | null;
  layout_classification_json: Record<string, unknown> | null;
  feeder_source?: boolean;
}

export interface OmOcrPage {
  pageId: number;
  pageIndex: number;
  rawText: string | null;
  ocrConfidence: number | null;
  status: string;
  rotation: number;
}

export interface OmOcrSettings {
  engine?: string;
  language?: string;
  defaultLanguage?: string;
  documentProcessing?: {
    recordLayoutMode?: string;
    extractionAgentMode?: string;
    [key: string]: any;
  };
}

export interface OmOcrUploadResult {
  jobs: OmOcrJob[];
}

// ----------------------------------------------------------------------

async function parseJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false || json?.ok === false) {
    throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

export async function fetchOcrSettings(churchId: number | string): Promise<OmOcrSettings> {
  const res = await omApiFetch(BASE(churchId), { method: 'GET' });
  return parseJson<OmOcrSettings>(res);
}

export async function fetchOcrJobs(
  churchId: number | string,
  opts: { limit?: number; includeHiddenCompleted?: boolean } = {},
): Promise<OmOcrJob[]> {
  const sp = new URLSearchParams();
  if (opts.limit) sp.set('limit', String(opts.limit));
  if (opts.includeHiddenCompleted) sp.set('include_hidden_completed', '1');
  const qs = sp.toString();
  const res = await omApiFetch(`${BASE(churchId)}/jobs${qs ? `?${qs}` : ''}`, { method: 'GET' });
  const json = await parseJson<{ jobs?: OmOcrJob[] }>(res);
  return json.jobs ?? [];
}

export async function fetchOcrJob(
  churchId: number | string,
  jobId: string | number,
): Promise<OmOcrJobDetail> {
  const res = await omApiFetch(`${BASE(churchId)}/jobs/${jobId}`, { method: 'GET' });
  return parseJson<OmOcrJobDetail>(res);
}

export function ocrJobImageUrl(
  churchId: number | string,
  jobId: string | number,
  opts: { original?: boolean } = {},
): string {
  const qs = opts.original ? '?original=true' : '';
  return `${BASE(churchId)}/jobs/${jobId}/image${qs}`;
}

export async function uploadOcrFiles(
  churchId: number | string,
  files: File[],
  payload: {
    recordType?: OmOcrRecordType | string;
    language?: string;
    recordLayoutMode?: string;
    batchId?: string;
  } = {},
): Promise<OmOcrUploadResult> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  formData.append('churchId', String(churchId));
  if (payload.recordType) formData.append('recordType', payload.recordType);
  if (payload.language) formData.append('language', payload.language);
  if (payload.recordLayoutMode) formData.append('recordLayoutMode', payload.recordLayoutMode);
  if (payload.batchId) formData.append('batchId', payload.batchId);

  const res = await omApiFetch(`${PLATFORM_BASE}/jobs/upload`, {
    method: 'POST',
    body: formData,
  });
  return parseJson<OmOcrUploadResult>(res);
}
