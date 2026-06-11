const fs = require('node:fs');
const { parse } = require('csv-parse');
const { from: copyFrom } = require('pg-copy-streams');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { inferColumns, pgTypeFor } = require('../utils/csvTypes');
const { quoteIdent } = require('../utils/filterGrammar');

function escapeCsvValue(v) {
    if (v === null || v === undefined) return '';
    return '"' + String(v).replace(/"/g, '""') + '"';
}

async function readSample(filePath, { delimiter, encoding }) {
    return new Promise((resolve, reject) => {
        let headers;
        const rows = [];
        let settled = false;
        const readStream = fs.createReadStream(filePath, { encoding });
        const parser = parse({ bom: true, delimiter, relax_column_count: true, skip_empty_lines: true });

        parser.on('readable', () => {
            let record;
            while ((record = parser.read()) !== null) {
                if (headers === undefined) {
                    headers = record;
                } else {
                    rows.push(record);
                    if (rows.length === 1000) {
                        settled = true;
                        readStream.destroy();
                        parser.destroy();
                        resolve({ headers, rows });
                    }
                }
            }
        });

        parser.on('end', () => {
            if (!settled) {
                settled = true;
                resolve({ headers, rows });
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
    const { headers, rows } = await readSample(filePath, { delimiter, encoding });
    if (!headers || headers.length === 0) throw new Error('empty CSV');
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
    let first = true;
    const toCsv = new Transform({
        objectMode: true,
        transform(record, enc, cb) {
            if (first) {
                first = false;
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
        parse({ bom: true, delimiter, relax_column_count: true, skip_empty_lines: true }),
        toCsv,
        client.query(copyFrom(copySql))
    );

    for (const col of columns) {
        if (col.type === 'TEXT') continue;
        const ident = quoteIdent(col.id);
        try {
            await client.query('SAVEPOINT cast_col');
            await client.query('ALTER TABLE ' + table + ' ALTER COLUMN ' + ident + ' TYPE ' + pgTypeFor(col.type) + ' USING nullif(' + ident + ', \'\')::' + pgTypeFor(col.type));
            await client.query('RELEASE SAVEPOINT cast_col');
        } catch (err) {
            await client.query('ROLLBACK TO SAVEPOINT cast_col');
            col.type = 'TEXT';
            col.cast_failed = true;
        }
    }

    return { rowCount, columns };
}

module.exports = { loadCsvIntoStore };
