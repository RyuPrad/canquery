const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const { escapeCsvValue } = require('./csvLoad');
const { makeSafeWriter } = require('./csvDownload');

// Normalize any Excel cell value to a string (shared by both converters)
function normalizeCellValue(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
        if (v.error !== undefined) return '';
        if (Array.isArray(v.richText)) return v.richText.map(s => s.text).join('');
        if (v.formula !== undefined || v.sharedFormula !== undefined) {
            return normalizeCellValue(v.result === undefined ? null : v.result);
        }
        if (v.text !== undefined) return String(v.text);
        return '';
    }
    return String(v);
}

async function convertXlsxToCsv(xlsxPath, { maxRows, maxCols, maxCsvBytes }) {
    // styles must be 'cache' or date cells arrive as raw Excel serial
    // numbers and would land as integers.
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(xlsxPath, {
        entries: 'ignore',
        sharedStrings: 'cache',
        hyperlinks: 'ignore',
        styles: 'cache',
        worksheets: 'emit'
    });

    const csvPath = path.join(os.tmpdir(), 'canquery-xlsx-' + crypto.randomUUID() + '.csv');
    const ws = fs.createWriteStream(csvPath);
    const writer = makeSafeWriter(ws);

    try {
        let rowCount = 0;
        let bytesWritten = 0;

        // worksheets emit in zip-entry order which matches workbook order
        // in practice (not formally guaranteed).
        for await (const worksheet of reader) {
            for await (const row of worksheet) {
                // row.values is 1-based and sparse
                const cells = [];
                for (let i = 1; i < row.values.length; i += 1) {
                    cells.push(normalizeCellValue(row.values[i]));
                }

                // trim trailing empty cells
                while (cells.length > 0 && cells[cells.length - 1] === '') {
                    cells.pop();
                }

                // skip completely empty rows
                if (cells.length === 0) continue;

                if (cells.length > maxCols) {
                    const err = new Error('column count ' + cells.length + ' exceeds cap ' + maxCols);
                    err.code = 'CAP_COLS';
                    throw err;
                }

                const line = cells.map(escapeCsvValue).join(',') + '\n';
                const lineBytes = Buffer.byteLength(line);

                if (bytesWritten + lineBytes > maxCsvBytes) {
                    const err = new Error('converted CSV exceeds size cap (' + maxCsvBytes + ' bytes)');
                    err.code = 'CAP_FILE';
                    throw err;
                }

                await writer.write(line);

                bytesWritten += lineBytes;
                rowCount += 1;

                // +10 covers the header-preamble detection window;
                // csvLoad enforces the exact cap.
                if (rowCount > maxRows + 10) {
                    const err = new Error('row count exceeds cap ' + maxRows);
                    err.code = 'CAP_ROWS';
                    throw err;
                }
            }
            break; // only process the first worksheet
        }

        if (rowCount === 0) throw new Error('empty XLSX worksheet');

        await writer.end();
        return { csvPath, rowCount };
    } catch (err) {
        // makeSafeWriter holds a persistent 'error' listener, so destroying the
        // stream with a write still in flight no longer emits an unhandled
        // ERR_STREAM_DESTROYED that crashes the worker. Wait for close before
        // unlink so the lazy open cannot recreate the file after unlink.
        await new Promise((resolve) => {
            ws.once('close', resolve);
            ws.destroy();
        });
        try {
            await fs.promises.unlink(csvPath);
        } catch {
            // ignore
        }
        throw err;
    }
}

async function convertXlsToCsv(xlsPath, { maxRows, maxCols, maxCsvBytes }) {
    // Legacy .xls cannot be streamed; the whole workbook is read in memory.
    // That is acceptable because the download is already capped.
    const wb = XLSX.readFile(xlsPath, { cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('empty XLS workbook');

    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });

    const lines = [];
    let rowCount = 0;
    let bytesWritten = 0;

    for (const row of rows) {
        const cells = row.map(v => normalizeCellValue(v));

        while (cells.length > 0 && cells[cells.length - 1] === '') {
            cells.pop();
        }

        if (cells.length === 0) continue;

        if (cells.length > maxCols) {
            const err = new Error('column count ' + cells.length + ' exceeds cap ' + maxCols);
            err.code = 'CAP_COLS';
            throw err;
        }

        const line = cells.map(escapeCsvValue).join(',') + '\n';
        const lineBytes = Buffer.byteLength(line);

        if (bytesWritten + lineBytes > maxCsvBytes) {
            const err = new Error('converted CSV exceeds size cap (' + maxCsvBytes + ' bytes)');
            err.code = 'CAP_FILE';
            throw err;
        }

        lines.push(line);
        bytesWritten += lineBytes;
        rowCount += 1;

        if (rowCount > maxRows + 10) {
            const err = new Error('row count exceeds cap ' + maxRows);
            err.code = 'CAP_ROWS';
            throw err;
        }
    }

    if (rowCount === 0) throw new Error('empty XLS worksheet');

    const csvPath = path.join(os.tmpdir(), 'canquery-xls-' + crypto.randomUUID() + '.csv');
    await fs.promises.writeFile(csvPath, lines.join(''));
    return { csvPath, rowCount };
}

module.exports = { convertXlsxToCsv, convertXlsToCsv };
