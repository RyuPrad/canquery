// A CSV of exactly the rows on screen, built in the browser from the in-browser
// table. The cell rules copy the server's export
// (server/controllers/queryController.js), so both downloads read the same:
// formula-like text gets a leading apostrophe unless it is a valid negative
// number in a numeric column, DATE cells are written YYYY-MM-DD and
// timestamps in ISO UTC.

const NUMERIC_TYPE_RE =
  /^(smallint|integer|bigint|int[248]?|numeric|decimal|real|float[48]?|double( precision)?|money)$/i;
const NEGATIVE_NUMBER_RE = /^-(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

/** @param {string} value */
export function hasSpreadsheetFormulaPrefix(value) {
  const trimmed = value.trimStart();
  const leading = value.slice(0, value.length - trimmed.length);
  for (const character of leading) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return trimmed.length > 0 && '=+-@'.includes(trimmed[0]);
}

/** @param {unknown} value @param {boolean} [spreadsheetSafe] */
export function csvEscape(value, spreadsheetSafe = false) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (spreadsheetSafe && hasSpreadsheetFormulaPrefix(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

/** @param {{ type?: string }} field @param {unknown} value */
export function shouldNeutralizeCell(field, value) {
  return !(
    NUMERIC_TYPE_RE.test(String(field.type || '').trim()) && NEGATIVE_NUMBER_RE.test(String(value))
  );
}

// The JSON API sends a DATE as the ISO string of its midnight.
/** @param {{ type?: string }} field @param {unknown} value */
export function cellText(field, value) {
  if (
    typeof value === 'string' &&
    String(field.type || '')
      .trim()
      .toUpperCase() === 'DATE'
  ) {
    const match = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.0+)?Z$/.exec(value);
    if (match) return match[1];
  }
  return value;
}

/** @param {{ id: string, type?: string }[]} fields @param {unknown[][]} rows */
export function buildCsv(fields, rows) {
  const lines = [fields.map((field) => csvEscape(field.id, true)).join(',')];
  for (const row of rows) {
    lines.push(
      fields
        .map((field, index) => {
          const value = cellText(field, row[index]);
          return csvEscape(value, shouldNeutralizeCell(field, value));
        })
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

/** @param {string} resourceId */
export const csvFilename = (resourceId) =>
  'resource-' +
  String(resourceId)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100) +
  '.csv';

/** @param {string} filename @param {string} text */
export function downloadCsv(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
