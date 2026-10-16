/**
 * Explicit allowlisted record types, tables, fields, and operators
 * for governed parish records search. Never derive SQL identifiers from user input.
 */

const OPERATORS = Object.freeze([
  'equals', 'not_equals', 'contains', 'starts_with', 'ends_with',
  'in', 'not_in', 'before', 'after', 'between',
  'is_empty', 'is_not_empty', 'greater_than', 'less_than',
]);

const LOGICAL_OPS = Object.freeze(['and', 'or']);

const CANONICAL_DATE_FIELDS = Object.freeze({
  baptism: 'reception_date',
  marriage: 'mdate',
  funeral: 'burial_date',
});

const RECORD_TYPES = Object.freeze({
  baptism: {
    type: 'baptism',
    table: 'baptism_records',
    label: 'Baptism',
    canonicalEventDate: 'reception_date',
    additionalDates: ['birth_date'],
    personFields: ['first_name', 'last_name'],
    primaryNameSql: "TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')))",
    clergyField: 'clergy',
    locationField: 'birthplace',
    statusField: 'status',
    textSearchFields: ['first_name', 'last_name', 'clergy', 'sponsors', 'parents', 'birthplace'],
    sortableFields: [
      'canonical_event_date', 'primary_name', 'clergy', 'location', 'status', 'id',
      'reception_date', 'birth_date', 'first_name', 'last_name',
    ],
    fields: {
      canonical_event_date: { column: 'reception_date', kind: 'date', logical: true },
      birth_date: { column: 'birth_date', kind: 'date' },
      reception_date: { column: 'reception_date', kind: 'date' },
      first_name: { column: 'first_name', kind: 'text' },
      last_name: { column: 'last_name', kind: 'text' },
      primary_name: { column: null, kind: 'text', logical: true },
      clergy: { column: 'clergy', kind: 'text' },
      location: { column: 'birthplace', kind: 'text', logical: true },
      birthplace: { column: 'birthplace', kind: 'text' },
      sponsors: { column: 'sponsors', kind: 'text' },
      parents: { column: 'parents', kind: 'text' },
      status: { column: 'status', kind: 'text' },
      id: { column: 'id', kind: 'num' },
    },
  },
  marriage: {
    type: 'marriage',
    table: 'marriage_records',
    label: 'Marriage',
    canonicalEventDate: 'mdate',
    additionalDates: [],
    personFields: ['fname_groom', 'lname_groom', 'fname_bride', 'lname_bride'],
    primaryNameSql: "TRIM(CONCAT(COALESCE(fname_groom,''), ' ', COALESCE(lname_groom,''), ' & ', COALESCE(fname_bride,''), ' ', COALESCE(lname_bride,'')))",
    clergyField: 'clergy',
    locationField: null,
    statusField: 'status',
    textSearchFields: ['fname_groom', 'lname_groom', 'fname_bride', 'lname_bride', 'clergy', 'witness', 'parentsg', 'parentsb'],
    sortableFields: [
      'canonical_event_date', 'primary_name', 'clergy', 'status', 'id', 'mdate',
      'lname_groom', 'lname_bride',
    ],
    fields: {
      canonical_event_date: { column: 'mdate', kind: 'date', logical: true },
      mdate: { column: 'mdate', kind: 'date' },
      fname_groom: { column: 'fname_groom', kind: 'text' },
      lname_groom: { column: 'lname_groom', kind: 'text' },
      fname_bride: { column: 'fname_bride', kind: 'text' },
      lname_bride: { column: 'lname_bride', kind: 'text' },
      primary_name: { column: null, kind: 'text', logical: true },
      clergy: { column: 'clergy', kind: 'text' },
      witness: { column: 'witness', kind: 'text' },
      status: { column: 'status', kind: 'text' },
      id: { column: 'id', kind: 'num' },
    },
  },
  funeral: {
    type: 'funeral',
    table: 'funeral_records',
    label: 'Funeral',
    canonicalEventDate: 'burial_date',
    additionalDates: ['deceased_date'],
    personFields: ['name', 'lastname'],
    primaryNameSql: "TRIM(CONCAT(COALESCE(name,''), ' ', COALESCE(lastname,'')))",
    clergyField: 'clergy',
    locationField: 'burial_location',
    statusField: 'status',
    textSearchFields: ['name', 'lastname', 'clergy', 'burial_location'],
    sortableFields: [
      'canonical_event_date', 'primary_name', 'clergy', 'location', 'status', 'id',
      'burial_date', 'deceased_date', 'lastname', 'name',
    ],
    fields: {
      canonical_event_date: { column: 'burial_date', kind: 'date', logical: true },
      burial_date: { column: 'burial_date', kind: 'date' },
      deceased_date: { column: 'deceased_date', kind: 'date' },
      name: { column: 'name', kind: 'text' },
      lastname: { column: 'lastname', kind: 'text' },
      primary_name: { column: null, kind: 'text', logical: true },
      clergy: { column: 'clergy', kind: 'text' },
      location: { column: 'burial_location', kind: 'text', logical: true },
      burial_location: { column: 'burial_location', kind: 'text' },
      status: { column: 'status', kind: 'text' },
      age: { column: 'age', kind: 'num' },
      id: { column: 'id', kind: 'num' },
    },
  },
});

const DEFAULT_SELECT = Object.freeze([
  'record_type', 'primary_name', 'canonical_event_date', 'clergy', 'location', 'status', 'source_record_id',
]);

const MAX_PAGE_SIZE = 100;
const MAX_EXPORT_SYNC_ROWS = 5000;
const MAX_CONDITION_DEPTH = 4;
const MAX_CONDITIONS = 40;

function getRecordTypeConfig(type) {
  return RECORD_TYPES[type] || null;
}

function listRecordTypes() {
  return Object.keys(RECORD_TYPES);
}

function resolvePhysicalColumn(type, fieldKey) {
  const cfg = RECORD_TYPES[type];
  if (!cfg) return null;
  if (fieldKey === 'canonical_event_date') return cfg.canonicalEventDate;
  if (fieldKey === 'primary_name') return null;
  if (fieldKey === 'location') return cfg.locationField;
  const f = cfg.fields[fieldKey];
  return f ? f.column : null;
}

module.exports = {
  OPERATORS,
  LOGICAL_OPS,
  CANONICAL_DATE_FIELDS,
  RECORD_TYPES,
  DEFAULT_SELECT,
  MAX_PAGE_SIZE,
  MAX_EXPORT_SYNC_ROWS,
  MAX_CONDITION_DEPTH,
  MAX_CONDITIONS,
  getRecordTypeConfig,
  listRecordTypes,
  resolvePhysicalColumn,
};
