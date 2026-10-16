/**
 * Certificate Studio — load sacramental records from church DB
 */

const { getAppPool } = require('../../config/db');
const { getChurchDbConnection } = require('../../utils/dbSwitcher');
const { formatDate } = require('./field-bindings');

async function resolveChurchDb(churchId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT database_name FROM churches WHERE id = ? AND is_active = 1 LIMIT 1',
    [churchId],
  );
  if (!rows.length) return null;
  const dbName = rows[0].database_name || `om_church_${churchId}`;
  const churchDb = await getChurchDbConnection(dbName);
  return churchDb;
}

function normalizeBaptismRecord(record) {
  if (!record) return record;
  record.reception_date = record.reception_date || record.date_of_baptism || null;
  record.date_of_baptism = record.date_of_baptism || record.reception_date || null;
  record.birth_date = record.birth_date || record.date_of_birth || null;
  record.date_of_birth = record.date_of_birth || record.birth_date || null;
  return record;
}

function isBaptismEntryType(entryType) {
  if (entryType == null || entryType === '') return true;
  return String(entryType).trim().toLowerCase() === 'baptism';
}

async function loadChurchMeta(churchId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT id, name, city, state_province, rector_name, seal_image_path, signature_image_path, jurisdiction_id
     FROM churches WHERE id = ? LIMIT 1`,
    [churchId],
  );
  if (!rows.length) return null;
  const c = rows[0];
  return {
    id: c.id,
    name: c.name,
    city: c.city,
    state: c.state_province || '',
    rector_name: c.rector_name,
    priest_name: c.rector_name,
    seal_image_path: c.seal_image_path,
    signature_image_path: c.signature_image_path,
  };
}

const LIST_DATE_FIELDS = {
  baptism: ['reception_date', 'date_of_baptism', 'birth_date', 'date_of_birth'],
  reception: ['reception_date', 'date_of_baptism', 'birth_date', 'date_of_birth'],
  marriage: ['mdate'],
};

/** Format date columns for certificate-studio record picker (display only). */
function formatRecordListDates(record, certificateType) {
  if (!record) return record;
  const fields = LIST_DATE_FIELDS[certificateType] || [];
  const out = { ...record };
  for (const field of fields) {
    if (out[field]) out[field] = formatDate(out[field]);
  }
  return out;
}

async function loadRecord(certificateType, recordId, churchId) {
  const churchDb = await resolveChurchDb(churchId);
  if (!churchDb) throw new Error('Church database not available');

  const tableMap = {
    baptism: 'baptism_records',
    marriage: 'marriage_records',
    reception: 'baptism_records',
  };
  const table = tableMap[certificateType];
  if (!table) throw new Error(`Unknown certificate type: ${certificateType}`);

  const [rows] = await churchDb.query(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`, [recordId]);
  if (!rows.length) return null;

  const record = rows[0];
  if (certificateType === 'baptism' || certificateType === 'reception') {
    normalizeBaptismRecord(record);
  }
  return record;
}

async function searchRecords(certificateType, churchId, { search = '', limit = 50, recordId = null } = {}) {
  if (recordId) {
    const record = await loadRecord(certificateType, recordId, churchId);
    return record ? [formatRecordListDates(record, certificateType)] : [];
  }

  const churchDb = await resolveChurchDb(churchId);
  if (!churchDb) return [];

  const tableMap = {
    baptism: 'baptism_records',
    marriage: 'marriage_records',
    reception: 'baptism_records',
  };
  const table = tableMap[certificateType];
  if (!table) return [];

  let query;
  let params;

  if (certificateType === 'marriage') {
    query = `SELECT id, fname_groom, lname_groom, fname_bride, lname_bride, mdate, clergy
             FROM ${table} WHERE 1=1`;
    if (search) {
      query += ` AND (fname_groom LIKE ? OR lname_groom LIKE ? OR fname_bride LIKE ? OR lname_bride LIKE ?)`;
      const q = `%${search}%`;
      params = [q, q, q, q];
    }
  } else if (certificateType === 'reception') {
    query = `SELECT id, first_name, last_name, reception_date, clergy, entry_type
             FROM ${table}
             WHERE entry_type IS NOT NULL
               AND entry_type != ''
               AND LOWER(entry_type) != 'baptism'`;
    if (search) {
      query += ` AND (first_name LIKE ? OR last_name LIKE ?)`;
      const q = `%${search}%`;
      params = [q, q];
    }
  } else {
    query = `SELECT id, first_name, last_name, reception_date, clergy, entry_type
             FROM ${table}
             WHERE (entry_type IS NULL OR entry_type = '' OR LOWER(entry_type) = 'baptism')`;
    if (search) {
      query += ` AND (first_name LIKE ? OR last_name LIKE ?)`;
      const q = `%${search}%`;
      params = [q, q];
    }
  }

  query += ` ORDER BY id DESC LIMIT ?`;
  params = [...(params || []), Math.min(Number(limit) || 50, 200)];

  const [rows] = await churchDb.query(query, params);
  return rows.map((row) => formatRecordListDates(normalizeBaptismRecord(row), certificateType));
}

module.exports = {
  loadChurchMeta,
  loadRecord,
  searchRecords,
  resolveChurchDb,
  normalizeBaptismRecord,
  formatRecordListDates,
  isBaptismEntryType,
};
