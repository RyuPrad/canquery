const amounts = require('../services/oasAmounts');
const { resourceVersion } = require('../services/resourceVersion');
const { OAS_TABLES, periodKey, periodOf } = require('../utils/oasLabels');

const { cents, tableLayout, parseAmounts, decodeAmounts, checkCopy, failureCode, namedTable, wholeQuarters, runAmounts, runOutcome,
    OasFileError } = amounts;
const NOW = new Date('2026-11-10T12:00:00Z');
const BASE = ['benefityear', 'benefitquarter', 'incomeyear', 'income_from', 'income_to'];
// Dollars as the publisher writes them: "1138.9", "23.99", "0".
const money = value => String(value / 100);

// A table as the publisher writes it: income bands of `step` dollars from 0, each
// amount one even step (DROP for the default table) lower than the band before, down
// to less than a step in the last band, where the benefit runs out. In table 4 that
// benefit is the Allowance; its GIS stays $5 above it. `edit(cells, line)` changes one line.
const DROP = 950;
function tableRecords(table, { rows = 120, year = 2026, quarter = 4, incomeYear = 2025, top = 113890, step = 2400,
    oas65 = 76250, oas75 = 83875, edit = null } = {}) {
    const header = [...BASE, ...OAS_TABLES[table]].map(name => 't' + table + name);
    const drop = Math.floor(top / rows) + 1;
    const body = [];
    for (let position = 0; position < rows; position += 1) {
        const amount = top - position * drop;
        const gis = table === 4 ? amount + 500 : amount;
        const cells = {
            benefityear: String(year), benefitquarter: String(quarter), incomeyear: String(incomeYear),
            income_from: money(position * step), income_to: money((position + 1) * step - 1),
            gistotal: money(gis), gistotalwithoas65: money(gis + oas65), gistotalwithoas75: money(gis + oas75),
            alwtotal: money(amount), alwstotal: money(amount)
        };
        if (edit) edit(cells, position + 1);
        body.push([...BASE, ...OAS_TABLES[table]].map(name => cells[name]));
    }
    return [header, ...body];
}
const refusal = (records, options = { now: NOW }) => {
    try {
        parseAmounts(records, options);
    } catch (error) {
        return error instanceof OasFileError ? error.code : 'thrown: ' + error.message;
    }
    return 'accepted';
};
const csv = (records, eol = '\n') => records.map(record => record.join(',')).join(eol) + eol;

describe('periods', () => {
    test('a quarter is keyed by its year and last month', () => {
        expect(periodKey(2026, 4)).toBe(202612);
        expect(periodKey(2027, 1)).toBe(202703);
        expect(periodOf(202612)).toEqual({ key: 202612, year: 2026, quarter: 4, start: '2026-10-01', end: '2026-12-31' });
        expect(periodOf(202703)).toEqual({ key: 202703, year: 2027, quarter: 1, start: '2027-01-01', end: '2027-03-31' });
        expect(periodOf('202806')).toMatchObject({ quarter: 2, start: '2028-04-01', end: '2028-06-30' });
        expect(periodOf(202611)).toBeNull();
        expect(periodOf('q4')).toBeNull();
    });
});

describe('cents', () => {
    test('reads dollars with up to two decimals as whole cents, from text', () => {
        expect(cents('1138.9')).toBe(113890);
        expect(cents('0')).toBe(0);
        expect(cents('23.99')).toBe(2399);
        expect(cents('0.49')).toBe(49);
        expect(cents('55391.99')).toBe(5539199);
        // 1901.4 is not exact in binary: the text is what counts.
        expect(cents('1901.4')).toBe(190140);
    });
    test('refuses anything that is not a plain amount', () => {
        for (const text of ['', ' ', '1,138.90', '$5', '-1', '1.234', '1.', '.5', '1e3', 'NaN', '12345678', '1 138.9']) {
            expect(cents(text)).toBeNull();
        }
    });
});

describe('tableLayout', () => {
    test('finds each table by its prefix and its columns in any order', () => {
        for (const table of [1, 2, 3, 4, 5]) {
            const header = tableRecords(table)[0];
            expect(tableLayout(header).table).toBe(table);
            expect(tableLayout([...header].reverse()).index.benefityear).toBe(header.length - 1);
        }
        expect(tableLayout([' T1BenefitYear ', 't1benefitquarter', 't1incomeyear', 't1income_from', 't1income_to', 't1gistotal',
            't1gistotalwithoas65', 't1gistotalwithoas75']).table).toBe(1);
    });
    test('refuses a header that is not exactly one table', () => {
        const header = tableRecords(1)[0];
        const code = value => { try { tableLayout(value); } catch (error) { return error.code; } return 'accepted'; };
        expect(code(header.slice(0, -1))).toBe('unrecognized_layout');
        expect(code([...header, 't1gistotalwithoas85'])).toBe('unrecognized_layout');
        expect(code([...header.slice(0, -1), 't2gistotalwithoas75'])).toBe('unrecognized_layout');
        expect(code(header.map(name => name.replace('t1', '')))).toBe('unrecognized_layout');
        expect(code(['Province', 'Employer'])).toBe('unrecognized_layout');
        expect(code([])).toBe('unrecognized_layout');
        expect(code(undefined)).toBe('unrecognized_layout');
        // Table 5's columns under table 1's prefix.
        expect(code(tableRecords(5)[0].map(name => name.replace('t5', 't1')))).toBe('unrecognized_layout');
    });
    test('a table this module has never seen is unknown, not a layout to guess', () => {
        const code = value => { try { tableLayout(value); } catch (error) { return error.code; } return 'accepted'; };
        expect(code(tableRecords(1)[0].map(name => name.replace('t1', 't6')))).toBe('unknown_table');
        expect(code(tableRecords(1)[0].map(name => name.replace('t1', 't12')))).toBe('unknown_table');
    });
});

