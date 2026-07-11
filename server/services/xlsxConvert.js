const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const { escapeCsvValue } = require('./csvLoad');
const { makeSafeWriter } = require('./csvDownload');

const CHILD_ARG = '--canquery-excel-converter';
const DEFAULT_MEMORY_MB = 384;
const DEFAULT_TIMEOUT_MS = 120000;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;

function positiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(max, Math.floor(parsed));
}

function capError(message, code) {
    const err = new Error(message);
    err.code = code;
    return err;
}

// Normalize any Excel cell value to a string (shared by both converters).
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

function archiveLimits(overrides = {}) {
    const mb = 1024 * 1024;
    return {
        maxEntries: positiveInt(overrides.maxEntries || process.env.XLSX_MAX_ENTRIES, 5000),
        maxCentralDirectoryBytes: positiveInt(
            overrides.maxCentralDirectoryBytes || process.env.XLSX_MAX_CENTRAL_DIRECTORY_MB * mb,
            16 * mb
        ),
        maxUncompressedBytes: positiveInt(
            overrides.maxUncompressedBytes || process.env.XLSX_MAX_UNCOMPRESSED_MB * mb,
            256 * mb
        ),
        maxEntryUncompressedBytes: positiveInt(
            overrides.maxEntryUncompressedBytes || process.env.XLSX_MAX_ENTRY_MB * mb,
            128 * mb
        ),
        maxSharedStringsBytes: positiveInt(
            overrides.maxSharedStringsBytes || process.env.XLSX_MAX_SHARED_STRINGS_MB * mb,
            64 * mb
        ),
        maxStylesBytes: positiveInt(
            overrides.maxStylesBytes || process.env.XLSX_MAX_STYLES_MB * mb,
            16 * mb
        ),
        maxCompressionRatio: positiveInt(
            overrides.maxCompressionRatio || process.env.XLSX_MAX_COMPRESSION_RATIO,
            100
        )
    };
}

async function inspectXlsxArchive(filePath, overrides = {}) {
    const limits = archiveLimits(overrides);
    const handle = await fs.promises.open(filePath, 'r');
    try {
        const stat = await handle.stat();
        const tailSize = Math.min(stat.size, 65557);
        if (tailSize < 22) throw capError('invalid XLSX archive', 'XLSX_ARCHIVE');
        const tail = Buffer.allocUnsafe(tailSize);
        await handle.read(tail, 0, tail.length, stat.size - tailSize);

        let eocd = -1;
        for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
            if (tail.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
                eocd = offset;
                break;
            }
        }
        if (eocd === -1) throw capError('invalid XLSX archive directory', 'XLSX_ARCHIVE');

        const disk = tail.readUInt16LE(eocd + 4);
        const centralDisk = tail.readUInt16LE(eocd + 6);
        const diskEntries = tail.readUInt16LE(eocd + 8);
        const totalEntries = tail.readUInt16LE(eocd + 10);
        const centralSize = tail.readUInt32LE(eocd + 12);
        const centralOffset = tail.readUInt32LE(eocd + 16);
        if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
            throw capError('multi-disk XLSX archives are not supported', 'XLSX_ARCHIVE');
        }
        if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
            throw capError('ZIP64 XLSX archives are not supported', 'XLSX_ARCHIVE');
        }
        if (totalEntries > limits.maxEntries) {
            throw capError('XLSX archive entry count exceeds cap', 'XLSX_ZIP_BOMB');
        }
        if (centralSize > limits.maxCentralDirectoryBytes || centralOffset + centralSize > stat.size) {
            throw capError('XLSX archive directory exceeds cap', 'XLSX_ZIP_BOMB');
        }

        const central = Buffer.allocUnsafe(centralSize);
        await handle.read(central, 0, central.length, centralOffset);
        let offset = 0;
        let totalCompressed = 0;
        let totalUncompressed = 0;
        let sawWorkbook = false;

        for (let index = 0; index < totalEntries; index += 1) {
            if (offset + 46 > central.length || central.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
                throw capError('invalid XLSX archive entry', 'XLSX_ARCHIVE');
            }
            const flags = central.readUInt16LE(offset + 8);
            const method = central.readUInt16LE(offset + 10);
            const compressed = central.readUInt32LE(offset + 20);
            const uncompressed = central.readUInt32LE(offset + 24);
            const nameLength = central.readUInt16LE(offset + 28);
            const extraLength = central.readUInt16LE(offset + 30);
            const commentLength = central.readUInt16LE(offset + 32);
            const entryLength = 46 + nameLength + extraLength + commentLength;
            if (offset + entryLength > central.length) {
                throw capError('invalid XLSX archive entry length', 'XLSX_ARCHIVE');
            }
            if ((flags & 1) !== 0) throw capError('encrypted XLSX archives are not supported', 'XLSX_ARCHIVE');
            if (method !== 0 && method !== 8) {
                throw capError('unsupported XLSX compression method', 'XLSX_ARCHIVE');
            }
            if (compressed === 0xffffffff || uncompressed === 0xffffffff) {
                throw capError('ZIP64 XLSX entries are not supported', 'XLSX_ARCHIVE');
            }

            const name = central.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').toLowerCase();
            sawWorkbook ||= name === 'xl/workbook.xml';
            totalCompressed += compressed;
            totalUncompressed += uncompressed;

            if (uncompressed > limits.maxEntryUncompressedBytes) {
                throw capError('XLSX archive entry exceeds uncompressed-size cap', 'XLSX_ZIP_BOMB');
            }
            if (uncompressed > 1024 * 1024 && uncompressed / Math.max(1, compressed) > limits.maxCompressionRatio) {
                throw capError('XLSX archive entry exceeds compression-ratio cap', 'XLSX_ZIP_BOMB');
            }
            if (name === 'xl/sharedstrings.xml' && uncompressed > limits.maxSharedStringsBytes) {
                throw capError('XLSX shared strings exceed memory cap', 'XLSX_ZIP_BOMB');
            }
            if (name === 'xl/styles.xml' && uncompressed > limits.maxStylesBytes) {
                throw capError('XLSX styles exceed memory cap', 'XLSX_ZIP_BOMB');
            }
            if (totalUncompressed > limits.maxUncompressedBytes) {
                throw capError('XLSX uncompressed size exceeds cap', 'XLSX_ZIP_BOMB');
            }
            offset += entryLength;
        }

        if (!sawWorkbook) throw capError('archive is not an XLSX workbook', 'XLSX_ARCHIVE');
        if (totalUncompressed > 1024 * 1024 &&
            totalUncompressed / Math.max(1, totalCompressed) > limits.maxCompressionRatio) {
            throw capError('XLSX archive exceeds compression-ratio cap', 'XLSX_ZIP_BOMB');
        }
        return { entries: totalEntries, totalCompressed, totalUncompressed };
    } finally {
        await handle.close();
    }
}

