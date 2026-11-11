// The quarterly tables of Guaranteed Income Supplement and Allowance amounts by income
// (open.canada.ca dataset dfa4daf1-669e-4514-82cd-982f27707ed0), read from the dataset's
// five CSV files into public.oas_rows (migration 054) by scripts/load-oas-amounts.js.
// Employment and Social Development Canada replaces the files in place every quarter:
// each file says which quarter it holds, and every quarter loaded stays in the tables.
// People read their benefit from these numbers, so a file is loaded only when it is
// exactly the table this module expects; anything else is refused with a code and the
// last good quarter stays. All I/O comes in through `deps`.
const fs = require('fs');
const { createHash } = require('node:crypto');
const { parse } = require('csv-parse/sync');
const { resourceVersion } = require('./resourceVersion');
const { toAbsoluteUrl } = require('../utils/resolveUrl');
const { OAS_DATASET_ID, OAS_TABLES, periodKey } = require('../utils/oasLabels');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MIN_ROWS = 100;
const MAX_ROWS = 5000;
const BASE_COLUMNS = Object.freeze(['benefityear', 'benefitquarter', 'incomeyear', 'income_from', 'income_to']);
// Failures of the download, not of the file: the next run tries the same version again.
const RETRYABLE = new Set(['rate_limited', 'upstream_http', 'timeout', 'error']);

class OasFileError extends Error {
    constructor(code, detail = '', cause = undefined) {
        super(detail ? code + ': ' + detail : code);
        this.code = code;
        this.cause = cause;
    }
}

// ---- One file ---------------------------------------------------------------------

// "1138.9" is 113890 cents: whole dollars with up to two decimals, read as text.
function cents(text) {
    const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
    return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : null;
}

// Which table a header row belongs to, and where each of its columns is. Every
// column name starts with the table's prefix (t1…t5); the columns must be exactly
// the ones the table has, in any order.
function tableLayout(header) {
    const names = (Array.isArray(header) ? header : []).map(cell => String(cell).trim().toLowerCase());
    const prefixes = new Set(names.map(name => (/^t(\d{1,2})[a-z]/.exec(name) || [])[1]));
    if (!names.length || prefixes.size !== 1 || prefixes.has(undefined)) throw new OasFileError('unrecognized_layout');
    const table = Number([...prefixes][0]);
    // A table this module has never seen is reported, never guessed at.
    if (!OAS_TABLES[table]) throw new OasFileError('unknown_table', 'table ' + table);
    const columns = [...BASE_COLUMNS, ...OAS_TABLES[table]];
    const index = {};
    for (const column of columns) index[column] = names.indexOf('t' + table + column);
    if (names.length !== columns.length || Object.values(index).includes(-1)) throw new OasFileError('unrecognized_layout');
    return { table, index };
}

// The rows of one table, from the file's records (header first). Refuses anything
// that is not one whole table of one quarter: a blank or non-numeric cell, a second
// quarter, income bands that do not follow one another from 0, an amount that rises
// with income. Returns the rows in cents, a digest of them and the table's figures.
function parseAmounts(records, { now = new Date() } = {}) {
    if (!Array.isArray(records) || !records.length) throw new OasFileError('unrecognized_layout');
    const { table, index } = tableLayout(records[0]);
    const body = records.slice(1);
    if (body.length < MIN_ROWS) throw new OasFileError('too_few_rows', String(body.length));
    if (body.length > MAX_ROWS) throw new OasFileError('too_many_rows', String(body.length));
    const width = records[0].length;
    const amounts = OAS_TABLES[table];
    let period = null;
    const rows = [];
    for (let position = 0; position < body.length; position += 1) {
        const record = body[position];
        const line = position + 1;
        if (!Array.isArray(record) || record.length !== width) throw new OasFileError('bad_row', 'line ' + line);
        const cell = name => String(record[index[name]]).trim();
        const year = /^\d{4}$/.test(cell('benefityear')) ? Number(cell('benefityear')) : null;
        const quarter = /^[1-4]$/.test(cell('benefitquarter')) ? Number(cell('benefitquarter')) : null;
        const incomeYear = /^\d{4}$/.test(cell('incomeyear')) ? Number(cell('incomeyear')) : null;
        if (year === null || quarter === null || incomeYear === null) throw new OasFileError('bad_value', 'line ' + line);
        if (period === null) period = { year, quarter, incomeYear };
        else if (period.year !== year || period.quarter !== quarter || period.incomeYear !== incomeYear) {
            throw new OasFileError('mixed_period', 'line ' + line);
        }
        const from = cents(cell('income_from'));
        const to = cents(cell('income_to'));
        const values = Object.fromEntries(amounts.map(name => [name, cents(cell(name))]));
        if (from === null || to === null || Object.values(values).includes(null)) throw new OasFileError('bad_value', 'line ' + line);
        const row = {
            line, income_from_cents: from, income_to_cents: to,
            amount_cents: table === 5 ? values.alwstotal : values.gistotal,
            allowance_cents: table === 4 ? values.alwtotal : null,
            with_oas_65_cents: table === 5 ? null : values.gistotalwithoas65,
            with_oas_75_cents: table === 5 ? null : values.gistotalwithoas75
        };
        // A combined OAS and GIS amount below the GIS alone is not a table to show.
        if (table !== 5 && (row.with_oas_65_cents < row.amount_cents || row.with_oas_75_cents < row.amount_cents)) {
            throw new OasFileError('bad_value', 'line ' + line);
        }
        const previous = rows[rows.length - 1];
        if (to < from || from !== (previous ? previous.income_to_cents + 1 : 0)) throw new OasFileError('band_gap', 'line ' + line);
        if (previous && ['amount_cents', 'allowance_cents', 'with_oas_65_cents', 'with_oas_75_cents']
            .some(name => row[name] !== null && row[name] > previous[name])) {
            throw new OasFileError('amount_increases', 'line ' + line);
        }
        rows.push(row);
    }
    if (period.year < 2000 || period.year > now.getUTCFullYear() + 1 ||
        period.incomeYear > period.year || period.incomeYear < period.year - 3) {
        throw new OasFileError('implausible_period', `${period.year} Q${period.quarter}, income ${period.incomeYear}`);
    }
    // The full OAS pension the publisher added to the GIS, when it is one amount on
    // every row; otherwise the table is kept as published and no pension is named.
    const constant = name => {
        if (table === 5) return null;
        const found = new Set(rows.map(row => row[name] - row.amount_cents));
        return found.size === 1 ? [...found][0] : null;
    };
    const hash = createHash('sha256').update(JSON.stringify([table, period.year, period.quarter, period.incomeYear,
        rows.map(row => [row.income_from_cents, row.income_to_cents, row.amount_cents, row.allowance_cents,
            row.with_oas_65_cents, row.with_oas_75_cents])])).digest('hex');
    return {
        table, year: period.year, quarter: period.quarter, income_year: period.incomeYear,
        period_key: periodKey(period.year, period.quarter), rows, hash,
        figures: {
            row_count: rows.length, max_amount_cents: rows[0].amount_cents,
            max_allowance_cents: rows[0].allowance_cents,
            // The first yearly income the table no longer lists.
            ends_at_cents: rows[rows.length - 1].income_to_cents + 1,
            oas_65_cents: constant('with_oas_65_cents'), oas_75_cents: constant('with_oas_75_cents')
        }
    };
}

