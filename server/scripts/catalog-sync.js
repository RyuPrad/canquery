require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
});

process.on('uncaughtException', (err) => {
    console.error(err);
    process.exit(1);
});

const pool = require('../db/pool');
const { packageList, packageShow } = require('../services/ckanClient');
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

const args = process.argv.slice(2);
function getArgValue(name) {
    const eq = args.find(a => a.startsWith(name + '='));
    if (eq) return eq.split('=')[1];
    const idx = args.indexOf(name);
    if (idx !== -1 && args[idx + 1] !== undefined) return args[idx + 1];
    return null;
}
const limitRaw = getArgValue('--limit');
const limit = limitRaw ? Number(limitRaw) : null;
const dryRun = args.includes('--dry-run');

async function main() {
    const startedAt = new Date();
    let ok = false;
    let error = null;
    let datasetsUpserted = 0;
    let resourcesUpserted = 0;

    try {
        const ids = await packageList(limit ? { limit } : {});
        console.log(ids.length);

        const progress = await getProgress(pool, 'catalog-sync');
        let startOffset = 0;
        if (progress && Number.isInteger(progress.offset) && progress.offset > 0 && progress.offset < ids.length) {
            startOffset = progress.offset;
            console.log('resuming at offset', startOffset);
        }

        for (let offset = startOffset; offset < ids.length; offset += 50) {
            const chunk = ids.slice(offset, offset + 50);

            const packages = [];
            let cursor = 0;
            async function worker() {
                while (cursor < chunk.length) {
                    const id = chunk[cursor];
                    cursor += 1;
                    try {
                        packages.push(await packageShow(id));
                    } catch (err) {
                        console.warn('skip ' + id + ': ' + err.message);
                    }
                }
            }
            await Promise.all([worker(), worker()]);

            const orgsById = new Map();
            const datasets = [];
            const allResources = [];
            const datasetIds = [];
            for (const pkg of packages) {
                const n = normalizePackage(pkg);
                if (n.organization) {
                    orgsById.set(n.organization.id, n.organization);
                }
                datasets.push(n.dataset);
                datasetIds.push(n.dataset.id);
                allResources.push(...n.resources);
            }

            if (!dryRun && datasets.length > 0) {
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
                await setProgress(pool, 'catalog-sync', { offset: offset + chunk.length });
            }

            datasetsUpserted += datasets.length;
            resourcesUpserted += allResources.length;
            console.log('processed ' + Math.min(offset + 50, ids.length) + '/' + ids.length);
        }

        if (!dryRun) {
            await refreshOrganizationDatasetCounts(pool);
            await setProgress(pool, 'catalog-sync', { offset: 0 });
        }

        ok = true;
    } catch (err) {
        error = err.message;
        console.error('catalog-sync failed:', err);
    } finally {
        try {
            await insertSyncRun(pool, { kind: 'full', startedAt, finishedAt: new Date(), ok, datasetsUpserted, resourcesUpserted, error });
        } catch (logErr) {
            console.error('run log failed:', logErr.message);
        }
        await pool.end();
        process.exit(ok ? 0 : 1);
    }
}

main();
