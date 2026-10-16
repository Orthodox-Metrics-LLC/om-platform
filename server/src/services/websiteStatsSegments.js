/**
 * Traffic segment definitions for OM Website Stats (Phase 1).
 *
 * Segments split analytics into public marketing traffic vs. authenticated
 * application usage. Path rules mirror the OM route map.
 */

/** @typedef {'all' | 'public' | 'app'} TrafficSegment */

const SEGMENT_LABELS = {
  all: 'All traffic',
  public: 'Public site',
  app: 'OM application',
};

const EXCLUDED_EXACT = new Set(['/admin/omai']);

/** Paths that are always excluded from segment rollups. */
const PUBLIC_EXACT = new Set([
  '/',
  '/about',
  '/contact',
  '/pricing',
  '/faq',
  '/tour',
  '/privacy',
  '/terms',
  '/security',
  '/enroll',
  '/blog',
  '/samples',
  '/tasks',
  '/platform-tour',
  '/sample-records',
  '/greek_baptism_table_demo.html',
  '/russian_wedding_table_demo.html',
  '/romanian_funeral_table_demo.html',
]);

const PUBLIC_PREFIXES = [
  '/auth/',
  '/frontend-pages/',
  '/help/',
  '/bigbook/',
  '/blog/',
  '/samples/',
  '/tasks/',
  '/r/interactive/',
  '/c/',
];

const APP_PREFIXES = [
  '/portal/',
  '/admin/',
  '/om-daily/',
  '/devel/',
  '/devel-tools/',
  '/account/',
  '/apps/',
  '/social/',
  '/dashboards/',
  '/interactive-reports/',
  '/onboarding/',
  '/church/',
  '/omb/',
  '/site-map',
  '/bigbook/',
  '/tables/',
  '/react-tables/',
  '/notifications',
  '/user-profile',
  '/records/',
];

/**
 * Plausible v1 filter strings (OR groups with wildcards).
 * Used when segment !== 'all' for provider-side totals.
 */
const PLAUSIBLE_SEGMENT_FILTERS = {
  public:
    'event:page==/|/auth/*|/help/*|/bigbook/*|/about|/contact|/pricing|/faq|/blog/*|/samples/*|/tour|/privacy|/terms|/security|/enroll|/tasks/*|/r/interactive/*|/c/*|/frontend-pages/*',
  app:
    'event:page==/portal/*|/om-daily/*|/devel/*|/devel-tools/*|/account/*|/apps/*|/social/*|/dashboards/*|/interactive-reports/*|/onboarding/*|/church/*|/omb/*|/site-map|/bigbook/*|/admin/*|/tables/*|/react-tables/*|/notifications|/user-profile|/records/*;event:page!=/admin/omai',
};

function normalizeSegment(value) {
  const segment = String(value || 'all').toLowerCase();
  return segment === 'public' || segment === 'app' ? segment : 'all';
}

function normalizePagePath(page) {
  if (!page) return '/';
  const raw = String(page).trim();
  const withoutQuery = raw.split('?')[0].split('#')[0] || '/';
  if (!withoutQuery.startsWith('/')) return `/${withoutQuery}`;
  return withoutQuery.length > 1 && withoutQuery.endsWith('/')
    ? withoutQuery.slice(0, -1)
    : withoutQuery;
}

function isExcludedPath(path) {
  return EXCLUDED_EXACT.has(path);
}

function isPublicPath(path) {
  if (isExcludedPath(path)) return false;
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isAppPath(path) {
  if (isExcludedPath(path)) return false;
  return APP_PREFIXES.some((prefix) => {
    if (prefix.endsWith('/')) {
      const root = prefix.slice(0, -1);
      return path === root || path.startsWith(prefix);
    }
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

function matchesSegment(page, segment) {
  const path = normalizePagePath(page);
  if (isExcludedPath(path)) return false;
  if (segment === 'all') return true;
  if (segment === 'public') return isPublicPath(path);
  if (segment === 'app') return isAppPath(path);
  return true;
}

function getPlausibleFilter(segment) {
  if (segment === 'all') return null;
  return PLAUSIBLE_SEGMENT_FILTERS[segment] || null;
}

function applySegmentToStats(data, segment) {
  if (segment === 'all') {
    return {
      ...data,
      segment,
      segment_label: SEGMENT_LABELS[segment],
      totals_derived: false,
    };
  }

  const filteredPages = (data.top_pages || []).filter((row) =>
    matchesSegment(row.page, segment),
  );
  const top_pages = filteredPages.slice(0, 10);
  const totals = {
    visitors: filteredPages.reduce((sum, row) => sum + (row.visitors || 0), 0),
    pageviews: filteredPages.reduce(
      (sum, row) => sum + (row.pageviews ?? row.visitors ?? 0),
      0,
    ),
    bounce_rate: null,
    visit_duration: null,
  };

  return {
    ...data,
    segment,
    segment_label: SEGMENT_LABELS[segment],
    totals,
    top_pages,
    top_referrers: [],
    totals_derived: true,
    totals_note:
      'Segment totals are summed from the top 100 pages in this category. Visitor counts may overlap across pages; bounce rate and visit duration are only available for All traffic.',
  };
}

module.exports = {
  SEGMENT_LABELS,
  normalizeSegment,
  normalizePagePath,
  matchesSegment,
  isPublicPath,
  isAppPath,
  isExcludedPath,
  getPlausibleFilter,
  applySegmentToStats,
};
