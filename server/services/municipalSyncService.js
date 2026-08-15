const defaultPool = require('../db/pool');
const { getSourceAdapter } = require('./sourceAdapters');
const {
    upsertCatalogSource,
    upsertOrganizations,
    upsertDatasets,
    upsertDatasetSources,
    replaceResources,
    replaceDatasetPlaces,
    replaceResourceMaps,
    refreshOrganizationDatasetCounts,
    sweepMissingDatasets,
    insertSyncRun
} = require('../db/catalogWriteQueries');

function uniqueBy(rows, key) {
    return Array.from(new Map(rows.map(row => [row[key], row])).values());
}

function finiteFraction(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
}

async function mapConcurrent(rows, concurrency, callback) {
    const results = new Array(rows.length);
    let cursor = 0;
    async function worker() {
        while (cursor < rows.length) {
            const index = cursor;
            cursor += 1;
            try {
                results[index] = await callback(rows[index], index);
            } catch (error) {
                results[index] = { status: 'failed', error };
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
    return results;
}

async function syncMunicipalSource(source, {
    pool = defaultPool,
    dryRun = false,
    limit = null,
    fetchJson,
    concurrency = 2,
    maxFailureFraction = 0.05,
    sourceAdapter,
    log = console
} = {}) {
    const startedAt = new Date();
    let ok = false;
    let errorMessage = null;
    let summary = null;
    const adapter = sourceAdapter || getSourceAdapter(source.kind);
    if (!dryRun) await upsertCatalogSource(pool, source);
    try {
        const discovered = await adapter.discover(source, { fetchJson });
        const records = limit == null ? discovered : discovered.slice(0, limit);
        const results = await mapConcurrent(records, concurrency, record => adapter.enrichRecord(record, source, { fetchJson }));
        const included = results.filter(result => result && result.status === 'included').map(result => result.value);
        const excluded = results.filter(result => result && result.status === 'excluded');
        const failed = results.filter(result => result && result.status === 'failed');
        const failureFraction = records.length === 0 ? 0 : failed.length / records.length;
        if (failureFraction > finiteFraction(maxFailureFraction, 0.05)) {
            throw new Error('metadata enrichment failed for ' + failed.length + '/' + records.length + ' records');
        }

        const failedExternalIds = [];
        for (let index = 0; index < results.length; index += 1) {
            if (!results[index] || results[index].status !== 'failed') continue;
            const identity = adapter.identityFor(records[index]);
            if (identity) failedExternalIds.push(adapter.canonicalKey(identity));
            log.warn('ArcGIS record failed: ' + (results[index].error && results[index].error.message));
        }
        const keepExternalIds = Array.from(new Set(included.map(row => row.externalId).concat(failedExternalIds)));
        if (included.length === 0) throw new Error('ArcGIS Hub produced no eligible records');

        summary = {
            source_id: source.id,
            discovered: discovered.length,
            processed: records.length,
            included: included.length,
            excluded: excluded.length,
            failed: failed.length,
            mappable: included.filter(item => item.map).length,
            formats: included.reduce((counts, item) => {
                const format = item.resource && item.resource.format;
                if (format) counts[format] = (counts[format] || 0) + 1;
                return counts;
            }, {}),
            places: included.flatMap(item => item.places || []).reduce((counts, item) => {
                counts[item.placeId] = (counts[item.placeId] || 0) + 1;
                return counts;
            }, {}),
            exclusion_reasons: excluded.reduce((counts, item) => {
                counts[item.reason] = (counts[item.reason] || 0) + 1;
                return counts;
            }, {})
        };
        if (dryRun) {
            ok = true;
            return summary;
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const organizations = uniqueBy(included.map(row => row.organization), 'id');
            const datasets = uniqueBy(included.map(row => row.dataset), 'id');
            const sources = uniqueBy(included.map(row => row.source), 'externalId');
            const resources = uniqueBy(included.map(row => row.resource), 'id');
            const datasetIds = datasets.map(row => row.id);
            const resourceIds = resources.map(row => row.id);
            const places = included.flatMap(row => row.places);
            const maps = included.map(row => row.map).filter(Boolean);

            await upsertOrganizations(client, organizations);
            await upsertDatasets(client, datasets);
            await upsertDatasetSources(client, sources);
            await replaceResources(client, datasetIds, resources);
            await replaceDatasetPlaces(client, source.id, datasetIds, places);
            await replaceResourceMaps(client, resourceIds, maps);
            if (limit == null) {
                summary.sweep = await sweepMissingDatasets(client, keepExternalIds, {
                    sourceId: source.id,
                    maxDeleteFraction: finiteFraction(source.maxDeleteFraction, 0.1)
                });
            }
            await refreshOrganizationDatasetCounts(client);
            await client.query('COMMIT');
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch {}
            throw error;
        } finally {
            client.release();
        }
        ok = true;
        return summary;
    } catch (error) {
        errorMessage = error.message;
        throw error;
    } finally {
        if (!dryRun) {
            try {
                await insertSyncRun(pool, {
                    kind: 'municipal',
                    sourceId: source.id,
                    startedAt,
                    finishedAt: new Date(),
                    ok,
                    datasetsUpserted: summary ? summary.included : 0,
                    resourcesUpserted: summary ? summary.included : 0,
                    error: errorMessage
                });
            } catch (runError) {
                log.error('municipal sync run log failed: ' + runError.message);
            }
        }
    }
}

module.exports = { syncMunicipalSource, mapConcurrent };
