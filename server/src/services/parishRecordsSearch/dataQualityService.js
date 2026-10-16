/**
 * Data-quality search for parish record dates.
 * Original input-format conflicts require raw OCR/import values — never invent them from DATE columns.
 */

const { RECORD_TYPES } = require('./recordFieldRegistry');
const { getTableColumns, notDeletedClause } = require('./schemaSupport');
const { formatDateOnlyIso, formatParishDateDisplay, parseDateOnlyParts, isValidYmd } = require('./dateDisplay');

const SUPPORTED_RULES = new Set([
  'invalid_date',
  'ambiguous_date',
  'missing_required_date',
  'event_date_in_future',
  'birth_after_reception',
  'death_after_burial',
  'implausible_year',
  'inconsistent_raw_date_format',
  'raw_value_differs_from_normalized_value',
]);

const RAW_DEPENDENT_RULES = new Set([
  'inconsistent_raw_date_format',
  'ambiguous_date',
  'raw_value_differs_from_normalized_value',
  'invalid_date', // invalid raw — DATE columns that stored successfully are valid
]);

function openPath(type, id, churchId) {
  return `/portal/records?type=${encodeURIComponent(type)}&recordId=${encodeURIComponent(id)}&churchId=${encodeURIComponent(churchId)}`;
}

function todayIsoUtc() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function looksAmbiguousRaw(raw) {
  if (raw == null) return false;
  const s = String(raw).trim();
  // 02/03/2022 style — month/day ambiguous without locale
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [a, b] = s.split('/').map(Number);
    return a <= 12 && b <= 12 && a !== b;
  }
  return false;
}

async function rawSourceAvailable(pool) {
  const candidates = ['ocr_draft_records', 'ocr_fused_drafts', 'ocr_feeder_artifacts'];
  const available = [];
  for (const table of candidates) {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
      [table],
    );
    if (rows.length) available.push(table);
  }
  return available;
}

