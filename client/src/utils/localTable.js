// A table held in the browser answers the same questions the server's table
// query does: search text, column filters, one sort column and a page. The
// rules mirror server/db/storeQueries.js and server/utils/filterGrammar.js:
// search and "contains" are a case-insensitive LIKE on each column's text, a
// filter compares typed values, NULLs sort last ascending and first
// descending, and ties keep _id order. Anything this module can't answer
// exactly (an unusual filter value, a text range filter that depends on the
// database collation) is reported as unsupported, so the caller asks the
// server or waits for the full table.

/**
 * @typedef {{ id: string, type?: string, original_label?: string }} LocalField
 * @typedef {'integer' | 'number' | 'date' | 'timestamp' | 'bool' | 'text'} Kind
 * @typedef {{ q?: string, filters?: Record<string, unknown>, sort?: string | null, offset?: number, limit?: number }} LocalQuery
 * @typedef {{ status: 'ok', fields: LocalField[], records: Record<string, unknown>[], total: number | null, available: number, complete: boolean }} LocalAnswerOk
 * @typedef {{ status: 'unsupported', reason: string }} LocalAnswerUnsupported
 * @typedef {LocalAnswerOk | LocalAnswerUnsupported} LocalAnswer
 * @typedef {{ neg: boolean, int: string, frac: string, nan: boolean }} Decimal
 * @typedef {{ fields: LocalField[], rows: unknown[][], complete: boolean }} LocalTableInput
 * @typedef {{
 *   fields: LocalField[], kinds: Kind[], rows: unknown[][], complete: boolean, rowCount: number,
 *   idIndex: number, texts: Map<number, (string | null)[]>, orders: Map<string, Int32Array>,
 *   matches: Map<string, Uint8Array | null>
 * }} LocalTable
 */

const SEARCH_EXCLUDED = new Set(['_id']);
const collator = new Intl.Collator('en-US');
const CACHE_LIMIT = 32;

/** @param {LocalField} field @returns {Kind} */
export function kindOf(field) {
  if (field.id === '_id') return 'integer';
  const type = String(field.type || '')
    .trim()
    .toLowerCase();
  if (/^(integer|int|int[248]|bigint|smallint|serial|bigserial)$/.test(type)) return 'integer';
  if (/^(numeric|decimal|real|float[48]?|double( precision)?|money|number)$/.test(type))
    return 'number';
  if (type === 'date') return 'date';
  if (/^timestamp/.test(type)) return 'timestamp';
  if (type === 'bool' || type === 'boolean') return 'bool';
  return 'text';
}

/** @param {LocalTableInput} input @returns {LocalTable} */
export function createLocalTable({ fields, rows, complete }) {
  const idIndex = fields.findIndex((field) => field.id === '_id');
  return {
    fields,
    kinds: fields.map(kindOf),
    rows,
    complete: Boolean(complete),
    rowCount: rows.length,
    idIndex,
    texts: new Map(),
    orders: new Map(),
    matches: new Map()
  };
}

/** @param {Map<string, any>} cache @param {string} key @param {any} value */
function remember(cache, key, value) {
  if (cache.size >= CACHE_LIMIT) cache.delete(/** @type {string} */ (cache.keys().next().value));
  cache.set(key, value);
}

// PostgreSQL's ::text of each value, as `ILIKE` sees it. node-pg sends a
// prepared copy's DATE as the ISO string of its midnight and TIMESTAMPTZ as
// ISO UTC; the database prints them as YYYY-MM-DD and YYYY-MM-DD HH:MM:SS+00.
/** @param {Kind} kind @param {unknown} value @returns {string | null} */
export function textForm(kind, value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (kind === 'date') return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
  if (kind === 'timestamp') {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(text);
    if (!match) return text;
    const fraction = (match[3] || '').replace(/0+$/, '');
    return match[1] + ' ' + match[2] + (fraction ? '.' + fraction : '') + '+00';
  }
  return text;
}

/** @param {LocalTable} table @param {number} column @returns {(string | null)[]} */
function columnTexts(table, column) {
  let texts = table.texts.get(column);
  if (!texts) {
    const kind = table.kinds[column];
    texts = table.rows.map((row) => textForm(kind, row[column]));
    table.texts.set(column, texts);
  }
  return texts;
}

