const { plainText, truncate, resourceTitleBase, resourceDescription } = require('./seoMeta');
const { resourceLanguages } = require('./catalogText');
const { classifyResource } = require('./resourceCapabilities');

const localized = (row, key, lang) => plainText(row[key + '_' + lang]) || plainText(row[key + '_' + (lang === 'fr' ? 'en' : 'fr')]);

function fieldPreview(row) {
    const columns = row.ingest_status === 'ready' && Array.isArray(row.ingested_columns) ? row.ingested_columns : [];
    const raw = columns.length ? columns : (Array.isArray(row.map_fields) ? row.map_fields : []);
    const fields = new Map();
    for (const field of raw) {
        if (!field || typeof field !== 'object') continue;
        const name = plainText(field.id || field.name);
        if (name && !fields.has(name)) fields.set(name, { name, type: plainText(field.type) || null });
    }
    return { items: [...fields.values()].slice(0, 20), total: fields.size,
        source: fields.size ? (columns.length ? 'table' : 'map') : null };
}

function resourcePresentation(row) {
    const mode = classifyResource(row).capability;
    const title = {}, summary = {};
    for (const lang of ['en', 'fr']) {
        const translated = { ...row, name_en: localized(row, 'name', lang),
            dataset_title_en: localized(row, 'dataset_title', lang) };
        title[lang] = resourceTitleBase(translated, null, lang);
        summary[lang] = resourceDescription(translated, { lang, max: 1200 });
    }
    return {
        title, summary,
        formats: row.format ? [plainText(row.format).toUpperCase()] : [],
        languages: resourceLanguages(row),
        capabilities: { table: ['datastore', 'ingested'].includes(mode) ? 'ready' : mode === 'ingestable' ? 'loadable' : null,
            map: Boolean(row.map_provider || row.map?.available), download: /^https?:\/\//i.test(row.url || '') },
        fields: fieldPreview(row)
    };
}

function datasetPresentation(row, resources = []) {
    const title = {}, summary = {}, description = {};
    for (const lang of ['en', 'fr']) {
        title[lang] = localized(row, 'title', lang) || row.name || row.id;
        description[lang] = localized(row, 'notes', lang);
        summary[lang] = truncate(description[lang], 1200);
    }
    const modes = resources.map(resource => classifyResource(resource).capability);
    return { title, summary, description,
        formats: [...new Set(resources.map(resource => plainText(resource.format).toUpperCase()).filter(Boolean))].sort(),
        languages: [...new Set(resources.flatMap(resourceLanguages))].sort(),
        capabilities: { ready: modes.filter(mode => ['datastore', 'ingested'].includes(mode)).length,
            loadable: modes.filter(mode => mode === 'ingestable').length,
            mapped: resources.filter(resource => resource.map_provider || resource.map?.available).length },
        fields: { items: [], total: 0, source: null }
    };
}

module.exports = { resourcePresentation, datasetPresentation, fieldPreview };
