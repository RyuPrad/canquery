const fs = require('fs');
const pool = require('../db/pool');
const { downloadToTempFile, sniffCsvMeta } = require('./csvDownload');
const { loadCsvIntoStore } = require('./csvLoad');
const { convertXlsxToCsv, convertXlsToCsv } = require('./xlsxConvert');
const { TABLE_NAME_RE } = require('../db/storeQueries');

function tableNameFor(resourceId) {
    return 'r_' + String(resourceId).toLowerCase().replace(/[^0-9a-f]/g, '_');
}

async function ingestResource(resource, caps) {
    const tableName = tableNameFor(resource.id);
    if (!TABLE_NAME_RE.test(tableName)) {
        throw new Error('cannot derive a safe table name');
    }

    const used = Number((await pool.query('SELECT coalesce(sum(byte_size),0)::bigint AS used FROM ingested_resources')).rows[0].used);
    if (used >= caps.storeBudgetBytes) {
        const err = new Error('store budget exceeded (' + used + ' bytes used)');
        err.code = 'BUDGET';
        throw err;
    }

    const format = String(resource.format || '').toUpperCase();
    const isExcel = format === 'XLSX' || format === 'XLS';
    const { filePath, bytes } = await downloadToTempFile(resource.url, { maxFileBytes: isExcel ? caps.maxXlsxBytes : caps.maxFileBytes, fetchImpl: caps.fetchImpl, userAgent: caps.userAgent });

    const tempPaths = [filePath];
    try {
        let dataPath = filePath;
        let delimiter;
        let encoding;
        if (isExcel) {
            const convert = format === 'XLSX' ? convertXlsxToCsv : convertXlsToCsv;
            const { csvPath } = await convert(filePath, { maxRows: caps.maxRows, maxCols: caps.maxCols, maxCsvBytes: caps.maxFileBytes });
            tempPaths.push(csvPath);
            dataPath = csvPath;
            delimiter = ',';
            encoding = 'utf8';
        } else {
            ({ delimiter, encoding } = await sniffCsvMeta(filePath));
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rowCount, columns } = await loadCsvIntoStore(client, { filePath: dataPath, tableName, delimiter, encoding, maxRows: caps.maxRows, maxCols: caps.maxCols });
            const sizeResult = await client.query('SELECT pg_total_relation_size($1) AS size', ['store.' + tableName]);
            const byteSize = Number(sizeResult.rows[0].size);
            await client.query(`INSERT INTO ingested_resources (resource_id, table_name, row_count, byte_size, columns, ingested_at, last_accessed_at, status) VALUES ($1, $2, $3, $4, $5, now(), now(), 'ready') ON CONFLICT (resource_id) DO UPDATE SET table_name = EXCLUDED.table_name, row_count = EXCLUDED.row_count, byte_size = EXCLUDED.byte_size, columns = EXCLUDED.columns, ingested_at = now(), last_accessed_at = now(), status = 'ready'`, [resource.id, tableName, rowCount, byteSize, JSON.stringify(columns)]);
            await client.query('COMMIT');
            return { tableName, rowCount, byteSize, downloadedBytes: bytes, columns };
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch {}
            throw err;
        } finally {
            client.release();
        }
    } finally {
        for (const p of tempPaths) {
            try {
                await fs.promises.unlink(p);
            } catch {}
        }
    }
}

module.exports = { ingestResource, tableNameFor };
