import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Page Builder client on `/api/latest-news` (prod:
 * server/src/routes/latest-news.js). This is the generalized Campaign
 * Builder backend — `page_type` selects which public-site surface a
 * campaign/page renders on (latest_news, coming_soon, maintenance, error
 * pages). Superadmin/admin only (requireRole(['super_admin','admin'])
 * server-side).
 */

export type PageType =
  | 'latest_news' | 'coming_soon' | 'maintenance' | 'error_404' | 'error_403' | 'error_500'
  | 'checkout' | 'payment' | 'pricing' | 'records' | 'faq';

export const PAGE_TYPES: { value: PageType; label: string }[] = [
  { value: 'latest_news', label: 'Latest News' },
  { value: 'coming_soon', label: 'Coming soon' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'error_404', label: '404 — Not found' },
  { value: 'error_403', label: '403 — Forbidden' },
  { value: 'error_500', label: '500 — Server error' },
  { value: 'checkout', label: 'Checkout' },
  { value: 'payment', label: 'Payment' },
  { value: 'pricing', label: 'Pricing' },
  { value: 'records', label: 'Records (public page)' },
  { value: 'faq', label: 'FAQ' },
];

export type PageStatus = 'draft' | 'scheduled' | 'live' | 'expired' | 'archived';
export type LayoutType =
  | 'hero' | 'split' | 'card' | 'banner' | 'quote' | 'image_grid' | 'video'
  | 'animate' | 'utilities' | 'scrollbar' | 'scroll_progress' | 'lightbox'
  | 'form_wizard' | 'carousel' | 'timeline' | 'tooltip' | 'rating'
  | 'file_upload' | 'data_table';

export type PageTableColumn = { key: string; label: string };

export type PageItemConfig = Record<string, unknown> & {
  variant?: string;
  orientation?: 'horizontal' | 'vertical';
  height?: number;
  maxHeight?: number;
  progress?: number;
  rating?: number;
  precision?: number;
  tooltip?: string;
  steps?: { title: string; body?: string }[];
  timeline?: { title: string; body?: string; date?: string }[];
  /** `file_upload` — live, functional upload widget (not decorative). */
  uploadEndpoint?: string;
  uploadChurchId?: number;
  uploadRecordType?: string;
  uploadLanguage?: string;
  uploadLayoutMode?: string;
  uploadButtonLabel?: string;
  uploadHelperText?: string;
  /** `data_table` — live table bound to a GET endpoint. */
  tableEndpoint?: string;
  tableColumns?: PageTableColumn[];
  tableRowsPath?: string;
};

export type PageEffectsConfig = {
  animation?: 'none' | 'fade' | 'slide_up' | 'slide_left' | 'zoom' | 'scale' | 'rotate';
  trigger?: 'on_load' | 'in_view' | 'hover';
  duration?: number;
  delay?: number;
  opacity?: number;
  scale?: number;
  rotate?: number;
  blur?: number;
  hover_lift?: number;
  parallax?: boolean;
  sticky?: boolean;
  show_scroll_progress?: boolean;
};
export type ItemStatus = 'draft' | 'active' | 'disabled';
export type FileType = 'image' | 'video' | 'document';

export interface PageMedia {
  id: number;
  campaign_id: number;
  item_id: number | null;
  file_url: string;
  om_asset_id?: number | null;
  file_type: FileType;
  alt_text: string | null;
  caption: string | null;
  credit: string | null;
  sort_order: number;
  is_primary: boolean;
  created_at?: string;
}

export interface PageItem {
  id: number;
  campaign_id: number;
  title: string;
  subtitle: string | null;
  body: string | null;
  excerpt: string | null;
  cta_label: string | null;
  cta_url: string | null;
  sort_order: number;
  status: ItemStatus;
  layout_type: LayoutType;
  component_config: PageItemConfig;
  effects_config: PageEffectsConfig;
  active: boolean;
  media: PageMedia[];
  created_at?: string;
  updated_at?: string;
}

