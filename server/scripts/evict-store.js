require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db/pool');
const { evictUntilUnderBudget, withStoreBudgetLock } = require('../services/evictService');
const { cleanRetiredTables } = require('../services/retiredIngestTables');

function parseOptions(argv = process.argv.slice(2), env = process.env) {
    const index = argv.indexOf('--budget-gb');
    const budgetArg = argv.find(arg => arg.startsWith('--budget-gb='));
    if (index !== -1 && (!argv[index + 1] || argv[index + 1].startsWith('--'))) {
        throw new Error('--budget-gb requires a value');
    }
    const budgetRaw = budgetArg ? budgetArg.slice('--budget-gb='.length)
        : index !== -1 ? argv[index + 1] : env.STORE_BUDGET_GB || '15';
    const budgetGb = Number(budgetRaw);
    const idleRaw = env.STORE_IDLE_TTL_HOURS ?? '';
    const idleHours = idleRaw === '' ? 24 : Number(idleRaw);
    if (String(budgetRaw).trim() === '' || !Number.isFinite(budgetGb) || budgetGb < 0) {
        throw new Error('store budget must be a non-negative finite number');
    }
    if ((idleRaw !== '' && String(idleRaw).trim() === '') || !Number.isSafeInteger(idleHours) || idleHours < 0 || idleHours > 876000) {
        throw new Error('STORE_IDLE_TTL_HOURS must be an integer between 0 and 876000');
    }
    return { budgetBytes: budgetGb * 1024 ** 3, idleHours, dryRun: argv.includes('--dry-run') };
}

async function runEviction(db, options) {
    const startedAt = new Date();
    let completed = false;
    let error;
    let result;
    try {
        result = await withStoreBudgetLock(db, async () => {
            completed = true;
            if (!options.dryRun) await cleanRetiredTables(db);
            return evictUntilUnderBudget(db, { ...options, lockHeld: true });
        }, { tryLock: true });
        return result;
    } catch (err) {
        completed = true;
        error = err.message;
        throw err;
    } finally {
        // A preview must not even write telemetry. Expected lock contention is
        // a skip, not a new successful/failed maintenance attempt.
        if (!options.dryRun && completed) {
            await db.query(`INSERT INTO ingest_runs
                (resource_id, started_at, finished_at, ok, rows_loaded, bytes_loaded, error)
                VALUES ($1, $2, $3, $4, $5, $6, $7)`, [null, startedAt, new Date(), !error, null,
                -(result?.freedBytes || 0), error ? 'evict: ' + error : 'evict: ' + JSON.stringify(result)
            ]).catch(logErr => console.error('run log failed:', logErr.message));
        }
    }
}

async function main() {
    try {
        const options = parseOptions();
        console.log(JSON.stringify({ startedAt: new Date().toISOString(), ...options }));
        const result = await runEviction(pool, options);
        console.log(result === null ? 'evict-store skipped: store budget lock busy' : JSON.stringify(result));
    } catch (err) {
        console.error('evict-store failed:', err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) main();
module.exports = { parseOptions, runEviction };
