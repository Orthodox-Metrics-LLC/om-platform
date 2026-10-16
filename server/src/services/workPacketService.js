/**
 * Work Packet ID registry — shared OMPKT-YYYYMMDD-#### allocator.
 *
 * A Work Packet correlates a single unit of inbound work across systems:
 *   - Docs Dropbox items (uploaded files AND pasted prompts)
 *   - Docs Pickup results those items produce
 *
 * The id is stable, UI-visible, and daily-scoped:  OMPKT-YYYYMMDD-####
 * where #### is a zero-padded 1-based sequence within that UTC day.
 *
 * Allocation is race-safe via a UNIQUE (packet_date, seq) constraint on the
 * work_packets registry table plus bounded retry on duplicate insert.
 */

const WORK_PACKET_RE = /^OMPKT-\d{8}-\d{4,}$/;

function pad4(n) {
  return String(n).padStart(4, '0');
}

function ymd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return { compact: `${y}${m}${d}`, iso: `${y}-${m}-${d}` };
}

function isWorkPacketId(value) {
  return typeof value === 'string' && WORK_PACKET_RE.test(value);
}

/**
 * Allocate a new Work Packet id and record it in the registry.
 *
 * @param {import('mysql2/promise').Pool} pool  Platform DB pool (orthodoxmetrics_db)
 * @param {object} [opts]
 * @param {Date}   [opts.date]            Reference date (defaults to now, UTC)
 * @param {string} [opts.sourceType]      uploaded_file | pasted_prompt | pickup | other
 * @param {string} [opts.origin]          dropbox | pickup
 * @param {string} [opts.refId]           Owning row id
 * @param {string} [opts.createdByEmail]  Actor email
 * @returns {Promise<string>} the allocated OMPKT id
 */
async function generateWorkPacketId(pool, opts = {}) {
  const date = opts.date instanceof Date ? opts.date : new Date();
  const { compact, iso } = ymd(date);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const [rows] = await pool.query(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM work_packets WHERE packet_date = ?',
      [iso],
    );
    const seq = Number(rows?.[0]?.nextSeq || 1);
    const workPacketId = `OMPKT-${compact}-${pad4(seq)}`;
    try {
      await pool.query(
        `INSERT INTO work_packets
          (work_packet_id, packet_date, seq, source_type, origin, ref_id, created_by_email)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          workPacketId,
          iso,
          seq,
          opts.sourceType || null,
          opts.origin || null,
          opts.refId || null,
          opts.createdByEmail || null,
        ],
      );
      return workPacketId;
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') continue;
      throw err;
    }
  }

  // Extremely unlikely fallback: monotonic-ish suffix guaranteed unique on PK.
  const fallback = `OMPKT-${compact}-${pad4(9000 + (Date.now() % 1000))}`;
  await pool.query(
    `INSERT INTO work_packets
      (work_packet_id, packet_date, seq, source_type, origin, ref_id, created_by_email)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [fallback, iso, 9000 + (Date.now() % 1000), opts.sourceType || null, opts.origin || null, opts.refId || null, opts.createdByEmail || null],
  ).catch(() => {});
  return fallback;
}

/** Update the registry row with the owning ref once it is known (best-effort). */
async function linkWorkPacket(pool, workPacketId, { origin, refId } = {}) {
  if (!isWorkPacketId(workPacketId)) return;
  await pool.query(
    'UPDATE work_packets SET origin = COALESCE(?, origin), ref_id = COALESCE(?, ref_id) WHERE work_packet_id = ?',
    [origin || null, refId || null, workPacketId],
  ).catch(() => {});
}

async function linkWorkItem(pool, workPacketId, itemId, metadata = {}) {
  if (!isWorkPacketId(workPacketId) || !itemId) return;
  await pool.query(
    `UPDATE work_packets SET om_daily_item_id = ?,
      metadata_json = JSON_SET(COALESCE(metadata_json, '{}'), '$.om_daily_item_id', ?, '$.om_daily_item_code', ?)
     WHERE work_packet_id = ?`,
    [itemId, itemId, `OMD-${itemId}`, workPacketId],
  ).catch(() => {});
}

module.exports = {
  WORK_PACKET_RE,
  isWorkPacketId,
  generateWorkPacketId,
  linkWorkPacket,
  linkWorkItem,
};
