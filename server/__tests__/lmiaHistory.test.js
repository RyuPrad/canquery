const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const history = require('../services/lmiaHistory');
const { resourceVersion } = require('../services/resourceVersion');

const { lmiaPeriod, normalizeRecords, fileSummary, validate, decodeText, fileKind, readRecords, runHistory, LmiaFileError } = history;

const NOTES = [['Notes:'], ['1. This list excludes all personal names, such as employers of caregivers.'], ['2. Positions are not work permits.']];
const MODERN_HEADER = ['Province/Territory', 'Program Stream', 'Employer', 'Address', 'Occupation', 'Incorporate Status',
    'Approved LMIAs', 'Approved Positions'];

// A modern file with n employers, for the run tests.
function modernRecords(n = 120, employer = i => `Employer ${i} Ltd`) {
    const rows = Array.from({ length: n }, (_, i) => ['Ontario', 'High Wage', employer(i), 'Toronto, ON M5J 2X5',
        '72310-Carpenters', 'Corporation', '1', '2']);
    return [['Employers Who Were Issued a Positive LMIA'], MODERN_HEADER, ...rows, ...NOTES];
}

describe('lmiaPeriod', () => {
    test('reads quarters, the half year and whole years from the catalogue name', () => {
        expect(lmiaPeriod('2026Q2-Employers Who Were Issued a Positive Labour Market Impact Assessment (LMIA)'))
            .toEqual({ key: 202606, kind: 'quarter', start: '2026-04-01', end: '2026-06-30' });
        expect(lmiaPeriod('2017Q1Q2-Employers who were issued a positive LMIA in 2017 (January-June)'))
            .toEqual({ key: 201706, kind: 'half', start: '2017-01-01', end: '2017-06-30' });
        expect(lmiaPeriod('2016-Employers who were issued a positive LMIA in 2016'))
            .toEqual({ key: 201612, kind: 'year', start: '2016-01-01', end: '2016-12-31' });
        expect(lmiaPeriod('2014-Employers who have requested an LMIA and were issued a positive LMIA between June 20 and December 31, 2014 inclusively'))
            .toEqual({ key: 201412, kind: 'year', start: '2014-06-20', end: '2014-12-31' });
        expect(lmiaPeriod('2024Q4-Employers')).toMatchObject({ key: 202412, start: '2024-10-01', end: '2024-12-31' });
    });
    test('refuses names without a leading period, and years the list cannot have', () => {
        const now = new Date('2026-11-03T00:00:00Z');
        for (const name of ['Employers 2016', '2017Q3Q1-Employers', '2017Q1Q4-x', '20171-Employers', '', null, 'Q2 2026',
            '3026Q2-Employers', '2013-Employers', '2028Q1-Employers']) {
            expect(lmiaPeriod(name, { now })).toBeNull();
        }
        expect(lmiaPeriod('2027Q1-Employers', { now })).toMatchObject({ key: 202703 });
    });

    test('a range with a day that does not exist, or that runs backwards, keeps the whole year', () => {
        for (const name of ['2014-Employers between June 0 and December 31, 2014', '2014-Employers between June 20 and June 3, 2014',
            '2014-Employers between February 30 and December 31, 2014']) {
            expect(lmiaPeriod(name)).toMatchObject({ key: 201412, start: '2014-01-01', end: '2014-12-31' });
        }
    });
});

