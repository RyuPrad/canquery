const fs = require('node:fs');
const { parse } = require('csv-parse');
const { from: copyFrom } = require('pg-copy-streams');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { inferColumns, pgTypeFor, detectHeaderIndex, mergeTwoRowHeader } = require('../utils/csvTypes');
const { quoteIdent } = require('../utils/filterGrammar');

// Some CKAN exports use CRLF for the header and LF for later records. Let the
// parser accept every conventional record delimiter explicitly; otherwise it
// locks onto CRLF and rejects a correctly quoted field followed by a lone LF.
const CSV_RECORD_DELIMITERS = ['\r\n', '\n', '\r'];

function csvParseOptions(options = {}) {
    return {
        bom: true,
        relax_column_count: true,
        skip_empty_lines: true,
        record_delimiter: CSV_RECORD_DELIMITERS,
        ...options
    };
}

function escapeCsvValue(v) {
    if (v === null || v === undefined) return '';
    return '"' + String(v).replace(/"/g, '""') + '"';
}

async function readSample(filePath, { delimiter, encoding }) {
    return new Promise((resolve, reject) => {
        const records = [];
        let settled = false;
        const readStream = fs.createReadStream(filePath, { encoding });
        const parser = parse(csvParseOptions({ delimiter }));

        const finish = () => {
            const headerIndex = detectHeaderIndex(records);
            const headers = records[headerIndex];
            const next = records[headerIndex + 1];
            const merged = next ? mergeTwoRowHeader(headers, next) : null;
            if (merged) return { headers: merged, rows: records.slice(headerIndex + 2), skipRecords: headerIndex + 2 };
            return { headers, rows: records.slice(headerIndex + 1), skipRecords: headerIndex + 1 };
        };

        parser.on('readable', () => {
            let record;
            while ((record = parser.read()) !== null) {
                records.push(record);
                if (records.length === 1011) {
                    settled = true;
                    readStream.destroy();
                    parser.destroy();
                    resolve(finish());
                }
            }
        });

        parser.on('end', () => {
            if (!settled) {
                settled = true;
                resolve(finish());
            }
        });

        parser.on('error', (err) => {
            if (!settled) {
                settled = true;
                reject(err);
            }
        });

        readStream.pipe(parser);
    });
}

async function loadCsvIntoStore(client, { filePath, tableName, delimiter, encoding, maxRows, maxCols }) {
    const { headers, rows, skipRecords } = await readSample(filePath, { delimiter, encoding });
    if (!headers || headers.length === 0) throw Object.assign(new Error('empty CSV'), { code: 'CSV_EMPTY' });
    if (headers.length > maxCols) {
        const err = new Error('column count ' + headers.length + ' exceeds cap ' + maxCols);
        err.code = 'CAP_COLS';
        throw err;
    }

    const columns = inferColumns(headers, rows);
    const table = 'store.' + quoteIdent(tableName);
    await client.query('DROP TABLE IF EXISTS ' + table);
    await client.query('CREATE TABLE ' + table + ' (_id bigserial, ' + columns.map(c => quoteIdent(c.id) + ' text').join(', ') + ')');

    const colList = columns.map(c => quoteIdent(c.id)).join(', ');
    const copySql = 'COPY ' + table + ' (' + colList + ') FROM STDIN WITH (FORMAT csv)';

    let rowCount = 0;
    let skipped = 0;
    const toCsv = new Transform({
        objectMode: true,
        transform(record, enc, cb) {
            if (skipped < skipRecords) {
                skipped += 1;
                return cb();
            }
            rowCount += 1;
            if (rowCount > maxRows) {
                const err = new Error('row count exceeds cap ' + maxRows);
                err.code = 'CAP_ROWS';
                return cb(err);
            }
            const padded = [];
            for (let i = 0; i < columns.length; i += 1) {
                padded.push(escapeCsvValue(record[i] === undefined ? null : record[i]));
            }
            cb(null, padded.join(',') + '\n');
        }
    });

    await pipeline(
        fs.createReadStream(filePath, { encoding }),
        parse(csvParseOptions({ delimiter })),
        toCsv,
        client.query(copyFrom(copySql))
    );

    const typedColumns = columns.filter(col => col.type !== 'TEXT');
    if (typedColumns.length) {
        // Validate the complete file before changing types. PostgreSQL 16's
        // input validator distinguishes bad publisher values from infrastructure
        // failures, which must abort the import instead of silently using TEXT.
        const checks = typedColumns.map((col, index) =>
            'coalesce(bool_and(pg_input_is_valid(nullif(' + quoteIdent(col.id) +
            ', \'\'), $' + (index + 1) + ')), true) AS "cast_' + index + '"'
        );
        const { rows: validity } = await client.query(
            'SELECT ' + checks.join(', ') + ' FROM ' + table,
            typedColumns.map(col => pgTypeFor(col.type))
        );
        const alterations = [];
        typedColumns.forEach((col, index) => {
            if (validity[0]['cast_' + index] !== true) {
                col.type = 'TEXT';
                col.cast_failed = true;
                return;
            }
            const ident = quoteIdent(col.id);
            const type = pgTypeFor(col.type);
            alterations.push('ALTER COLUMN ' + ident + ' TYPE ' + type +
                ' USING nullif(' + ident + ', \'\')::' + type);
        });
        if (alterations.length) {
            // A separate ALTER for each column keeps many rewritten relations
            // alive until commit. Combine conversions into one table rewrite.
            await client.query('ALTER TABLE ' + table + ' ' + alterations.join(', '));
        }
    }

    return { rowCount, columns };
}

module.exports = { loadCsvIntoStore, escapeCsvValue, csvParseOptions, CSV_RECORD_DELIMITERS };
