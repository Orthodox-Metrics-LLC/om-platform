'use strict';

const crypto = require('crypto');

const OMDOC_RE = /^OMDOC-(\d{8})-([A-Z0-9]{6})$/;

function utcDateStamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function randomSuffix(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function isValidDocumentId(id) {
  return typeof id === 'string' && OMDOC_RE.test(id);
}

function generateDocumentId(date = new Date()) {
  return `OMDOC-${utcDateStamp(date)}-${randomSuffix(6)}`;
}

async function generateUniqueDocumentId(existsFn, date = new Date()) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const id = generateDocumentId(date);
    if (!existsFn || !(await existsFn(id))) return id;
  }
  throw new Error('DOCUMENT_ID_COLLISION');
}

module.exports = {
  OMDOC_RE,
  isValidDocumentId,
  generateDocumentId,
  generateUniqueDocumentId,
  utcDateStamp,
};
