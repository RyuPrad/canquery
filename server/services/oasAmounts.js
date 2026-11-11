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
const { OAS_DATASET_ID, OAS_TABLES, periodKey, periodOf } = require('../utils/oasLabels');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MIN_ROWS = 100;
const MAX_ROWS = 5000;
const BASE_COLUMNS = Object.freeze(['benefityear', 'benefitquarter', 'incomeyear', 'income_from', 'income_to']);
// Failures of the download, not of the file: the next run tries the same version again.
const RETRYABLE = new Set(['rate_limited', 'upstream_http', 'timeout', 'error', 'gone', 'content_mismatch']);
// Any other failure is tried again this long after its last attempt: the publisher can
// repair a file, or take a notice page down, without the catalogue showing a change.
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
// How long after a quarter ends the run starts saying that the next one has not come,
// and how long a later quarter may stay incomplete before the run says so.
const OVERDUE_MS = 7 * 24 * 60 * 60 * 1000;
const INCOMPLETE_MS = 24 * 60 * 60 * 1000;

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
// with income, a table that stops before its benefit has run out. Returns the rows in
// cents, a digest of them and the table's figures.
function parseAmounts(records, { now = new Date() } = {}) {
    if (!Array.isArray(records) || !records.length) throw new OasFileError('unrecognized_layout');
    const { table, index } = tableLayout(records[0]);
    const body = records.slice(1);
    // Last lines of nothing but separators or spaces are not rows.
    while (body.length && Array.isArray(body[body.length - 1]) && body[body.length - 1].every(cell => String(cell).trim() === '')) body.pop();
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
        // A combined OAS and GIS amount below the GIS alone, or a pension that is lower
        // from age 75 than before it, is not a table to show.
        if (table !== 5 && (row.with_oas_65_cents < row.amount_cents || row.with_oas_75_cents < row.with_oas_65_cents)) {
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
    // A whole table starts with a benefit and ends where it runs out: its last band
    // holds less than the last step down. The benefit that runs out is the partner's
    // Allowance in table 4 (the GIS beside it stays level) and the table's own amount
    // in the others. A file cut short, or with its amounts blanked to 0, stops here.
    const fading = table === 4 ? 'allowance_cents' : 'amount_cents';
    if (rows[0].amount_cents === 0 || rows[0][fading] === 0) throw new OasFileError('no_amounts');
    let step = 0;
    for (let at = rows.length - 1; at > 0 && step === 0; at -= 1) step = rows[at - 1][fading] - rows[at][fading];
    if (rows[rows.length - 1][fading] >= step) {
        throw new OasFileError('table_cut', `the last band still holds ${rows[rows.length - 1][fading]} cents`);
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

// The bytes downloaded must be the file the catalogue describes: the publisher's portal
// records each file's size and MD5 when it is uploaded, and both are checked when the
// catalogue has them. A short copy, or an old one served from a cache, is a failed
// download (tried again on the next run), never a table.
function checkCopy(row, buffer) {
    const size = row.size_bytes == null ? null : Number(row.size_bytes);
    if (Number.isSafeInteger(size) && size > 0 && buffer.length !== size) {
        throw new OasFileError('content_mismatch', `${buffer.length} bytes downloaded, the catalogue says ${size}`);
    }
    const md5 = String((row.raw && row.raw.hash) || '').trim().toLowerCase();
    if (/^[0-9a-f]{32}$/.test(md5) && createHash('md5').update(buffer).digest('hex') !== md5) {
        throw new OasFileError('content_mismatch', 'the MD5 of the download is not the catalogue’s');
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
        const buffer = await fs.promises.readFile(filePath);
        checkCopy(row, buffer);
        return decodeAmounts(buffer);
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

// The publisher uploads a quarter's tables in the days before it starts and corrects
// them while it runs, so a file names the quarter its upload falls in or the one after.
// Any other quarter is a mislabelled file. The upload time is the catalogue's; the
// run's when the catalogue has none. Quarters are counted in UTC.
function fitsItsUpload(table, row, now) {
    const time = Number.isFinite(modified(row)) ? new Date(modified(row)) : now;
    const uploaded = time.getUTCFullYear() * 4 + Math.floor(time.getUTCMonth() / 3);
    const named = table.year * 4 + table.quarter - 1;
    return named === uploaded || named === uploaded + 1;
}

// Whether a remembered failure is due another attempt.
function retryDue(known, now) {
    if (RETRYABLE.has(known.failure)) return true;
    const last = Date.parse(known.at);
    return !Number.isFinite(last) || now.getTime() - last >= RETRY_AFTER_MS;
}

// The quarters whose five tables are loaded and agree on the income year: the rule of
// the view public.oas_periods, applied to the tables as a run leaves them (a dry run
// writes nothing, and says what a real one would show).
function wholeQuarters(files) {
    const quarters = new Map();
    for (const file of files) {
        if (!quarters.has(file.period_key)) quarters.set(file.period_key, []);
        quarters.get(file.period_key).push(file);
    }
    return [...quarters].filter(([, tables]) => new Set(tables.map(file => file.table_no)).size === Object.keys(OAS_TABLES).length &&
        new Set(tables.map(file => file.income_year)).size === 1).map(([key]) => key).sort((a, b) => a - b);
}

// What is wrong after a run even when no file failed in it: the run is not a success
// while any of these holds, so a quarter that is stuck keeps being reported. `live`
// says whether a loaded table still comes from its resource's present version.
function problemsOf(summary, stored, now, live) {
    const problems = [];
    if (summary.files < Object.keys(OAS_TABLES).length) problems.push(`the catalogue lists ${summary.files} CSV file(s) of the dataset, not five`);
    if (summary.waiting) problems.push(`${summary.waiting} file(s) failed earlier and wait for their next attempt`);
    if (summary.unknown.length) problems.push('a table this site does not show: ' + summary.unknown.join(', '));
    if (summary.memory_error) problems.push('what the run remembers could not be saved: ' + summary.memory_error);
    if (summary.displayed === null) problems.push('no quarter has its five tables');
    else {
        const { end } = periodOf(summary.displayed);
        if (now.getTime() - Date.parse(end + 'T23:59:59Z') > OVERDUE_MS) {
            problems.push(`the quarter shown (${summary.displayed}) ended on ${end} and no later quarter has its five tables`);
        }
    }
    for (const [period, tables] of Object.entries(summary.pending)) {
        const files = stored.filter(file => file.period_key === Number(period));
        // Tables left behind by versions the publisher has since replaced are not a quarter in progress.
        if (!files.some(live)) continue;
        const first = Math.min(...files.map(file => new Date(file.loaded_at).getTime()));
        if (now.getTime() - first <= INCOMPLETE_MS) continue;
        const years = [...new Set(files.map(file => file.income_year))].sort();
        problems.push(`quarter ${period} is not whole: it has table(s) ${tables.join(', ')}` +
            (years.length > 1 ? ', which name the income years ' + years.join(' and ') : ''));
    }
    return problems;
}

// Read every CSV of the dataset whose catalogue version is not the one loaded (one at
// a time with a pause between downloads, the least recently changed first), then place
// each file under the quarter it names. The tables of a new quarter arrive one by one
// and public.oas_periods lists the quarter once all five are in.
//
// A file is placed only when its quarter fits its upload date and is not older than
// the quarter the dataset's other files hold now: a quarter the publisher has moved on
// from is never rewritten. A file with the same rows as the ones loaded only records
// its new version, so loaded_at keeps saying when the amounts last changed. When two
// resources hold the same table of the same quarter, the one the catalogue changed
// last is loaded.
//
// A file that fails keeps the rows already loaded. A failed download is tried again on
// the next run and any other failure RETRY_AFTER_MS after its last attempt, or at once
// with force or --file. What each resource is waiting for is remembered between runs
// through deps.getMemory and deps.saveMemory.
async function runAmounts({ dryRun = false, force = false, only = null, deps, gapMs = 2000, timeoutMs = 120000, now = new Date() } = {}) {
    const resources = [...await deps.listResources()].sort((a, b) => modified(a) - modified(b) || (a.id < b.id ? -1 : 1));
    const stored = (await deps.listFiles()).map(file => ({ ...file, period_key: Number(file.period_key), table_no: Number(file.table_no),
        income_year: Number(file.income_year) }));
    const before = await deps.getMemory() || {};
    const memory = { ...before };
    const byId = new Map(resources.map(row => [row.id, row]));
    const versions = new Map(resources.map(row => [row.id, resourceVersion(row)]));
    const summary = { files: resources.length, loaded: 0, same_content: 0, unchanged: 0, failed: 0, waiting: 0, rows: 0,
        unknown: [], superseded: [], orphaned: [...new Set(stored.map(file => file.resource_id))].filter(id => !byId.has(id)),
        results: [] };
    if (only && !byId.has(only)) summary.unknown_file = only;
    const remember = (id, entry) => { memory[id] = { ...entry, at: now.toISOString() }; };
    // The loaded table a resource's present version is the source of, if any.
    const sourceOf = id => stored.find(file => file.resource_id === id && file.source_version === versions.get(id));

    // 1. The files to read: a version that is neither loaded nor waiting.
    const due = [];
    for (const row of resources) {
        if (only && row.id !== only) continue;
        const version = versions.get(row.id);
        if (!force && sourceOf(row.id)) {
            summary.unchanged += 1;
            continue;
        }
        const known = memory[row.id];
        if (!force && !only && known && known.version === version) {
            if (known.state === 'unknown_table') {
                summary.unknown.push(row.id);
                continue;
            }
            // Superseded for as long as the resource that won still holds that table.
            const winner = known.state === 'superseded' ? sourceOf(known.by) : null;
            if (winner && winner.source_version === known.by_version) {
                summary.superseded.push(row.id);
                continue;
            }
            if (known.state === 'failed' && !retryDue(known, now)) {
                summary.waiting += 1;
                summary.results.push({ resource_id: row.id, status: 'waiting', failure: known.failure, since: known.at });
                continue;
            }
        }
        due.push({ row, version });
    }

    // 2. Read them.
    for (const [position, item] of due.entries()) {
        if (position > 0) await deps.wait(gapMs);
        try {
            item.table = parseAmounts(await deps.readFile(item.row, { signal: AbortSignal.timeout(timeoutMs) }), { now });
            const named = namedTable(item.row);
            if (named !== null && named !== item.table.table) {
                throw new OasFileError('table_mismatch', `named table ${named}, holds table ${item.table.table}`);
            }
            item.fits = fitsItsUpload(item.table, item.row, now);
        } catch (error) {
            item.error = error;
        }
    }

    // 3. Place them. The newest quarter the dataset's files hold now: the quarter of
    // every loaded table whose resource has not changed since, and of every file just
    // read whose quarter fits its upload.
    const newest = Math.max(-Infinity, ...resources.map(row => sourceOf(row.id)).filter(Boolean).map(file => file.period_key),
        ...due.filter(item => item.table && item.fits).map(item => item.table.period_key));
    for (const { row, version, table, fits, error: readError } of due) {
        try {
            if (readError) throw readError;
            const current = stored.find(file => file.period_key === table.period_key && file.table_no === table.table);
            const same = !force && current && current.content_sha256 === table.hash;
            if (!same) {
                if (!fits) {
                    throw new OasFileError('implausible_period', `names ${table.year} Q${table.quarter}, ` +
                        (Number.isFinite(modified(row)) ? 'uploaded ' + new Date(modified(row)).toISOString().slice(0, 10) : 'no upload date'));
                }
                if (table.period_key < newest) {
                    throw new OasFileError('older_period', `names ${table.period_key}, the dataset’s files hold ${newest}`);
                }
            }
            // Two resources hold the same table of the same quarter: the one the catalogue
            // changed last wins. A resource that has changed or left since its table was
            // loaded no longer holds it.
            const holder = current && current.resource_id !== row.id && sourceOf(current.resource_id) === current ? byId.get(current.resource_id) : null;
            if (holder && (modified(holder) > modified(row) || (modified(holder) === modified(row) && holder.id > row.id))) {
                summary.superseded.push(row.id);
                remember(row.id, { version, state: 'superseded', by: holder.id, by_version: current.source_version });
                continue;
            }
            const result = { resource_id: row.id, table: table.table, period_key: table.period_key, income_year: table.income_year,
                status: dryRun ? (same ? 'same_content' : 'parsed') : same ? 'same_content' : 'loaded', ...table.figures };
            if (!dryRun && same) await deps.touchTable({ period_key: table.period_key, table: table.table, resource_id: row.id, version });
            if (!dryRun && !same) await deps.saveTable({ resource_id: row.id, version, table });
            if (same) summary.same_content += 1;
            else {
                summary.loaded += dryRun ? 0 : 1;
                summary.rows += table.rows.length;
            }
            const entry = { period_key: table.period_key, table_no: table.table, income_year: table.income_year, resource_id: row.id,
                source_version: version, content_sha256: table.hash, ...(same ? {} : { loaded_at: now }) };
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
    const whole = wholeQuarters(stored);
    summary.displayed = whole.length ? whole[whole.length - 1] : null;
    summary.pending = {};
    for (const file of stored) {
        if (whole.includes(file.period_key) || (summary.displayed !== null && file.period_key < summary.displayed)) continue;
        (summary.pending[file.period_key] ||= []).push(file.table_no);
    }
    for (const tables of Object.values(summary.pending)) tables.sort((a, b) => a - b);
    summary.problems = problemsOf(summary, stored, now, file => sourceOf(file.resource_id) === file);
    summary.ok = summary.failed === 0 && summary.problems.length === 0 && !summary.unknown_file;
    return summary;
}

// What a run leaves in the run log (sync_runs) and whether it succeeded: one line that
// stays the same from run to run while nothing changes, so the job can record a
// standing failure once a day instead of every hour.
function runOutcome(summary) {
    const failures = summary.results.filter(result => result.status === 'failed');
    const parts = [
        failures.length ? `${failures.length} file(s) failed: ` + failures.map(result => `${result.resource_id} ${result.failure}`).join(', ') : '',
        summary.unknown_file ? `--file ${summary.unknown_file} is not a CSV file of the OAS benefit amounts` : '',
        ...summary.problems
    ].filter(Boolean);
    return { ok: summary.ok, message: parts.length ? parts.join('; ').slice(0, 500) : null };
}

module.exports = {
    OAS_DATASET_ID, MAX_FILE_BYTES, MIN_ROWS, MAX_ROWS, RETRYABLE, RETRY_AFTER_MS, OVERDUE_MS, INCOMPLETE_MS, OasFileError,
    cents, tableLayout, parseAmounts, decodeAmounts, checkCopy, readOasFile, failureCode, namedTable, wholeQuarters, runAmounts, runOutcome
};
