import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Data layer for the user-management pages, backed by OM's admin API
 * (prod: server/src/api/admin.js, mounted at /api/admin).
 */

export type OmAccountStatus = 'pending' | 'active' | 'banned' | 'rejected';

export type OmAdminUser = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  role: string;
  church_id: number | null;
  church_name: string | null;
  is_active: 0 | 1 | boolean;
  is_locked: 0 | 1 | boolean;
  lockout_reason?: string | null;
  account_status: OmAccountStatus;
  approved_at: string | null;
  email_verified: 0 | 1 | boolean;
  preferred_language: string | null;
  phone: string | null;
  location: string | null;
  job_title: string | null;
  avatar_url: string | null;
  created_at: string;
  last_login: string | null;
};

export type OmChurchOption = { id: number; name: string; church_name?: string | null };

export const ACCOUNT_STATUS_OPTIONS: { value: OmAccountStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'banned', label: 'Banned' },
  { value: 'rejected', label: 'Rejected' },
];

/** Canonical OM roles (utils/roles.js). Assignable set depends on the actor. */
export const OM_ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin', tier: 'platform' },
  { value: 'admin', label: 'Administrator', tier: 'platform' },
  { value: 'church_admin', label: 'Church Admin', tier: 'church' },
  { value: 'priest', label: 'Priest', tier: 'church' },
  { value: 'deacon', label: 'Deacon', tier: 'church' },
  { value: 'editor', label: 'Editor', tier: 'church' },
  { value: 'viewer', label: 'Viewer', tier: 'church' },
] as const;

export const isPlatformRole = (role?: string | null) => role === 'super_admin' || role === 'admin';

export const userFullName = (u: Pick<OmAdminUser, 'first_name' | 'last_name' | 'display_name' | 'email'>) =>
  u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;

export const churchLabel = (c: OmChurchOption) => c.church_name || c.name;

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(input, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const omUsersApi = {
  list: () => call<{ users: OmAdminUser[] }>('/api/om-admin/users').then((r) => r.users),
  get: (id: number | string) => call<{ user: OmAdminUser }>(`/api/om-admin/users/${id}`).then((r) => r.user),
  churches: () =>
    call<{ churches: OmChurchOption[] }>('/api/om-admin/churches').then((r) => r.churches ?? []),

  create: (body: {
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    church_id: number | null;
    phone?: string | null;
    location?: string | null;
    job_title?: string | null;
  }) => call<{ user: OmAdminUser }>('/api/om-admin/users', { method: 'POST', ...json(body) }),

  update: (id: number, body: Partial<Pick<OmAdminUser, 'email' | 'first_name' | 'last_name' | 'display_name' | 'role' | 'church_id' | 'phone' | 'location' | 'job_title'>>) =>
    call(`/api/om-admin/users/${id}`, { method: 'PUT', ...json(body) }),

  remove: (id: number) => call(`/api/om-admin/users/${id}`, { method: 'DELETE' }),

  setAccountStatus: (id: number, body: { account_status: OmAccountStatus; church_id?: number | null; reason?: string }) =>
    call<{ account_status: OmAccountStatus; welcome_email_sent: boolean }>(
      `/api/om-admin/users/${id}/account-status`,
      { method: 'PATCH', ...json(body) }
    ),

  adminChurches: (id: number) =>
    call<{ churches: { church_id: number; church_name: string }[] }>(`/api/om-admin/users/${id}/churches`).then(
      (r) => r.churches
    ),
  setAdminChurches: (id: number, church_ids: number[]) =>
    call(`/api/om-admin/users/${id}/churches`, { method: 'PUT', ...json({ church_ids }) }),
};
