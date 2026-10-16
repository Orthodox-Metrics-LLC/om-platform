/**
 * Server-side parish search exports: XLSX, CSV, XML.
 * Spreadsheet formula-injection protection for = + - @ prefixes.
 */

const { validateAst } = require('./astValidator');
const { planUnionQueryAsync } = require('./queryPlanner');
const { normalizeRows } = require('./resultNormalizer');
const { resolveAuthorizedChurchId, getTenantConnection } = require('./churchContext');
const { logParishSearchEvent } = require('./audit');
const { MAX_EXPORT_SYNC_ROWS } = require('./recordFieldRegistry');
const { randomUUID } = require('crypto');
const { guardSpreadsheetValue } = require('./spreadsheetGuard');
const { executeDuplicateDetection } = require('./duplicateService');
const { executeActivitySearch } = require('./activityService');
const { executeDataQualitySearch } = require('./dataQualityService');
const { formatParishDateDisplay, formatParishDateTimeDisplay } = require('./dateDisplay');

function rowToExportObject(row) {
  return {
    Type: row.recordType,
    'Name / Parties': row.primaryName,
    'Event Date': row.canonicalEventDateDisplay || formatParishDateDisplay(row.canonicalEventDate) || '',
    Clergy: row.clergy || '',
    Location: row.location || '',
    Status: row.status || '',
    'Record ID': row.sourceRecordId,
    Match: row.matchLabel || '',
    'Activity Type': row.activityType || '',
    'Activity Timestamp': row.activityAtDisplay || (row.activityAt ? formatParishDateTimeDisplay(row.activityAt) : ''),
    'Performed By': row.performedBy || '',
    Rule: row.issue || row.rule || '',
    Field: row.field || '',
    'Stored Value': row.storedValue || '',
    'Display Value': row.displayValue || '',
    'Raw Source Value': row.rawSourceValue || '',
  };
}

async function fetchAllRows(req, ast) {
  const validated = validateAst({ ...ast, limit: Math.min(ast.limit || MAX_EXPORT_SYNC_ROWS, MAX_EXPORT_SYNC_ROWS) }, { forExport: true });
  const { churchId, user } = await resolveAuthorizedChurchId(req, validated.scope.churchId);
  validated.scope.churchId = churchId;
  const pool = await getTenantConnection(churchId);
  if (validated.operation?.type === 'duplicate_detection') {
    const result = await executeDuplicateDetection(pool, { ...validated, limit: MAX_EXPORT_SYNC_ROWS, offset: 0 }, churchId);
    return { rows: [], groups: result.groups, churchId, user, ast: validated };
  }
  if (validated.operation?.type === 'record_activity') {
    const result = await executeActivitySearch(pool, { ...validated, limit: MAX_EXPORT_SYNC_ROWS, offset: 0 }, churchId);
    return { rows: result.rows, groups: null, churchId, user, ast: validated, exportKind: 'activity' };
  }
  if (validated.operation?.type === 'data_quality') {
    const result = await executeDataQualitySearch(pool, { ...validated, limit: MAX_EXPORT_SYNC_ROWS, offset: 0 }, churchId);
    return { rows: result.rows, groups: null, churchId, user, ast: validated, exportKind: 'data_quality', unsupported: result.unsupported };
  }

  // Page through results up to sync cap
  const all = [];
  let offset = 0;
  const pageSize = 500;
  while (all.length < MAX_EXPORT_SYNC_ROWS) {
    const pageAst = { ...validated, limit: pageSize, offset, aggregates: [], groupBy: [] };
    const plan = await planUnionQueryAsync(pageAst, pool);
    const [rows] = await pool.query(plan.sql, plan.params);
    if (!rows.length) break;
    all.push(...normalizeRows(rows, churchId));
    offset += rows.length;
    if (rows.length < pageSize) break;
  }
  if (all.length >= MAX_EXPORT_SYNC_ROWS) {
    // check if more exist
    const plan = await planUnionQueryAsync({ ...validated, aggregates: [], groupBy: [] }, pool);
    const [[countRow]] = await pool.query(plan.countSql, plan.countParams);
    if (Number(countRow?.total || 0) > MAX_EXPORT_SYNC_ROWS) {
      const err = new Error(`Export too large (max ${MAX_EXPORT_SYNC_ROWS} rows for synchronous export)`);
      err.status = 413;
      err.code = 'export_too_large';
      throw err;
    }
  }
  return { rows: all, groups: null, churchId, user, ast: validated };
}

