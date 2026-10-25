require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db/pool');
const { listChangedSitemapPages } = require('../db/catalogReadQueries');
const { getProgress, setProgress } = require('../db/catalogWriteQueries');
const { indexNowKey, submitChanges, PROGRESS_KEY } = require('../services/indexNow');

// Sends the canonical URLs whose sitemap entry changed since the last run to
// IndexNow. Without INDEXNOW_KEY it does nothing. --dry-run prints the count
// and a sample, sends nothing and leaves the watermark.
async function main() {
    const startedAt = new Date();
    const dryRun = process.argv.includes('--dry-run');
    let ok = false;
    let error = null;
    let submitted = 0;
    let key = null;
    try {
        key = indexNowKey();
        if (!key) {
            console.log('INDEXNOW_KEY is not set; nothing to submit');
            ok = true;
            return;
        }
        const result = await submitChanges({
            key,
            dryRun,
            now: startedAt,
            readProgress: () => getProgress(pool, PROGRESS_KEY),
            writeProgress: value => setProgress(pool, PROGRESS_KEY, value),
            readChanges: window => listChangedSitemapPages(window, pool)
        });
        submitted = result.submitted;
        ok = true;
    } catch (err) {
        error = err.message;
        console.error('IndexNow submission failed:', err.message);
    } finally {
        if (key) {
            try {
                await pool.query(`
                    INSERT INTO sync_runs (kind, started_at, finished_at, ok, resources_upserted, error)
                    VALUES ('indexnow', $1, $2, $3, $4, $5)
                `, [startedAt, new Date(), ok, submitted, error || (dryRun ? 'dry-run' : null)]);
            } catch (logErr) {
                console.error('IndexNow run log failed:', logErr.message);
            }
        }
        await pool.end();
    }
    if (!ok) process.exitCode = 1;
}

main();
