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
const daysRaw = getArgValue('--days');
const days = (daysRaw !== null && Number.isInteger(Number(daysRaw)) && Number(daysRaw) >= 0)
    ? Number(daysRaw)
    : (Number(process.env.QUERY_LOG_RETENTION_DAYS) || 30);

const pool = require('../db/pool');
const { countOlderThan, pruneOlderThan } = require('../db/queryLogQueries');

async function main() {
    const startedAt = new Date();
    let ok = false;
    let error;
    let affected = 0;
    try {
        if (dryRun) {
            affected = await countOlderThan(days);
            console.log('would delete ' + affected + ' rows older than ' + days + ' days (dry-run)');
        } else {
            affected = await pruneOlderThan(days);
            console.log('deleted ' + affected + ' rows older than ' + days + ' days');
        }
        ok = true;
    } catch (err) {
        error = err.message;
        console.error('prune-query-log failed:', err);
    } finally {
        try {
            await pool.query('INSERT INTO sync_runs (kind, started_at, finished_at, ok, datasets_upserted, resources_upserted, error) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['query-log-prune', startedAt, new Date(), ok, null, affected, error ? error : (dryRun ? 'dry-run' : null)]);
        } catch (logErr) {
            console.error('run log failed:', logErr.message);
        }
        await pool.end();
        process.exit(ok ? 0 : 1);
    }
}

main();