export interface Page {
  id: number;
  title: string;
  slug: string;
  page_type: PageType;
  published_version_id: number | null;
  summary: string | null;
  visibility_start_at: string | null;
  visibility_end_at: string | null;
  timezone: string;
  publish_mode: 'manual' | 'scheduled';
  rotation_enabled: boolean;
  rotation_interval_seconds: number;
  display_priority: number;
  show_on_homepage: boolean;
  show_in_parish_portal: boolean;
  status?: PageStatus;
  effective_status?: PageStatus;
  items: PageItem[];
  media: PageMedia[];
  created_at?: string;
  updated_at?: string;
}

export interface PageVersion {
  id: number;
  campaign_id: number;
  label: string | null;
  status: 'draft' | 'published';
  created_by: number | null;
  created_at: string;
  published_at: string | null;
  snapshot?: Page;
}

const BASE = '/latest-news';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await omApiFetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json as T;
}

export const omPagesApi = {
  list: (pageType?: PageType): Promise<{ campaigns: Page[] }> =>
    request('GET', `${BASE}/campaigns${pageType ? `?page_type=${pageType}` : ''}`),

  get: (id: number): Promise<{ campaign: Page }> => request('GET', `${BASE}/campaigns/${id}`),

  create: (payload: Partial<Page> & { items?: Partial<PageItem>[] }): Promise<{ campaign: Page }> =>
    request('POST', `${BASE}/campaigns`, payload),

  update: (id: number, payload: Partial<Page>): Promise<{ campaign: Page }> =>
    request('PUT', `${BASE}/campaigns/${id}`, payload),

  archive: (id: number): Promise<{ archived: true }> => request('DELETE', `${BASE}/campaigns/${id}`),

  addItem: (campaignId: number, payload: Partial<PageItem>): Promise<{ item: PageItem }> =>
    request('POST', `${BASE}/campaigns/${campaignId}/items`, payload),

  updateItem: (itemId: number, payload: Partial<PageItem>): Promise<{ item: PageItem }> =>
    request('PUT', `${BASE}/items/${itemId}`, payload),

  deleteItem: (itemId: number): Promise<{ success: true }> => request('DELETE', `${BASE}/items/${itemId}`),

  reorderItems: (campaignId: number, order: number[]): Promise<{ success: true }> =>
    request('PUT', `${BASE}/campaigns/${campaignId}/items/reorder`, { order }),

  attachAssetMedia: (payload: {
    campaign_id: number;
    om_asset_id: number;
    file_url: string;
    file_type?: FileType;
    item_id?: number | null;
    alt_text?: string;
    caption?: string;
    is_primary?: boolean;
  }): Promise<{ media: PageMedia }> => request('POST', `${BASE}/media/from-asset`, payload),

  updateMedia: (mediaId: number, payload: Partial<PageMedia>): Promise<{ media: PageMedia }> =>
    request('PUT', `${BASE}/media/${mediaId}`, payload),

  deleteMedia: (mediaId: number): Promise<{ success: true }> => request('DELETE', `${BASE}/media/${mediaId}`),

  listVersions: (campaignId: number): Promise<{ versions: PageVersion[] }> =>
    request('GET', `${BASE}/campaigns/${campaignId}/versions`),

  getVersion: (campaignId: number, versionId: number): Promise<{ version: PageVersion }> =>
    request('GET', `${BASE}/campaigns/${campaignId}/versions/${versionId}`),

  saveVersion: (campaignId: number, label?: string): Promise<{ version: PageVersion }> =>
    request('POST', `${BASE}/campaigns/${campaignId}/versions`, { label }),

  publishVersion: (campaignId: number, versionId: number): Promise<{ campaign: Page }> =>
    request('POST', `${BASE}/campaigns/${campaignId}/versions/${versionId}/publish`),
};
