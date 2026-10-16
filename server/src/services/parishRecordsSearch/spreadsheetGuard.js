/** Spreadsheet formula-injection protection for = + - @ prefixes. */
function guardSpreadsheetValue(value) {
  if (value == null) return '';
  const s = String(value);
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

module.exports = { guardSpreadsheetValue };
