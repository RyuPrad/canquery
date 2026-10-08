const { TABLE_NAME_RE } = require('../db/storeQueries');
const { quoteIdent } = require('../utils/filterGrammar');
const { snapshotKey } = require('../db/snapshotRead');
const { INGEST_RESOURCE_LOCK_NAMESPACE } = require('../db/ingestResourceLock');
const { setTimeout: delay } = require('node:timers/promises');

const STORE_BUDGET_LOCK = 'canquery-store-budget-v1';

async function withStoreBudgetLock(db, callback, { tryLock = false, signal } = {}) {
    const client = await db.connect();
    let locked = false;
    let broken = false;
    try {
        try {
            signal?.throwIfAborted();
            if (signal && !tryLock) {
                while (!locked) {
                    signal.throwIfAborted();
                    const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [STORE_BUDGET_LOCK]);
                    locked = result.rows[0]?.locked;
                    if (!locked) await delay(100, undefined, { signal });
                }
            } else if (tryLock) {
                const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [STORE_BUDGET_LOCK]);
                if (!result.rows[0]?.locked) return null;
            } else {
                await client.query('SELECT pg_advisory_lock(hashtext($1))', [STORE_BUDGET_LOCK]);
            }
        } catch (error) {
            broken = true;
            throw error;
        }
        locked = true;
        return await callback();
    } finally {
        if (locked) {
            try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [STORE_BUDGET_LOCK]); }
            catch { broken = true; }
        }
        client.release(broken);
    }
}

