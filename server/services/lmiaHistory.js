// Every quarter of the federal positive LMIA employers list (open.canada.ca dataset
// 90fed587-1364-4f33-a9ee-208181dc0b97), read from its English CSV, XLS and XLSX files
// into public.lmia_positive_rows (migration 050) by scripts/build-lmia-history.js.
// The publisher's layout changed over the years: 2014 and 2015 group employers under
// province rows, 2016 to 2019Q2 leave the grouped columns blank after their first row,
// later files repeat every column, and every file ends with numbered notes. This module
// turns any of them into the same rows; all I/O comes in through `deps`.
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { employerKey } = require('../utils/employerKey');
const { resourceVersion } = require('./resourceVersion');
const { toAbsoluteUrl } = require('../utils/resolveUrl');

const LMIA_DATASET_ID = '90fed587-1364-4f33-a9ee-208181dc0b97';
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_ROWS = 200000;
const MIN_ROWS = 100;
const NAME_LIMITS = { employer: 300, address: 300, city: 120, occupation_title: 300, stream: 80, incorporation: 80 };

class LmiaFileError extends Error {
    constructor(code, cause) {
        super(code);
        this.code = code;
        this.cause = cause;
    }
}

// ---- Periods ---------------------------------------------------------------------

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
    'november', 'december'];
