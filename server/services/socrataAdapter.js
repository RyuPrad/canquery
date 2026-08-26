const crypto = require('node:crypto');
const { fetchPublicJson } = require('./publicJson');

const PAGE_SIZE = 100;
const MAP_VERSION = 'socrata-pmtiles-v1';
const GEOMETRY_TYPES = new Set([
    'point', 'multipoint', 'line', 'multiline', 'polygon', 'multipolygon',
    // Socrata's legacy location type is emitted as GeoJSON Point geometry.
    'location'
]);

function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function array(value) {
    return Array.isArray(value) ? value : value == null ? [] : [value];
}

function finiteNonNegative(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function timestamp(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    const date = Number.isFinite(number)
        ? new Date(number < 10_000_000_000 ? number * 1000 : number)
        : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function namespace(sourceId, kind, upstreamId) {
    return ['socrata', sourceId, kind, clean(upstreamId).toLowerCase()].join('-');
}

function identityFor(record) {
    return clean(record && record.resource && record.resource.id) || null;
}

function canonicalKey(identity) {
    return clean(identity).toLowerCase();
}

function viewUrl(source, datasetId) {
    return source.homepageUrl.replace(/\/+$/, '') + '/api/views/' + encodeURIComponent(datasetId);
}

function countUrl(source, datasetId) {
    const url = new URL(source.homepageUrl.replace(/\/+$/, '') + '/resource/' +
        encodeURIComponent(datasetId) + '.json');
    url.searchParams.set('$select', 'count(*)');
    return url.href;
}

function csvUrl(source, datasetId) {
    const url = new URL(source.homepageUrl.replace(/\/+$/, '') + '/api/views/' +
        encodeURIComponent(datasetId) + '/rows.csv');
    url.searchParams.set('accessType', 'DOWNLOAD');
    return url.href;
}

function geoJsonBaseUrl(source, datasetId) {
    return source.homepageUrl.replace(/\/+$/, '') + '/resource/' +
        encodeURIComponent(datasetId) + '.geojson';
}

function geoJsonPageUrl(source, datasetId, { limit, offset }) {
    const url = new URL(geoJsonBaseUrl(source, datasetId));
    url.searchParams.set('$limit', String(limit));
    url.searchParams.set('$offset', String(offset));
    // A stable system-row order prevents offset pagination from duplicating or
    // skipping features when the portal's default plan changes.
    url.searchParams.set('$order', ':id');
    return url.href;
}

function customFields(view) {
    const fields = view && view.metadata && view.metadata.custom_fields;
    return fields && typeof fields === 'object' ? fields : {};
}

function supplierFor(view) {
    return clean(customFields(view)['Data Supplier'] &&
        customFields(view)['Data Supplier'].Organization);
}

function recordLicenseUrl(view) {
    const section = customFields(view)['License/Attribution'];
    if (!section || typeof section !== 'object') return '';
    return clean(section['License URL'] || section['License-URL']);
}

function normalizeUrl(value) {
    try {
        const url = new URL(value);
        url.hash = '';
        url.search = '';
        url.pathname = url.pathname.replace(/\/+$/, '');
        return url.href.toLowerCase();
    } catch {
        return '';
    }
}

function licenseFor(view, source) {
    if (supplierFor(view) !== clean(source.dataSupplier)) return null;
    const supplied = normalizeUrl(recordLicenseUrl(view));
    const allowed = new Set(array(source.approvedLicenseUrls).map(normalizeUrl).filter(Boolean));
    if (!supplied || !allowed.has(supplied)) return null;
    return {
        titleEn: source.defaultLicenseTitleEn || null,
        titleFr: source.defaultLicenseTitleFr || null,
        url: source.defaultLicenseUrl,
        attributionEn: source.defaultAttributionEn || null,
        attributionFr: source.defaultAttributionFr || null
    };
}

function cachedRecordCount(view) {
    const counts = [];
    for (const column of array(view && view.columns)) {
        const cached = column && column.cachedContents;
        if (!cached || typeof cached !== 'object') continue;
        const direct = finiteNonNegative(cached.count);
        if (direct != null) counts.push(direct);
        const nonNull = finiteNonNegative(cached.non_null);
        const nulls = finiteNonNegative(cached.null);
        if (nonNull != null && nulls != null) counts.push(nonNull + nulls);
    }
    return counts.length ? Math.max(...counts) : null;
}

async function exactRecordCount(view, source, options = {}) {
    const cached = cachedRecordCount(view);
    if (cached != null) return cached;
    const fetchJson = options.fetchJson || fetchPublicJson;
    try {
        const payload = await fetchJson(countUrl(source, view.id), options.http);
        const count = finiteNonNegative(payload && payload[0] && payload[0].count);
        return count;
    } catch {
        return null;
    }
}

function geometryFields(view) {
    return array(view && view.columns).filter(column =>
        GEOMETRY_TYPES.has(clean(column && column.dataTypeName).toLowerCase()) &&
        clean(column && column.fieldName)
    ).map(column => ({
        name: clean(column.fieldName),
        alias: clean(column.name) || clean(column.fieldName),
        type: clean(column.dataTypeName).toLowerCase()
    }));
}

function directMapVersion(view, source, recordCount) {
    const fields = array(view && view.columns).map(column => ({
        name: clean(column && column.fieldName),
        type: clean(column && column.dataTypeName)
    }));
    const identity = [
        MAP_VERSION,
        source.id,
        clean(view && view.id),
        timestamp(view && view.viewLastModified),
        timestamp(view && view.rowsUpdatedAt),
        recordCount,
        fields,
        geoJsonBaseUrl(source, view && view.id)
    ];
    return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

async function discover(source, options = {}) {
    const fetchJson = options.fetchJson || fetchPublicJson;
    const records = [];
    const identities = new Set();
    let expectedTotal = null;

    for (let offset = 0; expectedTotal == null || offset < expectedTotal; offset += PAGE_SIZE) {
        const url = new URL(source.catalogUrl);
        url.searchParams.set('only', 'datasets');
        url.searchParams.set('search_context', source.upstreamHost);
        url.searchParams.set('limit', String(PAGE_SIZE));
        url.searchParams.set('offset', String(offset));
        const body = await fetchJson(url.href, options.http);
        const total = Number(body && body.resultSetSize);
        const page = body && body.results;
        if (!Number.isInteger(total) || total < 0 || !Array.isArray(page)) {
            throw new Error('Socrata source returned an invalid catalogue response');
        }
        if (expectedTotal == null) expectedTotal = total;
        if (expectedTotal !== total) {
            throw new Error('Socrata source catalogue count changed during pagination');
        }
        const expectedPage = Math.min(PAGE_SIZE, expectedTotal - offset);
        if (page.length !== expectedPage) {
            throw new Error('Socrata source catalogue ended before its advertised count');
        }
        for (const record of page) {
            const identity = identityFor(record);
            if (!identity) throw new Error('Socrata source returned a record without a dataset id');
            const key = canonicalKey(identity);
            if (identities.has(key)) {
                throw new Error('Socrata source returned a duplicate dataset id: ' + identity);
            }
            identities.add(key);
            records.push(record);
        }
    }

    if (!expectedTotal || records.length !== expectedTotal) {
        throw new Error('Socrata source returned an empty or incomplete catalogue');
    }
    return records;
}

async function enrichRecord(record, source, options = {}) {
    const externalId = identityFor(record);
    const catalog = record && record.resource || {};
    if (!externalId || clean(catalog.type).toLowerCase() !== 'dataset' ||
        clean(catalog.lens_view_type).toLowerCase() !== 'tabular') {
        return { status: 'excluded', reason: 'invalid-dataset', externalId };
    }

    const fetchJson = options.fetchJson || fetchPublicJson;
    const view = await fetchJson(viewUrl(source, externalId), options.http);
    if (!view || canonicalKey(view.id) !== canonicalKey(externalId) ||
        !clean(view.name) || view.hideFromCatalog === true || view.hideFromDataJson === true) {
        return { status: 'excluded', reason: 'not-public', externalId: canonicalKey(externalId) };
    }

    const licence = licenseFor(view, source);
    if (!licence) {
        return {
            status: 'excluded',
            reason: supplierFor(view) === clean(source.dataSupplier) ? 'unlicensed' : 'publisher-not-admitted',
            externalId: canonicalKey(externalId)
        };
    }

    const columns = array(view.columns).filter(column => clean(column && column.fieldName));
    if (!columns.length) {
        return { status: 'excluded', reason: 'not-loadable', externalId: canonicalKey(externalId) };
    }
    const recordCount = await exactRecordCount(view, source, options);
    const spatialFields = geometryFields(view);
    const maxMapRows = finiteNonNegative(process.env.MAP_MAX_ROWS) || 1_000_000;
    const hasMap = spatialFields.length > 0 && recordCount != null && recordCount <= maxMapRows;
    const datasetId = namespace(source.id, 'dataset', externalId);
    const resourceId = namespace(source.id, 'resource', externalId);
    const orgId = namespace(source.id, 'org', source.defaultOrganizationId || 'city-of-calgary');
    const modified = timestamp(view.viewLastModified || view.rowsUpdatedAt || catalog.updatedAt);
    const keywords = Array.from(new Set(array(view.tags).concat(array(catalog.domain_tags))
        .map(clean).filter(Boolean)));
    const title = clean(view.name || catalog.name);
    const rawIdentity = {
        provider: 'socrata',
        source_id: source.id,
        upstream_dataset_id: externalId
    };

    return {
        status: 'included',
        value: {
            externalId: canonicalKey(externalId),
            organization: {
                id: orgId,
                name: source.id + '-' + (source.defaultOrganizationName || 'city-of-calgary'),
                titleEn: source.defaultOrganizationTitleEn || source.dataSupplier,
                titleFr: source.defaultOrganizationTitleFr || null,
                placeId: source.placeId
            },
            dataset: {
                id: datasetId,
                name: source.id + '-' + canonicalKey(externalId),
                titleEn: title,
                titleFr: null,
                notesEn: clean(view.description || catalog.description) || null,
                notesFr: null,
                orgId,
                keywordsEn: keywords,
                keywordsFr: [],
                metadataModified: modified,
                raw: { ...rawIdentity, metadata_language: 'en' }
            },
            source: {
                sourceId: source.id,
                externalId: canonicalKey(externalId),
                datasetId,
                landingUrl: source.homepageUrl.replace(/\/+$/, '') + '/d/' + encodeURIComponent(externalId),
                licenseTitleEn: licence.titleEn,
                licenseTitleFr: licence.titleFr,
                licenseUrl: licence.url,
                attributionEn: licence.attributionEn,
                attributionFr: licence.attributionFr,
                isAuthoritative: true,
                raw: {
                    upstream_dataset_id: externalId,
                    data_supplier: supplierFor(view),
                    license_url: recordLicenseUrl(view),
                    rows_updated_at: timestamp(view.rowsUpdatedAt),
                    view_last_modified: timestamp(view.viewLastModified)
                }
            },
            resources: [{
                id: resourceId,
                datasetId,
                nameEn: title,
                nameFr: null,
                format: 'CSV',
                url: csvUrl(source, externalId),
                sizeBytes: null,
                datastoreActive: false,
                language: 'en',
                lastModified: modified,
                raw: {
                    ...rawIdentity,
                    original_format: 'CSV',
                    record_count: recordCount,
                    field_count: columns.length,
                    rows_updated_at: timestamp(view.rowsUpdatedAt),
                    view_last_modified: timestamp(view.viewLastModified),
                    geometry_fields: spatialFields
                }
            }],
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
            mapCandidates: hasMap ? [{
                resourceId,
                desiredVersion: directMapVersion(view, source, recordCount),
                mode: 'socrata-geojson-pmtiles',
                sourceUrl: geoJsonBaseUrl(source, externalId),
                expectedRows: recordCount,
                expectedVertices: null,
                expectedBytes: null,
                raw: {
                    ...rawIdentity,
                    geometry_fields: spatialFields,
                    rows_updated_at: timestamp(view.rowsUpdatedAt),
                    view_last_modified: timestamp(view.viewLastModified)
                }
            }] : []
        }
    };
}

module.exports = {
    PAGE_SIZE,
    MAP_VERSION,
    discover,
    enrichRecord,
    identityFor,
    canonicalKey,
    namespace,
    viewUrl,
    countUrl,
    csvUrl,
    geoJsonBaseUrl,
    geoJsonPageUrl,
    licenseFor,
    cachedRecordCount,
    exactRecordCount,
    geometryFields,
    directMapVersion,
    timestamp
};
