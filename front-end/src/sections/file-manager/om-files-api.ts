import type { IFileShared, IFileManager, IFolderManager } from 'src/types/file';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * File manager data layer on OM's `/api/om/files` (prod: server/src/routes/om/files.js).
 * Items are already shaped server-side into the template's IFileManager / IFolderManager
 * types, with a few OM extras.
 */

export type OmFolder = IFolderManager & {
  rawId: number;
  kind: 'folder';
  systemKey: 'records' | 'media' | 'documents' | null;
  parentId: number | null;
  createdBy: number;
};

export type OmFile = IFileManager & {
  rawId: number;
  kind: 'file';
  folderId: number | null;
  mimeType: string | null;
  category: 'image' | 'video' | 'audio' | 'document' | 'other';
  uploadedBy: number;
};

export type OmFileItem = OmFolder | OmFile;
export const isFolder = (i: OmFileItem): i is OmFolder => i.kind === 'folder';

export type OmFilesContextInfo = {
  church: { id: number; name: string; jurisdiction: string | null };
  quota_bytes: number;
  used_bytes: number;
  can_write: boolean;
  is_platform: boolean;
  roots: OmFolder[];
};

export type OmShareTarget = { id: string; name: string; email: string; role: string; avatarUrl: string };
export type OmSharedUser = IFileShared & { permission: 'view' | 'edit' };

export type OmFilesOverview = {
  church: { id: number; name: string; jurisdiction: string | null };
  quota_bytes: number;
  used_bytes: number;
  categories: Record<'images' | 'media' | 'documents' | 'other', { count: number; bytes: number }>;
  roots: { key: string; name: string; count: number; bytes: number }[];
  activity: { year: number; years: number[]; series: { name: string; data: number[] }[] };
  recent_files: OmFile[];
  recent_activity: {
    id: number; action: string; item_type: string; item_name: string; category: string | null;
    size_delta: number; created_at: string; user: { id: number; name: string; avatar_url: string | null } | null;
    church?: { id: number; name: string };
  }[];
};

export type OmAdminChurchStorage = {
  id: number; name: string; jurisdiction: string | null; database_name: string; city: string | null; state_province: string | null;
  quota_bytes: number; used_bytes: number; file_count: number; last_activity: string | null; error?: string;
};

export type OmAdminOverview = {
  year: number; jurisdiction: string | null; churches: OmAdminChurchStorage[];
  totals: { quota_bytes: number; used_bytes: number; file_count: number; categories: OmFilesOverview['categories']; roots: OmFilesOverview['roots'] };
  activity: { year: number; series: { name: string; data: number[] }[] };
  recent_activity: OmFilesOverview['recent_activity'];
};

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(input, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json as T;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const F = '/api/om/files';
const q = (params: Record<string, string | number | null | undefined>) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') sp.set(k, String(v)); });
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const omFilesApi = {
  context: (churchId?: number | null) => call<OmFilesContextInfo>(`${F}/context${q({ church_id: churchId })}`),

  items: (p: { churchId?: number | null; folderId?: number | null; q?: string; types?: string[]; favorites?: boolean; shared?: boolean }) =>
    call<{ folder_id: number | null; breadcrumbs: { id: number; name: string; systemKey: string | null }[]; folders: OmFolder[]; files: OmFile[] }>(
      `${F}/items${q({ church_id: p.churchId, folder_id: p.folderId, q: p.q, types: p.types?.join(','), favorites: p.favorites ? 1 : undefined, shared: p.shared ? 1 : undefined })}`
    ),

  createFolder: (churchId: number | null | undefined, name: string, parentId: number | null) =>
    call<{ folder: OmFolder }>(`${F}/folders`, jsonInit('POST', { church_id: churchId, name, parent_id: parentId })).then((r) => r.folder),

  upload: async (churchId: number | null | undefined, folderId: number | null, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return call<{ files: OmFile[]; used_bytes: number; quota_bytes: number }>(`${F}/upload${q({ church_id: churchId, folder_id: folderId })}`, { method: 'POST', body: form });
  },

  update: (churchId: number | null | undefined, itemId: string, body: { name?: string; tags?: string[]; folder_id?: number | null; parent_id?: number | null }) =>
    call<{ item: OmFileItem }>(`${F}/items/${itemId}`, jsonInit('PATCH', { church_id: churchId, ...body })).then((r) => r.item),

  remove: (churchId: number | null | undefined, itemId: string) => call(`${F}/items/${itemId}${q({ church_id: churchId })}`, { method: 'DELETE' }),

  toggleFavorite: (churchId: number | null | undefined, itemId: string) =>
    call<{ favorited: boolean }>(`${F}/items/${itemId}/favorite`, jsonInit('POST', { church_id: churchId })),

  shareTargets: (churchId?: number | null) => call<{ users: OmShareTarget[] }>(`${F}/share-targets${q({ church_id: churchId })}`).then((r) => r.users),

  setShares: (churchId: number | null | undefined, itemId: string, users: { user_id: number; permission: 'view' | 'edit' }[]) =>
    call<{ item: OmFileItem }>(`${F}/items/${itemId}/shares`, jsonInit('PUT', { church_id: churchId, users })).then((r) => r.item),

  overview: (churchId?: number | null, year?: number) => call<OmFilesOverview>(`${F}/overview${q({ church_id: churchId, year })}`),

  adminChurches: (jurisdiction?: string | null) =>
    call<{ churches: OmAdminChurchStorage[]; jurisdictions: string[] }>(`${F}/admin/churches${q({ jurisdiction })}`),
  adminOverview: (jurisdiction?: string | null, year?: number) => call<OmAdminOverview>(`${F}/admin/overview${q({ jurisdiction, year })}`),

  downloadUrl: (file: OmFile, inline = false) => `${file.url}${inline ? '?inline=1&log=0' : ''}`,
};
