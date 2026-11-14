// Per-column filter inputs accept a leading comparison operator so users can
// reach the numeric range ops the backend grammar already supports
// (gt/gte/lt/lte/eq). Bare text falls back to a case-insensitive substring
// match (contains), which is the friendly default for names and codes.
//
// The value travels to the API as a string; Postgres casts it per the column
// type, so ">2" on a numeric column and "=K1A" on a text column both work
// without us guessing types on the client.
const OP_BY_PREFIX = { '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt', '=': 'eq' };

// Longer prefixes first so ">=" is not read as ">" followed by "=".
const PREFIX_RE = /^(>=|<=|>|<|=)\s*(.+)$/;

// A value in double quotes after an operator is taken exactly as written
// inside the quotes (JSON string syntax), spaces included: `="CAD "`.
function exactValue(value) {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function parseColumnFilter(raw) {
  const text = (raw == null ? '' : String(raw)).trim();
  const match = PREFIX_RE.exec(text);
  if (match) {
    const value = match[2].trim();
    const exact = exactValue(value);
    return { op: OP_BY_PREFIX[match[1]], value: exact ?? value };
  }
  return { op: 'contains', value: text };
}

/**
 * The filter text that matches exactly one stored value. Plain when the
 * value reads back unchanged, in quotes when trimming or quotes would alter it.
 */
export function equalsFilterText(value) {
  const text = String(value);
  return text.trim() === text && text !== '' && !text.startsWith('"') ? '=' + text : '=' + JSON.stringify(text);
}

// Turn the per-column input map ({ colId: rawText }) into the API `filters`
// object, dropping blank inputs.
export function buildColumnFilters(columnFilters) {
  const filters = {};
  for (const [col, raw] of Object.entries(columnFilters || {})) {
    if (raw != null && String(raw).trim() !== '') {
      filters[col] = parseColumnFilter(raw);
    }
  }
  return filters;
}
