const crypto = require('node:crypto');
const { fetchPublicJson } = require('./publicJson');

const PAGE_SIZE = 100;
const FORMAT_PRIORITY = new Map([
    ['CSV-4326', 0], ['CSV-WGS84', 0], ['CSV', 1], ['XLSX', 2], ['XLS', 3],
    ['GEOJSON', 4], ['JSON', 5], ['GPKG', 6], ['SHP', 7], ['ZIP', 8], ['PDF', 9]
]);

function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function timestamp(value) {
    if (value == null || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatOf(resource) {
    return clean(resource && resource.format).toUpperCase() || 'FILE';
}

function namespace(sourceId, kind, upstreamId) {
    return ['ckan', sourceId, kind, clean(upstreamId).toLowerCase()].join('-');
}

function logicalKey(resource) {
    const name = clean(resource && resource.name) || clean(resource && resource.id);
    return name
        .replace(/\.[a-z0-9]{1,8}$/i, '')
        .replace(/[\s_-]+(?:epsg[\s_-]*)?(?:4326|2952|wgs[\s_-]*84|mtm[\s_-]*10)$/i, '')
        .trim().toLowerCase();
}

function priority(resource) {
    const format = formatOf(resource);
    const name = clean(resource && resource.name).toUpperCase();
    const key = format === 'CSV' && /(?:4326|WGS[\s_-]*84)/.test(name)
        ? (name.includes('4326') ? 'CSV-4326' : 'CSV-WGS84')
        : format;
    return FORMAT_PRIORITY.has(key) ? FORMAT_PRIORITY.get(key) : 100;
}

function chooseResources(resources) {
    const active = resources.filter(resource => resource && resource.datastore_active === true);
    const activeIds = new Set(active.map(resource => clean(resource.id)));
    const activeKeys = new Set(active.map(logicalKey));
    const remaining = resources.filter(resource => {
        if (!resource || resource.datastore_active === true) return false;
        const linked = clean(resource.datastore_resource_id);
        if (linked && activeIds.has(linked) && activeKeys.has(logicalKey(resource))) return false;
        return clean(resource.url) !== '';
    });
    const chosen = new Map();
    for (const resource of remaining) {
        const key = logicalKey(resource);
        const current = chosen.get(key);
        if (!current || priority(resource) < priority(current) ||
            (priority(resource) === priority(current) && Number(resource.position) < Number(current.position))) {
            chosen.set(key, resource);
        }
    }
    return active.concat(Array.from(chosen.values()));
}

function mapVersion(resource) {
    const identity = [
        resource.metadata_modified || null,
        resource.datastore_cache_last_update || null,
        resource.record_count == null ? null : Number(resource.record_count),
        resource.vertex_count == null ? null : Number(resource.vertex_count),
        resource.url || null
    ];
    return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function resourceUrl(resource, actionBase) {
    if (resource.datastore_active === true) {
        return actionBase.replace(/\/api\/3\/action\/?$/, '') + '/datastore/dump/' + encodeURIComponent(resource.id);
    }
    return clean(resource.url);
}

function normalizeResource(resource, datasetId, source) {
    const upstreamId = clean(resource.id);
    const originalFormat = formatOf(resource);
    return {
        id: namespace(source.id, 'resource', upstreamId),
        datasetId,
        nameEn: clean(resource.name) || originalFormat,
        nameFr: null,
        format: resource.datastore_active === true ? 'CSV' : originalFormat,
        url: resourceUrl(resource, source.catalogUrl),
        sizeBytes: Number.isFinite(Number(resource.size)) ? Number(resource.size) : null,
        datastoreActive: resource.datastore_active === true,
        language: 'en',
        lastModified: timestamp(resource.last_modified || resource.metadata_modified),
        raw: {
            provider: 'ckan',
            source_id: source.id,
            upstream_resource_id: upstreamId,
            original_format: originalFormat,
            record_count: Number.isFinite(Number(resource.record_count)) ? Number(resource.record_count) : null,
            vertex_count: Number.isFinite(Number(resource.vertex_count)) ? Number(resource.vertex_count) : null
        }
    };
}

function identityFor(record) {
    return clean(record && record.id) || null;
}

function canonicalKey(identity) {
    return clean(identity).toLowerCase();
}

async function discover(source, options = {}) {
    const fetchJson = options.fetchJson || fetchPublicJson;
    const records = [];
    let total = null;
    for (let start = 0; total == null || start < total; start += PAGE_SIZE) {
        const url = new URL(source.catalogUrl.replace(/\/+$/, '') + '/package_search');
        url.searchParams.set('rows', String(PAGE_SIZE));
        url.searchParams.set('start', String(start));
        url.searchParams.set('sort', 'id asc');
        const body = await fetchJson(url.href, options.http);
        const result = body && body.success !== false ? body.result : null;
        if (!result || !Array.isArray(result.results) || !Number.isInteger(Number(result.count))) {
            throw new Error('CKAN source returned an invalid package_search response');
        }
        total = Number(result.count);
        records.push(...result.results);
        if (result.results.length === 0) break;
    }
    if (total === 0 || records.length === 0) throw new Error('CKAN source returned an empty catalogue');
    if (records.length < total) throw new Error('CKAN source catalogue ended before its advertised count');
    return records.slice(0, total);
}

async function enrichRecord(record, source) {
    const externalId = identityFor(record);
    if (!externalId || !clean(record.name) || !clean(record.title)) {
        return { status: 'excluded', reason: 'invalid-package', externalId };
    }
    const datasetId = namespace(source.id, 'dataset', externalId);
    const organization = record.organization || {};
    const upstreamOrgId = clean(organization.id || record.owner_org || 'city-of-toronto');
    const orgId = namespace(source.id, 'org', upstreamOrgId);
    const selectedResources = chooseResources(Array.isArray(record.resources) ? record.resources : []);
    const resources = selectedResources.map(resource => normalizeResource(resource, datasetId, source));
    const resourceByUpstream = new Map(resources.map(resource => [resource.raw.upstream_resource_id, resource]));
    const mapCandidates = selectedResources
        .filter(resource => resource.datastore_active === true && formatOf(resource) === 'GEOJSON')
        .map(resource => ({
            resourceId: resourceByUpstream.get(clean(resource.id)).id,
            desiredVersion: mapVersion(resource),
            sourceUrl: resourceUrl(resource, source.catalogUrl),
            expectedRows: Number.isFinite(Number(resource.record_count)) ? Number(resource.record_count) : null,
            expectedVertices: Number.isFinite(Number(resource.vertex_count)) ? Number(resource.vertex_count) : null,
            raw: { upstream_resource_id: clean(resource.id) }
        }));
    const keywords = Array.from(new Set([
        ...(Array.isArray(record.topics) ? record.topics : []),
        ...(Array.isArray(record.tags) ? record.tags.map(tag => tag && (tag.display_name || tag.name)) : [])
    ].map(clean).filter(Boolean)));
    const modified = timestamp(record.metadata_modified || record.last_refreshed);
    return {
        status: 'included',
        value: {
            externalId: canonicalKey(externalId),
            organization: {
                id: orgId,
                name: source.id + '-' + (clean(organization.name) || 'city-of-toronto'),
                titleEn: clean(organization.title) || 'City of Toronto',
                titleFr: 'Ville de Toronto',
                placeId: source.placeId
            },
            dataset: {
                id: datasetId,
                name: source.id + '-' + clean(record.name),
                titleEn: clean(record.title),
                titleFr: null,
                notesEn: clean(record.notes || record.excerpt) || null,
                notesFr: null,
                orgId,
                keywordsEn: keywords,
                keywordsFr: [],
                metadataModified: modified,
                raw: { provider: 'ckan', source_id: source.id, upstream_dataset_id: externalId, retired: record.is_retired === true }
            },
            source: {
                sourceId: source.id,
                externalId: canonicalKey(externalId),
                datasetId,
                landingUrl: source.homepageUrl.replace(/\/+$/, '') + '/dataset/' + encodeURIComponent(record.name) + '/',
                licenseTitleEn: source.defaultLicenseTitleEn,
                licenseTitleFr: source.defaultLicenseTitleFr,
                licenseUrl: source.defaultLicenseUrl,
                attributionEn: source.defaultAttributionEn,
                attributionFr: source.defaultAttributionFr,
                isAuthoritative: true,
                raw: { upstream_dataset_id: externalId, retired: record.is_retired === true }
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
            manageMapCandidates: true,
            mapCandidates
        }
    };
}

module.exports = {
    discover,
    enrichRecord,
    identityFor,
    canonicalKey,
    chooseResources,
    logicalKey,
    priority,
    mapVersion,
    namespace
};
