const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { fork } = require('node:child_process');
const ExcelJS = require('exceljs');
// These readers/xforms belong to the lockfile-pinned ExcelJS installation.
const WorksheetReader = require('exceljs/lib/stream/xlsx/worksheet-reader');
const WorkbookXform = require('exceljs/lib/xlsx/xform/book/workbook-xform');
const RelationshipsXform = require('exceljs/lib/xlsx/xform/core/relationships-xform');
const SharedStringsXform = require('exceljs/lib/xlsx/xform/strings/shared-strings-xform');
const { SaxesParser } = require('saxes');
const XLSX = require('xlsx');
const { escapeCsvValue } = require('./csvLoad');
const { makeSafeWriter } = require('./csvDownload');

const CHILD_ARG = '--canquery-excel-converter';
const DEFAULT_MEMORY_MB = 384;
const DEFAULT_TIMEOUT_MS = 120000;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

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
        const parts = new Map();
        const names = new Set();

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

            const name = central.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
            const normalizedName = name.toLowerCase();
            if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') ||
                name.split('/').some(segment => segment === '.' || segment === '..') || names.has(normalizedName)) {
                throw capError('invalid or duplicate XLSX archive part', 'XLSX_ARCHIVE');
            }
            names.add(normalizedName);
            const localOffset = central.readUInt32LE(offset + 42);
            if (localOffset === 0xffffffff || localOffset + 30 > centralOffset) {
                throw capError('invalid XLSX archive part offset', 'XLSX_ARCHIVE');
            }
            parts.set(name, { name, flags, method, compressed, uncompressed, localOffset, centralOffset });
            totalCompressed += compressed;
            totalUncompressed += uncompressed;

            if (uncompressed > limits.maxEntryUncompressedBytes) {
                throw capError('XLSX archive entry exceeds uncompressed-size cap', 'XLSX_ZIP_BOMB');
            }
            if (uncompressed > 1024 * 1024 && uncompressed / Math.max(1, compressed) > limits.maxCompressionRatio) {
                throw capError('XLSX archive entry exceeds compression-ratio cap', 'XLSX_ZIP_BOMB');
            }
            if (normalizedName === 'xl/sharedstrings.xml' && uncompressed > limits.maxSharedStringsBytes) {
                throw capError('XLSX shared strings exceed memory cap', 'XLSX_ZIP_BOMB');
            }
            if (normalizedName === 'xl/styles.xml' && uncompressed > limits.maxStylesBytes) {
                throw capError('XLSX styles exceed memory cap', 'XLSX_ZIP_BOMB');
            }
            if (totalUncompressed > limits.maxUncompressedBytes) {
                throw capError('XLSX uncompressed size exceeds cap', 'XLSX_ZIP_BOMB');
            }
            offset += entryLength;
        }

        if (!parts.has('xl/workbook.xml') || !parts.has('xl/_rels/workbook.xml.rels')) {
            throw capError('archive is missing XLSX workbook metadata', 'XLSX_ARCHIVE');
        }
        if (totalUncompressed > 1024 * 1024 &&
            totalUncompressed / Math.max(1, totalCompressed) > limits.maxCompressionRatio) {
            throw capError('XLSX archive exceeds compression-ratio cap', 'XLSX_ZIP_BOMB');
        }
        return { entries: totalEntries, totalCompressed, totalUncompressed, parts, limits };
    } finally {
        await handle.close();
    }
}

// Read only addressed package parts; ZIP order never selects the worksheet or
// determines when its string/style caches become available. Nothing is extracted.
async function* readArchivePart(filePath, part) {
    const handle = await fs.promises.open(filePath, 'r');
    let dataOffset;
    try {
        const header = Buffer.alloc(30);
        const { bytesRead } = await handle.read(header, 0, header.length, part.localOffset);
        if (bytesRead !== 30 || header.readUInt32LE(0) !== ZIP_LOCAL_SIGNATURE ||
            header.readUInt16LE(6) !== part.flags || header.readUInt16LE(8) !== part.method) {
            throw capError('invalid XLSX local archive entry', 'XLSX_ARCHIVE');
        }
        const nameLength = header.readUInt16LE(26);
        const extraLength = header.readUInt16LE(28);
        const name = Buffer.alloc(nameLength);
        await handle.read(name, 0, name.length, part.localOffset + 30);
        dataOffset = part.localOffset + 30 + nameLength + extraLength;
        if (name.toString('utf8') !== part.name || dataOffset + part.compressed > part.centralOffset) {
            throw capError('invalid XLSX local archive part', 'XLSX_ARCHIVE');
        }
    } finally { await handle.close(); }
    if (part.compressed === 0) {
        if (part.uncompressed !== 0) throw capError('invalid XLSX archive part size', 'XLSX_ARCHIVE');
        return;
    }
    const source = fs.createReadStream(filePath, { start: dataOffset, end: dataOffset + part.compressed - 1 });
    const stream = part.method === 8 ? source.pipe(zlib.createInflateRaw()) : source;
    if (stream !== source) source.on('error', error => stream.destroy(error));
    let bytes = 0;
    try {
        for await (const chunk of stream) {
            bytes += chunk.length;
            if (bytes > part.uncompressed) throw capError('XLSX part exceeds declared expansion', 'XLSX_ZIP_BOMB');
            yield chunk;
        }
        if (bytes !== part.uncompressed) throw capError('invalid XLSX archive part size', 'XLSX_ARCHIVE');
    } catch (error) {
        if (['Z_DATA_ERROR', 'Z_BUF_ERROR'].includes(error.code)) {
            throw capError('invalid XLSX compressed part', 'XLSX_ARCHIVE');
        }
        throw error;
    } finally {
        stream.destroy();
        source.destroy();
    }
}

