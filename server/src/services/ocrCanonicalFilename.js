/**
 * OM parish image naming convention.
 *
 * Unknown at intake:  [parish-id]-[sequence].[ext]     e.g. ssppoc-nj01-001.jpg
 * Record type known:  [type][sequence]-[parish-id].[ext] e.g. fun001-ssppoc-nj01.jpg
 *
 * The on-disk object name and job id stay immutable. This module only
 * assigns display/metadata names: original_filename + canonical_filename.
 */
'use strict';

const path = require('path');

const RECORD_TYPE_PREFIX = {
  baptism: 'bap',
  marriage: 'mar',
  funeral: 'fun',
  burial: 'bur',
  chrismation: 'chr',
  conversion: 'con',
  reception: 'con',
  membership: 'mem',
  census: 'cns',
  custom: 'unk',
  unknown: 'unk',
  undetermined: 'unk',
  image: 'img',
  img: 'img',
};

const US_STATE_ABBR = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca',
  colorado: 'co', connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga',
  hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia',
  kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md',
  massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms',
  missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv',
  newhampshire: 'nh', newjersey: 'nj', newmexico: 'nm', newyork: 'ny',
  northcarolina: 'nc', northdakota: 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or',
  pennsylvania: 'pa', rhodeisland: 'ri', southcarolina: 'sc', southdakota: 'sd',
  tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va',
  washington: 'wa', westvirginia: 'wv', wisconsin: 'wi', wyoming: 'wy',
  districtofcolumbia: 'dc',
};

const STOP_WORDS = new Set(['the', 'and', 'of', 'in', 'at', 'a', 'an', 'for', 'to']);

function normalizeState(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'xx';
  if (/^[A-Za-z]{2}$/.test(s)) return s.toLowerCase();
  const key = s.toLowerCase().replace(/[^a-z]/g, '');
  if (US_STATE_ABBR[key]) return US_STATE_ABBR[key];
  return s.slice(0, 2).toLowerCase();
}

