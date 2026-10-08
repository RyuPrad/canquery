jest.mock('node:child_process', () => {
    const actual = jest.requireActual('node:child_process');
    return { ...actual, fork: jest.fn(actual.fork) };
});
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { fork } = require('node:child_process');
const { convertXlsxToCsv } = require('../services/xlsxConvert');

let directory;
let original;
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canquery-converter-env-'));
    original = { ...process.env };
    fork.mockClear();
});
afterEach(async () => {
    process.env = original;
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture() {
    const file = path.join(directory, 'input.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Data').addRows([['code'], ['00123']]);
    await workbook.xlsx.writeFile(file);
    return file;
}
const limits = { maxRows: 10, maxCols: 10, maxCsvBytes: 1024 ** 2 };

test('real converter receives only locale/path/temp environment and preserves file output', async () => {
    const file = await fixture();
    process.env.CANQUERY_DATABASE_URL = 'private-test-only-database';
    process.env.BETTER_AUTH_SECRET = 'private-test-only-secret';
    process.env.MAP_R2_SECRET_ACCESS_KEY = 'private-test-only-object-key';
    process.env.NODE_OPTIONS = '--require=/must-not-be-loaded-by-converter';
    const result = await convertXlsxToCsv(file, limits);
    try {
        expect(await fs.readFile(result.csvPath, 'utf8')).toBe('"code"\n"00123"\n');
        const env = fork.mock.calls[0][2].env;
        expect(Object.keys(env).every(name => ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'TMP', 'TEMP'].includes(name))).toBe(true);
        expect(JSON.stringify(env)).not.toContain('private-test-only');
        expect(env.NODE_OPTIONS).toBeUndefined();
    } finally { await fs.unlink(result.csvPath); }
});

test('archive limits from the parent environment still constrain the isolated child', async () => {
    const file = await fixture();
    process.env.XLSX_MAX_ENTRIES = '1';
    await expect(convertXlsxToCsv(file, limits)).rejects.toMatchObject({ code: 'XLSX_ZIP_BOMB' });
    expect(fork.mock.calls[0][2].env.XLSX_MAX_ENTRIES).toBeUndefined();
});
