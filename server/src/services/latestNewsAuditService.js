/**
 * Latest News publisher audit log (platform DB).
 */

const { getAppPool } = require('../config/db');

/**
 * @param {string} action
 * @param {object} opts
 * @param {number|null} [opts.campaignId]
 * @param {number|null} [opts.itemId]
 * @param {number|null} [opts.userId]
 * @param {object} [opts.changes]
 */
async function logLatestNewsAudit(action, { campaignId = null, itemId = null, userId = null, changes = {} } = {}) {
  try {
    const pool = getAppPool();
    await pool.query(
      'INSERT INTO latest_news_audit (campaign_id, item_id, action, changed_by, changes) VALUES (?, ?, ?, ?, ?)',
      [campaignId, itemId, action, userId, JSON.stringify(changes)]
    );
  } catch (err) {
    console.error('[latest-news-audit]', err.message);
  }
}

module.exports = { logLatestNewsAudit };
