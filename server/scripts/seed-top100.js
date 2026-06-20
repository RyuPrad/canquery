require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.on('unhandledRejection', (err) => { console.error(err); process.exit(1); });
process.on('uncaughtException', (err) => { console.error(err); process.exit(1); });

const pool = require('../db/pool');
const { getResourceById, listResourcesForDataset } = require('../db/catalogReadQueries');
const { queryStoreTable } = require('../db/storeQueries');
const { ingestCapBytesFor } = require('../services/catalogService');
const { enqueueIngest } = require('../services/ingestService');
const { replaceTopDownloads, pinResource, prunePins, listFailedResourceIds } = require('../db/topDownloadsQueries');
const { insertSyncRun } = require('../db/catalogWriteQueries');
const { computeSnapshot, pickRepresentative } = require('../services/top100Compute');

// The "Top 100 Downloaded Datasets (for the month prior)" resource under the
// Open Government Analytics dataset. Override with TOP100_RESOURCE_ID if it moves.
const DEFAULT_TOP100_RESOURCE_ID = 'ba980e38-f110-466a-ad92-3ee0d5a60d49';

const dryRun = process.argv.slice(2).includes('--dry-run');

async function main() {
    const startedAt = new Date();
    let ok = false;
    let error = null;
    let datasetCount = 0;
    let ingestedCount = 0;

    try {
        const resourceId = process.env.TOP100_RESOURCE_ID || DEFAULT_TOP100_RESOURCE_ID;
        const res = await getResourceById(resourceId);
        if (!res) throw new Error('analytics resource not in catalogue: ' + resourceId);

        // The source itself must be ingested before we can read the snapshot. Pin it
        // so it stays loaded; if it is not ready yet, enqueue it and bail until the
        // next run (the worker will have loaded it by then).
        if (!dryRun) await pinResource(resourceId, 'top100-source');
        if (res.ingest_status !== 'ready' || !res.table_name) {
            console.log('analytics resource not ingested yet; enqueuing and exiting.');
            if (!dryRun) {
                try { await enqueueIngest(resourceId); }
                catch (e) { console.warn('could not enqueue source:', e.message); }
            }
            ok = true;
            return;
        }

        const columns = Array.isArray(res.ingested_columns) ? res.ingested_columns.map(c => c.id) : [];
        const { records } = await queryStoreTable({
            tableName: res.table_name, knownColumns: columns,
            q: undefined, filters: [], sortSql: '"_id" ASC', limit: 1000000, offset: 0
        });

        const snap = computeSnapshot(records);
        console.log('snapshot ' + snap.year + '-' + String(snap.month).padStart(2, '0') + ': ' + snap.ranked.length + ' datasets');
        if (snap.ranked.length === 0) {
            console.warn('no snapshot rows found; leaving existing top_downloads unchanged.');
            ok = true;
            return;
        }

        const items = [];
        const keepPins = [resourceId];

        // Resources the worker has permanently failed on - skip them when picking
        // so the daily cron stops re-enqueuing files that can never load.
        const failedIds = new Set(await listFailedResourceIds());
        if (failedIds.size) console.log('skipping ' + failedIds.size + ' previously-failed resources');

        // Reuse-or-ingest + pin one representative, returning its id (or null if it
        // turns out not to be loadable). Memoised per run so a resource shared by
        // both languages (a bilingual "en, fr" file, or a monolingual fallback) is
        // only enqueued + pinned once.
        const resolved = new Map();
        const resolveRep = async (rep) => {
            if (!rep) return null;
            if (resolved.has(rep.id)) return resolved.get(rep.id);
            let repId;
            if (dryRun) {
                repId = rep.id;
            } else if (rep.ingest_status === 'ready') {
                // Already ingested (and pinned from a prior run) - reuse, never re-download.
                repId = rep.id;
                keepPins.push(repId);
                await pinResource(repId, 'top100');
            } else {
                try {
                    await enqueueIngest(rep.id);
                    repId = rep.id;
                    keepPins.push(repId);
                    await pinResource(repId, 'top100');
                    ingestedCount += 1;
                } catch (e) {
                    if (e && e.statusCode === 422) {
                        repId = null; // not actually loadable -> download-only for this language
                    } else {
                        throw e;
                    }
                }
            }
            resolved.set(rep.id, repId);
            return repId;
        };

        for (const row of snap.ranked) {
            const resources = await listResourcesForDataset(row.dataset_id);
            // Prefer a same-language file; fall back to a language-blind pick so
            // monolingual / unknown-language datasets still get a representative.
            const repEn = pickRepresentative(resources, ingestCapBytesFor, 'en', failedIds)
                || pickRepresentative(resources, ingestCapBytesFor, null, failedIds);
            const repFr = pickRepresentative(resources, ingestCapBytesFor, 'fr', failedIds)
                || pickRepresentative(resources, ingestCapBytesFor, null, failedIds);
            const enId = await resolveRep(repEn);
            const frId = await resolveRep(repFr);
            items.push({
                dataset_id: row.dataset_id, rank: row.rank,
                title_en: row.title_en, title_fr: row.title_fr,
                department: row.department, ministere: row.ministere,
                downloads: row.downloads,
                period_year: snap.year, period_month: snap.month,
                history: snap.historyByDataset.get(row.dataset_id) || [],
                resource_id: enId || frId, // primary/default = English-preferred
                resource_id_en: enId,
                resource_id_fr: frId
            });
        }
        datasetCount = items.length;

        if (dryRun) {
            console.log('[dry-run] would write ' + items.length + ' rows; ingestable reps: ' + items.filter(i => i.resource_id).length);
        } else {
            await replaceTopDownloads(items);
            await prunePins(keepPins);
            console.log('wrote ' + items.length + ' rows; enqueued ' + ingestedCount + ' ingests; pinned ' + keepPins.length + ' resources.');
        }
        ok = true;
    } catch (err) {
        error = err.message;
        console.error('seed-top100 failed:', err);
    } finally {
        try {
            if (!dryRun) {
                await insertSyncRun(pool, {
                    kind: 'top100', startedAt, finishedAt: new Date(), ok,
                    datasetsUpserted: datasetCount, resourcesUpserted: ingestedCount, error
                });
            }
        } catch (logErr) {
            console.error('run log failed:', logErr.message);
        }
        await pool.end();
        process.exit(ok ? 0 : 1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
