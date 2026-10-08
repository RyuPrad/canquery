// Operator-only metadata reconciliation. Default mode is a read-only preview;
// apply requires an exact saved manifest and an exclusive new receipt path.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const fs = require('node:fs/promises');
const { isDeepStrictEqual } = require('node:util');
const { TABLE_NAME_RE } = require('../db/storeQueries');
const { withStoreBudgetLock } = require('../services/evictService');
const { INGEST_RESOURCE_LOCK_NAMESPACE } = require('../db/ingestResourceLock');
const { snapshotKey } = require('../db/snapshotRead');
const { truncateUtf8, validColumnId } = require('../utils/columnIdentifiers');

function reconcileColumns(columns, physical) {
    if (!Array.isArray(columns) || physical.length !== columns.length + 1 ||
        physical[0]?.name !== '_id' || physical[0]?.type !== 'bigint' ||
        physical.some((column, index) => column.ordinal !== index + 1)) {
        throw new Error('Physical columns do not match the complete metadata ordinal inventory');
    }
    const typeNames = { INTEGER: 'bigint', NUMERIC: 'numeric', TEXT: 'text', DATE: 'date', TIMESTAMPTZ: 'timestamp with time zone' };
    const result = columns.map((column, index) => {
        const actual = physical[index + 1];
        if (!column || typeNames[column.type] !== actual.type || !validColumnId(actual.name)) {
            throw new Error('Column type or physical identifier does not match the reviewed schema');
        }
        if (column.id === actual.name) return { ...column };
        if (typeof column.id !== 'string' || Buffer.byteLength(column.id) <= 63 ||
            /["\0]/.test(column.id) || !column.id.isWellFormed() || truncateUtf8(column.id) !== actual.name) {
            throw new Error('Mismatch is not an unambiguous PostgreSQL identifier truncation');
        }
        return { ...column, id: actual.name, legacy_ids: [...new Set([...(column.legacy_ids || []), column.id])] };
    });
    const canonical = new Set(['_id', ...result.map(column => column.id)]);
    if (canonical.size !== result.length + 1) throw new Error('Canonical identifiers collide');
    const aliases = new Map();
    for (const column of result) for (const alias of column.legacy_ids || []) {
        if (typeof alias !== 'string' || canonical.has(alias) || (aliases.has(alias) && aliases.get(alias) !== column.id)) {
            throw new Error('Legacy identifiers are ambiguous');
        }
        aliases.set(alias, column.id);
    }
    return result;
}

async function databaseIdentity(db) {
    const { rows } = await db.query(`SELECT current_database() AS database,
        (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
        current_setting('server_encoding') AS encoding,
        current_setting('max_identifier_length')::int AS identifier_bytes`);
    const identity = rows[0];
    if (identity.encoding !== 'UTF8' || identity.identifier_bytes !== 63) throw new Error('Expected UTF8 and 63-byte PostgreSQL identifiers');
    return identity;
}

async function inventory(db, resourceId, lock = false) {
    const { rows } = await db.query(`SELECT resource_id, table_name, columns, ingested_at, source_version,
        row_count::text, byte_size::text, status FROM ingested_resources WHERE resource_id=$1` + (lock ? ' FOR UPDATE' : ''), [resourceId]);
    const row = rows[0];
    if (!row || row.status !== 'ready' || !TABLE_NAME_RE.test(row.table_name)) throw new Error('Resource has no valid ready snapshot');
    const { rows: relation } = await db.query('SELECT to_regclass($1)::oid::text AS oid', ['store.' + row.table_name]);
    if (!relation[0].oid) throw new Error('Serving relation is missing');
    const { rows: physical } = await db.query(`SELECT attnum::int AS ordinal, attname AS name,
        format_type(atttypid, atttypmod) AS type FROM pg_attribute
        WHERE attrelid=$1::oid AND attnum>0 AND NOT attisdropped ORDER BY attnum`, [relation[0].oid]);
    return { ...row, ingested_at: row.ingested_at?.toISOString() || null, table_oid: relation[0].oid, physical };
}

async function previewRepair(db, resourceIds) {
    if (!resourceIds.length || new Set(resourceIds).size !== resourceIds.length) throw new Error('Provide unique explicit resource IDs');
    const client = await db.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const identity = await databaseIdentity(client);
        const resources = [];
        for (const id of resourceIds) {
            const before = await inventory(client, id);
            const after = reconcileColumns(before.columns, before.physical);
            resources.push({ before, after });
        }
        await client.query('COMMIT');
        return { version: 1, identity, resources };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

async function applyRepair(db, manifest, onReceipt = async () => {}) {
    if (manifest.version !== 1 || !Array.isArray(manifest.resources) || !manifest.resources.length ||
        !isDeepStrictEqual(manifest.identity, await databaseIdentity(db))) throw new Error('Invalid manifest or database identity mismatch');
    const ids = manifest.resources.map(item => item.before?.resource_id);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('Invalid manifest resource scope');
    const results = [];
    for (const item of manifest.resources) {
        const result = await withStoreBudgetLock(db, async () => {
            const client = await db.connect();
            try {
                await client.query('BEGIN');
                await client.query("SET LOCAL lock_timeout='1s'");
                const resource = await client.query('SELECT pg_try_advisory_xact_lock($1,hashtext($2)) AS locked', [INGEST_RESOURCE_LOCK_NAMESPACE, item.before.resource_id]);
                const reader = resource.rows[0].locked && await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [snapshotKey(item.before.resource_id)]);
                if (!reader || !reader.rows[0].locked) {
                    await client.query('ROLLBACK');
                    return { resource_id: item.before.resource_id, status: 'busy' };
                }
                const active = await client.query("SELECT 1 FROM ingest_jobs WHERE resource_id=$1 AND status IN ('pending','running')", [item.before.resource_id]);
                if (active.rows.length) {
                    await client.query('ROLLBACK');
                    return { resource_id: item.before.resource_id, status: 'active_job' };
                }
                const current = await inventory(client, item.before.resource_id, true);
                if (!isDeepStrictEqual(current, item.before)) throw new Error('Snapshot drift: refresh the preview');
                const after = reconcileColumns(current.columns, current.physical);
                if (!isDeepStrictEqual(after, item.after)) throw new Error('Manifest proposed change does not match verified reconciliation');
                const changed = !isDeepStrictEqual(current.columns, after);
                if (changed) {
                    await onReceipt({ resource_id: current.resource_id, status: 'intent', before: current, after });
                    const updated = await client.query(`UPDATE ingested_resources SET columns=$3::jsonb
                        WHERE resource_id=$1 AND table_name=$2 AND columns=$4::jsonb`,
                    [current.resource_id, current.table_name, JSON.stringify(after), JSON.stringify(current.columns)]);
                    if (updated.rowCount !== 1) throw new Error('Snapshot changed before metadata update');
                }
                await client.query('COMMIT');
                return { resource_id: current.resource_id, status: changed ? 'repaired' : 'unchanged', before: current, after };
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally { client.release(); }
        }, { tryLock: true });
        const receipt = result || { resource_id: item.before.resource_id, status: 'budget_busy' };
        await onReceipt(receipt);
        results.push(receipt);
    }
    return results;
}

async function main() {
    const db = require('../db/pool');
    let receipt;
    try {
        const args = process.argv.slice(2);
        const value = name => args.find(argument => argument.startsWith(name + '='))?.slice(name.length + 1);
        if (args.some(argument => argument !== '--apply' && !['--resource=', '--output=', '--manifest=', '--receipt='].some(prefix => argument.startsWith(prefix)))) throw new Error('Unknown argument');
        if (args.includes('--apply')) {
            if (!value('--manifest') || !value('--receipt') || value('--resource') || value('--output')) throw new Error('Apply requires --manifest=FILE and --receipt=NEW_FILE only');
            const manifest = JSON.parse(await fs.readFile(value('--manifest'), 'utf8'));
            receipt = await fs.open(value('--receipt'), 'wx', 0o600);
            await applyRepair(db, manifest, async result => {
                await receipt.write(JSON.stringify(result) + '\n');
                await receipt.sync();
            });
        } else {
            if (!value('--output') || value('--manifest') || value('--receipt')) throw new Error('Preview requires --resource=ID (repeatable) and --output=NEW_FILE');
            const manifest = await previewRepair(db, args.filter(argument => argument.startsWith('--resource=')).map(argument => argument.slice(11)));
            await fs.writeFile(value('--output'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        }
        console.log('Column identifier operation completed; inspect the private manifest or receipts.');
    } finally {
        if (receipt) await receipt.close();
        await db.end();
    }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { reconcileColumns, previewRepair, applyRepair };
