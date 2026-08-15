// A single `INSERT ... VALUES (...) ON CONFLICT (id) DO UPDATE` errors with
// "cannot affect row a second time" if two rows in the same statement share the
// conflict key. package_search paging can return the same package on adjacent
// pages (ties on metadata_modified shuffle across the page boundary), so the
// collected set can carry duplicate ids. Dedupe by id (last occurrence wins -
// duplicates are the same record fetched twice) before building any upsert.
function dedupeById(rows) {
    if (!rows || rows.length === 0) {
        return [];
    }
    const byId = new Map();
    for (const row of rows) {
        byId.set(row.id, row);
    }
    return Array.from(byId.values());
}

function upsertOrganizations(db, orgsRaw) {
    const orgs = dedupeById(orgsRaw);
    if (orgs.length === 0) {
        return Promise.resolve();
    }
    const chunkSize = 500;
    const chunks = [];
    for (let i = 0; i < orgs.length; i += chunkSize) {
        chunks.push(orgs.slice(i, i + chunkSize));
    }

    return Promise.all(chunks.map(chunk => {
        const placeholders = [];
        const values = [];
        let paramIndex = 1;
        for (let j = 0; j < chunk.length; j++) {
            const org = chunk[j];
            placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
            values.push(org.id, org.name, org.titleEn, org.titleFr, org.placeId || null);
            paramIndex += 5;
        }
        const sql = `
            INSERT INTO organizations (id, name, title_en, title_fr, place_id)
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                title_en = EXCLUDED.title_en,
                title_fr = EXCLUDED.title_fr,
                place_id = EXCLUDED.place_id
        `;
        return db.query(sql, values);
    }));
}

