#!/usr/bin/env node
/**
 * One-time ingest: import the CURRENT hardcoded Pricing/Records/FAQ public
 * content into the Page Builder (latest_news_campaigns) system, as real
 * published pages, instead of leaving admins to build these from a blank
 * page. Idempotent — skips any page_type that already has a campaign.
 *
 * Source of truth for the content copied below:
 *   front-end/src/sections/home/home-pricing.tsx   (PLANS)
 *   front-end/src/sections/home/home-faqs.tsx      (FAQs)
 *   front-end/src/sections/home/home-hugepack-elements.tsx (TOP_ROW/BOTTOM_ROW)
 *
 * Run: node server/src/scripts/seed-public-pages.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const { getAppPool } = require('../config/db');
const { registerOmAssetFromLegacyFile } = require('../assets/omAssetsLegacyBridge');

const RECORDS_IMAGES_DIR = '/var/www/om-platform/front-end/public/assets/images/home/records';

const RECORDS_IMAGES = [
  // TOP_ROW
  { file: 'records-overview.webp', alt: 'Church records summary with yearly totals' },
  { file: 'parish-history.webp', alt: 'Parish history dashboard showing record trends by year' },
  { file: 'register-cards-trio.webp', alt: 'Three baptism register cards from a parish archive' },
  { file: 'notebook-entries.webp', alt: 'Guide to reading entries in a parish notebook' },
  // BOTTOM_ROW
  { file: 'register-handwritten.webp', alt: 'Handwritten baptism register card, parish record 15401' },
  { file: 'register-transcribed.webp', alt: 'The same baptism record transcribed into print' },
  { file: 'register-digitized.webp', alt: 'The same baptism record as a structured digital record' },
  { file: 'ocr-batch-progress.webp', alt: 'OCR batch processing progress for a parish register' },
  { file: 'ocr-batch-complete.webp', alt: 'Completed OCR batch ready for review' },
  { file: 'certificate-generator.webp', alt: 'Certificate generator with a live baptism certificate preview' },
];

const PLANS = [
  {
    title: 'Parish Essentials',
    subtitle: '$4.99/mo',
    caption: 'For small, historical parishes with limited modern intake.',
    features: ['Up to 1,000 historical pages', 'Standard search & metrics dashboard', 'Secure cloud hosting & backup', 'Email support'],
    cta_label: 'Get Started',
    cta_url: '/enroll',
  },
  {
    title: 'Diocesan Standard',
    subtitle: '$19.99/mo',
    caption: 'For active, mid-sized communities with deep historical archives.',
    features: ['Up to 5,000 historical pages', 'Multi-user parish staff access', 'Certificate generation', 'Data export & import tools'],
    cta_label: 'Choose Standard',
    cta_url: '/enroll',
  },
  {
    title: 'Cathedral Pro',
    subtitle: 'Contact Us',
    caption: 'For large cathedrals, monastic libraries, or central diocesan archives.',
    features: ['Unlimited historical processing', '~50+ new pages/month', 'Dedicated onboarding & training', 'Multi-parish diocesan rollup'],
    cta_label: 'Contact Us',
    cta_url: '/contact',
  },
];

const FAQS = [
  {
    title: 'What sacramental records does Orthodox Metrics support?',
    body: 'Baptism, chrismation, marriage, and funeral registers — the canonical metrical records most parishes are required to keep. Each record carries its own field set and can generate a parish-styled certificate on demand.',
  },
  {
    title: 'Which languages and scripts are supported?',
    body: '• English, Greek, Russian, Romanian, and Georgian.\n• Full Cyrillic, Greek, and Georgian character support in entry and display.\n• Records can be entered in one language and rendered in another.',
  },
  {
    title: 'Does it handle Old and New calendar systems?',
    body: 'Yes. Both the Julian (Old) and Revised Julian (New) calendars are supported. Feast-day and commemoration dates are resolved against the calendar your parish actually observes.',
  },
  {
    title: 'Can a diocese use one account for multiple parishes?',
    body: 'Yes. The Cathedral Pro plan includes multi-parish diocesan rollup, so chancery staff can compare record activity and data quality across every parish from a single dashboard while each parish keeps its own records.',
  },
  {
    title: 'How does the pricing work?',
    body: '• A one-time digitization fee for your existing historic books.\n• A monthly hosting subscription for the living sacramental registry.\n• Plans scale by page volume and the number of parishes covered.',
  },
  {
    title: 'How long does setup take?',
    body: 'A parish can begin entering new records the same day. Digitizing an existing archive depends on its size — most parishes complete their historical backlog within a few weeks of sending their books.',
  },
  {
    title: 'Is my parish data secure?',
    body: 'Records are stored in per-parish isolated databases with encrypted backups. Access is role-scoped, so clergy, parish secretaries, and diocesan staff each see only what their role permits.',
  },
];

function featuresToBody(caption, features) {
  return `${caption}\n\n${features.map((f) => `• ${f}`).join('\n')}`;
}

/** Ignores archived/empty test scaffolding so this stays re-runnable without manual cleanup. */
async function campaignExists(pool, pageType) {
  const [rows] = await pool.query(
    "SELECT id FROM latest_news_campaigns WHERE page_type = ? AND status != 'archived' LIMIT 1",
    [pageType],
  );
  return rows[0]?.id || null;
}

