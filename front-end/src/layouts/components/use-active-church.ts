import { useState, useEffect, useCallback } from 'react';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Parish switcher state (Minimal's "workspaces" repurposed).
 *
 * Church roles have exactly one parish. Platform admins pick the parish they are
 * acting in; that choice is remembered for the session and used as the default
 * church context by Overview → File, File manager, Calendar, Account → Appearance
 * and Asset Manager → Church files (an explicit `?church=` still wins).
 */

export type OmWorkspace = {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
  jurisdiction: string | null;
  image_url: string | null;
  plan: string;
  plan_status: string | null;
};

const KEY = 'om_active_church';
const EVENT = 'om:active-church-changed';

export function getActiveChurchId(): number | null {
  const v = sessionStorage.getItem(KEY);
  return v ? Number(v) : null;
}

export function setActiveChurchId(id: number | null) {
  if (id) sessionStorage.setItem(KEY, String(id));
  else sessionStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

/** Reactive active church id (null until chosen). */
export function useActiveChurchId() {
  const [id, setId] = useState<number | null>(() => (typeof window === 'undefined' ? null : getActiveChurchId()));
  useEffect(() => {
    const on = (e: Event) => setId((e as CustomEvent<number | null>).detail ?? null);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return id;
}

/** Parishes the signed-in user may act in, plus the current selection. */
export function useWorkspaces(enabled: boolean) {
  const [workspaces, setWorkspaces] = useState<OmWorkspace[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [homeChurchId, setHomeChurchId] = useState<number | null>(null);
  const activeId = useActiveChurchId();

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await omApiFetch('/api/church-branding/workspaces');
      const json = await res.json();
      if (!res.ok || json?.success === false) return;
      setWorkspaces(json.workspaces ?? []);
      setRole(json.role ?? null);
      setHomeChurchId(json.home_church_id ?? null);
      // Default selection: own parish, else remembered, else first.
      const list: OmWorkspace[] = json.workspaces ?? [];
      const current = getActiveChurchId();
      if (!current || !list.some((w) => w.id === current)) {
        const next = list.find((w) => w.id === json.home_church_id) ?? list[0] ?? null;
        setActiveChurchId(next?.id ?? null);
      }
    } catch {
      /* keep last */
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const active = workspaces.find((w) => w.id === activeId) ?? null;
  return { workspaces, active, role, homeChurchId, refresh, select: setActiveChurchId };
}
