import type { ICalendarEvent } from 'src/types/calendar';
import type { OmCalendarEvent } from 'src/sections/calendar/om-calendar-api';

import dayjs from 'dayjs';
import useSWR, { mutate } from 'swr';
import { useMemo, useEffect } from 'react';

import { toast } from 'src/components/snackbar';

import { omCalendarApi } from 'src/sections/calendar/om-calendar-api';

// ----------------------------------------------------------------------

/**
 * Calendar actions on OM (`/api/om/calendar`). Events combine the church's local
 * events (editable by church admins/clergy) with read-only synced sources.
 * `churchId` is only needed for super_admin/admin viewing a specific parish; it is
 * remembered per session so the form/drag handlers can reuse it.
 */

/** Session-level calendar state shared with the form/drag handlers (not React state). */
const store: { churchId: number | null; events: OmCalendarEvent[] } = { churchId: null, events: [] };
export const setCalendarChurch = (id: number | null) => { store.churchId = id; };

const RANGE_START = () => dayjs().subtract(3, 'month').startOf('month').format('YYYY-MM-DD');
const RANGE_END = () => dayjs().add(12, 'month').endOf('month').format('YYYY-MM-DD');
export const eventsKey = (churchId: number | null) => ['om-calendar-events', churchId, RANGE_START(), RANGE_END()] as const;

export function useGetEvents(churchId: number | null = null) {
  const { data, isLoading, error, isValidating } = useSWR(
    eventsKey(churchId),
    ([, id, start, end]) => omCalendarApi.events(id, start, end),
    { revalidateOnFocus: false, refreshInterval: 15 * 60 * 1000 }
  );

  useEffect(() => {
    store.churchId = churchId;
    store.events = (data?.events ?? []) as OmCalendarEvent[];
  }, [churchId, data]);

  return useMemo(
    () => ({
      events: (data?.events ?? []) as OmCalendarEvent[],
      sources: data?.sources ?? [],
      canWrite: !!data?.can_write,
      eventsLoading: isLoading,
      eventsError: error,
      eventsValidating: isValidating,
      eventsEmpty: !isLoading && !isValidating && !data?.events.length,
    }),
    [data, error, isLoading, isValidating]
  );
}

export const refreshEvents = () => mutate(eventsKey(store.churchId));

// ----------------------------------------------------------------------

export async function createEvent(eventData: ICalendarEvent) {
  await omCalendarApi.createEvent(store.churchId, eventData);
  await refreshEvents();
}

export async function updateEvent(eventData: Partial<ICalendarEvent>) {
  if (!eventData.id || !String(eventData.id).startsWith('local:')) {
    toast.error('Synced calendar events are read-only');
    await refreshEvents(); // snap the dragged event back
    return;
  }
  // Drag/resize only carries id/start/end/allDay — merge with the cached event.
  const existing = store.events.find((e) => e.id === eventData.id);
  const merged = { ...existing, ...eventData };
  await omCalendarApi.updateEvent(store.churchId, String(eventData.id), merged);
  await refreshEvents();
}

export async function deleteEvent(eventId: string) {
  if (!eventId.startsWith('local:')) {
    toast.error('Synced calendar events are read-only');
    return;
  }
  await omCalendarApi.deleteEvent(store.churchId, eventId);
  await refreshEvents();
}
