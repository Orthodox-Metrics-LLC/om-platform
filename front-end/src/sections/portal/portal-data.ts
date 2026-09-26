import { useState, useEffect } from 'react';

import { CONFIG } from 'src/global-config';

import { useOmAuth, omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Data for the /portal parish landing page.
 *
 * Wired to real OM endpoints where they exist — the same calls the legacy
 * portal hub makes (`usePortalHub`):
 *   - church name            → GET /api/my/churches
 *   - baptism/marriage/funeral totals → GET /api/*-records?limit=1 (totals only)
 *
 * Widgets with no OM aggregate endpoint yet (age groups, attendance,
 * ministries, news, events, tasks, new-parishioner counts) render from the
 * approved mockup fixtures below — the same review-fixture approach prod's
 * own /om-portal dashboard uses while its aggregate APIs are pending.
 * If a live call fails, the fixture value stands in so the page still
 * matches the approved design.
 */

export type PortalSummary = {
  newParishioners: number;
  baptisms: number;
  marriages: number;
  funerals: number;
};

export type PortalData = {
  loading: boolean;
  churchName: string | null;
  /** True when the sacrament totals came from the live API. */
  summaryIsLive: boolean;
  summary: PortalSummary;
};

/** Values shown on the approved mockup — the fallback when live data is absent. */
const FIXTURE_SUMMARY: PortalSummary = {
  newParishioners: 12,
  baptisms: 8,
  marriages: 3,
  funerals: 5,
};

async function recordTotal(path: string): Promise<number | null> {
  try {
    const res = await omApiFetch(`/api/${path}?limit=1`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const total = data?.totalRecords ?? data?.total ?? data?.pagination?.total;
    return typeof total === 'number' ? total : null;
  } catch {
    return null;
  }
}

async function resolveChurchName(churchId: number | null): Promise<string | null> {
  if (!churchId) return null;
  try {
    const res = await omApiFetch('/api/my/churches');
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const list: any[] = data?.churches ?? (Array.isArray(data) ? data : []);
    const match = list.find((c) => c.id === churchId);
    return match ? (match.name || match.church_name || null) : null;
  } catch {
    return null;
  }
}

export function usePortalData(): PortalData {
  const { user } = useOmAuth();
  const [state, setState] = useState<PortalData>({
    loading: true,
    churchName: null,
    summaryIsLive: false,
    summary: FIXTURE_SUMMARY,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [churchName, baptisms, marriages, funerals] = await Promise.all([
        resolveChurchName(user?.church_id ?? null),
        recordTotal('baptism-records'),
        recordTotal('marriage-records'),
        recordTotal('funeral-records'),
      ]);
      if (cancelled) return;

      const live = baptisms !== null || marriages !== null || funerals !== null;
      setState({
        loading: false,
        churchName,
        summaryIsLive: live,
        summary: {
          newParishioners: FIXTURE_SUMMARY.newParishioners,
          baptisms: baptisms ?? FIXTURE_SUMMARY.baptisms,
          marriages: marriages ?? FIXTURE_SUMMARY.marriages,
          funerals: funerals ?? FIXTURE_SUMMARY.funerals,
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.church_id]);

  return state;
}

// ----------------------------------------------------------------------
// Fixtures for widgets that have no OM aggregate endpoint yet. Values are
// transcribed from the approved mockup.
// ----------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const PORTAL_AGE_GROUPS = [
  { label: 'Adults', value: 48.8 },
  { label: 'Children', value: 31.3 },
  { label: 'Seniors', value: 18.8 },
  { label: 'Teens', value: 1.1 },
];

export const PORTAL_ATTENDANCE = {
  categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
  series: [
    { name: 'Sunday Liturgy', data: [44, 55, 30, 67, 68, 37, 67, 68, 37] },
    { name: 'Other Services', data: [35, 70, 47, 40, 40, 24, 37, 24, 55] },
  ],
};

export const PORTAL_SACRAMENTAL = {
  categories: ['Baptisms', 'Chrismations', 'Marriages', 'Funerals', 'Confessions'],
  series: [
    { name: 'This Year', data: [62, 58, 41, 68, 28] },
    { name: 'Last Year', data: [53, 49, 33, 52, 13] },
  ],
};

export const PORTAL_MINISTRIES = {
  categories: ['Liturgy', 'Education', 'Outreach', 'Youth', 'Stewardship'],
  series: [
    { name: 'Current Year', data: [80, 50, 30, 40, 70] },
    { name: 'Last Year', data: [60, 30, 40, 60, 40] },
    { name: 'Parish Goal', data: [70, 76, 60, 55, 65] },
  ],
};

export const PORTAL_NEWS = [
  {
    id: 'news-1',
    title: 'Fall Parish Assembly',
    description: 'Join us this Sunday after Liturgy to discuss upcoming parish initiatives.',
    coverUrl: `${CONFIG.assetsDir}/assets/images/home/records/records-overview.webp`,
    postedAt: Date.now() - 15 * MINUTE,
  },
  {
    id: 'news-2',
    title: 'Adult Education Series Begins',
    description: 'A new 8-week series on the Divine Liturgy starts this Wednesday.',
    coverUrl: `${CONFIG.assetsDir}/assets/images/home/records/notebook-entries.webp`,
    postedAt: Date.now() - DAY,
  },
  {
    id: 'news-3',
    title: 'Parish Feast Day Celebration',
    description: 'Save the date! Our patronal feast will be celebrated on November 6th.',
    coverUrl: `${CONFIG.assetsDir}/assets/images/home/records/register-digitized.webp`,
    postedAt: Date.now() - 2 * DAY,
  },
  {
    id: 'news-4',
    title: 'Help for Our Neighbors',
    description: 'Food drive for the local community runs through the end of the month.',
    coverUrl: `${CONFIG.assetsDir}/assets/images/home/records/parish-history.webp`,
    postedAt: Date.now() - 3 * DAY,
  },
  {
    id: 'news-5',
    title: 'New Parish Photo Directory',
    description: 'Photography sessions continue next weekend. Sign up in the narthex.',
    coverUrl: `${CONFIG.assetsDir}/assets/images/home/records/ocr-batch-complete.webp`,
    postedAt: Date.now() - 4 * DAY,
  },
];

export const PORTAL_EVENTS = [
  { id: 'event-1', type: 'order1', title: 'Divine Liturgy', time: '2026-09-28T09:00:00' },
  { id: 'event-2', type: 'order2', title: 'Adult Education Class', time: '2026-10-01T19:00:00' },
  { id: 'event-3', type: 'order3', title: 'Parish Council Meeting', time: '2026-10-02T18:30:00' },
  { id: 'event-4', type: 'order4', title: 'Youth Group', time: '2026-10-04T17:00:00' },
  { id: 'event-5', type: 'order5', title: 'Parish Feast Day', time: '2026-11-06T09:00:00' },
];

export const PORTAL_TASKS = [
  { id: 'task-1', name: 'Review new parishioner registrations' },
  { id: 'task-2', name: 'Update family contact information' },
  { id: 'task-3', name: 'Prepare monthly stewardship report' },
  { id: 'task-4', name: 'Respond to parish messages' },
  { id: 'task-5', name: 'Plan upcoming event' },
];