describe('normalizeRecords', () => {
    test('2014 and 2015: province rows set the province, repeated headers and notes are skipped', () => {
        const { rows, skipped } = normalizeRecords([
            ['Employers who have requested a Labour Market Impact Assessment (LMIA) and were issued a positive LMIA'],
            [''],
            ['Newfoundland and Labrador'],
            ['Employer', 'Address', 'Positions approved'],
            ['', '', ''],
            ['Central Regional Health Authority', 'GRAND FALLS - WINDSOR, NL A2A 2E1', '2'],
            ['Atlantic Fish Co.', "St. John's, NL A1A 1A1", '1'],
            ['Ontario'],
            ['Employer', 'Address', 'Positions Approved'],
            ['Maple Farms Ltd', 'Leamington, ON N8H 1A1', '12'],
            ['Outside Canada'],
            ['Employer', 'Address', 'Positions Approved'],
            ['Global Ship Management', 'Wanchai, NL A0A 0A0', '4'],
            ['Total Lubrication Management Company', '1740 Stebbins Drive, Houston, TX 770043', '5'],
            ['Other employers', '', '5,967'],
            ['Total ', '', '30,396'],
            ...NOTES
        ]);
        expect(rows.map(row => [row.employer, row.employer_key, row.province, row.city, row.approved_positions])).toEqual([
            ['Central Regional Health Authority', 'central regional health authority', 'NL', 'GRAND FALLS - WINDSOR', 2],
            ['Atlantic Fish Co.', 'atlantic fish', 'NL', "St. John's", 1],
            ['Maple Farms Ltd', 'maple farms', 'ON', 'Leamington', 12],
            ['Global Ship Management', 'global ship management', 'HO', 'Wanchai', 4],
            ['Total Lubrication Management Company', 'total lubrication management', 'HO', null, 5]
        ]);
        expect(rows.every(row => row.stream === null && row.occupation_code === null && row.approved_lmias === null)).toBe(true);
        expect(skipped).toMatchObject({ sections: 2, headers: 2, notes: 3, aggregates: 2, no_positions: 0 });
    });

    test('2016: blank province and employer cells carry down, with or without a new address', () => {
        const { rows } = normalizeRecords([
            ['Employers who were issued a positive LMIA by NOC 2011 and business location in 2016'],
            ['Province/Territory', 'Employer', 'Address', 'Occupations under NOC 2011', 'Positions Approved'],
            ['Newfoundland and Labrador', '10565 NFLD. Inc.', 'Goose Bay, NL A0P 1C0', '6312-Executive housekeepers', '1'],
            ['', '', 'Happy Valley Goose Bay, NL A0P 1C0', '6312-Executive housekeepers', '2'],
            ['Prince Edward Island', 'Atlantic Grown Organics Inc', 'Kensington, PE C0B 1M0', '8432-Nursery and greenhouse workers', '3'],
            ['', '', '', '0822-Managers in horticulture', '2'],
            ...NOTES
        ]);
        expect(rows.map(row => [row.province, row.employer, row.address, row.occupation_code, row.noc_version, row.approved_positions])).toEqual([
            ['NL', '10565 NFLD. Inc.', 'Goose Bay, NL A0P 1C0', '6312', 2011, 1],
            ['NL', '10565 NFLD. Inc.', 'Happy Valley Goose Bay, NL A0P 1C0', '6312', 2011, 2],
            ['PE', 'Atlantic Grown Organics Inc', 'Kensington, PE C0B 1M0', '8432', 2011, 3],
            ['PE', 'Atlantic Grown Organics Inc', 'Kensington, PE C0B 1M0', '0822', 2011, 2]
        ]);
        expect(rows[0].employer_key).toBe('10565 nfld');
        expect(rows.map(row => row.line)).toEqual([3, 4, 5, 6]);
    });

    test('2017 to 2019: stream carries down with the province, and continuation rows take the employer', () => {
        const { rows } = normalizeRecords([
            ['List of employers who were issued a positive LMIA by Stream, NOC 2011 and business location in 2017 (January-June)'],
            ['Province/Territory', 'Stream', 'Employer', 'Address', 'Occupations under NOC 2011', 'Positions Approved'],
            ['Nova Scotia', 'High Wage', 'Irving Shipbuilding Inc.', 'Halifax, NS B3K 5M7', '0711-Construction managers', '2'],
            ['', '', '', '', '0911-Manufacturing managers', '4'],
            ['', 'Low Wage', 'Harbour Fish', 'Halifax, NS B3K 1A1', '9463-Fish and seafood plant workers', '10'],
            ['Quebec', 'Primary Agriculture', 'Ferme Lavoie', 'Saint-Rémi, QC J0L 2L0', '8431-General farm workers', '6'],
            ...NOTES
        ]);
        expect(rows.map(row => [row.province, row.stream, row.employer, row.address, row.occupation_code])).toEqual([
            ['NS', 'High Wage', 'Irving Shipbuilding Inc.', 'Halifax, NS B3K 5M7', '0711'],
            ['NS', 'High Wage', 'Irving Shipbuilding Inc.', 'Halifax, NS B3K 5M7', '0911'],
            ['NS', 'Low Wage', 'Harbour Fish', 'Halifax, NS B3K 1A1', '9463'],
            ['QC', 'Primary Agriculture', 'Ferme Lavoie', 'Saint-Rémi, QC J0L 2L0', '8431']
        ]);
    });

    test('current files: every column, head offices, NOC 2021, stream spellings, blank occupations and counts with commas', () => {
        const { rows, skipped } = normalizeRecords([
            ['Employers Who Were Issued a Positive Labour Market Impact Assessment (LMIA)'],
            MODERN_HEADER,
            ['Ontario', 'Global Talent', 'Shopify Inc.', 'Ottawa, ON K2P 1L4', '21231-Software engineers and designers', 'Corporation', '3', '5'],
            ['Employers carrying on business in Canada with Head Office outside of Canada', 'High Wage', 'Fugro N.V.', 'Leidschendam',
                '22100-Chemical technologists and technicians', 'Unknown', '1', '1'],
            ['British Columbia', 'Low Wage', 'Tim Hortons', 'Vancouver, BC V6B 1A1', '(blank)', 'Unknown', '1', '2'],
            ['Alberta', 'Talent mondial', 'DANCHAR LTD.', 'Calgary, AB T2P 1J9', '72310-Carpenters', 'No response provided', '', '1,200'],
            ...NOTES
        ]);
        expect(rows.map(row => [row.province, row.stream, row.employer_key, row.occupation_code, row.noc_version, row.incorporation,
            row.approved_lmias, row.approved_positions])).toEqual([
            ['ON', 'Global Talent Stream', 'shopify', '21231', 2021, 'Corporation', 3, 5],
            ['HO', 'High Wage', 'fugro nv', '22100', 2021, 'Unknown', 1, 1],
            ['BC', 'Low Wage', 'tim hortons', null, null, 'Unknown', 1, 2],
            ['AB', 'Global Talent Stream', 'danchar', '72310', 2021, 'No response provided', null, 1200]
        ]);
        expect(rows[1].city).toBeNull();
        expect(rows[0].occupation_title).toBe('Software engineers and designers');
        expect(skipped.notes).toBe(3);
    });

    test('header variants: requested counts, Employer Name and the Occupaitons misspelling', () => {
        const requested = normalizeRecords([
            ['Province/Territory', 'Program Stream', 'Employer', 'Address', 'Occupation', 'Incorporate Status', 'Requested LMIAs', 'Requested Positions'],
            ['Manitoba', 'Low Wage', 'Prairie Farms', 'Brandon, MB R7A 1A1', '8431-General farm workers', 'Unknown', '2', '7']
        ]);
        expect(requested.rows[0]).toMatchObject({ approved_lmias: 2, approved_positions: 7 });
        const misspelt = normalizeRecords([
            ['Province/Territory', 'Stream', 'Employer Name', 'Address', 'Occupaitons under NOC 2011', 'Approved Positions'],
            ['Yukon', 'High Wage', 'Klondike Gold', 'Dawson, YT Y0B 1G0', '8231-Underground production and development miners', '3']
        ]);
        expect(misspelt.rows[0]).toMatchObject({ province: 'YT', employer: 'Klondike Gold', occupation_code: '8231', approved_positions: 3 });
    });

    test('a row whose province is not a province stays unknown rather than inheriting one', () => {
        const { rows } = normalizeRecords([
            MODERN_HEADER,
            ['Ontario', 'High Wage', 'First Co', 'Toronto, ON', '72310-Carpenters', 'Unknown', '1', '1'],
            ['Atlantis', 'High Wage', 'Second Co', 'Nowhere', '72310-Carpenters', 'Unknown', '1', '1']
        ]);
        expect(rows.map(row => row.province)).toEqual(['ON', null]);
    });

    test('refuses a table that is not the list', () => {
        expect(() => normalizeRecords([['Name', 'Count'], ['A', '1']])).toThrow(LmiaFileError);
        expect(() => normalizeRecords([['Name', 'Count']])).toThrow(expect.objectContaining({ code: 'unrecognized_layout' }));
    });

    test('pivot placeholders: a "(blank)" employer is skipped, not filled down; a "(blank)" province is unknown', () => {
        const { rows, skipped } = normalizeRecords([
            MODERN_HEADER,
            ['Ontario', 'High Wage', 'First Co', 'Toronto, ON M5J 2X5', '72310-Carpenters', 'Unknown', '1', '1'],
            ['Ontario', 'High Wage', '(blank)', '(blank)', '72310-Carpenters', 'Unknown', '1', '4'],
            ['(blank)', '(blank)', 'Second Co', 'Ottawa, ON K1P 1J1', '(blank)', '(blank)', '1', '2']
        ]);
        expect(rows.map(row => [row.employer, row.province, row.stream, row.incorporation, row.approved_positions])).toEqual([
            ['First Co', 'ON', 'High Wage', 'Unknown', 1], ['Second Co', null, null, null, 2]]);
        expect(skipped.no_employer).toBe(1);
    });

    test('a blank employer continues the one above only when its province is blank too', () => {
        const { rows, skipped } = normalizeRecords([
            MODERN_HEADER,
            ['Ontario', 'High Wage', 'First Co', 'Toronto, ON M5J 2X5', '72310-Carpenters', 'Unknown', '1', '1'],
            ['Alberta', 'High Wage', '', 'Calgary, AB T2P 1J9', '72310-Carpenters', 'Unknown', '1', '3']
        ]);
        expect(rows.map(row => row.employer)).toEqual(['First Co']);
        expect(skipped.no_employer).toBe(1);
    });

    test('an unknown label in a sectioned file ends the section instead of keeping its province', () => {
        const { rows } = normalizeRecords([
            ['Employer', 'Address', 'Positions approved'],
            ['Ontario'],
            ['Maple Farms Ltd', 'Leamington, ON N8H 1A1', '12'],
            ['Some new grouping'],
            ['Elsewhere Inc', 'Somewhere', '2']
        ]);
        expect(rows.map(row => [row.employer, row.province])).toEqual([['Maple Farms Ltd', 'ON'], ['Elsewhere Inc', null]]);
    });

    test('cities come from Canadian addresses as the publisher wrote them over the years', () => {
        const { cityOf } = history;
        expect(cityOf("Box 20, 215 Water Street, Suite 511, St. John's, NL A1C 6C9")).toBe("St. John's");
        expect(cityOf("St. John's, A1N3J7")).toBe("St. John's");
        expect(cityOf('MONTREAL, QC H3G 1T')).toBe('MONTREAL');
        expect(cityOf('St-Sébastien,, QC J0J 2C0')).toBe('St-Sébastien');
        expect(cityOf('Mississauga, ON, ON L5N 1A1')).toBe('Mississauga');
        expect(cityOf('GRAND FALLS - WINDSOR, NL A2A 2E1')).toBe('GRAND FALLS - WINDSOR');
        expect(cityOf('Edmonton, AB  T6R\u00a00X5')).toBe('Edmonton');
        expect(cityOf('100 Mile House, BC V0K 2E0')).toBe('100 Mile House');
        expect(cityOf('RR# 1 Waterford, ON N0E 1Y0')).toBe('Waterford');
        expect(cityOf('R. R. #2 Simcoe, ON N3Y 4K1')).toBe('Simcoe');
        expect(cityOf('blue river, po box 25, BC V0E 1J0')).toBe('blue river');
        expect(cityOf('1740 Stebbins Drive, Houston, TX 770043')).toBeNull();
        expect(cityOf('123 Main Street')).toBeNull();
        expect(cityOf('')).toBeNull();
    });
});