async function convertXlsxInProcess(xlsxPath, {
    maxRows,
    maxCols,
    maxCsvBytes,
    archiveCaps,
    outputPath
}) {
    await inspectXlsxArchive(xlsxPath, archiveCaps);

    // styles must be cached or date cells arrive as raw Excel serial numbers.
    // The preflight above bounds both styles.xml and sharedStrings.xml before
    // ExcelJS is allowed to populate either cache.
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(xlsxPath, {
        entries: 'ignore',
        sharedStrings: 'cache',
        hyperlinks: 'ignore',
        styles: 'cache',
        worksheets: 'emit'
    });

    const csvPath = outputPath || path.join(os.tmpdir(), 'canquery-xlsx-' + crypto.randomUUID() + '.csv');
    const stream = fs.createWriteStream(csvPath);
    const writer = makeSafeWriter(stream);
    try {
        let rowCount = 0;
        let bytesWritten = 0;
        for await (const worksheet of reader) {
            for await (const row of worksheet) {
                if (row.cellCount > maxCols) {
                    throw capError('column count ' + row.cellCount + ' exceeds cap ' + maxCols, 'CAP_COLS');
                }
                const cells = [];
                for (let index = 1; index <= row.cellCount; index += 1) {
                    cells.push(normalizeCellValue(row.getCell(index).value));
                }
                while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
                if (cells.length === 0) continue;

                const line = cells.map(escapeCsvValue).join(',') + '\n';
                const lineBytes = Buffer.byteLength(line);
                if (bytesWritten + lineBytes > maxCsvBytes) {
                    throw capError('converted CSV exceeds size cap (' + maxCsvBytes + ' bytes)', 'CAP_FILE');
                }
                await writer.write(line);
                bytesWritten += lineBytes;
                rowCount += 1;
                // +10 covers the header-preamble detection window; csvLoad
                // enforces the exact data-row cap.
                if (rowCount > maxRows + 10) {
                    throw capError('row count exceeds cap ' + maxRows, 'CAP_ROWS');
                }
            }
            break;
        }
        if (rowCount === 0) throw new Error('empty XLSX worksheet');
        await writer.end();
        return { csvPath, rowCount };
    } catch (err) {
        await new Promise((resolve) => {
            stream.once('close', resolve);
            stream.destroy();
        });
        await fs.promises.unlink(csvPath).catch(() => {});
        throw err;
    }
}