const iso = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// The period a file covers, from the start of its catalogue name: "2026Q2-…" is a
// quarter, "2017Q1Q2-…" two quarters, "2016-…" a year ("…between June 20 and
// December 31, 2014…" narrows a year). key is the year and last month: 202606.
function lmiaPeriod(name) {
    const text = typeof name === 'string' ? name.trim() : '';
    let match = /^(\d{4})\s*Q([1-4])(?:\s*Q([1-4]))?(?![0-9])/i.exec(text);
    if (match) {
        const year = Number(match[1]);
        const first = Number(match[2]);
        const last = match[3] ? Number(match[3]) : first;
        if (last < first || last - first > 1) return null;
        const startMonth = first * 3 - 2;
        const endMonth = last * 3;
        return { key: year * 100 + endMonth, kind: last > first ? 'half' : 'quarter',
            start: iso(year, startMonth, 1), end: iso(year, endMonth, lastDay(year, endMonth)) };
    }
    match = /^(\d{4})(?=\s*[-–:,(]|\s*$)/.exec(text);
    if (!match) return null;
    const year = Number(match[1]);
    let start = iso(year, 1, 1);
    let end = iso(year, 12, 31);
    const range = /between\s+([a-z]+)\s+(\d{1,2})\s+and\s+([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
    if (range && Number(range[5]) === year) {
        const from = MONTHS.indexOf(range[1].toLowerCase()) + 1;
        const to = MONTHS.indexOf(range[3].toLowerCase()) + 1;
        if (from > 0 && to >= from) {
            start = iso(year, from, Math.min(Number(range[2]), lastDay(year, from)));
            end = iso(year, to, Math.min(Number(range[4]), lastDay(year, to)));
        }
    }
    return { key: year * 100 + Number(end.slice(5, 7)), kind: 'year', start, end };
}

// ---- Values ----------------------------------------------------------------------

const PROVINCES = [
    ['NL', 'Newfoundland and Labrador'], ['PE', 'Prince Edward Island'], ['NS', 'Nova Scotia'], ['NB', 'New Brunswick'],
    ['QC', 'Quebec', 'Québec'], ['ON', 'Ontario'], ['MB', 'Manitoba'], ['SK', 'Saskatchewan'], ['AB', 'Alberta'],
    ['BC', 'British Columbia'], ['YT', 'Yukon', 'Yukon Territory'], ['NT', 'Northwest Territories'], ['NU', 'Nunavut'],
    ['HO', 'Employers carrying on business in Canada with Head Office outside of Canada', 'Outside Canada',
        'Head Office outside of Canada']
];
const PROVINCE_CODES = PROVINCES.map(([code]) => code);
const PROVINCE_BY_LABEL = new Map(PROVINCES.flatMap(([code, ...labels]) =>
    [code, ...labels].map(label => [label.toLowerCase(), code])));

function provinceCode(value) {
    return PROVINCE_BY_LABEL.get(String(value || '').trim().toLowerCase()) || null;
}

// The publisher's stream names, with its stray spellings folded in.
const STREAMS = new Map([
    ['high wage', 'High Wage'], ['low wage', 'Low Wage'], ['primary agriculture', 'Primary Agriculture'],
    ['global talent stream', 'Global Talent Stream'], ['global talent', 'Global Talent Stream'],
    ['talent mondial', 'Global Talent Stream'], ['permanent resident only', 'Permanent Resident Only'],
    ['unspecified', 'Unspecified']
]);

function streamName(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    return STREAMS.get(text.toLowerCase()) || text.slice(0, NAME_LIMITS.stream);
}

// "72310-Carpenters" is NOC 2021 (five digits); "7271-Carpenters" NOC 2011.
function occupation(value) {
    const match = /^(\d{4,5})\s*-\s*(.+)$/.exec(String(value || '').trim());
    if (!match) return null;
    return { code: match[1], title: match[2].trim().slice(0, NAME_LIMITS.occupation_title), noc: match[1].length === 5 ? 2021 : 2011 };
}

// "GRAND FALLS - WINDSOR, NL A2A 2E1" is in Grand Falls - Windsor.
function cityOf(address) {
    const match = /^(.+?),\s*[A-Z]{2}\b(?:\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d)?\s*$/.exec(address || '');
    return match ? match[1].trim().slice(0, NAME_LIMITS.city) || null : null;
}

function count(value) {
    const text = String(value || '').replace(/[,\s]/g, '');
    if (!/^\d{1,7}$/.test(text)) return null;
    return Number(text);
}

const clean = value => (value === null || value === undefined ? '' : String(value)).replace(/\s+/g, ' ').trim();

// ---- Layout ----------------------------------------------------------------------

const HEADERS = {
    province: /^province/i,
    stream: /stream/i,
    employer: /^employer( name)?$/i,
    address: /^address$/i,
    occupation: /^occupa/i,
    incorporation: /incorporat/i,
    lmias: /lmias?$/i,
    positions: /positions/i
};

function headerColumns(record) {
    const columns = {};
    record.forEach((cell, index) => {
        for (const [name, pattern] of Object.entries(HEADERS)) {
            if (columns[name] === undefined && pattern.test(clean(cell))) {
                columns[name] = index;
                break;
            }
        }
    });
    return columns.employer !== undefined && columns.positions !== undefined ? columns : null;
}

function findHeader(records) {
    for (let index = 0; index < Math.min(records.length, 15); index += 1) {
        const columns = headerColumns(records[index]);
        if (columns) return { index, columns };
    }
    return null;
}

// Rows of one file in a common shape. Grouped columns (province, stream, employer
// with its address and incorporation status) carry down to the following rows;
// province rows above or inside the table set the province of files without that
// column; notes, repeated headers and stray single cells are counted and skipped.
function normalizeRecords(records) {
    const header = findHeader(records);
    if (!header) throw new LmiaFileError('unrecognized_layout');
    const { columns } = header;
    const cell = (record, name) => (columns[name] === undefined ? '' : clean(record[columns[name]]));
    const skipped = { notes: 0, sections: 0, headers: 0, other: 0, no_positions: 0, no_employer: 0 };
    let section = null;
    for (const record of records.slice(0, header.index)) {
        const cells = record.map(clean).filter(Boolean);
        if (cells.length === 1 && provinceCode(cells[0])) section = provinceCode(cells[0]);
    }
    const rows = [];
    let last = null;
    let notes = false;
    for (let index = header.index + 1; index < records.length; index += 1) {
        const record = records[index];
        const cells = record.map(clean).filter(Boolean);
        if (!cells.length) continue;
        if (notes || /^notes?\s*:?$/i.test(cells[0]) || (cells.length === 1 && /^\d+\.\s/.test(cells[0]))) {
            notes = true;
            skipped.notes += 1;
            continue;
        }
        if (cells.length === 1) {
            const code = columns.province === undefined ? provinceCode(cells[0]) : null;
            if (code) {
                section = code;
                last = null;
                skipped.sections += 1;
            } else {
                skipped.other += 1;
            }
            continue;
        }
        if (headerColumns(record)) {
            skipped.headers += 1;
            continue;
        }
        const positions = count(cell(record, 'positions'));
        if (positions === null) {
            skipped.no_positions += 1;
            continue;
        }
        const employerCell = cell(record, 'employer');
        const continued = !employerCell && last !== null;
        const employer = (employerCell || (last && last.employer) || '').slice(0, NAME_LIMITS.employer);
        const key = employerKey(employer);
        if (!employer || !key) {
            skipped.no_employer += 1;
            continue;
        }
        const address = (cell(record, 'address') || (continued ? last.address : '') || '').slice(0, NAME_LIMITS.address) || null;
        const provinceCell = cell(record, 'province');
        const role = occupation(cell(record, 'occupation'));
        const row = {
            line: index + 1,
            // A province cell that is not a province stays unknown rather than inherited.
            province: columns.province === undefined ? section : provinceCell ? provinceCode(provinceCell) : last && last.province,
            stream: columns.stream === undefined ? null : streamName(cell(record, 'stream')) || (last && last.stream) || null,
            employer,
            employer_key: key,
            address,
            city: cityOf(address),
            occupation_code: role ? role.code : null,
            occupation_title: role ? role.title : null,
            noc_version: role ? role.noc : null,
            incorporation: (cell(record, 'incorporation') || (continued ? last.incorporation : '') || '')
                .slice(0, NAME_LIMITS.incorporation) || null,
            approved_lmias: count(cell(record, 'lmias')),
            approved_positions: positions
        };
        rows.push(row);
        last = row;
    }
    return { rows, skipped, columns: Object.keys(columns) };
}

// A file is loaded only when it looks like the list: enough rows, positions, and a
// known province for nearly every row.
function fileSummary(rows) {
    const employers = new Set(rows.map(row => row.employer_key));
    const known = rows.filter(row => row.province).length;
    const nocs = new Set(rows.map(row => row.noc_version).filter(Boolean));
    const withLmias = rows.filter(row => row.approved_lmias !== null);
    return {
        row_count: rows.length,
        employers: employers.size,
        positions: rows.reduce((sum, row) => sum + row.approved_positions, 0),
        lmias: withLmias.length ? withLmias.reduce((sum, row) => sum + row.approved_lmias, 0) : null,
        noc_version: nocs.size === 1 ? [...nocs][0] : nocs.size ? Math.max(...nocs) : null,
        known_provinces: rows.length ? known / rows.length : 0
    };
}

function validate(summary) {
    if (summary.row_count < MIN_ROWS) throw new LmiaFileError('too_few_rows');
    if (summary.positions <= 0) throw new LmiaFileError('no_positions');
    if (summary.known_provinces < 0.98) throw new LmiaFileError('unknown_provinces');
}

// ---- Reading files ---------------------------------------------------------------

// The upper half of DOS code page 850, which TextDecoder does not know.
const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀' +
    'ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0';
function decodeCp850(buffer) {
    let text = '';
    for (const byte of buffer) text += byte < 0x80 ? String.fromCharCode(byte) : CP850[byte - 0x80];
    return text;
}

// How French a single-byte decoding reads: accented letters that match the case of
// the letters beside them count for it; control characters, box drawing and stray
// symbols count against it.
const IMPLAUSIBLE = /[\u0080-\u009f─-▟‚„…†‡ˆ‰‹›ƒ‗¤¦¶§÷¸¨¹³²■]/;
function plausibility(text) {
    let score = 0;
    for (const match of text.matchAll(/[^\p{ASCII}]/gu)) {
        const ch = match[0];
        const before = text[match.index - 1] || '';
        const after = text[match.index + 1] || '';
        if (IMPLAUSIBLE.test(ch)) score -= 2;
        else if (/\p{Ll}/u.test(ch)) score += /[a-z]/.test(before) || /[a-z]/.test(after) ? 1 : 0;
        else if (/\p{Lu}/u.test(ch)) {
            score += /[a-z]/.test(before) && /[a-z]/.test(after) ? -1 : /[A-Z]/.test(before) || /[A-Z]/.test(after) ? 1 : 0;
        }
    }
    return score;
}

// Newer files are UTF-8. Older CSVs are Windows-1252 (Latin-1 would turn their
// curly apostrophes into control characters), except the 2017Q4 file, which is DOS
// code page 850: the decoding that reads more plausibly wins, judged without byte
// 0xA0 (a no-break space in one, "á" in the other).
function decodeText(buffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\ufeff/, '');
    } catch {
        const windows = new TextDecoder('windows-1252').decode(buffer);
        const neutral = Buffer.from(buffer.map(byte => (byte === 0xa0 ? 0x20 : byte)));
        const dos = plausibility(decodeCp850(neutral)) > plausibility(new TextDecoder('windows-1252').decode(neutral));
        return dos ? decodeCp850(buffer) : windows;
    }
}

// What the bytes are, whatever the catalogue says: a ZIP is XLSX, an OLE compound
// file is legacy XLS, anything else is read as CSV.
function fileKind(head) {
    if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'xlsx';
    if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'xls';
    return 'csv';
}

function parseCsvText(text, delimiter = ',') {
    const { csvParseOptions } = require('./csvLoad');
    return parse(text, csvParseOptions({ delimiter, skip_empty_lines: false, to: MAX_ROWS + 50 }));
}

async function readRecords(filePath, { signal } = {}) {
    const fd = await fs.promises.open(filePath, 'r');
    let head;
    try {
        head = Buffer.alloc(65536);
        const { bytesRead } = await fd.read(head, 0, head.length, 0);
        head = head.subarray(0, bytesRead);
    } finally {
        await fd.close();
    }
    const kind = fileKind(head);
    if (kind === 'csv') {
        const { sniffCsvMetaFromBytes } = require('./csvDownload');
        const buffer = await fs.promises.readFile(filePath);
        let delimiter;
        try {
            ({ delimiter } = sniffCsvMetaFromBytes(buffer.subarray(0, 65536), buffer.length <= 65536));
        } catch (error) {
            throw new LmiaFileError('not_a_table', error);
        }
        return parseCsvText(decodeText(buffer), delimiter);
    }
    const { convertXlsxToCsv, convertXlsToCsv } = require('./xlsxConvert');
    const convert = kind === 'xlsx' ? convertXlsxToCsv : convertXlsToCsv;
    let converted;
    try {
        converted = await convert(filePath, { maxRows: MAX_ROWS, maxCols: 40, maxCsvBytes: 4 * MAX_FILE_BYTES, signal });
    } catch (error) {
        throw new LmiaFileError(error && error.code === 'EXCEL_TIMEOUT' ? 'timeout' : 'not_a_table', error);
    }
    try {
        return parseCsvText(await fs.promises.readFile(converted.csvPath, 'utf8'));
    } finally {
        await fs.promises.unlink(converted.csvPath).catch(() => {});
    }
}

// Download one file through the ingest download guard and read its rows.
async function readLmiaFile(row, { signal } = {}) {
    const { downloadToTempFile } = require('./csvDownload');
    const { filePath } = await downloadToTempFile(toAbsoluteUrl(row.url), {
        maxFileBytes: MAX_FILE_BYTES,
        userAgent: process.env.CKAN_USER_AGENT || 'canquery/1.0',
        signal
    });
    try {
        return await readRecords(filePath, { signal });
    } finally {
        await fs.promises.unlink(filePath).catch(() => {});
    }
}

function failureCode(error) {
    if (error instanceof LmiaFileError) return error.code;
    const status = error && (error.upstreamStatus || error.httpStatus);
    if (error && (error.code === 'DOWNLOAD_URL_BLOCKED' || error.code === 'DOWNLOAD_REDIRECT')) return 'blocked';
    if (error && error.code === 'CAP_FILE') return 'too_large';
    if (status === 429) return 'rate_limited';
    if (status === 404 || status === 410) return 'gone';
    if (status) return 'upstream_http';
    if (error && (error.name === 'AbortError' || error.name === 'TimeoutError' ||
        error.code === 'DOWNLOAD_RESPONSE_STALL' || error.code === 'DOWNLOAD_BODY_STALL')) return 'timeout';
    return 'error';
}

// ---- The run ---------------------------------------------------------------------

// The catalogue's English files with a period, one per period: when two resources
// claim the same period, the newer one wins and the other is reported.
function pickFiles(resources) {
    const byPeriod = new Map();
    const unparsed = [];
    const superseded = [];
    for (const row of resources) {
        const period = lmiaPeriod(row.name_en || row.name_fr || '');
        if (!period) {
            unparsed.push(row.id);
            continue;
        }
        const current = byPeriod.get(period.key);
        const newer = !current || String(row.last_modified || '') > String(current.row.last_modified || '') ||
            (String(row.last_modified || '') === String(current.row.last_modified || '') && row.id > current.row.id);
        if (newer) {
            if (current) superseded.push(current.row.id);
            byPeriod.set(period.key, { id: row.id, row, period });
        } else {
            superseded.push(row.id);
        }
    }
    const files = [...byPeriod.values()].sort((a, b) => b.period.key - a.period.key);
    return { files, unparsed, superseded };
}

// Load every file whose version changed (or every file with force), newest period
// first, one at a time with a pause between downloads. A file that fails keeps its
// last good rows. Files whose resource left the catalogue are reported, not deleted.
async function runHistory({ dryRun = false, force = false, only = null, deps, gapMs = 2000, timeoutMs = 180000 } = {}) {
    const resources = await deps.listResources();
    const stored = new Map((await deps.listFiles()).map(file => [file.resource_id, file]));
    const { files, unparsed, superseded } = pickFiles(resources);
    const summary = { files: files.length, loaded: 0, unchanged: 0, failed: 0, rows: 0, unparsed, superseded,
        orphaned: [...stored.keys()].filter(id => !resources.some(row => row.id === id)), results: [] };
    let downloads = 0;
    for (const file of files) {
        if (only && file.id !== only) continue;
        const version = resourceVersion(file.row);
        const current = stored.get(file.id);
        if (!force && current && current.source_version === version) {
            summary.unchanged += 1;
            continue;
        }
        if (downloads > 0) await deps.wait(gapMs);
        downloads += 1;
        const signal = AbortSignal.timeout(timeoutMs);
        try {
            const records = await deps.readFile(file.row, { signal });
            const { rows, skipped } = normalizeRecords(records);
            const counts = fileSummary(rows);
            validate(counts);
            const result = { resource_id: file.id, period_key: file.period.key, status: dryRun ? 'parsed' : 'loaded',
                ...counts, skipped };
            if (!dryRun) await deps.saveFile({ file, version, counts, rows });
            summary.loaded += dryRun ? 0 : 1;
            summary.rows += rows.length;
            summary.results.push(result);
        } catch (error) {
            const code = failureCode(error);
            summary.failed += 1;
            summary.results.push({ resource_id: file.id, period_key: file.period.key, status: 'failed', failure: code,
                message: String(error && error.message || error).slice(0, 200) });
            if (!dryRun) await deps.saveFailure({ file, version, failure: code });
        }
    }
    if (!dryRun && summary.loaded > 0) await deps.refreshEmployers();
    return summary;
}

module.exports = {
    LMIA_DATASET_ID, PROVINCES, PROVINCE_CODES, MAX_FILE_BYTES, LmiaFileError,
    lmiaPeriod, provinceCode, streamName, occupation, cityOf, normalizeRecords, fileSummary, validate,
    decodeText, fileKind, parseCsvText, readRecords, readLmiaFile, failureCode, pickFiles, runHistory
};
