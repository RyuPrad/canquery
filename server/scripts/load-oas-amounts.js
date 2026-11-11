require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db/pool');
const queries = require('../db/oasQueries');
const { runAmounts, readOasFile } = require('../services/oasAmounts');
const { sleep } = require('../utils/fetchWithBackoff');

// Two signed int32 keys spelling "canq" / "oasa": one load at a time.
const LOCK_KEYS = [1667329649, 1868657505];

// Loads the five tables of OAS benefit amounts (services/oasAmounts.js) into oas_rows
// whenever the publisher replaces a file. A file whose catalogue version is the one
// loaded is skipped, so a run downloads nothing between the quarterly updates.
// --dry-run downloads and reads the changed files and writes nothing; --force reloads
// every file; --file=RESOURCE_ID handles one (and retries a version that was refused).
async function main() {
    const startedAt = new Date();
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');
    const fileArg = args.find(arg => arg.startsWith('--file='));
    const only = fileArg ? fileArg.slice('--file='.length) : null;
    let lock = null;
    let summary = null;
    let error = null;
    try {
        const unknown = args.filter(arg => !['--dry-run', '--force'].includes(arg) && arg !== fileArg);
        if (unknown.length) throw new Error('Unknown arguments: ' + unknown.join(' '));
        if (only !== null && !/^[A-Za-z0-9_.:-]{1,200}$/.test(only)) throw new Error('--file must be a resource id');
        lock = await pool.connect();
        const { rows: [held] } = await lock.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', LOCK_KEYS);
        if (!held.acquired) {
            console.log('load-oas-amounts skipped: another run is active');
            return;
        }
        summary = await runAmounts({ dryRun, force, only, deps: {
            listResources: () => queries.listOasResources(),
            listFiles: () => queries.listOasFiles(),
            getMemory: () => queries.getOasMemory(),
            saveMemory: memory => queries.saveOasMemory(memory),
            readFile: (row, options) => readOasFile(row, options),
            saveTable: input => queries.saveOasTable(input),
            touchTable: input => queries.touchOasTable(input),
            listPeriods: () => queries.listOasPeriods(),
            wait: ms => sleep(ms)
        } });
        console.log(JSON.stringify({ dry_run: dryRun, force, ...summary }));
        if (summary.unknown_file) throw new Error(`--file ${summary.unknown_file} is not a CSV file of the OAS benefit amounts`);
    } catch (err) {
        error = err;
        console.error('OAS amounts load failed:', err.message);
    } finally {
        // Runs that loaded nothing and failed nothing leave no record.
        const touched = summary && !dryRun && summary.loaded + summary.failed > 0;
        if (!dryRun && (touched || (error && lock))) {
            const failures = summary ? summary.results.filter(result => result.status === 'failed') : [];
            const message = error ? error.message
                : failures.length ? `${failures.length} file(s) failed: ` +
                    failures.map(result => `${result.resource_id} ${result.failure}`).join(', ') : null;
            try {
                await pool.query(`
                    INSERT INTO sync_runs (kind, started_at, finished_at, ok, resources_upserted, error)
                    VALUES ('oas-amounts', $1, $2, $3, $4, $5)
                `, [startedAt, new Date(), !error && !failures.length, summary ? summary.loaded : 0,
                    message ? message.slice(0, 500) : null]);
            } catch (logErr) {
                console.error('OAS amounts run log failed:', logErr.message);
            }
        }
        if (lock) {
            try { await lock.query('SELECT pg_advisory_unlock($1, $2)', LOCK_KEYS); } catch { /* the session ends below */ }
            lock.release();
        }
        await pool.end();
    }
    if (error || (summary && summary.failed)) process.exitCode = 1;
}

main();
