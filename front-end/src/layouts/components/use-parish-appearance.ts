import { useState, useEffect, useCallback } from 'react';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/** Parish appearance (`/api/church-branding/appearance`): sidebar card + Account → Appearance. */
export type ParishAppearance = {
  church_id: number;
  name: string;
  display_name: string;
  short_name: string | null;
  city: string | null;
  state: string | null;
  image_url: string | null;
  /** Small square church icon (favicon) — parish switcher chip + Parish Settings. */
  icon_url: string | null;
  primary_color: string | null;
  can_write: boolean;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json as T;
}

const A = '/api/church-branding/appearance';

export const PARISH_APPEARANCE_EVENT = 'om:parish-appearance-updated';

export const parishAppearanceApi = {
  get: (churchId?: number | null) => call<{ appearance: ParishAppearance }>(`${A}${churchId ? `?church_id=${churchId}` : ''}`).then((r) => r.appearance),
  update: (body: Partial<Pick<ParishAppearance, 'display_name' | 'city' | 'state' | 'image_url' | 'icon_url'>> & { church_id?: number | null }) =>
    call<{ appearance: ParishAppearance }>(A, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => {
      window.dispatchEvent(new CustomEvent(PARISH_APPEARANCE_EVENT, { detail: r.appearance }));
      return r.appearance;
    }),
};

export function useParishAppearance(enabled: boolean, churchId?: number | null) {
  const [appearance, setAppearance] = useState<ParishAppearance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setAppearance(await parishAppearanceApi.get(churchId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load parish appearance');
    }
  }, [enabled, churchId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Other instances (e.g. the sidebar card) pick up saves made on Account → Appearance.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const next = (e as CustomEvent<ParishAppearance>).detail;
      if (next && (!churchId || next.church_id === churchId)) setAppearance(next);
    };
    window.addEventListener(PARISH_APPEARANCE_EVENT, onUpdate);
    return () => window.removeEventListener(PARISH_APPEARANCE_EVENT, onUpdate);
  }, [churchId]);

  return { appearance, error, refresh, setAppearance };
}
