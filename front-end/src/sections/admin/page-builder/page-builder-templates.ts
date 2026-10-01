import type { PageType, LayoutType } from './om-pages-api';

// ----------------------------------------------------------------------

/**
 * Page Builder starting points — one per public-site surface this feature
 * can take over from its static Minimal UI defaults
 * (src/sections/{coming-soon,maintenance,error}/*-view.tsx). Deliberately
 * does NOT include the old Campaign Builder's content templates (parish
 * announcement, feast day, fundraiser, etc.) — those stay specific to
 * Latest News campaigns, which this Page Builder also manages but without
 * pre-built copy.
 */
export interface PageTemplate {
  page_type: PageType;
  label: string;
  description: string;
  title: string;
  summary: string;
  item: {
    title: string;
    subtitle?: string;
    body: string;
    layout_type: LayoutType;
    cta_label?: string;
    cta_url?: string;
  };
}

export const PAGE_BUILDER_TEMPLATES: PageTemplate[] = [
  {
    page_type: 'coming_soon',
    label: 'Coming soon',
    description: 'Countdown placeholder for a page that is not live yet',
    title: 'Coming soon',
    summary: 'We are currently working hard on this page!',
    item: {
      title: 'Coming soon',
      body: 'We are currently working hard on this page! Check back soon for updates.',
      layout_type: 'hero',
    },
  },
  {
    page_type: 'maintenance',
    label: 'Maintenance',
    description: 'Shown while the site (or a section of it) is down for maintenance',
    title: 'Website currently under maintenance',
    summary: 'We are currently working hard on this page!',
    item: {
      title: 'Under maintenance',
      body: 'We are currently working hard on this page! Please check back shortly.',
      layout_type: 'hero',
      cta_label: 'Go to home',
      cta_url: '/',
    },
  },
  {
    page_type: 'error_404',
    label: '404 — Not found',
    description: 'Page not found error surface',
    title: 'Sorry, page not found!',
    summary: 'Sorry, we could not find the page you are looking for.',
    item: {
      title: 'Page not found',
      body: "Sorry, we couldn't find the page you're looking for. Perhaps you mistyped the URL? Be sure to check your spelling.",
      layout_type: 'hero',
      cta_label: 'Go to home',
      cta_url: '/',
    },
  },
  {
    page_type: 'error_403',
    label: '403 — Forbidden',
    description: 'Permission denied error surface',
    title: 'No permission',
    summary: 'The page you are trying to access has restricted access.',
    item: {
      title: 'No permission',
      body: 'The page you are trying to access has restricted access. Please refer to your system administrator.',
      layout_type: 'hero',
      cta_label: 'Go to home',
      cta_url: '/',
    },
  },
  {
    page_type: 'error_500',
    label: '500 — Server error',
    description: 'Internal server error surface',
    title: 'Internal server error',
    summary: 'There was an error, please try again later.',
    item: {
      title: 'Internal server error',
      body: 'There was an error, please try again later.',
      layout_type: 'hero',
      cta_label: 'Go to home',
      cta_url: '/',
    },
  },
  {
    page_type: 'checkout',
    label: 'Checkout',
    description: 'Override the /product/checkout cart → billing → payment flow',
    title: 'Checkout unavailable',
    summary: 'Checkout is temporarily unavailable. Please check back shortly.',
    item: {
      title: 'Checkout unavailable',
      body: 'We are temporarily unable to process checkout. Please check back shortly or contact us for help completing your order.',
      layout_type: 'hero',
      cta_label: 'Go to home',
      cta_url: '/',
    },
  },
  {
    page_type: 'payment',
    label: 'Payment',
    description: 'Override the /payment plan upgrade & billing surface',
    title: 'Payments unavailable',
    summary: 'Payment processing is temporarily unavailable.',
    item: {
      title: 'Payments unavailable',
      body: 'We are temporarily unable to process payments. Please check back shortly or contact us for help upgrading your plan.',
      layout_type: 'hero',
      cta_label: 'Go to home',
      cta_url: '/',
    },
  },
  {
    page_type: 'pricing',
    label: 'Pricing',
    description: 'Override the /pricing plans surface',
    title: 'Flexible plans for your community',
    summary: 'Choose the plan that fits your parish and start today.',
    item: {
      title: 'Flexible plans for your community',
      body: 'Choose the plan that fits your parish and start today. Contact us if you have questions about which plan is right for you.',
      layout_type: 'hero',
      cta_label: 'Contact us',
      cta_url: '/contact',
    },
  },
];

export function templateFor(pageType: PageType): PageTemplate | undefined {
  return PAGE_BUILDER_TEMPLATES.find((t) => t.page_type === pageType);
}
