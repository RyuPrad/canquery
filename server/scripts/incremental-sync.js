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
            limit = parseInt(args[i + 1], 10);
            i++;
        }
    } else if (arg.startsWith('--limit=')) {
        limit = parseInt(arg.split('=')[1], 10);
    }
}

const pool = require('../db/pool');
const { packageSearch } = require('../services/ckanClient');
const { normalizePackage } = require('../services/catalogNormalizer');
const { upsertOrganizations, upsertDatasets, replaceResources, refreshOrganizationDatasetCounts, insertSyncRun } = require('../db/catalogWriteQueries');

async function main() {
    const startedAt = new Date();
    let ok = false;
    let error = null;
    let datasetsUpserted = 0;
    let resourcesUpserted = 0;

    try {
        const hwmResult = await pool.query('SELECT max(metadata_modified) AS hwm FROM datasets');
        const hwm = hwmResult.rows[0].hwm;
        console.log('HWM:', hwm);

        const collected = [];
        for (let page = 0; page < 10; page += 1) {
            const result = await packageSearch({ sort: 'metadata_modified desc', rows: 100, start: page * 100 });
            if (!result.results || result.results.length === 0) {
                break;
            }
            let reachedOld = false;
            for (const pkg of result.results) {
                if (hwm && pkg.metadata_modified && new Date(pkg.metadata_modified) <= hwm) {
                    reachedOld = true;
                    break;
                }
                collected.push(pkg);
                if (limit && collected.length >= limit) {
                    reachedOld = true;
                    break;
                }
            }
            if (reachedOld || result.results.length < 100) {
                break;
            }
        }

        console.log(collected.length + ' modified datasets');

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