// The records of a downloaded file. The publisher's files are UTF-8 with a byte-order
// mark; UTF-16 with one is read too. Text in any other encoding, a web page or an
// archive served in the file's place is refused, never guessed at.
function decodeAmounts(buffer) {
    const { sniffCsvMetaFromBytes } = require('./csvDownload');
    const { csvParseOptions } = require('./csvLoad');
    let meta;
    try {
        meta = sniffCsvMetaFromBytes(buffer.subarray(0, 65536), buffer.length <= 65536);
    } catch (error) {
        throw new OasFileError('not_a_table', '', error);
    }
    let text;
    try {
        const encoding = meta.encoding === 'utf16le' ? 'utf-16le' : meta.encoding === 'utf16be' ? 'utf-16be' : 'utf-8';
        text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch (error) {
        throw new OasFileError('not_utf8', '', error);
    }
    try {
        return parse(text, csvParseOptions({ delimiter: meta.delimiter }));
    } catch (error) {
        throw new OasFileError('not_a_table', '', error);
    }
}

// Download one file through the ingest download guard and read its records.
async function readOasFile(row, { signal } = {}) {
    const { downloadToTempFile } = require('./csvDownload');
    const { filePath } = await downloadToTempFile(toAbsoluteUrl(row.url), {
        maxFileBytes: MAX_FILE_BYTES,
        userAgent: process.env.CKAN_USER_AGENT || 'canquery/1.0',
        signal
    });
    try {
        return decodeAmounts(await fs.promises.readFile(filePath));
    } finally {
        await fs.promises.unlink(filePath).catch(() => {});
    }
}

function failureCode(error) {
    if (error instanceof OasFileError) return error.code;
    return require('./csvDownload').downloadFailureCode(error);
}

// ---- The run ----------------------------------------------------------------------

// "Table 4 - GIS and Allowance for couple" names its table; null when a name has none.
function namedTable(row) {
    const match = /^\s*table(?:au)?\s*(\d{1,2})\b/i.exec(row.name_en || row.name_fr || '');
    return match ? Number(match[1]) : null;
}

// When the catalogue last changed a resource, as a time (node-pg returns a Date).
function modified(row) {
    const time = row && row.last_modified ? new Date(row.last_modified).getTime() : NaN;
    return Number.isFinite(time) ? time : -Infinity;
}

// Load every CSV of the dataset whose catalogue version is not the one loaded, one at
// a time with a pause between downloads, the least recently changed first. Each file
// goes under the quarter it names, so the tables of a new quarter arrive one by one
// and public.oas_periods lists the quarter once all five are in. A file that fails
// keeps the rows already loaded; a failed download is tried again on the next run,
// while a file that was refused waits for a new version (or force, or --file). What
// each resource is waiting for is remembered between runs through deps.getMemory and
// deps.saveMemory. A file with the same rows as the ones loaded only records its new
// version, so loaded_at keeps saying when the amounts last changed.
async function runAmounts({ dryRun = false, force = false, only = null, deps, gapMs = 2000, timeoutMs = 120000, now = new Date() } = {}) {
    const resources = [...await deps.listResources()].sort((a, b) => modified(a) - modified(b) || (a.id < b.id ? -1 : 1));
    const stored = (await deps.listFiles()).map(file => ({ ...file, period_key: Number(file.period_key), table_no: Number(file.table_no) }));
    const before = await deps.getMemory() || {};
    const memory = { ...before };
    const byId = new Map(resources.map(row => [row.id, row]));
    const summary = { files: resources.length, loaded: 0, same_content: 0, unchanged: 0, failed: 0, waiting: 0, rows: 0,
        unknown: [], superseded: [], orphaned: [...new Set(stored.map(file => file.resource_id))].filter(id => !byId.has(id)),
        results: [] };
    if (only && !byId.has(only)) summary.unknown_file = only;
    const remember = (id, entry) => { memory[id] = { ...entry, at: now.toISOString() }; };
    let downloads = 0;
    for (const row of resources) {
        if (only && row.id !== only) continue;
        const version = resourceVersion(row);
        if (!force && stored.some(file => file.resource_id === row.id && file.source_version === version)) {
            summary.unchanged += 1;
            continue;
        }
        const known = memory[row.id];
        if (!force && !only && known && known.version === version && !(known.state === 'failed' && RETRYABLE.has(known.failure))) {
            if (known.state === 'unknown_table') summary.unknown.push(row.id);
            else if (known.state === 'superseded') summary.superseded.push(row.id);
            else summary.waiting += 1;
            continue;
        }
        if (downloads > 0) await deps.wait(gapMs);
        downloads += 1;
        try {
            const table = parseAmounts(await deps.readFile(row, { signal: AbortSignal.timeout(timeoutMs) }), { now });
            const named = namedTable(row);
            if (named !== null && named !== table.table) throw new OasFileError('table_mismatch', `named table ${named}, holds table ${table.table}`);
            const current = stored.find(file => file.period_key === table.period_key && file.table_no === table.table);
            const holder = current && current.resource_id !== row.id ? byId.get(current.resource_id) : null;
            // Two resources hold the same table of the same quarter: the one the catalogue changed last wins.
            if (holder && (modified(holder) > modified(row) || (modified(holder) === modified(row) && holder.id > row.id))) {
                summary.superseded.push(row.id);
                remember(row.id, { version, state: 'superseded' });
                continue;
            }
            const same = !force && current && current.content_sha256 === table.hash;
            const result = { resource_id: row.id, table: table.table, period_key: table.period_key, income_year: table.income_year,
                status: dryRun ? (same ? 'same_content' : 'parsed') : same ? 'same_content' : 'loaded', ...table.figures };
            if (!dryRun && same) await deps.touchTable({ period_key: table.period_key, table: table.table, resource_id: row.id, version });
            if (!dryRun && !same) await deps.saveTable({ resource_id: row.id, version, table });
            if (same) summary.same_content += 1;
            else {
                summary.loaded += dryRun ? 0 : 1;
                summary.rows += table.rows.length;
            }
            const entry = { period_key: table.period_key, table_no: table.table, resource_id: row.id, source_version: version,
                content_sha256: table.hash };
            if (current) Object.assign(current, entry);
            else stored.push(entry);
            delete memory[row.id];
            summary.results.push(result);
        } catch (error) {
            const code = failureCode(error);
            if (code === 'unknown_table') {
                summary.unknown.push(row.id);
                remember(row.id, { version, state: 'unknown_table' });
                continue;
            }
            summary.failed += 1;
            summary.results.push({ resource_id: row.id, status: 'failed', failure: code,
                message: String(error && error.message || error).slice(0, 200) });
            remember(row.id, { version, state: 'failed', failure: code });
        }
    }
    for (const id of Object.keys(memory)) if (!byId.has(id)) delete memory[id];
    // Remembering must not undo a load: a memory that cannot be saved is reported.
    if (!dryRun && JSON.stringify(memory) !== JSON.stringify(before)) {
        await deps.saveMemory(memory).catch(error => { summary.memory_error = String(error.message || error).slice(0, 200); });
    }
    // The quarter the pages show, and the tables of any later quarter that is not whole yet.
    const complete = (await deps.listPeriods()).map(period => Number(period.period_key));
    summary.displayed = complete.length ? Math.max(...complete) : null;
    summary.pending = {};
    for (const file of stored) {
        if (complete.includes(file.period_key) || (summary.displayed !== null && file.period_key < summary.displayed)) continue;
        (summary.pending[file.period_key] ||= []).push(file.table_no);
    }
    for (const tables of Object.values(summary.pending)) tables.sort((a, b) => a - b);
    return summary;
}

module.exports = {
    OAS_DATASET_ID, MAX_FILE_BYTES, MIN_ROWS, MAX_ROWS, RETRYABLE, OasFileError,
    cents, tableLayout, parseAmounts, decodeAmounts, readOasFile, failureCode, namedTable, runAmounts
};
