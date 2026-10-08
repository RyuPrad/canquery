const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { convertXlsxToCsv, inspectXlsxArchive } = require('../services/xlsxConvert');

let counter = 0;
const fixturePaths = [];
const csvPaths = [];

async function workbookFixture(rows = [['first'], ['value']], secondRows = [['second']]) {
    const fixturePath = path.join(os.tmpdir(), 'canquery-xlsx-fixture-' + Date.now() + '-' + (counter++) + '.xlsx');
    fixturePaths.push(fixturePath);
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('First').addRows(rows);
    workbook.addWorksheet('Second').addRows(secondRows);
    await workbook.xlsx.writeFile(fixturePath);
    return fixturePath;
}

async function rewriteWorkbook(fixturePath, edit, firstParts = []) {
    const input = await JSZip.loadAsync(fs.readFileSync(fixturePath));
    await edit(input);
    const output = new JSZip();
    const names = [...firstParts, ...Object.keys(input.files).filter(name => !firstParts.includes(name))];
    for (const name of names) {
        const entry = input.file(name);
        if (entry) output.file(name, await entry.async('nodebuffer'));
    }
    fs.writeFileSync(fixturePath, await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

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

    test('deadline cancellation waits for child exit before removing partial output', async () => {
        const fixture = await workbookFixture();
        const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('canquery-xlsx-') && name.endsWith('.csv'));
        const controller = new AbortController();
        const error = Object.assign(new Error('test deadline'), { code: 'INGEST_DEADLINE' });
        const conversion = convertXlsxToCsv(fixture, { maxRows: 1000, maxCols: 50, maxCsvBytes: 1024 ** 2, signal: controller.signal });
        controller.abort(error);
        await expect(conversion).rejects.toBe(error);
        expect(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('canquery-xlsx-') && name.endsWith('.csv'))).toEqual(before);
    });

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

    it('selects the manifest first sheet when another sheet and late caches come first in the ZIP', async () => {
        const fixturePath = await workbookFixture([['first', 'date'], ['chosen', new Date('2024-01-15T00:00:00Z')]], [['wrong']]);
        await rewriteWorkbook(fixturePath, async () => {}, ['xl/worksheets/sheet2.xml', 'xl/worksheets/sheet1.xml']);

        const { text } = await convertAndRead(fixturePath);
        expect(text).toContain('"first","date"');
        expect(text).toContain('"chosen","2024-01-15T00:00:00.000Z"');
        expect(text).not.toContain('wrong');
    });

    it('uses relationship targets rather than the sheet ID or worksheet filename', async () => {
        const fixturePath = await workbookFixture([['wrong']], [['logical first'], ['chosen']]);
        await rewriteWorkbook(fixturePath, async zip => {
            const workbook = await zip.file('xl/workbook.xml').async('string');
            const sheets = workbook.match(/<sheet\b[^>]*\/>/g);
            zip.file('xl/workbook.xml', workbook.replace(sheets.join(''), sheets[1].replace('sheetId="2"', 'sheetId="42"') + sheets[0]));
            const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
            zip.file('xl/_rels/workbook.xml.rels', rels.replace('worksheets/sheet2.xml', '/xl/worksheets/chosen.xml'));
            zip.file('xl/worksheets/chosen.xml', await zip.file('xl/worksheets/sheet2.xml').async('nodebuffer'));
            zip.remove('xl/worksheets/sheet2.xml');
        }, ['xl/worksheets/sheet1.xml', 'xl/worksheets/chosen.xml']);

        const { text } = await convertAndRead(fixturePath);
        expect(text).toContain('logical first');
        expect(text).toContain('chosen');
        expect(text).not.toContain('wrong');
    });

    it('preloads late workbook properties so 1904 dates retain their calendar value', async () => {
        const fixturePath = await workbookFixture([['date'], [new Date('2024-01-15T00:00:00Z')]]);
        const workbook = new ExcelJS.Workbook();
        workbook.properties.date1904 = true;
        workbook.addWorksheet('First').addRows([['date'], [new Date('2024-01-15T00:00:00Z')]]);
        await workbook.xlsx.writeFile(fixturePath);
        await rewriteWorkbook(fixturePath, async () => {}, ['xl/worksheets/sheet1.xml']);

        expect((await convertAndRead(fixturePath)).text).toContain('2024-01-15T00:00:00.000Z');
    });

    it('rejects a genuinely empty manifest first sheet even when a populated sheet is first in the ZIP', async () => {
        const fixturePath = await workbookFixture([], [['other sheet data']]);
        await rewriteWorkbook(fixturePath, async () => {}, ['xl/worksheets/sheet2.xml', 'xl/worksheets/sheet1.xml']);

        await expect(convertAndRead(fixturePath)).rejects.toThrow('empty XLSX worksheet');
    });

    it('supports inline strings without a shared-string cache', async () => {
        const fixturePath = await workbookFixture();
        await rewriteWorkbook(fixturePath, async zip => {
            zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>inline header</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>inline value</t></is></c></row></sheetData></worksheet>');
            const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
            zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship\b[^>]*Type="[^"]*\/sharedStrings"[^>]*\/>/, ''));
            zip.remove('xl/sharedStrings.xml');
        });
        expect((await convertAndRead(fixturePath)).text).toBe('"inline header"\n"inline value"\n');
    });

    it.each(['xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml'])(
        'rejects a missing required package part %s', async part => {
            const fixturePath = await workbookFixture();
            await rewriteWorkbook(fixturePath, async zip => { zip.remove(part); });
            await expect(convertAndRead(fixturePath)).rejects.toMatchObject({ code: 'XLSX_ARCHIVE' });
        }
    );

    it('rejects duplicate ZIP part identities', async () => {
        const fixturePath = await workbookFixture();
        const archive = fs.readFileSync(fixturePath);
        const eocdOffset = archive.length - 22;
        const centralOffset = archive.readUInt32LE(eocdOffset + 16);
        const recordLength = 46 + archive.readUInt16LE(centralOffset + 28) +
            archive.readUInt16LE(centralOffset + 30) + archive.readUInt16LE(centralOffset + 32);
        const duplicate = archive.subarray(centralOffset, centralOffset + recordLength);
        const eocd = Buffer.from(archive.subarray(eocdOffset));
        eocd.writeUInt16LE(eocd.readUInt16LE(8) + 1, 8);
        eocd.writeUInt16LE(eocd.readUInt16LE(10) + 1, 10);
        eocd.writeUInt32LE(eocd.readUInt32LE(12) + duplicate.length, 12);
        fs.writeFileSync(fixturePath, Buffer.concat([archive.subarray(0, eocdOffset), duplicate, eocd]));

        await expect(inspectXlsxArchive(fixturePath)).rejects.toMatchObject({ code: 'XLSX_ARCHIVE' });
    });

    it('keeps shared-string expansion caps for relationships to nonstandard cache filenames', async () => {
        const fixturePath = await workbookFixture();
        await rewriteWorkbook(fixturePath, async zip => {
            const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
            zip.file('xl/_rels/workbook.xml.rels', rels.replace('sharedStrings.xml', 'strings.xml'));
            zip.file('xl/strings.xml', await zip.file('xl/sharedStrings.xml').async('nodebuffer'));
            zip.remove('xl/sharedStrings.xml');
        });

        await expect(convertAndRead(fixturePath, { archiveCaps: { maxSharedStringsBytes: 1 } }))
            .rejects.toMatchObject({ code: 'XLSX_ZIP_BOMB' });
    });

    it.each(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml'])(
        'rejects truncated XML in %s instead of emitting partial rows', async part => {
            const fixturePath = await workbookFixture();
            await rewriteWorkbook(fixturePath, async zip => {
                const xml = await zip.file(part).async('string');
                zip.file(part, xml.slice(0, xml.lastIndexOf('</')));
            });
            await expect(convertAndRead(fixturePath)).rejects.toMatchObject({ code: 'XLSX_XML' });
        }
    );

    it('rejects invalid UTF-8 in a cache with a publisher-file error', async () => {
        const fixturePath = await workbookFixture();
        await rewriteWorkbook(fixturePath, async zip => {
            zip.file('xl/sharedStrings.xml', Buffer.from([0xc3, 0x28]));
        });
        await expect(convertAndRead(fixturePath)).rejects.toMatchObject({ code: 'XLSX_XML' });
    });

    it('supports a UTF-16 XML cache with its BOM', async () => {
        const fixturePath = await workbookFixture();
        await rewriteWorkbook(fixturePath, async zip => {
            const xml = (await zip.file('xl/sharedStrings.xml').async('string')).replace('encoding="UTF-8"', 'encoding="UTF-16"');
            zip.file('xl/sharedStrings.xml', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));
        });
        expect((await convertAndRead(fixturePath)).text).toBe('"first"\n"value"\n');
    });

    it('rejects an external first worksheet relationship without fetching it', async () => {
        const fixturePath = await workbookFixture();
        await rewriteWorkbook(fixturePath, async zip => {
            const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
            zip.file('xl/_rels/workbook.xml.rels', rels.replace('Target="worksheets/sheet1.xml"', 'Target="https://example.org/sheet.xml" TargetMode="External"'));
        });
        await expect(convertAndRead(fixturePath)).rejects.toMatchObject({ code: 'XLSX_ARCHIVE' });
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