describe('parseAmounts', () => {
    test('reads a GIS table in cents with its quarter and figures', () => {
        const parsed = parseAmounts(tableRecords(1), { now: NOW });
        expect(parsed).toMatchObject({ table: 1, year: 2026, quarter: 4, income_year: 2025, period_key: 202612 });
        expect(parsed.rows).toHaveLength(120);
        expect(parsed.rows[0]).toEqual({ line: 1, income_from_cents: 0, income_to_cents: 2399, amount_cents: 113890,
            allowance_cents: null, with_oas_65_cents: 190140, with_oas_75_cents: 197765 });
        expect(parsed.rows[119]).toMatchObject({ line: 120, income_from_cents: 285600, income_to_cents: 287999, amount_cents: 113890 - 119 * DROP });
        expect(parsed.figures).toEqual({ row_count: 120, max_amount_cents: 113890, max_allowance_cents: null,
            ends_at_cents: 288000, oas_65_cents: 76250, oas_75_cents: 83875 });
        expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);
    });
    test('table 4 carries the partner’s Allowance and table 5 only the survivor’s', () => {
        const couple = parseAmounts(tableRecords(4), { now: NOW });
        expect(couple.rows[0]).toMatchObject({ amount_cents: 114390, allowance_cents: 113890, with_oas_65_cents: 190640 });
        expect(couple.figures).toMatchObject({ max_amount_cents: 114390, max_allowance_cents: 113890 });
        const survivor = parseAmounts(tableRecords(5, { top: 172618 }), { now: NOW });
        expect(survivor.rows[0]).toEqual({ line: 1, income_from_cents: 0, income_to_cents: 2399, amount_cents: 172618,
            allowance_cents: null, with_oas_65_cents: null, with_oas_75_cents: null });
        expect(survivor.figures).toMatchObject({ oas_65_cents: null, oas_75_cents: null, max_allowance_cents: null });
    });
    test('the digest follows the rows, not the spelling of the file', () => {
        const base = parseAmounts(tableRecords(2), { now: NOW }).hash;
        const reordered = tableRecords(2).map(record => [...record].reverse());
        const padded = tableRecords(2).map(record => record.map(cell => ' ' + cell + ' '));
        expect(parseAmounts(reordered, { now: NOW }).hash).toBe(base);
        expect(parseAmounts(padded, { now: NOW }).hash).toBe(base);
        expect(parseAmounts(tableRecords(2, { top: 113891 }), { now: NOW }).hash).not.toBe(base);
        expect(parseAmounts(tableRecords(3), { now: NOW }).hash).not.toBe(base);
        expect(parseAmounts(tableRecords(2, { quarter: 3 }), { now: NOW }).hash).not.toBe(base);
    });
    test('an amount may stay level from one band to the next, but never rise', () => {
        // Table 4's GIS is one amount over its first bands, then falls.
        const level = top => tableRecords(4, { top, edit: (cells, line) => {
            if (line <= 50) Object.assign(cells, { gistotal: money(60000), gistotalwithoas65: money(60000 + 76250), gistotalwithoas75: money(60000 + 83875) });
        } });
        expect(refusal(level(60000))).toBe('accepted');
        expect(parseAmounts(level(60000), { now: NOW }).rows[49].amount_cents).toBe(60000);
        // The band after the level stretch would be higher than it.
        expect(refusal(level(113890))).toBe('amount_increases');
    });
    test('refuses a file with too few or too many rows', () => {
        expect(refusal(tableRecords(1, { rows: 99 }))).toBe('too_few_rows');
        expect(refusal(tableRecords(1, { rows: 100 }))).toBe('accepted');
        expect(refusal(tableRecords(5, { rows: 5001, top: 600000 }))).toBe('too_many_rows');
        expect(refusal([tableRecords(1)[0]])).toBe('too_few_rows');
        expect(refusal([])).toBe('unrecognized_layout');
        expect(refusal(null)).toBe('unrecognized_layout');
    });
    test('refuses a line with a missing or extra cell', () => {
        const short = tableRecords(1);
        short[40] = short[40].slice(0, -1);
        expect(refusal(short)).toBe('bad_row');
        const long = tableRecords(1);
        long[40] = [...long[40], '1'];
        expect(refusal(long)).toBe('bad_row');
    });
    test('refuses a blank or non-numeric cell wherever it is', () => {
        const edits = [
            cells => { cells.gistotal = ''; }, cells => { cells.gistotal = '1,138.90'; }, cells => { cells.income_to = 'n/a'; },
            cells => { cells.income_from = '-24'; }, cells => { cells.gistotalwithoas75 = '1977.655'; },
            cells => { cells.benefityear = '26'; }, cells => { cells.benefitquarter = '5'; }, cells => { cells.benefitquarter = 'Q4'; },
            cells => { cells.incomeyear = ''; }
        ];
        for (const change of edits) {
            expect(refusal(tableRecords(1, { edit: (cells, line) => { if (line === 77) change(cells); } }))).toBe('bad_value');
        }
        expect(refusal(tableRecords(5, { edit: (cells, line) => { if (line === 3) cells.alwstotal = ' '; } }))).toBe('bad_value');
    });
    test('refuses a combined OAS and GIS amount below the GIS alone, and a pension lower from 75 than before', () => {
        expect(refusal(tableRecords(1, { edit: (cells, line) => { if (line === 120) cells.gistotalwithoas65 = '1.00'; } }))).toBe('bad_value');
        // The two combined columns the wrong way round.
        expect(refusal(tableRecords(1, { oas65: 83875, oas75: 76250 }))).toBe('bad_value');
        expect(refusal(tableRecords(1, { oas65: 76250, oas75: 76250 }))).toBe('accepted');
    });
    test('refuses a table that stops before its benefit has run out', () => {
        // Cut after 110 bands, and cut one band short: the last band still holds a step or more.
        expect(refusal(tableRecords(1).slice(0, 111))).toBe('table_cut');
        expect(refusal(tableRecords(1).slice(0, 120))).toBe('table_cut');
        expect(refusal(tableRecords(5, { top: 172618 }).slice(0, 120))).toBe('table_cut');
        // Table 4 is followed by its Allowance: its GIS is still $5 and more in the last band.
        expect(parseAmounts(tableRecords(4), { now: NOW }).rows[119]).toMatchObject({ amount_cents: 840 + 500, allowance_cents: 840 });
        expect(refusal(tableRecords(4).slice(0, 120))).toBe('table_cut');
        // The last band may hold nothing at all, after a band that held something.
        expect(refusal(tableRecords(1, { edit: (cells, line) => {
            if (line === 120) Object.assign(cells, { gistotal: '0', gistotalwithoas65: '762.5', gistotalwithoas75: '838.75' });
        } }))).toBe('accepted');
        // One amount on every band is not a table that runs out.
        expect(refusal(tableRecords(5, { edit: cells => { cells.alwstotal = '500'; } }))).toBe('table_cut');
    });
    test('refuses a table whose amounts are all nothing', () => {
        expect(refusal(tableRecords(5, { edit: cells => { cells.alwstotal = '0'; } }))).toBe('no_amounts');
        expect(refusal(tableRecords(4, { edit: cells => { cells.alwtotal = '0'; } }))).toBe('no_amounts');
        expect(refusal(tableRecords(1, { edit: cells => {
            Object.assign(cells, { gistotal: '0', gistotalwithoas65: '762.5', gistotalwithoas75: '838.75' });
        } }))).toBe('no_amounts');
    });
    test('last lines of nothing but separators or spaces are not rows', () => {
        const base = parseAmounts(tableRecords(1), { now: NOW });
        const padded = [...tableRecords(1), ['', '', '', '', '', '', '', ''], [' '], ['']];
        expect(parseAmounts(padded, { now: NOW })).toMatchObject({ hash: base.hash, figures: base.figures });
        // The same line anywhere else is a broken row.
        const holed = tableRecords(1);
        holed.splice(60, 0, ['', '', '', '', '', '', '', '']);
        expect(refusal(holed)).toBe('bad_value');
    });
    test('refuses a file that holds more than one quarter or income year', () => {
        expect(refusal(tableRecords(1, { edit: (cells, line) => { if (line === 120) cells.benefitquarter = '3'; } }))).toBe('mixed_period');
        expect(refusal(tableRecords(1, { edit: (cells, line) => { if (line === 2) cells.benefityear = '2027'; } }))).toBe('mixed_period');
        expect(refusal(tableRecords(1, { edit: (cells, line) => { if (line === 60) cells.incomeyear = '2024'; } }))).toBe('mixed_period');
    });
    test('refuses a quarter or an income year that cannot be right', () => {
        expect(refusal(tableRecords(1, { year: 1999, incomeYear: 1998 }))).toBe('implausible_period');
        expect(refusal(tableRecords(1, { year: 2028, incomeYear: 2027 }))).toBe('implausible_period');
        expect(refusal(tableRecords(1, { year: 2027, quarter: 1, incomeYear: 2025 }))).toBe('accepted');
        expect(refusal(tableRecords(1, { incomeYear: 2027 }))).toBe('implausible_period');
        expect(refusal(tableRecords(1, { incomeYear: 2022 }))).toBe('implausible_period');
        expect(refusal(tableRecords(1, { incomeYear: 2023 }))).toBe('accepted');
        expect(refusal(tableRecords(1, { year: 2028, incomeYear: 2027 }), { now: new Date('2027-12-28T00:00:00Z') })).toBe('accepted');
    });
    test('refuses income bands that do not follow one another from 0', () => {
        const edit = change => tableRecords(1, { edit: (cells, line) => { if (line === 30) change(cells); } });
        expect(refusal(tableRecords(1, { edit: (cells, line) => { if (line === 1) cells.income_from = '1'; } }))).toBe('band_gap');
        expect(refusal(edit(cells => { cells.income_from = money(29 * 2400 + 1); }))).toBe('band_gap');
        expect(refusal(edit(cells => { cells.income_from = money(29 * 2400 - 1); }))).toBe('band_gap');
        expect(refusal(edit(cells => { cells.income_to = money(29 * 2400 - 100); }))).toBe('band_gap');
        // A band cut short leaves a gap before the next one.
        expect(refusal(edit(cells => { cells.income_to = money(30 * 2400 - 2); }))).toBe('band_gap');
        const dropped = tableRecords(1);
        dropped.splice(50, 1);
        expect(refusal(dropped)).toBe('band_gap');
    });
    test('refuses an amount that rises with income, in any amount column', () => {
        const raise = (table, name) => tableRecords(table, { edit: (cells, line) => {
            if (line === 90) cells[name] = money(cents(cells[name]) + DROP + 1);
        } });
        expect(refusal(raise(1, 'gistotal'))).toBe('amount_increases');
        expect(refusal(raise(1, 'gistotalwithoas65'))).toBe('amount_increases');
        expect(refusal(raise(1, 'gistotalwithoas75'))).toBe('amount_increases');
        expect(refusal(raise(4, 'alwtotal'))).toBe('amount_increases');
        expect(refusal(raise(5, 'alwstotal'))).toBe('amount_increases');
    });
    test('a table whose OAS pension is not one amount on every row is kept as published, without a pension', () => {
        const uneven = tableRecords(1, { edit: (cells, line) => {
            if (line >= 60) cells.gistotalwithoas65 = money(cents(cells.gistotalwithoas65) - 1);
        } });
        const parsed = parseAmounts(uneven, { now: NOW });
        expect(parsed.figures).toMatchObject({ oas_65_cents: null, oas_75_cents: 83875 });
        expect(parsed.rows[59].with_oas_65_cents).toBe(113890 - 59 * DROP + 76250 - 1);
    });
});

