/**
 * Normalize SQL rows into API result DTOs with deep-link friendly ids.
 * Storage/API filter values stay ISO; display fields use MM/DD/YYYY.
 */

const { formatDateOnlyIso, formatParishDateDisplay } = require('./dateDisplay');

function formatDateOnly(v) {
  return formatDateOnlyIso(v);
}

function normalizeRow(row, churchId) {
  const eventIso = formatDateOnly(row.canonical_event_date);
  return {
    recordType: row.record_type,
    primaryName: (row.primary_name || '').trim() || '—',
    canonicalEventDate: eventIso,
    canonicalEventDateDisplay: formatParishDateDisplay(row.canonical_event_date),
    clergy: row.clergy || null,
    location: row.location || null,
    status: row.status || null,
    sourceRecordId: row.source_record_id,
    deletedAt: row.deleted_at ? (row.deleted_at instanceof Date ? row.deleted_at.toISOString() : String(row.deleted_at)) : null,
    churchId,
    matchLabel: row.match_label || null,
    matchConfidence: row.match_confidence != null ? Number(row.match_confidence) : null,
    activityType: row.activity_type || row.activityType || null,
    activityAt: row.activity_at || row.activityAt || null,
    activityAtDisplay: row.activityAtDisplay || null,
    performedBy: row.performed_by || row.performedBy || null,
    openPath: `/portal/records?type=${encodeURIComponent(row.record_type)}&recordId=${encodeURIComponent(row.source_record_id)}&churchId=${encodeURIComponent(churchId)}`,
  };
}

function normalizeRows(rows, churchId) {
  return (rows || []).map((r) => normalizeRow(r, churchId));
}

function normalizeAggregateRows(rows) {
  return (rows || []).map((r) => ({
    year: r.year != null ? Number(r.year) : null,
    recordType: r.record_type,
    count: Number(r.count) || 0,
  }));
}

module.exports = { normalizeRow, normalizeRows, normalizeAggregateRows, formatDateOnly };