async function createCampaign(pool, { title, slug, pageType, summary }) {
  const [result] = await pool.query(
    `INSERT INTO latest_news_campaigns (
      title, slug, status, page_type, summary, timezone, publish_mode,
      rotation_enabled, rotation_interval_seconds, display_priority,
      show_on_homepage, show_in_parish_portal, created_by, updated_by
    ) VALUES (?, ?, 'draft', ?, ?, 'America/New_York', 'manual', 0, 8, 0, 0, 0, NULL, NULL)`,
    [title, slug, pageType, summary || null],
  );
  return result.insertId;
}

async function createItem(pool, campaignId, { title, subtitle, body, cta_label, cta_url, layout_type, component_config, sortOrder }) {
  const [result] = await pool.query(
    `INSERT INTO latest_news_items (
      campaign_id, title, subtitle, body, cta_label, cta_url, sort_order,
      status, layout_type, component_config, effects_config, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, '{}', 1)`,
    [
      campaignId, title || '', subtitle || null, body || null,
      cta_label || null, cta_url || null, sortOrder,
      layout_type, JSON.stringify(component_config || {}),
    ],
  );
  return result.insertId;
}

async function attachMedia(pool, { campaignId, itemId, omAssetId, fileUrl, altText, sortOrder }) {
  await pool.query(
    `INSERT INTO latest_news_media (campaign_id, item_id, file_url, om_asset_id, file_type, alt_text, sort_order, is_primary)
     VALUES (?, ?, ?, ?, 'image', ?, ?, ?)`,
    [campaignId, itemId || null, fileUrl, omAssetId, altText || null, sortOrder, sortOrder === 0 ? 1 : 0],
  );
}

/** Builds the same snapshot shape loadCampaignById()/serializeCampaign() produce, then publishes it. */
async function publishCampaign(pool, campaignId) {
  const [[campaign]] = await pool.query('SELECT * FROM latest_news_campaigns WHERE id = ?', [campaignId]);
  const [items] = await pool.query('SELECT * FROM latest_news_items WHERE campaign_id = ? ORDER BY sort_order ASC, id ASC', [campaignId]);
  const [media] = await pool.query('SELECT * FROM latest_news_media WHERE campaign_id = ? ORDER BY sort_order ASC, id ASC', [campaignId]);

  const mediaByItem = new Map();
  const campaignMedia = [];
  for (const m of media) {
    if (m.item_id) {
      if (!mediaByItem.has(m.item_id)) mediaByItem.set(m.item_id, []);
      mediaByItem.get(m.item_id).push(serializeMedia(m));
    } else {
      campaignMedia.push(serializeMedia(m));
    }
  }

  const snapshot = {
    id: campaign.id,
    title: campaign.title,
    slug: campaign.slug,
    page_type: campaign.page_type,
    published_version_id: null,
    summary: campaign.summary,
    visibility_start_at: campaign.visibility_start_at,
    visibility_end_at: campaign.visibility_end_at,
    timezone: campaign.timezone,
    publish_mode: campaign.publish_mode,
    rotation_enabled: !!campaign.rotation_enabled,
    rotation_interval_seconds: campaign.rotation_interval_seconds,
    display_priority: campaign.display_priority,
    show_on_homepage: !!campaign.show_on_homepage,
    show_in_parish_portal: !!campaign.show_in_parish_portal,
    items: items.map((item) => serializeItem({ ...item, media: mediaByItem.get(item.id) || [] })),
    media: campaignMedia,
  };

  const [versionResult] = await pool.query(
    `INSERT INTO latest_news_page_versions (campaign_id, label, snapshot, status, created_by)
     VALUES (?, 'Initial ingest from hardcoded content', ?, 'published', NULL)`,
    [campaignId, JSON.stringify(snapshot)],
  );
  await pool.query(
    `UPDATE latest_news_page_versions SET published_at = NOW() WHERE id = ?`,
    [versionResult.insertId],
  );
  await pool.query(
    `UPDATE latest_news_campaigns SET published_version_id = ?, status = 'live' WHERE id = ?`,
    [versionResult.insertId, campaignId],
  );
}