describe('decodeAmounts', () => {
    const records = tableRecords(1);
    const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
    test('the publisher’s form (a byte-order mark and CRLF) reads like plain text', () => {
        const published = decodeAmounts(Buffer.concat([BOM, Buffer.from(csv(records, '\r\n'))]));
        expect(published).toEqual(records);
        expect(parseAmounts(published, { now: NOW }).hash).toBe(parseAmounts(decodeAmounts(Buffer.from(csv(records))), { now: NOW }).hash);
        expect(decodeAmounts(Buffer.from(csv(records, '\r')))).toEqual(records);
    });
    test('another delimiter and UTF-16 with a byte-order mark are read', () => {
        expect(decodeAmounts(Buffer.from(records.map(record => record.join(';')).join('\n')))).toEqual(records);
        const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv(records), 'utf16le')]);
        expect(decodeAmounts(utf16)).toEqual(records);
    });
    test('text that is not UTF-8 is refused, not guessed at', () => {
        const latin1 = Buffer.concat([Buffer.from(csv(records)), Buffer.from([0x52, 0xe9, 0x73, 0x75, 0x6d, 0xe9, 0x0a])]);
        expect(() => decodeAmounts(latin1)).toThrow(expect.objectContaining({ code: 'not_utf8' }));
        // Invalid bytes after the part the sniffer reads are found too.
        const late = Buffer.concat([Buffer.from(csv(tableRecords(1, { rows: 3000, top: 400000 }))), Buffer.from([0xe9, 0x0a])]);
        expect(late.length).toBeGreaterThan(65536);
        expect(() => decodeAmounts(late)).toThrow(expect.objectContaining({ code: 'not_utf8' }));
    });
    test('a web page or an archive served in the file’s place is not a table', () => {
        expect(() => decodeAmounts(Buffer.from('<!DOCTYPE html><html><head><title>Not found</title></head><body></body></html>')))
            .toThrow(expect.objectContaining({ code: 'not_a_table' }));
        expect(() => decodeAmounts(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)])))
            .toThrow(expect.objectContaining({ code: 'not_a_table' }));
        expect(() => decodeAmounts(Buffer.from('t1benefityear,"unclosed\n2026,4\n'))).toThrow(expect.objectContaining({ code: 'not_a_table' }));
    });
});

