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
  canonical_filename?: string | null;
  status: OmOcrJobStatus;
  review_status: OmOcrReviewStatus;
  review_notes?: string | null;
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
  already_exists?: boolean;
  not_church_record?: boolean;
  seeded_at?: string | null;
  uploaded_by?: string | number | null;
  batch_id?: string | null;
  batch_name?: string | null;
  batch_ready_for_image_review?: boolean;
  batch_ready_by_name?: string | null;
  batch_ready_at?: string | null;
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
  recordCandidates?: unknown;
  tableExtractionJson?: unknown;
  ocrConfidence: number | null;
  status: string;
  rotation: number;
}

// ----------------------------------------------------------------------
// Batch model — one "Upload Records" row can span several ocr_jobs rows
// (multi-page uploads share a batch_id, see ocrJobIngestService.js).
// Mirrors the mapping used by the old portal's Parish Uploader dashboard.
// ----------------------------------------------------------------------

/** Coarse status used to drive the batch processing/ready UI. */
export type OmOcrWizardStatus =
  | 'ready-for-image-review'
  | 'processing'
  | 'ready-for-review'
  | 'completed'
  | 'failed'
  | 'returned'
  | 'already-exists'
  | 'not-church-record';

const TERMINAL_REVIEW_STATUSES = ['agent_extracted', 'ready_to_seed', 'seeded'];

export function mapJobToWizardStatus(job: OmOcrJob): OmOcrWizardStatus {
  const reviewStatus = job.review_status || 'uploaded';
  if (job.status === 'failed' || job.status === 'error') return 'failed';
  if (reviewStatus === 'not_church_record' || job.not_church_record) return 'not-church-record';
  if (reviewStatus === 'returned') return 'returned';
  if (reviewStatus === 'seeded' || job.already_exists) return 'already-exists';
  if (['agent_extracted', 'ready_to_seed', 'in_review'].includes(reviewStatus)) return 'ready-for-review';
  if (reviewStatus === 'ocr_complete' || reviewStatus === 'pending_review') return 'processing';
  if (reviewStatus === 'uploaded' || job.status === 'queued' || job.status === 'pending') {
    return 'ready-for-image-review';
  }
  return 'processing';
}

export function isJobTerminal(job: OmOcrJob): boolean {
  if (job.status === 'failed' || job.status === 'error') return true;
  const rs = job.review_status || 'uploaded';
  return rs === 'returned' || rs === 'not_church_record' || TERMINAL_REVIEW_STATUSES.includes(rs);
}

export type OmOcrProcessingMode = 'automatic' | 'assisted' | 'manual';

export interface OmOcrBatchRow {
  /** batch_id when the backend assigned one, else the single job id. */
  id: string;
  batchId: string | null;
  displayName: string;
  originalName: string | null;
  recordType: string;
  submittedBy: string;
  date: string;
  totalImages: number;
  completedImages: number;
  allProcessed: boolean;
  status: OmOcrWizardStatus;
  mode: OmOcrProcessingMode;
  /** Records the extractor detected across every image in the batch. */
  recordsDetected: number;
  /** Of those, how many have already been confirmed/auto-added. */
  recordsConfirmed: number;
  /** recordsDetected - recordsConfirmed (or a job-count fallback pre-extraction). */
  needsReview: number;
  reviewReady: boolean;
  readyByName: string | null;
  readyAt: string | null;
  /** The job used for navigation (first/least-advanced job in the batch). */
  primaryJobId: string;
  jobIds: string[];
}

function jobDisplayName(job: OmOcrJob): string {
  return (job.canonical_filename || job.original_filename || job.filename || '').split('/').pop()
    || `Job #${job.id}`;
}

function batchDisplayName(jobs: OmOcrJob[]): string {
  if (jobs.length === 1) return jobDisplayName(jobs[0]);
  const names = jobs.map(jobDisplayName);
  const first = names[0] || 'Batch';
  const stem = first.replace(/\.[^.]+$/, '').replace(/[-_]\d+$/, '');
  if (stem.length >= 3 && names.every((n) => n.replace(/\.[^.]+$/, '').startsWith(stem.slice(0, Math.min(stem.length, 12))))) {
    return stem;
  }
  return `${stem || 'Batch'} (${jobs.length} images)`;
}

function formatUploader(job: OmOcrJob): string {
  const raw = job.uploaded_by;
  if (raw && !/^\d+$/.test(String(raw))) return String(raw);
  return '—';
}

const STATUS_RANK: Record<OmOcrWizardStatus, number> = {
  'ready-for-image-review': 1,
  processing: 2,
  failed: 2,
  'not-church-record': 2,
  'ready-for-review': 3,
  returned: 3,
  'already-exists': 4,
  completed: 4,
};

function leastAdvancedJob(jobs: OmOcrJob[]): OmOcrJob {
  return [...jobs].sort(
    (a, b) => STATUS_RANK[mapJobToWizardStatus(a)] - STATUS_RANK[mapJobToWizardStatus(b)],
  )[0];
}

