'use strict';

/**
 * Parish profile-banner library, stored in each tenant DB (om_church_##).
 * Clergy publish up to 12 images; members of that church choose one.
 */

const { getAppPool, getTenantPool } = require('../config/db');

const MAX_BANNERS = 12;

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS church_profile_banners (
  id INT(11) NOT NULL AUTO_INCREMENT,
  church_id INT(11) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  sort_order INT(11) NOT NULL DEFAULT 0,
  uploaded_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_church_profile_banner_url (church_id, file_url),
  KEY idx_church_profile_banners_order (church_id, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

async function ensureTable(pool) {
  await pool.query(CREATE_SQL);
}

function shape(row) {
  return { id: row.id, url: row.file_url, sort_order: row.sort_order, created_at: row.created_at };
}

async function listBanners(pool, churchId) {
  await ensureTable(pool);
  const [rows] = await pool.query(
    'SELECT id, file_url, sort_order, created_at FROM church_profile_banners WHERE church_id = ? ORDER BY sort_order ASC, id ASC',
    [churchId]
  );
  return rows.map(shape);
}

function isImageRow(mime, fileType) {
  const mimeText = String(mime || '').toLowerCase();
  const typeText = String(fileType || '').toLowerCase();
  if (mimeText.startsWith('video/') || typeText === 'video' || mimeText.includes('pdf')) return false;
  if (mimeText.startsWith('image/')) return true;
  return ['image', 'logo', 'icon', 'jpeg', 'jpg', 'png', 'gif', 'webp'].includes(typeText);
}

async function lookupSocialImage(db, filename) {
  const [[row]] = await db.query(
    'SELECT mime_type, file_type FROM social_media WHERE filename = ? LIMIT 1',
    [filename]
  );
  if (!row) throw fail(400, 'That image is not in this parish library');
  if (!isImageRow(row.mime_type, row.file_type)) throw fail(400, 'Profile banners must be images');
}

/** file_url must already live in this church's social media or asset library. */
async function assertChurchImage(pool, churchId, fileUrl, { allowPlatform = false } = {}) {
  const url = String(fileUrl || '');
  const media = url.match(new RegExp(`^/api/om/media/church_${churchId}/([\\w.-]+)$`));
  if (media) {
    await lookupSocialImage(pool, media[1]);
    return url;
  }

  if (allowPlatform) {
    const platform = url.match(/^\/api\/om\/media\/platform\/([\w.-]+)$/);
    if (platform) {
      await lookupSocialImage(getAppPool(), platform[1]);
      return url;
    }
  }

  const asset = url.match(/^\/api\/assets\/(\d+)\/file$/);
  if (asset) {
    const [[row]] = await getAppPool().query(
      'SELECT church_id, mime_type, file_type FROM om_assets WHERE id = ? LIMIT 1',
      [Number(asset[1])]
    );
    if (!row || Number(row.church_id) !== Number(churchId)) {
      throw fail(400, 'Choose an image that belongs to this parish');
    }
    if (!isImageRow(row.mime_type, row.file_type)) throw fail(400, 'Profile banners must be images');
    return url;
  }

  throw fail(400, 'Choose an image from this parish');
}

async function addBanner(pool, churchId, userId, fileUrl, options = {}) {
  await ensureTable(pool);
  const url = await assertChurchImage(pool, churchId, fileUrl, options);
  try {
    const [result] = await pool.query(
      `INSERT INTO church_profile_banners (church_id, file_url, sort_order, uploaded_by)
       SELECT src.church_id, src.file_url, src.sort_order, src.uploaded_by FROM (
         SELECT ? AS church_id, ? AS file_url, COALESCE(MAX(sort_order), -1) + 1 AS sort_order, ? AS uploaded_by
           FROM church_profile_banners
          WHERE church_id = ?
         HAVING COUNT(*) < ?
       ) AS src`,
      [churchId, url, userId, churchId, MAX_BANNERS]
    );
    if (!result.affectedRows) throw fail(409, `A parish can publish at most ${MAX_BANNERS} profile banners`);
  } catch (err) {
    if (err.status) throw err;
    if (err.code === 'ER_DUP_ENTRY') throw fail(409, 'That banner is already in the parish library');
    throw err;
  }
  return listBanners(pool, churchId);
}

async function removeBanner(pool, churchId, bannerId) {
  await ensureTable(pool);
  const [result] = await pool.query(
    'DELETE FROM church_profile_banners WHERE id = ? AND church_id = ?',
    [bannerId, churchId]
  );
  if (!result.affectedRows) throw fail(404, 'Banner not found');
  return listBanners(pool, churchId);
}

/** Banner URL a member of this church is allowed to apply to their own profile. */
async function bannerUrlForMember(churchId, bannerId) {
  const pool = getTenantPool(churchId);
  await ensureTable(pool);
  const [[row]] = await pool.query(
    'SELECT file_url FROM church_profile_banners WHERE id = ? AND church_id = ? LIMIT 1',
    [bannerId, churchId]
  );
  return row ? row.file_url : null;
}

module.exports = {
  MAX_BANNERS,
  ensureTable,
  listBanners,
  addBanner,
  removeBanner,
  bannerUrlForMember,
};
