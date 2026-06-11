require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.on('unhandledRejection', (err) => { console.error(err); process.exit(1); });
process.on('uncaughtException', (err) => { console.error(err); process.exit(1); });

const argv = process.argv.slice(2);
function getArgValue(name) {
    const eq = argv.find(a => a.startsWith(name + '='));
    if (eq) return eq.split('=')[1];
    const idx = argv.indexOf(name);
    if (idx !== -1 && argv[idx + 1] !== undefined) return argv[idx + 1];
    return null;
}

const dryRun = argv.includes('--dry-run');
const budgetGbRaw = getArgValue('--budget-gb');
const budgetGb = (budgetGbRaw !== null && Number.isFinite(Number(budgetGbRaw)))
    ? Number(budgetGbRaw)
    : (Number(process.env.STORE_BUDGET_GB) || 15);
const budgetBytes = budgetGb * 1024 * 1024 * 1024;

const pool = require('../db/pool');
const { evictUntilUnderBudget } = require('../services/evictService');

async function main() {
    const startedAt = new Date();
    let ok = false;
    let error;
    let result = { dropped: 0, freedBytes: 0 };
    try {
        console.log('budget: ' + budgetBytes + ' bytes' + (dryRun ? ' (dry-run)' : ''));
        result = await evictUntilUnderBudget(pool, { budgetBytes, dryRun });
        console.log('evicted ' + result.dropped + ' tables, freed ' + result.freedBytes + ' bytes');
        ok = true;
    } catch (err) {
        error = err.message;
        console.error('evict-store failed:', err);
    } finally {
        try {
            await pool.query('INSERT INTO ingest_runs (resource_id, started_at, finished_at, ok, rows_loaded, bytes_loaded, error) VALUES ($1, $2, $3, $4, $5, $6, $7)', [null, startedAt, new Date(), ok, null, result.freedBytes ? -result.freedBytes : 0, error ? 'evict: ' + error : 'evict: dropped ' + result.dropped]);
        } catch (logErr) {
            console.error('run log failed:', logErr.message);
        }
        await pool.end();
        process.exit(ok ? 0 : 1);
    }
}

main();