function duplicateRecordRows(groups) {
  return groups.flatMap((g) => g.records.map((r) => ({
    'Duplicate Group ID': g.duplicateGroupId, Classification: g.classification, Confidence: g.confidence,
    'Record Type': r.recordType, 'Record ID': r.sourceRecordId, 'Name / Parties': r.primaryName,
    'Event Date': r.canonicalEventDateDisplay || formatParishDateDisplay(r.canonicalEventDate) || '',
    'Matching Fields': g.matchedFields.join(', '),
    'Differing Fields': g.differingFields.join(', '), 'Original Values': JSON.stringify(r.values),
    'Review Status': g.reviewStatus,
    'Survivor Selection': '',
    'Removal Selection': '',
    'Removal Status': r.deletedAt ? 'soft_deleted' : 'active',
    'Record Reference': r.openPath,
  })));
}

function buildDuplicateCsv(groups) {
  const rows = duplicateRecordRows(groups); const headers = Object.keys(rows[0] || { 'Duplicate Group ID': '' });
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => { const v = guardSpreadsheetValue(row[h]); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(','));
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
}

async function buildDuplicateXlsx(groups, ast, churchId) {
  const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); wb.creator = 'Orthodox Metrics';
  const groupRows = groups.map((g) => ({ 'Duplicate Group ID': g.duplicateGroupId, Classification: g.classification, Confidence: g.confidence, 'Record Type': g.recordType, 'Record Count': g.recordCount, 'Matching Fields': g.matchedFields.join(', '), 'Differing Fields': g.differingFields.join(', '), Preset: g.preset, 'Review Status': g.reviewStatus }));
  const add = (name, rows) => { const ws = wb.addWorksheet(name); const headers = Object.keys(rows[0] || {}); ws.addRow(headers); ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; if (headers.length) ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + Math.min(headers.length, 26))}1` }; rows.forEach((r) => ws.addRow(headers.map((h) => guardSpreadsheetValue(r[h])))); };
  add('Duplicate Groups', groupRows); add('Duplicate Records', duplicateRecordRows(groups));
  add('Query Summary', [{ Church: churchId, Operation: ast.operation.mode, 'Match Level': ast.operation.matchLevel, 'Record Types': ast.scope.recordTypes.join(', '), 'Group Count': groups.length, Generated: new Date().toISOString() }]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function buildDuplicateXml(groups, ast, churchId) {
  const p = ['<?xml version="1.0" encoding="UTF-8"?>', `<DuplicateSearchExport schemaVersion="1" churchId="${escapeXml(churchId)}" mode="${escapeXml(ast.operation.mode)}">`];
  for (const g of groups) { p.push(`  <DuplicateGroup id="${escapeXml(g.duplicateGroupId)}" classification="${escapeXml(g.classification)}" confidence="${g.confidence}" reviewStatus="${escapeXml(g.reviewStatus)}">`, `    <MatchReasons>${escapeXml(g.matchedFields.join(', '))}</MatchReasons>`, `    <Differences>${escapeXml(g.differingFields.join(', '))}</Differences>`); for (const r of g.records) p.push(`    <Record type="${escapeXml(r.recordType)}" id="${escapeXml(r.sourceRecordId)}"><PrimaryName>${escapeXml(r.primaryName)}</PrimaryName><EventDate>${escapeXml(r.canonicalEventDate || '')}</EventDate><Reference>${escapeXml(r.openPath)}</Reference><OriginalValues>${escapeXml(JSON.stringify(r.values))}</OriginalValues></Record>`); p.push('  </DuplicateGroup>'); }
  p.push('</DuplicateSearchExport>'); return Buffer.from(p.join('\n'), 'utf8');
}

async function buildCsv(rows, { includeSummary, ast, churchId }) {
  const headers = ['Type', 'Name / Parties', 'Event Date', 'Clergy', 'Location', 'Status', 'Record ID', 'Match'];
  const lines = [];
  if (includeSummary) {
    lines.push(guardSpreadsheetValue('# Orthodox Metrics Parish Records Export'));
    lines.push(guardSpreadsheetValue(`# Church ID: ${churchId}`));
    lines.push(guardSpreadsheetValue(`# Generated: ${new Date().toISOString()}`));
    lines.push(guardSpreadsheetValue(`# Record types: ${(ast.scope.recordTypes || []).join(', ')}`));
    lines.push(guardSpreadsheetValue(`# Count: ${rows.length}`));
    lines.push('');
  }
  lines.push(headers.join(','));
  for (const r of rows) {
    const o = rowToExportObject(r);
    lines.push(headers.map((h) => {
      const v = guardSpreadsheetValue(o[h]);
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    }).join(','));
  }
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
}

