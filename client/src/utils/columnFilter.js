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

export function parseColumnFilter(raw) {
  const text = (raw == null ? '' : String(raw)).trim();
  const match = PREFIX_RE.exec(text);
  if (match) {
    return { op: OP_BY_PREFIX[match[1]], value: match[2].trim() };
  }
  return { op: 'contains', value: text };
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
