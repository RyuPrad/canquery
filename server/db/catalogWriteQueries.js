function upsertOrganizations(db, orgs) {
    if (!orgs || orgs.length === 0) {
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
            placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`);
            values.push(org.id, org.name, org.titleEn, org.titleFr);
            paramIndex += 4;
        }
        const sql = `
            INSERT INTO organizations (id, name, title_en, title_fr)
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                title_en = EXCLUDED.title_en,
                title_fr = EXCLUDED.title_fr
        `;
        return db.query(sql, values);
    }));
}

function upsertDatasets(db, datasets) {
    if (!datasets || datasets.length === 0) {
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

function replaceResources(db, datasetIds, resources) {
    if (!datasetIds || datasetIds.length === 0) {
        return Promise.resolve();
    }
    const deleteSql = 'DELETE FROM resources WHERE dataset_id = ANY($1)';
    return db.query(deleteSql, [datasetIds]).then(() => {
        if (!resources || resources.length === 0) {
            return Promise.resolve();
        }
        const chunkSize = 500;
        const chunks = [];
        for (let i = 0; i < resources.length; i += chunkSize) {
            chunks.push(resources.slice(i, i + chunkSize));
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
    const sql = `
        UPDATE organizations
        SET dataset_count = sub.c
        FROM (
            SELECT org_id, count(*) AS c
            FROM datasets
            GROUP BY org_id
        ) sub
        WHERE organizations.id = sub.org_id
    `;
    return db.query(sql);
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
        INSERT INTO sync_runs (kind, started_at, finished_at, ok, datasets_upserted, resources_upserted, error)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    return db.query(sql, [
        run.kind,
        run.startedAt,
        run.finishedAt,
        run.ok,
        run.datasetsUpserted,
        run.resourcesUpserted,
        run.error
    ]);
}

module.exports = {
    upsertOrganizations,
    upsertDatasets,
    replaceResources,
    refreshOrganizationDatasetCounts,
    getProgress,
    setProgress,
    insertSyncRun
};
