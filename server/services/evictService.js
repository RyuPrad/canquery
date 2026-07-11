const { TABLE_NAME_RE } = require('../db/storeQueries');
const { quoteIdent } = require('../utils/filterGrammar');

const STORE_BUDGET_LOCK = 'canquery-store-budget-v1';

async function withStoreBudgetLock(db, callback) {
    const client = await db.connect();
    try {
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [STORE_BUDGET_LOCK]);
        return await callback();
    } finally {
        try {
            await client.query('SELECT pg_advisory_unlock(hashtext($1))', [STORE_BUDGET_LOCK]);
        } finally {
            client.release();
        }
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
    excludeResourceIds
}) {
    const excluded = Array.from(new Set((excludeResourceIds || []).map(String)));
    const { rows } = await db.query(
        `SELECT ir.resource_id, ir.table_name,
                coalesce(ir.byte_size, 0)::bigint AS byte_size,
                ir.last_accessed_at, ir.ingested_at,
                EXISTS (
                    SELECT 1 FROM pinned_resources p
                    WHERE p.resource_id = ir.resource_id
                ) AS pinned
         FROM ingested_resources ir
         WHERE NOT (ir.resource_id = ANY($1::text[]))
         ORDER BY ir.last_accessed_at ASC`,
        [excluded]
    );
    let totalBytes = rows.reduce((sum, row) => sum + Number(row.byte_size), 0);
    let dropped = 0;
    let freedBytes = 0;
    let skippedChanged = 0;
    let skippedPinned = 0;

    for (const candidate of rows) {
        if (totalBytes <= budgetBytes) break;
        if (candidate.pinned) {
            skippedPinned += 1;
            continue;
        }
        if (!TABLE_NAME_RE.test(candidate.table_name)) {
            console.warn('skipping suspicious table name: ' + candidate.table_name);
            skippedChanged += 1;
            continue;
        }

        if (dryRun) {
            console.log('[dry-run] would drop ' + candidate.table_name + ' (' + candidate.byte_size + ' bytes)');
            totalBytes -= Number(candidate.byte_size);
            freedBytes += Number(candidate.byte_size);
            dropped += 1;
            continue;
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');
            // SHARE blocks concurrent INSERT/DELETE pin changes for the short
            // recheck/drop transaction, including the otherwise-unlockable
            // "no pin row exists" case.
            await client.query('LOCK TABLE pinned_resources IN SHARE MODE');
            const currentResult = await client.query(
                `SELECT ir.resource_id, ir.table_name,
                        coalesce(ir.byte_size, 0)::bigint AS byte_size,
                        ir.last_accessed_at, ir.ingested_at,
                        EXISTS (
                            SELECT 1 FROM pinned_resources p
                            WHERE p.resource_id = ir.resource_id
                        ) AS pinned
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
            if (changed || current.pinned || !TABLE_NAME_RE.test(current.table_name)) {
                if (current && current.pinned) skippedPinned += 1;
                else skippedChanged += 1;
                await client.query('ROLLBACK');
                continue;
            }

            console.log('dropping ' + current.table_name + ' (' + current.byte_size + ' bytes)');
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
        } catch (err) {
            try { await client.query('ROLLBACK'); } catch {}
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
        budgetSatisfied: totalBytes <= budgetBytes
    };
}

async function evictUntilUnderBudget(db, {
    budgetBytes,
    dryRun = false,
    excludeResourceIds = [],
    lockHeld = false
} = {}) {
    const budget = Number(budgetBytes);
    if (!Number.isFinite(budget) || budget < 0) {
        throw new Error('budgetBytes must be a non-negative finite number');
    }
    const options = {
        budgetBytes: budget,
        dryRun,
        excludeResourceIds
    };
    if (lockHeld) return evictLocked(db, options);
    return withStoreBudgetLock(db, () => evictLocked(db, options));
}

module.exports = { evictUntilUnderBudget, withStoreBudgetLock, STORE_BUDGET_LOCK };
