const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const XLSX = require('xlsx');
const { convertXlsToCsv } = require('../services/xlsxConvert');

let counter = 0;
const fixturePaths = [];
const csvPaths = [];

async function convertAndRead(fixturePath, caps) {
    const { csvPath, rowCount } = await convertXlsToCsv(fixturePath, {
        maxRows: 1000,
        maxCols: 50,
        maxCsvBytes: 1024 * 1024,
        ...caps
    });
    csvPaths.push(csvPath);
    const text = fs.readFileSync(csvPath, 'utf8');
    return { text, lines: text.split('\n'), rowCount, csvPath };
}

describe('convertXlsToCsv', () => {

    afterEach(() => {
        for (const fp of fixturePaths) {
            try {
                fs.unlinkSync(fp);
            } catch {
                // ignore
            }
        }
        for (const cp of csvPaths) {
            try {
                fs.unlinkSync(cp);
            } catch {
                // ignore
            }
        }
        fixturePaths.length = 0;
        csvPaths.length = 0;
        counter = 0;
    });

    it('converts strings and numbers with the header preserved', async () => {
        const fixturePath = path.join(os.tmpdir(), 'opencanada-xls-fixture-' + Date.now() + '-' + (counter++) + '.xls');
        fixturePaths.push(fixturePath);
        const ws = XLSX.utils.aoa_to_sheet([['name', 'amount'], ['ottawa', 42]]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, fixturePath, { bookType: 'biff8' });

        const { lines } = await convertAndRead(fixturePath, {});
        expect(lines[0]).toBe('"name","amount"');
        expect(lines[1]).toBe('"ottawa","42"');
    });

    it('date cells become ISO-style strings, not Excel serials', async () => {
        const fixturePath = path.join(os.tmpdir(), 'opencanada-xls-fixture-' + Date.now() + '-' + (counter++) + '.xls');
        fixturePaths.push(fixturePath);
        const ws = XLSX.utils.aoa_to_sheet([['when'], [new Date(Date.UTC(2024, 0, 15))]]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, fixturePath, { bookType: 'biff8', cellDates: true });

        const { text } = await convertAndRead(fixturePath, {});
        expect(text).toMatch(/2024-01-1[45]/);
        expect(text).not.toMatch(/"45\d{3}"/);
    });

    it('only the first sheet is converted', async () => {
        const fixturePath = path.join(os.tmpdir(), 'opencanada-xls-fixture-' + Date.now() + '-' + (counter++) + '.xls');
        fixturePaths.push(fixturePath);
        const ws1 = XLSX.utils.aoa_to_sheet([['col1'], ['appears']]);
        const ws2 = XLSX.utils.aoa_to_sheet([['SHOULD_NOT_APPEAR']]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws1, 'Sheet1');
        XLSX.utils.book_append_sheet(wb, ws2, 'Sheet2');
        XLSX.writeFile(wb, fixturePath, { bookType: 'biff8' });

        const { text } = await convertAndRead(fixturePath, {});
        expect(text).not.toContain('SHOULD_NOT_APPEAR');
    });

    it('tiny maxRows throws CAP_ROWS', async () => {
        const fixturePath = path.join(os.tmpdir(), 'opencanada-xls-fixture-' + Date.now() + '-' + (counter++) + '.xls');
        fixturePaths.push(fixturePath);
        const rows = [['col1']];
        for (let i = 0; i < 30; i += 1) {
            rows.push(['row' + i]);
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, fixturePath, { bookType: 'biff8' });

        const before = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('opencanada-xls-') && f.endsWith('.csv')));
        let thrown;
        try {
            await convertXlsToCsv(fixturePath, { maxRows: 5, maxCols: 50, maxCsvBytes: 1024 * 1024 });
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeDefined();
        expect(thrown.code).toBe('CAP_ROWS');
        const after = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('opencanada-xls-') && f.endsWith('.csv')));
        expect(after.size - before.size).toBe(0);
    });
});
