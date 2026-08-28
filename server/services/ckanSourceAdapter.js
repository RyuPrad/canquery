const crypto = require('node:crypto');
const { fetchPublicJson } = require('./publicJson');

const PAGE_SIZE = 100;
const DIRECT_GEOJSON_VERSION = 'geojson-v1';
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

function directMapVersion(resource) {
    const identity = [
        DIRECT_GEOJSON_VERSION,
        resource.metadata_modified || null,
        resource.last_modified || null,
        resource.hash || null,
        Number(resource.size) > 0 ? Number(resource.size) : null,
        resource.url || null
    ];
    return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function patternMatches(pattern, value) {
    if (!pattern) return true;
    if (pattern instanceof RegExp) {
        pattern.lastIndex = 0;
        return pattern.test(clean(value));
    }
    return clean(pattern).toLowerCase() === clean(value).toLowerCase();
}

function publisherName(record, source) {
    const organization = record.organization || {};
    return clean(organization.title) ||
        clean(source.defaultOrganizationTitleEn || source.defaultOrganizationTitleFr) ||
        clean(source.nameEn || source.nameFr) || 'Publisher';
}

function authoritativePublisher(source, publisher) {
    if (!Array.isArray(source.authoritativePublishers)) return true;
    return source.authoritativePublishers.some(rule => patternMatches(rule.publisher, publisher));
}

function placeRuleFor(source, publisher) {
    const configured = Array.isArray(source.placeRules) ? source.placeRules : [];
    const match = configured.find(rule => patternMatches(rule.publisher, publisher));
    if (match) return match;
    if (!source.placeId) return null;
    return {
        placeId: source.placeId,
        relationship: 'direct',
        includesDescendants: false
    };
}

function configuredLicense(source) {
    if (!source.defaultLicenseUrl) return null;
    return {
        titleEn: source.defaultLicenseTitleEn || null,
        titleFr: source.defaultLicenseTitleFr || null,
        url: source.defaultLicenseUrl,
        attributionEn: source.defaultAttributionEn || null,
        attributionFr: source.defaultAttributionFr || null
    };
}

function licenseFor(record, source) {
    const rules = Array.isArray(source.licenseRules) ? source.licenseRules : [];
    if (rules.length) {
        const id = clean(record.license_id);
        const title = clean(record.license_title);
        const url = clean(record.license_url);
        const publisher = publisherName(record, source);
        const rule = rules.find(item =>
            patternMatches(item.licenseId, id) &&
            patternMatches(item.licenseTitle, title) &&
            patternMatches(item.licenseUrl, url) &&
            patternMatches(item.publisher, publisher)
        );
        return rule ? rule.license : null;
    }
    return configuredLicense(source);
}

function translated(value, language) {
    const result = { en: null, fr: null };
    result[language === 'fr' ? 'fr' : 'en'] = clean(value) || null;
    return result;
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
    const language = source.metadataLanguage === 'fr' ? 'fr' : 'en';
    const name = translated(clean(resource.name) || originalFormat, language);
    return {
        id: namespace(source.id, 'resource', upstreamId),
        datasetId,
        nameEn: name.en,
        nameFr: name.fr,
        format: resource.datastore_active === true ? 'CSV' : originalFormat,
        url: resourceUrl(resource, source.catalogUrl),
        sizeBytes: Number.isFinite(Number(resource.size)) && Number(resource.size) > 0 ? Number(resource.size) : null,
        datastoreActive: resource.datastore_active === true,
        language,
        lastModified: timestamp(resource.last_modified || resource.metadata_modified),
        raw: {
            provider: 'ckan',
            source_id: source.id,
            upstream_resource_id: upstreamId,
            original_format: originalFormat,
            source_hash: clean(resource.hash) || null,
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
    const catalogOrganization = clean(source.catalogOrganization);
    if (catalogOrganization && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(catalogOrganization)) {
        throw new Error('CKAN source has an unsafe catalog organization slug');
    }
    let total = null;
    const seen = new Set();
    for (let start = 0; total == null || start < total; start += PAGE_SIZE) {
        const url = new URL(source.catalogUrl.replace(/\/+$/, '') + '/package_search');
        url.searchParams.set('rows', String(PAGE_SIZE));
        url.searchParams.set('start', String(start));
        url.searchParams.set('sort', 'id asc');
        if (catalogOrganization) url.searchParams.set('fq', 'organization:' + catalogOrganization);
        const body = await fetchJson(url.href, options.http);
        const result = body && body.success !== false ? body.result : null;
        if (!result || !Array.isArray(result.results) || !Number.isInteger(Number(result.count))) {
            throw new Error('CKAN source returned an invalid package_search response');
        }
        const pageTotal = Number(result.count);
        if (pageTotal < 0) throw new Error('CKAN source returned an invalid package_search count');
        if (total == null) total = pageTotal;
        else if (pageTotal !== total) throw new Error('CKAN source catalogue count changed while paging');
        for (const record of result.results) {
            const identity = identityFor(record);
            if (!identity) throw new Error('CKAN source returned a package without an id');
            const key = canonicalKey(identity);
            if (seen.has(key)) throw new Error('CKAN source returned a duplicate package id');
            seen.add(key);
            if (catalogOrganization) {
                const organization = record && record.organization || {};
                if (clean(organization.name).toLowerCase() !== catalogOrganization.toLowerCase()) {
                    throw new Error('CKAN source returned a package outside its configured organization');
                }
            }
            records.push(record);
        }
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
    const upstreamOrgId = clean(organization.id || record.owner_org || source.defaultOrganizationId || 'publisher');
    const orgId = namespace(source.id, 'org', upstreamOrgId);
    const publisher = publisherName(record, source);
    const placeRule = placeRuleFor(source, publisher);
    const licence = licenseFor(record, source);
    if (!licence || !licence.url) {
        return { status: 'excluded', reason: 'unlicensed', externalId: canonicalKey(externalId) };
    }
    const language = source.metadataLanguage === 'fr' ? 'fr' : 'en';
    const organizationTitle = translated(publisher, language);
    if (source.defaultOrganizationTitleEn && !organizationTitle.en) {
        organizationTitle.en = source.defaultOrganizationTitleEn;
    }
    if (source.defaultOrganizationTitleFr && !organizationTitle.fr) {
        organizationTitle.fr = source.defaultOrganizationTitleFr;
    }
    const selectedResources = chooseResources(Array.isArray(record.resources) ? record.resources : []);
    const resources = selectedResources.map(resource => normalizeResource(resource, datasetId, source));
    const resourceByUpstream = new Map(resources.map(resource => [resource.raw.upstream_resource_id, resource]));
    const mapCandidates = selectedResources
        .filter(resource => formatOf(resource) === 'GEOJSON' &&
            (resource.datastore_active === true ||
                (source.directGeoJsonMaps === true && clean(resource.url) !== '')))
        .map(resource => ({
            resourceId: resourceByUpstream.get(clean(resource.id)).id,
            desiredVersion: resource.datastore_active === true ? mapVersion(resource) : directMapVersion(resource),
            mode: resource.datastore_active === true ? 'ckan-datastore-csv' : 'geojson-file',
            sourceUrl: resourceUrl(resource, source.catalogUrl),
            expectedRows: Number.isFinite(Number(resource.record_count)) ? Number(resource.record_count) : null,
            expectedVertices: Number.isFinite(Number(resource.vertex_count)) ? Number(resource.vertex_count) : null,
            expectedBytes: Number.isFinite(Number(resource.size)) && Number(resource.size) > 0
                ? Number(resource.size) : null,
            raw: { upstream_resource_id: clean(resource.id) }
        }));
    const keywords = Array.from(new Set([
        ...(Array.isArray(record.topics) ? record.topics : []),
        ...(Array.isArray(record.tags) ? record.tags.map(tag => tag && (tag.display_name || tag.name)) : [])
    ].map(clean).filter(Boolean)));
    const modified = timestamp(record.metadata_modified || record.last_refreshed);
    const datasetTitle = translated(record.title, language);
    const datasetNotes = translated(record.notes || record.excerpt, language);
    return {
        status: 'included',
        value: {
            externalId: canonicalKey(externalId),
            organization: {
                id: orgId,
                name: source.id + '-' + (clean(organization.name) || source.defaultOrganizationName || 'publisher'),
                titleEn: organizationTitle.en,
                titleFr: organizationTitle.fr,
                placeId: placeRule ? placeRule.placeId : null
            },
            dataset: {
                id: datasetId,
                name: source.id + '-' + clean(record.name),
                titleEn: datasetTitle.en,
                titleFr: datasetTitle.fr,
                notesEn: datasetNotes.en,
                notesFr: datasetNotes.fr,
                orgId,
                keywordsEn: language === 'en' ? keywords : [],
                keywordsFr: language === 'fr' ? keywords : [],
                metadataModified: modified,
                raw: {
                    provider: 'ckan', source_id: source.id, upstream_dataset_id: externalId,
                    metadata_language: language, retired: record.is_retired === true
                }
            },
            source: {
                sourceId: source.id,
                externalId: canonicalKey(externalId),
                datasetId,
                landingUrl: (source.datasetBaseUrl ||
                    source.homepageUrl.replace(/\/+$/, '') + '/dataset').replace(/\/+$/, '') +
                    '/' + encodeURIComponent(record.name) + '/',
                licenseTitleEn: licence.titleEn || null,
                licenseTitleFr: licence.titleFr || null,
                licenseUrl: licence.url,
                attributionEn: licence.attributionEn || null,
                attributionFr: licence.attributionFr || null,
                isAuthoritative: authoritativePublisher(source, publisher),
                raw: {
                    upstream_dataset_id: externalId,
                    publisher,
                    license_id: clean(record.license_id) || null,
                    license_title: clean(record.license_title) || null,
                    license_url: clean(record.license_url) || null,
                    retired: record.is_retired === true
                }
            },
            resources,
            places: placeRule ? [{
                datasetId,
                placeId: placeRule.placeId,
                relationship: placeRule.relationship,
                includesDescendants: placeRule.includesDescendants === true,
                assignmentMethod: 'source'
            }] : [],
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
    directMapVersion,
    licenseFor,
    authoritativePublisher,
    placeRuleFor,
    namespace
};
