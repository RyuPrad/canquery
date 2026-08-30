const { fetchPublicJson } = require('./publicJson');

const DOWNLOAD_FORMATS = new Map([
    ['CSV', { format: 'CSV', endpoint: 'csv' }],
    ['EXCEL', { format: 'XLSX', endpoint: 'excel' }],
    ['JSON', { format: 'JSON', endpoint: 'json' }],
    ['SHAPEFILE', { format: 'ZIP', endpoint: 'shapefile' }],
    ['KMZ', { format: 'KMZ', endpoint: 'kmz' }],
    ['ZIP', { format: 'ZIP', endpoint: 'zip' }],
    ['XML', { format: 'XML', endpoint: 'xml' }]
]);

function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function timestamp(value) {
    if (value == null || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function identityFor(record) {
    try {
        const url = new URL(clean(record && record.dataUrl));
        const match = url.pathname.match(/^\/api\/datasets\/([a-z0-9-]+)\/?$/i);
        return match ? match[1].toLowerCase() : null;
    } catch {
        return null;
    }
}

function canonicalKey(identity) {
    return clean(identity).toLowerCase();
}

function pageSlug(record) {
    return clean(record && record.name).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function listedFormats(record) {
    const seen = new Set();
    return clean(record && record.formats)
        .split(',')
        .map(value => clean(value).toUpperCase())
        .map(value => DOWNLOAD_FORMATS.get(value))
        .filter(Boolean)
        .filter(value => {
            if (seen.has(value.endpoint)) return false;
            seen.add(value.endpoint);
            return true;
        });
}

function keywords(record) {
    return Array.from(new Set(clean(record && record.keywords)
        .split(',')
        .map(clean)
        .filter(Boolean)));
}

async function discover(source, options = {}) {
    const body = await (options.fetchJson || fetchPublicJson)(source.catalogUrl, options.http);
    const datasets = body && body.datasets;
    const total = Number(body && body.totalCount);
    if (!Array.isArray(datasets) || !Number.isInteger(total) || total <= 0 || datasets.length !== total) {
        throw new Error('Red Deer returned an invalid or incomplete catalogue');
    }

    const expectedHost = clean(source.upstreamHost).toLowerCase();
    const identities = new Set();
    for (const record of datasets) {
        const identity = identityFor(record);
        let url;
        try {
            url = new URL(clean(record && record.dataUrl));
        } catch {
            throw new Error('Red Deer returned a dataset with an invalid data URL');
        }
        if (!identity || url.protocol !== 'https:' || url.hostname.toLowerCase() !== expectedHost) {
            throw new Error('Red Deer returned a dataset outside its configured HTTPS host');
        }
        if (identities.has(identity)) throw new Error('Red Deer returned a duplicate dataset identity');
        identities.add(identity);
    }
    return datasets;
}

async function enrichRecord(record, source) {
    const externalId = identityFor(record);
    const title = clean(record && record.name);
    const compactSlug = pageSlug(record);
    const license = source.license;
    if (!externalId || !title || !compactSlug) {
        return { status: 'excluded', reason: 'invalid-dataset', externalId };
    }
    if (!license || !clean(license.url)) {
        return { status: 'excluded', reason: 'unlicensed', externalId: canonicalKey(externalId) };
    }

    const available = listedFormats(record);
    if (available.length === 0) {
        return { status: 'excluded', reason: 'not-loadable', externalId: canonicalKey(externalId) };
    }

    const datasetId = 'red-deer-' + canonicalKey(externalId);
    const publisher = clean(source.publisher) || 'The City of Red Deer';
    const orgId = 'red-deer-publisher-city-of-red-deer';
    const modified = timestamp(record.lastUpdateDate || record.metaDataLastUpdate);
    const baseUrl = 'https://' + source.upstreamHost + '/datasets/' + compactSlug + '/download/';
    const resources = available.map(item => ({
        id: datasetId + '-' + item.endpoint,
        datasetId,
        nameEn: title + ' – ' + item.format,
        nameFr: null,
        format: item.format,
        url: baseUrl + item.endpoint,
        sizeBytes: null,
        datastoreActive: false,
        language: 'en',
        lastModified: modified,
        raw: {
            provider: 'red-deer',
            source_id: source.id,
            upstream_dataset_id: externalId,
            download_format: item.endpoint
        }
    }));

    return {
        status: 'included',
        value: {
            externalId: canonicalKey(externalId),
            organization: {
                id: orgId,
                name: 'city-of-red-deer',
                titleEn: publisher,
                titleFr: 'Ville de Red Deer',
                placeId: source.placeId
            },
            dataset: {
                id: datasetId,
                name: datasetId,
                titleEn: title,
                titleFr: null,
                notesEn: clean(record.description) || null,
                notesFr: null,
                orgId,
                keywordsEn: keywords(record),
                keywordsFr: [],
                metadataModified: modified,
                raw: {
                    provider: 'red-deer',
                    source_id: source.id,
                    upstream_dataset_id: externalId,
                    category: clean(record.category) || null,
                    owner: clean(record.owner) || null
                }
            },
            source: {
                sourceId: source.id,
                externalId: canonicalKey(externalId),
                datasetId,
                landingUrl: 'https://' + source.upstreamHost + '/' + compactSlug,
                licenseTitleEn: license.titleEn || null,
                licenseTitleFr: license.titleFr || null,
                licenseUrl: license.url,
                attributionEn: license.attributionEn || null,
                attributionFr: license.attributionFr || null,
                isAuthoritative: true,
                raw: { upstream_dataset_id: externalId, publisher }
            },
            resources,
            places: [{
                datasetId,
                placeId: source.placeId,
                relationship: 'direct',
                includesDescendants: false,
                assignmentMethod: 'source'
            }],
            maps: [],
            manageMaps: false,
            mapCandidates: [],
            manageMapCandidates: true
        }
    };
}

module.exports = {
    discover,
    enrichRecord,
    identityFor,
    canonicalKey,
    listedFormats,
    pageSlug,
    timestamp
};
