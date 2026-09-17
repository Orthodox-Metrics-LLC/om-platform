// ----------------------------------------------------------------------

/**
 * Anchor ids on the home page, and the paths that deep-link to them.
 *
 * Ported from OM's `features/public-site/landing/landingSectionRoutes.ts`. In OM,
 * `/product`, `/products`, `/records`, `/ocr`, `/capabilities` and `/analytics`
 * are not separate pages — they all render the same home page and scroll to a
 * named section. Keeping the same names and mapping preserves existing inbound
 * links and SEO.
 */
export const LANDING_SECTION_IDS = [
  'product',
  'record-capabilities',
  'paper-to-digital',
  'history-insight',
  'pricing',
  'faq',
  'final-cta',
] as const;

export type LandingSectionId = (typeof LANDING_SECTION_IDS)[number];

/** Paths that render the home page, each landing on a different section. */
export const LANDING_PATH_TO_SECTION: Record<string, LandingSectionId> = {
  '/': 'product',
  '/product': 'product',
  '/products': 'product',
  '/records': 'record-capabilities',
  '/capabilities': 'record-capabilities',
  '/ocr': 'paper-to-digital',
  '/analytics': 'history-insight',
};

export const LANDING_PATHS = Object.keys(LANDING_PATH_TO_SECTION);

export function sectionIdForPath(pathname: string): LandingSectionId {
  return LANDING_PATH_TO_SECTION[pathname] ?? 'product';
}