async function buildXlsx(rows, { includeSummary, ast, churchId }) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Orthodox Metrics';
  wb.created = new Date();

  if (includeSummary) {
    const summary = wb.addWorksheet('Query Summary');
    summary.addRow(['Orthodox Metrics Parish Records Export']);
    summary.addRow(['Church ID', churchId]);
    summary.addRow(['Generated', new Date().toISOString()]);
    summary.addRow(['Record types', (ast.scope.recordTypes || []).join(', ')]);
    summary.addRow(['Result count', rows.length]);
    summary.addRow(['Query version', ast.version]);
    summary.getColumn(1).width = 20;
    summary.getColumn(2).width = 50;
  }

  const byType = new Map();
  for (const r of rows) {
    if (!byType.has(r.recordType)) byType.set(r.recordType, []);
    byType.get(r.recordType).push(r);
  }

  const addSheet = (name, sheetRows) => {
    const ws = wb.addWorksheet(name.slice(0, 31));
    const headers = ['Type', 'Name / Parties', 'Event Date', 'Clergy', 'Location', 'Status', 'Record ID', 'Match'];
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: 'H1' };
    for (const r of sheetRows) {
      const o = rowToExportObject(r);
      const values = headers.map((h) => guardSpreadsheetValue(o[h]));
      ws.addRow(values);
    }
    ws.columns.forEach((col) => { col.width = Math.min(40, Math.max(12, col.width || 14)); });
  };

  if (byType.size > 1) {
    addSheet('Combined', rows);
    for (const [type, list] of byType) addSheet(type, list);
  } else {
    addSheet('Records', rows);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function buildXml(rows, { ast, churchId }) {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<ParishRecordsExport schemaVersion="1">');
  parts.push('  <Metadata>');
  parts.push(`    <ChurchId>${escapeXml(churchId)}</ChurchId>`);
  parts.push(`    <GeneratedAt>${escapeXml(new Date().toISOString())}</GeneratedAt>`);
  parts.push(`    <RecordCount>${rows.length}</RecordCount>`);
  parts.push(`    <RecordTypes>${escapeXml((ast.scope.recordTypes || []).join(','))}</RecordTypes>`);
  parts.push(`    <QueryVersion>${escapeXml(ast.version)}</QueryVersion>`);
  parts.push('  </Metadata>');
  parts.push('  <Records>');
  for (const r of rows) {
    parts.push(`    <Record type="${escapeXml(r.recordType)}" id="${escapeXml(r.sourceRecordId)}">`);
    parts.push(`      <PrimaryName>${escapeXml(r.primaryName)}</PrimaryName>`);
    parts.push(`      <CanonicalEventDate>${escapeXml(r.canonicalEventDate || '')}</CanonicalEventDate>`);
    parts.push(`      <Clergy>${escapeXml(r.clergy || '')}</Clergy>`);
    parts.push(`      <Location>${escapeXml(r.location || '')}</Location>`);
    parts.push(`      <Status>${escapeXml(r.status || '')}</Status>`);
    if (r.matchLabel) parts.push(`      <MatchLabel>${escapeXml(r.matchLabel)}</MatchLabel>`);
    parts.push('    </Record>');
  }
  parts.push('  </Records>');
  parts.push('</ParishRecordsExport>');
  return Buffer.from(parts.join('\n'), 'utf8');
}

/** Landscape letter PDF table (pdf-lib, no browser) — parity with the legacy client-side PDF export. */
async function buildPdf(rows, { includeSummary, ast, churchId }) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const headers = ['Type', 'Name / Parties', 'Event Date', 'Clergy', 'Location', 'Status', 'Record ID'];
  const widths = [60, 190, 80, 150, 130, 60, 60];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageW = 792, pageH = 612, margin = 36, rowH = 16;
  const clip = (text, w, f, size) => {
    let t = String(text ?? '').replace(/\s+/g, ' ');
    while (t && f.widthOfTextAtSize(t, size) > w - 6) t = t.slice(0, -1);
    return t.length < String(text ?? '').replace(/\s+/g, ' ').length ? `${t.slice(0, -1)}…` : t;
  };
  let page; let y;
  const newPage = () => {
    page = doc.addPage([pageW, pageH]);
    y = pageH - margin;
    page.drawText('Orthodox Metrics — Parish Records Export', { x: margin, y, size: 13, font: bold, color: rgb(0.1, 0.2, 0.4) });
    y -= 16;
    if (includeSummary) {
      page.drawText(`Church ${churchId} · ${(ast.scope.recordTypes || []).join(', ')} · ${rows.length} records · ${new Date().toLocaleDateString('en-US')}`, { x: margin, y, size: 8.5, font, color: rgb(0.4, 0.4, 0.4) });
      y -= 14;
    }
    let x = margin;
    page.drawRectangle({ x: margin, y: y - 4, width: pageW - margin * 2, height: rowH, color: rgb(0.93, 0.94, 0.96) });
    headers.forEach((h, i) => { page.drawText(h, { x: x + 3, y, size: 8.5, font: bold }); x += widths[i]; });
    y -= rowH;
  };
  newPage();
  for (const r of rows) {
    if (y < margin + rowH) newPage();
    const o = rowToExportObject(r);
    let x = margin;
    headers.forEach((h, i) => { page.drawText(clip(o[h], widths[i], font, 8), { x: x + 3, y, size: 8, font }); x += widths[i]; });
    y -= rowH;
    page.drawLine({ start: { x: margin, y: y + rowH - 4 }, end: { x: pageW - margin, y: y + rowH - 4 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
  }
  const pages = doc.getPages();
  pages.forEach((pg, i) => pg.drawText(`Page ${i + 1} of ${pages.length}`, { x: pageW - margin - 60, y: margin / 2, size: 8, font, color: rgb(0.5, 0.5, 0.5) }));
  return Buffer.from(await doc.save());
}

async function exportSearch(req, { ast, format, includeQuerySummary = true, columns } = {}) {
  const executionId = randomUUID();
  await logParishSearchEvent('export_requested', {
    churchId: ast?.scope?.churchId,
    userId: req.user?.id,
    executionId,
    meta: { format },
  });
  try {
    const { rows, groups, churchId, user, ast: validated } = await fetchAllRows(req, ast);
    const fmt = String(format || 'xlsx').toLowerCase();
    let buffer;
    let contentType;
    let filename;
    if (groups) {
      if (fmt === 'csv') { buffer = await buildDuplicateCsv(groups); contentType = 'text/csv; charset=utf-8'; }
      else if (fmt === 'xml') { buffer = await buildDuplicateXml(groups, validated, churchId); contentType = 'application/xml; charset=utf-8'; }
      else { buffer = await buildDuplicateXlsx(groups, validated, churchId); contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; }
      filename = `parish-duplicates-${churchId}.${fmt === 'excel' ? 'xlsx' : fmt}`;
    } else if (fmt === 'csv') {
      buffer = await buildCsv(rows, { includeSummary: includeQuerySummary, ast: validated, churchId });
      contentType = 'text/csv; charset=utf-8';
      filename = `parish-records-${churchId}.csv`;
    } else if (fmt === 'xml') {
      buffer = await buildXml(rows, { ast: validated, churchId });
      contentType = 'application/xml; charset=utf-8';
      filename = `parish-records-${churchId}.xml`;
    } else if (fmt === 'pdf') {
      buffer = await buildPdf(rows, { includeSummary: includeQuerySummary, ast: validated, churchId });
      contentType = 'application/pdf';
      filename = `parish-records-${churchId}.pdf`;
    } else {
      buffer = await buildXlsx(rows, { includeSummary: includeQuerySummary, ast: validated, churchId });
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = `parish-records-${churchId}.xlsx`;
    }
    await logParishSearchEvent('export_completed', {
      churchId,
      userId: user?.id,
      executionId,
      meta: { format: fmt, count: groups ? groups.length : rows.length, duplicateSearch: Boolean(groups) },
    });
    return { buffer, contentType, filename, count: groups ? groups.length : rows.length, executionId, churchId };
  } catch (err) {
    await logParishSearchEvent('export_failed', {
      churchId: ast?.scope?.churchId,
      userId: req.user?.id,
      executionId,
      meta: { format, message: err.message },
    });
    throw err;
  }
}

module.exports = {
  exportSearch,
  guardSpreadsheetValue,
  buildCsv,
  buildXlsx,
  buildXml,
  buildDuplicateCsv,
  buildDuplicateXlsx,
  buildDuplicateXml,
  duplicateRecordRows,
};