async function* readXmlPart(filePath, part) {
    const parser = new SaxesParser();
    let xmlError;
    parser.on('error', () => { xmlError = capError('invalid XLSX XML', 'XLSX_XML'); });
    let decoder;
    for await (const chunk of readArchivePart(filePath, part)) {
        if (!decoder) {
            const encoding = chunk[0] === 0xff && chunk[1] === 0xfe ? 'utf-16le'
                : chunk[0] === 0xfe && chunk[1] === 0xff ? 'utf-16be' : 'utf-8';
            decoder = new TextDecoder(encoding, { fatal: true });
        }
        let text;
        try { text = decoder.decode(chunk, { stream: true }); }
        catch { throw capError('invalid XLSX XML encoding', 'XLSX_XML'); }
        parser.write(text);
        if (xmlError) throw xmlError;
        yield text;
    }
    let tail;
    try { tail = decoder ? decoder.decode() : ''; }
    catch { throw capError('invalid XLSX XML encoding', 'XLSX_XML'); }
    parser.write(tail).close();
    if (xmlError) throw xmlError;
    if (tail) yield tail;
}

async function parseArchiveXml(filePath, part, xform) {
    const iterator = readXmlPart(filePath, part)[Symbol.asyncIterator]();
    // ExcelJS xforms return at the root closing tag. Keep their early return
    // from cancelling validation of later bytes/truncated or trailing XML.
    const input = { [Symbol.asyncIterator]: () => ({ next: () => iterator.next() }) };
    try {
        const model = await xform.parseStream(input);
        for await (const chunk of iterator) { void chunk; }
        return model;
    } catch (error) {
        if (!error.code && /^Unexpected xml node in parse(?:Open|Close):/.test(error.message)) {
            throw capError('invalid XLSX XML structure', 'XLSX_XML');
        }
        throw error;
    } finally { await iterator.return(); }
}

