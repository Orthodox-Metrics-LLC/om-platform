import type { ICalendarEvent } from 'src/types/calendar';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Calendar data layer on OM's `/api/om/calendar` (prod: server/src/routes/om/calendar.js).
 * Sources: parish website (/schedule → iCal), any iCal URL, orthocal.info (new/old calendar).
 */

export type OmCalendarKind = 'website' | 'ics' | 'orthocal';
export type OmLiturgicalCalendar = 'new' | 'old';

export type OmCalendarSource = {
  id: number;
  name: string;
  kind: OmCalendarKind;
  url: string | null;
  color: string;
  enabled: boolean;
  sort_order: number;
  config: { calendar?: OmLiturgicalCalendar } & Record<string, unknown>;
  last_synced_at: string | null;
  last_error: string | null;
  feed_url?: string;
  feed_name?: string | null;
};

export type OmLiturgicalDay = {
  date: string;
  calendar: OmLiturgicalCalendar;
  title: string;
  titles: string[];
  feasts: string[];
  saints: string[];
  feast_level: number | null;
  feast_level_description: string | null;
  fast_level: number | null;
  fast_level_description: string | null;
  fast_exception_description: string | null;
  tone: number | null;
  readings: string[];
  other: { calendar: OmLiturgicalCalendar; label: string; date: string; today_title: string | null };
};

/** Minimal's ICalendarEvent + OM extras carried through FullCalendar's extendedProps. */
export type OmCalendarEvent = ICalendarEvent & {
  readonly: boolean;
  source_id: number | null;
  source_name: string;
  location?: string;
  url?: string | null;
  local_id?: number;
  liturgical?: OmLiturgicalDay;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json as T;
}
const jsonInit = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const C = '/api/om/calendar';
const q = (p: Record<string, unknown>) => {
  const sp = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') sp.set(k, String(v)); });
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const omCalendarApi = {
  sources: (churchId?: number | null) =>
    call<{ church: { id: number; name: string; website: string | null }; can_write: boolean; default_calendar: OmLiturgicalCalendar; sources: OmCalendarSource[] }>(`${C}/sources${q({ church_id: churchId })}`),
  addSource: (churchId: number | null | undefined, body: { name: string; kind: OmCalendarKind; url?: string; color?: string; config?: Record<string, unknown> }) =>
    call<{ source: OmCalendarSource }>(`${C}/sources`, jsonInit('POST', { church_id: churchId, ...body })).then((r) => r.source),
  updateSource: (churchId: number | null | undefined, id: number, body: Partial<Pick<OmCalendarSource, 'name' | 'color' | 'enabled' | 'url'>> & { config?: Record<string, unknown> }) =>
    call<{ source: OmCalendarSource }>(`${C}/sources/${id}`, jsonInit('PATCH', { church_id: churchId, ...body })).then((r) => r.source),
  removeSource: (churchId: number | null | undefined, id: number) => call(`${C}/sources/${id}${q({ church_id: churchId })}`, { method: 'DELETE' }),
  syncSource: (churchId: number | null | undefined, id: number) => call<{ source: OmCalendarSource; count: number }>(`${C}/sources/${id}/sync`, jsonInit('POST', { church_id: churchId })),
  setDefaultCalendar: (churchId: number | null | undefined, calendar: OmLiturgicalCalendar) =>
    call<{ default_calendar: OmLiturgicalCalendar }>(`${C}/default-calendar`, jsonInit('PUT', { church_id: churchId, calendar })),

  events: (churchId: number | null | undefined, start: string, end: string) =>
    call<{ range: { start: string; end: string }; can_write: boolean; sources: OmCalendarSource[]; events: OmCalendarEvent[] }>(`${C}/events${q({ church_id: churchId, start, end })}`),
  liturgical: (churchId: number | null | undefined, start: string, end: string) =>
    call<{ calendar: OmLiturgicalCalendar; days: OmLiturgicalDay[] }>(`${C}/liturgical${q({ church_id: churchId, start, end })}`),

  createEvent: (churchId: number | null | undefined, e: Partial<OmCalendarEvent>) =>
    call<{ id: string }>(`${C}/events`, jsonInit('POST', { church_id: churchId, ...e })),
  updateEvent: (churchId: number | null | undefined, id: string, e: Partial<OmCalendarEvent>) =>
    call(`${C}/events/${encodeURIComponent(id)}`, jsonInit('PUT', { church_id: churchId, ...e })),
  deleteEvent: (churchId: number | null | undefined, id: string) => call(`${C}/events/${encodeURIComponent(id)}${q({ church_id: churchId })}`, { method: 'DELETE' }),
};