function sameInstant(left, right) {
    if (left == null && right == null) return true;
    const a = new Date(left).getTime();
    const b = new Date(right).getTime();
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

async function evictLocked(db, {
    budgetBytes,
    dryRun,
    excludeResourceIds,
    idleHours,
    signal
}) {
    // Use one database-clock cutoff for the entire run. Ingestion callers omit
    // idleHours and continue enforcing only their explicit storage budget.
    const cutoff = idleHours > 0
        ? new Date((await db.query("SELECT clock_timestamp() - $1 * interval '1 hour' AS cutoff", [idleHours])).rows[0].cutoff).getTime()
        : null;
    const expired = row => {
        const accessed = row.last_accessed_at ?? row.ingested_at;
        return cutoff !== null && row.ready && accessed != null && new Date(accessed).getTime() <= cutoff;
    };
    const excluded = Array.from(new Set((excludeResourceIds || []).map(String)));
    const { rows } = await db.query(
        `SELECT ir.resource_id, ir.table_name,
                coalesce(ir.byte_size, 0)::bigint AS byte_size,
                ir.last_accessed_at, ir.ingested_at, ir.resource_id = ANY($1::text[]) AS excluded,
                EXISTS (
                    SELECT 1 FROM pinned_resources p
                    WHERE p.resource_id = ir.resource_id
                ) AS pinned,
                ir.status = 'ready' AS ready,
                EXISTS (SELECT 1 FROM ingest_jobs j WHERE j.resource_id = ir.resource_id
                        AND j.status IN ('pending', 'running')) AS active_job,
                false AS retired
         FROM ingested_resources ir
         UNION ALL
         SELECT resource_id, table_name, byte_size, retired_at, retired_at, true, true, false, false, true
         FROM retired_ingest_tables
         ORDER BY last_accessed_at ASC`,
        [excluded]
    );
    let totalBytes = rows.reduce((sum, row) => sum + Number(row.byte_size), 0);
    let dropped = 0;
    let freedBytes = 0;
    let skippedChanged = 0;
    let skippedPinned = 0;
    let skippedActive = 0;
    let expiredDropped = 0;
    let budgetDropped = 0;
    const inventory = { expired: 0, expiredBytes: 0, pinned: 0, pinnedBytes: 0, active: 0, activeBytes: 0, recent: 0 };
    for (const row of rows) {
        if (row.retired) continue;
        if (row.pinned) { inventory.pinned++; inventory.pinnedBytes += Number(row.byte_size); }
        else if (row.active_job) { inventory.active++; inventory.activeBytes += Number(row.byte_size); }
        else if (expired(row)) { inventory.expired++; inventory.expiredBytes += Number(row.byte_size); }
        else inventory.recent++;
    }

    for (const candidate of rows) {
        signal?.throwIfAborted();
        const idle = expired(candidate);
        if (totalBytes <= budgetBytes && !idle) continue;
        if (candidate.excluded || excluded.includes(candidate.resource_id)) continue;
        if (candidate.pinned) {
            skippedPinned += 1;
            continue;
        }
        if (candidate.active_job) { skippedActive++; continue; }
        if (!TABLE_NAME_RE.test(candidate.table_name)) {
            console.warn('skipping suspicious table name: ' + candidate.table_name);
            skippedChanged += 1;
            continue;
        }

        if (dryRun) {
            console.log('[dry-run] would drop ' + candidate.table_name + ' (' + candidate.byte_size + ' bytes, ' + (idle ? 'idle' : 'budget') + ')');
            totalBytes -= Number(candidate.byte_size);
            freedBytes += Number(candidate.byte_size);
            dropped += 1;
            if (idle) expiredDropped++; else budgetDropped++;
            continue;
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL lock_timeout = '1000ms'");
            // Never wait for resource admission while holding the budget lock.
            // Holding this lock through the recheck excludes new refresh jobs.
            const resourceLock = await client.query('SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS locked', [INGEST_RESOURCE_LOCK_NAMESPACE, candidate.resource_id]);
            if (!resourceLock.rows[0]?.locked) {
                skippedActive++;
                await client.query('ROLLBACK');
                continue;
            }
            const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [snapshotKey(candidate.resource_id)]);
            if (!lock.rows[0]?.locked) {
                skippedChanged += 1;
                await client.query('ROLLBACK');
                continue;
            }
            // SHARE blocks concurrent INSERT/DELETE pin changes for the short
            // recheck/drop transaction, including the otherwise-unlockable
            // "no pin row exists" case.
            await client.query('SELECT public.canquery_lock_pins()');
            const currentResult = await client.query(
                `SELECT ir.resource_id, ir.table_name,
                        coalesce(ir.byte_size, 0)::bigint AS byte_size,
                        ir.last_accessed_at, ir.ingested_at,
                        EXISTS (
                            SELECT 1 FROM pinned_resources p
                            WHERE p.resource_id = ir.resource_id
                        ) AS pinned,
                        ir.status = 'ready' AS ready,
                        EXISTS (SELECT 1 FROM ingest_jobs j WHERE j.resource_id = ir.resource_id
                                AND j.status IN ('pending', 'running')) AS active_job
                 FROM ingested_resources ir
                 WHERE ir.resource_id = $1
                 FOR UPDATE`,
                [candidate.resource_id]
            );
            const current = currentResult.rows[0];
            const changed = !current ||
                current.table_name !== candidate.table_name ||
                Number(current.byte_size) !== Number(candidate.byte_size) ||
                !sameInstant(current.ingested_at, candidate.ingested_at) ||
                !sameInstant(current.last_accessed_at, candidate.last_accessed_at);
            if (changed || current.pinned || current.active_job || (idle && !expired(current)) || !TABLE_NAME_RE.test(current.table_name)) {
                if (current && current.pinned) skippedPinned += 1;
                else if (current && current.active_job) skippedActive++;
                else skippedChanged += 1;
                await client.query('ROLLBACK');
                continue;
            }

            console.log('dropping ' + current.table_name + ' (' + current.byte_size + ' bytes, ' + (idle ? 'idle' : 'budget') + ')');
            await client.query('DROP TABLE IF EXISTS store.' + quoteIdent(current.table_name));
            const deleted = await client.query(
                'DELETE FROM ingested_resources WHERE resource_id = $1 AND table_name = $2 RETURNING resource_id',
                [current.resource_id, current.table_name]
            );
            if (deleted.rows.length !== 1) {
                throw new Error('eviction metadata changed before delete');
            }
            await client.query('COMMIT');
            totalBytes -= Number(current.byte_size);
            freedBytes += Number(current.byte_size);
            dropped += 1;
            if (idle) expiredDropped++; else budgetDropped++;
        } catch (err) {
            try { await client.query('ROLLBACK'); } catch {}
            if (err.code === '55P03') { skippedActive++; continue; }
            throw err;
        } finally {
            client.release();
        }
    }

    return {
        dropped,
        freedBytes,
        totalBytesAfter: totalBytes,
        skippedChanged,
        skippedPinned,
        skippedActive,
        expiredDropped,
        budgetDropped,
        inventory,
        budgetSatisfied: totalBytes <= budgetBytes
    };
}

async function evictUntilUnderBudget(db, {
    budgetBytes,
    dryRun = false,
    excludeResourceIds = [],
    lockHeld = false,
    idleHours = 0,
    signal
} = {}) {
    const budget = Number(budgetBytes);
    if (!Number.isFinite(budget) || budget < 0) {
        throw new Error('budgetBytes must be a non-negative finite number');
    }
    if (!Number.isSafeInteger(idleHours) || idleHours < 0 || idleHours > 876000) {
        throw new Error('idleHours must be an integer between 0 and 876000');
    }
    const options = {
        budgetBytes: budget,
        dryRun,
        excludeResourceIds,
        idleHours,
        signal
    };
    if (lockHeld) return evictLocked(db, options);
    return withStoreBudgetLock(db, () => evictLocked(db, options), { signal });
}

module.exports = { evictUntilUnderBudget, withStoreBudgetLock, STORE_BUDGET_LOCK };