function upsertDatasets(db, datasetsRaw) {
    const datasets = dedupeById(datasetsRaw);
    if (datasets.length === 0) {
        return Promise.resolve();
    }
    const chunkSize = 500;
    const chunks = [];
    for (let i = 0; i < datasets.length; i += chunkSize) {
        chunks.push(datasets.slice(i, i + chunkSize));
    }

    return Promise.all(chunks.map(chunk => {
        const placeholders = [];
        const values = [];
        let paramIndex = 1;
        for (let j = 0; j < chunk.length; j++) {
            const ds = chunk[j];
            placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10})`);
            values.push(
                ds.id,
                ds.name,
                ds.titleEn,
                ds.titleFr,
                ds.notesEn,
                ds.notesFr,
                ds.orgId,
                ds.keywordsEn,
                ds.keywordsFr,
                ds.metadataModified,
                JSON.stringify(ds.raw)
            );
            paramIndex += 11;
        }
        const sql = `
            INSERT INTO datasets (id, name, title_en, title_fr, notes_en, notes_fr, org_id, keywords_en, keywords_fr, metadata_modified, raw)
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                title_en = EXCLUDED.title_en,
                title_fr = EXCLUDED.title_fr,
                notes_en = EXCLUDED.notes_en,
                notes_fr = EXCLUDED.notes_fr,
                org_id = EXCLUDED.org_id,
                keywords_en = EXCLUDED.keywords_en,
                keywords_fr = EXCLUDED.keywords_fr,
                metadata_modified = EXCLUDED.metadata_modified,
                raw = EXCLUDED.raw
        `;
        return db.query(sql, values);
    }));
}

function upsertDatasetSources(db, rowsRaw) {
    const rows = Array.from(new Map((rowsRaw || []).map(row => [row.sourceId + '\0' + row.externalId, row])).values());
    if (rows.length === 0) return Promise.resolve();
    const chunks = [];
    for (let i = 0; i < rows.length; i += 250) chunks.push(rows.slice(i, i + 250));
    return Promise.all(chunks.map(chunk => {
        const values = [];
        const tuples = chunk.map((row, index) => {
            const p = index * 12 + 1;
            values.push(
                row.sourceId, row.externalId, row.datasetId, row.landingUrl || null,
                row.licenseTitleEn || null, row.licenseTitleFr || null, row.licenseUrl || null,
                row.attributionEn || null, row.attributionFr || null,
                row.isAuthoritative === true, JSON.stringify(row.raw || null), row.lastSeenAt || new Date()
            );
            return `($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8},$${p + 9},$${p + 10},$${p + 11})`;
        });
        return db.query(`
            INSERT INTO dataset_sources (
                source_id, external_id, dataset_id, landing_url,
                license_title_en, license_title_fr, license_url,
                attribution_en, attribution_fr, is_authoritative, raw, last_seen_at
            ) VALUES ${tuples.join(',')}
            ON CONFLICT (source_id, external_id) DO UPDATE SET
                dataset_id = EXCLUDED.dataset_id,
                landing_url = EXCLUDED.landing_url,
                license_title_en = EXCLUDED.license_title_en,
                license_title_fr = EXCLUDED.license_title_fr,
                license_url = EXCLUDED.license_url,
                attribution_en = EXCLUDED.attribution_en,
                attribution_fr = EXCLUDED.attribution_fr,
                is_authoritative = EXCLUDED.is_authoritative,
                raw = EXCLUDED.raw,
                last_seen_at = EXCLUDED.last_seen_at
        `, values);
    }));
}

async function replaceDatasetPlaces(db, sourceId, datasetIds, linksRaw) {
    if (!datasetIds || datasetIds.length === 0) return;
    await db.query(
        'DELETE FROM dataset_places WHERE source_id = $1 AND dataset_id = ANY($2::text[])',
        [sourceId, datasetIds]
    );
    const links = Array.from(new Map((linksRaw || []).map(link => [
        link.datasetId + '\0' + link.placeId + '\0' + link.relationship,
        link
    ])).values());
    if (links.length === 0) return;
    const values = [];
    const tuples = links.map((link, index) => {
        const p = index * 6 + 1;
        values.push(sourceId, link.datasetId, link.placeId, link.relationship, link.includesDescendants === true, link.assignmentMethod);
        return `($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5})`;
    });
    await db.query(`
        INSERT INTO dataset_places (
            source_id, dataset_id, place_id, relationship, includes_descendants, assignment_method
        ) VALUES ${tuples.join(',')}
        ON CONFLICT (source_id, dataset_id, place_id, relationship) DO UPDATE SET
            includes_descendants = EXCLUDED.includes_descendants,
            assignment_method = EXCLUDED.assignment_method
    `, values);
}

async function replaceResourceMaps(db, resourceIds, mapsRaw) {
    if (!resourceIds || resourceIds.length === 0) return;
    await db.query('DELETE FROM resource_maps WHERE resource_id = ANY($1::text[])', [resourceIds]);
    const maps = Array.from(new Map((mapsRaw || []).map(map => [map.resourceId, map])).values());
    if (maps.length === 0) return;
    const values = [];
    const tuples = maps.map((map, index) => {
        const p = index * 10 + 1;
        values.push(
            map.resourceId, 'arcgis', map.serviceUrl, map.geometryType,
            JSON.stringify(map.extent || null), map.objectIdField || null,
            map.displayField || null, JSON.stringify(map.fields || []),
            map.maxRecordCount || null, map.updatedAt || new Date()
        );
        return `($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8},$${p + 9})`;
    });
    await db.query(`
        INSERT INTO resource_maps (
            resource_id, provider, service_url, geometry_type, extent,
            object_id_field, display_field, fields, max_record_count, updated_at
        ) VALUES ${tuples.join(',')}
        ON CONFLICT (resource_id) DO UPDATE SET
            service_url = EXCLUDED.service_url,
            geometry_type = EXCLUDED.geometry_type,
            extent = EXCLUDED.extent,
            object_id_field = EXCLUDED.object_id_field,
            display_field = EXCLUDED.display_field,
            fields = EXCLUDED.fields,
            max_record_count = EXCLUDED.max_record_count,
            updated_at = EXCLUDED.updated_at
    `, values);
}

async function upsertCatalogSource(db, source) {
    await db.query(`
        INSERT INTO catalog_sources (
            id, kind, name_en, name_fr, homepage_url, catalog_url, upstream_host,
            default_license_title_en, default_license_title_fr, default_license_url,
            default_attribution_en, default_attribution_fr, enabled, sync_interval_hours, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
        ON CONFLICT (id) DO UPDATE SET
            kind = EXCLUDED.kind,
            name_en = EXCLUDED.name_en,
            name_fr = EXCLUDED.name_fr,
            homepage_url = EXCLUDED.homepage_url,
            catalog_url = EXCLUDED.catalog_url,
            upstream_host = EXCLUDED.upstream_host,
            default_license_title_en = EXCLUDED.default_license_title_en,
            default_license_title_fr = EXCLUDED.default_license_title_fr,
            default_license_url = EXCLUDED.default_license_url,
            default_attribution_en = EXCLUDED.default_attribution_en,
            default_attribution_fr = EXCLUDED.default_attribution_fr,
            enabled = EXCLUDED.enabled,
            sync_interval_hours = EXCLUDED.sync_interval_hours,
            updated_at = now()
    `, [
        source.id, source.kind, source.nameEn, source.nameFr || null,
        source.homepageUrl, source.catalogUrl || null, source.upstreamHost,
        source.defaultLicenseTitleEn || null, source.defaultLicenseTitleFr || null,
        source.defaultLicenseUrl || null, source.defaultAttributionEn || null,
        source.defaultAttributionFr || null, source.enabled !== false,
        source.syncIntervalHours || null
    ]);
}

function replaceResources(db, datasetIds, resources) {
    if (!datasetIds || datasetIds.length === 0) {
        return Promise.resolve();
    }
    const deleteSql = 'DELETE FROM resources WHERE dataset_id = ANY($1)';
    return db.query(deleteSql, [datasetIds]).then(() => {
        const resourceRows = dedupeById(resources);
        if (resourceRows.length === 0) {
            return Promise.resolve();
        }
        const chunkSize = 500;
        const chunks = [];
        for (let i = 0; i < resourceRows.length; i += chunkSize) {
            chunks.push(resourceRows.slice(i, i + chunkSize));
        }

        return Promise.all(chunks.map(chunk => {
            const placeholders = [];
            const values = [];
            let paramIndex = 1;
            for (let j = 0; j < chunk.length; j++) {
                const r = chunk[j];
                placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10})`);
                values.push(
                    r.id,
                    r.datasetId,
                    r.nameEn,
                    r.nameFr,
                    r.format,
                    r.url,
                    r.sizeBytes,
                    r.datastoreActive,
                    r.language,
                    r.lastModified,
                    JSON.stringify(r.raw)
                );
                paramIndex += 11;
            }
            const sql = `
                INSERT INTO resources (id, dataset_id, name_en, name_fr, format, url, size_bytes, datastore_active, language, last_modified, raw)
                VALUES ${placeholders.join(', ')}
                ON CONFLICT (id) DO UPDATE SET
                    dataset_id = EXCLUDED.dataset_id,
                    name_en = EXCLUDED.name_en,
                    name_fr = EXCLUDED.name_fr,
                    format = EXCLUDED.format,
                    url = EXCLUDED.url,
                    size_bytes = EXCLUDED.size_bytes,
                    datastore_active = EXCLUDED.datastore_active,
                    language = EXCLUDED.language,
                    last_modified = EXCLUDED.last_modified,
                    raw = EXCLUDED.raw
            `;
            return db.query(sql, values);
        }));
    });
}

