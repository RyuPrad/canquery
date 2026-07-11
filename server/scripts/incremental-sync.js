require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
});

process.on('uncaughtException', (err) => {
    console.error(err);
    process.exit(1);
});

const args = process.argv.slice(2);
let limit = null;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
        dryRun = true;
    } else if (arg === '--limit') {
        if (i + 1 < args.length) {
            limit = Number(args[i + 1]);
            i++;
        }
    } else if (arg.startsWith('--limit=')) {
        limit = Number(arg.split('=')[1]);
    }
}

const pool = require('../db/pool');
const { packageSearch } = require('../services/ckanClient');
const { normalizePackage } = require('../services/catalogNormalizer');
const {
    upsertOrganizations,
    upsertDatasets,
    replaceResources,
    refreshOrganizationDatasetCounts,
    getProgress,
    setProgress,
    insertSyncRun
} = require('../db/catalogWriteQueries');
const {
    DEFAULT_MAX_PAGES,
    DEFAULT_OVERLAP_MS,
    collectIncrementalPackages,
    latestTimestamp
} = require('../services/incrementalSync');

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const maxPages = positiveInteger(process.env.INCREMENTAL_SYNC_MAX_PAGES, DEFAULT_MAX_PAGES);
const overlapSeconds = positiveInteger(process.env.INCREMENTAL_SYNC_OVERLAP_SECONDS, DEFAULT_OVERLAP_MS / 1000);

async function main() {
    const startedAt = new Date();
    let ok = false;
    let error = null;
    let datasetsUpserted = 0;
    let resourcesUpserted = 0;

    try {
        if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
            throw new Error('--limit must be a positive integer');
        }
        const progress = await getProgress(pool, 'incremental-sync');
        let watermark = progress && progress.watermark;
        if (!watermark) {
            // Upgrade path from the old max(metadata_modified)-only sync. This is
            // only a baseline; after the first complete traversal the independently
            // persisted checkpoint becomes authoritative.
            const hwmResult = await pool.query('SELECT max(metadata_modified) AS hwm FROM datasets');
            watermark = hwmResult.rows[0].hwm;
        }
        watermark = latestTimestamp(null, watermark);
        console.log('watermark:', watermark || '(none)');

        const collectedResult = await collectIncrementalPackages({
            search: packageSearch,
            watermark,
            overlapMs: overlapSeconds * 1000,
            maxPages,
            limit
        });
        const collected = collectedResult.packages;

        console.log(collected.length + ' modified datasets across ' + collectedResult.pagesFetched + ' page(s)');

        const orgsById = new Map();
        const datasets = [];
        const datasetIds = [];
        const allResources = [];

        if (collected.length > 0) {
            for (const pkg of collected) {
                const { organization, dataset, resources } = normalizePackage(pkg);
                if (organization) {
                    orgsById.set(organization.id, organization);
                }
                datasets.push(dataset);
                datasetIds.push(dataset.id);
                allResources.push(...resources);
            }

            if (!dryRun) {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    await upsertOrganizations(client, Array.from(orgsById.values()));
                    await upsertDatasets(client, datasets);
                    await replaceResources(client, datasetIds, allResources);
                    await client.query('COMMIT');
                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
                await refreshOrganizationDatasetCounts(pool);
            }
        }

        datasetsUpserted = datasets.length;
        resourcesUpserted = allResources.length;

        if (!dryRun) {
            if (collectedResult.complete) {
                await setProgress(pool, 'incremental-sync', {
                    watermark: collectedResult.nextWatermark || watermark,
                    completedAt: new Date().toISOString(),
                    overlapSeconds,
                    incomplete: null
                });
            } else {
                // Never advance the committed watermark after a truncated read.
                // The next run repeats the overlap instead of silently skipping
                // the unvisited tail.
                await setProgress(pool, 'incremental-sync', {
                    watermark,
                    overlapSeconds,
                    incomplete: {
                        at: new Date().toISOString(),
                        reason: collectedResult.reason,
                        pagesFetched: collectedResult.pagesFetched,
                        datasetsSeen: collected.length
                    }
                });
            }
        }

        if (!collectedResult.complete && (!dryRun || collectedResult.reason === 'page-cap')) {
            throw new Error(
                'incremental sync incomplete (' + collectedResult.reason + ' after ' +
                collectedResult.pagesFetched + ' page(s)); watermark was not advanced'
            );
        }
        ok = true;
    } catch (err) {
        error = err.message;
        console.error('incremental-sync failed:', err);
    } finally {
        try {
            await insertSyncRun(pool, { kind: 'incremental', startedAt, finishedAt: new Date(), ok, datasetsUpserted, resourcesUpserted, error });
        } catch (logErr) {
            console.error('run log failed:', logErr.message);
        }
        await pool.end();
        process.exit(ok ? 0 : 1);
    }
}

main();