describe('checkCopy', () => {
    const { createHash } = require('node:crypto');
    const file = Buffer.from(csv(tableRecords(1), '\r\n'));
    const md5 = createHash('md5').update(file).digest('hex');
    const code = (row, buffer = file) => {
        try {
            checkCopy(row, buffer);
        } catch (error) {
            return error instanceof OasFileError ? error.code : 'thrown: ' + error.message;
        }
        return 'accepted';
    };
    test('the download must have the size and the MD5 the catalogue records', () => {
        expect(code({ size_bytes: String(file.length), raw: { hash: md5 } })).toBe('accepted');
        expect(code({ size_bytes: file.length, raw: { hash: md5.toUpperCase() + ' ' } })).toBe('accepted');
        // A copy cut short, and a copy of the right size with other bytes.
        expect(code({ size_bytes: file.length, raw: { hash: md5 } }, file.subarray(0, file.length - 3))).toBe('content_mismatch');
        expect(code({ size_bytes: file.length + 1, raw: {} })).toBe('content_mismatch');
        const other = Buffer.from(file);
        other[other.length - 4] ^= 1;
        expect(code({ size_bytes: file.length, raw: { hash: md5 } }, other)).toBe('content_mismatch');
        expect(code({ size_bytes: null, raw: { hash: md5 } }, other)).toBe('content_mismatch');
    });
    test('a catalogue without a size or an MD5 for the file is not a reason to refuse it', () => {
        expect(code({ size_bytes: null, raw: {} })).toBe('accepted');
        expect(code({})).toBe('accepted');
        expect(code({ size_bytes: 0, raw: { hash: '' } })).toBe('accepted');
        // Another kind of digest is not compared.
        expect(code({ raw: { hash: createHash('sha256').update('other').digest('hex') } })).toBe('accepted');
    });
});

describe('failureCode and namedTable', () => {
    test('file refusals keep their code; download errors map to stable ones', () => {
        expect(failureCode(new OasFileError('band_gap', 'line 3'))).toBe('band_gap');
        expect(new OasFileError('band_gap', 'line 3').message).toBe('band_gap: line 3');
        expect(failureCode(Object.assign(new Error('blocked'), { code: 'DOWNLOAD_URL_BLOCKED' }))).toBe('blocked');
        expect(failureCode(Object.assign(new Error('big'), { code: 'CAP_FILE' }))).toBe('too_large');
        expect(failureCode(Object.assign(new Error('429'), { httpStatus: 429 }))).toBe('rate_limited');
        expect(failureCode(Object.assign(new Error('404'), { upstreamStatus: 404 }))).toBe('gone');
        expect(failureCode(Object.assign(new Error('503'), { httpStatus: 503 }))).toBe('upstream_http');
        expect(failureCode(Object.assign(new Error('late'), { name: 'TimeoutError' }))).toBe('timeout');
        expect(failureCode(new Error('socket hang up'))).toBe('error');
        expect(failureCode(new OasFileError('content_mismatch'))).toBe('content_mismatch');
    });
    test('failed downloads are tried again on the next run; a missing file and a wrong copy are failed downloads', () => {
        expect([...amounts.RETRYABLE].sort()).toEqual(['content_mismatch', 'error', 'gone', 'rate_limited', 'timeout', 'upstream_http']);
        expect(amounts.RETRY_AFTER_MS).toBe(6 * 60 * 60 * 1000);
    });
    test('a catalogue name names its table when it starts with one', () => {
        expect(namedTable({ name_en: 'Table 4 - GIS and Allowance for couple' })).toBe(4);
        expect(namedTable({ name_en: '', name_fr: 'Tableau 2 - SRG pour époux' })).toBe(2);
        expect(namedTable({ name_en: ' table 5 – Allowance for the Survivor' })).toBe(5);
        expect(namedTable({ name_en: 'GIS Tables Data Dictionnary' })).toBeNull();
        expect(namedTable({ name_en: 'Table of Amounts October to December 2026' })).toBeNull();
        expect(namedTable({})).toBeNull();
    });
});


describe('wholeQuarters', () => {
    const file = (period, table, incomeYear = 2025) => ({ period_key: period, table_no: table, income_year: incomeYear });
    test('a quarter is whole when its five tables are loaded and agree on the income year, as the view says', () => {
        const five = period => [1, 2, 3, 4, 5].map(table => file(period, table));
        expect(wholeQuarters([])).toEqual([]);
        expect(wholeQuarters([...five(202703), ...five(202612)])).toEqual([202612, 202703]);
        expect(wholeQuarters([...five(202612), ...five(202703).slice(1)])).toEqual([202612]);
        expect(wholeQuarters([...five(202612).slice(0, 4), file(202612, 5, 2024)])).toEqual([]);
    });
});

