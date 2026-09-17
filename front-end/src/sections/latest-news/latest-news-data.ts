import type { IconifyName } from 'src/components/iconify/register-icons';

// ----------------------------------------------------------------------

/**
 * Standing product announcements, taken verbatim from OM's
 * `features/public-site/components/latest-news/figma/latestNewsFigmaData.ts`
 * and the `latest_news.*` i18n keys.
 *
 * These are the baseline: the page also reads
 * `GET /api/public/latest-news/active`, but that returns
 * `{"success":true,"campaigns":[]}` today because no campaign has been authored
 * (`latest_news_campaigns` and `latest_news_items` are both empty in
 * `orthodoxmetrics_db`). When a campaign is published it renders above these.
 */

export const LATEST_NEWS_COPY = {
  badge: 'Announcements',
  title: 'Latest News',
  subtitle: 'Updates and announcements from Orthodox Metrics.',
  empty: 'No announcements at this time. Please check back soon.',
} as const;

export type AnnouncementStatus = 'active' | 'scheduled' | 'featured';

export type Announcement = {
  id: string;
  label: string;
  status: string;
  statusType: AnnouncementStatus;
  shortName: string;
  title: string;
  body: string;
  bullets: string[];
  cta: string;
  ctaHref: string;
  /** Must be a name registered in the offline icon set. */
  icon: IconifyName;
};

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'om',
    label: 'Featured Platform',
    status: 'Now Available',
    statusType: 'active',
    shortName: 'Orthodox Metrics',
    title: 'Orthodox Metrics: A Complete Digital Platform for Orthodox Parish Records',
    body: 'Orthodox Metrics helps Orthodox parishes manage baptism, marriage, funeral, cemetery, and parish record workflows through a secure, structured, and modern platform. Built for churches that need better organization, better visibility, and better long-term preservation of parish records.',
    bullets: [
      'Centralized parish record management',
      'Secure administrative workflows',
      'Designed around Orthodox parish needs',
      'Built for long-term historical preservation',
      'Supports modern digital operations without losing traditional church structure',
    ],
    cta: 'Learn More About Orthodox Metrics',
    ctaHref: '/about',
    icon: 'solar:box-minimalistic-bold',
  },
  {
    id: 'cemetery',
    label: 'Cemetery Management',
    status: 'Active',
    statusType: 'active',
    shortName: 'OM Cemetery',
    title: 'OM Cemetery: Cemetery Records, Plot Tracking, and Burial History in One Place',
    body: 'OM Cemetery gives parishes a structured way to manage cemetery records, burial history, plot assignments, family connections, and long-term cemetery documentation. It is designed for churches that need clarity, accuracy, and preservation around sacred cemetery records.',
    bullets: [
      'Cemetery record organization',
      'Burial and plot tracking',
      'Family and historical connections',
      'Searchable cemetery documentation',
      'Better visibility for parish administrators',
    ],
    cta: 'Explore OM Cemetery',
    ctaHref: '/contact',
    icon: 'mingcute:location-fill',
  },
  {
    id: 'vault',
    label: 'Secure Preservation',
    status: 'Featured This Month',
    statusType: 'featured',
    shortName: 'OM Parish Vault',
    title: 'OM Parish Vault: Secure Digital Preservation for Parish Documents',
    body: 'OM Parish Vault provides a secure place for parishes to preserve important records, scanned documents, certificates, historical files, and administrative materials. It is built to help churches protect institutional memory and keep important parish information accessible for the future.',
    bullets: [
      'Secure document storage',
      'Parish archives and scanned records',
      'Certificate and record preservation',
      'Organized access for authorized users',
      'Built for long-term continuity',
    ],
    cta: 'View OM Parish Vault',
    ctaHref: '/security',
    icon: 'solar:shield-keyhole-bold-duotone',
  },
];

// ----------------------------------------------------------------------

/** Shape returned by `GET /api/public/latest-news/active`. */
export type NewsCampaign = {
  id: number;
  title: string;
  summary?: string | null;
  slug?: string | null;
  items?: {
    id: number;
    title: string;
    subtitle?: string | null;
    excerpt?: string | null;
    body?: string | null;
    cta_label?: string | null;
    cta_url?: string | null;
  }[];
};