async function convertXlsInProcess(xlsPath, { maxRows, maxCols, maxCsvBytes, outputPath }) {
    // SheetJS must parse legacy BIFF workbooks in memory, but sheetRows bounds
    // parsing, row output is streamed, and the whole conversion runs in a
    // memory-limited child process (see runIsolatedConversion below).
    const wb = XLSX.readFile(xlsPath, {
        cellDates: true,
        cellFormula: false,
        cellHTML: false,
        cellNF: false,
        cellStyles: false,
        bookFiles: false,
        bookVBA: false,
        sheetRows: maxRows + 11
    });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('empty XLS workbook');
    const sheet = wb.Sheets[sheetName];
    const rangeRef = sheet['!fullref'] || sheet['!ref'];
    if (!rangeRef) throw new Error('empty XLS worksheet');
    const range = XLSX.utils.decode_range(rangeRef);
    const declaredRows = range.e.r - range.s.r + 1;
    const declaredCols = range.e.c - range.s.c + 1;
    if (declaredRows > maxRows + 10) {
        throw capError('row count exceeds cap ' + maxRows, 'CAP_ROWS');
    }
    if (declaredCols > maxCols) {
        throw capError('column count ' + declaredCols + ' exceeds cap ' + maxCols, 'CAP_COLS');
    }

    const csvPath = outputPath || path.join(os.tmpdir(), 'canquery-xls-' + crypto.randomUUID() + '.csv');
    const stream = fs.createWriteStream(csvPath);
    const writer = makeSafeWriter(stream);
    try {
        let rowCount = 0;
        let bytesWritten = 0;
        for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
            const cells = [];
            for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
                const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })];
                cells.push(normalizeCellValue(cell ? cell.v : null));
            }
            while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
            if (cells.length === 0) continue;

            const line = cells.map(escapeCsvValue).join(',') + '\n';
            const lineBytes = Buffer.byteLength(line);
            if (bytesWritten + lineBytes > maxCsvBytes) {
                throw capError('converted CSV exceeds size cap (' + maxCsvBytes + ' bytes)', 'CAP_FILE');
            }
            await writer.write(line);
            bytesWritten += lineBytes;
            rowCount += 1;
            if (rowCount > maxRows + 10) {
                throw capError('row count exceeds cap ' + maxRows, 'CAP_ROWS');
            }
        }
        if (rowCount === 0) throw new Error('empty XLS worksheet');
        await writer.end();
        return { csvPath, rowCount };
    } catch (err) {
        await new Promise((resolve) => {
            stream.once('close', resolve);
            stream.destroy();
        });
        await fs.promises.unlink(csvPath).catch(() => {});
        throw err;
    }
}

function runIsolatedConversion(kind, inputPath, options) {
    const memoryMb = positiveInt(process.env.EXCEL_CONVERT_MEMORY_MB, DEFAULT_MEMORY_MB, {
        min: 64,
        max: 1024
    });
    const timeoutMs = positiveInt(process.env.EXCEL_CONVERT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, {
        min: 1000,
        max: 15 * 60 * 1000
    });
    const outputPath = path.join(
        os.tmpdir(),
        'canquery-' + kind + '-' + crypto.randomUUID() + '.csv'
    );
    return new Promise((resolve, reject) => {
        const child = fork(__filename, [CHILD_ARG], {
            execArgv: ['--max-old-space-size=' + memoryMb],
            stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        });
        let settled = false;
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            if (stderr.length < 4096) stderr += chunk.toString();
        });

        const finish = (err, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (child.connected) child.disconnect();
            if (err) {
                fs.promises.unlink(outputPath).catch(() => {}).finally(() => reject(err));
            } else resolve(result);
        };
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            finish(capError('Excel conversion timed out', 'EXCEL_TIMEOUT'));
        }, timeoutMs);

        child.once('error', (err) => finish(err));
        child.once('exit', (code, signal) => {
            if (settled) return;
            const detail = stderr.trim() ? ': ' + stderr.trim().slice(0, 500) : '';
            finish(capError(
                'Excel conversion process failed (' + (signal || code) + ')' + detail,
                'EXCEL_CONVERSION'
            ));
        });
        child.once('message', (message) => {
            if (message && message.ok) {
                finish(null, message.result);
                return;
            }
            finish(capError(
                message && message.error && message.error.message
                    ? message.error.message
                    : 'Excel conversion failed',
                message && message.error && message.error.code
                    ? message.error.code
                    : 'EXCEL_CONVERSION'
            ));
        });
        child.send({ kind, inputPath, options: { ...options, outputPath } });
    });
}

async function convertXlsxToCsv(xlsxPath, options) {
    return runIsolatedConversion('xlsx', xlsxPath, options);
}

async function convertXlsToCsv(xlsPath, options) {
    return runIsolatedConversion('xls', xlsPath, options);
}

async function runChild() {
    process.once('message', async ({ kind, inputPath, options }) => {
        try {
            const result = kind === 'xlsx'
                ? await convertXlsxInProcess(inputPath, options)
                : await convertXlsInProcess(inputPath, options);
            if (process.send) process.send({ ok: true, result });
        } catch (err) {
            if (process.send) {
                process.send({
                    ok: false,
                    error: { message: err.message, code: err.code }
                });
            }
        }
    });
}

if (process.argv.includes(CHILD_ARG)) runChild();

module.exports = {
    convertXlsxToCsv,
    convertXlsToCsv,
    inspectXlsxArchive,
    normalizeCellValue
};