function churchNameToAcronym(raw) {
  let name = String(raw || '').toLowerCase();
  name = name.replace(/\s*[—–].*$/, '');
  name = name.replace(/\(.*?\)/g, ' ');
  name = name.replace(/#\d+/g, ' ');
  name = name.replace(/,/g, ' ');
  name = name.replace(/\bss\.?\b/g, 'ss ');
  name = name.replace(/\bsaints\b/g, 'ss ');
  name = name.replace(/\bsts\.?\b/g, 'st ');
  name = name.replace(/\bsaint\b/g, 'st ');
  name = name.replace(/\bst\.?\b/g, 'st ');
  name = name.replace(/&/g, ' ');
  const words = name.split(/[^a-z0-9]+/).filter(Boolean);
  const parts = [];
  for (const w of words) {
    if (STOP_WORDS.has(w)) continue;
    if (w === 'ss') parts.push('ss');
    else if (w === 'st' || w === 'sts') parts.push('st');
    else if (w === 'orthodox') parts.push('o');
    else if (w === 'church') parts.push('c');
    else if (w === 'parish' || w === 'cathedral') continue;
    else parts.push(w[0]);
  }
  let acronym = parts.join('') || 'unk';
  const hasOc = /oc$/.test(acronym) || (acronym.includes('o') && acronym.endsWith('c'));
  if (!hasOc && (parts[0] === 'ss' || parts[0] === 'st')) {
    acronym += 'oc';
  }
  return acronym.slice(0, 16);
}

function parishIdFromChurch(self, peers) {
  const acronym = churchNameToAcronym(self.church_name || self.name || '');
  const state = normalizeState(self.state_province);
  const same = (peers || [])
    .filter((p) => (
      churchNameToAcronym(p.church_name || p.name || '') === acronym
      && normalizeState(p.state_province) === state
    ))
    .sort((a, b) => Number(a.id) - Number(b.id));
  const found = same.findIndex((p) => Number(p.id) === Number(self.id));
  const idx = found >= 0 ? found + 1 : 1;
  return `${acronym}-${state}${String(idx).padStart(2, '0')}`;
}

function fileTypePrefix(recordType) {
  const key = String(recordType || '').toLowerCase();
  return RECORD_TYPE_PREFIX[key] || null;
}

function isUnknownRecordType(recordType) {
  const key = String(recordType || '').toLowerCase();
  return !key || key === 'custom';
}

function padSequence(n, forceWidth) {
  const num = Math.max(1, Number(n) || 1);
  const width = forceWidth || (num > 999 ? 4 : 3);
  return String(num).padStart(width, '0');
}

function normalizeExt(ext) {
  const cleaned = String(ext || '.jpg').replace(/^\./, '').toLowerCase();
  return cleaned || 'jpg';
}

/**
 * @param {{ parishId: string, sequence: number, recordType?: string, ext?: string, intakeUnknown?: boolean, padWidth?: number }} opts
 */
function buildCanonicalFilename(opts) {
  const parishId = String(opts.parishId || 'unk-xx01').toLowerCase();
  const seq = padSequence(opts.sequence, opts.padWidth);
  const ext = normalizeExt(opts.ext);
  const unknown = opts.intakeUnknown === true
    || (opts.intakeUnknown !== false && isUnknownRecordType(opts.recordType));
  if (unknown) {
    return `${parishId}-${seq}.${ext}`;
  }
  const prefix = fileTypePrefix(opts.recordType) || 'unk';
  return `${prefix}${seq}-${parishId}.${ext}`;
}

function parseSequenceFromCanonical(filename) {
  if (!filename) return null;
  const base = String(filename).split('/').pop().replace(/\.[^.]+$/, '');
  const typed = base.match(/^[a-z]{3}(\d{3,4})-/i);
  if (typed) return parseInt(typed[1], 10);
  const intake = base.match(/-(\d{3,4})$/);
  if (intake) return parseInt(intake[1], 10);
  return null;
}

let filenameColumnsEnsured = false;

async function ensureFilenameColumns(pool) {
  if (filenameColumnsEnsured) return;
  await pool.query('ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS original_filename VARCHAR(512) NULL');
  await pool.query('ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS canonical_filename VARCHAR(255) NULL');
  filenameColumnsEnsured = true;
}

function resetFilenameColumnsCacheForTests() {
  filenameColumnsEnsured = false;
}

async function resolveParishId(pool, churchId) {
  const [churches] = await pool.query(
    'SELECT id, name, church_name, state_province FROM churches',
  );
  const self = (churches || []).find((c) => Number(c.id) === Number(churchId));
  if (!self) return `ch${churchId}`;
  return parishIdFromChurch(self, churches);
}

async function nextParishImageSequence(pool, churchId) {
  let max = 0;
  try {
    const [rows] = await pool.query(
      'SELECT canonical_filename FROM ocr_jobs WHERE church_id = ? AND canonical_filename IS NOT NULL',
      [churchId],
    );
    for (const row of rows || []) {
      const n = parseSequenceFromCanonical(row.canonical_filename);
      if (n && n > max) max = n;
    }
  } catch (_) {
    /* column may not exist yet */
  }
  if (max === 0) {
    const [cntRows] = await pool.query(
      'SELECT COUNT(*) AS n FROM ocr_jobs WHERE church_id = ?',
      [churchId],
    );
    max = Number(cntRows?.[0]?.n || 0);
  }
  return max + 1;
}

async function assignCanonicalAtIngest(pool, {
  churchId,
  originalFilename,
  recordType,
}) {
  await ensureFilenameColumns(pool);
  const parishId = await resolveParishId(pool, churchId);
  const sequence = await nextParishImageSequence(pool, churchId);
  const ext = path.extname(originalFilename || '.jpg');
  const canonical = buildCanonicalFilename({
    parishId,
    sequence,
    recordType,
    ext,
    intakeUnknown: isUnknownRecordType(recordType),
  });
  return { parishId, sequence, canonical_filename: canonical };
}

async function persistCanonicalForJob(pool, { jobId, churchId, recordType }) {
  await ensureFilenameColumns(pool);
  const [rows] = await pool.query(
    'SELECT original_filename, canonical_filename, filename, record_type FROM ocr_jobs WHERE id = ?',
    [jobId],
  );
  const job = rows?.[0];
  if (!job) return null;
  const parishId = await resolveParishId(pool, churchId);
  let sequence = parseSequenceFromCanonical(job.canonical_filename);
  if (!sequence) {
    sequence = await nextParishImageSequence(pool, churchId);
  }
  const ext = path.extname(job.original_filename || job.filename || '.jpg');
  const type = recordType || job.record_type || 'custom';
  const canonical = buildCanonicalFilename({
    parishId,
    sequence,
    recordType: type,
    ext,
    intakeUnknown: isUnknownRecordType(type),
  });
  await pool.query('UPDATE ocr_jobs SET canonical_filename = ? WHERE id = ?', [canonical, jobId]);
  return canonical;
}

module.exports = {
  RECORD_TYPE_PREFIX,
  normalizeState,
  churchNameToAcronym,
  parishIdFromChurch,
  fileTypePrefix,
  isUnknownRecordType,
  padSequence,
  buildCanonicalFilename,
  parseSequenceFromCanonical,
  ensureFilenameColumns,
  resetFilenameColumnsCacheForTests,
  resolveParishId,
  nextParishImageSequence,
  assignCanonicalAtIngest,
  persistCanonicalForJob,
};
