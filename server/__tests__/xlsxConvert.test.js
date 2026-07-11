const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ExcelJS = require('exceljs');
const { convertXlsxToCsv, inspectXlsxArchive } = require('../services/xlsxConvert');

let counter = 0;
const fixturePaths = [];
const csvPaths = [];

async function convertAndRead(fixturePath, caps) {
    const { csvPath, rowCount } = await convertXlsxToCsv(fixturePath, {
        maxRows: 1000,
        maxCols: 50,
        maxCsvBytes: 1024 * 1024,
        ...caps
    });
    csvPaths.push(csvPath);
    const text = fs.readFileSync(csvPath, 'utf8');
    return { text, lines: text.split('\n'), rowCount, csvPath };
}

describe('convertXlsxToCsv', () => {

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

    it('converts strings, numbers and booleans with the header preserved', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('Sheet1');
        sheet.addRow(['name', 'amount', 'active']);
        sheet.addRow(['ottawa', 42, true]);
        await wb.xlsx.writeFile(fixturePath);

        const { lines } = await convertAndRead(fixturePath, {});
        expect(lines[0]).toBe('"name","amount","active"');
        expect(lines[1]).toBe('"ottawa","42","true"');
    });

    it('date cells become ISO strings, not Excel serial numbers', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('Sheet1');
        sheet.addRow(['date']);
        sheet.addRow([new Date(Date.UTC(2024, 0, 15))]);
        await wb.xlsx.writeFile(fixturePath);

        const { text } = await convertAndRead(fixturePath, {});
        expect(text).toContain('2024-01-15T00:00:00.000Z');
        expect(text).not.toMatch(/"45\d{3}"/);
    });

    it('formula cells emit their cached result', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('Sheet1');
        sheet.addRow(['value']);
        const row = sheet.addRow([]);
        const cell = row.getCell(1);
        cell.value = { formula: 'A2*2', result: 84 };
        await wb.xlsx.writeFile(fixturePath);

        const { text } = await convertAndRead(fixturePath, {});
        expect(text).toContain('"84"');
    });

    it('richText cells join their segments', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('Sheet1');
        sheet.addRow(['greeting']);
        const row = sheet.addRow([]);
        const cell = row.getCell(1);
        cell.value = { richText: [{ text: 'Hello ' }, { text: 'World' }] };
        await wb.xlsx.writeFile(fixturePath);

        const { text } = await convertAndRead(fixturePath, {});
        expect(text).toContain('"Hello World"');
    });

    it('sparse rows pad missing cells', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('Sheet1');
        sheet.addRow(['a', 'b', 'c', 'd']);
        const row = sheet.getRow(2);
        row.getCell(1).value = 'a';
        row.getCell(4).value = 'd';
        row.commit();
        await wb.xlsx.writeFile(fixturePath);

        const { lines } = await convertAndRead(fixturePath, {});
        expect(lines[1]).toBe('"a","","","d"');
    });

    it('only the first worksheet is converted', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        const sheet1 = wb.addWorksheet('Sheet1');
        sheet1.addRow(['data']);
        sheet1.addRow(['appears']);
        const sheet2 = wb.addWorksheet('Sheet2');
        sheet2.addRow(['SHOULD_NOT_APPEAR']);
        await wb.xlsx.writeFile(fixturePath);

        const { text } = await convertAndRead(fixturePath, {});
        expect(text).not.toContain('SHOULD_NOT_APPEAR');
    });

    it('tiny maxRows throws CAP_ROWS', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('Sheet1');
        sheet.addRow(['col1']);
        for (let i = 0; i < 15; i += 1) {
            sheet.addRow(['row' + i]);
        }
        await wb.xlsx.writeFile(fixturePath);

        const before = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('canquery-xlsx-') && f.endsWith('.csv')));
        let thrown;
        try {
            await convertXlsxToCsv(fixturePath, { maxRows: 5, maxCols: 50, maxCsvBytes: 1024 * 1024 });
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeDefined();
        expect(thrown.code).toBe('CAP_ROWS');
        const after = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('canquery-xlsx-') && f.endsWith('.csv')));
        expect(after.size - before.size).toBe(0);
    }, 15000);

    it('tiny maxCols throws CAP_COLS', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('Sheet1');
        const row = sheet.addRow([]);
        for (let i = 1; i <= 10; i += 1) {
            row.getCell(i).value = 'v' + i;
        }
        await wb.xlsx.writeFile(fixturePath);

        const before = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('canquery-xlsx-') && f.endsWith('.csv')));
        let thrown;
        try {
            await convertXlsxToCsv(fixturePath, { maxRows: 1000, maxCols: 3, maxCsvBytes: 1024 * 1024 });
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeDefined();
        expect(thrown.code).toBe('CAP_COLS');
        const after = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('canquery-xlsx-') && f.endsWith('.csv')));
        expect(after.size - before.size).toBe(0);
    });

    it('tiny maxCsvBytes throws CAP_FILE', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('Sheet1');
        sheet.addRow(['a', 'b', 'c']);
        sheet.addRow(['1', '2', '3']);
        sheet.addRow(['4', '5', '6']);
        await wb.xlsx.writeFile(fixturePath);

        const before = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('canquery-xlsx-') && f.endsWith('.csv')));
        let thrown;
        try {
            await convertXlsxToCsv(fixturePath, { maxRows: 1000, maxCols: 50, maxCsvBytes: 10 });
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeDefined();
        expect(thrown.code).toBe('CAP_FILE');
        const after = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('canquery-xlsx-') && f.endsWith('.csv')));
        expect(after.size - before.size).toBe(0);
    });

    it('empty worksheet throws', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet('Sheet1');
        await wb.xlsx.writeFile(fixturePath);

        let thrown;
        try {
            await convertXlsxToCsv(fixturePath, { maxRows: 1000, maxCols: 50, maxCsvBytes: 1024 * 1024 });
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeDefined();
        expect(thrown.message).toContain('empty XLSX worksheet');
    });

    it('preflights the ZIP directory before conversion', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet('Sheet1').addRow(['hello']);
        await wb.xlsx.writeFile(fixturePath);

        const stats = await inspectXlsxArchive(fixturePath);
        expect(stats.entries).toBeGreaterThan(0);
        expect(stats.totalUncompressed).toBeGreaterThan(0);
    });

    it('rejects an XLSX whose declared expansion exceeds the archive cap', async () => {
        const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
        fixturePaths.push(fixturePath);
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet('Sheet1').addRow(['hello']);
        await wb.xlsx.writeFile(fixturePath);

        await expect(inspectXlsxArchive(fixturePath, {
            maxUncompressedBytes: 1
        })).rejects.toMatchObject({ code: 'XLSX_ZIP_BOMB' });
    });
});