async function scanRawDateIssues(pool, recordTypes, rules, churchId, limit) {
  const issues = [];
  const sources = await rawSourceAvailable(pool);
  if (!sources.length) return { issues, unsupported: true };

  // Best-effort: inspect ocr_draft_records.record_data JSON for date-like strings
  if (sources.includes('ocr_draft_records')) {
    try {
      const [rows] = await pool.query(
        `SELECT id, record_type, imported_record_id, record_data, status
         FROM ocr_draft_records
         WHERE record_type IN (${recordTypes.map(() => '?').join(',')})
         ORDER BY id DESC
         LIMIT 500`,
        recordTypes,
      );
      for (const row of rows) {
        let data = row.record_data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch { data = {}; }
        }
        if (!data || typeof data !== 'object') continue;
        for (const [field, raw] of Object.entries(data)) {
          if (!/date|mdate|burial|birth|reception|deceased/i.test(field)) continue;
          if (raw == null || raw === '') continue;
          const rawStr = String(raw);
          const parts = parseDateOnlyParts(rawStr);
          const type = String(row.record_type || '').toLowerCase();
          if (!RECORD_TYPES[type]) continue;

          if (rules.includes('invalid_date') && parts?.invalid) {
            issues.push({
              recordType: type,
              sourceRecordId: row.imported_record_id || row.id,
              primaryName: '—',
              field,
              storedValue: null,
              displayValue: formatParishDateDisplay(null),
              rawSourceValue: rawStr,
              issue: 'invalid_date',
              explanation: 'Raw OCR/import date value could not be parsed',
              sourceType: 'ocr_draft_records',
              openPath: row.imported_record_id ? openPath(type, row.imported_record_id, churchId) : null,
            });
          }
          if (rules.includes('ambiguous_date') && looksAmbiguousRaw(rawStr)) {
            issues.push({
              recordType: type,
              sourceRecordId: row.imported_record_id || row.id,
              primaryName: '—',
              field,
              storedValue: formatDateOnlyIso(rawStr),
              displayValue: formatParishDateDisplay(rawStr),
              rawSourceValue: rawStr,
              issue: 'ambiguous_date',
              explanation: 'Month/day order is ambiguous in the raw value; human confirmation required before correction',
              sourceType: 'ocr_draft_records',
              openPath: row.imported_record_id ? openPath(type, row.imported_record_id, churchId) : null,
            });
          }
          if (rules.includes('inconsistent_raw_date_format') || rules.includes('raw_value_differs_from_normalized_value')) {
            const iso = formatDateOnlyIso(rawStr);
            if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(rawStr.trim()) && /\d/.test(rawStr)) {
              // Multiple raw format styles among drafts for same normalized day
              issues.push({
                recordType: type,
                sourceRecordId: row.imported_record_id || row.id,
                primaryName: '—',
                field,
                storedValue: iso,
                displayValue: formatParishDateDisplay(iso),
                rawSourceValue: rawStr,
                issue: rules.includes('raw_value_differs_from_normalized_value')
                  ? 'raw_value_differs_from_normalized_value'
                  : 'inconsistent_raw_date_format',
                explanation: 'Raw import/OCR date text differs from normalized DATE storage form',
                sourceType: 'ocr_draft_records',
                openPath: row.imported_record_id ? openPath(type, row.imported_record_id, churchId) : null,
              });
            }
          }
          if (issues.length >= limit) return { issues, unsupported: false };
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  return { issues, unsupported: false };
}

async function executeDataQualitySearch(pool, ast, churchId) {
  const rules = (ast.rules || []).map((r) => (typeof r === 'string' ? r : r.rule)).filter(Boolean);
  const unknown = rules.filter((r) => !SUPPORTED_RULES.has(r));
  if (unknown.length) {
    const err = new Error(`Unsupported data-quality rule(s): ${unknown.join(', ')}`);
    err.status = 400;
    err.code = 'unsupported_query';
    throw err;
  }
  if (!rules.length) {
    const err = new Error('At least one data-quality rule is required');
    err.status = 400;
    err.code = 'invalid_ast';
    throw err;
  }

  const needsRaw = rules.some((r) => RAW_DEPENDENT_RULES.has(r));
  const structuralRules = rules.filter((r) => !RAW_DEPENDENT_RULES.has(r) || r === 'invalid_date');
  // invalid_date on normalized DATE columns: only meaningful if value somehow not a date — rare; skip false positives
  const logicalRules = rules.filter((r) => [
    'missing_required_date', 'event_date_in_future', 'birth_after_reception',
    'death_after_burial', 'implausible_year',
  ].includes(r));

  const issues = [];
  let unsupportedMessage = null;

  if (needsRaw && rules.every((r) => RAW_DEPENDENT_RULES.has(r))) {
    const raw = await scanRawDateIssues(pool, ast.scope.recordTypes, rules, churchId, 500);
    if (raw.unsupported) {
      return {
        rows: [],
        total: 0,
        unsupported: {
          code: 'raw_date_source_unavailable',
          message: 'Original date format cannot be determined because these records contain normalized DATE values and no raw import value is available.',
        },
        rules,
      };
    }
    issues.push(...raw.issues);
  } else if (needsRaw) {
    const raw = await scanRawDateIssues(pool, ast.scope.recordTypes, rules, churchId, 500);
    if (raw.unsupported) {
      unsupportedMessage = 'Original date format cannot be determined because these records contain normalized DATE values and no raw import value is available. Structural date rules were still evaluated.';
    } else {
      issues.push(...raw.issues);
    }
  }

  const today = todayIsoUtc();
  for (const type of ast.scope.recordTypes) {
    if (!logicalRules.length && !structuralRules.includes('invalid_date')) continue;
    const cfg = RECORD_TYPES[type];
    const cols = await getTableColumns(pool, cfg.table);
    const [rows] = await pool.query(
      `SELECT * FROM \`${cfg.table}\` WHERE ${notDeletedClause(cols)} LIMIT 2000`,
    );
    for (const row of rows) {
      const primaryName = type === 'marriage'
        ? `${row.fname_groom || ''} ${row.lname_groom || ''} & ${row.fname_bride || ''} ${row.lname_bride || ''}`.trim()
        : `${row[cfg.personFields[0]] || ''} ${row[cfg.personFields[1]] || ''}`.trim();

      if (logicalRules.includes('missing_required_date')) {
        const event = row[cfg.canonicalEventDate];
        if (event == null || String(event).trim() === '') {
          issues.push({
            recordType: type, sourceRecordId: row.id, primaryName: primaryName || '—',
            field: cfg.canonicalEventDate, storedValue: null, displayValue: '—', rawSourceValue: null,
            issue: 'missing_required_date', explanation: 'Required sacramental event date is missing',
            sourceType: 'record', openPath: openPath(type, row.id, churchId),
          });
        }
      }
      if (logicalRules.includes('event_date_in_future')) {
        const eventIso = formatDateOnlyIso(row[cfg.canonicalEventDate]);
        if (eventIso && eventIso > today) {
          issues.push({
            recordType: type, sourceRecordId: row.id, primaryName: primaryName || '—',
            field: cfg.canonicalEventDate, storedValue: eventIso,
            displayValue: formatParishDateDisplay(eventIso), rawSourceValue: null,
            issue: 'event_date_in_future', explanation: 'Event date is in the future',
            sourceType: 'record', openPath: openPath(type, row.id, churchId),
          });
        }
      }
      if (logicalRules.includes('implausible_year')) {
        for (const field of [cfg.canonicalEventDate, ...(cfg.additionalDates || [])]) {
          const iso = formatDateOnlyIso(row[field]);
          if (!iso) continue;
          const y = Number(iso.slice(0, 4));
          if (y < 1800 || y > Number(today.slice(0, 4)) + 1) {
            issues.push({
              recordType: type, sourceRecordId: row.id, primaryName: primaryName || '—',
              field, storedValue: iso, displayValue: formatParishDateDisplay(iso), rawSourceValue: null,
              issue: 'implausible_year', explanation: `Year ${y} is outside the plausible parish-records range`,
              sourceType: 'record', openPath: openPath(type, row.id, churchId),
            });
          }
        }
      }
      if (type === 'baptism' && logicalRules.includes('birth_after_reception')) {
        const birth = formatDateOnlyIso(row.birth_date);
        const reception = formatDateOnlyIso(row.reception_date);
        if (birth && reception && birth > reception) {
          issues.push({
            recordType: type, sourceRecordId: row.id, primaryName: primaryName || '—',
            field: 'birth_date', storedValue: birth, displayValue: formatParishDateDisplay(birth),
            rawSourceValue: null, issue: 'birth_after_reception',
            explanation: `Birth date ${formatParishDateDisplay(birth)} is after reception date ${formatParishDateDisplay(reception)}`,
            sourceType: 'record', openPath: openPath(type, row.id, churchId),
          });
        }
      }
      if (type === 'funeral' && logicalRules.includes('death_after_burial')) {
        const death = formatDateOnlyIso(row.deceased_date);
        const burial = formatDateOnlyIso(row.burial_date);
        if (death && burial && death > burial) {
          issues.push({
            recordType: type, sourceRecordId: row.id, primaryName: primaryName || '—',
            field: 'deceased_date', storedValue: death, displayValue: formatParishDateDisplay(death),
            rawSourceValue: null, issue: 'death_after_burial',
            explanation: `Death date ${formatParishDateDisplay(death)} is after burial date ${formatParishDateDisplay(burial)}`,
            sourceType: 'record', openPath: openPath(type, row.id, churchId),
          });
        }
      }
    }
  }

  const total = issues.length;
  const offset = Number(ast.offset || 0);
  const limit = Number(ast.limit || 50);
  return {
    rows: issues.slice(offset, offset + limit),
    total,
    unsupported: unsupportedMessage ? { code: 'raw_date_source_partial', message: unsupportedMessage } : null,
    rules,
  };
}

module.exports = {
  executeDataQualitySearch,
  SUPPORTED_RULES,
  looksAmbiguousRaw,
  isValidYmd,
};
