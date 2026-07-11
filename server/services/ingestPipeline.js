const fs = require('node:fs');
const os = require('node:os');
const metadataPool = require('../db/pool');
const ingestPool = require('../db/longRunningPool');
const { downloadToTempFile, sniffCsvMeta } = require('./csvDownload');
const { loadCsvIntoStore } = require('./csvLoad');
const { convertXlsxToCsv, convertXlsToCsv } = require('./xlsxConvert');
const { TABLE_NAME_RE } = require('../db/storeQueries');
const { evictUntilUnderBudget, withStoreBudgetLock } = require('./evictService');
const { toAbsoluteUrl } = require('../utils/resolveUrl');

const MB = 1024 * 1024;
const GB = 1024 * MB;

function tableNameFor(resourceId) {
    return 'r_' + String(resourceId).toLowerCase().replace(/[^0-9a-f]/g, '_');
}

function finiteNonNegative(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function budgetError(message, code = 'BUDGET') {
    const err = new Error(message);
    err.code = code;
    return err;
}

async function availableDiskBytes(directory) {
    const stat = await fs.promises.statfs(directory, { bigint: true });
    return stat.bavail * stat.bsize;
}

async function assertDiskHeadroom(directory, requiredBytes, label) {
    const required = BigInt(Math.ceil(finiteNonNegative(requiredBytes, 0)));
    let available;
    try {
        available = await availableDiskBytes(directory);
    } catch {
        throw budgetError('cannot check free space for ' + label + ' at ' + directory, 'DISK_CHECK');
    }
    if (available < required) {
        throw budgetError(
            label + ' has insufficient free space (' + available + ' available, ' + required + ' required)',
            'DISK_FREE'
        );
    }
    return available;
}

function storageOptions(caps) {
    return {
        budgetBytes: finiteNonNegative(caps.storeBudgetBytes, 15 * GB),
        reserveFloorBytes: finiteNonNegative(
            caps.storeReserveBytes,
            finiteNonNegative(process.env.STORE_INGEST_HEADROOM_MB, 256) * MB
        ),
        reserveMultiplier: finiteNonNegative(
            caps.storeSizeMultiplier,
            finiteNonNegative(process.env.STORE_SIZE_RESERVE_MULTIPLIER, 2)
        ),
        minTmpFreeBytes: finiteNonNegative(
            caps.minTmpFreeBytes,
            finiteNonNegative(process.env.TMP_MIN_FREE_MB, 512) * MB
        ),
        storeDataPath: caps.storeDataPath || process.env.STORE_DATA_PATH || null,
        minStoreFreeBytes: finiteNonNegative(
            caps.minStoreFreeBytes,
            finiteNonNegative(process.env.STORE_MIN_FREE_GB, 2) * GB
        )
    };
}

async function validateStorageFilesystems(caps) {
    const storage = storageOptions(caps);
    if (process.env.NODE_ENV === 'production' && !storage.storeDataPath) {
        throw budgetError('STORE_DATA_PATH is required in production', 'DISK_CHECK');
    }
    await assertDiskHeadroom(os.tmpdir(), storage.minTmpFreeBytes, 'ingest temporary filesystem');
    if (storage.storeDataPath) {
        await assertDiskHeadroom(
            storage.storeDataPath,
            storage.minStoreFreeBytes,
            'PostgreSQL store filesystem'
        );
    }
    return storage;
}

async function ingestResourceLocked(resource, caps, tableName) {
    const storage = storageOptions(caps);
    if (process.env.NODE_ENV === 'production' && !storage.storeDataPath) {
        throw budgetError('STORE_DATA_PATH is required in production', 'DISK_CHECK');
    }
    if (storage.budgetBytes <= 0) throw budgetError('store budget is disabled');

    const format = String(resource.format || '').toUpperCase();
    const isExcel = format === 'XLSX' || format === 'XLS';
    const downloadCap = isExcel ? caps.maxXlsxBytes : caps.maxFileBytes;
    const tempDirectory = os.tmpdir();
    // Leave an emergency floor even if the remote sends its full advertised
    // cap. This turns a low-disk condition into a job failure instead of an
    // ENOSPC that can affect other tenants.
    await assertDiskHeadroom(
        tempDirectory,
        storage.minTmpFreeBytes + downloadCap + (isExcel ? caps.maxFileBytes : 0),
        'ingest temporary filesystem'
    );

    const { filePath, bytes } = await downloadToTempFile(toAbsoluteUrl(resource.url), {
        maxFileBytes: downloadCap,
        fetchImpl: caps.fetchImpl,
        userAgent: caps.userAgent,
        stallTimeoutMs: caps.stallTimeoutMs,
        lookupImpl: caps.lookupImpl,
        requestImpl: caps.requestImpl
    });

    const tempPaths = [filePath];
    try {
        let dataPath = filePath;
        let delimiter;
        let encoding;
        if (isExcel) {
            // The compressed workbook is already on disk. Reserve the largest
            // permitted converted CSV before forking so the child cannot fill
            // TMPDIR before the post-conversion check gets a chance to run.
            await assertDiskHeadroom(
                tempDirectory,
                storage.minTmpFreeBytes + caps.maxFileBytes,
                'Excel conversion temporary filesystem'
            );
            const convert = format === 'XLSX' ? convertXlsxToCsv : convertXlsToCsv;
            const { csvPath } = await convert(filePath, {
                maxRows: caps.maxRows,
                maxCols: caps.maxCols,
                maxCsvBytes: caps.maxFileBytes,
                archiveCaps: caps.xlsxArchiveCaps
            });
            tempPaths.push(csvPath);
            dataPath = csvPath;
            delimiter = ',';
            encoding = 'utf8';
        } else {
            ({ delimiter, encoding } = await sniffCsvMeta(filePath));
        }

        const sourceBytes = Number((await fs.promises.stat(dataPath)).size);
        const reserveBytes = Math.max(
            storage.reserveFloorBytes,
            Math.ceil(sourceBytes * storage.reserveMultiplier)
        );
        await assertDiskHeadroom(
            tempDirectory,
            storage.minTmpFreeBytes + Math.min(reserveBytes, caps.maxFileBytes),
            'ingest temporary filesystem'
        );
        if (storage.storeDataPath) {
            await assertDiskHeadroom(
                storage.storeDataPath,
                storage.minStoreFreeBytes + reserveBytes,
                'PostgreSQL store filesystem'
            );
        }

        // Reserve likely relation growth before COPY. The exact relation size is
        // checked again inside the uncommitted load transaction below.
        await evictUntilUnderBudget(metadataPool, {
            budgetBytes: Math.max(0, storage.budgetBytes - reserveBytes),
            excludeResourceIds: [resource.id],
            lockHeld: true
        });

        const client = await ingestPool.connect();
        let committed = false;
        try {
            await client.query('BEGIN');
            const { rowCount, columns } = await loadCsvIntoStore(client, {
                filePath: dataPath,
                tableName,
                delimiter,
                encoding,
                maxRows: caps.maxRows,
                maxCols: caps.maxCols
            });
            const sizeResult = await client.query(
                'SELECT pg_total_relation_size($1) AS size',
                ['store.' + tableName]
            );
            const byteSize = Number(sizeResult.rows[0].size);
            if (!Number.isFinite(byteSize) || byteSize < 0) {
                throw budgetError('PostgreSQL returned an invalid relation size');
            }
            if (byteSize > storage.budgetBytes) {
                throw budgetError('resource is larger than the entire store budget');
            }

            // The new table is still invisible to other sessions. Evict against
            // an exact target that leaves byteSize free, excluding any previous
            // version of this same resource from the committed usage total.
            const exact = await evictUntilUnderBudget(metadataPool, {
                budgetBytes: storage.budgetBytes - byteSize,
                excludeResourceIds: [resource.id],
                lockHeld: true
            });
            if (!exact.budgetSatisfied || exact.totalBytesAfter + byteSize > storage.budgetBytes) {
                throw budgetError(
                    'store budget cannot accommodate resource (' + exact.totalBytesAfter +
                    ' bytes retained, ' + byteSize + ' bytes required)'
                );
            }

            await client.query(
                `INSERT INTO ingested_resources
                    (resource_id, table_name, row_count, byte_size, columns,
                     ingested_at, last_accessed_at, status)
                 VALUES ($1, $2, $3, $4, $5, now(), now(), 'ready')
                 ON CONFLICT (resource_id) DO UPDATE SET
                    table_name = EXCLUDED.table_name,
                    row_count = EXCLUDED.row_count,
                    byte_size = EXCLUDED.byte_size,
                    columns = EXCLUDED.columns,
                    ingested_at = now(),
                    last_accessed_at = now(),
                    status = 'ready'`,
                [resource.id, tableName, rowCount, byteSize, JSON.stringify(columns)]
            );
            await client.query('COMMIT');
            committed = true;

            // Exact pre-commit accounting already proved the committed state is
            // within budget. Re-run after commit to catch non-cooperating
            // writers, but never report a committed load as failed (which would
            // make the worker retry and rebuild it). The nightly enforcer will
            // also retry any transient post-commit database failure.
            try {
                const postCommit = await evictUntilUnderBudget(metadataPool, {
                    budgetBytes: storage.budgetBytes,
                    lockHeld: true
                });
                if (!postCommit.budgetSatisfied) {
                    console.error(
                        'store remains over budget after committed ingest: ' +
                        postCommit.totalBytesAfter + ' bytes'
                    );
                }
            } catch (err) {
                console.error('post-commit store-budget verification failed: ' + err.message);
            }
            return { tableName, rowCount, byteSize, downloadedBytes: bytes, columns };
        } catch (err) {
            if (!committed) {
                try { await client.query('ROLLBACK'); } catch {}
            }
            throw err;
        } finally {
            client.release();
        }
    } finally {
        for (const tempPath of tempPaths) {
            await fs.promises.unlink(tempPath).catch(() => {});
        }
    }
}

async function ingestResource(resource, caps) {
    const tableName = tableNameFor(resource.id);
    if (!TABLE_NAME_RE.test(tableName)) {
        throw new Error('cannot derive a safe table name');
    }
    return withStoreBudgetLock(metadataPool, () =>
        ingestResourceLocked(resource, caps, tableName)
    );
}

module.exports = {
    ingestResource,
    tableNameFor,
    assertDiskHeadroom,
    storageOptions,
    validateStorageFilesystems
};