describe('runAmounts', () => {
    const resource = (table, { id = 'r' + table, modified = '2026-09-29T14:1' + table + ':00Z', name = `Table ${table} - amounts`, size = 50000 + table } = {}) =>
        ({ id, name_en: name, name_fr: name, url: `https://files.example.test/${id}.csv`, format: 'CSV', size_bytes: size,
            last_modified: modified === null ? null : new Date(modified), raw: {} });
    // The loaded tables, the job's memory and each resource's file, as the database and the publisher would hold them.
    function world(resources) {
        const state = { resources, files: [], memory: {}, contents: new Map(), reads: [], saved: [], touched: [], waits: [], memorySaves: 0, clock: NOW };
        const deps = {
            listResources: async () => state.resources,
            listFiles: async () => state.files.map(file => ({ ...file, period_key: String(file.period_key) })),
            getMemory: async () => JSON.parse(JSON.stringify(state.memory)),
            saveMemory: async memory => { state.memory = JSON.parse(JSON.stringify(memory)); state.memorySaves += 1; },
            readFile: async (row, options) => {
                state.reads.push(row.id);
                expect(options.signal).toBeInstanceOf(AbortSignal);
                const content = state.contents.get(row.id);
                if (content instanceof Error) throw content;
                return content;
            },
            saveTable: async ({ resource_id: id, version, table }) => {
                state.saved.push(`${id}:${table.period_key}:${table.table}`);
                state.files = state.files.filter(file => !(file.period_key === table.period_key && file.table_no === table.table));
                state.files.push({ period_key: table.period_key, table_no: table.table, income_year: table.income_year, resource_id: id,
                    source_version: version, content_sha256: table.hash, loaded_at: state.clock });
            },
            touchTable: async ({ period_key: period, table, resource_id: id, version }) => {
                state.touched.push(`${id}:${period}:${table}`);
                Object.assign(state.files.find(file => file.period_key === period && file.table_no === table), { resource_id: id, source_version: version });
            },
            wait: async ms => { state.waits.push(ms); }
        };
        // A run at a given time (the tables it saves are loaded then).
        const run = (time = NOW, options = {}) => {
            state.clock = new Date(time);
            return runAmounts({ deps, now: state.clock, ...options });
        };
        return { state, deps, run };
    }
    function quarter(options = {}) {
        const resources = [1, 2, 3, 4, 5].map(table => resource(table));
        const built = world(resources);
        for (const table of [1, 2, 3, 4, 5]) built.state.contents.set('r' + table, tableRecords(table, options));
        return built;
    }
    // The publisher replaces a file: new bytes, and the catalogue shows a new time.
    function replace(state, table, options, modified) {
        state.resources = state.resources.map(row => (row.id === 'r' + table ? { ...row, last_modified: new Date(modified) } : row));
        state.contents.set('r' + table, options instanceof Error ? options : tableRecords(table, options));
    }
    const NEXT = { year: 2027, quarter: 1, incomeYear: 2025, top: 115000 };
    const hashOf = (state, period, table) => state.files.find(file => file.period_key === period && file.table_no === table).content_sha256;
    const failures = summary => summary.results.filter(result => result.status === 'failed').map(result => result.resource_id + ' ' + result.failure);

    test('loads the five tables of a quarter, the least recently changed first, then finds nothing to do', async () => {
        const { state, run } = quarter();
        state.resources = [...state.resources].reverse();
        const first = await run();
        expect(first).toMatchObject({ files: 5, loaded: 5, unchanged: 0, failed: 0, waiting: 0, rows: 600, displayed: 202612, pending: {},
            problems: [], ok: true });
        expect(state.reads).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
        expect(state.saved).toEqual(['r1:202612:1', 'r2:202612:2', 'r3:202612:3', 'r4:202612:4', 'r5:202612:5']);
        expect(state.waits).toEqual([2000, 2000, 2000, 2000]);
        expect(first.results[0]).toMatchObject({ resource_id: 'r1', table: 1, period_key: 202612, income_year: 2025, status: 'loaded',
            row_count: 120, max_amount_cents: 113890, ends_at_cents: 288000 });
        expect(state.files.find(file => file.table_no === 3).source_version).toBe(resourceVersion(state.resources.find(row => row.id === 'r3')));
        expect(state.memorySaves).toBe(0);

        const second = await run();
        expect(second).toMatchObject({ loaded: 0, unchanged: 5, failed: 0, displayed: 202612, results: [], problems: [], ok: true });
        expect(state.reads).toHaveLength(5);
        expect(state.waits).toHaveLength(4);
    });

    test('a new quarter arrives table by table: the quarter shown changes only when all five are in', async () => {
        const { state, run } = quarter();
        await run();
        for (const table of [1, 2, 3]) replace(state, table, NEXT, '2026-12-29T15:0' + table + ':00Z');
        const partial = await run('2026-12-29T16:00:00Z', { gapMs: 10 });
        expect(partial).toMatchObject({ loaded: 3, unchanged: 2, displayed: 202612, pending: { 202703: [1, 2, 3] }, problems: [], ok: true });
        expect(state.waits.slice(-2)).toEqual([10, 10]);
        // The old quarter's tables stay.
        expect(state.files.filter(file => file.period_key === 202612)).toHaveLength(5);

        for (const table of [4, 5]) replace(state, table, NEXT, '2026-12-29T17:0' + table + ':00Z');
        const whole = await run('2026-12-29T18:00:00Z');
        expect(whole).toMatchObject({ loaded: 2, unchanged: 3, displayed: 202703, pending: {}, ok: true });
        expect(state.files).toHaveLength(10);
    });

    test('the same rows published again only record where they came from; --force loads them anyway', async () => {
        const { state, run } = quarter();
        await run();
        replace(state, 2, {}, '2026-10-05T09:00:00Z');
        const again = await run();
        expect(again).toMatchObject({ loaded: 0, same_content: 1, unchanged: 4, rows: 0, failed: 0, ok: true });
        expect(again.results).toEqual([expect.objectContaining({ resource_id: 'r2', status: 'same_content' })]);
        expect(state.touched).toEqual(['r2:202612:2']);
        expect(state.saved).toHaveLength(5);
        expect((await run()).unchanged).toBe(5);

        const forced = await run(NOW, { force: true });
        expect(forced).toMatchObject({ loaded: 5, same_content: 0, unchanged: 0, ok: true });
        expect(state.saved).toHaveLength(10);
        expect(state.touched).toHaveLength(1);
    });

    test('the same rows uploaded again in a later quarter are still only a new version', async () => {
        const { state, run } = quarter();
        await run();
        // The publisher uploads the October table again in February: nothing new, and nothing to refuse.
        replace(state, 2, {}, '2027-02-10T09:00:00Z');
        const again = await run('2027-02-10T10:00:00Z');
        expect(again).toMatchObject({ loaded: 0, same_content: 1, failed: 0 });
        expect(state.touched).toEqual(['r2:202612:2']);
    });

    test('a corrected file of the same quarter replaces its table', async () => {
        const { state, run } = quarter();
        await run();
        replace(state, 5, { top: 113900 }, '2026-10-20T09:00:00Z');
        const corrected = await run();
        expect(corrected).toMatchObject({ loaded: 1, same_content: 0, unchanged: 4, displayed: 202612, ok: true });
        expect(state.saved[state.saved.length - 1]).toBe('r5:202612:5');
        expect(state.files).toHaveLength(5);
    });

    test('a download that fails is tried again on the next run', async () => {
        for (const [error, code] of [
            [Object.assign(new Error('upstream 503'), { httpStatus: 503 }), 'upstream_http'],
            // A file that is missing for a moment while the publisher replaces it.
            [Object.assign(new Error('upstream 404'), { httpStatus: 404 }), 'gone'],
            // A copy that is not the file the catalogue describes.
            [new OasFileError('content_mismatch', '500 bytes downloaded, the catalogue says 50003'), 'content_mismatch']
        ]) {
            const { state, run } = quarter();
            state.contents.set('r3', error);
            const failed = await run();
            expect(failed).toMatchObject({ loaded: 4, failed: 1, displayed: null, pending: { 202612: [1, 2, 4, 5] }, ok: false });
            expect(failed.results.find(result => result.status === 'failed')).toEqual({ resource_id: 'r3', status: 'failed',
                failure: code, message: error.message });
            expect(state.memory.r3).toEqual({ version: resourceVersion(state.resources[2]), state: 'failed', failure: code, at: NOW.toISOString() });
            expect(state.memorySaves).toBe(1);

            state.contents.set('r3', tableRecords(3));
            const retried = await run('2026-11-10T13:00:00Z');
            expect(retried).toMatchObject({ loaded: 1, unchanged: 4, failed: 0, waiting: 0, displayed: 202612, problems: [], ok: true });
            expect(state.memory).toEqual({});
            expect(state.reads.filter(id => id === 'r3')).toHaveLength(2);
        }
    });

    test('a refused file keeps the loaded quarter and is tried again six hours later, or at once when asked for', async () => {
        const { state, run } = quarter();
        await run();
        const broken = { ...NEXT, edit: (cells, line) => { if (line === 9) cells.gistotal = ''; } };
        replace(state, 1, broken, '2026-12-29T15:00:00Z');
        const refused = await run('2026-12-29T16:00:00Z');
        expect(refused).toMatchObject({ loaded: 0, failed: 1, unchanged: 4, displayed: 202612, pending: {}, ok: false });
        expect(refused.results[0]).toMatchObject({ resource_id: 'r1', status: 'failed', failure: 'bad_value', message: 'bad_value: line 9' });
        expect(state.files.find(file => file.table_no === 1)).toMatchObject({ period_key: 202612, resource_id: 'r1' });

        // Until then the run says what it is waiting for, and is not a success.
        const waiting = await run('2026-12-29T21:59:00Z');
        expect(waiting).toMatchObject({ loaded: 0, failed: 0, waiting: 1, unchanged: 4, ok: false,
            problems: ['1 file(s) failed earlier and wait for their next attempt'] });
        expect(waiting.results).toEqual([{ resource_id: 'r1', status: 'waiting', failure: 'bad_value', since: '2026-12-29T16:00:00.000Z' }]);
        expect(state.reads.filter(id => id === 'r1')).toHaveLength(2);

        const again = await run('2026-12-29T22:00:00Z');
        expect(again).toMatchObject({ failed: 1, waiting: 0 });
        expect(state.memory.r1.at).toBe('2026-12-29T22:00:00.000Z');
        expect(state.reads.filter(id => id === 'r1')).toHaveLength(3);
        expect(await run('2026-12-30T03:59:00Z')).toMatchObject({ failed: 0, waiting: 1 });

        // --file tries the refused version again at once; so does --force.
        expect(await run('2026-12-30T04:00:00Z', { only: 'r1' })).toMatchObject({ failed: 1, waiting: 0 });
        expect(await run('2026-12-30T04:01:00Z', { force: true })).toMatchObject({ failed: 1, loaded: 4 });
        expect(state.reads.filter(id => id === 'r1')).toHaveLength(5);

        // The publisher fixes the file: the new version is read on the next run.
        replace(state, 1, NEXT, '2026-12-30T09:00:00Z');
        const fixed = await run('2026-12-30T09:30:00Z');
        expect(fixed).toMatchObject({ loaded: 1, failed: 0, waiting: 0, pending: { 202703: [1] }, ok: true });
        expect(state.memory).toEqual({});
    });

    test('a file that still names the quarter the others have left is refused, whatever the order', async () => {
        for (const firstUploaded of [3, 1]) {
            const { state, run } = quarter();
            await run();
            const before = hashOf(state, 202612, 3);
            // Table 3 holds the January amounts under the October label.
            for (const table of [1, 2, 3, 4, 5]) {
                replace(state, table, table === 3 ? { top: 115000 } : NEXT, `2026-12-29T15:0${table === firstUploaded ? 0 : table}:00Z`);
            }
            const summary = await run('2026-12-29T16:00:00Z');
            expect(summary).toMatchObject({ loaded: 4, failed: 1, displayed: 202612, pending: { 202703: [1, 2, 4, 5] }, ok: false });
            expect(summary.results.find(result => result.status === 'failed')).toMatchObject({ resource_id: 'r3', failure: 'older_period',
                message: 'older_period: names 202612, the dataset’s files hold 202703' });
            // The quarter on the pages keeps its own table 3.
            expect(hashOf(state, 202612, 3)).toBe(before);
            // The publisher corrects the label: the quarter becomes whole.
            replace(state, 3, NEXT, '2026-12-30T09:00:00Z');
            expect(await run('2026-12-30T09:30:00Z')).toMatchObject({ loaded: 1, failed: 0, displayed: 202703, pending: {}, ok: true });
            expect(hashOf(state, 202612, 3)).toBe(before);
        }
    });

    test('a file whose quarter does not fit its upload is refused and does not stop the others', async () => {
        const { state, run } = quarter();
        await run();
        const before = state.files.map(file => file.content_sha256).join();
        // Uploaded in the last days of December 2026: October to December 2026 or January to March 2027 only.
        for (const table of [1, 2, 4, 5]) replace(state, table, NEXT, '2026-12-29T15:0' + table + ':00Z');
        replace(state, 3, { year: 2027, quarter: 4, incomeYear: 2026, top: 115000 }, '2026-12-29T15:03:00Z');
        const summary = await run('2026-12-29T16:00:00Z');
        expect(summary).toMatchObject({ loaded: 4, failed: 1, displayed: 202612, pending: { 202703: [1, 2, 4, 5] } });
        expect(failures(summary)).toEqual(['r3 implausible_period']);
        expect(summary.results.find(result => result.status === 'failed').message).toBe('implausible_period: names 2027 Q4, uploaded 2026-12-29');
        expect(state.files.filter(file => file.period_key === 202712)).toEqual([]);

        // Five January files that say January to March 2026: none is loaded.
        const stale = quarter();
        await stale.run();
        for (const table of [1, 2, 3, 4, 5]) replace(stale.state, table, { year: 2026, quarter: 1, incomeYear: 2024, top: 115000 }, '2026-12-29T15:0' + table + ':00Z');
        const refused = await stale.run('2026-12-29T16:00:00Z');
        expect(refused).toMatchObject({ loaded: 0, failed: 5, displayed: 202612, pending: {} });
        expect(new Set(refused.results.map(result => result.failure))).toEqual(new Set(['implausible_period']));
        expect(stale.state.files.map(file => file.content_sha256).join()).toBe(before);
    });

    test('a file with no upload date in the catalogue is judged by the day of the run', async () => {
        const { state, run } = quarter();
        state.resources = state.resources.map(row => ({ ...row, last_modified: null }));
        expect(await run('2026-11-10T12:00:00Z')).toMatchObject({ loaded: 5, failed: 0, displayed: 202612 });
        const late = quarter();
        late.state.resources = late.state.resources.map(row => ({ ...row, last_modified: null }));
        expect(await late.run('2027-04-02T12:00:00Z')).toMatchObject({ loaded: 0, failed: 5, displayed: null });
    });

    test('a mislabelled file that was loaded as a later quarter does not stop its correction', async () => {
        const { state, run } = quarter();
        await run();
        // In November a corrected table 2 is uploaded under next quarter's label, then again under the right one.
        replace(state, 2, { ...NEXT, top: 113900 }, '2026-11-20T09:00:00Z');
        expect(await run('2026-11-20T09:30:00Z')).toMatchObject({ loaded: 1, displayed: 202612, pending: { 202703: [2] } });
        replace(state, 2, { top: 113900 }, '2026-11-21T09:00:00Z');
        const corrected = await run('2026-11-21T09:30:00Z');
        expect(corrected).toMatchObject({ loaded: 1, failed: 0, displayed: 202612, pending: { 202703: [2] }, ok: true });
        expect(state.saved[state.saved.length - 1]).toBe('r2:202612:2');
        // The table left under the later quarter belongs to no file any more: it is not a quarter in progress.
        expect(await run('2026-11-25T09:30:00Z')).toMatchObject({ unchanged: 5, problems: [], ok: true });
    });

    test('a file whose name and header disagree about the table is refused', async () => {
        const { state, run } = quarter();
        state.contents.set('r2', tableRecords(1));
        const summary = await run();
        expect(summary).toMatchObject({ loaded: 4, failed: 1 });
        expect(summary.results.find(result => result.status === 'failed')).toMatchObject({ resource_id: 'r2', failure: 'table_mismatch' });
        expect(state.files.filter(file => file.table_no === 1)).toHaveLength(1);
        expect(state.files.find(file => file.table_no === 1).resource_id).toBe('r1');
    });

    test('a file without a table in its name is read by its header', async () => {
        const { state, run } = quarter();
        state.resources = state.resources.map(row => (row.id === 'r4' ? { ...row, name_en: 'GIS and Allowance for couple', name_fr: '' } : row));
        expect(await run()).toMatchObject({ loaded: 5, failed: 0, displayed: 202612 });
    });

    test('a sixth table is never loaded or read twice, and every run says it is there', async () => {
        const { state, run } = quarter();
        state.resources = [...state.resources, resource(6, { id: 'r6', name: 'Table 6 - something new', modified: '2026-09-29T14:20:00Z' })];
        state.contents.set('r6', tableRecords(1).map((record, index) => (index ? record : record.map(name => name.replace('t1', 't6')))));
        const first = await run();
        expect(first).toMatchObject({ files: 6, loaded: 5, failed: 0, unknown: ['r6'], displayed: 202612, ok: false,
            problems: ['a table this site does not show: r6'] });
        expect(state.memory.r6).toMatchObject({ state: 'unknown_table' });
        const second = await run();
        expect(second).toMatchObject({ unchanged: 5, failed: 0, waiting: 0, unknown: ['r6'], ok: false });
        expect(state.reads.filter(id => id === 'r6')).toHaveLength(1);
    });

    test('two resources with the same table of a quarter: the one changed last wins, whatever the order', async () => {
        const { state, run } = quarter();
        await run();
        // An older copy appears under another id: it never replaces the newer one and is not read twice.
        state.resources = [...state.resources, resource(1, { id: 'a-old', modified: '2026-09-01T00:00:00Z' })];
        state.contents.set('a-old', tableRecords(1, { top: 100000 }));
        const older = await run();
        expect(older).toMatchObject({ loaded: 0, superseded: ['a-old'], failed: 0, ok: true });
        expect(state.memory['a-old']).toMatchObject({ state: 'superseded', by: 'r1', by_version: resourceVersion(state.resources[0]) });
        expect(state.files.find(file => file.table_no === 1).resource_id).toBe('r1');
        expect((await run()).superseded).toEqual(['a-old']);
        expect(state.reads.filter(id => id === 'a-old')).toHaveLength(1);

        // A newer copy under another id replaces it, and the others are then the superseded ones.
        state.resources = [...state.resources, resource(1, { id: 'z-new', modified: '2026-10-15T00:00:00Z' })];
        state.contents.set('z-new', tableRecords(1, { top: 113895 }));
        const newer = await run();
        expect(newer).toMatchObject({ loaded: 1, failed: 0, superseded: ['a-old'] });
        expect(state.files.find(file => file.table_no === 1).resource_id).toBe('z-new');
        const settled = await run();
        expect(settled).toMatchObject({ loaded: 0, unchanged: 5, failed: 0 });
        expect([...settled.superseded].sort()).toEqual(['a-old', 'r1']);
        expect(state.memory.r1).toMatchObject({ state: 'superseded', by: 'z-new' });
        const quiet = await run();
        expect(quiet).toMatchObject({ loaded: 0, unchanged: 5, same_content: 0, ok: true });
        expect([...quiet.superseded].sort()).toEqual(['a-old', 'r1']);
        expect(state.reads.filter(id => id === 'r1')).toHaveLength(2);
        expect(state.reads.filter(id => id === 'a-old')).toHaveLength(2);
        expect(state.files.find(file => file.table_no === 1).resource_id).toBe('z-new');
        expect(state.files).toHaveLength(5);

        // The newest copy is withdrawn: the table goes back to the newest file that is left.
        const original = parseAmounts(tableRecords(1), { now: NOW }).hash;
        state.resources = state.resources.filter(row => row.id !== 'z-new');
        const withdrawn = await run();
        expect(withdrawn).toMatchObject({ failed: 0, orphaned: ['z-new'] });
        expect(state.files.find(file => file.table_no === 1)).toMatchObject({ resource_id: 'r1', content_sha256: original });
        const after = await run();
        expect(after).toMatchObject({ loaded: 0, failed: 0, superseded: ['a-old'], orphaned: [], ok: true });
        expect(state.files.find(file => file.table_no === 1)).toMatchObject({ resource_id: 'r1', content_sha256: original });
        expect((await run()).results).toEqual([]);
    });

    test('a resource that has changed since its table was loaded no longer holds that table', async () => {
        const { state, run } = quarter();
        await run();
        // Table 1's own file is replaced by one that cannot be read; a copy uploaded before that, but
        // after the rows that are loaded, appears under another id.
        replace(state, 1, { edit: (cells, line) => { if (line === 4) cells.income_to = ''; } }, '2026-10-20T09:00:00Z');
        state.resources = [...state.resources, resource(1, { id: 'c-copy', modified: '2026-10-10T09:00:00Z' })];
        state.contents.set('c-copy', tableRecords(1, { top: 113895 }));
        const summary = await run('2026-10-20T10:00:00Z');
        expect(summary).toMatchObject({ loaded: 1, failed: 1, superseded: [] });
        expect(failures(summary)).toEqual(['r1 bad_value']);
        expect(state.files.find(file => file.table_no === 1)).toMatchObject({ resource_id: 'c-copy',
            content_sha256: parseAmounts(tableRecords(1, { top: 113895 }), { now: NOW }).hash });
        // The file is repaired: it is the newest again.
        replace(state, 1, { top: 113900 }, '2026-10-21T09:00:00Z');
        expect(await run('2026-10-21T10:00:00Z')).toMatchObject({ loaded: 1, failed: 0 });
        expect(state.files.find(file => file.table_no === 1).resource_id).toBe('r1');
    });

    test('a copy of an earlier quarter under a new resource does not rewrite it once the files have moved on', async () => {
        const { state, run } = quarter();
        await run();
        const before = hashOf(state, 202612, 1);
        for (const table of [1, 2, 3, 4, 5]) replace(state, table, NEXT, '2026-12-29T15:0' + table + ':00Z');
        state.resources = [...state.resources, resource(1, { id: 'x-fix', modified: '2026-12-29T15:30:00Z' })];
        state.contents.set('x-fix', tableRecords(1, { top: 113000 }));
        const summary = await run('2026-12-29T16:00:00Z');
        expect(summary).toMatchObject({ loaded: 5, failed: 1, displayed: 202703 });
        expect(failures(summary)).toEqual(['x-fix older_period']);
        expect(hashOf(state, 202612, 1)).toBe(before);
    });

    test('a dry run reads and reports but writes nothing, and says what a real run would show', async () => {
        const { state, run } = quarter();
        state.contents.set('r5', Object.assign(new Error('gone'), { httpStatus: 404 }));
        const summary = await run(NOW, { dryRun: true });
        expect(summary).toMatchObject({ loaded: 0, failed: 1, rows: 480, displayed: null, pending: { 202612: [1, 2, 3, 4] } });
        expect(summary.results.filter(result => result.status === 'parsed')).toHaveLength(4);
        expect(state.saved).toEqual([]);
        expect(state.touched).toEqual([]);
        expect(state.memorySaves).toBe(0);
        expect(state.files).toEqual([]);

        // With all five readable, the dry run names the quarter a real run would show.
        state.contents.set('r5', tableRecords(5));
        const whole = await run(NOW, { dryRun: true });
        expect(whole).toMatchObject({ loaded: 0, failed: 0, rows: 600, displayed: 202612, pending: {}, problems: [], ok: true });
        expect(state.files).toEqual([]);
        // And of a new quarter beside a loaded one.
        await run();
        for (const table of [1, 2, 3, 4, 5]) replace(state, table, NEXT, '2026-12-29T15:0' + table + ':00Z');
        expect(await run('2026-12-29T16:00:00Z', { dryRun: true })).toMatchObject({ loaded: 0, rows: 600, displayed: 202703, pending: {} });
        expect(state.files).toHaveLength(5);
    });

    test('resources that left the catalogue are reported and forgotten; --file names an unknown file', async () => {
        const { state, run } = quarter();
        state.contents.set('r5', tableRecords(5, { edit: (cells, line) => { if (line === 2) cells.alwstotal = 'x'; } }));
        await run();
        expect(Object.keys(state.memory)).toEqual(['r5']);
        state.resources = state.resources.filter(row => !['r4', 'r5'].includes(row.id));
        const summary = await run();
        expect(summary).toMatchObject({ files: 3, unchanged: 3, orphaned: ['r4'], ok: false });
        expect(summary.problems).toEqual(['the catalogue lists 3 CSV file(s) of the dataset, not five', 'no quarter has its five tables']);
        expect(state.memory).toEqual({});
        const unknown = await run(NOW, { only: 'nope' });
        expect(unknown).toMatchObject({ unknown_file: 'nope', ok: false });
        expect(runOutcome(unknown).message).toContain('--file nope is not a CSV file of the OAS benefit amounts');
    });

    test('a memory that cannot be saved is reported and does not undo the loads', async () => {
        const { state, deps, run } = quarter();
        state.contents.set('r1', Object.assign(new Error('slow'), { name: 'TimeoutError' }));
        deps.saveMemory = async () => { throw new Error('permission denied for table sync_progress'); };
        const summary = await run();
        expect(summary).toMatchObject({ loaded: 4, failed: 1, memory_error: 'permission denied for table sync_progress', ok: false });
        expect(summary.problems).toContain('what the run remembers could not be saved: permission denied for table sync_progress');
        expect(state.saved).toHaveLength(4);
        // Without a failure in the run itself, it is still not a success.
        state.contents.set('r1', tableRecords(1));
        state.resources = [...state.resources, resource(6, { id: 'r6', name: 'Table 6', modified: '2026-09-29T14:20:00Z' })];
        state.contents.set('r6', tableRecords(1).map((record, index) => (index ? record : record.map(name => name.replace('t1', 't6')))));
        expect(await run()).toMatchObject({ loaded: 1, failed: 0, ok: false, memory_error: 'permission denied for table sync_progress' });
    });

    test('a table that cannot be saved is a failure of that file only', async () => {
        const { state, deps, run } = quarter();
        const save = deps.saveTable;
        deps.saveTable = async input => {
            if (input.table.table === 2) throw new Error('deadlock detected');
            return save(input);
        };
        const summary = await run();
        expect(summary).toMatchObject({ loaded: 4, failed: 1 });
        expect(state.memory.r2).toMatchObject({ state: 'failed', failure: 'error' });
        expect(summary.pending).toEqual({ 202612: [1, 3, 4, 5] });
    });

    test('a quarter shown a week after it ended is a standing problem', async () => {
        const { run } = quarter();
        await run();
        expect(await run('2027-01-07T12:00:00Z')).toMatchObject({ unchanged: 5, problems: [], ok: true });
        const overdue = await run('2027-01-08T00:00:00Z');
        expect(overdue).toMatchObject({ unchanged: 5, failed: 0, ok: false,
            problems: ['the quarter shown (202612) ended on 2026-12-31 and no later quarter has its five tables'] });
        expect(runOutcome(overdue)).toEqual({ ok: false,
            message: 'the quarter shown (202612) ended on 2026-12-31 and no later quarter has its five tables' });
    });

    test('a later quarter that stays incomplete for a day is a standing problem', async () => {
        const { state, run } = quarter();
        await run();
        for (const table of [1, 2, 3]) replace(state, table, NEXT, '2026-12-29T15:0' + table + ':00Z');
        await run('2026-12-29T16:00:00Z');
        expect(await run('2026-12-30T16:00:00Z')).toMatchObject({ problems: [], ok: true });
        const stuck = await run('2026-12-30T16:00:01Z');
        expect(stuck).toMatchObject({ displayed: 202612, ok: false, problems: ['quarter 202703 is not whole: it has table(s) 1, 2, 3'] });

        // Five tables that do not agree on the income year never make a quarter.
        replace(state, 4, NEXT, '2026-12-30T17:04:00Z');
        replace(state, 5, { ...NEXT, incomeYear: 2026 }, '2026-12-30T17:05:00Z');
        const split = await run('2026-12-30T18:00:00Z');
        expect(split).toMatchObject({ loaded: 2, failed: 0, displayed: 202612, pending: { 202703: [1, 2, 3, 4, 5] }, ok: false });
        expect(split.problems).toEqual(['quarter 202703 is not whole: it has table(s) 1, 2, 3, 4, 5, which name the income years 2025 and 2026']);
    });
});

