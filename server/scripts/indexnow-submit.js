require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db/pool');
const { listChangedSitemapPages, listChangedCataloguePages } = require('../db/catalogReadQueries');
const { getProgress, setProgress } = require('../db/catalogWriteQueries');
const { indexNowKey, submitChanges, changesSource, PROGRESS_KEY } = require('../services/indexNow');
const { alwaysIndexableDatasetIds, policyEngines } = require('../services/indexPolicy');

// Sends the canonical URLs that changed since the last run to IndexNow: only
// pages its engines may index (services/indexNow.js: changesSource). Without
// INDEXNOW_KEY it does nothing. --dry-run prints the count and a sample, sends
// nothing and leaves the watermark. Both lines name the list that was read
// ("list: policy" or "list: catalogue"): the job reads INDEX_POLICY_ENGINES from
// its own environment, and the list must match the tag the API writes.
const READERS = {
    policy: window => listChangedSitemapPages({ ...window, ids: alwaysIndexableDatasetIds() }, pool),
    catalogue: window => listChangedCataloguePages(window, pool)
};

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
        const source = changesSource(policyEngines());
        const readChanges = READERS[source];
        const result = await submitChanges({
            key,
            source,
            dryRun,
            now: startedAt,
            readProgress: () => getProgress(pool, PROGRESS_KEY),
            writeProgress: value => setProgress(pool, PROGRESS_KEY, value),
            readChanges
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

if (require.main === module) main();
module.exports = { main, READERS };
