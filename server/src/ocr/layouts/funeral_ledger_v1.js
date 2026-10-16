/**
 * Funeral / death-register ledger extractor.
 *
 * Open-book death registers number each decedent in the left margin
 * (1, 2, 3, 4). One image is one page-spread and many records.
 */
'use strict';

const generic = require('./generic_table');

const LAYOUT_ID = 'funeral_ledger_v1';

const COLUMNS = {
  number: [0.000, 0.080],
  death_date: [0.080, 0.175],
  burial_date: [0.175, 0.260],
  deceased_name: [0.240, 0.480],
  age: [0.430, 0.520],
  cause: [0.500, 0.720],
  officiant: [0.700, 1.000],
};

const COLUMN_KEYS = Object.keys(COLUMNS);

function isRecordNumberToken(token) {
  if (token.x_center > 0.18) return false;
  const text = String(token.text || '').replace(/\.$/, '');
  if (!/^\d{1,3}$/.test(text)) return false;
  const n = Number(text);
  return n >= 1 && n <= 200;
}

function headerYThreshold(tokens) {
  const headerRe = /\b(deaths|year|number|male|female|decedent|burial|cause|priest|full)\b/i;
  let max = 0.22;
  for (const token of tokens) {
    if (token.y_center > 0.38) continue;
    if (headerRe.test(token.text)) {
      max = Math.max(max, token.y_max + 0.01);
    }
  }
  return Math.min(max, 0.42);
}

function extractFuneralLedgerTable(visionJson, opts = {}) {
  const pageIndex = opts.pageIndex || 0;
  const tokens = generic.extractWordTokens(visionJson, pageIndex);
  if (!tokens.length) {
    return {
      layout_id: LAYOUT_ID,
      page_number: pageIndex + 1,
      tables: [],
      column_bands: COLUMNS,
      columns_detected: COLUMN_KEYS.length,
      data_rows: 0,
      extracted_at: new Date().toISOString(),
    };
  }

  const headerY = headerYThreshold(tokens);
  const dataTokens = tokens.filter((t) => t.y_center > headerY);
  const textRows = generic.clusterIntoRows(dataTokens);
  const ledgerRows = [];
  let current = [];

  for (const row of textRows) {
    const startsRecord = row.some(isRecordNumberToken);
    if (startsRecord && current.length) {
      ledgerRows.push(current.flat());
      current = [row];
    } else if (startsRecord) {
      current = [row];
    } else if (current.length) {
      current.push(row);
    }
  }
  if (current.length) ledgerRows.push(current.flat());

  const headerRow = {
    row_index: 0,
    type: 'header',
    cells: COLUMN_KEYS.map((key, colIdx) => ({
      row_index: 0,
      column_index: colIdx,
      column_key: key,
      content: key,
    })),
  };

  const dataRowObjects = ledgerRows.map((rowTokens, dataIdx) => {
    const rowIndex = dataIdx + 1;
    const cells = COLUMN_KEYS.map((key, colIdx) => {
      const [x0, x1] = COLUMNS[key];
      const cell = generic.extractCell(rowTokens, x0, x1);
      return {
        row_index: rowIndex,
        column_index: colIdx,
        column_key: key,
        content: cell.text,
        confidence: cell.confidence,
        token_count: cell.token_count,
        bbox: cell.bbox,
      };
    });
    return { row_index: rowIndex, type: 'row', cells };
  });

  const page = visionJson?.pages?.[pageIndex];
  return {
    layout_id: LAYOUT_ID,
    page_number: pageIndex + 1,
    page_dimensions: page ? { width: page.width, height: page.height } : null,
    tables: [{
      row_count: 1 + dataRowObjects.length,
      column_count: COLUMN_KEYS.length,
      table_number: 1,
      has_header_row: true,
      rows: [headerRow, ...dataRowObjects],
    }],
    column_bands: COLUMNS,
    columns_detected: COLUMN_KEYS.length,
    header_y_threshold: headerY,
    total_tokens: tokens.length,
    data_tokens: dataTokens.length,
    data_rows: ledgerRows.length,
    extracted_at: new Date().toISOString(),
  };
}

module.exports = {
  LAYOUT_ID,
  COLUMNS,
  extractFuneralLedgerTable,
};
