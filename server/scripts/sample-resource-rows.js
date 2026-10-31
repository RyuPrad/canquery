require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db/pool');
const { SITE_URL } = require('../services/seoMeta');
const { getProgress, setProgress } = require('../db/catalogWriteQueries');
const { listShownCandidates, listDueCandidates, listSweepCandidates, saveSample } = require('../db/rowSampleQueries');
const { runSampler, samplerSettings, defaultReaders, PROGRESS_KEY } = require('../services/rowSampler');
const { sleep } = require('../utils/fetchWithBackoff');

// Two signed int32 keys spelling "canq" / "rows": one sampler at a time.
const LOCK_KEYS = [1667329649, 1919907699];

// Reads the first rows of live DataStore tables and CSV files that resource
// pages show to crawlers (services/rowSampler.js). --dry-run lists the next
// batch and reads nothing; --limit=N takes N instead of ROW_SAMPLE_BATCH.
async function main() {
    const startedAt = new Date();
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const limitArg = args.find(arg => arg.startsWith('--limit='));
    const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
    let lock = null;
    let summary = null;
    let error = null;
    try {
        if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 500)) throw new Error('--limit must be an integer from 1 to 500');
        const settings = samplerSettings();
        lock = await pool.connect();
        const { rows: [held] } = await lock.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', LOCK_KEYS);
        if (!held.acquired) {
            console.log('sample-resource-rows skipped: another run is active');
            return;
        }
        summary = await runSampler({ dryRun, limit, settings, now: startedAt, deps: {
            readProgress: () => getProgress(pool, PROGRESS_KEY),
            writeProgress: value => setProgress(pool, PROGRESS_KEY, value),
            listShown: () => listShownCandidates({ pagePrefix: SITE_URL + '/resources/' }),
            listDue: options => listDueCandidates(options),
            listSweep: options => listSweepCandidates(options),
            saveSample: result => saveSample(result),
            readers: defaultReaders,
            wait: ms => sleep(ms)
        } });
        console.log(JSON.stringify({ dry_run: dryRun, ...summary }));
    } catch (err) {
        error = err;
        console.error('Row sampling failed:', err.message);
    } finally {
        // Runs that read nothing leave no record; the ops view scans this table.
        const touched = summary && !dryRun && summary.ok + summary.unsupported + summary.failed > 0;
        if (touched || (error && lock)) {
            try {
                await pool.query(`
                    INSERT INTO sync_runs (kind, started_at, finished_at, ok, resources_upserted, error)
                    VALUES ('row-samples', $1, $2, $3, $4, $5)
                `, [startedAt, new Date(), !error, summary ? summary.ok : 0, error ? error.message.slice(0, 500) : null]);
            } catch (logErr) {
                console.error('Row sampling run log failed:', logErr.message);
            }
        }
        if (lock) {
            try { await lock.query('SELECT pg_advisory_unlock($1, $2)', LOCK_KEYS); } catch { /* the session ends below */ }
            lock.release();
        }
        await pool.end();
    }
    if (error) process.exitCode = 1;
}

main();
