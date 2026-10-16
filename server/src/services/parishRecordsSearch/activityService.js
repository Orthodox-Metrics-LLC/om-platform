/**
 * Record activity search using history tables + optional row timestamps.
 * Sacramental event dates are NEVER used as activity timestamps.
 */

const { RECORD_TYPES } = require('./recordFieldRegistry');
const { getTableColumns, notDeletedClause } = require('./schemaSupport');
const { getChurchTimezone, resolveRelativeWindow } = require('./churchTimezone');
const { formatDateOnlyIso, formatParishDateDisplay, formatParishDateTimeDisplay } = require('./dateDisplay');

const HISTORY_TYPE_MAP = {
  created: ['create'],
  modified: ['update', 'merge'],
  imported: ['import', 'ocr'],
  verified: ['update'], // filtered further by description/status when possible
  deleted: ['delete'],
  restored: ['restore'],
  any_activity: ['create', 'update', 'import', 'ocr', 'merge', 'delete', 'restore'],
};

const DEFAULT_GENERAL = ['created', 'imported'];

async function historyTableExists(pool, table) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}

function openPath(type, id, churchId) {
  return `/portal/records?type=${encodeURIComponent(type)}&recordId=${encodeURIComponent(id)}&churchId=${encodeURIComponent(churchId)}`;
}

function mapHistoryTypeToActivity(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'create') return 'created';
  if (t === 'update' || t === 'merge') return 'modified';
  if (t === 'import' || t === 'ocr') return 'imported';
  if (t === 'delete') return 'deleted';
  if (t === 'restore') return 'restored';
  return t || 'any_activity';
}