function relationshipPart(relationship, parts) {
    if (!relationship || String(relationship.TargetMode || '').toLowerCase() === 'external' ||
        typeof relationship.Target !== 'string' || /[\\?#\0]/.test(relationship.Target) ||
        /^[a-z][a-z\d+.-]*:/i.test(relationship.Target)) {
        throw capError('invalid XLSX workbook relationship', 'XLSX_ARCHIVE');
    }
    let target;
    try { target = decodeURIComponent(relationship.Target); }
    catch { throw capError('invalid XLSX workbook relationship target', 'XLSX_ARCHIVE'); }
    const name = path.posix.normalize(target.startsWith('/') ? target.slice(1) : 'xl/' + target);
    const part = parts.get(name);
    if (!part || !name.startsWith('xl/') || name.includes('\\') || name.includes('\0')) {
        throw capError('missing or invalid XLSX relationship part', 'XLSX_ARCHIVE');
    }
    return part;
}

async function firstWorksheetReader(filePath, archive) {
    const { parts, limits } = archive;
    const workbookXform = new WorkbookXform();
    const model = await parseArchiveXml(filePath, parts.get('xl/workbook.xml'), workbookXform);
    const rels = await parseArchiveXml(filePath, parts.get('xl/_rels/workbook.xml.rels'), new RelationshipsXform());
    const first = model?.sheets?.[0];
    if (!first || !Array.isArray(rels)) throw capError('empty or invalid XLSX workbook', 'XLSX_ARCHIVE');
    const ids = new Set();
    for (const rel of rels) {
        if (!rel.Id || ids.has(rel.Id)) throw capError('duplicate XLSX relationship identity', 'XLSX_ARCHIVE');
        ids.add(rel.Id);
    }
    const sheetRel = rels.find(rel => rel.Id === first.rId);
    if (!sheetRel || !sheetRel.Type?.endsWith('/worksheet')) {
        throw capError('first XLSX sheet is not a worksheet', 'XLSX_ARCHIVE');
    }
    const sheetPart = relationshipPart(sheetRel, parts);
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(null, {
        sharedStrings: 'cache', styles: 'cache', hyperlinks: 'ignore', worksheets: 'emit'
    });
    // WorksheetReader expects the workbook-properties xform shape, whereas
    // WorkbookXform.parseStream returns a model containing plain properties.
    reader.properties = { model: model.properties || {} };
    reader.model = model;
    reader.sharedStrings = [];
    for (const [type, maxBytes] of [['sharedStrings', limits.maxSharedStringsBytes], ['styles', limits.maxStylesBytes]]) {
        const matches = rels.filter(rel => rel.Type?.endsWith('/' + type));
        if (matches.length > 1) throw capError('duplicate XLSX cache relationship', 'XLSX_ARCHIVE');
        if (!matches.length) continue;
        const part = relationshipPart(matches[0], parts);
        if (part.uncompressed > maxBytes) throw capError('XLSX cache exceeds memory cap', 'XLSX_ZIP_BOMB');
        if (type === 'styles') await parseArchiveXml(filePath, part, reader.styles);
        else reader.sharedStrings = (await parseArchiveXml(filePath, part, new SharedStringsXform())).values;
    }
    return new WorksheetReader({
        workbook: reader, id: first.id, iterator: readXmlPart(filePath, sheetPart), options: reader.options
    });
}

async function convertXlsxInProcess(xlsxPath, {
    maxRows,
    maxCols,
    maxCsvBytes,
    archiveCaps,
    outputPath
}) {
    const archive = await inspectXlsxArchive(xlsxPath, archiveCaps);
    const worksheet = await firstWorksheetReader(xlsxPath, archive);

    const csvPath = outputPath || path.join(os.tmpdir(), 'canquery-xlsx-' + crypto.randomUUID() + '.csv');
    const stream = fs.createWriteStream(csvPath);
    const writer = makeSafeWriter(stream);
    try {
        let rowCount = 0;
        let bytesWritten = 0;
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
        if (rowCount === 0) throw capError('empty XLSX worksheet', 'EXCEL_EMPTY');
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
    if (!sheetName) throw capError('empty XLS workbook', 'EXCEL_EMPTY');
    const sheet = wb.Sheets[sheetName];
    const rangeRef = sheet['!fullref'] || sheet['!ref'];
    if (!rangeRef) throw capError('empty XLS worksheet', 'EXCEL_EMPTY');
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
        if (rowCount === 0) throw capError('empty XLS worksheet', 'EXCEL_EMPTY');
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
    const { signal, ...childOptions } = options;
    signal?.throwIfAborted();
    // Resolve configured caps in the parent, then send explicit values. The
    // converter has no reason to inherit database, billing or object secrets,
    // NODE_OPTIONS preload hooks, or other runtime process configuration.
    childOptions.archiveCaps = archiveLimits(childOptions.archiveCaps);
    const childEnvironment = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'TMP', 'TEMP']
        .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
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
            env: childEnvironment,
            stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        });
        let settled = false;
        let outcome = null;
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            if (stderr.length < 4096) stderr += chunk.toString();
        });

        const finish = (err, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (child.connected) child.disconnect();
            if (err) {
                fs.promises.unlink(outputPath).catch(() => {}).finally(() => reject(err));
            } else resolve(result);
        };
        const terminate = error => {
            if (settled) return;
            outcome = { error };
            child.kill('SIGKILL');
        };
        const abort = () => terminate(signal.reason);
        const timer = setTimeout(() => terminate(capError('Excel conversion timed out', 'EXCEL_TIMEOUT')), timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();

        child.once('error', (err) => { outcome = { error: err }; if (!child.pid) finish(err); });
        child.once('exit', (code, exitSignal) => {
            if (settled) return;
            // Wait until the child has exited before unlinking
            // a partial output; it must not recreate the file after cleanup.
            if (outcome?.error) return finish(outcome.error);
            if (outcome?.result && code === 0) return finish(null, outcome.result);
            const detail = stderr.trim() ? ': ' + stderr.trim().slice(0, 500) : '';
            finish(capError(
                'Excel conversion process failed (' + (exitSignal || code) + ')' + detail,
                'EXCEL_CONVERSION'
            ));
        });
        child.once('message', (message) => {
            if (outcome?.error) return;
            if (message && message.ok) {
                outcome = { result: message.result };
                if (child.connected) child.disconnect();
                return;
            }
            outcome = { error: capError(
                message && message.error && message.error.message
                    ? message.error.message
                    : 'Excel conversion failed',
                message && message.error && message.error.code
                    ? message.error.code
                    : 'EXCEL_CONVERSION'
            ) };
            if (child.connected) child.disconnect();
        });
        child.send({ kind, inputPath, options: { ...childOptions, outputPath } });
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