describe('fileSummary and validate', () => {
    test('counts employers by key, positions, LMIAs and the NOC version', () => {
        const { rows } = normalizeRecords(modernRecords(120, i => (i % 2 ? 'Danchar Ltd' : 'DANCHAR LTD.')));
        expect(fileSummary(rows)).toMatchObject({ row_count: 120, employers: 1, positions: 240, lmias: 120, noc_version: 2021,
            known_provinces: 1 });
        expect(() => validate(fileSummary(rows))).not.toThrow();
    });
    test('refuses a file where one line holds half the positions (a total)', () => {
        const records = modernRecords(120);
        records[5][7] = '1000';
        expect(() => validate(fileSummary(normalizeRecords(records).rows))).toThrow('aggregate_row');
    });

    test('refuses a file with too few rows or unknown provinces', () => {
        expect(() => validate(fileSummary(normalizeRecords(modernRecords(20)).rows))).toThrow('too_few_rows');
        const records = modernRecords(120);
        for (let i = 2; i < 10; i += 1) records[i][0] = 'Atlantis';
        expect(() => validate(fileSummary(normalizeRecords(records).rows))).toThrow('unknown_provinces');
    });
});

describe('decoding and reading files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmia-history-test-'));
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
    const write = (name, data) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, data);
        return file;
    };

    test('UTF-8, Windows-1252 and DOS code page 850 text', () => {
        expect(decodeText(Buffer.from('\ufeffQuébec’s', 'utf8'))).toBe('Québec’s');
        // Windows-1252: é (0xE9), a curly apostrophe (0x92) and a no-break space (0xA0) in a box number.
        expect(decodeText(Buffer.from([...Buffer.from('Montr'), 0xe9, ...Buffer.from('al, St. John'), 0x92,
            ...Buffer.from('s, Box'), 0xa0, ...Buffer.from('12')]))).toBe('Montréal, St. John’s, Box\u00a012');
        // DOS 850: É is 0x90 and è is 0x8A, control characters in Windows-1252.
        expect(decodeText(Buffer.from([...Buffer.from('2164-8431 QU'), 0x90, ...Buffer.from('BEC INC., d'), 0x82,
            ...Buffer.from('rabli'), 0x8a, ...Buffer.from('re')]))).toBe('2164-8431 QUÉBEC INC., dérablière');
    });

    test('file kinds come from the bytes', () => {
        expect(fileKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]))).toBe('xlsx');
        expect(fileKind(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe('xls');
        expect(fileKind(Buffer.from('Province/Territory,Employer'))).toBe('csv');
    });

    const table = [['Employers list'], MODERN_HEADER,
        ['Quebec', 'Low Wage', 'Équipements Lafontaine inc.', 'Saint-Évariste, QC G0M 1S0', '75101-Material handlers', 'Unknown', '1', '3'],
        ...NOTES];

    test('a Windows-1252 CSV', async () => {
        const csv = table.map(row => row.map(cell => `"${cell}"`).join(',')).join('\r\n');
        const file = write('list.csv', encodeWindows1252(csv));
        const { rows } = normalizeRecords(await readRecords(file));
        expect(rows[0]).toMatchObject({ employer: 'Équipements Lafontaine inc.', address: 'Saint-Évariste, QC G0M 1S0', province: 'QC' });
    });

    test('an XLSX workbook, through the isolated converter', async () => {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(table), 'Positive_EN');
        const file = write('list.xlsx', XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
        const { rows } = normalizeRecords(await readRecords(file));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ employer: 'Équipements Lafontaine inc.', approved_positions: 3, approved_lmias: 1 });
    });

    test('a legacy XLS workbook, through the isolated converter', async () => {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(table), 'Positive_EN');
        const file = write('list.xls', XLSX.write(book, { type: 'buffer', bookType: 'biff8' }));
        const { rows } = normalizeRecords(await readRecords(file));
        expect(rows[0]).toMatchObject({ employer: 'Équipements Lafontaine inc.', occupation_code: '75101', approved_positions: 3 });
    });

    test('a web page served instead of the file is not a table', async () => {
        const file = write('page.csv', '<!doctype html><html><body>Moved</body></html>');
        await expect(readRecords(file)).rejects.toMatchObject({ code: 'not_a_table' });
    });
});