async function executeActivitySearch(pool, ast, churchId) {
  const activity = ast.activity || {};
  let eventTypes = Array.isArray(activity.eventTypes) && activity.eventTypes.length
    ? activity.eventTypes.map(String)
    : [...DEFAULT_GENERAL];
  if (eventTypes.includes('any_activity')) eventTypes = ['any_activity'];

  const timeZone = await getChurchTimezone(churchId);
  const window = resolveRelativeWindow(activity.relativeWindow || { amount: 24, unit: 'hours' }, timeZone);
  const includeDeleted = eventTypes.includes('deleted') || eventTypes.includes('restored') || eventTypes.includes('any_activity');

  const historyTypes = new Set();
  for (const et of eventTypes) {
    for (const ht of (HISTORY_TYPE_MAP[et] || [])) historyTypes.add(ht);
  }
  if (!historyTypes.size) {
    return {
      rows: [],
      total: 0,
      unsupported: null,
      window,
      interpretation: 'No activity event types selected',
    };
  }

  const rows = [];
  const gaps = [];

  for (const type of ast.scope.recordTypes) {
    const cfg = RECORD_TYPES[type];
    const historyTable = cfg.table.replace('_records', '_history');
    const hasHistory = await historyTableExists(pool, historyTable);
    const cols = await getTableColumns(pool, cfg.table);
    const deletedClause = includeDeleted ? '1=1' : notDeletedClause(cols, 'r');

    if (hasHistory) {
      const htList = [...historyTypes];
      const sql = `
        SELECT
          '${type}' AS record_type,
          h.record_id AS source_record_id,
          h.type AS history_type,
          h.timestamp AS activity_at,
          h.actor_user_id AS performed_by,
          h.description AS activity_description,
          h.source AS activity_source,
          ${cfg.primaryNameSql} AS primary_name,
          r.\`${cfg.canonicalEventDate}\` AS canonical_event_date,
          ${cfg.statusField && cols.has(cfg.statusField) ? `r.\`${cfg.statusField}\`` : 'NULL'} AS status
        FROM \`${historyTable}\` h
        INNER JOIN \`${cfg.table}\` r ON r.id = h.record_id
        WHERE h.type IN (${htList.map(() => '?').join(',')})
          AND h.timestamp >= ? AND h.timestamp <= ?
          AND (${deletedClause})
        ORDER BY h.timestamp DESC
        LIMIT 2000
      `;
      const params = [...htList, window.startUtc, window.endUtc];
      try {
        const [found] = await pool.query(sql, params);
        for (const row of found) {
          // verified: prefer rows whose description mentions verify OR status Verified after update
          if (eventTypes.includes('verified') && !eventTypes.includes('any_activity') && eventTypes.length === 1) {
            const desc = String(row.activity_description || '').toLowerCase();
            if (!desc.includes('verif') && String(row.status || '') !== 'Verified') continue;
          }
          rows.push({
            recordType: type,
            sourceRecordId: row.source_record_id,
            primaryName: (row.primary_name || '').trim() || '—',
            canonicalEventDate: formatDateOnlyIso(row.canonical_event_date),
            canonicalEventDateDisplay: formatParishDateDisplay(row.canonical_event_date),
            activityType: mapHistoryTypeToActivity(row.history_type),
            activityAt: row.activity_at,
            activityAtDisplay: formatParishDateTimeDisplay(row.activity_at),
            performedBy: row.performed_by || null,
            importOrOcrBatch: row.activity_source || null,
            status: row.status || null,
            churchId,
            openPath: openPath(type, row.source_record_id, churchId),
          });
        }
      } catch (err) {
        gaps.push(`${type}: history query failed (${err.message})`);
      }
    } else if (cols.has('created_at') || cols.has('updated_at')) {
      // Fallback: row timestamps only for created/modified
      const useCreated = eventTypes.some((e) => ['created', 'imported', 'any_activity'].includes(e)) && cols.has('created_at');
      const useUpdated = eventTypes.some((e) => ['modified', 'any_activity'].includes(e)) && cols.has('updated_at');
      if (!useCreated && !useUpdated) {
        gaps.push(`${type}: no history table and no matching timestamp columns`);
        continue;
      }
      const parts = [];
      if (useCreated) parts.push('(r.created_at >= ? AND r.created_at <= ?)');
      if (useUpdated) parts.push('(r.updated_at >= ? AND r.updated_at <= ?)');
      const params = [];
      if (useCreated) params.push(window.startUtc, window.endUtc);
      if (useUpdated) params.push(window.startUtc, window.endUtc);
      const sql = `
        SELECT
          '${type}' AS record_type,
          r.id AS source_record_id,
          ${cfg.primaryNameSql} AS primary_name,
          r.\`${cfg.canonicalEventDate}\` AS canonical_event_date,
          ${cfg.statusField && cols.has(cfg.statusField) ? `r.\`${cfg.statusField}\`` : 'NULL'} AS status,
          r.created_at AS created_at,
          ${cols.has('updated_at') ? 'r.updated_at' : 'NULL'} AS updated_at
        FROM \`${cfg.table}\` r
        WHERE (${parts.join(' OR ')}) AND (${includeDeleted ? '1=1' : notDeletedClause(cols, 'r')})
        ORDER BY COALESCE(r.updated_at, r.created_at) DESC
        LIMIT 2000
      `;
      try {
        const [found] = await pool.query(sql, params);
        for (const row of found) {
          let activityType = 'created';
          let activityAt = row.created_at;
          if (useUpdated && row.updated_at && (!row.created_at || new Date(row.updated_at) > new Date(row.created_at))) {
            if (eventTypes.includes('modified') || eventTypes.includes('any_activity')) {
              activityType = 'modified';
              activityAt = row.updated_at;
            }
          }
          rows.push({
            recordType: type,
            sourceRecordId: row.source_record_id,
            primaryName: (row.primary_name || '').trim() || '—',
            canonicalEventDate: formatDateOnlyIso(row.canonical_event_date),
            canonicalEventDateDisplay: formatParishDateDisplay(row.canonical_event_date),
            activityType,
            activityAt,
            activityAtDisplay: formatParishDateTimeDisplay(activityAt),
            performedBy: null,
            importOrOcrBatch: null,
            status: row.status || null,
            churchId,
            openPath: openPath(type, row.source_record_id, churchId),
          });
        }
      } catch (err) {
        gaps.push(`${type}: timestamp fallback failed (${err.message})`);
      }
    } else {
      gaps.push(`${type}: no reliable activity source (no *_history and no created_at/updated_at)`);
    }
  }

  rows.sort((a, b) => new Date(b.activityAt) - new Date(a.activityAt));
  const total = rows.length;
  const offset = Number(ast.offset || 0);
  const limit = Number(ast.limit || 50);
  const page = rows.slice(offset, offset + limit);

  let unsupported = null;
  if (!total && gaps.length === ast.scope.recordTypes.length) {
    unsupported = {
      code: 'activity_source_unavailable',
      message: 'No reliable record activity timestamps are available for this church. Sacramental event dates are not used as activity times. A governed activity mechanism or history backfill is required.',
      gaps,
    };
  }

  return {
    rows: page,
    total,
    unsupported,
    window: {
      startUtc: window.startUtc.toISOString(),
      endUtc: window.endUtc.toISOString(),
      label: window.label,
      timeZone: window.timeZone,
      relative: activity.relativeWindow || { amount: 24, unit: 'hours' },
    },
    gaps,
  };
}

module.exports = {
  executeActivitySearch,
  HISTORY_TYPE_MAP,
  DEFAULT_GENERAL,
  mapHistoryTypeToActivity,
};
