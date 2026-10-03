import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------
// Parish Settings (super_admin / admin) — real data from the OM backend's
// existing church-admin endpoints (prod: server/src/api/admin.js,
// server/src/routes/admin/church-users.js).

export type ParishStatus = 'production' | 'staging' | 'trial' | 'inactive';

export interface ParishSummary {
  id: number;
  name: string;
  church_name?: string | null;
  is_active: 0 | 1;
  client_status: string | null;
  billing_status: string | null;
  onboarding_phase: string | null;
  database_name: string | null;
  is_demo: 0 | 1;
  city: string | null;
  state_province: string | null;
  userCount?: number;
}

export interface ParishDetail {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string | null;
  website: string | null;
  preferred_language: string | null;
  timezone: string | null;
  currency: string | null;
  is_active: 0 | 1;
  database_name: string | null;
  has_baptism_records: 0 | 1;
  has_marriage_records: 0 | 1;
  has_funeral_records: 0 | 1;
  setup_complete: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface ParishStats {
  baptisms: number;
  marriages: number;
  funerals: number;
  totalRecords: number;
}

async function parseJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

export async function fetchParishes(): Promise<ParishSummary[]> {
  const res = await omApiFetch('/api/admin/churches?include_directory=1');
  const json = await parseJson<{ churches: ParishSummary[] }>(res);
  return json.churches ?? [];
}

export async function fetchParish(id: number): Promise<ParishDetail> {
  const res = await omApiFetch(`/api/admin/churches/${id}`);
  return parseJson<ParishDetail>(res);
}

export async function fetchParishStats(id: number): Promise<ParishStats> {
  const res = await omApiFetch(`/api/admin/churches/${id}/stats`);
  return parseJson<ParishStats>(res);
}

export async function fetchParishUserCount(id: number): Promise<number> {
  const res = await omApiFetch(`/api/admin/church-users/${id}`);
  const json = await parseJson<{ data?: unknown[] }>(res);
  return Array.isArray(json.data) ? json.data.length : 0;
}

export interface CreateParishPayload {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  website?: string;
}

export async function createParish(payload: CreateParishPayload): Promise<{ church_id: number }> {
  const res = await omApiFetch('/api/admin/churches/wizard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function updateParish(id: number, patch: Partial<CreateParishPayload>): Promise<void> {
  const res = await omApiFetch(`/api/admin/churches/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  await parseJson(res);
}