function jobRecordCount(job: OmOcrJob): number {
  if (typeof job.records_count === 'number') return job.records_count;
  return job.has_ocr_text ? 1 : 0;
}

function jobConfirmedCount(job: OmOcrJob): number {
  if (typeof job.confirmed_count === 'number') return job.confirmed_count;
  const status = mapJobToWizardStatus(job);
  return status === 'already-exists' || status === 'completed' ? jobRecordCount(job) : 0;
}

function inferProcessingMode(jobs: OmOcrJob[]): OmOcrProcessingMode {
  if (jobs.some((j) => ['returned', 'in_review', 'human_confirmed'].includes(j.review_status || ''))) {
    return 'assisted';
  }
  return 'automatic';
}

function aggregateWizardStatus(jobs: OmOcrJob[]): OmOcrWizardStatus {
  const statuses = jobs.map(mapJobToWizardStatus);
  if (statuses.every((s) => s === 'failed')) return 'failed';
  if (statuses.every((s) => s === 'not-church-record')) return 'not-church-record';
  if (statuses.some((s) => s === 'processing')) return 'processing';
  if (statuses.some((s) => s === 'ready-for-image-review')) return 'ready-for-image-review';
  if (statuses.some((s) => s === 'ready-for-review')) return 'ready-for-review';
  if (statuses.some((s) => s === 'returned')) return 'returned';
  if (statuses.every((s) => s === 'already-exists' || s === 'completed')) {
    return statuses[0] === 'completed' ? 'completed' : 'already-exists';
  }
  return statuses[0];
}

export function batchProcessingLabel(row: Pick<OmOcrBatchRow, 'allProcessed' | 'completedImages' | 'totalImages'>): string {
  if (row.totalImages === 0) return 'No images';
  if (row.allProcessed) return `Processing complete — ${row.totalImages} of ${row.totalImages}`;
  return `Processing ${row.completedImages} of ${row.totalImages}`;
}

export function statusLabel(status: OmOcrWizardStatus): string {
  switch (status) {
    case 'ready-for-image-review': return 'Uploaded';
    case 'processing': return 'Processing';
    case 'ready-for-review': return 'Ready for review';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'returned': return 'Returned';
    case 'already-exists': return 'Already in records';
    case 'not-church-record': return 'Not a church record';
    default: return status;
  }
}

/** Groups raw jobs into the same batches the old Parish Uploader dashboard showed. */
export function mapJobsToBatchRows(jobs: OmOcrJob[]): OmOcrBatchRow[] {
  const groups = new Map<string, OmOcrJob[]>();
  for (const job of jobs) {
    const key = job.batch_id ? `b:${job.batch_id}` : `j:${job.id}`;
    const existing = groups.get(key);
    if (existing) existing.push(job);
    else groups.set(key, [job]);
  }

  return [...groups.values()].map((group) => {
    const sorted = [...group].sort((a, b) => (
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ));
    const first = sorted[0];
    const focus = leastAdvancedJob(group);
    const completedImages = group.filter((j) => isJobTerminal(j)).length;
    const totalImages = group.length;
    const recordsDetected = group.reduce((sum, j) => sum + jobRecordCount(j), 0);
    const recordsConfirmed = group.reduce((sum, j) => sum + jobConfirmedCount(j), 0);
    const needsFromJobs = group.filter((j) => {
      const s = mapJobToWizardStatus(j);
      return s === 'ready-for-review' || s === 'returned';
    }).length;
    return {
      id: first.batch_id || `J-${first.id}`,
      batchId: first.batch_id || null,
      displayName: first.batch_name || batchDisplayName(sorted),
      originalName: first.original_filename || null,
      recordType: first.record_type || 'custom',
      submittedBy: formatUploader(first),
      date: first.created_at,
      totalImages,
      completedImages,
      allProcessed: completedImages === totalImages,
      status: aggregateWizardStatus(group),
      mode: inferProcessingMode(group),
      recordsDetected,
      recordsConfirmed,
      needsReview: recordsDetected > 0 ? Math.max(0, recordsDetected - recordsConfirmed) : needsFromJobs,
      reviewReady: !!first.batch_ready_for_image_review,
      readyByName: first.batch_ready_by_name || null,
      readyAt: first.batch_ready_at || null,
      primaryJobId: String(focus.id),
      jobIds: sorted.map((j) => String(j.id)),
    };
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function processingModeLabel(mode: OmOcrProcessingMode): string {
  if (mode === 'assisted') return 'Assisted';
  if (mode === 'manual') return 'Manual';
  return 'Automatic';
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

export async function renameOcrBatch(
  churchId: number | string,
  batchId: string,
  name: string,
): Promise<void> {
  const res = await omApiFetch(`${BASE(churchId)}/batches/${batchId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  await parseJson(res);
}

export async function setOcrBatchReviewReady(
  churchId: number | string,
  batchId: string,
  ready: boolean,
): Promise<void> {
  const res = await omApiFetch(`${BASE(churchId)}/batches/${batchId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ready_for_image_review: ready }),
  });
  await parseJson(res);
}
