/**
 * Latest News Campaign — effective status from stored status + visibility window.
 */

const PUBLIC_STATUSES = new Set(['live']);
const ALL_STATUSES = ['draft', 'scheduled', 'live', 'expired', 'archived'];

/**
 * @param {string|Date|null|undefined} value
 * @returns {number|null}
 */
function toTimestamp(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {object} campaign
 * @param {Date} [now]
 * @returns {'draft'|'scheduled'|'live'|'expired'|'archived'}
 */
function computeEffectiveStatus(campaign, now = new Date()) {
  const stored = String(campaign?.status || 'draft').toLowerCase();
  if (!ALL_STATUSES.includes(stored)) return 'draft';

  if (stored === 'archived') return 'archived';
  if (stored === 'draft') return 'draft';

  const nowMs = now.getTime();
  const endMs = toTimestamp(campaign.visibility_end_at);
  const startMs = toTimestamp(campaign.visibility_start_at);

  if (endMs != null && nowMs > endMs) return 'expired';
  if (startMs != null && nowMs < startMs) return 'scheduled';

  if (stored === 'scheduled' || stored === 'live') return 'live';

  return stored;
}

/**
 * @param {object} campaign
 * @param {Date} [now]
 * @returns {boolean}
 */
function isPubliclyVisible(campaign, now = new Date()) {
  return PUBLIC_STATUSES.has(computeEffectiveStatus(campaign, now));
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isValidCtaUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/')) return !/\s/.test(trimmed);
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * @param {object} fields
 * @returns {string|null}
 */
function validateCampaignFields(fields) {
  const title = String(fields.title || '').trim();
  if (!title) return 'title is required';

  const startMs = toTimestamp(fields.visibility_start_at);
  const endMs = toTimestamp(fields.visibility_end_at);
  if (startMs != null && endMs != null && endMs <= startMs) {
    return 'visibility_end_at must be after visibility_start_at';
  }

  const rotationSeconds = Number(fields.rotation_interval_seconds);
  if (fields.rotation_interval_seconds != null && (!Number.isFinite(rotationSeconds) || rotationSeconds < 3)) {
    return 'rotation_interval_seconds must be at least 3';
  }

  return null;
}

/**
 * @param {object} fields
 * @returns {string|null}
 */
function validateItemFields(fields) {
  const title = String(fields.title || '').trim();
  if (!title) return 'title is required';

  if (fields.cta_label && !fields.cta_url) {
    return 'cta_url is required when cta_label is set';
  }
  if (fields.cta_url && !fields.cta_label) {
    return 'cta_label is required when cta_url is set';
  }
  if (fields.cta_url && !isValidCtaUrl(fields.cta_url)) {
    return 'cta_url must be a valid http(s) URL or site-relative path';
  }

  return null;
}

/**
 * @param {string} title
 * @param {number} [id]
 * @returns {string}
 */
function slugify(title, id) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base) return base.slice(0, 200);
  return `campaign-${id || Date.now()}`;
}

/**
 * Strip HTML and trim to max length.
 * @param {string} html
 * @param {number} [maxLen]
 * @returns {string}
 */
function excerptFromBody(html, maxLen = 200) {
  const text = String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trim()}…`;
}

/**
 * @param {string} body
 * @param {string} [url]
 * @returns {string}
 */
function suggestCtaLabel(body, url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('register') || u.includes('signup') || u.includes('rsvp')) return 'Register';
  if (u.includes('donate') || u.includes('give')) return 'Donate';
  if (u.includes('volunteer')) return 'Volunteer';
  if (u.includes('calendar') || u.includes('schedule')) return 'View schedule';
  const text = String(body || '').toLowerCase();
  if (text.includes('fundraiser') || text.includes('donation')) return 'Support this effort';
  if (text.includes('volunteer')) return 'Volunteer';
  if (text.includes('register') || text.includes('rsvp')) return 'Register';
  return 'Learn more';
}

const LAYOUT_TYPES = [
  'hero', 'split', 'card', 'banner', 'quote', 'image_grid', 'video',
  'animate', 'utilities', 'scrollbar', 'scroll_progress', 'lightbox',
  'form_wizard', 'carousel', 'timeline', 'tooltip', 'rating',
  'file_upload', 'data_table',
];
const ITEM_STATUSES = ['draft', 'active', 'disabled'];
const FILE_TYPES = ['image', 'video', 'document'];

/**
 * Page Builder page types. 'latest_news' is the original Campaign Builder
 * behavior (rotating public announcements); the rest recreate the standing
 * public-site pages (front-end/src/pages/{coming-soon,maintenance,error}).
 */
const PAGE_TYPES = ['latest_news', 'coming_soon', 'maintenance', 'error_404', 'error_403', 'error_500', 'checkout', 'payment', 'pricing', 'records', 'faq'];

module.exports = {
  ALL_STATUSES,
  PUBLIC_STATUSES,
  LAYOUT_TYPES,
  ITEM_STATUSES,
  FILE_TYPES,
  PAGE_TYPES,
  computeEffectiveStatus,
  isPubliclyVisible,
  isValidCtaUrl,
  validateCampaignFields,
  validateItemFields,
  slugify,
  excerptFromBody,
  suggestCtaLabel,
  toTimestamp,
};