/** @param {string} text */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// LIKE with PostgreSQL's default escape: % any run, _ one character, a
// backslash makes the next character literal. A dangling backslash is an
// error in PostgreSQL, so it is left to the server.
/** @param {string} pattern @returns {RegExp | null} */
export function likeRegExp(pattern) {
  let source = '';
  const characters = Array.from(pattern);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === '\\') {
      index += 1;
      if (index >= characters.length) return null;
      source += escapeRegExp(characters[index]);
    } else if (character === '%') source += '[\\s\\S]*';
    else if (character === '_') source += '[\\s\\S]';
    else source += escapeRegExp(character);
  }
  return new RegExp('^' + source + '$', 'iu');
}

/** @param {unknown} value @returns {Decimal | null} */
export function parseDecimal(value) {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'number' ? numberText(value) : String(value).trim();
  if (/^nan$/i.test(text)) return { neg: false, int: '', frac: '', nan: true };
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match || (match[2] === '' && (match[3] || '') === '')) return null;
  let digits = (match[2] || '') + (match[3] || '');
  let point = (match[2] || '').length + Number(match[4] || 0);
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  const int = digits.slice(0, point).replace(/^0+/, '');
  const frac = digits.slice(point).replace(/0+$/, '');
  const zero = int === '' && frac === '';
  return { neg: match[1] === '-' && !zero, int, frac, nan: false };
}

/** @param {number} value */
function numberText(value) {
  if (Number.isNaN(value)) return 'NaN';
  return Number.isFinite(value) ? String(value) : value > 0 ? '1e400' : '-1e400';
}

/** @param {Decimal} a @param {Decimal} b @returns {number} */
export function compareDecimal(a, b) {
  // PostgreSQL orders NaN above every number.
  if (a.nan || b.nan) return a.nan === b.nan ? 0 : a.nan ? 1 : -1;
  if (a.neg !== b.neg) return a.neg ? -1 : 1;
  const sign = a.neg ? -1 : 1;
  if (a.int.length !== b.int.length) return (a.int.length < b.int.length ? -1 : 1) * sign;
  if (a.int !== b.int) return (a.int < b.int ? -1 : 1) * sign;
  const length = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(length, '0');
  const fb = b.frac.padEnd(length, '0');
  if (fa === fb) return 0;
  return (fa < fb ? -1 : 1) * sign;
}

/** @param {number} year @param {number} month @param {number} day */
function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// Timestamps as epoch milliseconds. A value with no zone is UTC, as in the
// database session; hand parsing avoids Date.parse reading it as local time.
/** @param {unknown} value @returns {number | null} */
export function parseTimestamp(value) {
  if (value === null || value === undefined) return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
      String(value).trim()
    );
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!validDate(year, month, day)) return null;
  const [hour, minute, second] = [
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0)
  ];
  if (hour > 23 || minute > 59 || second > 59) return null;
  const millis = Number((match[7] || '').padEnd(3, '0').slice(0, 3) || 0);
  let offset = 0;
  const zone = match[8];
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0));
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, millis) - offset * 60000;
}

/** @param {unknown} value @returns {string | null} */
function parseDateKey(value) {
  if (value === null || value === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match || !validDate(Number(match[1]), Number(match[2]), Number(match[3]))) return null;
  return match[0];
}

