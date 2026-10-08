const { createHash } = require('node:crypto');
const AppError = require('../utils/AppError');

const SNAPSHOT_ID = /^cqs1_[0-9a-f]{64}$/;

function snapshotInfo(row) {
    if (row?.ingest_status !== 'ready' || !row.table_name) return null;
    return {
        id: 'cqs1_' + createHash('sha256')
            .update(JSON.stringify(['canquery-snapshot-v1', row.id, row.table_name])).digest('hex'),
        prepared_at: row.ingested_at || null,
        // This fingerprints publisher metadata, not downloaded file contents.
        source_metadata_version: row.ingested_source_version || null
    };
}

function validateSnapshot(value) {
    if (value === undefined) return;
    if (typeof value !== 'string' || !SNAPSHOT_ID.test(value)) {
        throw new AppError('Invalid snapshot identifier', 400);
    }
}

function requireSnapshot(row, expected) {
    const snapshot = snapshotInfo(row);
    if (expected !== undefined && snapshot?.id !== expected) {
        const error = new AppError('The requested snapshot is no longer available; start a new extraction explicitly', 409);
        error.publicCode = 'SNAPSHOT_UNAVAILABLE';
        throw error;
    }
    return snapshot;
}

module.exports = { snapshotInfo, validateSnapshot, requireSnapshot };
