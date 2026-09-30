import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Menu editor client on `/api/om/menus` (prod: server/src/routes/om/menus.js).
 * Nav templates are stored as serializable Minimal navData: icons are strings
 * (NAV_ICONS keys or Iconify names), `info` is { label, color, icon }.
 */

export type MenuAudience = 'admin' | 'church' | 'limited';

export const AUDIENCE_LABELS: Record<MenuAudience, string> = {
  admin: 'Admin',
  church: 'Priest · Deacon · Church admin',
  limited: 'Limited roles',
};

export type NavInfo = { label?: string; color?: string; icon?: string };
export type NavItemNode = {
  title: string;
  path: string;
  icon?: string | null;
  caption?: string | null;
  info?: NavInfo | null;
  deepMatch?: boolean;
  disabled?: boolean;
  children?: NavItemNode[] | null;
};
export type NavSectionNode = { subheader: string; items: NavItemNode[] };

export type MenuTemplate = {
  id: number;
  audience: MenuAudience;
  name: string;
  description?: string | null;
  is_active: 0 | 1;
  nav: NavSectionNode[];
  updated_at?: string;
};

export type CatalogItem = {
  id: number;
  item_key: string;
  section: string;
  title: string;
  path: string;
  icon?: string | null;
  caption?: string | null;
  info_label?: string | null;
  info_color?: string | null;
  info_icon?: string | null;
  children?: NavItemNode[] | null;
  audiences: MenuAudience[];
};

const j = (r: Response) => r.json();

export const omMenusApi = {
  catalog: (): Promise<{ items: CatalogItem[] }> =>
    omApiFetch('/api/om/menus/catalog').then(j),

  templates: (): Promise<{ templates: MenuTemplate[] }> =>
    omApiFetch('/api/om/menus/templates').then(j),

  create: (audience: MenuAudience, name: string, nav: NavSectionNode[], description?: string): Promise<{ id: number }> =>
    omApiFetch('/api/om/menus/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience, name, nav, description }),
    }).then(j),

  update: (id: number, patch: { name?: string; description?: string; nav?: NavSectionNode[] }): Promise<{ ok: true }> =>
    omApiFetch(`/api/om/menus/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(j),

  activate: (id: number): Promise<{ ok: true }> =>
    omApiFetch(`/api/om/menus/templates/${id}/activate`, { method: 'POST' }).then(j),

  remove: (id: number): Promise<{ ok: true }> =>
    omApiFetch(`/api/om/menus/templates/${id}`, { method: 'DELETE' }).then(j),
};
