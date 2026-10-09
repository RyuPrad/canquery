const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCsvReadStream } = require('../services/csvRead');
const { sniffCsvMeta } = require('../services/csvDownload');

function markedUtf16(text, encoding) {
    const bytes = Buffer.from('\uFEFF' + text, 'utf16le');
    return encoding === 'utf16be' ? bytes.swap16() : bytes;
}

async function readText(filePath, encoding, options) {
    let text = '';
    for await (const chunk of createCsvReadStream(filePath, encoding, options)) text += chunk.toString();
    return text;
}

describe('CSV byte decoding and content detection', () => {
    let directory;
    let filePath;
    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canquery-csv-read-'));
        filePath = path.join(directory, 'data.csv');
    });
    afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

    test.each(['utf16le', 'utf16be'])('decodes BOM-marked %s across bytes and surrogate pairs', async encoding => {
        const text = 'Place,Description\r\nMontréal,"échantillon 🐟"\r\n';
        await fs.writeFile(filePath, markedUtf16(text, encoding));
        await expect(sniffCsvMeta(filePath)).resolves.toEqual({ encoding, delimiter: ',' });
        await expect(readText(filePath, encoding, { highWaterMark: 1 })).resolves.toBe(text);
    });

    test.each(['utf16le', 'utf16be'])('allows a partial %s surrogate only at the sample boundary', async encoding => {
        const prefix = 'Name,Note\nx,';
        const text = prefix + 'a'.repeat((65534 - 2) / 2 - prefix.length) + '🐟\n';
        await fs.writeFile(filePath, markedUtf16(text, encoding));
        await expect(sniffCsvMeta(filePath)).resolves.toEqual({ encoding, delimiter: ',' });
        // The 64 KiB read boundary lands between the fish surrogate pair, just
        // like the sniffing sample boundary, without generating ~44,000 tiny
        // chunks on slower CI runners.
        await expect(readText(filePath, encoding, { highWaterMark: 65536 })).resolves.toBe(text);
    });

    test.each(['utf16le', 'utf16be'])('rejects an incomplete %s code unit at real EOF', async encoding => {
        const bytes = markedUtf16('Name,Note\nx,y\n', encoding);
        await fs.writeFile(filePath, Buffer.concat([bytes, Buffer.from([0x61])]));
        await expect(sniffCsvMeta(filePath)).rejects.toMatchObject({ code: 'CSV_ENCODING' });
        await expect(readText(filePath, encoding, { highWaterMark: 3 })).rejects.toMatchObject({ code: 'CSV_ENCODING' });
    });

    test('keeps filesystem failures as infrastructure errors', async () => {
        await expect(readText(filePath, 'utf16be')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(sniffCsvMeta(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    test.each([
        ['utf8', Buffer.from('Name,Note\nMontréal,été\n', 'utf8')],
        ['latin1', Buffer.from('Name,Note\nMontréal,été\n', 'latin1')]
    ])('preserves existing %s detection without a UTF-16 BOM', async (encoding, bytes) => {
        await fs.writeFile(filePath, bytes);
        await expect(sniffCsvMeta(filePath)).resolves.toEqual({ encoding, delimiter: ',' });
        await expect(readText(filePath, encoding)).resolves.toBe('Name,Note\nMontréal,été\n');
    });

    test.each([
        ['"Title, with commas"|"Code | extra"|Language\r"A | B"|x|fr\r', '|'],
        ['"Title | many | pipes",Note\nA,B\n', ','],
        ['"Title; many; semicolons"\tNote\rA\tB\r', '\t'],
        ['"Title, many, commas";Note\nA;B\n', ';'],
        ['"Title\nwith, commas"|Note\rA|B\r', '|'],
        ['"Title ""quoted, comma"""|Note\rA|B\r', '|']
    ])('detects %s using only unquoted header separators', async (text, delimiter) => {
        await fs.writeFile(filePath, text);
        await expect(sniffCsvMeta(filePath)).resolves.toEqual({ encoding: 'utf8', delimiter });
    });

    test.each([
        ['HTML doctype', Buffer.from('<!doctype html>\n<html lang="en">\n<head><title>Portal</title></head></html>')],
        ['HTML without doctype', Buffer.from(' <!-- error --> <HTML><BODY>Not found</BODY></HTML>')],
        ['UTF-16 HTML', markedUtf16('<!doctype html>\n<html><head><title>Portal</title></head></html>', 'utf16be')],
        ['ZIP workbook', Buffer.from('504b030414000000', 'hex')],
        ['empty ZIP', Buffer.from('504b050600000000', 'hex')],
        ['7z archive', Buffer.from('377abcaf271c0004', 'hex')],
        ['OLE workbook', Buffer.from('d0cf11e0a1b11ae1', 'hex')]
    ])('rejects identifiable %s before CSV loading', async (_label, bytes) => {
        await fs.writeFile(filePath, bytes);
        await expect(sniffCsvMeta(filePath)).rejects.toMatchObject({ code: 'CSV_CONTENT_TYPE' });
    });

    test.each([
        'Name,Markup\nx,"<html><body>hello</body></html>"\n',
        '"<!doctype html>",Note\nx,y\n',
        '<!doctype html>,Note\nx,y\n',
        '<html>,Note\nx,y\n'
    ])('accepts CSV fields containing HTML text', async text => {
        await fs.writeFile(filePath, text);
        await expect(sniffCsvMeta(filePath)).resolves.toEqual({ encoding: 'utf8', delimiter: ',' });
    });
});
