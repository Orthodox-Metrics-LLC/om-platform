#!/usr/bin/env node
/**
 * One-time content update: sets the real monthly price + onboarding fee
 * (Self Service vs OM Service) on the 3 pricing cards ingested by
 * seed-public-pages.js, then republishes the pricing campaign so the
 * public site picks it up immediately.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { getAppPool } = require('../config/db');

const UPDATES = [
  {
    title: 'Parish Essentials',
    subtitle: '$8.99/mo',
    onboarding: {
      self_service_fee: 1250, self_service_cap: 1000, self_service_additional_fee: 550, self_service_additional_block: 300,
      om_service_fee: 2500, om_service_cap: 1500,
    },
  },
  {
    title: 'Diocesan Standard',
    subtitle: '$13.99/mo',
    onboarding: {
      self_service_fee: 1600, self_service_cap: 1500, self_service_additional_fee: 500, self_service_additional_block: 300,
      om_service_fee: 3200, om_service_cap: 2000,
    },
  },
  {
    title: 'Cathedral Pro',
    subtitle: '$24.99/mo',
    onboarding: {
      self_service_fee: 3500, self_service_cap: 1800, self_service_additional_fee: 450, self_service_additional_block: 300,
      om_service_fee: 7000, om_service_cap: 2200,
    },
  },
];

function serializeMedia(row) {
  return {
    id: row.id, campaign_id: row.campaign_id, item_id: row.item_id, file_url: row.file_url,
    om_asset_id: row.om_asset_id || null, file_type: row.file_type, alt_text: row.alt_text,
    caption: row.caption, credit: row.credit, sort_order: row.sort_order, is_primary: !!row.is_primary,
    created_at: row.created_at,
  };
}

function serializeItem(row) {
  return {
    id: row.id, campaign_id: row.campaign_id, title: row.title, subtitle: row.subtitle, body: row.body,
    excerpt: row.excerpt, cta_label: row.cta_label, cta_url: row.cta_url, sort_order: row.sort_order,
    status: row.status, layout_type: row.layout_type,
    component_config: typeof row.component_config === 'string' ? JSON.parse(row.component_config || '{}') : (row.component_config || {}),
    effects_config: typeof row.effects_config === 'string' ? JSON.parse(row.effects_config || '{}') : (row.effects_config || {}),
    active: !!row.active, created_at: row.created_at, updated_at: row.updated_at, media: row.media || [],
  };
}

async function republish(pool, campaignId) {
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
    id: campaign.id, title: campaign.title, slug: campaign.slug, page_type: campaign.page_type,
    published_version_id: null, summary: campaign.summary, visibility_start_at: campaign.visibility_start_at,
    visibility_end_at: campaign.visibility_end_at, timezone: campaign.timezone, publish_mode: campaign.publish_mode,
    rotation_enabled: !!campaign.rotation_enabled, rotation_interval_seconds: campaign.rotation_interval_seconds,
    display_priority: campaign.display_priority, show_on_homepage: !!campaign.show_on_homepage,
    show_in_parish_portal: !!campaign.show_in_parish_portal,
    items: items.map((item) => serializeItem({ ...item, media: mediaByItem.get(item.id) || [] })),
    media: campaignMedia,
  };

  const [versionResult] = await pool.query(
    `INSERT INTO latest_news_page_versions (campaign_id, label, snapshot, status, created_by)
     VALUES (?, 'Add onboarding fee + updated prices', ?, 'published', NULL)`,
    [campaignId, JSON.stringify(snapshot)],
  );
  await pool.query(`UPDATE latest_news_page_versions SET published_at = NOW() WHERE id = ?`, [versionResult.insertId]);
  await pool.query(`UPDATE latest_news_campaigns SET published_version_id = ?, status = 'live' WHERE id = ?`, [versionResult.insertId, campaignId]);
}

async function main() {
  const pool = getAppPool();
  const [[campaign]] = await pool.query("SELECT id FROM latest_news_campaigns WHERE page_type = 'pricing' AND status != 'archived' LIMIT 1");
  if (!campaign) throw new Error('No live pricing campaign found');

  for (const update of UPDATES) {
    const [[item]] = await pool.query(
      'SELECT id, component_config FROM latest_news_items WHERE campaign_id = ? AND title = ?',
      [campaign.id, update.title],
    );
    if (!item) {
      console.warn(`[update] no item found for "${update.title}" — skipping`);
      continue;
    }
    const existingConfig = typeof item.component_config === 'string' ? JSON.parse(item.component_config || '{}') : (item.component_config || {});
    const nextConfig = { ...existingConfig, onboarding: update.onboarding };
    await pool.query(
      'UPDATE latest_news_items SET subtitle = ?, component_config = ? WHERE id = ?',
      [update.subtitle, JSON.stringify(nextConfig), item.id],
    );
    console.log(`[update] "${update.title}" -> ${update.subtitle}, onboarding fee set`);
  }

  await republish(pool, campaign.id);
  console.log(`[update] pricing campaign ${campaign.id} republished`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[update] FAILED:', err);
  process.exit(1);
});