function refreshOrganizationDatasetCounts(db) {
    // Correlated subquery over every org (not a join against grouped datasets):
    // an org whose last dataset moved away has no row in a GROUP BY org_id result,
    // so a join would leave its count stale. count(*) returns 0 for such orgs,
    // keeping dataset_count and the dataset_count > 0 stats filter honest.
    const sql = `
        UPDATE organizations o
        SET dataset_count = (SELECT count(*) FROM datasets d WHERE d.org_id = o.id)
    `;
    return db.query(sql);
}

// package_list is the authoritative set during a complete, unlimited full sync.
// Remove catalogue rows that disappeared upstream, but refuse a suspiciously
// large sweep (often a truncated/broken package_list response) unless the
// operator deliberately raises the configured fraction.
async function sweepMissingDatasets(db, upstreamIdsRaw, options = {}) {
    const upstreamIds = Array.from(new Set((upstreamIdsRaw || []).filter(Boolean)));
    if (upstreamIds.length === 0) {
        throw new Error('refusing catalogue sweep with an empty upstream id set');
    }

    const maxDeleteFraction = Number.isFinite(options.maxDeleteFraction)
        ? options.maxDeleteFraction
        : 0.1;
    const sourceId = options.sourceId || 'open-canada';
    if (maxDeleteFraction <= 0 || maxDeleteFraction > 1) {
        throw new TypeError('maxDeleteFraction must be greater than 0 and at most 1');
    }

    const countResult = await db.query(`
        SELECT count(*)::bigint AS total,
               count(*) FILTER (WHERE NOT (external_id = ANY($1::text[])))::bigint AS missing
        FROM dataset_sources
        WHERE source_id = $2
    `, [upstreamIds, sourceId]);
    const total = Number(countResult.rows[0].total) || 0;
    const missing = Number(countResult.rows[0].missing) || 0;

    // Small development catalogues can legitimately lose one of a handful of
    // rows. On a real harvest, require an operator decision before deleting more
    // than the safety fraction in one run.
    if (total >= 100 && missing / total > maxDeleteFraction) {
        throw new Error(
            'refusing catalogue sweep of ' + missing + '/' + total +
            ' datasets (limit ' + (maxDeleteFraction * 100) + '%)'
        );
    }
    if (missing === 0) return { datasetsDeleted: 0, resourcesDeleted: 0 };

    const removedResult = await db.query(`
        DELETE FROM dataset_sources
        WHERE source_id = $2 AND NOT (external_id = ANY($1::text[]))
        RETURNING dataset_id
    `, [upstreamIds, sourceId]);
    const removedDatasetIds = Array.from(new Set(removedResult.rows.map(row => row.dataset_id)));
    if (removedDatasetIds.length === 0) return { datasetsDeleted: 0, resourcesDeleted: 0 };
    await db.query(
        'DELETE FROM dataset_places WHERE source_id = $2 AND dataset_id = ANY($1::text[])',
        [removedDatasetIds, sourceId]
    );
    const orphanedResult = await db.query(`
        SELECT id FROM datasets d
        WHERE id = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM dataset_sources ds WHERE ds.dataset_id = d.id)
    `, [removedDatasetIds]);
    const orphanedIds = orphanedResult.rows.map(row => row.id);
    if (orphanedIds.length === 0) return { datasetsDeleted: 0, resourcesDeleted: 0 };
    const resourcesResult = await db.query(
        'DELETE FROM resources WHERE dataset_id = ANY($1::text[])',
        [orphanedIds]
    );
    const datasetsResult = await db.query(
        'DELETE FROM datasets WHERE id = ANY($1::text[])',
        [orphanedIds]
    );
    return {
        datasetsDeleted: datasetsResult.rowCount,
        resourcesDeleted: resourcesResult.rowCount
    };
}

function getProgress(db, key) {
    const sql = 'SELECT value FROM sync_progress WHERE key = $1';
    return db.query(sql, [key]).then(result => {
        return result.rows && result.rows.length > 0 ? result.rows[0].value : null;
    });
}

function setProgress(db, key, value) {
    const sql = `
        INSERT INTO sync_progress (key, value, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = now()
    `;
    return db.query(sql, [key, JSON.stringify(value)]);
}

function insertSyncRun(db, run) {
    const sql = `
        INSERT INTO sync_runs (kind, source_id, started_at, finished_at, ok, datasets_upserted, resources_upserted, error)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    return db.query(sql, [
        run.kind,
        run.sourceId || null,
        run.startedAt,
        run.finishedAt,
        run.ok,
        run.datasetsUpserted,
        run.resourcesUpserted,
        run.error
    ]);
}

module.exports = {
    dedupeById,
    upsertOrganizations,
    upsertDatasets,
    upsertDatasetSources,
    replaceDatasetPlaces,
    replaceResourceMaps,
    upsertCatalogSource,
    replaceResources,
    refreshOrganizationDatasetCounts,
    sweepMissingDatasets,
    getProgress,
    setProgress,
    insertSyncRun
};
