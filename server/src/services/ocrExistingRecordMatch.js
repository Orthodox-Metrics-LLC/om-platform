/**
 * Conservative "already exists" matcher for OCR jobs vs tenant sacrament tables.
 * Prefer exact name + date equality to avoid false positives.
 */

const TABLE_BY_TYPE = {
  baptism: 'baptism_records',
  marriage: 'marriage_records',
  funeral: 'funeral_records',
};

function normalizeText(value) {
  if (value == null) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (us) {
    const y = us[3].length === 2 ? `19${us[3]}` : us[3];
    const m = us[1].padStart(2, '0');
    const d = us[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function pickField(fields, keys) {
  if (!fields || typeof fields !== 'object') return '';
  for (const key of keys) {
    const v = fields[key];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function extractCandidateRecords(agentExtractJson, recordType) {
  let parsed = agentExtractJson;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const type = String(recordType || parsed.record_type || '').toLowerCase();
  if (!['baptism', 'marriage', 'funeral'].includes(type)) return [];

  const records = Array.isArray(parsed.records) && parsed.records.length > 0
    ? parsed.records
    : parsed.fields && typeof parsed.fields === 'object'
      ? [parsed.fields]
      : [];

  return records.map((fields) => ({ type, fields: fields || {} }));
}

function buildMatchQuery(type, fields) {
  if (type === 'baptism') {
    const first = normalizeText(pickField(fields, ['first_name', 'fname', 'child_first', 'name_first']));
    const last = normalizeText(pickField(fields, ['last_name', 'lname', 'child_last', 'name_last', 'surname']));
    const date =
      normalizeDate(pickField(fields, ['reception_date', 'baptism_date', 'date', 'event_date'])) ||
      normalizeDate(pickField(fields, ['birth_date']));
    if (!first || !last || !date) return null;
    return {
      sql: `SELECT id FROM baptism_records
            WHERE LOWER(TRIM(COALESCE(first_name,''))) = ?
              AND LOWER(TRIM(COALESCE(last_name,''))) = ?
              AND (
                DATE(reception_date) = ?
                OR DATE(COALESCE(baptism_date, reception_date)) = ?
                OR DATE(birth_date) = ?
              )
            LIMIT 1`,
      params: [first, last, date, date, date],
      key: { first, last, date },
    };
  }

  if (type === 'marriage') {
    const gFirst = normalizeText(pickField(fields, ['groom_first', 'fname_groom', 'groom_first_name']));
    const gLast = normalizeText(pickField(fields, ['groom_last', 'lname_groom', 'groom_last_name']));
    const bFirst = normalizeText(pickField(fields, ['bride_first', 'fname_bride', 'bride_first_name']));
    const bLast = normalizeText(pickField(fields, ['bride_last', 'lname_bride', 'bride_last_name']));
    const date = normalizeDate(pickField(fields, ['marriage_date', 'mdate', 'date', 'event_date']));
    if (!gFirst || !gLast || !bFirst || !bLast || !date) return null;
    return {
      sql: `SELECT id FROM marriage_records
            WHERE LOWER(TRIM(COALESCE(fname_groom, groom_first_name, ''))) = ?
              AND LOWER(TRIM(COALESCE(lname_groom, groom_last_name, ''))) = ?
              AND LOWER(TRIM(COALESCE(fname_bride, bride_first_name, ''))) = ?
              AND LOWER(TRIM(COALESCE(lname_bride, bride_last_name, ''))) = ?
              AND DATE(COALESCE(mdate, marriage_date)) = ?
            LIMIT 1`,
      params: [gFirst, gLast, bFirst, bLast, date],
      key: { gFirst, gLast, bFirst, bLast, date },
    };
  }

  if (type === 'funeral') {
    const first = normalizeText(pickField(fields, ['first_name', 'fname', 'name', 'deceased_first']));
    const last = normalizeText(pickField(fields, ['last_name', 'lname', 'lastname', 'deceased_last', 'surname']));
    const date =
      normalizeDate(pickField(fields, ['deceased_date', 'death_date', 'date'])) ||
      normalizeDate(pickField(fields, ['burial_date', 'funeral_date']));
    if (!first || !last || !date) return null;
    return {
      sql: `SELECT id FROM funeral_records
            WHERE (
              (LOWER(TRIM(COALESCE(first_name,''))) = ? AND LOWER(TRIM(COALESCE(last_name, lastname, ''))) = ?)
              OR (
                LOWER(TRIM(COALESCE(name,''))) = ?
                AND LOWER(TRIM(COALESCE(lastname, last_name, ''))) = ?
              )
            )
            AND (
              DATE(COALESCE(deceased_date, death_date)) = ?
              OR DATE(COALESCE(burial_date, funeral_date)) = ?
            )
            LIMIT 1`,
      params: [first, last, first, last, date, date],
      key: { first, last, date },
    };
  }

  return null;
}

/**
 * @param {import('mysql2/promise').Pool} tenantPool
 * @param {object} job — { review_status, record_type, agent_extract_json, seeded_at }
 * @returns {Promise<{ alreadyExists: boolean, matchedRecordIds: number[], matchMethod: string|null }>}
 */
async function checkJobAlreadyExists(tenantPool, job) {
  if (!job) {
    return { alreadyExists: false, matchedRecordIds: [], matchMethod: null };
  }

  if (job.review_status === 'seeded' || job.seeded_at) {
    return { alreadyExists: true, matchedRecordIds: [], matchMethod: 'seeded' };
  }

  const candidates = extractCandidateRecords(job.agent_extract_json, job.record_type);
  if (candidates.length === 0) {
    return { alreadyExists: false, matchedRecordIds: [], matchMethod: null };
  }

  const matchedRecordIds = [];
  for (const candidate of candidates) {
    const q = buildMatchQuery(candidate.type, candidate.fields);
    if (!q) continue;
    try {
      const [rows] = await tenantPool.query(q.sql, q.params);
      if (Array.isArray(rows) && rows.length > 0) {
        matchedRecordIds.push(Number(rows[0].id));
      }
    } catch (err) {
      // Column variance across tenants — skip this candidate quietly
      console.log(`[OCR AlreadyExists] match query skipped for ${candidate.type}: ${err.message}`);
    }
  }

  if (matchedRecordIds.length > 0) {
    return {
      alreadyExists: true,
      matchedRecordIds,
      matchMethod: 'type_name_date',
    };
  }

  return { alreadyExists: false, matchedRecordIds: [], matchMethod: null };
}

/**
 * Batch annotate jobs with already_exists for list responses.
 * Caps DB lookups to avoid heavy list endpoints.
 */
async function annotateJobsAlreadyExists(tenantPool, jobs, { maxLookups = 40 } = {}) {
  if (!tenantPool || !Array.isArray(jobs) || jobs.length === 0) return jobs;

  let lookups = 0;
  for (const job of jobs) {
    if (job.review_status === 'seeded' || job.seeded_at) {
      job.already_exists = true;
      job.already_exists_method = 'seeded';
      continue;
    }
    if (job.review_status === 'not_church_record') {
      job.already_exists = false;
      continue;
    }
    if (lookups >= maxLookups) {
      job.already_exists = false;
      continue;
    }
    if (!job.agent_extract_json) {
      job.already_exists = false;
      continue;
    }
    lookups += 1;
    const result = await checkJobAlreadyExists(tenantPool, job);
    job.already_exists = result.alreadyExists;
    job.already_exists_method = result.matchMethod;
    job.matched_record_ids = result.matchedRecordIds;
  }
  return jobs;
}

module.exports = {
  checkJobAlreadyExists,
  annotateJobsAlreadyExists,
  extractCandidateRecords,
  normalizeText,
  normalizeDate,
  TABLE_BY_TYPE,
};