describe('runOutcome', () => {
    const summary = extra => ({ ok: true, results: [], problems: [], ...extra });
    test('a clean run has nothing to say', () => {
        expect(runOutcome(summary())).toEqual({ ok: true, message: null });
    });
    test('names each failed file, then what else is wrong, in a line that does not change while they stand', () => {
        const failed = summary({ ok: false, results: [
            { resource_id: 'r3', status: 'failed', failure: 'gone', message: 'upstream 404' },
            { resource_id: 'r1', status: 'waiting', failure: 'bad_value', since: '2026-12-29T16:00:00.000Z' },
            { resource_id: 'r4', status: 'failed', failure: 'table_cut', message: 'table_cut: the last band still holds 10340 cents' }
        ], problems: ['1 file(s) failed earlier and wait for their next attempt'] });
        expect(runOutcome(failed)).toEqual({ ok: false,
            message: '2 file(s) failed: r3 gone, r4 table_cut; 1 file(s) failed earlier and wait for their next attempt' });
        expect(runOutcome(failed)).toEqual(runOutcome(JSON.parse(JSON.stringify(failed))));
    });
    test('is never longer than the run log holds', () => {
        const long = summary({ ok: false, problems: Array.from({ length: 40 }, (_, index) => 'problem number ' + index + ' of the run') });
        expect(runOutcome(long).message).toHaveLength(500);
    });
});