function serializeMedia(row) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    item_id: row.item_id,
    file_url: row.file_url,
    om_asset_id: row.om_asset_id || null,
    file_type: row.file_type,
    alt_text: row.alt_text,
    caption: row.caption,
    credit: row.credit,
    sort_order: row.sort_order,
    is_primary: !!row.is_primary,
    created_at: row.created_at,
  };
}

function serializeItem(row) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    title: row.title,
    subtitle: row.subtitle,
    body: row.body,
    excerpt: row.excerpt,
    cta_label: row.cta_label,
    cta_url: row.cta_url,
    sort_order: row.sort_order,
    status: row.status,
    layout_type: row.layout_type,
    component_config: typeof row.component_config === 'string' ? JSON.parse(row.component_config || '{}') : (row.component_config || {}),
    effects_config: typeof row.effects_config === 'string' ? JSON.parse(row.effects_config || '{}') : (row.effects_config || {}),
    active: !!row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    media: row.media || [],
  };
}

async function seedPricing(pool) {
  if (await campaignExists(pool, 'pricing')) {
    console.log('[seed] pricing already has a campaign — skipping');
    return;
  }
  const campaignId = await createCampaign(pool, {
    title: 'Flexible plans designed to scale',
    slug: 'pricing',
    pageType: 'pricing',
    summary: 'From small rural parishes to cathedral archives — one-time digitization for your historic books, plus affordable monthly hosting for a living sacramental registry.',
  });
  let sortOrder = 0;
  for (const plan of PLANS) {
    await createItem(pool, campaignId, {
      title: plan.title,
      subtitle: plan.subtitle,
      body: featuresToBody(plan.caption, plan.features),
      cta_label: plan.cta_label,
      cta_url: plan.cta_url,
      layout_type: 'card',
      sortOrder: sortOrder++,
    });
  }
  await publishCampaign(pool, campaignId);
  console.log(`[seed] pricing campaign ${campaignId} created + published with ${PLANS.length} items`);
}

async function seedFaq(pool) {
  if (await campaignExists(pool, 'faq')) {
    console.log('[seed] faq already has a campaign — skipping');
    return;
  }
  const campaignId = await createCampaign(pool, {
    title: 'We’ve got the answers',
    slug: 'faq',
    pageType: 'faq',
    summary: null,
  });
  let sortOrder = 0;
  for (const faq of FAQS) {
    await createItem(pool, campaignId, {
      title: faq.title,
      body: faq.body,
      layout_type: 'card',
      sortOrder: sortOrder++,
    });
  }
  await publishCampaign(pool, campaignId);
  console.log(`[seed] faq campaign ${campaignId} created + published with ${FAQS.length} items`);
}

async function seedRecords(pool) {
  if (await campaignExists(pool, 'records')) {
    console.log('[seed] records already has a campaign — skipping');
    return;
  }
  const campaignId = await createCampaign(pool, {
    title: 'Large bundle of records',
    slug: 'records',
    pageType: 'records',
    summary: 'Orthodox Metrics handles the complete sacramental lifecycle — from digitizing century-old handwritten ledgers to generating official certificates on demand.',
  });
  const itemId = await createItem(pool, campaignId, {
    layout_type: 'carousel',
    component_config: { slidesToShow: 1, autoplay: true, loop: true },
    sortOrder: 0,
  });

  let sortOrder = 0;
  let imported = 0;
  for (const image of RECORDS_IMAGES) {
    const absPath = path.join(RECORDS_IMAGES_DIR, image.file);
    const urlPath = `/assets/images/home/records/${image.file}`;
    const assetId = await registerOmAssetFromLegacyFile({
      absPath,
      urlPath,
      legacySource: 'home_records_strip',
      legacyId: image.file,
      scope: 'site',
      category: 'marketing',
      name: image.file.replace(/\.\w+$/, ''),
      productTags: ['om', 'home', 'records'],
    });
    if (!assetId) {
      console.warn(`[seed] could not import ${image.file} — skipping`);
      continue;
    }
    await attachMedia(pool, {
      campaignId,
      itemId,
      omAssetId: assetId,
      fileUrl: `/api/assets/${assetId}/file`,
      altText: image.alt,
      sortOrder: sortOrder++,
    });
    imported += 1;
  }

  await publishCampaign(pool, campaignId);
  console.log(`[seed] records campaign ${campaignId} created + published with ${imported}/${RECORDS_IMAGES.length} images imported`);
}

async function main() {
  const pool = getAppPool();
  await seedPricing(pool);
  await seedFaq(pool);
  await seedRecords(pool);
  console.log('[seed] done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
