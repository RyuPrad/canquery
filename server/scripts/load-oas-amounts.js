require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db/pool');
const queries = require('../db/oasQueries');
const { runAmounts, runOutcome, readOasFile } = require('../services/oasAmounts');
const { sleep } = require('../utils/fetchWithBackoff');

// Two signed int32 keys spelling "canq" / "oasa": one load at a time.
const LOCK_KEYS = [1667329649, 1868657505];

// A failure that stands from run to run is written to the run log once in this long.
const REPEAT_MS = 24 * 60 * 60 * 1000;

// Loads the five tables of OAS benefit amounts (services/oasAmounts.js) into oas_rows
// whenever the publisher replaces a file. A file whose catalogue version is the one
// loaded is skipped, so a run downloads nothing between the quarterly updates.
// --dry-run downloads and reads the changed files and writes nothing; --force reloads
// every file; --file=RESOURCE_ID handles one (and retries a version that was refused).
// The run exits 1 while anything is wrong: a file that failed or waits for its next
// attempt, a quarter that is not whole, a quarter shown long after it ended.
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
            wait: ms => sleep(ms)
        } });
        console.log(JSON.stringify({ dry_run: dryRun, force, ...summary }));
    } catch (err) {
        error = err;
        console.error('OAS amounts load failed:', err.message);
    } finally {
        const outcome = summary ? runOutcome(summary) : { ok: false, message: null };
        const ok = !error && outcome.ok;
        const message = error ? String(error.message).slice(0, 500) : outcome.message;
        if (!ok) process.exitCode = 1;
        // A run that loaded nothing and found nothing wrong leaves no record; neither does
        // a dry run, or a run that never held the lock.
        if (!dryRun && lock && ((summary && summary.loaded > 0) || !ok)) {
            try {
                // The same failure as the last run's, with nothing loaded since, is on record already.
                const { rows: [last] } = ok || (summary && summary.loaded > 0) ? { rows: [] } : await pool.query(`
                    SELECT ok, error, finished_at FROM sync_runs WHERE kind = 'oas-amounts' ORDER BY started_at DESC LIMIT 1
                `);
                const repeated = last && !last.ok && last.error === message && last.finished_at &&
                    startedAt.getTime() - new Date(last.finished_at).getTime() < REPEAT_MS;
                if (!repeated) {
                    await pool.query(`
                        INSERT INTO sync_runs (kind, started_at, finished_at, ok, resources_upserted, error)
                        VALUES ('oas-amounts', $1, $2, $3, $4, $5)
                    `, [startedAt, new Date(), ok, summary ? summary.loaded : 0, message]);
                }
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
}

main();
