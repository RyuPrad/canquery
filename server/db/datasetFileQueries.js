const pool = require('./pool');

// One dataset's files in the given formats, for the owner jobs that load a whole
// dataset into tables of its own (the LMIA history, the OAS benefit amounts). Each
// row carries what services/resourceVersion.js needs: a narrow slice of `raw`,
// never the whole record. `language` is the catalogue's value for a file ('en',
// 'fr', or 'en, fr' for a bilingual one); null keeps every language.
async function listDatasetFiles({ datasetId, formats, language = null }, db = pool) {
    if (typeof datasetId !== 'string' || !datasetId) throw new TypeError('listDatasetFiles needs a dataset id');
    if (!Array.isArray(formats) || !formats.length) throw new TypeError('listDatasetFiles needs formats');
    const { rows } = await db.query(`
        SELECT r.id, r.name_en, r.name_fr, r.url, r.format, r.size_bytes, r.last_modified,
            jsonb_build_object('record_count', r.raw->'record_count', 'field_count', r.raw->'field_count',
                'source_hash', r.raw->'source_hash', 'hash', r.raw->'hash', 'data_processed', r.raw->'data_processed',
                'rows_updated_at', r.raw->'rows_updated_at', 'view_last_modified', r.raw->'view_last_modified') AS raw
        FROM resources r
        WHERE r.dataset_id = $1 AND ($3::text IS NULL OR r.language = $3) AND upper(r.format) = ANY($2::text[])
            AND r.url IS NOT NULL
        ORDER BY r.id
    `, [datasetId, formats.map(format => String(format).toUpperCase()), language]);
    return rows;
}

module.exports = { listDatasetFiles };