// Windows-1252 bytes for the test text (only Latin-1 letters are used).
function encodeWindows1252(text) {
    return Buffer.from([...text].map(ch => {
        const code = ch.charCodeAt(0);
        if (code > 0xff) throw new Error('not in the test alphabet: ' + ch);
        return code;
    }));
}

describe('converterFailure', () => {
    test('timeouts and size caps keep their meaning', () => {
        expect(history.converterFailure(Object.assign(new Error('x'), { code: 'EXCEL_TIMEOUT' }))).toBe('timeout');
        expect(history.converterFailure(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('timeout');
        expect(history.converterFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('timeout');
        expect(history.converterFailure(Object.assign(new Error('x'), { code: 'CAP_ROWS' }))).toBe('too_large');
        expect(history.converterFailure(new Error('corrupt'))).toBe('not_a_table');
    });
});

describe('failureCode', () => {
    test('maps download and file errors to stable codes', () => {
        expect(history.failureCode(new LmiaFileError('too_few_rows'))).toBe('too_few_rows');
        expect(history.failureCode(Object.assign(new Error('x'), { code: 'DOWNLOAD_URL_BLOCKED' }))).toBe('blocked');
        expect(history.failureCode(Object.assign(new Error('x'), { code: 'CAP_FILE' }))).toBe('too_large');
        expect(history.failureCode(Object.assign(new Error('x'), { httpStatus: 404 }))).toBe('gone');
        expect(history.failureCode(Object.assign(new Error('x'), { httpStatus: 429 }))).toBe('rate_limited');
        expect(history.failureCode(Object.assign(new Error('x'), { httpStatus: 503 }))).toBe('upstream_http');
        expect(history.failureCode(Object.assign(new Error('x'), { code: 'DOWNLOAD_BODY_STALL' }))).toBe('timeout');
        expect(history.failureCode(new Error('boom'))).toBe('error');
    });
});

describe('runHistory', () => {
    const resource = (id, name, lastModified = '2026-10-30T00:00:00Z') =>
        ({ id, name_en: name, format: 'XLSX', url: `https://files.example.test/${id}.xlsx`, size_bytes: null, last_modified: lastModified, raw: {} });
    const q2 = resource('q2', '2026Q2-Employers Who Were Issued a Positive LMIA');
    const q2old = resource('q2-old', '2026Q2-Employers (first edition)', '2026-10-01T00:00:00Z');
    const q1 = resource('q1', '2026Q1-Employers Who Were Issued a Positive LMIA', '2026-07-21T00:00:00Z');
    const odd = resource('odd', 'Data dictionary');

    function deps(overrides = {}) {
        const calls = { read: [], saved: [], failures: [], refresh: 0, waits: [] };
        return {
            calls,
            deps: {
                listResources: async () => [q2, q2old, q1, odd],
                listFiles: async () => [{ resource_id: 'q1', period_key: 202603, source_version: resourceVersion(q1) },
                    { resource_id: 'gone', period_key: 202503, source_version: 'v' }],
                readFile: async (row, { signal }) => {
                    expect(signal).toBeInstanceOf(AbortSignal);
                    calls.read.push(row.id);
                    return modernRecords();
                },
                saveFile: async input => { calls.saved.push(input); },
                saveFailure: async input => { calls.failures.push(input); },
                refreshEmployers: async () => { calls.refresh += 1; },
                employersBehind: async () => false,
                wait: async ms => { calls.waits.push(ms); },
                ...overrides
            }
        };
    }

    test('loads changed files only, newest first, and refreshes the employers once', async () => {
        const { calls, deps: d } = deps();
        const summary = await runHistory({ deps: d });
        expect(calls.read).toEqual(['q2']);
        expect(summary).toMatchObject({ files: 2, loaded: 1, unchanged: 1, failed: 0, rows: 120, unparsed: ['odd'],
            superseded: ['q2-old'], orphaned: ['gone'] });
        expect(calls.saved[0]).toMatchObject({ file: { id: 'q2', period: { key: 202606 } }, version: resourceVersion(q2),
            counts: { row_count: 120, positions: 240 } });
        expect(calls.saved[0].rows).toHaveLength(120);
        expect(calls.refresh).toBe(1);
        expect(calls.waits).toEqual([]);
    });

    test('--force reloads every file with a pause between downloads; --file handles one', async () => {
        const forced = deps();
        await runHistory({ force: true, gapMs: 1500, deps: forced.deps });
        expect(forced.calls.read).toEqual(['q2', 'q1']);
        expect(forced.calls.waits).toEqual([1500]);
        const one = deps();
        const summary = await runHistory({ force: true, only: 'q1', deps: one.deps });
        expect(one.calls.read).toEqual(['q1']);
        expect(summary.loaded).toBe(1);
    });

    test('a dry run reads and counts but writes nothing', async () => {
        const { calls, deps: d } = deps();
        const summary = await runHistory({ dryRun: true, deps: d });
        expect(summary.results).toEqual([expect.objectContaining({ resource_id: 'q2', status: 'parsed', row_count: 120 })]);
        expect(summary.loaded).toBe(0);
        expect(calls.saved).toEqual([]);
        expect(calls.refresh).toBe(0);
    });

    test('a failed file keeps its rows, records the failure and does not stop the run', async () => {
        const { calls, deps: d } = deps({
            readFile: async row => {
                if (row.id === 'q2') throw Object.assign(new Error('Not Found'), { httpStatus: 404 });
                return modernRecords(10);
            }
        });
        const summary = await runHistory({ force: true, deps: d });
        expect(summary).toMatchObject({ loaded: 0, failed: 2 });
        expect(calls.failures.map(input => [input.file.id, input.failure])).toEqual([['q2', 'gone'], ['q1', 'too_few_rows']]);
        expect(calls.refresh).toBe(0);
    });

    test('the newer of two files for a period wins by date, as the database returns them', () => {
        const { files, superseded } = history.pickFiles([
            { ...q1, id: 'original', last_modified: new Date('2026-07-21T00:00:00Z') },
            { ...q1, id: 'correction', last_modified: new Date('2026-10-30T00:00:00Z') },
            { ...q1, id: 'undated', last_modified: null }
        ]);
        expect(files.map(file => file.id)).toEqual(['correction']);
        expect(superseded.sort()).toEqual(['original', 'undated']);
    });

    test('a file renamed to another period loads again', async () => {
        const { calls, deps: d } = deps({
            listResources: async () => [q1],
            listFiles: async () => [{ resource_id: 'q1', period_key: 202506, source_version: resourceVersion(q1) }]
        });
        await runHistory({ deps: d });
        expect(calls.read).toEqual(['q1']);
    });

    test('a version that already failed waits for a new one, unless asked for', async () => {
        const failedBefore = { resource_id: 'q2', period_key: 202606, source_version: null, failed_version: resourceVersion(q2) };
        const waiting = deps({ listResources: async () => [q2], listFiles: async () => [failedBefore] });
        const summary = await runHistory({ deps: waiting.deps });
        expect(waiting.calls.read).toEqual([]);
        expect(summary.waiting).toBe(1);
        const asked = deps({ listResources: async () => [q2], listFiles: async () => [failedBefore] });
        await runHistory({ only: 'q2', deps: asked.deps });
        expect(asked.calls.read).toEqual(['q2']);
    });

    test('a failure that cannot be recorded does not stop the other files', async () => {
        const { calls, deps: d } = deps({
            readFile: async row => {
                calls.read.push(row.id);
                if (row.id === 'q2') throw Object.assign(new Error('Not Found'), { httpStatus: 404 });
                return modernRecords();
            },
            saveFailure: async () => { throw new Error('check constraint'); }
        });
        const summary = await runHistory({ force: true, deps: d });
        expect(calls.read).toEqual(['q2', 'q1']);
        expect(summary).toMatchObject({ failed: 1, loaded: 1 });
        expect(summary.results[0]).toMatchObject({ failure: 'gone', record_error: 'check constraint' });
    });

    test('a refresh that did not happen is made up on the next run; --file names an unknown file', async () => {
        const { calls, deps: d } = deps({ employersBehind: async () => true });
        const summary = await runHistory({ deps: { ...d, readFile: async () => { throw new Error('should not read'); },
            listResources: async () => [q1] } });
        expect(summary).toMatchObject({ loaded: 0, refreshed: true });
        expect(calls.refresh).toBe(1);
        const unknown = await runHistory({ only: 'nope', deps: deps().deps });
        expect(unknown.unknown_file).toBe('nope');
    });
});