/** @param {unknown} value @returns {boolean | null} */
function parseBool(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

// The filter values this module reads exactly. PostgreSQL accepts more (for
// example "Jan 5 2020", "1_000" or "+5"); those go to the server.
/** @param {Kind} kind @param {unknown} value */
function filterKey(kind, value) {
  const text = typeof value === 'number' ? numberText(value) : String(value);
  if (kind === 'integer') return /^-?\d+$/.test(text) ? parseDecimal(text) : undefined;
  if (kind === 'number')
    return /^-?(\d+(\.\d*)?|\.\d+)$/.test(text) ? parseDecimal(text) : undefined;
  if (kind === 'date')
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? (parseDateKey(text) ?? undefined) : undefined;
  if (kind === 'timestamp') return parseTimestamp(text) ?? undefined;
  if (kind === 'bool') return parseBool(text) ?? undefined;
  return text;
}

/** @param {Kind} kind @param {unknown} value */
function cellKey(kind, value) {
  if (value === null || value === undefined) return null;
  if (kind === 'integer' || kind === 'number') return parseDecimal(value);
  if (kind === 'date') return parseDateKey(value);
  if (kind === 'timestamp') return parseTimestamp(value);
  if (kind === 'bool') return parseBool(value);
  return String(value);
}

/** @param {Kind} kind @param {any} a @param {any} b @returns {number} */
function compareKeys(kind, a, b) {
  if (kind === 'integer' || kind === 'number') return compareDecimal(a, b);
  if (kind === 'timestamp') return a === b ? 0 : a < b ? -1 : 1;
  if (kind === 'bool') return a === b ? 0 : a ? 1 : -1;
  if (kind === 'date') return a === b ? 0 : a < b ? -1 : 1;
  return collator.compare(a, b);
}

/**
 * @param {Record<string, unknown> | undefined} filters
 * @returns {{ column: string, op: string, value: unknown }[]}
 */
function normalizeFilters(filters) {
  return Object.entries(filters || {}).map(([column, spec]) =>
    spec !== null && typeof spec === 'object' && !Array.isArray(spec)
      ? {
          column,
          op: String(/** @type {{ op?: unknown }} */ (spec).op),
          value: /** @type {{ value?: unknown }} */ (spec).value
        }
      : { column, op: 'eq', value: spec }
  );
}

/** @typedef {(row: number) => boolean} RowTest */

/** @param {LocalTable} table @param {{ column: string, op: string, value: unknown }} filter @returns {RowTest | string} */
function compileFilter(table, filter) {
  const column = table.fields.findIndex((field) => field.id === filter.column);
  if (column < 0 || filter.column === '_id') return 'unknown_column';
  const kind = table.kinds[column];
  if (filter.op === 'contains') {
    const pattern = likeRegExp('%' + String(filter.value ?? '') + '%');
    if (!pattern) return 'pattern';
    const texts = columnTexts(table, column);
    return (row) => {
      const text = texts[row];
      return text !== null && pattern.test(text);
    };
  }
  if (!['eq', 'lt', 'gt', 'lte', 'gte'].includes(filter.op)) return 'operator';
  if (filter.value === null) {
    if (filter.op !== 'eq') return 'operator';
    return (row) => table.rows[row][column] === null || table.rows[row][column] === undefined;
  }
  if (kind === 'text' && filter.op !== 'eq') return 'collation';
  const wanted = filterKey(kind, filter.value);
  if (wanted === undefined) return 'value';
  const op = filter.op;
  /** @param {number} order */
  const accept = (order) =>
    op === 'eq'
      ? order === 0
      : op === 'lt'
        ? order < 0
        : op === 'gt'
          ? order > 0
          : op === 'lte'
            ? order <= 0
            : order >= 0;
  if (kind === 'text')
    return (row) =>
      table.rows[row][column] !== null &&
      table.rows[row][column] !== undefined &&
      String(table.rows[row][column]) === wanted;
  const keys = table.rows.map((row) => cellKey(kind, row[column]));
  return (row) => {
    const key = keys[row];
    return key !== null && accept(compareKeys(kind, key, wanted));
  };
}

/** @param {LocalTable} table @param {string} q @param {ReturnType<typeof normalizeFilters>} filters @returns {Uint8Array | null | string} */
function matchMask(table, q, filters) {
  const key = JSON.stringify([q, filters]);
  if (table.matches.has(key)) return /** @type {Uint8Array | null} */ (table.matches.get(key));
  /** @type {RowTest[]} */
  const tests = [];
  for (const filter of filters) {
    const test = compileFilter(table, filter);
    if (typeof test === 'string') return test;
    tests.push(test);
  }
  if (q) {
    const pattern = likeRegExp('%' + q + '%');
    if (!pattern) return 'pattern';
    const columns = table.fields
      .map((field, index) => (SEARCH_EXCLUDED.has(field.id) ? -1 : index))
      .filter((index) => index >= 0);
    const texts = columns.map((column) => columnTexts(table, column));
    tests.push((row) =>
      texts.some(
        (columnText) =>
          columnText[row] !== null && pattern.test(/** @type {string} */ (columnText[row]))
      )
    );
  }
  if (!tests.length) {
    remember(table.matches, key, null);
    return null;
  }
  const mask = new Uint8Array(table.rowCount);
  for (let row = 0; row < table.rowCount; row += 1) {
    if (tests.every((test) => test(row))) mask[row] = 1;
  }
  remember(table.matches, key, mask);
  return mask;
}

// The validateSort grammar: a whole known column name, else a known column
// followed by asc or desc.
/** @param {LocalTable} table @param {string | null | undefined} sort @returns {{ column: number, desc: boolean } | null | string} */
function parseSort(table, sort) {
  const value = sort == null ? '' : String(sort).trim();
  if (!value) return null;
  const exact = table.fields.findIndex((field) => field.id === value);
  if (exact >= 0) return { column: exact, desc: false };
  const match = /^([\s\S]+?)\s+(asc|desc)$/i.exec(value);
  const column = match ? table.fields.findIndex((field) => field.id === match[1]) : -1;
  if (!match || column < 0) return 'unknown_sort';
  return { column, desc: match[2].toLowerCase() === 'desc' };
}

// Rows in sort order. Distinct values are ranked once (a categorical column
// sorts its few values, not every row), then a stable sort by rank keeps
// _id order among ties, as the server's ", _id ASC" tiebreak does.
/** @param {LocalTable} table @param {{ column: number, desc: boolean }} sort @returns {Int32Array} */
function sortedOrder(table, { column, desc }) {
  const cacheKey = column + (desc ? ':desc' : ':asc');
  const cached = table.orders.get(cacheKey);
  if (cached) return cached;
  const kind = table.kinds[column];
  const keys = table.rows.map((row) => cellKey(kind, row[column]));
  /** @type {Map<string, { key: any }>} */
  const distinct = new Map();
  const identities = keys.map((key) => {
    if (key === null) return null;
    const identity = typeof key === 'object' ? JSON.stringify(key) : String(key);
    if (!distinct.has(identity)) distinct.set(identity, { key });
    return identity;
  });
  const ordered = Array.from(distinct.entries()).sort((a, b) =>
    compareKeys(kind, a[1].key, b[1].key)
  );
  /** @type {Map<string, number>} */
  const ranks = new Map();
  let rank = 0;
  ordered.forEach(([identity, value], index) => {
    if (index > 0 && compareKeys(kind, ordered[index - 1][1].key, value.key) !== 0) rank += 1;
    ranks.set(identity, rank);
  });
  // PostgreSQL treats NULL as larger than every value: last ascending, first descending.
  const nullRank = rank + 1;
  const rowRanks = identities.map((identity) =>
    identity === null ? nullRank : /** @type {number} */ (ranks.get(identity))
  );
  const order = Array.from({ length: table.rowCount }, (_, index) => index);
  order.sort((a, b) => (desc ? rowRanks[b] - rowRanks[a] : rowRanks[a] - rowRanks[b]));
  const result = Int32Array.from(order);
  remember(table.orders, cacheKey, result);
  return result;
}

/** @param {LocalTable} table @param {number} row @returns {Record<string, unknown>} */
function recordAt(table, row) {
  /** @type {Record<string, unknown>} */
  const record = {};
  const values = table.rows[row];
  table.fields.forEach((field, index) => {
    record[field.id] = values[index] === undefined ? null : values[index];
  });
  return record;
}

/** @param {LocalTable} table @param {LocalQuery} query @returns {{ rows: number[] } | LocalAnswerUnsupported} */
function selectRows(table, { q = '', filters, sort } = {}) {
  const mask = matchMask(table, q || '', normalizeFilters(filters));
  if (typeof mask === 'string') return { status: 'unsupported', reason: mask };
  const order = parseSort(table, sort);
  if (typeof order === 'string') return { status: 'unsupported', reason: order };
  const sequence = order ? sortedOrder(table, order) : null;
  /** @type {number[]} */
  const rows = [];
  for (let position = 0; position < table.rowCount; position += 1) {
    const row = sequence ? sequence[position] : position;
    if (!mask || mask[row]) rows.push(row);
  }
  return { rows };
}

/** @param {LocalTable} table @param {LocalQuery} [query] @returns {LocalAnswer} */
export function answerLocal(table, query = {}) {
  const selected = selectRows(table, query);
  if ('status' in selected) return selected;
  const offset = Math.max(0, Number(query.offset) || 0);
  const limit = Math.max(0, Number(query.limit ?? 50));
  return {
    status: 'ok',
    fields: table.fields,
    records: selected.rows.slice(offset, offset + limit).map((row) => recordAt(table, row)),
    total: table.complete ? selected.rows.length : null,
    available: selected.rows.length,
    complete: table.complete
  };
}

// Every matching row in view order, for a download of exactly what is shown.
/** @param {LocalTable} table @param {LocalQuery} query @param {number} max @returns {{ fields: LocalField[], rows: unknown[][] } | LocalAnswerUnsupported} */
export function exportLocal(table, query, max) {
  const selected = selectRows(table, query);
  if ('status' in selected) return selected;
  return { fields: table.fields, rows: selected.rows.slice(0, max).map((row) => table.rows[row]) };
}
